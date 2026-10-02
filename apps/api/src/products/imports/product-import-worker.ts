import { Logger } from "@nestjs/common";
import { z } from "zod";

import { ProductImportUseCases } from "./product-release-import-use-cases";
import type { ProductImportRepository } from "./product-release-import-use-cases";

const uuidSchema = z.uuid();
const maximumClaimsPerCycle = 1_000;

export type ProductImportMeasurement = Readonly<{
  metric:
    | "validation_duration_ms"
    | "validation_failure"
    | "retry_count"
    | "dead_letter";
  value: number;
}>;

export class ProductImportWorker {
  private readonly logger = new Logger(ProductImportWorker.name);

  constructor(
    private readonly dependencies: Readonly<{
      workerId: string;
      leaseSeconds: number;
      repository: ProductImportRepository;
      useCases: ProductImportUseCases;
      authorizeCommit: (
        organizationId: string,
        actorId: string,
      ) => Promise<boolean>;
      observe?: (measurement: ProductImportMeasurement) => void;
    }>,
  ) {
    if (!uuidSchema.safeParse(dependencies.workerId).success) {
      throw new Error("invalid product import worker id");
    }
    if (
      !Number.isInteger(dependencies.leaseSeconds) ||
      dependencies.leaseSeconds < 1 ||
      dependencies.leaseSeconds > 3_600
    ) {
      throw new Error("invalid product import worker lease");
    }
  }

  /** One claim per due tenant per round prevents a heavy tenant monopolizing. */
  async runOnce(): Promise<void> {
    let due = unique(await this.dependencies.repository.dueOrganizationIds());
    let remaining = maximumClaimsPerCycle;
    while (due.length > 0 && remaining > 0) {
      const nextRound: string[] = [];
      for (const organizationId of due) {
        if (remaining === 0) break;
        const claimed = await this.processOne(organizationId);
        if (!claimed) continue;
        nextRound.push(organizationId);
        remaining -= 1;
      }
      due = nextRound;
    }
  }

  private async processOne(organizationId: string): Promise<boolean> {
    const claim = await this.dependencies.repository.claim(organizationId, {
      workerId: this.dependencies.workerId,
      leaseSeconds: this.dependencies.leaseSeconds,
    });
    if (claim.outcome !== "claimed") return false;

    const startedAt = Date.now();
    let authorized = true;
    if (claim.work.kind === "commit") {
      try {
        authorized = await this.dependencies.authorizeCommit(
          organizationId,
          claim.work.actorId,
        );
      } catch {
        await this.dependencies.repository.failClaim(organizationId, {
          importId: claim.importId,
          workerId: this.dependencies.workerId,
          errorCode: "unavailable",
          retryable: true,
        });
        this.observe("retry_count", claim.retryCount + 1);
        return true;
      }
    }
    if (!authorized) {
      await this.dependencies.repository.markStaleClaim(organizationId, {
        importId: claim.importId,
        workerId: this.dependencies.workerId,
        errorCode: "authorization_changed",
      });
      this.observe("validation_failure", 1);
      return true;
    }
    if (claim.work.kind === "commit") {
      let source: Awaited<ReturnType<ProductImportRepository["source"]>>;
      try {
        source = await this.dependencies.repository.source(
          organizationId,
          claim.importId,
        );
      } catch {
        await this.dependencies.repository.failClaim(organizationId, {
          importId: claim.importId,
          workerId: this.dependencies.workerId,
          errorCode: "unavailable",
          retryable: true,
        });
        this.observe("retry_count", claim.retryCount + 1);
        return true;
      }
      const sourceError = !source
        ? "source_missing"
        : source.contentHash !== claim.contentHash
          ? "content_hash_mismatch"
          : null;
      if (sourceError) {
        await this.dependencies.repository.markStaleClaim(organizationId, {
          importId: claim.importId,
          workerId: this.dependencies.workerId,
          errorCode: sourceError,
        });
        this.observe("validation_failure", 1);
        return true;
      }
    }
    const result =
      claim.work.kind === "commit"
        ? await this.dependencies.useCases.executeCommit({
            organizationId,
            actorId: claim.work.actorId,
            importId: claim.importId,
            contentHash: claim.contentHash,
            idempotencyKey: claim.work.idempotencyKey,
          })
        : await this.dependencies.useCases.processStored({
            organizationId,
            importId: claim.importId,
            workerId: this.dependencies.workerId,
            expectedContentHash: claim.contentHash,
          });
    this.observe("validation_duration_ms", Date.now() - startedAt);
    if (result.ok) return true;

    const staleErrorCode = staleClaimCode(result.error.code);
    if (staleErrorCode) {
      await this.dependencies.repository.markStaleClaim(organizationId, {
        importId: claim.importId,
        workerId: this.dependencies.workerId,
        errorCode: staleErrorCode,
      });
      this.observe("validation_failure", 1);
      return true;
    }

    const retryable = result.error.code === "unavailable";
    await this.dependencies.repository.failClaim(organizationId, {
      importId: claim.importId,
      workerId: this.dependencies.workerId,
      errorCode: safeWorkerError(result.error.code),
      retryable,
    });
    this.observe("validation_failure", 1);
    this.observe("retry_count", claim.retryCount + (retryable ? 1 : 0));
    if (!retryable || claim.retryCount >= 4) this.observe("dead_letter", 1);
    this.logger.warn(
      JSON.stringify({
        event: "product_import_measurement",
        metric: retryable ? "retry_scheduled" : "dead_letter",
        value: 1,
      }),
    );
    return true;
  }

  private observe(
    metric: ProductImportMeasurement["metric"],
    value: number,
  ): void {
    this.dependencies.observe?.(Object.freeze({ metric, value }));
  }
}

function staleClaimCode(
  code: string,
): "source_missing" | "content_hash_mismatch" | null {
  return code === "source_missing" || code === "content_hash_mismatch"
    ? code
    : null;
}

function unique(values: readonly string[]): readonly string[] {
  return Object.freeze(
    [...new Set(values)].filter((value) => uuidSchema.safeParse(value).success),
  );
}

function safeWorkerError(code: string): string {
  return new Set([
    "invalid_request",
    "conflict",
    "not_found",
    "unavailable",
    "malformed_provider",
  ]).has(code)
    ? code
    : "unavailable";
}
