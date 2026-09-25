import type {
  Invitation,
  OrganizationSummary,
} from "@repo/contracts/invitations";

import type {
  AcceptInvitationAtomicOutcome,
  InvitationActor,
  InvitationRepository,
  RevokeInvitationAtomicOutcome,
} from "./invitation-repository.port";
import { ListInvitationsQuery } from "./list-invitations.query";
import { RevokeInvitationUseCase } from "./revoke-invitation.use-case";

const listedInvitation = Object.freeze({
  id: "2ad67e3b-6e5e-4cde-870f-2225e7da1200",
  email: "member@cra.test",
  role: "member" as const,
  status: "pending" as const,
  expiresAt: "2026-08-16T00:00:00.000Z",
});

class TransitionRepositoryFake implements InvitationRepository {
  revokeOutcome: RevokeInvitationAtomicOutcome = "revoked";
  revokeFailure: Error | null = null;
  listFailure: Error | null = null;
  listValue: readonly Invitation[] = [listedInvitation];
  lastRevoke: Readonly<{
    orgId: string;
    invitationId: string;
    actor: InvitationActor;
  }> | null = null;
  listedOrgId: string | null = null;

  revokeAtomic(
    orgId: string,
    invitationId: string,
    actor: InvitationActor,
  ): Promise<RevokeInvitationAtomicOutcome> {
    if (this.revokeFailure) return Promise.reject(this.revokeFailure);
    this.lastRevoke = Object.freeze({
      orgId,
      invitationId,
      actor: Object.freeze({ ...actor }),
    });
    return Promise.resolve(this.revokeOutcome);
  }

  list(orgId: string): Promise<readonly Invitation[]> {
    if (this.listFailure) return Promise.reject(this.listFailure);
    this.listedOrgId = orgId;
    return Promise.resolve(this.listValue);
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

  acceptAtomic(): Promise<AcceptInvitationAtomicOutcome> {
    return Promise.reject(new Error("not used"));
  }

  resendAtomic(): Promise<never> {
    return Promise.reject(new Error("not used"));
  }

  organization(): Promise<OrganizationSummary | null> {
    return Promise.reject(new Error("not used"));
  }
}

const actor = Object.freeze({ id: "owner-1", email: " OWNER@CRA.TEST " });

describe("RevokeInvitationUseCase", () => {
  it("scopes revocation to the organization and normalizes the actor", async () => {
    const repository = new TransitionRepositoryFake();
    const useCase = new RevokeInvitationUseCase(repository);

    await expect(
      useCase.execute({ orgId: "org-1", actor, invitationId: "invitation-1" }),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(repository.lastRevoke).toEqual({
      orgId: "org-1",
      invitationId: "invitation-1",
      actor: { id: "owner-1", email: "owner@cra.test" },
    });
  });

  it.each([
    ["not_found", "invitation_not_found"],
    ["already_accepted", "invitation_already_accepted"],
    ["not_pending", "invitation_not_pending"],
    ["actor_not_found", "invitation_failed"],
    ["actor_email_mismatch", "invitation_failed"],
  ] as const)("maps the %s atomic outcome", async (outcome, code) => {
    const repository = new TransitionRepositoryFake();
    repository.revokeOutcome = outcome;
    const useCase = new RevokeInvitationUseCase(repository);

    await expect(
      useCase.execute({ orgId: "org-1", actor, invitationId: "invitation-1" }),
    ).resolves.toEqual({ ok: false, error: { code } });
  });

  it("fails closed on a repository outage", async () => {
    const repository = new TransitionRepositoryFake();
    repository.revokeFailure = new Error("database offline");
    const useCase = new RevokeInvitationUseCase(repository);

    await expect(
      useCase.execute({ orgId: "org-1", actor, invitationId: "invitation-1" }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "invitation_failed" },
    });
  });

  it("fails closed on a future atomic outcome", async () => {
    const repository = new TransitionRepositoryFake();
    repository.revokeOutcome = "future_outcome" as never;
    const useCase = new RevokeInvitationUseCase(repository);

    await expect(
      useCase.execute({ orgId: "org-1", actor, invitationId: "invitation-1" }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "invitation_failed" },
    });
  });
});

describe("ListInvitationsQuery", () => {
  it("returns a fresh immutable list scoped to the organization", async () => {
    const repository = new TransitionRepositoryFake();
    const query = new ListInvitationsQuery(repository);

    const result = await query.execute({ orgId: "org-1" });

    expect(result).toEqual({ ok: true, value: [listedInvitation] });
    expect(repository.listedOrgId).toBe("org-1");
    if (!result.ok) throw new Error("expected list success");
    expect(result.value).not.toBe(repository.listValue);
    expect(Object.isFrozen(result.value)).toBe(true);
  });

  it("returns a semantic failure for an unavailable list", async () => {
    const repository = new TransitionRepositoryFake();
    repository.listFailure = new Error("database offline");
    const query = new ListInvitationsQuery(repository);

    await expect(query.execute({ orgId: "org-1" })).resolves.toEqual({
      ok: false,
      error: { code: "invitation_list_failed" },
    });
  });
});
