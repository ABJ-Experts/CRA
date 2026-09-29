import {
  ConnectorSyncWorker,
  cursorAfterPage,
  cursorInputFor,
  toClaimedSyncRun,
  createConnectorSyncPlanContext,
} from "./connector-sync-worker";
import { AesGcmConnectorVault } from "../infrastructure/connector-vault";
import type { ConnectorCredentialReaderPort } from "../application/connector-vault.port";

const connectorContext = {
  connector: {
    connectorType: "reference_conformance",
    connectionConfig: {},
    hasSecret: true,
    enabled: true,
    archivedAt: null,
  },
  connectionRevision: 2,
  credentialRevision: 1,
  secret: {
    secretId: "secret-a",
    credentialRevision: 1,
    legacy: false,
    envelope: null,
  },
};
const claim = {
  id: "run-a",
  organizationId: "org-a",
  connectorId: "connector-a",
  workKind: "dry_run",
  actorId: "actor-a",
  commitActorId: "approver-a",
  connectionRevision: 2,
  credentialRevision: 1,
  permissionVersion: 4,
  cursorFrom: null,
  fetchContentHash: "hash",
  correlationId: "correlation",
};

function secureWorker(
  overrides: Record<string, unknown> = {},
  credentialReader?: ConnectorCredentialReaderPort,
  egress: { validate: jest.Mock } | null = {
    validate: jest.fn().mockResolvedValue(undefined),
  },
) {
  const vault = new AesGcmConnectorVault(
    JSON.stringify({
      activeKeyId: "key",
      keys: { key: Buffer.alloc(32, 1).toString("base64") },
    }),
  );
  const envelope = vault.encrypt(
    {
      orgId: "org-a",
      connectorId: "connector-a",
      secretId: "secret-a",
      credentialRevision: 1,
    },
    "worker-canary",
  );
  const context = {
    ...connectorContext,
    secret: { ...connectorContext.secret, envelope },
  };
  const authorization = {
    authorize: jest.fn().mockResolvedValue({
      organizationId: "org-a",
      actorId: "actor-a",
      role: "owner",
      permissionVersion: 4,
    }),
  };
  const hub = { context: jest.fn().mockResolvedValue(context) };
  const repository = {
    listDueSyncRunOrganizations: jest
      .fn()
      .mockResolvedValue([{ organization_id: "org-a" }]),
    claimSyncRun: jest
      .fn()
      .mockResolvedValueOnce({ ...claim, ...overrides })
      .mockResolvedValue(null),
    failSyncRun: jest.fn().mockResolvedValue(undefined),
    commitSyncRun: jest.fn().mockResolvedValue(undefined),
    saveSyncRunPlan: jest.fn().mockResolvedValue(undefined),
    resolveWorkerActor: jest.fn(),
    resolveConnectorSecret: jest.fn(),
  };
  const adapter = {
    testConnection: jest.fn().mockResolvedValue({
      outcome: "success",
      latencyMs: 1,
      adapterVersion: "1.0.0",
    }),
    pull: jest.fn().mockResolvedValue({
      records: [],
      nextCursor: null,
      adapterSignal: "ok",
    }),
  };
  const rpc = jest.fn().mockResolvedValue({ data: [], error: null });
  const worker = new ConnectorSyncWorker(
    repository as never,
    { admin: () => ({ rpc }) } as never,
    new Map([["reference_conformance", adapter as never]]),
    "legacy-key",
    "worker-a",
    60,
    {
      vault,
      credentialReader,
      egress: egress ?? undefined,
      authorization,
      hub: hub as never,
    },
  );
  return {
    worker,
    repository,
    adapter,
    authorization,
    hub,
    context,
    rpc,
    egress,
  };
}

describe("connector worker recorded authorization and credential fences", () => {
  it("checks egress immediately before each provider call and rejects changed DNS", async () => {
    const { worker, egress, adapter, repository } = secureWorker();
    egress!.validate
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("unsafe endpoint"));
    await worker.runOnce();
    expect(egress!.validate).toHaveBeenCalledTimes(2);
    expect(adapter.testConnection).toHaveBeenCalledTimes(1);
    expect(egress!.validate.mock.invocationCallOrder[0]).toBeLessThan(
      adapter.testConnection.mock.invocationCallOrder[0]!,
    );
    expect(adapter.pull).not.toHaveBeenCalled();
    expect(repository.saveSyncRunPlan).not.toHaveBeenCalled();
  });
  it("rejects unsafe legacy URLs before passing credentials to an adapter", async () => {
    const { worker, egress, hub, context, adapter, repository } =
      secureWorker();
    hub.context.mockResolvedValue({
      ...context,
      connector: {
        ...context.connector,
        connectionConfig: { baseUrl: "http://127.0.0.1/internal" },
      },
    });
    egress!.validate.mockRejectedValue(new Error("unsafe endpoint"));
    await worker.runOnce();
    expect(adapter.testConnection).not.toHaveBeenCalled();
    expect(adapter.pull).not.toHaveBeenCalled();
    expect(repository.failSyncRun).toHaveBeenCalled();
  });
  it("fails closed for a configured URL when no egress policy is injected", async () => {
    const { worker, hub, context, adapter } = secureWorker({}, undefined, null);
    hub.context.mockResolvedValue({
      ...context,
      connector: {
        ...context.connector,
        connectionConfig: { baseUrl: "https://vendor.example" },
      },
    });
    await worker.runOnce();
    expect(adapter.testConnection).not.toHaveBeenCalled();
    expect(adapter.pull).not.toHaveBeenCalled();
  });
  it("preserves active legacy credentials through the scoped ciphertext bridge", async () => {
    const credentialReader = {
      read: jest.fn().mockResolvedValue("legacy-memory-canary"),
    };
    const { worker, hub, adapter, context } = secureWorker(
      {},
      credentialReader,
    );
    hub.context.mockResolvedValue({
      ...context,
      secret: {
        ...context.secret,
        envelope: null,
        legacy: true,
        legacyCiphertextBase64: "Y2lwaGVy",
      },
    });
    await worker.runOnce();
    expect(credentialReader.read).toHaveBeenCalledWith(
      {
        orgId: "org-a",
        connectorId: "connector-a",
        secretId: "secret-a",
        credentialRevision: 1,
      },
      expect.objectContaining({
        legacy: true,
        legacyCiphertextBase64: "Y2lwaGVy",
      }),
    );
    expect(adapter.pull).toHaveBeenCalledWith(
      expect.objectContaining({
        secretReference: {
          provider: "vault",
          reference: "legacy-memory-canary",
        },
      }),
      null,
      200,
    );
  });
  it.each(["rate_limited", "cursor_expired", "cursor_invalid", "unavailable"])(
    "handles %s without advancing a cursor",
    async (adapterSignal) => {
      const { worker, adapter, repository } = secureWorker();
      adapter.pull.mockResolvedValue({
        records: [],
        nextCursor: null,
        adapterSignal,
      });
      await worker.runOnce();
      expect(repository.saveSyncRunPlan).not.toHaveBeenCalled();
      expect(repository.failSyncRun).toHaveBeenCalledWith(
        "org-a",
        "run-a",
        "worker-a",
        adapterSignal === "unavailable"
          ? "provider_unavailable"
          : adapterSignal,
      );
    },
  );
  it("parses failure categories and never persists arbitrary provider secret messages", async () => {
    const { worker, adapter, repository } = secureWorker();
    adapter.testConnection.mockResolvedValue({
      outcome: "failure",
      errorCode: "secret_canary",
      message: "provider secret canary",
    });
    await worker.runOnce();
    expect(repository.failSyncRun).toHaveBeenCalledWith(
      "org-a",
      "run-a",
      "worker-a",
      "worker_exception",
    );
    expect(JSON.stringify(repository.failSyncRun.mock.calls)).not.toContain(
      "secret_canary",
    );
  });
  it("bounds noncooperative provider reads and discards timed-out work", async () => {
    const abort = new AbortController();
    const timeout = jest
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(abort.signal);
    const { worker, adapter, repository } = secureWorker();
    adapter.pull.mockReturnValue(new Promise(() => {}));
    const pending = worker.runOnce();
    await new Promise((resolve) => setImmediate(resolve));
    abort.abort();
    await pending;
    timeout.mockRestore();
    expect(repository.saveSyncRunPlan).not.toHaveBeenCalled();
    expect(repository.failSyncRun).toHaveBeenCalled();
  });
  it("uses scoped GCM recovery and recorded actor rather than owner substitution", async () => {
    const { worker, repository, adapter, authorization } = secureWorker();
    await worker.runOnce();
    expect(repository.resolveWorkerActor).not.toHaveBeenCalled();
    expect(repository.resolveConnectorSecret).not.toHaveBeenCalled();
    expect(adapter.pull).toHaveBeenCalledWith(
      expect.objectContaining({
        executionIdentity: "org-a:connector-a:run-a",
        secretReference: { provider: "vault", reference: "worker-canary" },
      }),
      null,
      200,
    );
    expect(authorization.authorize).toHaveBeenCalledWith(
      "org-a",
      "actor-a",
      expect.arrayContaining(["can_create_connectors", "can_view_products"]),
    );
    expect(repository.saveSyncRunPlan).toHaveBeenCalled();
  });
  it.each([
    { connectionRevision: 1 },
    { credentialRevision: 0 },
    { permissionVersion: 3 },
    { actorId: null },
  ])(
    "rejects stale or missing recorded authority before provider work",
    async (override) => {
      const { worker, adapter, repository } = secureWorker(override);
      await worker.runOnce();
      expect(adapter.testConnection).not.toHaveBeenCalled();
      expect(repository.saveSyncRunPlan).not.toHaveBeenCalled();
      expect(repository.failSyncRun).toHaveBeenCalled();
    },
  );
  it("revalidates after provider reads and discards disconnected/in-flight results", async () => {
    const { worker, adapter, repository, hub, context } = secureWorker();
    adapter.pull.mockImplementation(() => {
      hub.context.mockResolvedValue({
        ...context,
        connector: { ...context.connector, enabled: false },
      });
      return Promise.resolve({
        records: [],
        nextCursor: null,
        adapterSignal: "ok",
      });
    });
    await worker.runOnce();
    expect(repository.saveSyncRunPlan).not.toHaveBeenCalled();
    expect(repository.failSyncRun).toHaveBeenCalled();
  });
  it("commits using the recorded approver and revalidates the initiating actor", async () => {
    const { worker, repository, authorization } = secureWorker({
      workKind: "commit",
    });
    await worker.runOnce();
    expect(repository.resolveWorkerActor).not.toHaveBeenCalled();
    expect(repository.commitSyncRun).toHaveBeenCalledWith(
      expect.objectContaining({ p_actor_user_id: "approver-a" }),
    );
    expect(authorization.authorize).toHaveBeenCalledWith(
      "org-a",
      "actor-a",
      expect.arrayContaining(["can_create_connectors"]),
    );
    expect(authorization.authorize).toHaveBeenCalledWith(
      "org-a",
      "approver-a",
      expect.arrayContaining(["can_approve_connectors"]),
    );
  });
  it("requires product mutation permissions for both recorded participants before commit", async () => {
    const { worker, repository, authorization, rpc } = secureWorker({
      workKind: "commit",
    });
    rpc.mockResolvedValue({
      data: ["create", "update", "archive"],
      error: null,
    });
    await worker.runOnce();
    expect(rpc).toHaveBeenCalledWith("m11_sync_run_required_product_actions", {
      p_organization_id: "org-a",
      p_sync_run_id: "run-a",
    });
    expect(authorization.authorize).toHaveBeenCalledWith(
      "org-a",
      "actor-a",
      expect.arrayContaining([
        "can_create_products",
        "can_edit_products",
        "can_delete_products",
      ]),
    );
    expect(authorization.authorize).toHaveBeenCalledWith(
      "org-a",
      "approver-a",
      expect.arrayContaining([
        "can_create_products",
        "can_edit_products",
        "can_delete_products",
      ]),
    );
    expect(repository.commitSyncRun).toHaveBeenCalled();
  });
});

describe("connector sync worker claim fairness", () => {
  it("claims only the organization selected for the current fair-scheduling turn", async () => {
    const repository = {
      listDueSyncRunOrganizations: jest
        .fn()
        .mockResolvedValue([
          { organization_id: "org-a" },
          { organization_id: "org-b" },
        ]),
      claimSyncRun: jest.fn().mockResolvedValue(null),
    };
    const worker = new ConnectorSyncWorker(
      repository as never,
      {} as never,
      new Map(),
      "test-key",
      "test-worker",
    );

    await worker.runOnce();

    expect(repository.claimSyncRun).toHaveBeenNthCalledWith(
      1,
      "org-a",
      "test-worker",
      60,
    );
    expect(repository.claimSyncRun).toHaveBeenNthCalledWith(
      2,
      "org-b",
      "test-worker",
      60,
    );
  });
});

describe("connector sync worker durable cursor handling", () => {
  it("maps an RPC JSON run into one canonical camel-case worker shape", () => {
    expect(
      toClaimedSyncRun({
        id: "run-1",
        organizationId: "org-1",
        connectorId: "connector-1",
        workKind: "dry_run",
        cursorFrom: null,
        fetchContentHash: null,
        correlationId: null,
      }),
    ).toMatchObject({ organizationId: "org-1", workKind: "dry_run" });
    expect(() =>
      toClaimedSyncRun({
        id: "run-1",
        organization_id: "org-1",
        connectorId: "connector-1",
        workKind: "dry_run",
      }),
    ).toThrow();
  });

  it("advances a terminal page to its final applied external record", () => {
    expect(
      cursorAfterPage(
        {
          records: [
            {
              externalUpdatedAt: "2026-08-20T00:00:00.000Z",
              externalId: "PLM-1",
            },
          ],
          nextCursor: null,
        },
        null,
      ),
    ).toBe("2026-08-20T00:00:00.000Z|PLM-1");
  });

  it("restores a composite durable cursor as its exact token and watermark", () => {
    expect(cursorInputFor("2026-08-20T00:00:00.000Z|PLM-1")).toEqual({
      watermark: "2026-08-20T00:00:00.000Z",
      token: "2026-08-20T00:00:00.000Z|PLM-1",
    });
  });
});

function queryFixture() {
  const queued: Record<string, unknown>[] = [];
  const queries: { table: string; eq: jest.Mock }[] = [];
  const rpc = jest
    .fn()
    .mockResolvedValue({ data: { outcome: "allowed" }, error: null });
  const from = jest.fn((table: string) => {
    const result = queued.shift() ?? { data: null, error: null };
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "neq", "like", "limit"])
      query[method] = jest.fn().mockReturnValue(query);
    query.maybeSingle = jest.fn().mockResolvedValue(result);
    query.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve(result).then(resolve);
    queries.push({ table, eq: query.eq as jest.Mock });
    return query;
  });
  const context = createConnectorSyncPlanContext(
    { admin: () => ({ from, rpc }) } as never,
    "org-a",
    "connector-a",
    {
      ...connectorContext.connector,
      connectionConfig: {
        defaultOwnerBinding: {
          responsibleOwnerId: "owner-a",
          legalEntityId: "entity-a",
        },
      },
    } as never,
    [
      { entityType: "product", externalId: "single", changeKind: "upsert" },
      { entityType: "product", externalId: "duplicate", changeKind: "upsert" },
      { entityType: "product", externalId: "duplicate", changeKind: "upsert" },
      { entityType: "release", externalId: "release", changeKind: "upsert" },
      { entityType: "product", externalId: "deleted", changeKind: "tombstone" },
    ],
  );
  return { queued, queries, rpc, context };
}

describe("connector planner tenant-scoped storage", () => {
  it("fails closed on mapping, candidate, field and policy lookup outages", async () => {
    const { context, queued } = queryFixture();
    const methods = [
      () => context.findActiveMapping("product", "external"),
      () => context.findProductCandidatesByCode("code"),
      () => context.findReleaseCandidatesByVersion("product", "version"),
      () => context.getProductFields("product"),
      () => context.getReleaseFields("product", "release"),
      () => context.getFieldAuthorityPolicy("product", "name"),
    ];
    for (const method of methods) {
      queued.push({ data: null, error: { message: "upstream-canary" } });
      await expect(method()).rejects.toThrow(/connector_.*_lookup_failed/);
    }
  });
  it("resolves mappings and fields without treating other tenants as candidates", async () => {
    const { context, queued, queries } = queryFixture();
    queued.push({ data: null, error: null });
    expect(await context.findActiveMapping("product", "external")).toBeNull();
    queued.push({
      data: { id: "identity", cra_product_id: "product", cra_release_id: null },
      error: null,
    });
    expect(await context.findActiveMapping("product", "external")).toEqual({
      id: "identity",
      craProductId: "product",
      craReleaseId: null,
    });
    queued.push(
      { data: [{ id: "product" }], error: null },
      { data: null, count: 1, error: null },
    );
    expect(await context.findProductCandidatesByCode("code")).toEqual([
      { productId: "product", hasOtherActiveMapping: true },
    ]);
    queued.push({ data: [{ id: "release" }], error: null });
    expect(
      await context.findReleaseCandidatesByVersion("product", "version"),
    ).toEqual([{ releaseId: "release", hasOtherActiveMapping: false }]);
    queued.push({ data: null, error: null });
    expect(await context.getProductFields("product")).toBeNull();
    queued.push({
      data: {
        name: "name",
        internal_code: "code",
        product_type: "software",
        description: null,
        version: 3,
      },
      error: null,
    });
    expect(await context.getProductFields("product")).toMatchObject({
      internalCode: "code",
      version: 3,
    });
    queued.push({ data: null, error: null });
    expect(await context.getReleaseFields("product", "release")).toBeNull();
    queued.push({
      data: {
        label: "label",
        release_version: "1.0",
        description: null,
        version: 2,
      },
      error: null,
    });
    expect(await context.getReleaseFields("product", "release")).toMatchObject({
      releaseVersion: "1.0",
      version: 2,
    });
    queued.push({ data: null, error: null });
    expect(await context.getFieldAuthorityPolicy("product", "name")).toBeNull();
    queued.push({
      data: {
        id: "policy",
        policy_value: "external",
        protected: true,
        policy_version: 2,
      },
      error: null,
    });
    expect(
      await context.getFieldAuthorityPolicy("product", "name"),
    ).toMatchObject({ id: "policy", policyVersion: 2, protected: true });
    for (const query of queries)
      expect(query.eq).toHaveBeenCalledWith("organization_id", "org-a");
    expect(context.isProductExternalIdPlanned("single")).toBe(true);
    expect(context.isProductExternalIdPlanned("duplicate")).toBe(false);
    expect(context.isProductExternalIdPlanned("deleted")).toBe(false);
    expect(context.hashValue(null)).toMatch(/^[a-f0-9]{64}$/);
    expect(context.hashValue("value")).not.toBe(context.hashValue(null));
    expect(context.nowIso()).toMatch(/^\d{4}-/);
  });
  it("uses connector-owned hierarchy and the existing organization graph preview", async () => {
    const { context, queued, queries, rpc } = queryFixture();
    queued.push({
      data: [{ id: "identity", cra_product_id: "parent" }],
      error: null,
    });
    expect(
      await context.getActiveProductMappingsForExternalParent(
        "parent-external",
      ),
    ).toEqual([{ identityId: "identity", craProductId: "parent" }]);
    queued.push({ data: null, error: null });
    expect(await context.getConnectorOwnedParent("child")).toEqual({
      outcome: "none",
    });
    queued.push({ data: [{ source_product_id: "parent" }], error: null });
    expect(await context.getConnectorOwnedParent("child")).toEqual({
      outcome: "one",
      parentProductId: "parent",
    });
    queued.push({
      data: [{ source_product_id: "first" }, { source_product_id: "second" }],
      error: null,
    });
    expect(await context.getConnectorOwnedParent("child")).toEqual({
      outcome: "ambiguous",
      parentProductIds: ["first", "second"],
    });
    queued.push({
      data: { product_relationship_graph_version: 2 },
      error: null,
    });
    expect(
      await context.wouldCreateEmbeddedComponentCycle("parent", "child"),
    ).toBe(false);
    expect(rpc).toHaveBeenCalledWith(
      "m2_component_link_preview",
      expect.objectContaining({
        p_organization_id: "org-a",
        p_parent_product_id: "parent",
        p_component_product_id: "child",
        p_graph_version: 2,
      }),
    );
    rpc.mockResolvedValue({ data: { outcome: "cycle" }, error: null });
    queued.push({
      data: { product_relationship_graph_version: 2 },
      error: null,
    });
    expect(
      await context.wouldCreateEmbeddedComponentCycle("parent", "child"),
    ).toBe(true);
    for (const query of queries)
      expect(query.eq).toHaveBeenCalledWith("organization_id", "org-a");
    queued.push({ data: null, error: {} });
    await expect(
      context.getActiveProductMappingsForExternalParent("external"),
    ).rejects.toThrow("connector_parent_mapping_lookup_failed");
    queued.push({ data: null, error: {} });
    await expect(context.getConnectorOwnedParent("child")).rejects.toThrow(
      "connector_owned_parent_lookup_failed",
    );
    queued.push({ data: null, error: {} });
    await expect(
      context.wouldCreateEmbeddedComponentCycle("parent", "child"),
    ).rejects.toThrow("connector_relationship_graph_lookup_failed");
    rpc.mockResolvedValue({ data: null, error: {} });
    queued.push({
      data: { product_relationship_graph_version: 2 },
      error: null,
    });
    await expect(
      context.wouldCreateEmbeddedComponentCycle("parent", "child"),
    ).rejects.toThrow("connector_relationship_graph_preview_failed");
  });
});
