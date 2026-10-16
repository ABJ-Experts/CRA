import { z } from "zod";

import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";
import {
  frameworkPackKeySchema,
  frameworkRequirementKeySchema,
  frameworkVersionKeySchema,
} from "./framework.schema.js";

const uuid = z.uuid();
const timestamp = z.iso.datetime({ offset: true });
const plainText = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .refine(
      (value) => !/[\p{Cc}\p{Cf}]/u.test(value) && !/<[^>]+>/u.test(value),
      "Control characters and HTML markup are not allowed",
    );
const uniqueProducts = z
  .array(uuid)
  .min(1)
  .max(100)
  .refine(
    (values) => new Set(values).size === values.length,
    "Product identifiers must be unique",
  );
const mutation = z
  .object({
    expectedRevision: z.number().int().min(1),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const controlStatusSchema = z.enum([
  "not_started",
  "in_progress",
  "implemented",
]);
export const controlIdParamsSchema = z.object({ controlId: uuid }).strict();
export const controlLinkParamsSchema = controlIdParamsSchema.extend({
  linkId: uuid,
});
export const controlMappingParamsSchema = controlIdParamsSchema.extend({
  mappingId: uuid,
});
export const controlParamsSchema = controlIdParamsSchema;
export const controlEvidenceLinkParamsSchema = controlLinkParamsSchema;
export const requirementCoverageParamsSchema = z
  .object({
    packKey: frameworkPackKeySchema,
    versionKey: frameworkVersionKeySchema,
  })
  .strict();
export const controlListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(50),
    cursor: z.string().min(1).max(128).optional(),
    includeArchived: z
      .union([z.boolean(), z.enum(["true", "false"])])
      .transform((value) => value === true || value === "true")
      .default(false),
  })
  .strict();
export const controlSummarySchema = z
  .object({
    id: uuid,
    title: plainText(200),
    description: plainText(4000),
    ownerUserId: uuid,
    ownerActive: z.boolean(),
    status: controlStatusSchema,
    revision: z.number().int().min(1),
    archivedAt: timestamp.nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();
export const controlListResponseSchema = z
  .object({
    controls: z.array(controlSummarySchema).max(50),
    nextCursor: z.string().min(1).max(128).nullable(),
  })
  .strict();
export const controlOwnerCandidatesQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(100),
    cursor: z.string().min(1).max(128).optional(),
  })
  .strict();
export const controlOwnerCandidatesResponseSchema = z
  .object({
    owners: z
      .array(z.object({ id: uuid, displayName: plainText(200) }).strict())
      .max(100),
    nextCursor: z.string().min(1).max(128).nullable(),
  })
  .strict();
export const controlEvidenceLinkSchema = z
  .object({
    id: uuid,
    evidenceVersionId: uuid,
    productId: uuid,
    evidenceTitle: plainText(500),
    evidenceVersionNumber: z.number().int().min(1),
    availability: z.enum([
      "available",
      "expired",
      "quarantined",
      "unavailable",
    ]),
    sourceControlRevision: z.number().int().min(1),
    endedAt: timestamp.nullable(),
    createdAt: timestamp,
  })
  .strict();
export const controlMappingSchema = z
  .object({
    id: uuid,
    packKey: frameworkPackKeySchema,
    versionKey: frameworkVersionKeySchema,
    requirementKey: frameworkRequirementKeySchema,
    identifier: plainText(120),
    heading: plainText(500).nullable(),
    requirementText: plainText(20_000),
    rationale: plainText(2000),
    productIds: z.array(uuid).max(100),
    productsRestricted: z.boolean(),
    sourceControlRevision: z.number().int().min(1),
    endedAt: timestamp.nullable(),
    createdAt: timestamp,
  })
  .strict();
export const controlDetailResponseSchema = controlSummarySchema.extend({
  evidenceLinks: z.array(controlEvidenceLinkSchema).max(100),
  evidenceRestricted: z.boolean(),
  mappings: z.array(controlMappingSchema).max(100),
});
export const createControlInputSchema = z
  .object({
    title: plainText(200),
    description: plainText(4000),
    ownerUserId: uuid,
    status: z.literal("not_started"),
    expectedRevision: z.null(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const updateControlInputSchema = mutation.extend({
  title: plainText(200),
  description: plainText(4000),
  ownerUserId: uuid,
  status: controlStatusSchema,
  transitionReason: plainText(1000).optional(),
});
export const archiveControlInputSchema = mutation;
export const linkControlEvidenceInputSchema = mutation.extend({
  evidenceVersionId: uuid,
  productId: uuid,
});
export const endControlLinkInputSchema = mutation;
export const createControlMappingInputSchema = mutation.extend({
  packKey: frameworkPackKeySchema,
  versionKey: frameworkVersionKeySchema,
  requirementKey: frameworkRequirementKeySchema,
  rationale: plainText(2000),
  productIds: uniqueProducts,
});
export const updateControlMappingInputSchema = createControlMappingInputSchema;
export const endControlMappingInputSchema = mutation;
export const controlCommandResponseSchema = z
  .object({
    controlId: uuid,
    revision: z.number().int().min(1),
    linkId: uuid.optional(),
    mappingId: uuid.optional(),
  })
  .strict();
export const requirementCoverageQuerySchema = z
  .object({
    productId: uuid,
    limit: z.coerce.number().int().min(1).max(100).default(100),
    cursor: z.string().min(1).max(128).optional(),
    filter: z
      .enum(["all", "gaps", "evidence_backed", "excluded"])
      .default("all"),
  })
  .strict();
export const frameworkApplicabilityParamsSchema =
  requirementCoverageParamsSchema.extend({
    requirementKey: frameworkRequirementKeySchema,
  });
export const frameworkApplicabilityStateSchema = z.enum([
  "applicable",
  "not_applicable",
]);
export const setFrameworkApplicabilityInputSchema = z
  .object({
    productId: uuid,
    state: frameworkApplicabilityStateSchema,
    reason: plainText(2000).optional(),
    expectedRevision: z.number().int().min(0),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.state === "not_applicable" && !value.reason) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Approval requires a reason",
      });
    }
    if (value.state === "applicable" && value.reason !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Restoring applicability must not include a reason",
      });
    }
  });
export const frameworkApplicabilityResponseSchema = z
  .object({
    state: frameworkApplicabilityStateSchema,
    reason: plainText(2000).nullable(),
    revision: z.number().int().min(0),
  })
  .strict();
export const requirementApplicabilityParamsSchema =
  frameworkApplicabilityParamsSchema;
export const requirementApplicabilityInputSchema =
  setFrameworkApplicabilityInputSchema;
export const requirementApplicabilityResponseSchema =
  frameworkApplicabilityResponseSchema;
export const requirementCoverageStateSchema = z.enum([
  "structural",
  "excluded",
  "evidence_backed",
  "no_mapping",
  "unimplemented",
  "missing_evidence",
  "expired_evidence",
  "not_yet_valid_evidence",
  "quarantined_evidence",
  "unavailable_evidence",
  "stale",
]);
export const requirementCoverageSummarySchema = z
  .object({
    totalRequirements: z.number().int().min(0),
    applicableRequirements: z.number().int().min(0),
    excludedRequirements: z.number().int().min(0),
    evidenceBackedRequirements: z.number().int().min(0),
    gapRequirements: z.number().int().min(0),
  })
  .strict();
export const requirementCoverageResponseSchema = z
  .object({
    packKey: frameworkPackKeySchema,
    versionKey: frameworkVersionKeySchema,
    productId: uuid,
    calculation: z
      .object({
        status: z.enum(["current", "stale", "unavailable"]),
        calculatedAt: timestamp.nullable(),
      })
      .strict(),
    summary: requirementCoverageSummarySchema.nullable(),
    requirements: z
      .array(
        z
          .object({
            requirementKey: frameworkRequirementKeySchema,
            identifier: plainText(120),
            heading: plainText(500).nullable(),
            text: plainText(20_000),
            parentKey: frameworkRequirementKeySchema.nullable(),
            assessable: z.boolean(),
            applicability: frameworkApplicabilityResponseSchema,
            coverageState: requirementCoverageStateSchema,
            remediation: z
              .object({
                kind: z
                  .enum([
                    "map_control",
                    "implement_control",
                    "link_evidence",
                    "replace_evidence",
                  ])
                  .nullable(),
                controlId: uuid.nullable(),
              })
              .strict(),
            controls: z
              .array(
                z
                  .object({
                    id: uuid,
                    title: plainText(200),
                    status: controlStatusSchema,
                    ownerActive: z.boolean(),
                    evidencePresent: z.boolean(),
                    evidenceAvailability: z.enum([
                      "available",
                      "missing",
                      "expired",
                      "quarantined",
                      "not_yet_valid",
                      "processing",
                      "deletion_pending",
                      "archived",
                      "unavailable",
                    ]),
                  })
                  .strict(),
              )
              .max(100),
          })
          .strict(),
      )
      .max(100),
    nextCursor: z.string().min(1).max(128).nullable(),
  })
  .strict();
