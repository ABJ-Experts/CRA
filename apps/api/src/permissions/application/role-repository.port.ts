import type { BaseRole, PermissionSet } from "@repo/contracts/permissions";
import type { CustomRole } from "@repo/contracts/roles";

export const ROLE_REPOSITORY = Symbol("ROLE_REPOSITORY");

export type AuditMutationContext = Readonly<{
  eventKey: string;
  correlationId: string;
  sourceIp: string | null;
}>;

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
  version: number;
}>;

export interface RoleRepository {
  list(orgId: string): Promise<readonly CustomRole[]>;
  create(
    orgId: string,
    input: CreateRoleRecord,
    actorId?: string,
    context?: AuditMutationContext,
  ): Promise<{ id: string }>;
  find(orgId: string, roleId: string): Promise<CustomRoleIdentity | null>;
  update(
    orgId: string,
    roleId: string,
    patch: UpdateRoleRecord,
    actorId?: string,
    context?: AuditMutationContext,
    expectedVersion?: number,
  ): Promise<void>;
  softDelete(
    orgId: string,
    roleId: string,
    actorId: string,
    context?: AuditMutationContext,
    expectedVersion?: number,
  ): Promise<void>;
  overrides(orgId: string): Promise<Readonly<Record<string, PermissionSet>>>;
  setOverride(
    orgId: string,
    baseRole: BaseRole,
    permissions: PermissionSet,
    actorId?: string,
    context?: AuditMutationContext,
  ): Promise<void>;
}

export type RoleRepositoryErrorCode =
  | "role_name_taken"
  | "role_not_found"
  | "role_is_system"
  | "conflict"
  | "unavailable";

/** Stable persistence failure vocabulary; provider details remain internal. */
export class RoleRepositoryError extends Error {
  readonly name = "RoleRepositoryError";

  constructor(readonly code: RoleRepositoryErrorCode) {
    super(code);
  }
}
