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
});
