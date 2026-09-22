// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SupplierEvidenceReviewRequestDetail } from "@repo/contracts/supplier-evidence";

import { ApiClientError } from "../../_lib/http/api-client";

const queryHooks = vi.hoisted(() => ({
  useSupplierEvidenceReviewRequestQuery: vi.fn(),
  useReviewSupplierEvidenceSubmissionMutation: vi.fn(),
  useReRequestSupplierEvidenceRequestMutation: vi.fn(),
}));

vi.mock("./supplier-evidence.queries", () => queryHooks);

import { SupplierEvidenceReviewPanel } from "./supplier-evidence-review-panel";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "22222222-2222-4222-8222-222222222222";
const SUBMISSION_ID = "33333333-3333-4333-8333-333333333333";
const DOCUMENT_ID = "44444444-4444-4444-8444-444444444444";
const VERSION_ID = "55555555-5555-4555-8555-555555555555";
const USER_ID = "66666666-6666-4666-8666-666666666666";
const NOW = "2026-09-22T10:00:00.000Z";
const HASH = "a".repeat(64);

function noOpMutation() {
  return { isPending: false, mutateAsync: vi.fn() };
}

const request: SupplierEvidenceReviewRequestDetail = {
  id: REQUEST_ID,
  supplierId: DOCUMENT_ID,
  productId: DOCUMENT_ID,
  recipientContactId: USER_ID,
  ownerUserId: USER_ID,
  state: "open",
  version: 3,
  reviewState: "awaiting_review",
  aggregateReviewState: "awaiting_review",
  currentRevision: {
    id: VERSION_ID,
    revisionNumber: 1,
    title: "Supplier security evidence",
    instructions: null,
    dueAt: NOW,
    disclosureContent: null,
    disclosureFingerprint: HASH,
    items: [],
    createdAt: NOW,
    createdBy: USER_ID,
  },
  activeInvitation: null,
  createdAt: NOW,
  updatedAt: NOW,
  revisions: [],
  invitations: [],
  reviewItems: [
    {
      id: ITEM_ID,
      title: "Penetration test report",
      instructions: "Provide the signed report.",
      documentClass: "test_report",
      position: 0,
      state: "awaiting_review",
      sourceRequestItemId: null,
      reRequestReason: null,
      submissions: [
        {
          id: SUBMISSION_ID,
          checklistItemId: ITEM_ID,
          revisionId: VERSION_ID,
          state: "submitted_pending_review",
          fileName: "supplier-report.pdf",
          mediaType: "application/pdf",
          byteSize: 1024,
          sha256: HASH,
          evidenceDocumentId: DOCUMENT_ID,
          evidenceVersionId: VERSION_ID,
          evidenceProcessingState: "clean",
          processingState: "clean",
          reviewState: null,
          rejectionReason: null,
          createdAt: NOW,
          updatedAt: NOW,
          reviews: [],
        },
      ],
    },
  ],
  submissions: [],
  reviews: [],
};

function defaults() {
  queryHooks.useSupplierEvidenceReviewRequestQuery.mockReturnValue({
    data: { request },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  queryHooks.useReviewSupplierEvidenceSubmissionMutation.mockReturnValue(
    noOpMutation(),
  );
  queryHooks.useReRequestSupplierEvidenceRequestMutation.mockReturnValue(
    noOpMutation(),
  );
}

describe("SupplierEvidenceReviewPanel", () => {
  beforeEach(() => {
    defaults();
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => USER_ID) });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("requires a supplier-safe reason before a rejection can be reviewed", async () => {
    const user = userEvent.setup();
    render(
      <SupplierEvidenceReviewPanel requests={[request]} canReview enabled />,
    );

    await user.selectOptions(
      screen.getByLabelText(
        "Decision for supplier evidence supplier-report.pdf",
      ),
      "reject",
    );
    expect(
      screen.getByLabelText("Supplier-visible rejection reason"),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Review reject" }),
    ).toBeDisabled();
  });

  it("keeps the supplier-visible reason and internal note in separate review fields", async () => {
    const user = userEvent.setup();
    const mutateAsync = vi.fn().mockResolvedValue({ request });
    queryHooks.useReviewSupplierEvidenceSubmissionMutation.mockReturnValue({
      isPending: false,
      mutateAsync,
    });
    render(
      <SupplierEvidenceReviewPanel requests={[request]} canReview enabled />,
    );

    await user.selectOptions(
      screen.getByLabelText(
        "Decision for supplier evidence supplier-report.pdf",
      ),
      "reject",
    );
    await user.type(
      screen.getByLabelText("Supplier-visible rejection reason"),
      "The signature page is missing.",
    );
    await user.type(
      screen.getByLabelText(/Internal review note/),
      "Confirmed against the intake checklist.",
    );
    await user.click(screen.getByRole("button", { name: "Review reject" }));
    await user.click(screen.getByRole("button", { name: "Confirm reject" }));

    expect(mutateAsync).toHaveBeenCalledWith({
      submissionId: SUBMISSION_ID,
      input: expect.objectContaining({
        decision: "reject",
        supplierVisibleReason: "The signature page is missing.",
        internalNote: "Confirmed against the intake checklist.",
        expectedEvidenceVersionId: VERSION_ID,
        expectedSha256: HASH,
      }),
    });
  });

  it("preserves review text after a stale-decision conflict", async () => {
    const user = userEvent.setup();
    const mutateAsync = vi
      .fn()
      .mockRejectedValue(new ApiClientError("api", "Conflict", 409));
    queryHooks.useReviewSupplierEvidenceSubmissionMutation.mockReturnValue({
      isPending: false,
      mutateAsync,
    });
    render(
      <SupplierEvidenceReviewPanel requests={[request]} canReview enabled />,
    );

    await user.selectOptions(
      screen.getByLabelText(
        "Decision for supplier evidence supplier-report.pdf",
      ),
      "reject",
    );
    const reason = screen.getByLabelText("Supplier-visible rejection reason");
    await user.type(reason, "The document is incomplete.");
    await user.click(screen.getByRole("button", { name: "Review reject" }));
    await user.click(screen.getByRole("button", { name: "Confirm reject" }));

    expect(reason).toHaveValue("The document is incomplete.");
    expect(
      screen.getByText(
        "This evidence changed elsewhere. Reload the request before recording a decision.",
      ),
    ).toBeVisible();
  });

  it("reuses the same idempotency key when an uncertain network decision is retried", async () => {
    const user = userEvent.setup();
    const mutateAsync = vi
      .fn()
      .mockRejectedValueOnce(new ApiClientError("network", "Offline"))
      .mockResolvedValueOnce({ request });
    queryHooks.useReviewSupplierEvidenceSubmissionMutation.mockReturnValue({
      isPending: false,
      mutateAsync,
    });
    render(
      <SupplierEvidenceReviewPanel requests={[request]} canReview enabled />,
    );

    await user.click(screen.getByRole("button", { name: "Review accept" }));
    await user.click(screen.getByRole("button", { name: "Confirm accept" }));
    await user.click(screen.getByRole("button", { name: "Review accept" }));
    await user.click(screen.getByRole("button", { name: "Confirm accept" }));

    expect(mutateAsync).toHaveBeenCalledTimes(2);
    expect(mutateAsync.mock.calls[0]?.[0].input.idempotencyKey).toBe(
      mutateAsync.mock.calls[1]?.[0].input.idempotencyKey,
    );
  });
});
