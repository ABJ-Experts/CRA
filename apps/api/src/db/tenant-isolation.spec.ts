// FR-TEN-001..006 tenant isolation suite + SEC-014, against a REAL Postgres with
// RLS active (BRD §6.4 / §23 — never mock the DB for an authorisation test).
// Runs as the restricted cras_app role via withTenant(); seeds via the superuser
// MIGRATION_DATABASE_URL (bypasses RLS for fixture setup only).
import '../env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { withTenant, withPrincipal, pool, closeDb } from './database';
import { assertRlsBootSafety } from './sec014';
import { product } from './schema';

const ORG_A = '1a1a1a1a-1111-7111-8111-1111111111aa';
const ORG_B = '2b2b2b2b-2222-7222-8222-2222222222bb';
const PROD_A = 'aaaaaaaa-1111-7111-8111-1111111111aa';
const PROD_B = 'bbbbbbbb-2222-7222-8222-2222222222bb';

let seed: Pool;

beforeAll(async () => {
  const migUrl = process.env.MIGRATION_DATABASE_URL;
  if (!migUrl)
    throw new Error(
      'MIGRATION_DATABASE_URL is required to seed isolation fixtures',
    );
  seed = new Pool({ connectionString: migUrl });
  await seed.query(
    `insert into organisation(id, legal_name, country_main_establishment)
     values ($1,'IsoA','DE'), ($2,'IsoB','FR') on conflict (id) do nothing`,
    [ORG_A, ORG_B],
  );
  await seed.query(
    `insert into product(id, organisation_id, name, internal_code)
     values ($1,$2,'A widget','PA'), ($3,$4,'B widget','PB') on conflict (id) do nothing`,
    [PROD_A, ORG_A, PROD_B, ORG_B],
  );
});

afterAll(async () => {
  await seed.end();
  await closeDb();
});

describe('SEC-014 boot assertion', () => {
  it('passes for the restricted cras_app role with RLS forced', async () => {
    await expect(assertRlsBootSafety()).resolves.toBeUndefined();
  });

  it('REFUSES a superuser / bypass-RLS role (the dangerous case it exists to catch)', async () => {
    // `seed` connects as the postgres superuser -> rolsuper true -> must be rejected,
    // otherwise a cross-tenant leak would wait silently until production.
    await expect(assertRlsBootSafety(seed)).rejects.toThrow(/SEC-014 FAILURE/);
  });
});

describe('FR-TEN-002 — RLS enabled AND forced on every organisation_id table', () => {
  it('every tenant-scoped table has relrowsecurity and relforcerowsecurity', async () => {
    const res = await pool.query<{
      relname: string;
      enabled: boolean;
      forced: boolean;
    }>(`
      select c.relname, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='public' and c.relkind='r'
        and exists (select 1 from information_schema.columns col
          where col.table_schema='public' and col.table_name=c.relname
            and col.column_name='organisation_id')
    `);
    expect(res.rows.length).toBeGreaterThan(0);
    const unprotected = res.rows.filter((r) => !r.enabled || !r.forced);
    expect(unprotected.map((r) => r.relname)).toEqual([]);
  });
});

describe('FR-TEN-003 — no rows without tenant context', () => {
  it('a fresh cras_app connection with no context reads zero rows', async () => {
    const res = await pool.query<{ n: string }>(
      'select count(*)::text as n from product',
    );
    expect(Number(res.rows[0]?.n)).toBe(0);
  });

  it('withTenant scoped to a non-existent org reads zero rows', async () => {
    const rows = await withTenant(
      { organisationId: '00000000-0000-7000-8000-000000000000' },
      (tx) => tx.select().from(product),
    );
    expect(rows).toHaveLength(0);
  });
});

describe('FR-TEN-001 — two orgs, identical shape, zero leakage', () => {
  it("org A sees only org A's product", async () => {
    const rows = await withTenant({ organisationId: ORG_A }, (tx) =>
      tx.select().from(product),
    );
    expect(rows.map((r) => r.internalCode).sort()).toEqual(['PA']);
  });

  it("org B sees only org B's product", async () => {
    const rows = await withTenant({ organisationId: ORG_B }, (tx) =>
      tx.select().from(product),
    );
    expect(rows.map((r) => r.internalCode).sort()).toEqual(['PB']);
  });

  it("org A cannot see org B's product by id (404-not-403: the row is simply invisible)", async () => {
    const rows = await withTenant({ organisationId: ORG_A }, (tx) =>
      tx
        .select()
        .from(product)
        .where(sql`${product.id} = ${PROD_B}`),
    );
    expect(rows).toHaveLength(0);
  });
});

describe('FR-TEN-006 — pooled connection reuse cannot leak context', () => {
  it('interleaved A/B transactions each see only their own rows', async () => {
    const results = await Promise.all([
      withTenant({ organisationId: ORG_A }, (tx) => tx.select().from(product)),
      withTenant({ organisationId: ORG_B }, (tx) => tx.select().from(product)),
      withTenant({ organisationId: ORG_A }, (tx) => tx.select().from(product)),
    ]);
    expect(results[0].map((r) => r.internalCode)).toEqual(['PA']);
    expect(results[1].map((r) => r.internalCode)).toEqual(['PB']);
    expect(results[2].map((r) => r.internalCode)).toEqual(['PA']);
  });
});

describe("FR-TEN — withPrincipal resolves a user's memberships without an org context", () => {
  it('membership lookup path does not throw', async () => {
    // Smoke: withPrincipal sets app.user_id only; org_member self-rows are visible.
    const rows = await withPrincipal(
      '00000000-0000-7000-8000-0000000000ff',
      (tx) => tx.execute(sql`select count(*)::int as n from org_member`),
    );
    expect(rows).toBeDefined();
  });
});
