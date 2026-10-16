import { Injectable } from "@nestjs/common";
import {
  taskAbsenceMutationResponseSchema,
  taskAbsencesResponseSchema,
  taskDetailResponseSchema,
  taskEligibleAssigneesResponseSchema,
  taskGroupDetailResponseSchema,
  taskGroupMutationResponseSchema,
  taskGroupsResponseSchema,
  taskListResponseSchema,
  taskMemberCandidatesResponseSchema,
  taskMutationResponseSchema,
} from "@repo/contracts/tasks";
import { SupabaseService } from "../../supabase/supabase.service";
import type {
  TaskAbsenceCommand,
  TaskGroupCommand,
  TaskQuery,
  TaskRepository,
  TaskResult,
  TaskRouteCommand,
  TaskType,
} from "../application/task.port";

type Rpc = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{
    data: unknown;
    error: { message?: string } | null;
  }>;
};
type Row = Record<string, unknown>;
type Schema<T> = { parse(value: unknown): T };

@Injectable()
export class SupabaseTaskRepository implements TaskRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async list(organizationId: string, actorId: string, query: TaskQuery) {
    const row = await this.rpc("m1201_list_tasks", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_scope: query.scope,
      p_type: query.taskType ?? null,
      p_state: query.state ?? null,
      p_owner_user_id: query.ownerUserId ?? null,
      p_due_from: query.dueFrom ?? null,
      p_due_to: query.dueTo ?? null,
      p_cursor: query.cursor ?? null,
      p_limit: query.limit,
    });
    return result(row, taskListResponseSchema, () => ({
      rows: row.tasks,
      nextCursor: row.next_cursor,
      counts: row.counts,
    }));
  }

  async get(
    organizationId: string,
    actorId: string,
    taskType: TaskType,
    sourceId: string,
  ) {
    const row = await this.rpc("m1201_get_task", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_task_type: taskType,
      p_source_id: sourceId,
    });
    return result(row, taskDetailResponseSchema, () => ({ task: row.task }));
  }

  async eligibleAssignees(
    organizationId: string,
    actorId: string,
    taskType: TaskType,
    sourceId: string,
  ) {
    const row = await this.rpc("m1201_eligible_assignees", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_task_type: taskType,
      p_source_id: sourceId,
    });
    return result(row, taskEligibleAssigneesResponseSchema, () => ({
      users: row.users,
      groups: row.groups,
    }));
  }

  async memberCandidates(organizationId: string, actorId: string) {
    const row = await this.rpc("m1201_member_candidates", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
    });
    return result(row, taskMemberCandidatesResponseSchema, () => ({
      users: row.users,
    }));
  }

  async route(
    organizationId: string,
    actorId: string,
    command: TaskRouteCommand,
  ) {
    const row = await this.rpc("m1201_route_task", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_task_type: command.taskType,
      p_source_id: command.sourceId,
      p_action: command.action,
      p_target_user_id: command.targetUserId ?? null,
      p_group_id: command.groupId ?? null,
      p_expected_route_version: command.expectedRouteVersion,
      p_expected_source_revision: command.expectedSourceRevision,
      p_idempotency_key: command.idempotencyKey,
      p_delegation_expires_at: command.delegationExpiresAt ?? null,
    });
    return result(row, taskMutationResponseSchema, () => ({ task: row.task }));
  }

  async groups(organizationId: string, actorId: string) {
    const row = await this.rpc("m1201_list_groups", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
    });
    return result(row, taskGroupsResponseSchema, () => ({
      groups: row.groups,
    }));
  }

  async group(organizationId: string, actorId: string, groupId: string) {
    const row = await this.rpc("m1201_get_group", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_group_id: groupId,
    });
    return result(row, taskGroupDetailResponseSchema, () => ({
      group: row.group,
      members: row.members,
    }));
  }

  async manageGroup(
    organizationId: string,
    actorId: string,
    command: TaskGroupCommand,
  ) {
    const row = await this.rpc("m1201_manage_group", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_action: command.action,
      p_group_id: command.groupId ?? null,
      p_name: command.name ?? null,
      p_member_user_id: command.memberUserId ?? null,
      p_expected_version: command.expectedVersion ?? null,
      p_idempotency_key: command.idempotencyKey,
    });
    return result(row, taskGroupMutationResponseSchema, () => ({
      group: row.group,
    }));
  }

  async absences(organizationId: string, actorId: string) {
    const row = await this.rpc("m1201_list_absences", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
    });
    return result(row, taskAbsencesResponseSchema, () => ({
      absences: row.absences,
    }));
  }

  async manageAbsence(
    organizationId: string,
    actorId: string,
    command: TaskAbsenceCommand,
  ) {
    const row = await this.rpc("m1201_manage_absence", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_action: command.action,
      p_absence_id: command.absenceId ?? null,
      p_starts_at: command.startsAt ?? null,
      p_ends_at: command.endsAt ?? null,
      p_substitute_user_id: command.substituteUserId ?? null,
      p_expected_version: command.expectedVersion ?? null,
      p_idempotency_key: command.idempotencyKey,
    });
    return result(row, taskAbsenceMutationResponseSchema, () => ({
      absence: row.absence,
    }));
  }

  private async rpc(name: string, args: Record<string, unknown>): Promise<Row> {
    const response = await (this.supabase.admin() as unknown as Rpc).rpc(
      name,
      args,
    );
    if (response.error) throw new Error("Task storage is unavailable");
    const data: unknown = response.data;
    if (Array.isArray(data) && data.length !== 1) {
      throw new Error("Task storage returned an invalid response");
    }
    const row: unknown = Array.isArray(data) ? (data as unknown[])[0] : data;
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("Task storage returned an invalid response");
    }
    return row as Row;
  }
}

function result<T>(
  row: Row,
  schema: Schema<T>,
  payload: () => unknown,
): TaskResult<T> {
  switch (row.outcome) {
    case "found":
    case "updated":
    case "replayed":
      return { outcome: row.outcome, data: schema.parse(payload()) };
    case "not_found":
    case "forbidden":
    case "conflict":
    case "invalid_request":
      return { outcome: row.outcome };
    default:
      throw new Error("Task storage returned an unknown outcome");
  }
}
