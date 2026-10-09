import {
  assignTaskInputSchema,
  claimTaskInputSchema,
  createTaskAbsenceInputSchema,
  createTaskGroupInputSchema,
  delegateTaskInputSchema,
  deleteTaskAbsenceInputSchema,
  releaseTaskInputSchema,
  removeTaskGroupMemberInputSchema,
  revokeTaskDelegationInputSchema,
  taskAbsenceMutationResponseSchema,
  taskAbsenceParamsSchema,
  taskAbsencesResponseSchema,
  taskDetailResponseSchema,
  taskEligibleAssigneesResponseSchema,
  taskGroupDetailResponseSchema,
  taskGroupMemberInputSchema,
  taskGroupMemberParamsSchema,
  taskGroupMutationResponseSchema,
  taskGroupParamsSchema,
  taskGroupsResponseSchema,
  taskListQuerySchema,
  taskListResponseSchema,
  taskMemberCandidatesResponseSchema,
  taskMutationResponseSchema,
  taskParamsSchema,
  updateTaskGroupInputSchema,
} from "@repo/contracts/tasks/schemas";
import type {
  AssignTaskInput,
  ClaimTaskInput,
  CreateTaskAbsenceInput,
  CreateTaskGroupInput,
  DelegateTaskInput,
  DeleteTaskAbsenceInput,
  ReleaseTaskInput,
  RemoveTaskGroupMemberInput,
  RevokeTaskDelegationInput,
  TaskGroupMemberInput,
  TaskListQuery,
  TaskType,
  UpdateTaskGroupInput,
} from "@repo/contracts/tasks/types";

import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";
import { apiClient } from "../../_lib/http/api-client";

function taskPath(taskType: TaskType, sourceId: string): `/${string}` {
  const params = apiClient.parseInput(taskParamsSchema, { taskType, sourceId });
  return `/api/v1/tasks/${params.taskType}/${params.sourceId}`;
}

function groupPath(groupId: string): `/${string}` {
  const params = apiClient.parseInput(taskGroupParamsSchema, { groupId });
  return `/api/v1/task-groups/${params.groupId}`;
}

function absencePath(absenceId: string): `/${string}` {
  const params = apiClient.parseInput(taskAbsenceParamsSchema, { absenceId });
  return `/api/v1/task-absences/${params.absenceId}`;
}

/** Browser gateway for source-linked tasks. Every wire body and response is parsed. */
export class TasksApi {
  list(query: Partial<TaskListQuery> = {}, signal?: AbortSignal) {
    const parsed = apiClient.parseInput(taskListQuerySchema, query);
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(parsed)) {
      if (value !== undefined) search.set(key, String(value));
    }
    return authenticatedRequestJson({
      path: `/api/v1/tasks?${search}`,
      schema: taskListResponseSchema,
      signal,
    });
  }

  detail(taskType: TaskType, sourceId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: taskPath(taskType, sourceId),
      schema: taskDetailResponseSchema,
      signal,
    });
  }

  eligible(taskType: TaskType, sourceId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: `${taskPath(taskType, sourceId)}/eligible-assignees`,
      schema: taskEligibleAssigneesResponseSchema,
      signal,
    });
  }

  assign(taskType: TaskType, sourceId: string, input: AssignTaskInput) {
    return authenticatedRequestJson({
      path: `${taskPath(taskType, sourceId)}/assign`,
      method: "POST",
      body: input,
      inputSchema: assignTaskInputSchema,
      schema: taskMutationResponseSchema,
    });
  }

  claim(taskType: TaskType, sourceId: string, input: ClaimTaskInput) {
    return authenticatedRequestJson({
      path: `${taskPath(taskType, sourceId)}/claim`,
      method: "POST",
      body: input,
      inputSchema: claimTaskInputSchema,
      schema: taskMutationResponseSchema,
    });
  }

  release(taskType: TaskType, sourceId: string, input: ReleaseTaskInput) {
    return authenticatedRequestJson({
      path: `${taskPath(taskType, sourceId)}/release`,
      method: "POST",
      body: input,
      inputSchema: releaseTaskInputSchema,
      schema: taskMutationResponseSchema,
    });
  }

  delegate(taskType: TaskType, sourceId: string, input: DelegateTaskInput) {
    return authenticatedRequestJson({
      path: `${taskPath(taskType, sourceId)}/delegate`,
      method: "POST",
      body: input,
      inputSchema: delegateTaskInputSchema,
      schema: taskMutationResponseSchema,
    });
  }

  revokeDelegation(
    taskType: TaskType,
    sourceId: string,
    input: RevokeTaskDelegationInput,
  ) {
    return authenticatedRequestJson({
      path: `${taskPath(taskType, sourceId)}/revoke-delegation`,
      method: "POST",
      body: input,
      inputSchema: revokeTaskDelegationInputSchema,
      schema: taskMutationResponseSchema,
    });
  }

  groups(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/task-groups",
      schema: taskGroupsResponseSchema,
      signal,
    });
  }

  group(groupId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: groupPath(groupId),
      schema: taskGroupDetailResponseSchema,
      signal,
    });
  }

  createGroup(input: CreateTaskGroupInput) {
    return authenticatedRequestJson({
      path: "/api/v1/task-groups",
      method: "POST",
      body: input,
      inputSchema: createTaskGroupInputSchema,
      schema: taskGroupMutationResponseSchema,
    });
  }

  updateGroup(groupId: string, input: UpdateTaskGroupInput) {
    return authenticatedRequestJson({
      path: groupPath(groupId),
      method: "PATCH",
      body: input,
      inputSchema: updateTaskGroupInputSchema,
      schema: taskGroupMutationResponseSchema,
    });
  }

  addGroupMember(groupId: string, input: TaskGroupMemberInput) {
    return authenticatedRequestJson({
      path: `${groupPath(groupId)}/members`,
      method: "POST",
      body: input,
      inputSchema: taskGroupMemberInputSchema,
      schema: taskGroupMutationResponseSchema,
    });
  }

  removeGroupMember(
    groupId: string,
    userId: string,
    input: RemoveTaskGroupMemberInput,
  ) {
    const params = apiClient.parseInput(taskGroupMemberParamsSchema, {
      groupId,
      userId,
    });
    return authenticatedRequestJson({
      path: `/api/v1/task-groups/${params.groupId}/members/${params.userId}`,
      method: "DELETE",
      body: input,
      inputSchema: removeTaskGroupMemberInputSchema,
      schema: taskGroupMutationResponseSchema,
    });
  }

  absences(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/task-absences",
      schema: taskAbsencesResponseSchema,
      signal,
    });
  }

  memberCandidates(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/task-absences/member-candidates",
      schema: taskMemberCandidatesResponseSchema,
      signal,
    });
  }

  createAbsence(input: CreateTaskAbsenceInput) {
    return authenticatedRequestJson({
      path: "/api/v1/task-absences",
      method: "POST",
      body: input,
      inputSchema: createTaskAbsenceInputSchema,
      schema: taskAbsenceMutationResponseSchema,
    });
  }

  deleteAbsence(absenceId: string, input: DeleteTaskAbsenceInput) {
    return authenticatedRequestJson({
      path: absencePath(absenceId),
      method: "DELETE",
      body: input,
      inputSchema: deleteTaskAbsenceInputSchema,
      schema: taskAbsenceMutationResponseSchema,
    });
  }
}

export const tasksApi = Object.freeze(new TasksApi());
