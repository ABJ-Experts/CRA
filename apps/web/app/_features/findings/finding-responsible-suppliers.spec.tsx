/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../_providers/session-provider", () => ({
  useHasPermission: () => true,
}));
vi.mock("../suppliers/suppliers.queries", () => ({
  useFindingResponsibleSuppliersQuery: () => ({
    isLoading: false,
    isError: false,
    data: { resolution: { responsibility: "unknown", suppliers: [] } },
  }),
}));

import { FindingResponsibleSuppliers } from "./finding-responsible-suppliers";

describe("FindingResponsibleSuppliers", () => {
  it("makes an absent exact-occurrence link explicitly unknown", () => {
    render(
      <FindingResponsibleSuppliers findingId="11111111-1111-4111-8111-111111111111" />,
    );
    expect(
      screen.getByText(/Unknown — no active supplier responsibility/i),
    ).toBeInTheDocument();
  });
});
