// FR-AN-001/009 — dashboard aggregates are tenant-isolated: org B's dashboard must
// never count org A's findings. Real PG with RLS forced.
import '../env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { ensureUserAccount } from '../identity';
import { createOrganisation } from '../org';
import { createProduct } from '../product';
import { createRelease, ingestSbom } from '../sbom';
import { InMemoryStorageProvider } from '../storage';
import { matchRelease } from '../vuln';
import { getDashboard } from './analytics.service';
import { closeDb } from '../db';

const PK = uuidv7();
const SUFFIX = PK.slice(0, 8);
const VULN = `anpkg-${SUFFIX}`;
const vulnSbom = JSON.stringify({
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  metadata: { component: { 'bom-ref': 'root' } },
  components: [
    {
      type: 'library',
      'bom-ref': 'a',
      name: VULN,
      version: '1.0.0',
      purl: `pkg:npm/${VULN}@1.0.0`,
    },
  ],
});
const cleanSbom = JSON.stringify({
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  metadata: { component: { 'bom-ref': 'root' } },
  components: [
    {
      type: 'library',
      'bom-ref': 'b',
      name: 'left-pad',
      version: '1.3.0',
      purl: 'pkg:npm/left-pad@1.3.0',
    },
  ],
});

const storage = new InMemoryStorageProvider();
let seed: Pool;
let userA: string;
let userB: string;
let orgA: string;
let orgB: string;

async function onboard(
  user: string,
  legalName: string,
  sbom: string,
): Promise<string> {
  const org = (
    await createOrganisation(user, {
      legalName,
      countryMainEstablishment: 'DE',
    })
  ).id;
  const product = await createProduct(org, user, {
    name: 'P',
    internalCode: 'P',
  });
  const releaseId = (await createRelease(org, user, product.id, '1.0.0')).id;
  await ingestSbom(org, user, releaseId, sbom, storage);
  await matchRelease(org, user, releaseId);
  return org;
}

beforeAll(async () => {
  seed = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await seed.query(
    `with adv as (
       insert into advisory(id, source, advisory_id, cvss_base, kev_listed)
       values ($1,'osv',$2,9.8,true)
       on conflict (source, advisory_id) do update set kev_listed = excluded.kev_listed
       returning id
     )
     insert into advisory_affected(advisory_pk, ecosystem, package_name, introduced, fixed)
     select id, 'semver', $3, '0', '2.0.0' from adv`,
    [PK, `OSV-AN-${SUFFIX}`, VULN],
  );
  userA = await ensureUserAccount(uuidv7(), 'an-a@acme.test');
  userB = await ensureUserAccount(uuidv7(), 'an-b@acme.test');
  orgA = await onboard(userA, 'AnalyticsA', vulnSbom);
  orgB = await onboard(userB, 'AnalyticsB', cleanSbom);
});

afterAll(async () => {
  await seed.end();
  await closeDb();
});

describe('FR-AN-001 — dashboard counts', () => {
  it('org A sees its critical KEV finding and its SBOM coverage', async () => {
    const d = await getDashboard(orgA);
    expect(d.findingsBySeverity.critical).toBe(1);
    expect(d.kevOpenCount).toBe(1);
    expect(d.sbomCoverage.releasesWithSbom).toBe(1);
    expect(d.ingestionHealth.valid).toBeGreaterThanOrEqual(1);
  });

  it('FR-AN-009 — org B never counts org A findings (tenant isolation)', async () => {
    const d = await getDashboard(orgB);
    expect(d.findingsBySeverity.critical).toBe(0);
    expect(d.kevOpenCount).toBe(0);
    // B has its own release + SBOM, but zero findings (clean component).
    expect(d.sbomCoverage.releasesWithSbom).toBe(1);
  });
});
