import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";

import { InvitationsService } from "./invitations.service";

const actor = Object.freeze({ id: "owner-1", email: "owner@cra.test" });
const input = Object.freeze({
  email: "  NEW.MEMBER@CRA.TEST ",
  role: "member" as const,
});

function fixture() {
  const create = {
    execute: jest.fn().mockResolvedValue({
      ok: true,
      value: { id: "invitation-1" },
    }),
  };
  const accept = { execute: jest.fn() };
  const resend = { execute: jest.fn() };
  const revoke = { execute: jest.fn() };
  const list = {
    execute: jest.fn().mockResolvedValue({ ok: true, value: [] }),
  };
  const auditLog = jest.fn();
  const service = new InvitationsService(
    create as never,
    resend as never,
    accept as never,
    revoke as never,
    list as never,
    { log: auditLog } as never,
  );

  return { accept, auditLog, create, list, revoke, service };
}

describe("InvitationsService create facade", () => {
  it("delegates and records the existing audit payload after notification", async () => {
    const { auditLog, create, service } = fixture();

    await expect(
      service.create("organization-1", actor, {
        ...input,
        firstName: "New",
        lastName: "Member",
      }),
    ).resolves.toEqual({ id: "invitation-1" });
    expect(create.execute).toHaveBeenCalledWith({
      orgId: "organization-1",
      actor,
      input: {
        ...input,
        firstName: "New",
        lastName: "Member",
      },
    });
    expect(auditLog).toHaveBeenCalledWith({
      organizationId: "organization-1",
      userId: "owner-1",
      actorEmail: "owner@cra.test",
      action: "invitation.created",
      entityType: "invitation",
      entityId: "invitation-1",
      changes: { email: "new.member@cra.test", role: "member" },
    });
    expect(create.execute.mock.invocationCallOrder[0]).toBeLessThan(
      auditLog.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it.each([
    [
      "cannot_invite_self",
      BadRequestException,
      {
        message: "You are already a member of this organization.",
        code: "cannot_invite_self",
      },
    ],
    [
      "already_member",
      BadRequestException,
      {
        message: "That person is already a member of this organization.",
        code: "already_member",
        fieldErrors: { email: "Already a member." },
      },
    ],
    [
      "invitation_pending",
      BadRequestException,
      {
        message: "An invitation has already been sent to that address.",
        code: "invitation_pending",
        fieldErrors: { email: "An invitation is already outstanding." },
      },
    ],
    [
      "organization_not_found",
      NotFoundException,
      {
        message: "That organization no longer exists.",
        code: "organization_not_found",
      },
    ],
    [
      "invitation_failed",
      BadRequestException,
      {
        message: "We could not create that invitation.",
        code: "invitation_failed",
      },
    ],
  ] as const)(
    "maps the %s semantic error",
    async (code, ErrorType, response) => {
      const { auditLog, create, service } = fixture();
      create.execute.mockResolvedValueOnce({ ok: false, error: { code } });

      const promise = service.create("organization-1", actor, input);
      await expect(promise).rejects.toBeInstanceOf(ErrorType);
      await expect(promise).rejects.toMatchObject({ response });
      expect(auditLog).not.toHaveBeenCalled();
    },
  );

  it("turns notification failure into a generic server error", async () => {
    const { auditLog, create, service } = fixture();
    create.execute.mockResolvedValueOnce({
      ok: false,
      error: { code: "notification_failed", invitationId: "invitation-1" },
    });

    const promise = service.create("organization-1", actor, input);
    await expect(promise).rejects.toBeInstanceOf(InternalServerErrorException);
    await expect(promise).rejects.toMatchObject({
      response: { statusCode: 500, message: "Internal server error" },
    });
    await expect(promise).rejects.not.toThrow("SMTP credentials rejected");
    expect(auditLog).not.toHaveBeenCalled();
  });

  it("does not expose onboarding evidence failures after email delivery", async () => {
    const { auditLog, create, service } = fixture();
    create.execute.mockResolvedValueOnce({
      ok: false,
      error: { code: "evidence_failed", invitationId: "invitation-1" },
    });

    const promise = service.create("organization-1", actor, input);
    await expect(promise).rejects.toBeInstanceOf(InternalServerErrorException);
    await expect(promise).rejects.toMatchObject({
      response: { statusCode: 500, message: "Internal server error" },
    });
    expect(auditLog).not.toHaveBeenCalled();
  });
});

describe("InvitationsService list facade", () => {
  it("returns the use-case rows without changing the wire shape", async () => {
    const { list, service } = fixture();
    const rows = [
      {
        id: "2ad67e3b-6e5e-4cde-870f-2225e7da1200",
        email: "member@cra.test",
        role: "member",
        status: "pending",
        expiresAt: "2026-08-16T00:00:00.000Z",
      },
    ];
    list.execute.mockResolvedValueOnce({ ok: true, value: rows });

    await expect(service.list("organization-1")).resolves.toEqual(rows);
    expect(list.execute).toHaveBeenCalledWith({ orgId: "organization-1" });
  });

  it("preserves the existing empty list fallback", async () => {
    const { list, service } = fixture();
    list.execute.mockResolvedValueOnce({
      ok: false,
      error: { code: "invitation_list_failed" },
    });

    await expect(service.list("organization-1")).resolves.toEqual([]);
  });
});
