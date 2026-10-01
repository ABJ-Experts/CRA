"use client";

import type {
  TaskListQuery,
  TaskRow,
  TaskType,
} from "@repo/contracts/tasks/types";
import { taskListQuerySchema } from "@repo/contracts/tasks/schemas";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import { useSession } from "../../_providers/session-provider";
import { PageHeading } from "../../dashboard/_components/dashboard-chrome";
import { TaskRoutingPanel } from "./task-routing-panel";
import { TaskSettings } from "./task-settings";
import {
  useTaskDetailQuery,
  useTaskListQuery,
  useTaskMemberCandidatesQuery,
} from "./tasks.queries";

const taskTypes: readonly [TaskType, string][] = [
  ["finding_triage", "Finding triage"],
  ["finding_approval", "Finding approval"],
  ["report_approval", "Report approval"],
  ["evidence_expiry", "Evidence expiry"],
  ["supplier_request", "Supplier request"],
];
const scopes = [
  ["mine", "My tasks"],
  ["group", "Group tasks"],
  ["available", "Available tasks"],
  ["all", "All authorized"],
] as const;
const fieldClass =
  "h-10 w-full rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

function formatDue(value: string | null) {
  return value
    ? new Date(value).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "No due date";
}

function requestMessage(error: unknown) {
  if (error instanceof ApiClientError) {
    if (error.status === 403)
      return "You no longer have access to this task inbox in the selected organization.";
    if (error.kind === "network")
      return "The inbox is offline. Your filters are retained; retry when connected.";
    if (error.status === 409)
      return "The inbox changed while loading. Retry to see the latest work.";
  }
  return "Tasks are temporarily unavailable. Retry to load current work.";
}

function dueBoundary(value: string, end: boolean) {
  if (!value) return undefined;
  const date = new Date(`${value}T${end ? "23:59:59.999" : "00:00:00"}`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function stateLabel(task: TaskRow) {
  if (task.state === "unavailable") return "Source unavailable";
  if (task.state === "overdue") return "Overdue";
  if (task.unresolvedAssignment) return "Assignment unresolved";
  if (task.delegatedToUserId) return "Delegated";
  return "Open";
}

function TaskTable({
  rows,
  memberNames,
  onManage,
}: Readonly<{
  rows: TaskRow[];
  memberNames: ReadonlyMap<string, string>;
  onManage: (task: TaskRow, trigger: HTMLButtonElement) => void;
}>) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-canvas">
      <table className="w-full min-w-[820px] border-collapse text-left">
        <thead className="bg-surface-subtle text-caption-2-uppercase text-fg-subtle">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              Task
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              State
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Due
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Assignment
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Action
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((task) => (
            <tr
              key={`${task.organizationId}:${task.taskType}:${task.sourceId}`}
              className="align-top text-caption-1-regular text-fg"
            >
              <td className="max-w-[320px] px-4 py-3">
                <span className="block text-caption-1-semibold text-fg">
                  {task.state === "unavailable"
                    ? "Source unavailable"
                    : task.title}
                </span>
                <span className="block text-fg-muted">
                  {taskTypes.find(([type]) => type === task.taskType)?.[1]}
                </span>
              </td>
              <td className="px-4 py-3">
                <span
                  className={cn(
                    "inline-flex rounded-lg border px-2 py-1 text-caption-1-semibold",
                    task.state === "overdue"
                      ? "border-danger text-danger"
                      : task.unresolvedAssignment
                        ? "border-warning text-fg"
                        : "border-border text-fg",
                  )}
                >
                  {stateLabel(task)}
                </span>
                {task.delegatedToUserId && task.state !== "unavailable" ? (
                  <span className="mt-1 block text-fg-muted">
                    Delegated until {formatDue(task.delegationExpiresAt)}
                  </span>
                ) : null}
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                {task.state === "unavailable"
                  ? "Unavailable"
                  : formatDue(task.dueAt)}
              </td>
              <td className="px-4 py-3">
                {task.unresolvedAssignment ? (
                  <span className="block text-warning">Needs reassignment</span>
                ) : null}
                {task.groupId ? (
                  <span className="block break-all">Group {task.groupId}</span>
                ) : null}
                {task.accountableOwnerUserId ? (
                  <span className="block break-all">
                    Owner{" "}
                    {memberNames.get(task.accountableOwnerUserId) ??
                      task.accountableOwnerUserId}
                  </span>
                ) : null}
                {task.effectiveAssigneeUserId ? (
                  <span className="block break-all">
                    Assignee{" "}
                    {memberNames.get(task.effectiveAssigneeUserId) ??
                      task.effectiveAssigneeUserId}
                  </span>
                ) : null}
                {task.actingUserId ? (
                  <span className="block break-all text-fg-muted">
                    Acting user{" "}
                    {memberNames.get(task.actingUserId) ?? task.actingUserId}
                  </span>
                ) : null}
                {!task.groupId &&
                !task.accountableOwnerUserId &&
                !task.effectiveAssigneeUserId
                  ? "Unassigned"
                  : null}
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                <div className="flex items-center gap-2">
                  {task.sourceUrl ? (
                    <Link
                      href={task.sourceUrl}
                      className="rounded-md text-caption-1-semibold text-active-500 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                      aria-label={`Open task: ${task.title}`}
                    >
                      Open task
                    </Link>
                  ) : (
                    <span className="text-fg-muted">Source unavailable</span>
                  )}
                  {task.canAssign ||
                  task.canClaim ||
                  task.canDelegate ||
                  task.unresolvedAssignment ? (
                    <Button
                      size="sm"
                      variant="outline"
                      tone="grey"
                      onClick={(event) => onManage(task, event.currentTarget)}
                      aria-label={`${task.canAssign || task.canClaim || task.canDelegate ? "Manage" : "View"} assignment for ${task.title ?? "unavailable source"}`}
                    >
                      {task.canAssign || task.canClaim || task.canDelegate
                        ? "Assign"
                        : "View assignment"}
                    </Button>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TaskInbox() {
  const { session, isLoading: sessionLoading } = useSession();
  const orgId = session?.organization?.id;
  const [scope, setScope] = useState<(typeof scopes)[number][0]>("mine");
  const [taskType, setTaskType] = useState<TaskType | "">("");
  const [state, setState] = useState<"" | "open" | "overdue" | "unavailable">(
    "",
  );
  const [ownerUserId, setOwnerUserId] = useState("");
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");
  const [cursor, setCursor] = useState<string | undefined>();
  const [selected, setSelected] = useState<Pick<
    TaskRow,
    "taskType" | "sourceId"
  > | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const lastOrg = useRef(orgId);
  useEffect(() => {
    if (lastOrg.current === orgId) return;
    lastOrg.current = orgId;
    setSelected(null);
    setOwnerUserId("");
    setCursor(undefined);
    triggerRef.current = null;
  }, [orgId]);
  const query = useMemo<Partial<TaskListQuery>>(
    () => ({
      scope,
      taskType: taskType || undefined,
      state: state || undefined,
      ownerUserId: ownerUserId || undefined,
      dueFrom: dueBoundary(dueFrom, false),
      dueTo: dueBoundary(dueTo, true),
      cursor: cursor as TaskListQuery["cursor"],
      limit: 50,
    }),
    [scope, taskType, state, ownerUserId, dueFrom, dueTo, cursor],
  );
  const filtersValid = taskListQuerySchema.safeParse(query).success;
  const list = useTaskListQuery(query, Boolean(orgId && filtersValid));
  const members = useTaskMemberCandidatesQuery(Boolean(orgId));
  const memberNames = useMemo(
    () =>
      new Map(
        members.isError
          ? []
          : (members.data?.users.map(
              (member) => [member.id, member.displayName] as const,
            ) ?? []),
      ),
    [members.data, members.isError],
  );
  const detail = useTaskDetailQuery(
    selected?.taskType ?? null,
    selected?.sourceId ?? null,
  );
  const rows = list.isError ? [] : (list.data?.rows ?? []);
  const counts = list.isError || !orgId ? null : list.data?.counts;
  const filtersActive = Boolean(
    taskType || state || ownerUserId || dueFrom || dueTo,
  );
  const updateFilter = (change: () => void) => {
    setCursor(undefined);
    change();
  };
  const selectedTask =
    selected &&
    !list.isError &&
    !detail.isError &&
    detail.data?.task.taskType === selected.taskType &&
    detail.data.task.sourceId === selected.sourceId
      ? detail.data.task
      : null;

  return (
    <div className="space-y-5 pb-10">
      <PageHeading
        title="Task inbox"
        subtitle="Open source work, coordinate ownership, and keep accountability visible."
        actions={
          <Button
            size="sm"
            variant="outline"
            tone="grey"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((value) => !value)}
          >
            Routing settings
          </Button>
        }
      />
      <div hidden={!settingsOpen}>
        <TaskSettings active={settingsOpen} />
      </div>
      <nav
        aria-label="Task views"
        className="flex flex-wrap gap-2 border-b border-border pb-3"
      >
        {scopes.map(([key, label]) => (
          <Button
            key={key}
            size="sm"
            variant={scope === key ? "fill" : "outline"}
            tone={scope === key ? "primary" : "grey"}
            aria-current={scope === key ? "page" : undefined}
            aria-label={label}
            onClick={() => updateFilter(() => setScope(key))}
          >
            {label}{" "}
            {key !== "all" ? (
              <span aria-hidden="true">{counts?.[key] ?? "—"}</span>
            ) : null}
          </Button>
        ))}
      </nav>
      <section
        aria-label="Task filters"
        className="grid gap-3 rounded-xl border border-border bg-surface-subtle p-4 sm:grid-cols-2 xl:grid-cols-5"
      >
        <label className="space-y-1 text-caption-1-regular text-fg">
          Task type
          <select
            className={fieldClass}
            value={taskType}
            onChange={(event) =>
              updateFilter(() =>
                setTaskType(event.target.value as TaskType | ""),
              )
            }
          >
            <option value="">All types</option>
            {taskTypes.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-caption-1-regular text-fg">
          State
          <select
            className={fieldClass}
            value={state}
            onChange={(event) =>
              updateFilter(() => setState(event.target.value as typeof state))
            }
          >
            <option value="">All states</option>
            <option value="open">Open</option>
            <option value="overdue">Overdue</option>
            <option value="unavailable">Source unavailable</option>
          </select>
        </label>
        <div className="space-y-1 text-caption-1-regular text-fg">
          <label htmlFor="task-owner-filter">Accountable owner</label>
          <select
            id="task-owner-filter"
            className={fieldClass}
            value={ownerUserId}
            onChange={(event) =>
              updateFilter(() => setOwnerUserId(event.target.value))
            }
            disabled={members.isLoading || members.isError}
          >
            <option value="">All owners</option>
            {!members.isError
              ? members.data?.users.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.displayName}
                  </option>
                ))
              : null}
          </select>
          {members.isError ? (
            <p role="alert" className="text-danger">
              Member choices unavailable.{" "}
              <Button
                size="sm"
                variant="outline"
                onClick={() => void members.refetch()}
              >
                Retry owners
              </Button>
            </p>
          ) : null}
          {members.isLoading ? (
            <p role="status" className="text-fg-muted">
              Loading owners…
            </p>
          ) : null}
          {members.data?.users.length === 1_000 && !members.isError ? (
            <p className="text-fg-muted">
              Showing the first 1,000 active members.
            </p>
          ) : null}
        </div>
        <label className="space-y-1 text-caption-1-regular text-fg">
          Due from
          <input
            className={fieldClass}
            type="date"
            value={dueFrom}
            onChange={(event) =>
              updateFilter(() => setDueFrom(event.target.value))
            }
          />
        </label>
        <label className="space-y-1 text-caption-1-regular text-fg">
          Due through
          <input
            className={fieldClass}
            type="date"
            value={dueTo}
            onChange={(event) =>
              updateFilter(() => setDueTo(event.target.value))
            }
          />
        </label>
      </section>
      {filtersActive ? (
        <div>
          <Button
            size="sm"
            variant="outline"
            tone="grey"
            onClick={() => {
              setTaskType("");
              setState("");
              setOwnerUserId("");
              setDueFrom("");
              setDueTo("");
              setCursor(undefined);
            }}
          >
            Clear filters
          </Button>
        </div>
      ) : null}
      {!filtersValid ? (
        <p
          role="alert"
          className="rounded-xl border border-warning bg-surface-subtle p-3 text-caption-1-regular text-fg"
        >
          Enter a valid owner ID and a due-date range with the start before the
          end.
        </p>
      ) : null}
      {!orgId && !sessionLoading ? (
        <p
          role="status"
          className="rounded-xl border border-border p-5 text-caption-1-regular text-fg-muted"
        >
          Select an organization to view assigned work.
        </p>
      ) : null}
      {sessionLoading || list.isLoading ? (
        <p
          role="status"
          className="rounded-xl border border-border p-5 text-caption-1-regular text-fg-muted"
        >
          Loading tasks…
        </p>
      ) : null}
      {list.isError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-xl border border-danger p-4 text-caption-1-regular text-danger"
        >
          <span>{requestMessage(list.error)}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void list.refetch()}
          >
            Retry tasks
          </Button>
        </div>
      ) : null}
      {list.data && rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-canvas p-8 text-center">
          <h2 className="text-subhead-semibold text-fg">
            {filtersActive
              ? "No tasks match these filters"
              : `No tasks in ${scopes.find(([key]) => key === scope)?.[1]}`}
          </h2>
          <p className="mt-1 text-caption-1-regular text-fg-muted">
            {filtersActive
              ? "Adjust the filters to inspect other authorized work."
              : "Work appears here when a source workflow needs action."}
          </p>
        </div>
      ) : null}
      {rows.length > 0 && !list.isError ? (
        <>
          <p className="text-caption-1-regular text-fg-muted md:hidden">
            Scroll the table horizontally to see assignment and actions.
          </p>
          <TaskTable
            rows={rows}
            memberNames={memberNames}
            onManage={(task, trigger) => {
              triggerRef.current = trigger;
              setSelected({ taskType: task.taskType, sourceId: task.sourceId });
            }}
          />
          <div className="flex items-center justify-between gap-3 text-caption-1-regular text-fg-muted">
            <span>
              {rows.length} task{rows.length === 1 ? "" : "s"} on this page.
            </span>
            <div className="flex gap-2">
              {cursor ? (
                <Button
                  size="sm"
                  variant="outline"
                  tone="grey"
                  onClick={() => setCursor(undefined)}
                >
                  First page
                </Button>
              ) : null}
              {list.data?.nextCursor ? (
                <Button
                  size="sm"
                  variant="outline"
                  tone="grey"
                  disabled={list.isFetching}
                  onClick={() => setCursor(list.data?.nextCursor ?? undefined)}
                >
                  Next page
                </Button>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
      {selected && detail.isLoading ? (
        <p
          role="status"
          className="rounded-xl border border-border p-4 text-caption-1-regular text-fg-muted"
        >
          Loading assignment…
        </p>
      ) : null}
      {selected && detail.isError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-xl border border-danger p-4 text-caption-1-regular text-danger"
        >
          <span>{requestMessage(detail.error)}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void detail.refetch()}
          >
            Retry assignment
          </Button>
        </div>
      ) : null}
      {selectedTask ? (
        <TaskRoutingPanel
          task={selectedTask}
          actorUserId={session?.user.id ?? null}
          onClose={() => {
            setSelected(null);
            triggerRef.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}
