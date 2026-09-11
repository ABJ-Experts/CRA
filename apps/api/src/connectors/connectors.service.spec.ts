import type { ConnectorPort } from "./application/connector-port";
import { ConnectorsService } from "./connectors.service";

const organizationId = "00000000-0000-4000-8000-000000000001";
const connectorId = "00000000-0000-4000-8000-000000000002";
const actorId = "00000000-0000-4000-8000-000000000003";

function connector(overrides: Record<string, unknown> = {}) {
  return {
    id: connectorId,
    connectorType: "reference_conformance",
    connectionConfig: { scopeFilter: { scenario: "create" } },
    hasSecret: true,
    ...overrides,
  };
}

function fixture(result: Awaited<ReturnType<ConnectorPort["testConnection"]>>) {
  const repository = {
    getConnector: jest.fn().mockResolvedValue(connector()),
    resolveConnectorSecret: jest.fn().mockResolvedValue("fixture-secret"),
    testConnector: jest.fn().mockResolvedValue({ id: connectorId }),
  };
  const testConnection = jest.fn().mockResolvedValue(result);
  const adapter: ConnectorPort = {
    connectorType: "reference_conformance",
    adapterVersion: "1.0.0",
    mappingVersion: "reference-v1",
    testConnection,
    discoverCapabilities: jest.fn(),
    pull: jest.fn(),
    push: jest.fn(),
  };
  return {
    repository,
    adapter,
    testConnection,
    service: new ConnectorsService(
      repository as never,
      new Map([[adapter.connectorType, adapter]]),
      "connector-test-key",
    ),
  };
}

describe("ConnectorsService.testConnection", () => {
  it("resolves the secret only on the server, calls the selected port, and persists a safe success outcome", async () => {
    const { service, repository, testConnection } = fixture({
      outcome: "success",
      latencyMs: 12,
      adapterVersion: "1.0.0",
    });

    await expect(
      service.testConnection({ organizationId, connectorId, actorId }),
    ).resolves.toEqual({ id: connectorId });

    expect(repository.resolveConnectorSecret).toHaveBeenCalledWith(
      organizationId,
      connectorId,
      "connector-test-key",
    );
    expect(testConnection).toHaveBeenCalledWith({
      connectorType: "reference_conformance",
      scopeFilter: { scenario: "create" },
      secretReference: {
        provider: "reference_fixture",
        reference: "fixture-secret",
      },
    });
    expect(repository.testConnector).toHaveBeenCalledWith(
      organizationId,
      connectorId,
      actorId,
      "success",
      null,
      12,
    );
  });

  it("records only the safe failure code, never the adapter message or secret", async () => {
    const { service, repository } = fixture({
      outcome: "failure",
      errorCode: "auth_failed",
      message: "The fixture secret is invalid: fixture-secret",
    });

    await service.testConnection({ organizationId, connectorId, actorId });

    expect(repository.testConnector).toHaveBeenCalledWith(
      organizationId,
      connectorId,
      actorId,
      "failure",
      "auth_failed",
      0,
    );
    expect(JSON.stringify(repository.testConnector.mock.calls)).not.toContain(
      "fixture-secret",
    );
  });

  it("fails closed when a connector type has no registered adapter", async () => {
    const { service, repository } = fixture({
      outcome: "success",
      latencyMs: 1,
      adapterVersion: "1.0.0",
    });
    repository.getConnector.mockResolvedValueOnce(
      connector({ connectorType: "unregistered" }),
    );

    await expect(
      service.testConnection({ organizationId, connectorId, actorId }),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(repository.resolveConnectorSecret).not.toHaveBeenCalled();
  });
});
