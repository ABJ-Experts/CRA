import { Logger } from "@nestjs/common";
import { z } from "zod";

export type EvidenceDeletionCleanupClaim = Readonly<{
  organizationId: string;
  intentId: string;
  cleanupItemId: string;
  documentId: string;
  bucket: "evidence-documents" | "evidence-watermark-exports";
  objectKey: string;
}>;

/** The queue is database-owned: claims perform the final locked protection recheck. */
export interface EvidenceDeletionCleanupQueue {
  organizationIds(limit: number): Promise<readonly string[]>;
  claim(
    organizationId: string,
    input: Readonly<{ workerId: string; leaseSeconds: number }>,
  ): Promise<EvidenceDeletionCleanupClaim | null>;
  complete(
    organizationId: string,
    input: Readonly<{
      workerId: string;
      intentId: string;
      cleanupItemId: string;
      outcome: "deleted" | "retry";
      error: string | null;
    }>,
  ): Promise<void>;
}

export interface EvidenceDeletionStorage {
  remove(
    input: Readonly<{
      bucket: "evidence-documents" | "evidence-watermark-exports";
      objectKey: string;
    }>,
  ): Promise<"deleted" | "missing" | "unavailable">;
}

/**
 * Physical deletion never decides eligibility. It only acts on a short-lived
 * DB claim and writes a durable completion for every object, so failures leave
 * the document inaccessible and retryable rather than restoring access.
 */
export class EvidenceDeletionCleanupWorker {
  private readonly logger = new Logger(EvidenceDeletionCleanupWorker.name);

  constructor(
    private readonly dependencies: Readonly<{
      workerId: string;
      leaseSeconds: number;
      queue: EvidenceDeletionCleanupQueue;
      storage: EvidenceDeletionStorage;
    }>,
  ) {
    if (
      !z.uuid().safeParse(dependencies.workerId).success ||
      !Number.isInteger(dependencies.leaseSeconds) ||
      dependencies.leaseSeconds < 15 ||
      dependencies.leaseSeconds > 900
    )
      throw new Error("invalid evidence deletion cleanup worker configuration");
  }

  async runOnce(): Promise<number> {
    let completed = 0;
    const organizationIds = await this.dependencies.queue.organizationIds(100);
    for (const organizationId of [...new Set(organizationIds)]) {
      for (;;) {
        const claim = await this.dependencies.queue.claim(organizationId, {
          workerId: this.dependencies.workerId,
          leaseSeconds: this.dependencies.leaseSeconds,
        });
        if (!claim) break;
        const retryScheduled = await this.completeClaim(claim);
        completed += 1;
        // A failed object remains retryable, but never spin on the same lease
        // and hammer private Storage in this worker cycle.
        if (retryScheduled) break;
      }
    }
    return completed;
  }

  private async completeClaim(
    claim: EvidenceDeletionCleanupClaim,
  ): Promise<boolean> {
    try {
      const storage = await this.dependencies.storage.remove({
        bucket: claim.bucket,
        objectKey: claim.objectKey,
      });
      await this.dependencies.queue.complete(claim.organizationId, {
        workerId: this.dependencies.workerId,
        intentId: claim.intentId,
        cleanupItemId: claim.cleanupItemId,
        outcome: storage === "unavailable" ? "retry" : "deleted",
        error:
          storage === "unavailable"
            ? "Evidence object cleanup could not reach private storage."
            : null,
      });
      return storage === "unavailable";
    } catch {
      try {
        await this.dependencies.queue.complete(claim.organizationId, {
          workerId: this.dependencies.workerId,
          intentId: claim.intentId,
          cleanupItemId: claim.cleanupItemId,
          outcome: "retry",
          error: "Evidence object cleanup failed before completion.",
        });
        return true;
      } catch {
        this.logger.error(
          "Evidence deletion cleanup failure could not be recorded",
        );
        return true;
      }
    }
  }
}
