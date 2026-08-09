import type {
  Invitation,
  OrganizationSummary,
} from "@repo/contracts/invitations";

import { AcceptInvitationUseCase } from "./accept-invitation.use-case";
import type {
  AcceptInvitationAtomicOutcome,
  InvitationActor,
  InvitationRepository,
  RevokeInvitationAtomicOutcome,
} from "./invitation-repository.port";

const organization = Object.freeze({ id: "org-1", name: "CRA", slug: "cra" });

class AcceptanceRepositoryFake implements InvitationRepository {
  outcome: AcceptInvitationAtomicOutcome = {
    outcome: "accepted",
    invitationId: "invitation-1",
    organization,
  };
  failure: Error | null = null;
  readonly calls: Array<
    Readonly<{ tokenHash: string; user: InvitationActor }>
  > = [];

  acceptAtomic(
    tokenHash: string,
    user: InvitationActor,
  ): Promise<AcceptInvitationAtomicOutcome> {
    if (this.failure) return Promise.reject(this.failure);
    this.calls.push(
      Object.freeze({ tokenHash, user: Object.freeze({ ...user }) }),
    );
    return Promise.resolve(this.outcome);
  }

  findExistingUser(): Promise<{ id: string } | null> {
    return Promise.reject(new Error("not used"));
  }

  isMember(): Promise<boolean> {
    return Promise.reject(new Error("not used"));
  }

  hasPending(): Promise<boolean> {
    return Promise.reject(new Error("not used"));
  }

  insert(): Promise<{ id: string }> {
    return Promise.reject(new Error("not used"));
  }

  revokeAtomic(): Promise<RevokeInvitationAtomicOutcome> {
    return Promise.reject(new Error("not used"));
  }

  list(): Promise<readonly Invitation[]> {
    return Promise.reject(new Error("not used"));
  }

  organization(): Promise<OrganizationSummary | null> {
    return Promise.reject(new Error("not used"));
  }
}

function fixture() {
  const repository = new AcceptanceRepositoryFake();
  const tokens = {
    create: jest
      .fn()
      .mockReturnValue({ raw: "raw-token", hash: "hashed-token" }),
    hash: jest.fn(() => "hashed-token"),
  };
  const useCase = new AcceptInvitationUseCase(repository, tokens);
  return { repository, tokens, useCase };
}

const user = Object.freeze({ id: "user-1", email: "member@cra.test" });

describe("AcceptInvitationUseCase", () => {
  it("hashes the raw token and normalizes the caller email", async () => {
    const { repository, useCase } = fixture();

    await useCase.execute({
      token: "raw-token",
      user: { id: "user-1", email: "  MEMBER@CRA.TEST " },
    });

    expect(repository.calls).toEqual([
      {
        tokenHash: "hashed-token",
        user: { id: "user-1", email: "member@cra.test" },
      },
    ]);
    expect(JSON.stringify(repository.calls)).not.toContain("raw-token");
  });

  it("returns a successful first acceptance", async () => {
    const { useCase } = fixture();

    await expect(
      useCase.execute({ token: "raw-token", user }),
    ).resolves.toEqual({
      ok: true,
      value: { ok: true, alreadyAccepted: false, organization },
    });
  });

  it("returns idempotent success when membership proves prior acceptance", async () => {
    const { repository, useCase } = fixture();
    repository.outcome = {
      outcome: "already_accepted",
      invitationId: "invitation-1",
      organization,
    };

    await expect(
      useCase.execute({ token: "raw-token", user }),
    ).resolves.toEqual({
      ok: true,
      value: { ok: true, alreadyAccepted: true, organization },
    });
  });

  it.each([
    ["not_found", "invitation_not_found"],
    ["expired", "invitation_expired"],
    ["email_mismatch", "invitation_email_mismatch"],
    ["not_pending", "invitation_not_pending"],
    ["organization_not_found", "organization_not_found"],
    ["user_not_found", "membership_failed"],
  ] as const)("maps the atomic %s outcome", async (outcome, code) => {
    const { repository, useCase } = fixture();
    repository.outcome = { outcome };

    await expect(
      useCase.execute({ token: "raw-token", user }),
    ).resolves.toEqual({
      ok: false,
      error: { code },
    });
  });

  it("treats an invalid token/hash as not found without leaking detail", async () => {
    const { repository, useCase } = fixture();
    repository.outcome = { outcome: "not_found" };

    await expect(
      useCase.execute({ token: "invalid-token", user }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "invitation_not_found" },
    });
  });

  it("fails closed for an accepted row whose membership is missing", async () => {
    const { repository, useCase } = fixture();
    repository.outcome = { outcome: "not_pending" };

    await expect(
      useCase.execute({ token: "raw-token", user }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "invitation_not_pending" },
    });
  });

  it("keeps concurrent double acceptance idempotent", async () => {
    const repository = new AcceptanceRepositoryFake();
    let accepted = false;
    repository.acceptAtomic = async () => {
      await Promise.resolve();
      if (!accepted) {
        accepted = true;
        return {
          outcome: "accepted",
          invitationId: "invitation-1",
          organization,
        };
      }
      return {
        outcome: "already_accepted",
        invitationId: "invitation-1",
        organization,
      };
    };
    const useCase = new AcceptInvitationUseCase(repository, {
      create: () => ({ raw: "unused", hash: "unused" }),
      hash: () => "hashed-token",
    });

    await expect(
      Promise.all([
        useCase.execute({ token: "raw-token", user }),
        useCase.execute({ token: "raw-token", user }),
      ]),
    ).resolves.toEqual([
      {
        ok: true,
        value: { ok: true, alreadyAccepted: false, organization },
      },
      {
        ok: true,
        value: { ok: true, alreadyAccepted: true, organization },
      },
    ]);
  });

  it("maps database outages to membership_failed", async () => {
    const { repository, useCase } = fixture();
    repository.failure = new Error("database offline");

    await expect(
      useCase.execute({ token: "raw-token", user }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "membership_failed" },
    });
  });

  it("fails closed when hashing fails", async () => {
    const { repository, tokens } = fixture();
    tokens.hash.mockImplementationOnce(() => {
      throw new Error("hash unavailable");
    });
    const useCase = new AcceptInvitationUseCase(repository, tokens);

    await expect(
      useCase.execute({ token: "raw-token", user }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "membership_failed" },
    });
    expect(repository.calls).toEqual([]);
  });

  it("fails closed on a future atomic outcome", async () => {
    const { repository, useCase } = fixture();
    repository.outcome = { outcome: "future_outcome" } as never;

    await expect(
      useCase.execute({ token: "raw-token", user }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "membership_failed" },
    });
  });

  it("fails closed on an empty atomic result", async () => {
    const { repository, useCase } = fixture();
    repository.outcome = null as never;

    await expect(
      useCase.execute({ token: "raw-token", user }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "membership_failed" },
    });
  });
});
