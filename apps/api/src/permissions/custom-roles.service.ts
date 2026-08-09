import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { BaseRole, PermissionSet } from "@repo/contracts/permissions";
import type { CustomRole } from "@repo/contracts/roles";

import type { Result } from "../common/application/result";
import {
  RoleUseCases,
  type CreateRoleInput,
  type RoleActor,
  type RoleUseCaseError,
  type UpdateRoleInput,
} from "./application/role-use-cases";

/** @deprecated Import `CustomRole` from `@repo/contracts/roles` directly. */
export type CustomRoleRow = CustomRole;

/** Nest compatibility facade for the custom-role application layer. */
@Injectable()
export class CustomRolesService {
  constructor(@Inject(RoleUseCases) private readonly useCases: RoleUseCases) {}

  async list(orgId: string): Promise<CustomRoleRow[]> {
    return this.unwrap(await this.useCases.list({ orgId }));
  }

  async create(
    orgId: string,
    actor: RoleActor,
    input: CreateRoleInput,
  ): Promise<{ id: string }> {
    return this.unwrap(await this.useCases.create({ orgId, actor, input }));
  }

  async update(
    orgId: string,
    actor: RoleActor,
    roleId: string,
    patch: UpdateRoleInput,
  ): Promise<void> {
    this.unwrap(await this.useCases.update({ orgId, actor, roleId, patch }));
  }

  async remove(orgId: string, actor: RoleActor, roleId: string): Promise<void> {
    this.unwrap(await this.useCases.remove({ orgId, actor, roleId }));
  }

  async overrides(orgId: string): Promise<Record<string, PermissionSet>> {
    return this.unwrap(await this.useCases.overrides({ orgId }));
  }

  async setOverride(
    orgId: string,
    actor: RoleActor,
    baseRole: BaseRole,
    permissions: unknown,
  ): Promise<void> {
    this.unwrap(
      await this.useCases.setOverride({
        orgId,
        actor,
        baseRole,
        permissions,
      }),
    );
  }

  private unwrap<T>(result: Result<T, RoleUseCaseError>): T {
    if (result.ok) return result.value;
    throw this.httpFailure(result.error);
  }

  private httpFailure(error: RoleUseCaseError): Error {
    switch (error.code) {
      case "role_list_failed":
        return new BadRequestException({
          message: "We could not load those roles.",
          code: error.code,
        });
      case "role_name_taken":
        return new ConflictException({
          message: "A role with that name already exists.",
          code: error.code,
          fieldErrors: { name: "That name is already in use." },
        });
      case "role_create_failed":
        return new BadRequestException({
          message: "We could not create that role.",
          code: error.code,
        });
      case "role_not_found":
        return new NotFoundException({
          message: "That role no longer exists.",
          code: error.code,
        });
      case "role_is_system":
        return new ConflictException({
          message:
            error.operation === "update"
              ? "System roles cannot be edited."
              : "System roles cannot be deleted.",
          code: error.code,
        });
      case "role_update_failed":
        return new BadRequestException({
          message: "We could not save that role.",
          code: error.code,
        });
      case "role_delete_failed":
        return new BadRequestException({
          message: "We could not delete that role.",
          code: error.code,
        });
      case "override_failed":
        return new BadRequestException({
          message: "We could not save those permissions.",
          code: error.code,
        });
    }
  }
}
