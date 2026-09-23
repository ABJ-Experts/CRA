/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "../../_lib/http/api-client";

const openPortal = vi.hoisted(() => vi.fn());
const portalRequest = vi.hoisted(() => vi.fn());
vi.mock("./supplier-evidence.api", () => ({
  supplierEvidenceApi: {
    openPortal,
    portalRequest,
    initializePortalUpload: vi.fn(),
    completePortalUpload: vi.fn(),
    uploadPrivateObject: vi.fn(),
  },
}));

import { SupplierEvidencePortal } from "./supplier-evidence-portal";

describe("SupplierEvidencePortal", () => {
  afterEach(() => {
    cleanup();
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

  it("treats a privacy-safe revoked-link 404 as unavailable without exposing grant details", async () => {
    window.location.hash = `#${"a".repeat(32)}`;
    openPortal.mockRejectedValue(
      new ApiClientError("api", "Something went wrong. Please try again.", 404),
    );
    render(<SupplierEvidencePortal />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This portal link is expired, revoked, or no longer available.",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Ask the request owner to issue a new invitation.",
    );
    expect(screen.queryByText(/Something went wrong/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/grant/i)).not.toBeInTheDocument();
  });

  it("keeps network failure guidance distinct from an unavailable link", async () => {
    window.location.hash = `#${"a".repeat(32)}`;
    openPortal.mockRejectedValue(new ApiClientError("network", "Offline"));
    render(<SupplierEvidencePortal />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not reach the evidence service.",
    );
  });

  it("clears a retained revoked session on privacy-safe 404", async () => {
    sessionStorage.setItem(
      "cra.supplier-evidence.portal-session",
      "s".repeat(32),
    );
    portalRequest.mockRejectedValue(
      new ApiClientError("api", "Something went wrong. Please try again.", 404),
    );
    render(<SupplierEvidencePortal />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ask the request owner to issue a new invitation.",
    );
    expect(
      sessionStorage.getItem("cra.supplier-evidence.portal-session"),
    ).toBeNull();
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

  it("routes assigned SBOM items to the SBOM panel instead of the evidence-document selector", async () => {
    window.location.hash = `#${"a".repeat(32)}`;
    openPortal.mockResolvedValue({
      session: {
        sessionToken: "s".repeat(32),
        expiresAt: "2026-09-30T12:00:00.000Z",
        request: {
          requestReference: "request-12345678",
          title: "Supply component SBOM",
          instructions: null,
          disclosureContent: null,
          dueAt: "2026-09-30T12:00:00.000Z",
          items: [
            {
              id: "00000000-0000-4000-8000-000000000003",
              kind: "sbom",
              title: "Component SBOM",
              instructions: null,
              documentClass: "sbom",
              position: 0,
              reRequestReason: null,
              sbom: {
                allowedComponentRef: "pkg:npm/example@1.0.0",
                submission: null,
              },
            },
          ],
          submissions: [],
        },
      },
    });

    render(<SupplierEvidencePortal />);
    expect(
      await screen.findByRole("button", { name: "Upload SBOM" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Upload private evidence" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Component SBOM" }),
    ).not.toBeInTheDocument();
  });
});
