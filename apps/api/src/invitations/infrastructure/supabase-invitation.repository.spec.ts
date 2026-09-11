import { SupabaseInvitationRepository } from "./supabase-invitation.repository";

type ProviderResult = Readonly<{
  data: unknown;
  error: Readonly<{ message: string }> | null;
}>;

function query(result: ProviderResult) {
  const builder = {
    eq: jest.fn(),
    insert: jest.fn(),
    maybeSingle: jest.fn(),
    order: jest.fn(),
    select: jest.fn(),
    single: jest.fn(),
  };
  builder.eq.mockReturnValue(builder);
  builder.insert.mockReturnValue(builder);
  builder.maybeSingle.mockResolvedValue(result);
  builder.order.mockResolvedValue(result);
  builder.select.mockReturnValue(builder);
  builder.single.mockResolvedValue(result);
  return builder;
}

function fixture(
  tables: Readonly<Record<string, readonly ProviderResult[]>> = {},
  rpcResults: Readonly<Record<string, readonly ProviderResult[]>> = {},
) {
  const builders = Object.fromEntries(
    Object.entries(tables).map(([table, results]) => [
      table,
      results.map(query),
    ]),
  ) as Record<string, ReturnType<typeof query>[]>;
  const tableIndexes: Record<string, number> = {};
  const from = jest.fn((table: string) => {
    const index = tableIndexes[table] ?? 0;
    tableIndexes[table] = index + 1;
    const builder = builders[table]?.[index];
    if (!builder) throw new Error(`Unexpected ${table} query ${index + 1}`);
    return builder;
  });

  const rpcIndexes: Record<string, number> = {};
  const rpc = jest.fn((name: string) => {
    const index = rpcIndexes[name] ?? 0;
    rpcIndexes[name] = index + 1;
    const result = rpcResults[name]?.[index];
    if (!result) throw new Error(`Unexpected ${name} RPC ${index + 1}`);
    return Promise.resolve(result);
  });
  const repository = new SupabaseInvitationRepository({
    admin: () => ({ from, rpc }),
  } as never);

  return { builders, from, repository, rpc };
}

const invitationId = "2ad67e3b-6e5e-4cde-870f-2225e7da1200";
const organizationId = "2ad67e3b-6e5e-4cde-870f-2225e7da1201";
const userId = "2ad67e3b-6e5e-4cde-870f-2225e7da1202";
const invitationRow = Object.freeze({
  id: invitationId,
  email: "member@cra.test",
  role: "member",
  status: "pending",
  expires_at: "2026-08-16T00:00:00.000Z",
});
const acceptedRow = Object.freeze({
  outcome: "accepted",
  invitation_id: invitationId,
  organization_id: organizationId,
  organization_name: "CRA",
  organization_slug: "cra",
});
const resentRow = Object.freeze({
  outcome: "resent",
  invitation_id: invitationId,
  email: "member@cra.test",
  organization_name: "CRA",
});

describe("SupabaseInvitationRepository create reads", () => {
  it("finds an existing account by canonical email", async () => {
    const { builders, repository } = fixture({
      users: [{ data: { id: userId }, error: null }],
    });

    await expect(
      repository.findExistingUser("member@cra.test"),
    ).resolves.toEqual({
      id: userId,
    });
    expect(builders.users?.[0]?.select).toHaveBeenCalledWith("id");
    expect(builders.users?.[0]?.eq).toHaveBeenCalledWith(
      "email",
      "member@cra.test",
    );
  });

  it("returns null when no existing account is present", async () => {
    const { repository } = fixture({
      users: [{ data: null, error: null }],
    });

    await expect(
      repository.findExistingUser("member@cra.test"),
    ).resolves.toBeNull();
  });

  it("scopes membership lookup to organization before user", async () => {
    const { builders, repository } = fixture({
      organization_members: [{ data: { id: "membership-1" }, error: null }],
    });

    await expect(repository.isMember(organizationId, userId)).resolves.toBe(
      true,
    );
    expect(builders.organization_members?.[0]?.eq.mock.calls).toEqual([
      ["organization_id", organizationId],
      ["user_id", userId],
    ]);
  });

  it("returns false when no membership is present", async () => {
    const { repository } = fixture({
      organization_members: [{ data: null, error: null }],
    });

    await expect(repository.isMember(organizationId, userId)).resolves.toBe(
      false,
    );
  });

  it("scopes pending lookup to organization, email, and pending state", async () => {
    const { builders, repository } = fixture({
      invitations: [{ data: null, error: null }],
    });

    await expect(
      repository.hasPending(organizationId, "member@cra.test"),
    ).resolves.toBe(false);
    expect(builders.invitations?.[0]?.eq.mock.calls).toEqual([
      ["organization_id", organizationId],
      ["email", "member@cra.test"],
      ["status", "pending"],
    ]);
  });

  it("returns true only for a concrete pending row", async () => {
    const { repository } = fixture({
      invitations: [{ data: { id: invitationId }, error: null }],
    });

    await expect(
      repository.hasPending(organizationId, "member@cra.test"),
    ).resolves.toBe(true);
  });

  it("writes every invitation field with explicit tenant ownership", async () => {
    const { builders, repository } = fixture({
      invitations: [{ data: { id: invitationId }, error: null }],
    });

    await expect(
      repository.insert(organizationId, {
        invitedBy: userId,
        email: "member@cra.test",
        role: "member",
        firstName: null,
        lastName: "Member",
        tokenHash: "hashed-token",
        expiresAt: "2026-08-16T00:00:00.000Z",
      }),
    ).resolves.toEqual({ id: invitationId });
    expect(builders.invitations?.[0]?.insert).toHaveBeenCalledWith({
      organization_id: organizationId,
      invited_by: userId,
      email: "member@cra.test",
      role: "member",
      first_name: null,
      last_name: "Member",
      token_hash: "hashed-token",
      expires_at: "2026-08-16T00:00:00.000Z",
    });
  });

  it("returns a validated organization summary", async () => {
    const { builders, repository } = fixture({
      organizations: [
        {
          data: { id: organizationId, name: "CRA", slug: "cra" },
          error: null,
        },
      ],
    });

    await expect(repository.organization(organizationId)).resolves.toEqual({
      id: organizationId,
      name: "CRA",
      slug: "cra",
    });
    expect(builders.organizations?.[0]?.eq).toHaveBeenCalledWith(
      "id",
      organizationId,
    );
  });

  it("returns null when the organization is absent", async () => {
    const { repository } = fixture({
      organizations: [{ data: null, error: null }],
    });

    await expect(repository.organization(organizationId)).resolves.toBeNull();
  });

  it.each([
    ["find", { users: [{ data: null, error: { message: "offline" } }] }],
    [
      "member",
      {
        organization_members: [{ data: null, error: { message: "offline" } }],
      },
    ],
    [
      "pending",
      { invitations: [{ data: null, error: { message: "offline" } }] },
    ],
    [
      "insert",
      { invitations: [{ data: null, error: { message: "offline" } }] },
    ],
    [
      "organization",
      { organizations: [{ data: null, error: { message: "offline" } }] },
    ],
  ] as const)("rejects a %s provider error", async (operation, tables) => {
    const { repository } = fixture(tables);
    const action = {
      find: () => repository.findExistingUser("member@cra.test"),
      member: () => repository.isMember(organizationId, userId),
      pending: () => repository.hasPending(organizationId, "member@cra.test"),
      insert: () =>
        repository.insert(organizationId, {
          invitedBy: userId,
          email: "member@cra.test",
          role: "member",
          firstName: null,
          lastName: null,
          tokenHash: "hashed-token",
          expiresAt: "2026-08-16T00:00:00.000Z",
        }),
      organization: () => repository.organization(organizationId),
    }[operation];

    await expect(action()).rejects.toThrow(
      "Invitation repository operation failed",
    );
  });

  it.each([
    [
      "existing user",
      { users: [{ data: {}, error: null }] },
      "findExistingUser",
    ],
    [
      "insert",
      { invitations: [{ data: {}, error: null }] },
      "insertInvitation",
    ],
    [
      "organization",
      { organizations: [{ data: { id: "bad" }, error: null }] },
      "organization",
    ],
  ] as const)(
    "rejects a malformed %s row",
    async (_label, tables, operation) => {
      const { repository } = fixture(tables);
      const action = {
        findExistingUser: () => repository.findExistingUser("member@cra.test"),
        insertInvitation: () =>
          repository.insert(organizationId, {
            invitedBy: userId,
            email: "member@cra.test",
            role: "member",
            firstName: null,
            lastName: null,
            tokenHash: "hashed-token",
            expiresAt: "2026-08-16T00:00:00.000Z",
          }),
        organization: () => repository.organization(organizationId),
      }[operation];

      await expect(action()).rejects.toThrow(
        "Invitation repository returned malformed data",
      );
    },
  );

  it.each([
    ["existing user", { users: [{ data: [], error: null }] }, "find"],
    [
      "membership",
      { organization_members: [{ data: [], error: null }] },
      "member",
    ],
    [
      "pending invitation",
      { invitations: [{ data: [], error: null }] },
      "pending",
    ],
    [
      "inserted invitation",
      { invitations: [{ data: [], error: null }] },
      "insert",
    ],
  ] as const)(
    "rejects a non-record %s provider row",
    async (_label, tables, operation) => {
      const { repository } = fixture(tables);
      const action = {
        find: () => repository.findExistingUser("member@cra.test"),
        member: () => repository.isMember(organizationId, userId),
        pending: () => repository.hasPending(organizationId, "member@cra.test"),
        insert: () =>
          repository.insert(organizationId, {
            invitedBy: userId,
            email: "member@cra.test",
            role: "member",
            firstName: null,
            lastName: null,
            tokenHash: "hashed-token",
            expiresAt: "2026-08-16T00:00:00.000Z",
          }),
      }[operation];

      await expect(action()).rejects.toThrow(
        "Invitation repository returned malformed data",
      );
    },
  );
});

describe("SupabaseInvitationRepository atomic acceptance", () => {
  it.each(["accepted", "already_accepted"] as const)(
    "maps the %s result and exact RPC arguments",
    async (outcome) => {
      const { repository, rpc } = fixture(
        {},
        {
          accept_invitation_atomic: [
            { data: [{ ...acceptedRow, outcome }], error: null },
          ],
        },
      );

      await expect(
        repository.acceptAtomic("hashed-token", {
          id: userId,
          email: "member@cra.test",
        }),
      ).resolves.toEqual({
        outcome,
        invitationId,
        organization: { id: organizationId, name: "CRA", slug: "cra" },
      });
      expect(rpc).toHaveBeenCalledWith("accept_invitation_atomic", {
        p_token_hash: "hashed-token",
        p_user_id: userId,
        p_email: "member@cra.test",
      });
    },
  );

  it.each([
    "not_found",
    "expired",
    "email_mismatch",
    "not_pending",
    "organization_not_found",
    "user_not_found",
  ] as const)("maps the %s failure outcome", async (outcome) => {
    const { repository } = fixture(
      {},
      {
        accept_invitation_atomic: [
          { data: [{ ...acceptedRow, outcome }], error: null },
        ],
      },
    );

    await expect(
      repository.acceptAtomic("hashed-token", {
        id: userId,
        email: "member@cra.test",
      }),
    ).resolves.toEqual({ outcome });
  });

  it.each([
    { data: null, error: { message: "offline" } },
    { data: null, error: null },
    { data: [], error: null },
    { data: [acceptedRow, acceptedRow], error: null },
    {
      data: [{ ...acceptedRow, invitation_id: null }],
      error: null,
    },
    {
      data: [{ ...acceptedRow, outcome: "future_outcome" }],
      error: null,
    },
  ] as const)(
    "rejects an invalid acceptance provider result %#",
    async (result) => {
      const { repository } = fixture(
        {},
        {
          accept_invitation_atomic: [result],
        },
      );

      await expect(
        repository.acceptAtomic("hashed-token", {
          id: userId,
          email: "member@cra.test",
        }),
      ).rejects.toThrow();
    },
  );

  it("rejects accepted results with a malformed organization", async () => {
    const { repository } = fixture(
      {},
      {
        accept_invitation_atomic: [
          {
            data: [{ ...acceptedRow, organization_name: null }],
            error: null,
          },
        ],
      },
    );

    await expect(
      repository.acceptAtomic("hashed-token", {
        id: userId,
        email: "member@cra.test",
      }),
    ).rejects.toThrow("Invitation repository returned malformed data");
  });
});

describe("SupabaseInvitationRepository atomic revocation", () => {
  it.each([
    "revoked",
    "not_found",
    "already_accepted",
    "not_pending",
    "actor_not_found",
    "actor_email_mismatch",
  ] as const)("maps the %s result and exact RPC arguments", async (outcome) => {
    const { repository, rpc } = fixture(
      {},
      {
        revoke_invitation_atomic: [{ data: outcome, error: null }],
      },
    );

    await expect(
      repository.revokeAtomic(organizationId, invitationId, {
        id: userId,
        email: "owner@cra.test",
      }),
    ).resolves.toBe(outcome);
    expect(rpc).toHaveBeenCalledWith("revoke_invitation_atomic", {
      p_organization_id: organizationId,
      p_invitation_id: invitationId,
      p_actor_user_id: userId,
      p_actor_email: "owner@cra.test",
    });
  });

  it.each([
    { data: null, error: { message: "offline" } },
    { data: null, error: null },
    { data: "future_outcome", error: null },
  ] as const)(
    "rejects an invalid revocation provider result %#",
    async (result) => {
      const { repository } = fixture(
        {},
        {
          revoke_invitation_atomic: [result],
        },
      );

      await expect(
        repository.revokeAtomic(organizationId, invitationId, {
          id: userId,
          email: "owner@cra.test",
        }),
      ).rejects.toThrow();
    },
  );
});

describe("SupabaseInvitationRepository atomic resend", () => {
  it("rotates the scoped pending invitation through the atomic RPC", async () => {
    const { repository, rpc } = fixture(
      {},
      {
        resend_invitation_atomic: [{ data: [resentRow], error: null }],
      },
    );

    await expect(
      repository.resendAtomic(
        organizationId,
        invitationId,
        { id: userId, email: "owner@cra.test" },
        "fresh-hashed-token",
        "2026-08-16T00:00:00.000Z",
      ),
    ).resolves.toEqual({
      outcome: "resent",
      invitationId,
      email: "member@cra.test",
      organizationName: "CRA",
    });
    expect(rpc).toHaveBeenCalledWith("resend_invitation_atomic", {
      p_organization_id: organizationId,
      p_invitation_id: invitationId,
      p_actor_user_id: userId,
      p_actor_email: "owner@cra.test",
      p_token_hash: "fresh-hashed-token",
      p_expires_at: "2026-08-16T00:00:00.000Z",
    });
  });

  it.each([
    "not_found",
    "expired",
    "accepted",
    "not_pending",
    "already_member",
    "actor_not_found",
    "actor_email_mismatch",
  ] as const)(
    "maps the %s resend result without exposing row data",
    async (outcome) => {
      const { repository } = fixture(
        {},
        {
          resend_invitation_atomic: [
            { data: [{ ...resentRow, outcome }], error: null },
          ],
        },
      );

      await expect(
        repository.resendAtomic(
          organizationId,
          invitationId,
          { id: userId, email: "owner@cra.test" },
          "fresh-hashed-token",
          "2026-08-16T00:00:00.000Z",
        ),
      ).resolves.toEqual({ outcome });
    },
  );

  it.each([
    { data: null, error: { message: "offline" } },
    { data: null, error: null },
    { data: [], error: null },
    { data: [resentRow, resentRow], error: null },
    { data: [{ ...resentRow, invitation_id: null }], error: null },
    { data: [{ ...resentRow, email: null }], error: null },
    { data: [{ ...resentRow, organization_name: null }], error: null },
    { data: [{ ...resentRow, outcome: "future_outcome" }], error: null },
  ] as const)(
    "rejects an invalid resend provider response %#",
    async (result) => {
      const { repository } = fixture(
        {},
        { resend_invitation_atomic: [result] },
      );

      await expect(
        repository.resendAtomic(
          organizationId,
          invitationId,
          { id: userId, email: "owner@cra.test" },
          "fresh-hashed-token",
          "2026-08-16T00:00:00.000Z",
        ),
      ).rejects.toThrow();
    },
  );
});

describe("SupabaseInvitationRepository list", () => {
  it("expires stale rows, scopes the list, and maps contract fields", async () => {
    const { builders, repository, rpc } = fixture(
      { invitations: [{ data: [invitationRow], error: null }] },
      { expire_stale_invitations: [{ data: 0, error: null }] },
    );

    await expect(repository.list(organizationId)).resolves.toEqual([
      {
        id: invitationId,
        email: "member@cra.test",
        role: "member",
        status: "pending",
        expiresAt: "2026-08-16T00:00:00.000Z",
      },
    ]);
    expect(rpc).toHaveBeenCalledWith("expire_stale_invitations");
    expect(builders.invitations?.[0]?.eq).toHaveBeenCalledWith(
      "organization_id",
      organizationId,
    );
    expect(builders.invitations?.[0]?.order).toHaveBeenCalledWith(
      "created_at",
      { ascending: false },
    );
  });

  it("preserves an empty provider row set", async () => {
    const { repository } = fixture(
      { invitations: [{ data: null, error: null }] },
      { expire_stale_invitations: [{ data: 0, error: null }] },
    );

    await expect(repository.list(organizationId)).resolves.toEqual([]);
  });

  it("rejects a non-array invitation collection", async () => {
    const { repository } = fixture(
      { invitations: [{ data: { ...invitationRow }, error: null }] },
      { expire_stale_invitations: [{ data: 0, error: null }] },
    );

    await expect(repository.list(organizationId)).rejects.toThrow(
      "Invitation repository returned malformed data",
    );
  });

  it.each([
    [
      "expiration",
      { data: 0, error: { message: "expire unavailable" } },
      { data: [], error: null },
    ],
    [
      "query",
      { data: 0, error: null },
      { data: null, error: { message: "query unavailable" } },
    ],
    [
      "malformed row",
      { data: 0, error: null },
      { data: [{ ...invitationRow, role: "superuser" }], error: null },
    ],
  ] as const)(
    "rejects a %s failure",
    async (_label, expireResult, listResult) => {
      const { repository } = fixture(
        { invitations: [listResult] },
        { expire_stale_invitations: [expireResult] },
      );

      await expect(repository.list(organizationId)).rejects.toThrow();
    },
  );
});
