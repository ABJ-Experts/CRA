// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SbomCompositeReviewSection } from "./sbom-composite-review-section";
import { SbomSupplierReviewSection } from "./sbom-supplier-review-section";

const queryHooks = vi.hoisted(() => ({
  useSbomSourceHistoryQuery: vi.fn(),
  useSbomCompositeReviewQuery: vi.fn(),
  useCreateSbomCompositeReviewMutation: vi.fn(),
  useResolveSbomCompositeConflictMutation: vi.fn(),
  useResolveSbomCompositeRelationshipMutation: vi.fn(),
  useGenerateSbomCompositeMutation: vi.fn(),
  useSupplierSbomRequestsQuery: vi.fn(),
  useCreateSupplierSbomRequestMutation: vi.fn(),
  useCreateSupplierSbomInvitationMutation: vi.fn(),
  useReviewSupplierSbomSubmissionMutation: vi.fn(),
}));

vi.mock("../../_features/sboms/sboms.queries", () => queryHooks);

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const RELEASE_ID = "22222222-2222-4222-8222-222222222222";
const SOURCE_ID = "33333333-3333-4333-8333-333333333333";
const REQUEST_ID = "44444444-4444-4444-8444-444444444444";
const NOW = "2026-08-25T10:00:00.000Z";
const HASH = "a".repeat(64);
const RELEASES = [{ id: RELEASE_ID, label: "Sentinel 1.0", version: "1.0.0" }];

function noOpMutation() {
  return { isPending: false, mutateAsync: vi.fn() };
}

function defaults() {
  queryHooks.useSbomSourceHistoryQuery.mockReturnValue({
    data: {
      sources: [
        {
          source: {
            id: SOURCE_ID,
            organizationId: PRODUCT_ID,
            productId: PRODUCT_ID,
            releaseId: RELEASE_ID,
            source: "manual_upload",
            fileName: "sentinel.cdx.json",
            mediaType: "application/vnd.cyclonedx+json",
            byteSize: 100,
            sha256: HASH,
            status: "verified",
            declaredFormat: "cyclonedx",
            declaredSpecVersion: "1.6",
            createdAt: NOW,
            completedAt: NOW,
          },
          validation: {
            status: "valid",
            errorCount: 0,
            warningCount: 0,
            omittedDiagnosticCount: 0,
            completedAt: NOW,
          },
        },
      ],
      nextCursor: null,
    },
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  queryHooks.useSbomCompositeReviewQuery.mockReturnValue({
    data: undefined,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  queryHooks.useCreateSbomCompositeReviewMutation.mockReturnValue(
    noOpMutation(),
  );
  queryHooks.useResolveSbomCompositeConflictMutation.mockReturnValue(
    noOpMutation(),
  );
  queryHooks.useResolveSbomCompositeRelationshipMutation.mockReturnValue(
    noOpMutation(),
  );
  queryHooks.useGenerateSbomCompositeMutation.mockReturnValue(noOpMutation());
  queryHooks.useSupplierSbomRequestsQuery.mockReturnValue({
    data: { requests: [], nextCursor: null },
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  queryHooks.useCreateSupplierSbomRequestMutation.mockReturnValue(
    noOpMutation(),
  );
  queryHooks.useCreateSupplierSbomInvitationMutation.mockReturnValue(
    noOpMutation(),
  );
  queryHooks.useReviewSupplierSbomSubmissionMutation.mockReturnValue(
    noOpMutation(),
  );
}

describe("SBOM composite and supplier review sections", () => {
  beforeEach(() => {
    defaults();
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => REQUEST_ID) });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("selects only valid source evidence before preparing an immutable composite review", async () => {
    const user = userEvent.setup();
    const create = vi.fn().mockResolvedValue({ review: { id: REQUEST_ID } });
    queryHooks.useCreateSbomCompositeReviewMutation.mockReturnValue({
      isPending: false,
      mutateAsync: create,
    });

    render(
      <SbomCompositeReviewSection
        productId={PRODUCT_ID}
        releases={RELEASES}
        canReview
        enabled
      />,
    );

    expect(screen.getByText("sentinel.cdx.json")).toBeVisible();
    await user.click(screen.getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", { name: "Prepare composite review" }),
    );

    expect(create).toHaveBeenCalledWith({
      productId: PRODUCT_ID,
      releaseId: RELEASE_ID,
      input: { sourceIds: [SOURCE_ID], idempotencyKey: REQUEST_ID },
    });
  });

  it("creates a scoped supplier request and reveals its one-time invitation only after creation", async () => {
    const user = userEvent.setup();
    const createRequest = vi.fn().mockResolvedValue({
      request: { id: REQUEST_ID },
    });
    const createInvitation = vi.fn().mockResolvedValue({
      invitationToken: "x".repeat(32),
    });
    queryHooks.useCreateSupplierSbomRequestMutation.mockReturnValue({
      isPending: false,
      mutateAsync: createRequest,
    });
    queryHooks.useCreateSupplierSbomInvitationMutation.mockReturnValue({
      isPending: false,
      mutateAsync: createInvitation,
    });

    render(
      <SbomSupplierReviewSection
        productId={PRODUCT_ID}
        releases={RELEASES}
        canReview
        enabled
      />,
    );

    expect(
      screen.queryByLabelText("One-time supplier invitation token"),
    ).not.toBeInTheDocument();
    await user.type(
      screen.getByLabelText("Supplier display name"),
      "ACME Parts",
    );
    await user.type(
      screen.getByLabelText("Allowed component reference"),
      "module-17",
    );
    await user.click(
      screen.getByRole("button", { name: "Create supplier invitation" }),
    );

    expect(createRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: PRODUCT_ID,
        releaseId: RELEASE_ID,
        input: expect.objectContaining({
          supplierDisplayName: "ACME Parts",
          allowedComponentRef: "module-17",
        }),
      }),
    );
    expect(createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: REQUEST_ID }),
    );
    expect(
      screen.getByLabelText("One-time supplier invitation token"),
    ).toHaveValue("x".repeat(32));
  });
});
