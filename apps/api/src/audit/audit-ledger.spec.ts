// ADR-012 / FR-AUD-001/002/003: append-only ledger + per-org hash chain, against
// a real Postgres. Fresh per-run org ids keep counts deterministic without deletes.
import '../env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { recordAudit, verifyAuditChain } from './audit.service';
import { withTenant, auditEvent, closeDb } from '../db';

const ORG = uuidv7();
const ORG2 = uuidv7();
let seed: Pool;

beforeAll(async () => {
  const migUrl = process.env.MIGRATION_DATABASE_URL;
  if (!migUrl) throw new Error('MIGRATION_DATABASE_URL is required');
  seed = new Pool({ connectionString: migUrl });
  await seed.query(
    `insert into organisation(id, legal_name, country_main_establishment)
     values ($1,'AuditOrg','DE'), ($2,'AuditOrg2','FR') on conflict (id) do nothing`,
    [ORG, ORG2],
  );
});

afterAll(async () => {
  await seed.end();
  await closeDb();
});

describe('FR-AUD-003 — per-org hash chain', () => {
  it('links three events into a verifiable chain with monotonic sequence', async () => {
    const scope = { organisationId: ORG, userId: uuidv7() };
    const a = await recordAudit(scope, {
      actorType: 'user',
      action: 'product.created',
      resourceType: 'product',
    });
    const b = await recordAudit(scope, {
      actorType: 'user',
      action: 'product.updated',
      resourceType: 'product',
    });
    const c = await recordAudit(scope, {
      actorType: 'user',
      action: 'product.archived',
      resourceType: 'product',
    });
    expect([a.sequence, b.sequence, c.sequence]).toEqual([1, 2, 3]);

    const result = await verifyAuditChain(ORG);
    expect(result.ok).toBe(true);
    expect(result.count).toBe(3);
  });

  it('detects tampering (a superuser edit breaks the chain from that row)', async () => {
    // cras_app cannot mutate audit rows, so tamper via the superuser connection.
    await seed.query(
      `update audit_event set action = 'tampered' where organisation_id = $1 and sequence = 2`,
      [ORG],
    );
    const result = await verifyAuditChain(ORG);
    expect(result.ok).toBe(false);
    expect(result.brokenAtSequence).toBe(2);
  });
});

// Drizzle wraps the pg error, so the "permission denied" text lands on .cause.
async function expectPermissionDenied(
  run: () => Promise<unknown>,
): Promise<void> {
  let err: unknown;
  try {
    await run();
  } catch (e) {
    err = e;
  }
  expect(err, 'expected the operation to be rejected').toBeDefined();
  const cause = (err as { cause?: unknown } | undefined)?.cause;
  const errMsg = err instanceof Error ? err.message : JSON.stringify(err);
  const causeMsg = cause instanceof Error ? cause.message : '';
  expect(`${errMsg} ${causeMsg}`).toMatch(/permission denied/i);
}

describe('FR-AUD-002 — append-only', () => {
  it('cras_app cannot UPDATE audit rows', async () => {
    await expectPermissionDenied(() =>
      withTenant({ organisationId: ORG }, (tx) =>
        tx
          .update(auditEvent)
          .set({ action: 'x' })
          .where(eq(auditEvent.organisationId, ORG)),
      ),
    );
  });

  it('cras_app cannot DELETE audit rows', async () => {
    await expectPermissionDenied(() =>
      withTenant({ organisationId: ORG }, (tx) =>
        tx.delete(auditEvent).where(eq(auditEvent.organisationId, ORG)),
      ),
    );
  });
});

describe('audit ledger is tenant-scoped with an independent per-org sequence', () => {
  it('a second org starts its own chain at sequence 1', async () => {
    const first = await recordAudit(
      { organisationId: ORG2, userId: uuidv7() },
      {
        actorType: 'system',
        action: 'org.created',
        resourceType: 'organisation',
      },
    );
    expect(first.sequence).toBe(1);

    // The chain read is tenant-scoped: ORG2 sees only its own rows.
    const rows = await withTenant({ organisationId: ORG2 }, (tx) =>
      tx
        .select()
        .from(auditEvent)
        .where(sql`true`),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('org.created');
  });
});
