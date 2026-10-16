import { z } from "zod";
export const dashboardTrendSourceOffsetMax = 1_000_000;
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return Number.isFinite(d.valueOf()) && d.toISOString().slice(0, 10) === v;
  }, "Invalid calendar date");
const timezone = z
  .string()
  .max(100)
  .refine((v) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }, "Invalid timezone");
export const dashboardTrendMetricSchema = z.enum([
  "activity",
  "triage",
  "remediation",
  "sbomCoverage",
  "readiness",
]);
export const dashboardTrendFiltersSchema = z
  .object({
    from: date,
    to: date,
    timezone: timezone.default("UTC"),
    bucket: z.enum(["day", "week", "month"]).default("day"),
    productId: z.uuid().optional(),
  })
  .strict()
  .refine((v) => {
    const days = (Date.parse(v.to) - Date.parse(v.from)) / 86400000 + 1;
    return days >= 1 && days <= 366;
  }, "Range must contain 1–366 calendar days");
const token = z
  .string()
  .min(1)
  .max(16384)
  .regex(/^[A-Za-z0-9_-]+$/);
export const dashboardTrendsQuerySchema = dashboardTrendFiltersSchema
  .safeExtend({ datasetToken: token.optional() })
  .refine((value) => {
    // Current-day buckets are partial observations at the pinned dataset snapshot.
    try {
      const parts = new Intl.DateTimeFormat("en", {
        timeZone: value.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(new Date());
      const part = (kind: string) => parts.find((p) => p.type === kind)?.value;
      return value.to <= `${part("year")}-${part("month")}-${part("day")}`;
    } catch {
      return false;
    }
  }, "Future dates have no observed history");
export const dashboardTrendSourcesQuerySchema = z
  .object({
    datasetToken: token,
    metric: dashboardTrendMetricSchema,
    cursor: token.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export const dashboardTrendsExportQuerySchema = z
  .object({ datasetToken: token })
  .strict();
const count = z.number().int().nonnegative();
export const dashboardTrendBucketSchema = z
  .object({
    start: z.iso.datetime(),
    partial: z.boolean(),
    end: z.iso.datetime(),
    opened: count.nullable(),
    closed: count.nullable(),
    reopened: count.nullable(),
    value: z.number().finite().nonnegative().nullable(),
    sampleCount: count,
    excludedCount: count,
    numerator: count.nullable(),
    denominator: count.nullable(),
    sourceCount: count,
  })
  .strict()
  .refine(
    (v) =>
      v.numerator === null ||
      v.denominator === null ||
      v.numerator <= v.denominator,
    "Numerator exceeds denominator",
  )
  .refine(
    (v) => Date.parse(v.start) < Date.parse(v.end),
    "Bucket start must precede end",
  );
export const dashboardTrendSeriesSchema = z
  .object({
    state: z.enum(["available", "restricted", "unavailable"]),
    reason: z.string().max(500).nullable(),
    unit: z.enum(["count", "hours", "days", "percent"]),
    baselineAt: z.iso.datetime().nullable(),
    buckets: z.array(dashboardTrendBucketSchema).max(366),
  })
  .strict()
  .refine(
    (v) => v.state === "available" || v.buckets.length === 0,
    "Withheld series must contain no data",
  );
export const dashboardTrendsDataSchema = z
  .object({
    organizationId: z.uuid(),
    filters: dashboardTrendFiltersSchema,
    policyVersion: z.literal("m14-02-v1"),
    datasetRevision: z.string().min(1).max(256),
    generatedAt: z.iso.datetime(),
    baselineAt: z.iso.datetime().nullable(),
    series: z
      .object({
        activity: dashboardTrendSeriesSchema,
        triage: dashboardTrendSeriesSchema,
        remediation: dashboardTrendSeriesSchema,
        sbomCoverage: dashboardTrendSeriesSchema,
        readiness: dashboardTrendSeriesSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const expected = {
      activity: "count",
      triage: "hours",
      remediation: "days",
      sbomCoverage: "percent",
      readiness: "percent",
    } as const;
    for (const metric of Object.keys(expected) as (keyof typeof expected)[]) {
      const series = data.series[metric];
      const invalid = (message: string) =>
        ctx.addIssue({ code: "custom", message, path: ["series", metric] });
      if (series.unit !== expected[metric])
        invalid("Incompatible metric units");
      if (series.state !== "available" && !series.reason)
        invalid("Withheld series requires a reason");
      for (const [i, b] of series.buckets.entries()) {
        if (
          i > 0 &&
          Date.parse(series.buckets[i - 1]!.end) > Date.parse(b.start)
        )
          invalid("Overlapping or unordered buckets");
        if (metric === "triage" || metric === "remediation") {
          if ((b.sampleCount === 0) !== (b.value === null))
            invalid("Duration mean requires resolved samples");
        }
        if (metric === "sbomCoverage" || metric === "readiness") {
          if (
            b.value !== null &&
            (b.value > 100 ||
              b.numerator === null ||
              b.denominator === null ||
              b.denominator === 0 ||
              Math.abs(
                b.value -
                  Math.round((b.numerator / b.denominator) * 10000) / 100,
              ) > 0.011)
          )
            invalid("Coverage value must match denominator");
          if (b.denominator === 0 && b.value !== null)
            invalid("Zero denominator is unavailable");
        }
      }
    }
  });
export const dashboardTrendsResponseSchema =
  dashboardTrendsDataSchema.safeExtend({ datasetToken: token });
export const dashboardTrendSourceSchema = z
  .object({
    id: z.string().min(1),
    productId: z.uuid(),
    sourceId: z.string().min(1),
    sourceType: z.string().min(1),
    factKind: z.string().min(1),
    effectiveAt: z.iso.datetime(),
    recordedAt: z.iso.datetime(),
    provenance: z.string(),
    href: z
      .string()
      .max(2048)
      .refine(
        (href) =>
          href.startsWith("/") &&
          !href.startsWith("//") &&
          Array.from(href).every(
            (character) => character.charCodeAt(0) > 32 && character !== "\\",
          ),
        "Source links must remain on the application origin",
      )
      .nullable(),
  })
  .strict();
export const dashboardTrendSourcesDataSchema = z
  .object({
    items: z.array(dashboardTrendSourceSchema).max(100),
    nextOffset: count.nullable(),
    datasetRevision: z.string().min(1).max(256),
  })
  .strict();
export const dashboardTrendSourcesResponseSchema = z
  .object({
    items: z.array(dashboardTrendSourceSchema).max(100),
    nextCursor: token.nullable(),
    datasetRevision: z.string().min(1).max(256),
    continuationUnavailable: z.literal("source_page_limit").optional(),
  })
  .strict()
  .refine(
    (page) => !page.continuationUnavailable || page.nextCursor === null,
    "Unavailable continuation must not contain a cursor",
  );
export const dashboardTrendsCsvSchema = z.string().max(4 * 1024 * 1024);
