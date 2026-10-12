import { describe, expect, it } from "vitest";
import { exportSources } from "../exports/index.js";
import {
  reportConfigurationSchema,
  reportSources,
  normalizeReportSelection,
  reportSourceSchemaDescriptor,
  reportListQuerySchema,
  reportScheduleSchema,
} from "./schemas/index.js";
import {
  nextReportOccurrence,
  latestReportOccurrence,
  resolveReportDateWindow,
} from "./policy.js";
const id = "e8a43815-631a-4363-9744-4dd067f49ab1";
const report = {
  kind: "list",
  source: "products.registry",
  format: "csv",
  context: {},
  filters: {},
};
const schedule = { frequency: "daily", timezone: "UTC", localTime: "09:00" };
const config = {
  title: " Weekly products ",
  report,
  schedule,
  dateWindow: { kind: "fixed" },
  recipientUserIds: [id],
  emailEnabled: false,
};
describe("persisted scheduled report selection", () => {
  it("covers all 117 member sources, excludes portals and keeps versioned descriptors", () => {
    const members = Object.entries(exportSources)
      .filter(([, spec]) => spec.subjectKind === "member")
      .map(([source]) => source);
    expect(Object.keys(reportSources).sort()).toEqual(members.sort());
    expect(members).toHaveLength(117);
    for (const source of members)
      expect(reportSourceSchemaDescriptor(source)).toMatchObject({
        schemaVersion: "m14_04_v1",
        source,
        scope: "all_filtered",
      });
    expect(() =>
      reportSourceSchemaDescriptor("supplier_evidence.portal_items"),
    ).toThrow();
    expect(
      reportSourceSchemaDescriptor("technical_files.readiness_report"),
    ).toMatchObject({
      source: "technical_files.readiness_report",
      scope: "all_filtered",
      schemaVersion: "m14_04_v1",
    });
  });
  it("uses source validation and strictly rejects unsafe saved state", () => {
    expect(reportConfigurationSchema.parse(config).title).toBe(
      "Weekly products",
    );
    for (const patch of [
      { filters: { page: 1 } },
      { filters: { cursor: "abc" } },
      { filters: { token: "secret" } },
      { context: { orgId: id } },
      { scope: "selected" },
      { columns: ["secret"] },
      { columns: ["id", "id"] },
    ])
      expect(
        reportConfigurationSchema.safeParse({
          ...config,
          report: { ...report, ...patch },
        }).success,
      ).toBe(false);
    expect(
      reportConfigurationSchema.safeParse({ ...config, sql: "select 1" })
        .success,
    ).toBe(false);
    expect(
      reportConfigurationSchema.safeParse({
        ...config,
        recipientUserIds: [id, id],
      }).success,
    ).toBe(false);
    expect(
      reportConfigurationSchema.safeParse({ ...config, recipientUserIds: [] })
        .success,
    ).toBe(false);
  });
  it("normalizes interactive filters immutably and keeps reparsing idempotent", () => {
    const input = {
      ...report,
      filters: { page: 4, pageSize: 20, archived: true, q: " device " },
    };
    const normalized = normalizeReportSelection(input);
    expect(normalized).toMatchObject({
      filters: { archived: true, q: "device" },
    });
    expect(normalized.filters).not.toHaveProperty("page");
    expect(normalizeReportSelection(normalized)).toEqual(normalized);
    expect(input.filters.page).toBe(4);
  });
  it("removes source-owned audit/trend capture tokens while preserving filters", () => {
    const filters = {
      from: "2026-10-01T00:00:00Z",
      to: "2026-10-02T00:00:00Z",
    };
    expect(
      normalizeReportSelection({
        ...report,
        source: "audit.events",
        context: { snapshotToken: "opaque" },
        filters,
      }),
    ).toMatchObject({ context: {}, filters });
    const trend = normalizeReportSelection({
      ...report,
      source: "dashboard.trends",
      filters: { from: "2026-09-01", to: "2026-09-30", datasetToken: "opaque" },
    });
    expect(trend.filters).not.toHaveProperty("datasetToken");
    expect(
      reportConfigurationSchema.safeParse({
        ...config,
        report: {
          ...report,
          source: "audit.events",
          context: { snapshotToken: "opaque" },
          filters,
        },
      }).success,
    ).toBe(false);
  });
  it("limits rolling windows to source-owned date contracts", () => {
    expect(
      reportConfigurationSchema.safeParse({
        ...config,
        dateWindow: { kind: "rolling", days: 7 },
      }).success,
    ).toBe(false);
    expect(reportListQuerySchema.parse({}).limit).toBe(25);
    expect(reportListQuerySchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(
      reportConfigurationSchema.parse({
        ...config,
        report: { kind: "readiness", productId: id },
      }).report.kind,
    ).toBe("readiness");
  });
});
describe("local recurrence", () => {
  it("validates recurrence qualifiers and timezone aliases", () => {
    expect(
      reportScheduleSchema.parse({ ...schedule, timezone: "Asia/Calcutta" })
        .timezone,
    ).toBe("Asia/Calcutta");
    for (const patch of [
      { timezone: "Mars/Base" },
      { localTime: "24:00" },
      { frequency: "weekly" },
      { frequency: "monthly" },
      { weekday: 3 },
      { monthDay: 31 },
    ])
      expect(
        reportScheduleSchema.safeParse({ ...schedule, ...patch }).success,
      ).toBe(false);
  });
  it("finds the next daily slot and supports half-hour offsets", () => {
    expect(
      nextReportOccurrence(schedule, "2026-10-12T09:00:00Z").scheduledFor,
    ).toBe("2026-10-13T09:00:00.000Z");
    expect(
      nextReportOccurrence(
        { ...schedule, timezone: "Asia/Kolkata" },
        "2026-10-12T00:00:00Z",
      ).scheduledFor,
    ).toBe("2026-10-12T03:30:00.000Z");
  });
  it("skips spring gaps and selects only the first fold", () => {
    expect(
      nextReportOccurrence(
        { ...schedule, timezone: "America/New_York", localTime: "02:30" },
        "2026-03-08T00:00:00Z",
      ).scheduledFor,
    ).toBe("2026-03-09T06:30:00.000Z");
    const fold = {
      ...schedule,
      timezone: "America/New_York",
      localTime: "01:30",
    };
    expect(
      nextReportOccurrence(fold, "2026-11-01T00:00:00Z").scheduledFor,
    ).toBe("2026-11-01T05:30:00.000Z");
    expect(
      nextReportOccurrence(fold, "2026-11-01T05:30:00Z").scheduledFor,
    ).toBe("2026-11-02T06:30:00.000Z");
  });
  it("resolves half-hour DST transitions and canonicalizes timezone alias keys", () => {
    const halfHour = {
      ...schedule,
      timezone: "Australia/Lord_Howe",
      localTime: "02:15",
    };
    expect(
      nextReportOccurrence(halfHour, "2026-10-03T00:00:00Z").scheduledFor,
    ).toBe("2026-10-04T15:15:00.000Z");
    const folded = { ...halfHour, localTime: "01:45" };
    expect(
      nextReportOccurrence(folded, "2026-04-04T12:00:00Z").scheduledFor,
    ).toBe("2026-04-04T14:45:00.000Z");
    expect(
      nextReportOccurrence(folded, "2026-04-04T14:45:00Z").scheduledFor,
    ).toBe("2026-04-05T15:15:00.000Z");
    expect(
      nextReportOccurrence(
        { ...schedule, timezone: "Asia/Calcutta" },
        "2026-10-12T00:00:00Z",
      ).occurrenceKey,
    ).toBe(
      nextReportOccurrence(
        { ...schedule, timezone: "Asia/Kolkata" },
        "2026-10-12T00:00:00Z",
      ).occurrenceKey,
    );
  });
  it("clamps month-end and selects weekly dates", () => {
    expect(
      nextReportOccurrence(
        { ...schedule, frequency: "monthly", monthDay: 31 },
        "2028-02-01T00:00:00Z",
      ).scheduledFor,
    ).toBe("2028-02-29T09:00:00.000Z");
    expect(
      nextReportOccurrence(
        { ...schedule, frequency: "weekly", weekday: 1 },
        "2026-10-12T09:00:00Z",
      ).scheduledFor,
    ).toBe("2026-10-19T09:00:00.000Z");
  });
  it("catches up only the latest slot in 24 hours", () => {
    expect(
      latestReportOccurrence(schedule, "2026-10-13T08:59:00Z")?.scheduledFor,
    ).toBe("2026-10-12T09:00:00.000Z");
    expect(
      latestReportOccurrence(
        { ...schedule, frequency: "monthly", monthDay: 1 },
        "2026-10-13T09:00:00Z",
      ),
    ).toBeNull();
    expect(() => nextReportOccurrence(schedule, "invalid")).toThrow();
  });
  it("resolves previous complete local days with source end semantics", () => {
    const base = {
      ...config,
      schedule: { ...schedule, timezone: "Asia/Kolkata" },
      dateWindow: { kind: "rolling", days: 7 },
    };
    const audit = reportConfigurationSchema.parse({
      ...base,
      report: {
        ...report,
        source: "audit.events",
        filters: { from: "2026-09-01T00:00:00Z", to: "2026-09-30T00:00:00Z" },
      },
    });
    expect(resolveReportDateWindow(audit, "2026-10-12T03:30:00Z")).toEqual({
      from: "2026-10-04T18:30:00.000Z",
      to: "2026-10-11T18:30:00.000Z",
    });
    const trends = reportConfigurationSchema.parse({
      ...base,
      report: {
        ...report,
        source: "dashboard.trends",
        filters: { from: "2026-09-01", to: "2026-09-30" },
      },
    });
    expect(
      resolveReportDateWindow(trends, "2026-10-12T03:30:00Z"),
    ).toMatchObject({
      from: "2026-10-05",
      to: "2026-10-11",
      timezone: "Asia/Kolkata",
    });
    expect(
      resolveReportDateWindow(
        reportConfigurationSchema.parse(config),
        "2026-10-12T03:30:00Z",
      ),
    ).toEqual({});
  });
});
