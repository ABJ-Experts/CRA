// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../../_lib/http/api-client";
import { SbomExportPanel } from "./sbom-export-panel";
const api = vi.hoisted(() => ({ exportDocument: vi.fn() }));
vi.mock("../../_features/sboms/sboms.api", () => ({ sbomsApi: api }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("SBOM portable export", () => {
  it("makes unsupported SPDX VEX explicit and clears the option on format change", async () => {
    const user = userEvent.setup();
    render(<SbomExportPanel documentId="doc" sourceId="source" />);
    await user.click(screen.getByLabelText("Include reviewed VEX"));
    await user.selectOptions(screen.getByLabelText("Export format"), "spdx");
    expect(screen.getByLabelText("Include reviewed VEX")).toBeDisabled();
    expect(screen.getByLabelText("Include reviewed VEX")).not.toBeChecked();
    expect(screen.getByText(/SPDX 2.3 export does not embed VEX/)).toBeVisible();
  });
  it("retains selections after a read failure and retries explicitly", async () => {
    const user = userEvent.setup();
    api.exportDocument.mockRejectedValue(new Error("offline"));
    render(<SbomExportPanel documentId="doc" sourceId="source" />);
    await user.click(screen.getByLabelText("Include reviewed VEX"));
    await user.click(screen.getByRole("button", { name: "Download SBOM export" }));
    await screen.findByText("The export is temporarily unavailable. Your choices are preserved; retry when the service is available.");
    expect(screen.getByLabelText("Include reviewed VEX")).toBeChecked();
    expect(api.exportDocument).toHaveBeenCalledWith("doc", { sourceId: "source", format: "cyclonedx", includeVex: true });
    await user.click(screen.getByRole("button", { name: "Download SBOM export" }));
    await waitFor(() => expect(api.exportDocument).toHaveBeenCalledTimes(2));
  });
  it.each([403, 404, 409, 422])("shows scoped service errors for %s without losing choices", async (status) => {
    const user = userEvent.setup();
    api.exportDocument.mockRejectedValue(new ApiClientError("api", "Review conflict", status));
    render(<SbomExportPanel documentId="doc" sourceId="source" />);
    await user.click(screen.getByRole("button", { name: "Download SBOM export" }));
    const expected = status === 403 ? "You no longer have permission to export SBOM evidence." : status === 404 ? "This SBOM source is unavailable." : "Review conflict";
    expect(await screen.findByText(expected)).toBeVisible();
  });

  it.each(["not_requested", "included"])("downloads exact parsed export bytes and reports VEX %s", async (status) => {
    const user = userEvent.setup();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const create = vi.fn((blob: Blob) => { void blob; return "blob:export"; });
    const revoke = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: create });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    api.exportDocument.mockResolvedValue({ export: { content: "{\"bomFormat\":\"CycloneDX\"}", mediaType: "application/vnd.cyclonedx+json", fileName: "export.cdx.json", sha256: "a".repeat(64), vex: { status, assessmentCount: 2 } } });
    try {
      render(<SbomExportPanel documentId="doc" sourceId="source" />);
      await user.click(screen.getByRole("button", { name: "Download SBOM export" }));
      await screen.findByText(/Export prepared. SHA-256/);
      expect(click).toHaveBeenCalledOnce();
      expect(create.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
      await vi.advanceTimersByTimeAsync(1100);
      expect(revoke).toHaveBeenCalledWith("blob:export");
    } finally { click.mockRestore(); vi.useRealTimers(); }
  });

});
