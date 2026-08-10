import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";

import { InvitationsService } from "./invitations.service";

const organization = Object.freeze({ id: "org-1", name: "CRA", slug: "cra" });

function fixture() {
  const create = { execute: jest.fn() };
  const accept = {
    execute: jest.fn().mockResolvedValue({
      ok: true,
      value: { ok: true, alreadyAccepted: false, organization },
    }),
  };
  const revoke = {
    execute: jest.fn().mockResolvedValue({ ok: true, value: undefined }),
  };
  const resend = {
    execute: jest.fn().mockResolvedValue({
      ok: true,
      value: { id: "invitation-1", delivery: "confirmed" },
    }),
  };
  const list = { execute: jest.fn() };
  const auditLog = jest.fn();
  const service = new InvitationsService(
    create as never,
    resend as never,
    accept as never,
    revoke as never,
    list as never,
    { log: auditLog } as never,
  );
  return { accept, auditLog, create, list, resend, revoke, service };
}

describe("InvitationsService acceptance facade", () => {
  it("delegates acceptance and returns the existing response", async () => {
    const { accept, auditLog, service } = fixture();

    await expect(
      service.accept("raw-token", {
        id: "user-1",
        email: "  MEMBER@CRA.TEST  ",
      }),
    ).resolves.toEqual({
      ok: true,
      alreadyAccepted: false,
      organization,
    });
    expect(accept.execute).toHaveBeenCalledWith({
      token: "raw-token",
      user: { id: "user-1", email: "  MEMBER@CRA.TEST  " },
    });
    expect(auditLog).not.toHaveBeenCalled();
  });

  it("preserves idempotent already-accepted success", async () => {
    const { accept, service } = fixture();
    accept.execute.mockResolvedValueOnce({
      ok: true,
      value: { ok: true, alreadyAccepted: true, organization },
    });

    await expect(
      service.accept("raw-token", {
        id: "user-1",
        email: "member@cra.test",
      }),
    ).resolves.toMatchObject({ ok: true, alreadyAccepted: true });
  });

  it.each([
    [
      "invitation_not_found",
      NotFoundException,
      "That invitation link is not valid.",
    ],
    ["invitation_expired", BadRequestException, "That invitation has expired."],
    [
      "invitation_email_mismatch",
      ForbiddenException,
      "That invitation was sent to a different email address.",
    ],
    [
      "invitation_not_pending",
      BadRequestException,
      "That invitation is no longer valid.",
    ],
    [
      "organization_not_found",
      NotFoundException,
      "That organization no longer exists.",
    ],
    [
      "membership_failed",
      BadRequestException,
      "We could not add you to that organization.",
    ],
  ] as const)("maps the %s error", async (code, ErrorType, message) => {
    const { accept, service } = fixture();
    accept.execute.mockResolvedValueOnce({ ok: false, error: { code } });

    const promise = service.accept("raw-token", {
      id: "user-1",
      email: "member@cra.test",
    });
    await expect(promise).rejects.toBeInstanceOf(ErrorType);
    await expect(promise).rejects.toMatchObject({
      response: { code, message },
    });
  });
});

describe("InvitationsService revocation facade", () => {
  it("delegates revocation without duplicating database audit", async () => {
    const { auditLog, revoke, service } = fixture();
    const actor = { id: "owner-1", email: " OWNER@CRA.TEST " };

    await expect(
      service.revoke("organization-1", actor, "invitation-1"),
    ).resolves.toBeUndefined();
    expect(revoke.execute).toHaveBeenCalledWith({
      orgId: "organization-1",
      actor,
      invitationId: "invitation-1",
    });
    expect(auditLog).not.toHaveBeenCalled();
  });

  it.each([
    [
      "invitation_not_found",
      NotFoundException,
      "That invitation no longer exists.",
    ],
    [
      "invitation_already_accepted",
      ConflictException,
      "That invitation has already been accepted.",
    ],
    [
      "invitation_not_pending",
      BadRequestException,
      "That invitation is no longer valid.",
    ],
    [
      "invitation_failed",
      BadRequestException,
      "We could not revoke that invitation.",
    ],
  ] as const)("maps the %s error", async (code, ErrorType, message) => {
    const { revoke, service } = fixture();
    revoke.execute.mockResolvedValueOnce({ ok: false, error: { code } });

    const promise = service.revoke(
      "organization-1",
      { id: "owner-1", email: "owner@cra.test" },
      "invitation-1",
    );
    await expect(promise).rejects.toBeInstanceOf(ErrorType);
    await expect(promise).rejects.toMatchObject({
      response: { code, message },
    });
  });
});

describe("InvitationsService resend facade", () => {
  it("returns a delivery-confirmed response only after the use case succeeds", async () => {
    const { resend, service } = fixture();
    const actor = { id: "owner-1", email: "owner@cra.test" };

    await expect(
      service.resend("organization-1", actor, "invitation-1"),
    ).resolves.toEqual({ id: "invitation-1", delivery: "confirmed" });
    expect(resend.execute).toHaveBeenCalledWith({
      orgId: "organization-1",
      actor,
      invitationId: "invitation-1",
    });
  });

  it.each([
    [
      "invitation_not_found",
      NotFoundException,
      "That invitation no longer exists.",
    ],
    ["invitation_expired", BadRequestException, "That invitation has expired."],
    [
      "invitation_already_accepted",
      ConflictException,
      "That invitation has already been accepted.",
    ],
    [
      "invitation_not_pending",
      BadRequestException,
      "That invitation is no longer valid.",
    ],
    [
      "invitation_already_member",
      BadRequestException,
      "That person is already a member of this organization.",
    ],
    [
      "invitation_failed",
      BadRequestException,
      "We could not resend that invitation.",
    ],
  ] as const)(
    "maps the %s semantic resend error",
    async (code, ErrorType, message) => {
      const { resend, service } = fixture();
      resend.execute.mockResolvedValueOnce({ ok: false, error: { code } });

      const promise = service.resend(
        "organization-1",
        { id: "owner-1", email: "owner@cra.test" },
        "invitation-1",
      );
      await expect(promise).rejects.toBeInstanceOf(ErrorType);
      await expect(promise).rejects.toMatchObject({
        response: { code, message },
      });
    },
  );

  it.each(["notification_failed", "evidence_failed"] as const)(
    "does not expose the persisted delivery state for %s",
    async (code) => {
      const { resend, service } = fixture();
      resend.execute.mockResolvedValueOnce({
        ok: false,
        error: { code, invitationId: "invitation-1", delivery: "persisted" },
      });

      const promise = service.resend(
        "organization-1",
        { id: "owner-1", email: "owner@cra.test" },
        "invitation-1",
      );
      await expect(promise).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
      await expect(promise).rejects.toMatchObject({
        response: { statusCode: 500, message: "Internal server error" },
      });
      await expect(promise).rejects.not.toThrow("SMTP credentials rejected");
    },
  );
});
