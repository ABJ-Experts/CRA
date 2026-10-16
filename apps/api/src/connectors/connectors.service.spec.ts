import type { ConnectorPort } from "./application/connector-port";
import { ConnectorsService } from "./connectors.service";
import {
  ConnectorError,
  type ConnectorErrorCode,
} from "./application/connector-errors";

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
  it("uses the authorized hub for versioned tests and fails closed without it", async () => {
    const { repository } = fixture({
      outcome: "success",
      latencyMs: 1,
      adapterVersion: "1.0.0",
    });
    const test = jest.fn().mockResolvedValue({ safe: true });
    const service = new ConnectorsService(
      repository as never,
      undefined,
      undefined,
      { test } as never,
    );
    const input = { expectedVersion: 1, idempotencyKey: connectorId };
    await expect(
      service.testConnection({ organizationId, connectorId, actorId, input }),
    ).resolves.toEqual({ safe: true });
    expect(test).toHaveBeenCalledWith(
      organizationId,
      connectorId,
      actorId,
      input,
    );
    expect(repository.getConnector).not.toHaveBeenCalled();
    expect(() => new ConnectorsService(repository as never).hub).toThrow(
      ConnectorError,
    );
  });

  it.each([
    null,
    [],
    {
      baseUrl: "https://fixture.example",
      tenantOrSiteId: "site",
      scopeFilter: { scenario: "create", unsafe: 42 },
    },
  ])(
    "preserves legacy tests without a configured credential or unsafe scope values",
    async (connectionConfig) => {
      const { service, repository, testConnection } = fixture({
        outcome: "success",
        latencyMs: 1,
        adapterVersion: "1.0.0",
      });
      repository.getConnector.mockResolvedValueOnce(
        connector({ hasSecret: false, connectionConfig }),
      );
      await service.testConnection({ organizationId, connectorId, actorId });
      expect(repository.resolveConnectorSecret).not.toHaveBeenCalled();
      expect(testConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          secretReference: { provider: "reference_fixture", reference: "" },
        }),
      );
      expect(JSON.stringify(testConnection.mock.calls)).not.toContain("unsafe");
    },
  );
  it.each<readonly [ConnectorErrorCode, number]>([
    ["invalid_request", 400],
    ["not_found", 404],
    ["conflict", 409],
    ["invalid_state", 409],
    ["already_running", 409],
    ["stale_preview", 409],
    ["blocked_by_conflicts", 409],
    ["blocked_by_dead_letter", 409],
    ["idempotency_mismatch", 409],
    ["dry_run_expired", 410],
    ["forbidden_by_policy", 403],
    ["rate_limited", 429],
    ["retryable_unavailable", 503],
    ["unavailable", 503],
    ["payload_too_large", 400],
    ["unsupported_content_type", 400],
  ])("returns safe HTTP %s outcomes with status %s", async (code, status) => {
    const { service } = fixture({
      outcome: "success",
      latencyMs: 1,
      adapterVersion: "1.0.0",
    });
    await expect(
      service.run(
        Promise.reject(new ConnectorError(code, "upstream-secret-canary")),
      ),
    ).rejects.toMatchObject({ status, response: { code } });
    try {
      await service.run(
        Promise.reject(new ConnectorError(code, "upstream-secret-canary")),
      );
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain("upstream-secret-canary");
    }
  });

  it("passes successful results and unexpected errors through the existing boundary", async () => {
    const { service } = fixture({
      outcome: "success",
      latencyMs: 1,
      adapterVersion: "1.0.0",
    });
    await expect(service.run(Promise.resolve("safe result"))).resolves.toBe(
      "safe result",
    );
    const error = new Error("unexpected");
    await expect(service.run(Promise.reject(error))).rejects.toBe(error);
  });
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
