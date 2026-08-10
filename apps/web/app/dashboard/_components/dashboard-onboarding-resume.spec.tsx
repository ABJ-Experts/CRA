// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DashboardOnboardingResume } from "./dashboard-onboarding-resume";

type MockOnboarding = {
  data: { nextIncompleteStage: "first_product" | null };
  isError: boolean;
};

const state = vi.hoisted(() => ({
  canView: true,
  session: {
    organization: {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Acme Ltd",
    },
  },
  onboarding: {
    data: {
      nextIncompleteStage: "first_product",
    },
    isError: false,
  } as MockOnboarding,
}));

vi.mock("../../_providers/providers", () => ({ useMocksReady: () => true }));
vi.mock("../../_providers/session-provider", () => ({
  useSession: () => ({ session: state.session }),
  useHasPermission: () => state.canView,
}));
vi.mock("../../_features/organizations/organizations.queries", () => ({
  useOnboardingQuery: () => state.onboarding,
}));

describe("DashboardOnboardingResume", () => {
  afterEach(() => {
    cleanup();
    state.canView = true;
    state.session = {
      organization: {
        id: "00000000-0000-4000-8000-000000000001",
        name: "Acme Ltd",
      },
    };
    state.onboarding = {
      data: { nextIncompleteStage: "first_product" },
      isError: false,
    };
    vi.unstubAllEnvs();
  });

  it("links only server-confirmed incomplete onboarding to the wizard", () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCKS", "false");
    render(<DashboardOnboardingResume />);

    expect(
      screen.getByText("Next required action: First product."),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Resume onboarding" }),
    ).toHaveAttribute("href", "/dashboard/onboarding");
  });

  it("does not show a progress prompt without permission or after completion", () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCKS", "false");
    state.canView = false;
    const view = render(<DashboardOnboardingResume />);
    expect(screen.queryByLabelText("Organization onboarding")).toBeNull();

    state.canView = true;
    state.onboarding = {
      data: { nextIncompleteStage: null },
      isError: false,
    };
    view.rerender(<DashboardOnboardingResume />);
    expect(screen.queryByLabelText("Organization onboarding")).toBeNull();
  });
});
