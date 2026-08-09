import type { RequestUser } from "../auth/auth.types";

import { InvitationsController } from "./invitations.controller";

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
const invitationId = "22222222-2222-4222-8222-222222222222";

function fixture() {
  const accepted = { organizationId: "org-2", organizationName: "Example" };
  const invitations = {
    list: jest.fn().mockResolvedValue([{ id: "invitation-1" }]),
    create: jest.fn().mockResolvedValue({ id: "invitation-2" }),
    accept: jest.fn().mockResolvedValue(accepted),
    revoke: jest.fn().mockResolvedValue(undefined),
  };
  return {
    controller: new InvitationsController(invitations as never),
    invitations,
    accepted,
  };
}

describe("InvitationsController", () => {
  it("lists invitations only within the active organization", async () => {
    const { controller, invitations } = fixture();

    await expect(controller.list(user)).resolves.toEqual({
      rows: [{ id: "invitation-1" }],
    });
    expect(invitations.list).toHaveBeenCalledWith("org-1");
  });

  it("creates an invitation with the scoped actor", async () => {
    const { controller, invitations } = fixture();
    const input = {
      email: "new.member@cra.test",
      role: "member" as const,
      firstName: "New",
      lastName: "Member",
    };

    await expect(controller.create(input, user)).resolves.toEqual({
      id: "invitation-2",
    });
    expect(invitations.create).toHaveBeenCalledWith(
      "org-1",
      { id: "owner-1", email: "owner@cra.test" },
      input,
    );
  });

  it("accepts only as the signed-in identity", async () => {
    const { controller, invitations, accepted } = fixture();
    const token = "a".repeat(32);

    await expect(controller.accept({ token }, user)).resolves.toBe(accepted);
    expect(invitations.accept).toHaveBeenCalledWith(token, {
      id: "owner-1",
      email: "owner@cra.test",
    });
  });

  it("revokes an invitation within the active organization", async () => {
    const { controller, invitations } = fixture();

    await expect(
      controller.revoke({ id: invitationId }, user),
    ).resolves.toEqual({
      ok: true,
    });
    expect(invitations.revoke).toHaveBeenCalledWith(
      "org-1",
      { id: "owner-1", email: "owner@cra.test" },
      invitationId,
    );
  });

  it("rejects organization-scoped operations without an active organization", async () => {
    const { controller, invitations } = fixture();
    const unscoped = { ...user, organizationId: null };

    await expect(controller.list(unscoped)).rejects.toMatchObject({
      response: {
        message: "You are not a member of any organization.",
        code: "no_organization",
      },
    });
    expect(invitations.list).not.toHaveBeenCalled();
  });
});
