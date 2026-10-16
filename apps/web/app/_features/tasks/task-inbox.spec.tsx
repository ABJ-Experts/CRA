// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "../../_lib/http/api-client";
import { TaskInbox } from "./task-inbox";

const queries = vi.hoisted(() => ({
  useTaskListQuery: vi.fn(),
  useTaskDetailQuery: vi.fn(),
  useEligibleAssigneesQuery: vi.fn(),
  useTaskCommand: vi.fn(),
  useTaskGroupsQuery: vi.fn(),
  useTaskGroupQuery: vi.fn(),
  useTaskAbsencesQuery: vi.fn(),
  useTaskMemberCandidatesQuery: vi.fn(),
}));
vi.mock("./tasks.queries", () => queries);
vi.mock("../../_providers/session-provider", () => ({
  useSession: () => ({
    session: {
      organization: { id: "org-one" },
      user: { id: "22222222-2222-4222-8222-222222222222" },
    },
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setup(rows: object[] = []) {
  queries.useTaskListQuery.mockReturnValue({
    data: {
      rows,
      nextCursor: null,
      counts: { mine: rows.length, group: 0, available: 0 },
    },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  });
  queries.useTaskDetailQuery.mockReturnValue({ data: undefined });
  queries.useEligibleAssigneesQuery.mockReturnValue({ data: undefined });
  queries.useTaskCommand.mockReturnValue({ pending: false, run: vi.fn() });
  queries.useTaskGroupsQuery.mockReturnValue({ data: { groups: [] } });
  queries.useTaskGroupQuery.mockReturnValue({ data: undefined });
  queries.useTaskAbsencesQuery.mockReturnValue({ data: { absences: [] } });
  queries.useTaskMemberCandidatesQuery.mockReturnValue({
    data: {
      users: [
        { id: "11111111-1111-4111-8111-111111111111", displayName: "Owner" },
      ],
    },
    isLoading: false,
    isError: false,
  });
}

describe("TaskInbox", () => {
  it("shows a task-free state without a generic completion action", () => {
    setup();
    render(<TaskInbox />);
    expect(
      screen.getByRole("heading", { name: "Task inbox" }),
    ).toBeInTheDocument();
    expect(screen.getByText("No tasks in My tasks")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /mark.*done/i }),
    ).not.toBeInTheDocument();
  });

  it("opens an authorized source and labels overdue and unavailable rows safely", () => {
    setup([
      {
        organizationId: "org-one",
        taskType: "finding_triage",
        sourceId: "11111111-1111-4111-8111-111111111111",
        title: "Review CVE-2026-0001",
        sourceUrl: "/findings?findingId=11111111-1111-4111-8111-111111111111",
        dueAt: "2026-09-01T12:00:00.000Z",
        state: "overdue",
        sourceRevision: "v4",
        routeVersion: 2,
        accountableOwnerUserId: null,
        effectiveAssigneeUserId: null,
        actingUserId: null,
        groupId: null,
        delegatedToUserId: null,
        delegationExpiresAt: null,
        unresolvedAssignment: false,
        canAssign: false,
        canClaim: false,
        canDelegate: false,
      },
      {
        organizationId: "org-one",
        taskType: "supplier_request",
        sourceId: "22222222-2222-4222-8222-222222222222",
        title: null,
        sourceUrl: null,
        dueAt: null,
        state: "unavailable",
        sourceRevision: null,
        routeVersion: 1,
        accountableOwnerUserId: null,
        effectiveAssigneeUserId: null,
        actingUserId: null,
        groupId: null,
        delegatedToUserId: null,
        delegationExpiresAt: null,
        unresolvedAssignment: true,
        canAssign: false,
        canClaim: false,
        canDelegate: false,
      },
    ]);
    render(<TaskInbox />);
    expect(
      screen.getByRole("link", { name: /open task.*review cve/i }),
    ).toHaveAttribute(
      "href",
      "/findings?findingId=11111111-1111-4111-8111-111111111111",
    );
    const rows = screen.getAllByRole("row");
    expect(within(rows[1]!).getByText("Overdue")).toBeInTheDocument();
    expect(
      within(rows[2]!).getAllByText("Source unavailable").length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByText("22222222-2222-4222-8222-222222222222"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Group tasks" }));
    expect(queries.useTaskListQuery).toHaveBeenCalled();
  });

  it("removes stale titles and counts after permission revocation", () => {
    const row = {
      organizationId: "55555555-5555-4555-8555-555555555555",
      taskType: "finding_triage",
      sourceId: "11111111-1111-4111-8111-111111111111",
      title: "Private finding title",
      sourceUrl: "/findings?findingId=11111111-1111-4111-8111-111111111111",
      dueAt: null,
      state: "open",
      sourceRevision: "v2",
      routeVersion: 1,
      accountableOwnerUserId: null,
      effectiveAssigneeUserId: null,
      actingUserId: null,
      groupId: null,
      delegatedToUserId: null,
      delegationExpiresAt: null,
      unresolvedAssignment: false,
      canAssign: true,
      canClaim: false,
      canDelegate: false,
    };
    setup([row]);
    queries.useTaskDetailQuery.mockReturnValue({
      data: { task: row },
      isLoading: false,
      isError: false,
    });
    const view = render(<TaskInbox />);
    const trigger = screen.getByRole("button", {
      name: /manage assignment for private finding/i,
    });
    fireEvent.click(trigger);
    expect(
      screen.getByRole("region", { name: "Task assignment" }),
    ).toBeInTheDocument();
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Assignment" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(document.activeElement).toBe(trigger);

    queries.useTaskListQuery.mockReturnValue({
      data: {
        rows: [row],
        nextCursor: null,
        counts: { mine: 1, group: 0, available: 0 },
      },
      isLoading: false,
      isError: true,
      error: new ApiClientError("api", "Forbidden", 403),
      refetch: vi.fn(),
    });
    view.rerender(<TaskInbox />);
    expect(screen.queryByText("Private finding title")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "My tasks" })).toHaveTextContent(
      "—",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "no longer have access",
    );
  });

  it("shows an offline retry without losing filter draft", () => {
    setup();
    const refetch = vi.fn();
    queries.useTaskListQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiClientError("network", "Offline"),
      refetch,
    });
    render(<TaskInbox />);
    fireEvent.change(screen.getByLabelText("Accountable owner"), {
      target: { value: "11111111-1111-4111-8111-111111111111" },
    });
    expect(screen.getByLabelText("Accountable owner")).toHaveValue(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("offline");
    fireEvent.click(screen.getByRole("button", { name: "Retry tasks" }));
    expect(refetch).toHaveBeenCalled();
    expect(screen.getByLabelText("Accountable owner")).toHaveValue(
      "11111111-1111-4111-8111-111111111111",
    );
  });

  it("validates filters, supports all authorized work, and keeps pagination bounded", () => {
    setup();
    queries.useTaskListQuery.mockReturnValue({
      data: {
        rows: [],
        nextCursor: "opaque-page",
        counts: { mine: 0, group: 0, available: 0 },
      },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    render(<TaskInbox />);
    fireEvent.click(screen.getByRole("button", { name: "All authorized" }));
    expect(queries.useTaskListQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ scope: "all" }),
      true,
    );
    fireEvent.change(screen.getByLabelText("Task type"), {
      target: { value: "supplier_request" },
    });
    fireEvent.change(screen.getByLabelText("State"), {
      target: { value: "overdue" },
    });
    fireEvent.change(screen.getByLabelText("Accountable owner"), {
      target: { value: "11111111-1111-4111-8111-111111111111" },
    });
    fireEvent.change(screen.getByLabelText("Due from"), {
      target: { value: "2027-02-01" },
    });
    fireEvent.change(screen.getByLabelText("Due through"), {
      target: { value: "2027-01-01" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("due-date range");
    fireEvent.change(screen.getByLabelText("Due through"), {
      target: { value: "2027-03-01" },
    });
    expect(queries.useTaskListQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scope: "all",
        taskType: "supplier_request",
        state: "overdue",
        dueFrom: expect.stringMatching(/Z$/),
        dueTo: expect.stringMatching(/Z$/),
      }),
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByLabelText("Task type")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Routing settings" }));
    expect(
      screen.getByRole("button", { name: "Routing settings" }),
    ).toHaveAttribute("aria-expanded", "true");
  });
});
