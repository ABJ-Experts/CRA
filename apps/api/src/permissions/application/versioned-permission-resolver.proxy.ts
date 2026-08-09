import type { BaseRole, PermissionSet } from "@repo/contracts/permissions";

import type {
  EffectivePermissionResolver,
  PermissionDataPort,
  PermissionResolution,
  PermissionResolver,
} from "./permission-data.port";
import { PermissionDataUnavailableError } from "./permission-data.port";

interface CacheEntry {
  readonly version: number;
  readonly permissions: Readonly<PermissionSet>;
  readonly value?: PermissionResolution;
}

export class VersionedPermissionResolver
  implements PermissionResolver, EffectivePermissionResolver
{
  private readonly cache = new Map<string, Readonly<CacheEntry>>();

  constructor(
    private readonly data: PermissionDataPort,
    private readonly target: PermissionResolver,
  ) {}

  async resolve(
    orgId: string,
    userId: string,
    baseRole: BaseRole,
  ): Promise<PermissionResolution> {
    const version = await this.validVersion(orgId);
    const key = this.key(orgId, userId);
    const cached = this.cache.get(key);
    if (cached?.version === version && cached.value) return cached.value;

    const value = this.snapshot(
      await this.target.resolve(orgId, userId, baseRole),
    );
    this.cache.set(
      key,
      Object.freeze({ version, permissions: value.permissions, value }),
    );
    return value;
  }

  async effectivePermissions(
    orgId: string,
    userId: string,
    baseRole: BaseRole,
  ): Promise<Readonly<PermissionSet>> {
    const version = await this.validVersion(orgId);
    const key = this.key(orgId, userId);
    const cached = this.cache.get(key);
    if (cached?.version === version) return cached.permissions;

    const permissionTarget = this.target as PermissionResolver &
      Partial<EffectivePermissionResolver>;
    const resolved = permissionTarget.effectivePermissions
      ? await permissionTarget.effectivePermissions(orgId, userId, baseRole)
      : (await permissionTarget.resolve(orgId, userId, baseRole)).permissions;
    const permissions = Object.freeze({ ...resolved });
    this.cache.set(key, Object.freeze({ version, permissions }));
    return permissions;
  }

  private async validVersion(orgId: string): Promise<number> {
    const version = await this.data.version(orgId);
    if (!Number.isSafeInteger(version) || version <= 0) {
      throw new PermissionDataUnavailableError("permission version");
    }
    return version;
  }

  private key(orgId: string, userId: string): string {
    return `${orgId}:${userId}`;
  }

  private snapshot(value: PermissionResolution): PermissionResolution {
    return Object.freeze({
      permissions: Object.freeze({ ...value.permissions }),
      menuOverrides: Object.freeze({ ...value.menuOverrides }),
    });
  }
}
