import { describe, expect, expectTypeOf, it } from "vitest";

import {
  createFindingProductImpactOverrideInputSchema,
  createFindingProductImpactOverrideParamsSchema,
  endFindingProductImpactOverrideInputSchema,
  findingImpactAssociationSchema,
  findingImpactSummaryResponseSchema,
  findingProductImpactOverrideSchema,
  findingPropagationEnqueueScopeSchema,
  enqueueFindingPropagationSourcePageInputSchema,
  findingPropagationJobSchema,
  findingPropagationSourceMutationResponseSchema,
  findingPropagationSourceSchema,
  registerFindingPropagationSourceInputSchema,
  updateFindingPropagationSourceInputSchema,
} from "./findings.js";
import type {
  CreateFindingProductImpactOverrideParams,
  FindingImpactAssociation,
  FindingPropagationJob,
  FindingPropagationSource,
} from "./findings.js";

const ids = {
  organization: "11111111-1111-4111-8111-111111111111",
  source: "33333333-3333-4333-8333-333333333333",
  product: "44444444-4444-4444-8444-444444444444",
  release: "55555555-5555-4555-8555-555555555555",
  baselineRevision: "66666666-6666-4666-8666-666666666666",
  actor: "77777777-7777-4777-8777-777777777777",
  idempotency: "88888888-8888-4888-8888-888888888888",
  correlation: "99999999-9999-4999-8999-999999999999",
  job: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  impact: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};

const at = "2026-08-14T10:15:30.000Z";

describe("finding propagation contracts", () => {
  it("registers an opaque external finding identity with exactly one release or baseline scope", () => {
    const parsed = registerFindingPropagationSourceInputSchema.parse({
      sourceSystem: "sbom-correlation",
      sourceFindingKey: "finding-opaque-42",
      sourceProductId: ids.product,
      sourceReleaseId: ids.release,
      ruleVersion: "m2-v1",
      source: "SBOM correlation service",
      provenance: "Signed ingest batch 2026-08-14",
      idempotencyKey: ids.idempotency,
      correlationId: ids.correlation,
    });

    expect(parsed).toMatchObject({
      sourceSystem: "sbom-correlation",
      sourceFindingKey: "finding-opaque-42",
      sourceReleaseId: ids.release,
      ruleVersion: "m2-v1",
    });
    expectTypeOf<typeof parsed>().toMatchTypeOf<{
      sourceFindingKey: string;
      sourceReleaseId?: string;
    }>();

    expect(
      registerFindingPropagationSourceInputSchema.safeParse({
        ...parsed,
        sourceBaselineRevisionId: ids.baselineRevision,
      }).success,
    ).toBe(false);
    expect(
      registerFindingPropagationSourceInputSchema.safeParse({
        ...parsed,
        sourceReleaseId: undefined,
      }).success,
    ).toBe(false);
  });

  it("requires a complete optimistic, audited source replacement when source scope changes", () => {
    const parsed = updateFindingPropagationSourceInputSchema.parse({
      sourceProductId: ids.product,
      sourceBaselineRevisionId: ids.baselineRevision,
      ruleVersion: "m2-v2",
      status: "active",
      reason: "The finding now maps to the corrected baseline revision.",
      source: "SBOM correlation service",
      provenance: "Signed ingest batch 2026-08-14",
      expectedVersion: 4,
      idempotencyKey: ids.idempotency,
      correlationId: ids.correlation,
    });

    expect(parsed).toMatchObject({
      sourceBaselineRevisionId: ids.baselineRevision,
      expectedVersion: 4,
    });
    expect(
      updateFindingPropagationSourceInputSchema.safeParse({
        ...parsed,
        unexpected: true,
      }).success,
    ).toBe(false);
  });

  it("exposes only opaque source and aggregate impact facts to product detail", () => {
    const parsed = findingImpactSummaryResponseSchema.parse({
      summary: {
        productId: ids.product,
        releaseId: ids.release,
        activeImpactCount: 12,
        supersededImpactCount: 2,
        closedImpactCount: 1,
        overrideCount: 3,
        latestGraphVersion: 17,
        latestEvaluatedAt: at,
        propagationState: "partial_failure",
        queuedJobCount: 1,
        inProgressJobCount: 2,
        retryingJobCount: 1,
        deadLetterJobCount: 1,
      },
    });

    expect(parsed.summary.activeImpactCount).toBe(12);
    expect(
      findingImpactSummaryResponseSchema.safeParse({
        ...parsed,
        summary: { ...parsed.summary, sourceFindingTitle: "confidential" },
      }).success,
    ).toBe(false);
  });

  it("keeps source mutation responses deliberately minimal", () => {
    const parsed = findingPropagationSourceMutationResponseSchema.parse({
      source: {
        id: ids.source,
        organizationId: ids.organization,
        status: "active",
        version: 1,
      },
      jobId: ids.job,
      idempotent: false,
    });
    expect(parsed.source.id).toBe(ids.source);
    expect(
      findingPropagationSourceMutationResponseSchema.safeParse({
        ...parsed,
        source: { ...parsed.source, sourceFindingKey: "confidential" },
      }).success,
    ).toBe(false);
  });

  it("requires an explicit, bounded override and retains an audited end command", () => {
    const params = createFindingProductImpactOverrideParamsSchema.parse({
      productId: ids.product,
      sourceId: ids.source,
    });
    expect(params).toEqual({ productId: ids.product, sourceId: ids.source });
    expectTypeOf<CreateFindingProductImpactOverrideParams>().toEqualTypeOf<
      typeof params
    >();
    expect(
      createFindingProductImpactOverrideParamsSchema.safeParse({
        productId: ids.product,
        sourceId: ids.source,
        overrideId: ids.impact,
      }).success,
    ).toBe(false);

    const created = createFindingProductImpactOverrideInputSchema.parse({
      affectedReleaseId: ids.release,
      overrideState: "not_applicable",
      reason: "This device build omits the vulnerable optional component.",
      source: "Product configuration review",
      provenance: "Approved configuration record CFG-42",
      effectiveStartsAt: at,
      idempotencyKey: ids.idempotency,
      correlationId: ids.correlation,
    });
    expect(created.overrideState).toBe("not_applicable");
    expect(
      createFindingProductImpactOverrideInputSchema.safeParse({
        ...created,
        effectiveEndsAt: "2026-08-14T10:15:29.000Z",
      }).success,
    ).toBe(false);

    expect(
      endFindingProductImpactOverrideInputSchema.parse({
        expectedVersion: 2,
        reason: "The optional component is enabled in the new build.",
        idempotencyKey: ids.idempotency,
        correlationId: ids.correlation,
      }),
    ).toMatchObject({ expectedVersion: 2 });

    expect(
      findingProductImpactOverrideSchema.safeParse({
        id: ids.impact,
        organizationId: ids.organization,
        sourceId: ids.source,
        affectedProductId: ids.product,
        affectedReleaseId: ids.release,
        overrideState: "not_applicable",
        reason: created.reason,
        source: created.source,
        provenance: created.provenance,
        effectiveStartsAt: at,
        effectiveEndsAt: null,
        version: 1,
        createdAt: at,
        createdBy: ids.actor,
        updatedAt: at,
        updatedBy: ids.actor,
        endedAt: at,
        endedBy: null,
        endReason: null,
      }).success,
    ).toBe(false);
  });

  it("parses durable worker rows and rejects ambiguous event scope", () => {
    const source = findingPropagationSourceSchema.parse({
      id: ids.source,
      organizationId: ids.organization,
      sourceSystem: "sbom-correlation",
      sourceFindingKey: "finding-opaque-42",
      sourceProductId: ids.product,
      sourceReleaseId: ids.release,
      sourceBaselineRevisionId: null,
      ruleVersion: "m2-v1",
      status: "active",
      source: "SBOM correlation service",
      provenance: "Signed ingest batch 2026-08-14",
      version: 1,
      createdAt: at,
      createdBy: ids.actor,
      updatedAt: at,
      updatedBy: ids.actor,
    });
    expect(source.id).toBe(ids.source);
    expectTypeOf<FindingPropagationSource>().toEqualTypeOf<typeof source>();

    const job = findingPropagationJobSchema.parse({
      id: ids.job,
      organizationId: ids.organization,
      sourceId: ids.source,
      sourceReleaseId: ids.release,
      sourceBaselineRevisionId: null,
      graphVersion: 17,
      ruleVersion: "m2-v1",
      triggerKey: "product-event:example:source",
      asOf: at,
      status: "leased",
      cursor: null,
      checkpointVersion: 2,
      processedCount: 100,
      upsertedCount: 97,
      supersededCount: 3,
      deliveryAttempts: 1,
      leaseOwner: ids.actor,
      leaseExpiresAt: "2026-08-14T10:16:30.000Z",
      dueAt: at,
      lastErrorCode: null,
      requestedBy: ids.actor,
      createdAt: at,
      updatedAt: at,
    });
    expect(job.id).toBe(ids.job);
    expectTypeOf<FindingPropagationJob>().toEqualTypeOf<typeof job>();
    expect(
      findingPropagationJobSchema.safeParse({
        ...job,
        leaseOwner: null,
      }).success,
    ).toBe(false);

    const association = findingImpactAssociationSchema.parse({
      id: ids.impact,
      organizationId: ids.organization,
      sourceId: ids.source,
      affectedProductId: ids.product,
      affectedReleaseId: ids.release,
      relationshipPathIds: [ids.source],
      relationshipPathHash:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      sourceGraphVersion: 17,
      ruleVersion: "m2-v1",
      status: "active",
      firstEvaluatedAt: at,
      lastEvaluatedAt: at,
      supersededAt: null,
      lastSeenJobId: ids.job,
      version: 1,
      createdAt: at,
      updatedAt: at,
    });
    expect(association.id).toBe(ids.impact);
    expectTypeOf<FindingImpactAssociation>().toEqualTypeOf<
      typeof association
    >();
    expect(
      findingImpactAssociationSchema.safeParse({
        ...association,
        status: "superseded",
      }).success,
    ).toBe(false);

    const productScope = findingPropagationEnqueueScopeSchema.parse({
      organizationId: ids.organization,
      eventId: ids.job,
      eventKey: "product-relationship:example",
      graphVersion: 17,
      scopeKind: "product",
      sourceProductId: ids.product,
      correlationId: ids.correlation,
      occurredAt: at,
    });
    expect(productScope.sourceProductId).toBe(ids.product);

    expect(
      enqueueFindingPropagationSourcePageInputSchema.parse({
        ...productScope,
        asOf: at,
        cursor: null,
        pageSize: 100,
      }),
    ).toMatchObject({ scopeKind: "product", pageSize: 100 });

    expect(
      findingPropagationEnqueueScopeSchema.safeParse({
        organizationId: ids.organization,
        eventId: ids.job,
        eventKey: "product-relationship:example",
        graphVersion: 17,
        scopeKind: "release",
        sourceProductId: ids.product,
        sourceReleaseId: ids.release,
        sourceBaselineRevisionId: ids.baselineRevision,
        correlationId: ids.correlation,
        occurredAt: at,
      }).success,
    ).toBe(false);
  });
});
