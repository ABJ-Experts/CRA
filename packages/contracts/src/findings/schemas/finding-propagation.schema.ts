import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";
import { utcZDateTimeSchema } from "../../products/schemas/release-market-lifecycle.schema.js";
import { z } from "zod";

const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);
const expectedVersionSchema = z.number().int().nonnegative();
const graphVersionSchema = z.number().int().nonnegative();
const sourceScopeIssue = (
  value: Readonly<{
    sourceReleaseId?: string | null | undefined;
    sourceBaselineRevisionId?: string | null | undefined;
  }>,
  context: z.RefinementCtx,
) => {
  const hasRelease =
    value.sourceReleaseId !== null && value.sourceReleaseId !== undefined;
  const hasBaseline =
    value.sourceBaselineRevisionId !== null &&
    value.sourceBaselineRevisionId !== undefined;
  if (hasRelease === hasBaseline) {
    context.addIssue({
      code: "custom",
      message: "Provide exactly one finding propagation source scope",
      path: ["sourceReleaseId"],
    });
  }
};
const effectiveIntervalIssue = (
  value: Readonly<{
    effectiveStartsAt: string;
    effectiveEndsAt?: string | null | undefined;
  }>,
  context: z.RefinementCtx,
) => {
  if (
    value.effectiveEndsAt !== null &&
    value.effectiveEndsAt !== undefined &&
    Date.parse(value.effectiveEndsAt) <= Date.parse(value.effectiveStartsAt)
  ) {
    context.addIssue({
      code: "custom",
      message: "The effective end must be after the effective start",
      path: ["effectiveEndsAt"],
    });
  }
};

export const FINDING_PROPAGATION_MAX_PATH_DEPTH = 64;
export const FINDING_PROPAGATION_MAX_PAGE_SIZE = 100;

export const findingPropagationSourceStatusSchema = z.enum([
  "active",
  "resolved",
  "archived",
]);
export const findingImpactAssociationStatusSchema = z.enum([
  "candidate",
  "active",
  "superseded",
  "closed",
]);
export const findingProductImpactOverrideStateSchema = z.enum([
  "applicable",
  "not_applicable",
  "accepted_risk",
  "suppressed",
]);
export const findingPropagationJobStateSchema = z.enum([
  "scheduled",
  "leased",
  "retrying",
  "completed",
  "dead_letter",
  "obsolete",
]);
export const findingImpactPropagationStateSchema = z.enum([
  "idle",
  "in_progress",
  "partial_failure",
  "stale",
]);

const sourceFindingScopeInput = {
  sourceProductId: z.uuid(),
  sourceReleaseId: z.uuid().optional(),
  sourceBaselineRevisionId: z.uuid().optional(),
};
const sourceFindingScope = {
  sourceProductId: z.uuid(),
  sourceReleaseId: z.uuid().nullable(),
  sourceBaselineRevisionId: z.uuid().nullable(),
};
const sourceFindingIdentityInput = {
  sourceSystem: requiredText(100),
  sourceFindingKey: requiredText(256),
};
const sourceFindingIdentity = {
  sourceSystem: requiredText(100),
  sourceFindingKey: requiredText(256),
};
const propagationScope = {
  sourceReleaseId: z.uuid().nullable(),
  sourceBaselineRevisionId: z.uuid().nullable(),
};
const relationshipTraversalCursorSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}:(?:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})?$/i,
    "Use a canonical relationship traversal cursor",
  );
const relationshipPathHashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/i, "Use a SHA-256 relationship path hash");

/** Route parameters for the source owner boundary. */
export const findingPropagationSourceParamsSchema = z
  .object({ sourceId: z.uuid() })
  .strict();

/** Route parameters for one product-specific override. */
export const findingProductImpactOverrideParamsSchema = z
  .object({
    productId: z.uuid(),
    sourceId: z.uuid(),
    overrideId: z.uuid(),
  })
  .strict();

/** Create routes cannot accept a server-generated override identifier. */
export const createFindingProductImpactOverrideParamsSchema = z
  .object({ productId: z.uuid(), sourceId: z.uuid() })
  .strict();

/** A release filter is optional because impacts can be product-wide. */
export const findingImpactSummaryQuerySchema = z
  .object({ releaseId: z.uuid().optional() })
  .strict();

/**
 * The source finding is intentionally opaque. This feature records only its
 * stable tenant-local identifier and propagation scope, never title, evidence,
 * SBOM, analyst assessment, CVE, or severity data.
 */
export const registerFindingPropagationSourceInputSchema = z
  .object({
    ...sourceFindingIdentityInput,
    ...sourceFindingScopeInput,
    ruleVersion: requiredText(100),
    source: requiredText(1_000),
    provenance: requiredText(1_000),
    idempotencyKey: idempotencyKeySchema,
    correlationId: z.uuid(),
  })
  .strict()
  .superRefine(sourceScopeIssue);

/**
 * Updates are full replacement commands so changing release/baseline scope is
 * never ambiguous. The persistence boundary uses `expectedVersion` to reject
 * concurrent writers and schedules a new propagation evaluation atomically.
 */
export const updateFindingPropagationSourceInputSchema = z
  .object({
    ...sourceFindingScopeInput,
    ruleVersion: requiredText(100),
    status: findingPropagationSourceStatusSchema,
    reason: requiredText(1_000),
    source: requiredText(1_000),
    provenance: requiredText(1_000),
    expectedVersion: expectedVersionSchema,
    idempotencyKey: idempotencyKeySchema,
    correlationId: z.uuid(),
  })
  .strict()
  .superRefine(sourceScopeIssue);

export const findingPropagationSourceSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    ...sourceFindingIdentity,
    ...sourceFindingScope,
    ruleVersion: requiredText(100),
    status: findingPropagationSourceStatusSchema,
    source: requiredText(1_000),
    provenance: requiredText(1_000),
    version: expectedVersionSchema,
    createdAt: utcZDateTimeSchema,
    createdBy: z.uuid(),
    updatedAt: utcZDateTimeSchema,
    updatedBy: z.uuid(),
  })
  .strict()
  .superRefine(sourceScopeIssue);

/** Minimal mutation result. A source read/history route owns the full row. */
export const findingPropagationSourceMutationSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    status: findingPropagationSourceStatusSchema,
    version: expectedVersionSchema,
  })
  .strict();
export const findingPropagationSourceMutationResponseSchema = z
  .object({
    source: findingPropagationSourceMutationSchema,
    jobId: z.uuid(),
    idempotent: z.boolean(),
  })
  .strict();

/** A single historical impact; it never contains an analyst assessment. */
export const findingImpactAssociationSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    sourceId: z.uuid(),
    affectedProductId: z.uuid(),
    affectedReleaseId: z.uuid().nullable(),
    relationshipPathIds: z
      .array(z.uuid())
      .max(FINDING_PROPAGATION_MAX_PATH_DEPTH),
    relationshipPathHash: relationshipPathHashSchema,
    sourceGraphVersion: graphVersionSchema,
    ruleVersion: requiredText(100),
    status: findingImpactAssociationStatusSchema,
    firstEvaluatedAt: utcZDateTimeSchema,
    lastEvaluatedAt: utcZDateTimeSchema,
    supersededAt: utcZDateTimeSchema.nullable(),
    lastSeenJobId: z.uuid().nullable(),
    version: expectedVersionSchema,
    createdAt: utcZDateTimeSchema,
    updatedAt: utcZDateTimeSchema,
  })
  .strict()
  .superRefine((association, context) => {
    if (
      association.status === "superseded" &&
      association.supersededAt === null
    ) {
      context.addIssue({
        code: "custom",
        message: "Superseded impacts require a superseded timestamp",
        path: ["supersededAt"],
      });
    }
  });

export const findingProductImpactOverrideSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    sourceId: z.uuid(),
    affectedProductId: z.uuid(),
    affectedReleaseId: z.uuid().nullable(),
    overrideState: findingProductImpactOverrideStateSchema,
    reason: requiredText(1_000),
    source: requiredText(1_000),
    provenance: requiredText(1_000),
    effectiveStartsAt: utcZDateTimeSchema,
    effectiveEndsAt: utcZDateTimeSchema.nullable(),
    version: expectedVersionSchema,
    createdAt: utcZDateTimeSchema,
    createdBy: z.uuid(),
    updatedAt: utcZDateTimeSchema,
    updatedBy: z.uuid(),
    endedAt: utcZDateTimeSchema.nullable(),
    endedBy: z.uuid().nullable(),
    endReason: requiredText(1_000).nullable(),
  })
  .strict()
  .superRefine(effectiveIntervalIssue)
  .superRefine((override, context) => {
    const ended = override.endedAt !== null;
    if (ended !== (override.endedBy !== null)) {
      context.addIssue({
        code: "custom",
        message: "Ended overrides must retain the ending actor",
        path: ["endedBy"],
      });
    }
    if (ended !== (override.endReason !== null)) {
      context.addIssue({
        code: "custom",
        message: "Ended overrides must retain the ending reason",
        path: ["endReason"],
      });
    }
  });

export const createFindingProductImpactOverrideInputSchema = z
  .object({
    affectedReleaseId: z.uuid().nullable(),
    overrideState: findingProductImpactOverrideStateSchema,
    reason: requiredText(1_000),
    source: requiredText(1_000),
    provenance: requiredText(1_000),
    effectiveStartsAt: utcZDateTimeSchema,
    effectiveEndsAt: utcZDateTimeSchema.optional(),
    idempotencyKey: idempotencyKeySchema,
    correlationId: z.uuid(),
  })
  .strict()
  .superRefine(effectiveIntervalIssue);

export const endFindingProductImpactOverrideInputSchema = z
  .object({
    expectedVersion: expectedVersionSchema,
    reason: requiredText(1_000),
    idempotencyKey: idempotencyKeySchema,
    correlationId: z.uuid(),
  })
  .strict();

export const findingProductImpactOverrideResponseSchema = z
  .object({
    override: findingProductImpactOverrideSchema,
    idempotent: z.boolean(),
  })
  .strict();

/** Aggregate-only product view: no finding evidence or narrative may cross it. */
export const findingImpactSummarySchema = z
  .object({
    productId: z.uuid(),
    releaseId: z.uuid().nullable(),
    activeImpactCount: z.number().int().nonnegative(),
    supersededImpactCount: z.number().int().nonnegative(),
    closedImpactCount: z.number().int().nonnegative(),
    overrideCount: z.number().int().nonnegative(),
    latestGraphVersion: graphVersionSchema.nullable(),
    latestEvaluatedAt: utcZDateTimeSchema.nullable(),
    propagationState: findingImpactPropagationStateSchema,
    queuedJobCount: z.number().int().nonnegative(),
    inProgressJobCount: z.number().int().nonnegative(),
    retryingJobCount: z.number().int().nonnegative(),
    deadLetterJobCount: z.number().int().nonnegative(),
  })
  .strict();

export const findingImpactSummaryResponseSchema = z
  .object({ summary: findingImpactSummarySchema })
  .strict();

/**
 * Product-owned graph events are projected into this sanitized command. A
 * finding adapter may use it to select its own sources, but it must not inspect
 * product outbox payloads or product tables directly.
 */
const findingPropagationEventScopeCommonSchema = z.object({
  organizationId: z.uuid(),
  eventId: z.uuid(),
  eventKey: requiredText(263),
  graphVersion: graphVersionSchema,
  sourceProductId: z.uuid(),
  correlationId: z.uuid(),
  occurredAt: utcZDateTimeSchema,
});

/**
 * Graph events deliberately distinguish a product-wide change from a release
 * or baseline change. This is a cross-module boundary, so the worker cannot
 * infer scope from nullable identifiers.
 */
export const findingPropagationEnqueueScopeSchema = z.discriminatedUnion(
  "scopeKind",
  [
    findingPropagationEventScopeCommonSchema
      .extend({ scopeKind: z.literal("product") })
      .strict(),
    findingPropagationEventScopeCommonSchema
      .extend({
        scopeKind: z.literal("release"),
        sourceReleaseId: z.uuid(),
      })
      .strict(),
    findingPropagationEventScopeCommonSchema
      .extend({
        scopeKind: z.literal("baseline"),
        sourceBaselineRevisionId: z.uuid(),
      })
      .strict(),
  ],
);

/** One bounded, idempotent source-selection page for a product graph event. */
const findingPropagationSourcePageCommonSchema = z.object({
  organizationId: z.uuid(),
  eventId: z.uuid(),
  eventKey: requiredText(263),
  graphVersion: graphVersionSchema,
  correlationId: z.uuid(),
  occurredAt: utcZDateTimeSchema,
  asOf: utcZDateTimeSchema,
  cursor: z.uuid().nullable(),
  pageSize: z.number().int().min(1).max(FINDING_PROPAGATION_MAX_PAGE_SIZE),
});

export const enqueueFindingPropagationSourcePageInputSchema =
  z.discriminatedUnion("scopeKind", [
    findingPropagationSourcePageCommonSchema
      .extend({ scopeKind: z.literal("product"), sourceProductId: z.uuid() })
      .strict(),
    findingPropagationSourcePageCommonSchema
      .extend({
        scopeKind: z.literal("release"),
        sourceProductId: z.uuid(),
        sourceReleaseId: z.uuid(),
      })
      .strict(),
    findingPropagationSourcePageCommonSchema
      .extend({
        scopeKind: z.literal("baseline"),
        sourceProductId: z.uuid(),
        sourceBaselineRevisionId: z.uuid(),
      })
      .strict(),
  ]);

/** Parsed RPC result; no source-finding material leaves the database. */
export const enqueueFindingPropagationSourcePageResultSchema = z
  .object({
    outcome: z.enum(["enqueued_page", "obsolete", "invalid_request"]),
    sourceCount: z.number().int().min(0).max(FINDING_PROPAGATION_MAX_PAGE_SIZE),
    nextCursor: z.uuid().nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.outcome !== "enqueued_page" && value.nextCursor !== null) {
      context.addIssue({
        code: "custom",
        message: "Only an enqueued source page may retain a cursor",
        path: ["nextCursor"],
      });
    }
  });

/** Durable worker row. A lease never exposes source-finding evidence. */
export const findingPropagationJobSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    sourceId: z.uuid(),
    ...propagationScope,
    graphVersion: graphVersionSchema,
    ruleVersion: requiredText(100),
    triggerKey: requiredText(300),
    asOf: utcZDateTimeSchema,
    status: findingPropagationJobStateSchema,
    cursor: relationshipTraversalCursorSchema.nullable(),
    checkpointVersion: z.number().int().nonnegative(),
    processedCount: z.number().int().nonnegative(),
    upsertedCount: z.number().int().nonnegative(),
    supersededCount: z.number().int().nonnegative(),
    deliveryAttempts: z.number().int().nonnegative(),
    leaseOwner: z.uuid().nullable(),
    leaseExpiresAt: utcZDateTimeSchema.nullable(),
    dueAt: utcZDateTimeSchema,
    lastErrorCode: z
      .string()
      .regex(/^[a-z0-9][a-z0-9_.:-]{0,99}$/)
      .nullable(),
    requestedBy: z.uuid(),
    createdAt: utcZDateTimeSchema,
    updatedAt: utcZDateTimeSchema,
  })
  .strict()
  .superRefine(sourceScopeIssue)
  .superRefine((job, context) => {
    const hasLease = job.leaseOwner !== null && job.leaseExpiresAt !== null;
    if (job.status === "leased" && !hasLease) {
      context.addIssue({
        code: "custom",
        message: "Leased propagation jobs require an active lease",
        path: ["leaseOwner"],
      });
    }
    if (
      job.status !== "leased" &&
      (job.leaseOwner !== null || job.leaseExpiresAt !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Only leased propagation jobs may retain a lease",
        path: ["leaseOwner"],
      });
    }
  });

export const claimFindingPropagationJobInputSchema = z
  .object({
    organizationId: z.uuid(),
    workerId: z.uuid(),
    leaseSeconds: z.number().int().min(1).max(3_600),
  })
  .strict();

export const findingPropagationPageCandidateSchema = z
  .object({
    productId: z.uuid(),
    releaseId: z.uuid().nullable(),
    relationshipPathIds: z
      .array(z.uuid())
      .max(FINDING_PROPAGATION_MAX_PATH_DEPTH),
    graphVersion: graphVersionSchema,
    evaluatedAt: utcZDateTimeSchema,
  })
  .strict();

/**
 * The job checkpoint and all page associations commit in one database
 * transaction. This command is intentionally bounded to one graph page.
 */
export const persistFindingPropagationPageInputSchema = z
  .object({
    organizationId: z.uuid(),
    jobId: z.uuid(),
    leaseOwner: z.uuid(),
    expectedCheckpointVersion: z.number().int().nonnegative(),
    candidates: z
      .array(findingPropagationPageCandidateSchema)
      .max(FINDING_PROPAGATION_MAX_PAGE_SIZE),
    nextCursor: relationshipTraversalCursorSchema.nullable(),
    isFinal: z.boolean(),
  })
  .strict();
