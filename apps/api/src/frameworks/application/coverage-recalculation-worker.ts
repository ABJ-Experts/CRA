export type CoverageScope = Readonly<{
  organizationId: string;
  productId: string;
  packKey: string;
  versionKey: string;
}>;

export interface CoverageWorkQueue {
  claim(workerId: string): Promise<CoverageScope | null>;
  recalculate(
    orgId: string,
    workerId: string,
    scope: CoverageScope,
  ): Promise<"current" | "lease_lost" | "unavailable">;
  fail(
    orgId: string,
    workerId: string,
    scope: CoverageScope,
    reason: string,
  ): Promise<void>;
}

/** One durable claim per call keeps worker cycles bounded and restart safe. */
export class CoverageRecalculationWorker {
  constructor(private readonly queue: CoverageWorkQueue) {}

  async runOnce(workerId: string): Promise<boolean> {
    const scope = await this.queue.claim(workerId);
    if (!scope) return false;
    try {
      await this.queue.recalculate(scope.organizationId, workerId, scope);
    } catch {
      await this.queue.fail(
        scope.organizationId,
        workerId,
        scope,
        "coverage_recalculation_failed",
      );
    }
    return true;
  }
}
