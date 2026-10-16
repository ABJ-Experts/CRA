import { ConnectorSyncOperationsUseCases } from "../application/connector-sync-operations-use-cases";
import { ReferenceConformanceAdapter } from "../reference-adapter/reference-conformance-adapter";
import { NodeConnectorEgressPolicy } from "./node-connector-egress.policy";

const orgId = "11111111-1111-4111-8111-111111111111";
const connectorId = "22222222-2222-4222-8222-222222222222";
const actorId = "33333333-3333-4333-8333-333333333333";

function setup(connectionConfig: Readonly<Record<string, unknown>> = {}) {
  const adapter = new ReferenceConformanceAdapter();
  const context = {
    connector: {
      connectorType: adapter.connectorType,
      adapterVersion: adapter.adapterVersion,
      mappingVersion: adapter.mappingVersion,
      connectionConfig,
    },
    connectionRevision: 1,
    secret: {
      secretId: "44444444-4444-4444-8444-444444444444",
      credentialRevision: 1,
      envelope: null,
      legacy: true,
    },
  };
  const useCases = new ConnectorSyncOperationsUseCases(
    {} as never,
    { authorize: jest.fn().mockResolvedValue({}) },
    { context: jest.fn().mockResolvedValue(context) } as never,
    {} as never,
    new Map([[adapter.connectorType, adapter]]),
    new NodeConnectorEgressPolicy([]),
    { read: jest.fn().mockResolvedValue("isolated-canary-credential") },
  );
  return { useCases, adapter };
}

describe("sync operations with the concrete egress policy", () => {
  it("validates persisted configuration without adapter runtime fields or credentials", async () => {
    const { useCases } = setup();
    const preview = await useCases.previewMapping(orgId, connectorId, actorId, {
      fields: [
        {
          entityType: "product",
          sourceField: "name",
          targetField: "name",
          transform: "identity",
        },
      ],
    });
    expect(preview.valid).toBe(true);
    expect(preview.samples[0]?.fields).toEqual({ name: "Sentinel Gateway" });
    expect(JSON.stringify(preview)).not.toContain("isolated-canary-credential");
  });

  it("rejects unsafe persisted configuration before calling the adapter", async () => {
    const { useCases, adapter } = setup({ baseUrl: "http://127.0.0.1" });
    const discover = jest.spyOn(adapter, "discoverCapabilities");
    await expect(
      useCases.mappingSchema(orgId, connectorId, actorId),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(discover).not.toHaveBeenCalled();
  });
});
