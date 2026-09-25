import type { InvitationActor } from "./invitation-repository.port";
import { ResendInvitationUseCase } from "./resend-invitation.use-case";

const actor = Object.freeze({ id: "owner-1", email: " OWNER@CRA.TEST " });
const invitationId = "2ad67e3b-6e5e-4cde-870f-2225e7da1200";

type ResendOutcome =
  | Readonly<{
      outcome: "resent";
      invitationId: string;
      email: string;
      organizationName: string;
    }>
  | Readonly<{
      outcome:
        | "not_found"
        | "expired"
        | "accepted"
        | "not_pending"
        | "already_member"
        | "actor_not_found"
        | "actor_email_mismatch";
    }>;

class ResendRepositoryFake {
  outcome: ResendOutcome = Object.freeze({
    outcome: "resent",
    invitationId,
    email: "member@cra.test",
    organizationName: "CRA",
  });
  failure: Error | null = null;
  readonly calls: Array<
    Readonly<{
      orgId: string;
      invitationId: string;
      actor: InvitationActor;
      tokenHash: string;
      expiresAt: string;
    }>
  > = [];

  resendAtomic(
    orgId: string,
    invitationIdValue: string,
    actorValue: InvitationActor,
    tokenHash: string,
    expiresAt: string,
  ): Promise<ResendOutcome> {
    if (this.failure) return Promise.reject(this.failure);
    this.calls.push(
      Object.freeze({
        orgId,
        invitationId: invitationIdValue,
        actor: Object.freeze({ ...actorValue }),
        tokenHash,
        expiresAt,
      }),
    );
    return Promise.resolve(this.outcome);
  }
}

class RecordingNotifier {
  readonly sent: Array<
    Readonly<{
      email: string;
      rawToken: string;
      organizationName: string;
      inviterName: string | null;
    }>
  > = [];
  failure: Error | null = null;

  send(
    email: string,
    rawToken: string,
    organizationName: string,
    inviterName: string | null,
  ): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    this.sent.push(
      Object.freeze({ email, rawToken, organizationName, inviterName }),
    );
    return Promise.resolve();
  }
}

class RecordingEvidence {
  readonly calls: Array<
    Readonly<{
      organizationId: string;
      invitationId: string;
      actorId: string;
    }>
  > = [];
  failure: Error | null = null;

  recordInvitationDelivery(
    organizationId: string,
    invitationId: string,
    actorId: string,
  ): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    this.calls.push(Object.freeze({ organizationId, invitationId, actorId }));
    return Promise.resolve();
  }
}

function fixture() {
  const repository = new ResendRepositoryFake();
  const notifier = new RecordingNotifier();
  const evidence = new RecordingEvidence();
  const tokens = {
    create: jest
      .fn()
      .mockReturnValue({ raw: "fresh-raw-token", hash: "fresh-hashed-token" }),
    hash: jest.fn((rawToken: string) => `hashed:${rawToken}`),
  };
  const clock = {
    now: jest.fn(() => new Date("2026-08-09T00:00:00.000Z")),
  };
  const useCase = new ResendInvitationUseCase(
    repository as never,
    tokens,
    notifier,
    evidence as never,
    clock,
    7,
  );
  return { clock, evidence, notifier, repository, tokens, useCase };
}

describe("ResendInvitationUseCase", () => {
  it("rotates only the hash and expiry, then confirms delivery and evidence", async () => {
    const { evidence, notifier, repository, useCase } = fixture();

    await expect(
      useCase.execute({ orgId: "org-1", actor, invitationId }),
    ).resolves.toEqual({
      ok: true,
      value: { id: invitationId, delivery: "confirmed" },
    });
    expect(repository.calls).toEqual([
      {
        orgId: "org-1",
        invitationId,
        actor: { id: "owner-1", email: "owner@cra.test" },
        tokenHash: "fresh-hashed-token",
        expiresAt: "2026-08-16T00:00:00.000Z",
      },
    ]);
    expect(JSON.stringify(repository.calls)).not.toContain("fresh-raw-token");
    expect(notifier.sent).toEqual([
      {
        email: "member@cra.test",
        rawToken: "fresh-raw-token",
        organizationName: "CRA",
        inviterName: "owner@cra.test",
      },
    ]);
    expect(evidence.calls).toEqual([
      {
        organizationId: "org-1",
        invitationId,
        actorId: "owner-1",
      },
    ]);
  });

  it("writes evidence only after successful delivery", async () => {
    const { evidence, notifier, useCase } = fixture();
    const order: string[] = [];
    notifier.send = jest.fn(() => {
      order.push("mail");
      return Promise.resolve();
    });
    evidence.recordInvitationDelivery = jest.fn(() => {
      order.push("evidence");
      return Promise.resolve();
    });

    await useCase.execute({ orgId: "org-1", actor, invitationId });

    expect(order).toEqual(["mail", "evidence"]);
  });

  it("preserves the row as persisted-but-undelivered when SMTP fails", async () => {
    const { evidence, notifier, repository, useCase } = fixture();
    notifier.failure = new Error("SMTP credentials rejected");

    await expect(
      useCase.execute({ orgId: "org-1", actor, invitationId }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "notification_failed",
        invitationId,
        delivery: "persisted",
      },
    });
    expect(repository.calls).toHaveLength(1);
    expect(evidence.calls).toEqual([]);
  });

  it("does not claim delivery confirmation when onboarding evidence fails", async () => {
    const { evidence, notifier, useCase } = fixture();
    evidence.failure = new Error("onboarding unavailable");

    await expect(
      useCase.execute({ orgId: "org-1", actor, invitationId }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "evidence_failed", invitationId },
    });
    expect(notifier.sent).toHaveLength(1);
  });

  it.each([
    ["not_found", "invitation_not_found"],
    ["expired", "invitation_expired"],
    ["accepted", "invitation_already_accepted"],
    ["not_pending", "invitation_not_pending"],
    ["already_member", "invitation_already_member"],
    ["actor_not_found", "invitation_failed"],
    ["actor_email_mismatch", "invitation_failed"],
  ] as const)("maps the atomic %s resend outcome", async (outcome, code) => {
    const { notifier, repository, useCase } = fixture();
    repository.outcome = Object.freeze({ outcome });

    await expect(
      useCase.execute({ orgId: "org-1", actor, invitationId }),
    ).resolves.toEqual({ ok: false, error: { code } });
    expect(notifier.sent).toEqual([]);
  });

  it("fails closed if token storage cannot keep raw and hashed tokens apart", async () => {
    const { notifier, repository, tokens, useCase } = fixture();
    tokens.create.mockReturnValueOnce({
      raw: "same-token",
      hash: "same-token",
    });

    await expect(
      useCase.execute({ orgId: "org-1", actor, invitationId }),
    ).resolves.toEqual({ ok: false, error: { code: "invitation_failed" } });
    expect(repository.calls).toEqual([]);
    expect(notifier.sent).toEqual([]);
  });

  it("uses atomic rotation independently for concurrent resend attempts", async () => {
    const { evidence, repository, tokens, useCase } = fixture();
    tokens.create
      .mockReturnValueOnce({ raw: "raw-token-one", hash: "hash-token-one" })
      .mockReturnValueOnce({ raw: "raw-token-two", hash: "hash-token-two" });

    await expect(
      Promise.all([
        useCase.execute({ orgId: "org-1", actor, invitationId }),
        useCase.execute({ orgId: "org-1", actor, invitationId }),
      ]),
    ).resolves.toEqual([
      { ok: true, value: { id: invitationId, delivery: "confirmed" } },
      { ok: true, value: { id: invitationId, delivery: "confirmed" } },
    ]);
    expect(repository.calls.map((call) => call.tokenHash)).toEqual([
      "hash-token-one",
      "hash-token-two",
    ]);
    expect(evidence.calls).toHaveLength(2);
  });

  it("fails closed when the atomic storage operation is unavailable", async () => {
    const { notifier, repository, useCase } = fixture();
    repository.failure = new Error("database offline");

    await expect(
      useCase.execute({ orgId: "org-1", actor, invitationId }),
    ).resolves.toEqual({ ok: false, error: { code: "invitation_failed" } });
    expect(notifier.sent).toEqual([]);
  });
});
