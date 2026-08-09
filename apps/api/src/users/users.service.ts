import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PageParams, Paged } from "@repo/contracts/pagination";
import type { BaseRole } from "@repo/contracts/permissions";
import type { Member } from "@repo/contracts/users";

import type { Result } from "../common/domain/result";
import {
  MemberUseCases,
  type MemberActor,
  type MemberMutationOperation,
  type MemberUseCaseError,
} from "./application/member-use-cases";
import type { ProfilePatch } from "./application/member-repository.port";

/** @deprecated Import `Member` from `@repo/contracts/users` directly. */
export type MemberRow = Member;

/**
 * Nest compatibility facade for the member application layer.
 *
 * Public signatures and exception payloads remain stable for existing
 * controllers while tenant rules and persistence live behind explicit ports.
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject(MemberUseCases) private readonly useCases: MemberUseCases,
  ) {}

  async listMembers(
    orgId: string,
    params: PageParams,
  ): Promise<Paged<MemberRow>> {
    return this.unwrap(await this.useCases.list({ orgId, params }));
  }

  async changeRole(
    orgId: string,
    actor: MemberActor,
    targetUserId: string,
    role: BaseRole,
  ): Promise<void> {
    this.unwrap(
      await this.useCases.changeRole({ orgId, actor, targetUserId, role }),
    );
  }

  async removeMember(
    orgId: string,
    actor: MemberActor,
    targetUserId: string,
  ): Promise<void> {
    this.unwrap(await this.useCases.remove({ orgId, actor, targetUserId }));
  }

  async setActive(
    orgId: string,
    actor: MemberActor,
    targetUserId: string,
    isActive: boolean,
  ): Promise<void> {
    this.unwrap(
      await this.useCases.setActive({
        orgId,
        actor,
        targetUserId,
        isActive,
      }),
    );
  }

  async updateProfile(userId: string, patch: ProfilePatch): Promise<void> {
    this.unwrap(
      await this.useCases.updateOwnProfile({
        actorUserId: userId,
        targetUserId: userId,
        patch,
      }),
    );
  }

  private unwrap<T>(result: Result<T, MemberUseCaseError>): T {
    if (result.ok) return result.value;
    throw this.httpFailure(result.error);
  }

  private httpFailure(error: MemberUseCaseError): Error {
    switch (error.code) {
      case "cannot_change_own_role":
        return new ConflictException({
          message: "You cannot change your own role.",
          code: error.code,
        });
      case "cannot_remove_self":
        return new ConflictException({
          message: "You cannot remove yourself from the organization.",
          code: error.code,
        });
      case "cannot_deactivate_self":
        return new ConflictException({
          message: "You cannot deactivate your own account.",
          code: error.code,
        });
      case "profile_scope_violation":
        return new ForbiddenException({
          message: "You can update only your own profile.",
          code: error.code,
        });
      case "member_not_found":
        return new NotFoundException({
          message: "That person is not a member of this organization.",
          code: error.code,
        });
      case "last_owner":
        return new ConflictException({
          message:
            "This organization needs at least one owner. Promote someone else first.",
          code: error.code,
        });
      case "member_list_failed":
        return new BadRequestException({
          message: "We could not load those members.",
          code: error.code,
        });
      case "update_failed":
        return new BadRequestException({
          message: this.updateFallback(error.operation),
          code: error.code,
        });
    }
  }

  private updateFallback(operation: MemberMutationOperation): string {
    switch (operation) {
      case "changeRole":
        return "We could not change that role.";
      case "remove":
        return "We could not remove that member.";
      case "setActive":
        return "We could not update that account.";
      case "updateOwnProfile":
        return "We could not save those changes.";
    }
  }
}
