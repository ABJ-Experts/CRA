import type { PageParams, Paged } from "@repo/contracts/pagination";
import type { BaseRole } from "@repo/contracts/permissions";
import type { Member } from "@repo/contracts/users";

export const MEMBER_REPOSITORY = Symbol("MEMBER_REPOSITORY");

export type ProfilePatch = Readonly<{
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  language?: string;
}>;

export type AuditMutationContext = Readonly<{
  eventKey: string;
  correlationId: string;
  sourceIp: string | null;
}>;

export interface MemberRepository {
  list(orgId: string, params: PageParams): Promise<Paged<Member>>;
  findMembership(
    orgId: string,
    userId: string,
  ): Promise<{ role: BaseRole } | null>;
  changeRole(
    orgId: string,
    userId: string,
    role: BaseRole,
    actorId?: string,
    context?: AuditMutationContext,
    expectedRole?: BaseRole,
  ): Promise<void>;
  remove(
    orgId: string,
    userId: string,
    actorId?: string,
    context?: AuditMutationContext,
  ): Promise<void>;
  setActive(
    orgId: string,
    userId: string,
    isActive: boolean,
    actorId?: string,
    context?: AuditMutationContext,
  ): Promise<void>;
  updateOwnProfile(
    orgId: string | null,
    userId: string,
    patch: ProfilePatch,
    context?: AuditMutationContext,
  ): Promise<void>;
}

export type MemberRepositoryErrorCode =
  "last_owner" | "member_not_found" | "conflict" | "unavailable";

/** Stable persistence failure vocabulary; no provider detail crosses the port. */
export class MemberRepositoryError extends Error {
  readonly name = "MemberRepositoryError";

  constructor(readonly code: MemberRepositoryErrorCode) {
    super(code);
  }
}
