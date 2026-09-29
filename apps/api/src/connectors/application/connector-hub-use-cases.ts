import { randomUUID } from "node:crypto";
import { testConnectorResultSchema } from "@repo/contracts/connectors/schemas";
import type {
  CreateConnectorInput,
  ConnectorOverview,
  BeginSyncRunInput,
  DisconnectConnectorInput,
  ReconnectConnectorInput,
  RevokeConnectorSecretInput,
  SetConnectorSecretInput,
  TestConnectorInput,
  UpdateConnectorInput,
} from "@repo/contracts/connectors/types";
import type { PageParams } from "@repo/contracts/pagination";
import { safeConnectorTestDiagnostic } from "./connector-scope-policy";
import { CONNECTOR_SCOPE_POLICY_VERSION } from "./connector-catalogue";
import type { ConnectorCredentialReaderPort } from "./connector-vault.port";
import type { ConnectorAuthorizationPort } from "./connector-authorization.port";
import { ConnectorError } from "./connector-errors";
import type {
  ConnectorCommandRequest,
  ConnectorEgressPolicy,
  ConnectorHubContext,
  ConnectorHubRepository,
  ConnectorSafeTestResult,
} from "./connector-hub-repository.port";
import type { ConnectorPort, ConnectorType } from "./connector-port";
import {
  ConnectorVaultUnavailableError,
  type ConnectorVaultPort,
} from "./connector-vault.port";

const testScope = Object.freeze({
  status: "not_applicable" as const,
  policyVersion: CONNECTOR_SCOPE_POLICY_VERSION,
  grantedScopes: [],
  missingScopes: [],
  excessScopes: [],
});

/** Deterministic ordering is required for keyed request identity across retries. */
export function canonicalConnectorRequest(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonicalConnectorRequest).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([name, item]) =>
          `${JSON.stringify(name)}:${canonicalConnectorRequest(item)}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export class ConnectorHubUseCases {
  constructor(
    private readonly repository: ConnectorHubRepository,
    private readonly authorization: ConnectorAuthorizationPort,
    private readonly vault: ConnectorVaultPort,
    private readonly adapters: ReadonlyMap<ConnectorType, ConnectorPort>,
    private readonly egress: ConnectorEgressPolicy,
    private readonly testTimeoutMs = 10_000,
    private readonly credentialReader?: ConnectorCredentialReaderPort,
  ) {}

  async overview(orgId: string, connectorId: string) {
    return this.vaultHealth(await this.repository.overview(orgId, connectorId));
  }
  async overviews(orgId: string, params: PageParams) {
    const page = await this.repository.overviews(orgId, params);
    return {
      ...page,
      rows: page.rows.map((overview) => this.vaultHealth(overview)),
    };
  }
  private vaultHealth(overview: ConnectorOverview): ConnectorOverview {
    if (
      this.vault.available() ||
      !["healthy", "syncing"].includes(overview.connection.status)
    )
      return overview;
    return {
      ...overview,
      connection: {
        ...overview.connection,
        status: "degraded",
        reason: "vault_unavailable",
        test: safeConnectorTestDiagnostic("vault_unavailable", null),
      },
    };
  }

  async create(orgId: string, actorId: string, input: CreateConnectorInput) {
    const authorization = await this.authorization.authorize(orgId, actorId, [
      "can_create_connectors",
    ]);
    const adapter = this.adapters.get(input.connectorType);
    if (!adapter || adapter.adapterVersion !== input.adapterVersion)
      throw new ConnectorError("invalid_request");
    await this.egress.validate(input.connectionConfig ?? {});
    if (input.commitPolicy === "auto")
      await this.authorization.authorize(orgId, actorId, [
        "can_approve_connectors",
      ]);
    return this.repository.create(orgId, authorization, input);
  }

  async beginSync(
    orgId: string,
    connectorId: string,
    actorId: string,
    input: BeginSyncRunInput,
  ) {
    const authorization = await this.authorization.authorize(orgId, actorId, [
      "can_create_connectors",
    ]);
    return this.repository.beginSync(
      orgId,
      authorization,
      connectorId,
      input.reconciliationKind,
      input.idempotencyKey,
      randomUUID(),
    );
  }
  async requestCommit(
    orgId: string,
    connectorId: string,
    runId: string,
    actorId: string,
    expectedRowCount: number | null,
  ) {
    const authorization = await this.authorization.authorize(orgId, actorId, [
      "can_approve_connectors",
    ]);
    return this.repository.requestCommit(
      orgId,
      authorization,
      connectorId,
      runId,
      expectedRowCount,
    );
  }
  async configure(
    orgId: string,
    connectorId: string,
    actorId: string,
    input: UpdateConnectorInput,
  ) {
    const request = await this.request(
      orgId,
      connectorId,
      actorId,
      "configure",
      input,
      false,
    );
    await this.egress.validate(input.connectionConfig ?? {});
    if (input.commitPolicy === "auto")
      await this.authorization.authorize(orgId, actorId, [
        "can_approve_connectors",
      ]);
    return this.repository.execute(orgId, {
      ...request,
      payload: {
        displayName: input.displayName,
        mappingVersion: input.mappingVersion,
        commitPolicy: input.commitPolicy,
        connectionConfig: input.connectionConfig ?? {},
      },
    });
  }

  async replaceSecret(
    orgId: string,
    connectorId: string,
    actorId: string,
    input: SetConnectorSecretInput,
  ) {
    const request = await this.request(
      orgId,
      connectorId,
      actorId,
      "replace_secret",
      input,
      true,
    );
    const context = await this.repository.context(orgId, connectorId);
    const secretId = randomUUID();
    const credentialRevision = context.credentialRevision + 1;
    let envelope;
    try {
      envelope = this.vault.encrypt(
        { orgId, connectorId, secretId, credentialRevision },
        input.secretValue,
      );
    } catch {
      throw new ConnectorError("unavailable");
    }
    return this.repository.execute(orgId, {
      ...request,
      payload: { secretId, credentialRevision, ...envelope },
    });
  }

  async revokeSecret(
    orgId: string,
    connectorId: string,
    actorId: string,
    input: RevokeConnectorSecretInput,
  ) {
    return this.simple(
      orgId,
      connectorId,
      actorId,
      "revoke_secret",
      input,
      true,
    );
  }
  async disconnect(
    orgId: string,
    connectorId: string,
    actorId: string,
    input: DisconnectConnectorInput,
  ) {
    return this.simple(orgId, connectorId, actorId, "disconnect", input, false);
  }
  async reconnect(
    orgId: string,
    connectorId: string,
    actorId: string,
    input: ReconnectConnectorInput,
  ) {
    const request = await this.request(
      orgId,
      connectorId,
      actorId,
      "reconnect",
      input,
      false,
    );
    const context = await this.repository.context(orgId, connectorId);
    try {
      await this.readCredential(orgId, context);
    } catch {
      throw new ConnectorError("unavailable");
    }
    return this.repository.execute(orgId, request);
  }

  async test(
    orgId: string,
    connectorId: string,
    actorId: string,
    input: TestConnectorInput,
  ) {
    const request = await this.request(
      orgId,
      connectorId,
      actorId,
      "test_connection",
      input,
      false,
    );
    const started = await this.repository.beginTest(orgId, request);
    if (started.outcome === "replayed") return started.connector;
    let result: ConnectorSafeTestResult;
    try {
      const context = await this.repository.context(orgId, connectorId);
      await this.egress.validate(context.connector.connectionConfig);
      const adapter = this.adapters.get(context.connector.connectorType);
      if (!adapter) result = failure("unsupported_capability");
      else
        result = await this.invokeTest(
          orgId,
          context,
          adapter,
          started.command.id,
        );
    } catch (error) {
      result = failure(
        error instanceof ConnectorVaultUnavailableError
          ? "vault_unavailable"
          : "unknown",
      );
    }
    // Never reuse the request authorization after a slow provider call.
    const authorization = await this.authorization.authorize(orgId, actorId, [
      "can_edit_connectors",
    ]);
    return this.repository.finalizeTest(
      orgId,
      connectorId,
      started.command,
      authorization,
      result,
    );
  }

  private async invokeTest(
    orgId: string,
    context: ConnectorHubContext,
    adapter: ConnectorPort,
    commandId: string,
  ): Promise<ConnectorSafeTestResult> {
    const secret = context.secret;
    if (!secret) return failure("auth_failed");
    const value = await this.readCredential(orgId, context);
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const raw = await Promise.race([
        adapter.testConnection({
          connectorType: context.connector.connectorType,
          ...context.connector.connectionConfig,
          secretReference: { provider: "reference_fixture", reference: value },
          executionIdentity: `${orgId}:${context.connector.id}:test:${commandId}`,
          signal: abort.signal,
        }),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => {
            abort.abort();
            resolve(null);
          }, this.testTimeoutMs);
        }),
      ]);
      if (raw === null) return failure("timeout");
      const parsed = testConnectorResultSchema.safeParse(raw);
      if (!parsed.success) return failure("malformed_response");
      const outcome = parsed.data;
      if (outcome.outcome === "failure") return failure(outcome.errorCode);
      if (outcome.adapterVersion !== context.connector.adapterVersion)
        return failure("unsupported_version");
      return Object.freeze({
        outcome: "success",
        errorCode: null,
        latencyMs: Math.min(outcome.latencyMs, 120_000),
        scope: testScope,
      });
    } finally {
      if (timer) clearTimeout(timer);
      abort.abort();
    }
  }

  private async readCredential(
    orgId: string,
    context: ConnectorHubContext,
  ): Promise<string> {
    const secret = context.secret;
    if (!secret) throw new ConnectorVaultUnavailableError();
    const binding = {
      orgId,
      connectorId: context.connector.id,
      secretId: secret.secretId,
      credentialRevision: secret.credentialRevision,
    };
    if (this.credentialReader)
      return this.credentialReader.read(binding, secret);
    if (!secret.envelope) throw new ConnectorVaultUnavailableError();
    return this.vault.decrypt(binding, secret.envelope);
  }

  private async simple(
    orgId: string,
    connectorId: string,
    actorId: string,
    operation: "revoke_secret" | "disconnect" | "reconnect",
    input: { expectedVersion: number; idempotencyKey: string; reason?: string },
    ownerOnly: boolean,
  ) {
    const request = await this.request(
      orgId,
      connectorId,
      actorId,
      operation,
      input,
      ownerOnly,
    );
    return this.repository.execute(orgId, {
      ...request,
      payload: "reason" in input ? { reason: input.reason } : {},
    });
  }

  private async request(
    orgId: string,
    connectorId: string,
    actorId: string,
    operation: ConnectorCommandRequest["operation"],
    input: { expectedVersion: number; idempotencyKey: string },
    ownerOnly: boolean,
  ): Promise<ConnectorCommandRequest> {
    const authorization = await this.authorization.authorize(
      orgId,
      actorId,
      ["can_edit_connectors"],
      ownerOnly,
    );
    const retained = await this.repository.command(
      orgId,
      connectorId,
      actorId,
      input.idempotencyKey,
    );
    let fingerprint;
    try {
      fingerprint = this.vault.fingerprint(
        orgId,
        connectorId,
        canonicalConnectorRequest({ operation, input }),
        retained?.requestDigestKeyId,
      );
    } catch {
      throw new ConnectorError("unavailable");
    }
    return Object.freeze({
      authorization,
      connectorId,
      operation,
      expectedVersion: input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
      requestDigest: fingerprint.digest,
      requestDigestKeyId: fingerprint.keyId,
      payload: {},
    });
  }
}

function failure(errorCode: string): ConnectorSafeTestResult {
  return Object.freeze({
    outcome: "failure",
    errorCode,
    latencyMs: 0,
    scope: testScope,
  });
}
