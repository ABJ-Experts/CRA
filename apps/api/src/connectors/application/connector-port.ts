/**
 * The one seam vendor-specific code may cross. Every adapter (the reference
 * conformance adapter today, a real vendor SDK later) implements this and
 * nothing else in the sync engine may reach past it into vendor specifics.
 */

export type ConnectorType = "reference_conformance";
export type ConnectorEntityType = "product" | "release";

export type SecretReference = Readonly<{
  provider: "reference_fixture" | "vault";
  reference: string;
}>;

export type ConnectorConnectionConfig = Readonly<{
  connectorType: ConnectorType;
  baseUrl?: string;
  tenantOrSiteId?: string;
  scopeFilter?: Readonly<Record<string, string>>;
  secretReference: SecretReference;
}>;

export type ConnectorErrorCode =
  | "auth_failed"
  | "unreachable"
  | "rate_limited"
  | "malformed_response"
  | "unsupported_capability"
  | "payload_too_large"
  | "unknown";

export type ConnectorTestResult =
  | Readonly<{ outcome: "success"; latencyMs: number; adapterVersion: string }>
  | Readonly<{
      outcome: "failure";
      errorCode: ConnectorErrorCode;
      message: string;
    }>;

export type ConnectorFieldCapability = Readonly<{
  field: string;
  supportsPull: boolean;
  supportsPush: boolean;
  vendorFieldPath: string;
}>;

export type ConnectorCapabilities = Readonly<{
  adapterVersion: string;
  mappingVersion: string;
  entities: readonly Readonly<{
    entityType: ConnectorEntityType;
    fields: readonly ConnectorFieldCapability[];
    supportsPush: boolean;
    supportsTombstones: boolean;
    supportsHierarchy: boolean;
  }>[];
}>;

export type SyncCursor = Readonly<{ token: string; watermark: string }>;

export type ExternalRecord = Readonly<{
  entityType: ConnectorEntityType;
  externalId: string;
  externalDisplayLabel: string;
  externalUpdatedAt: string;
  changeKind: "upsert" | "tombstone";
  tombstoneReliability: "confirmed" | "unknown";
  parentExternalId: string | null;
  fields: Readonly<Record<string, string | number | boolean | null>>;
  raw?: unknown;
}>;

export type AdapterSignal =
  "ok" | "cursor_expired" | "cursor_invalid" | "rate_limited" | "unavailable";

export type PullPage = Readonly<{
  records: readonly ExternalRecord[];
  nextCursor: SyncCursor | null;
  adapterSignal: AdapterSignal;
}>;

export type PushRecord = Readonly<{
  entityType: ConnectorEntityType;
  externalId: string;
  fields: Readonly<Record<string, string | number | boolean | null>>;
}>;

export type PushResult =
  | Readonly<{ outcome: "accepted"; externalUpdatedAt: string }>
  | Readonly<{
      outcome: "rejected";
      errorCode: ConnectorErrorCode;
      message: string;
    }>;

export interface ConnectorPort {
  readonly connectorType: ConnectorType;
  readonly adapterVersion: string;
  readonly mappingVersion: string;
  testConnection(
    config: ConnectorConnectionConfig,
  ): Promise<ConnectorTestResult>;
  discoverCapabilities(
    config: ConnectorConnectionConfig,
  ): Promise<ConnectorCapabilities>;
  pull(
    config: ConnectorConnectionConfig,
    cursor: SyncCursor | null,
    pageSize: number,
  ): Promise<PullPage>;
  push(
    config: ConnectorConnectionConfig,
    records: readonly PushRecord[],
  ): Promise<readonly PushResult[]>;
}
