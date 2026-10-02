import { PermissionDataUnavailableError } from "./application/permission-data.port";
import {
  isPermissionResolverDependency,
  PermissionsService,
} from "./permissions.service";

function fixture() {
  const resolution = {
    permissions: {
      can_view_users: true,
      can_edit_users: false,
      can_view_orders: true,
    },
    menuOverrides: { organization: false } as const,
  };
  const resolver = {
    resolve: jest.fn().mockResolvedValue(resolution),
    effectivePermissions: jest.fn().mockResolvedValue(resolution.permissions),
  };
  return {
    service: new PermissionsService(resolver),
    resolver,
    resolution,
  };
}

describe("PermissionsService facade", () => {
  it("recognizes only the complete resolver contract", () => {
    expect(
      isPermissionResolverDependency({
        resolve: jest.fn(),
        effectivePermissions: jest.fn(),
      }),
    ).toBe(true);
    expect(
      isPermissionResolverDependency({ resolve: jest.fn() } as never),
    ).toBe(false);
    expect(
      isPermissionResolverDependency({
        effectivePermissions: jest.fn(),
      } as never),
    ).toBe(false);
  });

  it("copies the resolver output at the compatibility boundary", async () => {
    const { service, resolver, resolution } = fixture();

    const result = await service.resolve("org-1", "user-1", "member");

    expect(result).toEqual(resolution);
    expect(result).not.toBe(resolution);
    expect(result.permissions).not.toBe(resolution.permissions);
    expect(result.menuOverrides).not.toBe(resolution.menuOverrides);
    expect(resolver.resolve).toHaveBeenCalledWith("org-1", "user-1", "member");
  });

  it("copies effective permissions and answers batch checks", async () => {
    const { service, resolver, resolution } = fixture();

    const permissions = await service.effectivePermissions(
      "org-1",
      "user-1",
      "member",
    );
    await expect(
      service.can("org-1", "user-1", "member", ["can_view_users"]),
    ).resolves.toBe(true);
    await expect(
      service.can("org-1", "user-1", "member", [
        "can_view_users",
        "can_edit_users",
      ]),
    ).resolves.toBe(false);

    expect(permissions).toEqual(resolution.permissions);
    expect(permissions).not.toBe(resolution.permissions);
    expect(resolver.effectivePermissions).toHaveBeenCalledWith(
      "org-1",
      "user-1",
      "member",
    );
  });

  it("derives visible menu keys from permissions and explicit overrides", async () => {
    const { service } = fixture();

    const menu = await service.menu("org-1", "user-1", "member");

    expect(menu).toContain("management");
    expect(menu).not.toContain("organization");
    expect(menu).not.toContain("authorization.roles");
  });

  it.each([
    ["management", true],
    ["authorization.roles", false],
    ["organization", false],
  ] as const)("checks menu key %s", async (key, visible) => {
    const { service } = fixture();

    await expect(
      service.canViewMenuKey("org-1", "user-1", "member", key),
    ).resolves.toBe(visible);
  });

  it("maps unavailable permission data to the stable 503 response", async () => {
    const resolver = {
      resolve: jest
        .fn()
        .mockRejectedValue(new PermissionDataUnavailableError("version")),
      effectivePermissions: jest.fn(),
    };
    const service = new PermissionsService(resolver);

    await expect(
      service.resolve("org-1", "user-1", "member"),
    ).rejects.toMatchObject({
      response: {
        message: "Permissions are temporarily unavailable. Please try again.",
        code: "permissions_unavailable",
      },
    });
  });

  it("does not disguise programming failures as availability errors", async () => {
    const failure = new Error("programming defect");
    const resolver = {
      resolve: jest.fn().mockRejectedValue(failure),
      effectivePermissions: jest.fn(),
    };
    const service = new PermissionsService(resolver);

    await expect(service.resolve("org-1", "user-1", "member")).rejects.toBe(
      failure,
    );
  });
});
