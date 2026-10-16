// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AuditRangeResult } from "@repo/contracts/audit/types";
import { AuditRangeResultView } from "./audit-range-result";
export const resultFixture: AuditRangeResult = {
  outcome: "consistent",
  algorithm: "sha256",
  chainVersion: 1,
  requestedRange: { from: "1", to: "4" },
  frozenRange: { from: "1", to: "4" },
  checkedRange: { from: "1", to: "4" },
  verifiedPrefix: { from: "1", to: "4" },
  checkedCount: "4",
  firstAffectedSequence: null,
  breaks: [],
  sampleSequences: [],
  inspectionComplete: true,
  checkedAt: "2026-10-07T00:00:00Z",
  datasetContext: "live",
  priorCheckpointStatus: "not_supplied",
  authenticityProven: false,
  completeLedgerVerified: false,
};
afterEach(cleanup);
describe("range results", () => {
  it("displays only actual consistency and precise limitations", () => {
    render(<AuditRangeResultView result={resultFixture} />);
    expect(screen.getByText("Range internally consistent")).toBeVisible();
    expect(screen.getByText(/does not prove authenticity/)).toBeVisible();
  });
  it("reports break intervals, restored context, and incomplete inspection", () => {
    render(
      <AuditRangeResultView
        result={{
          ...resultFixture,
          outcome: "integrity_break",
          verifiedPrefix: null,
          checkedCount: null,
          checkedAt: null,
          datasetContext: "restored",
          inspectionComplete: false,
          firstAffectedSequence: "2",
          breaks: [
            {
              category: "missing_sequence_interval",
              fromSequence: "2",
              toSequence: "3",
            },
          ],
        }}
      />,
    );
    expect(screen.getByRole("table")).toHaveAccessibleName(
      /Bounded integrity breaks/,
    );
    expect(screen.getByText("missing sequence interval")).toBeVisible();
    expect(screen.getByText(/marked restored/)).toBeVisible();
    expect(screen.getByText(/First affected sequence: 2/)).toBeVisible();
    expect(screen.getByText("Not checked")).toBeVisible();
  });
  it("suppresses all hidden progress and break contents", () => {
    render(
      <AuditRangeResultView
        result={{ ...resultFixture, outcome: "scope_unavailable" }}
      />,
    );
    expect(screen.getByText(/No evidence or progress/)).toBeVisible();
    expect(screen.queryByText("Frozen range")).not.toBeInTheDocument();
  });
  it.each([
    "empty",
    "legacy_unchained",
    "checkpoint_unavailable",
    "incomplete",
  ] as const)("keeps %s distinct", (outcome) => {
    render(
      <AuditRangeResultView
        result={{
          ...resultFixture,
          outcome,
          frozenRange: null,
          checkedRange: null,
          verifiedPrefix: null,
        }}
      />,
    );
    expect(
      screen.queryByText("Range internally consistent"),
    ).not.toBeInTheDocument();
  });
});
