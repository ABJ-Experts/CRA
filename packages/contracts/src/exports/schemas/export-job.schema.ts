import { z } from "zod";
import {
  EXPORT_LIMITS,
  exportColumnSchema,
  exportSourceIdSchema,
  exportScopeSchema,
} from "./export-source.schema.js";
import { technicalFileReadinessSchema } from "../../technical-files/schemas/technical-file-readiness.schema.js";
import { evidenceValidityStatusSchema } from "../../evidence/schemas/evidence.schema.js";
const instant = z.iso.datetime({ offset: true });
const digest = z.string().regex(/^[0-9a-f]{64}$/);
export const exportJobStateSchema = z.enum([
  "queued",
  "capturing",
  "audit_pending",
  "rendering",
  "ready",
  "failed",
  "cancelled",
  "expired",
]);
export const exportArtifactSchema = z
  .object({
    id: z.uuid(),
    name: z
      .string()
      .min(1)
      .max(180)
      .refine(
        (name) =>
          Array.from(name).every(
            (character) =>
              character.charCodeAt(0) >= 32 &&
              character.charCodeAt(0) !== 127 &&
              character !== "/" &&
              character !== "\\",
          ),
        "Invalid artifact name",
      ),
    mediaType: z.enum([
      "text/csv",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/pdf",
      "application/json",
    ]),
    byteLength: z
      .number()
      .int()
      .nonnegative()
      .max(EXPORT_LIMITS.maxArtifactBytes),
    sha256: digest,
    rowCount: z.number().int().nonnegative().max(EXPORT_LIMITS.maxRows),
  })
  .strict();
export const exportManifestSchema = z
  .object({
    version: z.literal("m14_03_v1"),
    jobId: z.uuid(),
    source: z.string().min(1).max(120),
    requestedAt: instant,
    snapshotAsOf: instant,
    scope: exportScopeSchema,
    requestDigest: digest,
    rowCount: z.number().int().nonnegative().max(EXPORT_LIMITS.maxRows),
    columns: z.array(exportColumnSchema).max(100),
    artifacts: z.array(exportArtifactSchema).max(EXPORT_LIMITS.maxParts),
    sourceVersionsDigest: digest,
    documentationReadinessOnly: z.boolean(),
  })
  .strict();
export const exportManifestResponseSchema = z
  .object({ data: exportManifestSchema })
  .strict();
export const exportJobSchema = z
  .object({
    id: z.uuid(),
    source: z.union([
      exportSourceIdSchema,
      z.literal("technical_files.readiness_report"),
    ]),
    kind: z.enum(["list", "readiness"]),
    format: z.enum(["csv", "xlsx", "report"]),
    state: exportJobStateSchema,
    version: z.number().int().positive(),
    requestedAt: instant,
    snapshotAsOf: instant.nullable(),
    rowCount: z
      .number()
      .int()
      .nonnegative()
      .max(EXPORT_LIMITS.maxRows)
      .nullable(),
    progress: z
      .object({
        processedRows: z
          .number()
          .int()
          .nonnegative()
          .max(EXPORT_LIMITS.maxRows),
        totalRows: z
          .number()
          .int()
          .nonnegative()
          .max(EXPORT_LIMITS.maxRows)
          .nullable(),
      })
      .strict(),
    artifacts: z.array(exportArtifactSchema).max(EXPORT_LIMITS.maxParts),
    manifest: exportManifestSchema.nullable().optional(),
    expiresAt: instant.nullable(),
    failure: z
      .object({
        code: z.string().min(1).max(80),
        message: z.string().min(1).max(500),
        retryable: z.boolean(),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((job, context) => {
    if (
      job.manifest &&
      (job.state !== "ready" ||
        job.manifest.jobId !== job.id ||
        job.manifest.source !== job.source ||
        job.manifest.rowCount !== job.rowCount ||
        Date.parse(job.manifest.snapshotAsOf) !==
          Date.parse(job.snapshotAsOf ?? "") ||
        Date.parse(job.manifest.requestedAt) !== Date.parse(job.requestedAt) ||
        job.manifest.documentationReadinessOnly !== (job.format === "report") ||
        job.manifest.artifacts.length !== job.artifacts.length ||
        job.manifest.artifacts.some((artifact, index) => {
          const expected = job.artifacts[index];
          return (
            !expected ||
            artifact.id !== expected.id ||
            artifact.name !== expected.name ||
            artifact.sha256 !== expected.sha256 ||
            artifact.byteLength !== expected.byteLength ||
            artifact.mediaType !== expected.mediaType ||
            artifact.rowCount !== expected.rowCount
          );
        }))
    )
      context.addIssue({
        code: "custom",
        path: ["manifest"],
        message: "Manifest must match the authorized ready job and artifacts",
      });
    if (
      job.state === "ready" &&
      (job.snapshotAsOf === null ||
        job.rowCount === null ||
        job.artifacts.length === 0)
    )
      context.addIssue({
        code: "custom",
        message: "Ready jobs require a frozen snapshot and verified output",
      });
    if (
      job.progress.totalRows !== null &&
      job.progress.processedRows > job.progress.totalRows
    )
      context.addIssue({
        code: "custom",
        path: ["progress"],
        message: "Progress cannot exceed the frozen result",
      });
    if (
      new Set(job.artifacts.map((artifact) => artifact.id)).size !==
        job.artifacts.length ||
      new Set(job.artifacts.map((artifact) => artifact.name)).size !==
        job.artifacts.length
    )
      context.addIssue({
        code: "custom",
        path: ["artifacts"],
        message: "Artifacts must be unique",
      });
    if (
      job.artifacts.reduce(
        (bytes, artifact) => bytes + artifact.byteLength,
        0,
      ) > EXPORT_LIMITS.maxTotalArtifactBytes
    )
      context.addIssue({
        code: "custom",
        path: ["artifacts"],
        message: "Export output exceeds its size limit",
      });
  });
export const exportJobResponseSchema = z
  .object({ data: exportJobSchema })
  .strict();
export const exportJobListResponseSchema = z
  .object({
    data: z.array(exportJobSchema).max(100),
    nextCursor: z.string().min(1).max(300).nullable(),
  })
  .strict();
export const exportJobParamsSchema = z.object({ jobId: z.uuid() }).strict();
export const exportMutationSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    idempotencyKey: z.uuid(),
  })
  .strict();
export const exportJobListQuerySchema = z
  .object({
    source: exportSourceIdSchema.optional(),
    cursor: z.string().min(1).max(300).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export const exportDownloadGrantInputSchema = z
  .object({ artifactId: z.uuid() })
  .strict();
export const exportDownloadGrantSchema = z
  .object({
    grantId: z.uuid(),
    expiresAt: instant,
    downloadPath: z
      .string()
      .startsWith("/api/v1/")
      .max(500)
      .refine(
        (path) =>
          !path.includes("..") &&
          !path.includes("\\") &&
          Array.from(path).every(
            (character) =>
              character.charCodeAt(0) > 32 && character.charCodeAt(0) !== 127,
          ),
        "Invalid local download path",
      ),
  })
  .strict();
export const exportDownloadGrantResponseSchema = z
  .object({ data: exportDownloadGrantSchema })
  .strict();
export const exportDownloadParamsSchema = z
  .object({ jobId: z.uuid(), grantId: z.uuid() })
  .strict();
export const createReadinessExportSchema = z
  .object({ productId: z.uuid(), idempotencyKey: z.uuid() })
  .strict();
export const exportReadinessProductParamsSchema = z
  .object({ productId: z.uuid() })
  .strict();
export const exportSnapshotRowSchema = z
  .object({
    ordinal: z.number().int().positive().max(EXPORT_LIMITS.maxRows),
    sourceId: z.string().min(1).max(500),
    sourceVersion: z.string().max(500).nullable(),
    productId: z.uuid().nullable(),
    values: z.record(
      z.string().min(1).max(120),
      z.union([
        z.string().max(EXPORT_LIMITS.maxCaptureBytes),
        z.number().finite(),
        z.boolean(),
        z.null(),
      ]),
    ),
    sha256: digest,
  })
  .strict();
export const readinessEvidenceSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(1000),
    sourceKind: z.string().min(1).max(100),
    sourceVersion: z.string().max(500).nullable(),
    validityStatus: evidenceValidityStatusSchema,
    validFrom: instant.nullable(),
    validUntil: instant.nullable(),
    stale: z.boolean(),
    unavailable: z.boolean(),
  })
  .strict();
export const exportReadinessReportSchema = z
  .object({
    version: z.literal("m14_03_v1"),
    product: z
      .object({
        id: z.uuid(),
        name: z.string().min(1).max(200),
        version: z.number().int().nonnegative(),
      })
      .strict(),
    snapshotAsOf: instant,
    technicalFileVersion: z.number().int().nonnegative(),
    canonicalReadiness: technicalFileReadinessSchema.nullable(),
    evidence: z.array(readinessEvidenceSchema).max(EXPORT_LIMITS.maxRows),
    degraded: z.boolean(),
    notices: z.array(z.string().min(1).max(1000)).max(100),
    documentationReadinessOnly: z.literal(true),
    sourceVersions: z
      .array(
        z
          .object({
            source: z.string().min(1).max(120),
            version: z.string().max(500),
            asOf: instant,
          })
          .strict(),
      )
      .max(EXPORT_LIMITS.maxRows),
  })
  .strict();
