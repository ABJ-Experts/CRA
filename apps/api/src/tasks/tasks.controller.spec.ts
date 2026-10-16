import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { REQUIRE_ROLE_KEY, type RequestUser } from "../auth/auth.types";
import { TaskAbsencesController } from "./task-absences.controller";
import { TaskGroupsController } from "./task-groups.controller";
import { TaskUseCases } from "./application/task-use-cases";
import { TasksController, unwrap } from "./tasks.controller";

const organizationId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const sourceId = "33333333-3333-4333-8333-333333333333";
const idempotencyKey = "44444444-4444-4444-8444-444444444444";
const user = { id: actorId, organizationId, role: "member" } as RequestUser;
const params = { taskType: "finding_triage" as const, sourceId };
const base = {
  expectedRouteVersion: 4,
  expectedSourceRevision: "source-7",
  idempotencyKey,
};

describe("task controller", () => {
  const route = jest.fn();
  const list = jest.fn();
  const get = jest.fn();
  const eligibleAssignees = jest.fn();
  const controller = new TasksController({
    route,
    list,
    get,
    eligibleAssignees,
  } as never);

  beforeEach(() => {
    route
      .mockReset()
      .mockResolvedValue({ outcome: "updated", data: { task: {} } });
    list.mockReset().mockResolvedValue({
      outcome: "found",
      data: {
        rows: [],
        nextCursor: null,
        counts: { mine: 0, group: 0, available: 0 },
      },
    });
    get.mockReset().mockResolvedValue({ outcome: "not_found" });
    eligibleAssignees
      .mockReset()
      .mockResolvedValue({ outcome: "found", data: { users: [], groups: [] } });
  });

  it("scopes the list and eligible choices to the verified organization and actor", async () => {
    await controller.list({ scope: "mine", limit: 50 }, user);
    await controller.eligibleAssignees(params, user);
    expect(list).toHaveBeenCalledWith(organizationId, actorId, {
      scope: "mine",
      limit: 50,
    });
    expect(eligibleAssignees).toHaveBeenCalledWith(
      organizationId,
      actorId,
      "finding_triage",
      sourceId,
    );
  });

  it("routes assignment and delegation with revisions and never calls a source approval action", async () => {
    const assignee = "55555555-5555-4555-8555-555555555555";
    await controller.assign(
      params,
      { ...base, assigneeUserId: assignee, groupId: null },
      user,
    );
    await controller.delegate(
      params,
      {
        ...base,
        substituteUserId: assignee,
        expiresAt: "2026-10-02T00:00:00.000Z",
      },
      user,
    );
    expect(route).toHaveBeenNthCalledWith(
      1,
      organizationId,
      actorId,
      expect.objectContaining({
        action: "assign",
        taskType: "finding_triage",
        sourceId,
        targetUserId: assignee,
        expectedRouteVersion: 4,
        expectedSourceRevision: "source-7",
        idempotencyKey,
      }),
    );
    expect(route).toHaveBeenNthCalledWith(
      2,
      organizationId,
      actorId,
      expect.objectContaining({
        action: "delegate",
        targetUserId: assignee,
        delegationExpiresAt: "2026-10-02T00:00:00.000Z",
      }),
    );
  });

  it("routes group claim, release and revocation without a generic completion action", async () => {
    await controller.claim(params, base, user);
    await controller.release(params, base, user);
    await controller.revokeDelegation(params, base, user);
    const routeCalls = route.mock.calls as unknown as Array<
      [string, string, { action: string }]
    >;
    expect(routeCalls.map((call) => call[2].action)).toEqual([
      "claim",
      "release",
      "revoke_delegation",
    ]);
    await expect(controller.detail(params, user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("preserves conflict, forbidden, missing and outage semantics", async () => {
    await expect(
      unwrap(Promise.resolve({ outcome: "conflict" })),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      unwrap(Promise.resolve({ outcome: "forbidden" })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      unwrap(Promise.resolve({ outcome: "not_found" })),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      unwrap(Promise.resolve({ outcome: "invalid_request" })),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      unwrap(Promise.reject(new Error("database details"))),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("refuses a missing organization before querying storage", () => {
    expect(() =>
      controller.list(
        { scope: "mine", limit: 50 },
        { ...user, organizationId: null },
      ),
    ).toThrow(ForbiddenException);
    expect(list).not.toHaveBeenCalled();
  });
});

describe("task group and absence controllers", () => {
  const group = jest
    .fn()
    .mockResolvedValue({ outcome: "found", data: { group: {}, members: [] } });
  const groups = jest
    .fn()
    .mockResolvedValue({ outcome: "found", data: { groups: [] } });
  const manageGroup = jest
    .fn()
    .mockResolvedValue({ outcome: "updated", data: { group: {} } });
  const absences = jest
    .fn()
    .mockResolvedValue({ outcome: "found", data: { absences: [] } });
  const manageAbsence = jest
    .fn()
    .mockResolvedValue({ outcome: "updated", data: { absence: null } });
  const memberCandidates = jest
    .fn()
    .mockResolvedValue({ outcome: "found", data: { users: [] } });
  const groupController = new TaskGroupsController({
    group,
    groups,
    manageGroup,
  } as never);
  const absenceController = new TaskAbsencesController({
    absences,
    manageAbsence,
    memberCandidates,
  } as never);

  beforeEach(() => {
    group.mockClear();
    groups.mockClear();
    manageGroup.mockClear();
    absences.mockClear();
    manageAbsence.mockClear();
    memberCandidates.mockClear();
  });

  it("limits group membership details to administrators", () => {
    const detailMethod: unknown = Object.getOwnPropertyDescriptor(
      TaskGroupsController.prototype,
      "detail",
    )?.value;
    expect(typeof detailMethod).toBe("function");
    expect(Reflect.getMetadata(REQUIRE_ROLE_KEY, detailMethod as object)).toBe(
      "admin",
    );
  });

  it("keeps group management scoped to the current organization and user", async () => {
    await groupController.list(user);
    await groupController.detail({ groupId: sourceId }, user);
    await groupController.create({ name: "Reviewers", idempotencyKey }, user);
    await groupController.update(
      { groupId: sourceId },
      { name: "Review team", expectedVersion: 1, idempotencyKey },
      user,
    );
    await groupController.addMember(
      { groupId: sourceId },
      { userId: actorId, expectedVersion: 2, idempotencyKey },
      user,
    );
    await groupController.removeMember(
      { groupId: sourceId, userId: actorId },
      { expectedVersion: 3, idempotencyKey },
      user,
    );
    expect(groups).toHaveBeenCalledWith(organizationId, actorId);
    expect(group).toHaveBeenCalledWith(organizationId, actorId, sourceId);
    const groupCalls = manageGroup.mock.calls as unknown as Array<
      [string, string, { action: string; memberUserId?: string }]
    >;
    expect(groupCalls.map((call) => call[2].action)).toEqual([
      "create",
      "update",
      "add_member",
      "remove_member",
    ]);
    expect(groupCalls[3]?.[2].memberUserId).toBe(actorId);
  });

  it("keeps absence create and revoke scoped to the current actor", async () => {
    await absenceController.list(user);
    await absenceController.memberCandidates(user);
    await absenceController.create(
      {
        substituteUserId: sourceId,
        startsAt: "2026-10-01T00:00:00.000Z",
        endsAt: "2026-10-02T00:00:00.000Z",
        idempotencyKey,
      },
      user,
    );
    await absenceController.delete(
      { absenceId: sourceId },
      { expectedVersion: 1, idempotencyKey },
      user,
    );
    expect(absences).toHaveBeenCalledWith(organizationId, actorId);
    expect(memberCandidates).toHaveBeenCalledWith(organizationId, actorId);
    const absenceCalls = manageAbsence.mock.calls as unknown as Array<
      [string, string, { action: string; absenceId?: string }]
    >;
    expect(absenceCalls.map((call) => call[2].action)).toEqual([
      "create",
      "delete",
    ]);
    expect(absenceCalls[1]?.[2].absenceId).toBe(sourceId);
  });
});

describe("task application boundary", () => {
  it("passes all task operations through an organization-first repository port", async () => {
    const repository = Object.fromEntries(
      [
        "list",
        "get",
        "eligibleAssignees",
        "memberCandidates",
        "route",
        "groups",
        "group",
        "manageGroup",
        "absences",
        "manageAbsence",
      ].map((name) => [
        name,
        jest.fn().mockResolvedValue({ outcome: "found" }),
      ]),
    ) as Record<string, jest.Mock>;
    const tasks = new TaskUseCases(repository as never);
    await tasks.list(organizationId, actorId, { scope: "mine", limit: 50 });
    await tasks.get(organizationId, actorId, "finding_triage", sourceId);
    await tasks.eligibleAssignees(
      organizationId,
      actorId,
      "finding_triage",
      sourceId,
    );
    await tasks.memberCandidates(organizationId, actorId);
    await tasks.route(organizationId, actorId, {
      action: "claim",
      ...params,
      ...base,
    });
    await tasks.groups(organizationId, actorId);
    await tasks.group(organizationId, actorId, sourceId);
    await tasks.manageGroup(organizationId, actorId, {
      action: "create",
      name: "Reviewers",
      idempotencyKey,
    });
    await tasks.absences(organizationId, actorId);
    await tasks.manageAbsence(organizationId, actorId, {
      action: "delete",
      absenceId: sourceId,
      expectedVersion: 1,
      idempotencyKey,
    });
    for (const operation of Object.values(repository)) {
      const firstCall = (operation.mock.calls as unknown[][])[0] ?? [];
      expect(firstCall.slice(0, 2)).toEqual([organizationId, actorId]);
    }
  });
});
