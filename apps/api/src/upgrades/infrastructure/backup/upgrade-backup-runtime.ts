import { createHash } from "node:crypto";
import { z } from "zod";
import {
  backupPolicySchema,
  backupRunSchema,
} from "@repo/contracts/backups/schemas";
import type { BackupRun } from "@repo/contracts/backups/types";
import { loadBackupWorkerRuntime } from "../../../backups/infrastructure/backup-worker-runtime";
import { createBackupExecutor } from "../../../backups/infrastructure/backup-executor";
import {
  NativeBackupWorkerControlClient,
  backupWorkerControlSource,
} from "../../../backups/infrastructure/native-backup-worker-control.client";
import { MountedBackupWorkerRequests } from "../../../backups/infrastructure/backup-worker-requests";
import { BackupWorker } from "../../../backups/worker/backup-worker";
import { EncryptedBackupRepository } from "../../../backups/infrastructure/repository/encrypted-backup.repository";
import {
  AuthenticatedUpgradeBackupHold,
  type UpgradeHold,
} from "./authenticated-upgrade-hold";
import { NativeBackupEvidenceReader } from "./backup-evidence-reader";
import { UpgradeBackupMaterialReader } from "./upgrade-backup-material";
import type { BackupControlPort } from "../../../backups/application/backup-control.port";

const path = z.string().startsWith("/").max(4096);
const name = z.string().regex(/^[a-zA-Z0-9_.-]{1,100}$/);
export const upgradeBackupRuntimeConfigurationSchema = z.strictObject({
  configurationPath: path,
  timeoutMs: z.number().int().min(1000).max(14400000).default(14400000),
  readOnly: z.strictObject({
    psqlBinary: path,
    host: name,
    port: z.number().int().min(1).max(65535),
    database: name,
    user: name,
    pgpassFile: path,
  }),
});
export type UpgradeBackupRuntimeConfiguration = z.output<
  typeof upgradeBackupRuntimeConfigurationSchema
>;
export interface UpgradeBackupRuntime {
  validateExisting(
    upgradeRunId: string,
    signal?: AbortSignal,
  ): Promise<UpgradeHold>;
  checkpointAfterDrain(
    upgradeRunId: string,
    signal?: AbortSignal,
  ): Promise<UpgradeHold>;
}
const requestId = (runId: string, purpose: string) => {
  const hex = createHash("sha256")
    .update(`CRA-UPGRADE-BACKUP-V1\0${runId}\0${purpose}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
/** Linux executor composition. It uses the approved M15-05 runtime and existing audited source RPC workflows. */
export async function createUpgradeBackupRuntime(
  input: z.input<typeof upgradeBackupRuntimeConfigurationSchema> & {
    readonly instanceId: string;
    readonly journalBinding: string;
    readonly hostKey: Buffer;
  },
): Promise<UpgradeBackupRuntime> {
  if (process.platform !== "linux")
    throw new Error("upgrade_backup_runtime_unavailable");
  const { instanceId, journalBinding, hostKey, ...unparsed } = input;
  z.uuid().parse(instanceId);
  const configuration = upgradeBackupRuntimeConfigurationSchema.parse(unparsed);
  const mounted = await loadBackupWorkerRuntime({
    BACKUP_WORKER_ENABLED: "true",
    BACKUP_WORKER_CONFIGURATION_PATH: configuration.configurationPath,
    LICENSING_INSTANCE_ID: instanceId,
  });
  if (!mounted || mounted.instanceId !== instanceId)
    throw new Error("upgrade_backup_runtime_unavailable");
  const control = new NativeBackupWorkerControlClient(
    instanceId,
    backupWorkerControlSource(mounted.runtime, mounted.controlSourceAlias),
  );
  const evidence = new NativeBackupEvidenceReader({
    instanceId,
    ...configuration.readOnly,
  });
  const executor = createBackupExecutor(mounted);
  const requests = new MountedBackupWorkerRequests(mounted.runtime);
  const actor = "backup-worker:upgrade-supervisor";
  const bounded = (signal?: AbortSignal) =>
    signal
      ? AbortSignal.any([signal, AbortSignal.timeout(configuration.timeoutMs)])
      : AbortSignal.timeout(configuration.timeoutMs);
  const holdFor = (repositoryAlias: string) => {
    const repository = mounted.runtime.repositories[repositoryAlias];
    if (!repository?.offHost)
      throw new Error("upgrade_backup_repository_unavailable");
    const keys = Object.values(mounted.runtime.keys);
    if (keys.length === 0) throw new Error("upgrade_backup_keys_unavailable");
    const material = new UpgradeBackupMaterialReader(
      keys.map(
        (key) =>
          new EncryptedBackupRepository({
            repository: repository.path,
            keyFile: key.path,
            keyId: key.keyId,
            keyFilesById: Object.fromEntries(
              keys.map((entry) => [entry.keyId, entry.path]),
            ),
            gpgBinary: mounted.runtime.gpgBinary,
            maximumPartBytes: Math.max(
              64 * 1024 * 1024,
              ...Object.values(mounted.runtime.staging).map(
                (stage) => stage.maximumBytes,
              ),
            ),
          }),
      ),
    );
    return new AuthenticatedUpgradeBackupHold({
      repositoryPath: repository.path,
      instanceId,
      journalBinding,
      hostKey,
      loadCertificate: (id, signal) => material.loadCertificate(id, signal),
      authenticateParts: (certificate, signal) =>
        material.authenticateParts(certificate, signal),
      assertVerifiedChild: (capture, child, digest, signal) =>
        evidence.assertVerifiedChild(capture, child, digest, signal),
    });
  };
  const pin = async (
    upgradeRunId: string,
    capture: BackupRun,
    child: BackupRun,
    repositoryAlias: string,
    signal: AbortSignal,
    replace = false,
  ) => {
    if (
      capture.instanceId !== instanceId ||
      child.instanceId !== instanceId ||
      capture.kind !== "capture" ||
      capture.state !== "certified" ||
      !capture.certificate ||
      child.kind !== "verification" ||
      child.state !== "verified" ||
      child.parentRunId !== capture.id
    )
      throw new Error("upgrade_backup_evidence_unavailable");
    return holdFor(repositoryAlias).acquire(
      {
        upgradeRunId,
        captureRunId: capture.id,
        verifiedChildRunId: child.id,
        certificateDigest: capture.certificate.manifestSha256,
      },
      signal,
      replace,
    );
  };
  const executeRun = async (
    run: BackupRun,
    signal: AbortSignal,
  ): Promise<BackupRun> => {
    if (run.instanceId !== instanceId)
      throw new Error("upgrade_backup_instance_mismatch");
    if (["certified", "verified"].includes(run.state)) return run;
    if (run.state !== "queued")
      throw new Error("upgrade_backup_checkpoint_uncertain");
    const workerId = `upgrade-${run.id}`;
    const scopedControl: BackupControlPort = {
      execute: async (instance, workerActor, action, value, stepSignal) => {
        const result = await control.execute(
          instance,
          workerActor,
          action,
          value,
          stepSignal ?? signal,
        );
        if (
          action === "run/claim" &&
          (!result ||
            typeof result !== "object" ||
            (result as { run?: { id?: string } }).run?.id !== run.id)
        )
          throw new Error("upgrade_backup_claim_mismatch");
        return result;
      },
    };
    const worker = new BackupWorker({
      instanceId,
      workerId,
      control: scopedControl,
      requests,
      executor,
      verificationTimeoutMs: (profile) =>
        mounted.targetProfiles[profile]?.deadlineMs ?? 1,
    });
    await worker.runOnce(run.kind, signal);
    return backupRunSchema.parse(
      await control.execute(
        instanceId,
        actor,
        "run/read",
        { runId: run.id },
        signal,
      ),
    );
  };
  return {
    validateExisting: async (upgradeRunId, signal) => {
      z.uuid().parse(upgradeRunId);
      const deadline = bounded(signal);
      const selected = await evidence.readApprovedEvidence(deadline);
      if (selected.policy.instanceId !== instanceId)
        throw new Error("upgrade_backup_instance_mismatch");
      return pin(
        upgradeRunId,
        selected.capture,
        selected.child,
        selected.policy.configuration.repositoryAlias,
        deadline,
      );
    },
    checkpointAfterDrain: async (upgradeRunId, signal) => {
      z.uuid().parse(upgradeRunId);
      const deadline = bounded(signal);
      try {
        const policy = backupPolicySchema.parse(
          await control.execute(instanceId, actor, "policy/read", {}, deadline),
        );
        if (policy.instanceId !== instanceId)
          throw new Error("upgrade_backup_instance_mismatch");
        let capture = backupRunSchema.parse(
          await control.execute(
            instanceId,
            actor,
            "run/create",
            {
              kind: "capture",
              expectedVersion: policy.version,
              idempotencyKey: requestId(upgradeRunId, "capture"),
            },
            deadline,
          ),
        );
        capture = await executeRun(capture, deadline);
        if (capture.state !== "certified")
          throw new Error("upgrade_backup_capture_unavailable");
        let child = backupRunSchema.parse(
          await control.execute(
            instanceId,
            actor,
            "run/create",
            {
              kind: "verification",
              parentRunId: capture.id,
              targetProfile: policy.configuration.targetProfile,
              expectedVersion: capture.version,
              idempotencyKey: requestId(upgradeRunId, "verification"),
            },
            deadline,
          ),
        );
        child = await executeRun(child, deadline);
        return pin(
          upgradeRunId,
          capture,
          child,
          policy.configuration.repositoryAlias,
          deadline,
          true,
        );
      } finally {
        await executor.stop?.();
      }
    },
  };
}
