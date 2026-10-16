import { projectFrozenSourceRow } from "./export-source-projection";
import { evaluateVulnerabilityPriority } from "../../vulnerabilities/prioritization/vulnerability-priority-policy";
it("reuses canonical frozen priority inputs without exporting private input metadata", () => {
  const inputs = {
    cvssBaseScore: 9.8,
    epss: 0.92,
    kevStatus: "listed" as const,
    confidenceScore: 0.9,
    humanVerdict: null,
  };
  const row = {
    ordinal: 1,
    values: {
      id: "finding",
      priority: JSON.stringify({ kind: "m14_priority_inputs_v1", inputs }),
    },
  };
  expect(
    projectFrozenSourceRow("vulnerabilities.enriched_findings", row).values
      .priority,
  ).toBe(JSON.stringify(evaluateVulnerabilityPriority(inputs)));
  expect(projectFrozenSourceRow("products.registry", row)).toBe(row);
  expect(() =>
    projectFrozenSourceRow("vulnerabilities.enriched_findings", {
      ...row,
      values: { priority: "malformed" },
    }),
  ).toThrow();
});

it("projects frozen feed health through the original source policy", () => {
  const row = {
    ordinal: 1,
    values: {
      feedKey: "nvd",
      status: JSON.stringify({
        kind: "m14_feed_health_v1",
        value: {
          feedKey: "nvd",
          syncState: "ready",
          freshnessState: "stale",
          lastRecordCount: 7,
        },
      }),
      freshness: null,
      currentRecordCount: null,
    },
  };
  expect(
    projectFrozenSourceRow("vulnerabilities.feed_health", row).values,
  ).toEqual({
    feedKey: "nvd",
    status: "stale",
    freshness: "stale",
    currentRecordCount: 7,
  });
  expect(() =>
    projectFrozenSourceRow("vulnerabilities.feed_health", {
      ordinal: 1,
      values: { status: 4 },
    }),
  ).toThrow();
  expect(() =>
    projectFrozenSourceRow("vulnerabilities.feed_health", {
      ordinal: 1,
      values: { status: "{}" },
    }),
  ).toThrow();
});
it("preserves public sync run semantics and redacts internal failure details", () => {
  expect(
    projectFrozenSourceRow("vulnerabilities.sync_runs", {
      ordinal: 1,
      values: { status: "failed", failureCode: "provider_timeout" },
    }).values,
  ).toEqual({ status: "retrying", failureCode: "network_timeout" });
  expect(
    projectFrozenSourceRow("vulnerabilities.sync_runs", {
      ordinal: 1,
      values: { status: "completed", failureCode: "secret" },
    }).values,
  ).toEqual({ status: "completed", failureCode: "unknown" });
  expect(
    projectFrozenSourceRow("vulnerabilities.enriched_findings", {
      ordinal: 1,
      values: { id: "x" },
    }).values,
  ).toEqual({ id: "x" });
  expect(() =>
    projectFrozenSourceRow("vulnerabilities.enriched_findings", {
      ordinal: 1,
      values: { priority: 4 },
    }),
  ).toThrow();
});

it("projects feed health when the selected fields omit status", () => {
  const frozen = JSON.stringify({
    kind: "m14_feed_health_v1",
    value: {
      syncState: "ready",
      freshnessState: "healthy",
      lastRecordCount: 42,
    },
  });
  expect(
    projectFrozenSourceRow("vulnerabilities.feed_health", {
      ordinal: 1,
      values: { currentRecordCount: frozen },
    }).values,
  ).toEqual({ currentRecordCount: 42 });
});
