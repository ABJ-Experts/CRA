"use client";

import type { TaskListQuery, TaskType } from "@repo/contracts/tasks/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { useSession } from "../../_providers/session-provider";
import { tasksApi } from "./tasks.api";

export function useTaskListQuery(
  query: Partial<TaskListQuery>,
  enabled = true,
) {
  const { session, permissions } = useSession();
  const orgId = session?.organization?.id;
  return useQuery({
    queryKey: ["tasks", orgId, session?.user?.id, permissions, "list", query],
    enabled: enabled && Boolean(orgId),
    retry: false,
    refetchOnWindowFocus: "always",
    refetchInterval: 30_000,
    queryFn: ({ signal }) => tasksApi.list(query, signal),
  });
}

export function useTaskDetailQuery(
  taskType: TaskType | null,
  sourceId: string | null,
) {
  const { session, permissions } = useSession();
  const orgId = session?.organization?.id;
  return useQuery({
    queryKey: [
      "tasks",
      orgId,
      session?.user?.id,
      permissions,
      "detail",
      taskType,
      sourceId,
    ],
    enabled: Boolean(orgId && taskType && sourceId),
    retry: false,
    refetchOnWindowFocus: "always",
    refetchInterval: 30_000,
    queryFn: ({ signal }) => tasksApi.detail(taskType!, sourceId!, signal),
  });
}

export function useEligibleAssigneesQuery(
  taskType: TaskType | null,
  sourceId: string | null,
  enabled: boolean,
) {
  const { session, permissions } = useSession();
  const orgId = session?.organization?.id;
  return useQuery({
    queryKey: [
      "tasks",
      orgId,
      session?.user?.id,
      permissions,
      "eligible",
      taskType,
      sourceId,
    ],
    enabled: enabled && Boolean(orgId && taskType && sourceId),
    retry: false,
    refetchOnWindowFocus: "always",
    refetchInterval: 30_000,
    queryFn: ({ signal }) => tasksApi.eligible(taskType!, sourceId!, signal),
  });
}

export function useTaskGroupsQuery(enabled = true) {
  const { session, permissions } = useSession();
  const orgId = session?.organization?.id;
  return useQuery({
    queryKey: ["tasks", orgId, session?.user?.id, permissions, "groups"],
    enabled: enabled && Boolean(orgId),
    retry: false,
    refetchOnWindowFocus: "always",
    refetchInterval: 30_000,
    queryFn: ({ signal }) => tasksApi.groups(signal),
  });
}

export function useTaskGroupQuery(groupId: string | null, enabled = true) {
  const { session, permissions } = useSession();
  const orgId = session?.organization?.id;
  return useQuery({
    queryKey: [
      "tasks",
      orgId,
      session?.user?.id,
      permissions,
      "group",
      groupId,
    ],
    enabled: enabled && Boolean(orgId && groupId),
    retry: false,
    refetchOnWindowFocus: "always",
    refetchInterval: 30_000,
    queryFn: ({ signal }) => tasksApi.group(groupId!, signal),
  });
}

export function useTaskAbsencesQuery(enabled = true) {
  const { session, permissions } = useSession();
  const orgId = session?.organization?.id;
  return useQuery({
    queryKey: ["tasks", orgId, session?.user?.id, permissions, "absences"],
    enabled: enabled && Boolean(orgId),
    retry: false,
    refetchOnWindowFocus: "always",
    refetchInterval: 30_000,
    queryFn: ({ signal }) => tasksApi.absences(signal),
  });
}

export function useTaskMemberCandidatesQuery(enabled = true) {
  const { session, permissions } = useSession();
  const orgId = session?.organization?.id;
  return useQuery({
    queryKey: [
      "tasks",
      orgId,
      session?.user?.id,
      permissions,
      "member-candidates",
    ],
    enabled: enabled && Boolean(orgId),
    retry: false,
    refetchOnWindowFocus: "always",
    refetchInterval: 30_000,
    queryFn: ({ signal }) => tasksApi.memberCandidates(signal),
  });
}

/** Commands never enter React Query's mutation cache, and never publish across organizations. */
export function useTaskCommand() {
  const { session } = useSession();
  const orgId = session?.organization?.id;
  const currentOrg = useRef(orgId);
  currentOrg.current = orgId;
  const [pending, setPending] = useState(false);
  const client = useQueryClient();
  return {
    pending,
    async run<T>(command: () => Promise<T>): Promise<T> {
      if (!orgId || currentOrg.current !== orgId)
        throw new Error("Organization changed. Reload the task before acting.");
      setPending(true);
      try {
        const result = await command();
        if (currentOrg.current !== orgId)
          throw new Error(
            "Organization changed during the action. Reload current tasks.",
          );
        await client.invalidateQueries({ queryKey: ["tasks", orgId] });
        return result;
      } catch (error) {
        if (currentOrg.current === orgId)
          await client.invalidateQueries({ queryKey: ["tasks", orgId] });
        throw error;
      } finally {
        setPending(false);
      }
    },
  };
}
