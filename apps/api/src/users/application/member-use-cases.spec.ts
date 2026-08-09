import type { BaseRole } from "@repo/contracts/permissions";
import type { PageParams, Paged } from "@repo/contracts/pagination";
import type { Member } from "@repo/contracts/users";

import type { MemberRepository, ProfilePatch } from "./member-repository.port";
import { MemberRepositoryError } from "./member-repository.port";
import {
  MemberUseCases,
  type MemberAuditEntry,
  type MemberAuditPort,
} from "./member-use-cases";

const params = Object.freeze<PageParams>({
  page: 1,
  pageSize: 15,
  order: "asc",
});

const member = Object.freeze<Member>({
  id: "00000000-0000-4000-8000-000000000002",
  email: "member@cra.test",
  username: "member",
  firstName: "Mem",
  lastName: "Ber",
  avatarUrl: null,
  jobTitle: null,
  isActive: true,
  role: "member",
  joinedAt: "2026-08-09T00:00:00.000Z",
  roles: [],
});

const page = Object.freeze({
  rows: [member],
  total: 1,
  page: 1,
  pageSize: 15,
  pageCount: 1,
}) as Paged<Member>;

class MemberRepositoryFake implements MemberRepository {
  readonly calls: Array<
    Readonly<{ operation: string; args: readonly unknown[] }>
  > = [];
  membership: Readonly<{ role: BaseRole }> | null = { role: "member" };
  pageValue: Paged<Member> = page;
  failure: MemberRepositoryError | Error | null = null;

  list(orgId: string, input: PageParams): Promise<Paged<Member>> {
    this.record("list", orgId, input);
    this.fail();
    return Promise.resolve(this.pageValue);
  }

  findMembership(
    orgId: string,
    userId: string,
  ): Promise<{ role: BaseRole } | null> {
    this.record("findMembership", orgId, userId);
    this.fail();
    return Promise.resolve(this.membership);
  }

  changeRole(orgId: string, userId: string, role: BaseRole): Promise<void> {
    this.record("changeRole", orgId, userId, role);
    this.fail();
    return Promise.resolve();
  }

  remove(orgId: string, userId: string): Promise<void> {
    this.record("remove", orgId, userId);
    this.fail();
    return Promise.resolve();
  }

  setActive(orgId: string, userId: string, isActive: boolean): Promise<void> {
    this.record("setActive", orgId, userId, isActive);
    this.fail();
    return Promise.resolve();
  }

  updateOwnProfile(userId: string, patch: ProfilePatch): Promise<void> {
    this.record("updateOwnProfile", userId, patch);
    this.fail();
    return Promise.resolve();
  }

  private record(operation: string, ...args: readonly unknown[]): void {
    this.calls.push(Object.freeze({ operation, args: Object.freeze(args) }));
  }

  private fail(): void {
    if (this.failure) throw this.failure;
  }
}

class RecordingAudit implements MemberAuditPort {
  readonly entries: MemberAuditEntry[] = [];

  log(entry: MemberAuditEntry): void {
    this.entries.push(entry);
  }
}

const actor = Object.freeze({ id: "owner-1", email: "owner@cra.test" });

function fixture() {
  const repository = new MemberRepositoryFake();
  const audit = new RecordingAudit();
  const useCases = new MemberUseCases(repository, audit);
  return { audit, repository, useCases };
}

function assertTenantArgumentPosition(repository: MemberRepository): void {
  // @ts-expect-error PageParams cannot replace the leading tenant scope.
  void repository.list(params, "org-a");

  // @ts-expect-error Tenant scope cannot move behind the distinct role input.
  void repository.changeRole("user-a", "viewer", "org-a");

  // @ts-expect-error Tenant scope cannot move behind the activation input.
  const setActive: MemberRepository["setActive"] = (
    ...args: [string, boolean, string]
  ) => {
    void args;
    return Promise.resolve();
  };

  void setActive;
}

void assertTenantArgumentPosition;

describe("MemberUseCases", () => {
  it("keeps organization scope first for list queries", async () => {
    const { repository, useCases } = fixture();

    await expect(useCases.list({ orgId: "org-a", params })).resolves.toEqual({
      ok: true,
      value: page,
    });
    expect(repository.calls).toEqual([
      { operation: "list", args: ["org-a", params] },
    ]);
    expect(repository.calls[0]?.args[1]).not.toBe(params);
    expect(Object.isFrozen(repository.calls[0]?.args[1])).toBe(true);
  });

  it("returns a detached, deeply frozen member page snapshot", async () => {
    const { repository, useCases } = fixture();
    const mutableRole = { id: "role-1", name: "Support", color: "blue" };
    const mutableMember = { ...member, roles: [mutableRole] };
    const mutablePage: Paged<Member> = {
      rows: [mutableMember],
      total: 1,
      page: 1,
      pageSize: 15,
      pageCount: 1,
    };
    repository.pageValue = mutablePage;

    const result = await useCases.list({ orgId: "org-a", params });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected a successful member page");
    expect(result.value).toEqual(mutablePage);
    expect(result.value).not.toBe(mutablePage);
    expect(result.value.rows).not.toBe(mutablePage.rows);
    expect(result.value.rows[0]).not.toBe(mutableMember);
    expect(result.value.rows[0]?.roles).not.toBe(mutableMember.roles);
    expect(result.value.rows[0]?.roles[0]).not.toBe(mutableRole);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.rows)).toBe(true);
    expect(Object.isFrozen(result.value.rows[0])).toBe(true);
    expect(Object.isFrozen(result.value.rows[0]?.roles)).toBe(true);
    expect(Object.isFrozen(result.value.rows[0]?.roles[0])).toBe(true);
  });

  it("rejects self role changes before reading persistence", async () => {
    const { audit, repository, useCases } = fixture();

    await expect(
      useCases.changeRole({
        orgId: "org-a",
        actor,
        targetUserId: actor.id,
        role: "admin",
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "cannot_change_own_role" },
    });
    expect(repository.calls).toEqual([]);
    expect(audit.entries).toEqual([]);
  });

  it("returns member-not-found without mutating or auditing", async () => {
    const { audit, repository, useCases } = fixture();
    repository.membership = null;

    await expect(
      useCases.changeRole({
        orgId: "org-a",
        actor,
        targetUserId: "member-1",
        role: "admin",
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "member_not_found" },
    });
    expect(repository.calls.map(({ operation }) => operation)).toEqual([
      "findMembership",
    ]);
    expect(audit.entries).toEqual([]);
  });

  it("changes a role and preserves the exact audit payload", async () => {
    const { audit, repository, useCases } = fixture();

    await expect(
      useCases.changeRole({
        orgId: "org-a",
        actor,
        targetUserId: "member-1",
        role: "admin",
      }),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(repository.calls).toEqual([
      { operation: "findMembership", args: ["org-a", "member-1"] },
      { operation: "changeRole", args: ["org-a", "member-1", "admin"] },
    ]);
    expect(audit.entries).toEqual([
      {
        organizationId: "org-a",
        userId: actor.id,
        actorEmail: actor.email,
        action: "member.role_changed",
        entityType: "user",
        entityId: "member-1",
        changes: { from: "member", to: "admin" },
      },
    ]);
    expect(Object.isFrozen(audit.entries[0])).toBe(true);
    expect(Object.isFrozen(audit.entries[0]?.changes)).toBe(true);
  });

  it("translates the database last-owner invariant semantically", async () => {
    const { audit, repository, useCases } = fixture();
    repository.membership = { role: "owner" };
    repository.failure = new MemberRepositoryError("last_owner");

    await expect(
      useCases.changeRole({
        orgId: "org-a",
        actor,
        targetUserId: "owner-2",
        role: "viewer",
      }),
    ).resolves.toEqual({ ok: false, error: { code: "last_owner" } });
    expect(audit.entries).toEqual([]);
  });

  it("rejects self removal and audits successful removal", async () => {
    const { audit, repository, useCases } = fixture();

    await expect(
      useCases.remove({
        orgId: "org-a",
        actor,
        targetUserId: actor.id,
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "cannot_remove_self" },
    });
    await expect(
      useCases.remove({
        orgId: "org-a",
        actor,
        targetUserId: "member-1",
      }),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(repository.calls).toEqual([
      { operation: "remove", args: ["org-a", "member-1"] },
    ]);
    expect(audit.entries).toEqual([
      {
        organizationId: "org-a",
        userId: actor.id,
        actorEmail: actor.email,
        action: "member.removed",
        entityType: "user",
        entityId: "member-1",
      },
    ]);
  });

  it("blocks self-deactivation but permits self-reactivation", async () => {
    const { audit, repository, useCases } = fixture();

    await expect(
      useCases.setActive({
        orgId: "org-a",
        actor,
        targetUserId: actor.id,
        isActive: false,
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "cannot_deactivate_self" },
    });
    await expect(
      useCases.setActive({
        orgId: "org-a",
        actor,
        targetUserId: actor.id,
        isActive: true,
      }),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(repository.calls).toEqual([
      { operation: "setActive", args: ["org-a", actor.id, true] },
    ]);
    expect(audit.entries[0]).toEqual({
      organizationId: "org-a",
      userId: actor.id,
      actorEmail: actor.email,
      action: "member.reactivated",
      entityType: "user",
      entityId: actor.id,
    });
  });

  it("preserves a repository membership failure during activation", async () => {
    const { audit, repository, useCases } = fixture();
    repository.failure = new MemberRepositoryError("member_not_found");

    await expect(
      useCases.setActive({
        orgId: "org-a",
        actor,
        targetUserId: "missing-1",
        isActive: true,
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "member_not_found" },
    });
    expect(audit.entries).toEqual([]);
  });

  it("enforces profile self-scope and forwards an immutable patch copy", async () => {
    const { repository, useCases } = fixture();
    const patch = { firstName: "Ada", language: "en" };

    await expect(
      useCases.updateOwnProfile({
        actorUserId: "actor-1",
        targetUserId: "other-1",
        patch,
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "profile_scope_violation" },
    });
    await expect(
      useCases.updateOwnProfile({
        actorUserId: "actor-1",
        targetUserId: "actor-1",
        patch,
      }),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(repository.calls).toHaveLength(1);
    expect(repository.calls[0]?.args).toEqual([
      "actor-1",
      { firstName: "Ada", language: "en" },
    ]);
    expect(Object.isFrozen(repository.calls[0]?.args[1])).toBe(true);
    expect(patch).toEqual({ firstName: "Ada", language: "en" });
  });

  it.each([
    ["list", "member_list_failed"],
    ["changeRole", "update_failed"],
    ["remove", "update_failed"],
    ["setActive", "update_failed"],
    ["updateOwnProfile", "update_failed"],
  ] as const)("maps %s repository outages to %s", async (operation, code) => {
    const { repository, useCases } = fixture();
    repository.failure = new Error("database credentials must not leak");

    const result =
      operation === "list"
        ? await useCases.list({ orgId: "org-a", params })
        : operation === "changeRole"
          ? await useCases.changeRole({
              orgId: "org-a",
              actor,
              targetUserId: "member-1",
              role: "admin",
            })
          : operation === "remove"
            ? await useCases.remove({
                orgId: "org-a",
                actor,
                targetUserId: "member-1",
              })
            : operation === "setActive"
              ? await useCases.setActive({
                  orgId: "org-a",
                  actor,
                  targetUserId: "member-1",
                  isActive: false,
                })
              : await useCases.updateOwnProfile({
                  actorUserId: actor.id,
                  targetUserId: actor.id,
                  patch: { firstName: "Ada" },
                });

    expect(result).toEqual({
      ok: false,
      error:
        code === "update_failed"
          ? { code, operation }
          : { code: "member_list_failed" },
    });
    expect(JSON.stringify(result)).not.toContain("credentials");
  });
});
