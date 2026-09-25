import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";
import { z } from "zod";

import { productParamsSchema, releaseParamsSchema } from "./product.schema.js";
import { utcZDateTimeSchema } from "./release-market-lifecycle.schema.js";

const meaningfulText = (maximum: number) =>
  z.string().trim().min(1).max(maximum);
const expectedVersionSchema = z.number().int().nonnegative();

export const supportPeriodIdParamsSchema = z
  .object({ ...productParamsSchema.shape, supportPeriodId: z.uuid() })
  .strict();

export const productSupportPeriodSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    productId: z.uuid(),
    releaseId: z.uuid().nullable(),
    supportStartsAt: utcZDateTimeSchema,
    supportEndsAt: utcZDateTimeSchema,
    expectedLifetimeJustification: meaningfulText(4_000),
    decisionActorId: z.uuid(),
    effectiveAt: utcZDateTimeSchema,
    supersededAt: utcZDateTimeSchema.nullable(),
    supersededById: z.uuid().nullable(),
    scopeRevision: z.number().int().positive(),
    version: expectedVersionSchema,
    createdAt: utcZDateTimeSchema,
    createdBy: z.uuid(),
    updatedAt: utcZDateTimeSchema,
    updatedBy: z.uuid(),
  })
  .strict()
  .refine(
    ({ supersededAt, supersededById }) =>
      (supersededAt === null) === (supersededById === null),
    {
      message: "Supersession timestamp and successor must be recorded together",
      path: ["supersededById"],
    },
  );

const supportPeriodDatesSchema = z
  .object({
    supportStartsAt: utcZDateTimeSchema,
    supportEndsAt: utcZDateTimeSchema,
  })
  .strict()
  .refine(
    ({ supportStartsAt, supportEndsAt }) =>
      Date.parse(supportEndsAt) > Date.parse(supportStartsAt),
    {
      message: "Support period end must be after its start",
      path: ["supportEndsAt"],
    },
  );

export const createSupportPeriodRequestSchema = supportPeriodDatesSchema
  .extend({
    releaseId: z.uuid().optional(),
    expectedLifetimeJustification: meaningfulText(4_000),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict()
  .transform((value) => ({ ...value, releaseId: value.releaseId }));

const supportPeriodProposalSchema = supportPeriodDatesSchema.extend({
  expectedLifetimeJustification: meaningfulText(4_000),
});
export const previewSupportPeriodChangeRequestSchema = z
  .object({
    releaseId: z.uuid().nullable().optional(),
    expectedVersion: expectedVersionSchema,
    // Initial decisions have no predecessor; later changes carry a snapshot
    // that makes the preview digest explainable to the reviewer.
    current: supportPeriodProposalSchema.nullable(),
    proposed: supportPeriodProposalSchema,
  })
  .strict();

export const supersedeSupportPeriodRequestSchema = supportPeriodDatesSchema
  .extend({
    expectedLifetimeJustification: meaningfulText(4_000),
    expectedVersion: expectedVersionSchema,
    reason: meaningfulText(1_000),
    previewDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/i)
      .optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
  })
  .strict();

export const supportPeriodHistoryResponseSchema = z
  .object({ supportPeriods: z.array(productSupportPeriodSchema) })
  .strict();

export const supportPeriodChangePreviewSchema = z
  .object({
    // An initial decision has no active record yet. Keeping that explicit lets
    // callers preview a first support commitment without inventing history.
    current: productSupportPeriodSchema.nullable(),
    proposed: supportPeriodProposalSchema,
    lowering: z.boolean(),
    previewDigest: z.string().regex(/^[a-f0-9]{64}$/i),
    activeScopeRevision: z.number().int().nonnegative().optional(),
    isShortening: z.boolean().optional(),
    retentionProtectionWouldReduce: z.boolean().optional(),
    blockedReasons: z
      .array(
        z.enum([
          "active_legal_hold",
          "binding_legal_floor",
          "active_dependency",
        ]),
      )
      .optional(),
    affectedCategories: z
      .array(
        z.enum([
          "registered_evidence",
          "update_artifacts",
          "technical_file_content",
          "support_alerts",
          "retention_dates",
          "legal_floors",
        ]),
      )
      .optional(),
    currentRetentionUntil: utcZDateTimeSchema.nullable().optional(),
    proposedRetentionUntil: utcZDateTimeSchema.nullable().optional(),
  })
  .strict();

export const supportPeriodChangePreviewResponseSchema = z
  .object({ preview: supportPeriodChangePreviewSchema })
  .strict();
export const supportPeriodResponseSchema = z
  .object({ supportPeriod: productSupportPeriodSchema })
  .strict();

export const retentionStatusSchema = z.enum(["current", "incomplete"]);
export const retentionIncompleteReasonSchema = z.enum([
  "missing_placed_on_market_at",
  "missing_support_period",
  "missing_release",
]);
export const retentionWinningRuleSchema = z.enum([
  "placed_on_market_plus_10_calendar_years",
  "support_period_end",
  "equal",
]);

export const releaseRetentionCalculationSchema = z
  .object({
    releaseId: z.uuid(),
    ruleVersion: z.literal("m2.v1.later_of_placement_plus_10y_or_support_end"),
    status: retentionStatusSchema,
    placedOnMarketCandidate: utcZDateTimeSchema.nullable(),
    supportPeriodCandidate: utcZDateTimeSchema.nullable(),
    retentionUntil: utcZDateTimeSchema.nullable(),
    retentionProtectionUntil: utcZDateTimeSchema.nullable(),
    winningRule: retentionWinningRuleSchema.nullable(),
    incompleteReasons: z.array(retentionIncompleteReasonSchema),
    legalHoldActive: z.boolean(),
  })
  .strict();

export const productRetentionCalculationSchema = z
  .object({
    ruleVersion: z.literal("m2.v1.later_of_placement_plus_10y_or_support_end"),
    status: retentionStatusSchema,
    placedOnMarketCandidate: utcZDateTimeSchema.nullable(),
    supportPeriodCandidate: utcZDateTimeSchema.nullable(),
    retentionUntil: utcZDateTimeSchema.nullable(),
    retentionProtectionUntil: utcZDateTimeSchema.nullable(),
    winningRule: retentionWinningRuleSchema.nullable(),
    incompleteReasons: z.array(retentionIncompleteReasonSchema),
    legalHoldActive: z.boolean(),
    releaseCalculations: z.array(releaseRetentionCalculationSchema),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.status === "current" &&
      (!value.placedOnMarketCandidate ||
        !value.supportPeriodCandidate ||
        !value.retentionUntil ||
        !value.retentionProtectionUntil ||
        !value.winningRule ||
        value.incompleteReasons.length !== 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Current retention requires all controlling facts",
      });
    }
    if (
      value.status === "incomplete" &&
      (value.placedOnMarketCandidate !== null ||
        value.supportPeriodCandidate !== null ||
        value.retentionUntil !== null ||
        value.winningRule !== null ||
        value.incompleteReasons.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Incomplete retention cannot expose a legal result",
      });
    }
  });
export const productRetentionResponseSchema = z
  .object({ retention: productRetentionCalculationSchema })
  .strict();

const supportAlertDaysSchema = z
  .array(z.coerce.number().int().min(1).max(3_650))
  .min(1)
  .max(12);
export const supportAlertIntervalsSchema = z
  .object({
    alertIntervalsDays: supportAlertDaysSchema.transform((values) =>
      [...new Set(values)].sort((left, right) => right - left),
    ),
    version: expectedVersionSchema,
    updatedAt: utcZDateTimeSchema,
    updatedBy: z.uuid().nullable(),
  })
  .strict();
export const updateSupportAlertIntervalsRequestSchema = z
  .object({
    alertIntervalsDays: supportAlertDaysSchema.refine(
      (values) => new Set(values).size === values.length,
      "Alert intervals must not contain duplicates",
    ),
    expectedVersion: expectedVersionSchema,
  })
  .strict();
export const supportAlertIntervalsResponseSchema = supportAlertIntervalsSchema;

export const supportAlertDeliveryStateSchema = z.enum([
  "pending",
  "scheduled",
  "leased",
  "delivered",
  "retrying",
  "dead_letter",
  "obsolete",
  "recipient_unavailable",
]);
export const supportAlertHistoryItemSchema = z
  .object({
    id: z.uuid(),
    supportPeriodId: z.uuid(),
    supportPeriodRevision: z.number().int().positive().optional(),
    releaseId: z.uuid().nullable().optional(),
    thresholdDays: z.number().int().positive(),
    dueAt: utcZDateTimeSchema,
    deliveredAt: utcZDateTimeSchema.nullable().optional(),
    deliveryState: supportAlertDeliveryStateSchema,
    missed: z.boolean(),
    obsolete: z.boolean(),
    attempts: z.number().int().nonnegative(),
    lastErrorCode: z.string().trim().min(1).max(100).nullable().optional(),
    createdAt: utcZDateTimeSchema.optional(),
  })
  .strict();
export const supportAlertHistoryResponseSchema = z
  .object({ alerts: z.array(supportAlertHistoryItemSchema) })
  .strict();

export type ProductSupportPeriod = z.output<typeof productSupportPeriodSchema>;
export type CreateSupportPeriodRequest = z.output<
  typeof createSupportPeriodRequestSchema
>;
export type PreviewSupportPeriodChangeRequest = z.output<
  typeof previewSupportPeriodChangeRequestSchema
>;
export type SupersedeSupportPeriodRequest = z.output<
  typeof supersedeSupportPeriodRequestSchema
>;
export type SupportPeriodChangePreview = z.output<
  typeof supportPeriodChangePreviewSchema
>;
export type ProductRetentionCalculation = z.output<
  typeof productRetentionCalculationSchema
>;
export type ReleaseRetentionCalculation = z.output<
  typeof releaseRetentionCalculationSchema
>;
export type SupportAlertIntervals = z.output<
  typeof supportAlertIntervalsResponseSchema
>;
export type UpdateSupportAlertIntervalsRequest = z.output<
  typeof updateSupportAlertIntervalsRequestSchema
>;
export type SupportAlertHistoryItem = z.output<
  typeof supportAlertHistoryItemSchema
>;

export const supportPeriodReleaseParamsSchema = releaseParamsSchema;
