import type { MenuKey } from "@repo/contracts/menu";
import type {
  AssignedCustomRole,
  BaseRole,
  PermissionSet,
} from "@repo/contracts/permissions";

export interface PermissionDataPort {
  version(orgId: string): Promise<number>;
  assignedRoles(
    orgId: string,
    userId: string,
  ): Promise<readonly AssignedCustomRole[]>;
  baseRoleOverrides(orgId: string, baseRole: BaseRole): Promise<unknown>;
  menuRules(
    orgId: string,
    userId: string,
    baseRole: BaseRole,
  ): Promise<Readonly<Partial<Record<MenuKey, boolean>>>>;
}

export interface PermissionResolution {
  readonly permissions: Readonly<PermissionSet>;
  readonly menuOverrides: Readonly<Partial<Record<MenuKey, boolean>>>;
}

export interface PermissionResolver {
  resolve(
    orgId: string,
    userId: string,
    baseRole: BaseRole,
  ): Promise<PermissionResolution>;
}

/**
 * Authorization does not depend on menu customization availability. Keeping
 * this narrower query separate preserves that security boundary while the
 * complete resolver remains useful to menu callers.
 */
export interface EffectivePermissionResolver {
  effectivePermissions(
    orgId: string,
    userId: string,
    baseRole: BaseRole,
  ): Promise<Readonly<PermissionSet>>;
}

/** Framework-free failure translated by the Nest compatibility facade. */
export class PermissionDataUnavailableError extends Error {
  constructor(readonly source: string) {
    super(`Permission data is unavailable: ${source}`);
    this.name = "PermissionDataUnavailableError";
  }
}
