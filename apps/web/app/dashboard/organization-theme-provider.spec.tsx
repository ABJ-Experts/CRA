// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ResolvedOrganizationBranding } from "@repo/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as { organization: { id: string } | null } | null,
  query: {
    data: undefined as { branding: ResolvedOrganizationBranding } | undefined,
    isLoading: false,
    isError: false,
  },
}));

vi.mock("../_providers/session-provider", () => ({
  useSession: () => ({ session: state.session }),
}));
vi.mock(
  "../_features/organizations/active-organization-branding.queries",
  () => ({
    useActiveOrganizationBrandingQuery: () => state.query,
  }),
);

import {
  OrganizationThemeProvider,
  useDashboardOrganizationBranding,
} from "./organization-theme-provider";

const publishedBranding = {
  source: "published",
  displayName: "Acme",
  footerText: "Acme footer",
  contactText: null,
  palette: {
    primary: "#111111",
    primaryText: "#FFFFFF",
    secondary: "#222222",
    secondaryText: "#000000",
  },
  logo: null,
  version: 1,
  publishedAt: "2026-08-12T10:00:00.000Z",
  updatedAt: "2026-08-12T10:00:00.000Z",
} as const satisfies ResolvedOrganizationBranding;

function BrandingConsumer() {
  const branding = useDashboardOrganizationBranding();
  return <output>{branding?.source ?? "none"}</output>;
}

function renderProvider() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <OrganizationThemeProvider>
        <BrandingConsumer />
      </OrganizationThemeProvider>
    </QueryClientProvider>,
  );
}

describe("OrganizationThemeProvider", () => {
  afterEach(() => {
    cleanup();
    state.session = null;
    state.query = { data: undefined, isLoading: false, isError: false };
  });

  it("applies only a published snapshot to the dashboard wrapper and context", () => {
    state.session = { organization: { id: "org-a" } };
    state.query = {
      data: { branding: publishedBranding },
      isLoading: false,
      isError: false,
    };
    renderProvider();

    const wrapper = screen.getByText("published").parentElement;
    expect(wrapper).toHaveAttribute("data-organization-theme", "published");
    expect(wrapper).toHaveClass("block");
    expect(wrapper).not.toHaveClass("contents");
    expect(wrapper).toHaveStyle({
      "--organization-brand-primary": "#111111",
      "--organization-brand-secondary": "#222222",
    });
  });

  it("clears the previous organization branding while its replacement is loading", () => {
    state.session = { organization: { id: "org-a" } };
    state.query = {
      data: { branding: publishedBranding },
      isLoading: false,
      isError: false,
    };
    const view = renderProvider();
    expect(screen.getByText("published").parentElement).toHaveStyle(
      "--organization-brand-primary: #111111",
    );

    state.session = { organization: { id: "org-b" } };
    state.query = { data: undefined, isLoading: true, isError: false };
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <OrganizationThemeProvider>
          <BrandingConsumer />
        </OrganizationThemeProvider>
      </QueryClientProvider>,
    );
    const wrapper = screen.getByText("none").parentElement;
    expect(wrapper).not.toHaveAttribute("data-organization-theme");
    expect(wrapper).not.toHaveStyle("--organization-brand-primary: #111111");
  });

  it.each([
    [
      {
        ...publishedBranding,
        source: "sentinel",
        version: 0,
        publishedAt: null,
      },
    ],
    [
      {
        ...publishedBranding,
        source: "draft_preview",
        version: 2,
        publishedAt: null,
      },
    ],
    [publishedBranding],
  ] as const)(
    "does not expose non-published, absent, or failed branding",
    (branding) => {
      state.session = { organization: { id: "org-a" } };
      state.query = {
        data: { branding },
        isLoading: false,
        isError: branding.source === "published",
      };
      renderProvider();

      expect(screen.getByText("none").parentElement).not.toHaveAttribute(
        "data-organization-theme",
      );
    },
  );

  it("clears branding without a session and after unmount", () => {
    state.session = null;
    state.query = {
      data: { branding: publishedBranding },
      isLoading: false,
      isError: false,
    };
    const view = renderProvider();
    expect(screen.getByText("none").parentElement).not.toHaveAttribute(
      "data-organization-theme",
    );
    view.unmount();
    expect(document.querySelector("[data-organization-theme]")).toBeNull();
  });
});
