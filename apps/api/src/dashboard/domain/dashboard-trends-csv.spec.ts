import { dashboardTrendsCsv } from "./dashboard-trends-csv";
import type { DashboardTrendsData } from "@repo/contracts/dashboard/types";
describe("chart/table/export parity", () => {
  it("serializes canonical values with nulls and escapes formula cells", () => {
    const s = {
      state: "unavailable",
      reason: '=HYPERLINK("danger")',
      unit: "count",
      baselineAt: null,
      buckets: [],
    } as const;
    const data = {
      policyVersion: "m14-02-v1",
      datasetRevision: "revision",
      filters: { timezone: "UTC" },
      series: {
        activity: {
          ...s,
          state: "available",
          buckets: [
            {
              start: "start",
              partial: false,
              end: "end",
              opened: 2,
              closed: 1,
              reopened: 0,
              value: null,
              sampleCount: 0,
              excludedCount: 1,
              numerator: null,
              denominator: null,
              sourceCount: 3,
            },
          ],
        },
        triage: s,
      },
    } as unknown as DashboardTrendsData;
    const csv = dashboardTrendsCsv(data);
    expect(csv).toContain('"2","1","0","","0","1"');
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain('""danger""');
    expect(csv.split("\r\n")).toHaveLength(4);
  });
});
