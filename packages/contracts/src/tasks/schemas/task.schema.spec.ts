import { describe, expect, it } from "vitest";

import {
  assignTaskInputSchema,
  createTaskGroupInputSchema,
  deleteTaskAbsenceInputSchema,
  createTaskAbsenceInputSchema,
  delegateTaskInputSchema,
  removeTaskGroupMemberInputSchema,
  taskErrorResponseSchema,
  taskGroupSchema,
  taskMemberCandidatesResponseSchema,
  taskListQuerySchema,
  taskRowSchema,
  taskTypeSchema,
} from "./task.schema.js";

const id = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
const command = {
  expectedRouteVersion: 0,
  expectedSourceRevision: "7",
  idempotencyKey: otherId,
};

describe("source-linked task contracts", () => {
  it("accepts only the five owned source types", () => {
    expect(taskTypeSchema.options).toEqual([
      "finding_triage",
      "finding_approval",
      "report_approval",
      "evidence_expiry",
      "supplier_request",
    ]);
    expect(taskTypeSchema.safeParse("generic_job").success).toBe(false);
  });

  it("bounds pagination and rejects unknown or malformed filters", () => {
    expect(taskListQuerySchema.parse({}).limit).toBe(50);
    expect(taskListQuerySchema.parse({ limit: "100" }).limit).toBe(100);
    expect(taskListQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(
      taskListQuerySchema.safeParse({ scope: "mine", foo: "bar" }).success,
    ).toBe(false);
    expect(
      taskListQuerySchema.safeParse({ dueFrom: "2026-10-02T00:00:00+05:30" })
        .success,
    ).toBe(false);
    expect(
      taskListQuerySchema.safeParse({
        dueFrom: "2026-10-03T00:00:00Z",
        dueTo: "2026-10-02T00:00:00Z",
      }).success,
    ).toBe(false);
  });

  it("requires optimistic revisions and rejects ambiguous assignment", () => {
    expect(
      assignTaskInputSchema.safeParse({
        assigneeUserId: id,
        groupId: null,
        ...command,
      }).success,
    ).toBe(true);
    expect(
      assignTaskInputSchema.safeParse({
        assigneeUserId: id,
        groupId: otherId,
        ...command,
      }).success,
    ).toBe(false);
    expect(
      assignTaskInputSchema.safeParse({
        assigneeUserId: id,
        groupId: null,
        idempotencyKey: otherId,
      }).success,
    ).toBe(false);
    expect(
      delegateTaskInputSchema.safeParse({
        substituteUserId: id,
        expiresAt: "2026-11-01T00:00:00Z",
        ...command,
      }).success,
    ).toBe(true);
    expect(
      removeTaskGroupMemberInputSchema.safeParse({
        expectedVersion: 2,
        idempotencyKey: otherId,
      }).success,
    ).toBe(true);
    expect(
      removeTaskGroupMemberInputSchema.safeParse({
        userId: id,
        expectedVersion: 2,
        idempotencyKey: otherId,
      }).success,
    ).toBe(false);
  });

  it("accepts UTC half-open absence intervals only", () => {
    const absence = {
      substituteUserId: id,
      idempotencyKey: otherId,
      startsAt: "2026-10-01T00:00:00Z",
      endsAt: "2026-10-02T00:00:00Z",
    };
    expect(createTaskAbsenceInputSchema.safeParse(absence).success).toBe(true);
    expect(
      createTaskAbsenceInputSchema.safeParse({
        ...absence,
        endsAt: absence.startsAt,
      }).success,
    ).toBe(false);
    expect(
      createTaskAbsenceInputSchema.safeParse({
        ...absence,
        startsAt: "2026-10-01T05:30:00+05:30",
      }).success,
    ).toBe(false);
    expect(
      createTaskAbsenceInputSchema.safeParse({
        ...absence,
        endsAt: "2027-10-02T00:00:00Z",
      }).success,
    ).toBe(false);
  });

  it("uses the database's 100-character workflow group name limit", () => {
    expect(
      createTaskGroupInputSchema.safeParse({
        name: "a".repeat(100),
        idempotencyKey: otherId,
      }).success,
    ).toBe(true);
    expect(
      createTaskGroupInputSchema.safeParse({
        name: "a".repeat(101),
        idempotencyKey: otherId,
      }).success,
    ).toBe(false);
  });

  it("requires persisted group and absence revisions to be positive", () => {
    expect(
      taskGroupSchema.safeParse({
        id,
        name: "Reviewers",
        version: 0,
        memberCount: 0,
      }).success,
    ).toBe(false);
    expect(
      removeTaskGroupMemberInputSchema.safeParse({
        expectedVersion: 0,
        idempotencyKey: otherId,
      }).success,
    ).toBe(false);
    expect(
      deleteTaskAbsenceInputSchema.safeParse({
        expectedVersion: 0,
        idempotencyKey: otherId,
      }).success,
    ).toBe(false);
  });

  it("parses the standard task error body without leaking provider details", () => {
    expect(
      taskErrorResponseSchema.safeParse({
        statusCode: 409,
        message: "The task changed. Refresh and retry.",
        code: "conflict",
      }).success,
    ).toBe(true);
  });

  it("bounds and validates active member candidate labels", () => {
    expect(
      taskMemberCandidatesResponseSchema.safeParse({
        users: [{ id, displayName: "Owner" }],
      }).success,
    ).toBe(true);
    expect(
      taskMemberCandidatesResponseSchema.safeParse({
        users: [{ id, displayName: "" }],
      }).success,
    ).toBe(false);
    expect(
      taskMemberCandidatesResponseSchema.safeParse({ users: [], hidden: id })
        .success,
    ).toBe(false);
  });

  it("never exposes a missing source title or link", () => {
    const row = {
      organizationId: id,
      taskType: "finding_triage",
      sourceId: otherId,
      title: "Review finding",
      sourceUrl: "/findings?findingId=" + otherId,
      dueAt: null,
      state: "open",
      sourceRevision: "5",
      routeVersion: 0,
      accountableOwnerUserId: id,
      effectiveAssigneeUserId: id,
      actingUserId: null,
      groupId: null,
      delegatedToUserId: null,
      delegationExpiresAt: null,
      unresolvedAssignment: false,
      canAssign: true,
      canClaim: false,
      canDelegate: true,
    };
    expect(taskRowSchema.safeParse(row).success).toBe(true);
    expect(
      taskRowSchema.safeParse({ ...row, sourceUrl: "https://evil.example/" })
        .success,
    ).toBe(false);
    expect(
      taskRowSchema.safeParse({
        ...row,
        state: "unavailable",
        title: "Stale title",
      }).success,
    ).toBe(false);
    expect(
      taskRowSchema.safeParse({
        ...row,
        state: "unavailable",
        title: null,
        sourceUrl: null,
        sourceRevision: null,
      }).success,
    ).toBe(true);
    expect(
      taskRowSchema.safeParse({
        ...row,
        state: "unavailable",
        title: null,
        sourceUrl: null,
        sourceRevision: null,
        dueAt: "2026-10-02T00:00:00Z",
      }).success,
    ).toBe(false);
    expect(
      taskRowSchema.safeParse({ ...row, delegatedToUserId: otherId }).success,
    ).toBe(false);
    expect(taskRowSchema.safeParse({ ...row, title: null }).success).toBe(
      false,
    );
  });
});
