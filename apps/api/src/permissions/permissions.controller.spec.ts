import { PERMISSION_KEYS } from "@repo/contracts/permissions";

import { PermissionsController } from "./permissions.controller";

function fixture() {
  const effectivePermissions = jest.fn().mockResolvedValue({
    can_view_users: true,
    can_edit_users: false,
  });
  const menu = jest.fn().mockResolvedValue(["dashboard", "users"]);
  const controller = new PermissionsController({
    effectivePermissions,
    menu,
  } as never);
  return { controller, effectivePermissions, menu };
}

describe("PermissionsController", () => {
  it.each([
    [null, "member"],
    ["org-1", null],
  ] as const)(
    "returns an empty effective set when membership is incomplete",
    async (orgId, role) => {
      const { controller, effectivePermissions } = fixture();

      await expect(
        controller.effective(orgId, "user-1", role),
      ).resolves.toEqual({
        organizationId: null,
        role: null,
        permissions: {},
      });
      expect(effectivePermissions).not.toHaveBeenCalled();
    },
  );

  it("returns the caller's effective permissions", async () => {
    const { controller, effectivePermissions } = fixture();

    await expect(
      controller.effective("org-1", "user-1", "admin"),
    ).resolves.toEqual({
      organizationId: "org-1",
      role: "admin",
      permissions: { can_view_users: true, can_edit_users: false },
    });
    expect(effectivePermissions).toHaveBeenCalledWith(
      "org-1",
      "user-1",
      "admin",
    );
  });

  it("returns no menu when the caller has no complete membership", async () => {
    const { controller, menu } = fixture();

    await expect(controller.menu(null, "user-1", "viewer")).resolves.toEqual({
      menu: [],
    });
    await expect(controller.menu("org-1", "user-1", null)).resolves.toEqual({
      menu: [],
    });
    expect(menu).not.toHaveBeenCalled();
  });

  it("returns menu visibility for the active organization", async () => {
    const { controller, menu } = fixture();

    await expect(controller.menu("org-1", "user-1", "member")).resolves.toEqual(
      { menu: ["dashboard", "users"] },
    );
    expect(menu).toHaveBeenCalledWith("org-1", "user-1", "member");
  });

  it.each([
    [null, "member"],
    ["org-1", null],
  ] as const)(
    "rejects a permission check without complete membership",
    async (orgId, role) => {
      const { controller, effectivePermissions } = fixture();

      await expect(
        controller.check(
          { permissions: ["can_view_users"] },
          orgId,
          "user-1",
          role,
        ),
      ).rejects.toMatchObject({
        response: {
          message: "You are not a member of any organization.",
          code: "no_organization",
        },
      });
      expect(effectivePermissions).not.toHaveBeenCalled();
    },
  );

  it("checks known keys and denies unknown or ungranted keys", async () => {
    const { controller, effectivePermissions } = fixture();

    await expect(
      controller.check(
        {
          permissions: [
            "can_view_users",
            "can_edit_users",
            "removed_permission",
          ],
        },
        "org-1",
        "user-1",
        "member",
      ),
    ).resolves.toEqual({
      results: {
        can_view_users: true,
        can_edit_users: false,
        removed_permission: false,
      },
    });
    expect(effectivePermissions).toHaveBeenCalledWith(
      "org-1",
      "user-1",
      "member",
    );
  });

  it("returns the canonical permission catalogue", () => {
    const { controller } = fixture();

    expect(controller.catalogue()).toEqual({ permissions: PERMISSION_KEYS });
  });
});
