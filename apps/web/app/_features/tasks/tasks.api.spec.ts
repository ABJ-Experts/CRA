import { afterEach, describe, expect, it, vi } from "vitest";

import { tasksApi } from "./tasks.api";

const sourceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const groupId = "33333333-3333-4333-8333-333333333333";
const absenceId = "44444444-4444-4444-8444-444444444444";
const idempotencyKey = "55555555-5555-4555-8555-555555555555";
const task = {
  organizationId: "66666666-6666-4666-8666-666666666666",
  taskType: "finding_triage",
  sourceId,
  title: "Review finding",
  sourceUrl: `/findings?findingId=${sourceId}`,
  dueAt: null,
  state: "open",
  sourceRevision: "v1",
  routeVersion: 1,
  accountableOwnerUserId: userId,
  effectiveAssigneeUserId: userId,
  actingUserId: null,
  groupId: null,
  delegatedToUserId: null,
  delegationExpiresAt: null,
  unresolvedAssignment: false,
  canAssign: true,
  canClaim: true,
  canDelegate: true,
};
const group = { id: groupId, name: "Reviewers", version: 1, memberCount: 1 };
const absence = {
  id: absenceId,
  userId,
  substituteUserId: sourceId,
  startsAt: "2027-01-01T10:00:00.000Z",
  endsAt: "2027-01-02T10:00:00.000Z",
  version: 1,
};

describe("TasksApi", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("validates query and source identity before transport", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(() => tasksApi.list({ limit: 101 })).toThrow();
    expect(() => tasksApi.detail("finding_triage", "bad")).toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects unparsed source data and sends scoped route commands", async () => {
    const fetcher = vi.fn(async (url: string) => {
      expect(url).toContain("/api/v1/tasks");
      return new Response(
        JSON.stringify({
          rows: [{ title: "Unparsed" }],
          nextCursor: null,
          counts: { mine: 1, group: 0, available: 0 },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetcher);
    await expect(tasksApi.list({ scope: "mine" })).rejects.toThrow();
    expect(String(fetcher.mock.calls[0]?.[0])).toContain(
      "/api/v1/tasks?scope=mine",
    );
    await expect(
      tasksApi.claim("finding_triage", sourceId, {
        expectedRouteVersion: 0,
        expectedSourceRevision: "v1",
        idempotencyKey: "bad",
      }),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("parses task, group, and absence journeys through every scoped route", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const payload = url.includes("/member-candidates")
        ? { users: [{ id: userId, displayName: "Owner" }] }
        : url.includes("/task-absences")
          ? method === "GET"
            ? { absences: [absence] }
            : { absence: method === "DELETE" ? null : absence }
          : url.includes("/task-groups")
            ? method !== "GET"
              ? { group }
              : url.endsWith(groupId)
                ? { group, members: [] }
                : { groups: [group] }
            : url.includes("/eligible-assignees")
              ? {
                  users: [{ id: userId, displayName: "Owner" }],
                  groups: [{ id: groupId, name: "Reviewers" }],
                }
              : { task };
      return new Response(JSON.stringify(payload), { status: 200 });
    });
    vi.stubGlobal("fetch", fetcher);
    const command = {
      expectedRouteVersion: 1,
      expectedSourceRevision: "v1",
      idempotencyKey,
    };
    await expect(tasksApi.detail("finding_triage", sourceId)).resolves.toEqual({
      task,
    });
    await expect(
      tasksApi.eligible("finding_triage", sourceId),
    ).resolves.toHaveProperty("users");
    await tasksApi.assign("finding_triage", sourceId, {
      ...command,
      assigneeUserId: userId,
      groupId: null,
    });
    await tasksApi.claim("finding_triage", sourceId, command);
    await tasksApi.release("finding_triage", sourceId, command);
    await tasksApi.delegate("finding_triage", sourceId, {
      ...command,
      substituteUserId: userId,
      expiresAt: absence.endsAt,
    });
    await tasksApi.revokeDelegation("finding_triage", sourceId, command);
    await expect(tasksApi.groups()).resolves.toEqual({ groups: [group] });
    await expect(tasksApi.group(groupId)).resolves.toEqual({
      group,
      members: [],
    });
    await tasksApi.createGroup({ name: "Reviewers", idempotencyKey });
    await tasksApi.updateGroup(groupId, {
      name: "Reviewers",
      expectedVersion: 1,
      idempotencyKey,
    });
    await tasksApi.addGroupMember(groupId, {
      userId,
      expectedVersion: 1,
      idempotencyKey,
    });
    await tasksApi.removeGroupMember(groupId, userId, {
      expectedVersion: 1,
      idempotencyKey,
    });
    await expect(tasksApi.absences()).resolves.toEqual({ absences: [absence] });
    await expect(tasksApi.memberCandidates()).resolves.toHaveProperty("users");
    await tasksApi.createAbsence({
      substituteUserId: sourceId,
      startsAt: absence.startsAt,
      endsAt: absence.endsAt,
      idempotencyKey,
    });
    await tasksApi.deleteAbsence(absenceId, {
      expectedVersion: 1,
      idempotencyKey,
    });
    expect(fetcher.mock.calls).toHaveLength(17);
    expect(
      fetcher.mock.calls.find(([url]) =>
        String(url).endsWith(`/task-groups/${groupId}/members/${userId}`),
      )?.[1]?.method,
    ).toBe("DELETE");
  });
});
