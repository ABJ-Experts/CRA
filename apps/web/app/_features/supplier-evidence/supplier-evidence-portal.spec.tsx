/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const openPortal = vi.hoisted(() => vi.fn());
vi.mock("./supplier-evidence.api", () => ({
  supplierEvidenceApi: {
    openPortal,
    initializePortalUpload: vi.fn(),
    completePortalUpload: vi.fn(),
    uploadPrivateObject: vi.fn(),
  },
}));

import { SupplierEvidencePortal } from "./supplier-evidence-portal";

describe("SupplierEvidencePortal", () => {
  afterEach(() => {
    sessionStorage.clear();
    window.history.replaceState(null, "", "/supplier-evidence");
    vi.clearAllMocks();
  });

  it("does not expose an internal request when no invitation or portal session exists", () => {
    render(<SupplierEvidencePortal />);
    expect(
      screen.getByRole("heading", {
        name: "This supplier link is unavailable",
      }),
    ).toBeInTheDocument();
    expect(openPortal).not.toHaveBeenCalled();
    expect(screen.queryByText(/organization/i)).not.toBeInTheDocument();
  });

  it("offers an explicit finalization retry after a dropped completion response", async () => {
    sessionStorage.setItem(
      "cra.supplier-evidence.pending-finalize.request-12345678",
      JSON.stringify({
        versionId: "00000000-0000-4000-8000-000000000001",
        idempotencyKey: "00000000-0000-4000-8000-000000000002",
      }),
    );
    window.location.hash = `#${"a".repeat(32)}`;
    openPortal.mockResolvedValue({
      session: {
        sessionToken: "a".repeat(32),
        expiresAt: "2026-09-30T12:00:00.000Z",
        request: {
          requestReference: "request-12345678",
          title: "Requested test report",
          instructions: null,
          disclosureContent: null,
          dueAt: "2026-09-30T12:00:00.000Z",
          items: [
            {
              id: "00000000-0000-4000-8000-000000000003",
              title: "Test report",
              instructions: null,
              documentClass: "test_report",
              position: 0,
            },
          ],
          submissions: [
            {
              id: "00000000-0000-4000-8000-000000000004",
              checklistItemId: "00000000-0000-4000-8000-000000000003",
              state: "uploading",
              fileName: "test.csv",
              mediaType: "text/csv",
              byteSize: 1,
              sha256: "a".repeat(64),
              rejectionReason: null,
              createdAt: "2026-09-22T12:00:00.000Z",
              updatedAt: "2026-09-22T12:00:00.000Z",
            },
          ],
        },
      },
    });

    render(<SupplierEvidencePortal />);

    expect(
      await screen.findByRole("button", { name: "Retry finalization" }),
    ).toBeInTheDocument();
  });
});
