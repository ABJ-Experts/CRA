/** Executor-only types. Mounted paths and credentials never cross the HTTP boundary. */
export type BackupPartKind =
  "base" | "wal" | "objects" | "inventory" | "recovery-key";

export interface BackupEncryptedPart {
  readonly keyId?: string;
  readonly id: string;
  readonly kind: BackupPartKind;
  readonly name: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly cipherSha256: string;
  readonly cipherBytes: number;
}

export interface BackupCertificate {
  readonly formatVersion: 1;
  readonly instanceId: string;
  readonly runId: string;
  readonly repositoryGeneration: string;
  readonly configurationRevision: number;
  readonly keyId: string;
  readonly capturedAt: string;
  readonly baseCapturedAt?: string;
  readonly baseRunId?: string;
  readonly coveredOrganizationIds?: readonly string[];
  readonly checkpoint: {
    readonly systemIdentifier: string;
    readonly timeline: number;
    readonly lsn: string;
    readonly postgresVersion: "17.6";
    readonly restorePoint: string;
  };
  readonly parts: readonly BackupEncryptedPart[];
  readonly inventoryDigest: string;
  readonly auditHeadsDigest: string;
  readonly certificateDigest: string;
}

export interface BackupCaptureRequest {
  readonly runId: string;
  readonly instanceId: string;
  readonly configurationRevision: number;
  readonly repositoryGeneration: string;
  readonly sourceAlias: string;
  readonly repositoryAlias: string;
  readonly stagingAlias: string;
  readonly keyAlias: string;
  readonly keyId: string;
  readonly pauseLimitSeconds: number;
  readonly baseIntervalHours?: number;
}

export interface BackupExecutionContext {
  readonly signal: AbortSignal;
  checkpoint(stage: string, progress: number): Promise<void>;
  assertAuthority(): Promise<void>;
}

export interface BackupCaptureResult {
  readonly coveredOrganizationIds?: readonly string[];
  readonly certificate: BackupCertificate;
  readonly bytes: number;
  readonly objectCount: number;
  readonly durationMs: number;
}

export interface BackupVerificationRequest {
  readonly runId: string;
  readonly instanceId: string;
  readonly parentRunId: string;
  readonly certificate: BackupCertificate;
  readonly repositoryAlias: string;
  readonly stagingAlias: string;
  readonly keyAlias: string;
  readonly targetProfile: string;
}

export interface BackupVerificationCheck {
  readonly code: string;
  readonly status: "passed" | "failed" | "unavailable";
  readonly durationMs: number;
}

export interface BackupVerificationResult {
  readonly verified: boolean;
  readonly checks: readonly BackupVerificationCheck[];
  readonly durationMs: number;
  readonly completedAt: string;
}

export interface BackupExecutionPort {
  capture(
    request: BackupCaptureRequest,
    context: BackupExecutionContext,
  ): Promise<BackupCaptureResult>;
  verify(
    request: BackupVerificationRequest,
    context: BackupExecutionContext,
  ): Promise<BackupVerificationResult>;
  stop?(): Promise<void>;
  reconcile?(request: BackupCaptureRequest, signal: AbortSignal): Promise<void>;
}

export class BackupExecutionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "BackupExecutionError";
  }
}

export interface BackupObjectInventoryEntry {
  /** Exact committed Storage metadata identity, encrypted at rest in the inventory. */
  readonly bucketId: string;
  readonly name: string;
  readonly version: string | null;
  /** Archive entry is generated from the row ordinal, never a source pathname. */
  readonly entry: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface BackupInventory {
  readonly catalog: unknown;
  readonly auditHeads: unknown;
  readonly objects: readonly BackupObjectInventoryEntry[];
  readonly externalKeyChecks: readonly {
    readonly alias: string;
    readonly canaryPartId: string;
  }[];
}
