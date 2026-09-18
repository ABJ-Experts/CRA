import { z } from "zod";

import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";

const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);
const cursorSchema = requiredText(512);
const utcDateTimeSchema = z.string().datetime({ offset: true });
const sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Use a lowercase SHA-256");

export const SBOM_COMPOSITE_MERGE_RULES_VERSION = "sbom-composite.v1" as const;

export const sbomCompositeReviewStateSchema = z.enum([
  "draft",
  "awaiting_review",
  "generating",
  "processing",
  "completed",
  "failed",
]);
export const sbomCompositeConflictKindSchema = z.enum([
  "incompatible_version",
  "field_conflict",
  "unresolved_identity",
]);
export const sbomCompositeConflictStateSchema = z.enum([
  "unresolved",
  "resolved",
  "excluded",
]);
export const sbomCompositeRelationshipKindSchema = z.enum([
  "unresolved_endpoint",
  "dependency_cycle",
  "omitted_dependency",
]);
export const sbomCompositeRelationshipStateSchema = z.enum([
  "unresolved",
  "included",
  "excluded",
]);

export const sbomCompositeReleaseParamsSchema = z
  .object({ productId: z.uuid(), releaseId: z.uuid() })
  .strict();
export const sbomCompositeReviewParamsSchema = z
  .object({ reviewId: z.uuid() })
  .strict();
export const sbomCompositeConflictParamsSchema = z
  .object({ reviewId: z.uuid(), conflictId: z.uuid() })
  .strict();
export const sbomCompositeRelationshipParamsSchema = z
  .object({ reviewId: z.uuid(), relationshipId: z.uuid() })
  .strict();

/** Source selection is deliberate: source IDs are tenant-scoped by the API. */
export const createSbomCompositeReviewInputSchema = z
  .object({
    sourceIds: z.array(z.uuid()).min(1).max(100),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (new Set(input.sourceIds).size !== input.sourceIds.length) {
      context.addIssue({
        code: "custom",
        path: ["sourceIds"],
        message: "Source documents must be selected at most once",
      });
    }
  });

export const sbomCompositeSourceInputSchema = z
  .object({
    sourceId: z.uuid(),
    documentId: z.uuid(),
    documentSha256: sha256Schema,
    releaseId: z.uuid(),
    source: z.enum([
      "manual_upload",
      "ci_upload",
      "integration",
      "supplier",
      "generated",
    ]),
    supplierSubmissionId: z.uuid().nullable(),
    acceptedForComposite: z.boolean(),
    retentionWarning: requiredText(500).nullable(),
  })
  .strict();

export const sbomCompositeComponentCandidateSchema = z
  .object({
    componentId: z.uuid(),
    sourceId: z.uuid(),
    documentId: z.uuid(),
    documentSha256: sha256Schema,
    sourceComponentRef: requiredText(4_096),
    name: requiredText(1_024),
    version: requiredText(1_024).nullable(),
    canonicalPurl: requiredText(4_096).nullable(),
    canonicalCpe: requiredText(4_096).nullable(),
    supplierSubmissionId: z.uuid().nullable(),
  })
  .strict();

export const sbomCompositeConflictCandidateSchema = z
  .object({
    component: sbomCompositeComponentCandidateSchema,
    value: z.string().max(16_384).nullable(),
  })
  .strict();

export const sbomCompositeConflictSchema = z
  .object({
    id: z.uuid(),
    reviewId: z.uuid(),
    identity: requiredText(4_096).nullable(),
    kind: sbomCompositeConflictKindSchema,
    field: requiredText(120).nullable(),
    state: sbomCompositeConflictStateSchema,
    candidates: z.array(sbomCompositeConflictCandidateSchema).min(2).max(100),
    selectedComponentId: z.uuid().nullable(),
    resolutionReason: requiredText(2_000).nullable(),
    resolvedAt: utcDateTimeSchema.nullable(),
  })
  .strict()
  .superRefine((conflict, context) => {
    const candidateIds = new Set(
      conflict.candidates.map((candidate) => candidate.component.componentId),
    );
    if (
      conflict.selectedComponentId !== null &&
      !candidateIds.has(conflict.selectedComponentId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["selectedComponentId"],
        message: "Selected component must be one of the conflict candidates",
      });
    }
    if (conflict.state === "resolved" && !conflict.selectedComponentId) {
      context.addIssue({
        code: "custom",
        path: ["selectedComponentId"],
        message: "Resolved conflicts require a selected source component",
      });
    }
    if (conflict.state !== "unresolved" && !conflict.resolutionReason) {
      context.addIssue({
        code: "custom",
        path: ["resolutionReason"],
        message: "Resolved conflicts require a reviewer rationale",
      });
    }
  });

export const sbomCompositeRelationshipSchema = z
  .object({
    id: z.uuid(),
    reviewId: z.uuid(),
    kind: sbomCompositeRelationshipKindSchema,
    state: sbomCompositeRelationshipStateSchema,
    parentComponentId: z.uuid().nullable(),
    childComponentId: z.uuid().nullable(),
    sourceId: z.uuid(),
    documentId: z.uuid(),
    sourceParentRef: requiredText(4_096).nullable(),
    sourceChildRef: requiredText(4_096).nullable(),
    reason: requiredText(2_000).nullable(),
    resolvedAt: utcDateTimeSchema.nullable(),
  })
  .strict()
  .superRefine((relationship, context) => {
    if (relationship.state !== "unresolved" && !relationship.reason) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Relationship decisions require a reviewer rationale",
      });
    }
  });

export const sbomCompositeCoverageSchema = z
  .object({
    sourceCount: z.number().int().nonnegative(),
    componentCandidateCount: z.number().int().nonnegative(),
    duplicateIdentityCount: z.number().int().nonnegative(),
    conflictCount: z.number().int().nonnegative(),
    unresolvedRelationshipCount: z.number().int().nonnegative(),
  })
  .strict();

export const sbomCompositeProvenanceSchema = z
  .object({
    compositeComponentRef: requiredText(4_096),
    field: requiredText(120).nullable(),
    sourceId: z.uuid(),
    documentId: z.uuid(),
    documentSha256: sha256Schema,
    sourceComponentId: z.uuid(),
    sourceComponentRef: requiredText(4_096),
    supplierSubmissionId: z.uuid().nullable(),
    mergedAt: utcDateTimeSchema,
    reviewDecisionId: z.uuid().nullable(),
  })
  .strict();

/**
 * A generated dependency edge is provenance-bearing evidence in its own
 * right. Component provenance alone cannot show which source relationship
 * justified an emitted edge when a component was merged from several inputs.
 */
export const sbomCompositeDependencyProvenanceSchema = z
  .object({
    compositeFromRef: requiredText(4_096),
    compositeToRef: requiredText(4_096),
    sourceId: z.uuid(),
    documentId: z.uuid(),
    documentSha256: sha256Schema,
    sourceFromComponentRef: requiredText(4_096),
    sourceToComponentRef: requiredText(4_096),
    supplierSubmissionId: z.uuid().nullable(),
    mergedAt: utcDateTimeSchema,
    reviewDecisionId: z.uuid().nullable(),
  })
  .strict()
  .superRefine((provenance, context) => {
    if (provenance.compositeFromRef === provenance.compositeToRef) {
      context.addIssue({
        code: "custom",
        path: ["compositeToRef"],
        message: "Composite dependency provenance cannot describe a self-edge",
      });
    }
  });

export const sbomCompositeProvenanceManifestSchema = z
  .object({
    reviewId: z.uuid(),
    sourceHashes: z.array(sha256Schema).min(1).max(100),
    mergeRulesVersion: requiredText(120),
    generatedAt: utcDateTimeSchema,
    components: z.array(sbomCompositeProvenanceSchema).max(100_000),
    dependencies: z.array(sbomCompositeDependencyProvenanceSchema).max(100_000),
  })
  .strict();

export const sbomCompositeReviewSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    productId: z.uuid(),
    releaseId: z.uuid(),
    state: sbomCompositeReviewStateSchema,
    mergeRulesVersion: requiredText(120),
    inputSetDigest: sha256Schema,
    resolutionDigest: sha256Schema.nullable(),
    coverage: sbomCompositeCoverageSchema,
    sources: z.array(sbomCompositeSourceInputSchema).min(1).max(100),
    conflicts: z.array(sbomCompositeConflictSchema).max(10_000),
    relationships: z.array(sbomCompositeRelationshipSchema).max(10_000),
    retentionWarnings: z.array(requiredText(500)).max(100),
    generatedSourceId: z.uuid().nullable(),
    generatedDocumentId: z.uuid().nullable(),
    provenanceManifest: sbomCompositeProvenanceManifestSchema.nullable(),
    error: requiredText(2_000).nullable(),
    createdAt: utcDateTimeSchema,
    updatedAt: utcDateTimeSchema,
    completedAt: utcDateTimeSchema.nullable(),
  })
  .strict()
  .superRefine((review, context) => {
    if (review.state === "completed") {
      if (!review.generatedSourceId || !review.generatedDocumentId) {
        context.addIssue({
          code: "custom",
          path: ["generatedSourceId"],
          message:
            "Completed composites require an immutable generated document",
        });
      }
      if (!review.provenanceManifest || !review.completedAt) {
        context.addIssue({
          code: "custom",
          path: ["provenanceManifest"],
          message:
            "Completed composites require provenance and completion time",
        });
      }
    }
  });

export const resolveSbomCompositeConflictInputSchema = z
  .object({
    decision: z.enum(["select_source_component", "exclude_identity"]),
    selectedComponentId: z.uuid().optional(),
    reason: requiredText(2_000),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.decision === "select_source_component" &&
      !input.selectedComponentId
    ) {
      context.addIssue({
        code: "custom",
        path: ["selectedComponentId"],
        message: "Selecting a conflict requires a source component",
      });
    }
    if (
      input.decision === "exclude_identity" &&
      input.selectedComponentId !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["selectedComponentId"],
        message: "Excluded identities cannot select a source component",
      });
    }
  });

export const resolveSbomCompositeRelationshipInputSchema = z
  .object({
    decision: z.enum(["include", "exclude"]),
    reason: requiredText(2_000),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const generateSbomCompositeInputSchema = z
  .object({ idempotencyKey: idempotencyKeySchema })
  .strict();

export const sbomCompositeReviewsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: cursorSchema.optional(),
    state: sbomCompositeReviewStateSchema.optional(),
  })
  .strict();
export const sbomCompositeReviewsResponseSchema = z
  .object({
    reviews: z.array(sbomCompositeReviewSchema).max(100),
    nextCursor: cursorSchema.nullable(),
  })
  .strict();
export const sbomCompositeReviewResponseSchema = z
  .object({ review: sbomCompositeReviewSchema })
  .strict();
export const sbomCompositeGenerationResponseSchema = z
  .object({
    review: sbomCompositeReviewSchema,
    replayed: z.boolean(),
  })
  .strict();
