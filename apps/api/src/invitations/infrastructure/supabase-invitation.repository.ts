import { Injectable } from "@nestjs/common";
import {
  invitationSchema,
  organizationSummarySchema,
  type Invitation,
  type OrganizationSummary,
} from "@repo/contracts/invitations";

import { SupabaseService } from "../../supabase/supabase.service";
import type {
  AcceptInvitationAtomicOutcome,
  InsertInvitationInput,
  InvitationActor,
  InvitationRepository,
  RevokeInvitationAtomicOutcome,
} from "../application/invitation-repository.port";

const ACCEPTANCE_FAILURES = new Set([
  "not_found",
  "expired",
  "email_mismatch",
  "not_pending",
  "organization_not_found",
  "user_not_found",
] as const);

const REVOCATION_OUTCOMES = new Set([
  "revoked",
  "not_found",
  "already_accepted",
  "not_pending",
  "actor_not_found",
  "actor_email_mismatch",
] as const);

function providerFailure(): Error {
  return new Error("Invitation repository operation failed");
}

function malformedData(): Error {
  return new Error("Invitation repository returned malformed data");
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function requiredString(
  value: Readonly<Record<string, unknown>>,
  key: string,
): string {
  const candidate = value[key];
  if (typeof candidate !== "string" || candidate.length === 0) {
    throw malformedData();
  }
  return candidate;
}

@Injectable()
export class SupabaseInvitationRepository implements InvitationRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async findExistingUser(
    email: string,
  ): Promise<Readonly<{ id: string }> | null> {
    const { data, error } = await this.supabase
      .admin()
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (error) throw providerFailure();
    if (!data) return null;
    const row = record(data);
    if (!row) throw malformedData();
    return Object.freeze({ id: requiredString(row, "id") });
  }

  async isMember(orgId: string, userId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .admin()
      .from("organization_members")
      .select("id")
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw providerFailure();
    if (!data) return false;
    const row = record(data);
    if (!row) throw malformedData();
    requiredString(row, "id");
    return true;
  }

  async hasPending(orgId: string, email: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .admin()
      .from("invitations")
      .select("id")
      .eq("organization_id", orgId)
      .eq("email", email)
      .eq("status", "pending")
      .maybeSingle();

    if (error) throw providerFailure();
    if (!data) return false;
    const row = record(data);
    if (!row) throw malformedData();
    requiredString(row, "id");
    return true;
  }

  async insert(
    orgId: string,
    input: InsertInvitationInput,
  ): Promise<Readonly<{ id: string }>> {
    const { data, error } = await this.supabase
      .admin()
      .from("invitations")
      .insert({
        organization_id: orgId,
        invited_by: input.invitedBy,
        email: input.email,
        role: input.role,
        first_name: input.firstName,
        last_name: input.lastName,
        token_hash: input.tokenHash,
        expires_at: input.expiresAt,
      })
      .select("id")
      .single();

    if (error) throw providerFailure();
    const row = record(data);
    if (!row) throw malformedData();
    return Object.freeze({ id: requiredString(row, "id") });
  }

  async acceptAtomic(
    tokenHash: string,
    user: InvitationActor,
  ): Promise<AcceptInvitationAtomicOutcome> {
    const { data, error } = await this.supabase
      .admin()
      .rpc("accept_invitation_atomic", {
        p_token_hash: tokenHash,
        p_user_id: user.id,
        p_email: user.email,
      });

    if (error) throw providerFailure();
    if (!Array.isArray(data) || data.length !== 1) throw malformedData();
    const row = record(data[0]);
    if (!row) throw malformedData();
    const outcome = requiredString(row, "outcome");

    if (ACCEPTANCE_FAILURES.has(outcome as never)) {
      return Object.freeze({
        outcome: outcome as Extract<
          AcceptInvitationAtomicOutcome,
          { outcome: string }
        >["outcome"],
      }) as AcceptInvitationAtomicOutcome;
    }
    if (outcome !== "accepted" && outcome !== "already_accepted") {
      throw malformedData();
    }

    const organization = organizationSummarySchema.safeParse({
      id: row.organization_id,
      name: row.organization_name,
      slug: row.organization_slug,
    });
    if (!organization.success) throw malformedData();

    return Object.freeze({
      outcome,
      invitationId: requiredString(row, "invitation_id"),
      organization: Object.freeze(organization.data),
    });
  }

  async revokeAtomic(
    orgId: string,
    invitationId: string,
    actor: InvitationActor,
  ): Promise<RevokeInvitationAtomicOutcome> {
    const { data, error } = await this.supabase
      .admin()
      .rpc("revoke_invitation_atomic", {
        p_organization_id: orgId,
        p_invitation_id: invitationId,
        p_actor_user_id: actor.id,
        p_actor_email: actor.email,
      });

    if (error) throw providerFailure();
    if (typeof data !== "string" || !REVOCATION_OUTCOMES.has(data as never)) {
      throw malformedData();
    }
    return data as RevokeInvitationAtomicOutcome;
  }

  async list(orgId: string): Promise<readonly Readonly<Invitation>[]> {
    const expiration = await this.supabase
      .admin()
      .rpc("expire_stale_invitations");
    if (expiration.error) throw providerFailure();

    const { data, error } = await this.supabase
      .admin()
      .from("invitations")
      .select("id, email, role, status, expires_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });

    if (error) throw providerFailure();
    if (!data) return Object.freeze([]);
    if (!Array.isArray(data)) throw malformedData();

    return Object.freeze(
      data.map((row) => {
        const parsed = invitationSchema.safeParse({
          id: row.id,
          email: row.email,
          role: row.role,
          status: row.status,
          expiresAt: row.expires_at,
        });
        if (!parsed.success) throw malformedData();
        return Object.freeze(parsed.data);
      }),
    );
  }

  async organization(
    orgId: string,
  ): Promise<Readonly<OrganizationSummary> | null> {
    const { data, error } = await this.supabase
      .admin()
      .from("organizations")
      .select("id, name, slug")
      .eq("id", orgId)
      .maybeSingle();

    if (error) throw providerFailure();
    if (!data) return null;
    const parsed = organizationSummarySchema.safeParse(data);
    if (!parsed.success) throw malformedData();
    return Object.freeze(parsed.data);
  }
}
