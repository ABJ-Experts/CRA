import { BasePermissionResolver } from "./base-permission-resolver";
import {
  permissionData,
  permissionResolverContract,
} from "./permission-resolver.contract.spec-helper";

permissionResolverContract("base", () => {
  const data = permissionData();
  return { data, resolver: new BasePermissionResolver(data) };
});

describe("BasePermissionResolver", () => {
  it("starts all independent reads before awaiting any one of them", async () => {
    const roleReads: Array<() => void> = [];
    const overrideReads: Array<() => void> = [];
    const menuReads: Array<() => void> = [];
    const assignedRoles = jest.fn(
      () =>
        new Promise<never[]>((resolve) => {
          roleReads.push(() => resolve([]));
        }),
    );
    const baseRoleOverrides = jest.fn(
      () =>
        new Promise<Record<string, never>>((resolve) => {
          overrideReads.push(() => resolve({}));
        }),
    );
    const menuRules = jest.fn(
      () =>
        new Promise<Record<string, boolean>>((resolve) => {
          menuReads.push(() => resolve({}));
        }),
    );
    const data = permissionData({
      assignedRoles,
      baseRoleOverrides,
      menuRules,
    });
    const resolver = new BasePermissionResolver(data);

    const resolution = resolver.resolve("org-a", "user-a", "member");

    expect(assignedRoles).toHaveBeenCalledWith("org-a", "user-a");
    expect(baseRoleOverrides).toHaveBeenCalledWith("org-a", "member");
    expect(menuRules).toHaveBeenCalledWith("org-a", "user-a", "member");
    [...roleReads, ...overrideReads, ...menuReads].forEach((release) =>
      release(),
    );
    await expect(resolution).resolves.toBeDefined();
  });

  it("does not cache successful reads", async () => {
    const assignedRoles = jest.fn().mockResolvedValue([]);
    const baseRoleOverrides = jest.fn().mockResolvedValue({});
    const menuRules = jest.fn().mockResolvedValue({});
    const data = permissionData({
      assignedRoles,
      baseRoleOverrides,
      menuRules,
    });
    const resolver = new BasePermissionResolver(data);

    await resolver.resolve("org-a", "user-a", "viewer");
    await resolver.resolve("org-a", "user-a", "viewer");

    expect(assignedRoles).toHaveBeenCalledTimes(2);
    expect(baseRoleOverrides).toHaveBeenCalledTimes(2);
    expect(menuRules).toHaveBeenCalledTimes(2);
  });

  it("propagates adapter errors unchanged", async () => {
    const failure = new Error("adapter failed");
    const data = permissionData({
      assignedRoles: jest.fn().mockRejectedValue(failure),
    });

    await expect(
      new BasePermissionResolver(data).resolve("org-a", "user-a", "viewer"),
    ).rejects.toBe(failure);
  });

  it("returns fresh top-level objects for each uncached resolution", async () => {
    const resolver = new BasePermissionResolver(permissionData());

    const first = await resolver.resolve("org-a", "user-a", "viewer");
    const second = await resolver.resolve("org-a", "user-a", "viewer");

    expect(second).not.toBe(first);
    expect(second.permissions).not.toBe(first.permissions);
    expect(second.menuOverrides).not.toBe(first.menuOverrides);
  });
});
