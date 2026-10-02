import { z } from "zod";

import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";
import {
  frameworkPackKeySchema,
  frameworkPackRequirementSchema,
  frameworkVersionKeySchema,
  validateFrameworkRequirements,
} from "./framework.schema.js";

const plainText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine(
      (value) => !/[\p{Cc}\p{Cf}]/u.test(value) && !/<[^>]+>/u.test(value),
      "Control characters and HTML markup are not allowed",
    );

export const customFrameworkContentSchema = z
  .object({
    title: plainText(300),
    editionDate: z.iso.date(),
    language: z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/),
    attribution: plainText(1_000),
    sourceUrl: z.url().startsWith("https://").max(2_048).optional(),
    requirements: z.array(frameworkPackRequirementSchema).min(1).max(1_000),
  })
  .strict()
  .superRefine((content, context) => {
    if (JSON.stringify(content).length > 2_097_152) {
      context.addIssue({ code: "custom", message: "Pack exceeds 2 MB" });
    }
    validateFrameworkRequirements(content.requirements, context);
  });

/** Portable file format. Pack identity is always allocated by the destination server. */
export const customFrameworkImportSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("customer_defined"),
    content: customFrameworkContentSchema,
  })
  .strict();

export const customFrameworkParamsSchema = z
  .object({
    draftId: z.uuid(),
  })
  .strict();

export const customFrameworkExportQuerySchema = z
  .object({
    versionKey: frameworkVersionKeySchema.optional(),
  })
  .strict();

export const customFrameworkListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict();

const commandBase = z.object({ idempotencyKey: idempotencyKeySchema }).strict();
export const customFrameworkCommandInputSchema = z.discriminatedUnion(
  "action",
  [
    commandBase.extend({
      action: z.literal("create_draft"),
      content: customFrameworkContentSchema,
    }),
    commandBase.extend({
      action: z.literal("save_draft"),
      expectedRevision: z.number().int().min(1),
      content: customFrameworkContentSchema,
    }),
    commandBase.extend({
      action: z.literal("publish_version"),
      expectedRevision: z.number().int().min(1),
    }),
    commandBase.extend({
      action: z.literal("archive_draft"),
      expectedRevision: z.number().int().min(1),
    }),
    commandBase.extend({
      action: z.literal("restore_draft"),
      expectedRevision: z.number().int().min(1),
    }),
  ],
);

export const customFrameworkStatusSchema = z.enum([
  "draft",
  "published",
  "update_available",
  "archived",
]);

export const customFrameworkSummarySchema = z
  .object({
    draftId: z.uuid(),
    packKey: frameworkPackKeySchema,
    title: plainText(300),
    status: customFrameworkStatusSchema,
    revision: z.number().int().min(1),
    latestVersionKey: z.string().nullable(),
    selectedVersionKey: z.string().nullable(),
    contentHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    archivedAt: z.iso.datetime({ offset: true }).nullable(),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const customFrameworkListResponseSchema = z
  .object({
    items: z.array(customFrameworkSummarySchema).max(50),
    nextOffset: z.number().int().min(0).nullable(),
  })
  .strict();

export const customFrameworkDetailResponseSchema =
  customFrameworkSummarySchema.extend({
    content: customFrameworkContentSchema,
  });

export const customFrameworkCommandResponseSchema =
  customFrameworkSummarySchema;

export const customFrameworkValidationResponseSchema = z
  .object({
    valid: z.boolean(),
    errors: z
      .array(z.object({ path: z.string(), message: z.string() }).strict())
      .max(1_000),
  })
  .strict();

// Dry runs must accept structurally invalid imports so the server can return
// field errors, but the transport may only send serializable JSON values.
export const customFrameworkValidationInputSchema = z.json();
