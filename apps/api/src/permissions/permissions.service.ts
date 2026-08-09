import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import type {
  AssignedCustomRole,
  BaseRole,
  PermissionKey,
  PermissionSet,
} from "@repo/contracts/permissions";
import {
  hasAllPermissions,
  hasPermission,
  resolveEffectivePermissions,
} from "@repo/contracts/permissions";
import type { MenuKey } from "@repo/contracts/menu";
import { canViewMenu, isMenuKey, visibleMenuKeys } from "@repo/contracts/menu";

import { SupabaseService } from "../supabase/supabase.service";

interface CacheEntry {
  version: number;
  permissions: PermissionSet;
  menuOverrides: Partial<Record<MenuKey, boolean>>;
  menuLoaded: boolean;
}

/**
 * Resolves a user's effective permissions within an organization.
 *
 * The MERGE SEMANTICS live in `@repo/contracts` so the web app computes exactly
 * the same answer the API enforces — a second implementation would drift, and
 * the drift would show as a UI that offers a button the server then refuses.
 * This service is only the data-gathering half.
 *
 * CACHING is keyed on `organization_permissions_version`, which database
 * triggers bump on any write to memberships, custom roles, assignments,
 * overrides or menu rules. So the cache is exact rather than time-based: a
 * permission change takes effect on the very next request instead of whenever a
 * TTL happens to lapse, and there is no invalidation code to forget to call.
 */
@Injectable()
export class PermissionsService {
  private readonly logger = new Logger(PermissionsService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly supabase: SupabaseService) {}

  private key(orgId: string, userId: string): string {
    return `${orgId}:${userId}`;
  }

  private unavailable(
    source: string,
    message: string,
  ): ServiceUnavailableException {
    this.logger.error(`${source} failed: ${message}`);
    return new ServiceUnavailableException({
      message: "Permissions are temporarily unavailable. Please try again.",
      code: "permissions_unavailable",
    });
  }

  /** Current RBAC version for an organization. */
  private async version(orgId: string): Promise<number> {
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

  async resolve(
    orgId: string,
    userId: string,
    baseRole: BaseRole,
  ): Promise<{
    permissions: PermissionSet;
    menuOverrides: Partial<Record<MenuKey, boolean>>;
  }> {
    const { version, permissions } = await this.resolvePermissions(
      orgId,
      userId,
      baseRole,
    );
    const cacheKey = this.key(orgId, userId);
    const cached = this.cache.get(cacheKey);
    if (cached?.version === version && cached.menuLoaded) {
      return {
        permissions,
        menuOverrides: cached.menuOverrides,
      };
    }

    const menu = await this.menuRules(orgId, userId, baseRole);

    this.cache.set(cacheKey, {
      version,
      permissions,
      menuOverrides: menu,
      menuLoaded: true,
    });

    return { permissions, menuOverrides: menu };
  }

  private async resolvePermissions(
    orgId: string,
    userId: string,
    baseRole: BaseRole,
  ): Promise<{ version: number; permissions: PermissionSet }> {
    const version = await this.version(orgId);
    const cacheKey = this.key(orgId, userId);
    const cached = this.cache.get(cacheKey);

    if (cached && cached.version === version) {
      return { version, permissions: cached.permissions };
    }

    const [roles, overrides] = await Promise.all([
      this.assignedRoles(orgId, userId),
      this.baseRoleOverrides(orgId, baseRole),
    ]);

    const permissions = resolveEffectivePermissions({
      baseRole,
      customRoles: roles,
      baseRoleOverrides: overrides,
    });

    this.cache.set(cacheKey, {
      version,
      permissions,
      menuOverrides: {},
      menuLoaded: false,
    });

    return { version, permissions };
  }

  async effectivePermissions(
    orgId: string,
    userId: string,
    baseRole: BaseRole,
  ): Promise<PermissionSet> {
    const { permissions } = await this.resolvePermissions(
      orgId,
      userId,
      baseRole,
    );
    return permissions;
  }

  async can(
    orgId: string,
    userId: string,
    baseRole: BaseRole,
    keys: readonly PermissionKey[],
  ): Promise<boolean> {
    const permissions = await this.effectivePermissions(
      orgId,
      userId,
      baseRole,
    );
    return hasAllPermissions(permissions, keys);
  }

  async menu(
    orgId: string,
    userId: string,
    baseRole: BaseRole,
  ): Promise<MenuKey[]> {
    const { permissions, menuOverrides } = await this.resolve(
      orgId,
      userId,
      baseRole,
    );
    return visibleMenuKeys({
      can: (k) => hasPermission(permissions, k),
      overrides: menuOverrides,
    });
  }

  async canViewMenuKey(
    orgId: string,
    userId: string,
    baseRole: BaseRole,
    key: MenuKey,
  ): Promise<boolean> {
    const { permissions, menuOverrides } = await this.resolve(
      orgId,
      userId,
      baseRole,
    );
    return canViewMenu(key, {
      can: (k) => hasPermission(permissions, k),
      overrides: menuOverrides,
    });
  }

  // -------------------------------------------------------------------------

  private async assignedRoles(
    orgId: string,
    userId: string,
  ): Promise<AssignedCustomRole[]> {
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

    return (data ?? [])
      .map((row) => row.custom_roles)
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .map((r) => ({
        id: r.id,
        name: r.name,
        base_role: r.base_role as BaseRole,
        permissions: r.permissions,
        is_active: r.is_active,
        is_deleted: r.is_deleted,
      }));
  }

  private async baseRoleOverrides(
    orgId: string,
    baseRole: BaseRole,
  ): Promise<unknown> {
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

  private async menuRules(
    orgId: string,
    userId: string,
    baseRole: BaseRole,
  ): Promise<Partial<Record<MenuKey, boolean>>> {
    const { data, error } = await this.supabase
      .admin()
      .from("menu_permissions")
      .select("menu_key, target_type, user_id, base_role, can_view")
      .eq("organization_id", orgId);

    if (error) {
      throw this.unavailable("Menu rule lookup", error.message);
    }

    const out: Partial<Record<MenuKey, boolean>> = {};

    // Base-role rules first, then user rules, so a rule aimed at one person
    // beats the organization-wide default rather than losing to it.
    for (const row of data ?? []) {
      if (!isMenuKey(row.menu_key)) continue;
      if (row.target_type === "base_role" && row.base_role === baseRole) {
        out[row.menu_key] = row.can_view ?? true;
      }
    }
    for (const row of data ?? []) {
      if (!isMenuKey(row.menu_key)) continue;
      if (row.target_type === "user" && row.user_id === userId) {
        out[row.menu_key] = row.can_view ?? true;
      }
    }

    return out;
  }
}
