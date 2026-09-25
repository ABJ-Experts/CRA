// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EvidenceExtractedText } from "./evidence-extracted-text";

const useEvidenceExtractedTextQuery = vi.hoisted(() => vi.fn());
const useRetryEvidenceExtractionMutation = vi.hoisted(() => vi.fn());

vi.mock("./evidence.queries", () => ({
  useEvidenceExtractedTextQuery,
  useRetryEvidenceExtractionMutation,
}));

describe("EvidenceExtractedText", () => {
  it("distinguishes unavailable text extraction from unavailable evidence access", () => {
    useEvidenceExtractedTextQuery.mockReturnValue({
      data: {
        extractedText: {
          documentId: "22222222-2222-4222-8222-222222222222",
          versionId: "33333333-3333-4333-8333-333333333333",
          extraction: {
            status: "failed",
            sourceSha256: "a".repeat(64),
            extractorVersion: "local-v1",
            updatedAt: "2026-09-18T00:00:00.000Z",
            failureCode: "unavailable",
            truncated: false,
            quality: "not_assessed",
          },
          snippet: null,
        },
      },
      isLoading: false,
      isError: false,
    });
    useRetryEvidenceExtractionMutation.mockReturnValue({
      isPending: false,
      isError: false,
      mutate: vi.fn(),
    });

    render(
      <EvidenceExtractedText
        productId="11111111-1111-4111-8111-111111111111"
        documentId="22222222-2222-4222-8222-222222222222"
        version={
          {
            id: "33333333-3333-4333-8333-333333333333",
            status: "clean",
          } as never
        }
        enabled
        canRetry
      />,
    );

    expect(screen.getByText(/Text extraction is unavailable/i)).toBeTruthy();
    expect(
      screen.getByText(/preview and download remain available/i),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Retry extraction" }),
    ).toBeTruthy();
  });
});
