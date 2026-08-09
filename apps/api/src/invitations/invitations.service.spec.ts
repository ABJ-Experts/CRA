import { createHash } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";

import { InvitationsService } from "./invitations.service";

type RpcResult = Readonly<{ data: unknown; error: { message: string } | null }>;

function serviceWithRpc(result: RpcResult) {
  const rpc = jest.fn<Promise<RpcResult>, []>().mockResolvedValue(result);
  const auditLog = jest.fn();
  const service = new InvitationsService(
    { admin: () => ({ rpc }) } as never,
    {} as never,
    {} as never,
    { log: auditLog } as never,
  );

  return { auditLog, rpc, service };
}

const acceptedRow = Object.freeze({
  outcome: "accepted",
  invitation_id: "invitation-1",
  organization_id: "organization-1",
  organization_name: "CRA",
  organization_slug: "cra",
});

describe("InvitationsService atomic transitions", () => {
  it("accepts through the atomic RPC and returns its organization", async () => {
    const { auditLog, rpc, service } = serviceWithRpc({
      data: [acceptedRow],
      error: null,
    });

    await expect(
      service.accept("raw-token", {
        id: "user-1",
        email: "  MEMBER@CRA.TEST  ",
      }),
    ).resolves.toEqual({
      ok: true,
      alreadyAccepted: false,
      organization: { id: "organization-1", name: "CRA", slug: "cra" },
    });
    expect(rpc).toHaveBeenCalledWith("accept_invitation_atomic", {
      p_token_hash: createHash("sha256").update("raw-token").digest("hex"),
      p_user_id: "user-1",
      p_email: "member@cra.test",
    });
    expect(auditLog).not.toHaveBeenCalled();
  });

  it("keeps repeated acceptance idempotent", async () => {
    const { service } = serviceWithRpc({
      data: [{ ...acceptedRow, outcome: "already_accepted" }],
      error: null,
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
      "not_found",
      NotFoundException,
      "invitation_not_found",
      "That invitation link is not valid.",
    ],
    [
      "expired",
      BadRequestException,
      "invitation_expired",
      "That invitation has expired.",
    ],
    [
      "email_mismatch",
      ForbiddenException,
      "invitation_email_mismatch",
      "That invitation was sent to a different email address.",
    ],
    [
      "not_pending",
      BadRequestException,
      "invitation_not_pending",
      "That invitation is no longer valid.",
    ],
    [
      "organization_not_found",
      NotFoundException,
      "organization_not_found",
      "That organization no longer exists.",
    ],
  ] as const)(
    "maps the %s acceptance outcome",
    async (outcome, ErrorType, code, message) => {
      const { service } = serviceWithRpc({
        data: [{ ...acceptedRow, outcome }],
        error: null,
      });

      const promise = service.accept("raw-token", {
        id: "user-1",
        email: "member@cra.test",
      });
      await expect(promise).rejects.toBeInstanceOf(ErrorType);
      await expect(promise).rejects.toMatchObject({
        response: { code, message },
      });
    },
  );

  it.each([
    { data: null, error: { message: "database offline" } },
    { data: [], error: null },
    {
      data: [{ ...acceptedRow, organization_id: null }],
      error: null,
    },
    { data: [acceptedRow, acceptedRow], error: null },
    { data: [{ ...acceptedRow, outcome: "future_outcome" }], error: null },
  ] as const)(
    "fails closed on invalid acceptance result %#",
    async (result) => {
      const { service } = serviceWithRpc(result);

      await expect(
        service.accept("raw-token", {
          id: "user-1",
          email: "member@cra.test",
        }),
      ).rejects.toMatchObject({
        response: {
          code: "membership_failed",
          message: "We could not add you to that organization.",
        },
      });
    },
  );

  it("revokes through the atomic RPC without duplicating audit", async () => {
    const { auditLog, rpc, service } = serviceWithRpc({
      data: "revoked",
      error: null,
    });

    await expect(
      service.revoke(
        "organization-1",
        { id: "owner-1", email: " OWNER@CRA.TEST " },
        "invitation-1",
      ),
    ).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("revoke_invitation_atomic", {
      p_organization_id: "organization-1",
      p_invitation_id: "invitation-1",
      p_actor_user_id: "owner-1",
      p_actor_email: "owner@cra.test",
    });
    expect(auditLog).not.toHaveBeenCalled();
  });

  it.each([
    ["not_found", NotFoundException, "invitation_not_found"],
    ["already_accepted", ConflictException, "invitation_already_accepted"],
    ["not_pending", BadRequestException, "invitation_not_pending"],
  ] as const)(
    "maps the %s revocation outcome",
    async (outcome, ErrorType, code) => {
      const { service } = serviceWithRpc({ data: outcome, error: null });

      const promise = service.revoke(
        "organization-1",
        { id: "owner-1", email: "owner@cra.test" },
        "invitation-1",
      );
      await expect(promise).rejects.toBeInstanceOf(ErrorType);
      await expect(promise).rejects.toMatchObject({ response: { code } });
    },
  );

  it.each([
    { data: null, error: { message: "database offline" } },
    { data: "wrong_organization", error: null },
    { data: "actor_not_found", error: null },
    { data: "actor_email_mismatch", error: null },
    { data: "future_outcome", error: null },
  ] as const)("fails closed on an invalid revoke result", async (result) => {
    const { service } = serviceWithRpc(result);

    await expect(
      service.revoke(
        "organization-1",
        { id: "owner-1", email: "owner@cra.test" },
        "invitation-1",
      ),
    ).rejects.toMatchObject({
      response: {
        code: "invitation_failed",
        message: "We could not revoke that invitation.",
      },
    });
  });
});
