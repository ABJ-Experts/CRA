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

import { ApiClientError } from "../../_lib/http/api-client";
import { NotificationCentre } from "./notification-centre";

const ref = "m6_55555555-5555-4555-8555-555555555555_event";
const fingerprint = "a".repeat(64);
const safeReportingPath =
  "/reporting?obligationId=66666666-6666-4666-8666-666666666666&stageId=77777777-7777-4777-8777-777777777777";
const item = {
  ref,
  category: "reporting_deadline",
  severity: "critical",
  occurredAt: "2026-10-01T10:00:00.000Z",
  title: "Reporting deadline",
  summary: "A regulatory deadline needs attention.",
  read: false,
  fingerprint,
  sourceState: "available",
  noticeKind: "event",
} as const;

const state = vi.hoisted(() => ({
  organizationId: "org-a",
  userId: "user-a",
  isLoading: false,
  sessionError: false,
  feed: { items: [] as unknown[], nextCursor: null as string | null },
  feedError: null as unknown,
  markError: null as unknown,
  destination: { state: "available", url: "/reporting" } as {
    state: string;
    url: string | null;
  },
}));
const actions = vi.hoisted(() => ({
  push: vi.fn(),
  feed: vi.fn(),
  refetch: vi.fn(),
  markRead: vi.fn(),
  destination: vi.fn(),
  invalidateSession: vi.fn(),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({ invalidateQueries: actions.invalidateSession }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: actions.push }),
}));
vi.mock("../../_providers/session-provider", () => ({
  useSession: () => ({
    session: state.isLoading
      ? null
      : {
          organization: { id: state.organizationId },
          user: { id: state.userId },
        },
    isLoading: state.isLoading,
    isError: state.sessionError,
  }),
}));
vi.mock("./notifications.queries", () => ({
  useNotificationFeedQuery: (query: unknown) => {
    actions.feed(query);
    return {
      data: state.feedError ? undefined : state.feed,
      isLoading: state.isLoading,
      isError: Boolean(state.feedError),
      error: state.feedError,
      isFetching: false,
      refetch: actions.refetch,
    };
  },
  useMarkNotificationReadMutation: () => ({
    mutateAsync: actions.markRead,
    isPending: false,
  }),
}));
vi.mock("./notifications.api", () => ({
  notificationsApi: { destination: actions.destination },
}));

beforeEach(() => {
  state.organizationId = "org-a";
  state.userId = "user-a";
  state.isLoading = false;
  state.sessionError = false;
  state.feed = { items: [item], nextCursor: null };
  state.feedError = null;
  state.markError = null;
  state.destination = { state: "available", url: safeReportingPath };
  actions.destination.mockImplementation(async () => state.destination);
  actions.markRead.mockImplementation(async () => {
    if (state.markError) throw state.markError;
    return {
      items: [{ ref, fingerprint, readAt: "2026-10-01T10:05:00.000Z" }],
      replayed: false,
    };
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("NotificationCentre", () => {
  it("shows non-colour unread state, filters, preferences and bounded explicit mark-read", async () => {
    render(<NotificationCentre />);
    expect(
      screen.getByRole("heading", { name: "Notifications" }),
    ).toBeVisible();
    expect(screen.getByText("Unread")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Notification preferences" }),
    ).toHaveAttribute("href", "/account");
    fireEvent.change(screen.getByLabelText("Read state"), {
      target: { value: "unread" },
    });
    expect(actions.feed).toHaveBeenLastCalledWith(
      expect.objectContaining({ read: "unread", limit: 25 }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Select Reporting deadline/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Mark selected as read" }),
    );
    await waitFor(() =>
      expect(actions.markRead).toHaveBeenCalledWith({
        items: [{ ref, expectedFingerprint: fingerprint }],
        idempotencyKey: expect.any(String),
      }),
    );
  });

  it("keeps selection on a stale conflict and offers retry on offline feed failure", async () => {
    state.markError = new ApiClientError("api", "Changed", 409);
    const view = render(<NotificationCentre />);
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Select Reporting deadline/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Mark selected as read" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/changed/i);
    expect(
      screen.getByRole("checkbox", { name: /Select Reporting deadline/ }),
    ).toBeChecked();
    state.feedError = new ApiClientError("network", "offline");
    view.rerender(<NotificationCentre />);
    expect(screen.getByRole("alert")).toHaveTextContent(/offline/i);
    fireEvent.click(
      screen.getByRole("button", { name: "Retry notifications" }),
    );
    expect(actions.refetch).toHaveBeenCalled();
  });

  it("never navigates when a source is unavailable or destination lookup returns 404", async () => {
    state.destination = { state: "unavailable", url: null };
    const view = render(<NotificationCentre />);
    fireEvent.click(
      screen.getByRole("button", { name: /Open Reporting deadline/ }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /no longer available/i,
    );
    expect(actions.push).not.toHaveBeenCalled();

    actions.destination.mockRejectedValue(
      new ApiClientError("api", "Not found", 404),
    );
    view.rerender(<NotificationCentre />);
    fireEvent.click(
      screen.getByRole("button", { name: /Open Reporting deadline/ }),
    );
    await waitFor(() => expect(actions.destination).toHaveBeenCalledTimes(2));
    expect(actions.push).not.toHaveBeenCalled();
  });

  it("shows no stale rows while loading and a clear no-access state on 403", () => {
    state.isLoading = true;
    const view = render(<NotificationCentre />);
    expect(
      screen.queryByText("A regulatory deadline needs attention."),
    ).not.toBeInTheDocument();
    state.isLoading = false;
    state.feedError = new ApiClientError("api", "Forbidden", 403);
    view.rerender(<NotificationCentre />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      /no longer have access/i,
    );
  });

  it("navigates only to a contract-validated local source route", async () => {
    render(<NotificationCentre />);
    fireEvent.click(
      screen.getByRole("button", { name: "Open Reporting deadline" }),
    );
    await waitFor(() =>
      expect(actions.push).toHaveBeenCalledWith(safeReportingPath),
    );
    actions.push.mockClear();
    state.destination = { state: "available", url: "javascript:alert(1)" };
    fireEvent.click(
      screen.getByRole("button", { name: "Open Reporting deadline" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /no longer available/i,
    );
    expect(actions.push).not.toHaveBeenCalled();
  });

  it("supports category and severity filters, stable cursor pages, and single-item mark-read", async () => {
    state.feed = { items: [item], nextCursor: "cursor_1" };
    render(<NotificationCentre />);
    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: "evidence" },
    });
    expect(actions.feed).toHaveBeenLastCalledWith(
      expect.objectContaining({ category: "evidence", limit: 25 }),
    );
    fireEvent.change(screen.getByLabelText("Severity"), {
      target: { value: "high" },
    });
    expect(actions.feed).toHaveBeenLastCalledWith(
      expect.objectContaining({ category: "evidence", severity: "high" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(actions.feed).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "cursor_1" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(actions.feed).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: undefined }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Mark Reporting deadline as read" }),
    );
    await waitFor(() =>
      expect(actions.markRead).toHaveBeenCalledWith({
        items: [{ ref, expectedFingerprint: fingerprint }],
        idempotencyKey: expect.any(String),
      }),
    );
  });

  it("labels unavailable and delivery failure entries without exposing an open action", () => {
    state.feed = {
      items: [{ ...item, noticeKind: "failure", sourceState: "unavailable" }],
      nextCursor: null,
    };
    render(<NotificationCentre />);
    expect(screen.getByText("Delivery issue")).toBeVisible();
    expect(screen.getByText("Source unavailable")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Open Reporting deadline" }),
    ).not.toBeInTheDocument();
  });

  it("hides cached rows when session verification fails and offers a session retry", () => {
    state.sessionError = true;
    render(<NotificationCentre />);
    expect(
      screen.queryByText("A regulatory deadline needs attention."),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /Could not verify notification access/,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry session" }));
    expect(actions.invalidateSession).toHaveBeenCalledWith({
      queryKey: ["session"],
    });
  });
});
