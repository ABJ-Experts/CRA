import { Logger } from "@nestjs/common";
import type {
  SbomDetectedFormat,
  SbomValidationReport,
} from "@repo/contracts/sboms";
import { z } from "zod";

import type { ValidateSbomInput } from "../validation/sbom-validator";
import {
  type SbomValidationWorkerResult,
  validateSbomInWorker,
} from "../validation/sbom-validation-worker";

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
      fileName: string;
      declaredFormat: SbomDetectedFormat | null;
      declaredSpecVersion: string | null;
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
  completeWithValidation(
    organizationId: string,
    input: Readonly<{
      jobId: string;
      workerId: string;
      report: SbomValidationReport;
    }>,
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
  readVerified(
    input: Readonly<{
      objectKey: string;
      sha256: string;
      byteSize: number;
      contentType: string;
    }>,
  ): Promise<
    Readonly<{
      outcome:
        "verified" | "missing" | "hash_mismatch" | "corrupt" | "unavailable";
      sha256?: string;
      byteSize?: number;
      contentType?: string | null;
      bytes?: Buffer;
    }>
  >;
}

export type SbomIngestValidator = (
  input: ValidateSbomInput,
) => Promise<SbomValidationWorkerResult>;

/**
 * Durable ingest worker: verify immutable evidence before isolating validation
 * and persist only the bounded report on the existing job.
 */
export class SbomIngestWorker {
  private readonly logger = new Logger(SbomIngestWorker.name);

  constructor(
    private readonly dependencies: Readonly<{
      workerId: string;
      leaseSeconds: number;
      queue: SbomIngestQueue;
      storage: SbomIngestStorage;
      validate?: SbomIngestValidator;
      now?: () => Date;
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
      const verified = await this.dependencies.storage.readVerified({
        objectKey: claim.objectKey,
        sha256: claim.sha256,
        byteSize: claim.byteSize,
        contentType: claim.mediaType,
      });
      if (verified.outcome !== "verified") {
        await this.dependencies.queue.fail(organizationId, {
          jobId: claim.jobId,
          workerId: this.dependencies.workerId,
          errorCode: toErrorCode(verified.outcome),
          retryable: verified.outcome === "unavailable",
        });
        return true;
      }
      if (!verified.bytes) throw new Error("verified sbom bytes missing");
      const validation = await (
        this.dependencies.validate ?? validateSbomInWorker
      )({
        bytes: verified.bytes,
        fileName: claim.fileName,
        mediaType: claim.mediaType,
        declaredFormat: claim.declaredFormat ?? undefined,
        declaredSpecVersion: claim.declaredSpecVersion ?? undefined,
      });
      if (validation.outcome !== "validated") {
        await this.dependencies.queue.fail(organizationId, {
          jobId: claim.jobId,
          workerId: this.dependencies.workerId,
          errorCode: "unavailable",
          retryable: true,
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
      // Report persistence and legacy completion form one durable terminal
      // transition, so a crash cannot create a report-only leased job.
      await this.dependencies.queue.completeWithValidation(organizationId, {
        jobId: claim.jobId,
        workerId: this.dependencies.workerId,
        report: stampValidationCompletion(
          validation.report,
          this.dependencies.now ?? (() => new Date()),
        ),
      });
    } catch {
      // The claim remains leased if persistence is unavailable, then is safely reclaimed.
      this.logger.warn("sbom ingest cycle could not persist state");
    }
    return true;
  }
}

function stampValidationCompletion(
  report: SbomValidationReport,
  now: () => Date,
): SbomValidationReport {
  const completedAt = now();
  if (!(completedAt instanceof Date) || Number.isNaN(completedAt.valueOf())) {
    throw new Error("invalid sbom validation completion time");
  }
  return Object.freeze({ ...report, completedAt: completedAt.toISOString() });
}

function unique(values: readonly string[]): readonly string[] {
  return Object.freeze(
    [...new Set(values)].filter((value) => uuidSchema.safeParse(value).success),
  );
}

function toErrorCode(
  outcome: Exclude<
    Awaited<ReturnType<SbomIngestStorage["readVerified"]>>["outcome"],
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
