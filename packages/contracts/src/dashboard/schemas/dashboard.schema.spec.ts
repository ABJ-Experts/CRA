import { describe, expect, it } from "vitest";
import {
  dashboardOverviewResponseSchema,
  dashboardObligationsQuerySchema,
  dashboardCoverageSchema,
  dashboardReadinessRowSchema,
  dashboardObligationRowSchema,
} from "./index.js";
import { vulnerabilityTriageQueueQuerySchema } from "../../vulnerabilities/schemas/index.js";
const id = "11111111-1111-4111-8111-111111111111";
const now = "2026-10-07T12:00:00Z";
const absent = { state: "restricted", observedAt: null, updatedAt: null };
const overview = {
  organizationId: id,
  serverNow: now,
  generatedAt: now,
  products: absent,
  findings: absent,
  obligations: absent,
  sbomCoverage: absent,
  readiness: absent,
  ingestion: absent,
  feedFreshness: absent,
};
describe("dashboard boundary", () => {
  it("accepts withheld sections without invented counts", () =>
    expect(dashboardOverviewResponseSchema.parse(overview)).toEqual(overview));
  it.each(["restricted", "unavailable", "not_initialized"])(
    "rejects %s data disclosure",
    (state) =>
      expect(
        dashboardOverviewResponseSchema.safeParse({
          ...overview,
          findings: { ...absent, state, data: { openCount: 0 } },
        }).success,
      ).toBe(false),
  );
  it("uses bounded strict paging and real booleans", () => {
    expect(dashboardObligationsQuerySchema.parse({})).toEqual({
      limit: 20,
      state: "active",
    });
    expect(dashboardObligationsQuerySchema.parse({ limit: "100" }).limit).toBe(
      100,
    );
    for (const value of [
      { limit: 101 },
      { organizationId: id },
      { cursor: "../secret" },
      { limit: true },
    ])
      expect(dashboardObligationsQuerySchema.safeParse(value).success).toBe(
        false,
      );
    expect(vulnerabilityTriageQueueQuerySchema.parse({}).openOnly).toBe(false);
    expect(
      vulnerabilityTriageQueueQuerySchema.parse({ openOnly: "false" }).openOnly,
    ).toBe(false);
    expect(
      vulnerabilityTriageQueueQuerySchema.parse({ openOnly: "true" }).openOnly,
    ).toBe(true);
    expect(
      vulnerabilityTriageQueueQuerySchema.safeParse({ openOnly: "yes" })
        .success,
    ).toBe(false);
  });
  it("does not invent coverage percentage on no eligible releases", () => {
    expect(
      dashboardCoverageSchema.parse({
        coveredReleases: 0,
        eligibleReleases: 0,
        percent: null,
      }),
    ).toBeDefined();
    expect(
      dashboardCoverageSchema.safeParse({
        coveredReleases: 0,
        eligibleReleases: 0,
        percent: 100,
      }).success,
    ).toBe(false);
    expect(
      dashboardCoverageSchema.safeParse({
        coveredReleases: 2,
        eligibleReleases: 1,
        percent: 100,
      }).success,
    ).toBe(false);
  });
  it("rejects fabricated complete readiness and pending deadlines", () => {
    expect(
      dashboardReadinessRowSchema.safeParse({
        productId: id,
        productName: "Product",
        status: "complete",
        completeSections: 0,
        applicableSections: 0,
        percent: 100,
        calculatedAt: now,
        gaps: [],
      }).success,
    ).toBe(false);
    expect(
      dashboardObligationRowSchema.safeParse({
        obligationId: id,
        stageId: id,
        productId: null,
        productName: null,
        type: "severe_incident",
        kind: "early_warning",
        state: "pending_anchor",
        obligationStatus: "active",
        dueAt: now,
        elapsedPercent: null,
        breachedAt: null,
        submittedAt: null,
      }).success,
    ).toBe(false);
  });
});

import {
  dashboardSectionSchema,
  dashboardProductsSummarySchema,
  dashboardFindingsSummarySchema,
  dashboardSupportSchema,
  dashboardReadinessQuerySchema,
  dashboardIngestionQuerySchema,
  dashboardProductPostureParamsSchema,
  dashboardProductPostureQuerySchema,
  dashboardOverviewQuerySchema,
  dashboardFindingsDrilldownQuerySchema,
  dashboardTechnicalFileDrilldownQuerySchema,
  dashboardPageSchema,
  dashboardProductPostureResponseSchema,
  dashboardObligationsResponseSchema,
  dashboardReadinessResponseSchema,
  dashboardIngestionResponseSchema,
  dashboardFeedFreshnessRowSchema,
  dashboardIngestionRowSchema,
} from "./index.js";
import { z } from "zod";
const obligation = {
  obligationId: id,
  stageId: id,
  productId: null,
  productName: null,
  type: "severe_incident",
  kind: "early_warning",
  state: "pending_anchor",
  obligationStatus: "active",
  dueAt: null,
  elapsedPercent: null,
  breachedAt: null,
  submittedAt: null,
};
const readiness = {
  productId: id,
  productName: "Product",
  status: "partial",
  completeSections: 1,
  applicableSections: 2,
  percent: 50,
  calculatedAt: now,
  gaps: [],
};
const product = {
  productId: id,
  productName: "Product",
  archived: false,
  classification: null,
  support: { state: "missing", startsAt: null, endsAt: null },
};
const page = { rows: [], nextCursor: null };
const section = {
  state: "empty",
  observedAt: now,
  updatedAt: null,
  data: page,
};
describe("dashboard source and row invariants", () => {
  it.each(["available", "empty", "stale"])(
    "preserves %s observations",
    (state) => {
      expect(
        dashboardSectionSchema(z.object({ value: z.number() }).strict()).parse({
          state,
          observedAt: now,
          updatedAt: now,
          data: { value: 1 },
        }),
      ).toBeDefined();
    },
  );
  it("validates counts including unknown severity", () => {
    expect(
      dashboardProductsSummarySchema.parse({
        totalProducts: 2,
        activeProducts: 1,
        archivedProducts: 1,
      }),
    ).toBeDefined();
    expect(
      dashboardProductsSummarySchema.safeParse({
        totalProducts: 2,
        activeProducts: 1,
        archivedProducts: 0,
      }).success,
    ).toBe(false);
    const summary = {
      openCount: 1,
      suppressedOpenCount: 1,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0, unknown: 1 },
    };
    expect(dashboardFindingsSummarySchema.parse(summary)).toBeDefined();
    expect(
      dashboardFindingsSummarySchema.safeParse({ ...summary, openCount: 2 })
        .success,
    ).toBe(false);
    expect(
      dashboardFindingsSummarySchema.safeParse({
        ...summary,
        suppressedOpenCount: 2,
      }).success,
    ).toBe(false);
  });
  it("checks exact coverage fractions", () => {
    expect(
      dashboardCoverageSchema.parse({
        coveredReleases: 1,
        eligibleReleases: 3,
        percent: 33.33,
      }),
    ).toBeDefined();
    expect(
      dashboardCoverageSchema.safeParse({
        coveredReleases: 1,
        eligibleReleases: 3,
        percent: null,
      }).success,
    ).toBe(false);
    expect(
      dashboardCoverageSchema.safeParse({
        coveredReleases: 1,
        eligibleReleases: 3,
        percent: 50,
      }).success,
    ).toBe(false);
  });
  it("keeps support availability explicit", () => {
    for (const state of ["not_started", "active", "ended"])
      expect(
        dashboardSupportSchema.parse({ state, startsAt: now, endsAt: now }),
      ).toBeDefined();
    expect(dashboardSupportSchema.parse(product.support)).toBeDefined();
    expect(
      dashboardSupportSchema.safeParse({ ...product.support, startsAt: now })
        .success,
    ).toBe(false);
    expect(
      dashboardSupportSchema.safeParse({ ...product.support, state: "active" })
        .success,
    ).toBe(false);
  });
  it("validates all stage clock states and retains late breach history", () => {
    expect(dashboardObligationRowSchema.parse(obligation)).toBeDefined();
    for (const state of ["running", "overdue"]) {
      expect(
        dashboardObligationRowSchema.safeParse({ ...obligation, state })
          .success,
      ).toBe(false);
      expect(
        dashboardObligationRowSchema.parse({
          ...obligation,
          state,
          dueAt: now,
          elapsedPercent: 100,
        }),
      ).toBeDefined();
    }
    expect(
      dashboardObligationRowSchema.safeParse({
        ...obligation,
        state: "submitted",
      }).success,
    ).toBe(false);
    expect(
      dashboardObligationRowSchema.parse({
        ...obligation,
        state: "submitted",
        submittedAt: now,
        breachedAt: now,
        dueAt: now,
      }),
    ).toBeDefined();
    expect(
      dashboardObligationRowSchema.parse({
        ...obligation,
        state: "not_required",
        obligationStatus: "cancelled",
      }),
    ).toBeDefined();
    expect(
      dashboardObligationRowSchema.safeParse({
        ...obligation,
        elapsedPercent: 20,
      }).success,
    ).toBe(false);
  });
  it("prevents incomplete, stale or missing files from displaying complete progress", () => {
    expect(dashboardReadinessRowSchema.parse(readiness)).toBeDefined();
    expect(
      dashboardReadinessRowSchema.safeParse({ ...readiness, status: "empty" })
        .success,
    ).toBe(false);
    expect(
      dashboardReadinessRowSchema.parse({
        ...readiness,
        status: "empty",
        completeSections: 0,
        applicableSections: 0,
        percent: null,
        calculatedAt: null,
      }),
    ).toBeDefined();
    expect(
      dashboardReadinessRowSchema.parse({
        ...readiness,
        status: "complete",
        completeSections: 2,
        percent: 100,
      }),
    ).toBeDefined();
    for (const value of [
      { ...readiness, status: "complete" },
      {
        ...readiness,
        status: "complete",
        completeSections: 2,
        percent: 100,
        calculatedAt: null,
      },
      { ...readiness, status: "stale", completeSections: 2, percent: 100 },
      { ...readiness, status: "partial", completeSections: 2, percent: 100 },
      { ...readiness, completeSections: 3, percent: 100 },
      { ...readiness, percent: null },
      { ...readiness, percent: 30 },
    ])
      expect(dashboardReadinessRowSchema.safeParse(value).success).toBe(false);
  });
  it("bounds initial and paginated lists", () => {
    expect(dashboardPageSchema(z.string()).parse(page)).toBeDefined();
    expect(
      dashboardPageSchema(z.string()).safeParse({
        rows: Array(101).fill("x"),
        nextCursor: null,
      }).success,
    ).toBe(false);
    expect(
      dashboardOverviewResponseSchema.safeParse({
        ...overview,
        obligations: {
          ...section,
          data: { rows: Array(11).fill(obligation), nextCursor: null },
        },
      }).success,
    ).toBe(false);
  });
  it("parses each response and rejects private extra data", () => {
    const posture = Object.fromEntries(
      Object.entries(overview).filter(([key]) => key !== "products"),
    );
    expect(
      dashboardProductPostureResponseSchema.parse({ ...posture, product }),
    ).toBeDefined();
    const metadata = { organizationId: id, serverNow: now, generatedAt: now };
    expect(
      dashboardObligationsResponseSchema.parse({
        ...metadata,
        obligations: section,
      }),
    ).toBeDefined();
    expect(
      dashboardReadinessResponseSchema.parse({
        ...metadata,
        readiness: section,
      }),
    ).toBeDefined();
    expect(
      dashboardIngestionResponseSchema.parse({
        ...metadata,
        ingestion: section,
      }),
    ).toBeDefined();
    expect(
      dashboardFeedFreshnessRowSchema.parse({
        feedKey: "nvd",
        status: "healthy",
        freshness: "fresh",
        lastSuccessfulSyncAt: now,
        updatedAt: now,
      }),
    ).toBeDefined();
    expect(
      dashboardFeedFreshnessRowSchema.safeParse({
        feedKey: "nvd",
        status: "healthy",
        freshness: "fresh",
        lastSuccessfulSyncAt: now,
        updatedAt: now,
        configuration: { secret: "hidden" },
      }).success,
    ).toBe(false);
    expect(
      dashboardIngestionRowSchema.parse({
        jobId: id,
        productId: id,
        productName: "Product",
        releaseId: id,
        status: "queued",
        createdAt: now,
        updatedAt: now,
      }),
    ).toBeDefined();
  });
  it("parses all outgoing queries strictly and without coercing arbitrary truthiness", () => {
    expect(dashboardReadinessQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(
      dashboardIngestionQuerySchema.parse({
        limit: 1,
        cursor: "opaque",
        productId: id,
      }),
    ).toBeDefined();
    expect(dashboardOverviewQuerySchema.parse({})).toEqual({});
    expect(dashboardProductPostureQuerySchema.parse({})).toEqual({});
    expect(
      dashboardProductPostureParamsSchema.parse({ productId: id }),
    ).toBeDefined();
    expect(
      dashboardProductPostureParamsSchema.safeParse({ productId: "foreign" })
        .success,
    ).toBe(false);
    for (const openOnly of [true, false, "true", "false"])
      expect(
        dashboardFindingsDrilldownQuerySchema.parse({
          openOnly,
          severity: "unknown",
          productId: id,
        }),
      ).toBeDefined();
    expect(dashboardFindingsDrilldownQuerySchema.parse({}).openOnly).toBe(
      false,
    );
    expect(
      dashboardFindingsDrilldownQuerySchema.safeParse({ openOnly: "yes" })
        .success,
    ).toBe(false);
    expect(dashboardTechnicalFileDrilldownQuerySchema.parse({})).toBeDefined();
    expect(
      dashboardTechnicalFileDrilldownQuerySchema.safeParse({
        section: "invalid",
      }).success,
    ).toBe(false);
  });
});

describe("per-product readiness authorization", () => {
  it.each(["restricted", "not_initialized", "unavailable"])(
    "withholds %s product metrics without erasing healthy rows",
    (state) => {
      const withheld = { productId: id, productName: "Product", state };
      expect(dashboardReadinessRowSchema.parse(withheld)).toEqual(withheld);
      expect(
        dashboardReadinessResponseSchema.parse({
          organizationId: id,
          serverNow: now,
          generatedAt: now,
          readiness: {
            state: "available",
            observedAt: now,
            updatedAt: null,
            data: { rows: [readiness, withheld], nextCursor: null },
          },
        }),
      ).toBeDefined();
      for (const extra of [
        { completeSections: 0 },
        { applicableSections: 0 },
        { percent: null },
        { status: "empty" },
        { calculatedAt: null },
        { gaps: [] },
      ])
        expect(
          dashboardReadinessRowSchema.safeParse({ ...withheld, ...extra })
            .success,
        ).toBe(false);
    },
  );
});
