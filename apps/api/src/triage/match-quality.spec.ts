// FR-MATCH-003 (confidence threshold in the queue) and FR-MATCH-004 (structured
// false-positive feedback), end to end against real PG.
import '../env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { CONFIDENCE } from '@repo/sbom-core';
import { ensureUserAccount } from '../identity';
import { createOrganisation } from '../org';
import { createProduct } from '../product';
import { createRelease, ingestSbom } from '../sbom';
import { InMemoryStorageProvider } from '../storage';
import { matchRelease } from '../vuln';
import { verifyAuditChain } from '../audit';
import { closeDb, finding, withTenant } from '../db';
import { eq } from 'drizzle-orm';
import {
  confidenceThreshold,
  falsePositiveRates,
  listFindings,
  markFalsePositive,
} from './triage.service';

const SUFFIX = uuidv7().slice(0, 8);
const NAME = `qualitypkg-${SUFFIX}`;
const SBOM = JSON.stringify({
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  metadata: { component: { 'bom-ref': 'root' } },
  components: [
    {
      type: 'library',
      'bom-ref': 'a',
      name: NAME,
      version: '1.0.0',
      purl: `pkg:npm/${NAME}@1.0.0`,
    },
  ],
});

const storage = new InMemoryStorageProvider();
let seed: Pool;
let userId: string;
let orgId: string;
let findingId: string;

beforeAll(async () => {
  seed = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await seed.query(
    `with adv as (
       insert into advisory(id, source, advisory_id, cvss_base, kev_listed)
       values ($1,'osv',$2,9.8,false)
       on conflict (source, advisory_id) do update set cvss_base = excluded.cvss_base
       returning id
     )
     insert into advisory_affected(advisory_pk, ecosystem, package_name, introduced, fixed)
     select id, 'semver', $3, '0', '2.0.0' from adv`,
    [uuidv7(), `OSV-QUALITY-${SUFFIX}`, NAME],
  );
  userId = await ensureUserAccount(uuidv7(), `quality-${SUFFIX}@acme.test`);
  orgId = (
    await createOrganisation(userId, {
      legalName: `QualityCo-${SUFFIX}`,
      countryMainEstablishment: 'DE',
    })
  ).id;
  const product = await createProduct(orgId, userId, {
    name: 'GW',
    internalCode: `GW-${SUFFIX}`,
  });
  const releaseId = (await createRelease(orgId, userId, product.id, '1.0.0'))
    .id;
  await ingestSbom(orgId, userId, releaseId, SBOM, storage);
  await matchRelease(orgId, userId, releaseId);
  const rows = (await listFindings(orgId, {})).items;
  findingId = rows[0]!.id;
});

afterAll(async () => {
  delete process.env.MATCH_CONFIDENCE_THRESHOLD;
  await seed.end();
  await closeDb();
});

describe('FR-MATCH-003 — confidence threshold', () => {
  it('defaults to the version-specific CPE confidence', () => {
    delete process.env.MATCH_CONFIDENCE_THRESHOLD;
    expect(confidenceThreshold()).toBe(CONFIDENCE.CPE_VERSION_SPECIFIC);
  });

  it('is configurable', () => {
    process.env.MATCH_CONFIDENCE_THRESHOLD = '0.9';
    expect(confidenceThreshold()).toBe(0.9);
    delete process.env.MATCH_CONFIDENCE_THRESHOLD;
  });

  it('rejects a malformed threshold rather than silently collapsing nothing', () => {
    // Coercing this to 0 would disable the queue's noise control in production
    // while every test still passed.
    process.env.MATCH_CONFIDENCE_THRESHOLD = 'aggressive';
    expect(() => confidenceThreshold()).toThrow(/between 0 and 1/);
    process.env.MATCH_CONFIDENCE_THRESHOLD = '7';
    expect(() => confidenceThreshold()).toThrow(/between 0 and 1/);
    delete process.env.MATCH_CONFIDENCE_THRESHOLD;
  });

  it('flags a PURL match as high confidence', async () => {
    delete process.env.MATCH_CONFIDENCE_THRESHOLD;
    const [f] = (await listFindings(orgId, {})).items;
    expect(f!.matchConfidence).toBe(CONFIDENCE.PURL_RANGE);
    expect(f!.lowConfidence).toBe(false);
  });

  it('still RETURNS a low-confidence finding, flagged rather than hidden', async () => {
    // "visible but collapsed by default, so the queue reflects what is worth
    // acting on without hiding anything".
    process.env.MATCH_CONFIDENCE_THRESHOLD = '0.99';
    const rows = (await listFindings(orgId, {})).items;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.lowConfidence).toBe(true);
    delete process.env.MATCH_CONFIDENCE_THRESHOLD;
  });

  it('excludes below-threshold rows only when minConfidence is explicit', async () => {
    expect(
      (await listFindings(orgId, { minConfidence: 0.99 })).items,
    ).toHaveLength(0);
    expect(
      (await listFindings(orgId, { minConfidence: 0.5 })).items,
    ).toHaveLength(1);
  });
});

describe('FR-MATCH-004 — structured false-positive feedback', () => {
  it('records the reason, closes the finding and audits it', async () => {
    const updated = await markFalsePositive(
      orgId,
      userId,
      findingId,
      'wrong_package',
    );
    expect(updated.falsePositiveReason).toBe('wrong_package');
    expect(updated.state).toBe('closed');

    const [row] = await withTenant({ organisationId: orgId }, (tx) =>
      tx.select().from(finding).where(eq(finding.id, findingId)),
    );
    expect(row!.falsePositiveAt).toBeInstanceOf(Date);
    expect(row!.falsePositiveBy).toBe(userId);

    expect((await verifyAuditChain(orgId)).ok).toBe(true);
  });

  it('rejects a reason outside the permitted set at the database', async () => {
    // The CHECK constraint is the backstop for anything that bypasses the Zod
    // enum on the controller — a job, a migration, a console.
    await expect(
      seed.query(
        `update finding set false_positive_reason = 'because' where id = $1`,
        [findingId],
      ),
    ).rejects.toThrow();
  });

  it('reports rates by method, ecosystem and feed', async () => {
    const rates = await falsePositiveRates(orgId);
    const dims = new Set(rates.map((r) => r.dimension));
    expect(dims).toEqual(new Set(['method', 'ecosystem', 'feed']));

    const byMethod = rates.find(
      (r) => r.dimension === 'method' && r.key === 'purl_range',
    );
    // One finding, marked false positive above -> a rate of 1 on this tenant.
    expect(byMethod).toMatchObject({ total: 1, falsePositives: 1, rate: 1 });

    expect(
      rates.find((r) => r.dimension === 'ecosystem' && r.key === 'semver'),
    ).toMatchObject({ falsePositives: 1 });
    expect(
      rates.find((r) => r.dimension === 'feed' && r.key === 'osv'),
    ).toMatchObject({ falsePositives: 1 });
  });
});
