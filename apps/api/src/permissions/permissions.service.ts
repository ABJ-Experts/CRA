import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { MenuKey } from "@repo/contracts/menu";
import { canViewMenu, visibleMenuKeys } from "@repo/contracts/menu";
import type {
  BaseRole,
  PermissionKey,
  PermissionSet,
} from "@repo/contracts/permissions";
import { hasAllPermissions, hasPermission } from "@repo/contracts/permissions";

import { BasePermissionResolver } from "./application/base-permission-resolver";
import { PermissionDataUnavailableError } from "./application/permission-data.port";
import { VersionedPermissionResolver } from "./application/versioned-permission-resolver.proxy";
import { SupabasePermissionDataAdapter } from "./infrastructure/supabase-permission-data.adapter";

/** Stable compatibility facade for controllers and guards. */
@Injectable()
export class PermissionsService {
  private readonly resolver: VersionedPermissionResolver;

  constructor(
    @Inject(VersionedPermissionResolver)
    dependency:
      | VersionedPermissionResolver
      | ConstructorParameters<typeof SupabasePermissionDataAdapter>[0],
  ) {
    if (
      "resolve" in dependency &&
      typeof dependency.resolve === "function" &&
      "effectivePermissions" in dependency &&
      typeof dependency.effectivePermissions === "function"
    ) {
      this.resolver = dependency;
      return;
    }

    // Transitional direct construction keeps the pre-refactor test and caller
    // surface stable while Nest uses the composition-root providers below.
    const data = new SupabasePermissionDataAdapter(dependency);
    this.resolver = new VersionedPermissionResolver(
      data,
      new BasePermissionResolver(data),
    );
  }

  async resolve(
    orgId: string,
    userId: string,
    baseRole: BaseRole,
  ): Promise<{
    permissions: PermissionSet;
    menuOverrides: Partial<Record<MenuKey, boolean>>;
  }> {
    return this.mapUnavailable(async () => {
      const resolved = await this.resolver.resolve(orgId, userId, baseRole);
      return {
        permissions: { ...resolved.permissions },
        menuOverrides: { ...resolved.menuOverrides },
      };
    });
  }

  async effectivePermissions(
    orgId: string,
    userId: string,
    baseRole: BaseRole,
  ): Promise<PermissionSet> {
    return this.mapUnavailable(async () => ({
      ...(await this.resolver.effectivePermissions(orgId, userId, baseRole)),
    }));
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
      can: (key) => hasPermission(permissions, key),
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
      can: (permission) => hasPermission(permissions, permission),
      overrides: menuOverrides,
    });
  }

  private async mapUnavailable<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof PermissionDataUnavailableError)) throw error;
      throw new ServiceUnavailableException({
        message: "Permissions are temporarily unavailable. Please try again.",
        code: "permissions_unavailable",
      });
    }
  }
}
