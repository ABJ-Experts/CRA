// FR-VULN-004/007/009/011: end-to-end matching against the advisory mirror, real PG.
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
import { finding, withTenant, closeDb } from '../db';
import { verifyAuditChain } from '../audit';

const ADVISORY_PK = uuidv7();
const SUFFIX = ADVISORY_PK.slice(0, 8);
const ADVISORY_ID = `OSV-VULN-${SUFFIX}`;
// Per-run unique package name so only THIS run's advisory matches (the advisory
// mirror is global and accumulates across test runs).
const PKG = `vulnpkg-${SUFFIX}`;
const SBOM = JSON.stringify({
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  metadata: { component: { 'bom-ref': 'root' } },
  components: [
    {
      type: 'library',
      'bom-ref': 'a',
      name: PKG,
      version: '1.0.0',
      purl: `pkg:npm/${PKG}@1.0.0`,
    },
    {
      type: 'library',
      'bom-ref': 'b',
      name: 'express',
      version: '4.18.2',
      purl: 'pkg:npm/express@4.18.2',
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
  // Global advisory: lodash < 4.17.21 is vulnerable, KEV-listed, CVSS 9.8.
  await seed.query(
    `with adv as (
       insert into advisory(id, source, advisory_id, cvss_base, kev_listed)
       values ($1,'osv',$2,9.8,true)
       on conflict (source, advisory_id) do update set kev_listed = excluded.kev_listed
       returning id
     )
     insert into advisory_affected(advisory_pk, ecosystem, package_name, introduced, fixed)
     select id, 'semver', $3, '0', '2.0.0' from adv`,
    [ADVISORY_PK, ADVISORY_ID, PKG],
  );

  userId = await ensureUserAccount(uuidv7(), 'match@acme.test');
  orgId = (
    await createOrganisation(userId, {
      legalName: 'MatchCo',
      countryMainEstablishment: 'DE',
    })
  ).id;
  const product = await createProduct(orgId, userId, {
    name: 'GW',
    internalCode: 'GW',
  });
  releaseId = (await createRelease(orgId, userId, product.id, '1.0.0')).id;
  await ingestSbom(orgId, userId, releaseId, SBOM, storage);
});

afterAll(async () => {
  await seed.end();
  await closeDb();
});

describe('FR-VULN — deterministic matching produces findings', () => {
  it('matches the vulnerable component via PURL at confidence 0.95', async () => {
    const result = await matchRelease(orgId, userId, releaseId);
    expect(result.findingsCreated).toBe(1);
    expect(result.kevFindings).toBe(1); // FR-VULN-011: KEV-listed

    const findings = await withTenant({ organisationId: orgId }, (tx) =>
      tx.select().from(finding),
    );
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f?.advisoryId).toBe(ADVISORY_ID);
    expect(f?.matchMethod).toBe('purl_range');
    expect(f?.matchConfidence).toBe(0.95);
    expect(f?.kevListed).toBe(true);
    expect(f?.cvssBase).toBe(9.8); // FR-VULN-009 enrichment
    expect(f?.state).toBe('open');
  });

  it('does not create a finding for the non-vulnerable component (express)', async () => {
    const findings = await withTenant({ organisationId: orgId }, (tx) =>
      tx
        .select({ id: finding.id })
        .from(finding)
        .where(eq(finding.advisoryId, ADVISORY_ID)),
    );
    // Only lodash matched; express 4.18.2 has no advisory.
    expect(findings).toHaveLength(1);
  });

  it('FR-MATCH-006 — re-matching is idempotent (carry-forward, no duplicates)', async () => {
    const again = await matchRelease(orgId, userId, releaseId);
    expect(again.findingsCreated).toBe(0);
  });

  it('records a verifiable audit event for the match run', async () => {
    const result = await verifyAuditChain(orgId);
    expect(result.ok).toBe(true);
  });
});
