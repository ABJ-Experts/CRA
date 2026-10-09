import { Logger } from "@nestjs/common";
import type { PageParams } from "@repo/contracts/pagination";

import { SupabaseMemberRepository } from "./supabase-member.repository";

interface QueryResult {
  readonly data: unknown;
  readonly count?: number | null;
  readonly error: { readonly message: string } | null;
}

function query(result: QueryResult) {
  const chain = {
    select: jest.fn(),
    eq: jest.fn(),
    or: jest.fn(),
    order: jest.fn(),
    range: jest.fn(),
    maybeSingle: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    then: undefined as unknown as PromiseLike<QueryResult>["then"],
  };
  for (const method of [
    chain.select,
    chain.eq,
    chain.or,
    chain.order,
    chain.update,
    chain.delete,
  ]) {
    method.mockReturnValue(chain);
  }
  chain.range.mockResolvedValue(result);
  chain.maybeSingle.mockResolvedValue(result);
  chain.then = ((resolve: (value: QueryResult) => unknown) =>
    Promise.resolve(result).then(resolve)) as PromiseLike<QueryResult>["then"];
  return chain;
}

function harness(
  results: readonly QueryResult[],
  rpcResult: QueryResult = { data: { status: "updated" }, error: null },
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
  const repository = new SupabaseMemberRepository({
    admin: () => ({ from, rpc }),
  } as never);
  return { from, queries, repository, rpc };
}

const params = Object.freeze<PageParams>({
  page: 8,
  pageSize: 2,
  order: "desc",
});

describe("SupabaseMemberRepository", () => {
  it("scopes both list queries, clamps the page, and maps the public shape", async () => {
    const row = {
      role: "member",
      created_at: "2026-08-09T00:00:00.000Z",
      users: {
        id: "member-1",
        email: "member@cra.test",
        username: null,
        first_name: "Mem",
        last_name: "Ber",
        avatar_url: null,
        job_title: null,
        is_active: true,
      },
    };
    const { queries, repository } = harness([
      { data: null, count: 1, error: null },
      { data: [row, { ...row, users: null }], count: 1, error: null },
    ]);

    await expect(repository.list("org-a", params)).resolves.toEqual({
      rows: [
        {
          id: "member-1",
          email: "member@cra.test",
          username: null,
          firstName: "Mem",
          lastName: "Ber",
          avatarUrl: null,
          jobTitle: null,
          isActive: true,
          role: "member",
          joinedAt: "2026-08-09T00:00:00.000Z",
          roles: [],
        },
      ],
      total: 1,
      page: 1,
      pageSize: 2,
      pageCount: 1,
    });
    for (const current of queries) {
      expect(current.eq).toHaveBeenCalledWith("organization_id", "org-a");
    }
    expect(queries[1]?.order).toHaveBeenCalledWith("created_at", {
      ascending: false,
    });
    expect(queries[1]?.range).toHaveBeenCalledWith(0, 1);
  });

  it("applies the same embedded-user search to count and row queries", async () => {
    const { queries, repository } = harness([
      { data: null, count: 0, error: null },
      { data: [], count: 0, error: null },
    ]);

    await repository.list("org-a", { ...params, q: "Ada" });

    for (const current of queries) {
      expect(current.or).toHaveBeenCalledWith(
        "email.ilike.%Ada%,first_name.ilike.%Ada%,last_name.ilike.%Ada%,username.ilike.%Ada%",
        { referencedTable: "users" },
      );
    }
  });

  it("drops PostgREST structural characters instead of emitting raw filters", async () => {
    const { queries, repository } = harness([
      { data: null, count: null, error: null },
      { data: null, count: null, error: null },
    ]);

    await expect(
      repository.list("org-a", { ...params, q: ',()\\"' }),
    ).resolves.toEqual({
      rows: [],
      total: 0,
      page: 1,
      pageSize: 2,
      pageCount: 1,
    });
    expect(queries[0]?.or).not.toHaveBeenCalled();
    expect(queries[1]?.or).not.toHaveBeenCalled();
  });

  it("preserves dots in email searches while removing filter separators", async () => {
    const { queries, repository } = harness([
      { data: null, count: 0, error: null },
      { data: [], count: 0, error: null },
    ]);

    await repository.list("org-a", {
      ...params,
      q: "ada@example.com,()",
    });

    expect(queries[0]?.or).toHaveBeenCalledWith(
      "email.ilike.%ada@example.com%,first_name.ilike.%ada@example.com%,last_name.ilike.%ada@example.com%,username.ilike.%ada@example.com%",
      { referencedTable: "users" },
    );
  });

  it("scopes membership lookup to organization and user", async () => {
    const { queries, repository } = harness([
      { data: { role: "admin" }, error: null },
    ]);

    await expect(repository.findMembership("org-a", "user-a")).resolves.toEqual(
      { role: "admin" },
    );
    expect(queries[0]?.eq).toHaveBeenNthCalledWith(
      1,
      "organization_id",
      "org-a",
    );
    expect(queries[0]?.eq).toHaveBeenNthCalledWith(2, "user_id", "user-a");
  });

  it("fails closed when persisted membership has an unknown base role", async () => {
    const errorSpy = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    const { repository } = harness([
      { data: { role: "operator" }, error: null },
    ]);

    await expect(
      repository.findMembership("org-a", "user-a"),
    ).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "Member query returned an invalid base role",
    );
    errorSpy.mockRestore();
  });

  const context = {
    eventKey: "11111111-1111-4111-8111-111111111111",
    correlationId: "22222222-2222-4222-8222-222222222222",
    sourceIp: "127.0.0.1",
  };

  it("uses one scoped RPC for each audited member mutation", async () => {
    const { repository, rpc, from } = harness([]);
    await repository.changeRole(
      "org-a",
      "user-a",
      "viewer",
      "actor-a",
      context,
      "member",
    );
    await repository.remove("org-a", "user-a", "actor-a", context);
    await repository.setActive("org-a", "user-a", false, "actor-a", context);

    expect(rpc).toHaveBeenNthCalledWith(1, "m13_01_mutate_member_atomic", {
      p_organization_id: "org-a",
      p_actor_user_id: "actor-a",
      p_target_user_id: "user-a",
      p_operation: "role",
      p_payload: { role: "viewer" },
      p_expected_role: "member",
      p_event_key: context.eventKey,
      p_correlation_id: context.correlationId,
      p_source_ip: context.sourceIp,
    });
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "m13_01_mutate_member_atomic",
      expect.objectContaining({
        p_organization_id: "org-a",
        p_operation: "remove",
        p_payload: {},
      }),
    );
    expect(rpc).toHaveBeenNthCalledWith(
      3,
      "m13_01_mutate_member_atomic",
      expect.objectContaining({
        p_organization_id: "org-a",
        p_operation: "active",
        p_payload: { isActive: false },
      }),
    );
    expect(from).not.toHaveBeenCalled();
  });

  it.each([
    ["not_found", "member_not_found"],
    ["conflict", "conflict"],
  ])("maps audited %s outcome to %s", async (status, code) => {
    const { repository } = harness([], { data: { status }, error: null });
    await expect(
      repository.remove("org-a", "user-a", "actor-a", context),
    ).rejects.toMatchObject({ code });
  });

  it("fails closed if the audit RPC fails or returns malformed data", async () => {
    const errorSpy = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    const failure = harness([], {
      data: null,
      error: { message: "connection unavailable" },
    });
    await expect(
      failure.repository.setActive("org-a", "user-a", true, "actor-a", context),
    ).rejects.toMatchObject({ code: "unavailable" });
    const malformed = harness([], { data: { status: "mystery" }, error: null });
    await expect(
      malformed.repository.remove("org-a", "user-a", "actor-a", context),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(errorSpy).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });

  it("preserves the last-owner protection reported by the atomic RPC", async () => {
    const { repository } = harness([], {
      data: null,
      error: { message: "organization must retain at least one owner" },
    });

    await expect(
      repository.remove("org-a", "owner-a", "actor-a", context),
    ).rejects.toMatchObject({ code: "last_owner" });
  });

  it("updates only the verified actor profile through the atomic RPC", async () => {
    const { repository, rpc, from } = harness([]);
    await repository.updateOwnProfile(
      "org-a",
      "user-a",
      { firstName: "Ada", language: "en" },
      context,
    );
    expect(rpc).toHaveBeenCalledWith("m13_01_update_profile_atomic", {
      p_organization_id: "org-a",
      p_actor_user_id: "user-a",
      p_patch: { first_name: "Ada", language: "en" },
      p_event_key: context.eventKey,
      p_correlation_id: context.correlationId,
      p_source_ip: context.sourceIp,
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("requires actor and identity context before using service role", async () => {
    const { repository, rpc } = harness([]);
    await expect(
      repository.changeRole("org-a", "user-a", "viewer"),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(rpc).not.toHaveBeenCalled();
  });
});
