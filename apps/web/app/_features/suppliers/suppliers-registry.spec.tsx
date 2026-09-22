/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../_providers/providers", () => ({ useMocksReady: () => true }));
vi.mock("../../_providers/session-provider", () => ({
  useSession: () => ({
    session: {
      organizations: [{ id: "11111111-1111-4111-8111-111111111111" }],
    },
    permissions: { can_view_suppliers: true, can_manage_suppliers: false },
    isLoading: false,
  }),
}));
vi.mock("./suppliers.queries", () => ({
  useSuppliersQuery: () => ({
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    data: {
      suppliers: {
        nextCursor: null,
        items: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            organizationId: "11111111-1111-4111-8111-111111111111",
            name: "Example Components",
            legalName: null,
            website: null,
            criticality: "high",
            state: "active",
            version: 0,
            componentCount: 2,
            requestCount: 1,
            createdAt: "2026-09-21T12:00:00.000Z",
            updatedAt: "2026-09-21T12:00:00.000Z",
            archivedAt: null,
          },
        ],
      },
    },
  }),
  useCreateSupplierMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

import { SuppliersRegistryContent } from "./suppliers-registry";

describe("SuppliersRegistryContent", () => {
  const previousMocks = process.env.NEXT_PUBLIC_ENABLE_MOCKS;
  afterEach(() => {
    process.env.NEXT_PUBLIC_ENABLE_MOCKS = previousMocks;
  });

  it("uses the workspace registry hierarchy without offering management controls to a read-only user", () => {
    process.env.NEXT_PUBLIC_ENABLE_MOCKS = "false";
    render(<SuppliersRegistryContent />);
    expect(
      screen.getByRole("heading", { name: "Suppliers", level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Supplier registry", level: 2 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Example Components" }),
    ).toHaveAttribute(
      "href",
      "/suppliers/11111111-1111-4111-8111-111111111111",
    );
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText(/cannot create or change/i)).toBeInTheDocument();
  });
});
