import type { z } from "zod";
import type {
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
  taskAbsenceSchema,
  taskAbsencesResponseSchema,
  taskDetailResponseSchema,
  taskEligibleAssigneesResponseSchema,
  taskErrorResponseSchema,
  taskGroupDetailResponseSchema,
  taskGroupMemberSchema,
  taskGroupMemberInputSchema,
  taskGroupMemberParamsSchema,
  taskGroupMutationResponseSchema,
  taskGroupParamsSchema,
  taskGroupSchema,
  taskGroupsResponseSchema,
  taskListQuerySchema,
  taskListResponseSchema,
  taskMemberCandidateSchema,
  taskMemberCandidatesResponseSchema,
  taskMutationResponseSchema,
  taskParamsSchema,
  taskRowSchema,
  taskScopeSchema,
  taskStateSchema,
  taskCursorSchema,
  taskTypeSchema,
  updateTaskGroupInputSchema,
} from "../schemas/index.js";

export type TaskType = z.output<typeof taskTypeSchema>;
export type TaskScope = z.output<typeof taskScopeSchema>;
export type TaskState = z.output<typeof taskStateSchema>;
export type TaskCursor = z.output<typeof taskCursorSchema>;
export type TaskRow = z.output<typeof taskRowSchema>;
export type TaskParams = z.output<typeof taskParamsSchema>;
export type TaskListQuery = z.output<typeof taskListQuerySchema>;
export type TaskListResponse = z.output<typeof taskListResponseSchema>;
export type TaskDetailResponse = z.output<typeof taskDetailResponseSchema>;
export type TaskMutationResponse = z.output<typeof taskMutationResponseSchema>;
export type TaskEligibleAssigneesResponse = z.output<
  typeof taskEligibleAssigneesResponseSchema
>;
export type TaskMemberCandidate = z.output<typeof taskMemberCandidateSchema>;
export type TaskMemberCandidatesResponse = z.output<
  typeof taskMemberCandidatesResponseSchema
>;
export type TaskErrorResponse = z.output<typeof taskErrorResponseSchema>;
export type AssignTaskInput = z.output<typeof assignTaskInputSchema>;
export type ClaimTaskInput = z.output<typeof claimTaskInputSchema>;
export type ReleaseTaskInput = z.output<typeof releaseTaskInputSchema>;
export type DelegateTaskInput = z.output<typeof delegateTaskInputSchema>;
export type RevokeTaskDelegationInput = z.output<
  typeof revokeTaskDelegationInputSchema
>;
export type TaskGroup = z.output<typeof taskGroupSchema>;
export type TaskGroupMember = z.output<typeof taskGroupMemberSchema>;
export type TaskGroupsResponse = z.output<typeof taskGroupsResponseSchema>;
export type TaskGroupDetailResponse = z.output<
  typeof taskGroupDetailResponseSchema
>;
export type TaskGroupMutationResponse = z.output<
  typeof taskGroupMutationResponseSchema
>;
export type TaskGroupParams = z.output<typeof taskGroupParamsSchema>;
export type TaskGroupMemberParams = z.output<
  typeof taskGroupMemberParamsSchema
>;
export type CreateTaskGroupInput = z.output<typeof createTaskGroupInputSchema>;
export type UpdateTaskGroupInput = z.output<typeof updateTaskGroupInputSchema>;
export type TaskGroupMemberInput = z.output<typeof taskGroupMemberInputSchema>;
export type RemoveTaskGroupMemberInput = z.output<
  typeof removeTaskGroupMemberInputSchema
>;
export type TaskAbsence = z.output<typeof taskAbsenceSchema>;
export type TaskAbsencesResponse = z.output<typeof taskAbsencesResponseSchema>;
export type TaskAbsenceMutationResponse = z.output<
  typeof taskAbsenceMutationResponseSchema
>;
export type TaskAbsenceParams = z.output<typeof taskAbsenceParamsSchema>;
export type CreateTaskAbsenceInput = z.output<
  typeof createTaskAbsenceInputSchema
>;
export type DeleteTaskAbsenceInput = z.output<
  typeof deleteTaskAbsenceInputSchema
>;
