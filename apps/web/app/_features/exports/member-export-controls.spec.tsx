// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportSources } from "@repo/contracts/exports";
import { MemberExportControls } from "./member-export-controls";
const state = vi.hoisted(() => ({
  value: {
    session: { organization: { id: "org" }, user: { id: "user" } },
    permissions: { can_view_products: true, can_export_products: true },
    isLoading: false,
  } as Record<string, unknown>,
}));
vi.mock("../../_providers/session-provider", () => ({
  useSession: () => state.value,
}));
afterEach(cleanup);
describe("MemberExportControls", () => {
  it("requires every existing source permission and a loaded organization session", () => {
    const props = {
      source: "products.registry" as const,
      context: {},
      filters: {},
    };
    const view = render(<MemberExportControls {...props} />);
    expect(
      screen.getByRole("button", { name: "Export registry" }),
    ).toBeInTheDocument();
    state.value = {
      ...state.value,
      permissions: { can_view_products: true, can_export_products: false },
    };
    view.rerender(<MemberExportControls {...props} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    state.value = { session: null, isLoading: true };
    view.rerender(<MemberExportControls {...props} enabled={false} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

it("preserves exact owner/admin role gates independently of grants", () => {
  const source = "vulnerabilities.sync_runs" as const;
  const permissions = Object.fromEntries(
    exportSources[source].requiredPermissions.map((key) => [key, true]),
  );
  state.value = {
    session: { organization: { id: "org" }, user: { id: "user" } },
    role: "admin",
    permissions,
    isLoading: false,
  };
  const view = render(
    <MemberExportControls
      source={source}
      context={{}}
      filters={{}}
      label="Export feed runs"
    />,
  );
  expect(
    screen.getByRole("button", { name: "Export feed runs" }),
  ).toBeVisible();
  state.value = { ...state.value, role: "member" };
  view.rerender(
    <MemberExportControls source={source} context={{}} filters={{}} />,
  );
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  const ownerSource = "sboms.ci_credentials" as const;
  state.value = {
    ...state.value,
    role: "admin",
    permissions: Object.fromEntries(
      exportSources[ownerSource].requiredPermissions.map((key) => [key, true]),
    ),
  };
  view.rerender(
    <MemberExportControls source={ownerSource} context={{}} filters={{}} />,
  );
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  state.value = { ...state.value, role: "owner" };
  view.rerender(
    <MemberExportControls source={ownerSource} context={{}} filters={{}} />,
  );
  expect(screen.getByRole("button")).toBeVisible();
});
