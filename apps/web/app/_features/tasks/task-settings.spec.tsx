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
import { TaskSettings } from "./task-settings";

const memberId = "22222222-2222-4222-8222-222222222222";
const substituteId = "33333333-3333-4333-8333-333333333333";
const groupId = "44444444-4444-4444-8444-444444444444";
const absence = {
  id: "66666666-6666-4666-8666-666666666666",
  userId: memberId,
  substituteUserId: substituteId,
  startsAt: "2027-01-01T10:00:00.000Z",
  endsAt: "2027-01-02T10:00:00.000Z",
  version: 2,
};
const api = vi.hoisted(() => ({
  createGroup: vi.fn(),
  createAbsence: vi.fn(),
  addGroupMember: vi.fn(),
  updateGroup: vi.fn(),
  removeGroupMember: vi.fn(),
  deleteAbsence: vi.fn(),
}));
const queries = vi.hoisted(() => ({
  useTaskGroupsQuery: vi.fn(),
  useTaskGroupQuery: vi.fn(),
  useTaskAbsencesQuery: vi.fn(),
  useTaskMemberCandidatesQuery: vi.fn(),
  useTaskCommand: vi.fn(),
}));
vi.mock("./tasks.api", () => ({ tasksApi: api }));
vi.mock("./tasks.queries", () => queries);
vi.mock("../../_providers/session-provider", () => ({
  useSession: () => ({
    role: "owner",
    session: {
      organization: { id: "55555555-5555-4555-8555-555555555555" },
      user: { id: memberId },
    },
  }),
}));

function setup() {
  queries.useTaskGroupsQuery.mockReturnValue({
    data: {
      groups: [{ id: groupId, name: "Reviewers", version: 2, memberCount: 0 }],
    },
    isLoading: false,
    isError: false,
  });
  queries.useTaskGroupQuery.mockReturnValue({
    data: {
      group: { id: groupId, name: "Reviewers", version: 2, memberCount: 0 },
      members: [],
    },
    isLoading: false,
    isError: false,
  });
  queries.useTaskAbsencesQuery.mockReturnValue({
    data: { absences: [] },
    isLoading: false,
    isError: false,
  });
  queries.useTaskMemberCandidatesQuery.mockReturnValue({
    data: {
      users: [
        { id: memberId, displayName: "Owner" },
        { id: substituteId, displayName: "Substitute" },
      ],
    },
    isLoading: false,
    isError: false,
  });
  queries.useTaskCommand.mockReturnValue({
    pending: false,
    run: (command: () => Promise<unknown>) => command(),
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TaskSettings", () => {
  it("uses active member choices and retains group draft after an offline failure", async () => {
    setup();
    api.createGroup.mockRejectedValue(new ApiClientError("network", "Offline"));
    render(<TaskSettings active />);
    fireEvent.change(screen.getByLabelText("New group name"), {
      target: { value: "Assessors" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create group" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Connection lost"),
    );
    expect(screen.getByLabelText("New group name")).toHaveValue("Assessors");
    expect(api.createGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Assessors",
        idempotencyKey: expect.any(String),
      }),
    );
    expect(screen.getByLabelText("Substitute member")).toHaveTextContent(
      "Substitute",
    );
    expect(screen.getByLabelText("Substitute member")).not.toHaveTextContent(
      "Owner",
    );
  });

  it("submits an out-of-office interval as UTC with a selected member", async () => {
    setup();
    api.createAbsence.mockResolvedValue({ absence: null });
    render(<TaskSettings active />);
    fireEvent.change(screen.getByLabelText("Substitute member"), {
      target: { value: substituteId },
    });
    fireEvent.change(screen.getByLabelText("Starts at"), {
      target: { value: "2027-01-01T10:00" },
    });
    fireEvent.change(screen.getByLabelText("Ends at"), {
      target: { value: "2027-01-02T10:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Schedule absence" }));
    await waitFor(() =>
      expect(api.createAbsence).toHaveBeenCalledWith(
        expect.objectContaining({
          substituteUserId: substituteId,
          startsAt: expect.stringMatching(/Z$/),
          endsAt: expect.stringMatching(/Z$/),
          idempotencyKey: expect.any(String),
        }),
      ),
    );
  });

  it("retries a committed-but-timed-out rename with the original version and key", async () => {
    setup();
    api.updateGroup
      .mockRejectedValueOnce(new ApiClientError("network", "Timeout"))
      .mockResolvedValue({
        group: { id: groupId, name: "Assessors", version: 3, memberCount: 0 },
      });
    const view = render(<TaskSettings active />);
    fireEvent.change(screen.getByLabelText("Group"), {
      target: { value: groupId },
    });
    fireEvent.change(screen.getByLabelText("Rename group"), {
      target: { value: "Assessors" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Retry last action" }),
      ).toBeInTheDocument(),
    );
    const original = api.updateGroup.mock.calls[0];
    queries.useTaskGroupQuery.mockReturnValue({
      data: {
        group: { id: groupId, name: "Assessors", version: 3, memberCount: 0 },
        members: [],
      },
      isLoading: false,
      isError: false,
    });
    view.rerender(<TaskSettings active />);
    fireEvent.click(screen.getByRole("button", { name: "Retry last action" }));
    await waitFor(() => expect(api.updateGroup).toHaveBeenCalledTimes(2));
    expect(api.updateGroup.mock.calls[1]).toEqual(original);
    expect(screen.getByLabelText("Rename group")).toHaveValue("Assessors");
  });

  it("retries member add with its original version after an ambiguous timeout", async () => {
    setup();
    api.addGroupMember
      .mockRejectedValueOnce(new ApiClientError("network", "Timeout"))
      .mockResolvedValue({
        group: { id: groupId, name: "Reviewers", version: 3, memberCount: 1 },
      });
    const view = render(<TaskSettings active />);
    fireEvent.change(screen.getByLabelText("Group"), {
      target: { value: groupId },
    });
    fireEvent.change(screen.getByLabelText("Add eligible member"), {
      target: { value: substituteId },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add member" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Retry last action" }),
      ).toBeInTheDocument(),
    );
    const original = api.addGroupMember.mock.calls[0];
    queries.useTaskGroupQuery.mockReturnValue({
      data: {
        group: { id: groupId, name: "Reviewers", version: 3, memberCount: 1 },
        members: [{ id: substituteId, displayName: "Substitute" }],
      },
      isLoading: false,
      isError: false,
    });
    view.rerender(<TaskSettings active />);
    fireEvent.click(screen.getByRole("button", { name: "Retry last action" }));
    await waitFor(() => expect(api.addGroupMember).toHaveBeenCalledTimes(2));
    expect(api.addGroupMember.mock.calls[1]).toEqual(original);
  });

  it("removes a group member and an absence with optimistic versions", async () => {
    setup();
    queries.useTaskGroupQuery.mockReturnValue({
      data: {
        group: { id: groupId, name: "Reviewers", version: 4, memberCount: 1 },
        members: [{ id: substituteId, displayName: "Substitute" }],
      },
      isLoading: false,
      isError: false,
    });
    queries.useTaskAbsencesQuery.mockReturnValue({
      data: { absences: [absence] },
      isLoading: false,
      isError: false,
    });
    api.removeGroupMember.mockResolvedValue({ group: {} });
    api.deleteAbsence.mockResolvedValue({ absence: null });
    render(<TaskSettings active />);
    expect(screen.getByText("Substitute: Substitute")).toBeInTheDocument();
    expect(screen.queryByText(substituteId)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Group"), {
      target: { value: groupId },
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(api.removeGroupMember).toHaveBeenCalledWith(
        groupId,
        substituteId,
        expect.objectContaining({
          expectedVersion: 4,
          idempotencyKey: expect.any(String),
        }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove absence" }));
    await waitFor(() =>
      expect(api.deleteAbsence).toHaveBeenCalledWith(
        absence.id,
        expect.objectContaining({ expectedVersion: 2 }),
      ),
    );
  });

  it("hides stale substitute names and identifiers when member lookup fails", () => {
    setup();
    queries.useTaskAbsencesQuery.mockReturnValue({
      data: { absences: [absence] },
      isLoading: false,
      isError: false,
    });
    queries.useTaskMemberCandidatesQuery.mockReturnValue({
      data: { users: [{ id: substituteId, displayName: "Stale member" }] },
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    });
    render(<TaskSettings active />);
    expect(screen.getByText("Substitute name unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Stale member")).not.toBeInTheDocument();
    expect(screen.queryByText(substituteId)).not.toBeInTheDocument();
  });

  it("hides stale group/member data on forbidden reads and exposes retry controls", () => {
    setup();
    const retryGroups = vi.fn();
    const retryMembers = vi.fn();
    const retryAbsences = vi.fn();
    queries.useTaskGroupsQuery.mockReturnValue({
      data: {
        groups: [
          { id: groupId, name: "Stale group", version: 2, memberCount: 0 },
        ],
      },
      isError: true,
      isLoading: false,
      refetch: retryGroups,
    });
    queries.useTaskMemberCandidatesQuery.mockReturnValue({
      data: { users: [{ id: substituteId, displayName: "Stale member" }] },
      isError: true,
      isLoading: false,
      refetch: retryMembers,
    });
    queries.useTaskAbsencesQuery.mockReturnValue({
      data: { absences: [] },
      isError: true,
      isLoading: false,
      refetch: retryAbsences,
    });
    render(<TaskSettings active />);
    expect(screen.queryByText("Stale group")).not.toBeInTheDocument();
    expect(screen.queryByText("Stale member")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry groups" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry members" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry absences" }));
    expect(retryGroups).toHaveBeenCalled();
    expect(retryMembers).toHaveBeenCalled();
    expect(retryAbsences).toHaveBeenCalled();
  });
});
