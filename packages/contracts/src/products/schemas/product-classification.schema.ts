import { z } from "zod";
import { pagedSchema } from "../../pagination/schemas/pagination.schema.js";
import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";

export const productClassificationSchema = z.enum([
  "default",
  "important_class_i",
  "important_class_ii",
  "critical",
  "out_of_scope",
  "undetermined",
]);
const matchSchema = z.enum(["yes", "no", "undetermined"]).nullable();
const sourceUrlSchema = z.url({ protocol: /^https$/ });
export const productClassificationAnswersSchema = z
  .object({
    scope: z.enum(["in_scope", "out_of_scope", "undetermined"]),
    criticalCoreFunction: matchSchema,
    classIICoreFunction: matchSchema,
    classICoreFunction: matchSchema,
  })
  .strict()
  .superRefine((answers, ctx) => {
    const visible = [
      answers.scope === "in_scope",
      answers.scope === "in_scope" && answers.criticalCoreFunction === "no",
      answers.scope === "in_scope" &&
        answers.criticalCoreFunction === "no" &&
        answers.classIICoreFunction === "no",
    ];
    (
      [
        "criticalCoreFunction",
        "classIICoreFunction",
        "classICoreFunction",
      ] as const
    ).forEach((key, index) => {
      if (visible[index] ? answers[key] === null : answers[key] !== null)
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: visible[index]
            ? "Answer this visible question."
            : "Skipped questions must be null.",
        });
    });
  });
export const productClassificationPolicySchema = z
  .object({
    version: z.string().min(1).max(100),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    effectiveDate: z.iso.date(),
    status: z.literal("engineering_provisional"),
    sourceRefs: z
      .array(
        z
          .object({ title: z.string().min(1).max(300), url: sourceUrlSchema })
          .strict(),
      )
      .min(1)
      .max(10),
    questions: z
      .array(
        z
          .object({
            key: z.enum([
              "scope",
              "criticalCoreFunction",
              "classIICoreFunction",
              "classICoreFunction",
            ]),
            prompt: z.string().min(1).max(1000),
            sourceRefs: z.array(sourceUrlSchema).min(1).max(10),
          })
          .strict(),
      )
      .length(4)
      .refine(
        (questions) =>
          new Set(questions.map((question) => question.key)).size === 4,
        "Each questionnaire key must occur exactly once.",
      ),
  })
  .strict();
export const saveProductClassificationInputSchema = z
  .object({
    expectedProductVersion: z.number().int().nonnegative(),
    expectedRevision: z.number().int().nonnegative(),
    policyVersion: z.string().min(1).max(100),
    policyHash: z.string().regex(/^[a-f0-9]{64}$/),
    idempotencyKey: idempotencyKeySchema,
    answers: productClassificationAnswersSchema,
    rationale: z.string().trim().min(1).max(4000),
  })
  .strict();
export const productClassificationRunSchema = z
  .object({
    id: z.uuid(),
    productId: z.uuid(),
    revision: z.number().int().positive(),
    productVersion: z.number().int().nonnegative(),
    classification: productClassificationSchema,
    answers: productClassificationAnswersSchema,
    rationale: z.string().min(1).max(4000),
    policySnapshot: productClassificationPolicySchema,
    policyHash: z.string().regex(/^[a-f0-9]{64}$/),
    createdBy: z.uuid(),
    createdAt: z.iso.datetime({ offset: true }),
    supersedesId: z.uuid().nullable(),
  })
  .strict()
  .refine((run) => run.policyHash === run.policySnapshot.hash, {
    path: ["policyHash"],
    message: "Policy hash must match the immutable snapshot.",
  });
export const productClassificationSummarySchema = z
  .object({
    classification: productClassificationSchema,
    revision: z.number().int().positive(),
    productVersion: z.number().int().nonnegative(),
    policyStatus: z.literal("engineering_provisional"),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export const productClassificationHistoryQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(15),
  })
  .strict();
export const productClassificationLatestQuerySchema = z
  .object({
    productIds: z
      .string()
      .max(3699)
      .transform((value) => value.split(","))
      .pipe(z.array(z.uuid()).min(1).max(100))
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Product IDs must be unique.",
      ),
  })
  .strict();
export const productClassificationPolicyResponseSchema = z
  .object({ policy: productClassificationPolicySchema })
  .strict();
export const saveProductClassificationResponseSchema = z
  .object({ run: productClassificationRunSchema })
  .strict();
export const productClassificationHistoryResponseSchema = z
  .object({
    latest: productClassificationRunSchema.nullable(),
    productVersion: z.number().int().nonnegative(),
    policy: productClassificationPolicySchema,
    runs: pagedSchema(productClassificationRunSchema),
  })
  .strict();
export const productClassificationsResponseSchema = z
  .object({
    classifications: z
      .array(
        z
          .object({
            productId: z.uuid(),
            latest: productClassificationSummarySchema.nullable(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
