import type {
  Invitation,
  OrganizationSummary,
} from "@repo/contracts/invitations";
import type { BaseRole } from "@repo/contracts/permissions";

export type InvitationActor = Readonly<{ id: string; email: string }>;

export type AcceptInvitationAtomicOutcome =
  | Readonly<{
      outcome: "accepted" | "already_accepted";
      invitationId: string;
      organization: Readonly<OrganizationSummary>;
    }>
  | Readonly<{
      outcome:
        | "not_found"
        | "expired"
        | "email_mismatch"
        | "not_pending"
        | "organization_not_found"
        | "user_not_found";
    }>;

export type RevokeInvitationAtomicOutcome =
  | "revoked"
  | "not_found"
  | "already_accepted"
  | "not_pending"
  | "actor_not_found"
  | "actor_email_mismatch";

export type InsertInvitationInput = Readonly<{
  invitedBy: string;
  email: string;
  role: BaseRole;
  firstName: string | null;
  lastName: string | null;
  tokenHash: string;
  expiresAt: string;
}>;

export interface InvitationRepository {
  findExistingUser(email: string): Promise<Readonly<{ id: string }> | null>;
  isMember(orgId: string, userId: string): Promise<boolean>;
  hasPending(orgId: string, email: string): Promise<boolean>;
  insert(
    orgId: string,
    input: InsertInvitationInput,
  ): Promise<Readonly<{ id: string }>>;
  acceptAtomic(
    tokenHash: string,
    user: InvitationActor,
  ): Promise<AcceptInvitationAtomicOutcome>;
  revokeAtomic(
    orgId: string,
    invitationId: string,
    actor: InvitationActor,
  ): Promise<RevokeInvitationAtomicOutcome>;
  list(orgId: string): Promise<readonly Readonly<Invitation>[]>;
  organization(orgId: string): Promise<Readonly<OrganizationSummary> | null>;
}
