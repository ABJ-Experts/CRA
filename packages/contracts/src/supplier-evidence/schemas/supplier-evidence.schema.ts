import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";
import {
  EVIDENCE_MAX_UPLOAD_BYTES,
  evidenceDocumentClassSchema,
  safeEvidenceFileNameSchema,
} from "../../evidence/schemas/evidence.schema.js";
import {
  completeSupplierSbomUploadInputSchema,
  initializeSupplierSbomUploadInputSchema,
  supplierSbomPortalSubmissionSchema,
  supplierSbomUploadInstructionSchema,
} from "../../sboms/schemas/sbom-supplier.schema.js";
import { z } from "zod";

const text = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .transform((value) => value.normalize("NFC"));
const safeText = (maximum: number) =>
  text(maximum).refine(
    (value) => !/[\p{Cc}\p{Cf}]/u.test(value),
    "Control characters are not allowed",
  );
const timestamp = z.string().datetime({ offset: true });
const sha256 = z.string().regex(/^[a-f0-9]{64}$/, "Use a lowercase SHA-256");
const token = z
  .string()
  .trim()
  .min(32)
  .max(1024)
  .regex(/^[A-Za-z0-9_-]+$/, "Use an opaque URL-safe bearer");
const fingerprint = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Use a SHA-256 fingerprint");
const supplierEvidenceDocumentClassSchema = z.union([
  evidenceDocumentClassSchema,
  z.literal("sbom"),
]);
/** M9-02 delegates finalization to the current M8 scanner contract. */
export const supplierEvidenceUploadMediaTypeSchema = z.enum([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/csv",
  "text/plain",
]);

export const supplierEvidenceRequestStateSchema = z.enum([
  "draft",
  "open",
  "closed",
  "revoked",
]);
export const supplierEvidenceInvitationStateSchema = z.enum([
  "active",
  "revoked",
  "expired",
]);
export const supplierEvidenceSubmissionStateSchema = z.enum([
  "uploading",
  "scan_pending",
  "submitted_pending_review",
  "accepted",
  "rejected",
  "re_requested",
  "failed",
  "cancelled",
]);
/** The supplier-visible result of the latest immutable review decision. */
export const supplierEvidenceReviewDecisionSchema = z.enum([
  "accepted",
  "rejected",
]);
/** Review is independent of M8 scan/quarantine status. */
export const supplierEvidenceSubmissionReviewStateSchema = z.enum([
  "pending",
  "accepted",
  "rejected",
  "re_requested",
]);
/** Current checklist-item state; this never replaces an immutable submission or review. */
export const supplierEvidenceChecklistReviewStateSchema = z.enum([
  "missing",
  "pending_response",
  "uploading",
  "pending_processing",
  "awaiting_review",
  "accepted",
  "rejected",
  "re_requested",
  "failed",
]);
/** Aggregate state is a projection of the current request revision only. */
export const supplierEvidenceAggregateReviewStateSchema = z.enum([
  "pending_response",
  "partial_response",
  "pending_processing",
  "awaiting_review",
  "accepted",
  "rejected",
  "re_requested",
]);
export const supplierEvidenceInvitationDeliveryStateSchema = z.enum([
  "pending",
  "delivered",
  "failed",
]);
/** Configured hours relative to a request revision's due timestamp. */
export const SUPPLIER_EVIDENCE_REMINDER_MIN_OFFSET_HOURS = -720;
export const SUPPLIER_EVIDENCE_REMINDER_MAX_OFFSET_HOURS = 720;
export const SUPPLIER_EVIDENCE_REMINDER_MAX_OFFSETS = 3;

export const supplierEvidenceReminderOffsetHoursSchema = z
  .number()
  .int()
  .min(SUPPLIER_EVIDENCE_REMINDER_MIN_OFFSET_HOURS)
  .max(SUPPLIER_EVIDENCE_REMINDER_MAX_OFFSET_HOURS)
  .refine((value) => value !== 0, "Reminder offsets cannot be zero");

const supplierEvidenceReminderOffsetsSchema = z
  .array(supplierEvidenceReminderOffsetHoursSchema)
  .min(1)
  .max(SUPPLIER_EVIDENCE_REMINDER_MAX_OFFSETS)
  .superRefine((offsets, context) => {
    if (new Set(offsets).size !== offsets.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Reminder offsets must be unique",
      });
    }
    if (!offsets.includes(24)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Reminder cadence must include the 24-hour overdue milestone",
      });
    }
  });

export const supplierEvidenceReminderRecipientSchema = z.enum([
  "supplier",
  "owner",
]);
export const supplierEvidenceReminderKindSchema = z.enum([
  "supplier_reminder",
  "owner_escalation",
]);
export const supplierEvidenceReminderDeliveryStateSchema = z.enum([
  "pending",
  "processing",
  "delivered",
  "failed",
  "cancelled",
  "superseded",
]);

export const supplierEvidenceRequestParamsSchema = z
  .object({ requestId: z.uuid() })
  .strict();
export const supplierEvidenceRevisionParamsSchema = z
  .object({ requestId: z.uuid(), revisionId: z.uuid() })
  .strict();
export const supplierEvidencePortalSubmissionParamsSchema = z
  .object({ versionId: z.uuid() })
  .strict();
export const supplierEvidenceSbomItemParamsSchema = z
  .object({ checklistItemId: z.uuid() })
  .strict();
export const supplierEvidenceSbomCompletionParamsSchema = z
  .object({ checklistItemId: z.uuid(), sourceId: z.uuid() })
  .strict();
export const supplierEvidenceSubmissionParamsSchema = z
  .object({ requestId: z.uuid(), submissionId: z.uuid() })
  .strict();
export const supplierEvidenceInvitationParamsSchema = z
  .object({ requestId: z.uuid(), invitationId: z.uuid() })
  .strict();
export const supplierEvidenceReminderDeliveryParamsSchema = z
  .object({ requestId: z.uuid(), deliveryId: z.uuid() })
  .strict();

export const supplierEvidenceReminderSettingsInputSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    offsetsHours: supplierEvidenceReminderOffsetsSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const retrySupplierEvidenceReminderDeliveryInputSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

const supplierEvidenceEvidenceChecklistItemInputSchema = z
  .object({
    title: safeText(160),
    instructions: safeText(2_000).optional(),
    documentClass: evidenceDocumentClassSchema,
    kind: z.literal("evidence").default("evidence"),
    supplierSbomRequestId: z.null().default(null),
  })
  .strict();

const supplierEvidenceSbomChecklistItemInputSchema = z
  .object({
    title: safeText(160),
    instructions: safeText(2_000).optional(),
    documentClass: z.literal("sbom"),
    kind: z.literal("sbom"),
    supplierSbomRequestId: z.uuid(),
  })
  .strict();

export const supplierEvidenceChecklistItemInputSchema = z.union([
  supplierEvidenceEvidenceChecklistItemInputSchema,
  supplierEvidenceSbomChecklistItemInputSchema,
]);

const requestContentSchema = z
  .object({
    title: safeText(160),
    instructions: safeText(10_000).optional(),
    dueAt: timestamp,
    disclosureContent: safeText(10_000).optional(),
    items: z.array(supplierEvidenceChecklistItemInputSchema).min(1).max(25),
  })
  .strict();

export const createSupplierEvidenceRequestInputSchema = requestContentSchema
  .extend({
    supplierId: z.uuid(),
    productId: z.uuid(),
    recipientContactId: z.uuid(),
    ownerUserId: z.uuid(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const previewSupplierEvidenceRequestInputSchema = requestContentSchema
  .extend({
    supplierId: z.uuid(),
    productId: z.uuid(),
    recipientContactId: z.uuid(),
    ownerUserId: z.uuid(),
  })
  .strict();

export const reviseSupplierEvidenceRequestInputSchema = requestContentSchema
  .extend({
    supplierId: z.uuid(),
    productId: z.uuid(),
    recipientContactId: z.uuid(),
    ownerUserId: z.uuid(),
    expectedVersion: z.number().int().nonnegative(),
    previewFingerprint: fingerprint,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const issueSupplierEvidenceRequestInputSchema = z
  .object({
    revisionId: z.uuid(),
    expectedVersion: z.number().int().nonnegative(),
    previewFingerprint: fingerprint,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const reissueSupplierEvidenceRequestInputSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    previewFingerprint: fingerprint,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const revokeSupplierEvidenceRequestInputSchema = z
  .object({
    invitationId: z.uuid(),
    reason: safeText(1_000),
    expectedVersion: z.number().int().nonnegative(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const closeSupplierEvidenceRequestInputSchema = z
  .object({
    reason: safeText(1_000),
    expectedVersion: z.number().int().nonnegative(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const reviewSupplierEvidenceSubmissionInputSchema = z
  .object({
    expectedRequestVersion: z.number().int().nonnegative(),
    expectedSubmissionUpdatedAt: timestamp,
    expectedEvidenceVersionId: z.uuid(),
    expectedSha256: sha256,
    decision: z.enum(["accept", "reject"]),
    supplierVisibleReason: safeText(500).optional(),
    internalNote: safeText(2_000).optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.decision === "reject" && !value.supplierVisibleReason) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["supplierVisibleReason"],
        message: "A supplier-visible rejection reason is required.",
      });
    }
    if (value.decision === "accept" && value.supplierVisibleReason) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["supplierVisibleReason"],
        message: "Supplier-visible reason is only allowed for rejection.",
      });
    }
  });

const reRequestChecklistItemSchema = z.union([
  supplierEvidenceEvidenceChecklistItemInputSchema
    .extend({ sourceRequestItemId: z.uuid() })
    .strict(),
  supplierEvidenceSbomChecklistItemInputSchema
    .extend({ sourceRequestItemId: z.uuid() })
    .strict(),
]);

export const reRequestSupplierEvidenceRequestInputSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    dueAt: timestamp,
    items: z.array(reRequestChecklistItemSchema).min(1).max(25),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict()
  .superRefine((value, context) => {
    const sourceIds = new Set<string>();
    for (const [index, item] of value.items.entries()) {
      if (sourceIds.has(item.sourceRequestItemId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items", index, "sourceRequestItemId"],
          message: "Each follow-up item must have a unique source item.",
        });
      }
      sourceIds.add(item.sourceRequestItemId);
    }
  });

export const markSupplierEvidenceInvitationDeliveryInputSchema = z
  .object({
    status: z.enum(["delivered", "failed"]),
    failureMessage: safeText(1_000).optional(),
    expectedRequestVersion: z.number().int().nonnegative(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "failed" && !value.failureMessage) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["failureMessage"],
        message: "A delivery failure message is required.",
      });
    }
  });

export const supplierEvidenceRequestListQuerySchema = z
  .object({
    productId: z.uuid().optional(),
    supplierId: z.uuid().optional(),
    state: supplierEvidenceRequestStateSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.uuid().optional(),
  })
  .strict();

/** Internal selector; the API still scopes every lookup to the verified organization. */
export const supplierEvidenceEligibleSbomRequestsQuerySchema = z
  .object({
    productId: z.uuid(),
    supplierId: z.uuid(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().trim().min(1).max(512).optional(),
  })
  .strict();

export const supplierEvidenceEligibleSbomRequestSchema = z
  .object({
    id: z.uuid(),
    releaseId: z.uuid(),
    supplierDisplayName: safeText(256),
    allowedComponentRef: safeText(512),
    expiresAt: timestamp,
  })
  .strict();

export const supplierEvidenceEligibleSbomRequestsResponseSchema = z
  .object({
    requests: z.array(supplierEvidenceEligibleSbomRequestSchema).max(100),
    nextCursor: z.string().trim().min(1).max(512).nullable(),
  })
  .strict();

export const supplierEvidenceMetricsQuerySchema = z
  .object({
    from: timestamp,
    to: timestamp,
    productId: z.uuid().optional(),
    supplierId: z.uuid().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.from) >= Date.parse(value.to)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["from"],
        message: "Metrics window start must precede its end",
      });
    }
  });

export const supplierEvidenceOverdueListQuerySchema = z
  .object({
    productId: z.uuid().optional(),
    supplierId: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().trim().min(1).max(512).optional(),
  })
  .strict();

const supplierEvidenceChecklistItemBaseSchema = z
  .object({
    id: z.uuid(),
    title: safeText(160),
    instructions: safeText(2_000).nullable(),
    documentClass: supplierEvidenceDocumentClassSchema,
    kind: z.enum(["evidence", "sbom"]).default("evidence"),
    supplierSbomRequestId: z.uuid().nullable().default(null),
    position: z.number().int().nonnegative(),
  })
  .strict();

const assertChecklistItemKind = (
  value: {
    kind: "evidence" | "sbom";
    supplierSbomRequestId: string | null;
    documentClass: string;
  },
  context: z.RefinementCtx,
) => {
  if (value.kind === "sbom" && !value.supplierSbomRequestId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["supplierSbomRequestId"],
      message: "An SBOM item must link to a supplier SBOM request",
    });
  }
  if (value.kind === "evidence" && value.supplierSbomRequestId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["supplierSbomRequestId"],
      message: "An evidence item cannot link to an SBOM request",
    });
  }
  if (value.kind === "sbom" && value.documentClass !== "sbom") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["documentClass"],
      message: "An SBOM item uses the sbom document class",
    });
  }
  if (value.kind === "evidence" && value.documentClass === "sbom") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["documentClass"],
      message: "An evidence item cannot use the sbom document class",
    });
  }
};

export const supplierEvidenceChecklistItemSchema =
  supplierEvidenceChecklistItemBaseSchema.superRefine(assertChecklistItemKind);

export const supplierEvidenceRevisionSchema = z
  .object({
    id: z.uuid(),
    revisionNumber: z.number().int().positive(),
    title: safeText(160),
    instructions: safeText(10_000).nullable(),
    dueAt: timestamp,
    disclosureContent: safeText(10_000).nullable(),
    disclosureFingerprint: fingerprint,
    items: z.array(supplierEvidenceChecklistItemSchema).max(25),
    createdAt: timestamp,
    createdBy: z.uuid(),
  })
  .strict();

export const supplierEvidenceInvitationSchema = z
  .object({
    id: z.uuid(),
    state: supplierEvidenceInvitationStateSchema,
    expiresAt: timestamp,
    issuedAt: timestamp,
    revokedAt: timestamp.nullable(),
    revisionId: z.uuid(),
    deliveryState: supplierEvidenceInvitationDeliveryStateSchema,
    deliveryAttemptCount: z.number().int().nonnegative(),
    deliveryError: safeText(1_000).nullable(),
    deliveryFailureMessage: safeText(1_000).nullable(),
    deliveredAt: timestamp.nullable(),
  })
  .strict();

export const supplierEvidenceReminderSettingsSchema = z
  .object({
    version: z.number().int().nonnegative(),
    offsetsHours: supplierEvidenceReminderOffsetsSchema,
  })
  .strict();

/** Internal-only delivery projection. It deliberately contains no raw bearer or recipient address. */
export const supplierEvidenceReminderDeliverySchema = z
  .object({
    id: z.uuid(),
    requestId: z.uuid(),
    revisionId: z.uuid(),
    dueAt: timestamp,
    offsetHours: supplierEvidenceReminderOffsetHoursSchema,
    recipient: supplierEvidenceReminderRecipientSchema,
    kind: supplierEvidenceReminderKindSchema,
    state: supplierEvidenceReminderDeliveryStateSchema,
    attemptCount: z.number().int().nonnegative(),
    nextAttemptAt: timestamp.nullable(),
    leasedUntil: timestamp.nullable(),
    failureMessage: safeText(1_000).nullable(),
    invitationId: z.uuid().nullable(),
    deliveredAt: timestamp.nullable(),
    version: z.number().int().nonnegative(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();

const supplierEvidenceRateSchema = z
  .object({
    numerator: z.number().int().nonnegative(),
    denominator: z.number().int().nonnegative(),
    value: z.number().min(0).max(1).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const mustBeUnavailable = value.denominator === 0;
    if (mustBeUnavailable !== (value.value === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "A rate is unavailable exactly when its denominator is zero",
      });
    }
    if (value.numerator > value.denominator) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["numerator"],
        message: "A rate numerator cannot exceed its denominator",
      });
    }
  });

export const supplierEvidenceMetricsSummarySchema = z
  .object({
    from: timestamp,
    to: timestamp,
    outstandingCount: z.number().int().nonnegative(),
    overdueCount: z.number().int().nonnegative(),
    firstSubmissionResponseRate: supplierEvidenceRateSchema,
    acceptedCompletionRate: supplierEvidenceRateSchema,
    averageFirstSubmissionTurnaroundHours: z.number().nonnegative().nullable(),
    turnaroundSampleCount: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.turnaroundSampleCount === 0) !==
      (value.averageFirstSubmissionTurnaroundHours === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["averageFirstSubmissionTurnaroundHours"],
        message:
          "Average turnaround is unavailable exactly when no turnaround samples exist",
      });
    }
  });

export const supplierEvidenceOverdueRowSchema = z
  .object({
    requestId: z.uuid(),
    revisionId: z.uuid(),
    supplierId: z.uuid(),
    productId: z.uuid(),
    requestTitle: safeText(160),
    supplierDisplayName: safeText(200),
    dueAt: timestamp,
    daysOverdue: z.number().int().positive(),
    state: supplierEvidenceAggregateReviewStateSchema,
    latestDelivery: supplierEvidenceReminderDeliverySchema.nullable(),
  })
  .strict();

export const supplierEvidenceSubmissionReviewSchema = z
  .object({
    id: z.uuid(),
    submissionId: z.uuid(),
    checklistItemId: z.uuid(),
    decision: supplierEvidenceReviewDecisionSchema,
    supplierVisibleReason: safeText(500).nullable(),
    internalNote: safeText(2_000).nullable(),
    reviewerUserId: z.uuid(),
    reviewedByUserId: z.uuid(),
    reviewedAt: timestamp,
    createdAt: timestamp,
    requestVersion: z.number().int().nonnegative(),
    submissionUpdatedAt: timestamp,
    evidenceDocumentId: z.uuid(),
    evidenceVersionId: z.uuid(),
    sha256,
    evidenceSha256: sha256,
  })
  .strict();

export const supplierEvidenceInternalSubmissionSchema = z
  .object({
    id: z.uuid(),
    checklistItemId: z.uuid(),
    revisionId: z.uuid(),
    state: supplierEvidenceSubmissionStateSchema,
    fileName: safeEvidenceFileNameSchema,
    mediaType: supplierEvidenceUploadMediaTypeSchema,
    byteSize: z.number().int().nonnegative().max(EVIDENCE_MAX_UPLOAD_BYTES),
    sha256,
    evidenceDocumentId: z.uuid(),
    evidenceVersionId: z.uuid(),
    evidenceProcessingState: z.enum([
      "uploading",
      "scan_pending",
      "clean",
      "quarantined",
      "failed",
    ]),
    processingState: z.enum([
      "uploading",
      "scan_pending",
      "clean",
      "quarantined",
      "failed",
    ]),
    reviewState: supplierEvidenceSubmissionReviewStateSchema.nullable(),
    rejectionReason: safeText(500).nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
    reviews: z.array(supplierEvidenceSubmissionReviewSchema),
  })
  .strict();

export const supplierEvidenceReviewItemSchema =
  supplierEvidenceChecklistItemSchema
    .safeExtend({
      sourceRequestItemId: z.uuid().nullable(),
      reRequestReason: safeText(500).nullable(),
      state: supplierEvidenceChecklistReviewStateSchema,
      submissions: z.array(supplierEvidenceInternalSubmissionSchema),
    })
    .strict();

export const supplierEvidenceRequestSummarySchema = z
  .object({
    id: z.uuid(),
    supplierId: z.uuid(),
    productId: z.uuid(),
    recipientContactId: z.uuid(),
    ownerUserId: z.uuid(),
    state: supplierEvidenceRequestStateSchema,
    version: z.number().int().nonnegative(),
    currentRevision: supplierEvidenceRevisionSchema,
    activeInvitation: supplierEvidenceInvitationSchema.nullable(),
    reviewState: supplierEvidenceAggregateReviewStateSchema,
    aggregateReviewState: supplierEvidenceAggregateReviewStateSchema,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();

export const supplierEvidenceRequestDetailSchema =
  supplierEvidenceRequestSummarySchema
    .extend({
      revisions: z.array(supplierEvidenceRevisionSchema),
      invitations: z.array(supplierEvidenceInvitationSchema),
    })
    .strict();

/** Reviewer-only projection. It intentionally contains internal notes and immutable evidence provenance. */
export const supplierEvidenceReviewRequestDetailSchema =
  supplierEvidenceRequestDetailSchema
    .extend({
      submissions: z.array(supplierEvidenceInternalSubmissionSchema),
      reviewItems: z.array(supplierEvidenceReviewItemSchema),
      reviews: z.array(supplierEvidenceSubmissionReviewSchema),
    })
    .strict();

export const supplierEvidenceRequestResponseSchema = z
  .object({ request: supplierEvidenceRequestDetailSchema })
  .strict();
export const supplierEvidenceReminderSettingsResponseSchema = z
  .object({ settings: supplierEvidenceReminderSettingsSchema })
  .strict();
export const supplierEvidenceReminderDeliveryResponseSchema = z
  .object({ delivery: supplierEvidenceReminderDeliverySchema })
  .strict();
export const supplierEvidenceMetricsResponseSchema = z
  .object({ summary: supplierEvidenceMetricsSummarySchema })
  .strict();
export const supplierEvidenceOverdueListResponseSchema = z
  .object({
    overdue: z.array(supplierEvidenceOverdueRowSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export const supplierEvidenceRequestsResponseSchema = z
  .object({
    requests: z.array(supplierEvidenceRequestSummarySchema),
    nextCursor: z.string().nullable(),
  })
  .strict();

/** The disclosure preview mirrors supplier-visible fields, never the internal M3 request ID. */
export const supplierEvidencePreviewChecklistItemSchema = z
  .object({
    id: z.uuid(),
    title: safeText(160),
    instructions: safeText(2_000).nullable(),
    documentClass: supplierEvidenceDocumentClassSchema,
    kind: z.enum(["evidence", "sbom"]).default("evidence"),
    position: z.number().int().nonnegative(),
    allowedComponentRef: safeText(512).nullable().default(null),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.kind === "sbom") !== (value.allowedComponentRef !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allowedComponentRef"],
        message: "Only an SBOM item displays a component reference",
      });
    }
    if ((value.kind === "sbom") !== (value.documentClass === "sbom")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["documentClass"],
        message: "SBOM item kind and document class must match",
      });
    }
  });

export const supplierEvidencePreviewSchema = z
  .object({
    fingerprint,
    portalPayload: z
      .object({
        title: safeText(160),
        instructions: safeText(10_000).nullable(),
        disclosureContent: safeText(10_000).nullable(),
        dueAt: timestamp,
        items: z.array(supplierEvidencePreviewChecklistItemSchema),
      })
      .strict(),
  })
  .strict();
export const supplierEvidencePreviewResponseSchema = z
  .object({ preview: supplierEvidencePreviewSchema })
  .strict();

export const supplierEvidenceIssuedResponseSchema = z
  .object({
    request: supplierEvidenceRequestDetailSchema,
    invitation: supplierEvidenceInvitationSchema,
  })
  .strict();

export const supplierEvidenceReviewResponseSchema = z
  .object({ request: supplierEvidenceReviewRequestDetailSchema })
  .strict();

export const supplierEvidencePortalSessionInputSchema = z
  .object({
    invitationToken: token,
  })
  .strict();

export const supplierEvidencePortalSubmissionSchema = z
  .object({
    id: z.uuid(),
    checklistItemId: z.uuid(),
    state: supplierEvidenceSubmissionStateSchema,
    fileName: safeEvidenceFileNameSchema,
    mediaType: supplierEvidenceUploadMediaTypeSchema,
    byteSize: z.number().int().nonnegative().max(EVIDENCE_MAX_UPLOAD_BYTES),
    sha256,
    rejectionReason: safeText(500).nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();

/** Supplier portal projection intentionally exposes only the safe re-request rationale. */
export const supplierEvidencePortalSbomSubmissionSchema =
  supplierSbomPortalSubmissionSchema.pick({
    id: true,
    state: true,
    fileName: true,
    validationMessage: true,
    createdAt: true,
    updatedAt: true,
  });

export const supplierEvidencePortalChecklistItemSchema = z
  .object({
    id: z.uuid(),
    title: safeText(160),
    instructions: safeText(2_000).nullable(),
    documentClass: supplierEvidenceDocumentClassSchema,
    kind: z.enum(["evidence", "sbom"]).default("evidence"),
    position: z.number().int().nonnegative(),
    reRequestReason: safeText(500).nullable(),
    sbom: z
      .object({
        allowedComponentRef: safeText(512),
        submission: supplierEvidencePortalSbomSubmissionSchema.nullable(),
      })
      .strict()
      .nullable()
      .default(null),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.kind === "sbom") !== (value.sbom !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sbom"],
        message: "SBOM details are available only for an SBOM item",
      });
    }
    if ((value.kind === "sbom") !== (value.documentClass === "sbom")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["documentClass"],
        message: "SBOM item kind and document class must match",
      });
    }
  });

export const supplierEvidencePortalRequestSchema = z
  .object({
    requestReference: z.string().trim().min(8).max(120),
    title: safeText(160),
    instructions: safeText(10_000).nullable(),
    disclosureContent: safeText(10_000).nullable(),
    dueAt: timestamp,
    items: z.array(supplierEvidencePortalChecklistItemSchema),
    submissions: z.array(supplierEvidencePortalSubmissionSchema),
  })
  .strict();

export const supplierEvidencePortalSessionSchema = z
  .object({
    sessionToken: token,
    expiresAt: timestamp,
    request: supplierEvidencePortalRequestSchema,
  })
  .strict();
export const supplierEvidencePortalSessionResponseSchema = z
  .object({ session: supplierEvidencePortalSessionSchema })
  .strict();

export const initializeSupplierEvidencePortalUploadInputSchema = z
  .object({
    sessionToken: token,
    checklistItemId: z.uuid(),
    fileName: safeEvidenceFileNameSchema,
    mediaType: supplierEvidenceUploadMediaTypeSchema,
    byteSize: z.number().int().positive().max(EVIDENCE_MAX_UPLOAD_BYTES),
    sha256,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const supplierEvidenceUploadSchema = z
  .object({ uploadUrl: z.string().url().max(4096), expiresAt: timestamp })
  .strict();
export const supplierEvidencePortalUploadInitializationResponseSchema = z
  .object({
    submission: supplierEvidencePortalSubmissionSchema,
    versionId: z.uuid(),
    upload: supplierEvidenceUploadSchema,
  })
  .strict();
export const completeSupplierEvidencePortalUploadInputSchema = z
  .object({ sessionToken: token, idempotencyKey: idempotencyKeySchema })
  .strict();
export const supplierEvidencePortalUploadCompletionResponseSchema = z
  .object({ submission: supplierEvidencePortalSubmissionSchema })
  .strict();

/** M9 routes retain M3's exact upload rules and do not accept tenant/product scope. */
export const initializeSupplierEvidenceSbomUploadInputSchema =
  initializeSupplierSbomUploadInputSchema;
export const completeSupplierEvidenceSbomUploadInputSchema =
  completeSupplierSbomUploadInputSchema;

export const supplierEvidenceSbomUploadInitializationResponseSchema = z
  .object({
    sourceId: z.uuid(),
    submission: supplierEvidencePortalSbomSubmissionSchema,
    upload: supplierSbomUploadInstructionSchema,
  })
  .strict();

export const supplierEvidenceSbomUploadCompletionResponseSchema = z
  .object({ submission: supplierEvidencePortalSbomSubmissionSchema })
  .strict();
