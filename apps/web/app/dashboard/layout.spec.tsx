// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ replace: navigation.replace }),
}));
vi.mock("../_providers/providers", () => ({ useMocksReady: () => true }));
vi.mock("../(workspace)/workspace-shell", async () => {
  const { DashboardOnboardingGate } =
    await import("./_components/dashboard-onboarding-gate");
  return {
    WorkspaceShell: ({ children }: { children: ReactNode }) => (
      <DashboardOnboardingGate>{children}</DashboardOnboardingGate>
    ),
  };
});

import DashboardLayout from "./layout";

const identity = {
  user: {
    id: "11111111-1111-4111-8111-111111111111",
    email: "fresh@example.com",
    username: "fresh",
    firstName: "Fresh",
    lastName: "User",
    jobTitle: null,
    avatarUrl: null,
    isActive: true,
  },
  organization: null,
  organizations: [],
};

function renderDashboard() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <DashboardLayout>Dashboard content</DashboardLayout>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCKS", "false");
});

afterEach(() => {
  cleanup();
  navigation.replace.mockReset();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("DashboardLayout session boundary", () => {
  it("loads the verified identity so a fresh account can enter onboarding", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      const body =
        path === "/api/v1/auth/session"
          ? identity
          : path === "/api/v1/permissions/menu"
            ? { menu: [] }
            : {
                organizationId: "22222222-2222-4222-8222-222222222222",
                role: "viewer",
                permissions: {},
              };
      return new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetcher);

    renderDashboard();

    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith("/onboarding"),
    );
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/auth/session",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("keeps the mocked dashboard independent of API availability", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCKS", "true");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    renderDashboard();
    await act(async () => Promise.resolve());

    expect(fetcher).not.toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();
  });
});
