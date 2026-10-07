import { randomUUID } from "node:crypto";
import {
  AuditRangeConflictError,
  AuditRangeLimitError,
} from "./audit-range.errors";
import { auditChainPageSchema } from "@repo/contracts/audit/schemas";
import {
  auditRangeResult,
  initializeAuditRange,
  inspectAuditRangeBatch,
} from "./audit-range-kernel";
import type { AuditRangeWorkerPort } from "./audit-range-worker.port";
export const auditRangeWorkerLimits = Object.freeze({
  maximumEvents: 1_000_000,
  batchSize: 250,
  maximumBytes: 16 * 1024 * 1024,
  maximumConcurrentWorkers: 2,
  maximumConcurrentTenantJobs: 1,
  leaseSeconds: 120,
  maximumAttempts: 3,
});
/** One durable batch per claim; scheduler owns leases, tenant fairness and fencing. */
export class AuditRangeWorker {
  private readonly workerId: string;
  private readonly now: () => Date;
  constructor(
    private readonly dependencies: Readonly<{
      repository: AuditRangeWorkerPort;
      workerId?: string;
      now?: () => Date;
    }>,
  ) {
    this.workerId = dependencies.workerId ?? randomUUID();
    this.now = dependencies.now ?? (() => new Date());
  }
  async runOnce(): Promise<"processed" | "idle"> {
    const repository = this.dependencies.repository;
    let job = await repository.claim(this.workerId);
    if (!job) return "idle";
    try {
      if (job.phase === "authorization") {
        const authorized = await repository.authorizeBatch(
          job,
          auditRangeWorkerLimits.batchSize,
          auditRangeWorkerLimits.maximumBytes,
        );
        job = authorized.job;
        if (!authorized.scopeAvailable)
          await repository.finishUnavailable(job, "scope_unavailable");
        else await repository.checkpoint(job, null, null);
        return "processed";
      }
      const validation = await repository.revalidate(job);
      job = validation.job;
      if (!validation.scopeAvailable) {
        await repository.finishUnavailable(job, "scope_unavailable");
        return "processed";
      }
      if (!validation.anchorsValid) {
        await repository.finishUnavailable(job, "checkpoint_unavailable");
        return "processed";
      }
      let cursor = job.cursor ?? initializeAuditRange(job);
      if (
        BigInt(cursor.checkedCount) >=
        BigInt(auditRangeWorkerLimits.maximumEvents)
      ) {
        await repository.fail(job, "event_limit", false);
        return "processed";
      }
      const remaining =
        auditRangeWorkerLimits.maximumEvents - Number(cursor.checkedCount);
      const page = await repository.page(
        job,
        (BigInt(cursor.nextSequence) - 1n).toString(),
        job.toSequence,
        Math.min(auditRangeWorkerLimits.batchSize, remaining),
        auditRangeWorkerLimits.maximumBytes,
      );
      const rows = auditChainPageSchema.parse(page.rows);
      if (
        rows.length > Math.min(auditRangeWorkerLimits.batchSize, remaining) ||
        Buffer.byteLength(JSON.stringify(rows), "utf8") >
          auditRangeWorkerLimits.maximumBytes
      )
        throw new Error("malformed_provider");
      if (rows.length === 0 && !page.exhausted)
        throw new Error("malformed_provider");
      cursor = inspectAuditRangeBatch(job, cursor, rows, page.exhausted);
      const done = cursor.exhausted || cursor.breaks.length >= 100;
      await repository.checkpoint(
        job,
        cursor,
        done ? auditRangeResult(job, cursor, this.now()) : null,
      );
    } catch (error) {
      if (error instanceof AuditRangeLimitError) {
        await repository.fail(job, error.code, false);
        return "processed";
      }
      if (
        error instanceof AuditRangeConflictError ||
        (error instanceof Error && error.name === "AuditRangeConflictError")
      )
        return "processed";
      const code =
        error instanceof Error && error.message === "malformed_provider"
          ? "malformed_provider"
          : "provider_unavailable";
      await repository.fail(job, code, code === "provider_unavailable");
    }
    return "processed";
  }
}
