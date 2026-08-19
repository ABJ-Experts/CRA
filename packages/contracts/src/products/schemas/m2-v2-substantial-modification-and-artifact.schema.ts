import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";
import { pagedSchema } from "../../pagination/schemas/pagination.schema.js";
import { z } from "zod";

import { productParamsSchema, releaseParamsSchema } from "./product.schema.js";
import { utcZDateTimeSchema } from "./release-market-lifecycle.schema.js";

const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);
const expectedVersionSchema = z.number().int().nonnegative();
const sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Use a lowercase SHA-256");

const httpsUriSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .pipe(z.url())
  // The authority cannot contain `@`, so user-info (including passwords) is
  // rejected before a URI crosses a persisted or published boundary.
  .pipe(
    z
      .string()
      .regex(
        /^https:\/\/(?![^/?#]*@)[^\s/?#]+(?:[/?#][^\s]*)?$/,
        "Use a credential-free HTTPS URI",
      ),
  );

/** Private signed Storage URLs may be loopback HTTP only in local Supabase. */
const signedStorageUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(4_096)
  .pipe(z.url())
  .superRefine((value, context) => {
    const parts =
      /^(https?):\/\/([^/?#:]+|\[[^\]]+\])(?::\d+)?(?:[/?#]|$)/i.exec(value);
    if (!parts) {
      context.addIssue({ code: "custom", message: "Use a valid signed URL" });
      return;
    }
    const protocol = parts[1]?.toLowerCase();
    const hostname = parts[2]?.toLowerCase();
    const loopback =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]";
    if (protocol !== "https" && !(protocol === "http" && loopback)) {
      context.addIssue({
        code: "custom",
        message: "Use HTTPS or a loopback HTTP signed Storage URL",
      });
    }
  });

/** Stable policy identifier; suggestions must never become determinations. */
export const substantialModificationPolicyVersionSchema = z.literal(
  "m2.v2.substantial-modification.v1",
);
export const substantialModificationAnswerSchema = z.enum([
  "yes",
  "no",
  "unknown",
]);
export const substantialModificationAnswersSchema = z
  .object({
    changesIntendedPurpose: substantialModificationAnswerSchema,
    changesSecurityArchitectureOrTrustBoundary:
      substantialModificationAnswerSchema,
    changesNetworkInterfaceOrPrivilegedRemoteControl:
      substantialModificationAnswerSchema,
    changesCryptographyOrIdentityAccessControl:
      substantialModificationAnswerSchema,
    changesSafetyOrSecurityRelevantComponent:
      substantialModificationAnswerSchema,
  })
  .strict();

export const substantialModificationSuggestionSchema = z.enum([
  "potentially_substantial",
  "undetermined",
  "not_substantial",
]);
export const substantialModificationDeterminationSchema = z.enum([
  "substantial",
  "potentially_substantial",
  "not_substantial",
  "undetermined",
]);
export const substantialModificationAssessmentStatusSchema = z.enum([
  "draft",
  "in_progress",
  "submitted_for_review",
  "reviewed",
  "superseded",
]);
export const substantialModificationAssessmentCompletenessStateSchema = z.enum([
  "draft",
  "in_progress",
  "complete",
]);

/** Evidence is self-describing without retaining credentials or opaque links. */
export const substantialModificationEvidenceReferenceSchema = z
  .object({
    id: z.uuid(),
    title: requiredText(500),
    sha256: sha256Schema.optional(),
    uri: httpsUriSchema.optional(),
  })
  .strict()
  .superRefine((reference, context) => {
    if (reference.sha256 === undefined && reference.uri === undefined) {
      context.addIssue({
        code: "custom",
        message: "Evidence requires a SHA-256 hash or HTTPS URI",
      });
    }
  });

/** Syntactic client candidate; the server must validate it before publication. */
export const externalReferenceCandidateSchema = z
  .object({
    id: z.uuid(),
    title: requiredText(500),
    uri: httpsUriSchema,
  })
  .strict();

/** Only server validation may promote a candidate into a published reference. */
export const validatedPublishedExternalReferenceSchema =
  externalReferenceCandidateSchema
    .extend({
      validationState: z.literal("validated_by_server"),
      validatedAt: utcZDateTimeSchema,
    })
    .strict();

const assessmentReleaseIdsSchema = z
  .array(z.uuid())
  .min(1)
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "Affected releases must not contain duplicates",
  });

const assessmentReleaseIdsDraftSchema = z
  .array(z.uuid())
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "Affected releases must not contain duplicates",
  });

const assessmentNarrativeSchema = z
  .object({
    modificationIdentifier: requiredText(128),
    title: requiredText(200),
    description: requiredText(4_000),
    technicalScope: requiredText(8_000),
    introducedAt: utcZDateTimeSchema,
    detectedOrAssessedAt: utcZDateTimeSchema,
    previousState: requiredText(8_000),
    resultingState: requiredText(8_000),
    requiredFollowUpActions: z.array(requiredText(1_000)).max(100),
  })
  .strict();

const substantialModificationDraftAnswersSchema = z
  .object({
    changesIntendedPurpose: substantialModificationAnswerSchema.optional(),
    changesSecurityArchitectureOrTrustBoundary:
      substantialModificationAnswerSchema.optional(),
    changesNetworkInterfaceOrPrivilegedRemoteControl:
      substantialModificationAnswerSchema.optional(),
    changesCryptographyOrIdentityAccessControl:
      substantialModificationAnswerSchema.optional(),
    changesSafetyOrSecurityRelevantComponent:
      substantialModificationAnswerSchema.optional(),
  })
  .strict();

const substantialModificationStoredAnswersSchema = z
  .object({
    changesIntendedPurpose: substantialModificationAnswerSchema.nullable(),
    changesSecurityArchitectureOrTrustBoundary:
      substantialModificationAnswerSchema.nullable(),
    changesNetworkInterfaceOrPrivilegedRemoteControl:
      substantialModificationAnswerSchema.nullable(),
    changesCryptographyOrIdentityAccessControl:
      substantialModificationAnswerSchema.nullable(),
    changesSafetyOrSecurityRelevantComponent:
      substantialModificationAnswerSchema.nullable(),
  })
  .strict();

const assessmentInputFieldsSchema = assessmentNarrativeSchema
  .extend({
    releaseIds: assessmentReleaseIdsSchema,
    policyVersion: substantialModificationPolicyVersionSchema,
    answers: substantialModificationAnswersSchema,
    rationale: requiredText(4_000),
    evidenceReferences: z
      .array(substantialModificationEvidenceReferenceSchema)
      .max(100),
  })
  .strict();

/** Draft data is deliberately incomplete and cannot itself be reviewed. */
export const createSubstantialModificationAssessmentDraftInputSchema = z
  .object({
    policyVersion: substantialModificationPolicyVersionSchema,
    completenessState: z.enum(["draft", "in_progress"]),
    releaseIds: assessmentReleaseIdsDraftSchema.optional(),
    answers: substantialModificationDraftAnswersSchema.optional(),
    rationale: requiredText(4_000).optional(),
    evidenceReferences: z
      .array(substantialModificationEvidenceReferenceSchema)
      .max(100)
      .optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .extend(assessmentNarrativeSchema.partial().shape)
  .strict();

export const createSubstantialModificationAssessmentInputSchema =
  assessmentInputFieldsSchema
    .extend({ idempotencyKey: idempotencyKeySchema })
    .strict();

export const reassessSubstantialModificationAssessmentInputSchema =
  assessmentInputFieldsSchema
    .extend({
      expectedVersion: expectedVersionSchema,
      idempotencyKey: idempotencyKeySchema,
    })
    .strict();

export const reviewSubstantialModificationAssessmentInputSchema = z
  .object({
    determination: substantialModificationDeterminationSchema,
    rationale: requiredText(4_000),
    /** Required whenever a reviewer differs from the policy suggestion. */
    overrideReason: requiredText(1_000).optional(),
    expectedVersion: expectedVersionSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const substantialModificationAssessmentParamsSchema = z
  .object({ ...productParamsSchema.shape, assessmentId: z.uuid() })
  .strict();

export const substantialModificationAssessmentListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(15),
    releaseId: z.uuid().optional(),
    status: substantialModificationAssessmentStatusSchema.optional(),
  })
  .strict();

export const substantialModificationAssessmentSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    productId: z.uuid(),
    /** Stable chain identifier shared by every immutable reassessment revision. */
    modificationId: z.uuid(),
    supersedesId: z.uuid().nullable(),
    modificationIdentifier: requiredText(128).nullable(),
    title: requiredText(200).nullable(),
    description: requiredText(4_000).nullable(),
    technicalScope: requiredText(8_000).nullable(),
    introducedAt: utcZDateTimeSchema.nullable(),
    detectedOrAssessedAt: utcZDateTimeSchema.nullable(),
    previousState: requiredText(8_000).nullable(),
    resultingState: requiredText(8_000).nullable(),
    requiredFollowUpActions: z.array(requiredText(1_000)).max(100).nullable(),
    completenessState: substantialModificationAssessmentCompletenessStateSchema,
    releaseIds: assessmentReleaseIdsDraftSchema,
    policyVersion: substantialModificationPolicyVersionSchema,
    answers: substantialModificationStoredAnswersSchema,
    rationale: requiredText(4_000).nullable(),
    evidenceReferences: z.array(substantialModificationEvidenceReferenceSchema),
    suggestion: substantialModificationSuggestionSchema.nullable(),
    status: substantialModificationAssessmentStatusSchema,
    determination: substantialModificationDeterminationSchema.nullable(),
    determinationRationale: requiredText(4_000).nullable(),
    overrideReason: requiredText(1_000).nullable(),
    reviewedAt: utcZDateTimeSchema.nullable(),
    reviewedBy: z.uuid().nullable(),
    version: expectedVersionSchema,
    createdAt: utcZDateTimeSchema,
    createdBy: z.uuid(),
    updatedAt: utcZDateTimeSchema,
    updatedBy: z.uuid(),
  })
  .strict()
  .superRefine((assessment, context) => {
    const assessmentComplete =
      assessment.releaseIds.length > 0 &&
      assessment.modificationIdentifier !== null &&
      assessment.title !== null &&
      assessment.description !== null &&
      assessment.technicalScope !== null &&
      assessment.introducedAt !== null &&
      assessment.detectedOrAssessedAt !== null &&
      assessment.previousState !== null &&
      assessment.resultingState !== null &&
      assessment.requiredFollowUpActions !== null &&
      assessment.rationale !== null &&
      assessment.suggestion !== null &&
      Object.values(assessment.answers).every((answer) => answer !== null);
    if (assessment.completenessState === "complete" && !assessmentComplete) {
      context.addIssue({
        code: "custom",
        message: "Complete assessments require every narrative and answer",
      });
    }
    const reviewComplete =
      assessment.determination !== null &&
      assessment.determinationRationale !== null &&
      assessment.reviewedAt !== null &&
      assessment.reviewedBy !== null;
    const reviewStarted =
      assessment.determination !== null ||
      assessment.determinationRationale !== null ||
      assessment.overrideReason !== null ||
      assessment.reviewedAt !== null ||
      assessment.reviewedBy !== null;
    if (
      (assessment.status === "reviewed" &&
        (!assessmentComplete || !reviewComplete)) ||
      (reviewStarted && !reviewComplete)
    ) {
      context.addIssue({
        code: "custom",
        message: "Human review fields must be complete when present",
      });
    }
  });

export const substantialModificationAssessmentResponseSchema = z
  .object({ assessment: substantialModificationAssessmentSchema })
  .strict();
export const substantialModificationAssessmentListResponseSchema = z
  .object({ assessments: pagedSchema(substantialModificationAssessmentSchema) })
  .strict();

export const securityUpdateArtifactUploadStatusSchema = z.enum([
  "reserved",
  "uploaded",
  "finalized",
  "missing",
  "failed",
]);
export const securityUpdateArtifactIntegrityStatusSchema = z.enum([
  "pending",
  "verified",
  "hash_mismatch",
  "type_mismatch",
  "corrupt",
  "unavailable",
  "provider_unavailable",
]);
export const securityUpdateArtifactReviewStatusSchema = z.enum([
  "pending_review",
  "cleared",
  "rejected",
]);
export const securityUpdateArtifactPublicationStatusSchema = z.enum([
  "draft",
  "published",
  "replaced",
  "withdrawn",
]);
export const securityUpdateArtifactAvailabilityStatusSchema = z.enum([
  "pending",
  "available",
  "blocked",
  "expired",
]);
export const securityUpdateArtifactTypeSchema = z.enum([
  "software_update",
  "firmware_update",
  "security_advisory",
]);
export const securityUpdateArtifactSignatureMetadataSchema = z
  .object({
    algorithm: requiredText(100),
    signer: requiredText(500),
    certificateSha256: sha256Schema.optional(),
  })
  .strict();
export const securityUpdateAvailabilityRuleVersionSchema = z.literal(
  "m2.v2.security-update-availability.v1",
);
export const securityUpdateArtifactAvailabilityWinningRuleSchema = z.enum([
  "issued_at_plus_10_calendar_years",
  "support_period_end",
  "equal",
]);
export const securityUpdateArtifactDistributionKindSchema = z.enum([
  "authenticated_download",
  "external_reference",
]);
export const securityUpdateArtifactStatusExplanationSchema = z
  .object({
    code: z.enum([
      "awaiting_upload",
      "awaiting_integrity_check",
      "integrity_check_failed",
      "awaiting_approval",
      "review_rejected",
      "support_period_missing",
      "availability_recalculation_required",
      "replacement_required",
      "withdrawn",
      "provider_unavailable",
    ]),
    message: requiredText(500),
  })
  .strict();

export const securityUpdateArtifactSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    productId: z.uuid(),
    /** Every artifact is scoped to exactly one release; replacement history is retained. */
    releaseId: z.uuid(),
    updateVersion: requiredText(200),
    title: requiredText(200),
    artifactType: securityUpdateArtifactTypeSchema,
    supportedPlatform: requiredText(500),
    signatureMetadata: securityUpdateArtifactSignatureMetadataSchema.nullable(),
    fileName: requiredText(255),
    contentType: requiredText(255),
    byteSize: z.number().int().positive().max(2_147_483_647),
    sha256: sha256Schema,
    uploadStatus: securityUpdateArtifactUploadStatusSchema,
    integrityStatus: securityUpdateArtifactIntegrityStatusSchema,
    reviewStatus: securityUpdateArtifactReviewStatusSchema,
    publicationStatus: securityUpdateArtifactPublicationStatusSchema,
    availabilityStatus: securityUpdateArtifactAvailabilityStatusSchema,
    statusExplanation: securityUpdateArtifactStatusExplanationSchema.nullable(),
    issuedAt: utcZDateTimeSchema,
    supportPeriodId: z.uuid().nullable(),
    supportPeriodRevision: z.number().int().positive().nullable(),
    supportEndsAt: utcZDateTimeSchema.nullable(),
    availabilityRuleVersion: securityUpdateAvailabilityRuleVersionSchema,
    issuedCandidate: utcZDateTimeSchema.nullable(),
    supportCandidate: utcZDateTimeSchema.nullable(),
    availabilityWinningRule:
      securityUpdateArtifactAvailabilityWinningRuleSchema.nullable(),
    computedAvailabilityUntil: utcZDateTimeSchema.nullable(),
    availabilityUntil: utcZDateTimeSchema.nullable(),
    nonReductionApplied: z.boolean(),
    distributionKind: securityUpdateArtifactDistributionKindSchema,
    distributionReference: validatedPublishedExternalReferenceSchema.nullable(),
    publishedExternalReferences: z.array(
      validatedPublishedExternalReferenceSchema,
    ),
    replacementArtifactId: z.uuid().nullable(),
    withdrawnAt: utcZDateTimeSchema.nullable(),
    withdrawnReason: requiredText(1_000).nullable(),
    version: expectedVersionSchema,
    createdAt: utcZDateTimeSchema,
    createdBy: z.uuid(),
    updatedAt: utcZDateTimeSchema,
    updatedBy: z.uuid(),
  })
  .strict()
  .superRefine((artifact, context) => {
    const withdrawn = artifact.publicationStatus === "withdrawn";
    if (
      withdrawn !==
      (artifact.withdrawnAt !== null && artifact.withdrawnReason !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Withdrawal status requires timestamp and reason",
      });
    }
    if (
      (artifact.supportPeriodId === null) !==
      (artifact.supportPeriodRevision === null)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Support period identity and revision must be recorded together",
      });
    }
    const external = artifact.distributionKind === "external_reference";
    if (
      (!external &&
        (artifact.distributionReference !== null ||
          artifact.publishedExternalReferences.length > 0)) ||
      (external &&
        artifact.publicationStatus !== "draft" &&
        artifact.distributionReference === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Distribution kind and validated source must agree",
      });
    }
    if (
      external &&
      artifact.publicationStatus === "published" &&
      artifact.publishedExternalReferences.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Published external artifacts require validated references",
      });
    }
  });

export const securityUpdateArtifactParamsSchema = z
  .object({ ...productParamsSchema.shape, artifactId: z.uuid() })
  .strict();
export const securityUpdateArtifactListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(15),
    releaseId: z.uuid().optional(),
    publicationStatus: securityUpdateArtifactPublicationStatusSchema.optional(),
  })
  .strict();

export const reserveSecurityUpdateArtifactInputSchema = z
  .object({
    releaseId: releaseParamsSchema.shape.releaseId,
    updateVersion: requiredText(200),
    title: requiredText(200),
    artifactType: securityUpdateArtifactTypeSchema,
    supportedPlatform: requiredText(500),
    signatureMetadata: securityUpdateArtifactSignatureMetadataSchema.optional(),
    distributionKind: securityUpdateArtifactDistributionKindSchema,
    /**
     * Syntactic candidate(s) used only to establish the immutable external
     * source. The API validates them before handing server-stamped references
     * to persistence; callers never provide trusted references directly.
     */
    externalReferenceCandidates: z
      .array(externalReferenceCandidateSchema)
      .min(1)
      .max(100)
      .optional(),
    serverValidationRequired: z.literal(true).optional(),
    fileName: requiredText(255),
    contentType: requiredText(255),
    byteSize: z.number().int().positive().max(2_147_483_647),
    sha256: sha256Schema,
    issuedAt: utcZDateTimeSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict()
  .superRefine((input, context) => {
    const external = input.distributionKind === "external_reference";
    if (
      external &&
      (input.externalReferenceCandidates === undefined ||
        input.serverValidationRequired !== true)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "External reservations require candidates and server validation",
      });
    }
    if (
      !external &&
      (input.externalReferenceCandidates !== undefined ||
        input.serverValidationRequired !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Authenticated-download reservations cannot include external references",
      });
    }
  });
export const finalizeSecurityUpdateArtifactInputSchema = z
  .object({
    expectedVersion: expectedVersionSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const reviewSecurityUpdateArtifactInputSchema = z
  .object({
    decision: z.enum(["clear", "reject"]),
    reason: requiredText(1_000),
    expectedVersion: expectedVersionSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const publishSecurityUpdateArtifactInputSchema = z
  .object({
    /** The durable reservation already contains the server-validated source. */
    expectedVersion: expectedVersionSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const replaceSecurityUpdateArtifactInputSchema = z
  .object({
    replacementArtifactId: z.uuid(),
    reason: requiredText(1_000),
    expectedVersion: expectedVersionSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const withdrawSecurityUpdateArtifactInputSchema = z
  .object({
    reason: requiredText(1_000),
    expectedVersion: expectedVersionSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
/**
 * PATCH is self-idempotent via `expectedVersion`'s optimistic lock, so unlike
 * every other mutation in this file this one carries no `idempotencyKey`.
 * Metadata-only edit: never the immutable content-identity columns.
 */
export const updateSecurityUpdateArtifactMetadataInputSchema = z
  .object({
    expectedVersion: expectedVersionSchema,
    title: requiredText(200),
    supportedPlatform: requiredText(500),
    signatureMetadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

/** A signed URL is transient response data and is never part of the artifact. */
export const securityUpdateArtifactUploadReservationSchema = z
  .object({
    uploadUrl: signedStorageUrlSchema,
    expiresAt: utcZDateTimeSchema,
  })
  .strict();
export const securityUpdateArtifactReserveResponseSchema = z
  .object({
    artifact: securityUpdateArtifactSchema,
    upload: securityUpdateArtifactUploadReservationSchema.nullable(),
  })
  .strict();
export const securityUpdateArtifactResponseSchema = z
  .object({ artifact: securityUpdateArtifactSchema })
  .strict();
export const securityUpdateArtifactListResponseSchema = z
  .object({ artifacts: pagedSchema(securityUpdateArtifactSchema) })
  .strict();
export const securityUpdateArtifactDownloadResponseSchema = z
  .object({
    download: z
      .object({
        downloadUrl: signedStorageUrlSchema,
        expiresAt: utcZDateTimeSchema,
        fileName: requiredText(255),
        contentType: requiredText(255),
      })
      .strict(),
  })
  .strict();
