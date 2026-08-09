import type { PermissionResolution } from "./permission-data.port";
import { PermissionDataUnavailableError } from "./permission-data.port";
import {
  permissionData,
  permissionResolverContract,
} from "./permission-resolver.contract.spec-helper";
import { BasePermissionResolver } from "./base-permission-resolver";
import { VersionedPermissionResolver } from "./versioned-permission-resolver.proxy";

permissionResolverContract("versioned", () => {
  const data = permissionData();
  return {
    data,
    resolver: new VersionedPermissionResolver(
      data,
      new BasePermissionResolver(data),
    ),
  };
});

function mutableResolution(allowed: boolean): PermissionResolution {
  return {
    permissions: { can_view_users: allowed },
    menuOverrides: { management: allowed },
  };
}

describe("VersionedPermissionResolver", () => {
  it("serves a cached immutable snapshot while the version is unchanged", async () => {
    const version = jest.fn().mockResolvedValue(7);
    const data = permissionData({ version });
    const target = {
      resolve: jest.fn().mockResolvedValue(mutableResolution(true)),
    };
    const resolver = new VersionedPermissionResolver(data, target);

    const first = await resolver.resolve("org-a", "user-a", "viewer");
    const second = await resolver.resolve("org-a", "user-a", "viewer");

    expect(first).toBe(second);
    expect(target.resolve).toHaveBeenCalledTimes(1);
    expect(version).toHaveBeenCalledTimes(2);
  });

  it("recomputes when the organization version changes", async () => {
    const data = permissionData({
      version: jest.fn().mockResolvedValueOnce(7).mockResolvedValueOnce(8),
    });
    const target = {
      resolve: jest
        .fn()
        .mockResolvedValueOnce(mutableResolution(false))
        .mockResolvedValueOnce(mutableResolution(true)),
    };
    const resolver = new VersionedPermissionResolver(data, target);

    await expect(
      resolver.resolve("org-a", "user-a", "viewer"),
    ).resolves.toMatchObject({ permissions: { can_view_users: false } });
    await expect(
      resolver.resolve("org-a", "user-a", "viewer"),
    ).resolves.toMatchObject({ permissions: { can_view_users: true } });
    expect(target.resolve).toHaveBeenCalledTimes(2);
  });

  it("never serves a cached value when the version read fails", async () => {
    const failure = new Error("version unavailable");
    const data = permissionData({
      version: jest
        .fn()
        .mockResolvedValueOnce(7)
        .mockRejectedValueOnce(failure),
    });
    const target = {
      resolve: jest.fn().mockResolvedValue(mutableResolution(true)),
    };
    const resolver = new VersionedPermissionResolver(data, target);

    await resolver.resolve("org-a", "user-a", "viewer");
    await expect(resolver.resolve("org-a", "user-a", "viewer")).rejects.toBe(
      failure,
    );
    expect(target.resolve).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed target resolution", async () => {
    const failure = new Error("resolution unavailable");
    const data = permissionData();
    const target = {
      resolve: jest
        .fn()
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce(mutableResolution(true)),
    };
    const resolver = new VersionedPermissionResolver(data, target);

    await expect(resolver.resolve("org-a", "user-a", "viewer")).rejects.toBe(
      failure,
    );
    await expect(
      resolver.resolve("org-a", "user-a", "viewer"),
    ).resolves.toMatchObject({ permissions: { can_view_users: true } });
    expect(target.resolve).toHaveBeenCalledTimes(2);
  });

  it("does not share cache entries across organizations or users", async () => {
    const data = permissionData();
    const target = {
      resolve: jest.fn().mockResolvedValue(mutableResolution(true)),
    };
    const resolver = new VersionedPermissionResolver(data, target);

    await resolver.resolve("org-a", "user-a", "viewer");
    await resolver.resolve("org-a", "user-b", "viewer");
    await resolver.resolve("org-b", "user-a", "viewer");
    await resolver.resolve("org-a", "user-a", "viewer");

    expect(target.resolve).toHaveBeenCalledTimes(3);
    expect(target.resolve).toHaveBeenNthCalledWith(
      1,
      "org-a",
      "user-a",
      "viewer",
    );
    expect(target.resolve).toHaveBeenNthCalledWith(
      2,
      "org-a",
      "user-b",
      "viewer",
    );
    expect(target.resolve).toHaveBeenNthCalledWith(
      3,
      "org-b",
      "user-a",
      "viewer",
    );
  });

  it("copies and freezes mutable target results before caching them", async () => {
    const data = permissionData();
    const source = mutableResolution(true);
    const target = { resolve: jest.fn().mockResolvedValue(source) };
    const resolver = new VersionedPermissionResolver(data, target);

    const first = await resolver.resolve("org-a", "user-a", "viewer");
    (source.permissions as Record<string, boolean>).can_view_users = false;
    (source.menuOverrides as Record<string, boolean>).management = false;

    expect(first.permissions.can_view_users).toBe(true);
    expect(first.menuOverrides.management).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.permissions)).toBe(true);
    expect(Object.isFrozen(first.menuOverrides)).toBe(true);
  });

  it("rejects version zero instead of caching an unverifiable result", async () => {
    const data = permissionData({ version: jest.fn().mockResolvedValue(0) });
    const target = {
      resolve: jest.fn().mockResolvedValue(mutableResolution(true)),
    };

    await expect(
      new VersionedPermissionResolver(data, target).resolve(
        "org-a",
        "user-a",
        "viewer",
      ),
    ).rejects.toBeInstanceOf(PermissionDataUnavailableError);
    expect(target.resolve).not.toHaveBeenCalled();
  });
});
