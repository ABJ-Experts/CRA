import {
  backupCertificateSchema,
  backupVerificationResultSchema,
  backupVerificationCheckSchema,
} from "@repo/contracts/backups/schemas";
import type {
  BackupPolicyConfiguration,
  BackupRun,
} from "@repo/contracts/backups/types";
import type {
  BackupCaptureRequest,
  BackupCaptureResult,
  BackupVerificationRequest,
  BackupVerificationResult,
} from "../application/backup-execution.port";
import type { BackupWorkerRequests } from "../worker/backup-worker";
import {
  resolveBackupMounts,
  type BackupMountedRuntime,
} from "./capture/backup-mounted-runtime";
import { EncryptedBackupRepository } from "./repository/encrypted-backup.repository";
export class MountedBackupWorkerRequests implements BackupWorkerRequests {
  constructor(private readonly runtime: BackupMountedRuntime) {}
  async capture(
    run: BackupRun,
    configuration: BackupPolicyConfiguration,
  ): Promise<BackupCaptureRequest> {
    const repository = this.runtime.repositories[configuration.repositoryAlias];
    const key = this.runtime.keys[configuration.keyAlias];
    if (
      !repository ||
      !key ||
      key.keyId !== configuration.keyAlias ||
      repository.residency !== configuration.residency
    )
      throw new Error("configuration_invalid");
    const request = {
      runId: run.id,
      instanceId: run.instanceId,
      configurationRevision: run.configurationRevision,
      repositoryGeneration: repository.generation,
      sourceAlias: configuration.sourceAlias,
      repositoryAlias: configuration.repositoryAlias,
      stagingAlias: configuration.stagingAlias,
      keyAlias: configuration.keyAlias,
      keyId: key.keyId,
      pauseLimitSeconds: configuration.pauseLimitSeconds,
      baseIntervalHours: configuration.baseIntervalHours,
    };
    await resolveBackupMounts(this.runtime, request);
    return request;
  }
  async verification(
    run: BackupRun,
    configuration: BackupPolicyConfiguration,
    signal?: AbortSignal,
  ): Promise<BackupVerificationRequest> {
    if (!run.parentRunId) throw new Error("manifest_invalid");
    const request = await this.capture(run, configuration);
    const mounts = await resolveBackupMounts(this.runtime, request);
    if (mounts.staging.kind !== "encrypted") throw new Error("staging_unsafe");
    const repository = new EncryptedBackupRepository({
      repository: mounts.repository.path,
      keyFile: mounts.key.path,
      keyId: mounts.key.keyId,
      keyFilesById: Object.fromEntries(
        Object.values(this.runtime.keys).map((key) => [key.keyId, key.path]),
      ),
      gpgBinary: this.runtime.gpgBinary,
      maximumPartBytes: mounts.staging.maximumBytes,
    });
    const certificate = await repository.loadCertificateInMemory(
      run.parentRunId,
      signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
    );
    return {
      runId: run.id,
      instanceId: run.instanceId,
      parentRunId: run.parentRunId,
      certificate,
      repositoryAlias: configuration.repositoryAlias,
      stagingAlias: configuration.stagingAlias,
      keyAlias: configuration.keyAlias,
      targetProfile: configuration.targetProfile,
    };
  }
  captured(result: BackupCaptureResult): unknown {
    const cert = result.certificate;
    const total = (kind: string) =>
      cert.parts
        .filter((part) => part.kind === kind)
        .reduce((sum, part) => sum + part.bytes, 0);
    return backupCertificateSchema.parse({
      version: 1,
      checkpointId: cert.runId,
      certifiedAt: cert.capturedAt,
      recoveryPointAt: cert.capturedAt,
      manifestSha256: cert.certificateDigest,
      repositoryGeneration: cert.repositoryGeneration,
      keyId: cert.keyId,
      baseRunId: cert.baseRunId ?? cert.runId,
      timeline: cert.checkpoint.timeline,
      checkpointLsn: cert.checkpoint.lsn,
      sourceSystemIdentifier: cert.checkpoint.systemIdentifier,
      databaseBytes: total("base"),
      objectBytes: total("objects"),
      objectCount: result.objectCount,
      walBytes: total("wal"),
      postgresqlVersion: cert.checkpoint.postgresVersion,
      integrity: "passed",
    });
  }
  verified(
    result: BackupVerificationResult,
    request: BackupVerificationRequest,
  ): unknown {
    const total = (kind: string) =>
      request.certificate.parts
        .filter((part) => part.kind === kind)
        .reduce((sum, part) => sum + part.bytes, 0);
    return backupVerificationResultSchema.parse({
      targetProfile: request.targetProfile,
      verifiedAt: result.completedAt,
      integrity: result.verified ? "passed" : "failed",
      checks: backupVerificationCheckSchema.shape.code.options.map((code) => {
        const matching = result.checks.filter((check) => check.code === code);
        const status = matching.some((check) => check.status === "failed")
          ? "failed"
          : matching.some((check) => check.status === "unavailable") ||
              matching.length === 0
            ? "unavailable"
            : "passed";
        return {
          code,
          status,
          durationMs: matching.reduce(
            (sum, check) => sum + check.durationMs,
            0,
          ),
          failureCode: status === "passed" ? null : "restore_failed",
        };
      }),
      recoveryPointAgeMs: Math.max(
        0,
        Date.parse(result.completedAt) -
          Date.parse(request.certificate.capturedAt),
      ),
      recoveryDurationMs: result.durationMs,
      measuredProfile: request.targetProfile,
      databaseBytes: total("base"),
      objectBytes: total("objects"),
    });
  }
}
