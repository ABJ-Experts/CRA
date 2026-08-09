import type { BaseRole, PermissionSet } from "@repo/contracts/permissions";
import { resolveEffectivePermissions } from "@repo/contracts/permissions";

import type {
  EffectivePermissionResolver,
  PermissionDataPort,
  PermissionResolution,
  PermissionResolver,
} from "./permission-data.port";

export class BasePermissionResolver
  implements PermissionResolver, EffectivePermissionResolver
{
  constructor(private readonly data: PermissionDataPort) {}

  async resolve(
    orgId: string,
    userId: string,
    baseRole: BaseRole,
  ): Promise<PermissionResolution> {
    const [roles, overrides, menuRules] = await Promise.all([
      this.data.assignedRoles(orgId, userId),
      this.data.baseRoleOverrides(orgId, baseRole),
      this.data.menuRules(orgId, userId, baseRole),
    ]);
    const permissions = this.calculate(baseRole, roles, overrides);

    return Object.freeze({
      permissions,
      menuOverrides: Object.freeze({ ...menuRules }),
    });
  }

  async effectivePermissions(
    orgId: string,
    userId: string,
    baseRole: BaseRole,
  ): Promise<Readonly<PermissionSet>> {
    const [roles, overrides] = await Promise.all([
      this.data.assignedRoles(orgId, userId),
      this.data.baseRoleOverrides(orgId, baseRole),
    ]);
    return this.calculate(baseRole, roles, overrides);
  }

  private calculate(
    baseRole: BaseRole,
    customRoles: Parameters<
      typeof resolveEffectivePermissions
    >[0]["customRoles"],
    baseRoleOverrides: unknown,
  ): Readonly<PermissionSet> {
    return Object.freeze({
      ...resolveEffectivePermissions({
        baseRole,
        customRoles,
        baseRoleOverrides,
      }),
    });
  }
}
