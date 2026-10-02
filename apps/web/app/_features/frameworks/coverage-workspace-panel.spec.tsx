/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requests = vi.hoisted(() => ({
  coverage: vi.fn(),
  applicability: vi.fn(),
  products: vi.fn(),
}));

vi.mock("./controls.api", () => ({
  controlsApi: {
    coverage: requests.coverage,
    updateApplicability: requests.applicability,
  },
}));
vi.mock("../products/products.api", () => ({
  productsApi: { list: requests.products },
}));

import { CoverageWorkspacePanel } from "./coverage-workspace-panel";

const productId = "11111111-1111-4111-8111-111111111111";
const orgId = "22222222-2222-4222-8222-222222222222";
const controlId = "33333333-3333-4333-8333-333333333333";

function coverage(overrides: Record<string, unknown> = {}) {
  return {
    packKey: "cra-annex-i",
    versionKey: "oj-2024-11-20-en",
    productId,
    calculation: { status: "current", calculatedAt: "2026-09-24T10:00:00Z" },
    summary: {
      totalRequirements: 3,
      applicableRequirements: 2,
      excludedRequirements: 0,
      evidenceBackedRequirements: 1,
      gapRequirements: 1,
    },
    requirements: [
      {
        requirementKey: "part-i-1",
        identifier: "I.1",
        heading: "Security properties",
        text: "<script>alert(1)</script> exact source text",
        parentKey: null,
        assessable: true,
        applicability: { state: "applicable", reason: null, revision: 0 },
        coverageState: "no_mapping",
        remediation: { kind: "map_control" },
        controls: [],
      },
      {
        requirementKey: "part-i-2",
        identifier: "I.2",
        heading: "Secure default",
        text: "Make secure settings the default.",
        parentKey: "part-i-1",
        assessable: true,
        applicability: { state: "applicable", reason: null, revision: 0 },
        coverageState: "evidence_backed",
        remediation: { kind: null },
        controls: [
          {
            id: controlId,
            title: "Secure defaults",
            status: "implemented",
            ownerActive: true,
            evidencePresent: true,
            evidenceAvailability: "available",
          },
        ],
      },
      {
        requirementKey: "part-i",
        identifier: "Part I",
        heading: "Product requirements",
        text: "Product requirements",
        parentKey: null,
        assessable: false,
        applicability: { state: "applicable", reason: null, revision: 0 },
        coverageState: "structural",
        remediation: { kind: null },
        controls: [],
      },
    ],
    nextCursor: null,
    ...overrides,
  };
}

function mount(
  props: Partial<React.ComponentProps<typeof CoverageWorkspacePanel>> = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CoverageWorkspacePanel
        organizationId={orgId}
        packKey="cra-annex-i"
        versionKey="oj-2024-11-20-en"
        canManage
        canViewProducts
        canViewEvidence
        {...props}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  requests.products.mockResolvedValue({
    products: {
      rows: [{ id: productId, name: "Widget" }],
      page: 1,
      pageCount: 1,
    },
  });
  requests.coverage.mockResolvedValue(coverage());
  requests.applicability.mockResolvedValue({
    revision: 1,
    state: "not_applicable",
    reason: "Not used by Widget",
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CoverageWorkspacePanel", () => {
  it("shows explicit denominator, gap detail, and inert legal text", async () => {
    mount();
    expect(
      await screen.findByText(
        /1 of 2 applicable requirements evidence-backed/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 gap/i)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("treeitem", { name: /I\.1 Security properties/ }),
    );
    expect(
      screen.getByText("<script>alert(1)</script> exact source text"),
    ).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
    expect(
      screen.getByRole("link", { name: /map a control/i }),
    ).toHaveAttribute("href", "/frameworks?requirementKey=part-i-1");
  });

  it("does not show a green result when calculation is stale", async () => {
    requests.coverage.mockResolvedValue(
      coverage({
        calculation: { status: "stale", calculatedAt: "2026-09-23T10:00:00Z" },
      }),
    );
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(/stale/i);
    expect(
      screen.queryByText(/1 of 2 applicable requirements evidence-backed/i),
    ).not.toBeInTheDocument();
  });

  it("changes the server-side gap filter and can read a second product page", async () => {
    requests.products
      .mockResolvedValueOnce({
        products: {
          rows: [{ id: productId, name: "Widget" }],
          page: 1,
          pageCount: 2,
        },
      })
      .mockResolvedValueOnce({
        products: {
          rows: [
            { id: "44444444-4444-4444-8444-444444444444", name: "Gadget" },
          ],
          page: 2,
          pageCount: 2,
        },
      });
    mount();
    await screen.findByText(/1 of 2 applicable/i);
    fireEvent.change(
      screen.getByRole("combobox", { name: /show requirements/i }),
      { target: { value: "gaps" } },
    );
    await waitFor(() =>
      expect(requests.coverage).toHaveBeenCalledWith(
        "cra-annex-i",
        "oj-2024-11-20-en",
        productId,
        undefined,
        expect.anything(),
        "gaps",
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /load more products/i }),
    );
    expect(
      await screen.findByRole("option", { name: "Gadget" }),
    ).toBeInTheDocument();
  });

  it("preserves a non-applicability reason after a conflicting write", async () => {
    requests.applicability.mockRejectedValueOnce(new Error("conflict"));
    mount();
    await screen.findByText(/1 of 2 applicable/i);
    fireEvent.click(
      screen.getByRole("treeitem", { name: /I\.1 Security properties/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /mark I\.1 not applicable/i }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: /reason/i }), {
      target: { value: "Not used by Widget" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /save non-applicability/i }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/preserved/i);
    expect(screen.getByRole("textbox", { name: /reason/i })).toHaveValue(
      "Not used by Widget",
    );
  });

  it("hides the previous summary while an approval is refreshing", async () => {
    requests.coverage
      .mockResolvedValueOnce(coverage())
      .mockImplementation(() => new Promise(() => {}));
    mount();
    await screen.findByText(/1 of 2 applicable/i);
    fireEvent.click(
      screen.getByRole("treeitem", { name: /I\.1 Security properties/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /mark I\.1 not applicable/i }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: /reason/i }), {
      target: { value: "Synthetic product review" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /save non-applicability/i }),
    );
    await screen.findByText(/Applicability saved/i);
    expect(
      screen.queryByText(/1 of 2 applicable requirements evidence-backed/i),
    ).not.toBeInTheDocument();
  });

  it("restores applicability without a reason and preserves the draft on failure", async () => {
    requests.coverage.mockResolvedValue(
      coverage({
        requirements: [
          {
            ...coverage().requirements[0],
            applicability: {
              state: "not_applicable",
              reason: "Synthetic product",
              revision: 2,
            },
            coverageState: "excluded",
            remediation: { kind: null },
          },
        ],
      }),
    );
    requests.applicability.mockRejectedValueOnce(new Error("offline"));
    mount();
    await screen.findByText(/1 of 2 applicable/i);
    fireEvent.click(
      screen.getByRole("treeitem", { name: /I\.1 Security properties/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /restore I\.1 as applicable/i }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Restore applicability" }),
    );
    await waitFor(() =>
      expect(requests.applicability).toHaveBeenCalledWith(
        "cra-annex-i",
        "oj-2024-11-20-en",
        "part-i-1",
        expect.not.objectContaining({ reason: expect.anything() }),
      ),
    );
    expect(
      Object.hasOwn(requests.applicability.mock.calls[0]?.[3] ?? {}, "reason"),
    ).toBe(false);
    expect(await screen.findByRole("alert")).toHaveTextContent(/preserved/i);
    expect(
      screen.getByRole("button", { name: "Restore applicability" }),
    ).toBeInTheDocument();
  });

  it("does not query or expose totals without product and evidence permissions", () => {
    mount({ canViewEvidence: false });
    expect(
      screen.getByText(/product and evidence permissions/i),
    ).toBeInTheDocument();
    expect(requests.coverage).not.toHaveBeenCalled();
    expect(
      screen.queryByText(/applicable requirements/i),
    ).not.toBeInTheDocument();
  });

  it("retries an unavailable product list without exposing coverage", async () => {
    requests.products
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        products: {
          rows: [{ id: productId, name: "Widget" }],
          page: 1,
          pageCount: 1,
        },
      });
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(/retry/i);
    expect(requests.coverage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /retry products/i }));
    expect(await screen.findByText(/1 of 2 applicable/i)).toBeInTheDocument();
  });

  it("retries failed coverage and lets keyboard users inspect a gap", async () => {
    requests.coverage
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(coverage());
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(/retry/i);
    fireEvent.click(screen.getByRole("button", { name: /retry coverage/i }));
    await screen.findByText(/1 of 2 applicable/i);
    const first = screen.getByRole("treeitem", {
      name: /I\.1 Security properties/,
    });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(screen.getByText(/exact source text/i)).toBeInTheDocument();
    fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(screen.queryByText(/exact source text/i)).not.toBeInTheDocument();
  });
});
