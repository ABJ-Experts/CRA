import { Logger } from "@nestjs/common";

import { PermissionDataUnavailableError } from "../application/permission-data.port";
import { SupabasePermissionDataAdapter } from "./supabase-permission-data.adapter";

interface QueryResult {
  readonly data: unknown;
  readonly error: { readonly message: string } | null;
}

function query(result: QueryResult) {
  const chain = {
    select: jest.fn(),
    eq: jest.fn(),
    maybeSingle: jest.fn(),
    then: undefined as unknown as PromiseLike<QueryResult>["then"],
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.maybeSingle.mockResolvedValue(result);
  chain.then = ((resolve: (value: QueryResult) => unknown) =>
    Promise.resolve(result).then(resolve)) as PromiseLike<QueryResult>["then"];
  return chain;
}

function harness(results: Record<string, QueryResult>) {
  const queries = new Map<string, ReturnType<typeof query>>();
  const from = jest.fn((table: string) => {
    const current = query(results[table]!);
    queries.set(table, current);
    return current;
  });
  const adapter = new SupabasePermissionDataAdapter({
    admin: () => ({ from }),
  } as never);
  return { adapter, from, queries };
}

const healthyResults: Record<string, QueryResult> = {
  organization_permissions_version: { data: { version: 9 }, error: null },
  user_role_assignments: {
    data: [
      {
        custom_roles: {
          id: "role-a",
          name: "Readers",
          base_role: "viewer",
          permissions: { can_view_users: true },
          is_active: true,
          is_deleted: false,
        },
      },
      { custom_roles: null },
    ],
    error: null,
  },
  base_role_permission_overrides: {
    data: { permissions: { can_view_users: false } },
    error: null,
  },
  menu_permissions: {
    data: [
      {
        menu_key: "management",
        target_type: "base_role",
        user_id: null,
        base_role: "viewer",
        can_view: true,
      },
      {
        menu_key: "management",
        target_type: "user",
        user_id: "user-a",
        base_role: null,
        can_view: false,
      },
      {
        menu_key: "unknown",
        target_type: "user",
        user_id: "user-a",
        base_role: null,
        can_view: true,
      },
    ],
    error: null,
  },
};

describe("SupabasePermissionDataAdapter", () => {
  it("scopes every service-role query to the exact organization", async () => {
    const { adapter, queries } = harness(healthyResults);

    await adapter.version("org-a");
    await adapter.assignedRoles("org-a", "user-a");
    await adapter.baseRoleOverrides("org-a", "viewer");
    await adapter.menuRules("org-a", "user-a", "viewer");

    for (const table of Object.keys(healthyResults)) {
      expect(queries.get(table)?.eq).toHaveBeenCalledWith(
        "organization_id",
        "org-a",
      );
    }
    expect(queries.get("user_role_assignments")?.eq).toHaveBeenCalledWith(
      "user_id",
      "user-a",
    );
    expect(
      queries.get("base_role_permission_overrides")?.eq,
    ).toHaveBeenCalledWith("base_role", "viewer");
  });

  it("maps database records without trusting stale role or menu rows", async () => {
    const { adapter } = harness(healthyResults);

    await expect(adapter.version("org-a")).resolves.toBe(9);
    await expect(adapter.assignedRoles("org-a", "user-a")).resolves.toEqual([
      {
        id: "role-a",
        name: "Readers",
        base_role: "viewer",
        permissions: { can_view_users: true },
        is_active: true,
        is_deleted: false,
      },
    ]);
    await expect(adapter.baseRoleOverrides("org-a", "viewer")).resolves.toEqual(
      { can_view_users: false },
    );
    await expect(
      adapter.menuRules("org-a", "user-a", "viewer"),
    ).resolves.toEqual({ management: false });
  });

  it.each(Object.keys(healthyResults))(
    "logs and maps a %s read error to the framework-free error",
    async (failedTable) => {
      const errorSpy = jest
        .spyOn(Logger.prototype, "error")
        .mockImplementation(() => undefined);
      const { adapter } = harness({
        ...healthyResults,
        [failedTable]: { data: null, error: { message: "database offline" } },
      });
      const operation =
        failedTable === "organization_permissions_version"
          ? adapter.version("org-a")
          : failedTable === "user_role_assignments"
            ? adapter.assignedRoles("org-a", "user-a")
            : failedTable === "base_role_permission_overrides"
              ? adapter.baseRoleOverrides("org-a", "viewer")
              : adapter.menuRules("org-a", "user-a", "viewer");

      await expect(operation).rejects.toBeInstanceOf(
        PermissionDataUnavailableError,
      );
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("database offline"),
      );
      errorSpy.mockRestore();
    },
  );

  it("treats a missing permission version row as unavailable", async () => {
    const errorSpy = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    const { adapter } = harness({
      ...healthyResults,
      organization_permissions_version: { data: null, error: null },
    });

    await expect(adapter.version("org-a")).rejects.toBeInstanceOf(
      PermissionDataUnavailableError,
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("version row missing"),
    );
    errorSpy.mockRestore();
  });
});
