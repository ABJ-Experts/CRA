// FR-TRI-001..005 + §8.4 finding State machine, end to end against real PG.
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
import {
  listFindings,
  transitionFindingState,
  recordVexAssessment,
} from './triage.service';
import { verifyAuditChain } from '../audit';
import { closeDb } from '../db';

const PK = uuidv7();
const SUFFIX = PK.slice(0, 8);
const NAME = `triagepkg-${SUFFIX}`;
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
       values ($1,'osv',$2,9.8,true)
       on conflict (source, advisory_id) do update set kev_listed = excluded.kev_listed
       returning id
     )
     insert into advisory_affected(advisory_pk, ecosystem, package_name, introduced, fixed)
     select id, 'semver', $3, '0', '2.0.0' from adv`,
    [PK, `OSV-TRIAGE-${SUFFIX}`, NAME],
  );
  userId = await ensureUserAccount(uuidv7(), 'triage@acme.test');
  orgId = (
    await createOrganisation(userId, {
      legalName: 'TriageCo',
      countryMainEstablishment: 'DE',
    })
  ).id;
  const product = await createProduct(orgId, userId, {
    name: 'P',
    internalCode: 'P',
  });
  const releaseId = (await createRelease(orgId, userId, product.id, '1.0.0'))
    .id;
  await ingestSbom(orgId, userId, releaseId, SBOM, storage);
  await matchRelease(orgId, userId, releaseId);
  const findings = (await listFindings(orgId, { kevOnly: true })).items;
  findingId = findings[0]!.id;
});

afterAll(async () => {
  await seed.end();
  await closeDb();
});

describe('FR-TRI-001 — queue lists findings (server-side filter)', () => {
  it('finds the KEV-listed finding', async () => {
    const rows = (await listFindings(orgId, { kevOnly: true, minCvss: 7 }))
      .items;
    expect(rows.map((r) => r.id)).toContain(findingId);
  });
});

describe('§8.4 — finding state machine + FR-TRI-004/005 VEX', () => {
  it('open -> in_triage', async () => {
    const f = await transitionFindingState(
      orgId,
      userId,
      findingId,
      'in_triage',
    );
    expect(f.state).toBe('in_triage');
  });

  it('rejects an illegal transition (in_triage -> closed)', async () => {
    await expect(
      transitionFindingState(orgId, userId, findingId, 'closed'),
    ).rejects.toMatchObject({ code: 'invalid_transition' });
  });

  it('FR-TRI-005 — not_affected requires a permitted justification', async () => {
    await expect(
      recordVexAssessment(orgId, userId, findingId, { status: 'not_affected' }),
    ).rejects.toMatchObject({ code: 'validation' });
  });

  it('records a VEX not_affected assessment with a permitted justification', async () => {
    const f = await recordVexAssessment(orgId, userId, findingId, {
      status: 'not_affected',
      justification: 'vulnerable_code_not_present',
    });
    expect(f.vexStatus).toBe('not_affected');
    expect(f.vexJustification).toBe('vulnerable_code_not_present');
  });

  it('in_triage -> awaiting_approval -> closed', async () => {
    await transitionFindingState(orgId, userId, findingId, 'awaiting_approval');
    const f = await transitionFindingState(orgId, userId, findingId, 'closed');
    expect(f.state).toBe('closed');
  });

  it('closed -> reopened, then reopened -> suppressed needs reason + expiry', async () => {
    await transitionFindingState(orgId, userId, findingId, 'reopened');
    await expect(
      transitionFindingState(orgId, userId, findingId, 'suppressed'),
    ).rejects.toMatchObject({ code: 'validation' });
    const f = await transitionFindingState(
      orgId,
      userId,
      findingId,
      'suppressed',
      {
        reason: 'false positive in this build',
        suppressionExpiresAt: new Date(Date.now() + 30 * 86_400_000),
      },
    );
    expect(f.state).toBe('suppressed');
  });

  it('every triage action is captured in a verifiable audit chain', async () => {
    const result = await verifyAuditChain(orgId);
    expect(result.ok).toBe(true);
  });
});
