import type { z } from "zod";
import type {
  taskAbsencesResponseSchema,
  taskAbsenceMutationResponseSchema,
  taskEligibleAssigneesResponseSchema,
  taskGroupDetailResponseSchema,
  taskGroupMutationResponseSchema,
  taskGroupsResponseSchema,
  taskListQuerySchema,
  taskListResponseSchema,
  taskMemberCandidatesResponseSchema,
  taskMutationResponseSchema,
  taskTypeSchema,
} from "@repo/contracts/tasks";

export const TASK_REPOSITORY = Symbol("TASK_REPOSITORY");

export type TaskType = z.output<typeof taskTypeSchema>;
export type TaskQuery = z.output<typeof taskListQuerySchema>;
export type TaskList = z.output<typeof taskListResponseSchema>;
export type TaskMutation = z.output<typeof taskMutationResponseSchema>;
export type TaskEligibleAssignees = z.output<
  typeof taskEligibleAssigneesResponseSchema
>;
export type TaskMemberCandidates = z.output<
  typeof taskMemberCandidatesResponseSchema
>;
export type TaskGroups = z.output<typeof taskGroupsResponseSchema>;
export type TaskGroupDetail = z.output<typeof taskGroupDetailResponseSchema>;
export type TaskGroupMutation = z.output<
  typeof taskGroupMutationResponseSchema
>;
export type TaskAbsences = z.output<typeof taskAbsencesResponseSchema>;
export type TaskAbsenceMutation = z.output<
  typeof taskAbsenceMutationResponseSchema
>;

export type TaskOutcome =
  | "found"
  | "updated"
  | "replayed"
  | "not_found"
  | "forbidden"
  | "conflict"
  | "invalid_request";

export type TaskResult<T> = Readonly<
  | { outcome: "found" | "updated" | "replayed"; data: T }
  | { outcome: "not_found" | "forbidden" | "conflict" | "invalid_request" }
>;

export interface TaskRouteCommand {
  action: "assign" | "claim" | "release" | "delegate" | "revoke_delegation";
  taskType: TaskType;
  sourceId: string;
  expectedRouteVersion: number;
  expectedSourceRevision: string;
  idempotencyKey: string;
  targetUserId?: string | null;
  groupId?: string | null;
  delegationExpiresAt?: string | null;
}

export interface TaskGroupCommand {
  action: "create" | "update" | "add_member" | "remove_member";
  groupId?: string | null;
  name?: string | null;
  memberUserId?: string | null;
  expectedVersion?: number | null;
  idempotencyKey: string;
}

export interface TaskAbsenceCommand {
  action: "create" | "delete";
  absenceId?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  substituteUserId?: string | null;
  expectedVersion?: number | null;
  idempotencyKey: string;
}

export interface TaskRepository {
  list(
    organizationId: string,
    actorId: string,
    query: TaskQuery,
  ): Promise<TaskResult<TaskList>>;
  get(
    organizationId: string,
    actorId: string,
    taskType: TaskType,
    sourceId: string,
  ): Promise<TaskResult<TaskMutation>>;
  eligibleAssignees(
    organizationId: string,
    actorId: string,
    taskType: TaskType,
    sourceId: string,
  ): Promise<TaskResult<TaskEligibleAssignees>>;
  memberCandidates(
    organizationId: string,
    actorId: string,
  ): Promise<TaskResult<TaskMemberCandidates>>;
  route(
    organizationId: string,
    actorId: string,
    command: TaskRouteCommand,
  ): Promise<TaskResult<TaskMutation>>;
  groups(
    organizationId: string,
    actorId: string,
  ): Promise<TaskResult<TaskGroups>>;
  group(
    organizationId: string,
    actorId: string,
    groupId: string,
  ): Promise<TaskResult<TaskGroupDetail>>;
  manageGroup(
    organizationId: string,
    actorId: string,
    command: TaskGroupCommand,
  ): Promise<TaskResult<TaskGroupMutation>>;
  absences(
    organizationId: string,
    actorId: string,
  ): Promise<TaskResult<TaskAbsences>>;
  manageAbsence(
    organizationId: string,
    actorId: string,
    command: TaskAbsenceCommand,
  ): Promise<TaskResult<TaskAbsenceMutation>>;
}
