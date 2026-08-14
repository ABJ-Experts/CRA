// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProductsRegistryContent } from "./products-registry-content";

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

const state = {
  session: {
    session: {
      user: { id: "33333333-3333-4333-8333-333333333333" },
      organizations: [{ id: "22222222-2222-4222-8222-222222222222" }],
    },
    permissions: { can_view_products: true, can_create_products: true },
    isLoading: false,
  },
  products: {
    isPending: false,
    isError: false,
    error: null as unknown,
    data: {
      products: {
        rows: [PRODUCT],
        total: 1,
        page: 1,
        pageSize: 25,
        pageCount: 1,
      },
    },
    refetch: vi.fn(),
  },
};

vi.mock("../../_features/products/products.queries", () => ({
  useProductsQuery: () => state.products,
  useCreateProductMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock("../../_features/organizations/organizations.queries", () => ({
  useLegalEntitiesQuery: () => ({ data: { legalEntities: [] } }),
}));
vi.mock("../../_providers/providers", () => ({ useMocksReady: () => true }));
vi.mock("../../_providers/session-provider", () => ({
  useSession: () => state.session,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("ProductsRegistryContent", () => {
  const environment = process.env.NEXT_PUBLIC_ENABLE_MOCKS;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_ENABLE_MOCKS = "false";
    state.session.permissions = {
      can_view_products: true,
      can_create_products: true,
    };
    state.products = {
      isPending: false,
      isError: false,
      error: null,
      data: {
        products: {
          rows: [PRODUCT],
          total: 1,
          page: 1,
          pageSize: 25,
          pageCount: 1,
        },
      },
      refetch: vi.fn(),
    };
  });
  afterEach(() => {
    cleanup();
    process.env.NEXT_PUBLIC_ENABLE_MOCKS = environment;
  });

  it("renders authoritative product data and never the generic ecommerce shape", () => {
    render(<ProductsRegistryContent />);

    expect(
      screen.getByRole("heading", { name: "Products" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Sentinel")).toBeInTheDocument();
    expect(screen.getByText(/CRA-001/)).toBeInTheDocument();
    expect(screen.queryByText("SKU")).not.toBeInTheDocument();
  });

  it("orients the user before they scan or filter the registry", () => {
    render(<ProductsRegistryContent />);

    expect(screen.getByText("1 product in this registry")).toBeInTheDocument();
    expect(
      screen.getByRole("searchbox", { name: "Search products" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Include archived products" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Standalone software")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open product Sentinel" }),
    ).toBeInTheDocument();
  });

  it("does not present an empty registry total while products are loading", () => {
    state.products = {
      isPending: true,
      isError: false,
      error: null,
      data: {
        products: {
          rows: [PRODUCT],
          total: 1,
          page: 1,
          pageSize: 25,
          pageCount: 1,
        },
      },
      refetch: vi.fn(),
    };
    render(<ProductsRegistryContent />);

    expect(screen.getByText("Loading registry…")).toBeInTheDocument();
    expect(
      screen.queryByText("0 products in this registry"),
    ).not.toBeInTheDocument();
  });

  it("shows a safe forbidden state rather than product data", () => {
    state.session.permissions = {
      can_view_products: false,
      can_create_products: false,
    };
    render(<ProductsRegistryContent />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "do not have permission",
    );
    expect(screen.queryByText("Sentinel")).not.toBeInTheDocument();
  });

  it("distinguishes filtered empty state from the initial empty registry", () => {
    state.products = {
      isPending: false,
      isError: false,
      error: null,
      data: {
        products: { rows: [], total: 0, page: 1, pageSize: 25, pageCount: 1 },
      },
      refetch: vi.fn(),
    };
    render(<ProductsRegistryContent />);

    expect(
      screen.getByText("No products have been created yet."),
    ).toBeInTheDocument();
  });
});
