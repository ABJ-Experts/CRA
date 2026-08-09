import type { BaseRole, PermissionSet } from "@repo/contracts/permissions";
import type { CustomRole } from "@repo/contracts/roles";

export const ROLE_REPOSITORY = Symbol("ROLE_REPOSITORY");

export type CreateRoleRecord = Readonly<{
  name: string;
  description: string | null;
  color: string;
  baseRole: BaseRole;
  permissions: PermissionSet;
}>;

export type UpdateRoleRecord = Readonly<{
  name?: string;
  description?: string;
  color?: string;
  baseRole?: BaseRole;
  permissions?: PermissionSet;
  isActive?: boolean;
}>;

export type CustomRoleIdentity = Readonly<{
  id: string;
  isSystem: boolean;
}>;

export interface RoleRepository {
  list(orgId: string): Promise<readonly CustomRole[]>;
  create(orgId: string, input: CreateRoleRecord): Promise<{ id: string }>;
  find(orgId: string, roleId: string): Promise<CustomRoleIdentity | null>;
  update(orgId: string, roleId: string, patch: UpdateRoleRecord): Promise<void>;
  softDelete(orgId: string, roleId: string, actorId: string): Promise<void>;
  overrides(orgId: string): Promise<Readonly<Record<string, PermissionSet>>>;
  setOverride(
    orgId: string,
    baseRole: BaseRole,
    permissions: PermissionSet,
  ): Promise<void>;
}

export type RoleRepositoryErrorCode = "role_name_taken" | "unavailable";

/** Stable persistence failure vocabulary; provider details remain internal. */
export class RoleRepositoryError extends Error {
  readonly name = "RoleRepositoryError";

  constructor(readonly code: RoleRepositoryErrorCode) {
    super(code);
  }
}
