// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import type { Release } from "@repo/contracts/products";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "../../_lib/http/api-client";
import { ProductDetailContent } from "./product-detail-content";

const PRODUCT = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  name: "Sentinel",
  internalCode: "CRA-001",
  productType: "standalone_software",
  description: null,
  responsibleOwnerId: "33333333-3333-4333-8333-333333333333",
  legalEntity: {
    id: "44444444-4444-4444-8444-444444444444",
    identifier: "cra-gb",
    legalName: "CRA Ltd",
    mainEstablishmentCountry: "GB",
    version: 1,
  },
  archivedAt: null,
  version: 1,
  releaseCount: 0,
  createdAt: "2026-08-12T10:00:00.000Z",
  updatedAt: "2026-08-12T10:00:00.000Z",
  createdBy: "33333333-3333-4333-8333-333333333333",
  updatedBy: "33333333-3333-4333-8333-333333333333",
} as const;
const RELEASE = {
  id: "55555555-5555-4555-8555-555555555555",
  organizationId: PRODUCT.organizationId,
  productId: PRODUCT.id,
  label: "Sentinel 1.0",
  version: "1.0.0",
  description: null,
  lifecycle: "development",
  placedOnMarketAt: null,
  marketAvailabilityWarning: "no_active_member_state_availability",
  legalEntity: PRODUCT.legalEntity,
  archivedAt: null,
  versionNumber: 1,
  createdAt: PRODUCT.createdAt,
  updatedAt: PRODUCT.updatedAt,
  createdBy: PRODUCT.createdBy,
  updatedBy: PRODUCT.updatedBy,
} as const;

const transitionMutation = {
  isPending: false,
  mutateAsync: vi.fn(async () => ({ release: RELEASE })),
};

const state = {
  session: {
    session: { organizations: [{ id: PRODUCT.organizationId }] },
    permissions: {
      can_view_products: true,
      can_create_products: true,
      can_edit_products: true,
      can_delete_products: true,
    },
    isLoading: false,
    role: "owner",
  },
  product: {
    isPending: false,
    isError: false,
    error: null as unknown,
    data: { product: PRODUCT },
    refetch: vi.fn(),
  },
  releases: {
    isPending: false,
    isError: false,
    error: null as unknown,
    data: {
      releases: {
        rows: [] as readonly Release[],
        total: 0,
        page: 1,
        pageSize: 50,
        pageCount: 1,
      },
    },
    refetch: vi.fn(),
  },
  memberStates: {
    isPending: false,
    isError: false,
    error: null as unknown,
    data: {
      memberStates: [
        { countryCode: "DE", name: "Germany", version: 1, active: true },
      ],
    },
    refetch: vi.fn(),
  },
  availability: {
    isPending: false,
    isError: false,
    error: null as unknown,
    data: { marketAvailability: [] },
    refetch: vi.fn(),
  },
  timeline: {
    isPending: false,
    isError: false,
    error: null as unknown,
    data: { timeline: [] },
    refetch: vi.fn(),
  },
};

vi.mock("../../_features/products/products.queries", () => ({
  useProductQuery: () => state.product,
  useProductReleasesQuery: () => state.releases,
  useUpdateProductMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useArchiveProductMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useCreateReleaseMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useUpdateReleaseMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useArchiveReleaseMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useMemberStatesQuery: () => state.memberStates,
  useReleaseMarketAvailabilityQuery: () => state.availability,
  useReleaseLifecycleTimelineQuery: () => state.timeline,
  useAddReleaseMarketAvailabilityMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useRemoveReleaseMarketAvailabilityMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useCorrectReleaseMarketAvailabilityMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useTransitionReleaseLifecycleMutation: () => transitionMutation,
  useCorrectPlacedOnMarketDateMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
}));
vi.mock("../../_providers/providers", () => ({ useMocksReady: () => true }));
vi.mock("../../_providers/session-provider", () => ({
  useSession: () => state.session,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("ProductDetailContent", () => {
  const previous = process.env.NEXT_PUBLIC_ENABLE_MOCKS;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_ENABLE_MOCKS = "false";
    state.session = {
      session: { organizations: [{ id: PRODUCT.organizationId }] },
      permissions: {
        can_view_products: true,
        can_create_products: true,
        can_edit_products: true,
        can_delete_products: true,
      },
      isLoading: false,
      role: "owner",
    };
    state.product.isPending = false;
    state.product.isError = false;
    state.product.data = { product: PRODUCT };
    state.releases.isPending = false;
    state.releases.isError = false;
    state.releases.data = {
      releases: { rows: [], total: 0, page: 1, pageSize: 50, pageCount: 1 },
    };
    state.memberStates.isPending = false;
    state.memberStates.isError = false;
    state.memberStates.data = {
      memberStates: [
        { countryCode: "DE", name: "Germany", version: 1, active: true },
      ],
    };
    state.availability.isPending = false;
    state.availability.isError = false;
    state.availability.data = { marketAvailability: [] };
    state.timeline.isPending = false;
    state.timeline.isError = false;
    state.timeline.data = { timeline: [] };
    transitionMutation.mutateAsync.mockClear();
  });

  afterEach(() => {
    cleanup();
    process.env.NEXT_PUBLIC_ENABLE_MOCKS = previous;
  });

  it("shows the legal-entity provenance, editable details, and the empty release state", () => {
    render(<ProductDetailContent productId={PRODUCT.id} />);

    expect(screen.getByText("CRA Ltd")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save changes" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No releases have been added yet."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add release" }),
    ).toBeInTheDocument();
  });

  it("shows a retryable unavailable state for tenant-safe product misses", () => {
    state.product.isError = true;
    state.product.data = undefined as never;
    state.product.error = new ApiClientError("api", "Not found", 404);
    render(<ProductDetailContent productId={PRODUCT.id} />);

    expect(screen.getByRole("alert")).toHaveTextContent("unavailable");
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });

  it("shows a terminal forbidden state instead of a disabled blank detail view", () => {
    state.session.permissions = {
      can_view_products: false,
      can_create_products: false,
      can_edit_products: false,
      can_delete_products: false,
    };
    render(<ProductDetailContent productId={PRODUCT.id} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "do not have permission to view products",
    );
    expect(screen.queryByText("CRA Ltd")).not.toBeInTheDocument();
  });

  it("shows the release-level availability warning and guarded lifecycle action", () => {
    state.releases.data = {
      releases: {
        rows: [RELEASE],
        total: 1,
        page: 1,
        pageSize: 50,
        pageCount: 1,
      },
    };
    render(<ProductDetailContent productId={PRODUCT.id} />);

    expect(
      screen.getByText("No Member State availability has been recorded."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Transition lifecycle" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Lifecycle")).not.toBeInTheDocument();
  });

  it("reports a placement guard without presenting it as a stale update", async () => {
    state.releases.data = {
      releases: {
        rows: [RELEASE],
        total: 1,
        page: 1,
        pageSize: 50,
        pageCount: 1,
      },
    };
    transitionMutation.mutateAsync.mockRejectedValueOnce(
      new ApiClientError(
        "api",
        "Product registry request could not be completed.",
        409,
        "placement_requires_active_market_availability",
      ),
    );
    render(<ProductDetailContent productId={PRODUCT.id} />);

    fireEvent.change(screen.getByLabelText("Placed on market at (UTC)"), {
      target: { value: "2026-08-12T10:00:00.000Z" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Transition lifecycle" }),
    );

    await waitFor(() =>
      expect(
        screen.getByText(/Add at least one active Member State/),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "Reload current data" }),
    ).not.toBeInTheDocument();
  });

  it("submits the next permitted transition after a release changes state", async () => {
    state.releases.data = {
      releases: {
        rows: [RELEASE],
        total: 1,
        page: 1,
        pageSize: 50,
        pageCount: 1,
      },
    };
    const view = render(<ProductDetailContent productId={PRODUCT.id} />);
    expect(
      screen.getByRole("combobox", {
        name: `Lifecycle target for ${RELEASE.label}`,
      }),
    ).toHaveValue("placed_on_market");

    state.releases.data = {
      releases: {
        rows: [
          {
            ...RELEASE,
            lifecycle: "placed_on_market",
            placedOnMarketAt: "2026-08-12T10:00:00.000Z",
          },
        ],
        total: 1,
        page: 1,
        pageSize: 50,
        pageCount: 1,
      },
    };
    view.rerender(<ProductDetailContent productId={PRODUCT.id} />);

    expect(
      screen.getByRole("combobox", {
        name: `Lifecycle target for ${RELEASE.label}`,
      }),
    ).toHaveValue("in_support");
    fireEvent.click(
      screen.getByRole("button", { name: "Transition lifecycle" }),
    );

    await waitFor(() =>
      expect(transitionMutation.mutateAsync).toHaveBeenCalledWith({
        targetState: "in_support",
        expectedVersion: 1,
      }),
    );
  });
});
