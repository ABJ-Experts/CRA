import type { Connector, SyncRun } from "@repo/contracts/connectors/types";
import type { SupabaseService } from "../../supabase/supabase.service";
import type { ConnectorAuthorization } from "../application/connector-authorization.port";
import type {
  ConnectorCommand,
  ConnectorCommandRequest,
  ConnectorSafeTestResult,
} from "../application/connector-hub-repository.port";
import type { SupabaseConnectorRepository } from "./supabase-connector.repository";
import { SupabaseConnectorHubRepository } from "./supabase-connector-hub.repository";

const orgId = "11111111-1111-4111-8111-111111111111";
const connectorId = "22222222-2222-4222-8222-222222222222";
const actorId = "33333333-3333-4333-8333-333333333333";
const commandId = "44444444-4444-4444-8444-444444444444";
const now = "2026-09-28T10:00:00.000Z";
const connector: Connector = {
  id: connectorId,
  organizationId: orgId,
  connectorType: "reference_conformance",
  displayName: "Reference",
  adapterVersion: "1.0.0",
  mappingVersion: "v1",
  connectionConfig: {},
  hasSecret: true,
  commitPolicy: "manual",
  enabled: true,
  lastTestedAt: now,
  lastTestOutcome: "success",
  lastTestErrorCode: null,
  archivedAt: null,
  version: 1,
  createdAt: now,
  createdBy: actorId,
  updatedAt: now,
  updatedBy: actorId,
};
const authorization: ConnectorAuthorization = {
  organizationId: orgId,
  actorId,
  role: "owner",
  permissionVersion: 3,
};
const command: ConnectorCommand = {
  id: commandId,
  operation: "test_connection",
  state: "running",
  connectionRevision: 2,
  credentialRevision: 1,
  permissionVersion: 3,
  requestDigestKeyId: "key-1",
  deadlineAt: now,
  result: null,
};
const request: ConnectorCommandRequest = {
  authorization,
  connectorId,
  operation: "disconnect",
  expectedVersion: 1,
  idempotencyKey: commandId,
  requestDigest: "a".repeat(64),
  requestDigestKeyId: "key-1",
  payload: { reason: "Maintenance" },
};
const testResult: ConnectorSafeTestResult = {
  outcome: "success",
  errorCode: null,
  latencyMs: 10,
  scope: {
    status: "not_applicable",
    policyVersion: "v1",
    grantedScopes: [],
    missingScopes: [],
    excessScopes: [],
  },
};
const run: SyncRun = {
  id: commandId,
  organizationId: orgId,
  connectorId,
  reconciliationKind: "incremental",
  workKind: "dry_run",
  status: "queued",
  adapterVersion: "1.0.0",
  mappingVersion: "v1",
  cursorFrom: null,
  cursorTo: null,
  fetchContentHash: null,
  planBasisDigest: null,
  rowCount: 0,
  counts: {
    create: 0,
    update: 0,
    unchanged: 0,
    skip: 0,
    conflict: 0,
    tombstone: 0,
    cycleBlocked: 0,
  },
  estimatedGraphImpact: {},
  errorCode: null,
  retryCount: 0,
  correlationId: commandId,
  expiresAt: now,
  committedAt: null,
  canceledAt: null,
  createdAt: now,
  updatedAt: now,
};
type Result = { data: unknown; error: unknown };
function result(data: unknown, error: unknown = null): Result {
  return { data, error };
}
function setup() {
  const reads: Result[] = [];
  const traces: {
    table: string;
    columns: string;
    filters: [string, unknown][];
  }[] = [];
  const client = {
    rpc: jest.fn<
      Promise<Result>,
      [string, Readonly<Record<string, unknown>>]
    >(),
    from: jest.fn((table: string) => {
      const trace = { table, columns: "", filters: [] as [string, unknown][] };
      traces.push(trace);
      const response = reads.shift() ?? result(null);
      const query = {
        select: (columns: string) => {
          trace.columns = columns;
          return query;
        },
        eq: (column: string, value: unknown) => {
          trace.filters.push([column, value]);
          return query;
        },
        is: (column: string, value: null) => {
          trace.filters.push([column, value]);
          return query;
        },
        maybeSingle: () => Promise.resolve(response),
        then: (resolve: (value: Result) => unknown) =>
          Promise.resolve(response).then(resolve),
      };
      return query;
    }),
  };
  const legacy = {
    getConnector: jest.fn().mockResolvedValue(connector),
    listConnectors: jest.fn().mockResolvedValue({
      rows: [connector],
      total: 1,
      page: 1,
      pageSize: 25,
      pageCount: 1,
    }),
    getSyncRun: jest.fn().mockResolvedValue(run),
  };
  const repository = new SupabaseConnectorHubRepository(
    { admin: () => client } as unknown as SupabaseService,
    legacy as unknown as SupabaseConnectorRepository,
  );
  return { repository, client, legacy, reads, traces };
}
const summary = {
  connector_id: connectorId,
  connection_revision: 2,
  credential_revision: 1,
  last_test_connection_revision: 2,
  last_sync_at: now,
  active_sync_status: null,
  credential_revoked: false,
  scope_assessment: {
    status: "not_applicable",
    policyVersion: "v1",
    grantedScopes: [],
    missingScopes: [],
    excessScopes: [],
  },
};

describe("connector hub service-role scope and response parsing", () => {
  it("scopes permission epoch and actor reads to organization and active identity", async () => {
    const { repository, reads, traces } = setup();
    reads.push(
      result({ version: 3 }),
      result({
        role: "owner",
        users: { is_active: true },
        organizations: { is_active: true },
      }),
    );
    expect(await repository.permissionVersion(orgId)).toBe(3);
    expect(await repository.actor(orgId, actorId)).toEqual({ role: "owner" });
    expect(
      traces.every((trace) =>
        trace.filters.some(
          ([column, value]) => column === "organization_id" && value === orgId,
        ),
      ),
    ).toBe(true);
    expect(traces[1]!.filters).toContainEqual(["user_id", actorId]);
  });
  it.each([null, { version: 0 }, { version: "3" }])(
    "fails closed on an invalid epoch %p",
    async (data) => {
      const { repository, reads } = setup();
      reads.push(result(data));
      await expect(repository.permissionVersion(orgId)).rejects.toMatchObject({
        code: "unavailable",
      });
    },
  );
  it("distinguishes unavailable identity storage from inactive actor", async () => {
    const { repository, reads } = setup();
    reads.push(
      result(null, new Error("provider-canary")),
      result({
        role: "owner",
        users: { is_active: false },
        organizations: { is_active: true },
      }),
    );
    await expect(repository.actor(orgId, actorId)).rejects.toMatchObject({
      code: "unavailable",
    });
    await expect(repository.actor(orgId, actorId)).rejects.toMatchObject({
      code: "not_found",
    });
  });
  it("scopes both connector and encrypted credential context reads", async () => {
    const { repository, reads, traces, legacy } = setup();
    reads.push(
      result({
        connection_revision: 2,
        credential_revision: 1,
        secret_ref: commandId,
      }),
      result({
        id: commandId,
        encryption_scheme: "aes_256_gcm_v1",
        key_id: "key-1",
        nonce: "\\x0102",
        auth_tag: "\\x0304",
        ciphertext: "\\x0506",
        credential_revision: 1,
        revoked_at: null,
      }),
    );
    expect(await repository.context(orgId, connectorId)).toMatchObject({
      connectionRevision: 2,
      credentialRevision: 1,
      secret: { envelope: { format: "aes-256-gcm-v1", nonce: "AQI=" } },
    });
    expect(legacy.getConnector).toHaveBeenCalledWith(orgId, connectorId);
    expect(
      traces.every(
        (trace) =>
          trace.filters.includes(traces[0]!.filters[0]!) ||
          trace.filters.some(
            ([column, value]) =>
              column === "organization_id" && value === orgId,
          ),
      ),
    ).toBe(true);
    expect(traces[1]!.filters).toContainEqual(["connector_id", connectorId]);
    expect(traces[1]!.filters).toContainEqual(["id", commandId]);
  });
  it.each(["missing", "revoked", "unconfigured"])(
    "does not resolve %s credentials",
    async (kind) => {
      const { repository, reads } = setup();
      reads.push(
        result({
          connection_revision: 2,
          credential_revision: 1,
          secret_ref: kind === "unconfigured" ? null : commandId,
        }),
      );
      if (kind !== "unconfigured")
        reads.push(result(kind === "missing" ? null : { revoked_at: now }));
      expect((await repository.context(orgId, connectorId)).secret).toBeNull();
    },
  );
  it("returns a legacy ciphertext envelope only to the internal reader", async () => {
    const { repository, reads } = setup();
    reads.push(
      result({
        connection_revision: 2,
        credential_revision: 1,
        secret_ref: commandId,
      }),
      result({
        id: commandId,
        encryption_scheme: "legacy_pgp",
        ciphertext: "\\x0102",
        credential_revision: 1,
        revoked_at: null,
      }),
    );
    expect((await repository.context(orgId, connectorId)).secret).toMatchObject(
      { legacy: true, envelope: null, legacyCiphertextBase64: "AQI=" },
    );
  });
  it("rejects unknown encryption formats instead of treating them as GCM", async () => {
    const { repository, reads } = setup();
    reads.push(
      result({
        connection_revision: 2,
        credential_revision: 1,
        secret_ref: commandId,
      }),
      result({
        id: commandId,
        encryption_scheme: "invented",
        key_id: "key-1",
        nonce: "\\x01",
        auth_tag: "\\x02",
        ciphertext: "\\x03",
        credential_revision: 1,
        revoked_at: null,
      }),
    );
    await expect(repository.context(orgId, connectorId)).rejects.toMatchObject({
      code: "unavailable",
    });
  });
  it.each(["invalid", "", null])(
    "rejects malformed encrypted bytes %p safely",
    async (ciphertext) => {
      const { repository, reads } = setup();
      reads.push(
        result({
          connection_revision: 2,
          credential_revision: 1,
          secret_ref: commandId,
        }),
        result({
          id: commandId,
          encryption_scheme: "legacy_pgp",
          ciphertext,
          credential_revision: 1,
          revoked_at: null,
        }),
      );
      await expect(
        repository.context(orgId, connectorId),
      ).rejects.toMatchObject({ code: "unavailable" });
    },
  );
  it("fails safe for missing context, invalid revision and credential storage errors", async () => {
    const { repository, reads } = setup();
    reads.push(
      result(null),
      result({ connection_revision: -1, credential_revision: 1 }),
      result({
        connection_revision: 2,
        credential_revision: 1,
        secret_ref: commandId,
      }),
      result(null, new Error("cipher-canary")),
    );
    await expect(repository.context(orgId, connectorId)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(repository.context(orgId, connectorId)).rejects.toMatchObject({
      code: "unavailable",
    });
    await expect(repository.context(orgId, connectorId)).rejects.toMatchObject({
      code: "unavailable",
    });
  });
});

describe("connector atomic command routing", () => {
  it("loads actor-specific idempotency metadata without exposing secrets", async () => {
    const { repository, reads, traces } = setup();
    reads.push(
      result(null),
      result({
        id: commandId,
        operation: "test_connection",
        state: "completed",
        connection_revision: 2,
        credential_revision: 1,
        permission_version: 3,
        request_digest_key_id: "key-1",
        deadline_at: now,
        result: { connector },
      }),
    );
    expect(
      await repository.command(orgId, connectorId, actorId, commandId),
    ).toBeNull();
    expect(
      await repository.command(orgId, connectorId, actorId, commandId),
    ).toMatchObject({ state: "completed", requestDigestKeyId: "key-1" });
    expect(traces[1]!.filters).toEqual([
      ["organization_id", orgId],
      ["connector_id", connectorId],
      ["actor_user_id", actorId],
      ["idempotency_key", commandId],
    ]);
  });
  it("maps successful/replayed mutation outcomes and records every authorization fence", async () => {
    const { repository, client } = setup();
    client.rpc.mockResolvedValue(result([{ outcome: "replayed", connector }]));
    expect(await repository.execute(orgId, request)).toEqual(connector);
    expect(client.rpc).toHaveBeenCalledWith(
      "m11_execute_connector_command_atomic",
      expect.objectContaining({
        p_organization_id: orgId,
        p_actor_user_id: actorId,
        p_connector_id: connectorId,
        p_permission_version: 3,
        p_expected_version: 1,
        p_request_digest_key_id: "key-1",
      }),
    );
  });
  it.each([
    ["not_found", "not_found"],
    ["forbidden", "forbidden_by_policy"],
    ["forbidden_by_policy", "forbidden_by_policy"],
    ["conflict", "conflict"],
    ["idempotency_conflict", "idempotency_mismatch"],
    ["in_progress", "already_running"],
    ["interrupted", "invalid_state"],
    ["invalid_state", "invalid_state"],
    ["invalid_request", "invalid_request"],
    ["invented", "unavailable"],
    [null, "unavailable"],
  ])("maps %s to %s without raw provider payload", async (outcome, code) => {
    const { repository, client } = setup();
    client.rpc.mockResolvedValue(
      result([{ outcome, providerMessage: "secret-canary" }]),
    );
    await expect(repository.execute(orgId, request)).rejects.toMatchObject({
      code,
    });
  });
  it.each([
    result([]),
    result([{}, {}]),
    result(null),
    result([null]),
    result([], new Error("secret-canary")),
  ])("rejects malformed RPC envelopes", async (response) => {
    const { repository, client } = setup();
    client.rpc.mockResolvedValue(response);
    await expect(repository.execute(orgId, request)).rejects.toMatchObject({
      code: "unavailable",
    });
  });
  it("redacts thrown RPC failures and failed ledger reads", async () => {
    const { repository, client, reads } = setup();
    client.rpc.mockRejectedValue(new Error("secret-canary"));
    reads.push(result(null, new Error("secret-canary")));
    await expect(repository.execute(orgId, request)).rejects.toMatchObject({
      code: "unavailable",
    });
    await expect(
      repository.command(orgId, connectorId, actorId, commandId),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
  it("reserves a non-destructive test then finalizes with command/org/revision fences", async () => {
    const { repository, client, reads, traces } = setup();
    client.rpc
      .mockResolvedValueOnce(
        result([{ outcome: "started", connector, command }]),
      )
      .mockResolvedValueOnce(result([{ outcome: "tested", connector }]));
    expect((await repository.beginTest(orgId, request)).outcome).toBe(
      "started",
    );
    expect(client.rpc.mock.calls[0]![1]).not.toHaveProperty("p_payload");
    reads.push(result({ id: commandId }));
    expect(
      await repository.finalizeTest(
        orgId,
        connectorId,
        command,
        authorization,
        testResult,
      ),
    ).toEqual(connector);
    expect(traces[0]!.filters).toEqual([
      ["organization_id", orgId],
      ["connector_id", connectorId],
      ["id", commandId],
    ]);
    expect(client.rpc).toHaveBeenLastCalledWith(
      "m11_finalize_connector_test_atomic",
      expect.objectContaining({
        p_permission_version: 3,
        p_connection_revision: 2,
        p_credential_revision: 1,
        p_actor_user_id: actorId,
      }),
    );
  });
  it("rejects substituted tenant/command before finalization", async () => {
    const { repository, client, reads } = setup();
    await expect(
      repository.finalizeTest(
        orgId,
        connectorId,
        command,
        { ...authorization, organizationId: actorId },
        testResult,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    reads.push(result(null));
    await expect(
      repository.finalizeTest(
        orgId,
        connectorId,
        command,
        authorization,
        testResult,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it("creates and begins/approves sync using original authorized actors", async () => {
    const { repository, client, legacy } = setup();
    client.rpc
      .mockResolvedValueOnce(result([{ outcome: "created", connector }]))
      .mockResolvedValueOnce(result([{ outcome: "queued", run }]))
      .mockResolvedValueOnce(result([{ outcome: "queued", run }]));
    expect(
      await repository.create(orgId, authorization, {
        connectorType: "reference_conformance",
        displayName: "Reference",
        adapterVersion: "1.0.0",
        mappingVersion: "v1",
        commitPolicy: "manual",
        idempotencyKey: commandId,
      }),
    ).toEqual(connector);
    expect(
      await repository.beginSync(
        orgId,
        authorization,
        connectorId,
        "incremental",
        commandId,
        commandId,
      ),
    ).toEqual(run);
    expect(
      await repository.requestCommit(
        orgId,
        authorization,
        connectorId,
        commandId,
        0,
      ),
    ).toEqual(run);
    expect(legacy.getSyncRun).toHaveBeenCalledWith(
      orgId,
      connectorId,
      commandId,
    );
    expect(
      client.rpc.mock.calls.every(
        ([, input]) =>
          input.p_actor_user_id === actorId &&
          input.p_organization_id === orgId &&
          input.p_permission_version === 3,
      ),
    ).toBe(true);
  });
});

describe("bounded connector health summaries", () => {
  it.each([
    [{ enabled: false }, {}, "not_connected", "disabled"],
    [{}, { credential_revoked: true }, "not_connected", "credentials_revoked"],
    [{ hasSecret: false }, {}, "not_connected", "credentials_missing"],
    [
      {},
      { last_test_connection_revision: 1 },
      "not_connected",
      "test_required",
    ],
    [
      { lastTestOutcome: "failure", lastTestErrorCode: "auth_failed" },
      {},
      "auth_expired",
      "authentication_expired",
    ],
    [
      { lastTestOutcome: "failure", lastTestErrorCode: "vault_unavailable" },
      {},
      "degraded",
      "vault_unavailable",
    ],
    [
      { lastTestOutcome: "failure", lastTestErrorCode: null },
      {},
      "degraded",
      "test_failed",
    ],
    [{}, { active_sync_status: "running" }, "syncing", "sync_in_progress"],
    [{}, {}, "healthy", "ready"],
  ] as const)(
    "derives current health %s %s",
    async (changes, rowChanges, status, reason) => {
      const { repository, client, legacy } = setup();
      legacy.getConnector.mockResolvedValue({ ...connector, ...changes });
      client.rpc.mockResolvedValue(result([{ ...summary, ...rowChanges }]));
      expect(
        (await repository.overview(orgId, connectorId)).connection,
      ).toMatchObject({ status, reason });
      expect(client.rpc).toHaveBeenCalledWith(
        "m11_connector_connection_summaries",
        { p_organization_id: orgId, p_connector_ids: [connectorId] },
      );
    },
  );
  it("does not erase a durable missing-scope verdict", async () => {
    const { repository, client } = setup();
    client.rpc.mockResolvedValue(
      result([
        {
          ...summary,
          scope_assessment: {
            status: "missing",
            policyVersion: "v1",
            grantedScopes: [],
            missingScopes: ["read:products"],
            excessScopes: [],
          },
        },
      ]),
    );
    expect(
      (await repository.overview(orgId, connectorId)).connection,
    ).toMatchObject({
      status: "degraded",
      reason: "missing_scope",
      scope: { missingScopes: ["read:products"] },
    });
  });
  it("handles unknown scopes and nullable dates without compliance claims", async () => {
    const { repository, client, legacy } = setup();
    legacy.getConnector.mockResolvedValue({
      ...connector,
      lastTestOutcome: null,
      lastTestedAt: null,
    });
    client.rpc.mockResolvedValue(
      result([{ ...summary, scope_assessment: null, last_sync_at: null }]),
    );
    const overview = await repository.overview(orgId, connectorId);
    expect(overview.connection.scope.status).toBe("unknown");
    expect(overview.connection.lastSyncAt).toBeNull();
    expect(overview.connection.test.category).toBe("not_tested");
  });
  it("uses one bounded summary RPC for a page and skips it for an empty page", async () => {
    const { repository, client, legacy } = setup();
    client.rpc.mockResolvedValue(result([summary]));
    expect(
      (
        await repository.overviews(orgId, {
          page: 1,
          pageSize: 25,
          order: "desc",
        })
      ).rows,
    ).toHaveLength(1);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    legacy.listConnectors.mockResolvedValue({
      rows: [],
      total: 0,
      page: 1,
      pageSize: 25,
      pageCount: 0,
    });
    expect(
      (
        await repository.overviews(orgId, {
          page: 1,
          pageSize: 25,
          order: "desc",
        })
      ).rows,
    ).toEqual([]);
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([
    result(null),
    result([]),
    result([null]),
    result([], new Error("provider-canary")),
  ])("fails safe on incomplete/invalid summary metadata", async (response) => {
    const { repository, client } = setup();
    client.rpc.mockResolvedValue(response);
    await expect(repository.overview(orgId, connectorId)).rejects.toMatchObject(
      { code: "unavailable" },
    );
  });
});
