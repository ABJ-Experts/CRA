// The ONE file allowed to open a DB transaction (ADR-005 / §26.3). A lint rule
// bans `db.transaction()` everywhere else; all tenant-scoped access goes through
// withTenant()/withPrincipal(), which set the tx-local RLS context first.
import '../env';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { schema } from './schema';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. It must be the restricted cras_app connection (ADR-005 / SEC-014).',
  );
}

export const pool = new Pool({
  connectionString,
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
});

export const db: NodePgDatabase<typeof schema> = drizzle(pool, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface TenantScope {
  organisationId: string;
  userId?: string;
}

/**
 * The sanctioned entry point for tenant-scoped DB access. Opens a transaction,
 * sets `app.organisation_id` (and `app.user_id`) as the FIRST statements with
 * `is_local = true` so a pooled connection cannot leak context to the next
 * borrower (BRD §6.3), then runs `fn` under that RLS context.
 */
export async function withTenant<T>(
  scope: TenantScope,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.organisation_id', ${scope.organisationId}, true)`,
    );
    if (scope.userId) {
      await tx.execute(
        sql`select set_config('app.user_id', ${scope.userId}, true)`,
      );
    }
    return fn(tx);
  });
}

/**
 * Identity-scoped access with NO organisation yet — used to resolve a user's
 * memberships at login (the org_member RLS policy admits a user's own rows via
 * `app.user_id`, so the org switcher can list orgs before one is active).
 */
export async function withPrincipal<T>(
  userId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}

/**
 * Identity-lookup access keyed on the external (Supabase) subject — used once at
 * the start of a request to resolve user_account.id from the JWT `sub` before an
 * organisation context exists (the user_account RLS policy admits self rows via
 * app.supabase_user_id).
 */
export async function withUserLookup<T>(
  supabaseUserId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.supabase_user_id', ${supabaseUserId}, true)`,
    );
    return fn(tx);
  });
}

/**
 * BRD §6.1: global reference data (the advisory mirror) is "written only by feed
 * jobs running under an elevated role". cras_app holds SELECT and nothing more,
 * so feed writes need their own connection as cras_feed — a role with DML on the
 * three mirror tables and no access whatsoever to tenant data.
 *
 * Lazily constructed: an API process that never runs a feed job should not hold
 * a second pool open, and a deployment that has not configured FEED_DATABASE_URL
 * should fail when a sync is attempted rather than at boot.
 */
let feedPool: Pool | null = null;

export function feedDb(): NodePgDatabase<typeof schema> {
  if (!feedPool) {
    const feedConnectionString = process.env.FEED_DATABASE_URL;
    if (!feedConnectionString)
      throw new Error(
        'FEED_DATABASE_URL is not set. Advisory feed ingestion needs the elevated ' +
          'cras_feed connection (BRD §6.1); cras_app holds SELECT on the mirror only.',
      );
    feedPool = new Pool({
      connectionString: feedConnectionString,
      max: Number(process.env.FEED_DATABASE_POOL_MAX ?? 4),
    });
  }
  return drizzle(feedPool, { schema });
}

/**
 * Feed writes carry no tenant context by design — the mirror is global. There is
 * deliberately no set_config here: if a caller reaches for this wrapper to touch a
 * tenant table, the missing grant fails the statement rather than widening a query.
 */
export async function withFeedWriter<T>(
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return feedDb().transaction(fn);
}

/**
 * FR-SLA-007 / FR-JOB-001: enumerate tenants so a global schedule can fan out to
 * them. Uses the cras_scheduler role, which can read organisation identifiers and
 * literally nothing else — see the step9b migration for why this exists as its
 * own role rather than as a widened policy on cras_app.
 */
let schedulerPool: Pool | null = null;

export async function listOrganisationIds(): Promise<string[]> {
  const connectionString = process.env.SCHEDULER_DATABASE_URL;
  if (!connectionString)
    throw new Error(
      'SCHEDULER_DATABASE_URL is not set. Scheduled jobs fan out per organisation ' +
        'and need the cras_scheduler connection; cras_app cannot enumerate tenants.',
    );
  schedulerPool ??= new Pool({ connectionString, max: 2 });
  const result = await schedulerPool.query<{ id: string }>(
    'select id from organisation where deleted_at is null order by id',
  );
  return result.rows.map((r) => r.id);
}

export async function closeDb(): Promise<void> {
  await pool.end();
  if (feedPool) {
    await feedPool.end();
    feedPool = null;
  }
  if (schedulerPool) {
    await schedulerPool.end();
    schedulerPool = null;
  }
}
