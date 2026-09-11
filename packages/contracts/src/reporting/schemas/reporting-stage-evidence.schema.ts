import { destructiveMfaCodeSchema } from "../../organizations/schemas/organization-lifecycle.schema.js";
import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";
import { z } from "zod";

import {
  reportingActorSnapshotSchema,
  reportingObligationParamsSchema,
  reportingObligationStageKindSchema,
  utcSecondDateTimeSchema,
} from "./reporting-obligations.schema.js";
import {
  reportingStageDraftApprovalSchema,
  reportingStageDraftHashSchema,
  reportingStageDraftParamsSchema,
} from "./reporting-stage-drafts.schema.js";

const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);
const revisionSchema = z.number().int().positive();
const expectedVersionSchema = z.number().int().nonnegative();
const sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Use a lowercase SHA-256 digest");
const base64UrlSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/, "Use unpadded base64url data")
  .min(40)
  .max(16_384);

export const REPORTING_MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
export const REPORTING_MAX_EVIDENCE_EXPORT_BYTES = 25 * 1024 * 1024;

/** Safe display name only; storage locations remain server-private. */
export const reportingEvidenceFileNameSchema = z
  .string()
  .trim()
  .regex(
    /^(?!\.)(?!.*[\\/])(?!.*\.\.)(?=.{1,255}$)[A-Za-z0-9][A-Za-z0-9._ -]*$/,
    "Use a safe filename without path segments",
  );

export const reportingReceiptMimeTypeSchema = z.enum([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "text/plain",
]);

export const reportingStageEvidencePackageStatusSchema = z.enum([
  "building",
  "ready",
  "failed",
]);

export const reportingStageEvidencePackageFailureCodeSchema = z.enum([
  "approval_invalidated",
  "artifact_too_large",
  "storage_unavailable",
  "unknown",
]);

/** Detached signature metadata: private signing material never appears on this boundary. */
export const reportingEvidenceDetachedSignatureSchema = z
  .object({
    algorithm: z.literal("Ed25519"),
    keyId: requiredText(1_000),
    detachedSignature: base64UrlSchema,
    publicKeyFingerprint: sha256Schema,
  })
  .strict();

/** Immutable package assembled from one approved revision/hash only. */
export const reportingStageEvidencePackageSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    obligationId: z.uuid(),
    stageId: z.uuid(),
    approvalId: z.uuid(),
    draftRevision: revisionSchema,
    draftHash: reportingStageDraftHashSchema,
    status: reportingStageEvidencePackageStatusSchema,
    fileName: reportingEvidenceFileNameSchema,
    byteLength: z
      .number()
      .int()
      .positive()
      .max(REPORTING_MAX_EVIDENCE_EXPORT_BYTES),
    sha256: sha256Schema,
    manifestSha256: sha256Schema,
    signature: reportingEvidenceDetachedSignatureSchema,
    createdAt: utcSecondDateTimeSchema,
    completedAt: utcSecondDateTimeSchema.nullable(),
    failureCode: reportingStageEvidencePackageFailureCodeSchema.nullable(),
  })
  .strict()
  .superRefine((artifact, context) => {
    const ready = artifact.status === "ready";
    if (ready !== (artifact.completedAt !== null)) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "Only ready packages have a completion timestamp",
      });
    }
    if ((artifact.status === "failed") !== (artifact.failureCode !== null)) {
      context.addIssue({
        code: "custom",
        path: ["failureCode"],
        message: "Only failed packages expose a failure code",
      });
    }
  });

export const generateReportingStageSubmissionPackageInputSchema = z
  .object({
    approvalId: z.uuid(),
    draftRevision: revisionSchema,
    draftHash: reportingStageDraftHashSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const reportingEvidenceArtifactDownloadSchema = z
  .object({
    fileName: reportingEvidenceFileNameSchema,
    downloadUrl: z.url().max(4_000),
    expiresAt: utcSecondDateTimeSchema,
    sha256: sha256Schema,
    byteLength: z
      .number()
      .int()
      .positive()
      .max(REPORTING_MAX_EVIDENCE_EXPORT_BYTES),
  })
  .strict();

export const reportingStageEvidencePackageResponseSchema = z
  .object({ package: reportingStageEvidencePackageSchema })
  .strict();

export const reportingStageEvidencePackageDownloadResponseSchema = z
  .object({ download: reportingEvidenceArtifactDownloadSchema })
  .strict();

export const reportingStageEvidencePackageParamsSchema = z
  .object({ packageId: z.uuid() })
  .strict();

/** Complete path boundary for a stage-package download. */
export const reportingStageEvidencePackageRouteParamsSchema =
  reportingStageDraftParamsSchema.merge(reportingStageEvidencePackageParamsSchema);

/** Credentials are verified immediately by the provider and never persist with a filing. */
export const reauthenticateReportingStageFilingInputSchema = z
  .object({
    packageId: z.uuid(),
    password: z.string().min(1).max(1_024),
    mfaCode: destructiveMfaCodeSchema.optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

/** One-use proof is package-bound to prevent reuse for approval or another filing. */
export const reauthenticateReportingStageFilingResponseSchema = z
  .object({
    reauthenticationProofId: z.uuid(),
    expiresAt: utcSecondDateTimeSchema,
  })
  .strict();

/**
 * Parsed non-file multipart fields. The receipt is supplied separately as exactly one
 * controller-validated file; browser paths, MIME claims and byte counts are not trusted.
 */
export const recordReportingStageExternalFilingFieldsSchema = z
  .object({
    packageId: z.uuid(),
    filingReauthenticationProofId: z.uuid(),
    submissionReference: requiredText(1_000),
    submittedAt: utcSecondDateTimeSchema,
    submittedAtBasis: requiredText(4_000),
    expectedStageVersion: expectedVersionSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const reportingStageReceiptSchema = z
  .object({
    id: z.uuid(),
    fileName: reportingEvidenceFileNameSchema,
    mimeType: reportingReceiptMimeTypeSchema,
    byteLength: z.number().int().positive().max(REPORTING_MAX_RECEIPT_BYTES),
    sha256: sha256Schema,
    uploadedAt: utcSecondDateTimeSchema,
  })
  .strict();

/** The only record that represents an actual external filing; package downloads do not. */
export const reportingStageExternalFilingSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    obligationId: z.uuid(),
    stageId: z.uuid(),
    stage: reportingObligationStageKindSchema,
    packageId: z.uuid(),
    approval: reportingStageDraftApprovalSchema,
    submissionReference: requiredText(1_000),
    submittedAt: utcSecondDateTimeSchema,
    submittedAtBasis: requiredText(4_000),
    receipt: reportingStageReceiptSchema,
    submittedBy: reportingActorSnapshotSchema,
    recordedAt: utcSecondDateTimeSchema,
    isLate: z.boolean(),
  })
  .strict();

export const reportingStageExternalFilingResponseSchema = z
  .object({ filing: reportingStageExternalFilingSchema })
  .strict();

export const createReportingStageAcknowledgementInputSchema = z
  .object({
    submissionId: z.uuid(),
    acknowledgedAt: utcSecondDateTimeSchema,
    acknowledgementReference: requiredText(1_000),
    acknowledgementBasis: requiredText(4_000),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

/** Complete path boundary for an immutable acknowledgement append. */
export const reportingSubmissionAcknowledgementRouteParamsSchema =
  reportingObligationParamsSchema.extend({ submissionId: z.uuid() });

export const reportingStageAcknowledgementSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    submissionId: z.uuid(),
    acknowledgedAt: utcSecondDateTimeSchema,
    acknowledgementReference: requiredText(1_000),
    acknowledgementBasis: requiredText(4_000),
    recordedBy: reportingActorSnapshotSchema,
    recordedAt: utcSecondDateTimeSchema,
  })
  .strict();

export const reportingStageAcknowledgementResponseSchema = z
  .object({ acknowledgement: reportingStageAcknowledgementSchema })
  .strict();

export const reportingEvidenceTimelineEventKindSchema = z.enum([
  "awareness_recorded",
  "anchor_corrected",
  "draft_saved",
  "approval_recorded",
  "approval_invalidated",
  "package_generated",
  "external_filing_recorded",
  "acknowledgement_recorded",
  "deadline_breached",
  "obligation_cancelled",
]);

export const reportingEvidenceTimelineEventSchema = z
  .object({
    id: z.uuid(),
    kind: reportingEvidenceTimelineEventKindSchema,
    occurredAt: utcSecondDateTimeSchema,
    recordedAt: utcSecondDateTimeSchema,
    actor: reportingActorSnapshotSchema.nullable(),
    stage: reportingObligationStageKindSchema.nullable(),
    summary: requiredText(2_000),
    contentSha256: sha256Schema.nullable(),
  })
  .strict();

export const reportingStageEvidenceTimelineResponseSchema = z
  .object({ events: z.array(reportingEvidenceTimelineEventSchema).max(500) })
  .strict();

export const generateReportingObligationEvidencePackInputSchema = z
  .object({ idempotencyKey: idempotencyKeySchema })
  .strict();

export const reportingObligationEvidencePackSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    obligationId: z.uuid(),
    fileName: reportingEvidenceFileNameSchema,
    sha256: sha256Schema,
    manifestSha256: sha256Schema,
    byteLength: z
      .number()
      .int()
      .positive()
      .max(REPORTING_MAX_EVIDENCE_EXPORT_BYTES),
    createdAt: utcSecondDateTimeSchema,
  })
  .strict();

export const reportingObligationEvidencePackResponseSchema = z
  .object({ evidencePack: reportingObligationEvidencePackSchema })
  .strict();

export const reportingObligationEvidencePackDownloadResponseSchema = z
  .object({ download: reportingEvidenceArtifactDownloadSchema })
  .strict();

export const reportingObligationEvidencePackParamsSchema = z
  .object({ evidencePackId: z.uuid() })
  .strict();

/** Complete path boundary for an obligation evidence-pack download. */
export const reportingObligationEvidencePackRouteParamsSchema =
  reportingObligationParamsSchema.merge(reportingObligationEvidencePackParamsSchema);

/** Public, rotation-aware verification material only. */
export const reportingEvidencePublicVerificationKeySchema = z
  .object({
    keyId: requiredText(1_000),
    algorithm: z.literal("Ed25519"),
    publicKey: base64UrlSchema,
    fingerprint: sha256Schema,
    validFrom: utcSecondDateTimeSchema,
    revokedAt: utcSecondDateTimeSchema.nullable(),
  })
  .strict();

export const reportingEvidencePublicVerificationKeysResponseSchema = z
  .object({
    keys: z.array(reportingEvidencePublicVerificationKeySchema).min(1).max(100),
  })
  .strict();
