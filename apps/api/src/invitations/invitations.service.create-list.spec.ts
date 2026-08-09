import { createHash } from "node:crypto";

import { BadRequestException, NotFoundException } from "@nestjs/common";

import { InvitationsService } from "./invitations.service";

interface QueryResult {
  readonly data: unknown;
  readonly error: Readonly<{ message: string }> | null;
}

function query(result: QueryResult) {
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

function serviceWithTables(
  tableResults: Readonly<Record<string, readonly QueryResult[]>>,
) {
  const builders = Object.fromEntries(
    Object.entries(tableResults).map(([table, results]) => [
      table,
      results.map(query),
    ]),
  ) as Record<string, ReturnType<typeof query>[]>;
  const indexes: Record<string, number> = {};
  const from = jest.fn((table: string) => {
    const index = indexes[table] ?? 0;
    indexes[table] = index + 1;
    const builder = builders[table]?.[index];
    if (!builder) throw new Error(`Unexpected ${table} query ${index + 1}`);
    return builder;
  });
  const rpc = jest
    .fn<Promise<QueryResult>, []>()
    .mockResolvedValue({ data: null, error: null });
  const configGet = jest.fn().mockReturnValue(7);
  const sendInvitation = jest
    .fn<Promise<void>, unknown[]>()
    .mockResolvedValue();
  const auditLog = jest.fn();
  const service = new InvitationsService(
    { admin: () => ({ from, rpc }) } as never,
    { getOrThrow: configGet } as never,
    { sendInvitation } as never,
    { log: auditLog } as never,
  );

  return {
    auditLog,
    builders,
    configGet,
    from,
    rpc,
    sendInvitation,
    service,
  };
}

function createFixture(
  overrides: Readonly<{
    existingUser?: unknown;
    existingMember?: unknown;
    pending?: unknown;
    insert?: QueryResult;
    organization?: unknown;
  }> = {},
) {
  const existingUser = overrides.existingUser ?? null;
  const tableResults: Record<string, readonly QueryResult[]> = {
    users: [{ data: existingUser, error: null }],
    invitations: [
      { data: overrides.pending ?? null, error: null },
      overrides.insert ?? { data: { id: "invitation-1" }, error: null },
    ],
    organizations: [
      {
        data:
          overrides.organization === undefined
            ? { id: "organization-1", name: "CRA", slug: "cra" }
            : overrides.organization,
        error: null,
      },
    ],
  };
  if (existingUser) {
    tableResults.organization_members = [
      { data: overrides.existingMember ?? null, error: null },
    ];
  }
  return serviceWithTables(tableResults);
}

const actor = Object.freeze({ id: "owner-1", email: "owner@cra.test" });
const input = Object.freeze({
  email: "  NEW.MEMBER@CRA.TEST ",
  role: "member" as const,
});

describe("InvitationsService create and list", () => {
  it("rejects a normalized self-invitation before querying", async () => {
    const { from, service } = serviceWithTables({});

    await expect(
      service.create("organization-1", actor, {
        email: " OWNER@CRA.TEST ",
        role: "owner",
      }),
    ).rejects.toMatchObject({ response: { code: "cannot_invite_self" } });
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects an existing organization member", async () => {
    const { service } = createFixture({
      existingUser: { id: "member-1" },
      existingMember: { id: "membership-1" },
    });

    await expect(
      service.create("organization-1", actor, input),
    ).rejects.toMatchObject({ response: { code: "already_member" } });
  });

  it("rejects an existing pending invitation", async () => {
    const { service } = createFixture({ pending: { id: "pending-1" } });

    await expect(
      service.create("organization-1", actor, input),
    ).rejects.toMatchObject({ response: { code: "invitation_pending" } });
  });

  it.each([
    { data: null, error: { message: "insert failed" } },
    { data: null, error: null },
  ] as const)(
    "fails closed when invitation insertion fails %#",
    async (insert) => {
      const { service } = createFixture({ insert });
      const promise = service.create("organization-1", actor, input);

      await expect(promise).rejects.toBeInstanceOf(BadRequestException);
      await expect(promise).rejects.toMatchObject({
        response: { code: "invitation_failed" },
      });
    },
  );

  it("stores only the token hash and sends only the raw token", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-09T00:00:00.000Z"));
    try {
      const fixture = createFixture({
        existingUser: { id: "existing-user" },
        existingMember: null,
      });

      await expect(
        fixture.service.create("organization-1", actor, {
          ...input,
          firstName: "New",
          lastName: "Member",
        }),
      ).resolves.toEqual({ id: "invitation-1" });

      const mailCall = fixture.sendInvitation.mock.calls[0];
      const rawToken = mailCall?.[1] as string;
      expect(rawToken).toMatch(/^[0-9a-f]{64}$/);
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      expect(fixture.builders.invitations?.at(1)?.insert).toHaveBeenCalledWith({
        organization_id: "organization-1",
        invited_by: "owner-1",
        email: "new.member@cra.test",
        role: "member",
        first_name: "New",
        last_name: "Member",
        token_hash: tokenHash,
        expires_at: "2026-08-16T00:00:00.000Z",
      });
      expect(rawToken).not.toBe(tokenHash);
      expect(mailCall).toEqual([
        "new.member@cra.test",
        rawToken,
        "CRA",
        "owner@cra.test",
      ]);
      expect(fixture.auditLog).toHaveBeenCalledWith({
        organizationId: "organization-1",
        userId: "owner-1",
        actorEmail: "owner@cra.test",
        action: "invitation.created",
        entityType: "invitation",
        entityId: "invitation-1",
        changes: { email: "new.member@cra.test", role: "member" },
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it("uses null profile fields and propagates notifier failure", async () => {
    const fixture = createFixture();
    fixture.sendInvitation.mockRejectedValueOnce(new Error("mail unavailable"));

    await expect(
      fixture.service.create("organization-1", actor, input),
    ).rejects.toThrow("mail unavailable");
    expect(fixture.builders.invitations?.[1]?.insert).toHaveBeenCalledWith(
      expect.objectContaining({ first_name: null, last_name: null }),
    );
    expect(fixture.auditLog).not.toHaveBeenCalled();
  });

  it("preserves the organization-not-found response", async () => {
    const { service } = createFixture({ organization: null });
    const promise = service.create("organization-1", actor, input);

    await expect(promise).rejects.toBeInstanceOf(NotFoundException);
    await expect(promise).rejects.toMatchObject({
      response: {
        code: "organization_not_found",
        message: "That organization no longer exists.",
      },
    });
  });

  it("expires stale invitations, scopes the query, and maps rows", async () => {
    const rows = [
      {
        id: "invitation-1",
        email: "new.member@cra.test",
        role: "member",
        status: "pending",
        expires_at: "2026-08-16T00:00:00.000Z",
      },
    ];
    const fixture = serviceWithTables({
      invitations: [{ data: rows, error: null }],
    });

    await expect(fixture.service.list("organization-1")).resolves.toEqual([
      {
        id: "invitation-1",
        email: "new.member@cra.test",
        role: "member",
        status: "pending",
        expiresAt: "2026-08-16T00:00:00.000Z",
      },
    ]);
    expect(fixture.rpc).toHaveBeenCalledWith("expire_stale_invitations");
    expect(fixture.builders.invitations?.[0]?.eq).toHaveBeenCalledWith(
      "organization_id",
      "organization-1",
    );
    expect(fixture.builders.invitations?.[0]?.order).toHaveBeenCalledWith(
      "created_at",
      { ascending: false },
    );
  });

  it.each([
    { data: null, error: null },
    { data: null, error: { message: "list failed" } },
  ] as const)(
    "returns an empty list for an unavailable row set %#",
    async (result) => {
      const { service } = serviceWithTables({ invitations: [result] });

      await expect(service.list("organization-1")).resolves.toEqual([]);
    },
  );
});
