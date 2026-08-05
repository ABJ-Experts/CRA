// FR-TEN-002 — "A generated test enumerates all tables carrying organisation_id
// and asserts RLS is both enabled and forced. A new table without a policy fails
// the build."
//
// Generated, not hand-listed, and that distinction is the whole requirement. A
// fixed list of table names is a list somebody forgets to update: the next
// tenant-scoped table ships with no policy, every existing test still passes,
// and §6.2 calls that failure mode "the most dangerous mistake available in this
// codebase" — because nothing breaks, it just quietly leaks.
//
// This asks the catalogue what tenant-scoped tables exist right now, so a new
// one is covered the moment it is created.
import '../env';
import { describe, it, expect, afterAll } from 'vitest';
import { Pool } from 'pg';
import { closeDb } from './database';

const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });

afterAll(async () => {
  await pool.end();
  await closeDb();
});

interface TableRls {
  table: string;
  rlsEnabled: boolean;
  rlsForced: boolean;
  policies: number;
}

/** Every ordinary public table carrying an organisation_id column. */
async function tenantScopedTables(): Promise<TableRls[]> {
  const { rows } = await pool.query<TableRls>(
    `select c.relname                as "table",
            c.relrowsecurity         as "rlsEnabled",
            c.relforcerowsecurity    as "rlsForced",
            (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
        and exists (
              select 1 from pg_attribute a
               where a.attrelid = c.oid
                 and a.attname  = 'organisation_id'
                 and a.attnum   > 0
                 and not a.attisdropped
            )
      order by c.relname`,
  );
  return rows;
}

describe('FR-TEN-002 — RLS coverage is enforced, not assumed', () => {
  it('finds the tenant-scoped tables to check', async () => {
    // Guards the guard: if the discovery query broke, every assertion below
    // would pass vacuously over an empty list.
    const tables = await tenantScopedTables();
    expect(tables.length).toBeGreaterThanOrEqual(10);
    expect(tables.map((t) => t.table)).toContain('finding');
  });

  it('has ROW LEVEL SECURITY enabled on every tenant-scoped table', async () => {
    const missing = (await tenantScopedTables())
      .filter((t) => !t.rlsEnabled)
      .map((t) => t.table);
    expect(
      missing,
      `these tables carry organisation_id but do not have RLS enabled:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('has RLS FORCED on every tenant-scoped table', async () => {
    // ENABLE alone exempts the table owner. The application role is not the
    // owner today, but a future migration run as owner would silently bypass
    // every policy, so FORCE is the setting that actually holds.
    const missing = (await tenantScopedTables())
      .filter((t) => !t.rlsForced)
      .map((t) => t.table);
    expect(
      missing,
      `these tables have RLS enabled but not FORCED:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('has at least one policy on every tenant-scoped table', async () => {
    // RLS with no policy denies everything, which fails loudly rather than
    // leaking — but it means the table is unusable, so it is still a defect.
    const missing = (await tenantScopedTables())
      .filter((t) => t.policies === 0)
      .map((t) => t.table);
    expect(
      missing,
      `these tables have RLS but no policy at all:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });
});
