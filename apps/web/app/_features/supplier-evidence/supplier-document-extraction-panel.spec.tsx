// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
  useSupplierDocumentExtractionQuery: vi.fn(),
  useStartSupplierDocumentExtractionMutation: vi.fn(),
  useDecideSupplierDocumentFieldMutation: vi.fn(),
  useCreateManualSupplierDocumentFieldMutation: vi.fn(),
}));
vi.mock("./supplier-evidence.queries", () => hooks);
vi.mock("../evidence/evidence.api", () => ({
  evidenceApi: { access: vi.fn() },
}));

import { SupplierDocumentExtractionPanel } from "./supplier-document-extraction-panel";
import { evidenceApi } from "../evidence/evidence.api";

const id = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const now = "2026-09-23T12:00:00.000Z";
const sha256 = "a".repeat(64);
const submission = {
  id,
  checklistItemId: id,
  revisionId: id,
  state: "accepted" as const,
  fileName: "certification.pdf",
  mediaType: "application/pdf" as const,
  byteSize: 1024,
  sha256,
  evidenceDocumentId: id,
  evidenceVersionId: id,
  evidenceProcessingState: "clean" as const,
  processingState: "clean" as const,
  reviewState: "accepted" as const,
  rejectionReason: null,
  createdAt: now,
  updatedAt: now,
  reviews: [],
};

function defaults() {
  hooks.useSupplierDocumentExtractionQuery.mockReturnValue({
    data: {
      pages: [
        {
          run: {
            id,
            submissionId: id,
            evidenceVersionId: id,
            evidenceSha256: sha256,
            status: "completed",
            model: "local-model",
            promptVersion: "supplier-fields-v1",
            createdAt: now,
            completedAt: now,
            errorCode: null,
          },
          suggestions: [
            {
              id: otherId,
              origin: "ai",
              runId: id,
              evidenceVersionId: id,
              evidenceSha256: sha256,
              model: "local-model",
              promptVersion: "supplier-fields-v1",
              fieldKey: "certification_held",
              candidateGroup: "certificate-1",
              originalValue: "ISO 9001",
              correctedValue: null,
              confidence: 0.93,
              sourceSpan: {
                page: 1,
                startOffset: 6,
                endOffset: 14,
                quote: "ISO 9001",
              },
              status: "pending",
              version: 0,
              reviewedByUserId: null,
              reviewedAt: null,
              createdAt: now,
            },
          ],
          pages: [{ page: 1, text: "holds ISO 9001 for production" }],
          nextCursor: null,
        },
      ],
      pageParams: [null],
    },
    isLoading: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  });
  hooks.useStartSupplierDocumentExtractionMutation.mockReturnValue({
    isPending: false,
    mutateAsync: vi.fn(),
  });
  hooks.useDecideSupplierDocumentFieldMutation.mockReturnValue({
    isPending: false,
    mutateAsync: vi.fn(),
  });
  hooks.useCreateManualSupplierDocumentFieldMutation.mockReturnValue({
    isPending: false,
    mutateAsync: vi.fn(),
  });
}

describe("SupplierDocumentExtractionPanel", () => {
  beforeEach(() => {
    defaults();
    vi.stubGlobal("crypto", { randomUUID: () => id });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows the exact passage and requires explicit per-field confirmation", async () => {
    const user = userEvent.setup();
    const mutateAsync = vi.fn().mockResolvedValue({});
    hooks.useDecideSupplierDocumentFieldMutation.mockReturnValue({
      isPending: false,
      mutateAsync,
    });
    render(
      <SupplierDocumentExtractionPanel
        requestId={id}
        requestVersion={3}
        productId={id}
        submission={submission}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: /View source for ISO 9001/ }),
    );
    expect(screen.getByText("ISO 9001", { selector: "mark" })).toBeVisible();
    expect(screen.getByText(/93% confidence/)).toBeVisible();
    await user.clear(
      screen.getByLabelText("Confirmed value for Certification Held"),
    );
    await user.type(
      screen.getByLabelText("Confirmed value for Certification Held"),
      "ISO 9001:2015",
    );
    await user.click(screen.getByRole("button", { name: "Confirm field" }));
    expect(mutateAsync).toHaveBeenCalledWith({
      fieldId: otherId,
      input: expect.objectContaining({
        productId: id,
        decision: "confirm",
        correctedValue: "ISO 9001:2015",
        expectedFieldVersion: 0,
        expectedSha256: sha256,
      }),
    });
  });

  it("opens a verified relative PDF delivery URL at the cited page", async () => {
    vi.mocked(evidenceApi.access).mockResolvedValue({
      access: {
        previewSupported: true,
        mediaType: "application/pdf",
        deliveryUrl: "/api/v1/evidence-delivery/verified-token",
      },
    } as Awaited<ReturnType<typeof evidenceApi.access>>);
    render(
      <SupplierDocumentExtractionPanel
        requestId={id}
        requestVersion={3}
        productId={id}
        submission={submission}
      />,
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /View source for ISO 9001/ }));
    await waitFor(() => {
      expect(
        screen.getByTitle("Verified certification.pdf, page 1"),
      ).toHaveAttribute(
        "src",
        `${window.location.origin}/api/v1/evidence-delivery/verified-token#page=1`,
      );
    });
  });

  it("keeps older-run suggestions visible but prevents applying their stale source", async () => {
    const current = hooks.useSupplierDocumentExtractionQuery();
    hooks.useSupplierDocumentExtractionQuery.mockReturnValue({
      ...current,
      data: {
        ...current.data,
        pages: current.data.pages.map(
          (page: { suggestions: Array<{ id: string }> }) => ({
            ...page,
            suggestions: page.suggestions.map((field) => ({
              ...field,
              evidenceSha256: "b".repeat(64),
            })),
          }),
        ),
      },
    });
    render(
      <SupplierDocumentExtractionPanel
        requestId={id}
        requestVersion={3}
        productId={id}
        submission={submission}
      />,
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /View source for ISO 9001/ }));
    expect(
      screen.getByText(/Older evidence version; confirmation unavailable/),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Confirm field" }),
    ).toBeDisabled();
  });

  it("does not allow low-confidence confirmation but keeps rejection and manual entry", async () => {
    const current = hooks.useSupplierDocumentExtractionQuery();
    hooks.useSupplierDocumentExtractionQuery.mockReturnValue({
      ...current,
      data: {
        ...current.data,
        pages: current.data.pages.map(
          (page: { suggestions: Array<{ id: string }> }) => ({
            ...page,
            suggestions: page.suggestions.map((field) => ({
              ...field,
              confidence: 0.55,
            })),
          }),
        ),
      },
    });
    render(
      <SupplierDocumentExtractionPanel
        requestId={id}
        requestVersion={3}
        productId={id}
        submission={submission}
      />,
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /View source for ISO 9001/ }));
    expect(
      screen.getByRole("button", { name: "Confirm field" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Reject suggestion" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("heading", { name: "Enter a field manually" }),
    ).toBeVisible();
  });

  it("loads older fields without discarding an unsaved correction or selected passage", async () => {
    const user = userEvent.setup();
    const current = hooks.useSupplierDocumentExtractionQuery();
    const fetchNextPage = vi.fn().mockResolvedValue({});
    hooks.useSupplierDocumentExtractionQuery.mockReturnValue({
      ...current,
      hasNextPage: true,
      fetchNextPage,
    });
    const view = render(
      <SupplierDocumentExtractionPanel
        requestId={id}
        requestVersion={3}
        productId={id}
        submission={submission}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: /View source for ISO 9001/ }),
    );
    const input = screen.getByLabelText(
      "Confirmed value for Certification Held",
    );
    await user.clear(input);
    await user.type(input, "ISO 9001:2015");
    await user.click(screen.getByRole("button", { name: "Load older fields" }));
    expect(fetchNextPage).toHaveBeenCalledOnce();
    hooks.useSupplierDocumentExtractionQuery.mockReturnValue({
      ...current,
      data: {
        ...current.data,
        pages: [
          current.data.pages[0],
          {
            run: current.data.pages[0].run,
            suggestions: [
              {
                ...current.data.pages[0].suggestions[0],
                id: "33333333-3333-4333-8333-333333333333",
                originalValue: "ISO 27001",
                candidateGroup: "certificate-2",
              },
            ],
            pages: [],
            nextCursor: null,
          },
        ],
      },
    });
    view.rerender(
      <SupplierDocumentExtractionPanel
        requestId={id}
        requestVersion={3}
        productId={id}
        submission={submission}
      />,
    );
    expect(input).toHaveValue("ISO 9001:2015");
    expect(screen.getByText("ISO 9001", { selector: "mark" })).toBeVisible();
    expect(screen.getByText("ISO 27001", { exact: true })).toBeVisible();
  });
});
