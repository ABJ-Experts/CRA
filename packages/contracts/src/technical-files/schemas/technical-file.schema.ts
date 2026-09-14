import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";
import { productRetentionCalculationSchema } from "../../products/schemas/support-period-retention.schema.js";
import { z } from "zod";

const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);
const optionalText = (maximum: number) =>
  z.string().trim().max(maximum).nullable();
const expectedVersionSchema = z.number().int().positive();

export const technicalFileSectionKeySchema = z.enum([
  "general_description",
  "user_instructions",
  "design_development_production",
  "support_period_basis",
  "vulnerability_handling",
  "test_reports",
  "release_sbom",
  "standards_common_specifications",
]);

export const technicalFileSourceKindSchema = z.enum([
  "product",
  "release",
  "support_period",
  "sbom_document",
  "finding",
  "manual_reference",
]);
export const technicalFileSectionStatusSchema = z.enum([
  "incomplete",
  "complete",
  "stale",
  "unavailable",
  "not_applicable",
]);

export const technicalFileSourceSchema = z
  .object({
    id: z.uuid(),
    kind: technicalFileSourceKindSchema,
    recordId: z.uuid().nullable(),
    observedRevision: z.string().trim().min(1).max(200).nullable(),
    title: requiredText(500),
    editionOrRevision: optionalText(200),
    issuer: optionalText(300),
    locator: optionalText(2_000),
    rationale: optionalText(2_000),
    status: z.enum(["current", "stale", "unavailable"]),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const technicalFileSectionSchema = z
  .object({
    id: z.uuid(),
    key: technicalFileSectionKeySchema,
    heading: requiredText(500),
    requirementText: requiredText(8_000),
    sortOrder: z.number().int().positive(),
    narrative: optionalText(20_000),
    applicability: z.enum(["applicable", "not_applicable"]),
    nonApplicabilityReason: optionalText(2_000),
    version: expectedVersionSchema,
    status: technicalFileSectionStatusSchema,
    sources: z.array(technicalFileSourceSchema),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.applicability === "not_applicable" &&
      !value.nonApplicabilityReason
    ) {
      context.addIssue({
        code: "custom",
        path: ["nonApplicabilityReason"],
        message: "Give a reason when a section is not applicable",
      });
    }
  });

export const technicalFileSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    productId: z.uuid(),
    templateKey: z.literal("annex_vii"),
    templateVersion: requiredText(80),
    legalSource: requiredText(2_000),
    status: z.enum(["active", "archived"]),
    version: expectedVersionSchema,
    sections: z.array(technicalFileSectionSchema),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const technicalFileProductParamsSchema = z
  .object({ productId: z.uuid() })
  .strict();
export const technicalFileSectionParamsSchema = technicalFileProductParamsSchema
  .extend({ sectionKey: technicalFileSectionKeySchema })
  .strict();
export const createTechnicalFileRequestSchema = z
  .object({ idempotencyKey: idempotencyKeySchema })
  .strict();
export const updateTechnicalFileSectionRequestSchema = z
  .object({
    expectedVersion: expectedVersionSchema,
    narrative: optionalText(20_000),
    applicability: z.enum(["applicable", "not_applicable"]),
    nonApplicabilityReason: optionalText(2_000),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.applicability === "not_applicable" &&
      !value.nonApplicabilityReason
    )
      context.addIssue({
        code: "custom",
        path: ["nonApplicabilityReason"],
        message: "Give a reason when a section is not applicable",
      });
  });

const manualReferenceSchema = z
  .object({
    title: requiredText(500),
    editionOrRevision: optionalText(200),
    issuer: optionalText(300),
    locator: optionalText(2_000),
    rationale: optionalText(2_000),
  })
  .strict();
export const addTechnicalFileSourceRequestSchema = z
  .object({
    expectedVersion: expectedVersionSchema,
    sourceKind: technicalFileSourceKindSchema,
    recordId: z.uuid().optional(),
    manualReference: manualReferenceSchema.optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.sourceKind === "manual_reference"
        ? !value.manualReference || value.recordId
        : !value.recordId || value.manualReference
    )
      context.addIssue({
        code: "custom",
        message:
          "Manual references need bibliographic data; internal sources need a record ID",
      });
  });
export const removeTechnicalFileSourceParamsSchema =
  technicalFileSectionParamsSchema.extend({ sourceId: z.uuid() }).strict();
export const removeTechnicalFileSourceRequestSchema = z
  .object({
    expectedVersion: expectedVersionSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const technicalFileResponseSchema = z
  .object({ technicalFile: technicalFileSchema })
  .strict();
export const technicalFileWorkspaceResponseSchema = z
  .object({
    technicalFile: technicalFileSchema,
    retention: productRetentionCalculationSchema,
  })
  .strict();
export const technicalFileSectionResponseSchema = z
  .object({ section: technicalFileSectionSchema })
  .strict();
