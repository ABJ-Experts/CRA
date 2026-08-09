import { Logger } from "@nestjs/common";

import { RoleRepositoryError } from "../application/role-repository.port";
import { SupabaseRoleRepository } from "./supabase-role.repository";

interface QueryResult {
  readonly data: unknown;
  readonly error: { readonly message: string } | null;
}

function query(result: QueryResult) {
  const chain = {
    select: jest.fn(),
    eq: jest.fn(),
    order: jest.fn(),
    insert: jest.fn(),
    single: jest.fn(),
    maybeSingle: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
    then: undefined as unknown as PromiseLike<QueryResult>["then"],
  };
  for (const method of [
    chain.select,
    chain.eq,
    chain.order,
    chain.insert,
    chain.update,
    chain.upsert,
  ]) {
    method.mockReturnValue(chain);
  }
  chain.single.mockResolvedValue(result);
  chain.maybeSingle.mockResolvedValue(result);
  chain.then = ((resolve: (value: QueryResult) => unknown) =>
    Promise.resolve(result).then(resolve)) as PromiseLike<QueryResult>["then"];
  return chain;
}

function harness(results: readonly QueryResult[]) {
  const queries: Array<ReturnType<typeof query>> = [];
  const from = jest.fn(() => {
    const result = results[queries.length];
    if (!result) throw new Error("Missing query result fixture");
    const current = query(result);
    queries.push(current);
    return current;
  });
  const repository = new SupabaseRoleRepository({
    admin: () => ({ from }),
  } as never);
  return { from, queries, repository };
}

const roleRow = {
  id: "00000000-0000-4000-8000-000000000010",
  name: "Support",
  description: null,
  color: "#4A50D6",
  base_role: "member",
  permissions: { can_view_users: true, future_grant: true },
  is_system: false,
  is_active: true,
  user_role_assignments: [{ count: 3 }],
};

describe("SupabaseRoleRepository", () => {
  it("scopes and maps role lists while sanitizing persisted data", async () => {
    const { queries, repository } = harness([{ data: [roleRow], error: null }]);

    await expect(repository.list("org-a")).resolves.toEqual([
      {
        id: "00000000-0000-4000-8000-000000000010",
        name: "Support",
        description: null,
        color: "#4A50D6",
        baseRole: "member",
        permissions: { can_view_users: true },
        isSystem: false,
        isActive: true,
        memberCount: 3,
      },
    ]);
    expect(queries[0]?.eq).toHaveBeenCalledWith("organization_id", "org-a");
    expect(queries[0]?.eq).toHaveBeenCalledWith("is_deleted", false);
    expect(queries[0]?.order).toHaveBeenCalledWith("created_at", {
      ascending: true,
    });
  });

  it("fails closed and logs when a persisted base role is invalid", async () => {
    const errorSpy = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    const { repository } = harness([
      { data: [{ ...roleRow, base_role: "root" }], error: null },
    ]);

    await expect(repository.list("org-a")).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "Role query returned an invalid base role",
    );
    errorSpy.mockRestore();
  });

  it("fails closed when a provider row violates the public role contract", async () => {
    const errorSpy = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    const { repository } = harness([
      { data: [{ ...roleRow, name: "" }], error: null },
    ]);

    await expect(repository.list("org-a")).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "Role query returned a malformed role record",
    );
    errorSpy.mockRestore();
  });

  it("returns an empty list and a zero member count for absent aggregates", async () => {
    const empty = harness([{ data: null, error: null }]);
    await expect(empty.repository.list("org-a")).resolves.toEqual([]);

    const noAssignments = harness([
      { data: [{ ...roleRow, user_role_assignments: null }], error: null },
    ]);
    await expect(noAssignments.repository.list("org-a")).resolves.toEqual([
      expect.objectContaining({ memberCount: 0 }),
    ]);
  });

  it("creates only inside the organization and returns the inserted id", async () => {
    const { queries, repository } = harness([
      { data: { id: "role-1" }, error: null },
    ]);
    const input = {
      name: "Support",
      description: null,
      color: "#4A50D6",
      baseRole: "member" as const,
      permissions: { can_view_users: true },
    };

    await expect(repository.create("org-a", input)).resolves.toEqual({
      id: "role-1",
    });
    expect(queries[0]?.insert).toHaveBeenCalledWith({
      organization_id: "org-a",
      name: "Support",
      description: null,
      color: "#4A50D6",
      base_role: "member",
      permissions: { can_view_users: true },
    });
  });

  it("fails closed when create succeeds without an inserted id", async () => {
    const errorSpy = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    const { repository } = harness([{ data: null, error: null }]);

    await expect(
      repository.create("org-a", {
        name: "Support",
        description: null,
        color: "#4A50D6",
        baseRole: "member",
        permissions: {},
      }),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(errorSpy).toHaveBeenCalledWith(
      "Role persistence failed: create returned no role id",
    );
    errorSpy.mockRestore();
  });

  it("scopes identity lookup to live roles in the organization", async () => {
    const { queries, repository } = harness([
      { data: { id: "role-1", is_system: true }, error: null },
    ]);

    await expect(repository.find("org-a", "role-1")).resolves.toEqual({
      id: "role-1",
      isSystem: true,
    });
    expect(queries[0]?.eq).toHaveBeenCalledWith("organization_id", "org-a");
    expect(queries[0]?.eq).toHaveBeenCalledWith("id", "role-1");
    expect(queries[0]?.eq).toHaveBeenCalledWith("is_deleted", false);
  });

  it("distinguishes a missing identity from a failed identity query", async () => {
    const missing = harness([{ data: null, error: null }]);
    await expect(
      missing.repository.find("org-a", "role-1"),
    ).resolves.toBeNull();

    const errorSpy = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    const failed = harness([
      { data: null, error: { message: "identity offline" } },
    ]);
    await expect(
      failed.repository.find("org-a", "role-1"),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(errorSpy).toHaveBeenCalledWith(
      "Role persistence failed: identity offline",
    );
    errorSpy.mockRestore();
  });

  it("scopes updates and maps application fields", async () => {
    const { queries, repository } = harness([{ data: null, error: null }]);

    await repository.update("org-a", "role-1", {
      name: "New",
      description: "Updated",
      color: "#000000",
      baseRole: "viewer",
      permissions: { can_view_users: false },
      isActive: false,
    });

    expect(queries[0]?.update).toHaveBeenCalledWith({
      name: "New",
      description: "Updated",
      color: "#000000",
      base_role: "viewer",
      permissions: { can_view_users: false },
      is_active: false,
    });
    expect(queries[0]?.eq).toHaveBeenCalledWith("id", "role-1");
    expect(queries[0]?.eq).toHaveBeenCalledWith("organization_id", "org-a");
  });

  it("does not invent fields for an empty update patch", async () => {
    const { queries, repository } = harness([{ data: null, error: null }]);

    await repository.update("org-a", "role-1", {});

    expect(queries[0]?.update).toHaveBeenCalledWith({});
  });

  it("soft-deletes with actor attribution inside the organization", async () => {
    const { queries, repository } = harness([{ data: null, error: null }]);
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-08-09T12:34:56.000Z"));

    try {
      await repository.softDelete("org-a", "role-1", "owner-1");
    } finally {
      jest.useRealTimers();
    }

    expect(queries[0]?.update).toHaveBeenCalledWith({
      is_deleted: true,
      deleted_at: "2026-08-09T12:34:56.000Z",
      deleted_by: "owner-1",
      is_active: false,
    });
    expect(queries[0]?.eq).toHaveBeenCalledWith("id", "role-1");
    expect(queries[0]?.eq).toHaveBeenCalledWith("organization_id", "org-a");
  });

  it("scopes and sanitizes override reads", async () => {
    const { queries, repository } = harness([
      {
        data: [
          {
            base_role: "member",
            permissions: { can_view_users: true, future_grant: true },
          },
        ],
        error: null,
      },
    ]);

    await expect(repository.overrides("org-a")).resolves.toEqual({
      member: { can_view_users: true },
    });
    expect(queries[0]?.eq).toHaveBeenCalledWith("organization_id", "org-a");
  });

  it("returns an empty override snapshot when no rows exist", async () => {
    const { repository } = harness([{ data: null, error: null }]);

    await expect(repository.overrides("org-a")).resolves.toEqual({});
  });

  it("upserts overrides with the exact tenant conflict key", async () => {
    const { queries, repository } = harness([{ data: null, error: null }]);

    await repository.setOverride("org-a", "member", {
      can_view_users: false,
    });

    expect(queries[0]?.upsert).toHaveBeenCalledWith(
      {
        organization_id: "org-a",
        base_role: "member",
        permissions: { can_view_users: false },
      },
      { onConflict: "organization_id,base_role" },
    );
  });

  it("distinguishes duplicate names from generic create failures", async () => {
    const duplicate = harness([
      { data: null, error: { message: "duplicate key value" } },
    ]);
    await expect(
      duplicate.repository.create("org-a", {
        name: "Support",
        description: null,
        color: "#4A50D6",
        baseRole: "member",
        permissions: {},
      }),
    ).rejects.toEqual(new RoleRepositoryError("role_name_taken"));

    const errorSpy = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    const generic = harness([
      { data: null, error: { message: "database offline" } },
    ]);
    await expect(
      generic.repository.create("org-a", {
        name: "Support",
        description: null,
        color: "#4A50D6",
        baseRole: "member",
        permissions: {},
      }),
    ).rejects.toEqual(new RoleRepositoryError("unavailable"));
    expect(errorSpy).toHaveBeenCalledWith(
      "Role persistence failed: database offline",
    );
    errorSpy.mockRestore();
  });

  it("fails closed on provider read and write errors", async () => {
    const errorSpy = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    const list = harness([{ data: null, error: { message: "list offline" } }]);
    await expect(list.repository.list("org-a")).rejects.toMatchObject({
      code: "unavailable",
    });

    const override = harness([
      { data: null, error: { message: "write offline" } },
    ]);
    await expect(
      override.repository.setOverride("org-a", "viewer", {}),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(errorSpy).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });
});
