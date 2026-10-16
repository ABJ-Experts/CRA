// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DashboardProjection } from "./dashboard.queries";
import {
  DashboardCountdown,
  DashboardCoverage,
  DashboardFeeds,
  DashboardFindings,
  DashboardIngestion,
  DashboardObligations,
  DashboardReadiness,
  SourceState,
} from "./dashboard-sections";
afterEach(cleanup);
const time = "2026-10-07T12:00:00Z";
const productId = "11111111-1111-4111-8111-111111111111";
const hidden = {
  state: "restricted",
  observedAt: null,
  updatedAt: null,
} as const;
const available = <T,>(data: T) =>
  ({ state: "available", observedAt: time, updatedAt: time, data }) as const;
const stage = {
  obligationId: productId,
  stageId: productId,
  productId,
  productName: "Connected hub",
  type: "actively_exploited_vulnerability",
  kind: "early_warning",
  state: "running",
  obligationStatus: "active",
  dueAt: time,
  elapsedPercent: 10,
  breachedAt: null,
  submittedAt: null,
} as const;
describe("Operational dashboard sections", () => {
  it("places the source countdown first and links the actual reporting route", () => {
    render(
      <DashboardCountdown
        section={available({ rows: [stage], nextCursor: null })}
        now={Date.parse(time) - 1000}
      />,
    );
    expect(screen.getByText("0h 0m 1s remaining")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Open this stage" }),
    ).toHaveAttribute(
      "href",
      `/reporting?obligationId=${productId}&stageId=${productId}`,
    );
  });
  it("orders overdue before running and pending and excludes cancelled obligations", () => {
    const cancelled = {
      ...stage,
      stageId: "cancelled",
      obligationStatus: "cancelled" as const,
    };
    const pending = {
      ...stage,
      stageId: "pending",
      state: "pending_anchor" as const,
      dueAt: null,
      elapsedPercent: null,
    };
    const overdue = {
      ...stage,
      stageId: "late",
      state: "overdue" as const,
      breachedAt: time,
    };
    render(
      <DashboardCountdown
        section={available({
          rows: [cancelled, pending, stage, overdue],
          nextCursor: null,
        })}
        now={Date.parse(time) + 1000}
      />,
    );
    expect(screen.getByText("0h 0m 1s elapsed")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Open this stage" }),
    ).toHaveAttribute("href", expect.stringContaining("stageId=late"));
    expect(screen.getByText(/Recorded deadline breach/)).toBeVisible();
  });
  it("never fabricates a number for a hidden source", () => {
    render(<DashboardCountdown section={hidden} now={0} />);
    expect(screen.getByText(/current access/)).toBeVisible();
    expect(
      screen.queryByText("No active reporting stages"),
    ).not.toBeInTheDocument();
    cleanup();
    render(<DashboardCoverage section={{ ...hidden, state: "unavailable" }} />);
    expect(screen.getByText(/temporarily unavailable/)).toBeVisible();
    expect(screen.queryByText(/0 \/ 0/)).not.toBeInTheDocument();
  });
  it("distinguishes empty, stale and not initialized", () => {
    for (const state of ["empty", "stale", "not_initialized"] as const) {
      render(
        <SourceState
          section={
            (state === "not_initialized"
              ? { ...hidden, state }
              : {
                  ...available({
                    coveredReleases: 0,
                    eligibleReleases: 0,
                    percent: null,
                  }),
                  state,
                }) as DashboardProjection["sbomCoverage"]
          }
        />,
      );
      expect(screen.getByRole("status")).toBeVisible();
      cleanup();
    }
    render(
      <DashboardCountdown
        section={available({ rows: [], nextCursor: null })}
        now={0}
      />,
    );
    expect(screen.getByText("No active reporting stages")).toBeVisible();
  });
  it("provides numeric severity labels and exact open triage filters", () => {
    render(
      <DashboardFindings
        productId={productId}
        section={available({
          openCount: 3,
          suppressedOpenCount: 1,
          bySeverity: { critical: 1, high: 1, medium: 0, low: 0, unknown: 1 },
        })}
      />,
    );
    expect(
      screen.getByRole("table", { name: "Open findings by severity" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Triage unknown" }),
    ).toHaveAttribute(
      "href",
      `/findings?openOnly=true&severity=unknown&productId=${productId}`,
    );
    expect(screen.getByText(/3 open · 1 suppressed/)).toBeVisible();
    cleanup();
    render(
      <DashboardFindings
        section={available({
          openCount: 0,
          suppressedOpenCount: 0,
          bySeverity: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
        })}
      />,
    );
    expect(screen.getByText(/0 open/)).toBeVisible();
  });
  it("preserves cancelled and late-submitted history without a running clock", () => {
    render(
      <DashboardObligations
        section={available({
          rows: [
            { ...stage, obligationStatus: "cancelled" },
            {
              ...stage,
              stageId: "submitted",
              state: "submitted",
              submittedAt: time,
              breachedAt: time,
            },
          ],
          nextCursor: null,
        })}
        now={0}
      />,
    );
    expect(screen.getByText("Cancelled")).toBeVisible();
    expect(screen.getByText("Submitted")).toBeVisible();
    expect(screen.getByText("Recorded breach")).toBeVisible();
  });
  it("shows actual readiness fraction and prioritized section actions", () => {
    render(
      <DashboardReadiness
        section={
          available({
            rows: [
              {
                productId,
                productName: "Hub",
                status: "partial",
                completeSections: 1,
                applicableSections: 4,
                percent: 25,
                calculatedAt: time,
                gaps: [
                  {
                    sectionKey: "general_description",
                    code: "missing_narrative",
                    priority: 1,
                    actionLabel: "Describe product",
                  },
                ],
              },
            ],
            nextCursor: null,
          }) as DashboardProjection["readiness"]
        }
      />,
    );
    expect(screen.getByText(/1 \/ 4 sections · 25%/)).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Describe product" }),
    ).toHaveAttribute(
      "href",
      `/products/${productId}/technical-file?section=general_description`,
    );
    cleanup();
    render(
      <DashboardReadiness
        section={available({
          rows: [
            {
              productId,
              productName: "Hub",
              status: "partial",
              completeSections: 0,
              applicableSections: 0,
              percent: null,
              calculatedAt: null,
              gaps: [],
            },
          ],
          nextCursor: null,
        })}
      />,
    );
    expect(screen.getByText(/Progress unavailable/)).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Open technical file" }),
    ).toBeVisible();
  });
  it("withholds per-product readiness details without a fake fraction", () => {
    render(
      <DashboardReadiness
        section={available({
          rows: [{ productId, productName: "Hub", state: "restricted" }],
          nextCursor: null,
        })}
      />,
    );
    expect(screen.getByText("Readiness evidence is restricted.")).toBeVisible();
    expect(screen.queryByText(/sections ·/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Open technical file" }),
    ).not.toBeInTheDocument();
  });
  it("shows coverage denominator and safe ingestion and feed states", () => {
    render(
      <DashboardCoverage
        section={available({
          coveredReleases: 0,
          eligibleReleases: 2,
          percent: 0,
        })}
      />,
    );
    expect(screen.getByText("0 / 2 releases")).toBeVisible();
    cleanup();
    render(
      <DashboardCoverage
        section={available({
          coveredReleases: 0,
          eligibleReleases: 0,
          percent: null,
        })}
      />,
    );
    expect(screen.getByText(/No eligible releases/)).toBeVisible();
    cleanup();
    render(
      <DashboardIngestion
        section={available({
          rows: [
            {
              jobId: productId,
              productId,
              productName: "Hub",
              releaseId: productId,
              status: "failed",
              createdAt: time,
              updatedAt: time,
            },
          ],
          nextCursor: null,
        })}
      />,
    );
    expect(
      screen.getByRole("table", { name: "SBOM ingestion status" }),
    ).toBeVisible();
    cleanup();
    render(
      <DashboardFeeds
        section={available([
          {
            feedKey: "nvd",
            status: "never_synced",
            freshness: "unknown",
            lastSuccessfulSyncAt: null,
            updatedAt: null,
          },
          {
            feedKey: "osv",
            status: "healthy",
            freshness: "fresh",
            lastSuccessfulSyncAt: time,
            updatedAt: time,
          },
        ])}
      />,
    );
    expect(screen.getByText("No successful sync recorded")).toBeVisible();
    expect(screen.getByText(/Last successful sync/)).toBeVisible();
  });
});
