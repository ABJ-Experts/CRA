import { SupabaseTenantScopeAccessAdapter } from "./supabase-tenant-scope-access.adapter";

const organizationId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";
const sessionId = "00000000-0000-4000-8000-000000000003";

function chain(
  results: readonly Readonly<{ data: unknown; error: unknown }>[],
) {
  let index = 0;
  const queries: Array<Record<string, jest.Mock>> = [];
  const from = jest.fn().mockImplementation(() => {
    const result = results[index++];
    const query = {
      select: jest.fn(),
      eq: jest.fn(),
      maybeSingle: jest.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.maybeSingle.mockResolvedValue(result);
    queries.push(query);
    return query;
  });
  return { from, queries };
}

describe("SupabaseTenantScopeAccessAdapter", () => {
  const scope = Object.freeze({
    organizationId,
    userId,
    sessionId,
    issuedAt: "2026-08-10T12:00:00.000Z",
    allowRecovery: false,
  });

  function activeAdapter(
    rpcResult: Readonly<{ data: unknown; error: unknown }>,
    queryResults: readonly Readonly<{ data: unknown; error: unknown }>[],
  ) {
    const { from } = chain(queryResults);
    return new SupabaseTenantScopeAccessAdapter(
      {
        admin: () => ({
          rpc: jest.fn().mockResolvedValue(rpcResult),
          from,
        }),
      } as never,
      { now: () => new Date("2026-08-10T12:30:00.000Z") },
    );
  }

  it("registers and accepts only an active, unrevoked, within-age tenant session", async () => {
    const { from, queries } = chain([
      { data: { status: "active" }, error: null },
      { data: null, error: null },
      { data: { maximum_session_age_minutes: 60 }, error: null },
    ]);
    const rpc = jest.fn().mockResolvedValue({
      data: [{ outcome: "registered" }],
      error: null,
    });
    const adapter = new SupabaseTenantScopeAccessAdapter(
      { admin: () => ({ rpc, from }) } as never,
      { now: () => new Date("2026-08-10T12:30:00.000Z") },
    );

    await expect(
      adapter.authorize({
        organizationId,
        userId,
        sessionId,
        issuedAt: "2026-08-10T12:00:00.000Z",
        allowRecovery: false,
      }),
    ).resolves.toEqual({ outcome: "allowed" });
    expect(rpc).toHaveBeenCalledWith("register_organization_session_atomic", {
      p_organization_id: organizationId,
      p_user_id: userId,
      p_session_id: sessionId,
      p_issued_at: "2026-08-10T12:00:00.000Z",
    });
    expect(queries[0]?.eq).toHaveBeenCalledWith(
      "organization_id",
      organizationId,
    );
  });

  it("blocks only the selected tenant when the session is revoked or over age", async () => {
    const revoked = chain([
      { data: { status: "active" }, error: null },
      { data: { session_id: sessionId }, error: null },
      { data: { maximum_session_age_minutes: 60 }, error: null },
    ]);
    const rpc = jest.fn().mockResolvedValue({
      data: [{ outcome: "registered" }],
      error: null,
    });
    const adapter = new SupabaseTenantScopeAccessAdapter(
      { admin: () => ({ rpc, from: revoked.from }) } as never,
      { now: () => new Date("2026-08-10T12:30:00.000Z") },
    );

    await expect(
      adapter.authorize({
        organizationId,
        userId,
        sessionId,
        issuedAt: "2026-08-10T12:00:00.000Z",
        allowRecovery: false,
      }),
    ).resolves.toEqual({ outcome: "revoked" });
  });

  it("blocks a selected tenant when its configured maximum session age elapsed", async () => {
    const { from } = chain([
      { data: { status: "active" }, error: null },
      { data: null, error: null },
      { data: { maximum_session_age_minutes: 15 }, error: null },
    ]);
    const adapter = new SupabaseTenantScopeAccessAdapter(
      {
        admin: () => ({
          rpc: jest.fn().mockResolvedValue({
            data: [{ outcome: "registered" }],
            error: null,
          }),
          from,
        }),
      } as never,
      { now: () => new Date("2026-08-10T12:30:00.000Z") },
    );

    await expect(
      adapter.authorize({
        organizationId,
        userId,
        sessionId,
        issuedAt: "2026-08-10T12:00:00.000Z",
        allowRecovery: false,
      }),
    ).resolves.toEqual({ outcome: "expired" });
  });

  it("binds a new inactive-tenant session before permitting owner recovery", async () => {
    const { from } = chain([
      { data: { status: "deactivated" }, error: null },
      { data: { role: "owner" }, error: null },
    ]);
    const rpc = jest.fn().mockResolvedValue({
      data: [{ outcome: "registered" }],
      error: null,
    });
    const adapter = new SupabaseTenantScopeAccessAdapter(
      { admin: () => ({ rpc, from }) } as never,
      { now: () => new Date("2026-08-10T12:30:00.000Z") },
    );

    await expect(
      adapter.authorize({
        organizationId,
        userId,
        sessionId,
        issuedAt: "2026-08-10T12:00:00.000Z",
        allowRecovery: true,
      }),
    ).resolves.toEqual({ outcome: "allowed" });
    expect(rpc).toHaveBeenCalledWith("register_organization_session_atomic", {
      p_organization_id: organizationId,
      p_user_id: userId,
      p_session_id: sessionId,
      p_issued_at: "2026-08-10T12:00:00.000Z",
    });
  });

  it.each([
    [
      "revoked",
      [
        { data: { status: "active" }, error: null },
        { data: { status: "active" }, error: null },
        { data: { session_id: sessionId }, error: null },
      ],
    ],
    [
      "expired",
      [
        { data: { status: "active" }, error: null },
        { data: { status: "active" }, error: null },
        { data: null, error: null },
        { data: { maximum_session_age_minutes: 15 }, error: null },
      ],
    ],
  ] as const)(
    "does not let recovery metadata bypass an active %s session",
    async (expected, results) => {
      const { from } = chain(results);
      const rpc = jest.fn().mockResolvedValue({
        data: [{ outcome: "registered" }],
        error: null,
      });
      const adapter = new SupabaseTenantScopeAccessAdapter(
        { admin: () => ({ rpc, from }) } as never,
        { now: () => new Date("2026-08-10T12:30:00.000Z") },
      );

      await expect(
        adapter.authorize({ ...scope, allowRecovery: true }),
      ).resolves.toEqual({ outcome: expected });
      expect(rpc).toHaveBeenCalledWith(
        "register_organization_session_atomic",
        expect.objectContaining({ p_session_id: sessionId }),
      );
      expect(from).not.toHaveBeenCalledWith("organization_members");
    },
  );

  it.each([
    [{ data: null, error: { message: "private" } }, "unavailable"],
    [{ data: [{ outcome: "not_found" }], error: null }, "not_found"],
    [{ data: [{ outcome: "unexpected" }], error: null }, "malformed"],
  ] as const)(
    "fails closed when inactive recovery session binding returns %s",
    async (rpcResult, expected) => {
      const { from } = chain([
        { data: { status: "deactivated" }, error: null },
        { data: { role: "owner" }, error: null },
      ]);
      const adapter = new SupabaseTenantScopeAccessAdapter({
        admin: () => ({
          rpc: jest.fn().mockResolvedValue(rpcResult),
          from,
        }),
      } as never);

      await expect(
        adapter.authorize({ ...scope, allowRecovery: true }),
      ).resolves.toEqual({ outcome: expected });
    },
  );

  it.each([
    [
      "registration provider failure",
      { data: null, error: { message: "private" } },
      [],
      "unavailable",
    ],
    [
      "missing membership",
      { data: [{ outcome: "not_found" }], error: null },
      [],
      "not_found",
    ],
    ["malformed registration", { data: [], error: null }, [], "malformed"],
    [
      "lifecycle provider failure",
      { data: [{ outcome: "registered" }], error: null },
      [{ data: null, error: { message: "private" } }],
      "unavailable",
    ],
    [
      "missing lifecycle",
      { data: [{ outcome: "registered" }], error: null },
      [{ data: null, error: null }],
      "not_found",
    ],
    [
      "malformed lifecycle",
      { data: [{ outcome: "registered" }], error: null },
      [{ data: { status: 1 }, error: null }],
      "malformed",
    ],
    [
      "inactive lifecycle",
      { data: [{ outcome: "registered" }], error: null },
      [{ data: { status: "deactivated" }, error: null }],
      "inactive",
    ],
    [
      "revocation provider failure",
      { data: [{ outcome: "registered" }], error: null },
      [
        { data: { status: "active" }, error: null },
        { data: null, error: { message: "private" } },
      ],
      "unavailable",
    ],
    [
      "malformed revocation",
      { data: [{ outcome: "registered" }], error: null },
      [
        { data: { status: "active" }, error: null },
        { data: { session_id: "not-a-uuid" }, error: null },
      ],
      "malformed",
    ],
    [
      "settings provider failure",
      { data: [{ outcome: "registered" }], error: null },
      [
        { data: { status: "active" }, error: null },
        { data: null, error: null },
        { data: null, error: { message: "private" } },
      ],
      "unavailable",
    ],
    [
      "missing settings",
      { data: [{ outcome: "registered" }], error: null },
      [
        { data: { status: "active" }, error: null },
        { data: null, error: null },
        { data: null, error: null },
      ],
      "allowed",
    ],
    [
      "malformed settings",
      { data: [{ outcome: "registered" }], error: null },
      [
        { data: { status: "active" }, error: null },
        { data: null, error: null },
        { data: { maximum_session_age_minutes: 0 }, error: null },
      ],
      "malformed",
    ],
    [
      "unlimited session age",
      { data: [{ outcome: "registered" }], error: null },
      [
        { data: { status: "active" }, error: null },
        { data: null, error: null },
        { data: { maximum_session_age_minutes: null }, error: null },
      ],
      "allowed",
    ],
  ] as const)(
    "fails closed for %s",
    async (_label, rpcResult, queryResults, expected) => {
      await expect(
        activeAdapter(rpcResult, queryResults).authorize(scope),
      ).resolves.toEqual({ outcome: expected });
    },
  );

  it("rejects an invalid issued-at value and exercises the system clock", async () => {
    const invalidDate = activeAdapter(
      { data: [{ outcome: "registered" }], error: null },
      [
        { data: { status: "active" }, error: null },
        { data: null, error: null },
        { data: { maximum_session_age_minutes: 60 }, error: null },
      ],
    );
    const { from } = chain([
      { data: { status: "active" }, error: null },
      { data: null, error: null },
      { data: { maximum_session_age_minutes: 1 }, error: null },
    ]);
    const systemClockAdapter = new SupabaseTenantScopeAccessAdapter({
      admin: () => ({
        rpc: jest.fn().mockResolvedValue({
          data: [{ outcome: "registered" }],
          error: null,
        }),
        from,
      }),
    } as never);

    await expect(
      invalidDate.authorize({ ...scope, issuedAt: "not-a-date" }),
    ).resolves.toEqual({ outcome: "malformed" });
    await expect(
      systemClockAdapter.authorize({
        ...scope,
        issuedAt: "2020-01-01T00:00:00.000Z",
      }),
    ).resolves.toEqual({ outcome: "expired" });
  });

  it.each([
    [
      "lifecycle provider failure",
      [{ data: null, error: { message: "private" } }],
      "unavailable",
    ],
    ["missing lifecycle", [{ data: null, error: null }], "not_found"],
    [
      "malformed lifecycle",
      [{ data: { status: 1 }, error: null }],
      "malformed",
    ],
    [
      "terminal lifecycle",
      [{ data: { status: "purged" }, error: null }],
      "inactive",
    ],
    [
      "membership provider failure",
      [
        { data: { status: "deactivated" }, error: null },
        { data: null, error: { message: "private" } },
      ],
      "unavailable",
    ],
    [
      "missing membership",
      [
        { data: { status: "deactivated" }, error: null },
        { data: null, error: null },
      ],
      "not_found",
    ],
    [
      "non-owner membership",
      [
        { data: { status: "deactivated" }, error: null },
        { data: { role: "admin" }, error: null },
      ],
      "not_found",
    ],
  ] as const)(
    "fails closed during recovery for %s",
    async (_label, results, expected) => {
      const { from } = chain(results);
      const adapter = new SupabaseTenantScopeAccessAdapter({
        admin: () => ({ rpc: jest.fn(), from }),
      } as never);

      await expect(
        adapter.authorize({ ...scope, allowRecovery: true }),
      ).resolves.toEqual({ outcome: expected });
    },
  );

  it("converts unexpected provider exceptions into unavailable", async () => {
    const adapter = new SupabaseTenantScopeAccessAdapter({
      admin: () => {
        throw new Error("private provider failure");
      },
    } as never);

    await expect(adapter.authorize(scope)).resolves.toEqual({
      outcome: "unavailable",
    });
  });
});
