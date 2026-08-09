import { Injectable, Logger } from "@nestjs/common";
import {
  isBaseRole,
  sanitizePermissions,
  type BaseRole,
  type PermissionSet,
} from "@repo/contracts/permissions";
import { customRoleSchema, type CustomRole } from "@repo/contracts/roles";

import { SupabaseService } from "../../supabase/supabase.service";
import {
  RoleRepositoryError,
  type CreateRoleRecord,
  type CustomRoleIdentity,
  type RoleRepository,
  type UpdateRoleRecord,
} from "../application/role-repository.port";

const ROLE_SELECT =
  "id, name, description, color, base_role, permissions, is_system, is_active, user_role_assignments(count)";

@Injectable()
export class SupabaseRoleRepository implements RoleRepository {
  private readonly logger = new Logger(SupabaseRoleRepository.name);

  constructor(private readonly supabase: SupabaseService) {}

  async list(orgId: string): Promise<readonly CustomRole[]> {
    const { data, error } = await this.supabase
      .admin()
      .from("custom_roles")
      .select(ROLE_SELECT)
      .eq("organization_id", orgId)
      .eq("is_deleted", false)
      .order("created_at", { ascending: true });
    if (error) this.fail(error.message);

    return (data ?? []).map((row) => this.toRole(row));
  }

  async create(
    orgId: string,
    input: CreateRoleRecord,
  ): Promise<{ id: string }> {
    const { data, error } = await this.supabase
      .admin()
      .from("custom_roles")
      .insert({
        organization_id: orgId,
        name: input.name,
        description: input.description,
        color: input.color,
        base_role: input.baseRole,
        permissions: input.permissions,
      })
      .select("id")
      .single();
    if (error?.message.includes("duplicate key")) {
      throw new RoleRepositoryError("role_name_taken");
    }
    if (error) this.fail(error.message);
    if (!data) this.fail("create returned no role id");
    return Object.freeze({ id: data.id });
  }

  async find(
    orgId: string,
    roleId: string,
  ): Promise<CustomRoleIdentity | null> {
    const { data, error } = await this.supabase
      .admin()
      .from("custom_roles")
      .select("id, is_system")
      .eq("id", roleId)
      .eq("organization_id", orgId)
      .eq("is_deleted", false)
      .maybeSingle();
    if (error) this.fail(error.message);
    if (!data) return null;
    return Object.freeze({ id: data.id, isSystem: data.is_system });
  }

  async update(
    orgId: string,
    roleId: string,
    patch: UpdateRoleRecord,
  ): Promise<void> {
    const { error } = await this.supabase
      .admin()
      .from("custom_roles")
      .update({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined
          ? { description: patch.description }
          : {}),
        ...(patch.color !== undefined ? { color: patch.color } : {}),
        ...(patch.baseRole !== undefined ? { base_role: patch.baseRole } : {}),
        ...(patch.permissions !== undefined
          ? { permissions: patch.permissions }
          : {}),
        ...(patch.isActive !== undefined ? { is_active: patch.isActive } : {}),
      })
      .eq("id", roleId)
      .eq("organization_id", orgId);
    if (error) this.fail(error.message);
  }

  async softDelete(
    orgId: string,
    roleId: string,
    actorId: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .admin()
      .from("custom_roles")
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: actorId,
        is_active: false,
      })
      .eq("id", roleId)
      .eq("organization_id", orgId);
    if (error) this.fail(error.message);
  }

  async overrides(
    orgId: string,
  ): Promise<Readonly<Record<string, PermissionSet>>> {
    const { data, error } = await this.supabase
      .admin()
      .from("base_role_permission_overrides")
      .select("base_role, permissions")
      .eq("organization_id", orgId);
    if (error) this.fail(error.message);

    return Object.fromEntries(
      (data ?? []).map((row) => [
        this.baseRole(row.base_role),
        sanitizePermissions(row.permissions),
      ]),
    );
  }

  async setOverride(
    orgId: string,
    baseRole: BaseRole,
    permissions: PermissionSet,
  ): Promise<void> {
    const { error } = await this.supabase
      .admin()
      .from("base_role_permission_overrides")
      .upsert(
        { organization_id: orgId, base_role: baseRole, permissions },
        { onConflict: "organization_id,base_role" },
      );
    if (error) this.fail(error.message);
  }

  private fail(message: string): never {
    this.logger.error(`Role persistence failed: ${message}`);
    throw new RoleRepositoryError("unavailable");
  }

  private baseRole(value: string): BaseRole {
    if (isBaseRole(value)) return value;
    this.logger.error("Role query returned an invalid base role");
    throw new RoleRepositoryError("unavailable");
  }

  private toRole(row: {
    id: string;
    name: string;
    description: string | null;
    color: string;
    base_role: string;
    permissions: unknown;
    is_system: boolean;
    is_active: boolean;
    user_role_assignments: unknown;
  }): CustomRole {
    const parsed = customRoleSchema.safeParse({
      id: row.id,
      name: row.name,
      description: row.description,
      color: row.color,
      baseRole: this.baseRole(row.base_role),
      permissions: sanitizePermissions(row.permissions),
      isSystem: row.is_system,
      isActive: row.is_active,
      memberCount:
        (row.user_role_assignments as { count: number }[] | null)?.[0]?.count ??
        0,
    });
    if (parsed.success) return parsed.data;
    this.logger.error("Role query returned a malformed role record");
    throw new RoleRepositoryError("unavailable");
  }
}
