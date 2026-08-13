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
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SIDEBAR_ATTR, SIDEBAR_STORAGE_KEY } from "./sidebar-collapse";

const state = vi.hoisted(() => ({
  pathname: "/dashboard/organization",
  canView: (key: string) => key.length > 0,
  replace: vi.fn(),
  refresh: vi.fn(),
  branding: null as {
    source: "published";
    displayName: string;
    footerText: string | null;
    logo: { altText: string | null } | null;
  } | null,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ replace: state.replace, refresh: state.refresh }),
}));
vi.mock("../../_providers/session-provider", () => ({
  useCanViewMenu: () => state.canView,
}));
vi.mock("../../dashboard/organization-theme-provider", () => ({
  useDashboardOrganizationBranding: () => state.branding,
}));

import { Sidebar } from "./sidebar";

function renderSidebar() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <Sidebar />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.pathname = "/dashboard/organization";
  state.canView = () => true;
  state.replace.mockReset();
  state.refresh.mockReset();
  state.branding = null;
  localStorage.clear();
  document.documentElement.removeAttribute(SIDEBAR_ATTR);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
  document.documentElement.removeAttribute(SIDEBAR_ATTR);
});

describe("Sidebar", () => {
  it("identifies the current CRA workspace route", () => {
    renderSidebar();

    expect(screen.getByRole("navigation", { name: "Main" })).toBeVisible();
    expect(screen.getByRole("link", { name: "CRA Sentinel" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
    expect(screen.getByRole("link", { name: "Organization" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: "Sign out" })).toBeVisible();
    expect(screen.getByText("C")).toHaveClass("text-on-accent");
  });

  it("renders the published name and published-only logo endpoint", () => {
    state.branding = {
      source: "published",
      displayName: "Analytical Engines",
      footerText: "Analytical Engines footer",
      logo: { altText: "Analytical Engines logo" },
    };
    renderSidebar();

    expect(
      screen.getByRole("link", { name: "Analytical Engines" }),
    ).toBeVisible();
    expect(
      screen.getByRole("img", { name: "Analytical Engines logo" }),
    ).toHaveAttribute("src", "/api/v1/organizations/current/branding/logo");
    expect(screen.queryByText("CRA Sentinel")).not.toBeInTheDocument();
  });

  it("uses the published display-name initial and footer when no logo is published", () => {
    state.branding = {
      source: "published",
      displayName: "Analytical Engines",
      footerText: "Engineering safer products.",
      logo: null,
    };
    renderSidebar();

    expect(
      screen.getByRole("link", { name: "Analytical Engines" }),
    ).toBeVisible();
    expect(screen.getByText("A", { exact: true })).toHaveClass(
      "text-on-accent",
    );
    expect(screen.getByText("Engineering safer products.")).toBeVisible();
    expect(screen.queryByText("C", { exact: true })).not.toBeInTheDocument();
  });

  it("keeps the CRA mark when branding is unavailable", () => {
    state.branding = null;
    renderSidebar();

    expect(screen.getByRole("link", { name: "CRA Sentinel" })).toBeVisible();
    expect(screen.getByText("C")).toBeVisible();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("persists collapse and restores the expanded rail", async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(
      await screen.findByRole("button", { name: "Expand sidebar" }),
    ).toBeVisible();
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("collapsed");
    expect(document.documentElement).toHaveAttribute(SIDEBAR_ATTR, "collapsed");

    await user.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(
      screen.getByRole("button", { name: "Collapse sidebar" }),
    ).toBeVisible();
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("expanded");
    expect(document.documentElement).not.toHaveAttribute(SIDEBAR_ATTR);
  });

  it("opens and closes access-control navigation without mutating the nav contract", async () => {
    const user = userEvent.setup();
    state.pathname = "/dashboard/roles";
    renderSidebar();
    const authorization = screen.getByRole("button", { name: "Authorization" });

    expect(authorization).toHaveAttribute("aria-expanded", "true");
    await user.click(authorization);
    expect(authorization).toHaveAttribute("aria-expanded", "false");
    await user.click(authorization);
    expect(authorization).toHaveAttribute("aria-expanded", "true");
  });

  it("filters unauthorized children and removes empty groups", () => {
    const allowed = new Set(["dashboard", "organization"]);
    state.canView = (key) => allowed.has(key);
    renderSidebar();

    expect(screen.getByRole("link", { name: /Dashboard/ })).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Organization" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Management" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Account & access")).not.toBeInTheDocument();
  });

  it("opens and dismisses the mobile drawer", async () => {
    const user = userEvent.setup();
    renderSidebar();
    const open = screen.getByRole("button", { name: "Open navigation" });

    await user.click(open);
    expect(open).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("navigation", { name: "Main" })).toHaveLength(2);

    fireEvent.click(
      screen.getAllByRole("button", { name: "Close navigation" })[1]!,
    );
    await waitFor(() => expect(open).toHaveAttribute("aria-expanded", "false"));
  });
});
