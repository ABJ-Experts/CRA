import type {
  Connector,
  ConnectorOverview,
  SyncRun,
} from "@repo/contracts/connectors/types";
import type { PageParams, Paged } from "@repo/contracts/pagination";
import type { ConnectorAuthorization } from "./connector-authorization.port";
import type { ConnectorSecretEnvelope } from "./connector-vault.port";

export type ConnectorHubContext = Readonly<{
  connector: Connector;
  connectionRevision: number;
  credentialRevision: number;
  secret: Readonly<{
    secretId: string;
    credentialRevision: number;
    envelope: ConnectorSecretEnvelope | null;
    legacy: boolean;
    legacyCiphertextBase64?: string;
  }> | null;
}>;
export type ConnectorCommand = Readonly<{
  id: string;
  operation: string;
  state: "running" | "completed" | "interrupted";
  connectionRevision: number;
  credentialRevision: number;
  permissionVersion: number;
  requestDigestKeyId: string;
  deadlineAt: string | null;
  result: unknown;
}>;
export type ConnectorCommandRequest = Readonly<{
  authorization: ConnectorAuthorization;
  connectorId: string;
  operation:
    | "configure"
    | "replace_secret"
    | "revoke_secret"
    | "disconnect"
    | "reconnect"
    | "test_connection";
  expectedVersion: number;
  idempotencyKey: string;
  requestDigest: string;
  requestDigestKeyId: string;
  payload: Readonly<Record<string, unknown>>;
}>;
export type ConnectorSafeTestResult = Readonly<{
  outcome: "success" | "failure";
  errorCode: string | null;
  latencyMs: number;
  scope: Readonly<{
    status: "unknown" | "not_applicable" | "compliant" | "missing" | "excess";
    policyVersion: string;
    grantedScopes: readonly string[];
    missingScopes: readonly string[];
    excessScopes: readonly string[];
  }>;
}>;

export interface ConnectorHubRepository {
  context(orgId: string, connectorId: string): Promise<ConnectorHubContext>;
  command(
    orgId: string,
    connectorId: string,
    actorId: string,
    idempotencyKey: string,
  ): Promise<ConnectorCommand | null>;
  execute(orgId: string, request: ConnectorCommandRequest): Promise<Connector>;
  beginTest(
    orgId: string,
    request: ConnectorCommandRequest,
  ): Promise<
    Readonly<{
      outcome: "started" | "replayed";
      connector: Connector;
      command: ConnectorCommand;
    }>
  >;
  finalizeTest(
    orgId: string,
    connectorId: string,
    command: ConnectorCommand,
    authorization: ConnectorAuthorization,
    result: ConnectorSafeTestResult,
  ): Promise<Connector>;
  create(
    orgId: string,
    authorization: ConnectorAuthorization,
    input: Readonly<Record<string, unknown>>,
  ): Promise<Connector>;
  beginSync(
    orgId: string,
    authorization: ConnectorAuthorization,
    connectorId: string,
    reconciliationKind: string,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<SyncRun>;
  requestCommit(
    orgId: string,
    authorization: ConnectorAuthorization,
    connectorId: string,
    runId: string,
    expectedRowCount: number | null,
  ): Promise<SyncRun>;
  overview(orgId: string, connectorId: string): Promise<ConnectorOverview>;
  overviews(
    orgId: string,
    params: PageParams,
  ): Promise<Paged<ConnectorOverview>>;
}

/** URL policy may resolve DNS; references never perform an unguarded request. */
export interface ConnectorEgressPolicy {
  validate(config: Readonly<Record<string, unknown>>): Promise<void>;
}
