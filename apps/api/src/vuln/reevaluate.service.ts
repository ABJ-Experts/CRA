// FR-VULN-008 — continuous re-evaluation. A newly published or newly amended
// advisory has to reach releases that were ingested weeks ago; without this, a
// finding only ever appears at SBOM upload time and the mirror going stale is
// indistinguishable from the product being safe.
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { parsePurl } from '@repo/sbom-core';
import {
  advisory,
  advisoryAffected,
  sbomComponent,
  sbomDocument,
  withTenant,
} from '../db';
import { matchRelease, type MatchReleaseResult } from './matching.service';

export interface ReevaluationResult extends MatchReleaseResult {
  releasesReevaluated: number;
}

/**
 * Which releases could an advisory change the answer for?
 *
 * Scoped by (ecosystem, package name) rather than re-matching everything: the
 * matcher's own lookup keys on exactly that pair, so a release with no component
 * in any changed package cannot produce a different result no matter how the
 * advisory moved. On a tenant with 5,000 releases this is the difference between
 * a targeted pass and a full re-scan on every hourly KEV refresh.
 */
async function releasesTouchedBy(
  organisationId: string,
  advisoryIds: string[],
): Promise<string[]> {
  return withTenant({ organisationId }, async (tx) => {
    const packages = await tx
      .selectDistinct({
        ecosystem: advisoryAffected.ecosystem,
        packageName: advisoryAffected.packageName,
      })
      .from(advisoryAffected)
      .innerJoin(advisory, eq(advisory.id, advisoryAffected.advisoryPk))
      .where(inArray(advisory.advisoryId, advisoryIds));

    if (packages.length === 0) return [];

    // Enrichment-only changes (KEV, EPSS) carry no affected ranges of their own,
    // so match on the names the advisory already had in the mirror.
    const names = new Set(packages.map((p) => p.packageName));
    const ecosystems = [...new Set(packages.map((p) => p.ecosystem))];

    // Narrow in SQL by ecosystem only, then compare package identity in memory.
    // advisory.package_name is a canonical PURL-shaped name, whereas
    // sbom_component.name is whatever the build tool wrote, so joining the two
    // directly silently drops every scoped npm package and Go module. Selecting
    // a superset is safe here: this only picks candidate releases and
    // matchRelease redoes the precise work.
    const rows = await tx
      .selectDistinct({
        releaseId: sbomDocument.productReleaseId,
        purl: sbomComponent.purl,
      })
      .from(sbomComponent)
      .innerJoin(
        sbomDocument,
        eq(sbomDocument.id, sbomComponent.sbomDocumentId),
      )
      .where(
        and(
          inArray(sbomComponent.ecosystem, ecosystems),
          eq(sbomDocument.validationStatus, 'valid'),
          isNotNull(sbomComponent.purl),
        ),
      );

    const affected = rows.filter((r) => {
      const name = r.purl ? parsePurl(r.purl)?.name : null;
      return name ? names.has(name) : false;
    });
    return [...new Set(affected.map((r) => r.releaseId))];
  });
}

/**
 * Re-run matching for every release this organisation holds that could be
 * affected by the given advisories.
 *
 * Safe to run repeatedly: matchRelease inserts with ON CONFLICT DO NOTHING, so a
 * finding that already carries a human assessment is left exactly as it is
 * (FR-MATCH-006). The counts returned are new findings only.
 */
export async function reevaluateForAdvisories(
  organisationId: string,
  userAccountId: string,
  advisoryIds: string[],
): Promise<ReevaluationResult> {
  if (advisoryIds.length === 0)
    return { releasesReevaluated: 0, findingsCreated: 0, kevFindings: 0 };

  const releaseIds = await releasesTouchedBy(organisationId, advisoryIds);

  let findingsCreated = 0;
  let kevFindings = 0;
  for (const releaseId of releaseIds) {
    const result = await matchRelease(organisationId, userAccountId, releaseId);
    findingsCreated += result.findingsCreated;
    kevFindings += result.kevFindings;
  }

  return {
    releasesReevaluated: releaseIds.length,
    findingsCreated,
    kevFindings,
  };
}
