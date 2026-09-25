// @vitest-environment jsdom

import type { EvidenceBulkIntakeBatch } from "@repo/contracts/evidence";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EvidenceBulkIntakePanel } from "./evidence-bulk-intake-panel";

const queries = vi.hoisted(() => ({
  useCancelEvidenceBulkIntakeItemMutation: vi.fn(),
  useCompleteEvidenceBulkIntakeItemMutation: vi.fn(),
  useCreateEvidenceBulkIntakeBatchMutation: vi.fn(),
  useEvidenceBulkIntakeBatchQuery: vi.fn(),
  useInitializeEvidenceBulkIntakeItemMutation: vi.fn(),
  useRetryEvidenceBulkIntakeItemMutation: vi.fn(),
}));

vi.mock("./evidence.queries", () => queries);

const productId = "11111111-1111-4111-8111-111111111111";
const ownerUserId = "00000000-0000-4000-8000-000000000001";

function emptyBatch(): EvidenceBulkIntakeBatch {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    productId,
    createdByUserId: ownerUserId,
    createdAt: "2026-09-21T10:00:00.000Z",
    updatedAt: "2026-09-21T10:00:00.000Z",
    status: "active",
    counts: {
      total: 0,
      unconfirmed: 0,
      ready: 0,
      uploading: 0,
      scanPending: 0,
      clean: 0,
      quarantined: 0,
      failed: 0,
      cancelled: 0,
      success: 0,
      pending: 0,
      rejected: 0,
    },
    items: [],
  };
}

describe("EvidenceBulkIntakePanel", () => {
  const create = vi.fn();

  beforeEach(() => {
    create.mockResolvedValue({ batch: emptyBatch() });
    queries.useCreateEvidenceBulkIntakeBatchMutation.mockReturnValue({
      mutateAsync: create,
      isPending: false,
    });
    queries.useEvidenceBulkIntakeBatchQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    for (const mutation of [
      queries.useCancelEvidenceBulkIntakeItemMutation,
      queries.useCompleteEvidenceBulkIntakeItemMutation,
      queries.useInitializeEvidenceBulkIntakeItemMutation,
      queries.useRetryEvidenceBulkIntakeItemMutation,
    ]) {
      mutation.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    }
  });

  afterEach(() => vi.clearAllMocks());

  it("creates one durable review batch without submitting a browser-derived classification", async () => {
    render(
      <EvidenceBulkIntakePanel
        productId={productId}
        ownerUserId={ownerUserId}
        enabled
      />,
    );
    const file = new File(["report"], "gateway-test-report.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(screen.getByLabelText("Evidence files"), {
      target: { files: [file] },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create review batch" }),
    );

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        idempotencyKey: expect.any(String),
        items: [
          expect.objectContaining({
            title: "gateway test report",
            ownerUserId,
            productIds: [productId],
            fileName: "gateway-test-report.pdf",
            byteSize: file.size,
          }),
        ],
      }),
    );
    expect(create.mock.calls[0]?.[0].items[0]).not.toHaveProperty(
      "classification",
    );
  });
});
