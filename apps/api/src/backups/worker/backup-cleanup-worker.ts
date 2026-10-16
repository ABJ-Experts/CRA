import { z } from "zod";
import type { BackupCleanupPort } from "../application/backup-cleanup.port";
import type { BackupControlPort } from "../application/backup-control.port";
const claimSchema = z.strictObject({
  run: z
    .object({ id: z.uuid(), version: z.number().int().positive() })
    .passthrough(),
  execution: z
    .object({
      configuration: z
        .object({
          sourceAlias: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
          repositoryAlias: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
        })
        .passthrough(),
      actor: z.string().regex(/^[a-z0-9][a-z0-9:_/-]{0,199}$/),
      reviewFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      idempotencyKey: z.uuid(),
    })
    .passthrough(),
});
/** Only explicit reviewed intents can be claimed; sealed artifacts are never aged out automatically. */
export class BackupCleanupWorker {
  constructor(
    private readonly options: {
      instanceId: string;
      workerId: string;
      control: BackupControlPort;
      executor: BackupCleanupPort;
    },
  ) {}
  async runOnce(shutdown?: AbortSignal): Promise<void> {
    const { instanceId, workerId, control } = this.options;
    const claim = await control.execute(
      instanceId,
      `backup-worker:${workerId}`,
      "cleanup/claim",
      { workerId },
      shutdown,
    );
    if (!claim) return;
    const parsed = claimSchema.parse(claim);
    await this.options.executor.cleanup(
      {
        instanceId,
        runId: parsed.run.id,
        actor: parsed.execution.actor,
        workerId,
        expectedVersion: parsed.run.version,
        reviewFingerprint: parsed.execution.reviewFingerprint,
        idempotencyKey: parsed.execution.idempotencyKey,
        sourceAlias: parsed.execution.configuration.sourceAlias,
        repositoryAlias: parsed.execution.configuration.repositoryAlias,
      },
      shutdown
        ? AbortSignal.any([shutdown, AbortSignal.timeout(60000)])
        : AbortSignal.timeout(60000),
    );
  }
}
