import type { BaseRole, PermissionSet } from "@repo/contracts/permissions";
import type { CustomRole } from "@repo/contracts/roles";

import type {
  CreateRoleRecord,
  CustomRoleIdentity,
  RoleRepository,
  UpdateRoleRecord,
} from "./role-repository.port";
import { RoleRepositoryError } from "./role-repository.port";
import {
  RoleUseCases,
  type RoleAuditEntry,
  type RoleAuditPort,
} from "./role-use-cases";

const actor = Object.freeze({ id: "owner-1", email: "owner@cra.test" });
const role = Object.freeze<CustomRole>({
  id: "00000000-0000-4000-8000-000000000010",
  name: "Support",
  description: "Support team",
  color: "#4A50D6",
  baseRole: "member",
  permissions: { can_view_users: true },
  isSystem: false,
  isActive: true,
  memberCount: 2,
});

class RoleRepositoryFake implements RoleRepository {
  readonly calls: Array<
    Readonly<{ operation: string; args: readonly unknown[] }>
  > = [];
  roles: readonly CustomRole[] = [role];
  identity: CustomRoleIdentity | null = { id: role.id, isSystem: false };
  overridesValue: Readonly<Record<string, PermissionSet>> = {
    member: { can_view_users: true },
  };
  createdId = role.id;
  failure: Error | null = null;

  list(orgId: string): Promise<readonly CustomRole[]> {
    this.record("list", orgId);
    this.fail();
    return Promise.resolve(this.roles);
  }

  create(orgId: string, input: CreateRoleRecord): Promise<{ id: string }> {
    this.record("create", orgId, input);
    this.fail();
    return Promise.resolve({ id: this.createdId });
  }

  find(orgId: string, roleId: string): Promise<CustomRoleIdentity | null> {
    this.record("find", orgId, roleId);
    this.fail();
    return Promise.resolve(this.identity);
  }

  update(
    orgId: string,
    roleId: string,
    patch: UpdateRoleRecord,
  ): Promise<void> {
    this.record("update", orgId, roleId, patch);
    this.fail();
    return Promise.resolve();
  }

  softDelete(orgId: string, roleId: string, actorId: string): Promise<void> {
    this.record("softDelete", orgId, roleId, actorId);
    this.fail();
    return Promise.resolve();
  }

  overrides(orgId: string): Promise<Readonly<Record<string, PermissionSet>>> {
    this.record("overrides", orgId);
    this.fail();
    return Promise.resolve(this.overridesValue);
  }

  setOverride(
    orgId: string,
    baseRole: BaseRole,
    permissions: PermissionSet,
  ): Promise<void> {
    this.record("setOverride", orgId, baseRole, permissions);
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

class RecordingRoleAudit implements RoleAuditPort {
  readonly entries: RoleAuditEntry[] = [];

  log(entry: RoleAuditEntry): void {
    this.entries.push(entry);
  }
}

function fixture() {
  const repository = new RoleRepositoryFake();
  const audit = new RecordingRoleAudit();
  const useCases = new RoleUseCases(repository, audit);
  return { audit, repository, useCases };
}

function assertTenantArgumentPosition(repository: RoleRepository): void {
  // @ts-expect-error Tenant scope cannot move behind the create record.
  void repository.create({} as CreateRoleRecord, "org-a");
  // @ts-expect-error Tenant scope cannot move behind the update record.
  void repository.update("role-a", {} as UpdateRoleRecord, "org-a");
  // @ts-expect-error Tenant scope cannot move behind the base-role input.
  void repository.setOverride("member", {}, "org-a");
}

void assertTenantArgumentPosition;

describe("RoleUseCases", () => {
  it("returns a detached and deeply frozen list snapshot", async () => {
    const { repository, useCases } = fixture();
    const mutablePermissions = { can_view_users: true };
    const mutableRole = { ...role, permissions: mutablePermissions };
    const mutableRoles = [mutableRole];
    repository.roles = mutableRoles;

    const result = await useCases.list({ orgId: "org-a" });

    expect(result).toEqual({ ok: true, value: mutableRoles });
    if (!result.ok) throw new Error("Expected roles");
    expect(result.value).not.toBe(mutableRoles);
    expect(result.value[0]).not.toBe(mutableRole);
    expect(result.value[0]?.permissions).not.toBe(mutablePermissions);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value[0])).toBe(true);
    expect(Object.isFrozen(result.value[0]?.permissions)).toBe(true);
    expect(repository.calls[0]).toEqual({ operation: "list", args: ["org-a"] });
  });

  it("maps list outages without leaking provider errors", async () => {
    const { repository, useCases } = fixture();
    repository.failure = new Error("database password leaked");

    const result = await useCases.list({ orgId: "org-a" });

    expect(result).toEqual({ ok: false, error: { code: "role_list_failed" } });
    expect(JSON.stringify(result)).not.toContain("password");
  });

  it("sanitizes create permissions, applies defaults, and audits exactly", async () => {
    const { audit, repository, useCases } = fixture();

    const result = await useCases.create({
      orgId: "org-a",
      actor,
      input: {
        name: "Support",
        description: "Support team",
        color: "#4A50D6",
        baseRole: "member",
        permissions: {
          can_view_users: true,
          can_delete_users: "yes",
          future_grant: true,
        },
      },
    });

    expect(result).toEqual({ ok: true, value: { id: role.id } });
    expect(Object.isFrozen(result)).toBe(true);
    if (result.ok) expect(Object.isFrozen(result.value)).toBe(true);
    expect(repository.calls).toEqual([
      {
        operation: "create",
        args: [
          "org-a",
          {
            name: "Support",
            description: "Support team",
            color: "#4A50D6",
            baseRole: "member",
            permissions: { can_view_users: true },
          },
        ],
      },
    ]);
    expect(Object.isFrozen(repository.calls[0]?.args[1])).toBe(true);
    expect(audit.entries).toEqual([
      {
        organizationId: "org-a",
        userId: actor.id,
        actorEmail: actor.email,
        action: "role.created",
        entityType: "custom_role",
        entityId: role.id,
      },
    ]);
  });

  it.each([
    [new RoleRepositoryError("role_name_taken"), "role_name_taken"],
    [new Error("offline"), "role_create_failed"],
  ] as const)(
    "maps create persistence failures to %s",
    async (failure, code) => {
      const { audit, repository, useCases } = fixture();
      repository.failure = failure;

      await expect(
        useCases.create({
          orgId: "org-a",
          actor,
          input: {
            name: "Support",
            baseRole: "member",
            permissions: {},
          },
        }),
      ).resolves.toEqual({ ok: false, error: { code } });
      expect(audit.entries).toEqual([]);
    },
  );

  it("rejects missing and system roles before update persistence", async () => {
    const missing = fixture();
    missing.repository.identity = null;

    await expect(
      missing.useCases.update({
        orgId: "org-a",
        actor,
        roleId: role.id,
        patch: { name: "New" },
      }),
    ).resolves.toEqual({ ok: false, error: { code: "role_not_found" } });

    const system = fixture();
    system.repository.identity = { id: role.id, isSystem: true };
    await expect(
      system.useCases.update({
        orgId: "org-a",
        actor,
        roleId: role.id,
        patch: { name: "New" },
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "role_is_system", operation: "update" },
    });
    expect(system.repository.calls.map(({ operation }) => operation)).toEqual([
      "find",
    ]);
  });

  it("sanitizes an immutable update patch and preserves its audit payload", async () => {
    const { audit, repository, useCases } = fixture();

    await expect(
      useCases.update({
        orgId: "org-a",
        actor,
        roleId: role.id,
        patch: {
          name: "Renamed",
          description: "Updated support role",
          color: "#000000",
          baseRole: "viewer",
          permissions: { can_edit_users: true, removed_key: true },
          isActive: false,
        },
      }),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(repository.calls[1]).toEqual({
      operation: "update",
      args: [
        "org-a",
        role.id,
        {
          name: "Renamed",
          description: "Updated support role",
          color: "#000000",
          baseRole: "viewer",
          permissions: { can_edit_users: true },
          isActive: false,
        },
      ],
    });
    expect(Object.isFrozen(repository.calls[1]?.args[2])).toBe(true);
    expect(
      Object.isFrozen(
        (repository.calls[1]?.args[2] as UpdateRoleRecord).permissions,
      ),
    ).toBe(true);
    expect(audit.entries).toEqual([
      {
        organizationId: "org-a",
        userId: actor.id,
        actorEmail: actor.email,
        action: "role.updated",
        entityType: "custom_role",
        entityId: role.id,
      },
    ]);
  });

  it("preserves an empty update patch without inventing fields", async () => {
    const { repository, useCases } = fixture();

    await expect(
      useCases.update({
        orgId: "org-a",
        actor,
        roleId: role.id,
        patch: {},
      }),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(repository.calls[1]).toEqual({
      operation: "update",
      args: ["org-a", role.id, {}],
    });
    expect(Object.isFrozen(repository.calls[1]?.args[2])).toBe(true);
  });

  it("soft-deletes non-system roles and protects system roles", async () => {
    const { audit, repository, useCases } = fixture();

    await expect(
      useCases.remove({ orgId: "org-a", actor, roleId: role.id }),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(repository.calls[1]).toEqual({
      operation: "softDelete",
      args: ["org-a", role.id, actor.id],
    });
    expect(audit.entries[0]).toEqual({
      organizationId: "org-a",
      userId: actor.id,
      actorEmail: actor.email,
      action: "role.deleted",
      entityType: "custom_role",
      entityId: role.id,
    });

    const system = fixture();
    system.repository.identity = { id: role.id, isSystem: true };
    await expect(
      system.useCases.remove({ orgId: "org-a", actor, roleId: role.id }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "role_is_system", operation: "remove" },
    });
    expect(system.repository.calls.map(({ operation }) => operation)).toEqual([
      "find",
    ]);
  });

  it("reports a missing role during removal without deleting", async () => {
    const { repository, useCases } = fixture();
    repository.identity = null;

    await expect(
      useCases.remove({ orgId: "org-a", actor, roleId: role.id }),
    ).resolves.toEqual({ ok: false, error: { code: "role_not_found" } });
    expect(repository.calls.map(({ operation }) => operation)).toEqual([
      "find",
    ]);
  });

  it("returns a frozen sanitized override snapshot and fails open on reads", async () => {
    const { repository, useCases } = fixture();
    repository.overridesValue = {
      member: { can_view_users: true, future_grant: true } as PermissionSet,
    };

    const result = await useCases.overrides({ orgId: "org-a" });

    expect(result).toEqual({
      ok: true,
      value: { member: { can_view_users: true } },
    });
    if (!result.ok) throw new Error("Expected overrides");
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.member)).toBe(true);

    repository.failure = new Error("offline");
    const failed = await useCases.overrides({ orgId: "org-a" });
    expect(failed).toEqual({ ok: true, value: {} });
    if (failed.ok) expect(Object.isFrozen(failed.value)).toBe(true);
  });

  it("fails open without exposing an invalid override base-role key", async () => {
    const { repository, useCases } = fixture();
    repository.overridesValue = {
      root: { can_view_users: true },
    };

    const result = await useCases.overrides({ orgId: "org-a" });

    expect(result).toEqual({ ok: true, value: {} });
    expect(JSON.stringify(result)).not.toContain("root");
  });

  it("sanitizes override writes and preserves the audit payload", async () => {
    const { audit, repository, useCases } = fixture();

    await expect(
      useCases.setOverride({
        orgId: "org-a",
        actor,
        baseRole: "viewer",
        permissions: { can_view_users: true, future_grant: true },
      }),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(repository.calls[0]).toEqual({
      operation: "setOverride",
      args: ["org-a", "viewer", { can_view_users: true }],
    });
    expect(Object.isFrozen(repository.calls[0]?.args[2])).toBe(true);
    expect(audit.entries).toEqual([
      {
        organizationId: "org-a",
        userId: actor.id,
        actorEmail: actor.email,
        action: "permissions.override_updated",
        entityType: "base_role",
        entityId: "viewer",
      },
    ]);
  });

  it.each([
    ["update", "role_update_failed"],
    ["remove", "role_delete_failed"],
    ["setOverride", "override_failed"],
  ] as const)("maps %s persistence outages to %s", async (operation, code) => {
    const { audit, repository, useCases } = fixture();
    repository.failure = new Error("offline");

    const result =
      operation === "update"
        ? await useCases.update({
            orgId: "org-a",
            actor,
            roleId: role.id,
            patch: { name: "New" },
          })
        : operation === "remove"
          ? await useCases.remove({ orgId: "org-a", actor, roleId: role.id })
          : await useCases.setOverride({
              orgId: "org-a",
              actor,
              baseRole: "member",
              permissions: {},
            });

    expect(result).toEqual({ ok: false, error: { code } });
    expect(audit.entries).toEqual([]);
  });
});
