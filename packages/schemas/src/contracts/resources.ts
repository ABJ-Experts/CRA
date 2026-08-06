// Resource contracts: one request and one response schema per endpoint.
//
// Named exports use the `<Resource><Verb>` convention so the generated OpenAPI
// component names read the same way in the document, the client and the UI.

import { z } from "zod";
import { isoDateTime, paginated, uuid } from "./common";
import {
  evidenceTamperState,
  falsePositiveReason,
  findingState,
  lifecycleState,
  matchMethod,
  obligationStage,
  obligationStageState,
  obligationState,
  obligationType,
  productType,
  sbomValidationStatus,
  vexJustification,
  vexStatus,
} from "./domain";

// --- Organisation -----------------------------------------------------------

export const createOrganisationRequest = z.object({
  legalName: z.string().min(1).max(200),
  /** ISO 3166-1 alpha-2. Decides the coordinating CSIRT (FR-ORG-001). */
  countryMainEstablishment: z.string().length(2),
  registeredAddress: z.string().max(500).optional(),
});

export const organisationResponse = z.object({
  id: uuid,
  legalName: z.string(),
  countryMainEstablishment: z.string(),
  /** Derived from the main establishment (FR-ORG-001). */
  coordinatingCsirt: z.string().nullable(),
  /** Resumable wizard progress (FR-ORG-002). Free-form jsonb by design. */
  onboardingState: z.unknown(),
});

/**
 * One row of "which organisations am I in, and as what". Feeds the post-sign-in
 * org picker, which runs BEFORE any tenant context exists — so this carries the
 * role key the caller needs to choose, and nothing tenant-scoped.
 */
export const membershipResponse = z.object({
  organisationId: uuid,
  legalName: z.string(),
  roleKey: z.string(),
  roleName: z.string(),
});

export const membershipListResponse = z.array(membershipResponse);

/** The active tenant principal, used by the UI only to present permitted actions. */
export const principalResponse = z.object({
  organisationId: uuid,
  roleKey: z.string(),
  permissions: z.array(z.string()),
  mfaSatisfied: z.boolean(),
});

/**
 * A create endpoint that returns only the new id.
 *
 * Modelled explicitly rather than reusing the full resource schema: the contract
 * has to describe what the handler actually returns, and POST /organisations
 * returns just the identifier. Claiming the full resource here would put fields
 * in the generated client that never arrive at runtime.
 */
export const createdResourceResponse = z.object({ id: uuid });
export type CreatedResourceResponse = z.infer<typeof createdResourceResponse>;

// --- Product ----------------------------------------------------------------

export const createProductRequest = z.object({
  name: z.string().min(1).max(200),
  internalCode: z.string().min(1).max(100),
  productType: productType.optional(),
});

export const productResponse = z.object({
  id: uuid,
  name: z.string(),
  internalCode: z.string(),
  productType: productType,
  lifecycleState: lifecycleState,
  /** FR-PROD-006: the date that starts the 10-year retention clock. */
  placedOnMarketAt: isoDateTime.nullable(),
  /** Optimistic lock (§8.3). A stale write returns 409 with the current state. */
  version: z.number().int(),
});

export const productListQuery = z.object({
  search: z.string().optional(),
  lifecycleState: lifecycleState.optional(),
  includeArchived: z.coerce.boolean().optional(),
});

export const productTransitionRequest = z.object({
  to: lifecycleState,
  /** Mandatory for placed_on_market — it anchors retention (FR-PROD-006). */
  placedOnMarketAt: isoDateTime.optional(),
});

// --- Release and SBOM -------------------------------------------------------

export const createReleaseRequest = z.object({
  productId: uuid,
  versionLabel: z.string().min(1).max(100),
});

export const releaseResponse = z.object({
  id: uuid,
  productId: uuid,
  versionLabel: z.string(),
  lifecycleState: lifecycleState,
  sbomCount: z.number().int(),
  createdAt: isoDateTime,
});

export const releaseListQuery = z.object({
  productId: uuid.optional(),
});

export const uploadSbomRequest = z.object({
  /** The raw CycloneDX or SPDX document. Persisted byte-exact (FR-SBOM-003). */
  document: z.string().min(1),
  /** Caller provenance (browser upload, CI, or integration); persisted with the evidence. */
  source: z.string().min(1).max(100).optional(),
});

export const sbomIngestResponse = z.object({
  ingest: z.object({
    sbomDocumentId: uuid,
    validationStatus: sbomValidationStatus,
    componentCount: z.number().int(),
    /** FR-SBOM-012: an identical upload links to the existing record. */
    deduplicated: z.boolean(),
  }),
  match: z.object({
    findingsCreated: z.number().int(),
    kevFindings: z.number().int(),
  }),
});

// --- Finding and triage -----------------------------------------------------

export const findingResponse = z.object({
  id: uuid,
  advisoryId: z.string(),
  matchMethod: matchMethod,
  /** §10.4: derived from method and data quality, never a model output. */
  matchConfidence: z.number(),
  cvssBase: z.number().nullable(),
  kevListed: z.boolean(),
  vexStatus: vexStatus,
  vexJustification: vexJustification.nullable(),
  state: findingState,
  /** FR-MATCH-003: collapsed by default in the queue, never hidden. */
  lowConfidence: z.boolean(),
  falsePositiveReason: falsePositiveReason.nullable(),
  version: z.number().int(),
});

export const findingListQuery = z.object({
  state: findingState.optional(),
  kevOnly: z.coerce.boolean().optional(),
  minCvss: z.coerce.number().optional(),
  productReleaseId: uuid.optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  minConfidence: z.coerce.number().min(0).max(1).optional(),
  /** Opaque keyset cursor from a previous page's nextCursor (§13.1). */
  cursor: z.string().optional(),
});

/** §13.1: "Cursor based on every collection. Offset pagination is banned." */
export const findingPageResponse = paginated(findingResponse);
export type FindingPageResponse = z.infer<typeof findingPageResponse>;

export const findingTransitionRequest = z.object({
  to: findingState,
  reason: z.string().optional(),
  /** Suppressions always expire (§8.3) — permanent suppression is not offered. */
  suppressionExpiresAt: isoDateTime.optional(),
});

export const vexAssessmentRequest = z.object({
  status: vexStatus,
  justification: vexJustification.optional(),
});

export const falsePositiveRequest = z.object({
  reason: falsePositiveReason,
});

export const falsePositiveRateResponse = z.object({
  dimension: z.enum(["method", "ecosystem", "feed"]),
  key: z.string(),
  total: z.number().int(),
  falsePositives: z.number().int(),
  rate: z.number(),
});

// --- Obligations ------------------------------------------------------------

export const obligationResponse = z.object({
  id: uuid,
  obligationType: obligationType,
  state: obligationState,
  /** The legally significant timestamp a person asserted (§8.3). */
  awarenessAt: isoDateTime,
  findingId: uuid.nullable(),
  productReleaseId: uuid.nullable(),
  /** Nearest running stage, computed server-side to avoid an N+1 UI query. */
  nextStage: obligationStage.nullable(),
  nextDueAt: isoDateTime.nullable(),
  overdue: z.boolean(),
  createdAt: isoDateTime,
});

export const obligationStageResponse = z.object({
  stage: obligationStage,
  anchorEvent: z.enum(["awareness", "remediation_available", "notification_submitted"]),
  /** Null while the stage is pending_anchor — the anchor has not happened yet. */
  dueAt: isoDateTime.nullable(),
  state: obligationStageState,
});

export const openObligationRequest = z.object({
  findingId: uuid,
  obligationType: obligationType.optional(),
  awarenessAt: isoDateTime.optional(),
  awarenessBasis: z.string().optional(),
});

export const recordAnchorRequest = z.object({
  anchor: z.enum(["awareness", "remediation_available", "notification_submitted"]),
  at: isoDateTime,
  /** FR-RPT-003: changing awareness_at requires a reason and re-anchors everything. */
  reason: z.string().optional(),
});

export const obligationTickResponse = z.object({
  stagesEvaluated: z.number().int(),
  notifications: z.array(
    z.object({
      obligationId: uuid,
      findingId: uuid.nullable(),
      stage: z.string(),
      kind: z.enum(["threshold", "overdue"]),
      threshold: z.number(),
      dueAt: isoDateTime,
    }),
  ),
});

// --- Evidence ---------------------------------------------------------------

export const uploadEvidenceRequest = z.object({
  title: z.string().min(1).max(300),
  classification: z.string().min(1),
  productId: uuid.optional(),
  validFrom: isoDateTime.optional(),
  validUntil: isoDateTime.optional(),
  /** Base64 payload. Large uploads move to pre-signed URLs at FR-API-005. */
  content: z.string(),
  contentType: z.string().optional(),
});

export const evidenceResponse = z.object({
  id: uuid,
  title: z.string(),
  classification: z.string(),
  productId: uuid.nullable(),
  /** FR-EVD-003: content hashing with tamper detection on retrieval. */
  contentHash: z.string(),
  sizeBytes: z.number().int(),
  tamperState: evidenceTamperState,
  uploadedAt: isoDateTime,
});

// --- Dashboard --------------------------------------------------------------

export const dashboardResponse = z.object({
  findingsBySeverity: z.object({
    critical: z.number().int(),
    high: z.number().int(),
    medium: z.number().int(),
    low: z.number().int(),
    unknown: z.number().int(),
  }),
  kevOpenCount: z.number().int(),
  activeObligations: z.array(
    z.object({
      obligationId: uuid,
      obligationType: z.string(),
      nextDueAt: isoDateTime.nullable(),
      nextStage: z.string().nullable(),
      overdue: z.boolean(),
    }),
  ),
  sbomCoverage: z.object({
    products: z.number().int(),
    releases: z.number().int(),
    releasesWithSbom: z.number().int(),
  }),
  ingestionHealth: z.object({
    valid: z.number().int(),
    validWithWarnings: z.number().int(),
    invalid: z.number().int(),
    lastIngestAt: isoDateTime.nullable(),
  }),
  generatedAt: isoDateTime,
});

export const healthResponse = z.object({ status: z.literal("ok") });

// Inferred types, so a consumer that already has the package does not need to
// round-trip through the generated client for a simple prop type.
export type OrganisationResponse = z.infer<typeof organisationResponse>;
export type MembershipResponse = z.infer<typeof membershipResponse>;
export type PrincipalResponse = z.infer<typeof principalResponse>;
export type ProductResponse = z.infer<typeof productResponse>;
export type ReleaseResponse = z.infer<typeof releaseResponse>;
export type SbomIngestResponse = z.infer<typeof sbomIngestResponse>;
export type FindingResponse = z.infer<typeof findingResponse>;
export type ObligationResponse = z.infer<typeof obligationResponse>;
export type ObligationStageResponse = z.infer<typeof obligationStageResponse>;
export type EvidenceResponse = z.infer<typeof evidenceResponse>;
export type DashboardResponse = z.infer<typeof dashboardResponse>;
export type FalsePositiveRateResponse = z.infer<typeof falsePositiveRateResponse>;
export type HealthResponse = z.infer<typeof healthResponse>;
