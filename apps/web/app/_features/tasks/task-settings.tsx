"use client";

import { Button } from "@repo/ui/button";
import { useEffect, useRef, useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import { useSession } from "../../_providers/session-provider";
import { tasksApi } from "./tasks.api";
import {
  useTaskAbsencesQuery,
  useTaskCommand,
  useTaskGroupQuery,
  useTaskGroupsQuery,
  useTaskMemberCandidatesQuery,
} from "./tasks.queries";

const fieldClass =
  "h-10 w-full rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";
const dateTime = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

function mutationError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 409)
      return "This record changed. Review the refreshed version and retry.";
    if (error.status === 403)
      return "Your access changed. This action is no longer available.";
    if (error.kind === "network")
      return "Connection lost. Retry when online; the request key is retained.";
  }
  return "The change could not be saved. Check the values and retry.";
}

export function TaskSettings({ active }: Readonly<{ active: boolean }>) {
  const { role, session } = useSession();
  const canManageGroups = role === "owner" || role === "admin";
  const groups = useTaskGroupsQuery(active);
  const absences = useTaskAbsencesQuery(active);
  const candidates = useTaskMemberCandidatesQuery(active);
  const [groupId, setGroupId] = useState<string | null>(null);
  const group = useTaskGroupQuery(groupId, active && canManageGroups);
  const command = useTaskCommand();
  const [newGroup, setNewGroup] = useState("");
  const [rename, setRename] = useState("");
  const [memberId, setMemberId] = useState("");
  const [substituteId, setSubstituteId] = useState("");
  const [startsLocal, setStartsLocal] = useState("");
  const [endsLocal, setEndsLocal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retry, setRetry] = useState<{
    name: string;
    call: () => Promise<unknown>;
    message: string;
  } | null>(null);
  const requestKeys = useRef<Record<string, string>>({});
  const requestPayloads = useRef<Record<string, unknown>>({});
  useEffect(() => {
    setGroupId(null);
    setMemberId("");
    setSubstituteId("");
    setRetry(null);
    requestKeys.current = {};
    requestPayloads.current = {};
  }, [session?.organization?.id]);
  const keyFor = (name: string) => {
    return (requestKeys.current[name] ??= crypto.randomUUID());
  };
  const payloadFor = <T,>(name: string, create: () => T): T => {
    return (requestPayloads.current[name] ??= create()) as T;
  };
  const clearKey = (name: string) => {
    delete requestKeys.current[name];
    delete requestPayloads.current[name];
    if (retry?.name === name) setRetry(null);
  };
  const perform = async (
    name: string,
    call: () => Promise<unknown>,
    message: string,
  ) => {
    setError(null);
    setNotice(null);
    try {
      await command.run(call);
      clearKey(name);
      setNotice(message);
      setRetry(null);
      return true;
    } catch (cause) {
      if (
        cause instanceof ApiClientError &&
        [400, 401, 403, 409, 422].includes(cause.status ?? 0)
      ) {
        clearKey(name);
        setRetry(null);
      } else {
        setRetry({ name, call, message });
      }
      setError(mutationError(cause));
      return false;
    }
  };
  return (
    <section
      aria-label="Task routing settings"
      className="space-y-6 rounded-xl border border-border bg-canvas p-4 sm:p-5"
    >
      <div>
        <h2 className="text-subhead-semibold text-fg">Routing settings</h2>
        <p className="mt-1 text-caption-1-regular text-fg-muted">
          Groups and absences change assignment visibility only. Source access
          is checked separately.
        </p>
      </div>
      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-danger p-3 text-caption-1-regular text-danger"
        >
          {error}
        </p>
      ) : null}
      {retry ? (
        <Button
          size="sm"
          variant="outline"
          disabled={command.pending}
          onClick={() => void perform(retry.name, retry.call, retry.message)}
        >
          Retry last action
        </Button>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="rounded-xl border border-success p-3 text-caption-1-regular text-fg"
        >
          {notice}
        </p>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <h3 className="text-subhead-semibold text-fg">Workflow groups</h3>
          {groups.isLoading ? (
            <p role="status" className="text-caption-1-regular text-fg-muted">
              Loading groups…
            </p>
          ) : null}
          {groups.isError ? (
            <p role="alert" className="text-caption-1-regular text-danger">
              Groups are unavailable.{" "}
              <Button
                size="sm"
                variant="outline"
                onClick={() => void groups.refetch()}
              >
                Retry groups
              </Button>
            </p>
          ) : null}
          {candidates.isLoading ? (
            <p role="status" className="text-caption-1-regular text-fg-muted">
              Loading eligible members…
            </p>
          ) : null}
          {candidates.isError ? (
            <p role="alert" className="text-caption-1-regular text-danger">
              Member choices are unavailable.{" "}
              <Button
                size="sm"
                variant="outline"
                onClick={() => void candidates.refetch()}
              >
                Retry members
              </Button>
            </p>
          ) : null}
          {!candidates.isError && candidates.data?.users.length === 0 ? (
            <p className="text-caption-1-regular text-fg-muted">
              No active members are available for assignment.
            </p>
          ) : null}
          {!groups.isError && groups.data?.groups.length === 0 ? (
            <p className="text-caption-1-regular text-fg-muted">
              No workflow groups yet.
            </p>
          ) : null}
          {!groups.isError && groups.data?.groups.length ? (
            <label className="block space-y-1 text-caption-1-regular text-fg">
              Group
              <select
                className={fieldClass}
                value={groupId ?? ""}
                onChange={(event) => {
                  for (const name of Object.keys(requestKeys.current)) {
                    if (
                      name === "rename-group" ||
                      name === "add-member" ||
                      name.startsWith("remove:")
                    )
                      clearKey(name);
                  }
                  setGroupId(event.target.value || null);
                  setRename("");
                  setMemberId("");
                }}
              >
                <option value="">Choose a group</option>
                {groups.data.groups.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.memberCount})
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {canManageGroups ? (
            <>
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void perform(
                    "create-group",
                    () =>
                      tasksApi.createGroup(
                        payloadFor("create-group", () => ({
                          name: newGroup.trim(),
                          idempotencyKey: keyFor("create-group"),
                        })),
                      ),
                    "Group created.",
                  ).then((saved) => {
                    if (saved) setNewGroup("");
                  });
                }}
              >
                <label className="min-w-48 flex-1 space-y-1 text-caption-1-regular text-fg">
                  New group name
                  <input
                    className={fieldClass}
                    value={newGroup}
                    onChange={(event) => {
                      setNewGroup(event.target.value);
                      clearKey("create-group");
                    }}
                    maxLength={100}
                    required
                  />
                </label>
                <Button type="submit" size="sm" disabled={command.pending}>
                  Create group
                </Button>
              </form>
              {groupId && group.isLoading ? (
                <p
                  role="status"
                  className="text-caption-1-regular text-fg-muted"
                >
                  Loading group members…
                </p>
              ) : null}
              {groupId && group.isError ? (
                <p role="alert" className="text-caption-1-regular text-danger">
                  Group members are unavailable.{" "}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void group.refetch()}
                  >
                    Retry group
                  </Button>
                </p>
              ) : null}
              {groupId && group.data && !group.isError ? (
                <div className="space-y-3 rounded-xl border border-border bg-surface-subtle p-3">
                  <form
                    className="flex flex-wrap items-end gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void perform(
                        "rename-group",
                        () =>
                          tasksApi.updateGroup(
                            groupId,
                            payloadFor("rename-group", () => ({
                              name: rename.trim(),
                              expectedVersion: group.data.group.version,
                              idempotencyKey: keyFor("rename-group"),
                            })),
                          ),
                        "Group renamed.",
                      );
                    }}
                  >
                    <label className="min-w-44 flex-1 space-y-1 text-caption-1-regular text-fg">
                      Rename group
                      <input
                        className={fieldClass}
                        value={rename}
                        onChange={(event) => {
                          setRename(event.target.value);
                          clearKey("rename-group");
                        }}
                        placeholder={group.data.group.name}
                        maxLength={100}
                        required
                      />
                    </label>
                    <Button
                      type="submit"
                      size="sm"
                      variant="outline"
                      disabled={command.pending}
                    >
                      Rename
                    </Button>
                  </form>
                  <h4 className="text-caption-1-semibold text-fg">Members</h4>
                  {group.data.members.length === 0 ? (
                    <p className="text-caption-1-regular text-fg-muted">
                      No members in this group.
                    </p>
                  ) : null}
                  <ul className="divide-y divide-border">
                    {group.data.members.map((member) => (
                      <li
                        key={member.id}
                        className="flex items-center justify-between gap-3 py-2 text-caption-1-regular text-fg"
                      >
                        <span>{member.displayName}</span>
                        <Button
                          size="sm"
                          variant="outline"
                          tone="grey"
                          disabled={command.pending}
                          onClick={() =>
                            void perform(
                              `remove:${member.id}`,
                              () =>
                                tasksApi.removeGroupMember(
                                  groupId,
                                  member.id,
                                  payloadFor(`remove:${member.id}`, () => ({
                                    expectedVersion: group.data.group.version,
                                    idempotencyKey: keyFor(
                                      `remove:${member.id}`,
                                    ),
                                  })),
                                ),
                              "Member removed.",
                            )
                          }
                        >
                          Remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                  <form
                    className="flex flex-wrap items-end gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void perform(
                        "add-member",
                        () =>
                          tasksApi.addGroupMember(
                            groupId,
                            payloadFor("add-member", () => ({
                              userId: memberId.trim(),
                              expectedVersion: group.data.group.version,
                              idempotencyKey: keyFor("add-member"),
                            })),
                          ),
                        "Member added.",
                      );
                    }}
                  >
                    <label className="min-w-44 flex-1 space-y-1 text-caption-1-regular text-fg">
                      Add eligible member
                      <select
                        className={fieldClass}
                        value={memberId}
                        onChange={(event) => {
                          setMemberId(event.target.value);
                          clearKey("add-member");
                        }}
                        required
                        disabled={candidates.isLoading || candidates.isError}
                      >
                        <option value="">Choose a member</option>
                        {!candidates.isError
                          ? candidates.data?.users
                              .filter(
                                (user) =>
                                  !group.data.members.some(
                                    (member) => member.id === user.id,
                                  ),
                              )
                              .map((user) => (
                                <option key={user.id} value={user.id}>
                                  {user.displayName}
                                </option>
                              ))
                          : null}
                      </select>
                    </label>
                    <Button
                      size="sm"
                      type="submit"
                      disabled={
                        command.pending ||
                        candidates.isLoading ||
                        candidates.isError ||
                        candidates.data?.users.length === 0
                      }
                    >
                      Add member
                    </Button>
                  </form>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-caption-1-regular text-fg-muted">
              An owner or admin manages group membership.
            </p>
          )}
        </div>
        <div className="space-y-4">
          <h3 className="text-subhead-semibold text-fg">Out of office</h3>
          <p className="text-caption-1-regular text-fg-muted">
            Times are shown in your locale. Intervals start at the first instant
            and end before the final instant.
          </p>
          {absences.isLoading ? (
            <p role="status" className="text-caption-1-regular text-fg-muted">
              Loading absences…
            </p>
          ) : null}
          {absences.isError ? (
            <p role="alert" className="text-caption-1-regular text-danger">
              Absences are unavailable.{" "}
              <Button
                size="sm"
                variant="outline"
                onClick={() => void absences.refetch()}
              >
                Retry absences
              </Button>
            </p>
          ) : null}
          {!absences.isError && absences.data?.absences.length === 0 ? (
            <p className="text-caption-1-regular text-fg-muted">
              No absence intervals scheduled.
            </p>
          ) : null}
          {!absences.isError && absences.data?.absences.length ? (
            <ul className="divide-y divide-border rounded-xl border border-border px-3">
              {absences.data.absences.map((absence) => {
                const substituteName =
                  !candidates.isError && !candidates.isLoading
                    ? candidates.data?.users.find(
                        (user) => user.id === absence.substituteUserId,
                      )?.displayName
                    : null;
                return (
                  <li
                    key={absence.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-3 text-caption-1-regular text-fg"
                  >
                    <span>
                      {dateTime(absence.startsAt)} – {dateTime(absence.endsAt)}
                      <span className="block text-fg-muted">
                        {substituteName
                          ? `Substitute: ${substituteName}`
                          : "Substitute name unavailable"}
                      </span>
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      tone="grey"
                      disabled={command.pending}
                      onClick={() =>
                        void perform(
                          `remove-absence:${absence.id}`,
                          () =>
                            tasksApi.deleteAbsence(
                              absence.id,
                              payloadFor(
                                `remove-absence:${absence.id}`,
                                () => ({
                                  expectedVersion: absence.version,
                                  idempotencyKey: keyFor(
                                    `remove-absence:${absence.id}`,
                                  ),
                                }),
                              ),
                            ),
                          "Absence removed.",
                        )
                      }
                    >
                      Remove absence
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              const start = Date.parse(startsLocal);
              const end = Date.parse(endsLocal);
              if (
                !Number.isFinite(start) ||
                !Number.isFinite(end) ||
                start >= end ||
                end - start > 365 * 24 * 60 * 60 * 1000
              ) {
                setError("Choose a valid interval of at most 365 days.");
                return;
              }
              void perform(
                "create-absence",
                () =>
                  tasksApi.createAbsence(
                    payloadFor("create-absence", () => ({
                      substituteUserId: substituteId.trim(),
                      startsAt: new Date(start).toISOString(),
                      endsAt: new Date(end).toISOString(),
                      idempotencyKey: keyFor("create-absence"),
                    })),
                  ),
                "Absence scheduled.",
              );
            }}
          >
            <label className="block space-y-1 text-caption-1-regular text-fg">
              Substitute member
              <select
                className={fieldClass}
                value={substituteId}
                onChange={(event) => {
                  setSubstituteId(event.target.value);
                  clearKey("create-absence");
                }}
                required
                disabled={candidates.isLoading || candidates.isError}
              >
                <option value="">Choose a member</option>
                {!candidates.isError
                  ? candidates.data?.users
                      .filter((user) => user.id !== session?.user.id)
                      .map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.displayName}
                        </option>
                      ))
                  : null}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-caption-1-regular text-fg">
                Starts at
                <input
                  className={fieldClass}
                  type="datetime-local"
                  value={startsLocal}
                  onChange={(event) => {
                    setStartsLocal(event.target.value);
                    clearKey("create-absence");
                  }}
                  required
                />
              </label>
              <label className="space-y-1 text-caption-1-regular text-fg">
                Ends at
                <input
                  className={fieldClass}
                  type="datetime-local"
                  value={endsLocal}
                  onChange={(event) => {
                    setEndsLocal(event.target.value);
                    clearKey("create-absence");
                  }}
                  required
                />
              </label>
            </div>
            <Button
              size="sm"
              type="submit"
              disabled={
                command.pending ||
                candidates.isLoading ||
                candidates.isError ||
                !candidates.data?.users.some(
                  (user) => user.id !== session?.user.id,
                )
              }
            >
              Schedule absence
            </Button>
          </form>
        </div>
      </div>
    </section>
  );
}
