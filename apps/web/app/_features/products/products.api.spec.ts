import { afterEach, describe, expect, it, vi } from "vitest";

import { productsApi } from "./products.api";

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const ORGANIZATION_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const ENTITY_ID = "44444444-4444-4444-8444-444444444444";
const RELEASE_ID = "55555555-5555-4555-8555-555555555555";
const NOW = "2026-08-12T10:00:00.000Z";

const LEGAL_ENTITY = {
  id: ENTITY_ID,
  identifier: "cra-gb",
  legalName: "CRA Ltd",
  mainEstablishmentCountry: "GB",
  version: 1,
} as const;
const PRODUCT = {
  id: PRODUCT_ID,
  organizationId: ORGANIZATION_ID,
  name: "Sentinel",
  internalCode: "CRA-001",
  productType: "standalone_software",
  description: null,
  responsibleOwnerId: USER_ID,
  legalEntity: LEGAL_ENTITY,
  archivedAt: null,
  version: 1,
  releaseCount: 0,
  createdAt: NOW,
  updatedAt: NOW,
  createdBy: USER_ID,
  updatedBy: USER_ID,
} as const;
const RELEASE = {
  id: RELEASE_ID,
  organizationId: ORGANIZATION_ID,
  productId: PRODUCT_ID,
  label: "Sentinel 1.0",
  version: "1.0.0",
  description: null,
  lifecycle: "development",
  placedOnMarketAt: null,
  marketAvailabilityWarning: "no_active_member_state_availability",
  legalEntity: LEGAL_ENTITY,
  archivedAt: null,
  versionNumber: 1,
  createdAt: NOW,
  updatedAt: NOW,
  createdBy: USER_ID,
  updatedBy: USER_ID,
} as const;
const SUPPORT_PERIOD_ID = "66666666-6666-4666-8666-666666666666";
const SUPPORT_PERIOD = {
  id: SUPPORT_PERIOD_ID,
  organizationId: ORGANIZATION_ID,
  productId: PRODUCT_ID,
  releaseId: RELEASE_ID,
  supportStartsAt: NOW,
  supportEndsAt: "2029-08-12T10:00:00.000Z",
  expectedLifetimeJustification: "Vendor support commitment",
  decisionActorId: USER_ID,
  effectiveAt: NOW,
  supersededAt: null,
  supersededById: null,
  scopeRevision: 1,
  version: 1,
  createdAt: NOW,
  createdBy: USER_ID,
  updatedAt: NOW,
  updatedBy: USER_ID,
} as const;

function json(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200 });
}

describe("productsApi", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the versioned product endpoint with parsed filters", async () => {
    const fetcher = vi.fn(async () =>
      json({
        products: {
          rows: [PRODUCT],
          total: 1,
          page: 1,
          pageSize: 25,
          pageCount: 1,
        },
      }),
    );
    vi.stubGlobal("fetch", fetcher);

    await expect(
      productsApi.list({
        page: 1,
        pageSize: 25,
        archived: false,
        q: "Sentinel",
      }),
    ).resolves.toEqual({
      products: {
        rows: [PRODUCT],
        total: 1,
        page: 1,
        pageSize: 25,
        pageCount: 1,
      },
    });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/products?page=1&pageSize=25&q=Sentinel&archived=false",
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
  });

  it("creates products only through the real M2 route and validates request input", async () => {
    const fetcher = vi.fn(async () => json({ product: PRODUCT }));
    vi.stubGlobal("fetch", fetcher);
    const input = {
      name: "Sentinel",
      internalCode: "CRA-001",
      productType: "standalone_software" as const,
      responsibleOwnerId: USER_ID,
      legalEntityId: ENTITY_ID,
      idempotencyKey: "66666666-6666-4666-8666-666666666666",
    };

    await expect(productsApi.create(input)).resolves.toEqual({
      product: PRODUCT,
    });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/products",
      expect.objectContaining({ method: "POST", body: JSON.stringify(input) }),
    );

    await expect(productsApi.get("not-a-uuid")).rejects.toMatchObject({
      kind: "invalid_request",
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("uploads an import through the versioned M2 namespace with parsed multipart fields", async () => {
    const importId = "77777777-7777-4777-8777-777777777777";
    const fetcher = vi.fn(async () =>
      json({
        import: {
          id: importId,
          schemaVersion: "m2-product-release-import-v1",
          status: "dry_run_completed",
          contentHash: "a".repeat(64),
          byteSize: 32,
          rowCount: 1,
          processedRowCount: 1,
          counts: {
            create: 1,
            update: 0,
            unchanged: 0,
            skipped: 0,
            failed: 0,
            warnings: 0,
          },
          errorCode: null,
          expiresAt: "2026-08-18T10:00:00.000Z",
          createdAt: NOW,
          updatedAt: NOW,
          committedAt: null,
        },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const file = new File(["record_type\nproduct\n"], "products.csv", {
      type: "text/csv",
    });

    await expect(
      productsApi.uploadImport(
        { idempotencyKey: "88888888-8888-4888-8888-888888888888" },
        file,
      ),
    ).resolves.toMatchObject({ import: { id: importId } });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/products/imports",
      expect.objectContaining({ method: "POST", body: expect.any(FormData) }),
    );
    const body = (
      fetcher.mock.calls as unknown as readonly [
        RequestInfo | URL,
        RequestInit?,
      ][]
    )[0]?.[1]?.body as FormData;
    expect(body.get("idempotencyKey")).toBe(
      "88888888-8888-4888-8888-888888888888",
    );
    expect(body.get("file")).toBe(file);
  });

  it("keeps release reads in the product-specific versioned namespace", async () => {
    const fetcher = vi.fn(async () =>
      json({
        releases: { rows: [], total: 0, page: 1, pageSize: 50, pageCount: 1 },
      }),
    );
    vi.stubGlobal("fetch", fetcher);

    await productsApi.listReleases(PRODUCT_ID, { page: 1, pageSize: 50 });

    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/products/${PRODUCT_ID}/releases?page=1&pageSize=50`,
      expect.objectContaining({ method: "GET" }),
    );
    await expect(
      productsApi.getRelease(PRODUCT_ID, "bad"),
    ).rejects.toMatchObject({ kind: "invalid_request" });
    expect(RELEASE_ID).toBeTruthy();
  });

  it("uses parsed release market and lifecycle action endpoints", async () => {
    const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === "/api/v1/products/member-states") {
        return json({
          memberStates: [
            { countryCode: "DE", name: "Germany", version: 1, active: true },
          ],
        });
      }
      if (
        path.endsWith("/market-availability") &&
        (init?.method ?? "GET") === "GET"
      ) {
        return json({
          marketAvailability: [
            {
              countryCode: "DE",
              memberStateName: "Germany",
              referenceVersion: 1,
              availableAt: NOW,
              unavailableAt: null,
              active: true,
            },
          ],
        });
      }
      if (path.endsWith("/lifecycle-timeline")) return json({ timeline: [] });
      return json({ release: RELEASE });
    });
    vi.stubGlobal("fetch", fetcher);

    await expect(productsApi.listMemberStates()).resolves.toEqual({
      memberStates: [
        { countryCode: "DE", name: "Germany", version: 1, active: true },
      ],
    });
    await productsApi.getReleaseMarketAvailability(PRODUCT_ID, RELEASE_ID);
    await productsApi.addReleaseMarketAvailability(PRODUCT_ID, RELEASE_ID, {
      countryCode: "DE",
      expectedVersion: 1,
    });
    await productsApi.removeReleaseMarketAvailability(
      PRODUCT_ID,
      RELEASE_ID,
      "DE",
      {
        expectedVersion: 2,
        reason: "No longer supplied in Germany",
      },
    );
    await productsApi.correctReleaseMarketAvailability(PRODUCT_ID, RELEASE_ID, {
      fromCountryCode: "DE",
      toCountryCode: "FR",
      expectedVersion: 3,
      reason: "Corrected market registry entry",
    });
    await productsApi.transitionReleaseLifecycle(PRODUCT_ID, RELEASE_ID, {
      targetState: "placed_on_market",
      expectedVersion: 4,
      placedOnMarketAt: NOW,
    });
    await productsApi.correctPlacedOnMarketDate(PRODUCT_ID, RELEASE_ID, {
      correctedPlacedOnMarketAt: NOW,
      expectedVersion: 5,
      reason: "Corrected authoritative placement date",
    });
    await productsApi.getReleaseLifecycleTimeline(PRODUCT_ID, RELEASE_ID);

    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/products/${PRODUCT_ID}/releases/${RELEASE_ID}/market-availability`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/products/${PRODUCT_ID}/releases/${RELEASE_ID}/market-availability/DE`,
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({
          expectedVersion: 2,
          reason: "No longer supplied in Germany",
        }),
      }),
    );
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/products/${PRODUCT_ID}/releases/${RELEASE_ID}/lifecycle-transitions`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          targetState: "placed_on_market",
          expectedVersion: 4,
          placedOnMarketAt: NOW,
        }),
      }),
    );
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/products/${PRODUCT_ID}/releases/${RELEASE_ID}/placed-on-market-date-corrections`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/products/${PRODUCT_ID}/releases/${RELEASE_ID}/lifecycle-timeline`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("uses product support period and retention report endpoints", async () => {
    const fetcher = vi.fn(async (path: string) => {
      if (path.includes("/support-periods?")) {
        return json({
          supportPeriods: [SUPPORT_PERIOD],
        });
      }
      if (path.endsWith("/support-period-preview")) {
        return json({
          preview: {
            current: SUPPORT_PERIOD,
            proposed: {
              supportStartsAt: NOW,
              supportEndsAt: "2029-08-12T10:00:00.000Z",
              expectedLifetimeJustification: "Vendor support commitment",
            },
            lowering: false,
            previewDigest: "a".repeat(64),
            activeScopeRevision: 1,
            isShortening: false,
            retentionProtectionWouldReduce: false,
            blockedReasons: [],
            affectedCategories: ["retention_dates"],
            currentRetentionUntil: null,
            proposedRetentionUntil: "2036-08-12T10:00:00.000Z",
          },
        });
      }
      if (path.endsWith("/retention")) {
        return json({
          retention: {
            ruleVersion: "m2.v1.later_of_placement_plus_10y_or_support_end",
            status: "current",
            placedOnMarketCandidate: "2036-08-12T10:00:00.000Z",
            supportPeriodCandidate: "2029-08-12T10:00:00.000Z",
            retentionUntil: "2036-08-12T10:00:00.000Z",
            retentionProtectionUntil: "2036-08-12T10:00:00.000Z",
            winningRule: "placed_on_market_plus_10_calendar_years",
            incompleteReasons: [],
            legalHoldActive: false,
            releaseCalculations: [
              {
                releaseId: RELEASE_ID,
                ruleVersion: "m2.v1.later_of_placement_plus_10y_or_support_end",
                status: "current",
                placedOnMarketCandidate: "2036-08-12T10:00:00.000Z",
                supportPeriodCandidate: "2029-08-12T10:00:00.000Z",
                retentionUntil: "2036-08-12T10:00:00.000Z",
                retentionProtectionUntil: "2036-08-12T10:00:00.000Z",
                winningRule: "placed_on_market_plus_10_calendar_years",
                incompleteReasons: [],
                legalHoldActive: false,
              },
            ],
          },
        });
      }
      if (path.endsWith("/support-alerts")) {
        return json({ alerts: [] });
      }
      return json({ supportPeriod: SUPPORT_PERIOD });
    });
    vi.stubGlobal("fetch", fetcher);

    await productsApi.listSupportPeriods(PRODUCT_ID, RELEASE_ID);
    await productsApi.previewSupportPeriod(PRODUCT_ID, {
      releaseId: RELEASE_ID,
      expectedVersion: 1,
      current: {
        supportStartsAt: NOW,
        supportEndsAt: "2029-08-12T10:00:00.000Z",
        expectedLifetimeJustification: "Vendor support commitment",
      },
      proposed: {
        supportStartsAt: NOW,
        supportEndsAt: "2030-08-12T10:00:00.000Z",
        expectedLifetimeJustification: "Extended vendor support",
      },
    });
    await productsApi.createSupportPeriod(PRODUCT_ID, {
      releaseId: RELEASE_ID,
      supportStartsAt: NOW,
      supportEndsAt: "2029-08-12T10:00:00.000Z",
      expectedLifetimeJustification: "Vendor support commitment",
      idempotencyKey: "77777777-7777-4777-8777-777777777777",
    });
    await productsApi.supersedeSupportPeriod(PRODUCT_ID, SUPPORT_PERIOD_ID, {
      supportStartsAt: "2026-08-13T10:00:00.000Z",
      supportEndsAt: "2030-08-13T10:00:00.000Z",
      expectedLifetimeJustification: "Extended vendor support",
      expectedVersion: 1,
      reason: "Contract extension",
      idempotencyKey: "88888888-8888-4888-8888-888888888888",
    });
    await productsApi.getSupportRetention(PRODUCT_ID);
    await productsApi.getSupportAlerts(PRODUCT_ID);

    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/products/${PRODUCT_ID}/support-periods?releaseId=${RELEASE_ID}`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/products/${PRODUCT_ID}/support-period-preview`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          releaseId: RELEASE_ID,
          expectedVersion: 1,
          current: {
            supportStartsAt: NOW,
            supportEndsAt: "2029-08-12T10:00:00.000Z",
            expectedLifetimeJustification: "Vendor support commitment",
          },
          proposed: {
            supportStartsAt: NOW,
            supportEndsAt: "2030-08-12T10:00:00.000Z",
            expectedLifetimeJustification: "Extended vendor support",
          },
        }),
      }),
    );
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/products/${PRODUCT_ID}/support-periods/${SUPPORT_PERIOD_ID}/supersessions`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/products/${PRODUCT_ID}/retention`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/products/${PRODUCT_ID}/support-alerts`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("uses the product support alert interval endpoints", async () => {
    const intervals = {
      alertIntervalsDays: [30, 180],
      version: 1,
      updatedAt: NOW,
      updatedBy: USER_ID,
    };
    const fetcher = vi.fn(async () => json(intervals));
    vi.stubGlobal("fetch", fetcher);

    await productsApi.getSupportAlertIntervals();
    await productsApi.updateSupportAlertIntervals({
      alertIntervalsDays: [14, 120],
      expectedVersion: 1,
    });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/products/support-alert-intervals",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/products/support-alert-intervals",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          alertIntervalsDays: [14, 120],
          expectedVersion: 1,
        }),
      }),
    );
  });

  it("uses parsed baseline, variant, component, graph, and propagation endpoints", async () => {
    const baseline = {
      id: "99999999-9999-4999-8999-999999999999",
      organizationId: ORGANIZATION_ID,
      baselineId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      revisionNumber: 1,
      identifier: "sentinel-runtime",
      name: "Sentinel runtime",
      description: null,
      revisionSummary: "Initial approved runtime baseline",
      source: "Architecture board",
      provenance: "ADR-14",
      effectiveStartsAt: NOW,
      effectiveEndsAt: null,
      version: 1,
      archivedAt: null,
      createdAt: NOW,
      createdBy: USER_ID,
      updatedAt: NOW,
      updatedBy: USER_ID,
    } as const;
    const membership = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      organizationId: ORGANIZATION_ID,
      productId: PRODUCT_ID,
      releaseId: RELEASE_ID,
      baselineId: baseline.baselineId,
      baselineRevisionId: baseline.id,
      baselineRevisionNumber: 1,
      source: "Architecture board",
      provenance: "ADR-14",
      effectiveStartsAt: NOW,
      effectiveEndsAt: null,
      assignedAt: NOW,
      assignedBy: USER_ID,
      endedAt: null,
      endedBy: null,
      endReason: null,
      version: 1,
      updatedAt: NOW,
      updatedBy: USER_ID,
    } as const;
    const component = {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      organizationId: ORGANIZATION_ID,
      relationshipType: "embedded" as const,
      parentProductId: PRODUCT_ID,
      componentProductId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      parentReleaseId: RELEASE_ID,
      componentReleaseId: null,
      quantity: 1,
      source: "Architecture board",
      provenance: "ADR-14",
      reason: "Runtime dependency",
      effectiveStartsAt: NOW,
      effectiveEndsAt: null,
      createdAt: NOW,
      createdBy: USER_ID,
      endedAt: null,
      endedBy: null,
      endReason: null,
      version: 1,
      updatedAt: NOW,
      updatedBy: USER_ID,
    } as const;
    const variant = {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      organizationId: ORGANIZATION_ID,
      relationshipType: "variant" as const,
      sourceType: "base_release" as const,
      sourceProductId: PRODUCT_ID,
      targetProductId: PRODUCT_ID,
      sourceReleaseId: RELEASE_ID,
      targetReleaseId: RELEASE_ID,
      baselineRevisionId: null,
      source: "Architecture board",
      provenance: "ADR-14",
      reason: "Regional configuration",
      effectiveStartsAt: NOW,
      effectiveEndsAt: null,
      createdAt: NOW,
      createdBy: USER_ID,
      endedAt: null,
      endedBy: null,
      endReason: null,
      version: 1,
      updatedAt: NOW,
      updatedBy: USER_ID,
    } as const;
    const event = {
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      organizationId: ORGANIZATION_ID,
      graphVersion: 1,
      eventKey: "product.relationship.changed",
      eventType: "product_relationship.graph_changed" as const,
      deliveryState: "scheduled" as const,
      correlationId: "12121212-1212-4212-8212-121212121212",
      occurredAt: NOW,
      deliveredAt: null,
      retryCount: 0,
    } as const;
    const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/api/v1/products/baselines?")) {
        return json({
          baselines: {
            items: [baseline],
            nextCursor: null,
          },
        });
      }
      if (path.endsWith("/revisions")) {
        return (init?.method ?? "GET") === "GET"
          ? json({ baselines: [baseline] })
          : json({ baseline });
      }
      if (path.includes("baseline-memberships")) {
        return path.endsWith("/baseline-memberships") &&
          (init?.method ?? "GET") === "GET"
          ? json({ memberships: [membership] })
          : json({ membership });
      }
      if (path.includes("variant-relationships")) {
        return path.endsWith("/variant-relationships") &&
          (init?.method ?? "GET") === "GET"
          ? json({ relationships: [variant] })
          : json({ relationship: variant, graphVersion: 1 });
      }
      if (path.endsWith("/component-links/preview")) {
        return json({
          preview: {
            outcome: "allowed",
            graphVersion: 1,
            candidateDepth: 1,
            relationshipPathIds: [],
            productPathIds: [PRODUCT_ID],
          },
        });
      }
      if (path.includes("component-links")) {
        return path.endsWith("/component-links") &&
          (init?.method ?? "GET") === "GET"
          ? json({ links: [component] })
          : json({ relationship: component, graphVersion: 1 });
      }
      if (path.includes("relationship-graph")) {
        return json({
          graph: {
            organizationId: ORGANIZATION_ID,
            rootProductId: PRODUCT_ID,
            rootReleaseId: null,
            graphVersion: 1,
            evaluatedAt: NOW,
            nodes: [],
            links: [component],
          },
        });
      }
      if (path.includes("relationship-propagation-events")) {
        return json({ events: [event], nextCursor: null });
      }
      if (path.includes("relationship-reevaluations")) {
        return json({ event });
      }
      return json({ baseline });
    });
    vi.stubGlobal("fetch", fetcher);
    const createBaseline = {
      identifier: baseline.identifier,
      name: baseline.name,
      revisionSummary: baseline.revisionSummary,
      source: baseline.source,
      provenance: baseline.provenance,
      effectiveStartsAt: NOW,
      idempotencyKey: "13131313-1313-4313-8313-131313131313",
    };
    const componentInput = {
      componentProductId: component.componentProductId,
      parentReleaseId: RELEASE_ID,
      quantity: 1,
      source: component.source,
      provenance: component.provenance,
      reason: component.reason,
      effectiveStartsAt: NOW,
      expectedGraphVersion: 1,
    };

    await productsApi.createSoftwareBaseline(createBaseline);
    await expect(
      productsApi.listSoftwareBaselines({
        q: "runtime",
        pageSize: 25,
        includeArchived: false,
      }),
    ).resolves.toEqual({
      baselines: {
        items: [baseline],
        nextCursor: null,
      },
    });
    await productsApi.listSoftwareBaselineRevisions(baseline.baselineId);
    const appendBaseline = {
      name: createBaseline.name,
      revisionSummary: createBaseline.revisionSummary,
      source: createBaseline.source,
      provenance: createBaseline.provenance,
      effectiveStartsAt: createBaseline.effectiveStartsAt,
      idempotencyKey: createBaseline.idempotencyKey,
    };
    const appendedBaseline = await productsApi.appendSoftwareBaselineRevision(
      baseline.baselineId,
      {
        ...appendBaseline,
        expectedVersion: 1,
      },
    );
    expect(appendedBaseline).toEqual({ baseline });
    await productsApi.archiveSoftwareBaseline(baseline.baselineId, {
      expectedVersion: 1,
      reason: "Retired runtime baseline",
    });
    await productsApi.listSoftwareBaselineMemberships(PRODUCT_ID);
    await productsApi.assignSoftwareBaselineMembership(PRODUCT_ID, {
      releaseId: RELEASE_ID,
      baselineId: baseline.baselineId,
      baselineRevisionId: baseline.id,
      expectedBaselineVersion: 1,
      source: baseline.source,
      provenance: baseline.provenance,
      effectiveStartsAt: NOW,
      idempotencyKey: "14141414-1414-4414-8414-141414141414",
    });
    await productsApi.endSoftwareBaselineMembership(PRODUCT_ID, membership.id, {
      expectedVersion: 1,
      reason: "No longer applicable",
      effectiveEndsAt: "2026-08-13T00:00:00.000Z",
    });
    await productsApi.listProductVariantRelationships(PRODUCT_ID);
    await productsApi.createProductVariantRelationship(PRODUCT_ID, {
      sourceType: "base_release",
      baseReleaseId: RELEASE_ID,
      variantProductId: PRODUCT_ID,
      variantReleaseId: RELEASE_ID,
      source: variant.source,
      provenance: variant.provenance,
      reason: variant.reason,
      effectiveStartsAt: NOW,
      expectedGraphVersion: 1,
      idempotencyKey: "15151515-1515-4515-8515-151515151515",
    });
    await productsApi.endProductVariantRelationship(PRODUCT_ID, variant.id, {
      expectedVersion: 1,
      expectedGraphVersion: 1,
      reason: "No longer a supported variant",
      effectiveEndsAt: "2026-08-13T00:00:00.000Z",
    });
    await productsApi.listProductComponentLinks(PRODUCT_ID);
    await productsApi.previewProductComponentLink(PRODUCT_ID, componentInput);
    await productsApi.createProductComponentLink(PRODUCT_ID, {
      ...componentInput,
      idempotencyKey: "16161616-1616-4616-8616-161616161616",
    });
    await productsApi.supersedeProductComponentLink(PRODUCT_ID, component.id, {
      ...componentInput,
      expectedVersion: 1,
      idempotencyKey: "17171717-1717-4717-8717-171717171717",
    });
    await productsApi.endProductComponentLink(PRODUCT_ID, component.id, {
      expectedVersion: 1,
      expectedGraphVersion: 1,
      reason: "No longer embedded",
      effectiveEndsAt: "2026-08-13T00:00:00.000Z",
    });
    await productsApi.getProductRelationshipGraph(PRODUCT_ID, { maxDepth: 1 });
    await productsApi.listRelationshipPropagationEvents(PRODUCT_ID, {
      deliveryState: "scheduled",
    });
    await productsApi.requestRelationshipReevaluation(PRODUCT_ID, {
      expectedGraphVersion: 1,
      reason: "Refresh downstream relationship assessments",
      source: component.source,
      provenance: component.provenance,
      idempotencyKey: "18181818-1818-4818-8818-181818181818",
    });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/products/baselines?pageSize=25&q=runtime&includeArchived=false",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/products/${PRODUCT_ID}/component-links/${component.id}/supersessions`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/products/${PRODUCT_ID}/relationship-graph?maxDepth=1`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/products/${PRODUCT_ID}/relationship-propagation-events?pageSize=25&deliveryState=scheduled`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/products/${PRODUCT_ID}/relationship-reevaluations`,
      expect.objectContaining({ method: "POST" }),
    );
  });
});
