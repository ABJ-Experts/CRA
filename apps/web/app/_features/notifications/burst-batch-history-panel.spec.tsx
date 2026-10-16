// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "../../_lib/http/api-client";
import { BurstBatchHistoryPanel } from "./burst-batch-history-panel";

const row = {
  batchId: "11111111-1111-4111-8111-111111111111",
  category: "finding_triage",
  eventClass: "finding_sla_breached",
  status: "exhausted",
  windowStartsAt: "2026-10-05T10:00:00.000Z",
  windowEndsAt: "2026-10-05T10:02:00.000Z",
  memberCount: 5,
  preparedCount: 3,
  attemptCount: 1,
  lastAttemptAt: "2026-10-05T10:03:00.000Z",
  nextAttemptAt: null,
  safeErrorCode: "lease_expired_ambiguous",
  createdAt: "2026-10-05T10:02:00.000Z",
} as const;
const state = vi.hoisted(() => ({
  organizationId: "org-a",
  data: { rows: [] as unknown[], nextCursor: null as string | null },
  loading: false,
  error: null as unknown,
}));
const actions = vi.hoisted(() => ({ query: vi.fn(), refetch: vi.fn() }));

vi.mock("../../_providers/session-provider", () => ({
  useSession: () => ({
    session: { organization: { id: state.organizationId } },
  }),
}));
vi.mock("./notifications.queries", () => ({
  useNotificationBurstBatchesQuery: (query: unknown, enabled: unknown) => {
    actions.query(query, enabled);
    return {
      data: state.error ? undefined : state.data,
      isLoading: state.loading,
      isError: Boolean(state.error),
      isFetching: false,
      error: state.error,
      refetch: actions.refetch,
    };
  },
}));

beforeEach(() => {
  state.organizationId = "org-a";
  state.data = { rows: [row], nextCursor: null };
  state.loading = false;
  state.error = null;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BurstBatchHistoryPanel", () => {
  it("shows bounded membership, accepted uncertainty, and a scoped prepared-events link", () => {
    render(<BurstBatchHistoryPanel canViewAudit />);
    expect(
      screen.getByRole("table", { name: "Notification burst deliveries" }),
    ).toBeVisible();
    expect(screen.getByText("3 of 5 prepared")).toBeVisible();
    expect(
      screen.getByText(/Outcome uncertain; manual review needed/),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "View prepared events" }),
    ).toHaveAttribute("href", `/notifications?batchId=${row.batchId}`);
    expect(actions.query).toHaveBeenLastCalledWith(
      { cursor: undefined, limit: 25 },
      true,
    );
  });

  it("keeps audit-only access read-only and supports bounded cursor pages", () => {
    state.data = { rows: [row], nextCursor: "cursor_1" };
    render(<BurstBatchHistoryPanel canViewAudit />);
    fireEvent.click(screen.getByRole("button", { name: "Next burst page" }));
    expect(actions.query).toHaveBeenLastCalledWith(
      { cursor: "cursor_1", limit: 25 },
      true,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Previous burst page" }),
    );
    expect(actions.query).toHaveBeenLastCalledWith(
      { cursor: undefined, limit: 25 },
      true,
    );
  });

  it("hides cached batch details after audit permission is revoked", () => {
    render(<BurstBatchHistoryPanel canViewAudit={false} />);
    expect(screen.queryByText("3 of 5 prepared")).toBeNull();
    expect(
      screen.getByText(/do not have permission to view burst history/i),
    ).toBeVisible();
    expect(actions.query).toHaveBeenLastCalledWith(
      { cursor: undefined, limit: 25 },
      false,
    );
  });

  it("handles loading, empty, offline, and retry states", () => {
    state.loading = true;
    const view = render(<BurstBatchHistoryPanel canViewAudit />);
    expect(screen.getByRole("status")).toHaveTextContent(
      /Loading burst history/i,
    );
    state.loading = false;
    state.data = { rows: [], nextCursor: null };
    view.rerender(<BurstBatchHistoryPanel canViewAudit />);
    expect(
      screen.getByText(/No notification burst deliveries yet/i),
    ).toBeVisible();
    state.error = new ApiClientError("network", "Offline");
    view.rerender(<BurstBatchHistoryPanel canViewAudit />);
    expect(screen.getByRole("alert")).toHaveTextContent(/offline/i);
    fireEvent.click(
      screen.getByRole("button", { name: "Retry burst history" }),
    );
    expect(actions.refetch).toHaveBeenCalled();
  });

  it("distinguishes accepted and unsent batches without offering an empty cohort link", () => {
    state.data = {
      rows: [
        {
          ...row,
          status: "provider_accepted",
          safeErrorCode: null,
          preparedCount: 5,
        },
        {
          ...row,
          batchId: "22222222-2222-4222-8222-222222222222",
          status: "queued",
          safeErrorCode: null,
          preparedCount: 0,
          attemptCount: 0,
          lastAttemptAt: null,
        },
      ],
      nextCursor: null,
    };
    render(<BurstBatchHistoryPanel canViewAudit />);
    expect(
      screen.getByText(/Provider accepted; final delivery unconfirmed/),
    ).toBeVisible();
    expect(screen.getByText("No prepared events")).toBeVisible();
    expect(
      screen.getAllByRole("link", { name: "View prepared events" }),
    ).toHaveLength(1);
  });

  it("clears pagination and cached details on organization switch", () => {
    state.data = { rows: [row], nextCursor: "cursor_1" };
    const view = render(<BurstBatchHistoryPanel canViewAudit />);
    fireEvent.click(screen.getByRole("button", { name: "Next burst page" }));
    state.organizationId = "org-b";
    state.loading = true;
    view.rerender(<BurstBatchHistoryPanel canViewAudit />);
    expect(screen.queryByText("3 of 5 prepared")).toBeNull();
    expect(actions.query).toHaveBeenLastCalledWith(
      { cursor: undefined, limit: 25 },
      true,
    );
  });
});
