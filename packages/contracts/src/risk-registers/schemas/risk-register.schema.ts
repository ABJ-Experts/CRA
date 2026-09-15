import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";
import { z } from "zod";

const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);
const optionalText = (maximum: number) =>
  z.string().trim().max(maximum).nullable();
const expectedVersionSchema = z.number().int().positive();

/** The V1 method is deliberately pinned; it is not a legal-compliance score. */
export const CRA_5X5_V1_METHOD_KEY = "cra_5x5_v1" as const;
export const riskRegisterMethodKeySchema = z.literal(CRA_5X5_V1_METHOD_KEY);
export const riskLikelihoodSchema = z.number().int().min(1).max(5);
export const riskImpactSchema = z.number().int().min(1).max(5);
export const riskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
export const riskStatusSchema = z.enum([
  "incomplete",
  "assessed",
  "review_required",
  "archived",
]);
export const riskRequirementMappingStatusSchema = z.literal("unresolved");
export const riskEvidenceStatusSchema = z.enum([
  "current",
  "review_required",
  "unavailable",
]);

export const calculateRiskLevel = (
  likelihood: number,
  impact: number,
): z.output<typeof riskLevelSchema> => {
  const score = likelihood * impact;
  if (score <= 4) return "low";
  if (score <= 9) return "medium";
  if (score <= 16) return "high";
  return "critical";
};

export const riskAssessmentInputSchema = z
  .object({
    likelihood: riskLikelihoodSchema,
    impact: riskImpactSchema,
    likelihoodRationale: requiredText(4_000),
    impactRationale: requiredText(4_000),
  })
  .strict();

export const riskAssessmentSchema = riskAssessmentInputSchema.extend({
  level: riskLevelSchema,
});

const riskAssessmentConsistencyIssue = (
  value: Readonly<{ likelihood: number; impact: number; level?: string }>,
  context: z.RefinementCtx,
) => {
  if (
    value.level &&
    value.level !== calculateRiskLevel(value.likelihood, value.impact)
  ) {
    context.addIssue({
      code: "custom",
      path: ["level"],
      message: "Risk level must match the pinned cra_5x5_v1 matrix",
    });
  }
};

export const riskAssessmentOutputSchema = riskAssessmentSchema
  .strict()
  .superRefine(riskAssessmentConsistencyIssue);

export const riskAffectedAssetInputSchema = z
  .object({ componentId: z.uuid() })
  .strict();
export const riskAffectedAssetSchema = riskAffectedAssetInputSchema
  .extend({
    id: z.uuid(),
    componentName: requiredText(500),
    componentVersion: optionalText(300),
    sbomDocumentId: z.uuid(),
    observedRevision: requiredText(200),
    status: z.enum(["current", "review_required", "unavailable"]),
  })
  .strict();

/** M10 owns authoritative packs. V1 records a manual, visibly unresolved mapping. */
export const riskRequirementMappingInputSchema = z
  .object({
    identifier: requiredText(200),
    edition: requiredText(200),
    sourceReference: requiredText(2_000),
    rationale: requiredText(4_000),
  })
  .strict();
export const riskRequirementMappingSchema = riskRequirementMappingInputSchema
  .extend({
    id: z.uuid(),
    status: riskRequirementMappingStatusSchema,
  })
  .strict();

export const riskEvidenceReferenceInputSchema = z
  .object({
    title: requiredText(500),
    recordId: z.uuid().nullable(),
    observedRevision: optionalText(200),
    locator: optionalText(2_000),
    rationale: requiredText(4_000),
  })
  .strict()
  .superRefine((value, context) => {
    const internal = value.recordId !== null;
    const revisionPresent = value.observedRevision !== null;
    if (internal !== revisionPresent) {
      context.addIssue({
        code: "custom",
        path: ["observedRevision"],
        message:
          "Internal evidence needs an exact observed revision; manual evidence cannot provide one",
      });
    }
  });
export const riskEvidenceReferenceSchema = riskEvidenceReferenceInputSchema
  .extend({ id: z.uuid(), status: riskEvidenceStatusSchema })
  .strict();

const uniqueIdIssue = (
  values: readonly { componentId?: string; identifier?: string }[],
  key: "componentId" | "identifier",
  context: z.RefinementCtx,
) => {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    const candidate = value[key];
    if (candidate && seen.has(candidate.toLowerCase())) {
      context.addIssue({
        code: "custom",
        path: [index, key],
        message: `Do not repeat ${key}`,
      });
    }
    if (candidate) seen.add(candidate.toLowerCase());
  }
};

export const riskRegisterProductParamsSchema = z
  .object({ productId: z.uuid() })
  .strict();
export const riskRegisterRiskParamsSchema = riskRegisterProductParamsSchema
  .extend({ riskId: z.uuid() })
  .strict();

const riskCommandFields = {
  threat: requiredText(4_000),
  affectedAssets: z.array(riskAffectedAssetInputSchema).min(1).max(100),
  requirements: z.array(riskRequirementMappingInputSchema).min(1).max(50),
  inherentAssessment: riskAssessmentInputSchema,
  mitigations: requiredText(12_000),
  residualAssessment: riskAssessmentInputSchema,
  revisionRationale: requiredText(4_000),
  ownerId: z.uuid(),
  evidenceReferences: z
    .array(riskEvidenceReferenceInputSchema)
    .max(50)
    .default([]),
};

const riskCommandConsistencyIssue = (
  value: Readonly<{
    affectedAssets: readonly { componentId: string }[];
    requirements: readonly { identifier: string }[];
  }>,
  context: z.RefinementCtx,
) => {
  uniqueIdIssue(value.affectedAssets, "componentId", context);
  uniqueIdIssue(value.requirements, "identifier", context);
};

export const createRiskRegisterRiskRequestSchema = z
  .object({ ...riskCommandFields, idempotencyKey: idempotencyKeySchema })
  .strict()
  .superRefine(riskCommandConsistencyIssue);
export const updateRiskRegisterRiskRequestSchema = z
  .object({
    ...riskCommandFields,
    expectedVersion: expectedVersionSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict()
  .superRefine(riskCommandConsistencyIssue);
export const acceptResidualRiskRequestSchema = z
  .object({
    expectedVersion: expectedVersionSchema,
    acceptanceRationale: requiredText(4_000),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const archiveRiskRegisterRiskRequestSchema = z
  .object({
    expectedVersion: expectedVersionSchema,
    archiveRationale: requiredText(4_000),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const riskResidualAcceptanceSchema = z
  .object({
    acceptedAt: z.string().datetime({ offset: true }),
    acceptedByUserId: z.uuid(),
    rationale: requiredText(4_000),
    revision: z.number().int().positive(),
  })
  .strict();

export const riskRevisionSchema = z
  .object({
    id: z.uuid(),
    revision: z.number().int().positive(),
    threat: requiredText(4_000),
    affectedAssets: z.array(riskAffectedAssetSchema),
    requirements: z.array(riskRequirementMappingSchema),
    inherentAssessment: riskAssessmentOutputSchema,
    mitigations: requiredText(12_000),
    residualAssessment: riskAssessmentOutputSchema,
    revisionRationale: requiredText(4_000),
    ownerId: z.uuid(),
    evidenceReferences: z.array(riskEvidenceReferenceSchema),
    createdByUserId: z.uuid(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const riskRegisterRiskSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    productId: z.uuid(),
    registerId: z.uuid(),
    version: expectedVersionSchema,
    status: riskStatusSchema,
    archivedAt: z.string().datetime({ offset: true }).nullable(),
    archivedByUserId: z.uuid().nullable(),
    archiveRationale: optionalText(4_000),
    residualRiskAcceptance: riskResidualAcceptanceSchema.nullable(),
    currentRevision: riskRevisionSchema,
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const riskRegisterSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    productId: z.uuid(),
    technicalFileId: z.uuid(),
    methodKey: riskRegisterMethodKeySchema,
    methodVersion: z.literal("1"),
    version: expectedVersionSchema,
    risks: z.array(riskRegisterRiskSchema),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const riskRegisterWorkspaceResponseSchema = z
  .object({ riskRegister: riskRegisterSchema.nullable() })
  .strict();
export const riskRegisterRiskResponseSchema = z
  .object({ risk: riskRegisterRiskSchema })
  .strict();
export const riskRegisterConflictResponseSchema = z
  .object({
    code: z.literal("version_conflict"),
    message: requiredText(500),
    currentVersion: expectedVersionSchema,
  })
  .strict();
