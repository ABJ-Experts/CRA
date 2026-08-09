import type {
  Invitation,
  OrganizationSummary,
} from "@repo/contracts/invitations";

import type {
  AcceptInvitationAtomicOutcome,
  InsertInvitationInput,
  InvitationRepository,
  RevokeInvitationAtomicOutcome,
} from "./invitation-repository.port";
import type { InvitationNotifierPort } from "./invitation-notifier.port";
import { CreateInvitationUseCase } from "./create-invitation.use-case";

class CreateRepositoryFake implements InvitationRepository {
  existingUser: { id: string } | null = null;
  member = false;
  pending = false;
  organizationValue: OrganizationSummary | null = {
    id: "org-1",
    name: "CRA",
    slug: "cra",
  };
  readonly calls: string[] = [];
  lastInsert: Readonly<{
    orgId: string;
    input: InsertInvitationInput;
  }> | null = null;
  failOn: string | null = null;

  findExistingUser(email: string): Promise<{ id: string } | null> {
    this.calls.push(`find:${email}`);
    this.failIf("findExistingUser");
    return Promise.resolve(this.existingUser);
  }

  isMember(orgId: string, userId: string): Promise<boolean> {
    this.calls.push(`member:${orgId}:${userId}`);
    this.failIf("isMember");
    return Promise.resolve(this.member);
  }

  hasPending(orgId: string, email: string): Promise<boolean> {
    this.calls.push(`pending:${orgId}:${email}`);
    this.failIf("hasPending");
    return Promise.resolve(this.pending);
  }

  insert(orgId: string, input: InsertInvitationInput): Promise<{ id: string }> {
    this.calls.push(`insert:${orgId}`);
    this.failIf("insert");
    this.lastInsert = Object.freeze({
      orgId,
      input: Object.freeze({ ...input }),
    });
    return Promise.resolve({ id: "invitation-1" });
  }

  organization(orgId: string): Promise<OrganizationSummary | null> {
    this.calls.push(`organization:${orgId}`);
    this.failIf("organization");
    return Promise.resolve(this.organizationValue);
  }

  acceptAtomic(): Promise<AcceptInvitationAtomicOutcome> {
    return Promise.reject(new Error("not used"));
  }

  revokeAtomic(): Promise<RevokeInvitationAtomicOutcome> {
    return Promise.reject(new Error("not used"));
  }

  list(): Promise<readonly Invitation[]> {
    return Promise.reject(new Error("not used"));
  }

  private failIf(operation: string): void {
    if (this.failOn === operation) throw new Error("database unavailable");
  }
}

class RecordingNotifier implements InvitationNotifierPort {
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

const actor = Object.freeze({ id: "owner-1", email: "owner@cra.test" });
const baseInput = Object.freeze({
  email: "member@cra.test",
  role: "member" as const,
});

function fixture(overrides: { ttlDays?: number } = {}) {
  const repository = new CreateRepositoryFake();
  const notifier = new RecordingNotifier();
  const tokens = {
    create: jest
      .fn()
      .mockReturnValue({ raw: "raw-token", hash: "hashed-token" }),
    hash: jest.fn((rawToken: string) => `hashed:${rawToken}`),
  };
  const clock = {
    now: jest.fn(() => new Date("2026-08-09T00:00:00.000Z")),
  };
  const useCase = new CreateInvitationUseCase(
    repository,
    tokens,
    notifier,
    clock,
    overrides.ttlDays ?? 7,
  );
  return { clock, notifier, repository, tokens, useCase };
}

describe("CreateInvitationUseCase", () => {
  it("rejects a normalized self-invitation before using any port", async () => {
    const { repository, tokens, useCase } = fixture();

    await expect(
      useCase.execute({
        orgId: "org-1",
        actor,
        input: { email: "  OWNER@CRA.TEST ", role: "owner" },
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "cannot_invite_self" },
    });
    expect(repository.calls).toEqual([]);
    expect(tokens.create).not.toHaveBeenCalled();
  });

  it("rejects an existing organization member", async () => {
    const { repository, useCase } = fixture();
    repository.existingUser = { id: "member-1" };
    repository.member = true;

    await expect(
      useCase.execute({ orgId: "org-1", actor, input: baseInput }),
    ).resolves.toEqual({ ok: false, error: { code: "already_member" } });
    expect(repository.calls).not.toContain("insert:org-1");
  });

  it("allows an existing non-member account to receive an invitation", async () => {
    const { repository, useCase } = fixture();
    repository.existingUser = { id: "known-user-1" };

    await expect(
      useCase.execute({ orgId: "org-1", actor, input: baseInput }),
    ).resolves.toEqual({ ok: true, value: { id: "invitation-1" } });
    expect(repository.calls).toContain("member:org-1:known-user-1");
  });

  it("rejects an existing pending invitation", async () => {
    const { repository, useCase } = fixture();
    repository.pending = true;

    await expect(
      useCase.execute({ orgId: "org-1", actor, input: baseInput }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "invitation_pending" },
    });
    expect(repository.calls).not.toContain("insert:org-1");
  });

  it("normalizes email consistently at every port boundary", async () => {
    const { notifier, repository, useCase } = fixture();

    await useCase.execute({
      orgId: "org-1",
      actor,
      input: { ...baseInput, email: "  MEMBER@CRA.TEST " },
    });

    expect(repository.calls).toEqual([
      "find:member@cra.test",
      "pending:org-1:member@cra.test",
      "insert:org-1",
      "organization:org-1",
    ]);
    expect(repository.lastInsert?.input.email).toBe("member@cra.test");
    expect(notifier.sent[0]?.email).toBe("member@cra.test");
  });

  it("sets expiration at the exact clock plus TTL boundary", async () => {
    const { repository, useCase } = fixture({ ttlDays: 1 });

    await useCase.execute({ orgId: "org-1", actor, input: baseInput });

    expect(repository.lastInsert?.input.expiresAt).toBe(
      "2026-08-10T00:00:00.000Z",
    );
  });

  it("persists only the hash and sends only the raw token", async () => {
    const { notifier, repository, useCase } = fixture();

    await useCase.execute({ orgId: "org-1", actor, input: baseInput });

    expect(repository.lastInsert?.input.tokenHash).toBe("hashed-token");
    expect(JSON.stringify(repository.lastInsert)).not.toContain("raw-token");
    expect(notifier.sent[0]?.rawToken).toBe("raw-token");
    expect(JSON.stringify(notifier.sent)).not.toContain("hashed-token");
  });

  it("fails closed when the token port does not separate raw and hashed values", async () => {
    const { notifier, repository, tokens, useCase } = fixture();
    tokens.create.mockReturnValueOnce({
      raw: "same-token",
      hash: "same-token",
    });

    await expect(
      useCase.execute({ orgId: "org-1", actor, input: baseInput }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "invitation_failed" },
    });
    expect(repository.lastInsert).toBeNull();
    expect(notifier.sent).toEqual([]);
  });

  it("succeeds with a disabled no-op notifier", async () => {
    const { repository, tokens } = fixture();
    const disabledNotifier: InvitationNotifierPort = {
      send: () => Promise.resolve(),
    };
    const useCase = new CreateInvitationUseCase(
      repository,
      tokens,
      disabledNotifier,
      { now: () => new Date("2026-08-09T00:00:00.000Z") },
      7,
    );

    await expect(
      useCase.execute({ orgId: "org-1", actor, input: baseInput }),
    ).resolves.toEqual({ ok: true, value: { id: "invitation-1" } });
  });

  it("reports notification failure without losing the persisted invitation", async () => {
    const { notifier, repository, useCase } = fixture();
    notifier.failure = new Error("mail unavailable");

    await expect(
      useCase.execute({ orgId: "org-1", actor, input: baseInput }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "notification_failed", invitationId: "invitation-1" },
    });
    expect(repository.lastInsert?.input.email).toBe("member@cra.test");
  });

  it("reports a missing organization after preserving the inserted row", async () => {
    const { notifier, repository, useCase } = fixture();
    repository.organizationValue = null;

    await expect(
      useCase.execute({ orgId: "org-1", actor, input: baseInput }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "organization_not_found" },
    });
    expect(repository.lastInsert).not.toBeNull();
    expect(notifier.sent).toEqual([]);
  });

  it.each([
    ["findExistingUser", false],
    ["isMember", true],
    ["hasPending", false],
    ["insert", false],
    ["organization", false],
  ] as const)(
    "maps a %s repository outage to invitation_failed",
    async (operation, needsExistingUser) => {
      const { repository, useCase } = fixture();
      repository.failOn = operation;
      if (needsExistingUser) repository.existingUser = { id: "known-user-1" };

      await expect(
        useCase.execute({ orgId: "org-1", actor, input: baseInput }),
      ).resolves.toEqual({
        ok: false,
        error: { code: "invitation_failed" },
      });
    },
  );

  it("returns the inserted invitation id and nullable profile fields", async () => {
    const { repository, useCase } = fixture();

    await expect(
      useCase.execute({ orgId: "org-1", actor, input: baseInput }),
    ).resolves.toEqual({ ok: true, value: { id: "invitation-1" } });
    expect(repository.lastInsert?.input).toMatchObject({
      firstName: null,
      lastName: null,
      invitedBy: "owner-1",
      role: "member",
    });
  });
});
