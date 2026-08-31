// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { rolesApi } from "../../_features/roles/roles.api";
import PermissionsMatrixPage from "./page";

vi.mock("../../_features/roles/roles.api", async () => {
  const actual = await vi.importActual<
    typeof import("../../_features/roles/roles.api")
  >("../../_features/roles/roles.api");
  return {
    ...actual,
    rolesApi: { getOverrides: vi.fn(), setOverride: vi.fn() },
  };
});
vi.mock("../../_providers/session-provider", () => ({
  useHasPermission: () => true,
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <PermissionsMatrixPage />
      </QueryClientProvider>,
    ),
  };
}

describe("PermissionsMatrixPage", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("loads and saves overrides through rolesApi", async () => {
    vi.mocked(rolesApi.getOverrides).mockResolvedValue({
      overrides: { owner: { can_view_users: true } },
    });
    vi.mocked(rolesApi.setOverride).mockResolvedValue({ ok: true });
    const { queryClient } = renderPage();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const checkbox = await screen.findByRole("checkbox", {
      name: "view users for owner",
    });
    fireEvent.click(checkbox);

    await waitFor(() =>
      expect(rolesApi.setOverride).toHaveBeenCalledWith("owner", {
        can_view_users: false,
      }),
    );
    expect(rolesApi.getOverrides).toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalled();
  });
});
