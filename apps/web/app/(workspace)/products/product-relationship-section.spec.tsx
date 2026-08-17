// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "../../_lib/http/api-client";
import { ProductRelationshipSection } from "./product-relationship-section";

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const RELEASE_ID = "22222222-2222-4222-8222-222222222222";
const COMPONENT_PRODUCT_ID = "33333333-3333-4333-8333-333333333333";

const state = {
  memberships: {
    isPending: false,
    isError: false,
    error: null as unknown,
    data: { memberships: [] as readonly Record<string, unknown>[] },
    refetch: vi.fn(),
  },
  variants: {
    isPending: false,
    isError: false,
    error: null as unknown,
    data: { relationships: [] as readonly Record<string, unknown>[] },
    refetch: vi.fn(),
  },
  components: {
    isPending: false,
    isError: false,
    error: null as unknown,
    data: { links: [] as readonly Record<string, unknown>[] },
    refetch: vi.fn(),
  },
  graph: {
    isPending: false,
    isError: false,
    error: null as unknown,
    data: {
      graph: {
        graphVersion: 3,
        evaluatedAt: "2026-08-13T00:00:00.000Z",
        nodes: [{ productId: PRODUCT_ID, releaseId: RELEASE_ID }],
        links: [],
      },
    },
    refetch: vi.fn(),
  },
  events: {
    isPending: false,
    isError: false,
    error: null as unknown,
    data: {
      events: [
        {
          id: "event-1",
          deliveryState: "scheduled",
          graphVersion: 3,
          occurredAt: "2026-08-13T00:00:00.000Z",
        },
        {
          id: "event-2",
          deliveryState: "dead_letter",
          graphVersion: 3,
          occurredAt: "2026-08-12T00:00:00.000Z",
        },
      ],
    },
    refetch: vi.fn(),
  },
};

const preview = { isPending: false, data: undefined, mutateAsync: vi.fn() };
const createComponent = { isPending: false, mutateAsync: vi.fn() };
const endComponent = { isPending: false, mutateAsync: vi.fn() };
const baselineRevisionsQuery = vi.fn((baselineId: string, enabled: boolean) => {
  void baselineId;
  void enabled;
  return {
    isPending: false,
    isError: false,
    error: null,
    data: { baselines: [] },
    refetch: vi.fn(),
  };
});
const createBaseline = { isPending: false, mutateAsync: vi.fn() };

vi.mock("../../_features/products/products.queries", () => ({
  useProductsQuery: () => ({
    isPending: false,
    isError: false,
    error: null,
    data: {
      products: {
        rows: [
          {
            id: COMPONENT_PRODUCT_ID,
            name: "Embedded runtime",
            internalCode: "RUNTIME-1",
          },
        ],
        total: 1,
        page: 1,
        pageSize: 25,
        pageCount: 1,
      },
    },
    refetch: vi.fn(),
  }),
  useProductReleasesQuery: () => ({
    isPending: false,
    isError: false,
    error: null,
    data: {
      releases: { rows: [], total: 0, page: 1, pageSize: 100, pageCount: 1 },
    },
    refetch: vi.fn(),
  }),
  useSoftwareBaselinesQuery: () => ({
    isPending: false,
    isError: false,
    error: null,
    data: {
      baselines: { items: [], nextCursor: null },
    },
    refetch: vi.fn(),
  }),
  useSoftwareBaselineMembershipsQuery: () => state.memberships,
  useProductVariantRelationshipsQuery: () => state.variants,
  useProductComponentLinksQuery: () => state.components,
  useProductRelationshipGraphQuery: () => state.graph,
  useRelationshipPropagationEventsQuery: () => state.events,
  usePreviewProductComponentLinkMutation: () => preview,
  useCreateProductComponentLinkMutation: () => createComponent,
  useEndProductComponentLinkMutation: () => endComponent,
  useSupersedeProductComponentLinkMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useAssignSoftwareBaselineMembershipMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useEndSoftwareBaselineMembershipMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useCreateProductVariantRelationshipMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useEndProductVariantRelationshipMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useSoftwareBaselineRevisionsQuery: (baselineId: string, enabled: boolean) =>
    baselineRevisionsQuery(baselineId, enabled),
  useCreateSoftwareBaselineMutation: () => createBaseline,
  useAppendSoftwareBaselineRevisionMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useArchiveSoftwareBaselineMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useRequestRelationshipReevaluationMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
}));

vi.mock("../../_features/organizations/organizations.queries", () => ({
  useOrganizationSettingsQuery: () => ({ data: undefined }),
}));

describe("ProductRelationshipSection", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("makes empty relationship histories, graph version, queued work, and failed work visible", () => {
    render(
      <ProductRelationshipSection
        productId={PRODUCT_ID}
        releases={[{ id: RELEASE_ID, label: "Sentinel 1.0", version: "1.0.0" }]}
        canEdit
        enabled
        onReload={vi.fn()}
      />,
    );

    expect(screen.getByText("Product relationships")).toBeInTheDocument();
    expect(screen.getByLabelText("Relationship overview")).toBeInTheDocument();
    expect(
      screen.getByText("No baseline memberships have been recorded."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No variant relationships have been recorded."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No embedded component links have been recorded."),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Graph version 3/).length).toBeGreaterThan(0);
    expect(screen.getByText(/scheduled/)).toBeInTheDocument();
    expect(screen.getByText(/dead letter/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "End baseline membership" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Update component link" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Queue relationship re-evaluation" }),
    ).toBeDisabled();
  });

  it("uses labeled tenant-scoped search and release selectors instead of raw relationship UUID fields", () => {
    render(
      <ProductRelationshipSection
        productId={PRODUCT_ID}
        releases={[{ id: RELEASE_ID, label: "Sentinel 1.0", version: "1.0.0" }]}
        canEdit
        enabled
        onReload={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("textbox", { name: "Search software baselines" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Software baseline" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("textbox", { name: "Search variant product" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Variant release" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("textbox", { name: "Search component product" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Component release" }),
    ).toBeDisabled();
    expect(screen.queryByLabelText("Baseline ID")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Baseline revision ID"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Variant product ID"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Component product ID"),
    ).not.toBeInTheDocument();
  });

  it("selects the first release once an initially empty product detail query resolves", async () => {
    const view = render(
      <ProductRelationshipSection
        productId={PRODUCT_ID}
        releases={[]}
        canEdit
        enabled
        onReload={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("combobox", { name: "Relationship release" }),
    ).toHaveValue("");

    view.rerender(
      <ProductRelationshipSection
        productId={PRODUCT_ID}
        releases={[{ id: RELEASE_ID, label: "Sentinel 1.0", version: "1.0.0" }]}
        canEdit
        enabled
        onReload={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Relationship release" }),
      ).toHaveValue(RELEASE_ID),
    );
  });

  it("presents a deterministic cycle rejection with a stale graph reload", async () => {
    createComponent.mutateAsync.mockRejectedValueOnce(
      new ApiClientError("api", "Cycle detected", 409, "cycle_detected"),
    );
    const onReload = vi.fn();
    render(
      <ProductRelationshipSection
        productId={PRODUCT_ID}
        releases={[{ id: RELEASE_ID, label: "Sentinel 1.0", version: "1.0.0" }]}
        canEdit
        enabled
        onReload={onReload}
      />,
    );

    fireEvent.change(screen.getByLabelText("Search component product"), {
      target: { value: "runtime" },
    });
    fireEvent.change(screen.getByLabelText("Component product"), {
      target: { value: COMPONENT_PRODUCT_ID },
    });
    fireEvent.change(screen.getByLabelText("Relationship source"), {
      target: { value: "Product architecture" },
    });
    fireEvent.change(screen.getByLabelText("Relationship provenance"), {
      target: { value: "Approved architecture decision" },
    });
    fireEvent.change(screen.getByLabelText("Relationship effective start"), {
      target: { value: "2026-08-13T00:00" },
    });
    fireEvent.change(screen.getByLabelText("Relationship reason"), {
      target: { value: "Embedded runtime component" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record component link" }),
    );

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "would create a cycle",
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Reload relationship graph" }),
    );
    expect(onReload).toHaveBeenCalledOnce();
  });

  it("keeps relationship mutations unavailable in the forbidden view", () => {
    render(
      <ProductRelationshipSection
        productId={PRODUCT_ID}
        releases={[]}
        canEdit={false}
        enabled
        onReload={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        "You can review relationship history, but cannot change it.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Record component link" }),
    ).not.toBeInTheDocument();
  });

  it("makes unavailable relationship history retriable", () => {
    const previous = { ...state.components };
    const refetch = vi.fn();
    state.components.isError = true;
    state.components.error = new ApiClientError(
      "network",
      "Registry unavailable",
    );
    state.components.refetch = refetch;

    try {
      render(
        <ProductRelationshipSection
          productId={PRODUCT_ID}
          releases={[]}
          canEdit
          enabled
          onReload={vi.fn()}
        />,
      );

      expect(screen.getByRole("alert")).toHaveTextContent(
        "temporarily unavailable",
      );
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(refetch).toHaveBeenCalledOnce();
    } finally {
      Object.assign(state.components, previous);
    }
  });

  it("does not enable revision history until a baseline exists", () => {
    render(
      <ProductRelationshipSection
        productId={PRODUCT_ID}
        releases={[]}
        canEdit
        enabled
        onReload={vi.fn()}
      />,
    );

    expect(baselineRevisionsQuery).toHaveBeenCalledWith("", false);
  });

  it("uses a created baseline identity and revision without exposing UUID fields", async () => {
    createBaseline.mutateAsync.mockResolvedValueOnce({
      baseline: {
        baselineId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        version: 2,
      },
    });
    render(
      <ProductRelationshipSection
        productId={PRODUCT_ID}
        releases={[{ id: RELEASE_ID, label: "Sentinel 1.0", version: "1.0.0" }]}
        canEdit
        enabled
        onReload={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Baseline identifier"), {
      target: { value: "sentinel-runtime" },
    });
    fireEvent.change(screen.getByLabelText("Baseline name"), {
      target: { value: "Sentinel runtime" },
    });
    fireEvent.change(screen.getByLabelText("Baseline revision summary"), {
      target: { value: "Initial revision" },
    });
    fireEvent.change(screen.getByLabelText("Relationship source"), {
      target: { value: "Architecture board" },
    });
    fireEvent.change(screen.getByLabelText("Relationship provenance"), {
      target: { value: "ADR-14" },
    });
    fireEvent.change(screen.getByLabelText("Relationship effective start"), {
      target: { value: "2026-08-13T00:00" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record software baseline" }),
    );

    await waitFor(() =>
      expect(baselineRevisionsQuery).toHaveBeenCalledWith(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        true,
      ),
    );
    expect(screen.queryByLabelText("Baseline ID")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Baseline revision ID"),
    ).not.toBeInTheDocument();
  });
});
