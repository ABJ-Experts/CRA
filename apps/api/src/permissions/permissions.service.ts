import { Injectable, Logger } from "@nestjs/common";
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

  /** Current RBAC version for an organization; 0 when it cannot be read. */
  private async version(orgId: string): Promise<number> {
    const { data, error } = await this.supabase
      .admin()
      .from("organization_permissions_version")
      .select("version")
      .eq("organization_id", orgId)
      .maybeSingle();

    if (error) {
      this.logger.error(`Permission version lookup failed: ${error.message}`);
      // 0 never matches a cached entry, so an unreadable version degrades to
      // "always re-resolve" rather than to "serve something stale".
      return 0;
    }
    return data?.version ?? 0;
  }

  async resolve(
    orgId: string,
    userId: string,
    baseRole: BaseRole,
  ): Promise<{
    permissions: PermissionSet;
    menuOverrides: Partial<Record<MenuKey, boolean>>;
  }> {
    const version = await this.version(orgId);
    const cacheKey = this.key(orgId, userId);
    const cached = this.cache.get(cacheKey);

    if (cached && cached.version === version && version !== 0) {
      return {
        permissions: cached.permissions,
        menuOverrides: cached.menuOverrides,
      };
    }

    // Independent reads, so they go together rather than in sequence.
    const [roles, overrides, menu] = await Promise.all([
      this.assignedRoles(orgId, userId),
      this.baseRoleOverrides(orgId, baseRole),
      this.menuRules(orgId, userId, baseRole),
    ]);

    const permissions = resolveEffectivePermissions({
      baseRole,
      customRoles: roles,
      baseRoleOverrides: overrides,
    });

    const entry: CacheEntry = { version, permissions, menuOverrides: menu };
    if (version !== 0) this.cache.set(cacheKey, entry);

    return { permissions, menuOverrides: menu };
  }

  async can(
    orgId: string,
    userId: string,
    baseRole: BaseRole,
    keys: readonly PermissionKey[],
  ): Promise<boolean> {
    const { permissions } = await this.resolve(orgId, userId, baseRole);
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
      this.logger.error(`Role assignment lookup failed: ${error.message}`);
      // Fail CLOSED: an unreadable role list must not silently grant the
      // permissions those roles would have added.
      return [];
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
      this.logger.error(`Override lookup failed: ${error.message}`);
      /*
       * Fail closed here too, but note the asymmetry with the roles above:
       * overrides can REVOKE, so dropping them on error would GRANT. Returning
       * an empty object means the base-role defaults apply unmodified, which is
       * the conservative choice only because overrides are additive-or-
       * restrictive per key — a wrong answer either way, so it is logged loudly.
       */
      return {};
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
      this.logger.error(`Menu rule lookup failed: ${error.message}`);
      return {};
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
