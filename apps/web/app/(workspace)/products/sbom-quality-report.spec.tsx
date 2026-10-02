// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "../../_lib/http/api-client";
import { SbomQualityReport } from "./sbom-quality-report";

const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const queries = vi.hoisted(() => ({
  useSbomQualityReportQuery: vi.fn(),
  useSbomQualityFindingsQuery: vi.fn(),
}));
vi.mock("../../_features/sboms/sboms.queries", () => queries);

const report = {
  sourceId: SOURCE_ID,
  state: "completed",
  assessmentStatus: "valid",
  formulaVersion: "sbom-quality.v1",
  totalScore: 92.5,
  inputs: { maximumDepth: 3 },
  dimensions: [
    {
      id: "purl",
      coveragePercent: 75,
      satisfiedCount: 3,
      eligibleCount: 4,
      weight: 20,
      status: "partial",
      score: 75,
    },
  ],
  bsiProfile: {
    enabled: true,
    status: "valid",
    findingCount: 0,
    rulesetVersion: "technical-subset.v1",
  },
  baseline: { status: "available", totalScore: 95 },
  regression: { status: "none", totalScoreDelta: 0, changedDimensions: [] },
  progress: { message: "Calculating evidence quality." },
  error: null,
};
const finding = {
  id: "finding-1",
  severity: "warning",
  ruleId: "SUPPLIER-PRESENT",
  code: "missing_supplier",
  kind: "missing_metadata",
  dimension: "supplier",
  sourcePath: "/components/0/supplier",
  actual: null,
  remediation: "Record the component supplier.",
};
function query(overrides: Record<string, unknown> = {}) {
  return {
    isPending: false,
    isError: false,
    error: null,
    data: undefined,
    refetch: vi.fn(),
    ...overrides,
  };
}
function setReport(overrides: Record<string, unknown> = {}) {
  queries.useSbomQualityReportQuery.mockReturnValue(
    query({ data: { report: { ...report, ...overrides } } }),
  );
}
function show(enabled = true) {
  return render(<SbomQualityReport sourceId={SOURCE_ID} enabled={enabled} />);
}

describe("SBOM quality operational states", () => {
  beforeEach(() => {
    setReport();
    queries.useSbomQualityFindingsQuery.mockReturnValue(
      query({ data: { findings: [], nextCursor: null } }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("shows loading without displaying stale metrics", () => {
    queries.useSbomQualityReportQuery.mockReturnValue(
      query({ isPending: true }),
    );
    show();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading SBOM quality report",
    );
    expect(
      screen.queryByRole("heading", { name: "Overall quality" }),
    ).not.toBeInTheDocument();
  });

  it.each([
    [
      new ApiClientError("api", "private provider details", 403),
      "You do not have permission to view SBOM quality results.",
    ],
    [
      new ApiClientError("api", "private provider details", 404),
      "This SBOM quality report is unavailable.",
    ],
    [
      new ApiClientError("network", "private provider details"),
      "SBOM quality data is temporarily unavailable. Try again.",
    ],
  ])(
    "handles scoped/provider denial and permits a manual retry",
    (error, message) => {
      const refetch = vi.fn();
      queries.useSbomQualityReportQuery.mockReturnValue(
        query({ isError: true, error, refetch }),
      );
      show();
      expect(screen.getByRole("alert")).toHaveTextContent(message);
      expect(
        screen.queryByText("private provider details"),
      ).not.toBeInTheDocument();
      expect(refetch).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(refetch).toHaveBeenCalledOnce();
    },
  );

  it("handles a missing report response as recoverable unavailability", () => {
    queries.useSbomQualityReportQuery.mockReturnValue(query());
    show();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "temporarily unavailable",
    );
  });

  it("forwards disabled scope to the data boundary", () => {
    queries.useSbomQualityReportQuery.mockReturnValue(
      query({ isPending: true }),
    );
    show(false);
    expect(queries.useSbomQualityReportQuery).toHaveBeenCalledWith(
      SOURCE_ID,
      false,
    );
    expect(queries.useSbomQualityFindingsQuery).not.toHaveBeenCalled();
  });

  it("shows worker progress separately from completed results", () => {
    setReport({ state: "running" });
    show();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Quality report is running.",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Calculating evidence quality.",
    );
    expect(
      screen.queryByRole("heading", { name: "Overall quality" }),
    ).not.toBeInTheDocument();
  });

  it.each([
    [
      { retryable: true, message: "Quality provider unavailable." },
      "Retryable: Quality provider unavailable.",
    ],
    [
      { retryable: false, message: "Unsupported evidence." },
      "Unsupported evidence.",
    ],
    [null, "Quality calculation could not finish."],
  ])("explains terminal worker failure", (error, message) => {
    setReport({ state: "failed", error });
    show();
    expect(screen.getByRole("alert")).toHaveTextContent(message);
  });

  it.each(["valid", "invalid", "warning", "regression", null])(
    "keeps engineering assessment %s visible with clear BSI limitations",
    (assessmentStatus) => {
      setReport({ assessmentStatus });
      show();
      expect(
        screen.getByRole("heading", { name: "SBOM quality report" }),
      ).toBeVisible();
      expect(
        screen.getByText(/it is not legal advice or release approval/),
      ).toBeVisible();
      expect(
        screen.getByText(/full pinned BSI profile has not been verified/),
      ).toBeVisible();
    },
  );

  it.each([
    ["available", "Previous report scored 95."],
    ["first_document", "This is the first document in this release lineage."],
    ["unavailable", "No eligible completed baseline is available."],
  ])("explains baseline %s", (status, message) => {
    setReport({ baseline: { ...report.baseline, status } });
    show();
    expect(screen.getByText(message)).toBeVisible();
    expect(
      screen.getByText("No material quality regression was recorded."),
    ).toBeVisible();
  });

  it.each([
    ["purl", "Purl"],
    [null, "recorded quality inputs"],
  ])(
    "shows regression causes without claiming conformity",
    (dimension, explanation) => {
      setReport({
        regression: {
          status: "regression",
          totalScoreDelta: -12.5,
          changedDimensions: dimension ? [dimension] : [],
        },
      });
      show();
      expect(screen.getByText(/Quality declined by/)).toHaveTextContent(
        `12.5 points. Changed dimensions: ${explanation}.`,
      );
    },
  );

  it("renders absent optional historical metrics without crashing", () => {
    setReport({
      totalScore: null,
      assessmentStatus: null,
      inputs: null,
      dimensions: [],
      bsiProfile: null,
      baseline: null,
      regression: null,
    });
    show();
    expect(screen.getByText("Disabled")).toBeVisible();
    expect(
      screen.getByText("No eligible completed baseline is available."),
    ).toBeVisible();
    expect(screen.getAllByText("0%").length).toBeGreaterThan(0);
  });

  it.each([
    ["warning", 0, "Manual review required"],
    ["invalid", 2, "Technical checks failed"],
  ])(
    "shows pinned technical %s results without claiming automatic conformity",
    (status, failedRuleCount, label) => {
      setReport({
        bsiProfile: {
          ...report.bsiProfile,
          status,
          assessmentKind: "pinned_technical_checks",
          findingCount: failedRuleCount + 3,
          sourceSha256: "a".repeat(64),
          evaluatorVersion: "bsi-technical.v1",
          passedRuleCount: 12,
          failedRuleCount,
          manualReviewRuleCount: 3,
        },
      });
      show();
      expect(
        screen.getByRole("heading", {
          name: "BSI pinned 2.0 technical checks",
        }),
      ).toBeVisible();
      expect(screen.getByText(label)).toBeVisible();
      expect(screen.getByText("Passed technical rules: 12")).toBeVisible();
      expect(
        screen.getByText(`Failed technical rules: ${failedRuleCount}`),
      ).toBeVisible();
      expect(
        screen.getByText("Manual review rules: 3 (unknown until reviewed)"),
      ).toBeVisible();
      expect(
        screen.getByText(`SBOM source SHA-256: ${"a".repeat(64)}`),
      ).toBeVisible();
      expect(screen.getByText("Evaluator: bsi-technical.v1")).toBeVisible();
      expect(
        screen.getByText(
          /The current edition and full conformity are not verified/,
        ),
      ).toBeVisible();
      expect(
        screen.queryByText(/Legacy\/subset checks:/),
      ).not.toBeInTheDocument();
    },
  );

  it("labels unavailable pinned technical evaluation without displaying results", () => {
    setReport({
      bsiProfile: {
        ...report.bsiProfile,
        status: "unavailable",
        assessmentKind: "unavailable",
      },
    });
    show();
    expect(
      screen.getByRole("heading", { name: "BSI pinned 2.0 technical checks" }),
    ).toBeVisible();
    expect(screen.getByText("Technical assessment unavailable")).toBeVisible();
    expect(
      screen.getByText(
        "Pinned technical evaluation could not complete. No BSI conformity result is available.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByText(/Passed technical rules:/),
    ).not.toBeInTheDocument();
  });

  it("distinguishes loading, failure, and empty remediation", () => {
    queries.useSbomQualityFindingsQuery.mockReturnValue(
      query({ isPending: true }),
    );
    const view = show();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading remediation guidance",
    );
    queries.useSbomQualityFindingsQuery.mockReturnValue(
      query({ isError: true, error: new ApiClientError("api", "hidden", 403) }),
    );
    view.rerender(<SbomQualityReport sourceId={SOURCE_ID} enabled />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "do not have permission",
    );
    queries.useSbomQualityFindingsQuery.mockReturnValue(
      query({ data: { findings: [], nextCursor: null } }),
    );
    view.rerender(<SbomQualityReport sourceId={SOURCE_ID} enabled />);
    expect(
      screen.getByText("No remediation items were retained for this report."),
    ).toBeVisible();
  });

  it("appends bounded remediation pages without duplicating prior rows", () => {
    const first = query({
      data: { findings: [finding], nextCursor: "page-two" },
    });
    const secondFinding = {
      ...finding,
      id: "finding-2",
      severity: "error",
      ruleId: null,
      dimension: null,
      sourcePath: null,
      actual: "Supplier missing",
      remediation: "Review supplier evidence.",
    };
    const second = query({
      data: { findings: [finding, secondFinding], nextCursor: null },
    });
    queries.useSbomQualityFindingsQuery.mockImplementation(
      (_sourceId, input) => (input.cursor ? second : first),
    );
    show();
    expect(screen.getByText("SUPPLIER-PRESENT")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Load more guidance" }));
    expect(queries.useSbomQualityFindingsQuery).toHaveBeenLastCalledWith(
      SOURCE_ID,
      { limit: 50, cursor: "page-two" },
      true,
    );
    const table = screen.getByRole("table", {
      name: "SBOM quality remediation guidance",
    });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(screen.getByText("Supplier missing")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Load more guidance" }),
    ).not.toBeInTheDocument();
  });

  it("renders malicious remediation text as inert text with document-level fallback", () => {
    queries.useSbomQualityFindingsQuery.mockReturnValue(
      query({
        data: {
          findings: [
            {
              ...finding,
              severity: "info",
              ruleId: null,
              dimension: null,
              sourcePath: null,
              actual: null,
              remediation: '<script>alert("x")</script>',
            },
          ],
          nextCursor: null,
        },
      }),
    );
    show();
    expect(screen.getByText('<script>alert("x")</script>')).toBeVisible();
    expect(screen.getByText("Document-level evidence")).toBeVisible();
    expect(document.querySelector("script")).toBeNull();
  });
});
