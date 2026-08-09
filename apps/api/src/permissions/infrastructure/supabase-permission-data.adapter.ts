import { Injectable, Logger } from "@nestjs/common";
import type { MenuKey } from "@repo/contracts/menu";
import { isMenuKey } from "@repo/contracts/menu";
import type { AssignedCustomRole, BaseRole } from "@repo/contracts/permissions";

import { SupabaseService } from "../../supabase/supabase.service";
import {
  PermissionDataUnavailableError,
  type PermissionDataPort,
} from "../application/permission-data.port";

@Injectable()
export class SupabasePermissionDataAdapter implements PermissionDataPort {
  private readonly logger = new Logger(SupabasePermissionDataAdapter.name);

  constructor(private readonly supabase: SupabaseService) {}

  async version(orgId: string): Promise<number> {
    const { data, error } = await this.supabase
      .admin()
      .from("organization_permissions_version")
      .select("version")
      .eq("organization_id", orgId)
      .maybeSingle();

    if (error || !data) {
      throw this.unavailable(
        "Permission version lookup",
        error?.message ?? "version row missing",
      );
    }
    return data.version;
  }

  async assignedRoles(
    orgId: string,
    userId: string,
  ): Promise<readonly AssignedCustomRole[]> {
    const { data, error } = await this.supabase
      .admin()
      .from("user_role_assignments")
      .select(
        "custom_roles(id, name, base_role, permissions, is_active, is_deleted)",
      )
      .eq("organization_id", orgId)
      .eq("user_id", userId);

    if (error) {
      throw this.unavailable("Role assignment lookup", error.message);
    }

    return Object.freeze(
      (data ?? [])
        .map((row) => row.custom_roles)
        .filter((role): role is NonNullable<typeof role> => role !== null)
        .map((role) =>
          Object.freeze({
            id: role.id,
            name: role.name,
            base_role: role.base_role as BaseRole,
            permissions: role.permissions,
            is_active: role.is_active,
            is_deleted: role.is_deleted,
          }),
        ),
    );
  }

  async baseRoleOverrides(orgId: string, baseRole: BaseRole): Promise<unknown> {
    const { data, error } = await this.supabase
      .admin()
      .from("base_role_permission_overrides")
      .select("permissions")
      .eq("organization_id", orgId)
      .eq("base_role", baseRole)
      .maybeSingle();

    if (error) {
      throw this.unavailable("Override lookup", error.message);
    }
    return data?.permissions ?? {};
  }

  async menuRules(
    orgId: string,
    userId: string,
    baseRole: BaseRole,
  ): Promise<Readonly<Partial<Record<MenuKey, boolean>>>> {
    const { data, error } = await this.supabase
      .admin()
      .from("menu_permissions")
      .select("menu_key, target_type, user_id, base_role, can_view")
      .eq("organization_id", orgId);

    if (error) {
      throw this.unavailable("Menu rule lookup", error.message);
    }

    const baseEntries = (data ?? [])
      .filter(
        (row) =>
          isMenuKey(row.menu_key) &&
          row.target_type === "base_role" &&
          row.base_role === baseRole,
      )
      .map((row) => [row.menu_key, row.can_view ?? true] as const);
    const userEntries = (data ?? [])
      .filter(
        (row) =>
          isMenuKey(row.menu_key) &&
          row.target_type === "user" &&
          row.user_id === userId,
      )
      .map((row) => [row.menu_key, row.can_view ?? true] as const);

    return Object.freeze(Object.fromEntries([...baseEntries, ...userEntries]));
  }

  private unavailable(
    source: string,
    message: string,
  ): PermissionDataUnavailableError {
    this.logger.error(`${source} failed: ${message}`);
    return new PermissionDataUnavailableError(source);
  }
}
