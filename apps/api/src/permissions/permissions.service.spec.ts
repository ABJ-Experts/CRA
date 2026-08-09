import { ServiceUnavailableException } from "@nestjs/common";

import { PermissionsService } from "./permissions.service";

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

function chain(result: QueryResult) {
  const query = {
    select: jest.fn(),
    eq: jest.fn(),
    maybeSingle: jest.fn(),
    then: undefined as unknown as PromiseLike<QueryResult>["then"],
  };

  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue(result);
  query.then = ((resolve: (value: QueryResult) => unknown) =>
    Promise.resolve(result).then(resolve)) as PromiseLike<QueryResult>["then"];

  return query;
}

function serviceWithFailure(failedTable: string): {
  service: PermissionsService;
  from: jest.Mock;
} {
  const healthy: Record<string, QueryResult> = {
    organization_permissions_version: { data: { version: 7 }, error: null },
    user_role_assignments: { data: [], error: null },
    base_role_permission_overrides: { data: [], error: null },
    menu_permissions: { data: [], error: null },
  };
  const results = {
    ...healthy,
    [failedTable]: { data: null, error: { message: "boom" } },
  } satisfies Record<string, QueryResult>;
  const from = jest.fn((table: string) => chain(results[table]!));

  return {
    service: new PermissionsService({ admin: () => ({ from }) } as never),
    from,
  };
}

describe("PermissionsService failure posture", () => {
  it("does not restore base grants when overrides cannot be read", async () => {
    const results: Record<string, QueryResult> = {
      organization_permissions_version: { data: { version: 7 }, error: null },
      user_role_assignments: { data: [], error: null },
      base_role_permission_overrides: {
        data: null,
        error: { message: "database unavailable" },
      },
      menu_permissions: { data: [], error: null },
    };
    const supabase = {
      admin: () => ({
        from: (table: string) => chain(results[table]!),
      }),
    };
    const service = new PermissionsService(supabase as never);

    await expect(
      service.resolve("org-1", "user-1", "member"),
    ).rejects.toMatchObject({
      response: {
        code: "permissions_unavailable",
      },
    });
  });

  it("treats a missing organization permission version as corruption", async () => {
    const supabase = {
      admin: () => ({
        from: () => chain({ data: null, error: null }),
      }),
    };
    const service = new PermissionsService(supabase as never);

    await expect(
      service.resolve("org-1", "user-1", "member"),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it.each([
    "organization_permissions_version",
    "user_role_assignments",
    "base_role_permission_overrides",
    "menu_permissions",
  ])("returns 503 when %s is unreadable", async (failedTable) => {
    const { service, from } = serviceWithFailure(failedTable);

    await expect(
      service.resolve("org-1", "user-1", "member"),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      service.resolve("org-1", "user-1", "member"),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(
      from.mock.calls.filter(([table]) => table === failedTable),
    ).toHaveLength(2);
  });

  it("does not make authorization depend on menu visibility data", async () => {
    const { service } = serviceWithFailure("menu_permissions");

    await expect(
      service.effectivePermissions("org-1", "user-1", "member"),
    ).resolves.toMatchObject({ can_view_organization: true });
    await expect(
      service.can("org-1", "user-1", "member", ["can_view_organization"]),
    ).resolves.toBe(true);
    await expect(
      service.menu("org-1", "user-1", "member"),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("caches successful menu reads for the current permission version", async () => {
    const { service, from } = serviceWithFailure("unused_table");

    await service.resolve("org-1", "user-1", "member");
    await service.resolve("org-1", "user-1", "member");

    expect(
      from.mock.calls.filter(([table]) => table === "menu_permissions"),
    ).toHaveLength(1);
  });
});
