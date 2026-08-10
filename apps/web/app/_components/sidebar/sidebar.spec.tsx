// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
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
  pathname: "/dashboard/tables/basic",
  canView: (key: string) => key.length > 0,
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ replace: state.replace, refresh: state.refresh }),
}));
vi.mock("../../_providers/session-provider", () => ({
  useCanViewMenu: () => state.canView,
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
  state.pathname = "/dashboard/tables/basic";
  state.canView = () => true;
  state.replace.mockReset();
  state.refresh.mockReset();
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
  it("opens the active group and identifies the current nested route", () => {
    renderSidebar();

    expect(screen.getByRole("navigation", { name: "Main" })).toBeVisible();
    expect(screen.getByRole("link", { name: "CRA" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
    expect(screen.getByRole("button", { name: "Tables" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("link", { name: "Basic" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: "Sign out" })).toBeVisible();
    expect(screen.getByText("99+")).toBeVisible();
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

  it("opens and closes expandable groups without mutating the nav contract", async () => {
    const user = userEvent.setup();
    state.pathname = "/dashboard/messages";
    renderSidebar();
    const tables = screen.getByRole("button", { name: "Tables" });

    expect(tables).toHaveAttribute("aria-expanded", "false");
    await user.click(tables);
    expect(tables).toHaveAttribute("aria-expanded", "true");
    await user.click(tables);
    expect(tables).toHaveAttribute("aria-expanded", "false");
  });

  it("filters unauthorized children and removes empty groups", () => {
    const allowed = new Set(["dashboard", "dashboard.analytics", "messages"]);
    state.canView = (key) => allowed.has(key);
    renderSidebar();

    expect(screen.getByRole("button", { name: /Dashboard/ })).toBeVisible();
    expect(screen.getByRole("link", { name: "Analytics" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Tables" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Messages/ })).toBeInTheDocument();
    expect(screen.queryByText("Admin Authorization")).not.toBeInTheDocument();
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
