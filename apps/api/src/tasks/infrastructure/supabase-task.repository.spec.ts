import { SupabaseTaskRepository } from "./supabase-task.repository";

const id = "11111111-1111-4111-8111-111111111111";
const actor = "22222222-2222-4222-8222-222222222222";
const sourceId = "33333333-3333-4333-8333-333333333333";
const key = "44444444-4444-4444-8444-444444444444";
const task = {
  organizationId: id,
  taskType: "finding_triage",
  sourceId,
  title: "Review finding",
  sourceUrl: `/findings?findingId=${sourceId}`,
  dueAt: null,
  state: "open",
  sourceRevision: "7",
  routeVersion: 1,
  accountableOwnerUserId: actor,
  effectiveAssigneeUserId: actor,
  actingUserId: actor,
  groupId: null,
  delegatedToUserId: null,
  delegationExpiresAt: null,
  unresolvedAssignment: false,
  canAssign: true,
  canClaim: false,
  canDelegate: true,
};

describe("SupabaseTaskRepository", () => {
  const rpc = jest.fn();
  const repository = new SupabaseTaskRepository({
    admin: () => ({ rpc }),
  } as never);

  beforeEach(() => rpc.mockReset());

  it("passes verified organization and actor to a source-scoped read", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          outcome: "found",
          tasks: [],
          next_cursor: null,
          counts: { mine: 0, group: 0, available: 0 },
        },
      ],
      error: null,
    });

    const result = await repository.list(id, actor, {
      scope: "mine",
      limit: 50,
    });

    expect(result).toEqual({
      outcome: "found",
      data: {
        rows: [],
        nextCursor: null,
        counts: { mine: 0, group: 0, available: 0 },
      },
    });
    expect(rpc).toHaveBeenCalledWith(
      "m1201_list_tasks",
      expect.objectContaining({
        p_organization_id: id,
        p_actor_user_id: actor,
        p_scope: "mine",
        p_limit: 50,
      }),
    );
  });

  it("rejects malformed database projections instead of returning unscoped data", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          outcome: "found",
          tasks: [{ title: "Leaked title" }],
          next_cursor: null,
          counts: {},
        },
      ],
      error: null,
    });
    await expect(
      repository.list(id, actor, { scope: "mine", limit: 50 }),
    ).rejects.toThrow();
  });

  it("does not turn a database outage into an empty inbox", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "database unavailable" },
    });
    await expect(
      repository.list(id, actor, { scope: "mine", limit: 50 }),
    ).rejects.toThrow();
  });

  it("rejects an unexpected multi-row RPC result", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          outcome: "found",
          tasks: [],
          next_cursor: null,
          counts: { mine: 0, group: 0, available: 0 },
        },
        {
          outcome: "found",
          tasks: [],
          next_cursor: null,
          counts: { mine: 0, group: 0, available: 0 },
        },
      ],
      error: null,
    });
    await expect(
      repository.list(id, actor, { scope: "mine", limit: 50 }),
    ).rejects.toThrow();
  });

  it("parses a live detail and safe eligible choices", async () => {
    rpc.mockResolvedValueOnce({
      data: [{ outcome: "found", task }],
      error: null,
    });
    expect(await repository.get(id, actor, "finding_triage", sourceId)).toEqual(
      {
        outcome: "found",
        data: { task },
      },
    );
    rpc.mockResolvedValueOnce({
      data: [{ outcome: "found", users: [], groups: [] }],
      error: null,
    });
    expect(
      await repository.eligibleAssignees(id, actor, "finding_triage", sourceId),
    ).toEqual({
      outcome: "found",
      data: { users: [], groups: [] },
    });
  });

  it("sends the exact optimistic and idempotent route command to SQL", async () => {
    rpc.mockResolvedValue({
      data: [{ outcome: "replayed", task }],
      error: null,
    });
    const result = await repository.route(id, actor, {
      action: "claim",
      taskType: "finding_triage",
      sourceId,
      expectedRouteVersion: 1,
      expectedSourceRevision: "7",
      idempotencyKey: key,
    });
    expect(result).toEqual({ outcome: "replayed", data: { task } });
    expect(rpc).toHaveBeenCalledWith(
      "m1201_route_task",
      expect.objectContaining({
        p_organization_id: id,
        p_actor_user_id: actor,
        p_source_id: sourceId,
        p_expected_route_version: 1,
        p_expected_source_revision: "7",
        p_idempotency_key: key,
      }),
    );
  });

  it("preserves SQL denial and rejects unknown outcomes", async () => {
    rpc.mockResolvedValueOnce({
      data: [{ outcome: "forbidden" }],
      error: null,
    });
    expect(await repository.get(id, actor, "finding_triage", sourceId)).toEqual(
      { outcome: "forbidden" },
    );
    rpc.mockResolvedValueOnce({
      data: [{ outcome: "unexpected" }],
      error: null,
    });
    await expect(
      repository.get(id, actor, "finding_triage", sourceId),
    ).rejects.toThrow();
  });

  it("parses groups and absence responses without trusting database JSON", async () => {
    const group = {
      id: sourceId,
      name: "Reviewers",
      version: 1,
      memberCount: 0,
    };
    rpc.mockResolvedValueOnce({
      data: [{ outcome: "found", groups: [group] }],
      error: null,
    });
    expect(await repository.groups(id, actor)).toEqual({
      outcome: "found",
      data: { groups: [group] },
    });
    rpc.mockResolvedValueOnce({
      data: [{ outcome: "found", group, members: [] }],
      error: null,
    });
    expect(await repository.group(id, actor, sourceId)).toEqual({
      outcome: "found",
      data: { group, members: [] },
    });
    rpc.mockResolvedValueOnce({
      data: [{ outcome: "updated", group }],
      error: null,
    });
    expect(
      await repository.manageGroup(id, actor, {
        action: "create",
        name: "Reviewers",
        idempotencyKey: key,
      }),
    ).toEqual({ outcome: "updated", data: { group } });
    rpc.mockResolvedValueOnce({
      data: [{ outcome: "found", absences: [] }],
      error: null,
    });
    expect(await repository.absences(id, actor)).toEqual({
      outcome: "found",
      data: { absences: [] },
    });
    rpc.mockResolvedValueOnce({
      data: [{ outcome: "updated", absence: null }],
      error: null,
    });
    expect(
      await repository.manageAbsence(id, actor, {
        action: "delete",
        absenceId: sourceId,
        expectedVersion: 1,
        idempotencyKey: key,
      }),
    ).toEqual({ outcome: "updated", data: { absence: null } });
  });

  it("fetches a bounded active-member picker from the scoped SQL function", async () => {
    rpc.mockResolvedValue({
      data: [{ outcome: "found", users: [] }],
      error: null,
    });
    expect(await repository.memberCandidates(id, actor)).toEqual({
      outcome: "found",
      data: { users: [] },
    });
    expect(rpc).toHaveBeenCalledWith("m1201_member_candidates", {
      p_organization_id: id,
      p_actor_user_id: actor,
    });
  });
});
