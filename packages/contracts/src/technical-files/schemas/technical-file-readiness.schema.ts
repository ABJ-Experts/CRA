import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";
import {
  technicalFileSectionKeySchema,
  technicalFileSourceKindSchema,
} from "./technical-file.schema.js";
import { z } from "zod";

const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);
const optionalText = (maximum: number) =>
  z.string().trim().max(maximum).nullable();
const expectedVersionSchema = z.number().int().positive();

/** Documentation readiness; never a legal or compliance certification. */
export const technicalFileReadinessStatusSchema = z.enum([
  "empty",
  "partial",
  "complete",
  "stale",
]);
export const technicalFileRecalculationStatusSchema = z.enum([
  "current",
  "recalculating",
  "failed",
]);
export const technicalFileEvidenceAvailabilitySchema = z.enum([
  "current",
  "stale",
  "unavailable",
]);
export const technicalFileMaterialChangeReasonSchema = z.enum([
  "product_facts_changed",
  "release_changed",
  "support_basis_changed",
  "risk_register_changed",
  "sbom_revision_changed",
  "source_validity_changed",
  "source_quarantined",
  "standard_edition_changed",
  "document_version_changed",
]);
export const technicalFileSourceReviewDecisionSchema = z.enum([
  "retain",
  "update",
]);
export const technicalFileReadinessGapCodeSchema = z.enum([
  "missing_narrative",
  "missing_evidence",
  "stale_evidence",
  "unavailable_evidence",
]);

export const technicalFileEvidenceLinkSchema = z
  .object({
    id: z.uuid(),
    sectionId: z.uuid(),
    sectionKey: technicalFileSectionKeySchema,
    sourceKind: technicalFileSourceKindSchema,
    recordId: z.uuid().nullable(),
    linkVersion: expectedVersionSchema,
    observedRevision: optionalText(200),
    // Older unavailable links may predate durable fingerprint capture. They
    // remain explicitly unavailable rather than being rejected at the wire
    // boundary or represented as invented evidence metadata.
    sourceFingerprint: optionalText(200),
    availability: technicalFileEvidenceAvailabilitySchema,
    staleAt: z.string().datetime({ offset: true }).nullable(),
    staleReason: technicalFileMaterialChangeReasonSchema.nullable(),
    currentObservedRevision: optionalText(200),
    currentFingerprint: optionalText(200),
    reviewedAt: z.string().datetime({ offset: true }).nullable(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((value, context) => {
    const stale = value.availability === "stale";
    if (stale && (!value.staleAt || !value.staleReason)) {
      context.addIssue({
        code: "custom",
        path: ["staleReason"],
        message: "Stale evidence needs a material-change reason",
      });
    }
    if (!stale && (value.staleAt || value.staleReason)) {
      context.addIssue({
        code: "custom",
        path: ["staleAt"],
        message: "Only stale evidence may carry stale metadata",
      });
    }
  });

export const technicalFileEvidenceReviewSchema = z
  .object({
    id: z.uuid(),
    sourceId: z.uuid(),
    decision: technicalFileSourceReviewDecisionSchema,
    rationale: requiredText(4_000),
    previousObservedRevision: optionalText(200),
    previousFingerprint: optionalText(200),
    reviewedObservedRevision: optionalText(200),
    reviewedFingerprint: optionalText(200),
    reviewedByUserId: z.uuid(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const technicalFileReadinessGapSchema = z
  .object({
    sectionKey: technicalFileSectionKeySchema,
    code: technicalFileReadinessGapCodeSchema,
    priority: z.number().int().min(1).max(100),
    actionLabel: requiredText(300),
  })
  .strict();

export const technicalFileSectionReadinessSchema = z
  .object({
    sectionKey: technicalFileSectionKeySchema,
    status: technicalFileReadinessStatusSchema,
    gapCount: z.number().int().nonnegative(),
    validEvidenceCount: z.number().int().nonnegative(),
    staleEvidenceCount: z.number().int().nonnegative(),
    unavailableEvidenceCount: z.number().int().nonnegative(),
    staleReasons: z.array(technicalFileMaterialChangeReasonSchema),
    gaps: z.array(technicalFileReadinessGapSchema),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "stale" && value.staleReasons.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["staleReasons"],
        message: "Stale sections must identify a material-change reason",
      });
    }
    if (value.gapCount !== value.gaps.length) {
      context.addIssue({
        code: "custom",
        path: ["gapCount"],
        message: "Gap count must match the actionable gap list",
      });
    }
  });

export const technicalFileReadinessSchema = z
  .object({
    technicalFileId: z.uuid(),
    overallStatus: technicalFileReadinessStatusSchema,
    recalculationStatus: technicalFileRecalculationStatusSchema,
    calculatedAt: z.string().datetime({ offset: true }).nullable(),
    sections: z.array(technicalFileSectionReadinessSchema),
    gaps: z.array(technicalFileReadinessGapSchema),
  })
  .strict();

export const technicalFileReadinessParamsSchema = z
  .object({ productId: z.uuid() })
  .strict();
export const technicalFileReadinessSourceParamsSchema =
  technicalFileReadinessParamsSchema
    .extend({ sectionKey: technicalFileSectionKeySchema, sourceId: z.uuid() })
    .strict();
export const reviewTechnicalFileSourceRequestSchema = z
  .object({
    expectedVersion: expectedVersionSchema,
    decision: technicalFileSourceReviewDecisionSchema,
    rationale: requiredText(4_000),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const signalTechnicalFileSourceMaterialChangeRequestSchema = z
  .object({
    expectedVersion: expectedVersionSchema,
    reason: technicalFileMaterialChangeReasonSchema,
    currentObservedRevision: optionalText(200),
    currentFingerprint: requiredText(200),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const recalculateTechnicalFileReadinessRequestSchema = z
  .object({ idempotencyKey: idempotencyKeySchema })
  .strict();

export const technicalFileReadinessResponseSchema = z
  .object({ readiness: technicalFileReadinessSchema })
  .strict();
export const technicalFileEvidenceLinkResponseSchema = z
  .object({ source: technicalFileEvidenceLinkSchema })
  .strict();
export const technicalFileEvidenceReviewResponseSchema = z
  .object({
    source: technicalFileEvidenceLinkSchema,
    review: technicalFileEvidenceReviewSchema,
  })
  .strict();
/** Narrow M8-04 projection: relationship state only, never document content. */
export const technicalFileEvidenceReverseLinkSchema = z
  .object({
    technicalFileId: z.uuid(),
    sectionId: z.uuid(),
    sectionKey: technicalFileSectionKeySchema,
    sourceId: z.uuid(),
    sourceFingerprint: optionalText(200),
    availability: technicalFileEvidenceAvailabilitySchema,
  })
  .strict();
export const technicalFileEvidenceReverseLinksResponseSchema = z
  .object({ links: z.array(technicalFileEvidenceReverseLinkSchema) })
  .strict();
export const technicalFileReadinessConflictResponseSchema = z
  .object({
    code: z.literal("version_conflict"),
    message: requiredText(500),
    currentVersion: expectedVersionSchema,
  })
  .strict();

export type TechnicalFileReadinessInput = Readonly<{
  sectionKey: z.output<typeof technicalFileSectionKeySchema>;
  applicability: "applicable" | "not_applicable";
  narrativePresent: boolean;
  validEvidenceCount: number;
  staleEvidenceCount: number;
  unavailableEvidenceCount: number;
}>;

export const calculateTechnicalFileReadiness = (
  sections: readonly TechnicalFileReadinessInput[],
) => {
  const applicable = sections.filter(
    (section) => section.applicability === "applicable",
  );
  const hasStaleEvidence = applicable.some(
    (section) => section.staleEvidenceCount > 0,
  );
  const hasIncompleteEvidence = applicable.some(
    (section) =>
      !section.narrativePresent ||
      section.validEvidenceCount === 0 ||
      section.unavailableEvidenceCount > 0,
  );
  const status = hasStaleEvidence
    ? "stale"
    : hasIncompleteEvidence
      ? applicable.every(
          (section) =>
            !section.narrativePresent && section.validEvidenceCount === 0,
        )
        ? "empty"
        : "partial"
      : "complete";
  const completeSectionCount = applicable.filter(
    (section) =>
      section.narrativePresent &&
      section.validEvidenceCount > 0 &&
      section.staleEvidenceCount === 0,
  ).length;
  return {
    overallStatus: status as z.output<
      typeof technicalFileReadinessStatusSchema
    >,
    applicableSectionCount: applicable.length,
    completeSectionCount,
    staleSectionCount: applicable.filter(
      (section) => section.staleEvidenceCount > 0,
    ).length,
  };
};
