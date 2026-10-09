// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import type { FindingImpactSummaryResponse } from "@repo/contracts/findings";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "../../_lib/http/api-client";
import { FindingImpactStatus } from "./finding-impact-status";

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-08-14T10:00:00.000Z";

const query: {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  data: FindingImpactSummaryResponse;
  refetch: ReturnType<typeof vi.fn>;
} = {
  isPending: false,
  isError: false,
  error: null as unknown,
  data: {
    summary: {
      productId: PRODUCT_ID,
      releaseId: null,
      activeImpactCount: 0,
      supersededImpactCount: 0,
      closedImpactCount: 0,
      overrideCount: 0,
      latestGraphVersion: null,
      latestEvaluatedAt: null,
      propagationState: "idle" as const,
      queuedJobCount: 0,
      inProgressJobCount: 0,
      retryingJobCount: 0,
      deadLetterJobCount: 0,
    },
  },
  refetch: vi.fn(),
};

vi.mock("../../_features/findings/finding-impact.queries", () => ({
  useFindingImpactSummaryQuery: () => query,
}));

describe("FindingImpactStatus", () => {
  beforeEach(() => {
    query.isPending = false;
    query.isError = false;
    query.error = null;
    query.data = {
      summary: {
        productId: PRODUCT_ID,
        releaseId: null,
        activeImpactCount: 0,
        supersededImpactCount: 0,
        closedImpactCount: 0,
        overrideCount: 0,
        latestGraphVersion: null,
        latestEvaluatedAt: null,
        propagationState: "idle",
        queuedJobCount: 0,
        inProgressJobCount: 0,
        retryingJobCount: 0,
        deadLetterJobCount: 0,
      },
    };
    query.refetch.mockClear();
  });

  afterEach(cleanup);

  it("renders a safe empty state without finding evidence or SBOM content", () => {
    render(<FindingImpactStatus productId={PRODUCT_ID} enabled />);

    expect(
      screen.getByRole("heading", { name: "Finding impact" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "No propagated finding impacts are currently associated with this product.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/CVE|SBOM|evidence/i)).not.toBeInTheDocument();
  });

  it("renders loading, in-progress, partial-failure, and stale graph states", () => {
    query.isPending = true;
    const { rerender } = render(
      <FindingImpactStatus productId={PRODUCT_ID} enabled />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading finding impact",
    );

    query.isPending = false;
    query.data.summary = {
      ...query.data.summary,
      activeImpactCount: 4,
      propagationState: "in_progress",
      queuedJobCount: 2,
      inProgressJobCount: 1,
      latestGraphVersion: 7,
      latestEvaluatedAt: NOW,
    };
    rerender(<FindingImpactStatus productId={PRODUCT_ID} enabled />);
    expect(screen.getByRole("status")).toHaveTextContent("in progress");
    expect(screen.getByText("4 active impacts")).toBeInTheDocument();

    query.data.summary = {
      ...query.data.summary,
      propagationState: "partial_failure",
      deadLetterJobCount: 1,
    };
    rerender(<FindingImpactStatus productId={PRODUCT_ID} enabled />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "partially unavailable",
    );

    query.data.summary = {
      ...query.data.summary,
      propagationState: "stale",
      deadLetterJobCount: 0,
    };
    rerender(<FindingImpactStatus productId={PRODUCT_ID} enabled />);
    expect(screen.getByRole("status")).toHaveTextContent("stale");
  });

  it("keeps forbidden distinct and offers retry for recoverable errors", () => {
    query.isError = true;
    query.error = new ApiClientError("api", "Forbidden", 403);
    const { rerender } = render(
      <FindingImpactStatus productId={PRODUCT_ID} enabled />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "do not have permission",
    );
    expect(
      screen.queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();

    query.error = new ApiClientError("network", "Unavailable");
    rerender(<FindingImpactStatus productId={PRODUCT_ID} enabled />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(query.refetch).toHaveBeenCalledOnce();
  });
});
