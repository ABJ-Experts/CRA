import { utcZDateTimeSchema } from "../../products/schemas/release-market-lifecycle.schema.js";
import { z } from "zod";

const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);

export const externalIdentityEntityTypeSchema = z.enum(["product", "release"]);
export const externalIdentityMatchMethodSchema = z.enum([
  "exact_normalized_code",
  "exact_normalized_release_version",
  "manual_link",
  "manual_merge",
  "adapter_asserted_id",
]);
export const externalIdentityMatchConfidenceSchema = z.enum([
  "certain",
  "ambiguous_resolved",
]);

export const externalIdentityParamsSchema = z
  .object({ connectorId: z.uuid(), mappingId: z.uuid() })
  .strict();

export const productExternalIdentitySchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    connectorId: z.uuid(),
    entityType: externalIdentityEntityTypeSchema,
    externalId: requiredText(500),
    externalDisplayLabel: requiredText(500).nullable(),
    craProductId: z.uuid(),
    craReleaseId: z.uuid().nullable(),
    matchMethod: externalIdentityMatchMethodSchema,
    matchConfidence: externalIdentityMatchConfidenceSchema,
    linkedAt: utcZDateTimeSchema,
    linkedBy: z.uuid(),
    unlinkedAt: utcZDateTimeSchema.nullable(),
    unlinkedBy: z.uuid().nullable(),
    unlinkReason: requiredText(500).nullable(),
    version: z.number().int().positive(),
    createdAt: utcZDateTimeSchema,
    createdBy: z.uuid(),
    updatedAt: utcZDateTimeSchema,
    updatedBy: z.uuid(),
  })
  .strict()
  .superRefine((identity, context) => {
    if (
      (identity.entityType === "product") !==
      (identity.craReleaseId === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["craReleaseId"],
        message:
          "A release identity requires a release id; a product identity must not carry one",
      });
    }
    const unlinkFieldsSet = [
      identity.unlinkedAt !== null,
      identity.unlinkedBy !== null,
      identity.unlinkReason !== null,
    ];
    if (unlinkFieldsSet.some(Boolean) && !unlinkFieldsSet.every(Boolean)) {
      context.addIssue({
        code: "custom",
        path: ["unlinkedAt"],
        message:
          "Unlink timestamp, actor, and reason must be recorded together",
      });
    }
  });

export const unlinkExternalIdentityInputSchema = z
  .object({ reason: requiredText(500) })
  .strict();

export const mergeExternalIdentitiesInputSchema = z
  .object({
    keepMappingId: z.uuid(),
    mergeFromMappingId: z.uuid(),
    reason: requiredText(500),
  })
  .strict();

export const linkExternalIdentityInputSchema = z
  .object({
    entityType: externalIdentityEntityTypeSchema,
    externalId: requiredText(500),
    externalDisplayLabel: requiredText(500).optional(),
    craProductId: z.uuid(),
    craReleaseId: z.uuid().optional(),
    matchMethod: externalIdentityMatchMethodSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (
      (input.entityType === "product") !==
      (input.craReleaseId === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["craReleaseId"],
        message:
          "A release link requires a release id; a product link must not carry one",
      });
    }
  });
