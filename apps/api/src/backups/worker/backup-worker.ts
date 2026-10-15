import {
  backupStageSchema,
  backupPolicyConfigurationSchema,
  backupRunSchema,
} from "@repo/contracts/backups/schemas";
import type {
  BackupPolicyConfiguration,
  BackupRun,
} from "@repo/contracts/backups/types";
import { z } from "zod";
import { backupFailure } from "../domain/backup-failure";
import type { BackupControlPort } from "../application/backup-control.port";
import type {
  BackupExecutionContext,
  BackupExecutionPort,
  BackupCaptureRequest,
  BackupVerificationRequest,
  BackupCaptureResult,
  BackupVerificationResult,
} from "../application/backup-execution.port";
export interface BackupWorkerRequests {
  capture(
    run: BackupRun,
    configuration: BackupPolicyConfiguration,
  ): Promise<BackupCaptureRequest>;
  verification(
    run: BackupRun,
    configuration: BackupPolicyConfiguration,
    signal?: AbortSignal,
  ): Promise<BackupVerificationRequest>;
  captured(result: BackupCaptureResult): unknown;
  verified(
    result: BackupVerificationResult,
    request: BackupVerificationRequest,
  ): unknown;
}
const claimSchema = z.strictObject({
  run: backupRunSchema,
  execution: z
    .object({ configuration: backupPolicyConfigurationSchema })
    .passthrough(),
});
/** Independent lanes prevent a long restoration drill from starving certified captures. */
export class BackupWorker {
  constructor(
    private readonly options: {
      instanceId: string;
      workerId: string;
      control: BackupControlPort;
      executor: BackupExecutionPort;
      requests: BackupWorkerRequests;
      verificationTimeoutMs?: (targetProfile: string) => number;
    },
  ) {}
  async runOnce(
    kind: "capture" | "verification",
    shutdownSignal?: AbortSignal,
  ): Promise<void> {
    const { instanceId, workerId, control } = this.options;
    const actor = `backup-worker:${workerId}`;
    const raw = await control.execute(instanceId, actor, "run/claim", {
      workerId,
      kind,
    });
    if (raw === null) return;
    const claim = claimSchema.parse(raw);
    let run = claim.run;
    let cutStarted = false;
    let lastCaptureRequest: BackupCaptureRequest | undefined;
    const abort = new AbortController();
    const shutdown = () => abort.abort(new Error("interrupted"));
    const verificationDeadline =
      kind === "verification"
        ? setTimeout(
            shutdown,
            Math.min(
              14400000,
              Math.max(
                1,
                this.options.verificationTimeoutMs?.(
                  claim.execution.configuration.targetProfile,
                ) ?? 14400000,
              ),
            ),
          )
        : undefined;
    shutdownSignal?.addEventListener("abort", shutdown, { once: true });
    if (shutdownSignal?.aborted) shutdown();
    let chain: Promise<unknown> = Promise.resolve();
    const serial = <T>(operation: () => Promise<T>): Promise<T> => {
      const task = chain.then(operation);
      chain = task.catch(() => undefined);
      return task;
    };
    const update = (
      action: "run/heartbeat" | "run/pause",
      input: Record<string, unknown> = {},
    ) =>
      serial(async () => {
        abort.signal.throwIfAborted();
        run = backupRunSchema.parse(
          await control.execute(
            instanceId,
            actor,
            action,
            { runId: run.id, workerId, expectedVersion: run.version, ...input },
            abort.signal,
          ),
        );
      });
    const context: BackupExecutionContext = {
      signal: abort.signal,
      checkpoint: async (stage, progress) => {
        const mapped =
          (
            {
              inventory: "validating",
              base_backup: "preparing_base",
              write_pause: "pausing_writes",
              manifest_integrity: "checking_integrity",
              ciphertext_authentication: "decrypting",
              egress_denied: "provisioning",
              runtime_compatibility: "restoring",
              schema_migrations: "checking_integrity",
              credential_quarantine: "quarantining",
              authentication: "probing",
            } as Record<string, string>
          )[stage] ?? stage;
        if (mapped === "pausing_writes") {
          cutStarted = true;
          await update("run/pause");
        }
        await update("run/heartbeat", {
          stage: backupStageSchema.parse(mapped),
          progress: Math.min(99, Math.max(run.progress, Math.floor(progress))),
        });
      },
      assertAuthority: () => update("run/heartbeat"),
    };
    const heartbeat = setInterval(() => {
      void update("run/heartbeat").catch((error: unknown) =>
        abort.abort(new Error(backupFailure(error))),
      );
    }, 2000);
    try {
      const request =
        kind === "capture"
          ? await this.options.requests.capture(
              run,
              claim.execution.configuration,
            )
          : await this.options.requests.verification(
              run,
              claim.execution.configuration,
              abort.signal,
            );
      if (kind === "capture")
        lastCaptureRequest = request as BackupCaptureRequest;
      const result =
        kind === "capture"
          ? await this.options.executor.capture(
              request as BackupCaptureRequest,
              context,
            )
          : await this.options.executor.verify(
              request as BackupVerificationRequest,
              context,
            );
      await context.assertAuthority();
      if (
        kind === "verification" &&
        !(result as BackupVerificationResult).verified
      ) {
        const verification = this.options.requests.verified(
          result as BackupVerificationResult,
          request as BackupVerificationRequest,
        );
        await serial(() =>
          control.execute(
            instanceId,
            actor,
            "run/fail",
            {
              runId: run.id,
              workerId,
              expectedVersion: run.version,
              failureCode: "restore_failed",
              verification,
            },
            abort.signal,
          ),
        );
        return;
      }
      await serial(async () => {
        abort.signal.throwIfAborted();
        const payload =
          kind === "capture"
            ? {
                certificate: this.options.requests.captured(
                  result as BackupCaptureResult,
                ),
                coveredOrganizationIds: z
                  .array(z.uuid())
                  .max(100000)
                  .parse(
                    (result as BackupCaptureResult).coveredOrganizationIds ??
                      [],
                  ),
              }
            : {
                verification: this.options.requests.verified(
                  result as BackupVerificationResult,
                  request as BackupVerificationRequest,
                ),
              };
        run = backupRunSchema.parse(
          await control.execute(
            instanceId,
            actor,
            "run/complete",
            {
              runId: run.id,
              workerId,
              expectedVersion: run.version,
              ...payload,
            },
            abort.signal,
          ),
        );
      });
    } catch (error) {
      const code = backupFailure(error);
      abort.abort();
      await chain;
      let receiptUncommitted = false;
      try {
        if (
          !cutStarted &&
          run.attempt < 3 &&
          [
            "source_unavailable",
            "repository_unavailable",
            "wal_receiver_failed",
            "base_backup_failed",
            "interrupted",
          ].includes(code)
        ) {
          await control.execute(
            instanceId,
            actor,
            "run/retry",
            {
              runId: run.id,
              workerId,
              expectedVersion: run.version,
              failureCode: code,
            },
            AbortSignal.timeout(5000),
          );
        } else {
          await control.execute(
            instanceId,
            actor,
            "run/fail",
            {
              runId: run.id,
              workerId,
              expectedVersion: run.version,
              failureCode: code,
              incomplete: ["object_missing", "object_corrupt"].includes(code),
            },
            AbortSignal.timeout(5000),
          );
        }
      } catch {
        try {
          const durable = backupRunSchema.parse(
            await control.execute(
              instanceId,
              actor,
              "run/read",
              { runId: run.id },
              AbortSignal.timeout(5000),
            ),
          );
          receiptUncommitted =
            durable.id !== run.id ||
            durable.instanceId !== instanceId ||
            durable.state === "running";
        } catch {
          receiptUncommitted = true;
        }
      }
      if (lastCaptureRequest) {
        try {
          await this.options.executor.reconcile?.(
            lastCaptureRequest,
            AbortSignal.timeout(5000),
          );
        } catch {
          /* Unknown source authority preserves owned ciphertext for the next bounded reconciliation. */
        }
      }
      if (receiptUncommitted) throw new Error("audit_unavailable");
    } finally {
      shutdownSignal?.removeEventListener("abort", shutdown);
      clearInterval(heartbeat);
      if (verificationDeadline) clearTimeout(verificationDeadline);
      abort.abort();
      await chain;
    }
  }
}
