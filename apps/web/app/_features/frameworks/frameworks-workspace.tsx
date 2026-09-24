"use client";

import {
  frameworkCatalogResponseSchema,
  type SelectFrameworkInput,
} from "@repo/contracts/frameworks";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { z } from "zod";

import { ApiClientError } from "../../_lib/http/api-client";
import { useMocksReady } from "../../_providers/providers";
import { useSession } from "../../_providers/session-provider";
import {
  PageHeading,
  SectionCard,
} from "../../dashboard/_components/dashboard-chrome";
import {
  useFrameworkCatalog,
  useFrameworkTree,
  useSelectFramework,
} from "./frameworks.queries";

type Pack = z.output<typeof frameworkCatalogResponseSchema>["packs"][number];
type Draft = Readonly<{
  organizationId: string;
  packKey: string;
  versionKey: string;
  enabled: boolean;
}>;

function formatEdition(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}

function saveMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 409)
    return "This selection changed in another session. Review the current selection and retry; your choice is preserved.";
  if (error instanceof ApiClientError && error.status === 403)
    return "You no longer have permission to change framework selections.";
  if (error instanceof ApiClientError && error.kind === "network")
    return "The server is unreachable. Your choice is preserved; retry when the connection returns.";
  if (error instanceof ApiClientError && error.kind === "invalid_request")
    return "The selection is invalid. Choose a listed version and retry.";
  return error instanceof ApiClientError
    ? error.message
    : "The selection could not be saved. Retry without changing your choice.";
}

function defaultDraft(pack: Pack, organizationId: string): Draft {
  return {
    organizationId,
    packKey: pack.packKey,
    versionKey:
      pack.selection?.versionKey ?? pack.versions[0]?.versionKey ?? "",
    enabled: pack.selection?.enabled ?? true,
  };
}

function RequirementTree({
  organizationId,
  packKey,
  versionKey,
}: Readonly<{ organizationId: string; packKey: string; versionKey: string }>) {
  const tree = useFrameworkTree(organizationId, packKey, versionKey, true);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const requirements = useMemo(
    () => tree.data?.pages.flatMap((page) => page.requirements) ?? [],
    [tree.data],
  );

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>) {
    const key = event.currentTarget.dataset.requirementKey;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      if (key) {
        event.preventDefault();
        setOpen((current) => {
          const next = new Set(current);
          if (event.key === "ArrowRight") next.add(key);
          else next.delete(key);
          return next;
        });
      }
      return;
    }
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const buttons = Array.from(
      event.currentTarget
        .closest("[role=tree]")
        ?.querySelectorAll<HTMLButtonElement>("button[role=treeitem]") ?? [],
    );
    const index = buttons.indexOf(event.currentTarget);
    const target =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : index + (event.key === "ArrowDown" ? 1 : -1);
    if (target < 0 || target >= buttons.length) return;
    event.preventDefault();
    setFocusKey(buttons[target]?.dataset.requirementKey ?? null);
    buttons[target]?.focus();
  }

  if (tree.isLoading)
    return (
      <p role="status" className={cn("text-caption-1-regular text-fg-muted")}>
        Loading requirements…
      </p>
    );
  if (tree.isError)
    return (
      <div>
        <p role="alert" className={cn("text-caption-1-regular text-danger")}>
          Requirements are unavailable. The selected version has not changed.
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn("mt-3")}
          onClick={() => void tree.refetch()}
        >
          Retry requirements
        </Button>
      </div>
    );
  if (requirements.length === 0)
    return (
      <p className={cn("text-caption-1-regular text-fg-muted")}>
        This version has no published requirements.
      </p>
    );

  return (
    <>
      <p className={cn("mb-4 text-caption-1-regular text-fg-muted")}>
        Use Tab to enter the tree, Up and Down to move, Right to read, and Left
        to close a requirement.
      </p>
      <ul
        role="tree"
        aria-label="Framework requirements"
        className={cn("divide-y divide-border border-y border-border")}
      >
        {requirements.map((requirement) => {
          const expanded = open.has(requirement.requirementKey);
          const panelId = `requirement-${packKey}-${versionKey}-${requirement.requirementKey}`;
          const hasDescriptiveHeading =
            requirement.heading !== null &&
            requirement.heading !== requirement.identifier;
          const summary = hasDescriptiveHeading
            ? requirement.heading
            : requirement.text.length > 100
              ? `${requirement.text.slice(0, 100).trimEnd()}…`
              : requirement.text;
          return (
            <li
              role="none"
              key={requirement.requirementKey}
              className={cn(
                "py-2",
                requirement.depth > 1 && "pl-4",
                requirement.depth > 2 && "sm:pl-8",
                requirement.depth > 3 && "lg:pl-12",
              )}
            >
              <button
                type="button"
                role="treeitem"
                data-requirement-key={requirement.requirementKey}
                tabIndex={
                  focusKey === null
                    ? requirements[0]?.requirementKey ===
                      requirement.requirementKey
                      ? 0
                      : -1
                    : focusKey === requirement.requirementKey
                      ? 0
                      : -1
                }
                aria-level={requirement.depth + 1}
                aria-expanded={expanded}
                aria-controls={expanded ? panelId : undefined}
                onKeyDown={moveFocus}
                onFocus={() => setFocusKey(requirement.requirementKey)}
                onClick={() =>
                  setOpen((current) => {
                    const next = new Set(current);
                    if (expanded) next.delete(requirement.requirementKey);
                    else next.add(requirement.requirementKey);
                    return next;
                  })
                }
                className={cn(
                  "flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left text-subhead-regular text-fg hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active-500",
                )}
              >
                <span className={cn("min-w-16 shrink-0 font-semibold")}>
                  {requirement.identifier}
                </span>
                <span>{summary}</span>
                <span
                  className={cn(
                    "ml-auto shrink-0 text-caption-1-regular text-fg-muted",
                  )}
                >
                  {expanded ? "Hide" : "Read"}
                </span>
              </button>
              {expanded ? (
                <div
                  id={panelId}
                  className={cn("px-3 pb-3 text-subhead-regular text-fg")}
                >
                  <p className={cn("whitespace-pre-wrap break-words")}>
                    {requirement.text}
                  </p>
                  <p
                    className={cn("mt-2 text-caption-1-regular text-fg-muted")}
                  >
                    Source: {requirement.sourceReference}
                  </p>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {tree.hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("mt-4")}
          disabled={tree.isFetchingNextPage}
          onClick={() => void tree.fetchNextPage()}
        >
          {tree.isFetchingNextPage ? "Loading more…" : "Load more requirements"}
        </Button>
      ) : null}
      {tree.hasNextPage ? (
        <p className={cn("mt-2 text-caption-1-regular text-fg-muted")}>
          More requirements are available.
        </p>
      ) : null}
    </>
  );
}

export function FrameworksWorkspace() {
  const mocksReady = useMocksReady();
  const live = process.env.NEXT_PUBLIC_ENABLE_MOCKS === "false" && mocksReady;
  const { session, permissions, isLoading } = useSession();
  const organizationId = session?.organization?.id ?? null;
  const canView = permissions.can_view_frameworks === true;
  const canManage = permissions.can_manage_frameworks === true;
  const catalog = useFrameworkCatalog(organizationId, live && canView);
  const select = useSelectFramework(organizationId);
  const [activePackKey, setActivePackKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageOrganizationId, setMessageOrganizationId] = useState<
    string | null
  >(null);
  const [saveSucceeded, setSaveSucceeded] = useState(false);
  const retryKey = useRef<{ signature: string; key: string } | null>(null);

  const pack =
    catalog.data?.packs.find(
      (candidate) => candidate.packKey === activePackKey,
    ) ?? catalog.data?.packs[0];
  const choice =
    pack &&
    draft?.packKey === pack.packKey &&
    draft.organizationId === organizationId
      ? draft
      : pack && organizationId
        ? defaultDraft(pack, organizationId)
        : null;
  const version = pack?.versions.find(
    (candidate) => candidate.versionKey === choice?.versionKey,
  );
  const changed = Boolean(
    pack &&
    choice &&
    (!pack.selection ||
      pack.selection.versionKey !== choice.versionKey ||
      pack.selection.enabled !== choice.enabled),
  );

  function changeChoice(next: Draft) {
    setDraft(next);
    setMessage(null);
    setMessageOrganizationId(null);
    setSaveSucceeded(false);
    retryKey.current = null;
  }

  async function save() {
    if (!pack || !choice || !version || !canManage || !changed) return;
    const signature = `${organizationId}:${pack.packKey}:${choice.versionKey}:${choice.enabled}:${pack.selection?.revision ?? "none"}`;
    const idempotencyKey =
      retryKey.current?.signature === signature
        ? retryKey.current.key
        : crypto.randomUUID();
    retryKey.current = { signature, key: idempotencyKey };
    const input: SelectFrameworkInput = {
      versionKey: choice.versionKey,
      enabled: choice.enabled,
      expectedRevision: pack.selection?.revision ?? null,
      idempotencyKey,
    };
    try {
      await select.mutateAsync({ packKey: pack.packKey, input });
      setMessage("Framework selection saved.");
      setMessageOrganizationId(organizationId);
      setSaveSucceeded(true);
      retryKey.current = null;
    } catch (error) {
      setMessage(saveMessage(error));
      setMessageOrganizationId(organizationId);
      setSaveSucceeded(false);
      if (error instanceof ApiClientError && error.status === 409) {
        retryKey.current = null;
        void catalog.refetch();
      }
    }
  }

  return (
    <main className={cn("flex flex-col gap-6 px-6 py-6 lg:px-[30px]")}>
      <PageHeading
        title="Frameworks"
        subtitle="Review published CRA requirements and choose the edition used in this workspace."
      />
      {!live ? (
        <SectionCard title="Local data connection required">
          <p className={cn("text-caption-1-regular text-fg-muted")}>
            Framework packs are available when the CRA API and local Supabase
            stack are enabled.
          </p>
        </SectionCard>
      ) : null}
      {live && isLoading ? (
        <p role="status" className={cn("text-caption-1-regular text-fg-muted")}>
          Checking framework access…
        </p>
      ) : null}
      {live && !isLoading && !canView ? (
        <SectionCard title="Framework access restricted">
          <p className={cn("text-caption-1-regular text-fg-muted")}>
            You do not have permission to view framework requirements.
          </p>
        </SectionCard>
      ) : null}
      {live && canView && organizationId === null && !isLoading ? (
        <SectionCard title="Choose an organization">
          <p className={cn("text-caption-1-regular text-fg-muted")}>
            Select an organization to view its framework selection.
          </p>
        </SectionCard>
      ) : null}
      {live && canView && organizationId !== null ? (
        <>
          {catalog.isLoading ? (
            <p
              role="status"
              className={cn("text-caption-1-regular text-fg-muted")}
            >
              Loading framework editions…
            </p>
          ) : null}
          {catalog.isError ? (
            <SectionCard title="Frameworks unavailable">
              <p
                role="alert"
                className={cn("text-caption-1-regular text-danger")}
              >
                The catalog could not be loaded. No selection was changed.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={cn("mt-3")}
                onClick={() => void catalog.refetch()}
              >
                Retry catalog
              </Button>
            </SectionCard>
          ) : null}
          {catalog.data?.packs.length === 0 ? (
            <SectionCard title="No framework packs">
              <p className={cn("text-caption-1-regular text-fg-muted")}>
                No reviewed framework pack has been published yet.
              </p>
            </SectionCard>
          ) : null}
          {pack ? (
            <>
              <SectionCard title="Workspace selection">
                <div className={cn("grid gap-4 md:grid-cols-2")}>
                  <label
                    className={cn(
                      "flex flex-col gap-2 text-caption-1-regular text-fg",
                    )}
                  >
                    Framework
                    <select
                      value={pack.packKey}
                      onChange={(event) => {
                        setActivePackKey(event.target.value);
                        setMessage(null);
                        setMessageOrganizationId(null);
                        setSaveSucceeded(false);
                        retryKey.current = null;
                      }}
                      className={cn(
                        "h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:outline-2 focus-visible:outline-active-500",
                      )}
                    >
                      {catalog.data?.packs.map((item) => (
                        <option key={item.packKey} value={item.packKey}>
                          {item.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label
                    className={cn(
                      "flex flex-col gap-2 text-caption-1-regular text-fg",
                    )}
                  >
                    Edition
                    <select
                      value={choice?.versionKey ?? ""}
                      onChange={(event) =>
                        choice &&
                        changeChoice({
                          ...choice,
                          versionKey: event.target.value,
                        })
                      }
                      className={cn(
                        "h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:outline-2 focus-visible:outline-active-500",
                      )}
                    >
                      {pack.versions.map((item) => (
                        <option key={item.versionKey} value={item.versionKey}>
                          {formatEdition(item.editionDate)} · {item.language}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label
                  className={cn(
                    "mt-4 flex items-center gap-3 text-subhead-regular text-fg",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={choice?.enabled ?? false}
                    onChange={(event) =>
                      choice &&
                      changeChoice({ ...choice, enabled: event.target.checked })
                    }
                    disabled={!canManage}
                    className={cn(
                      "size-4 accent-active-500 focus-visible:outline-2 focus-visible:outline-active-500",
                    )}
                  />
                  Show this edition in the current workspace
                </label>
                <p className={cn("mt-3 text-caption-1-regular text-fg-muted")}>
                  {pack.selection
                    ? `Current selection: ${pack.selection.versionKey} (${pack.selection.enabled ? "Enabled" : "Disabled"}).`
                    : "No edition selected for this organization."}{" "}
                  Historical versions remain available.
                </p>
                {message && messageOrganizationId === organizationId ? (
                  <p
                    role={saveSucceeded ? "status" : "alert"}
                    className={cn(
                      "mt-3 text-caption-1-regular",
                      saveSucceeded ? "text-fg" : "text-danger",
                    )}
                  >
                    {message}
                  </p>
                ) : null}
                {canManage ? (
                  <Button
                    type="button"
                    className={cn("mt-4")}
                    disabled={!changed || !version || select.isPending}
                    loading={select.isPending}
                    onClick={() => void save()}
                  >
                    Save selection
                  </Button>
                ) : (
                  <p
                    className={cn("mt-4 text-caption-1-regular text-fg-muted")}
                  >
                    You can read requirements but cannot change the organization
                    selection.
                  </p>
                )}
              </SectionCard>
              {version ? (
                <SectionCard title="Requirements preview">
                  <p className={cn("mb-2 text-subhead-regular text-fg")}>
                    {pack.title} · {formatEdition(version.editionDate)}
                  </p>
                  <p
                    className={cn("mb-2 text-caption-1-regular text-fg-muted")}
                  >
                    {pack.selection?.enabled &&
                    pack.selection.versionKey === version.versionKey
                      ? "This edition is enabled in the current workspace."
                      : "Historical or pending edition preview. This edition is not currently enabled in the workspace."}
                  </p>
                  <p
                    className={cn("mb-4 text-caption-1-regular text-fg-muted")}
                  >
                    {version.sourceReference} · {version.attribution} ·{" "}
                    <a
                      className={cn(
                        "text-link underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-active-500",
                      )}
                      href={version.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Read the authoritative source
                    </a>
                  </p>
                  <RequirementTree
                    key={`${organizationId}:${pack.packKey}:${version.versionKey}`}
                    organizationId={organizationId}
                    packKey={pack.packKey}
                    versionKey={version.versionKey}
                  />
                </SectionCard>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
