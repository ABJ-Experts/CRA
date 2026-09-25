import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";
import { z } from "zod";

const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);
const utcDateTimeSchema = z.string().datetime({ offset: true });
const reviewFingerprintSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Use a lowercase review fingerprint");

/** Document-level state; immutable versions are never removed from the audit trail. */
export const evidenceDeletionLifecycleSchema = z.enum([
  "active",
  "cleanup_queued",
  "cleanup_claimed",
  "cleanup_failed",
  "deleted",
]);

/** The state of the latest explicit request, separate from document lifecycle. */
export const evidenceDeletionIntentStatusSchema = z.enum([
  "queued",
  "claimed",
  "cleanup_failed",
  "completed",
  "cancelled",
]);

/**
 * A retained original can be pseudonymised only at its separate identity
 * reference. Its bytes must remain immutable and be reviewed for redaction.
 */
export const evidenceIdentityHandlingSchema = z.enum([
  "none",
  "legal_review_required",
]);

/**
 * The record-level projection is deliberately conservative. "incomplete" and
 * "unavailable" are deletion blockers, even if no date is currently known.
 */
export const evidenceRetentionProtectionSchema = z
  .object({
    status: z.enum(["current", "incomplete", "unavailable"]),
    retentionUntil: utcDateTimeSchema.nullable(),
    retentionProtectionUntil: utcDateTimeSchema.nullable(),
    legalHoldActive: z.boolean(),
    identityHandling: evidenceIdentityHandlingSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.status === "current" &&
      (value.retentionUntil === null || value.retentionProtectionUntil === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Current protection requires retained-until dates",
      });
    }
    if (value.status === "incomplete" && value.retentionUntil !== null) {
      context.addIssue({
        code: "custom",
        path: ["retentionUntil"],
        message: "Incomplete protection cannot expose a final retention date",
      });
    }
    if (
      value.status === "unavailable" &&
      (value.retentionUntil !== null || value.retentionProtectionUntil !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Unavailable protection cannot expose derived dates",
      });
    }
  });

/**
 * Visible blockers are already permission-filtered by the server. A hidden
 * product, declaration, or snapshot is represented only by this generic
 * restricted shape so a deletion review cannot disclose protected metadata.
 */
export const evidenceRetentionBlockerSchema = z.discriminatedUnion(
  "visibility",
  [
    z
      .object({
        visibility: z.literal("visible"),
        kind: z.enum([
          "product_retention",
          "legal_hold",
          "retained_reference",
          "incomplete_retention",
          "protection_unavailable",
          "retention",
          "deletion_in_progress",
        ]),
        obligation: requiredText(500),
        productId: z.uuid().nullable(),
        productName: requiredText(500).nullable(),
        protectThrough: utcDateTimeSchema.nullable(),
      })
      .strict()
      .superRefine((value, context) => {
        if ((value.productId === null) !== (value.productName === null)) {
          context.addIssue({
            code: "custom",
            path: ["productId"],
            message: "Visible product identity must include both ID and name",
          });
        }
        if (
          value.kind === "product_retention" &&
          (value.productId === null ||
            value.productName === null ||
            value.protectThrough === null)
        ) {
          context.addIssue({
            code: "custom",
            message: "Product retention must identify its product and date",
          });
        }
      }),
    z
      .object({
        visibility: z.literal("restricted"),
        kind: z.literal("protected_reference"),
        message: z.literal("A protected related record prevents deletion."),
      })
      .strict(),
  ],
);

export const evidenceRetentionReviewSchema = z
  .object({
    documentId: z.uuid(),
    currentVersionId: z.uuid(),
    lifecycle: evidenceDeletionLifecycleSchema,
    reviewedAt: utcDateTimeSchema,
    reviewFingerprint: reviewFingerprintSchema,
    eligibleForDeletion: z.boolean(),
    blockers: z.array(evidenceRetentionBlockerSchema).max(100),
    protection: evidenceRetentionProtectionSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.eligibleForDeletion && value.blockers.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["blockers"],
        message: "Eligible deletion cannot have protection blockers",
      });
    }
    if (value.eligibleForDeletion && value.lifecycle !== "active") {
      context.addIssue({
        code: "custom",
        path: ["lifecycle"],
        message: "Only active evidence may be eligible for deletion review",
      });
    }
    if (
      value.eligibleForDeletion &&
      (value.protection.status !== "current" ||
        value.protection.legalHoldActive ||
        value.protection.retentionUntil === null ||
        value.protection.retentionProtectionUntil === null ||
        Date.parse(value.protection.retentionUntil) >
          Date.parse(value.reviewedAt) ||
        Date.parse(value.protection.retentionProtectionUntil) >
          Date.parse(value.reviewedAt))
    ) {
      context.addIssue({
        code: "custom",
        path: ["protection"],
        message:
          "Eligible deletion requires expired current protection and no active hold",
      });
    }
  });

export const evidenceRetentionReviewParamsSchema = z
  .object({ documentId: z.uuid() })
  .strict();
export const evidenceRetentionReviewResponseSchema = z
  .object({ review: evidenceRetentionReviewSchema })
  .strict();

/** A user must confirm the exact review and immutable current version they saw. */
export const createEvidenceDeletionIntentInputSchema = z
  .object({
    expectedCurrentVersionId: z.uuid(),
    reviewFingerprint: reviewFingerprintSchema,
    confirmed: z.literal(true),
    reason: requiredText(2_000),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const evidenceDeletionIntentSchema = z
  .object({
    id: z.uuid(),
    documentId: z.uuid(),
    expectedCurrentVersionId: z.uuid(),
    reviewFingerprint: reviewFingerprintSchema,
    status: evidenceDeletionIntentStatusSchema,
    requestedByUserId: z.uuid(),
    requestedAt: utcDateTimeSchema,
    claimedAt: utcDateTimeSchema.nullable(),
    completedAt: utcDateTimeSchema.nullable(),
    failureCode: requiredText(100).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "claimed" && value.claimedAt === null) {
      context.addIssue({
        code: "custom",
        path: ["claimedAt"],
        message: "A claimed deletion intent requires a claim time",
      });
    }
    if (value.status === "completed" && value.completedAt === null) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "A completed deletion intent requires a completion time",
      });
    }
    if (value.status === "cleanup_failed" && value.failureCode === null) {
      context.addIssue({
        code: "custom",
        path: ["failureCode"],
        message: "Failed cleanup requires a safe failure code",
      });
    }
    if (value.status !== "cleanup_failed" && value.failureCode !== null) {
      context.addIssue({
        code: "custom",
        path: ["failureCode"],
        message: "Only failed cleanup may expose a failure code",
      });
    }
  });

export const evidenceDeletionIntentResponseSchema = z
  .object({
    outcome: z.enum(["queued", "replayed"]),
    deletion: evidenceDeletionIntentSchema,
  })
  .strict();

export const evidenceLegalHoldStatusSchema = z.enum(["active", "released"]);

/** A hold applies to the document and therefore every immutable version. */
export const evidenceLegalHoldSchema = z
  .object({
    id: z.uuid(),
    documentId: z.uuid(),
    reason: requiredText(2_000),
    status: evidenceLegalHoldStatusSchema,
    placedByUserId: z.uuid(),
    placedAt: utcDateTimeSchema,
    releasedByUserId: z.uuid().nullable(),
    releasedAt: utcDateTimeSchema.nullable(),
    releaseReason: requiredText(2_000).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const releaseComplete =
      value.releasedByUserId !== null &&
      value.releasedAt !== null &&
      value.releaseReason !== null;
    const hasAnyReleaseField =
      value.releasedByUserId !== null ||
      value.releasedAt !== null ||
      value.releaseReason !== null;
    if (value.status === "released" && !releaseComplete) {
      context.addIssue({
        code: "custom",
        message: "A released legal hold requires actor, time, and reason",
      });
    }
    if (value.status === "active" && hasAnyReleaseField) {
      context.addIssue({
        code: "custom",
        message: "An active legal hold cannot carry release details",
      });
    }
    if (
      value.releasedAt !== null &&
      Date.parse(value.releasedAt) < Date.parse(value.placedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["releasedAt"],
        message: "A legal hold cannot be released before it is placed",
      });
    }
  });

export const evidenceLegalHoldParamsSchema = z
  .object({ documentId: z.uuid(), holdId: z.uuid() })
  .strict();
export const evidenceLegalHoldListParamsSchema = z
  .object({ documentId: z.uuid() })
  .strict();
export const evidenceLegalHoldListResponseSchema = z
  .object({ legalHolds: z.array(evidenceLegalHoldSchema).max(100) })
  .strict();

export const placeEvidenceLegalHoldInputSchema = z
  .object({
    reason: requiredText(2_000),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const placeEvidenceLegalHoldResponseSchema = z
  .object({
    outcome: z.enum(["placed", "replayed"]),
    legalHold: evidenceLegalHoldSchema,
  })
  .strict();

export const releaseEvidenceLegalHoldInputSchema = z
  .object({
    reason: requiredText(2_000),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const releaseEvidenceLegalHoldResponseSchema = z
  .object({
    outcome: z.enum(["released", "replayed"]),
    legalHold: evidenceLegalHoldSchema,
  })
  .strict();
