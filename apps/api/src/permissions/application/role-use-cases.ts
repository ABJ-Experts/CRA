import {
  isBaseRole,
  sanitizePermissions,
  type BaseRole,
  type PermissionSet,
} from "@repo/contracts/permissions";
import type { CustomRole } from "@repo/contracts/roles";

import type { Result } from "../../common/application/result";
import { failure, success } from "../../common/application/result";
import type {
  CreateRoleRecord,
  RoleRepository,
  UpdateRoleRecord,
} from "./role-repository.port";
import { RoleRepositoryError } from "./role-repository.port";

export type RoleActor = Readonly<{ id: string; email: string }>;

export type RoleAuditEntry = Readonly<{
  organizationId: string | null;
  userId: string | null;
  actorEmail?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
}>;

export interface RoleAuditPort {
  /** Implementations must be best-effort and never throw. */
  log(entry: RoleAuditEntry): void;
}

export type CreateRoleInput = Readonly<{
  name: string;
  description?: string;
  color?: string;
  baseRole: BaseRole;
  permissions: unknown;
}>;

export type UpdateRoleInput = Readonly<{
  name?: string;
  description?: string;
  color?: string;
  baseRole?: BaseRole;
  permissions?: unknown;
  isActive?: boolean;
}>;

export type CreateRoleCommand = Readonly<{
  orgId: string;
  actor: RoleActor;
  input: CreateRoleInput;
}>;

export type UpdateRoleCommand = Readonly<{
  orgId: string;
  actor: RoleActor;
  roleId: string;
  patch: UpdateRoleInput;
}>;

export type RemoveRoleCommand = Readonly<{
  orgId: string;
  actor: RoleActor;
  roleId: string;
}>;

export type SetOverrideCommand = Readonly<{
  orgId: string;
  actor: RoleActor;
  baseRole: BaseRole;
  permissions: unknown;
}>;

export type RoleUseCaseError =
  | Readonly<{ code: "role_list_failed" }>
  | Readonly<{ code: "role_name_taken" }>
  | Readonly<{ code: "role_create_failed" }>
  | Readonly<{ code: "role_not_found" }>
  | Readonly<{
      code: "role_is_system";
      operation: "update" | "remove";
    }>
  | Readonly<{ code: "role_update_failed" }>
  | Readonly<{ code: "role_delete_failed" }>
  | Readonly<{ code: "override_failed" }>;

type RoleResult<T> = Result<T, RoleUseCaseError>;

/** Framework-free custom-role commands and queries. */
export class RoleUseCases {
  constructor(
    private readonly repository: RoleRepository,
    private readonly audit: RoleAuditPort,
  ) {}

  async list(
    query: Readonly<{ orgId: string }>,
  ): Promise<RoleResult<CustomRole[]>> {
    try {
      return success(this.freezeRoles(await this.repository.list(query.orgId)));
    } catch {
      return failure(Object.freeze({ code: "role_list_failed" as const }));
    }
  }

  async create(
    command: CreateRoleCommand,
  ): Promise<RoleResult<Readonly<{ id: string }>>> {
    const record = this.createRecord(command.input);
    try {
      const created = await this.repository.create(command.orgId, record);
      this.audit.log(
        this.auditEntry(
          command.orgId,
          command.actor,
          "role.created",
          created.id,
        ),
      );
      return success(Object.freeze({ id: created.id }));
    } catch (error) {
      if (
        error instanceof RoleRepositoryError &&
        error.code === "role_name_taken"
      ) {
        return failure(Object.freeze({ code: "role_name_taken" as const }));
      }
      return failure(Object.freeze({ code: "role_create_failed" as const }));
    }
  }

  async update(command: UpdateRoleCommand): Promise<RoleResult<void>> {
    try {
      const existing = await this.repository.find(
        command.orgId,
        command.roleId,
      );
      if (!existing) {
        return failure(Object.freeze({ code: "role_not_found" as const }));
      }
      if (existing.isSystem) {
        return failure(
          Object.freeze({
            code: "role_is_system" as const,
            operation: "update" as const,
          }),
        );
      }
      await this.repository.update(
        command.orgId,
        command.roleId,
        this.updateRecord(command.patch),
      );
      this.audit.log(
        this.auditEntry(
          command.orgId,
          command.actor,
          "role.updated",
          command.roleId,
        ),
      );
      return success(undefined);
    } catch {
      return failure(Object.freeze({ code: "role_update_failed" as const }));
    }
  }

  async remove(command: RemoveRoleCommand): Promise<RoleResult<void>> {
    try {
      const existing = await this.repository.find(
        command.orgId,
        command.roleId,
      );
      if (!existing) {
        return failure(Object.freeze({ code: "role_not_found" as const }));
      }
      if (existing.isSystem) {
        return failure(
          Object.freeze({
            code: "role_is_system" as const,
            operation: "remove" as const,
          }),
        );
      }
      await this.repository.softDelete(
        command.orgId,
        command.roleId,
        command.actor.id,
      );
      this.audit.log(
        this.auditEntry(
          command.orgId,
          command.actor,
          "role.deleted",
          command.roleId,
        ),
      );
      return success(undefined);
    } catch {
      return failure(Object.freeze({ code: "role_delete_failed" as const }));
    }
  }

  async overrides(
    query: Readonly<{ orgId: string }>,
  ): Promise<RoleResult<Readonly<Record<string, PermissionSet>>>> {
    try {
      const values = await this.repository.overrides(query.orgId);
      return success(this.freezeOverrides(values));
    } catch {
      return success(Object.freeze({}));
    }
  }

  async setOverride(command: SetOverrideCommand): Promise<RoleResult<void>> {
    const permissions = Object.freeze(sanitizePermissions(command.permissions));
    try {
      await this.repository.setOverride(
        command.orgId,
        command.baseRole,
        permissions,
      );
      this.audit.log(
        Object.freeze({
          organizationId: command.orgId,
          userId: command.actor.id,
          actorEmail: command.actor.email,
          action: "permissions.override_updated",
          entityType: "base_role",
          entityId: command.baseRole,
        }),
      );
      return success(undefined);
    } catch {
      return failure(Object.freeze({ code: "override_failed" as const }));
    }
  }

  private createRecord(input: CreateRoleInput): CreateRoleRecord {
    return Object.freeze({
      name: input.name,
      description: input.description ?? null,
      color: input.color ?? "#6B7280",
      baseRole: input.baseRole,
      permissions: Object.freeze(sanitizePermissions(input.permissions)),
    });
  }

  private updateRecord(input: UpdateRoleInput): UpdateRoleRecord {
    return Object.freeze({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.baseRole !== undefined ? { baseRole: input.baseRole } : {}),
      ...(input.permissions !== undefined
        ? {
            permissions: Object.freeze(sanitizePermissions(input.permissions)),
          }
        : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    });
  }

  private freezeRoles(roles: readonly CustomRole[]): CustomRole[] {
    return Object.freeze(
      roles.map((role) =>
        Object.freeze({
          ...role,
          permissions: Object.freeze(sanitizePermissions(role.permissions)),
        }),
      ),
    ) as CustomRole[];
  }

  private freezeOverrides(
    values: Readonly<Record<string, PermissionSet>>,
  ): Readonly<Record<string, PermissionSet>> {
    if (Object.keys(values).some((baseRole) => !isBaseRole(baseRole))) {
      throw new Error("Invalid base-role override snapshot");
    }
    return Object.freeze(
      Object.fromEntries(
        Object.entries(values).map(([baseRole, permissions]) => [
          baseRole,
          Object.freeze(sanitizePermissions(permissions)),
        ]),
      ),
    );
  }

  private auditEntry(
    orgId: string,
    actor: RoleActor,
    action: string,
    entityId: string,
  ): RoleAuditEntry {
    return Object.freeze({
      organizationId: orgId,
      userId: actor.id,
      actorEmail: actor.email,
      action,
      entityType: "custom_role",
      entityId,
    });
  }
}
