import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";
import { z } from "zod";

import { productParamsSchema } from "./product.schema.js";
import { utcZDateTimeSchema } from "./release-market-lifecycle.schema.js";

const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);
const expectedVersionSchema = z.number().int().nonnegative();
const graphVersionSchema = z.number().int().nonnegative();
const relationshipReasonSchema = requiredText(1_000);
const relationshipSourceSchema = requiredText(1_000);
const relationshipProvenanceSchema = requiredText(1_000);
const relationshipQuantitySchema = z.number().int().positive().max(1_000_000);
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

export const PRODUCT_RELATIONSHIP_MAX_DEPTH = 64;

export const productRelationshipTypeSchema = z.enum(["embedded", "variant"]);
export const productVariantSourceTypeSchema = z.enum([
  "base_release",
  "baseline_revision",
]);

/**
 * The product outbox exposes only the source selection needed by the finding
 * boundary. A discriminator makes product-wide component changes explicit;
 * null-pair conventions allowed malformed events to be retried forever.
 */
export const productRelationshipGraphEventScopeSchema = z.discriminatedUnion(
  "scopeKind",
  [
    z
      .object({
        scopeKind: z.literal("product"),
        sourceProductId: z.uuid(),
      })
      .strict(),
    z
      .object({
        scopeKind: z.literal("release"),
        sourceProductId: z.uuid(),
        sourceReleaseId: z.uuid(),
      })
      .strict(),
    z
      .object({
        scopeKind: z.literal("baseline"),
        sourceProductId: z.uuid(),
        sourceBaselineRevisionId: z.uuid(),
      })
      .strict(),
  ],
);

/** Opaque, bounded checkpoint used only by the durable graph-event worker. */
export const productRelationshipGraphEventCursorSchema = z
  .string()
  .trim()
  .min(1)
  .max(160);

export const productRelationshipGraphEventCheckpointSchema = z
  .object({
    deliveryCursor: productRelationshipGraphEventCursorSchema.nullable(),
    isFinal: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.isFinal && value.deliveryCursor !== null) {
      context.addIssue({
        code: "custom",
        message: "A final graph-event checkpoint cannot retain a cursor",
        path: ["deliveryCursor"],
      });
    }
    if (!value.isFinal && value.deliveryCursor === null) {
      context.addIssue({
        code: "custom",
        message: "A non-final graph-event checkpoint requires a cursor",
        path: ["deliveryCursor"],
      });
    }
  });

/** A stable baseline identity with its current immutable revision projection. */
export const softwareBaselineSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    baselineId: z.uuid(),
    revisionNumber: z.number().int().positive(),
    identifier: requiredText(128),
    name: requiredText(200),
    description: z.string().trim().min(1).max(4_000).nullable(),
    revisionSummary: requiredText(1_000),
    source: relationshipSourceSchema,
    provenance: relationshipProvenanceSchema,
    effectiveStartsAt: utcZDateTimeSchema,
    effectiveEndsAt: utcZDateTimeSchema.nullable(),
    version: expectedVersionSchema,
    archivedAt: utcZDateTimeSchema.nullable(),
    createdAt: utcZDateTimeSchema,
    createdBy: z.uuid(),
    updatedAt: utcZDateTimeSchema,
    updatedBy: z.uuid(),
  })
  .strict()
  .superRefine(effectiveIntervalIssue);

/** An immutable historic view of one revision of a stable software baseline. */
export const softwareBaselineRevisionSchema = softwareBaselineSchema;

export const softwareBaselineReleaseMembershipSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    productId: z.uuid(),
    releaseId: z.uuid(),
    baselineId: z.uuid(),
    baselineRevisionId: z.uuid(),
    baselineRevisionNumber: z.number().int().positive(),
    source: relationshipSourceSchema,
    provenance: relationshipProvenanceSchema,
    effectiveStartsAt: utcZDateTimeSchema,
    effectiveEndsAt: utcZDateTimeSchema.nullable(),
    assignedAt: utcZDateTimeSchema,
    assignedBy: z.uuid(),
    endedAt: utcZDateTimeSchema.nullable(),
    endedBy: z.uuid().nullable(),
    endReason: relationshipReasonSchema.nullable(),
    version: expectedVersionSchema,
    updatedAt: utcZDateTimeSchema,
    updatedBy: z.uuid(),
  })
  .strict()
  .superRefine((membership, context) => {
    const isEnded = membership.endedAt !== null;
    if (isEnded !== (membership.endedBy !== null)) {
      context.addIssue({
        code: "custom",
        message: "Ended memberships must retain the ending actor",
        path: ["endedBy"],
      });
    }
    if (isEnded !== (membership.endReason !== null)) {
      context.addIssue({
        code: "custom",
        message: "Ended memberships must retain the ending reason",
        path: ["endReason"],
      });
    }
  })
  .superRefine(effectiveIntervalIssue);

const relationshipFactsSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  source: relationshipSourceSchema,
  provenance: relationshipProvenanceSchema,
  reason: relationshipReasonSchema,
  effectiveStartsAt: utcZDateTimeSchema,
  effectiveEndsAt: utcZDateTimeSchema.nullable(),
  createdAt: utcZDateTimeSchema,
  createdBy: z.uuid(),
  endedAt: utcZDateTimeSchema.nullable(),
  endedBy: z.uuid().nullable(),
  endReason: relationshipReasonSchema.nullable(),
  version: expectedVersionSchema,
  updatedAt: utcZDateTimeSchema,
  updatedBy: z.uuid(),
});

const endedRelationshipFactsSchema = relationshipFactsSchema.superRefine(
  (relationship, context) => {
    const isEnded = relationship.endedAt !== null;
    if (isEnded !== (relationship.endedBy !== null)) {
      context.addIssue({
        code: "custom",
        message: "Ended relationships must retain the ending actor",
        path: ["endedBy"],
      });
    }
    if (isEnded !== (relationship.endReason !== null)) {
      context.addIssue({
        code: "custom",
        message: "Ended relationships must retain the ending reason",
        path: ["endReason"],
      });
    }
  },
);

/** The variant view of the generic, history-preserving relationship record. */
export const productVariantRelationshipSchema = endedRelationshipFactsSchema
  .extend({
    relationshipType: z.literal("variant"),
    sourceType: productVariantSourceTypeSchema,
    sourceProductId: z.uuid().nullable(),
    targetProductId: z.uuid(),
    sourceReleaseId: z.uuid().nullable(),
    targetReleaseId: z.uuid(),
    baselineRevisionId: z.uuid().nullable(),
  })
  .strict()
  .superRefine((relationship, context) => {
    const hasBaseRelease = relationship.sourceReleaseId !== null;
    const hasBaselineRevision = relationship.baselineRevisionId !== null;
    if (hasBaseRelease === hasBaselineRevision) {
      context.addIssue({
        code: "custom",
        message:
          "A variant must have exactly one source: a base release or baseline revision",
        path: ["sourceType"],
      });
    }
    if (
      relationship.sourceType === "base_release" &&
      (relationship.sourceProductId === null || !hasBaseRelease)
    ) {
      context.addIssue({
        code: "custom",
        message: "A base-release variant requires its base product and release",
        path: ["sourceReleaseId"],
      });
    }
    if (
      relationship.sourceType === "baseline_revision" &&
      (relationship.sourceProductId !== null || !hasBaselineRevision)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A baseline-revision variant cannot also retain a base product",
        path: ["baselineRevisionId"],
      });
    }
  })
  .superRefine(effectiveIntervalIssue);

/** The embedded-component view of the generic relationship record. */
export const productComponentLinkSchema = endedRelationshipFactsSchema
  .extend({
    relationshipType: z.literal("embedded"),
    parentProductId: z.uuid(),
    componentProductId: z.uuid(),
    parentReleaseId: z.uuid().nullable(),
    componentReleaseId: z.uuid().nullable(),
    quantity: relationshipQuantitySchema,
  })
  .strict()
  .refine(
    ({ parentProductId, componentProductId }) =>
      parentProductId !== componentProductId,
    {
      message: "A product cannot be its own embedded component",
      path: ["componentProductId"],
    },
  )
  .superRefine(effectiveIntervalIssue);

const baselineRevisionInputSchema = z.object({
  name: requiredText(200),
  description: z.string().trim().min(1).max(4_000).nullable().optional(),
  revisionSummary: requiredText(1_000),
  source: relationshipSourceSchema,
  provenance: relationshipProvenanceSchema,
  effectiveStartsAt: utcZDateTimeSchema,
  effectiveEndsAt: utcZDateTimeSchema.optional(),
});

export const createSoftwareBaselineInputSchema = baselineRevisionInputSchema
  .extend({
    identifier: requiredText(128),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict()
  .superRefine(effectiveIntervalIssue);
export const appendSoftwareBaselineRevisionInputSchema =
  baselineRevisionInputSchema
    .extend({
      expectedVersion: expectedVersionSchema,
      idempotencyKey: idempotencyKeySchema,
    })
    .strict()
    .superRefine(effectiveIntervalIssue);
export const archiveSoftwareBaselineInputSchema = z
  .object({
    expectedVersion: expectedVersionSchema,
    reason: relationshipReasonSchema,
  })
  .strict();

export const assignSoftwareBaselineMembershipInputSchema = z
  .object({
    releaseId: z.uuid(),
    baselineId: z.uuid(),
    baselineRevisionId: z.uuid(),
    expectedBaselineVersion: expectedVersionSchema,
    source: relationshipSourceSchema,
    provenance: relationshipProvenanceSchema,
    effectiveStartsAt: utcZDateTimeSchema,
    effectiveEndsAt: utcZDateTimeSchema.optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict()
  .superRefine(effectiveIntervalIssue);
export const endSoftwareBaselineMembershipInputSchema = z
  .object({
    expectedVersion: expectedVersionSchema,
    reason: relationshipReasonSchema,
    effectiveEndsAt: utcZDateTimeSchema,
  })
  .strict();

const variantSourceInputSchema = z
  .object({
    sourceType: productVariantSourceTypeSchema,
    baseReleaseId: z.uuid().optional(),
    baselineRevisionId: z.uuid().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    const hasBaseRelease = input.baseReleaseId !== undefined;
    const hasBaselineRevision = input.baselineRevisionId !== undefined;
    if (hasBaseRelease === hasBaselineRevision) {
      context.addIssue({
        code: "custom",
        message: "Provide exactly one variant source",
        path: ["sourceType"],
      });
      return;
    }
    if (input.sourceType === "base_release" && !hasBaseRelease) {
      context.addIssue({
        code: "custom",
        message: "A base-release variant requires baseReleaseId",
        path: ["baseReleaseId"],
      });
    }
    if (input.sourceType === "baseline_revision" && !hasBaselineRevision) {
      context.addIssue({
        code: "custom",
        message: "A baseline-revision variant requires baselineRevisionId",
        path: ["baselineRevisionId"],
      });
    }
  });

export const createProductVariantRelationshipInputSchema =
  variantSourceInputSchema
    .extend({
      variantProductId: z.uuid(),
      variantReleaseId: z.uuid(),
      source: relationshipSourceSchema,
      provenance: relationshipProvenanceSchema,
      reason: relationshipReasonSchema,
      effectiveStartsAt: utcZDateTimeSchema,
      effectiveEndsAt: utcZDateTimeSchema.optional(),
      expectedGraphVersion: graphVersionSchema,
      idempotencyKey: idempotencyKeySchema,
    })
    .strict()
    .superRefine(effectiveIntervalIssue);
export const endProductVariantRelationshipInputSchema = z
  .object({
    expectedVersion: expectedVersionSchema,
    expectedGraphVersion: graphVersionSchema,
    reason: relationshipReasonSchema,
    effectiveEndsAt: utcZDateTimeSchema,
  })
  .strict();

const productComponentLinkInputSchema = z
  .object({
    componentProductId: z.uuid(),
    parentReleaseId: z.uuid().optional(),
    componentReleaseId: z.uuid().optional(),
    quantity: relationshipQuantitySchema,
    source: relationshipSourceSchema,
    provenance: relationshipProvenanceSchema,
    reason: relationshipReasonSchema,
    effectiveStartsAt: utcZDateTimeSchema,
    effectiveEndsAt: utcZDateTimeSchema.optional(),
    expectedGraphVersion: graphVersionSchema,
  })
  .strict();
export const previewProductComponentLinkInputSchema =
  productComponentLinkInputSchema.superRefine(effectiveIntervalIssue);
export const createProductComponentLinkInputSchema =
  productComponentLinkInputSchema
    .extend({ idempotencyKey: idempotencyKeySchema })
    .strict()
    .superRefine(effectiveIntervalIssue);
/**
 * Component changes are explicit successor decisions; callers retain the old
 * link's reason and version while supplying the complete replacement scope.
 */
export const supersedeProductComponentLinkInputSchema =
  productComponentLinkInputSchema
    .extend({
      expectedVersion: expectedVersionSchema,
      reason: relationshipReasonSchema,
      idempotencyKey: idempotencyKeySchema,
    })
    .strict()
    .superRefine(effectiveIntervalIssue);
/** @deprecated Prefer the explicit supersede command for a historic link. */
export const updateProductComponentLinkInputSchema =
  supersedeProductComponentLinkInputSchema;
export const endProductComponentLinkInputSchema = z
  .object({
    expectedVersion: expectedVersionSchema,
    expectedGraphVersion: graphVersionSchema,
    reason: relationshipReasonSchema,
    effectiveEndsAt: utcZDateTimeSchema,
  })
  .strict();

export const softwareBaselineParamsSchema = z
  .object({ baselineId: z.uuid() })
  .strict();
export const softwareBaselineMembershipParamsSchema = z
  .object({ ...productParamsSchema.shape, membershipId: z.uuid() })
  .strict();
export const productRelationshipParamsSchema = z
  .object({ ...productParamsSchema.shape, relationshipId: z.uuid() })
  .strict();
export const productVariantRelationshipParamsSchema =
  productRelationshipParamsSchema;
export const productComponentLinkParamsSchema = productRelationshipParamsSchema;

const rawBoolean = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

/** Bounded searchable current-revision projection for baseline selectors. */
export const softwareBaselineListQuerySchema = z
  .object({
    cursor: z.uuid().optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    q: z.string().trim().min(1).max(128).optional(),
    includeArchived: rawBoolean.optional(),
  })
  .strict();
export const productRelationshipGraphQuerySchema = z
  .object({
    asOf: utcZDateTimeSchema.optional(),
    rootReleaseId: z.uuid().optional(),
    maxDepth: z.coerce
      .number()
      .int()
      .min(1)
      .max(PRODUCT_RELATIONSHIP_MAX_DEPTH)
      .default(PRODUCT_RELATIONSHIP_MAX_DEPTH),
    includeEnded: rawBoolean.optional(),
  })
  .strict();

const propagationSourceQuerySchema = z
  .object({
    sourceReleaseId: z.uuid().optional(),
    sourceBaselineRevisionId: z.uuid().optional(),
  })
  .strict()
  .superRefine((query, context) => {
    if (
      (query.sourceReleaseId !== undefined) ===
      (query.sourceBaselineRevisionId !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Provide exactly one propagation source",
        path: ["sourceReleaseId"],
      });
    }
  });

const relationshipPropagationCursorSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}:(?:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})?$/i,
  );

export const relationshipPropagationQuerySchema = propagationSourceQuerySchema
  .extend({
    graphVersion: graphVersionSchema,
    asOf: utcZDateTimeSchema.optional(),
    cursor: relationshipPropagationCursorSchema.optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export const relationshipPropagationEventsQuerySchema = z
  .object({
    cursor: z.string().trim().min(1).max(1_000).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    deliveryState: z
      .enum([
        "scheduled",
        "leased",
        "delivered",
        "retrying",
        "dead_letter",
        "obsolete",
      ])
      .optional(),
  })
  .strict();
export const requestRelationshipReevaluationInputSchema = z
  .object({
    expectedGraphVersion: graphVersionSchema,
    reason: relationshipReasonSchema,
    source: relationshipSourceSchema,
    provenance: relationshipProvenanceSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const productRelationshipGraphNodeSchema = z
  .object({
    productId: z.uuid(),
    releaseId: z.uuid().nullable(),
    depth: z.number().int().nonnegative().max(PRODUCT_RELATIONSHIP_MAX_DEPTH),
    relationshipPathIds: z.array(z.uuid()).max(PRODUCT_RELATIONSHIP_MAX_DEPTH),
  })
  .strict();
export const productRelationshipGraphSchema = z
  .object({
    organizationId: z.uuid(),
    rootProductId: z.uuid(),
    rootReleaseId: z.uuid().nullable(),
    graphVersion: graphVersionSchema,
    evaluatedAt: utcZDateTimeSchema,
    nodes: z.array(productRelationshipGraphNodeSchema),
    links: z.array(productComponentLinkSchema),
  })
  .strict();

export const productRelationshipPreviewSchema = z
  .object({
    outcome: z.enum(["allowed", "cycle_detected", "depth_exceeded"]),
    graphVersion: graphVersionSchema,
    candidateDepth: z
      .number()
      .int()
      .nonnegative()
      .max(PRODUCT_RELATIONSHIP_MAX_DEPTH + 1),
    relationshipPathIds: z.array(z.uuid()).max(PRODUCT_RELATIONSHIP_MAX_DEPTH),
    productPathIds: z.array(z.uuid()).max(PRODUCT_RELATIONSHIP_MAX_DEPTH + 1),
  })
  .strict();

export const relationshipPropagationCandidateSchema = z
  .object({
    productId: z.uuid(),
    releaseId: z.uuid().nullable(),
    relationshipPathIds: z.array(z.uuid()).max(PRODUCT_RELATIONSHIP_MAX_DEPTH),
    graphVersion: graphVersionSchema,
    evaluatedAt: utcZDateTimeSchema,
  })
  .strict();
export const relationshipPropagationEventSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    graphVersion: graphVersionSchema,
    eventKey: requiredText(1_000),
    eventType: z.literal("product_relationship.graph_changed"),
    deliveryState: z.enum([
      "scheduled",
      "leased",
      "delivered",
      "retrying",
      "dead_letter",
      "obsolete",
    ]),
    correlationId: z.uuid(),
    occurredAt: utcZDateTimeSchema,
    deliveredAt: utcZDateTimeSchema.nullable(),
    obsoleteAt: utcZDateTimeSchema.nullable().optional(),
    lastErrorCode: z.string().trim().min(1).max(100).nullable().optional(),
    retryCount: z.number().int().nonnegative(),
  })
  .strict();

export const softwareBaselineResponseSchema = z
  .object({ baseline: softwareBaselineSchema })
  .strict();
export const softwareBaselinesResponseSchema = z
  .object({ baselines: z.array(softwareBaselineSchema) })
  .strict();
export const softwareBaselineListResponseSchema = z
  .object({
    baselines: z
      .object({
        items: z.array(softwareBaselineSchema),
        nextCursor: z.uuid().nullable(),
      })
      .strict(),
  })
  .strict();
export const softwareBaselineRevisionResponseSchema = z
  .object({ revision: softwareBaselineRevisionSchema })
  .strict();
export const softwareBaselineRevisionsResponseSchema = z
  .object({ revisions: z.array(softwareBaselineRevisionSchema) })
  .strict();
export const softwareBaselineHistoryResponseSchema =
  softwareBaselinesResponseSchema;
export const softwareBaselineMembershipResponseSchema = z
  .object({ membership: softwareBaselineReleaseMembershipSchema })
  .strict();
export const softwareBaselineMembershipsResponseSchema = z
  .object({ memberships: z.array(softwareBaselineReleaseMembershipSchema) })
  .strict();
export const productVariantRelationshipResponseSchema = z
  .object({
    relationship: productVariantRelationshipSchema,
    graphVersion: graphVersionSchema,
  })
  .strict();
export const productVariantRelationshipsResponseSchema = z
  .object({ relationships: z.array(productVariantRelationshipSchema) })
  .strict();
export const productComponentLinkResponseSchema = z
  .object({
    relationship: productComponentLinkSchema,
    graphVersion: graphVersionSchema,
  })
  .strict();
export const productComponentLinksResponseSchema = z
  .object({ links: z.array(productComponentLinkSchema) })
  .strict();
export const productRelationshipGraphResponseSchema = z
  .object({ graph: productRelationshipGraphSchema })
  .strict();
export const productRelationshipPreviewResponseSchema = z
  .object({ preview: productRelationshipPreviewSchema })
  .strict();
export const relationshipPropagationCandidatesResponseSchema = z
  .object({
    candidates: z.array(relationshipPropagationCandidateSchema),
    nextCursor: z.string().nullable(),
    graphVersion: graphVersionSchema,
    evaluatedAt: utcZDateTimeSchema,
  })
  .strict();
export const relationshipPropagationEventsResponseSchema = z
  .object({
    events: z.array(relationshipPropagationEventSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export const requestRelationshipReevaluationResponseSchema = z
  .object({ event: relationshipPropagationEventSchema })
  .strict();
