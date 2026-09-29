import { secureWorker } from "./connector-sync-worker.fixture";
import {
  ConnectorSyncWorker,
  cursorAfterPage,
  cursorInputFor,
  toClaimedSyncRun,
} from "./connector-sync-worker";
import { ReferenceConformanceAdapter } from "../reference-adapter/reference-conformance-adapter";

describe("connector worker recorded authorization and credential fences", () => {
  it("rejects duplicate normalized source identities before persisting or advancing any plan", async () => {
    const { worker, adapter, repository } = secureWorker();
    const record = {
      entityType: "product",
      externalId: "DUPLICATE",
      externalDisplayLabel: "Duplicate",
      externalUpdatedAt: "2026-01-01T00:00:00.000Z",
      changeKind: "upsert",
      tombstoneReliability: "unknown",
      parentExternalId: null,
      fields: {
        name: "Duplicate",
        internalCode: "DUPLICATE",
        productType: "component",
      },
    };
    adapter.pull.mockResolvedValue({
      records: [record, { ...record, externalId: " duplicate " }],
      nextCursor: null,
      adapterSignal: "ok",
    });
    await worker.runOnce();
    expect(repository.saveSyncRunPlan).not.toHaveBeenCalled();
    expect(repository.failSyncRun).toHaveBeenCalledWith(
      "org-a",
      "run-a",
      "worker-a",
      "invalid_data",
      2,
      false,
      null,
    );
  });
  it("rejects credential echoes in discovered version metadata and provider cursors", async () => {
    const discovery =
      await new ReferenceConformanceAdapter().discoverCapabilities();
    const schemaLeak = secureWorker();
    schemaLeak.adapter.discoverCapabilities.mockResolvedValue({
      ...discovery,
      adapterVersion: "worker-canary",
    });
    await schemaLeak.worker.runOnce();
    expect(schemaLeak.repository.saveSyncRunPlan).not.toHaveBeenCalled();
    expect(
      JSON.stringify(schemaLeak.repository.failSyncRun.mock.calls),
    ).not.toContain("worker-canary");
    const cursorLeak = secureWorker();
    cursorLeak.adapter.pull.mockResolvedValue({
      records: [],
      nextCursor: { token: "worker-canary", watermark: "2026-01-01" },
      adapterSignal: "ok",
    });
    await cursorLeak.worker.runOnce();
    expect(cursorLeak.repository.saveSyncRunPlan).not.toHaveBeenCalled();
    expect(
      JSON.stringify(cursorLeak.repository.failSyncRun.mock.calls),
    ).not.toContain("worker-canary");
  });
  it.each(["externalId", "externalDisplayLabel", "parentExternalId", "name"])(
    "never retains a credential echoed into approved %s",
    async (field) => {
      const { worker, adapter, repository } = secureWorker();
      const record: Record<string, unknown> = {
        entityType: "product",
        externalId: "safe-id",
        externalDisplayLabel: "Safe",
        externalUpdatedAt: "2026-01-01T00:00:00.000Z",
        changeKind: "upsert",
        tombstoneReliability: "unknown",
        parentExternalId: null,
        fields: {
          name: "Safe",
          internalCode: "SAFE",
          productType: "component",
        },
      };
      if (field === "name")
        record.fields = { ...(record.fields as object), name: "worker-canary" };
      else record[field] = "worker-canary";
      adapter.pull.mockResolvedValue({
        records: [record],
        nextCursor: null,
        adapterSignal: "ok",
      });
      await worker.runOnce();
      const serialized = JSON.stringify(repository.saveSyncRunPlan.mock.calls);
      expect(serialized).not.toContain("worker-canary");
      expect(repository.saveSyncRunPlan).toHaveBeenCalledWith(
        expect.objectContaining({
          p_plan_items: [
            expect.objectContaining({
              externalId: "redacted-record-1",
              sourceSnapshot: null,
            }),
          ],
        }),
      );
    },
  );
  it.each([
    "plan_basis_changed",
    "cursor_drifted",
    "blocked_by_records",
    "invalid_state",
  ])(
    "terminalizes a claimed commit that cannot progress: %s",
    async (outcome) => {
      const { worker, repository } = secureWorker({ workKind: "commit" });
      repository.commitSyncRun.mockResolvedValue({ outcome });
      await worker.runOnce();
      expect(repository.failSyncRun).toHaveBeenCalledWith(
        "org-a",
        "run-a",
        "worker-a",
        outcome === "invalid_state"
          ? "authorization_changed"
          : outcome === "blocked_by_records"
            ? "invalid_data"
            : "stale_preview",
        2,
        false,
        null,
      );
    },
  );
  it.each([
    "completed",
    "retrying",
    "failed",
    "lease_lost",
    "not_found",
    "waiting_for_review",
  ])(
    "does not replace a SQL-owned or lost commit outcome: %s",
    async (outcome) => {
      const { worker, repository } = secureWorker({ workKind: "commit" });
      repository.commitSyncRun.mockResolvedValue({ outcome });
      await worker.runOnce();
      expect(repository.failSyncRun).not.toHaveBeenCalled();
    },
  );
  it("drops late results when an expired generation can no longer renew its lease", async () => {
    const { worker, repository } = secureWorker();
    repository.renewSyncRunLease.mockResolvedValue(false);
    await worker.runOnce();
    expect(repository.renewSyncRunLease).toHaveBeenCalledWith(
      "org-a",
      "run-a",
      "worker-a",
      2,
      60,
    );
    expect(repository.saveSyncRunPlan).not.toHaveBeenCalled();
  });
  it("isolates poison records, strips raw and sensitive values, and persists the entire blocked batch", async () => {
    const { worker, hub, context, adapter, repository } = secureWorker();
    hub.context.mockResolvedValue({
      ...context,
      connector: {
        ...context.connector,
        connectionConfig: {
          defaultOwnerBinding: {
            responsibleOwnerId: "owner",
            legalEntityId: "legal",
          },
        },
      },
    });
    const base = {
      entityType: "product",
      externalDisplayLabel: "Reference",
      externalUpdatedAt: "2026-01-01T00:00:00.000Z",
      changeKind: "upsert",
      tombstoneReliability: "unknown",
      parentExternalId: null,
    };
    adapter.pull.mockResolvedValue({
      records: [
        {
          ...base,
          externalId: "valid",
          fields: {
            name: "Valid",
            internalCode: "VALID",
            productType: "component",
            description: null,
            fixtureCredential: "secret-canary",
          },
          raw: { token: "secret-canary" },
        },
        {
          ...base,
          externalId: "poison",
          fields: {
            name: "Poison",
            internalCode: "POISON",
            productType: "unsupported",
          },
        },
        {
          ...base,
          externalId: "malformed",
          fields: { name: "x".repeat(4_001) },
        },
      ],
      nextCursor: null,
      adapterSignal: "ok",
    });
    await worker.runOnce();
    expect(repository.saveSyncRunPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        p_plan_items: expect.arrayContaining([
          expect.objectContaining({
            externalId: "valid",
            proposedAction: "create",
            errorCategory: null,
          }),
          expect.objectContaining({
            externalId: "poison",
            proposedAction: "rejected",
            errorCategory: "invalid_data",
          }),
          expect.objectContaining({
            externalId: "invalid-record-3",
            proposedAction: "rejected",
            sourceSnapshot: null,
          }),
        ]) as unknown,
      }),
    );
    expect(JSON.stringify(repository.saveSyncRunPlan.mock.calls)).not.toContain(
      "secret-canary",
    );
    expect(repository.commitSyncRun).not.toHaveBeenCalled();
  });
  it("persists review conflicts with safe authority metadata", async () => {
    const schemaSnapshot =
      await new ReferenceConformanceAdapter().discoverCapabilities();
    const { worker, hub, context, repository } = secureWorker({
      replaySourceMode: "retained",
      schemaSnapshot,
      replaySourceRecords: [
        {
          entityType: "product",
          externalId: "new",
          externalDisplayLabel: "New",
          externalUpdatedAt: "2026-01-01T00:00:00.000Z",
          changeKind: "upsert",
          tombstoneReliability: "unknown",
          parentExternalId: "missing-parent",
          fields: {
            name: "New",
            internalCode: "NEW",
            productType: "component",
            description: null,
          },
        },
      ],
    });
    hub.context.mockResolvedValue({
      ...context,
      connector: {
        ...context.connector,
        connectionConfig: {
          defaultOwnerBinding: {
            responsibleOwnerId: "owner",
            legalEntityId: "legal",
          },
        },
      },
    });
    await worker.runOnce();
    expect(repository.saveSyncRunPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        p_conflicts: expect.arrayContaining([
          expect.objectContaining({
            fieldPath: "parentExternalId",
            permittedActions: ["keep_cra", "enter_manual_value"],
          }),
        ]) as unknown,
      }),
    );
  });
  it("fails closed for stale discovered schemas, missing retained schemas, and unsupported adapters", async () => {
    const schemaSnapshot =
      await new ReferenceConformanceAdapter().discoverCapabilities();
    for (const overrides of [
      { schemaSnapshot: { ...schemaSnapshot, adapterVersion: "old" } },
      { replaySourceMode: "retained" },
    ]) {
      const { worker, repository } = secureWorker(overrides);
      await worker.runOnce();
      expect(repository.saveSyncRunPlan).not.toHaveBeenCalled();
      expect(repository.failSyncRun).toHaveBeenCalledWith(
        "org-a",
        "run-a",
        "worker-a",
        "stale_preview",
        2,
        false,
        null,
      );
    }
    const { worker, hub, context, repository } = secureWorker();
    hub.context.mockResolvedValue({
      ...context,
      connector: { ...context.connector, connectorType: "unregistered" },
    });
    await worker.runOnce();
    expect(repository.failSyncRun).toHaveBeenCalledWith(
      "org-a",
      "run-a",
      "worker-a",
      "unsupported_connector_type",
      2,
      false,
      null,
    );
  });
  it("classifies valid authentication and availability failures without storing provider messages", async () => {
    for (const errorCode of ["auth_failed", "unreachable"]) {
      const { worker, adapter, repository } = secureWorker();
      adapter.testConnection.mockResolvedValue({
        outcome: "failure",
        errorCode,
        message: "private provider detail",
      });
      await worker.runOnce();
      expect(repository.failSyncRun).toHaveBeenCalledWith(
        "org-a",
        "run-a",
        "worker-a",
        errorCode === "unreachable" ? "provider_unavailable" : "auth_failed",
        2,
        errorCode === "unreachable",
        null,
      );
    }
  });
  it("fences persisted plans and commits by claim generation", async () => {
    const dry = secureWorker();
    await dry.worker.runOnce();
    expect(dry.repository.saveSyncRunPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        p_generation: 2,
        p_schema_snapshot: expect.any(Object) as unknown,
      }),
    );
    const commit = secureWorker({ workKind: "commit" });
    await commit.worker.runOnce();
    expect(commit.repository.commitSyncRun).toHaveBeenCalledWith(
      expect.objectContaining({ p_generation: 2, p_worker_id: "worker-a" }),
    );
  });
  it("replays retained records without another provider read", async () => {
    const schemaSnapshot =
      await new ReferenceConformanceAdapter().discoverCapabilities();
    const { worker, adapter, repository } = secureWorker({
      replaySourceMode: "retained",
      replaySourceRecords: [],
      schemaSnapshot,
    });
    await worker.runOnce();
    expect(adapter.pull).not.toHaveBeenCalled();
    expect(repository.saveSyncRunPlan).toHaveBeenCalled();
  });
  it("does not discover or persist malformed source schema", async () => {
    const { worker, adapter, repository } = secureWorker();
    adapter.discoverCapabilities.mockResolvedValue({ entities: [] });
    await worker.runOnce();
    expect(adapter.pull).not.toHaveBeenCalled();
    expect(repository.saveSyncRunPlan).not.toHaveBeenCalled();
  });
  it("persists a provider not-before wait and generation without payload messages", async () => {
    const { worker, adapter, repository } = secureWorker();
    adapter.pull.mockResolvedValue({
      records: [],
      nextCursor: null,
      adapterSignal: "rate_limited",
      retryAfterSeconds: 900,
    });
    await worker.runOnce();
    expect(repository.failSyncRun).toHaveBeenCalledWith(
      "org-a",
      "run-a",
      "worker-a",
      "rate_limited",
      2,
      true,
      900,
    );
  });
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
        2,
        ["unavailable", "rate_limited"].includes(adapterSignal),
        null,
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
      2,
      false,
      null,
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
        leaseGeneration: 1,
        fieldMappingSnapshot: [],
        fieldMappingRevision: 0,
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
