export interface BackupCleanupExecutionRequest {
  readonly instanceId: string;
  readonly runId: string;
  readonly actor: string;
  readonly workerId: string;
  readonly expectedVersion: number;
  readonly reviewFingerprint: string;
  readonly idempotencyKey: string;
  readonly sourceAlias: string;
  readonly repositoryAlias: string;
}
export interface BackupCleanupPort {
  cleanup(
    request: BackupCleanupExecutionRequest,
    signal: AbortSignal,
  ): Promise<void>;
}
