// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SbomNormalizedDocumentsPanel } from "./sbom-normalized-documents-panel";

const query = vi.hoisted(() => vi.fn());

vi.mock("../../_features/sboms/sboms.queries", () => ({
  useSbomDocumentsForReleaseQuery: query,
}));

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const RELEASE_ID = "22222222-2222-4222-8222-222222222222";
const document = {
  id: "33333333-3333-4333-8333-333333333333",
  sourceId: "44444444-4444-4444-8444-444444444444",
  format: "spdx",
  specificationVersion: "2.3",
  parser: { name: "CRA parser", version: "1.0.0" },
  normalizer: { name: "CRA normalizer", version: "1.0.0" },
  state: "completed",
  validationStatus: "valid",
  componentCount: 1,
  dependencyCount: 0,
  maximumDepth: 0,
  warningCount: 0,
  error: null,
  completedAt: "2026-08-24T00:00:00.000Z",
  createdAt: "2026-08-24T00:00:00.000Z",
  updatedAt: "2026-08-24T00:00:00.000Z",
} as const;

describe("SbomNormalizedDocumentsPanel", () => {
  afterEach(() => vi.clearAllMocks());

  it("keeps release document pages reachable through a cursor-bound load-more action", () => {
    query.mockReturnValue({
      data: { documents: [document], nextCursor: "documents-next" },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    render(
      <SbomNormalizedDocumentsPanel
        productId={PRODUCT_ID}
        releaseId={RELEASE_ID}
        enabled
      />,
    );

    expect(
      screen.getByRole("link", { name: "Open normalized graph" }),
    ).toHaveAttribute(
      "href",
      `/products/${PRODUCT_ID}/sboms/${document.id}?sourceId=${document.sourceId}`,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Load more documents" }),
    );
    expect(query).toHaveBeenLastCalledWith(
      PRODUCT_ID,
      RELEASE_ID,
      { limit: 25, cursor: "documents-next" },
      true,
    );
  });
});
