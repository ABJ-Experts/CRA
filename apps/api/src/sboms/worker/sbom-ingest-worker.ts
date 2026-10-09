import { openSbomSpool, withSbomSpool } from "../validation/sbom-spool";
import {
  validateSbomFile,
  STREAMING_VALIDATOR_VERSION,
  canonicalSbomSpecificationVersion,
  type StreamingValidationResult,
} from "../validation/sbom-streaming-validator";
import { schemaAssetSha256ForDetection } from "../validation/schema-manifest";

import { Logger } from "@nestjs/common";
import type {
  SbomDetectedFormat,
  SbomValidationReport,
} from "@repo/contracts/sboms";
import { z } from "zod";

import {
  SbomNormalizationError,
  normalizeSbomStream,
  type SbomNormalizationBatch,
  type SbomNormalizationResult,
} from "../normalization/sbom-normalizer";
import { SbomStorageError } from "../infrastructure/supabase-sbom-storage.adapter";
import {
  SbomValidationInfrastructureError,
  type ValidateSbomInput,
} from "../validation/sbom-validator";
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
        | "normalization_byte_limit_exceeded"
        | "normalization_component_limit_exceeded"
        | "unavailable";
      retryable: boolean;
    }>,
  ): Promise<void>;
  beginNormalization?(
    organizationId: string,
    input: Readonly<{
      jobId: string;
      workerId: string;
      format: string;
      serialization: string;
      specificationVersion: string;
      report: SbomValidationReport;
    }>,
  ): Promise<
    Readonly<{
      outcome: "ready" | "complete" | "deferred" | "failed";
      documentId?: string;
    }>
  >;
  persistNormalizationBatch?(
    organizationId: string,
    input: Readonly<{
      jobId: string;
      workerId: string;
      documentId: string;
      batch: SbomNormalizationBatch;
      diagnostics: readonly unknown[];
      sourceOffset: number;
    }>,
  ): Promise<void>;
  finalizeNormalization?(
    organizationId: string,
    input: Readonly<{ jobId: string; workerId: string; documentId: string }>,
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
  openVerified?(
    input: Readonly<{
      objectKey: string;
      sha256: string;
      byteSize: number;
      contentType: string;
    }>,
  ): Promise<
    | Readonly<{
        outcome: "verified";
        stream: AsyncIterable<Uint8Array>;
        sha256: string;
        byteSize: number;
        contentType: string | null;
      }>
    | Readonly<{
        outcome: "missing" | "hash_mismatch" | "corrupt" | "unavailable";
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
      normalize?: typeof normalizeSbomStream;
      validateFile?: typeof validateSbomFile;
      maximumBytes?: number;
      maximumComponents?: number;
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
    if (
      !Number.isSafeInteger(dependencies.maximumBytes ?? 100 * 1024 * 1024) ||
      (dependencies.maximumBytes ?? 100 * 1024 * 1024) < 1 ||
      !Number.isSafeInteger(dependencies.maximumComponents ?? 50_000) ||
      (dependencies.maximumComponents ?? 50_000) < 1
    ) {
      throw new Error("invalid sbom normalization limits");
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
      if (this.canNormalize()) return await this.processNormalized(claim);
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
    } catch (error) {
      if (error instanceof SbomValidationInfrastructureError) {
        await this.dependencies.queue.fail(organizationId, {
          jobId: claim.jobId,
          workerId: this.dependencies.workerId,
          errorCode: "unavailable",
          retryable: true,
        });
        return true;
      }
      if (error instanceof SbomStorageError && error.code === "malformed") {
        await this.dependencies.queue.fail(organizationId, {
          jobId: claim.jobId,
          workerId: this.dependencies.workerId,
          errorCode: "content_hash_mismatch",
          retryable: false,
        });
        return true;
      }
      if (error instanceof SbomNormalizationError) {
        await this.dependencies.queue.fail(organizationId, {
          jobId: claim.jobId,
          workerId: this.dependencies.workerId,
          errorCode:
            error.code === "normalization_byte_limit_exceeded"
              ? "normalization_byte_limit_exceeded"
              : error.code === "normalization_component_limit_exceeded"
                ? "normalization_component_limit_exceeded"
                : "invalid_request",
          retryable: false,
        });
        return true;
      }
      // The claim remains leased if persistence is unavailable, then is safely reclaimed.
      this.logger.warn({
        message: "sbom ingest cycle could not persist state",
        error: errorSummary(error),
      });
    }
    return true;
  }

  private canNormalize(): boolean {
    return Boolean(
      typeof this.dependencies.storage.openVerified === "function" &&
      typeof this.dependencies.queue.beginNormalization === "function" &&
      typeof this.dependencies.queue.persistNormalizationBatch === "function" &&
      typeof this.dependencies.queue.finalizeNormalization === "function",
    );
  }

  private async processNormalized(
    claim: Extract<SbomIngestClaim, { outcome: "claimed" }>,
  ): Promise<boolean> {
    const organizationId = claim.organizationId;
    const opened = await this.dependencies.storage.openVerified?.({
      objectKey: claim.objectKey,
      sha256: claim.sha256,
      byteSize: claim.byteSize,
      contentType: claim.mediaType,
    });
    if (!opened || opened.outcome !== "verified") {
      await this.dependencies.queue.fail(organizationId, {
        jobId: claim.jobId,
        workerId: this.dependencies.workerId,
        errorCode: toErrorCode(opened?.outcome ?? "unavailable"),
        retryable: opened?.outcome === "unavailable" || !opened,
      });
      return true;
    }
    try {
      return await withSbomSpool(
        opened.stream,
        this.maximumBytes(),
        async (path) => this.processNormalizedFile(claim, path),
        async () =>
          this.dependencies.queue.checkpoint(organizationId, {
            jobId: claim.jobId,
            workerId: this.dependencies.workerId,
            stage: "parsing",
            percent: 30,
            message: "Verifying immutable original evidence",
          }),
      );
    } catch (error) {
      if (!(error instanceof SbomNormalizationError)) throw error;
      await this.dependencies.queue.completeWithValidation(organizationId, {
        jobId: claim.jobId,
        workerId: this.dependencies.workerId,
        report: failedNormalizationReport(
          error,
          this.dependencies.now ?? (() => new Date()),
        ),
      });
      return true;
    }
  }

  private async processNormalizedFile(
    claim: Extract<SbomIngestClaim, { outcome: "claimed" }>,
    path: string,
  ): Promise<boolean> {
    const organizationId = claim.organizationId;
    await this.dependencies.queue.checkpoint(organizationId, {
      jobId: claim.jobId,
      workerId: this.dependencies.workerId,
      stage: "parsing",
      percent: 30,
      message: "Streaming SBOM components",
    });
    let lastHeartbeat = Date.now();
    const progress = async () => {
      if (Date.now() - lastHeartbeat < 15_000) return;
      await this.dependencies.queue.checkpoint(organizationId, {
        jobId: claim.jobId,
        workerId: this.dependencies.workerId,
        stage: "parsing",
        percent: 35,
        message: "Validating and normalizing immutable SBOM",
      });
      lastHeartbeat = Date.now();
    };
    const normalizer = (
      this.dependencies.normalize ?? normalizeSbomStream
    ).bind(undefined);
    const scanned = await normalizer(openSbomSpool(path), {
      maximumBytes: Math.min(claim.byteSize, this.maximumBytes()),
      maximumComponents: this.maximumComponents(),
      retainResult: false,
      onProgress: progress,
    });
    await this.dependencies.queue.checkpoint(organizationId, {
      jobId: claim.jobId,
      workerId: this.dependencies.workerId,
      stage: "parsing",
      percent: 35,
      message: "Validating pinned SBOM schemas",
    });
    const validation = await (
      this.dependencies.validateFile ?? validateSbomFile
    )(path, scanned, progress);
    const report = normalizationReport(
      scanned,
      this.dependencies.now ?? (() => new Date()),
      validation,
      claim,
    );
    // Invalid evidence remains an M3-02 validation result.  It has no
    // normalized graph, so persist the bounded report through the existing
    // atomic terminal transition instead of opening a document row.
    if (report.status === "invalid") {
      await this.dependencies.queue.completeWithValidation(organizationId, {
        jobId: claim.jobId,
        workerId: this.dependencies.workerId,
        report,
      });
      return true;
    }
    let began:
      | Awaited<ReturnType<NonNullable<SbomIngestQueue["beginNormalization"]>>>
      | undefined;
    try {
      began = await this.dependencies.queue.beginNormalization?.(
        organizationId,
        {
          jobId: claim.jobId,
          workerId: this.dependencies.workerId,
          format: formatFamily(scanned.format),
          serialization: serialization(scanned.format),
          specificationVersion: scanned.specVersion ?? "unknown",
          report,
        },
      );
    } catch (error) {
      this.logger.warn({
        message: "sbom normalization begin transition failed",
        error: errorSummary(error),
      });
      throw error;
    }
    if (!began || began.outcome === "failed" || !began.documentId) return true;
    if (began.outcome === "deferred") {
      await this.dependencies.queue.fail(organizationId, {
        jobId: claim.jobId,
        workerId: this.dependencies.workerId,
        errorCode: "unavailable",
        retryable: true,
      });
      return true;
    }
    if (began.outcome === "complete") return true;
    await normalizer(openSbomSpool(path), {
      spdx3HashCatalog: scanned.spdx3HashCatalog,
      maximumBytes: Math.min(claim.byteSize, this.maximumBytes()),
      maximumComponents: this.maximumComponents(),
      retainResult: false,
      onProgress: progress,
      onBatch: async (batch) =>
        this.dependencies.queue.persistNormalizationBatch?.(organizationId, {
          jobId: claim.jobId,
          workerId: this.dependencies.workerId,
          documentId: began.documentId as string,
          batch,
          diagnostics: scanned.diagnostics,
          sourceOffset: batchSourceOffset(batch),
        }),
    });
    await this.dependencies.queue.checkpoint(organizationId, {
      jobId: claim.jobId,
      workerId: this.dependencies.workerId,
      stage: "resolving_graph",
      percent: 90,
      message: "Resolving dependency graph",
    });
    await this.dependencies.queue.finalizeNormalization?.(organizationId, {
      jobId: claim.jobId,
      workerId: this.dependencies.workerId,
      documentId: began.documentId,
    });
    return true;
  }

  private maximumBytes(): number {
    return this.dependencies.maximumBytes ?? 100 * 1024 * 1024;
  }

  private maximumComponents(): number {
    return this.dependencies.maximumComponents ?? 50_000;
  }
}

function formatFamily(
  format: SbomNormalizationResult["format"],
): "cyclonedx" | "spdx" {
  return format.startsWith("cyclonedx") ? "cyclonedx" : "spdx";
}

function serialization(
  format: SbomNormalizationResult["format"],
): "json" | "json_ld" | "xml" | "tag_value" {
  if (format === "cyclonedx-xml") return "xml";
  if (format === "spdx-tag-value") return "tag_value";
  return format === "spdx-json-ld" ? "json_ld" : "json";
}

function batchSourceOffset(batch: SbomNormalizationBatch): number {
  return Math.max(
    0,
    ...batch.components.map((component) => component.source.offset),
    ...batch.edges.map((edge) => edge.source.offset),
  );
}

function normalizationReport(
  result: SbomNormalizationResult,
  now: () => Date,
  validation: StreamingValidationResult,
  declared: {
    declaredFormat: SbomDetectedFormat | null;
    declaredSpecVersion: string | null;
  },
): SbomValidationReport {
  const completedAt = now().toISOString();
  const normalizationDiagnostics = result.diagnostics.map((item) => ({
    severity: item.severity,
    // Keep the established M3-02 validation vocabulary at the intake
    // boundary. Detailed normalization codes remain on completed documents;
    // invalid evidence has no graph to expose.
    code: item.severity === "error" ? "schema_violation" : item.code,
    location: item.source.path,
    message: item.message,
    remediation: "Review the SBOM source evidence.",
  }));
  const metadataWarnings =
    (declared.declaredFormat !== null &&
      declared.declaredFormat !== formatFamily(result.format)) ||
    (declared.declaredSpecVersion !== null &&
      declared.declaredSpecVersion.replace(/^SPDX-/u, "") !==
        result.specVersion?.replace(/^SPDX-/u, ""))
      ? [
          {
            severity: "warning" as const,
            code: "declared_metadata_mismatch",
            location: "$",
            message:
              "Declared SBOM metadata differs from the verified content.",
            remediation: "Use the detected format and edition.",
          },
        ]
      : [];
  const allDiagnostics = [
    ...validation.diagnostics,
    ...normalizationDiagnostics,
    ...metadataWarnings,
  ];
  const diagnostics = allDiagnostics.slice(0, 100);
  const errorCount =
    validation.errorCount +
    (result.errorCount ??
      normalizationDiagnostics.filter((item) => item.severity === "error")
        .length);
  const warningCount =
    validation.warningCount +
    (result.warningCount ??
      normalizationDiagnostics.filter((item) => item.severity === "warning")
        .length) +
    metadataWarnings.length;
  return Object.freeze({
    status:
      errorCount > 0
        ? "invalid"
        : warningCount > 0
          ? "valid_with_warnings"
          : "valid",
    detected: {
      format: formatFamily(result.format),
      serialization: validationSerialization(result.format),
      specificationVersion:
        canonicalSbomSpecificationVersion(result.specVersion) ?? "unknown",
    },
    validator: {
      name: "CRA streaming SBOM validator",
      version: STREAMING_VALIDATOR_VERSION,
      schemaAssetSha256:
        validation.schemaAssetSha256 ??
        schemaAssetSha256ForDetection({
          format: formatFamily(result.format),
          serialization: validationSerialization(result.format),
          version: result.specVersion?.replace(/^SPDX-/u, "") ?? null,
        }),
    },
    diagnostics,
    errorCount,
    warningCount,
    omittedDiagnosticCount:
      validation.omittedDiagnosticCount +
      (result.omittedDiagnosticCount ?? 0) +
      Math.max(0, allDiagnostics.length - diagnostics.length),
    completedAt,
  });
}

function validationSerialization(
  format: SbomNormalizationResult["format"],
): "json" | "xml" | "tag_value" {
  const value = serialization(format);
  return value === "json_ld" ? "json" : value;
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

function errorSummary(error: unknown): Readonly<{
  name: string;
  code: string | null;
  providerCode: string | null;
}> {
  if (error instanceof Error) {
    const code =
      "code" in error && typeof error.code === "string" ? error.code : null;
    const providerCode =
      "providerCode" in error && typeof error.providerCode === "string"
        ? error.providerCode
        : null;
    return Object.freeze({ name: error.name, code, providerCode });
  }
  return Object.freeze({ name: typeof error, code: null, providerCode: null });
}

function failedNormalizationReport(
  error: SbomNormalizationError,
  now: () => Date,
): SbomValidationReport {
  return {
    status: "invalid",
    detected: null,
    validator: {
      name: "CRA streaming SBOM validator",
      version: STREAMING_VALIDATOR_VERSION,
      schemaAssetSha256: schemaAssetSha256ForDetection({
        format: null,
        serialization: null,
        version: null,
      }),
    },
    diagnostics: [
      {
        severity: "error",
        code:
          error.code === "normalization_byte_limit_exceeded"
            ? "byte_limit_exceeded"
            : error.code === "normalization_extreme_numeric_literal"
              ? "extreme_numeric_literal"
              : "schema_violation",
        location: "$",
        message:
          error.code === "normalization_projection_limit_exceeded"
            ? error.message
            : "SBOM parsing or safety validation failed.",
        remediation: "Correct the SBOM and upload a new immutable version.",
      },
    ],
    errorCount: 1,
    warningCount: 0,
    omittedDiagnosticCount: 0,
    completedAt: now().toISOString(),
  };
}
