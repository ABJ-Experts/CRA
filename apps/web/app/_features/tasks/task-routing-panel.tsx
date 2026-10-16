"use client";

import type { TaskRow } from "@repo/contracts/tasks/types";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import { useEffect, useRef, useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import { tasksApi } from "./tasks.api";
import { useEligibleAssigneesQuery, useTaskCommand } from "./tasks.queries";

const fieldClass =
  "h-10 w-full rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

function currentAssignment(task: TaskRow) {
  if (task.groupId) return `group:${task.groupId}`;
  const userId = task.unresolvedAssignment
    ? task.accountableOwnerUserId
    : (task.effectiveAssigneeUserId ?? task.accountableOwnerUserId);
  if (userId) return `user:${userId}`;
  return "";
}

function commandMessage(error: unknown) {
  if (error instanceof ApiClientError) {
    if (error.status === 409)
      return "The task changed. Review the refreshed assignment and retry your action.";
    if (error.status === 403)
      return "Your access changed. You can no longer manage this task.";
    if (error.kind === "network")
      return "The connection was lost. Retry safely with the same request key.";
  }
  return "The assignment could not be saved. Review the details and retry.";
}

export function TaskRoutingPanel({
  task,
  actorUserId,
  onClose,
}: Readonly<{
  task: TaskRow;
  actorUserId: string | null;
  onClose: () => void;
}>) {
  const eligible = useEligibleAssigneesQuery(
    task.taskType,
    task.sourceId,
    task.canAssign || task.canDelegate,
  );
  const command = useTaskCommand();
  const [assignee, setAssignee] = useState(() => currentAssignment(task));
  const [assignmentDirty, setAssignmentDirty] = useState(false);
  const [substitute, setSubstitute] = useState("");
  const [expiresLocal, setExpiresLocal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retry, setRetry] = useState<{
    kind: string;
    call: () => Promise<unknown>;
    success: string;
  } | null>(null);
  const requestBases = useRef<
    Record<
      string,
      {
        expectedRouteVersion: number;
        expectedSourceRevision: string;
        idempotencyKey: string;
      }
    >
  >({});
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [task.sourceId]);

  useEffect(() => {
    requestBases.current = {};
    setError(null);
    setRetry(null);
    setAssignmentDirty(false);
    setSubstitute("");
    setExpiresLocal("");
  }, [task.sourceId, task.taskType]);

  useEffect(() => {
    if (!assignmentDirty) setAssignee(currentAssignment(task));
  }, [assignmentDirty, task]);

  const sourceRevision = task.sourceRevision;
  const commandBase = (kind: string) =>
    (requestBases.current[kind] ??= {
      expectedRouteVersion: task.routeVersion,
      expectedSourceRevision: sourceRevision!,
      idempotencyKey: crypto.randomUUID(),
    });
  const perform = async (
    kind: string,
    call: () => Promise<unknown>,
    success: string,
  ) => {
    setError(null);
    setNotice(null);
    try {
      await command.run(call);
      delete requestBases.current[kind];
      setNotice(success);
      setRetry(null);
      return true;
    } catch (cause) {
      if (
        cause instanceof ApiClientError &&
        [400, 401, 403, 409, 422].includes(cause.status ?? 0)
      ) {
        delete requestBases.current[kind];
        setRetry(null);
      } else {
        setRetry({ kind, call, success });
      }
      setError(commandMessage(cause));
      return false;
    }
  };

  const canRelease = Boolean(
    task.groupId &&
    !task.unresolvedAssignment &&
    actorUserId &&
    task.effectiveAssigneeUserId === actorUserId,
  );
  const hasActiveDelegation = Boolean(
    task.delegatedToUserId &&
    task.delegationExpiresAt &&
    Date.parse(task.delegationExpiresAt) > Date.now(),
  );
  const canRevokeDelegation = Boolean(
    hasActiveDelegation &&
    (task.canAssign || actorUserId === task.accountableOwnerUserId),
  );
  return (
    <section
      aria-label="Task assignment"
      className="rounded-xl border border-border bg-canvas p-4 sm:p-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="text-subhead-semibold text-fg"
          >
            Assignment
          </h2>
          <p className="mt-1 text-caption-1-regular text-fg-muted">
            Routing changes who sees this work. Open task to complete it in the
            source workflow.
          </p>
        </div>
        <Button size="sm" variant="outline" tone="grey" onClick={onClose}>
          Close
        </Button>
      </div>
      {task.unresolvedAssignment ? (
        <p
          role="status"
          className="mt-4 rounded-xl border border-warning bg-surface-subtle p-3 text-caption-1-regular text-fg"
        >
          Assignment unresolved. The original owner or unclaimed group remains
          accountable until an eligible member is selected.
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-danger p-3 text-caption-1-regular text-danger"
        >
          {error}
        </p>
      ) : null}
      {retry ? (
        <Button
          size="sm"
          variant="outline"
          disabled={command.pending}
          onClick={() => void perform(retry.kind, retry.call, retry.success)}
        >
          Retry last action
        </Button>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="mt-4 rounded-xl border border-success p-3 text-caption-1-regular text-fg"
        >
          {notice}
        </p>
      ) : null}
      {sourceRevision === null ? (
        <p className="mt-4 text-caption-1-regular text-fg-muted">
          The source is unavailable. Its title and actions are hidden until it
          can be checked again.
        </p>
      ) : (
        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          {task.canAssign ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const [kind, id] = assignee.split(":");
                void perform(
                  "assign",
                  () =>
                    tasksApi.assign(task.taskType, task.sourceId, {
                      assigneeUserId: kind === "user" ? (id ?? null) : null,
                      groupId: kind === "group" ? (id ?? null) : null,
                      ...commandBase("assign"),
                    }),
                  "Assignment saved.",
                ).then((saved) => {
                  if (saved) setAssignmentDirty(false);
                });
              }}
              className="space-y-3"
            >
              <label
                className="block text-caption-1-regular text-fg"
                htmlFor="task-assignee"
              >
                Assign to user or group
              </label>
              <select
                id="task-assignee"
                className={fieldClass}
                value={assignee}
                onChange={(event) => {
                  setAssignee(event.target.value);
                  setAssignmentDirty(true);
                  delete requestBases.current.assign;
                  if (retry?.kind === "assign") setRetry(null);
                }}
                disabled={eligible.isLoading || command.pending}
              >
                <option value="">Unassigned</option>
                {!eligible.isError
                  ? eligible.data?.users.map((user) => (
                      <option key={user.id} value={`user:${user.id}`}>
                        {user.displayName}
                      </option>
                    ))
                  : null}
                {!eligible.isError
                  ? eligible.data?.groups.map((group) => (
                      <option key={group.id} value={`group:${group.id}`}>
                        {group.name} (group)
                      </option>
                    ))
                  : null}
              </select>
              {eligible.isError ? (
                <p
                  role="alert"
                  className="flex items-center gap-2 text-caption-1-regular text-danger"
                >
                  Eligible assignees are unavailable.{" "}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void eligible.refetch()}
                  >
                    Retry assignees
                  </Button>
                </p>
              ) : null}
              <Button
                type="submit"
                size="sm"
                disabled={
                  !assignmentDirty ||
                  eligible.isLoading ||
                  eligible.isError ||
                  command.pending
                }
              >
                Save assignment
              </Button>
            </form>
          ) : null}
          {task.canClaim || canRelease ? (
            <div className="space-y-3">
              <p className="text-caption-1-regular text-fg">Group work</p>
              <p className="text-caption-1-regular text-fg-muted">
                A claim reserves the task for one eligible group member.
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={command.pending}
                onClick={() =>
                  void perform(
                    canRelease ? "release" : "claim",
                    () =>
                      canRelease
                        ? tasksApi.release(
                            task.taskType,
                            task.sourceId,
                            commandBase("release"),
                          )
                        : tasksApi.claim(
                            task.taskType,
                            task.sourceId,
                            commandBase("claim"),
                          ),
                    canRelease ? "Claim released." : "Task claimed.",
                  )
                }
              >
                {canRelease ? "Release claim" : "Claim task"}
              </Button>
            </div>
          ) : null}
          {task.canDelegate && !hasActiveDelegation ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const parsed = Date.parse(expiresLocal);
                if (
                  !substitute ||
                  !Number.isFinite(parsed) ||
                  parsed <= Date.now()
                ) {
                  setError(
                    "Choose an eligible substitute and a future expiry.",
                  );
                  return;
                }
                void perform(
                  "delegate",
                  () =>
                    tasksApi.delegate(task.taskType, task.sourceId, {
                      substituteUserId: substitute,
                      expiresAt: new Date(parsed).toISOString(),
                      ...commandBase("delegate"),
                    }),
                  "Delegation saved.",
                );
              }}
              className={cn("space-y-3", task.canAssign && "lg:col-span-2")}
            >
              <h3 className="text-subhead-semibold text-fg">
                Temporary delegation
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-caption-1-regular text-fg">
                  Substitute
                  <select
                    className={fieldClass}
                    value={substitute}
                    onChange={(event) => {
                      setSubstitute(event.target.value);
                      delete requestBases.current.delegate;
                      if (retry?.kind === "delegate") setRetry(null);
                    }}
                    required
                    disabled={eligible.isLoading || command.pending}
                  >
                    <option value="">Choose a member</option>
                    {!eligible.isError
                      ? eligible.data?.users
                          .filter((user) => user.id !== actorUserId)
                          .map((user) => (
                            <option key={user.id} value={user.id}>
                              {user.displayName}
                            </option>
                          ))
                      : null}
                  </select>
                </label>
                <label className="space-y-1 text-caption-1-regular text-fg">
                  Expires at
                  <input
                    className={fieldClass}
                    type="datetime-local"
                    value={expiresLocal}
                    onChange={(event) => {
                      setExpiresLocal(event.target.value);
                      delete requestBases.current.delegate;
                      if (retry?.kind === "delegate") setRetry(null);
                    }}
                    required
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  size="sm"
                  disabled={command.pending || eligible.isError}
                >
                  Delegate
                </Button>
              </div>
            </form>
          ) : null}
          {hasActiveDelegation ? (
            <div className={cn("space-y-3", task.canAssign && "lg:col-span-2")}>
              <h3 className="text-subhead-semibold text-fg">
                Temporary delegation
              </h3>
              <p className="text-caption-1-regular text-fg-muted">
                An active delegation must be revoked before assigning another
                substitute.
              </p>
              {canRevokeDelegation ? (
                <Button
                  size="sm"
                  variant="outline"
                  tone="grey"
                  disabled={command.pending}
                  onClick={() =>
                    void perform(
                      "revoke",
                      () =>
                        tasksApi.revokeDelegation(
                          task.taskType,
                          task.sourceId,
                          commandBase("revoke"),
                        ),
                      "Delegation revoked.",
                    )
                  }
                >
                  Revoke delegation
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
