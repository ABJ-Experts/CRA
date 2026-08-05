import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import {
  organisation,
  orgMember,
  role,
  userAccount,
  withTenant,
  withUserLookup,
} from '../db';
import { recordAuditInTx } from '../audit';

const OWNER_ROLE_ID = '01000000-0000-7000-8000-000000000001';

// FR-ORG-001: the country of main establishment decides the coordinating CSIRT.
// Minimal MVP routing; the full table becomes versioned config in V1.
const CSIRT_BY_COUNTRY: Record<string, string> = {
  DE: 'CERT-Bund (DE)',
  FR: 'CERT-FR',
  NL: 'NCSC-NL',
  BE: 'CCB (BE)',
  IE: 'NCSC-IE',
};

export function coordinatingCsirtForCountry(country: string): string | null {
  return CSIRT_BY_COUNTRY[country.toUpperCase()] ?? null;
}

export interface CreateOrganisationInput {
  legalName: string;
  countryMainEstablishment: string;
  registeredAddress?: string;
}

/**
 * FR-ORG-001/002 onboarding. Creates the org and the caller's owner membership.
 * The tenant context is set to the NEW org id so the forced-RLS with-check admits
 * the bootstrap inserts (the caller is not yet a member of any org).
 */
export async function createOrganisation(
  userAccountId: string,
  input: CreateOrganisationInput,
): Promise<{ id: string }> {
  const orgId = uuidv7();
  return withTenant(
    { organisationId: orgId, userId: userAccountId },
    async (tx) => {
      await tx.insert(organisation).values({
        id: orgId,
        legalName: input.legalName,
        countryMainEstablishment: input.countryMainEstablishment,
        coordinatingCsirt: coordinatingCsirtForCountry(
          input.countryMainEstablishment,
        ),
        registeredAddress: input.registeredAddress ?? null,
        onboardingState: { step: 'organisation_created' },
        createdBy: userAccountId,
        updatedBy: userAccountId,
      });
      await tx.insert(orgMember).values({
        id: uuidv7(),
        organisationId: orgId,
        userAccountId,
        roleId: OWNER_ROLE_ID,
        createdBy: userAccountId,
        updatedBy: userAccountId,
      });
      await recordAuditInTx(tx, orgId, {
        actorType: 'user',
        actorId: userAccountId,
        action: 'organisation.created',
        resourceType: 'organisation',
        resourceId: orgId,
        afterState: {
          legalName: input.legalName,
          countryMainEstablishment: input.countryMainEstablishment,
        },
      });
      return { id: orgId };
    },
  );
}

export interface OrganisationView {
  id: string;
  legalName: string;
  countryMainEstablishment: string;
  coordinatingCsirt: string | null;
  onboardingState: unknown;
}

export async function getOrganisation(
  organisationId: string,
): Promise<OrganisationView | null> {
  return withTenant({ organisationId }, async (tx) => {
    const [row] = await tx
      .select({
        id: organisation.id,
        legalName: organisation.legalName,
        countryMainEstablishment: organisation.countryMainEstablishment,
        coordinatingCsirt: organisation.coordinatingCsirt,
        onboardingState: organisation.onboardingState,
      })
      .from(organisation)
      .where(eq(organisation.id, organisationId))
      .limit(1);
    return row ?? null;
  });
}

export interface MembershipView {
  organisationId: string;
  legalName: string;
  roleKey: string;
  roleName: string;
}

/**
 * The organisations this user belongs to.
 *
 * Deliberately runs without a tenant context: the caller has no active
 * organisation yet — this is the query that lets them pick one.
 *
 * It needs BOTH session settings, which is the subtle part. `app.supabase_user_id`
 * is what makes `user_account` self-readable, but the policies on `org_member`
 * and `organisation` key off `app.user_id` — the user_account.id, not the
 * Supabase subject. Setting only the first returns an empty list rather than an
 * error, which is exactly the kind of silent-empty that looks like "no
 * memberships" instead of "wrong session variable".
 *
 * Both policies still scope to this user's own rows, so this can never become a
 * directory of anyone else's memberships.
 */
export async function listMemberships(
  supabaseUserId: string,
): Promise<MembershipView[]> {
  return withUserLookup(supabaseUserId, async (tx) => {
    const [self] = await tx
      .select({ id: userAccount.id })
      .from(userAccount)
      .where(eq(userAccount.supabaseUserId, supabaseUserId))
      .limit(1);
    if (!self) return [];

    await tx.execute(sql`select set_config('app.user_id', ${self.id}, true)`);

    return tx
      .select({
        organisationId: organisation.id,
        legalName: organisation.legalName,
        roleKey: role.key,
        roleName: role.displayName,
      })
      .from(orgMember)
      .innerJoin(organisation, eq(organisation.id, orgMember.organisationId))
      .innerJoin(role, eq(role.id, orgMember.roleId))
      .where(eq(orgMember.userAccountId, self.id));
  });
}

/** FR-ORG-002: persist wizard progress so an abandoned onboarding can resume. */
export async function updateOnboardingState(
  organisationId: string,
  userAccountId: string,
  state: Record<string, unknown>,
): Promise<void> {
  await withTenant({ organisationId, userId: userAccountId }, async (tx) => {
    await tx
      .update(organisation)
      .set({
        onboardingState: state,
        updatedBy: userAccountId,
        updatedAt: new Date(),
      })
      .where(eq(organisation.id, organisationId));
  });
}
