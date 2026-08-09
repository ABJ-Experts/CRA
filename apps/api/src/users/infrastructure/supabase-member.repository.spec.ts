import { Logger } from "@nestjs/common";
import type { PageParams } from "@repo/contracts/pagination";

import { MemberRepositoryError } from "../application/member-repository.port";
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

function harness(results: readonly QueryResult[]) {
  const queries: Array<ReturnType<typeof query>> = [];
  const from = jest.fn(() => {
    const result = results[queries.length];
    if (!result) throw new Error("Missing query result fixture");
    const current = query(result);
    queries.push(current);
    return current;
  });
  const repository = new SupabaseMemberRepository({
    admin: () => ({ from }),
  } as never);
  return { from, queries, repository };
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

  it("scopes role changes and removals to the organization", async () => {
    const role = harness([{ data: null, error: null }]);
    await role.repository.changeRole("org-a", "user-a", "viewer");
    expect(role.queries[0]?.update).toHaveBeenCalledWith({ role: "viewer" });
    expect(role.queries[0]?.eq).toHaveBeenCalledWith(
      "organization_id",
      "org-a",
    );
    expect(role.queries[0]?.eq).toHaveBeenCalledWith("user_id", "user-a");

    const removal = harness([{ data: null, error: null }]);
    await removal.repository.remove("org-b", "user-b");
    expect(removal.queries[0]?.delete).toHaveBeenCalledTimes(1);
    expect(removal.queries[0]?.eq).toHaveBeenCalledWith(
      "organization_id",
      "org-b",
    );
    expect(removal.queries[0]?.eq).toHaveBeenCalledWith("user_id", "user-b");
  });

  it("proves membership scope before activation touches the user table", async () => {
    const { from, queries, repository } = harness([
      { data: { role: "member" }, error: null },
      { data: null, error: null },
    ]);

    await repository.setActive("org-a", "user-a", false);

    expect(from).toHaveBeenNthCalledWith(1, "organization_members");
    expect(queries[0]?.eq).toHaveBeenCalledWith("organization_id", "org-a");
    expect(queries[0]?.eq).toHaveBeenCalledWith("user_id", "user-a");
    expect(from).toHaveBeenNthCalledWith(2, "users");
    expect(queries[1]?.update).toHaveBeenCalledWith({ is_active: false });
    expect(queries[1]?.eq).toHaveBeenCalledWith("id", "user-a");
  });

  it("does not activate a user without an organization membership", async () => {
    const { from, repository } = harness([{ data: null, error: null }]);

    await expect(
      repository.setActive("org-a", "user-a", true),
    ).rejects.toMatchObject({ code: "member_not_found" });
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("maps profile fields without inventing tenant scope", async () => {
    const { queries, repository } = harness([{ data: null, error: null }]);

    await repository.updateOwnProfile("user-a", {
      firstName: "Ada",
      lastName: "Lovelace",
      jobTitle: "Engineer",
      language: "en",
    });

    expect(queries[0]?.update).toHaveBeenCalledWith({
      first_name: "Ada",
      last_name: "Lovelace",
      job_title: "Engineer",
      language: "en",
    });
    expect(queries[0]?.eq).toHaveBeenCalledWith("id", "user-a");
  });

  it("supports an empty profile patch without writing undefined fields", async () => {
    const { queries, repository } = harness([{ data: null, error: null }]);

    await repository.updateOwnProfile("user-a", {});

    expect(queries[0]?.update).toHaveBeenCalledWith({});
  });

  it("fails closed on an invalid persisted base role", async () => {
    const errorSpy = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    const { repository } = harness([
      { data: { role: "future-super-admin" }, error: null },
    ]);

    await expect(
      repository.findMembership("org-a", "user-a"),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(errorSpy).toHaveBeenCalledWith(
      "Member query returned an invalid base role",
    );
    errorSpy.mockRestore();
  });

  it("recognizes last-owner failures without leaking Postgres details", async () => {
    const errorSpy = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    const { repository } = harness([
      {
        data: null,
        error: {
          message: "organization org-secret must retain at least one owner",
        },
      },
    ]);

    await expect(
      repository.changeRole("org-a", "user-a", "viewer"),
    ).rejects.toEqual(new MemberRepositoryError("last_owner"));
    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("org-secret"),
    );
    errorSpy.mockRestore();
  });

  it("logs generic persistence failures and exposes only a stable code", async () => {
    const errorSpy = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    const { repository } = harness([
      { data: null, error: { message: "connection unavailable" } },
    ]);

    await expect(repository.remove("org-a", "user-a")).rejects.toEqual(
      new MemberRepositoryError("unavailable"),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      "Member persistence failed: connection unavailable",
    );
    errorSpy.mockRestore();
  });

  it.each([
    ["count", [{ data: null, count: null, error: { message: "offline" } }]],
    [
      "rows",
      [
        { data: null, count: 1, error: null },
        { data: null, count: null, error: { message: "offline" } },
      ],
    ],
  ] as const)(
    "fails closed when the list %s query fails",
    async (_name, results) => {
      const errorSpy = jest
        .spyOn(Logger.prototype, "error")
        .mockImplementation(() => undefined);
      const { repository } = harness(results);

      await expect(repository.list("org-a", params)).rejects.toMatchObject({
        code: "unavailable",
      });
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("offline"));
      errorSpy.mockRestore();
    },
  );
});
