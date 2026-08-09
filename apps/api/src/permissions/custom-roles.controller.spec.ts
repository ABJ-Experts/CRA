import type { RequestUser } from "../auth/auth.types";

import { CustomRolesController } from "./custom-roles.controller";

const user: RequestUser = Object.freeze({
  id: "user-1",
  authUserId: "auth-user-1",
  email: "owner@cra.test",
  isActive: true,
  organizationId: "org-1",
  role: "owner",
  accessToken: "access-token",
  aal: "aal2",
});
const roleId = "33333333-3333-4333-8333-333333333333";

function fixture() {
  const roles = {
    list: jest.fn().mockResolvedValue([{ id: "role-1", name: "Support" }]),
    create: jest.fn().mockResolvedValue({ id: "role-2" }),
    update: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    overrides: jest
      .fn()
      .mockResolvedValue({ member: { can_view_users: true } }),
    setOverride: jest.fn().mockResolvedValue(undefined),
  };
  return { controller: new CustomRolesController(roles as never), roles };
}

describe("CustomRolesController", () => {
  it("lists roles within the caller's organization", async () => {
    const { controller, roles } = fixture();

    await expect(controller.list(user)).resolves.toEqual({
      rows: [{ id: "role-1", name: "Support" }],
    });
    expect(roles.list).toHaveBeenCalledWith("org-1");
  });

  it("creates a role with the scoped actor", async () => {
    const { controller, roles } = fixture();
    const input = {
      name: "Support",
      description: "Support operators",
      color: "#4A50D6",
      baseRole: "member" as const,
      permissions: { can_view_users: true },
    };

    await expect(controller.create(input, user)).resolves.toEqual({
      id: "role-2",
    });
    expect(roles.create).toHaveBeenCalledWith(
      "org-1",
      { id: "user-1", email: "owner@cra.test" },
      input,
    );
  });

  it("updates and removes only roles in the caller's organization", async () => {
    const { controller, roles } = fixture();
    const patch = { name: "Escalations", isActive: false };

    await expect(
      controller.update({ id: roleId }, patch, user),
    ).resolves.toEqual({
      ok: true,
    });
    await expect(controller.remove({ id: roleId }, user)).resolves.toEqual({
      ok: true,
    });
    expect(roles.update).toHaveBeenCalledWith(
      "org-1",
      { id: "user-1", email: "owner@cra.test" },
      roleId,
      patch,
    );
    expect(roles.remove).toHaveBeenCalledWith(
      "org-1",
      { id: "user-1", email: "owner@cra.test" },
      roleId,
    );
  });

  it("gets and sets scoped base-role overrides", async () => {
    const { controller, roles } = fixture();

    await expect(controller.overrides(user)).resolves.toEqual({
      overrides: { member: { can_view_users: true } },
    });
    await expect(
      controller.setOverride(
        {
          baseRole: "member",
          permissions: { can_view_users: false },
        },
        user,
      ),
    ).resolves.toEqual({ ok: true });
    expect(roles.overrides).toHaveBeenCalledWith("org-1");
    expect(roles.setOverride).toHaveBeenCalledWith(
      "org-1",
      { id: "user-1", email: "owner@cra.test" },
      "member",
      { can_view_users: false },
    );
  });

  it("rejects every operation when no organization is active", async () => {
    const { controller, roles } = fixture();
    const unscoped = { ...user, organizationId: null };

    await expect(controller.list(unscoped)).rejects.toMatchObject({
      response: {
        message: "You are not a member of any organization.",
        code: "no_organization",
      },
    });
    expect(roles.list).not.toHaveBeenCalled();
  });
});
