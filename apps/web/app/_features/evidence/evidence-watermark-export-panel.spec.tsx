// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EvidenceDocumentVersion } from "@repo/contracts/evidence";

import { EvidenceWatermarkExportPanel } from "./evidence-watermark-export-panel";

const queries = vi.hoisted(() => ({
  useCreateEvidenceWatermarkExportMutation: vi.fn(),
  useDeliverEvidenceWatermarkExportMutation: vi.fn(),
  useEvidenceWatermarkExportQuery: vi.fn(),
  usePreviewEvidenceWatermarkExportMutation: vi.fn(),
}));

vi.mock("./evidence.queries", () => queries);

const productId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const version: EvidenceDocumentVersion = {
  id: "33333333-3333-4333-8333-333333333333",
  documentId,
  organizationId: "00000000-0000-4000-8000-000000000001",
  versionNumber: 1,
  title: "Gateway report",
  documentClass: "test_report",
  ownerUserId: "00000000-0000-4000-8000-000000000001",
  productIds: [productId],
  validFrom: null,
  validUntil: null,
  fileName: "gateway.pdf",
  mediaType: "application/pdf",
  byteSize: 10,
  sha256: "a".repeat(64),
  status: "clean",
  scan: null,
  extraction: null,
  uploadExpiresAt: null,
  uploadedByUserId: "00000000-0000-4000-8000-000000000001",
  completedAt: null,
  createdAt: "2026-09-21T10:00:00.000Z",
};

describe("EvidenceWatermarkExportPanel", () => {
  const create = vi.fn();

  beforeEach(() => {
    create.mockResolvedValue({
      export: {
        id: "44444444-4444-4444-8444-444444444444",
      },
    });
    queries.useCreateEvidenceWatermarkExportMutation.mockReturnValue({
      mutateAsync: create,
      isPending: false,
    });
    queries.usePreviewEvidenceWatermarkExportMutation.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    });
    queries.useDeliverEvidenceWatermarkExportMutation.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    });
    queries.useEvidenceWatermarkExportQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
  });

  afterEach(() => vi.clearAllMocks());

  it("requires recipient and purpose and pins the requested export to the selected version", async () => {
    render(
      <EvidenceWatermarkExportPanel
        productId={productId}
        documentId={documentId}
        version={version}
        enabled
        canManage
      />,
    );

    fireEvent.change(screen.getByLabelText("Recipient"), {
      target: { value: "Zoë Auditor" },
    });
    fireEvent.change(screen.getByLabelText("External-review purpose"), {
      target: { value: "External review" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create watermarked preview" }),
    );

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        documentId,
        versionId: version.id,
        input: {
          recipient: "Zoë Auditor",
          purpose: "External review",
          idempotencyKey: expect.any(String),
        },
      }),
    );
  });

  it("requires a recorded preview before a ready derivative can be delivered", () => {
    queries.useEvidenceWatermarkExportQuery.mockReturnValue({
      data: {
        export: {
          id: "44444444-4444-4444-8444-444444444444",
          status: "ready",
          derivative: {
            fileName: "gateway-watermarked.pdf",
            mediaType: "application/pdf",
            byteSize: 10,
            sha256: "b".repeat(64),
            createdAt: "2026-09-21T10:01:00.000Z",
          },
          previewedAt: null,
          failureCode: null,
        },
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(
      <EvidenceWatermarkExportPanel
        productId={productId}
        documentId={documentId}
        version={version}
        enabled
        canManage
      />,
    );

    expect(
      screen.getByRole("button", { name: "Deliver reviewed derivative" }),
    ).toBeDisabled();
    expect(
      screen.getByText("Preview is required before delivery."),
    ).toBeInTheDocument();
  });
});
