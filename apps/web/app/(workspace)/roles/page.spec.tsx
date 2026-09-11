// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { rolesApi } from "../../_features/roles/roles.api";
import RolesPage from "./page";

vi.mock("../../_features/roles/roles.api", async () => {
  const actual = await vi.importActual<
    typeof import("../../_features/roles/roles.api")
  >("../../_features/roles/roles.api");
  return { ...actual, rolesApi: { ...actual.rolesApi, list: vi.fn() } };
});
vi.mock("../../_providers/session-provider", () => ({
  useHasPermission: () => false,
}));

describe("RolesPage", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("loads custom roles through rolesApi without changing the cards", async () => {
    vi.mocked(rolesApi.list).mockResolvedValue({
      rows: [
        {
          id: "a05570d6-aa75-4b6a-9688-b5a82eb3a774",
          name: "Auditor",
          description: null,
          color: "#4A50D6",
          baseRole: "viewer",
          permissions: { can_view_audit: true },
          isSystem: true,
          isActive: false,
          memberCount: 1,
        },
      ],
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <RolesPage />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Auditor")).toBeTruthy();
    expect(screen.getByText("1 member")).toBeTruthy();
    expect(screen.getByText("No description.")).toBeTruthy();
    expect(screen.getByText("System")).toBeTruthy();
    expect(screen.getByText("Inactive")).toBeTruthy();
    expect(rolesApi.list).toHaveBeenCalled();
  });

  it("preserves the empty state", async () => {
    vi.mocked(rolesApi.list).mockResolvedValue({ rows: [] });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <RolesPage />
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/No custom roles yet/)).toBeTruthy();
  });

  it("preserves the retryable error state", async () => {
    vi.mocked(rolesApi.list).mockRejectedValue(new Error("offline"));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <RolesPage />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
