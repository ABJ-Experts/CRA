// FR-VULN-011 + FR-RPT-004/005/006 + §11.1: open an obligation from a KEV finding
// and recompute due_at when an anchor is recorded. Real PG.
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
import { listFindings } from '../triage';
import {
  openObligationFromFinding,
  openObligation,
  recordAnchor,
  listStages,
  listObligations,
  tickObligations,
} from './obligation.service';
import { verifyAuditChain } from '../audit';
import { closeDb } from '../db';

const PK = uuidv7();
const SUFFIX = PK.slice(0, 8);
const NAME = `oblpkg-${SUFFIX}`;
const AWARENESS = new Date('2026-04-14T09:20:00Z');
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
    [PK, `OSV-OBL-${SUFFIX}`, NAME],
  );
  userId = await ensureUserAccount(uuidv7(), 'obl@acme.test');
  orgId = (
    await createOrganisation(userId, {
      legalName: 'OblCo',
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
  findingId = (await listFindings(orgId, { kevOnly: true })).items[0]!.id;
});

afterAll(async () => {
  await seed.end();
  await closeDb();
});

describe('FR-VULN-011 — open obligation from a KEV finding', () => {
  let obligationId: string;

  it('creates stages: awareness+24h/+72h running, final_report pending_anchor', async () => {
    obligationId = (
      await openObligationFromFinding(orgId, userId, findingId, AWARENESS)
    ).id;
    const stages = await listStages(orgId, obligationId);
    const early = stages.find((s) => s.stage === 'early_warning');
    const notif = stages.find((s) => s.stage === 'notification');
    const final = stages.find((s) => s.stage === 'final_report');

    expect(early?.state).toBe('running');
    expect(early?.dueAt?.toISOString()).toBe('2026-04-15T09:20:00.000Z'); // +24h
    expect(notif?.dueAt?.toISOString()).toBe('2026-04-17T09:20:00.000Z'); // +72h anchored to awareness
    // FR-RPT-006: final report waits for remediation, no date yet.
    expect(final?.state).toBe('pending_anchor');
    expect(final?.dueAt).toBeNull();
    const [summary] = await listObligations(orgId);
    expect(summary).toMatchObject({
      id: obligationId,
      nextStage: 'early_warning',
      nextDueAt: '2026-04-15T09:20:00.000Z',
      overdue: false,
    });
  });

  it('§11.1 — recording remediation recomputes the final report to remediation+14d', async () => {
    await recordAnchor(
      orgId,
      userId,
      obligationId,
      'remediation_available',
      new Date('2026-04-24T16:00:00Z'),
    );
    const stages = await listStages(orgId, obligationId);
    const final = stages.find((s) => s.stage === 'final_report');
    expect(final?.state).toBe('running');
    expect(final?.dueAt?.toISOString()).toBe('2026-05-08T16:00:00.000Z'); // remediation + 14d, NOT awareness + 14d
  });
});

describe('severe incident — final report is one calendar month after notification', () => {
  it('recomputes on notification_submitted', async () => {
    const ob = await openObligation(orgId, userId, {
      obligationType: 'severe_incident',
      awarenessAt: AWARENESS,
    });
    await recordAnchor(
      orgId,
      userId,
      ob.id,
      'notification_submitted',
      new Date('2026-04-17T08:00:00Z'),
    );
    const stages = await listStages(orgId, ob.id);
    const final = stages.find((s) => s.stage === 'final_report');
    expect(final?.dueAt?.toISOString()).toBe('2026-05-17T08:00:00.000Z'); // +1 calendar month
  });
});

describe('FR-SLA-005/006 — obligation.tick escalates and is idempotent', () => {
  it('marks a passed deadline overdue and returns escalation notifications', async () => {
    const ob = await openObligationFromFinding(
      orgId,
      userId,
      findingId,
      new Date('2026-06-01T00:00:00Z'),
    );
    // Tick past the +24h early-warning deadline (2026-06-02T00:00Z).
    const now = new Date('2026-06-02T06:00:00Z');
    const first = await tickObligations(orgId, now);
    expect(first.notifications.length).toBeGreaterThan(0);
    expect(
      first.notifications.some(
        (n) => n.kind === 'overdue' && n.stage === 'early_warning',
      ),
    ).toBe(true);

    const stages = await listStages(orgId, ob.id);
    expect(stages.find((s) => s.stage === 'early_warning')?.state).toBe(
      'overdue',
    );

    // §11.4: a second tick at the same instant sends nothing new.
    const second = await tickObligations(orgId, now);
    expect(second.notifications).toEqual([]);
  });
});

describe('audit', () => {
  it('obligation events are captured in a verifiable chain', async () => {
    expect((await verifyAuditChain(orgId)).ok).toBe(true);
  });
});
