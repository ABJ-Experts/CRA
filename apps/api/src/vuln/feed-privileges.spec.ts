// BRD §6.1 — the advisory mirror is global reference data: readable by every
// tenant, writable only by feed jobs under an elevated role. RLS cannot enforce
// that (these tables carry no organisation_id), so the whole guarantee rests on
// grants. This asserts both directions, because a grant that silently widened
// would leave every test passing.
import '../env';
import { describe, it, expect, afterAll } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { sql } from 'drizzle-orm';
import {
  advisory,
  advisoryAffected,
  advisoryFeedSyncState,
  finding,
  product,
  withFeedWriter,
  withTenant,
  closeDb,
} from '../db';

const ORG = uuidv7();

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

afterAll(async () => {
  await closeDb();
});

describe('FR-VULN-001 — cras_app cannot write the advisory mirror', () => {
  it('rejects INSERT on advisory', async () => {
    await expectPermissionDenied(() =>
      withTenant({ organisationId: ORG }, (tx) =>
        tx
          .insert(advisory)
          .values({ id: uuidv7(), source: 'osv', advisoryId: 'OSV-FORGED' }),
      ),
    );
  });

  it('rejects UPDATE on advisory — no tenant can flip its own KEV status', async () => {
    await expectPermissionDenied(() =>
      withTenant({ organisationId: ORG }, (tx) =>
        tx.update(advisory).set({ kevListed: false }),
      ),
    );
  });

  it('rejects DELETE on advisory_affected', async () => {
    await expectPermissionDenied(() =>
      withTenant({ organisationId: ORG }, (tx) => tx.delete(advisoryAffected)),
    );
  });

  it('rejects writes to the feed sync state', async () => {
    await expectPermissionDenied(() =>
      withTenant({ organisationId: ORG }, (tx) =>
        tx.update(advisoryFeedSyncState).set({ status: 'success' }),
      ),
    );
  });

  it('still allows SELECT — matching reads the mirror on every ingest', async () => {
    const rows = await withTenant({ organisationId: ORG }, (tx) =>
      tx.select().from(advisory).limit(1),
    );
    expect(Array.isArray(rows)).toBe(true);
  });
});

describe('FR-VULN-002 — cras_feed writes the mirror and nothing else', () => {
  const pk = uuidv7();

  it('can insert and update advisories', async () => {
    await withFeedWriter(async (tx) => {
      await tx.insert(advisory).values({
        id: pk,
        source: 'osv',
        advisoryId: `OSV-PRIV-${pk.slice(0, 8)}`,
      });
      await tx.update(advisory).set({ kevListed: true });
    });
    const rows = await withTenant({ organisationId: ORG }, (tx) =>
      tx
        .select()
        .from(advisory)
        .where(sql`id = ${pk}`),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kevListed).toBe(true);
  });

  it('can record sync state, seeded one row per feed', async () => {
    const rows = await withFeedWriter((tx) =>
      tx.select().from(advisoryFeedSyncState),
    );
    expect(rows.map((r) => r.feed).sort()).toEqual([
      'epss',
      'ghsa',
      'kev',
      'nvd',
      'osv',
    ]);
    // Seeded as never_run rather than absent: an empty table reads as
    // "no feeds configured", which is a different and less alarming fault.
    expect(rows.every((r) => r.status === 'never_run' || r.lastAttemptAt)).toBe(
      true,
    );
  });

  it('cannot read tenant data — a feed job has no business in a customer product', async () => {
    await expectPermissionDenied(() =>
      withFeedWriter((tx) => tx.select().from(product).limit(1)),
    );
    await expectPermissionDenied(() =>
      withFeedWriter((tx) => tx.select().from(finding).limit(1)),
    );
  });

  it('cleans up its own fixture', async () => {
    await withFeedWriter((tx) => tx.delete(advisory).where(sql`id = ${pk}`));
    const rows = await withTenant({ organisationId: ORG }, (tx) =>
      tx
        .select()
        .from(advisory)
        .where(sql`id = ${pk}`),
    );
    expect(rows).toHaveLength(0);
  });
});
