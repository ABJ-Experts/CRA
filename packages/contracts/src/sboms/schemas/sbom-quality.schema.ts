import { z } from "zod";

import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";

const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);
const cursorSchema = requiredText(512);
const utcDateTimeSchema = z.string().datetime({ offset: true });
const percentageSchema = z.number().min(0).max(100);

export const SBOM_QUALITY_FORMULA_VERSION = "sbom-quality.v1" as const;
export const BSI_TR_03183_2_RULESET_VERSION = "bsi-tr-03183-2.v2.0.0" as const;

export const sbomQualityFormulaVersionSchema = z
  .string()
  .regex(/^sbom-quality\.v[1-9][0-9]*$/, "Use a versioned SBOM formula");
export const sbomQualityRulesetVersionSchema = z
  .string()
  .regex(
    /^bsi-tr-03183-2\.v[1-9][0-9]*\.[0-9]+\.[0-9]+$/,
    "Use a versioned BSI TR-03183-2 ruleset",
  );

export const sbomQualityReportStateSchema = z.enum([
  "queued",
  "processing",
  "completed",
  "failed",
]);
export const sbomQualityJobStageSchema = z.enum([
  "queued",
  "collecting_inputs",
  "scoring",
  "comparing_baseline",
  "evaluating_bsi",
  "recording_findings",
  "completed",
  "failed",
]);
export const sbomQualityAssessmentStatusSchema = z.enum([
  "valid",
  "warning",
  "invalid",
  "first_document",
  "no_baseline",
  "regression",
]);
export const sbomQualityDimensionIdSchema = z.enum([
  "purl",
  "hash",
  "supplier",
  "license",
  "top_level_dependency",
  "transitive_depth",
]);
export const sbomQualityDimensionStatusSchema = z.enum([
  "complete",
  "partial",
  "missing",
  "not_assessable",
]);

export const sbomQualityInputsSchema = z
  .object({
    componentCount: z.number().int().nonnegative(),
    componentsWithCanonicalPurl: z.number().int().nonnegative(),
    componentsWithValidHash: z.number().int().nonnegative(),
    componentsWithSupplier: z.number().int().nonnegative(),
    componentsWithLicense: z.number().int().nonnegative(),
    primaryComponentIdentified: z.boolean(),
    primaryComponentDirectDependencyCount: z.number().int().nonnegative(),
    maximumDepth: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((inputs, context) => {
    const componentBoundedFields = [
      "componentsWithCanonicalPurl",
      "componentsWithValidHash",
      "componentsWithSupplier",
      "componentsWithLicense",
    ] as const;
    for (const field of componentBoundedFields) {
      if (inputs[field] > inputs.componentCount) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: "Coverage counts cannot exceed the component count",
        });
      }
    }
    if (
      !inputs.primaryComponentIdentified &&
      inputs.primaryComponentDirectDependencyCount !== 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["primaryComponentDirectDependencyCount"],
        message: "An unidentified primary component cannot have dependencies",
      });
    }
  });

export const sbomQualityDimensionSchema = z
  .object({
    id: sbomQualityDimensionIdSchema,
    eligibleCount: z.number().int().nonnegative(),
    satisfiedCount: z.number().int().nonnegative(),
    coveragePercent: percentageSchema,
    score: percentageSchema,
    weight: percentageSchema,
    weightedScore: percentageSchema,
    status: sbomQualityDimensionStatusSchema,
  })
  .strict()
  .superRefine((dimension, context) => {
    if (dimension.satisfiedCount > dimension.eligibleCount) {
      context.addIssue({
        code: "custom",
        path: ["satisfiedCount"],
        message: "Satisfied coverage cannot exceed eligible coverage",
      });
    }
  });

export const sbomQualityProfileStatusSchema = z.enum([
  "disabled",
  "valid",
  "warning",
  "invalid",
  "unavailable",
]);
export const sbomQualityBaselineStatusSchema = z.enum([
  "available",
  "first_document",
  "no_baseline",
]);
export const sbomQualityRegressionStatusSchema = z.enum(["none", "regression"]);

export const sbomQualityProfileSchema = z
  .object({
    enabled: z.boolean(),
    status: sbomQualityProfileStatusSchema,
    rulesetVersion: sbomQualityRulesetVersionSchema,
    findingCount: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((profile, context) => {
    if (!profile.enabled && profile.status !== "disabled") {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Disabled BSI profiles must report a disabled status",
      });
    }
  });

export const sbomQualityBaselineSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("available"),
      reportId: z.uuid(),
      sourceId: z.uuid(),
      totalScore: percentageSchema,
      completedAt: utcDateTimeSchema,
    })
    .strict(),
  z.object({ status: z.literal("first_document") }).strict(),
  z.object({ status: z.literal("no_baseline") }).strict(),
]);

export const sbomQualityRegressionSchema = z
  .object({
    status: sbomQualityRegressionStatusSchema,
    totalScoreDelta: z.number().min(-100).max(100),
    changedDimensions: z.array(sbomQualityDimensionIdSchema).max(6),
  })
  .strict()
  .superRefine((regression, context) => {
    if (
      new Set(regression.changedDimensions).size !==
      regression.changedDimensions.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["changedDimensions"],
        message: "Changed quality dimensions must be unique",
      });
    }
    if (
      regression.status === "none" &&
      regression.changedDimensions.length !== 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["changedDimensions"],
        message: "Non-regression reports cannot list changed dimensions",
      });
    }
  });

export const sbomQualityJobProgressSchema = z
  .object({
    stage: sbomQualityJobStageSchema,
    percent: z.number().int().min(0).max(100),
    message: requiredText(500),
  })
  .strict();

export const sbomQualityJobErrorSchema = z
  .object({
    code: z.enum([
      "normalized_document_missing",
      "quality_persistence_unavailable",
      "quality_configuration_unavailable",
      "quality_source_missing",
      "quality_statement_timeout",
      "quality_calculation_failed",
      "provider_unavailable",
      "unexpected_failure",
    ]),
    message: requiredText(500),
    retryable: z.boolean(),
  })
  .strict();

export const sbomQualityReportSchema = z
  .object({
    id: z.uuid(),
    sourceId: z.uuid(),
    releaseId: z.uuid(),
    documentId: z.uuid(),
    state: sbomQualityReportStateSchema,
    assessmentStatus: sbomQualityAssessmentStatusSchema.nullable(),
    formulaVersion: sbomQualityFormulaVersionSchema,
    rulesetVersion: sbomQualityRulesetVersionSchema,
    configurationVersion: z.number().int().nonnegative(),
    inputs: sbomQualityInputsSchema.nullable(),
    dimensions: z.array(sbomQualityDimensionSchema).max(6),
    totalScore: percentageSchema.nullable(),
    bsiProfile: sbomQualityProfileSchema.nullable(),
    baseline: sbomQualityBaselineSchema.nullable(),
    regression: sbomQualityRegressionSchema.nullable(),
    progress: sbomQualityJobProgressSchema,
    error: sbomQualityJobErrorSchema.nullable(),
    completedAt: utcDateTimeSchema.nullable(),
    createdAt: utcDateTimeSchema,
    updatedAt: utcDateTimeSchema,
  })
  .strict()
  .superRefine((report, context) => {
    if (
      new Set(report.dimensions.map((dimension) => dimension.id)).size !==
      report.dimensions.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["dimensions"],
        message: "Quality dimensions must be unique",
      });
    }
    if (report.state === "completed") {
      if (
        report.assessmentStatus === null ||
        report.inputs === null ||
        report.totalScore === null ||
        report.bsiProfile === null ||
        report.baseline === null ||
        report.regression === null ||
        report.completedAt === null ||
        report.error !== null
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Completed quality reports require a complete immutable result",
        });
      }
    }
    if (report.state === "failed" && report.error === null) {
      context.addIssue({
        code: "custom",
        path: ["error"],
        message: "Failed quality reports require an error",
      });
    }
    if (report.state !== "failed" && report.error !== null) {
      context.addIssue({
        code: "custom",
        path: ["error"],
        message: "Only failed quality reports contain an error",
      });
    }
  });

export const sbomQualityReportResponseSchema = z
  .object({ report: sbomQualityReportSchema })
  .strict();

export const sbomSourceQualityParamsSchema = z
  .object({ sourceId: z.uuid() })
  .strict();

export const sbomQualityFindingKindSchema = z.enum([
  "coverage_gap",
  "bsi_rule",
  "regression",
]);
export const sbomQualityFindingSeveritySchema = z.enum([
  "info",
  "warning",
  "error",
]);
export const sbomQualityFindingSchema = z
  .object({
    id: z.uuid(),
    reportId: z.uuid(),
    kind: sbomQualityFindingKindSchema,
    severity: sbomQualityFindingSeveritySchema,
    code: requiredText(160),
    ruleId: requiredText(160).nullable(),
    dimension: sbomQualityDimensionIdSchema.nullable(),
    sourcePath: requiredText(1_000).nullable(),
    expected: requiredText(1_000).nullable(),
    actual: requiredText(1_000).nullable(),
    remediation: requiredText(1_000),
    componentId: z.uuid().nullable(),
    createdAt: utcDateTimeSchema,
  })
  .strict();

export const sbomQualityFindingsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: cursorSchema.optional(),
    severity: sbomQualityFindingSeveritySchema.optional(),
    kind: sbomQualityFindingKindSchema.optional(),
  })
  .strict();
export const sbomQualityFindingsResponseSchema = z
  .object({
    findings: z.array(sbomQualityFindingSchema).max(100),
    nextCursor: cursorSchema.nullable(),
  })
  .strict();

export const updateSbomQualitySettingsInputSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    bsiProfileEnabled: z.boolean(),
    idempotencyKey: idempotencyKeySchema.optional(),
  })
  .strict();
export const sbomQualitySettingsSchema = z
  .object({
    version: z.number().int().nonnegative(),
    bsiProfileEnabled: z.boolean(),
    rulesetVersion: z.literal(BSI_TR_03183_2_RULESET_VERSION),
    updatedAt: utcDateTimeSchema,
  })
  .strict();
export const sbomQualitySettingsResponseSchema = z
  .object({ settings: sbomQualitySettingsSchema })
  .strict();
