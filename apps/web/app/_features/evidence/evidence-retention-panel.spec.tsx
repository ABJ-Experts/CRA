// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "../../_lib/http/api-client";
import { EvidenceRetentionPanel } from "./evidence-retention-panel";

const queries = vi.hoisted(() => ({
  useCreateEvidenceDeletionIntentMutation: vi.fn(),
  useEvidenceLegalHoldsQuery: vi.fn(),
  useEvidenceRetentionReviewQuery: vi.fn(),
  usePlaceEvidenceLegalHoldMutation: vi.fn(),
  useReleaseEvidenceLegalHoldMutation: vi.fn(),
}));

vi.mock("./evidence.queries", () => queries);

const documentId = "22222222-2222-4222-8222-222222222222";
const versionId = "33333333-3333-4333-8333-333333333333";

function eligibleReview() {
  return {
    review: {
      documentId,
      currentVersionId: versionId,
      lifecycle: "active",
      reviewedAt: "2026-09-21T10:00:00.000Z",
      reviewFingerprint: "a".repeat(64),
      eligibleForDeletion: true,
      blockers: [],
      protection: {
        status: "current",
        retentionUntil: "2026-09-20T00:00:00.000Z",
        retentionProtectionUntil: "2026-09-20T00:00:00.000Z",
        legalHoldActive: false,
        identityHandling: "none",
      },
    },
  } as const;
}

function protectedReview() {
  return {
    review: {
      ...eligibleReview().review,
      eligibleForDeletion: false,
      blockers: [
        {
          visibility: "visible",
          kind: "product_retention",
          obligation: "Product retention",
          productId: "11111111-1111-4111-8111-111111111111",
          productName: "Gateway",
          protectThrough: "2030-01-01T00:00:00.000Z",
        },
      ],
      protection: {
        status: "current",
        retentionUntil: "2030-01-01T00:00:00.000Z",
        retentionProtectionUntil: "2030-01-01T00:00:00.000Z",
        legalHoldActive: false,
        identityHandling: "legal_review_required",
      },
    },
  } as const;
}

describe("EvidenceRetentionPanel", () => {
  const createDeletion = vi.fn();
  const placeHold = vi.fn();
  const releaseHold = vi.fn();

  beforeEach(() => {
    createDeletion.mockResolvedValue({});
    placeHold.mockResolvedValue({});
    releaseHold.mockResolvedValue({});
    queries.useEvidenceRetentionReviewQuery.mockReturnValue({
      data: eligibleReview(),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    queries.useEvidenceLegalHoldsQuery.mockReturnValue({
      data: { legalHolds: [] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    queries.useCreateEvidenceDeletionIntentMutation.mockReturnValue({
      mutateAsync: createDeletion,
      isPending: false,
    });
    queries.usePlaceEvidenceLegalHoldMutation.mockReturnValue({
      mutateAsync: placeHold,
      isPending: false,
    });
    queries.useReleaseEvidenceLegalHoldMutation.mockReturnValue({
      mutateAsync: releaseHold,
      isPending: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("requires an explicit confirmation and sends the exact reviewed version and fingerprint", async () => {
    render(
      <EvidenceRetentionPanel
        productId="11111111-1111-4111-8111-111111111111"
        documentId={documentId}
        enabled
        canManage
      />,
    );

    fireEvent.change(screen.getByLabelText("Deletion review reason"), {
      target: { value: "No longer needed after approved review." },
    });
    fireEvent.click(
      screen.getByLabelText(/I reviewed the current protection/i),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Request reviewed deletion" }),
    );

    await waitFor(() =>
      expect(createDeletion).toHaveBeenCalledWith({
        documentId,
        input: expect.objectContaining({
          expectedCurrentVersionId: versionId,
          reviewFingerprint: "a".repeat(64),
          confirmed: true,
          reason: "No longer needed after approved review.",
          idempotencyKey: expect.any(String),
        }),
      }),
    );
  });

  it("shows named permitted protection and never renders a deletion action when blocked", () => {
    queries.useEvidenceRetentionReviewQuery.mockReturnValue({
      data: protectedReview(),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(
      <EvidenceRetentionPanel
        productId="11111111-1111-4111-8111-111111111111"
        documentId={documentId}
        enabled
        canManage
      />,
    );

    expect(screen.getByText(/Product retention for Gateway/i)).toBeInTheDocument();
    expect(screen.getByText(/Original evidence remains immutable/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Request reviewed deletion" }),
    ).not.toBeInTheDocument();
  });

  it("fails closed in the review UI while legal-hold state is unavailable", () => {
    queries.useEvidenceLegalHoldsQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    });

    render(
      <EvidenceRetentionPanel
        productId="11111111-1111-4111-8111-111111111111"
        documentId={documentId}
        enabled
        canManage
      />,
    );

    expect(screen.getByText(/Legal holds could not be loaded/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Request reviewed deletion" }),
    ).not.toBeInTheDocument();
  });

  it("preserves the entered legal-hold reason when a recoverable request fails", async () => {
    placeHold.mockRejectedValueOnce(
      new ApiClientError("network", "The network is unavailable."),
    );
    render(
      <EvidenceRetentionPanel
        productId="11111111-1111-4111-8111-111111111111"
        documentId={documentId}
        enabled
        canManage
      />,
    );

    const reason = screen.getByLabelText("Legal hold reason");
    fireEvent.change(reason, {
      target: { value: "Preserve for regulator request." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Place legal hold" }));

    await waitFor(() =>
      expect(
        screen.getByText(/entered details are still here/i),
      ).toBeInTheDocument(),
    );
    expect(reason).toHaveValue("Preserve for regulator request.");
  });
});
