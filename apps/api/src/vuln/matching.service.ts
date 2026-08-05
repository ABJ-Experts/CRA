import { and, desc, eq, inArray } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import {
  matchComponent,
  parsePurl,
  type Advisory,
  type AdvisoryLookup,
  type Ecosystem,
  type NormalizedComponent,
} from '@repo/sbom-core';
import {
  advisory,
  advisoryAffected,
  finding,
  sbomComponent,
  sbomDocument,
  withTenant,
  type Tx,
} from '../db';
import { recordAuditInTx } from '../audit';
import { DomainError } from '../product';

interface AdvisoryMeta {
  pk: string;
  source: string;
  advisoryId: string;
  cvssBase: number | null;
  epssScore: number | null;
  kevListed: boolean;
}

function toNormalised(
  row: typeof sbomComponent.$inferSelect,
): NormalizedComponent {
  return {
    purl: row.purl,
    cpe: row.cpe,
    name: row.name,
    version: row.version,
    ecosystem: row.ecosystem as Ecosystem | null,
    versionNormalised: row.versionNormalised,
    depth: row.depth,
    scope: row.scope as NormalizedComponent['scope'],
    supplierName: row.supplierName,
    hashes: (row.hashes as Record<string, string>) ?? {},
  };
}

// Build an in-memory advisory lookup for the components' (ecosystem, name) pairs.
//
// The prefilter is deliberately COARSE — keyed on (ecosystem, name) without the
// namespace — because the unscoped-namespace rule (a null advisory namespace
// matches anything) is awkward to express in SQL and easy to get subtly wrong
// there. The precise identity check runs in the engine, which re-verifies name
// and namespace on every candidate. See namespaceMatches in @repo/sbom-core.
async function loadLookup(
  tx: Tx,
  components: (typeof sbomComponent.$inferSelect)[],
): Promise<{ lookup: AdvisoryLookup; meta: Map<string, AdvisoryMeta> }> {
  // Query by the PURL-derived name, NOT sbom_component.name. The raw SBOM name
  // is whatever the build tool wrote — cyclonedx-maven puts the artifactId there
  // and the groupId in `group`, cyclonedx-npm writes "@babel/core" whole — so it
  // is not a package identity and must never be joined against the feed mirror.
  const names = [
    ...new Set(
      components
        .map((c) => (c.purl ? (parsePurl(c.purl)?.name ?? null) : null))
        .filter((n): n is string => Boolean(n)),
    ),
  ];
  const byKey = new Map<string, Map<string, Advisory>>();
  const meta = new Map<string, AdvisoryMeta>();

  if (names.length > 0) {
    const rows = await tx
      .select({
        pk: advisory.id,
        source: advisory.source,
        advisoryId: advisory.advisoryId,
        cvssBase: advisory.cvssBase,
        epssScore: advisory.epssScore,
        kevListed: advisory.kevListed,
        ecosystem: advisoryAffected.ecosystem,
        packageName: advisoryAffected.packageName,
        namespace: advisoryAffected.namespace,
        introduced: advisoryAffected.introduced,
        fixed: advisoryAffected.fixed,
        lastAffected: advisoryAffected.lastAffected,
      })
      .from(advisoryAffected)
      .innerJoin(advisory, eq(advisory.id, advisoryAffected.advisoryPk))
      .where(inArray(advisoryAffected.packageName, names));

    for (const r of rows) {
      meta.set(r.pk, {
        pk: r.pk,
        source: r.source,
        advisoryId: r.advisoryId,
        cvssBase: r.cvssBase,
        epssScore: r.epssScore,
        kevListed: r.kevListed,
      });
      const key = `${r.ecosystem}::${r.packageName}`;
      let group = byKey.get(key);
      if (!group) {
        group = new Map<string, Advisory>();
        byKey.set(key, group);
      }
      let adv = group.get(r.pk);
      if (!adv) {
        // advisoryId carries the PK so persistence can look up enrichment by it.
        adv = { advisoryId: r.pk, source: r.source, affected: [] };
        group.set(r.pk, adv);
      }
      let pkg = adv.affected.find(
        (p) =>
          p.ecosystem === r.ecosystem &&
          p.name === r.packageName &&
          (p.namespace ?? null) === r.namespace,
      );
      if (!pkg) {
        pkg = {
          ecosystem: r.ecosystem as Ecosystem,
          name: r.packageName,
          // Carrying the namespace is what lets the engine tell
          // org.apache.commons:commons-text apart from com.example:commons-text.
          namespace: r.namespace,
          ranges: [],
        };
        adv.affected.push(pkg);
      }
      pkg.ranges.push({
        introduced: r.introduced ?? undefined,
        fixed: r.fixed ?? undefined,
        lastAffected: r.lastAffected ?? undefined,
      });
    }
  }

  const lookup: AdvisoryLookup = {
    // Coarse index by (ecosystem, name). The namespace argument is intentionally
    // not applied here: this returns a superset and the engine narrows it, so an
    // advisory with no namespace still reaches a namespaced component.
    byPurl: (_type, _ns, name, ecosystem) => [
      ...(byKey.get(`${ecosystem}::${name}`)?.values() ?? []),
    ],
    // FR-VULN-005 (V1): CPE fallback matching. The mirror already stores NVD's
    // CPE ranges (advisory_cpe), so enabling this layer is a code change rather
    // than a re-sync — but it stays off until §10.4's confidence handling and the
    // "collapsed by default below threshold" queue behaviour ship with it.
    byCpe: () => [],
  };
  return { lookup, meta };
}

export interface MatchReleaseResult {
  findingsCreated: number;
  kevFindings: number;
}

/**
 * Correlate a release's SBOM components against the advisory mirror and persist
 * findings (deterministic, ADR-010). Existing findings are preserved (carry-forward
 * of a prior human assessment); only new (component, advisory) pairs are inserted.
 */
export async function matchRelease(
  organisationId: string,
  userAccountId: string,
  productReleaseId: string,
): Promise<MatchReleaseResult> {
  return withTenant({ organisationId, userId: userAccountId }, async (tx) => {
    const [doc] = await tx
      .select({ id: sbomDocument.id })
      .from(sbomDocument)
      .where(
        and(
          eq(sbomDocument.productReleaseId, productReleaseId),
          eq(sbomDocument.validationStatus, 'valid'),
        ),
      )
      .orderBy(desc(sbomDocument.createdAt))
      .limit(1);
    if (!doc)
      throw new DomainError('not_found', 'No valid SBOM for this release');

    const components = await tx
      .select()
      .from(sbomComponent)
      .where(eq(sbomComponent.sbomDocumentId, doc.id));

    const { lookup, meta } = await loadLookup(tx, components);

    // Collect first, insert in batches. One statement per (component, advisory)
    // meant a 5,000-component SBOM against a populated mirror issued tens of
    // thousands of round trips inside a single transaction, which is well outside
    // the NFR-003 60-second budget.
    const rows: (typeof finding.$inferInsert)[] = [];
    const kevByKey = new Map<string, boolean>();

    for (const component of components) {
      for (const candidate of matchComponent(toNormalised(component), lookup)) {
        const advisoryMeta = meta.get(candidate.advisoryId);
        if (!advisoryMeta) continue;
        rows.push({
          id: uuidv7(),
          organisationId,
          productReleaseId,
          sbomComponentId: component.id,
          advisoryPk: advisoryMeta.pk,
          advisorySource: advisoryMeta.source,
          advisoryId: advisoryMeta.advisoryId,
          matchMethod: candidate.method,
          matchConfidence: candidate.confidence,
          cvssBase: advisoryMeta.cvssBase,
          epssScore: advisoryMeta.epssScore,
          kevListed: advisoryMeta.kevListed,
          createdBy: userAccountId,
          updatedBy: userAccountId,
        });
        kevByKey.set(
          `${component.id}::${advisoryMeta.pk}`,
          advisoryMeta.kevListed,
        );
      }
    }

    let findingsCreated = 0;
    let kevFindings = 0;
    const BATCH = 500;

    for (let i = 0; i < rows.length; i += BATCH) {
      const inserted = await tx
        .insert(finding)
        .values(rows.slice(i, i + BATCH))
        // Carry-forward (FR-MATCH-006): an existing finding keeps its human
        // assessment. Re-matching must never resurrect a triaged item as untriaged.
        .onConflictDoNothing({
          target: [
            finding.organisationId,
            finding.sbomComponentId,
            finding.advisoryPk,
          ],
        })
        .returning({
          sbomComponentId: finding.sbomComponentId,
          advisoryPk: finding.advisoryPk,
        });

      findingsCreated += inserted.length;
      for (const row of inserted)
        if (kevByKey.get(`${row.sbomComponentId}::${row.advisoryPk}`))
          kevFindings += 1;
    }

    await recordAuditInTx(tx, organisationId, {
      actorType: 'system',
      actorId: userAccountId,
      action: 'release.matched',
      resourceType: 'product_release',
      resourceId: productReleaseId,
      afterState: { findingsCreated, kevFindings },
    });

    return { findingsCreated, kevFindings };
  });
}
