// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupportDiagnostics } from "./support-diagnostics";
const scope = {
  userId: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000002",
  permissionRevision: "a",
};
afterEach(cleanup);
describe("support diagnostic consent boundary", () => {
  it("does not read jobs without owner/admin export authority", () => {
    const gateway = { list: vi.fn() } as never;
    render(
      <SupportDiagnostics
        scope={scope}
        canGenerate={false}
        gateway={gateway}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "owner or administrator",
    );
  });
  it("loads creator-only history and previews only on explicit action", async () => {
    const gateway = {
      list: vi.fn().mockResolvedValue({
        organizationId: scope.organizationId,
        items: [],
        nextCursor: null,
      }),
      preview: vi.fn(),
    } as never;
    render(<SupportDiagnostics scope={scope} canGenerate gateway={gateway} />);
    expect(
      await screen.findByText("No diagnostic bundles created by you."),
    ).toBeTruthy();
    expect(screen.queryByLabelText(/I consent/)).toBeNull();
    expect(screen.getByLabelText("Logs")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Logs"));
    expect(screen.queryByText("Create diagnostic bundle")).toBeNull();
  });
});

import { waitFor } from "@testing-library/react";
import { ApiClientError } from "../../_lib/http/api-client";
import {
  diagnosticFailure,
  defaultDiagnosticSelection,
} from "./support-diagnostics";
import {
  diagnosticOrg,
  diagnosticId,
  diagnosticKey,
  diagnosticJob,
  diagnosticPreview,
  diagnosticContent,
} from "./diagnostic.fixture";
import { DiagnosticJobDetail } from "./diagnostic-job-detail";
function makeGateway() {
  return {
    list: vi.fn().mockResolvedValue({
      organizationId: diagnosticOrg,
      items: [],
      nextCursor: null,
    }),
    preview: vi.fn().mockResolvedValue(diagnosticPreview),
    create: vi.fn().mockResolvedValue(diagnosticJob),
    read: vi.fn().mockResolvedValue(diagnosticJob),
    content: vi.fn().mockResolvedValue(diagnosticContent),
    cancel: vi
      .fn()
      .mockResolvedValue({ ...diagnosticJob, state: "cancelled", version: 2 }),
    grant: vi.fn().mockResolvedValue({
      organizationId: diagnosticOrg,
      jobId: diagnosticId,
      grantId: diagnosticKey,
      downloadPath: `/api/v1/system/diagnostics/bundles/${diagnosticId}/download/${diagnosticKey}`,
      expiresAt: diagnosticPreview.expiresAt,
    }),
    reviewCleanup: vi.fn().mockResolvedValue({
      organizationId: diagnosticOrg,
      jobId: diagnosticId,
      eligible: true,
      blockers: [],
      reviewFingerprint: "a".repeat(64),
    }),
    cleanup: vi
      .fn()
      .mockResolvedValue({ ...diagnosticJob, state: "deleted", version: 2 }),
  };
}
const fullScope = { ...scope, organizationId: diagnosticOrg };
describe("diagnostic operational workflow", () => {
  it("requires unchecked consent, preserves idempotency on retry, inspects actual artifact, grants download and confirms reviewed cleanup", async () => {
    const gateway = makeGateway();
    gateway.create.mockRejectedValueOnce(new Error("network"));
    render(
      <SupportDiagnostics scope={fullScope} canGenerate gateway={gateway} />,
    );
    await screen.findByText("No diagnostic bundles created by you.");
    fireEvent.click(
      screen.getByRole("button", { name: "Preview diagnostic selection" }),
    );
    const consent = await screen.findByLabelText(/I consent to collect/);
    const create = screen.getByRole("button", {
      name: "Create diagnostic bundle",
    }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    expect((consent as HTMLInputElement).checked).toBe(false);
    fireEvent.click(consent);
    fireEvent.click(create);
    await screen.findByText(/Your form is preserved/);
    fireEvent.click(create);
    await screen.findByText(/Bundle .*version 1/);
    expect(gateway.create.mock.calls[0]![1].idempotencyKey).toBe(
      gateway.create.mock.calls[1]![1].idempotencyKey,
    );
    expect(await screen.findByText(/"operation_completed"/)).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: /Download authorized/ }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Authorize bundle download" }),
    );
    expect(
      (
        await screen.findByRole("link", {
          name: "Download authorized diagnostic bundle",
        })
      ).getAttribute("href"),
    ).toContain(`/download/${diagnosticKey}`);
    fireEvent.click(screen.getByRole("button", { name: "Review cleanup" }));
    const confirm = await screen.findByLabelText(/I confirm permanent cleanup/);
    expect(
      (
        screen.getByRole("button", {
          name: "Confirm diagnostic cleanup",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(confirm);
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm diagnostic cleanup" }),
    );
    await screen.findByText("Cleanup completed. Diagnostic artifact deleted.");
    expect(gateway.cleanup.mock.calls[0]![2]).toMatchObject({
      expectedVersion: 1,
      reviewFingerprint: "a".repeat(64),
    });
  });
  it("clears sensitive state on authority change while preserving safely scoped selection drafts", async () => {
    const gateway = makeGateway();
    const view = render(
      <SupportDiagnostics scope={fullScope} canGenerate gateway={gateway} />,
    );
    await screen.findByText("No diagnostic bundles created by you.");
    fireEvent.click(screen.getByLabelText("Logs"));
    fireEvent.click(
      screen.getByRole("button", { name: "Preview diagnostic selection" }),
    );
    await screen.findByLabelText(/I consent to collect/);
    view.rerender(
      <SupportDiagnostics
        scope={{ ...fullScope, permissionRevision: "b" }}
        canGenerate
        gateway={gateway}
      />,
    );
    expect(screen.queryByLabelText(/I consent to collect/)).toBeNull();
    expect((screen.getByLabelText("Logs") as HTMLInputElement).checked).toBe(
      false,
    );
    view.rerender(
      <SupportDiagnostics
        scope={{ ...fullScope, userId: diagnosticKey }}
        canGenerate
        gateway={gateway}
      />,
    );
    expect((screen.getByLabelText("Logs") as HTMLInputElement).checked).toBe(
      true,
    );
    view.rerender(
      <SupportDiagnostics scope={null} canGenerate gateway={gateway} />,
    );
    expect(
      screen.queryByRole("region", { name: "Support diagnostics" }),
    ).toBeNull();
  });
  it("shows forbidden without retaining history after a server authority rejection", async () => {
    const gateway = makeGateway();
    gateway.list.mockRejectedValue(new ApiClientError("api", "", 403));
    render(
      <SupportDiagnostics scope={fullScope} canGenerate gateway={gateway} />,
    );
    expect(
      await screen.findByText(/current owner or administrator/),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Logs")).toBeNull();
  });
  it("handles invalid ranges, category edits, expiring preview and list retry/older pagination", async () => {
    const gateway = makeGateway();
    gateway.list
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce({
        organizationId: diagnosticOrg,
        items: [diagnosticJob],
        nextCursor: diagnosticKey,
      });
    const view = render(
      <SupportDiagnostics scope={fullScope} canGenerate gateway={gateway} />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Retry history" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Load older bundles" }),
    );
    await waitFor(() =>
      expect(gateway.list).toHaveBeenCalledWith(
        diagnosticOrg,
        diagnosticKey,
        expect.any(AbortSignal),
      ),
    );
    fireEvent.change(screen.getByLabelText("From (UTC)"), {
      target: { value: "2020-01-01T01:00" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Preview diagnostic selection" }),
    );
    expect(await screen.findByText(/valid UTC window/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Last 24 hours" }));
    fireEvent.click(screen.getByLabelText("Logs"));
    fireEvent.click(screen.getByLabelText("Logs"));
    fireEvent.change(screen.getByLabelText("To (UTC)"), {
      target: { value: new Date().toISOString().slice(0, 16) },
    });
    gateway.preview.mockResolvedValue({
      ...diagnosticPreview,
      expiresAt: "2020-01-01T00:00:00.000Z",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Preview diagnostic selection" }),
    );
    fireEvent.click(await screen.findByLabelText(/I consent to collect/));
    fireEvent.click(
      screen.getByRole("button", { name: "Create diagnostic bundle" }),
    );
    expect(await screen.findByText(/preview has expired/)).toBeTruthy();
    expect(gateway.create).not.toHaveBeenCalled();
    view.unmount();
  });
  it("opens creator history records, refreshes job and polls active generation", async () => {
    const gateway = makeGateway();
    const running = {
      ...diagnosticJob,
      state: "running" as const,
      stage: "collecting" as const,
    };
    gateway.list.mockResolvedValue({
      organizationId: diagnosticOrg,
      items: [running],
      nextCursor: null,
    });
    gateway.read
      .mockResolvedValueOnce(running)
      .mockResolvedValue(diagnosticJob);
    render(
      <SupportDiagnostics scope={fullScope} canGenerate gateway={gateway} />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Inspect bundle/ }),
    );
    expect(await screen.findByRole("progressbar")).toBeTruthy();
    await waitFor(() => expect(gateway.read).toHaveBeenCalledTimes(2), {
      timeout: 4000,
    });
    await screen.findByText(/"operation_completed"/);
    fireEvent.click(screen.getByRole("button", { name: "Refresh job" }));
    await waitFor(() => expect(gateway.read).toHaveBeenCalledTimes(3));
    fireEvent.click(screen.getByRole("button", { name: "Refresh history" }));
    await waitFor(() => expect(gateway.list).toHaveBeenCalledTimes(2));
  });
  it("maps failure statuses and last24h defaults", () => {
    expect(diagnosticFailure(new ApiClientError("api", "", 401))).toContain(
      "forbidden",
    );
    expect(diagnosticFailure(new ApiClientError("api", "", 409))).toContain(
      "stale",
    );
    expect(diagnosticFailure(new ApiClientError("api", "", 410))).toContain(
      "expired",
    );
    expect(diagnosticFailure(new ApiClientError("api", "", 429))).toContain(
      "limit",
    );
    const selection = defaultDiagnosticSelection();
    expect(Date.parse(selection.to) - Date.parse(selection.from)).toBe(
      86400000,
    );
  });
});

describe("diagnostic job artifact states", () => {
  it("inspects bounded content pages and all sections, retries errors, withdraws consent", async () => {
    const gateway = makeGateway();
    gateway.content.mockResolvedValueOnce({
      ...diagnosticContent,
      nextOffset: 100,
    });
    const onJob = vi.fn(),
      onFailure = vi.fn();
    render(
      <DiagnosticJobDetail
        organizationId={diagnosticOrg}
        job={diagnosticJob}
        gateway={gateway}
        onJob={onJob}
        onFailure={onFailure}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Next content page" }),
    );
    await waitFor(() =>
      expect(gateway.content).toHaveBeenLastCalledWith(
        diagnosticOrg,
        diagnosticId,
        { section: "logs", offset: 100, limit: 100 },
        expect.any(AbortSignal),
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Previous content page" }),
    );
    await waitFor(() =>
      expect(gateway.content).toHaveBeenLastCalledWith(
        diagnosticOrg,
        diagnosticId,
        { section: "logs", offset: 0, limit: 100 },
        expect.any(AbortSignal),
      ),
    );
    for (const name of [
      "Configuration content",
      "Metrics content",
      "Omissions content",
    ]) {
      fireEvent.click(screen.getByRole("button", { name }));
      await waitFor(() =>
        expect(gateway.content).toHaveBeenLastCalledWith(
          diagnosticOrg,
          diagnosticId,
          expect.objectContaining({
            section: name.split(" ")[0]!.toLowerCase(),
          }),
          expect.any(AbortSignal),
        ),
      );
    }
    gateway.content.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Retry content" }));
    expect(await screen.findByText(/Content unavailable/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry content" }));
    await screen.findByText(/"operation_completed"/);
    fireEvent.click(screen.getByRole("button", { name: "Withdraw consent" }));
    await waitFor(() =>
      expect(onJob).toHaveBeenCalledWith(
        expect.objectContaining({ state: "cancelled" }),
      ),
    );
  });
  it("invalidates cleanup confirmation after failure and shows retention blockers", async () => {
    const gateway = makeGateway();
    gateway.reviewCleanup.mockResolvedValueOnce({
      organizationId: diagnosticOrg,
      jobId: diagnosticId,
      eligible: false,
      blockers: ["legal_hold"],
      reviewFingerprint: "a".repeat(64),
    });
    gateway.cleanup.mockRejectedValue(new ApiClientError("api", "", 409));
    const onFailure = vi.fn();
    render(
      <DiagnosticJobDetail
        organizationId={diagnosticOrg}
        job={diagnosticJob}
        gateway={gateway}
        onJob={vi.fn()}
        onFailure={onFailure}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Review cleanup" }));
    expect(await screen.findByText("Retained: legal_hold.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review cleanup" }));
    fireEvent.click(
      await screen.findByLabelText(/I confirm permanent cleanup/),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm diagnostic cleanup" }),
    );
    await waitFor(() => expect(onFailure).toHaveBeenCalled());
    expect(
      screen.queryByRole("button", { name: "Confirm diagnostic cleanup" }),
    ).toBeNull();
  });
  it.each(["expired", "cancelled", "failed", "deleted"] as const)(
    "renders %s without exposing content",
    (state) => {
      const gateway = makeGateway();
      render(
        <DiagnosticJobDetail
          organizationId={diagnosticOrg}
          job={{
            ...diagnosticJob,
            state,
            failureCode: "source_unavailable",
            cleanup: {
              state: state === "expired" ? "blocked" : "requested",
              blockers: ["retention"],
            },
            omissions: [{ category: "logs", code: "source_withheld" }],
          }}
          gateway={gateway}
          onJob={vi.fn()}
          onFailure={vi.fn()}
        />,
      );
      expect(
        screen.queryByRole("button", { name: "Authorize bundle download" }),
      ).toBeNull();
      expect(gateway.content).not.toHaveBeenCalled();
      expect(screen.getByText(/Omissions:/)).toBeTruthy();
    },
  );
});

it("describes an unselected or omitted configuration section without displaying null", async () => {
  const gateway = makeGateway();
  gateway.content.mockResolvedValue({
    ...diagnosticContent,
    section: "configuration",
    data: null,
  });
  render(
    <DiagnosticJobDetail
      organizationId={diagnosticOrg}
      job={diagnosticJob}
      gateway={gateway}
      onJob={vi.fn()}
      onFailure={vi.fn()}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Configuration content" }),
  );
  expect(
    await screen.findByText(
      "Configuration was not selected or is unavailable. Inspect omissions for details.",
    ),
  ).toBeTruthy();
});

it("polls reviewed cleanup until the retained artifact is deleted", async () => {
  const gateway = makeGateway();
  const queued = {
    ...diagnosticJob,
    state: "cancelled" as const,
    cleanup: { state: "requested" as const, blockers: [] },
  };
  gateway.list.mockResolvedValue({
    organizationId: diagnosticOrg,
    items: [queued],
    nextCursor: null,
  });
  gateway.read.mockResolvedValueOnce(queued).mockResolvedValue({
    ...diagnosticJob,
    state: "deleted",
    version: 2,
    cleanup: { state: "deleted", blockers: [] },
  });
  render(
    <SupportDiagnostics scope={fullScope} canGenerate gateway={gateway} />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: /Inspect bundle/ }),
  );
  await screen.findByText(/Cleanup requested/);
  expect(
    await screen.findByText(
      "Cleanup completed. Diagnostic artifact deleted.",
      {},
      { timeout: 4000 },
    ),
  ).toBeTruthy();
});

it("preserves inspected content when the already active content section is selected again", async () => {
  const gateway = makeGateway();
  render(
    <DiagnosticJobDetail
      organizationId={diagnosticOrg}
      job={diagnosticJob}
      gateway={gateway}
      onJob={vi.fn()}
      onFailure={vi.fn()}
    />,
  );
  await screen.findByText(/"operation_completed"/);
  fireEvent.click(screen.getByRole("button", { name: "Logs content" }));
  expect(screen.getByText(/"operation_completed"/)).toBeTruthy();
  expect(screen.queryByText("Loading redacted content…")).toBeNull();
});

it("explains an empty actual artifact section", async () => {
  const gateway = makeGateway();
  gateway.content.mockResolvedValue({ ...diagnosticContent, data: [] });
  render(
    <DiagnosticJobDetail
      organizationId={diagnosticOrg}
      job={diagnosticJob}
      gateway={gateway}
      onJob={vi.fn()}
      onFailure={vi.fn()}
    />,
  );
  expect(
    await screen.findByText(
      "No redacted records in this section. Check omissions for details.",
    ),
  ).toBeTruthy();
});
