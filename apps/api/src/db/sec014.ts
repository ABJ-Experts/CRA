// SEC-014 boot assertion (BRD §19.1 / §6.2 / ADR-005). "The most dangerous
// mistake available in this codebase" is connecting with a role that can bypass
// RLS: nothing breaks, every test passes, and a cross-tenant leak waits for
// production. We defend mechanically — refuse to start if the app's DB role is
// unsafe, RLS is not forced, or a tenant table is readable with no context.
import type { Pool } from 'pg';
import { pool } from './database';

// `p` defaults to the app pool (cras_app); injectable so the guard itself can be
// tested against a deliberately-unsafe (superuser) connection.
export async function assertRlsBootSafety(p: Pool = pool): Promise<void> {
  const client = await p.connect();
  try {
    // 1. The app role must NOT be superuser and must NOT hold BYPASSRLS.
    const role = (
      await client.query<{
        rolname: string;
        rolsuper: boolean;
        rolbypassrls: boolean;
      }>(
        `select rolname, rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
      )
    ).rows[0];
    if (!role) throw new Error('SEC-014: could not read current DB role.');
    if (role.rolsuper || role.rolbypassrls) {
      throw new Error(
        `SEC-014 FAILURE: app DB role "${role.rolname}" has superuser=${role.rolsuper} ` +
          `bypassrls=${role.rolbypassrls}. RLS isolation would be silently off. ` +
          `Refusing to start — use the restricted cras_app role.`,
      );
    }

    // 2. Every tenant-scoped table (has an organisation_id column) must have RLS
    //    ENABLED and FORCED (this is also the structural half of FR-TEN-002).
    const rls = (
      await client.query<{
        relname: string;
        enabled: boolean;
        forced: boolean;
      }>(`
        select c.relname,
               c.relrowsecurity      as enabled,
               c.relforcerowsecurity as forced
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and exists (
            select 1 from information_schema.columns col
            where col.table_schema = 'public'
              and col.table_name   = c.relname
              and col.column_name  = 'organisation_id'
          )
      `)
    ).rows;
    if (rls.length === 0) {
      throw new Error(
        'SEC-014: found no tenant-scoped tables. Has the schema migration been applied?',
      );
    }
    const unprotected = rls.filter((r) => !r.enabled || !r.forced);
    if (unprotected.length > 0) {
      throw new Error(
        `SEC-014 FAILURE: RLS not ENABLED+FORCED on tenant tables: ` +
          unprotected.map((r) => r.relname).join(', '),
      );
    }

    // 3. Runtime check: with no tenant context (fresh connection), a tenant table
    //    must return zero rows.
    const leaked = Number(
      (
        await client.query<{ n: string }>(
          `select count(*)::text as n from product`,
        )
      ).rows[0]?.n ?? '0',
    );
    if (leaked !== 0) {
      throw new Error(
        `SEC-014 FAILURE: read ${leaked} rows from a tenant table with no tenant context. ` +
          `RLS is not enforcing. Refusing to start.`,
      );
    }
  } finally {
    client.release();
  }
}
