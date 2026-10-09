"use client";

import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import { SectionCard } from "../../dashboard/_components/dashboard-chrome";
import { ControlDetailPanel } from "./control-detail-panel";
import { controlsApi } from "./controls.api";

export interface ControlLibraryPanelProps {
  readonly organizationId: string;
  readonly actorUserId: string;
  readonly canManage: boolean;
  readonly canViewProducts: boolean;
  readonly canViewEvidence: boolean;
  readonly activePackKey: string | null;
  readonly activeVersionKey: string | null;
  readonly initialControlId: string | null;
  readonly initialRequirementKey?: string | null;
}

function failureMessage(error: unknown, action: string): string {
  if (error instanceof ApiClientError) {
    if (error.status === 409)
      return `${action} conflicted with another change. Your input is preserved. Review the current version and retry.`;
    if (error.status === 403)
      return `You no longer have permission to ${action.toLowerCase()}. Your input is preserved.`;
    if (error.kind === "network")
      return "The server is unreachable. Your input is preserved; retry when online.";
    if (error.kind === "invalid_request" || error.status === 400)
      return "Check the required fields and retry. Your input is preserved.";
    return error.message;
  }
  return `${action} failed. Your input is preserved; retry.`;
}

function statusLabel(value: string): string {
  return value === "not_started"
    ? "Not started"
    : value === "in_progress"
      ? "In progress"
      : value === "implemented"
        ? "Implemented"
        : value;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(value),
  );
}

const fieldClass = cn(
  "min-h-10 w-full rounded-xl border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active-500",
);
const labelClass = cn("grid gap-2 text-caption-1-regular text-fg");

export function ControlLibraryPanel({
  organizationId,
  actorUserId,
  canManage,
  canViewProducts,
  canViewEvidence,
  activePackKey,
  activeVersionKey,
  initialControlId,
  initialRequirementKey = null,
}: ControlLibraryPanelProps) {
  const client = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(initialControlId);
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ownerUserId, setOwnerUserId] = useState(actorUserId);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const retry = useRef<{ signature: string; key: string } | null>(null);

  useEffect(() => {
    if (initialControlId) setSelectedId(initialControlId);
  }, [initialControlId]);

  const list = useInfiniteQuery({
    queryKey: ["framework-controls", organizationId, "list", showArchived],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      controlsApi.list(pageParam, showArchived, signal),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    retry: false,
  });
  const owners = useQuery({
    queryKey: ["framework-controls", organizationId, "owner-candidates"],
    queryFn: ({ signal }) => controlsApi.ownerCandidates(undefined, signal),
    enabled: canManage && creating,
    retry: false,
  });
  const controls = list.data?.pages.flatMap((page) => page.controls) ?? [];

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || saving) return;
    setSaving(true);
    setMessage(null);
    const signature = JSON.stringify([
      organizationId,
      title,
      description,
      ownerUserId,
    ]);
    const idempotencyKey =
      retry.current?.signature === signature
        ? retry.current.key
        : crypto.randomUUID();
    retry.current = { signature, key: idempotencyKey };
    try {
      const result = await controlsApi.create({
        title,
        description,
        ownerUserId,
        status: "not_started",
        expectedRevision: null,
        idempotencyKey,
      });
      retry.current = null;
      setCreating(false);
      setSelectedId(result.controlId);
      setTitle("");
      setDescription("");
      setOwnerUserId(actorUserId);
      setMessage("Control saved.");
      void client.invalidateQueries({
        queryKey: ["framework-controls", organizationId],
      });
    } catch (error) {
      setMessage(failureMessage(error, "Create control"));
      if (error instanceof ApiClientError && error.status === 409)
        retry.current = null;
    } finally {
      setSaving(false);
    }
  }

  function selectControl(id: string) {
    setSelectedId(id);
    setCreating(false);
    setMessage(null);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("controlId", id);
      window.history.replaceState(null, "", url);
    }
  }

  return (
    <section aria-label="Control library" className={cn("grid gap-6")}>
      <SectionCard title="Control library">
        {initialRequirementKey && !selectedId ? (
          <p role="status" className={cn("mb-3 text-subhead-regular text-fg")}>
            Select or create a control, then review its mapping for requirement{" "}
            {initialRequirementKey}.
          </p>
        ) : null}
        <div className={cn("flex flex-wrap items-start justify-between gap-3")}>
          <p className={cn("max-w-2xl text-subhead-regular text-fg-muted")}>
            Record organization controls, then link exact evidence versions and
            map them to requirements for selected products. A mapping is not a
            compliance decision.
          </p>
          {canManage ? (
            <Button
              type="button"
              onClick={() => {
                setCreating(true);
                setSelectedId(null);
                setMessage(null);
                if (typeof window !== "undefined") {
                  const url = new URL(window.location.href);
                  url.searchParams.delete("controlId");
                  window.history.replaceState(null, "", url);
                }
              }}
            >
              Create control
            </Button>
          ) : null}
        </div>
        <label
          className={cn(
            "mt-4 flex items-center gap-2 text-caption-1-regular text-fg",
          )}
        >
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
            className={cn(
              "size-4 accent-active-500 focus-visible:outline-2 focus-visible:outline-active-500",
            )}
          />
          Show archived controls
        </label>
        {list.isLoading ? (
          <p
            role="status"
            className={cn("mt-4 text-subhead-regular text-fg-muted")}
          >
            Loading controls…
          </p>
        ) : null}
        {list.isError ? (
          <div className={cn("mt-4")}>
            <p role="alert" className={cn("text-subhead-regular text-danger")}>
              {failureMessage(list.error, "Read controls")}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn("mt-3")}
              onClick={() => void list.refetch()}
            >
              Retry controls
            </Button>
          </div>
        ) : null}
        {!list.isLoading && !list.isError && controls.length === 0 ? (
          <p className={cn("mt-4 text-subhead-regular text-fg-muted")}>
            No controls yet. Create a control to record ownership and
            implementation work.
          </p>
        ) : null}
        {controls.length > 0 ? (
          <div className={cn("mt-4 overflow-x-auto")}>
            <table
              className={cn(
                "w-full border-collapse text-left text-subhead-regular text-fg",
              )}
            >
              <caption className={cn("sr-only")}>Organization controls</caption>
              <thead>
                <tr
                  className={cn(
                    "border-b border-border text-caption-1-regular text-fg-muted",
                  )}
                >
                  <th scope="col" className={cn("px-3 py-2 font-medium")}>
                    Control
                  </th>
                  <th scope="col" className={cn("px-3 py-2 font-medium")}>
                    Implementation
                  </th>
                  <th scope="col" className={cn("px-3 py-2 font-medium")}>
                    Owner
                  </th>
                  <th scope="col" className={cn("px-3 py-2 font-medium")}>
                    Updated
                  </th>
                </tr>
              </thead>
              <tbody>
                {controls.map((control) => (
                  <tr
                    key={control.id}
                    className={cn("border-b border-border last:border-0")}
                  >
                    <th scope="row" className={cn("px-3 py-3 font-medium")}>
                      <button
                        type="button"
                        className={cn(
                          "text-left text-link underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active-500",
                        )}
                        onClick={() => selectControl(control.id)}
                      >
                        {control.title}
                      </button>
                      {control.archivedAt ? (
                        <span
                          className={cn(
                            "ml-2 text-caption-1-regular text-fg-muted",
                          )}
                        >
                          Archived
                        </span>
                      ) : null}
                    </th>
                    <td className={cn("px-3 py-3")}>
                      {statusLabel(control.status)}
                    </td>
                    <td className={cn("px-3 py-3")}>
                      {control.ownerActive
                        ? "Assigned"
                        : "Owner needs reassignment"}
                    </td>
                    <td className={cn("px-3 py-3 tabular-nums")}>
                      {formatDate(control.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {list.hasNextPage ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn("mt-4")}
            disabled={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {list.isFetchingNextPage ? "Loading more…" : "Load more controls"}
          </Button>
        ) : null}
      </SectionCard>

      {creating && canManage ? (
        <SectionCard title="New control">
          <form
            onSubmit={(event) => void submitCreate(event)}
            className={cn("grid gap-4")}
          >
            <label className={labelClass}>
              Control title
              <input
                className={fieldClass}
                value={title}
                maxLength={200}
                required
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label className={labelClass}>
              Description
              <textarea
                className={fieldClass}
                value={description}
                maxLength={4000}
                required
                rows={3}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <label className={labelClass}>
              Owner
              <select
                className={fieldClass}
                value={ownerUserId}
                onChange={(event) => setOwnerUserId(event.target.value)}
              >
                {!owners.data?.owners.some(
                  (owner) => owner.id === ownerUserId,
                ) ? (
                  <option value={ownerUserId}>Current user</option>
                ) : null}
                {owners.data?.owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.displayName}
                  </option>
                ))}
              </select>
            </label>
            {owners.isError ? (
              <p
                role="alert"
                className={cn("text-caption-1-regular text-danger")}
              >
                Owner choices are unavailable. You can assign yourself and retry
                loading members later.
              </p>
            ) : null}
            <p className={cn("text-caption-1-regular text-fg-muted")}>
              Initial implementation status: Not started. Advance it in the
              control detail after creation.
            </p>
            {message ? (
              <p
                role={message === "Control saved." ? "status" : "alert"}
                className={cn(
                  "text-caption-1-regular",
                  message === "Control saved." ? "text-fg" : "text-danger",
                )}
              >
                {message}
              </p>
            ) : null}
            <div className={cn("flex flex-wrap gap-3")}>
              <Button type="submit" loading={saving} disabled={saving}>
                Save control
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreating(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </SectionCard>
      ) : null}

      {selectedId ? (
        <ControlDetailPanel
          key={`${organizationId}:${selectedId}`}
          organizationId={organizationId}
          controlId={selectedId}
          canManage={canManage}
          canViewProducts={canViewProducts}
          canViewEvidence={canViewEvidence}
          activePackKey={activePackKey}
          activeVersionKey={activeVersionKey}
          initialRequirementKey={initialRequirementKey}
        />
      ) : null}
    </section>
  );
}
