// Tier 2 of the accuracy harness (FR-MATCH-005): package IDENTITY through the
// real Postgres-backed AdvisoryLookup adapter.
//
// Tier 1 (packages/sbom-core/src/golden/) proves the engine. It cannot prove the
// adapter, and the adapter is where identity actually broke: the engine was
// handed a namespace it was never given the data to use, and the SQL prefilter
// joined on sbom_component.name — a string the build tool chooses, not a package
// identity. Both defects were invisible to every existing test because the
// conventions happened to agree for unscoped npm packages, which is what the
// fixtures used.
//
// Every case here is a case Tier 1 already asserts at engine level. If these two
// files ever disagree, the adapter is lying about identity.
import '../env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { ensureUserAccount } from '../identity';
import { createOrganisation } from '../org';
import { createProduct } from '../product';
import { createRelease, ingestSbom } from '../sbom';
import { InMemoryStorageProvider } from '../storage';
import { matchRelease } from './matching.service';
import { finding, sbomComponent, withTenant, closeDb } from '../db';

// The advisory mirror is GLOBAL and accumulates across runs, so every package
// name is namespaced with a per-run suffix. Without this a previous run's
// advisory matches this run's components and the failure looks like a matcher
// bug rather than a fixture leak.
const SUFFIX = uuidv7().slice(0, 8);

const MAVEN_ARTIFACT = `collide-${SUFFIX}`;
const MAVEN_OWNER_NS = 'org.apache.golden';
const MAVEN_OTHER_NS = 'com.example.golden';
const NPM_SCOPE = `@golden-${SUFFIX}`;
const NPM_NAME = 'core';
const GO_NAMESPACE = 'github.com/golden';
const GO_NAME = `gin-${SUFFIX}`;
const DEB_NAME = `osslib-${SUFFIX}`;

interface SeedAdvisory {
  advisoryId: string;
  ecosystem: string;
  packageName: string;
  namespace: string | null;
}

const ADVISORIES: SeedAdvisory[] = [
  {
    advisoryId: `GOLDEN-MAVEN-${SUFFIX}`,
    ecosystem: 'maven',
    packageName: MAVEN_ARTIFACT,
    namespace: MAVEN_OWNER_NS,
  },
  {
    advisoryId: `GOLDEN-NPM-${SUFFIX}`,
    ecosystem: 'semver',
    packageName: NPM_NAME,
    namespace: NPM_SCOPE,
  },
  {
    advisoryId: `GOLDEN-GO-${SUFFIX}`,
    ecosystem: 'go',
    packageName: GO_NAME,
    namespace: GO_NAMESPACE,
  },
  {
    // Deliberately UNSCOPED, which is what every non-Maven feed actually writes
    // for an OS package. It must still match a Debian PURL, which always carries
    // a distro namespace.
    advisoryId: `GOLDEN-DEB-${SUFFIX}`,
    ecosystem: 'deb',
    packageName: DEB_NAME,
    namespace: null,
  },
];

// One SBOM holding every case at once, so a component is exposed to all four
// advisories and an over-reaching matcher shows up as a false positive.
const SBOM = JSON.stringify({
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  metadata: { component: { 'bom-ref': 'root' } },
  components: [
    {
      // cyclonedx-maven puts the artifactId in `name` and the groupId in `group`.
      type: 'library',
      'bom-ref': 'maven-owner',
      name: MAVEN_ARTIFACT,
      group: MAVEN_OWNER_NS,
      version: '1.9',
      purl: `pkg:maven/${MAVEN_OWNER_NS}/${MAVEN_ARTIFACT}@1.9`,
    },
    {
      // Same artifactId, different groupId. A different package entirely.
      type: 'library',
      'bom-ref': 'maven-other',
      name: MAVEN_ARTIFACT,
      group: MAVEN_OTHER_NS,
      version: '1.9',
      purl: `pkg:maven/${MAVEN_OTHER_NS}/${MAVEN_ARTIFACT}@1.9`,
    },
    {
      // cyclonedx-npm writes the whole scoped name into `name`, so the SBOM name
      // and the PURL name differ. Matching on the SBOM name misses this entirely.
      type: 'library',
      'bom-ref': 'npm-scoped',
      name: `${NPM_SCOPE}/${NPM_NAME}`,
      version: '7.0.0',
      purl: `pkg:npm/${encodeURIComponent(NPM_SCOPE)}/${NPM_NAME}@7.0.0`,
    },
    {
      type: 'library',
      'bom-ref': 'go-module',
      name: GO_NAME,
      version: 'v1.0.0',
      purl: `pkg:golang/${GO_NAMESPACE}/${GO_NAME}@v1.0.0`,
    },
    {
      type: 'library',
      'bom-ref': 'deb-pkg',
      name: DEB_NAME,
      version: '2.0',
      purl: `pkg:deb/debian/${DEB_NAME}@2.0`,
    },
  ],
});

const storage = new InMemoryStorageProvider();
let seed: Pool;
let userId: string;
let orgId: string;
let releaseId: string;

beforeAll(async () => {
  seed = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });

  for (const adv of ADVISORIES) {
    await seed.query(
      `with adv as (
         insert into advisory(id, source, advisory_id, cvss_base, kev_listed)
         values ($1,'osv',$2,7.5,false)
         on conflict (source, advisory_id) do update set cvss_base = excluded.cvss_base
         returning id
       )
       insert into advisory_affected(advisory_pk, ecosystem, package_name, namespace, introduced, fixed)
       select id, $3, $4, $5, '0', $6 from adv`,
      [
        uuidv7(),
        adv.advisoryId,
        adv.ecosystem,
        adv.packageName,
        adv.namespace,
        // An upper bound above every fixture version, so the range never decides
        // the outcome — only identity does. That keeps a failure here
        // unambiguous: it is an identity bug, not a comparator bug.
        adv.ecosystem === 'go' ? 'v99.0.0' : '99.0.0',
      ],
    );
  }

  userId = await ensureUserAccount(uuidv7(), `golden-${SUFFIX}@acme.test`);
  orgId = (
    await createOrganisation(userId, {
      legalName: `GoldenCo-${SUFFIX}`,
      countryMainEstablishment: 'DE',
    })
  ).id;
  const product = await createProduct(orgId, userId, {
    name: 'Gateway',
    internalCode: `GW-${SUFFIX}`,
  });
  releaseId = (await createRelease(orgId, userId, product.id, '1.0.0')).id;
  await ingestSbom(orgId, userId, releaseId, SBOM, storage);
  await matchRelease(orgId, userId, releaseId);
});

afterAll(async () => {
  await seed.end();
  await closeDb();
});

/** The findings this run produced, as (bom-ref, advisoryId) pairs. */
async function findingsByComponent(): Promise<Set<string>> {
  const rows = await withTenant({ organisationId: orgId }, (tx) =>
    tx
      .select({
        advisoryId: finding.advisoryId,
        purl: sbomComponent.purl,
      })
      .from(finding)
      .innerJoin(sbomComponent, eq(sbomComponent.id, finding.sbomComponentId)),
  );
  return new Set(rows.map((r) => `${r.purl} -> ${r.advisoryId}`));
}

describe('FR-MATCH-005 tier 2 — package identity through the DB adapter', () => {
  it('matches a Maven artifact under its own groupId', async () => {
    expect([...(await findingsByComponent())]).toContain(
      `pkg:maven/${MAVEN_OWNER_NS}/${MAVEN_ARTIFACT}@1.9 -> GOLDEN-MAVEN-${SUFFIX}`,
    );
  });

  it('does NOT match the same artifactId under a different groupId', async () => {
    // The false positive. advisory_affected.namespace was populated by the feed
    // and then never selected, so the adapter could not tell these two apart.
    expect([...(await findingsByComponent())]).not.toContain(
      `pkg:maven/${MAVEN_OTHER_NS}/${MAVEN_ARTIFACT}@1.9 -> GOLDEN-MAVEN-${SUFFIX}`,
    );
  });

  it('matches a scoped npm package', async () => {
    // The false negative, and the more dangerous of the two: a missing finding
    // is invisible. The SBOM name here is "@scope/core" while the PURL name is
    // "core", so a prefilter on sbom_component.name loads no advisory at all.
    expect([...(await findingsByComponent())]).toContain(
      `pkg:npm/${encodeURIComponent(NPM_SCOPE)}/${NPM_NAME}@7.0.0 -> GOLDEN-NPM-${SUFFIX}`,
    );
  });

  it('matches a Go module by its full module path', async () => {
    expect([...(await findingsByComponent())]).toContain(
      `pkg:golang/${GO_NAMESPACE}/${GO_NAME}@v1.0.0 -> GOLDEN-GO-${SUFFIX}`,
    );
  });

  it('matches an unscoped advisory against a namespaced Debian PURL', async () => {
    // pkg:deb/debian/... carries a distro namespace no feed ever supplies.
    // Requiring namespace equality here would drop every OS-package finding.
    expect([...(await findingsByComponent())]).toContain(
      `pkg:deb/debian/${DEB_NAME}@2.0 -> GOLDEN-DEB-${SUFFIX}`,
    );
  });

  it('produces exactly four findings — one per genuinely affected component', async () => {
    // Asserting the total as well as the individual pairs: a fix that matched
    // everything would satisfy all four positive cases above on its own.
    const ours = [...(await findingsByComponent())].filter((k) =>
      k.includes(SUFFIX),
    );
    expect(ours).toHaveLength(4);
  });
});
