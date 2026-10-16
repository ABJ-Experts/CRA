import { ConnectorVaultUnavailableError } from "./connector-vault.port";
import {
  ConnectorHubUseCases,
  canonicalConnectorRequest,
} from "./connector-hub-use-cases";
import type { ConnectorPort, ConnectorType } from "./connector-port";

const org = "00000000-0000-4000-8000-000000000001";
const id = "00000000-0000-4000-8000-000000000002";
const actor = "00000000-0000-4000-8000-000000000003";
const key = "00000000-0000-4000-8000-000000000004";
const canary = "credential-canary-never-persist";
function fixture(timeoutMs = 100) {
  const connector = {
    id,
    organizationId: org,
    connectorType: "reference_conformance",
    displayName: "Fixture",
    adapterVersion: "1.0.0",
    mappingVersion: "reference-v1",
    connectionConfig: {},
    hasSecret: true,
    commitPolicy: "manual",
    enabled: true,
    lastTestedAt: null,
    lastTestOutcome: null,
    lastTestErrorCode: null,
    archivedAt: null,
    version: 1,
    createdAt: "2026-09-28T00:00:00.000Z",
    updatedAt: "2026-09-28T00:00:00.000Z",
    createdBy: actor,
    updatedBy: actor,
  };
  const context = {
    connector,
    connectionRevision: 1,
    credentialRevision: 1,
    secret: {
      secretId: id,
      credentialRevision: 1,
      envelope: {
        format: "aes-256-gcm-v1",
        keyId: "key-1",
        nonce: "opaque",
        authTag: "opaque",
        ciphertext: "opaque",
      },
    },
  };
  const repository = {
    context: jest.fn().mockResolvedValue(context),
    command: jest.fn().mockResolvedValue(null),
    execute: jest.fn().mockResolvedValue(connector),
    beginTest: jest.fn().mockResolvedValue({
      outcome: "started",
      command: { id: key, connectionRevision: 1, credentialRevision: 1 },
    }),
    finalizeTest: jest.fn().mockResolvedValue(connector),
    create: jest.fn().mockResolvedValue(connector),
    overview: jest.fn().mockResolvedValue({
      connector,
      connection: { status: "not_connected" },
    }),
    overviews: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    beginSync: jest.fn(),
    requestCommit: jest.fn(),
  };
  const authorization = {
    authorize: jest.fn().mockResolvedValue({
      organizationId: org,
      actorId: actor,
      role: "owner",
      permissionVersion: 1,
    }),
  };
  const vault = {
    available: jest.fn().mockReturnValue(true),
    keyIds: jest.fn().mockReturnValue(["key-1"]),
    encrypt: jest.fn().mockReturnValue(context.secret.envelope),
    decrypt: jest.fn().mockReturnValue(canary),
    fingerprint: jest
      .fn()
      .mockReturnValue({ keyId: "key-1", digest: "a".repeat(64) }),
  };
  const adapter = {
    connectorType: "reference_conformance" as const,
    adapterVersion: "1.0.0",
    mappingVersion: "reference-v1",
    testConnection: jest.fn().mockResolvedValue({
      outcome: "success",
      latencyMs: 2,
      adapterVersion: "1.0.0",
    }),
    discoverCapabilities: jest.fn(),
    pull: jest.fn(),
    push: jest.fn(),
  };
  const agentAdapter = {
    ...adapter,
    connectorType: "on_prem_agent" as const,
    testConnection: jest.fn().mockResolvedValue({
      outcome: "success",
      latencyMs: 0,
      adapterVersion: "1.0.0",
    }),
  };
  const egress = { validate: jest.fn().mockResolvedValue(undefined) };
  const useCases = new ConnectorHubUseCases(
    repository,
    authorization,
    vault,
    new Map<ConnectorType, ConnectorPort>([
      ["reference_conformance", adapter],
      ["on_prem_agent", agentAdapter],
    ]),
    egress,
    timeoutMs,
  );
  return {
    useCases,
    repository,
    authorization,
    vault,
    adapter,
    agentAdapter,
    egress,
    context,
    connector,
  };
}
describe("ConnectorHubUseCases security boundaries", () => {
  it("encrypts before persistence and keeps secret bytes out of RPC arguments", async () => {
    const f = fixture();
    await f.useCases.replaceSecret(org, id, actor, {
      secretValue: canary,
      expectedVersion: 1,
      idempotencyKey: key,
    });
    expect(f.authorization.authorize).toHaveBeenCalledWith(
      org,
      actor,
      ["can_edit_connectors"],
      true,
    );
    expect(f.vault.encrypt).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: org,
        connectorId: id,
        credentialRevision: 2,
      }),
      canary,
    );
    expect(JSON.stringify(f.repository.execute.mock.calls)).not.toContain(
      canary,
    );
  });
  it("uses the retained fingerprint key for retries across rotation", async () => {
    const f = fixture();
    f.repository.command.mockResolvedValue({
      requestDigestKeyId: "old-key",
    });
    await f.useCases.replaceSecret(org, id, actor, {
      secretValue: canary,
      expectedVersion: 1,
      idempotencyKey: key,
    });
    expect(f.vault.fingerprint).toHaveBeenCalledWith(
      org,
      id,
      expect.any(String),
      "old-key",
    );
  });
  it("records only approved test codes, never upstream text or credentials", async () => {
    const f = fixture();
    f.adapter.testConnection.mockResolvedValue({
      outcome: "failure",
      errorCode: "auth_failed",
      message: canary,
    });
    await f.useCases.test(org, id, actor, {
      expectedVersion: 1,
      idempotencyKey: key,
    });
    expect(JSON.stringify(f.repository.finalizeTest.mock.calls)).not.toContain(
      canary,
    );
    expect(f.adapter.pull).not.toHaveBeenCalled();
    expect(f.adapter.push).not.toHaveBeenCalled();
  });
  it("rejects unavailable and mismatched adapters before configuration creation", async () => {
    const f = fixture();
    await expect(
      f.useCases.create(org, actor, {
        connectorType: "reference_conformance",
        adapterVersion: "9.0.0",
        mappingVersion: "reference-v1",
        displayName: "Fixture",
        commitPolicy: "manual",
        idempotencyKey: key,
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(f.repository.create).not.toHaveBeenCalled();
  });
  it("allows external metadata without a product/release adapter and requires owner authorization", async () => {
    const f = fixture();
    for (const [
      connectorType,
      mappingVersion,
      displayName,
      connectionConfig,
    ] of [
      [
        "github_actions",
        "ci-v1",
        "GitHub App",
        { providerHost: "github.com", appId: "123", installationId: "456" },
      ],
      [
        "jira",
        "jira-v1",
        "Jira Cloud",
        {
          providerHost: "api.atlassian.com",
          siteHost: "tenant.atlassian.net",
          cloudId: key,
        },
      ],
    ] as const)
      await f.useCases.create(org, actor, {
        connectorType,
        adapterVersion: "1.0.0",
        mappingVersion,
        displayName,
        connectionConfig,
        commitPolicy: "manual",
        idempotencyKey: key,
      });
    expect(f.authorization.authorize).toHaveBeenCalledWith(
      org,
      actor,
      ["can_create_connectors"],
      true,
    );
    expect(f.egress.validate).toHaveBeenCalledWith(
      { providerHost: "github.com", appId: "123", installationId: "456" },
      "github_actions",
    );
    expect(f.egress.validate).toHaveBeenCalledWith(
      {
        providerHost: "api.atlassian.com",
        siteHost: "tenant.atlassian.net",
        cloudId: key,
      },
      "jira",
    );
    expect(f.repository.create).toHaveBeenCalledTimes(2);
  });
  it("checks the active envelope before reconnecting", async () => {
    const f = fixture();
    f.vault.decrypt.mockImplementation(() => {
      throw new Error("wrong key");
    });
    await expect(
      f.useCases.reconnect(org, id, actor, {
        expectedVersion: 1,
        idempotencyKey: key,
      }),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(f.repository.execute).not.toHaveBeenCalled();
  });
  it("denies permission failures before opening the vault or invoking the adapter", async () => {
    const f = fixture();
    f.authorization.authorize.mockRejectedValue(new Error("denied"));
    await expect(
      f.useCases.test(org, id, actor, {
        expectedVersion: 1,
        idempotencyKey: key,
      }),
    ).rejects.toThrow("denied");
    expect(f.vault.decrypt).not.toHaveBeenCalled();
    expect(f.adapter.testConnection).not.toHaveBeenCalled();
  });
});

describe("ConnectorHubUseCases command lifecycle", () => {
  const input = { expectedVersion: 1, idempotencyKey: key };
  it("canonicalizes nested request objects without depending on property insertion order", () => {
    expect(
      canonicalConnectorRequest({
        b: [2, null],
        a: { z: 1, omitted: undefined },
      }),
    ).toBe(canonicalConnectorRequest({ a: { z: 1 }, b: [2, null] }));
    expect(canonicalConnectorRequest(undefined)).toBe("null");
  });
  it("delegates bounded overview queries without opening credentials", async () => {
    const f = fixture();
    await f.useCases.overview(org, id);
    await f.useCases.overviews(org, { page: 1, pageSize: 20, order: "desc" });
    expect(f.repository.overview).toHaveBeenCalledWith(org, id);
    expect(f.vault.decrypt).not.toHaveBeenCalled();
  });
  it("creates an approved adapter and checks auto-commit permission", async () => {
    const f = fixture();
    await f.useCases.create(org, actor, {
      connectorType: "reference_conformance",
      adapterVersion: "1.0.0",
      displayName: "Fixture",
      mappingVersion: "reference-v1",
      commitPolicy: "auto",
      idempotencyKey: key,
    });
    expect(f.authorization.authorize).toHaveBeenCalledWith(org, actor, [
      "can_approve_connectors",
    ]);
    expect(f.repository.create).toHaveBeenCalledWith(
      org,
      expect.objectContaining({ actorId: actor }),
      expect.any(Object),
    );
  });
  it("requires approval permission for auto configuration and persists only allowed fields", async () => {
    const f = fixture();
    await f.useCases.configure(org, id, actor, {
      ...input,
      displayName: "Fixture",
      mappingVersion: "reference-v1",
      commitPolicy: "auto",
    });
    expect(f.repository.execute).toHaveBeenCalledWith(
      org,
      expect.objectContaining({
        operation: "configure",
        payload: {
          displayName: "Fixture",
          mappingVersion: "reference-v1",
          commitPolicy: "auto",
          connectionConfig: {},
        },
      }),
    );
  });
  it("authorizes recorded sync initiation and approval through application ports", async () => {
    const f = fixture();
    await f.useCases.beginSync(org, id, actor, {
      reconciliationKind: "full",
      idempotencyKey: key,
    });
    await f.useCases.requestCommit(org, id, key, actor, 3);
    expect(f.repository.beginSync).toHaveBeenCalledWith(
      org,
      expect.objectContaining({ actorId: actor }),
      id,
      "full",
      key,
      expect.any(String),
    );
    expect(f.repository.requestCommit).toHaveBeenCalledWith(
      org,
      expect.objectContaining({ actorId: actor }),
      id,
      key,
      3,
    );
  });
  it("does not enqueue product or release sync for an external connection", async () => {
    const f = fixture();
    f.repository.context.mockResolvedValue({
      ...f.context,
      connector: { ...f.connector, connectorType: "jira" },
    });
    await expect(
      f.useCases.beginSync(org, id, actor, {
        reconciliationKind: "full",
        idempotencyKey: key,
      }),
    ).rejects.toMatchObject({ code: "invalid_state" });
    await expect(
      f.useCases.requestCommit(org, id, key, actor, 0),
    ).rejects.toMatchObject({ code: "invalid_state" });
    expect(f.repository.beginSync).not.toHaveBeenCalled();
    expect(f.repository.requestCommit).not.toHaveBeenCalled();
  });
  it("allows a staged on-prem agent connector through the reviewed sync path", async () => {
    const f = fixture();
    f.repository.context.mockResolvedValue({
      ...f.context,
      connector: {
        ...f.connector,
        connectorType: "on_prem_agent",
        hasSecret: false,
      },
      secret: null,
    });
    await f.useCases.beginSync(org, id, actor, {
      reconciliationKind: "incremental",
      idempotencyKey: key,
    });
    await f.useCases.requestCommit(org, id, key, actor, 1);
    expect(f.repository.beginSync).toHaveBeenCalledTimes(1);
    expect(f.repository.requestCommit).toHaveBeenCalledTimes(1);
  });
  it("tests and reconnects an active agent without a provider secret", async () => {
    const f = fixture();
    f.repository.context.mockResolvedValue({
      ...f.context,
      connector: {
        ...f.connector,
        connectorType: "on_prem_agent",
        hasSecret: false,
      },
      secret: null,
    });
    await f.useCases.test(org, id, actor, {
      expectedVersion: 1,
      idempotencyKey: key,
    });
    expect(f.agentAdapter.testConnection).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: org, connectorId: id }),
    );
    expect(f.repository.finalizeTest).toHaveBeenCalledWith(
      org,
      id,
      expect.any(Object),
      expect.any(Object),
      expect.objectContaining({ outcome: "success" }),
    );
    await f.useCases.reconnect(org, id, actor, {
      expectedVersion: 1,
      idempotencyKey: key,
    });
    expect(f.repository.execute).toHaveBeenCalled();
    expect(f.vault.decrypt).not.toHaveBeenCalled();
  });
  it("revoke is owner-only and disconnect is edit-only with a redacted reason", async () => {
    const f = fixture();
    await f.useCases.revokeSecret(org, id, actor, {
      ...input,
      reason: "Credential revoked",
    });
    await f.useCases.disconnect(org, id, actor, {
      ...input,
      reason: "Disconnect",
    });
    expect(
      f.authorization.authorize.mock.calls.map((call: unknown[]) => call[3]),
    ).toEqual([true, undefined, false]);
    expect(
      f.repository.execute.mock.calls.map(
        (call: unknown[]) => (call[1] as { operation: string }).operation,
      ),
    ).toEqual(["revoke_secret", "disconnect"]);
  });
  it("requires owner authority before disconnecting an external connection", async () => {
    const f = fixture();
    f.repository.context.mockResolvedValue({
      ...f.context,
      connector: { ...f.connector, connectorType: "jira" },
    });
    await f.useCases.disconnect(org, id, actor, {
      ...input,
      reason: "Project access revoked",
    });
    expect(f.authorization.authorize).toHaveBeenLastCalledWith(
      org,
      actor,
      ["can_edit_connectors"],
      true,
    );
  });
  it("reconnect authenticates before vault access and submits an empty command payload", async () => {
    const f = fixture();
    await f.useCases.reconnect(org, id, actor, input);
    expect(f.vault.decrypt).toHaveBeenCalled();
    expect(f.repository.execute).toHaveBeenCalledWith(
      org,
      expect.objectContaining({ operation: "reconnect", payload: {} }),
    );
  });
  it("replays completed tests without provider calls", async () => {
    const f = fixture();
    f.repository.beginTest.mockResolvedValue({
      outcome: "replayed",
      connector: f.connector,
    });
    await expect(f.useCases.test(org, id, actor, input)).resolves.toEqual(
      f.connector,
    );
    expect(f.adapter.testConnection).not.toHaveBeenCalled();
  });
  it.each([
    [{ outcome: "success", latencyMs: 1, adapterVersion: "1.0.0" }, null],
    [
      { outcome: "success", latencyMs: 1, adapterVersion: "9.0.0" },
      "unsupported_version",
    ],
    [
      {
        outcome: "failure",
        errorCode: "rate_limited",
        message: "Upstream rate limited",
      },
      "rate_limited",
    ],
    [{ outcome: "failure", errorCode: canary }, "malformed_response"],
  ])("validates provider outcomes and sanitizes %j", async (raw, code) => {
    const f = fixture();
    f.adapter.testConnection.mockResolvedValue(raw);
    await f.useCases.test(org, id, actor, input);
    expect(f.repository.finalizeTest).toHaveBeenCalledWith(
      org,
      id,
      expect.any(Object),
      expect.any(Object),
      expect.objectContaining({ errorCode: code }),
    );
    expect(f.authorization.authorize).toHaveBeenCalledTimes(2);
  });
  it("bounds a provider that ignores cancellation without calling sync", async () => {
    const f = fixture(1);
    f.adapter.testConnection.mockImplementation(() => new Promise(() => {}));
    await f.useCases.test(org, id, actor, input);
    expect(f.repository.finalizeTest).toHaveBeenCalledWith(
      org,
      id,
      expect.any(Object),
      expect.any(Object),
      expect.objectContaining({ errorCode: "timeout" }),
    );
    expect(f.adapter.pull).not.toHaveBeenCalled();
  });
  it.each([new ConnectorVaultUnavailableError(), new Error(canary)])(
    "redacts failed dependency results",
    async (error) => {
      const f = fixture();
      f.repository.context.mockRejectedValue(error);
      await f.useCases.test(org, id, actor, input);
      expect(
        JSON.stringify(f.repository.finalizeTest.mock.calls),
      ).not.toContain(canary);
    },
  );
  it("does not finalize under revoked authorization after a slow test", async () => {
    const f = fixture();
    f.authorization.authorize
      .mockResolvedValueOnce({
        organizationId: org,
        actorId: actor,
        role: "owner",
        permissionVersion: 1,
      })
      .mockRejectedValueOnce(new Error("revoked"));
    await expect(f.useCases.test(org, id, actor, input)).rejects.toThrow(
      "revoked",
    );
    expect(f.repository.finalizeTest).not.toHaveBeenCalled();
  });
  it("missing credentials produce an approved authentication category", async () => {
    const f = fixture();
    f.repository.context.mockResolvedValue({
      ...f.context,
      secret: null,
    });
    await f.useCases.test(org, id, actor, input);
    expect(f.repository.finalizeTest).toHaveBeenCalledWith(
      org,
      id,
      expect.any(Object),
      expect.any(Object),
      expect.objectContaining({ errorCode: "auth_failed" }),
    );
  });
  it("missing key material safely blocks fingerprinting and encryption", async () => {
    const f = fixture();
    f.vault.fingerprint.mockImplementation(() => {
      throw new Error(canary);
    });
    await expect(
      f.useCases.disconnect(org, id, actor, { ...input, reason: "Disconnect" }),
    ).rejects.toMatchObject({ code: "unavailable" });
    const g = fixture();
    g.vault.encrypt.mockImplementation(() => {
      throw new Error(canary);
    });
    await expect(
      g.useCases.replaceSecret(org, id, actor, {
        ...input,
        secretValue: canary,
      }),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
  it("legacy without an injected bridge remains safely unavailable", async () => {
    const f = fixture();
    f.repository.context.mockResolvedValue({
      ...f.context,
      secret: { ...f.context.secret, envelope: null, legacy: true },
    });
    await f.useCases.test(org, id, actor, input);
    expect(f.repository.finalizeTest).toHaveBeenCalledWith(
      org,
      id,
      expect.any(Object),
      expect.any(Object),
      expect.objectContaining({ errorCode: "vault_unavailable" }),
    );
  });
});

it("reports a safe degraded health when injected vault keys are unavailable", async () => {
  const f = fixture();
  f.vault.available.mockReturnValue(false);
  f.repository.overview.mockResolvedValue({
    connector: f.connector,
    connection: { status: "healthy", reason: "ready" },
  });
  const overview = await f.useCases.overview(org, id);
  expect(overview.connection).toMatchObject({
    status: "degraded",
    reason: "vault_unavailable",
    test: { category: "vault_unavailable" },
  });
  expect(f.vault.decrypt).not.toHaveBeenCalled();
});
