// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ids = [
  "00000000-0000-4000-8000-000000000101",
  "00000000-0000-4000-8000-000000000102",
  "00000000-0000-4000-8000-000000000103",
  "00000000-0000-4000-8000-000000000104",
  "00000000-0000-4000-8000-000000000105",
  "00000000-0000-4000-8000-000000000106",
  "00000000-0000-4000-8000-000000000107",
  "00000000-0000-4000-8000-000000000108",
];

const state = vi.hoisted(() => ({
  session: {
    session: {
      organization: { id: "22222222-2222-4222-8222-222222222222" },
    },
    permissions: { can_view_audit: true, can_export_audit: true },
    isLoading: false,
    isError: false,
  },
  snapshot: {
    snapshotToken: "snapshot_1",
    expiresAt: "2026-01-31T00:00:00Z",
    filters: {
      from: "2026-01-01T00:00:00Z",
      to: "2026-01-31T00:00:00Z",
    },
  },
  row: {
    id: "00000000-0000-4000-8000-000000000002",
    sequence: "1",
    legacy: false,
    createdAt: "2026-01-02T00:00:00Z",
    actor: {
      id: "00000000-0000-4000-8000-000000000010",
      type: "user",
      label: "owner@cra.test",
    },
    action: "product.updated",
    resourceType: "product",
    resourceId: "00000000-0000-4000-8000-000000000020",
    correlationId: null,
    outcome: "completed",
    verificationStatus: "not_verified",
  },
  searchMutate: vi.fn(),
  verifyMutate: vi.fn(),
  exportMutate: vi.fn(),
  grantMutate: vi.fn(),
  refetchPage: vi.fn(),
  refetchDetail: vi.fn(),
  pageData: undefined as unknown,
  pageLoading: false,
  pageFetching: false,
  pageError: null as unknown,
  detailData: undefined as unknown,
  detailLoading: false,
  detailError: null as unknown,
  exportJobData: undefined as unknown,
  startDownload: vi.fn(),
}));

vi.mock("../../_providers/session-provider", () => ({
  useSession: () => state.session,
}));

vi.mock("./audit-download", () => ({
  startAuditExportDownload: state.startDownload,
}));

vi.mock("./audit.queries", () => ({
  useAuditSearchMutation: () => ({
    isPending: false,
    mutateAsync: state.searchMutate,
  }),
  useAuditPageQuery: (
    _organizationId: string | null,
    snapshotToken: string | null,
    _query: unknown,
    enabled: boolean,
  ) => ({
    data: enabled && snapshotToken ? state.pageData : undefined,
    isLoading: enabled && snapshotToken ? state.pageLoading : false,
    isFetching: enabled && snapshotToken ? state.pageFetching : false,
    isError: enabled && snapshotToken ? state.pageError !== null : false,
    error: enabled && snapshotToken ? state.pageError : null,
    refetch: state.refetchPage,
  }),
  useAuditDetailQuery: (
    _organizationId: string | null,
    snapshotToken: string | null,
    eventId: string | null,
    _requestId: string,
    enabled: boolean,
  ) => ({
    data: enabled && snapshotToken && eventId ? state.detailData : undefined,
    isLoading:
      enabled && snapshotToken && eventId ? state.detailLoading : false,
    isError:
      enabled && snapshotToken && eventId ? state.detailError !== null : false,
    error: enabled && snapshotToken && eventId ? state.detailError : null,
    refetch: state.refetchDetail,
  }),
  useAuditVerifyMutation: () => ({
    isPending: false,
    mutateAsync: state.verifyMutate,
  }),
  useCreateAuditExportMutation: () => ({
    isPending: false,
    mutateAsync: state.exportMutate,
  }),
  useAuditExportJobQuery: (
    _organizationId: string | null,
    jobId: string | null,
    enabled: boolean,
  ) => ({
    data: enabled && jobId ? state.exportJobData : undefined,
  }),
  useAuditDownloadGrantMutation: () => ({
    isPending: false,
    mutateAsync: state.grantMutate,
  }),
}));

import { ApiClientError } from "../../_lib/http/api-client";
import { AuditExplorer } from "./audit-explorer";

function resetState() {
  state.session = {
    session: {
      organization: { id: "22222222-2222-4222-8222-222222222222" },
    },
    permissions: { can_view_audit: true, can_export_audit: true },
    isLoading: false,
    isError: false,
  };
  state.pageData = undefined;
  state.pageLoading = false;
  state.pageFetching = false;
  state.pageError = null;
  state.detailData = undefined;
  state.detailLoading = false;
  state.detailError = null;
  state.exportJobData = undefined;
  state.startDownload.mockReset();
  state.searchMutate.mockReset().mockResolvedValue(state.snapshot);
  state.verifyMutate.mockReset().mockResolvedValue({
    checkedAt: "2026-01-02T00:00:00Z",
    items: [{ eventId: state.row.id, status: "event_hashes_checked" }],
    completenessProven: false,
    authenticityProven: false,
  });
  state.exportMutate.mockReset().mockResolvedValue({
    id: "00000000-0000-4000-8000-000000000030",
    status: "queued",
    format: "csv",
    createdAt: "2026-01-02T00:00:00Z",
    expiresAt: null,
    rowCount: null,
    packageHash: null,
    failureCode: null,
  });
  state.grantMutate.mockReset().mockResolvedValue({
    url: "/api/v1/audit/exports/00000000-0000-4000-8000-000000000030/download",
    expiresAt: "2026-01-02T00:15:00Z",
    packageHash: "a".repeat(64),
  });
}

beforeEach(() => {
  resetState();
  let index = 0;
  vi.stubGlobal("crypto", {
    randomUUID: vi.fn(() => ids[index++] ?? ids.at(-1)),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("AuditExplorer", () => {
  it("fails closed without audit view permission", () => {
    state.session = {
      ...state.session,
      permissions: { can_view_audit: false, can_export_audit: true },
    };

    render(<AuditExplorer />);

    expect(
      screen.getByText("You do not have permission to view the audit trail."),
    ).toBeInTheDocument();
  });

  it("creates a filtered snapshot without sending tenant scope", async () => {
    render(<AuditExplorer />);
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-01-01T00:00" },
    });
    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "2026-01-31T00:00" },
    });
    fireEvent.change(screen.getByLabelText("Action"), {
      target: { value: "product.updated" },
    });

    fireEvent.click(
      screen.getByRole("button", { name: /search audit trail/i }),
    );

    await waitFor(() => expect(state.searchMutate).toHaveBeenCalledTimes(1));
    expect(state.searchMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: expect.stringMatching(
          /^00000000-0000-4000-8000-00000000010[1-8]$/,
        ),
        filters: {
          from: new Date("2026-01-01T00:00").toISOString(),
          to: new Date("2026-01-31T00:00").toISOString(),
          action: "product.updated",
        },
      }),
    );
    const firstSearchCall = state.searchMutate.mock.calls[0];
    expect(firstSearchCall).toBeDefined();
    expect(firstSearchCall?.[0]).not.toHaveProperty("organizationId");
  });

  it("keeps invalid draft dates in the audit form error path", async () => {
    render(<AuditExplorer />);
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "" } });
    fireEvent.click(
      screen.getByRole("button", { name: /search audit trail/i }),
    );

    expect(
      await screen.findByText(/could not be completed/i),
    ).toBeInTheDocument();
    expect(state.searchMutate).not.toHaveBeenCalled();
  });

  it("reuses request identities for ambiguous read, verify, and export retries", async () => {
    state.pageData = { items: [state.row], nextCursor: null };
    state.searchMutate
      .mockRejectedValueOnce(new ApiClientError("network", "offline"))
      .mockResolvedValue(state.snapshot);

    render(<AuditExplorer />);
    fireEvent.change(screen.getByLabelText("Action"), {
      target: { value: "product.updated" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /search audit trail/i }),
    );
    await screen.findByText(/temporarily unavailable/i);
    fireEvent.click(
      screen.getByRole("button", { name: /search audit trail/i }),
    );
    await screen.findByText(/audit snapshot created/i);

    const firstSearch = state.searchMutate.mock.calls[0]?.[0];
    const secondSearch = state.searchMutate.mock.calls[1]?.[0];
    expect(secondSearch?.requestId).toBe(firstSearch?.requestId);

    fireEvent.change(screen.getByLabelText("Action"), {
      target: { value: "product.deleted" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /search audit trail/i }),
    );
    await waitFor(() => expect(state.searchMutate).toHaveBeenCalledTimes(3));
    const thirdSearch = state.searchMutate.mock.calls[2]?.[0];
    expect(thirdSearch?.requestId).not.toBe(firstSearch?.requestId);

    state.verifyMutate
      .mockRejectedValueOnce(new ApiClientError("network", "offline"))
      .mockResolvedValue({
        checkedAt: "2026-01-02T00:00:00Z",
        items: [{ eventId: state.row.id, status: "event_hashes_checked" }],
        completenessProven: false,
        authenticityProven: false,
      });
    fireEvent.click(
      screen.getByRole("checkbox", { name: /select product.updated/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /verify selected/i }));
    await screen.findByText(/temporarily unavailable/i);
    fireEvent.click(screen.getByRole("button", { name: /verify selected/i }));
    await screen.findByText(/selected event hashes were checked/i);
    const firstVerify = state.verifyMutate.mock.calls[0]?.[0].input.requestId;
    const secondVerify = state.verifyMutate.mock.calls[1]?.[0].input.requestId;
    expect(secondVerify).toBe(firstVerify);

    state.exportMutate
      .mockRejectedValueOnce(new ApiClientError("network", "offline"))
      .mockResolvedValue({
        id: "00000000-0000-4000-8000-000000000030",
        status: "queued",
        format: "csv",
        createdAt: "2026-01-02T00:00:00Z",
        expiresAt: null,
        rowCount: null,
        packageHash: null,
        failureCode: null,
      });
    fireEvent.click(screen.getByRole("button", { name: /queue export/i }));
    await screen.findByText(/temporarily unavailable/i);
    fireEvent.click(screen.getByRole("button", { name: /queue export/i }));
    await screen.findByText(/audit export queued/i);
    const firstExport = state.exportMutate.mock.calls[0]?.[0].requestId;
    const secondExport = state.exportMutate.mock.calls[1]?.[0].requestId;
    expect(secondExport).toBe(firstExport);
  });

  it("does not show a verified badge until verification returns that status", async () => {
    state.pageData = { items: [state.row], nextCursor: null };
    render(<AuditExplorer />);

    fireEvent.click(
      screen.getByRole("button", { name: /search audit trail/i }),
    );
    await screen.findByText(/audit snapshot created/i);
    expect(screen.getByText("Not verified")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /select product.updated/i }),
    );
    const verifyButton = screen.getByRole("button", {
      name: /verify selected/i,
    });
    await waitFor(() => expect(verifyButton).toBeEnabled());
    fireEvent.click(verifyButton);

    await waitFor(() => expect(state.verifyMutate).toHaveBeenCalledTimes(1));
    await screen.findByText("Event hashes checked");
    expect(state.verifyMutate).toHaveBeenCalledWith({
      snapshotToken: "snapshot_1",
      input: expect.objectContaining({
        requestId: expect.stringMatching(
          /^00000000-0000-4000-8000-00000000010[1-8]$/,
        ),
        eventIds: [state.row.id],
      }),
    });
  });

  it("restores focus to the current matching opener if the original row button is replaced", async () => {
    state.pageData = { items: [state.row], nextCursor: null };
    state.detailData = {
      event: state.row,
      before: { status: "draft" },
      after: { secret: "[REDACTED]" },
      reason: "manual_update",
    };
    render(<AuditExplorer />);

    fireEvent.click(
      screen.getByRole("button", { name: /search audit trail/i }),
    );
    await screen.findByText(/audit snapshot created/i);
    const openButton = screen.getByRole("button", { name: "Open" });
    fireEvent.click(openButton);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    const replacement = openButton.cloneNode(true) as HTMLButtonElement;
    openButton.replaceWith(replacement);
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(document.activeElement).toBe(replacement));
  });

  it("restores keyboard focus to the detail opener after Escape closes the side panel", async () => {
    state.pageData = { items: [state.row], nextCursor: null };
    state.detailData = {
      event: state.row,
      before: { status: "draft" },
      after: { secret: "[REDACTED]" },
      reason: "manual_update",
    };
    render(<AuditExplorer />);

    fireEvent.click(
      screen.getByRole("button", { name: /search audit trail/i }),
    );
    await screen.findByText(/audit snapshot created/i);
    const openButton = screen.getByRole("button", { name: "Open" });
    openButton.focus();
    fireEvent.click(openButton);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(document.activeElement).toBe(openButton);
  });

  it("opens the detail drawer with redacted before and after values", async () => {
    state.pageData = { items: [state.row], nextCursor: null };
    state.detailData = {
      event: state.row,
      before: { status: "draft" },
      after: { secret: "[REDACTED]" },
      reason: "manual_update",
    };
    render(<AuditExplorer />);

    fireEvent.click(
      screen.getByRole("button", { name: /search audit trail/i }),
    );
    await screen.findByText(/audit snapshot created/i);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Audit event detail")).toBeInTheDocument();
    expect(screen.getByText(/REDACTED/)).toBeInTheDocument();
  });

  it("shows loading, conflict and retry states for a snapshot read", async () => {
    state.pageLoading = true;
    const { rerender } = render(<AuditExplorer />);

    fireEvent.click(
      screen.getByRole("button", { name: /search audit trail/i }),
    );
    await screen.findByText(/audit snapshot created/i);
    expect(screen.getByText("Loading audit events…")).toBeInTheDocument();

    state.pageLoading = false;
    state.pageError = new ApiClientError("api", "Snapshot changed", 409);
    rerender(<AuditExplorer />);

    expect(screen.getByText(/audit snapshot changed/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^retry$/i }));
    expect(state.refetchPage).toHaveBeenCalledTimes(1);
  });

  it("shows stale session and expired snapshot states without clearing draft filters", async () => {
    state.session = { ...state.session, isError: true };
    state.pageError = new ApiClientError("api", "Gone", 410);
    render(<AuditExplorer />);

    fireEvent.change(screen.getByLabelText("Action"), {
      target: { value: "product.deleted" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /search audit trail/i }),
    );

    await screen.findByText("Session permissions stale");
    expect(screen.getByText(/snapshot or export expired/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Action")).toHaveValue("product.deleted");
  });

  it("clears bound snapshot state on organization switch while preserving draft filters", async () => {
    state.pageData = { items: [state.row], nextCursor: "cursor_2" };
    state.detailData = {
      event: state.row,
      before: { status: "draft" },
      after: { status: "ready" },
      reason: "manual_update",
    };
    const { rerender } = render(<AuditExplorer />);

    fireEvent.change(screen.getByLabelText("Action"), {
      target: { value: "product.updated" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /search audit trail/i }),
    );
    await screen.findByText(/audit snapshot created/i);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    state.session = {
      ...state.session,
      session: {
        organization: { id: "33333333-3333-4333-8333-333333333333" },
      },
    };
    rerender(<AuditExplorer />);

    await waitFor(() => {
      expect(
        screen.getByText(/create a snapshot before paging/i),
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Action")).toHaveValue("product.updated");
    expect(
      screen.queryByRole("button", { name: "Open" }),
    ).not.toBeInTheDocument();
  });

  it("queues exports and authorizes ready downloads with a fresh request identity", async () => {
    state.pageData = { items: [state.row], nextCursor: null };
    state.exportJobData = {
      id: "00000000-0000-4000-8000-000000000030",
      status: "ready",
      format: "csv",
      createdAt: "2026-01-02T00:00:00Z",
      expiresAt: "2026-01-02T00:15:00Z",
      rowCount: 1,
      packageHash: "a".repeat(64),
      failureCode: null,
    };
    const { rerender } = render(<AuditExplorer />);

    fireEvent.click(
      screen.getByRole("button", { name: /search audit trail/i }),
    );
    await screen.findByText(/audit snapshot created/i);
    fireEvent.click(screen.getByRole("button", { name: /queue export/i }));
    await waitFor(() => expect(state.exportMutate).toHaveBeenCalledTimes(1));
    rerender(<AuditExplorer />);
    fireEvent.click(
      screen.getByRole("button", { name: /authorize download/i }),
    );

    await waitFor(() => expect(state.grantMutate).toHaveBeenCalledTimes(1));
    expect(state.grantMutate).toHaveBeenCalledWith(
      expect.stringMatching(/^00000000-0000-4000-8000-00000000010[1-8]$/),
    );
    expect(state.startDownload).toHaveBeenCalledTimes(1);
    expect(state.startDownload).toHaveBeenCalledWith(
      expect.objectContaining({ packageHash: "a".repeat(64) }),
      expect.any(Function),
    );
  });

  it("handles empty results, pagination controls, reset, and separate export permission", async () => {
    state.session = {
      ...state.session,
      permissions: { can_view_audit: true, can_export_audit: false },
    };
    state.pageData = { items: [], nextCursor: "cursor_2" };
    render(<AuditExplorer />);

    fireEvent.change(screen.getByLabelText("Actor"), {
      target: { value: "00000000-0000-4000-8000-000000000010" },
    });
    fireEvent.change(screen.getByLabelText("Resource type"), {
      target: { value: "product" },
    });
    fireEvent.change(screen.getByLabelText("Resource"), {
      target: { value: "00000000-0000-4000-8000-000000000020" },
    });
    fireEvent.change(screen.getByLabelText("Correlation ID"), {
      target: { value: "00000000-0000-4000-8000-000000000021" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /search audit trail/i }),
    );

    await screen.findByText(/no audit events match/i);
    expect(screen.getByText("Export permission required")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /queue export/i }),
    ).toBeDisabled();
    expect(state.searchMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({
          actorId: "00000000-0000-4000-8000-000000000010",
          resourceType: "product",
          resourceId: "00000000-0000-4000-8000-000000000020",
          correlationId: "00000000-0000-4000-8000-000000000021",
        }),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^previous$/i })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: /^previous$/i }));
    fireEvent.change(screen.getByLabelText("Format"), {
      target: { value: "json" },
    });
    expect(screen.getByLabelText("Format")).toHaveValue("json");
    fireEvent.click(screen.getByRole("button", { name: /reset dates/i }));
    expect(screen.getByLabelText("Actor")).toHaveValue(
      "00000000-0000-4000-8000-000000000010",
    );
  });

  it("surfaces integrity breaks, correlation identifiers, and detail retry states", async () => {
    const breakRow = {
      ...state.row,
      id: "00000000-0000-4000-8000-000000000099",
      sequence: "2",
      actor: { id: null, type: "system", label: null },
      resourceId: null,
      correlationId: "00000000-0000-4000-8000-000000000077",
      verificationStatus: "integrity_break",
    };
    state.pageData = { items: [breakRow], nextCursor: null };
    state.detailData = {
      event: breakRow,
      before: null,
      after: { enabled: true, count: 2 },
      reason: null,
    };
    const { rerender } = render(<AuditExplorer />);

    fireEvent.click(
      screen.getByRole("button", { name: /search audit trail/i }),
    );
    await screen.findAllByText("Integrity break");
    expect(screen.getByText("Integrity break detected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByText("00000000-0000-4000-8000-000000000077"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Integrity break in visible results"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("None").length).toBeGreaterThan(0);

    state.detailData = undefined;
    state.detailLoading = true;
    rerender(<AuditExplorer />);
    expect(screen.getByText("Loading event detail…")).toBeInTheDocument();

    state.detailLoading = false;
    state.detailError = new ApiClientError("network", "Offline");
    rerender(<AuditExplorer />);
    expect(screen.getByText(/temporarily unavailable/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^retry$/i }));
    expect(state.refetchDetail).toHaveBeenCalledTimes(1);
  });

  it("shows failed export states without exposing a package hash", async () => {
    state.pageData = { items: [state.row], nextCursor: null };
    state.exportJobData = {
      id: "00000000-0000-4000-8000-000000000030",
      status: "failed",
      format: "json",
      createdAt: "2026-01-02T00:00:00Z",
      expiresAt: null,
      rowCount: null,
      packageHash: null,
      failureCode: "access_changed",
    };
    const { rerender } = render(<AuditExplorer />);

    fireEvent.click(
      screen.getByRole("button", { name: /search audit trail/i }),
    );
    await screen.findByText(/audit snapshot created/i);
    fireEvent.change(screen.getByLabelText("Format"), {
      target: { value: "json" },
    });
    fireEvent.click(screen.getByRole("button", { name: /queue export/i }));
    await waitFor(() => expect(state.exportMutate).toHaveBeenCalledTimes(1));
    rerender(<AuditExplorer />);

    expect(screen.getByText(/failed: access changed/i)).toBeInTheDocument();
    expect(screen.queryByText(/sha-256/i)).not.toBeInTheDocument();
  });
});
