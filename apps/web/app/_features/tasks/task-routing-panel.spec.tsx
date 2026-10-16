// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "../../_lib/http/api-client";
import { TaskRoutingPanel } from "./task-routing-panel";

const sourceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const substituteId = "33333333-3333-4333-8333-333333333333";
const groupId = "44444444-4444-4444-8444-444444444444";
const api = vi.hoisted(() => ({
  assign: vi.fn(),
  claim: vi.fn(),
  release: vi.fn(),
  delegate: vi.fn(),
  revokeDelegation: vi.fn(),
}));
const queries = vi.hoisted(() => ({
  useEligibleAssigneesQuery: vi.fn(),
  useTaskCommand: vi.fn(),
}));
vi.mock("./tasks.api", () => ({ tasksApi: api }));
vi.mock("./tasks.queries", () => queries);

const task = {
  organizationId: "55555555-5555-4555-8555-555555555555",
  taskType: "finding_triage" as const,
  sourceId,
  title: "Review finding",
  sourceUrl: `/findings?findingId=${sourceId}`,
  dueAt: null,
  state: "open" as const,
  sourceRevision: "source-4",
  routeVersion: 7,
  accountableOwnerUserId: userId,
  effectiveAssigneeUserId: userId,
  actingUserId: null,
  groupId,
  delegatedToUserId: null,
  delegationExpiresAt: null,
  unresolvedAssignment: false,
  canAssign: true,
  canClaim: true,
  canDelegate: true,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TaskRoutingPanel", () => {
  it("starts an individual assignment at its effective assignee, with owner fallback only when unresolved", () => {
    queries.useEligibleAssigneesQuery.mockReturnValue({
      data: {
        users: [
          { id: userId, displayName: "Accountable owner" },
          { id: substituteId, displayName: "Assigned reviewer" },
        ],
        groups: [],
      },
      isLoading: false,
      isError: false,
    });
    queries.useTaskCommand.mockReturnValue({
      pending: false,
      run: (command: () => Promise<unknown>) => command(),
    });
    const individual = {
      ...task,
      groupId: null,
      effectiveAssigneeUserId: substituteId,
    };
    const view = render(
      <TaskRoutingPanel
        task={individual}
        actorUserId={userId}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Assign to user or group")).toHaveValue(
      `user:${substituteId}`,
    );
    expect(
      screen.getByRole("button", { name: "Save assignment" }),
    ).toBeDisabled();
    view.rerender(
      <TaskRoutingPanel
        task={{ ...individual, unresolvedAssignment: true }}
        actorUserId={userId}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Assign to user or group")).toHaveValue(
      `user:${userId}`,
    );
  });

  it("claims group work with the source and route revisions", async () => {
    queries.useEligibleAssigneesQuery.mockReturnValue({
      data: { users: [], groups: [] },
      isLoading: false,
      isError: false,
    });
    queries.useTaskCommand.mockReturnValue({
      pending: false,
      run: (command: () => Promise<unknown>) => command(),
    });
    api.claim.mockResolvedValue({ task });
    render(
      <TaskRoutingPanel
        task={{ ...task, effectiveAssigneeUserId: null }}
        actorUserId={userId}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Claim task" }));
    await waitFor(() =>
      expect(api.claim).toHaveBeenCalledWith(
        "finding_triage",
        sourceId,
        expect.objectContaining({
          expectedRouteVersion: 7,
          expectedSourceRevision: "source-4",
          idempotencyKey: expect.any(String),
        }),
      ),
    );
    expect(screen.getByText("Task claimed.")).toBeInTheDocument();
  });

  it("retains delegation draft after an optimistic conflict", async () => {
    queries.useEligibleAssigneesQuery.mockReturnValue({
      data: {
        users: [{ id: substituteId, displayName: "Substitute" }],
        groups: [],
      },
      isLoading: false,
      isError: false,
    });
    queries.useTaskCommand.mockReturnValue({
      pending: false,
      run: (command: () => Promise<unknown>) => command(),
    });
    api.delegate.mockRejectedValue(new ApiClientError("api", "Conflict", 409));
    render(
      <TaskRoutingPanel task={task} actorUserId={userId} onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("Substitute"), {
      target: { value: substituteId },
    });
    fireEvent.change(screen.getByLabelText("Expires at"), {
      target: { value: "2027-01-01T10:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delegate" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("task changed"),
    );
    expect(screen.getByLabelText("Substitute")).toHaveValue(substituteId);
    expect(screen.getByLabelText("Expires at")).toHaveValue("2027-01-01T10:00");
  });

  it("does not clear an untouched assignment and replays an ambiguous timeout with the original command", async () => {
    queries.useEligibleAssigneesQuery.mockReturnValue({
      data: {
        users: [{ id: substituteId, displayName: "Substitute" }],
        groups: [{ id: groupId, name: "Reviewers" }],
      },
      isLoading: false,
      isError: false,
    });
    queries.useTaskCommand.mockReturnValue({
      pending: false,
      run: (command: () => Promise<unknown>) => command(),
    });
    api.assign
      .mockRejectedValueOnce(new ApiClientError("network", "Timeout"))
      .mockResolvedValue({ task });
    const view = render(
      <TaskRoutingPanel task={task} actorUserId={userId} onClose={vi.fn()} />,
    );
    expect(screen.getByLabelText("Assign to user or group")).toHaveValue(
      `group:${groupId}`,
    );
    expect(
      screen.getByRole("button", { name: "Save assignment" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Assign to user or group"), {
      target: { value: `user:${substituteId}` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save assignment" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Retry last action" }),
      ).toBeInTheDocument(),
    );
    const original = api.assign.mock.calls[0];
    view.rerender(
      <TaskRoutingPanel
        task={{ ...task, routeVersion: 8, sourceRevision: "v2" }}
        actorUserId={userId}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry last action" }));
    await waitFor(() => expect(api.assign).toHaveBeenCalledTimes(2));
    expect(api.assign.mock.calls[1]).toEqual(original);
    expect(screen.getByText("Assignment saved.")).toBeInTheDocument();
  });

  it("never offers release to an unresolved group fallback owner", () => {
    queries.useEligibleAssigneesQuery.mockReturnValue({
      data: { users: [], groups: [] },
      isLoading: false,
      isError: false,
    });
    queries.useTaskCommand.mockReturnValue({
      pending: false,
      run: (command: () => Promise<unknown>) => command(),
    });
    render(
      <TaskRoutingPanel
        task={{ ...task, unresolvedAssignment: true, canClaim: false }}
        actorUserId={userId}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/Assignment unresolved/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Release claim" }),
    ).not.toBeInTheDocument();
  });

  it("releases a genuine claim and revokes an active delegation", async () => {
    queries.useEligibleAssigneesQuery.mockReturnValue({
      data: { users: [], groups: [] },
      isLoading: false,
      isError: false,
    });
    queries.useTaskCommand.mockReturnValue({
      pending: false,
      run: (command: () => Promise<unknown>) => command(),
    });
    api.release.mockResolvedValue({ task });
    api.revokeDelegation.mockResolvedValue({ task });
    render(
      <TaskRoutingPanel
        task={{
          ...task,
          delegatedToUserId: substituteId,
          delegationExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          canDelegate: false,
        }}
        actorUserId={userId}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Release claim" }));
    await waitFor(() =>
      expect(api.release).toHaveBeenCalledWith(
        "finding_triage",
        sourceId,
        expect.objectContaining({ expectedRouteVersion: 7 }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Revoke delegation" }));
    await waitFor(() =>
      expect(api.revokeDelegation).toHaveBeenCalledWith(
        "finding_triage",
        sourceId,
        expect.objectContaining({ expectedSourceRevision: "source-4" }),
      ),
    );
    expect(
      screen.queryByRole("button", { name: "Delegate" }),
    ).not.toBeInTheDocument();
  });

  it("allows a new delegation after an earlier delegation has expired", () => {
    queries.useEligibleAssigneesQuery.mockReturnValue({
      data: {
        users: [{ id: substituteId, displayName: "Substitute" }],
        groups: [],
      },
      isLoading: false,
      isError: false,
    });
    queries.useTaskCommand.mockReturnValue({
      pending: false,
      run: (command: () => Promise<unknown>) => command(),
    });
    render(
      <TaskRoutingPanel
        task={{
          ...task,
          delegatedToUserId: substituteId,
          delegationExpiresAt: new Date(Date.now() - 86_400_000).toISOString(),
          unresolvedAssignment: true,
        }}
        actorUserId={userId}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Delegate" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Revoke delegation" }),
    ).not.toBeInTheDocument();
  });

  it("hides source actions when unavailable and offers assignee retry without stale names", () => {
    const refetch = vi.fn();
    queries.useEligibleAssigneesQuery.mockReturnValue({
      data: {
        users: [{ id: substituteId, displayName: "Stale member" }],
        groups: [],
      },
      isLoading: false,
      isError: true,
      refetch,
    });
    queries.useTaskCommand.mockReturnValue({
      pending: false,
      run: (command: () => Promise<unknown>) => command(),
    });
    const view = render(
      <TaskRoutingPanel task={task} actorUserId={userId} onClose={vi.fn()} />,
    );
    expect(screen.queryByText("Stale member")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry assignees" }));
    expect(refetch).toHaveBeenCalled();
    view.rerender(
      <TaskRoutingPanel
        task={{
          ...task,
          title: null,
          sourceUrl: null,
          sourceRevision: null,
          state: "unavailable",
          dueAt: null,
          canAssign: false,
          canClaim: false,
          canDelegate: false,
        }}
        actorUserId={userId}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/The source is unavailable/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save assignment" }),
    ).not.toBeInTheDocument();
  });
});
