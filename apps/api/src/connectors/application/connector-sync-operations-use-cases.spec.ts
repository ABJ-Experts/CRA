import { ConnectorSyncOperationsUseCases } from "./connector-sync-operations-use-cases";
import { connectorMappingDiscovery } from "./connector-field-mapping-policy";
const orgId = "11111111-1111-4111-8111-111111111111",
  connectorId = "22222222-2222-4222-8222-222222222222",
  actorId = "33333333-3333-4333-8333-333333333333",
  key = "44444444-4444-4444-8444-444444444444";
const capabilities = {
  adapterVersion: "1",
  mappingVersion: "v1",
  entities: [
    {
      entityType: "product" as const,
      supportsPush: false,
      supportsTombstones: true,
      supportsHierarchy: true,
      fields: [
        {
          field: "name",
          vendorFieldPath: "name",
          supportsPull: true,
          supportsPush: false,
          type: "string" as const,
          nullable: false,
          required: true,
          sensitive: false,
        },
      ],
    },
  ],
};
const fields = [
  {
    entityType: "product" as const,
    sourceField: "name",
    targetField: "name",
    transform: "identity" as const,
  },
];
const page = {
  records: [
    {
      entityType: "product",
      externalId: "one",
      externalDisplayLabel: "One",
      externalUpdatedAt: "2026-09-29T00:00:00Z",
      changeKind: "upsert",
      tombstoneReliability: "unknown",
      parentExternalId: null,
      fields: { name: "Name" },
      raw: { secret: "canary" },
    },
  ],
  adapterSignal: "ok",
  nextCursor: null,
};
function setup() {
  const authorization = {
    organizationId: orgId,
    actorId,
    permissionVersion: 1,
    role: "owner" as const,
  };
  const authorize = jest.fn().mockResolvedValue(authorization);
  const repository = {
    currentMapping: jest.fn().mockResolvedValue({ revision: 0, fields: [] }),
    history: jest.fn().mockResolvedValue({ rows: [] }),
    detail: jest.fn(),
    deadLetters: jest.fn(),
    replayPreview: jest.fn(),
    replay: jest.fn(),
    saveMapping: jest.fn(),
  };
  const context = {
    connector: {
      id: connectorId,
      connectorType: "reference_conformance",
      adapterVersion: "1",
      mappingVersion: "v1",
      connectionConfig: {},
    },
    connectionRevision: 1,
    secret: {
      secretId: key,
      credentialRevision: 1,
      envelope: null,
      legacy: true,
    },
  };
  const hub = {
    context: jest.fn().mockResolvedValue(context),
    command: jest.fn().mockResolvedValue(null),
  };
  const vault = {
    fingerprint: jest
      .fn()
      .mockReturnValue({ digest: "a".repeat(64), keyId: "key-1" }),
  };
  const adapter = {
    discoverCapabilities: jest.fn().mockResolvedValue(capabilities),
    pull: jest.fn().mockResolvedValue(page),
  };
  const adapters = new Map([["reference_conformance", adapter]]);
  const egress = { validate: jest.fn().mockResolvedValue(undefined) },
    reader = { read: jest.fn().mockResolvedValue("fixture") };
  const useCases = new ConnectorSyncOperationsUseCases(
    repository,
    { authorize },
    hub as never,
    vault as never,
    adapters as never,
    egress,
    reader,
  );
  return {
    useCases,
    authorize,
    repository,
    hub,
    vault,
    adapter,
    egress,
    reader,
    context,
    authorization,
  };
}
describe("sync operations use cases", () => {
  it("reauthorizes all tenant scoped reads", async () => {
    const { useCases, authorize, repository } = setup();
    await useCases.currentMapping(orgId, connectorId, actorId);
    await useCases.history(orgId, connectorId, actorId, {
      page: 1,
      pageSize: 15,
    });
    await useCases.detail(orgId, connectorId, key, actorId, {
      page: 1,
      pageSize: 15,
    });
    await useCases.deadLetters(orgId, connectorId, actorId, {
      page: 1,
      pageSize: 15,
    });
    expect(authorize).toHaveBeenCalledTimes(4);
    expect(repository.currentMapping).toHaveBeenCalledWith(orgId, connectorId);
  });
  it("does not read after revoked permission", async () => {
    const { useCases, authorize, repository } = setup();
    authorize.mockRejectedValueOnce(new Error("revoked"));
    await expect(
      useCases.currentMapping(orgId, connectorId, actorId),
    ).rejects.toThrow("revoked");
    expect(repository.currentMapping).not.toHaveBeenCalled();
  });
  it("discovers typed schemas and bounded safe samples", async () => {
    const { useCases, egress, authorize } = setup();
    expect(
      (await useCases.mappingSchema(orgId, connectorId, actorId)).sources[0]
        ?.fields[0]?.type,
    ).toBe("string");
    const result = await useCases.previewMapping(orgId, connectorId, actorId, {
      fields,
    });
    expect(result.valid).toBe(true);
    expect(JSON.stringify(result)).not.toContain("canary");
    expect(egress.validate).toHaveBeenCalledTimes(3);
    expect(authorize).toHaveBeenCalledWith(orgId, actorId, [
      "can_edit_connectors",
    ]);
  });
  it("returns reviewable mapping failures without calling pull", async () => {
    const { useCases, adapter } = setup();
    const result = await useCases.previewMapping(orgId, connectorId, actorId, {
      fields: [{ ...fields[0]!, targetField: "organizationId" }],
    });
    expect(result.valid).toBe(false);
    expect(adapter.pull).not.toHaveBeenCalled();
  });
  it("surfaces per-record invalid values safely", async () => {
    const { useCases, adapter } = setup();
    adapter.pull.mockResolvedValueOnce({
      ...page,
      records: [{ ...page.records[0]!, fields: { name: "" } }],
    });
    const result = await useCases.previewMapping(orgId, connectorId, actorId, {
      fields,
    });
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe("invalid_value");
  });
  it.each(["malformed", "outage", "oversize"])(
    "rejects %s provider previews",
    async (kind) => {
      const { useCases, adapter } = setup();
      if (kind === "malformed")
        adapter.pull.mockResolvedValueOnce({ records: [] });
      if (kind === "outage")
        adapter.pull.mockResolvedValueOnce({
          ...page,
          adapterSignal: "unavailable",
        });
      if (kind === "oversize")
        adapter.pull.mockResolvedValueOnce({
          ...page,
          records: Array.from({ length: 11 }, () => page.records[0]!),
        });
      await expect(
        useCases.previewMapping(orgId, connectorId, actorId, { fields }),
      ).rejects.toMatchObject({ code: "unavailable" });
    },
  );
  it("rejects late previews after configuration change", async () => {
    const { useCases, hub, context } = setup();
    hub.context
      .mockResolvedValueOnce(context)
      .mockResolvedValueOnce({ ...context, connectionRevision: 2 });
    await expect(
      useCases.previewMapping(orgId, connectorId, actorId, { fields }),
    ).rejects.toMatchObject({ code: "stale_preview" });
  });
  it("validates schema and mappings before durable save", async () => {
    const { useCases, repository, vault, hub } = setup();
    hub.command.mockResolvedValue({ requestDigestKeyId: "old-key" });
    const input = {
      expectedVersion: 1,
      expectedMappingRevision: 0,
      idempotencyKey: key,
      schemaDigest: connectorMappingDiscovery(capabilities).schemaDigest,
      fields,
    };
    await useCases.saveMapping(orgId, connectorId, actorId, input);
    expect(repository.saveMapping).toHaveBeenCalled();
    expect(vault.fingerprint).toHaveBeenCalledWith(
      orgId,
      connectorId,
      expect.any(String),
      "old-key",
    );
    await expect(
      useCases.saveMapping(orgId, connectorId, actorId, {
        ...input,
        schemaDigest: "b".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "stale_preview" });
    await expect(
      useCases.saveMapping(orgId, connectorId, actorId, {
        ...input,
        fields: [{ ...fields[0]!, targetField: "approvalState" }],
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });
  it("fingerprints replay and checks current edit permission", async () => {
    const { useCases, repository, authorize } = setup();
    const input = {
      expectedVersion: 1,
      mappingMode: "preserve" as const,
      sourceMode: "retained" as const,
    };
    await useCases.replayPreview(orgId, connectorId, key, actorId, input);
    await useCases.replay(orgId, connectorId, key, actorId, {
      ...input,
      idempotencyKey: key,
      previewDigest: "a".repeat(64),
      reason: "Review",
    });
    expect(authorize).toHaveBeenCalledWith(orgId, actorId, [
      "can_edit_connectors",
    ]);
    expect(repository.replay).toHaveBeenCalledWith(
      orgId,
      connectorId,
      key,
      expect.anything(),
      expect.anything(),
      { digest: "a".repeat(64), keyId: "key-1" },
    );
  });
  it("does not issue a command when fingerprint key is unavailable", async () => {
    const { useCases, vault, repository } = setup();
    vault.fingerprint.mockImplementation(() => {
      throw new Error("canary");
    });
    await expect(
      useCases.replay(orgId, connectorId, key, actorId, {
        expectedVersion: 1,
        mappingMode: "preserve",
        sourceMode: "retained",
        idempotencyKey: key,
        previewDigest: "a".repeat(64),
        reason: "Review",
      }),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(repository.replay).not.toHaveBeenCalled();
  });
  it.each(["secret", "reader", "discovery", "schema", "version"])(
    "handles unavailable %s safely",
    async (kind) => {
      const { useCases, hub, context, reader, adapter } = setup();
      if (kind === "secret")
        hub.context.mockResolvedValueOnce({ ...context, secret: null });
      if (kind === "reader")
        reader.read.mockRejectedValueOnce(new Error("canary"));
      if (kind === "discovery")
        adapter.discoverCapabilities.mockRejectedValueOnce(new Error("canary"));
      if (kind === "schema")
        adapter.discoverCapabilities.mockResolvedValueOnce({});
      if (kind === "version")
        adapter.discoverCapabilities.mockResolvedValueOnce({
          ...capabilities,
          adapterVersion: "2",
        });
      await expect(
        useCases.mappingSchema(orgId, connectorId, actorId),
      ).rejects.toMatchObject({ code: "unavailable" });
    },
  );
  it("times out a provider that ignores cancellation", async () => {
    jest.useFakeTimers();
    try {
      const { useCases, adapter } = setup();
      adapter.discoverCapabilities.mockReturnValueOnce(new Promise(() => {}));
      const promise = useCases.mappingSchema(orgId, connectorId, actorId);
      const check = expect(promise).rejects.toMatchObject({
        code: "unavailable",
      });
      await jest.advanceTimersByTimeAsync(10_001);
      await check;
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("durable mapping replay", () => {
  it("replays an authorized completed command during provider outage", async () => {
    const { useCases, hub, adapter, repository } = setup();
    hub.command.mockResolvedValue({
      state: "completed",
      operation: "save_field_mapping",
      requestDigestKeyId: "retained-key",
    });
    adapter.discoverCapabilities.mockRejectedValue(new Error("outage"));
    const input = {
      expectedVersion: 1,
      expectedMappingRevision: 0,
      idempotencyKey: key,
      schemaDigest: connectorMappingDiscovery(capabilities).schemaDigest,
      fields,
    };
    await useCases.saveMapping(orgId, connectorId, actorId, input);
    expect(adapter.discoverCapabilities).not.toHaveBeenCalled();
    expect(repository.saveMapping).toHaveBeenCalled();
  });
});

describe("credential canary previews", () => {
  it("rejects credential echoes in business values and safe identities", async () => {
    const { useCases, adapter } = setup();
    adapter.pull.mockResolvedValueOnce({
      ...page,
      records: [
        {
          ...page.records[0]!,
          externalId: "fixture-one",
          fields: { name: "contains fixture credential" },
        },
      ],
    });
    const result = await useCases.previewMapping(orgId, connectorId, actorId, {
      fields,
    });
    expect(result.valid).toBe(false);
    expect(JSON.stringify(result)).not.toContain("fixture");
    expect(result.samples[0]?.externalId).toBe("redacted-record");
  });
});

describe("legacy configured mapping labels", () => {
  it("keeps adapter discovery distinct from the existing user mapping label", async () => {
    const { useCases, hub, context } = setup();
    hub.context.mockResolvedValue({
      ...context,
      connector: {
        ...context.connector,
        mappingVersion: "configured-legacy-v1",
      },
    });
    expect(
      (await useCases.mappingSchema(orgId, connectorId, actorId))
        .mappingVersion,
    ).toBe("v1");
  });
});

describe("provider metadata canary rejection", () => {
  it("rejects exact active credentials in discovered source metadata", async () => {
    const { useCases, adapter } = setup();
    adapter.discoverCapabilities.mockResolvedValueOnce({
      ...capabilities,
      entities: [
        {
          ...capabilities.entities[0]!,
          fields: [
            {
              ...capabilities.entities[0]!.fields[0]!,
              field: "fixture-secret",
              vendorFieldPath: "fixture-secret",
            },
          ],
        },
      ],
    });
    await expect(
      useCases.mappingSchema(orgId, connectorId, actorId),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
  it("rejects secret-bearing provider cursors without serializing them", async () => {
    const { useCases, adapter } = setup();
    adapter.pull.mockResolvedValueOnce({
      ...page,
      nextCursor: { token: "fixture-canary", watermark: "safe" },
    });
    await expect(
      useCases.previewMapping(orgId, connectorId, actorId, { fields }),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
});
