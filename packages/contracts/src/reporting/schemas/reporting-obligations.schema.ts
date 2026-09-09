import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";
import { utcZDateTimeSchema } from "../../products/schemas/release-market-lifecycle.schema.js";
import { z } from "zod";

const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);
const utcSecondDateTimeSchema = utcZDateTimeSchema.regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
  "Use a UTC timestamp ending in Z with second precision",
);
const expectedVersionSchema = z.number().int().nonnegative();
const storedVersionSchema = z.number().int().positive();
const listLimitSchema = z.coerce.number().int().min(1).max(100).default(50);

export const reportingObligationTypeSchema = z.enum([
  "actively_exploited_vulnerability",
  "severe_incident",
]);

export const reportingObligationStatusSchema = z.enum([
  "active",
  "completed",
  "cancelled",
]);

export const reportingObligationStageKindSchema = z.enum([
  "early_warning",
  "notification",
  "final_report",
]);

export const reportingObligationAnchorKindSchema = z.enum([
  "awareness",
  "remediation_available",
  "notification_submitted",
]);

export const reportingObligationStageStateSchema = z.enum([
  "pending_anchor",
  "running",
  "submitted",
  "overdue",
  "not_required",
]);

export const reportingDurationSchema = z.enum([
  "PT24H",
  "PT72H",
  "P14D",
  "P1M",
]);

export const reportingObligationSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("manual") }).strict(),
  z.object({ kind: z.literal("finding"), findingId: z.uuid() }).strict(),
]);

export const reportingActorSnapshotSchema = z
  .object({
    userId: z.uuid(),
    displayName: requiredText(200),
  })
  .strict();

export const reportingRuleSetSnapshotSchema = z
  .object({
    id: z.uuid(),
    version: storedVersionSchema,
    jurisdiction: z.literal("EU-CRA"),
    effectiveFrom: utcSecondDateTimeSchema,
    effectiveTo: utcSecondDateTimeSchema.nullable(),
  })
  .strict();

export const createReportingObligationInputSchema = z
  .object({
    type: reportingObligationTypeSchema,
    source: reportingObligationSourceSchema,
    awarenessAt: utcSecondDateTimeSchema,
    awarenessBasis: requiredText(4_000),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const correctReportingObligationAnchorInputSchema = z
  .object({
    anchor: reportingObligationAnchorKindSchema,
    anchorAt: utcSecondDateTimeSchema,
    basis: requiredText(4_000).optional(),
    reason: requiredText(4_000),
    expectedVersion: expectedVersionSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (input.anchor === "awareness" && input.basis === undefined) {
      context.addIssue({
        code: "custom",
        path: ["basis"],
        message: "Awareness corrections require an awareness basis",
      });
    }
    if (input.anchor !== "awareness" && input.basis !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["basis"],
        message: "Only awareness corrections carry a basis",
      });
    }
  });

export const recordReportingObligationStageSubmissionInputSchema = z
  .object({
    stage: reportingObligationStageKindSchema,
    submittedAt: utcSecondDateTimeSchema,
    submissionReference: requiredText(1_000),
    expectedVersion: expectedVersionSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const cancelReportingObligationInputSchema = z
  .object({
    reason: requiredText(4_000),
    expectedVersion: expectedVersionSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const reportingObligationParamsSchema = z
  .object({ obligationId: z.uuid() })
  .strict();

export const reportingObligationListQuerySchema = z
  .object({
    cursor: z.string().trim().min(1).max(1_000).optional(),
    limit: listLimitSchema,
    type: reportingObligationTypeSchema.optional(),
    status: reportingObligationStatusSchema.optional(),
    findingId: z.uuid().optional(),
  })
  .strict();

export const reportingObligationStageSchema = z
  .object({
    id: z.uuid(),
    kind: reportingObligationStageKindSchema,
    anchor: reportingObligationAnchorKindSchema,
    duration: reportingDurationSchema,
    state: reportingObligationStageStateSchema,
    dueAt: utcSecondDateTimeSchema.nullable(),
    submittedAt: utcSecondDateTimeSchema.nullable(),
    overdueAt: utcSecondDateTimeSchema.nullable(),
    version: storedVersionSchema,
  })
  .strict()
  .superRefine((stage, context) => {
    if (stage.state === "pending_anchor" && stage.dueAt !== null) {
      context.addIssue({
        code: "custom",
        path: ["dueAt"],
        message: "Pending-anchor stages cannot expose a due date",
      });
    }
    if (stage.state === "submitted" && stage.submittedAt === null) {
      context.addIssue({
        code: "custom",
        path: ["submittedAt"],
        message: "Submitted stages require a submitted timestamp",
      });
    }
    if (stage.state === "overdue" && stage.overdueAt === null) {
      context.addIssue({
        code: "custom",
        path: ["overdueAt"],
        message: "Overdue stages require an overdue timestamp",
      });
    }
  });

export const reportingObligationAnchorEventSchema = z
  .object({
    kind: reportingObligationAnchorKindSchema,
    anchoredAt: utcSecondDateTimeSchema,
    basis: requiredText(4_000).nullable(),
    reason: requiredText(4_000).nullable(),
    recordedBy: reportingActorSnapshotSchema,
    recordedAt: utcSecondDateTimeSchema,
  })
  .strict();

const reportingObligationBaseSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    type: reportingObligationTypeSchema,
    status: reportingObligationStatusSchema,
    source: reportingObligationSourceSchema,
    ruleSet: reportingRuleSetSnapshotSchema,
    awarenessAt: utcSecondDateTimeSchema,
    awarenessBasis: requiredText(4_000),
    createdBy: reportingActorSnapshotSchema,
    createdAt: utcSecondDateTimeSchema,
    updatedAt: utcSecondDateTimeSchema,
    version: storedVersionSchema,
    cancelledAt: utcSecondDateTimeSchema.nullable(),
    cancellationReason: requiredText(4_000).nullable(),
    stages: z.array(reportingObligationStageSchema).min(3).max(3),
    anchors: z.array(reportingObligationAnchorEventSchema).min(1).max(100),
  })
  .strict();

function refineReportingObligation(
  obligation: z.output<typeof reportingObligationBaseSchema>,
  context: z.RefinementCtx,
) {
  const final = obligation.stages.find(
    (stage) => stage.kind === "final_report",
  );
  const expectedFinalAnchor =
    obligation.type === "actively_exploited_vulnerability"
      ? "remediation_available"
      : "notification_submitted";
  if (final?.anchor !== expectedFinalAnchor) {
    context.addIssue({
      code: "custom",
      path: ["stages"],
      message: "Final report anchor must match the obligation type",
    });
  }
  const cancelled = obligation.status === "cancelled";
  if (cancelled !== (obligation.cancelledAt !== null)) {
    context.addIssue({
      code: "custom",
      path: ["cancelledAt"],
      message: "Cancelled obligations require a cancellation timestamp",
    });
  }
  if (cancelled !== (obligation.cancellationReason !== null)) {
    context.addIssue({
      code: "custom",
      path: ["cancellationReason"],
      message: "Cancelled obligations require a cancellation reason",
    });
  }
}

export const reportingObligationSchema =
  reportingObligationBaseSchema.superRefine(refineReportingObligation);

export const reportingObligationSummarySchema = reportingObligationBaseSchema
  .omit({ anchors: true })
  .strict()
  .superRefine((summary, context) =>
    refineReportingObligation({ ...summary, anchors: [] }, context),
  );

export const reportingObligationListResponseSchema = z
  .object({
    obligations: z.array(reportingObligationSummarySchema).max(100),
    nextCursor: z.string().trim().min(1).max(1_000).nullable(),
  })
  .strict();

export const reportingObligationDetailResponseSchema = z
  .object({
    obligation: reportingObligationSchema,
  })
  .strict();

export const reportingObligationMutationResponseSchema =
  reportingObligationDetailResponseSchema;
