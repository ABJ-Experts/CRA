import { describe, expect, it } from "vitest";
import {
  dashboardTrendsQuerySchema,
  dashboardTrendSourcesQuerySchema,
  dashboardTrendSourcesResponseSchema,
} from "./trends.schema.js";
it("exposes bounded source continuation explicitly without issuing an unusable cursor", () => {
  const page = { items: [], nextCursor: null, datasetRevision: "revision" };
  expect(dashboardTrendSourcesResponseSchema.safeParse(page).success).toBe(
    true,
  );
  expect(
    dashboardTrendSourcesResponseSchema.safeParse({
      ...page,
      continuationUnavailable: "source_page_limit",
    }).success,
  ).toBe(true);
  expect(
    dashboardTrendSourcesResponseSchema.safeParse({
      ...page,
      nextCursor: "cursor",
      continuationUnavailable: "source_page_limit",
    }).success,
  ).toBe(false);
  expect(
    dashboardTrendSourcesResponseSchema.safeParse({
      ...page,
      continuationUnavailable: "invented",
    }).success,
  ).toBe(false);
});
describe("trend filters", () => {
  it("accepts leap dates and timezone-aware bounded ranges", () => {
    expect(
      dashboardTrendsQuerySchema.parse({
        from: "2024-02-29",
        to: "2024-03-10",
        timezone: "America/New_York",
      }).bucket,
    ).toBe("day");
  });
  it.each([
    { from: "2025-02-29", to: "2025-03-01" },
    { from: "2024-01-01", to: "2025-01-01" },
    { from: "2024-03-10", to: "2024-03-01" },
    { from: "2024-03-01", to: "2024-03-10", timezone: "invented/zone" },
    { from: "2024-03-01", to: "2024-03-10", organizationId: "forged" },
  ])("rejects invalid filters %j", (value) =>
    expect(dashboardTrendsQuerySchema.safeParse(value).success).toBe(false),
  );
  it("rejects future observations", () => {
    expect(
      dashboardTrendsQuerySchema.safeParse({
        from: "9999-01-01",
        to: "9999-01-02",
      }).success,
    ).toBe(false);
  });
  it("bounds tokens and source paging", () => {
    expect(
      dashboardTrendSourcesQuerySchema.safeParse({
        datasetToken: "x".repeat(16385),
        metric: "activity",
      }).success,
    ).toBe(false);
    expect(
      dashboardTrendSourcesQuerySchema.safeParse({
        datasetToken: "token",
        metric: "activity",
        limit: 101,
      }).success,
    ).toBe(false);
  });
});
import {
  dashboardTrendsDataSchema,
  dashboardTrendBucketSchema,
  dashboardTrendSeriesSchema,
} from "./trends.schema.js";
const bucket = {
  start: "2024-02-29T00:00:00Z",
  partial: false,
  end: "2024-03-01T00:00:00Z",
  opened: 0,
  closed: 0,
  reopened: 0,
  value: null,
  sampleCount: 0,
  excludedCount: 0,
  numerator: null,
  denominator: null,
  sourceCount: 0,
};
const s = (unit: string) => ({
  state: "available",
  reason: null,
  unit,
  baselineAt: null,
  buckets: [bucket],
});
const d = () => ({
  organizationId: "00000000-0000-4000-8000-000000000001",
  filters: {
    from: "2024-02-29",
    to: "2024-03-01",
    timezone: "UTC",
    bucket: "day",
  },
  policyVersion: "m14-02-v1",
  datasetRevision: "revision",
  generatedAt: "2024-03-01T00:00:00Z",
  baselineAt: null,
  series: {
    activity: s("count"),
    triage: s("hours"),
    remediation: s("days"),
    sbomCoverage: s("percent"),
    readiness: s("percent"),
  },
});
describe("trend data invariants", () => {
  it("preserves actual zero and missing means", () => {
    expect(dashboardTrendsDataSchema.safeParse(d()).success).toBe(true);
    expect(
      dashboardTrendsDataSchema.safeParse({
        ...d(),
        series: {
          ...d().series,
          triage: {
            ...s("hours"),
            buckets: [{ ...bucket, sampleCount: 1, value: 0 }],
          },
        },
      }).success,
    ).toBe(true);
  });
  it("rejects reversed buckets, excess numerator, negative durations and restricted data", () => {
    expect(
      dashboardTrendBucketSchema.safeParse({ ...bucket, end: bucket.start })
        .success,
    ).toBe(false);
    expect(
      dashboardTrendBucketSchema.safeParse({
        ...bucket,
        numerator: 2,
        denominator: 1,
      }).success,
    ).toBe(false);
    expect(
      dashboardTrendBucketSchema.safeParse({ ...bucket, value: -1 }).success,
    ).toBe(false);
    expect(
      dashboardTrendSeriesSchema.safeParse({
        ...s("count"),
        state: "restricted",
      }).success,
    ).toBe(false);
  });
  it.each([
    { triage: { ...s("days") } },
    { triage: { ...s("hours"), buckets: [{ ...bucket, value: 0 }] } },
    { remediation: { ...s("days"), buckets: [{ ...bucket, sampleCount: 1 }] } },
    {
      activity: {
        ...s("count"),
        state: "restricted",
        buckets: [],
        reason: null,
      },
    },
    { activity: { ...s("count"), buckets: [bucket, bucket] } },
    {
      sbomCoverage: {
        ...s("percent"),
        buckets: [{ ...bucket, value: 25, numerator: 1, denominator: 2 }],
      },
    },
    {
      sbomCoverage: {
        ...s("percent"),
        buckets: [{ ...bucket, value: 0, numerator: 0, denominator: 0 }],
      },
    },
  ])("rejects contradictory metric %j", (patch) =>
    expect(
      dashboardTrendsDataSchema.safeParse({
        ...d(),
        series: { ...d().series, ...patch },
      }).success,
    ).toBe(false),
  );
  it("accepts exact coverage with denominator context", () =>
    expect(
      dashboardTrendsDataSchema.safeParse({
        ...d(),
        series: {
          ...d().series,
          sbomCoverage: {
            ...s("percent"),
            buckets: [{ ...bucket, value: 50, numerator: 1, denominator: 2 }],
          },
        },
      }).success,
    ).toBe(true));
});
import { dashboardTrendSourceSchema } from "./trends.schema.js";
it("accepts only same-origin source links", () => {
  const source = {
    id: "fact",
    productId: "00000000-0000-4000-8000-000000000001",
    sourceId: "source",
    sourceType: "finding",
    factKind: "opened",
    effectiveAt: "2024-03-01T00:00:00Z",
    recordedAt: "2024-03-01T00:00:00Z",
    provenance: "source",
    href: "/findings?product=one",
  };
  expect(dashboardTrendSourceSchema.safeParse(source).success).toBe(true);
  for (const href of ["//evil.test", "/\\evil.test", "/path\nsecret"])
    expect(
      dashboardTrendSourceSchema.safeParse({ ...source, href }).success,
    ).toBe(false);
});
