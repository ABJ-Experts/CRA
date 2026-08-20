import { Logger } from "@nestjs/common";
import { z } from "zod";

const uuidSchema = z.uuid();
const maximumClaimsPerCycle = 1_000;

export type SbomIngestClaim =
  | Readonly<{
      outcome: "claimed";
      organizationId: string;
      jobId: string;
      sourceId: string;
      objectKey: string;
      sha256: string;
      byteSize: number;
      mediaType: string;
      retryCount: number;
    }>
  | Readonly<{ outcome: "none_available" | "conflict" }>;

export interface SbomIngestQueue {
  dueOrganizationIds(): Promise<readonly string[]>;
  claim(
    organizationId: string,
    input: Readonly<{ workerId: string; leaseSeconds: number }>,
  ): Promise<SbomIngestClaim>;
  checkpoint(
    organizationId: string,
    input: Readonly<{
      jobId: string;
      workerId: string;
      stage: string;
      percent: number;
      message: string;
    }>,
  ): Promise<void>;
  markComplete(
    organizationId: string,
    input: Readonly<{ jobId: string; workerId: string }>,
  ): Promise<void>;
  fail(
    organizationId: string,
    input: Readonly<{
      jobId: string;
      workerId: string;
      errorCode:
        | "source_missing"
        | "content_hash_mismatch"
        | "invalid_request"
        | "unavailable";
      retryable: boolean;
    }>,
  ): Promise<void>;
}

export interface SbomIngestStorage {
  inspect(
    input: Readonly<{
      objectKey: string;
      sha256: string;
      byteSize: number;
      contentType: string;
    }>,
  ): Promise<
    Readonly<{
      outcome:
        | "verified"
        | "missing"
        | "hash_mismatch"
        | "type_mismatch"
        | "corrupt"
        | "unavailable";
    }>
  >;
}

/**
 * Durable foundation worker. Its completed state means only that immutable
 * original evidence was re-verified; parsing is deliberately a later stage.
 */
export class SbomIngestWorker {
  private readonly logger = new Logger(SbomIngestWorker.name);

  constructor(
    private readonly dependencies: Readonly<{
      workerId: string;
      leaseSeconds: number;
      queue: SbomIngestQueue;
      storage: SbomIngestStorage;
    }>,
  ) {
    if (!uuidSchema.safeParse(dependencies.workerId).success)
      throw new Error("invalid sbom ingest worker id");
    if (
      !Number.isInteger(dependencies.leaseSeconds) ||
      dependencies.leaseSeconds < 1 ||
      dependencies.leaseSeconds > 3_600
    ) {
      throw new Error("invalid sbom ingest worker lease");
    }
  }

  /** One claim per due tenant per round prevents a noisy tenant from starving another. */
  async runOnce(): Promise<void> {
    let due = unique(await this.dependencies.queue.dueOrganizationIds());
    let remaining = maximumClaimsPerCycle;
    while (due.length > 0 && remaining > 0) {
      const nextRound: string[] = [];
      for (const organizationId of due) {
        if (remaining === 0) break;
        if (await this.processOne(organizationId)) {
          nextRound.push(organizationId);
          remaining -= 1;
        }
      }
      due = nextRound;
    }
  }

  private async processOne(organizationId: string): Promise<boolean> {
    const claim = await this.dependencies.queue.claim(organizationId, {
      workerId: this.dependencies.workerId,
      leaseSeconds: this.dependencies.leaseSeconds,
    });
    if (claim.outcome !== "claimed") return false;
    try {
      await this.dependencies.queue.checkpoint(organizationId, {
        jobId: claim.jobId,
        workerId: this.dependencies.workerId,
        stage: "verifying_original",
        percent: 25,
        message: "Verifying immutable original evidence",
      });
      const inspected = await this.dependencies.storage.inspect({
        objectKey: claim.objectKey,
        sha256: claim.sha256,
        byteSize: claim.byteSize,
        contentType: claim.mediaType,
      });
      if (inspected.outcome !== "verified") {
        await this.dependencies.queue.fail(organizationId, {
          jobId: claim.jobId,
          workerId: this.dependencies.workerId,
          errorCode: toErrorCode(inspected.outcome),
          retryable: inspected.outcome === "unavailable",
        });
        return true;
      }
      await this.dependencies.queue.checkpoint(organizationId, {
        jobId: claim.jobId,
        workerId: this.dependencies.workerId,
        stage: "recording_evidence",
        percent: 90,
        message: "Original evidence captured",
      });
      await this.dependencies.queue.markComplete(organizationId, {
        jobId: claim.jobId,
        workerId: this.dependencies.workerId,
      });
    } catch {
      // The claim remains leased if persistence is unavailable, then is safely reclaimed.
      this.logger.warn("sbom ingest cycle could not persist state");
    }
    return true;
  }
}

function unique(values: readonly string[]): readonly string[] {
  return Object.freeze(
    [...new Set(values)].filter((value) => uuidSchema.safeParse(value).success),
  );
}

function toErrorCode(
  outcome: Exclude<
    Awaited<ReturnType<SbomIngestStorage["inspect"]>>["outcome"],
    "verified"
  >,
):
  | "source_missing"
  | "content_hash_mismatch"
  | "invalid_request"
  | "unavailable" {
  if (outcome === "missing") return "source_missing";
  if (outcome === "hash_mismatch") return "content_hash_mismatch";
  return outcome === "unavailable" ? "unavailable" : "invalid_request";
}
