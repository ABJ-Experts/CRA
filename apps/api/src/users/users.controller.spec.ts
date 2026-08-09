import type { RequestUser } from "../auth/auth.types";

import { UsersController } from "./users.controller";

const memberId = "11111111-1111-4111-8111-111111111111";
const user: RequestUser = Object.freeze({
  id: "owner-1",
  authUserId: "auth-owner-1",
  email: "owner@cra.test",
  isActive: true,
  organizationId: "org-1",
  role: "owner",
  accessToken: "access-token",
  aal: "aal2",
});

function fixture() {
  const page = {
    rows: [],
    total: 0,
    page: 2,
    pageSize: 25,
    pageCount: 2,
  };
  const users = {
    listMembers: jest.fn().mockResolvedValue(page),
    updateProfile: jest.fn().mockResolvedValue(undefined),
    changeRole: jest.fn().mockResolvedValue(undefined),
    setActive: jest.fn().mockResolvedValue(undefined),
    removeMember: jest.fn().mockResolvedValue(undefined),
  };
  return { controller: new UsersController(users as never), users, page };
}

describe("UsersController", () => {
  it("normalizes list query parameters and scopes the query", async () => {
    const { controller, users, page } = fixture();

    await expect(
      controller.list(user, "2", "25", "email", "desc", "  ada  "),
    ).resolves.toBe(page);
    expect(users.listMembers).toHaveBeenCalledWith("org-1", {
      page: 2,
      pageSize: 25,
      sort: "email",
      order: "desc",
      q: "ada",
    });
  });

  it("updates only the caller's own profile", async () => {
    const { controller, users } = fixture();
    const patch = { firstName: "Ada", language: "en" };

    await expect(controller.updateMe(patch, "owner-1")).resolves.toEqual({
      ok: true,
    });
    expect(users.updateProfile).toHaveBeenCalledWith("owner-1", patch);
  });

  it("changes role and active state for a validated member id", async () => {
    const { controller, users } = fixture();

    await expect(
      controller.changeRole(memberId, { role: "admin" }, user),
    ).resolves.toEqual({ ok: true });
    await expect(
      controller.setActive(memberId, { isActive: false }, user),
    ).resolves.toEqual({ ok: true });
    expect(users.changeRole).toHaveBeenCalledWith(
      "org-1",
      { id: "owner-1", email: "owner@cra.test" },
      memberId,
      "admin",
    );
    expect(users.setActive).toHaveBeenCalledWith(
      "org-1",
      { id: "owner-1", email: "owner@cra.test" },
      memberId,
      false,
    );
  });

  it("removes a validated member within the active organization", async () => {
    const { controller, users } = fixture();

    await expect(controller.remove(memberId, user)).resolves.toEqual({
      ok: true,
    });
    expect(users.removeMember).toHaveBeenCalledWith(
      "org-1",
      { id: "owner-1", email: "owner@cra.test" },
      memberId,
    );
  });

  it("rejects malformed member ids before calling the service", async () => {
    const { controller, users } = fixture();

    await expect(
      controller.changeRole("not-a-uuid", { role: "admin" }, user),
    ).rejects.toBeDefined();
    expect(users.changeRole).not.toHaveBeenCalled();
  });

  it("rejects organization-scoped operations without an active organization", async () => {
    const { controller, users } = fixture();
    const unscoped = { ...user, organizationId: null };

    await expect(controller.list(unscoped)).rejects.toMatchObject({
      response: {
        message: "You are not a member of any organization.",
        code: "no_organization",
      },
    });
    expect(users.listMembers).not.toHaveBeenCalled();
  });
});
