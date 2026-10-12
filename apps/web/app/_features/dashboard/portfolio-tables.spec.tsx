// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PortfolioCoverage,
  PortfolioState,
  PortfolioFindings,
  PortfolioProductsTable,
  PortfolioConcentrationTable,
  PortfolioDetailTable,
} from "./portfolio-tables";
const now = "2026-10-12T10:00:00Z";
const id = "11111111-1111-4111-8111-111111111111";
const hidden = {
  state: "restricted",
  observedAt: null,
  updatedAt: null,
} as const;
const available = <T,>(data: T) =>
  ({ state: "available", observedAt: now, updatedAt: now, data }) as const;
const summary = {
  openCount: 1,
  suppressedOpenCount: 0,
  bySeverity: { critical: 0, high: 1, medium: 0, low: 0, unknown: 0 },
};
const product = {
  productId: id,
  productName: "Alpha",
  archived: true,
  classification: null,
  support: { state: "missing", startsAt: null, endsAt: null },
  legalEntityId: null,
  legalEntityName: null,
  sbomCoverage: available({
    coveredReleases: 0,
    eligibleReleases: 0,
    percent: null,
  }),
  findings: available(summary),
  readiness: hidden,
} as const;
const component = {
  packageIdentity: "pkg:npm/example",
  version: "1",
  componentRef: "opaque",
  productCount: 2,
  releaseCount: 2,
};
afterEach(cleanup);
describe("portfolio tables", () => {
  it("names source states without turning unavailable evidence into zero", () => {
    for (const state of [
      "restricted",
      "not_initialized",
      "unavailable",
      "stale",
      "empty",
    ]) {
      const view = render(<PortfolioState state={state} />);
      expect(view.container.textContent).toBeTruthy();
      view.unmount();
    }
    const view = render(<PortfolioFindings section={hidden} />);
    expect(screen.getByText(/Restricted/)).toBeVisible();
    view.rerender(
      <PortfolioFindings section={{ ...available(summary), state: "stale" }} />,
    );
    expect(screen.getByText(/Stale evidence/)).toBeVisible();
  });
  it("discloses all missing identity, coverage and freshness states", () => {
    const data = {
      generatedAt: now,
      coverage: available({
        eligibleReleases: 0,
        coveredReleases: 0,
        missingReleases: 0,
        percent: null,
        totalComponents: 4,
        rankableComponents: 0,
        excludedIdentity: {
          missingPurl: 1,
          missingVersion: 1,
          invalidPurl: 1,
          versionConflict: 1,
        },
      }),
      matchingCoverage: available({
        eligibleReleases: 0,
        evaluatedReleases: 0,
        pendingReleases: 0,
      }),
      feedFreshness: available([]),
    };
    const view = render(<PortfolioCoverage data={data} />);
    expect(screen.getByText(/No eligible releases/)).toBeVisible();
    expect(screen.getByText(/1 version conflicts/)).toBeVisible();
    expect(screen.getByText(/No intelligence feed/)).toBeVisible();
    view.rerender(
      <PortfolioCoverage
        data={{
          ...data,
          coverage: {
            ...data.coverage,
            state: "stale",
            data: {
              ...data.coverage.data,
              eligibleReleases: 2,
              coveredReleases: 1,
              missingReleases: 1,
              percent: 50,
            },
          },
          feedFreshness: available([
            {
              feedKey: "nvd",
              status: "stale",
              freshness: "stale",
              lastSuccessfulSyncAt: null,
              updatedAt: null,
            },
          ]),
        }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("stale");
    expect(screen.getByText(/nvd: stale/)).toBeVisible();
    view.rerender(
      <PortfolioCoverage
        data={{
          generatedAt: now,
          coverage: hidden,
          matchingCoverage: hidden,
          feedFreshness: hidden,
        }}
      />,
    );
    expect(screen.getAllByText(/Restricted/)).toHaveLength(3);
  });
  it("supports empty/restricted products, archive/support/coverage/readiness and pagination", () => {
    const onNext = vi.fn();
    const view = render(
      <PortfolioProductsTable section={hidden} onNext={onNext} />,
    );
    expect(screen.getByText(/Restricted/)).toBeVisible();
    view.rerender(
      <PortfolioProductsTable
        section={available({ rows: [], nextCursor: null })}
        onNext={onNext}
      />,
    );
    expect(screen.getByText(/No authorized products/)).toBeVisible();
    view.rerender(
      <PortfolioProductsTable
        section={available({ rows: [product], nextCursor: "next" })}
        onNext={onNext}
      />,
    );
    expect(screen.getByText(/Archived product/)).toBeVisible();
    fireEvent.click(screen.getByRole("button"));
    expect(onNext).toHaveBeenCalledWith("next");
    view.rerender(
      <PortfolioProductsTable
        section={available({
          rows: [
            {
              ...product,
              archived: false,
              legalEntityName: "Entity",
              legalEntityId: id,
              classification: "default",
              sbomCoverage: available({
                coveredReleases: 1,
                eligibleReleases: 1,
                percent: 100,
              }),
              readiness: available({
                productId: id,
                productName: "Alpha",
                status: "empty",
                percent: 0,
                completeSections: 0,
                applicableSections: 1,
                gaps: [],
                calculatedAt: null,
              }),
            },
          ],
          nextCursor: null,
        })}
        onNext={onNext}
      />,
    );
    expect(screen.getByText(/100%/)).toBeVisible();
    view.rerender(
      <PortfolioProductsTable
        section={available({
          rows: [{ ...product, sbomCoverage: hidden }],
          nextCursor: null,
        })}
        onNext={onNext}
      />,
    );
    expect(screen.getAllByText(/Restricted/)).toHaveLength(2);
  });
  it("paginates ranked and drilldown rows with archive labels and no name matching", () => {
    const next = vi.fn(),
      inspect = vi.fn();
    const view = render(
      <PortfolioConcentrationTable
        section={hidden}
        onNext={next}
        onInspect={inspect}
      />,
    );
    view.rerender(
      <PortfolioConcentrationTable
        section={available({ rows: [], nextCursor: null })}
        onNext={next}
        onInspect={inspect}
      />,
    );
    expect(screen.getByText(/No shared versioned PURL/)).toBeVisible();
    view.rerender(
      <PortfolioConcentrationTable
        section={available({
          rows: [{ ...component, findings: hidden }],
          nextCursor: "next",
        })}
        onNext={next}
        onInspect={inspect}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Inspect/ }));
    expect(inspect).toHaveBeenCalledWith("opaque");
    fireEvent.click(
      screen.getByRole("button", { name: "Next component page" }),
    );
    expect(next).toHaveBeenCalledWith("next");
    const metadata = {
      organizationId: id,
      serverNow: now,
      generatedAt: now,
      scope: { productId: null, legalEntityId: null, includeArchived: false },
      coverage: hidden,
      matchingCoverage: hidden,
      feedFreshness: hidden,
      component,
    };
    view.rerender(
      <PortfolioDetailTable
        data={{ ...metadata, affectedReleases: hidden }}
        onNext={next}
      />,
    );
    view.rerender(
      <PortfolioDetailTable
        data={{
          ...metadata,
          affectedReleases: available({ rows: [], nextCursor: null }),
        }}
        onNext={next}
      />,
    );
    expect(screen.getByText(/No affected releases/)).toBeVisible();
    const row = {
      productId: id,
      productName: "Alpha",
      archived: true,
      legalEntityId: null,
      legalEntityName: null,
      releaseId: id,
      releaseVersion: "1",
      releaseArchived: true,
      findings: hidden,
    };
    view.rerender(
      <PortfolioDetailTable
        data={{
          ...metadata,
          affectedReleases: available({
            rows: [row],
            nextCursor: "detail-next",
          }),
        }}
        onNext={next}
      />,
    );
    expect(screen.getByText("Archived release")).toBeVisible();
    fireEvent.click(screen.getByRole("button"));
    expect(next).toHaveBeenCalledWith("detail-next");
    view.rerender(
      <PortfolioDetailTable
        data={{
          ...metadata,
          affectedReleases: available({
            rows: [
              {
                ...row,
                archived: false,
                releaseArchived: false,
                legalEntityId: id,
                legalEntityName: "Entity",
              },
            ],
            nextCursor: null,
          }),
        }}
        onNext={next}
      />,
    );
    expect(screen.getByText("Active marketed release")).toBeVisible();
  });
});
