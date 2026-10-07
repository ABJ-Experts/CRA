// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SiemAuditLink } from "./siem-audit-link";
const state = vi.hoisted(() => ({
  permissions: { can_view_audit: true, can_view_connectors: true },
}));
vi.mock("../../../_providers/session-provider", () => ({
  useSession: () => state,
}));
afterEach(cleanup);
it("links from audit only with both read grants", () => {
  render(<SiemAuditLink />);
  expect(screen.getByRole("link")).toHaveAttribute("href", "/connectors/siem");
  cleanup();
  state.permissions.can_view_connectors = false;
  render(<SiemAuditLink />);
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  cleanup();
  state.permissions.can_view_connectors = true;
  state.permissions.can_view_audit = false;
  render(<SiemAuditLink />);
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});
