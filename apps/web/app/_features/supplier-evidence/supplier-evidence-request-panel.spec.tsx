/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../_providers/session-provider", () => ({
  useHasPermission: () => true,
}));
vi.mock("../products/products.queries", () => ({
  useProductsQuery: () => ({
    isLoading: false,
    data: {
      products: {
        rows: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            name: "Sensor",
            internalCode: "SN-1",
          },
        ],
      },
    },
  }),
}));
vi.mock("./supplier-evidence.queries", () => ({
  useCreateSupplierEvidenceRequestMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useSupplierEvidenceRequestsQuery: () => ({
    isLoading: false,
    data: { requests: [] },
    refetch: vi.fn(),
  }),
  useSupplierEvidenceEligibleSbomRequestsQuery: () => ({
    data: {
      pages: [
        {
          requests: [
            {
              id: "22222222-2222-4222-8222-222222222222",
              releaseId: "33333333-3333-4333-8333-333333333333",
              supplierDisplayName: "Example supplier",
              allowedComponentRef: "pkg:npm/example@1.0.0",
              expiresAt: "2026-10-01T00:00:00.000Z",
            },
          ],
          nextCursor: null,
        },
      ],
    },
    isLoading: false,
    isError: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
  }),
}));
vi.mock("./supplier-evidence-review-panel", () => ({
  SupplierEvidenceReviewPanel: () => null,
}));
vi.mock("./supplier-evidence-reminders-panel", () => ({
  SupplierEvidenceRemindersPanel: () => null,
}));

import { SupplierEvidenceRequestPanel } from "./supplier-evidence-request-panel";

describe("SupplierEvidenceRequestPanel SBOM assignment", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("offers only an eligible pre-existing request after selecting a product and SBOM class", async () => {
    render(
      <SupplierEvidenceRequestPanel
        supplierId="44444444-4444-4444-8444-444444444444"
        contacts={[
          {
            id: "55555555-5555-4555-8555-555555555555",
            name: "Alice",
            email: "alice@example.test",
            state: "active",
          },
        ]}
        ownerUserId="66666666-6666-4666-8666-666666666666"
        readEnabled
        canReview
        canManage
        disabled={false}
      />,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Product" }), {
      target: { value: "11111111-1111-4111-8111-111111111111" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Class" }), {
      target: { value: "sbom" },
    });
    expect(
      await screen.findByRole("option", { name: /pkg:npm\/example@1\.0\.0/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/existing supplier SBOM request/i),
    ).toBeInTheDocument();
  });
});
