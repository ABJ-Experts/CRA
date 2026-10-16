/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { supplierEvidencePortalRequestSchema } from "@repo/contracts/supplier-evidence";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "../../_lib/http/api-client";

const completeSbomPortalUpload = vi.hoisted(() => vi.fn());
const initializeSbomPortalUpload = vi.hoisted(() => vi.fn());
const uploadPrivateObject = vi.hoisted(() => vi.fn());
vi.mock("./supplier-evidence.api", () => ({
  supplierEvidenceApi: {
    initializeSbomPortalUpload,
    completeSbomPortalUpload,
    uploadPrivateObject,
  },
}));

import { SupplierEvidenceSbomItem } from "./supplier-evidence-sbom-item";

const ITEM_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_ID = "22222222-2222-4222-8222-222222222222";
const item = supplierEvidencePortalRequestSchema.parse({
  requestReference: "request-12345678",
  title: "Supplier request",
  instructions: null,
  disclosureContent: null,
  dueAt: "2026-09-30T12:00:00.000Z",
  items: [
    {
      id: ITEM_ID,
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
}).items[0]!;

describe("SupplierEvidenceSbomItem", () => {
  afterEach(() => {
    cleanup();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("reuses the reservation idempotency key for completion and a saved retry", async () => {
    const reservationKey = "55555555-5555-4555-8555-555555555555";
    vi.stubGlobal("crypto", {
      randomUUID: vi
        .fn()
        .mockReturnValueOnce(reservationKey)
        .mockReturnValueOnce("66666666-6666-4666-8666-666666666666"),
      subtle: { digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer) },
    });
    initializeSbomPortalUpload.mockResolvedValue({
      sourceId: SOURCE_ID,
      upload: {
        uploadUrl: "https://storage.example.test/upload",
        expiresAt: "2026-09-23T12:00:00.000Z",
      },
    });
    uploadPrivateObject.mockResolvedValue(undefined);
    completeSbomPortalUpload.mockRejectedValue(
      new ApiClientError("network", "Offline"),
    );
    render(
      <SupplierEvidenceSbomItem
        item={item}
        sessionToken={"s".repeat(32)}
        requestReference="request-12345678"
        refresh={vi.fn()}
      />,
    );
    const file = new File(["{}"], "component.cdx.json", {
      type: "application/json",
    });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new Uint8Array([123, 125]).buffer,
    });
    fireEvent.change(screen.getByLabelText("SBOM file"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload SBOM" }));

    await waitFor(() =>
      expect(completeSbomPortalUpload).toHaveBeenCalledOnce(),
    );
    const initInput = initializeSbomPortalUpload.mock.calls[0]?.[1];
    const completeInput = completeSbomPortalUpload.mock.calls[0]?.[2];
    expect(initInput.idempotencyKey).toBe(reservationKey);
    expect(completeInput.idempotencyKey).toBe(initInput.idempotencyKey);
    expect(
      JSON.parse(
        sessionStorage.getItem(
          `cra.supplier-evidence.sbom-pending-finalize.request-12345678.${ITEM_ID}`,
        ) ?? "null",
      ),
    ).toMatchObject({ idempotencyKey: reservationKey });
  });

  it("shows only the assigned component and normal intake constraints, without internal IDs or findings", () => {
    render(
      <SupplierEvidenceSbomItem
        item={item}
        sessionToken={"s".repeat(32)}
        requestReference="request-12345678"
        refresh={vi.fn()}
      />,
    );
    expect(screen.getByText("pkg:npm/example@1.0.0")).toBeInTheDocument();
    expect(screen.getByText(/100 MiB maximum/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /upload sbom/i })).toBeDisabled();
    expect(
      screen.queryByText("33333333-3333-4333-8333-333333333333"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/vulnerabilit/i)).not.toBeInTheDocument();
  });

  it("retries finalization without uploading bytes again", async () => {
    sessionStorage.setItem(
      `cra.supplier-evidence.sbom-pending-finalize.request-12345678.${ITEM_ID}`,
      JSON.stringify({
        sourceId: SOURCE_ID,
        idempotencyKey: crypto.randomUUID(),
      }),
    );
    completeSbomPortalUpload.mockResolvedValue({
      submission: {
        id: "44444444-4444-4444-8444-444444444444",
        state: "processing",
        fileName: "component.cdx.json",
        validationMessage: null,
        createdAt: "2026-09-23T00:00:00.000Z",
        updatedAt: "2026-09-23T00:00:00.000Z",
      },
    });
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(
      <SupplierEvidenceSbomItem
        item={item}
        sessionToken={"s".repeat(32)}
        requestReference="request-12345678"
        refresh={refresh}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry finalization" }));
    await waitFor(() =>
      expect(completeSbomPortalUpload).toHaveBeenCalledOnce(),
    );
    expect(completeSbomPortalUpload).toHaveBeenCalledWith(
      ITEM_ID,
      SOURCE_ID,
      expect.objectContaining({ sessionToken: "s".repeat(32) }),
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("keeps the same finalization retry after completion succeeds but status refresh fails", async () => {
    const key = `cra.supplier-evidence.sbom-pending-finalize.request-12345678.${ITEM_ID}`;
    sessionStorage.setItem(
      key,
      JSON.stringify({
        sourceId: SOURCE_ID,
        idempotencyKey: "55555555-5555-4555-8555-555555555555",
      }),
    );
    completeSbomPortalUpload.mockResolvedValue({
      submission: { state: "processing" },
    });
    render(
      <SupplierEvidenceSbomItem
        item={item}
        sessionToken={"s".repeat(32)}
        requestReference="request-12345678"
        refresh={vi
          .fn()
          .mockRejectedValue(new ApiClientError("network", "Offline"))}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry finalization" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Retry finalization" }),
      ).toBeEnabled(),
    );
    expect(sessionStorage.getItem(key)).not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      /retried without re-uploading/i,
    );
  });

  it("lets a reissued session discard an unusable retry hint without deleting the immutable source", async () => {
    const key = `cra.supplier-evidence.sbom-pending-finalize.request-12345678.${ITEM_ID}`;
    sessionStorage.setItem(
      key,
      JSON.stringify({
        sourceId: SOURCE_ID,
        idempotencyKey: "55555555-5555-4555-8555-555555555555",
      }),
    );
    completeSbomPortalUpload.mockRejectedValue(
      new ApiClientError("api", "Grant no longer active", 403),
    );
    render(
      <SupplierEvidenceSbomItem
        item={item}
        sessionToken={"n".repeat(32)}
        requestReference="request-12345678"
        refresh={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry finalization" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Discard saved retry" }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Discard saved retry" }),
    );
    expect(sessionStorage.getItem(key)).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      /previously uploaded source remains private and immutable/i,
    );
    expect(screen.getByRole("button", { name: "Upload SBOM" })).toBeDisabled();
    expect(initializeSbomPortalUpload).not.toHaveBeenCalled();
  });

  it("rejects an unsupported file locally and keeps it selected for correction", () => {
    render(
      <SupplierEvidenceSbomItem
        item={item}
        sessionToken={"s".repeat(32)}
        requestReference="request-12345678"
        refresh={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("SBOM file") as HTMLInputElement;
    const file = new File(["not an SBOM"], "picture.png", {
      type: "image/png",
    });
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload SBOM" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Use a CycloneDX or SPDX JSON or XML file.",
    );
    expect(input.files?.[0]).toBe(file);
    expect(initializeSbomPortalUpload).not.toHaveBeenCalled();
  });

  it("offers an explicit status refresh while the standard intake is processing", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(
      <SupplierEvidenceSbomItem
        item={{
          ...item,
          sbom: {
            allowedComponentRef: "pkg:npm/example@1.0.0",
            submission: {
              id: "44444444-4444-4444-8444-444444444444",
              state: "processing",
              fileName: "component.cdx.json",
              validationMessage: null,
              createdAt: "2026-09-23T00:00:00.000Z",
              updatedAt: "2026-09-23T00:00:00.000Z",
            },
          },
        }}
        sessionToken={"s".repeat(32)}
        requestReference="request-12345678"
        refresh={refresh}
      />,
    );
    expect(
      screen.getByText(/Processing in the standard SBOM intake pipeline/i),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(
      screen.queryByRole("button", { name: "Upload SBOM" }),
    ).not.toBeInTheDocument();
  });
});
