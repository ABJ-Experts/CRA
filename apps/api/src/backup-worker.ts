import { maintenanceRun } from "./upgrades/maintenance/maintenance-gate";
import { z } from "zod";
import { backupFailure } from "./backups/domain/backup-failure";
import { createHash, randomUUID } from "node:crypto";
import {
  backupHistorySchema,
  backupRunSchema,
  backupPolicySchema,
  backupPolicyConfigurationSchema,
} from "@repo/contracts/backups/schemas";
import {
  NativeBackupWorkerControlClient,
  backupWorkerControlSource,
} from "./backups/infrastructure/native-backup-worker-control.client";
import { loadBackupWorkerRuntime } from "./backups/infrastructure/backup-worker-runtime";
import { createBackupExecutor } from "./backups/infrastructure/backup-executor";
import { MountedBackupWorkerRequests } from "./backups/infrastructure/backup-worker-requests";
import { NativeBackupCaptureAdapter } from "./backups/infrastructure/capture/native-backup-capture.adapter";
import { resolveBackupMounts } from "./backups/infrastructure/capture/backup-mounted-runtime";
import { BackupOperatorAlerts } from "./backups/infrastructure/alerts/backup-operator-alerts";
import { BackupCleanupWorker } from "./backups/worker/backup-cleanup-worker";
import { NativeBackupCleanupAdapter } from "./backups/infrastructure/cleanup/native-backup-cleanup.adapter";
import { reconcileStaleRecoveryTargets } from "./backups/infrastructure/restore/recovery-reconciliation";
import { reconcileStaleCaptureResources } from "./backups/infrastructure/capture/capture-resource-reconciliation";
import { BackupWorker } from "./backups/worker/backup-worker";
/** Separate executor process. It never starts with the normal API or private ingress. */
export async function bootstrapBackupWorker(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ stop(): Promise<void> } | null> {
  const config = await loadBackupWorkerRuntime(env);
  if (!config) return null;
  const workerId = `backup-${randomUUID()}`;
  const actor = `backup-worker:${workerId}`;
  const controlSource = backupWorkerControlSource(
    config.runtime,
    config.controlSourceAlias,
  );
  const control = new NativeBackupWorkerControlClient(
    config.instanceId,
    controlSource,
  );
  const requests = new MountedBackupWorkerRequests(config.runtime);
  const operatorAlerts = new BackupOperatorAlerts(
    config.instanceId,
    config.runtime,
    config.operatorAlerts,
  );
  const report = async (error: unknown): Promise<void> => {
    let fresh = true;
    try {
      fresh = await operatorAlerts.record(
        backupFailure(error),
        AbortSignal.timeout(5000),
      );
    } catch {
      process.stderr.write("Backup operator alert journal unavailable\n");
    }
    if (fresh)
      process.stderr.write(
        "Backup executor operation unavailable; inspect safe run receipts\n",
      );
  };
  const executor = createBackupExecutor(config);
  const worker = new BackupWorker({
    instanceId: config.instanceId,
    workerId,
    control,
    requests,
    executor,
    verificationTimeoutMs: (profile) =>
      config.targetProfiles[profile]?.deadlineMs ?? 1,
  });
  const nativeCleanup = new NativeBackupCleanupAdapter(config.runtime);
  const cleanup = new BackupCleanupWorker({
    instanceId: config.instanceId,
    workerId,
    control,
    executor: {
      cleanup: async (request, signal) => {
        await nativeCleanup.cleanup(request, signal);
      },
    },
  });
  let stopped = false;
  let ticking: Promise<void> | null = null;
  let reconciledAt = 0;
  let alertsReconciledAt = 0;
  let validatedAt = 0;
  let validatedDigest: string | null = null;
  const shutdown = new AbortController();
  let cleanupLane: Promise<void> | null = null;
  let captureLane: Promise<void> | null = null;
  let verificationLane: Promise<void> | null = null;
  const tick = async () => {
    if (stopped || ticking) return;
    ticking = maintenanceRun(async () => {
      if (Date.now() - reconciledAt > 60_000) {
        const reconciliationSignal = AbortSignal.any([
          shutdown.signal,
          AbortSignal.timeout(30_000),
        ]);
        await reconcileStaleCaptureResources(
          config.runtime,
          config.instanceId,
          async (runId) => {
            const receipt = backupRunSchema.parse(
              await control.execute(config.instanceId, actor, "run/read", {
                runId,
              }),
            );
            return (
              receipt.instanceId === config.instanceId &&
              receipt.id === runId &&
              receipt.kind === "capture" &&
              ["certified", "failed", "incomplete", "cancelled"].includes(
                receipt.state,
              )
            );
          },
          reconciliationSignal,
        );
        await reconcileStaleRecoveryTargets(
          config.runtime,
          config.instanceId,
          async (runId) => {
            const result = z
              .strictObject({ eligible: z.boolean() })
              .parse(
                await control.execute(
                  config.instanceId,
                  actor,
                  "run/reconcile",
                  { runId },
                ),
              );
            return result.eligible;
          },
          reconciliationSignal,
        );
        reconciledAt = Date.now();
      }
      const candidate = z
        .strictObject({
          configuration: backupPolicyConfigurationSchema,
          configurationRevision: z.number().int().positive(),
          configurationDigest: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .nullable()
        .parse(
          await control.execute(
            config.instanceId,
            actor,
            "policy/validation-read",
          ),
        );
      if (
        candidate &&
        (candidate.configurationDigest !== validatedDigest ||
          Date.now() - validatedAt > 60_000)
      ) {
        validatedAt = Date.now();
        validatedDigest = candidate.configurationDigest;
        try {
          if (
            config.runtime.sources[candidate.configuration.sourceAlias] !==
            controlSource
          )
            throw new Error("configuration_invalid");
          const synthetic = {
            id: randomUUID(),
            instanceId: config.instanceId,
            configurationRevision: candidate.configurationRevision,
          };
          const request = await requests.capture(
            synthetic as Parameters<MountedBackupWorkerRequests["capture"]>[0],
            candidate.configuration,
          );
          const mounts = await resolveBackupMounts(config.runtime, request);
          await new NativeBackupCaptureAdapter(config.runtime).preflight(
            mounts,
            AbortSignal.timeout(30_000),
          );
          if (!config.targetProfiles[candidate.configuration.targetProfile])
            throw new Error("target_unsafe");
          await control.execute(config.instanceId, actor, "policy/validated", {
            configurationDigest: candidate.configurationDigest,
          });
          validatedAt = Date.now();
          validatedDigest = candidate.configurationDigest;
        } catch (error) {
          await control.execute(
            config.instanceId,
            actor,
            "policy/validation-failed",
            {
              configurationDigest: candidate.configurationDigest,
              failureCode: backupFailure(error),
            },
          );
        }
      }
      const policy = backupPolicySchema
        .nullable()
        .parse(await control.execute(config.instanceId, actor, "policy/read"));
      if (!policy) return;
      if (
        config.runtime.sources[policy.configuration.sourceAlias] !==
        controlSource
      )
        throw new Error("configuration_invalid");
      operatorAlerts.select(policy.configuration);
      if (Date.now() - alertsReconciledAt > 60_000) {
        alertsReconciledAt = Date.now();
        try {
          await control.execute(config.instanceId, actor, "alerts/reconcile");
        } catch (error) {
          await report(error);
        }
      }
      if (policy.configuration.schedulingEnabled) {
        const bucket = Math.floor(
          Date.now() /
            (policy.configuration.checkpointIntervalMinutes * 60_000),
        );
        await control.execute(config.instanceId, actor, "schedule/enqueue", {
          expectedVersion: policy.version,
          idempotencyKey: deterministicOccurrenceId(
            `${config.instanceId}:capture:${bucket}`,
          ),
          occurrenceKey: `capture:${bucket}`,
        });
      }
      const captures = backupHistorySchema.parse(
        await control.execute(config.instanceId, actor, "run/list", {
          kind: "capture",
          limit: 1,
          certifiedOnly: true,
        }),
      );
      const lastCapture = captures.items[0];
      if (
        lastCapture?.state === "certified" &&
        lastCapture.configurationRevision === policy.configurationRevision
      ) {
        const verifications = backupHistorySchema.parse(
          await control.execute(config.instanceId, actor, "run/list", {
            kind: "verification",
            limit: 100,
          }),
        );
        const lastVerified = verifications.items.find(
          (run) =>
            run.state === "verified" &&
            run.configurationRevision === policy.configurationRevision,
        );
        const due =
          !lastVerified?.completedAt ||
          Date.now() - Date.parse(lastVerified.completedAt) >=
            policy.configuration.verificationIntervalDays * 86400000;
        if (
          due &&
          !captureLane &&
          !verifications.items.some((run) =>
            ["queued", "running"].includes(run.state),
          )
        ) {
          const verificationBucket = Math.floor(
            Date.now() /
              (policy.configuration.verificationIntervalDays * 86400000),
          );
          await control.execute(config.instanceId, actor, "run/create", {
            kind: "verification",
            parentRunId: lastCapture.id,
            expectedVersion: lastCapture.version,
            targetProfile: policy.configuration.targetProfile,
            idempotencyKey: deterministicOccurrenceId(
              `${config.instanceId}:verification:${lastCapture.id}:${verificationBucket}`,
            ),
          });
        }
      }
      if (!cleanupLane)
        cleanupLane = maintenanceRun(() => cleanup.runOnce(shutdown.signal))
          .then(() => undefined)
          .catch(() => {
            process.stderr.write(
              "Reviewed backup cleanup unavailable; retained intent requires review\n",
            );
          })
          .finally(() => {
            cleanupLane = null;
          });
      if (!captureLane)
        captureLane = maintenanceRun(() =>
          worker.runOnce("capture", shutdown.signal),
        )
          .then(() => undefined)
          .catch(report)
          .finally(() => {
            captureLane = null;
          });
      if (!verificationLane)
        verificationLane = maintenanceRun(() =>
          worker.runOnce("verification", shutdown.signal),
        )
          .then(() => undefined)
          .catch(report)
          .finally(() => {
            verificationLane = null;
          });
    })
      .then(() => undefined)
      .catch(report)
      .finally(() => {
        ticking = null;
      });
    await ticking;
  };
  const timer = setInterval(() => {
    void tick();
  }, 1000);
  await tick();
  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      shutdown.abort();
      await ticking;
      await Promise.all([captureLane, verificationLane, cleanupLane]);
      await executor.stop?.();
    },
  };
}
/* istanbul ignore next -- executable signal wiring */
if (require.main === module)
  void bootstrapBackupWorker()
    .then((worker) => {
      if (!worker) return;
      for (const signal of ["SIGINT", "SIGTERM"] as const)
        process.once(signal, () => {
          void worker.stop().catch(() => {
            process.stderr.write(
              "Backup executor shutdown incomplete; recovery reconciliation required\n",
            );
            process.exitCode = 1;
          });
        });
    })
    .catch(() => {
      process.stderr.write("Backup executor failed to start\n");
      process.exitCode = 1;
    });

export function deterministicOccurrenceId(input: string): string {
  const bytes = createHash("sha256").update(input).digest();
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
