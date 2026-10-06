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

function harness(
  results: readonly QueryResult[],
  rpcResult: QueryResult = {
    data: { status: "updated", id: "00000000-0000-4000-8000-000000000010" },
    error: null,
  },
) {
  const queries: Array<ReturnType<typeof query>> = [];
  const from = jest.fn(() => {
    const result = results[queries.length];
    if (!result) throw new Error("Missing query result fixture");
    const current = query(result);
    queries.push(current);
    return current;
  });
  const rpc = jest.fn().mockResolvedValue(rpcResult);
  const repository = new SupabaseRoleRepository({
    admin: () => ({ from, rpc }),
  } as never);
  return { from, queries, repository, rpc };
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

  const context = {
    eventKey: "11111111-1111-4111-8111-111111111111",
    correlationId: "22222222-2222-4222-8222-222222222222",
    sourceIp: "127.0.0.1",
  };

  it("creates roles using one organization-scoped audited RPC", async () => {
    const { repository, rpc, from } = harness([]);
    await expect(
      repository.create(
        "org-a",
        {
          name: "Support",
          description: null,
          color: "#4A50D6",
          baseRole: "member",
          permissions: { can_view_users: true },
        },
        "actor-a",
        context,
      ),
    ).resolves.toEqual({ id: roleRow.id });
    expect(rpc).toHaveBeenCalledWith("m13_01_mutate_role_atomic", {
      p_organization_id: "org-a",
      p_actor_user_id: "actor-a",
      p_operation: "create",
      p_role_id: null,
      p_expected_version: null,
      p_payload: {
        name: "Support",
        description: null,
        color: "#4A50D6",
        baseRole: "member",
        permissions: { can_view_users: true },
      },
      p_event_key: context.eventKey,
      p_correlation_id: context.correlationId,
      p_source_ip: context.sourceIp,
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("uses audited RPC for updates, deletion and permission overrides", async () => {
    const { repository, rpc } = harness([]);
    await repository.update(
      "org-a",
      roleRow.id,
      { name: "Renamed", isActive: false },
      "actor-a",
      context,
      1,
    );
    await repository.softDelete("org-a", roleRow.id, "actor-a", context, 2);
    await repository.setOverride(
      "org-a",
      "viewer",
      { can_view_users: false },
      "actor-a",
      context,
    );
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "m13_01_mutate_role_atomic",
      expect.objectContaining({
        p_organization_id: "org-a",
        p_operation: "update",
        p_role_id: roleRow.id,
        p_payload: { name: "Renamed", isActive: false },
        p_expected_version: 1,
      }),
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "m13_01_mutate_role_atomic",
      expect.objectContaining({
        p_organization_id: "org-a",
        p_operation: "delete",
        p_role_id: roleRow.id,
        p_expected_version: 2,
      }),
    );
    expect(rpc).toHaveBeenNthCalledWith(
      3,
      "m13_01_mutate_role_atomic",
      expect.objectContaining({
        p_organization_id: "org-a",
        p_operation: "override",
        p_payload: {
          baseRole: "viewer",
          permissions: { can_view_users: false },
        },
      }),
    );
  });

  it("accepts idempotent replay outcomes for create, update, delete and override", async () => {
    const { repository } = harness([], {
      data: { status: "replayed", id: roleRow.id },
      error: null,
    });
    await expect(
      repository.create(
        "org-a",
        {
          name: "Support",
          description: null,
          color: "#4A50D6",
          baseRole: "member",
          permissions: {},
        },
        "actor-a",
        context,
      ),
    ).resolves.toEqual({ id: roleRow.id });
    await expect(
      repository.update(
        "org-a",
        roleRow.id,
        { isActive: false },
        "actor-a",
        context,
        1,
      ),
    ).resolves.toBeUndefined();
    await expect(
      repository.softDelete("org-a", roleRow.id, "actor-a", context, 2),
    ).resolves.toBeUndefined();
    await expect(
      repository.setOverride("org-a", "viewer", {}, "actor-a", context),
    ).resolves.toBeUndefined();
  });

  it("keeps identity and override reads organization-scoped", async () => {
    const role = harness([
      { data: { id: roleRow.id, is_system: false, version: 1 }, error: null },
    ]);
    await expect(role.repository.find("org-a", roleRow.id)).resolves.toEqual({
      id: roleRow.id,
      isSystem: false,
      version: 1,
    });
    expect(role.queries[0]?.eq).toHaveBeenCalledWith(
      "organization_id",
      "org-a",
    );
    const override = harness([
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
    await expect(override.repository.overrides("org-a")).resolves.toEqual({
      member: { can_view_users: true },
    });
    expect(override.queries[0]?.eq).toHaveBeenCalledWith(
      "organization_id",
      "org-a",
    );
  });

  it.each([
    ["not_found", "role_not_found"],
    ["system", "role_is_system"],
    ["conflict", "conflict"],
  ])("maps audited %s outcome to %s", async (status, code) => {
    const { repository } = harness([], { data: { status }, error: null });
    await expect(
      repository.update("org-a", roleRow.id, {}, "actor-a", context),
    ).rejects.toMatchObject({ code });
  });

  it("fails closed for provider outage, malformed result or absent actor context", async () => {
    const errorSpy = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    const outage = harness([], {
      data: null,
      error: { message: "database offline" },
    });
    await expect(
      outage.repository.softDelete("org-a", roleRow.id, "actor-a", context),
    ).rejects.toMatchObject({ code: "unavailable" });
    const malformed = harness([], { data: { status: "mystery" }, error: null });
    await expect(
      malformed.repository.setOverride(
        "org-a",
        "viewer",
        {},
        "actor-a",
        context,
      ),
    ).rejects.toMatchObject({ code: "unavailable" });
    const absent = harness([]);
    await expect(
      absent.repository.create("org-a", {
        name: "Support",
        description: null,
        color: "#4A50D6",
        baseRole: "member",
        permissions: {},
      }),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(absent.rpc).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });

  it("maps a same-tenant role-name collision", async () => {
    const { repository } = harness([], {
      data: null,
      error: { message: "duplicate key value" },
    });
    await expect(
      repository.create(
        "org-a",
        {
          name: "Support",
          description: null,
          color: "#4A50D6",
          baseRole: "member",
          permissions: {},
        },
        "actor-a",
        context,
      ),
    ).rejects.toEqual(new RoleRepositoryError("role_name_taken"));
  });
});
