import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";
import { productRetentionCalculationSchema } from "../../products/schemas/support-period-retention.schema.js";
import { riskRegisterSchema } from "../../risk-registers/schemas/risk-register.schema.js";
import { z } from "zod";

import {
  technicalFileProductParamsSchema,
  technicalFileSchema,
} from "./technical-file.schema.js";
import { technicalFileReadinessSchema } from "./technical-file-readiness.schema.js";

const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);
const sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Use a lowercase SHA-256 digest");
const expectedVersionSchema = z.number().int().positive();

/** Byte ceilings protect the worker from unbounded in-memory package assembly. */
export const TECHNICAL_FILE_SNAPSHOT_MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;
export const TECHNICAL_FILE_SNAPSHOT_MAX_EXPORT_BYTES = 25 * 1024 * 1024;

/** A generated display name only; storage keys stay server-private. */
export const technicalFileSnapshotArtifactFileNameSchema = z
  .string()
  .trim()
  .regex(
    /^(?!\.)(?!.*[\\/])(?!.*\.\.)(?=.{1,255}$)[A-Za-z0-9][A-Za-z0-9._ -]*$/,
    "Use a safe filename without path segments",
  );

export const technicalFileSnapshotPurposeSchema = z.enum(["release", "audit"]);
export const technicalFileSnapshotStatusSchema = z.enum(["current", "superseded"]);
export const technicalFileSnapshotExportStatusSchema = z.enum([
  "queued",
  "generating",
  "ready",
  "failed",
  "superseded",
  "cancelled",
]);
export const technicalFileSnapshotExportFailureCodeSchema = z.enum([
  "snapshot_unavailable",
  "artifact_too_large",
  "storage_unavailable",
  "source_unavailable",
  "worker_unavailable",
  "unknown",
]);
export const technicalFileSnapshotArtifactKindSchema = z.enum([
  "pdf",
  "archive",
  "manifest",
]);

export const technicalFileSnapshotArtifactSchema = z
  .object({
    kind: technicalFileSnapshotArtifactKindSchema,
    fileName: technicalFileSnapshotArtifactFileNameSchema,
    mimeType: z.enum([
      "application/pdf",
      "application/zip",
      "application/json",
    ]),
    byteLength: z
      .number()
      .int()
      .positive()
      .max(TECHNICAL_FILE_SNAPSHOT_MAX_EXPORT_BYTES),
    sha256: sha256Schema,
    generatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

/**
 * A copied, immutable point-in-time payload. Source records are represented by
 * their pinned metadata already present in the technical-file and risk schemas;
 * M8 document bytes are deliberately excluded.
 */
export const technicalFileSnapshotPayloadSchema = z
  .object({
    schemaVersion: z.literal("m7_04_v1"),
    capturedAt: z.string().datetime({ offset: true }),
    technicalFile: technicalFileSchema,
    readiness: technicalFileReadinessSchema,
    riskRegister: riskRegisterSchema.nullable(),
    retention: productRetentionCalculationSchema,
  })
  .strict();

export const technicalFileSnapshotSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    productId: z.uuid(),
    technicalFileId: z.uuid(),
    technicalFileVersion: expectedVersionSchema,
    releaseId: z.uuid().nullable(),
    purpose: technicalFileSnapshotPurposeSchema,
    auditRationale: z.string().trim().min(1).max(4_000).nullable(),
    templateKey: z.literal("annex_vii"),
    templateVersion: requiredText(80),
    readinessStatus: z.enum(["empty", "partial", "complete", "stale"]),
    payload: technicalFileSnapshotPayloadSchema,
    payloadByteLength: z
      .number()
      .int()
      .positive()
      .max(TECHNICAL_FILE_SNAPSHOT_MAX_PAYLOAD_BYTES),
    payloadSha256: sha256Schema,
    status: technicalFileSnapshotStatusSchema,
    supersededBySnapshotId: z.uuid().nullable(),
    createdByUserId: z.uuid(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (snapshot.purpose === "release" && snapshot.releaseId === null) {
      context.addIssue({
        code: "custom",
        path: ["releaseId"],
        message: "Release snapshots require a release ID",
      });
    }
    if (
      snapshot.purpose === "audit" &&
      (snapshot.releaseId !== null || snapshot.auditRationale === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["auditRationale"],
        message: "Audit snapshots require a rationale and cannot link a release",
      });
    }
    if (
      (snapshot.status === "superseded") !==
      (snapshot.supersededBySnapshotId !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["supersededBySnapshotId"],
        message: "Only superseded snapshots have a successor reference",
      });
    }
  });

export const technicalFileSnapshotExportSchema = z
  .object({
    id: z.uuid(),
    snapshotId: z.uuid(),
    status: technicalFileSnapshotExportStatusSchema,
    failureCode: technicalFileSnapshotExportFailureCodeSchema.nullable(),
    cancellationReason: z.string().trim().min(1).max(1_000).nullable(),
    artifacts: z.array(technicalFileSnapshotArtifactSchema).max(4),
    manifestSha256: sha256Schema.nullable(),
    idempotencyKey: idempotencyKeySchema,
    createdAt: z.string().datetime({ offset: true }),
    startedAt: z.string().datetime({ offset: true }).nullable(),
    completedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const ready = value.status === "ready";
    const artifactKinds = new Set(value.artifacts.map((artifact) => artifact.kind));
    const completeReadyPackage = ["pdf", "archive", "manifest"].every(
      (kind) => artifactKinds.has(kind as z.output<typeof technicalFileSnapshotArtifactKindSchema>),
    );
    if (ready && (!value.completedAt || !value.manifestSha256 || !completeReadyPackage)) {
      context.addIssue({
        code: "custom",
        path: ["artifacts"],
        message: "Ready exports require PDF, archive, and manifest artifacts",
      });
    }
    if (!ready && (value.completedAt !== null || value.manifestSha256 !== null)) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "Only ready exports contain completed artifact metadata",
      });
    }
    if ((value.status === "failed") !== (value.failureCode !== null)) {
      context.addIssue({
        code: "custom",
        path: ["failureCode"],
        message: "Only failed exports expose a failure code",
      });
    }
    if ((value.status === "cancelled") !== (value.cancellationReason !== null)) {
      context.addIssue({
        code: "custom",
        path: ["cancellationReason"],
        message: "Only cancelled exports expose a cancellation reason",
      });
    }
  });

export const technicalFileSnapshotParamsSchema = technicalFileProductParamsSchema
  .extend({ snapshotId: z.uuid() })
  .strict();
export const technicalFileSnapshotExportParamsSchema = technicalFileSnapshotParamsSchema
  .extend({ exportId: z.uuid() })
  .strict();
export const technicalFileSnapshotDownloadQuerySchema = z
  .object({ artifact: z.enum(["pdf", "archive"]) })
  .strict();

export const createTechnicalFileSnapshotRequestSchema = z
  .object({
    expectedTechnicalFileVersion: expectedVersionSchema,
    purpose: technicalFileSnapshotPurposeSchema,
    releaseId: z.uuid().nullable().optional(),
    auditRationale: z.string().trim().min(1).max(4_000).nullable().optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict()
  .superRefine((value, context) => {
    const releaseId = value.releaseId ?? null;
    const auditRationale = value.auditRationale ?? null;
    if (value.purpose === "release" && (releaseId === null || auditRationale !== null)) {
      context.addIssue({
        code: "custom",
        path: ["releaseId"],
        message: "Release snapshots require a release ID and no audit rationale",
      });
    }
    if (value.purpose === "audit" && (releaseId !== null || auditRationale === null)) {
      context.addIssue({
        code: "custom",
        path: ["auditRationale"],
        message: "Audit snapshots require a rationale and cannot link a release",
      });
    }
  });

export const createTechnicalFileSnapshotExportRequestSchema = z
  .object({ idempotencyKey: idempotencyKeySchema })
  .strict();
export const cancelTechnicalFileSnapshotExportRequestSchema = z
  .object({
    reason: requiredText(1_000),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const technicalFileSnapshotDownloadArtifactSchema = z
  .object({
    artifact: technicalFileSnapshotArtifactSchema,
    downloadUrl: z.url().max(4_000),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const technicalFileSnapshotResponseSchema = z
  .object({ snapshot: technicalFileSnapshotSchema })
  .strict();
export const technicalFileSnapshotsResponseSchema = z
  .object({ snapshots: z.array(technicalFileSnapshotSchema) })
  .strict();
export const technicalFileSnapshotExportResponseSchema = z
  .object({ export: technicalFileSnapshotExportSchema })
  .strict();
export const technicalFileSnapshotDownloadResponseSchema = z
  .object({ download: technicalFileSnapshotDownloadArtifactSchema })
  .strict();
export const technicalFileSnapshotConflictResponseSchema = z
  .object({
    code: z.literal("version_conflict"),
    message: requiredText(500),
    currentVersion: expectedVersionSchema,
  })
  .strict();
