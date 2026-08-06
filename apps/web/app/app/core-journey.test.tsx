import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FindingDetail } from "./findings/[id]/finding-detail";
import { FindingsQueue } from "./findings/findings-queue";
import { ProductDetail } from "./products/[id]/product-detail";
import { ProductsWorkspace } from "./products/products-workspace";

const mocks = vi.hoisted(() => ({
  browserApi: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

vi.mock("./_lib/browser-api", () => ({
  browserApi: mocks.browserApi,
  jsonRequest: (body: unknown) => ({ method: "POST", body: JSON.stringify(body) }),
}));

const product = {
  id: "00000000-0000-7000-8000-000000000001",
  name: "Gateway",
  internalCode: "GW-1",
  productType: "standalone_software",
  lifecycleState: "development",
  placedOnMarketAt: null,
  version: 1,
};

const finding = {
  id: "00000000-0000-7000-8000-000000000002",
  advisoryId: "CVE-2026-0001",
  matchMethod: "purl_exact",
  matchConfidence: 1,
  cvssBase: 9.8,
  kevListed: true,
  vexStatus: "not_assessed",
  vexJustification: null,
  state: "open",
  lowConfidence: false,
  falsePositiveReason: null,
  version: 1,
};

const principal = {
  organisationId: "00000000-0000-7000-8000-000000000003",
  roleKey: "owner",
  permissions: [
    "product:create",
    "product:update",
    "product:archive",
    "sbom:upload",
    "finding:triage",
    "finding:assess",
  ],
  mfaSatisfied: true,
};

describe("core journey controls", () => {
  beforeEach(() => {
    mocks.browserApi.mockReset();
    mocks.push.mockReset();
    mocks.refresh.mockReset();
  });

  it("hides product creation without the effective permission", () => {
    render(
      createElement(ProductsWorkspace, {
        products: [],
        principal: { ...principal, permissions: [] },
      }),
    );
    expect(screen.queryByRole("button", { name: "Add product" })).not.toBeInTheDocument();
  });

  it("creates a product through the session proxy", async () => {
    mocks.browserApi.mockResolvedValue({ data: product });
    render(createElement(ProductsWorkspace, { products: [], principal }));

    fireEvent.click(screen.getByRole("button", { name: "Add product" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Gateway" } });
    fireEvent.change(screen.getByLabelText("Internal code"), { target: { value: "GW-1" } });
    fireEvent.submit(screen.getByRole("button", { name: "Create product" }).closest("form")!);

    await waitFor(() =>
      expect(mocks.browserApi).toHaveBeenCalledWith(
        "/products",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(mocks.push).toHaveBeenCalledWith(`/app/products/${product.id}`);
  });

  it("creates a release and uploads its raw SBOM through the canonical proxy", async () => {
    const release = {
      id: "00000000-0000-7000-8000-000000000004",
      productId: product.id,
      versionLabel: "1.0.0",
      lifecycleState: "development",
      sbomCount: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    mocks.browserApi
      .mockResolvedValueOnce({ data: { id: release.id } })
      .mockResolvedValueOnce({
        data: {
          ingest: { validationStatus: "valid", componentCount: 1, deduplicated: false },
          match: { findingsCreated: 2, kevFindings: 1 },
        },
      });
    render(
      createElement(ProductDetail, {
        product,
        releases: [release],
        principal,
      }),
    );

    fireEvent.change(screen.getByPlaceholderText("Version, e.g. 1.0.0"), {
      target: { value: "1.1.0" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Add release" }).closest("form")!);
    await waitFor(() =>
      expect(mocks.browserApi).toHaveBeenCalledWith(
        "/releases",
        expect.objectContaining({ method: "POST" }),
      ),
    );

    const file = new File(['{"bomFormat":"CycloneDX"}'], "bom.json", { type: "application/json" });
    Object.defineProperty(file, "text", {
      value: vi.fn().mockResolvedValue('{"bomFormat":"CycloneDX"}'),
    });
    fireEvent.change(screen.getByLabelText(/Upload CycloneDX/), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload SBOM" }));

    await waitFor(() =>
      expect(mocks.browserApi).toHaveBeenLastCalledWith(
        `/releases/${release.id}/sbom`,
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(await screen.findByText(/1 components.*2 findings/i)).toBeInTheDocument();
  });

  it("loads the next cursor page and sends server-side filters", async () => {
    mocks.browserApi.mockResolvedValue({
      data: {
        items: [
          { ...finding, id: "00000000-0000-7000-8000-000000000005", advisoryId: "CVE-2026-0002" },
        ],
        nextCursor: null,
        hasMore: false,
      },
    });
    render(
      createElement(FindingsQueue, {
        initial: { items: [finding], nextCursor: "cursor-1", hasMore: true },
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() =>
      expect(mocks.browserApi).toHaveBeenCalledWith("/findings?limit=50&cursor=cursor-1"),
    );

    fireEvent.change(screen.getByLabelText("State"), { target: { value: "open" } });
    fireEvent.click(screen.getByLabelText("KEV only"));
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    await waitFor(() =>
      expect(mocks.browserApi).toHaveBeenLastCalledWith(
        "/findings?limit=50&state=open&kevOnly=true",
      ),
    );
  });

  it("gates and submits valid triage and VEX actions", async () => {
    mocks.browserApi.mockResolvedValue({ data: finding });
    render(createElement(FindingDetail, { finding, principal }));

    fireEvent.click(screen.getByRole("button", { name: "in triage" }));
    await waitFor(() =>
      expect(mocks.browserApi).toHaveBeenCalledWith(
        `/findings/${finding.id}/transitions`,
        expect.objectContaining({ method: "POST" }),
      ),
    );

    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "not_affected" } });
    fireEvent.click(screen.getByRole("button", { name: "Save assessment" }));
    await waitFor(() =>
      expect(mocks.browserApi).toHaveBeenLastCalledWith(
        `/findings/${finding.id}/vex`,
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });
});
