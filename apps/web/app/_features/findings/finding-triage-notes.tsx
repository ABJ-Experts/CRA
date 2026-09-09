"use client";

import type { VulnerabilityTriageNoteMentionCandidate } from "@repo/contracts/vulnerabilities";
import { Button } from "@repo/ui/button";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  useHasPermission,
  useSession,
} from "../../_providers/session-provider";
import { ApiClientError } from "../../_lib/http/api-client";
import { vulnerabilityTriageApi } from "./triage.api";
import { vulnerabilityTriageKeys } from "./triage.keys";
import {
  useCreateVulnerabilityTriageNoteMutation,
  useDeleteVulnerabilityTriageNoteMutation,
  useUpdateVulnerabilityTriageNoteMutation,
  useVulnerabilityTriageNotesQuery,
} from "./triage.queries";

function message(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 403)
    return "You no longer have access to these notes.";
  if (error instanceof ApiClientError && error.status === 409)
    return "This note changed in another session. Refresh and retry.";
  if (error instanceof ApiClientError && error.kind === "network")
    return "You appear to be offline. Your draft is still here.";
  return "The note could not be saved. Your draft is still here; retry when ready.";
}
function instant(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function FindingTriageNotes({
  findingId,
}: Readonly<{ findingId: string }>) {
  const canEdit = useHasPermission("can_edit_findings");
  const { session } = useSession();
  const notes = useVulnerabilityTriageNotesQuery(findingId, true);
  const create = useCreateVulnerabilityTriageNoteMutation();
  const remove = useDeleteVulnerabilityTriageNoteMutation();
  const update = useUpdateVulnerabilityTriageNoteMutation();
  const [body, setBody] = useState("");
  const [createIdempotencyKey, setCreateIdempotencyKey] = useState(() =>
    crypto.randomUUID(),
  );
  const [mentionSearch, setMentionSearch] = useState("");
  const [mentions, setMentions] = useState<
    readonly VulnerabilityTriageNoteMentionCandidate[]
  >([]);
  const [editing, setEditing] = useState<Readonly<{
    id: string;
    version: number;
    body: string;
    mentionedUserIds: readonly string[];
    idempotencyKey: string;
  }> | null>(null);
  const candidates = useQuery({
    queryKey: [
      ...vulnerabilityTriageKeys.notesForFinding(findingId),
      "candidates",
      mentionSearch,
    ],
    enabled: canEdit && mentionSearch.length > 0,
    retry: false,
    queryFn: ({ signal }) =>
      vulnerabilityTriageApi.noteMentionCandidates(
        findingId,
        { q: mentionSearch, limit: 10 },
        signal,
      ),
  });
  const remaining = 4000 - body.length;
  const candidateList = candidates.data?.members ?? [];
  const selectedIds = useMemo(
    () => new Set(mentions.map((item) => item.userId)),
    [mentions],
  );
  const save = async () => {
    if (!body.trim() || body.length > 4000 || create.isPending) return;
    try {
      await create.mutateAsync({
        findingId,
        input: {
          body: body.trim(),
          mentionedUserIds: mentions.map((item) => item.userId),
          idempotencyKey: createIdempotencyKey,
        },
      });
      setBody("");
      setMentions([]);
      setMentionSearch("");
      setCreateIdempotencyKey(crypto.randomUUID());
    } catch {
      /* Draft deliberately remains intact. */
    }
  };
  const saveEdit = async () => {
    if (!editing || !editing.body.trim() || update.isPending) return;
    try {
      await update.mutateAsync({
        findingId,
        noteId: editing.id,
        input: {
          body: editing.body.trim(),
          mentionedUserIds: [...editing.mentionedUserIds],
          expectedVersion: editing.version,
          idempotencyKey: editing.idempotencyKey,
        },
      });
      setEditing(null);
    } catch {
      /* Preserve the edit draft for a deliberate retry. */
    }
  };
  return (
    <section
      className="mt-6 border-t border-border pt-6"
      aria-labelledby="finding-notes-heading"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3
          id="finding-notes-heading"
          className="text-subhead-semibold text-fg"
        >
          Internal triage notes
        </h3>
        <span className="text-caption-1-regular text-fg-muted">
          Operational only
        </span>
      </div>
      {!canEdit ? (
        <p className="mt-3 text-caption-1-regular text-fg-muted">
          You can view notes, but cannot add or change them.
        </p>
      ) : (
        <div className="mt-3 grid gap-3">
          <label
            className="grid gap-1 text-caption-1-semibold text-fg"
            htmlFor={`note-${findingId}`}
          >
            Add a note
            <textarea
              id={`note-${findingId}`}
              value={body}
              maxLength={4000}
              onChange={(event) => {
                setBody(event.target.value);
                setCreateIdempotencyKey(crypto.randomUUID());
              }}
              placeholder="Add an internal triage note"
              className="min-h-24 rounded-lg border border-border bg-canvas p-3 text-caption-1-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
              aria-describedby={`note-count-${findingId}`}
            />
          </label>
          <div>
            <label
              className="text-caption-1-semibold text-fg"
              htmlFor={`mention-${findingId}`}
            >
              Mention authorized members
            </label>
            <input
              id={`mention-${findingId}`}
              value={mentionSearch}
              onChange={(event) => setMentionSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setMentionSearch("");
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  document
                    .querySelector<HTMLButtonElement>(
                      `#mention-list-${findingId} button`,
                    )
                    ?.focus();
                }
                if (event.key === "Enter" && candidateList[0]) {
                  event.preventDefault();
                  const candidate = candidateList[0];
                  if (
                    !selectedIds.has(candidate.userId) &&
                    mentions.length < 20
                  ) {
                    setMentions([...mentions, candidate]);
                    setCreateIdempotencyKey(crypto.randomUUID());
                  }
                  setMentionSearch("");
                }
              }}
              placeholder="Search members"
              className="mt-1 w-full rounded-lg border border-border bg-canvas px-3 py-2 text-caption-1-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
              aria-autocomplete="list"
              aria-controls={`mention-list-${findingId}`}
            />
            {candidates.isLoading ? (
              <p className="mt-1 text-caption-1-regular text-fg-muted">
                Searching members…
              </p>
            ) : candidateList.length > 0 ? (
              <ul
                id={`mention-list-${findingId}`}
                className="mt-1 border border-border bg-canvas"
                role="listbox"
              >
                {candidateList.map((candidate) => (
                  <li key={candidate.userId}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-caption-1-regular text-fg hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-focus"
                      onClick={() => {
                        if (
                          !selectedIds.has(candidate.userId) &&
                          mentions.length < 20
                        ) {
                          setMentions([...mentions, candidate]);
                          setCreateIdempotencyKey(crypto.randomUUID());
                        }
                        setMentionSearch("");
                      }}
                    >
                      {candidate.displayName}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {mentions.length > 0 ? (
              <p className="mt-1 text-caption-1-regular text-fg-muted">
                Mentions:{" "}
                {mentions.map((member) => (
                  <button
                    key={member.userId}
                    type="button"
                    className="underline underline-offset-2"
                    onClick={() => {
                      setMentions(
                        mentions.filter(
                          (entry) => entry.userId !== member.userId,
                        ),
                      );
                      setCreateIdempotencyKey(crypto.randomUUID());
                    }}
                  >
                    {member.displayName} remove{" "}
                  </button>
                ))}
              </p>
            ) : null}
          </div>
          <div className="flex items-center justify-between gap-3">
            <span
              id={`note-count-${findingId}`}
              className="text-caption-1-regular text-fg-muted"
            >
              {remaining} characters remaining · {mentions.length}/20 mentions
            </span>
            <Button
              size="sm"
              onClick={() => void save()}
              disabled={!body.trim() || create.isPending}
            >
              {create.isPending ? "Saving…" : "Save note"}
            </Button>
          </div>
          {create.error ? (
            <p role="alert" className="text-caption-1-regular text-danger">
              Save failed: {message(create.error)}{" "}
              <button
                type="button"
                className="underline"
                onClick={() => void save()}
              >
                Retry
              </button>
            </p>
          ) : null}
        </div>
      )}
      {notes.isLoading ? (
        <p className="mt-4 text-caption-1-regular text-fg-muted">
          Loading notes…
        </p>
      ) : notes.error ? (
        <p role="alert" className="mt-4 text-caption-1-regular text-danger">
          Notes are unavailable.{" "}
          <button
            type="button"
            className="underline"
            onClick={() => void notes.refetch()}
          >
            Retry
          </button>
        </p>
      ) : notes.data?.notes.length === 0 ? (
        <p className="mt-4 text-caption-1-regular text-fg-muted">
          No internal notes have been added.
        </p>
      ) : (
        <ol className="mt-4 grid gap-3">
          {notes.data?.notes.map((note) => {
            const authorOwns =
              canEdit &&
              note.createdBy.userId === session?.user.id &&
              !note.deletedAt;
            const isEditing = editing?.id === note.id;
            return (
              <li key={note.id} className="border border-border p-3">
                <div className="flex flex-wrap justify-between gap-2 text-caption-1-regular text-fg-muted">
                  <span>
                    {note.createdBy.displayName} · {instant(note.createdAt)}
                    {note.updatedBy ? " · edited" : ""}
                  </span>
                  {authorOwns ? (
                    <span className="flex gap-2">
                      <Button
                        size="sm"
                        variant="gap"
                        tone="grey"
                        onClick={() =>
                          setEditing({
                            id: note.id,
                            version: note.version,
                            body: note.body ?? "",
                            mentionedUserIds: note.mentions
                              .filter((member) => member.status === "active")
                              .map((member) => member.userId),
                            idempotencyKey: crypto.randomUUID(),
                          })
                        }
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="gap"
                        tone="grey"
                        onClick={() =>
                          remove.mutate({
                            findingId,
                            noteId: note.id,
                            input: {
                              expectedVersion: note.version,
                              idempotencyKey: crypto.randomUUID(),
                            },
                          })
                        }
                      >
                        Delete
                      </Button>
                    </span>
                  ) : null}
                </div>
                {note.deletedAt ? (
                  <p className="mt-2 text-caption-1-regular text-fg-muted">
                    This note was deleted by{" "}
                    {note.deletedBy?.displayName ?? "its author"}.
                  </p>
                ) : isEditing ? (
                  <div className="mt-2 grid gap-2">
                    <label className="sr-only" htmlFor={`edit-note-${note.id}`}>
                      Edit triage note
                    </label>
                    <textarea
                      id={`edit-note-${note.id}`}
                      value={editing.body}
                      maxLength={4000}
                      onChange={(event) =>
                        setEditing({
                          ...editing,
                          body: event.target.value,
                          idempotencyKey: crypto.randomUUID(),
                        })
                      }
                      className="min-h-20 rounded-lg border border-border bg-canvas p-3 text-caption-1-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => void saveEdit()}
                        disabled={!editing.body.trim() || update.isPending}
                      >
                        {update.isPending ? "Saving…" : "Save changes"}
                      </Button>
                      <Button
                        size="sm"
                        variant="gap"
                        tone="grey"
                        onClick={() => setEditing(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                    {update.error ? (
                      <p
                        role="alert"
                        className="text-caption-1-regular text-danger"
                      >
                        {message(update.error)}{" "}
                        <button
                          type="button"
                          className="underline"
                          onClick={() => void saveEdit()}
                        >
                          Retry
                        </button>
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-2 whitespace-pre-wrap text-caption-1-regular text-fg">
                    {note.body}
                  </p>
                )}
                {note.mentions.length > 0 && !note.deletedAt ? (
                  <p className="mt-2 text-caption-1-regular text-fg-muted">
                    Mentioned:{" "}
                    {note.mentions
                      .map((member) => member.displayName)
                      .join(", ")}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
