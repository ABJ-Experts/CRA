// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EvidenceSearchPanel } from "./evidence-search-panel";
import { EvidenceSnippet } from "./evidence-snippet";

const useEvidenceSearchQuery = vi.hoisted(() => vi.fn());

vi.mock("./evidence.queries", () => ({
  useEvidenceSearchQuery,
}));

describe("EvidenceSnippet", () => {
  it("renders extracted text as inert text segments, never HTML", () => {
    const { container } = render(
      <EvidenceSnippet
        snippet={{
          segments: [
            { text: "Before ", highlighted: false },
            { text: "<img src=x onerror=alert(1)>", highlighted: true },
          ],
          truncated: false,
        }}
      />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
  });
});

describe("EvidenceSearchPanel", () => {
  it("makes incomplete coverage explicit instead of claiming no evidence", async () => {
    useEvidenceSearchQuery.mockReturnValue({
      data: {
        results: [],
        totalCount: 0,
        facets: [],
        coverage: { indexed: 0, pending: 2, unavailable: 1 },
        nextCursor: null,
      },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    });

    render(
      <EvidenceSearchPanel
        productId="11111111-1111-4111-8111-111111111111"
        enabled
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Search evidence text"), {
      target: { value: "secure boot" },
    });
    await act(
      async () => await new Promise((resolve) => setTimeout(resolve, 250)),
    );

    expect(
      screen.getByText(/No matching extracted text is available yet/i),
    ).toBeTruthy();
    expect(screen.getByText(/2 extracting, 1 unavailable/i)).toBeTruthy();
  });
});
