// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => vi.fn());
vi.mock("./export-controls", () => ({
  ExportControls: (props: unknown) => {
    calls(props);
    return <div>Portal export</div>;
  },
}));
vi.mock("./exports.api", () => ({
  ExportsGateway: class {
    constructor(
      public client: unknown,
      public options: unknown,
    ) {}
  },
}));
import { PortalExportControls } from "./portal-export-controls";
afterEach(() => {
  cleanup();
  calls.mockClear();
});
it("binds supplier export requests to the original opaque session without membership transport", () => {
  render(
    <PortalExportControls
      source="supplier_evidence.portal_items"
      sessionToken="opaque-session"
    />,
  );
  expect(screen.getByText("Portal export")).toBeInTheDocument();
  const props = calls.mock.calls[0]![0];
  expect(props.context).toEqual({});
  expect(props.gateway.options).toEqual({
    basePath: "/api/v1/supplier-evidence-portal/exports",
    headers: { "x-supplier-evidence-session": "opaque-session" },
    credentials: "same-origin",
  });
  expect(props.enabled).toBe(true);
});
it("keeps submissions scoped to their visible checklist item", () => {
  render(
    <PortalExportControls
      source="supplier_evidence.portal_submissions"
      sessionToken="opaque-session"
      checklistItemId="item"
    />,
  );
  expect(calls.mock.calls[0]![0].context).toEqual({ checklistItemId: "item" });
});
it("uses the auditor cookie scope and no supplier header", () => {
  render(
    <PortalExportControls source="technical_file.auditor_manifest_artifacts" />,
  );
  expect(calls.mock.calls[0]![0].gateway.options).toEqual({
    basePath: "/api/v1/auditor/exports",
    credentials: "same-origin",
  });
});
it("does not enable a supplier export without its opaque session", () => {
  render(<PortalExportControls source="supplier_evidence.portal_items" />);
  expect(calls.mock.calls[0]![0].enabled).toBe(false);
});
