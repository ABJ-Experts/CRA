import { z } from "zod";

import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";
import {
  frameworkPackKeySchema,
  frameworkRequirementKeySchema,
  frameworkRequirementReferenceSchema,
  frameworkSelectionResponseSchema,
  frameworkVersionKeySchema,
} from "./framework.schema.js";

const uuid = z.uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (value) => !/[\p{Cc}\p{Cf}]/u.test(value) && !/<[^>]+>/u.test(value),
      "Control characters and HTML markup are not allowed",
    );
const page = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).max(256).optional(),
  })
  .strict();
const reviewId = z
  .object({
    packKey: frameworkPackKeySchema,
    reviewId: uuid,
  })
  .strict();

export const curatedFrameworkRelationSchema = z
  .object({
    id: uuid,
    source: frameworkRequirementReferenceSchema,
    target: frameworkRequirementReferenceSchema,
    relationship: z.enum([
      "equivalent",
      "partial",
      "supports",
      "related",
      "uncertain",
    ]),
    direction: z.enum(["one_way", "bidirectional"]),
    rationale: text(2_000),
    provenance: text(2_000),
    reviewer: text(200),
    reviewedAt: z.iso.datetime({ offset: true }),
    curated: z.literal(true),
  })
  .strict();

export const frameworkCrosswalkParamsSchema = z
  .object({
    packKey: frameworkPackKeySchema,
    versionKey: frameworkVersionKeySchema,
  })
  .strict();
export const frameworkCrosswalkQuerySchema = page;
export const frameworkCrosswalkResponseSchema = z
  .object({
    relations: z.array(curatedFrameworkRelationSchema).max(100),
    nextCursor: z.string().min(1).max(256).nullable(),
  })
  .strict();

export const frameworkUpgradePreviewParamsSchema = z
  .object({
    packKey: frameworkPackKeySchema,
    targetVersionKey: frameworkVersionKeySchema,
  })
  .strict();
export const frameworkUpgradePreviewQuerySchema = page;
const diff = z
  .object({
    added: z.array(frameworkRequirementKeySchema).max(1_000),
    removed: z.array(frameworkRequirementKeySchema).max(1_000),
    changed: z.array(frameworkRequirementKeySchema).max(1_000),
    split: z.array(frameworkRequirementKeySchema).max(1_000),
    merged: z.array(frameworkRequirementKeySchema).max(1_000),
  })
  .strict();
export const frameworkUpgradeImpactSchema = z
  .object({
    mappingId: uuid,
    controlId: uuid,
    controlRevision: z.number().int().min(1),
    sourceRequirementKey: frameworkRequirementKeySchema,
    productIds: z.array(uuid).max(1_000),
    evidenceVersionIds: z.array(uuid).max(1_000),
    suggestedTargetKeys: z.array(frameworkRequirementKeySchema).max(1_000),
  })
  .strict();
export const frameworkUpgradePreviewResponseSchema = z
  .object({
    packKey: frameworkPackKeySchema,
    sourceVersionKey: frameworkVersionKeySchema,
    targetVersionKey: frameworkVersionKeySchema,
    selectionRevision: z.number().int().min(1),
    sourceHash: hash,
    targetHash: hash,
    fingerprint: hash,
    diff,
    impacts: z.array(frameworkUpgradeImpactSchema).max(100),
    nextCursor: z.string().min(1).max(256).nullable(),
    totalImpacts: z.number().int().min(0),
  })
  .strict();

export const frameworkUpgradeReviewParamsSchema = reviewId;
export const frameworkUpgradeReviewQuerySchema = page;
export const frameworkUpgradeDecisionParamsSchema = reviewId.extend({
  mappingId: uuid,
});
export const createFrameworkUpgradeReviewInputSchema = z
  .object({
    targetVersionKey: frameworkVersionKeySchema,
    expectedSelectionRevision: z.number().int().min(1),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
const reviewStatus = z.enum(["draft", "committed"]);
export const createFrameworkUpgradeReviewResponseSchema = z
  .object({
    reviewId: uuid,
    packKey: frameworkPackKeySchema,
    sourceVersionKey: frameworkVersionKeySchema,
    targetVersionKey: frameworkVersionKeySchema,
    revision: z.number().int().min(1),
    status: reviewStatus,
  })
  .strict();
export const frameworkUpgradeReviewResponseSchema =
  createFrameworkUpgradeReviewResponseSchema.extend({
    decisions: z
      .array(
        z
          .object({
            mappingId: uuid,
            action: z.enum(["map", "leave_gap"]),
            targetRequirementKeys: z
              .array(frameworkRequirementKeySchema)
              .max(1_000),
          })
          .strict(),
      )
      .max(100),
    nextCursor: z.string().min(1).max(256).nullable(),
  });
export const upsertFrameworkUpgradeDecisionInputSchema = z
  .object({
    action: z.enum(["map", "leave_gap"]),
    targetRequirementKeys: z.array(frameworkRequirementKeySchema).max(1_000),
    expectedReviewRevision: z.number().int().min(1),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.action === "map" && value.targetRequirementKeys.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Choose at least one target requirement",
      });
    }
    if (
      value.action === "leave_gap" &&
      value.targetRequirementKeys.length > 0
    ) {
      context.addIssue({
        code: "custom",
        message: "A gap cannot have target requirements",
      });
    }
    if (
      new Set(value.targetRequirementKeys).size !==
      value.targetRequirementKeys.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Duplicate target requirement",
      });
    }
  });
export const frameworkUpgradeDecisionResponseSchema = z
  .object({
    reviewId: uuid,
    revision: z.number().int().min(1),
  })
  .strict();
export const commitFrameworkUpgradeInputSchema = z
  .object({
    expectedReviewRevision: z.number().int().min(1),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const commitFrameworkUpgradeResponseSchema = z
  .object({
    reviewId: uuid,
    selection: frameworkSelectionResponseSchema,
    migratedCount: z.number().int().min(0),
    gapCount: z.number().int().min(0),
  })
  .strict();

export const frameworkCrosswalkEvidenceReuseParamsSchema = z
  .object({ evidenceVersionId: uuid })
  .strict();
export const frameworkCrosswalkEvidenceReuseQuerySchema = page.extend({
  productId: uuid,
});
export const frameworkCrosswalkEvidenceReuseResponseSchema = z
  .object({
    relations: z.array(curatedFrameworkRelationSchema).max(100),
    evidenceValid: z.boolean(),
    nextCursor: z.string().min(1).max(256).nullable(),
  })
  .strict();
