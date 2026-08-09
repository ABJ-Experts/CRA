import type { PageParams, Paged } from "@repo/contracts/pagination";
import type { BaseRole } from "@repo/contracts/permissions";
import type { Member } from "@repo/contracts/users";

import type { Result } from "../../common/application/result";
import { failure, success } from "../../common/application/result";
import type { MemberRepository, ProfilePatch } from "./member-repository.port";
import { MemberRepositoryError } from "./member-repository.port";

export type MemberActor = Readonly<{ id: string; email: string }>;

export type MemberAuditEntry = Readonly<{
  organizationId: string | null;
  userId: string | null;
  actorEmail?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  changes?: Readonly<Record<string, string | number | boolean | null>>;
}>;

export interface MemberAuditPort {
  log(entry: MemberAuditEntry): void;
}

export type ListMembersQuery = Readonly<{
  orgId: string;
  params: Readonly<PageParams>;
}>;

export type ChangeMemberRoleCommand = Readonly<{
  orgId: string;
  actor: MemberActor;
  targetUserId: string;
  role: BaseRole;
}>;

export type RemoveMemberCommand = Readonly<{
  orgId: string;
  actor: MemberActor;
  targetUserId: string;
}>;

export type SetMemberActiveCommand = Readonly<{
  orgId: string;
  actor: MemberActor;
  targetUserId: string;
  isActive: boolean;
}>;

export type UpdateOwnProfileCommand = Readonly<{
  actorUserId: string;
  targetUserId: string;
  patch: ProfilePatch;
}>;

export type MemberMutationOperation =
  "changeRole" | "remove" | "setActive" | "updateOwnProfile";

export type MemberUseCaseError =
  | Readonly<{ code: "cannot_change_own_role" }>
  | Readonly<{ code: "cannot_remove_self" }>
  | Readonly<{ code: "cannot_deactivate_self" }>
  | Readonly<{ code: "profile_scope_violation" }>
  | Readonly<{ code: "member_not_found" }>
  | Readonly<{ code: "last_owner" }>
  | Readonly<{ code: "member_list_failed" }>
  | Readonly<{ code: "update_failed"; operation: MemberMutationOperation }>;

type MemberResult<T> = Result<T, MemberUseCaseError>;

/** Framework-free member commands and queries. */
export class MemberUseCases {
  constructor(
    private readonly repository: MemberRepository,
    private readonly audit: MemberAuditPort,
  ) {}

  async list(query: ListMembersQuery): Promise<MemberResult<Paged<Member>>> {
    try {
      const params = Object.freeze({ ...query.params });
      const page = await this.repository.list(query.orgId, params);
      return success(this.freezePage(page));
    } catch {
      return failure(Object.freeze({ code: "member_list_failed" as const }));
    }
  }

  async changeRole(
    command: ChangeMemberRoleCommand,
  ): Promise<MemberResult<void>> {
    if (command.actor.id === command.targetUserId) {
      return failure(
        Object.freeze({ code: "cannot_change_own_role" as const }),
      );
    }

    try {
      const existing = await this.repository.findMembership(
        command.orgId,
        command.targetUserId,
      );
      if (!existing) {
        return failure(Object.freeze({ code: "member_not_found" as const }));
      }
      await this.repository.changeRole(
        command.orgId,
        command.targetUserId,
        command.role,
      );
      this.audit.log(
        Object.freeze({
          organizationId: command.orgId,
          userId: command.actor.id,
          actorEmail: command.actor.email,
          action: "member.role_changed",
          entityType: "user",
          entityId: command.targetUserId,
          changes: Object.freeze({ from: existing.role, to: command.role }),
        }),
      );
      return success(undefined);
    } catch (error) {
      return this.repositoryFailure(error, "changeRole");
    }
  }

  async remove(command: RemoveMemberCommand): Promise<MemberResult<void>> {
    if (command.actor.id === command.targetUserId) {
      return failure(Object.freeze({ code: "cannot_remove_self" as const }));
    }

    try {
      await this.repository.remove(command.orgId, command.targetUserId);
      this.audit.log(
        Object.freeze({
          organizationId: command.orgId,
          userId: command.actor.id,
          actorEmail: command.actor.email,
          action: "member.removed",
          entityType: "user",
          entityId: command.targetUserId,
        }),
      );
      return success(undefined);
    } catch (error) {
      return this.repositoryFailure(error, "remove");
    }
  }

  async setActive(
    command: SetMemberActiveCommand,
  ): Promise<MemberResult<void>> {
    if (command.actor.id === command.targetUserId && !command.isActive) {
      return failure(
        Object.freeze({ code: "cannot_deactivate_self" as const }),
      );
    }

    try {
      await this.repository.setActive(
        command.orgId,
        command.targetUserId,
        command.isActive,
      );
      this.audit.log(
        Object.freeze({
          organizationId: command.orgId,
          userId: command.actor.id,
          actorEmail: command.actor.email,
          action: command.isActive
            ? "member.reactivated"
            : "member.deactivated",
          entityType: "user",
          entityId: command.targetUserId,
        }),
      );
      return success(undefined);
    } catch (error) {
      return this.repositoryFailure(error, "setActive");
    }
  }

  async updateOwnProfile(
    command: UpdateOwnProfileCommand,
  ): Promise<MemberResult<void>> {
    if (command.actorUserId !== command.targetUserId) {
      return failure(
        Object.freeze({ code: "profile_scope_violation" as const }),
      );
    }

    try {
      await this.repository.updateOwnProfile(
        command.actorUserId,
        Object.freeze({ ...command.patch }),
      );
      return success(undefined);
    } catch (error) {
      return this.repositoryFailure(error, "updateOwnProfile");
    }
  }

  private repositoryFailure(
    error: unknown,
    operation: MemberMutationOperation,
  ): MemberResult<never> {
    if (error instanceof MemberRepositoryError) {
      if (error.code === "last_owner") {
        return failure(Object.freeze({ code: "last_owner" as const }));
      }
      if (error.code === "member_not_found") {
        return failure(Object.freeze({ code: "member_not_found" as const }));
      }
    }
    return failure(
      Object.freeze({ code: "update_failed" as const, operation }),
    );
  }

  private freezePage(page: Paged<Member>): Paged<Member> {
    const rows = page.rows.map((member) =>
      Object.freeze({
        ...member,
        roles: Object.freeze(
          member.roles.map((role) => Object.freeze({ ...role })),
        ),
      }),
    );
    return Object.freeze({
      rows: Object.freeze(rows) as Member[],
      total: page.total,
      page: page.page,
      pageSize: page.pageSize,
      pageCount: page.pageCount,
    });
  }
}
