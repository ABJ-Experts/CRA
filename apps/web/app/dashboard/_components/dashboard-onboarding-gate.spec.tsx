// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DashboardOnboardingGate } from "./dashboard-onboarding-gate";

const navigation = vi.hoisted(() => ({
  pathname: "/dashboard",
  replace: vi.fn(),
}));
const session = vi.hoisted(() => ({
  value: {
    session: {
      organizations: [] as ReadonlyArray<{ id: string; name: string }>,
    },
    isLoading: false,
    isError: false,
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: navigation.replace }),
}));
vi.mock("../../_providers/providers", () => ({ useMocksReady: () => true }));
vi.mock("../../_providers/session-provider", () => ({
  useSession: () => session.value,
}));

describe("DashboardOnboardingGate", () => {
  afterEach(() => {
    navigation.pathname = "/dashboard";
    navigation.replace.mockReset();
    session.value = {
      session: { organizations: [] },
      isLoading: false,
      isError: false,
    };
    vi.unstubAllEnvs();
  });

  it("routes a verified session without memberships to onboarding", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCKS", "false");

    render(
      <DashboardOnboardingGate>
        <div>Dashboard body</div>
      </DashboardOnboardingGate>,
    );

    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith("/onboarding"),
    );
  });

  it("does not loop on onboarding or redirect while session state is uncertain", () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCKS", "false");
    navigation.pathname = "/onboarding";
    render(
      <DashboardOnboardingGate>
        <div>Onboarding body</div>
      </DashboardOnboardingGate>,
    );
    expect(navigation.replace).not.toHaveBeenCalled();

    navigation.pathname = "/dashboard";
    session.value = {
      session: { organizations: [] },
      isLoading: true,
      isError: false,
    };
    render(
      <DashboardOnboardingGate>
        <div>Loading body</div>
      </DashboardOnboardingGate>,
    );
    expect(navigation.replace).not.toHaveBeenCalled();
  });
});
