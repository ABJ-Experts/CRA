// RBAC core (ADR-004: roles/permissions live in app tables, never derived from
// JWT claims alone). A principal's permissions are resolved from their org
// membership's role key against the shared @repo/schemas catalog (BRD §7.2).
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { permissionsForRole, type Permission } from '@repo/schemas';
import {
  orgMember,
  role,
  userAccount,
  withTenant,
  withUserLookup,
} from '../db';

export interface Principal {
  userAccountId: string;
  organisationId: string;
  roleKey: string;
  permissions: readonly Permission[];
  /** Whether the current session has satisfied MFA (FR-AUTH-002 gate). */
  mfaSatisfied: boolean;
  actorType: 'user' | 'service_account';
}

/** Pure authorisation check: does the principal hold every required permission? */
export function hasRequiredPermissions(
  granted: readonly Permission[],
  required: readonly Permission[],
): boolean {
  return required.every((p) => granted.includes(p));
}

/**
 * Resolve the active-org principal for a known user_account. Reads the member's
 * role under tenant RLS (org_member is visible via app.user_id self OR
 * app.organisation_id). Returns null if the user is not a member of the org —
 * which upstream turns into a 404, never a 403 (cross-tenant must not confirm).
 */
export async function resolvePrincipalForMember(
  organisationId: string,
  userAccountId: string,
  mfaSatisfied: boolean,
): Promise<Principal | null> {
  return withTenant({ organisationId, userId: userAccountId }, async (tx) => {
    const [row] = await tx
      .select({ roleKey: role.key })
      .from(orgMember)
      .innerJoin(role, eq(orgMember.roleId, role.id))
      .where(
        and(
          eq(orgMember.organisationId, organisationId),
          eq(orgMember.userAccountId, userAccountId),
        ),
      )
      .limit(1);
    if (!row) return null;
    return {
      userAccountId,
      organisationId,
      roleKey: row.roleKey,
      permissions: permissionsForRole(row.roleKey),
      mfaSatisfied,
      actorType: 'user',
    };
  });
}

/**
 * Provision (or fetch) the user_account for an authenticated Supabase subject
 * (FR-AUTH first-login). Runs under the user's own identity context so the
 * user_account self-INSERT policy admits the row.
 */
export async function ensureUserAccount(
  supabaseUserId: string,
  email: string,
  displayName?: string,
): Promise<string> {
  return withUserLookup(supabaseUserId, async (tx) => {
    const [existing] = await tx
      .select({ id: userAccount.id })
      .from(userAccount)
      .where(eq(userAccount.supabaseUserId, supabaseUserId))
      .limit(1);
    if (existing) return existing.id;
    const id = uuidv7();
    await tx.insert(userAccount).values({
      id,
      supabaseUserId,
      email,
      displayName: displayName ?? null,
      createdBy: id,
      updatedBy: id,
    });
    return id;
  });
}

/** Resolve user_account.id from the external (Supabase) subject; null if unknown or deactivated. */
export async function resolveUserAccountId(
  supabaseUserId: string,
): Promise<string | null> {
  return withUserLookup(supabaseUserId, async (tx) => {
    const [u] = await tx
      .select({ id: userAccount.id, status: userAccount.status })
      .from(userAccount)
      .where(eq(userAccount.supabaseUserId, supabaseUserId))
      .limit(1);
    return u && u.status === 'active' ? u.id : null;
  });
}

/** Full auth resolution: JWT subject -> user_account -> active-org principal. */
export async function resolvePrincipal(
  supabaseUserId: string,
  organisationId: string,
  mfaSatisfied: boolean,
): Promise<Principal | null> {
  const userAccountId = await resolveUserAccountId(supabaseUserId);
  if (!userAccountId) return null;
  return resolvePrincipalForMember(organisationId, userAccountId, mfaSatisfied);
}
