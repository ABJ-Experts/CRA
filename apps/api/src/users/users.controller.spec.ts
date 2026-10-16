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
      controller.list(user, {
        page: 2,
        pageSize: 25,
        sort: "email",
        order: "desc",
        q: "ada",
      }),
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

    await expect(controller.updateMe(patch, user)).resolves.toEqual({
      ok: true,
    });
    expect(users.updateProfile).toHaveBeenCalledWith(
      "owner-1",
      patch,
      "org-1",
      expect.objectContaining({
        eventKey: expect.any(String) as string,
        correlationId: expect.any(String) as string,
      }),
    );
  });

  it("changes role and active state for a validated member id", async () => {
    const { controller, users } = fixture();

    await expect(
      controller.changeRole({ id: memberId }, { role: "admin" }, user),
    ).resolves.toEqual({ ok: true });
    await expect(
      controller.setActive({ id: memberId }, { isActive: false }, user),
    ).resolves.toEqual({ ok: true });
    expect(users.changeRole).toHaveBeenCalledWith(
      "org-1",
      { id: "owner-1", email: "owner@cra.test" },
      memberId,
      "admin",
      expect.objectContaining({
        eventKey: expect.any(String) as string,
        correlationId: expect.any(String) as string,
      }),
    );
    expect(users.setActive).toHaveBeenCalledWith(
      "org-1",
      { id: "owner-1", email: "owner@cra.test" },
      memberId,
      false,
      expect.objectContaining({
        eventKey: expect.any(String) as string,
        correlationId: expect.any(String) as string,
      }),
    );
  });

  it("removes a validated member within the active organization", async () => {
    const { controller, users } = fixture();

    await expect(controller.remove({ id: memberId }, user)).resolves.toEqual({
      ok: true,
    });
    expect(users.removeMember).toHaveBeenCalledWith(
      "org-1",
      { id: "owner-1", email: "owner@cra.test" },
      memberId,
      expect.objectContaining({
        eventKey: expect.any(String) as string,
        correlationId: expect.any(String) as string,
      }),
    );
  });

  it("validates request identity headers and records the trusted request address", async () => {
    const { controller, users } = fixture();
    const eventKey = "11111111-1111-4111-8111-111111111111";
    const correlationId = "22222222-2222-4222-8222-222222222222";
    await expect(
      controller.changeRole(
        { id: memberId },
        { role: "admin" },
        user,
        "invalid",
        correlationId,
      ),
    ).rejects.toMatchObject({ response: { code: "invalid_audit_identity" } });
    await expect(
      controller.changeRole(
        { id: memberId },
        { role: "admin" },
        user,
        eventKey,
        "invalid",
      ),
    ).rejects.toMatchObject({ response: { code: "invalid_audit_identity" } });
    expect(users.changeRole).not.toHaveBeenCalled();
    await controller.changeRole(
      { id: memberId },
      { role: "admin" },
      user,
      eventKey,
      correlationId,
      { ip: "127.0.0.1" } as never,
    );
    expect(users.changeRole).toHaveBeenCalledWith(
      "org-1",
      { id: "owner-1", email: "owner@cra.test" },
      memberId,
      "admin",
      { eventKey, correlationId, sourceIp: "127.0.0.1" },
    );
  });

  it("rejects organization-scoped operations without an active organization", async () => {
    const { controller, users } = fixture();
    const unscoped = { ...user, organizationId: null };

    await expect(
      controller.list(unscoped, {
        page: 1,
        pageSize: 15,
        order: "asc",
      }),
    ).rejects.toMatchObject({
      response: {
        message: "You are not a member of any organization.",
        code: "no_organization",
      },
    });
    expect(users.listMembers).not.toHaveBeenCalled();
  });
});
