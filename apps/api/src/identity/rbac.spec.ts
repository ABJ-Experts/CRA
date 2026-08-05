// FR-IAM RBAC resolution + ADR-004 IdentityProvider conformance, against real PG.
import '../env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { sign } from 'jsonwebtoken';
import { uuidv7 } from 'uuidv7';
import { PERMISSIONS } from '@repo/schemas';
import {
  resolvePrincipalForMember,
  hasRequiredPermissions,
} from './auth.service';
import { SupabaseIdentityAdapter } from './identity-provider';
import { closeDb } from '../db';

const ORG = uuidv7();
const OTHER_ORG = uuidv7();
const PSM_USER = uuidv7();
const EXEC_USER = uuidv7();
const PSM_SUPA = uuidv7();
const EXEC_SUPA = uuidv7();
const ROLE_PSM = '01000000-0000-7000-8000-000000000003';
const ROLE_EXEC = '01000000-0000-7000-8000-000000000007';
let seed: Pool;

beforeAll(async () => {
  seed = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await seed.query(
    `insert into organisation(id,legal_name,country_main_establishment)
     values ($1,'RbacOrg','DE'),($2,'RbacOther','FR') on conflict (id) do nothing`,
    [ORG, OTHER_ORG],
  );
  await seed.query(
    `insert into user_account(id,supabase_user_id,email)
     values ($1,$2,'psm@x.io'),($3,$4,'exec@x.io') on conflict (id) do nothing`,
    [PSM_USER, PSM_SUPA, EXEC_USER, EXEC_SUPA],
  );
  await seed.query(
    `insert into org_member(id,organisation_id,user_account_id,role_id)
     values ($1,$2,$3,$4),($5,$6,$7,$8) on conflict do nothing`,
    [uuidv7(), ORG, PSM_USER, ROLE_PSM, uuidv7(), ORG, EXEC_USER, ROLE_EXEC],
  );
});

afterAll(async () => {
  await seed.end();
  await closeDb();
});

describe('FR-IAM — RBAC resolved from role templates', () => {
  it('a PSM member gets triage + approval permissions', async () => {
    const p = await resolvePrincipalForMember(ORG, PSM_USER, true);
    expect(p?.roleKey).toBe('psm');
    expect(p?.permissions).toContain(PERMISSIONS.FINDING_TRIAGE);
    expect(p?.permissions).toContain(PERMISSIONS.VEX_APPROVE);
  });

  it('an exec member cannot triage but can read analytics', async () => {
    const p = await resolvePrincipalForMember(ORG, EXEC_USER, false);
    expect(p?.permissions).not.toContain(PERMISSIONS.FINDING_TRIAGE);
    expect(p?.permissions).toContain(PERMISSIONS.ANALYTICS_READ);
  });

  it('a non-member resolves to null (=> 404, never 403)', async () => {
    expect(await resolvePrincipalForMember(ORG, uuidv7(), false)).toBeNull();
  });

  it('a member of another org resolves to null for this org (cross-tenant)', async () => {
    expect(
      await resolvePrincipalForMember(OTHER_ORG, PSM_USER, false),
    ).toBeNull();
  });
});

describe('hasRequiredPermissions', () => {
  it('allows when every required permission is granted', () => {
    expect(
      hasRequiredPermissions(
        [PERMISSIONS.FINDING_READ, PERMISSIONS.FINDING_TRIAGE],
        [PERMISSIONS.FINDING_TRIAGE],
      ),
    ).toBe(true);
  });

  it('denies when any required permission is missing', () => {
    expect(
      hasRequiredPermissions(
        [PERMISSIONS.FINDING_READ],
        [PERMISSIONS.FINDING_TRIAGE],
      ),
    ).toBe(false);
  });
});

describe('ADR-004 — IdentityProvider conformance (Supabase adapter)', () => {
  const secret = process.env.SUPABASE_JWT_SECRET ?? '';
  const adapter = new SupabaseIdentityAdapter(secret);

  it('verifies a valid Supabase-signed token and reads aal2 as MFA-satisfied', async () => {
    const token = sign(
      { sub: PSM_SUPA, email: 'psm@x.io', aal: 'aal2', role: 'authenticated' },
      secret,
      { algorithm: 'HS256', expiresIn: '1h' },
    );
    const id = await adapter.authenticate(`Bearer ${token}`);
    expect(id?.supabaseUserId).toBe(PSM_SUPA);
    expect(id?.mfaSatisfied).toBe(true);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const token = sign({ sub: PSM_SUPA }, 'wrong-secret', {
      algorithm: 'HS256',
    });
    expect(await adapter.authenticate(`Bearer ${token}`)).toBeNull();
  });
});
