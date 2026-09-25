"use client";

import { customFrameworkImportSchema } from "@repo/contracts/frameworks";
import type {
  CustomFrameworkContent,
  CustomFrameworkDetailResponse,
  CustomFrameworkImport,
  CustomFrameworkListResponse,
} from "@repo/contracts/frameworks";
import { Button } from "@repo/ui/button";
import { ZodError } from "zod";
import { cn } from "@repo/ui/cn";
import { useEffect, useMemo, useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import { SectionCard } from "../../dashboard/_components/dashboard-chrome";
import { customFrameworksApi } from "./custom-frameworks.api";
import {
  useCustomFrameworkCommand,
  useCustomFrameworkDetail,
  useCustomFrameworks,
} from "./custom-frameworks.queries";

type DraftSource = "new" | "existing";
type ExportChoice = "draft" | "published";
type DownloadState = Readonly<{ href: string; filename: string }>;
type FieldError = Readonly<{ path: string; message: string }>;

type EditorState = Readonly<{
  source: DraftSource;
  draftId: string | null;
  revision: number | null;
  status: CustomFrameworkListResponse["items"][number]["status"] | null;
  latestVersionKey: string | null;
  text: string;
}>;

type Requirement = CustomFrameworkContent["requirements"][number];

const sampleImport: CustomFrameworkImport = {
  schemaVersion: 1,
  kind: "customer_defined",
  content: {
    title: "Internal product controls",
    editionDate: "2026-09-25",
    language: "en",
    attribution: "Created by the organization",
    requirements: [
      {
        requirementKey: "control-1",
        identifier: "INT-1",
        parentKey: null,
        position: 1,
        heading: "Document design",
        text: "Keep design decisions available for review.",
        sourceReference: "Internal policy 1",
      },
    ],
  },
};

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function importPayload(content: CustomFrameworkContent): CustomFrameworkImport {
  return { schemaVersion: 1, kind: "customer_defined", content };
}

function newEditor(): EditorState {
  return {
    source: "new",
    draftId: null,
    revision: null,
    status: null,
    latestVersionKey: null,
    text: pretty(sampleImport),
  };
}

function editorFromDetail(detail: CustomFrameworkDetailResponse): EditorState {
  return {
    source: "existing",
    draftId: detail.draftId,
    revision: detail.revision,
    status: detail.status,
    latestVersionKey: detail.latestVersionKey,
    text: pretty(importPayload(detail.content)),
  };
}

function randomKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}`;
}

function importError(error: unknown): string {
  if (error instanceof SyntaxError) return "Import JSON is not valid.";
  if (error instanceof ApiClientError && error.kind === "invalid_request")
    return "Import content does not match the custom framework schema.";
  return "The custom framework could not be imported.";
}

function commandError(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 409)
    return "This custom framework changed in another session. Your editor content is preserved; reload the draft before retrying.";
  if (error instanceof ApiClientError && error.status === 403)
    return "You no longer have permission to manage custom frameworks.";
  if (error instanceof ApiClientError && error.kind === "network")
    return "The server is unreachable. Your editor content is preserved.";
  if (error instanceof ApiClientError && error.kind === "invalid_request")
    return "The custom framework content is invalid.";
  return error instanceof ApiClientError
    ? error.message
    : "The custom framework command failed.";
}

function parseImportPayload(text: string): CustomFrameworkImport {
  const payload = JSON.parse(text) as unknown;
  return customFrameworkImportSchema.parse(payload);
}

function parseEditorContent(text: string): CustomFrameworkContent {
  return parseImportPayload(text).content;
}

function fieldErrorsFrom(error: unknown): readonly FieldError[] {
  if (error instanceof SyntaxError) {
    return [{ path: "JSON", message: "JSON syntax is invalid." }];
  }
  if (error instanceof ZodError) {
    return error.issues.map((issue) => ({
      path: issue.path.length > 0 ? issue.path.join(".") : "root",
      message: issue.message,
    }));
  }
  return [];
}

function statusLabel(
  status: CustomFrameworkListResponse["items"][number]["status"],
): string {
  if (status === "update_available") return "Update available";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function safeFilename(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "custom-framework"
  );
}

function fieldClass(extra?: string): string {
  return cn(
    "mt-2 w-full min-w-0 max-w-full rounded-xl border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg focus-visible:outline-2 focus-visible:outline-active-500",
    extra,
  );
}

function nextRequirement(position: number): Requirement {
  return {
    requirementKey: `control-${position}`,
    identifier: `INT-${position}`,
    parentKey: null,
    position,
    heading: "New requirement",
    text: "Describe the requirement.",
    sourceReference: "Internal policy",
  };
}

export function CustomFrameworksPanel({
  organizationId,
  canManage,
}: Readonly<{ organizationId: string; canManage: boolean }>) {
  const [listOffset, setListOffset] = useState(0);
  const list = useCustomFrameworks(organizationId, true, listOffset);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const detail = useCustomFrameworkDetail(
    organizationId,
    selectedDraftId,
    selectedDraftId !== null,
  );
  const command = useCustomFrameworkCommand(organizationId);
  const [editor, setEditor] = useState<EditorState>(() => newEditor());
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [exportChoice, setExportChoice] = useState<ExportChoice>("draft");
  const [exportText, setExportText] = useState<string>(() =>
    pretty(sampleImport),
  );
  const [exportLoading, setExportLoading] = useState(false);
  const [download, setDownload] = useState<DownloadState | null>(null);
  const [savedText, setSavedText] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<readonly FieldError[]>([]);
  const [serverRefreshPending, setServerRefreshPending] = useState(false);

  useEffect(() => {
    if (!detail.data) return;
    const next = editorFromDetail(detail.data);
    setEditor((current) => {
      const hasDirtyCurrent =
        current.draftId === detail.data.draftId &&
        savedText !== null &&
        current.text !== savedText;
      if (hasDirtyCurrent) {
        setServerRefreshPending(true);
        setMessage(
          "Server draft changed while your unsaved edits are preserved. Reload the server draft or save and resolve any conflict.",
        );
        setSuccess(false);
        return current;
      }
      setExportChoice("draft");
      setExportText(next.text);
      setDownload(null);
      setSavedText(next.text);
      setServerRefreshPending(false);
      setFieldErrors([]);
      setMessage(null);
      setSuccess(false);
      return next;
    });
  }, [detail.data, savedText]);

  const parsedContent = useMemo(() => {
    try {
      return parseEditorContent(editor.text);
    } catch {
      return null;
    }
  }, [editor.text]);

  useEffect(() => {
    return () => {
      if (download && typeof URL.revokeObjectURL === "function")
        URL.revokeObjectURL(download.href);
    };
  }, [download]);

  function updateDownload(
    text: string,
    content: CustomFrameworkContent,
    versionKey: string | null,
  ) {
    setDownload((current) => {
      if (current) URL.revokeObjectURL(current.href);
      const href = URL.createObjectURL(
        new Blob([text], { type: "application/json" }),
      );
      const suffix = versionKey ? `-${versionKey}` : "-draft";
      return {
        href,
        filename: `${safeFilename(content.title)}${suffix}.json`,
      };
    });
  }

  const parsedExport = useMemo(() => {
    try {
      return pretty(importPayload(parseEditorContent(editor.text)));
    } catch {
      return editor.text;
    }
  }, [editor.text]);

  function updateContent(next: CustomFrameworkContent) {
    const text = pretty(importPayload(next));
    setEditor((current) => ({ ...current, text }));
    setExportChoice("draft");
    setExportText(text);
    setDownload(null);
    setFieldErrors([]);
    setMessage(null);
    setSuccess(false);
  }

  function updateRequirement(index: number, patch: Partial<Requirement>) {
    if (!parsedContent) return;
    updateContent({
      ...parsedContent,
      requirements: parsedContent.requirements.map((requirement, current) =>
        current === index ? { ...requirement, ...patch } : requirement,
      ),
    });
  }

  async function runCreateOrSave() {
    try {
      const content = parseEditorContent(editor.text);
      const saved = pretty(importPayload(content));
      const result = await command.mutateAsync({
        draftId: editor.draftId,
        input:
          editor.source === "new" || editor.draftId === null
            ? {
                action: "create_draft",
                content,
                idempotencyKey: randomKey(),
              }
            : {
                action: "save_draft",
                content,
                expectedRevision: editor.revision ?? 1,
                idempotencyKey: randomKey(),
              },
      });
      setSelectedDraftId(result.draftId);
      setEditor((current) => ({
        ...current,
        source: "existing",
        draftId: result.draftId,
        revision: result.revision,
        status: result.status,
        latestVersionKey: result.latestVersionKey,
        text: saved,
      }));
      setSavedText(saved);
      setFieldErrors([]);
      setServerRefreshPending(false);
      setMessage("Draft saved.");
      setSuccess(true);
    } catch (error) {
      const errors = fieldErrorsFrom(error);
      setFieldErrors(errors);
      setMessage(errors.length > 0 ? importError(error) : commandError(error));
      setSuccess(false);
    }
  }

  async function runRevisioned(
    action: "publish_version" | "archive_draft" | "restore_draft",
  ) {
    if (editor.draftId === null || editor.revision === null) return;
    try {
      const result = await command.mutateAsync({
        draftId: editor.draftId,
        input: {
          action,
          expectedRevision: editor.revision,
          idempotencyKey: randomKey(),
        },
      });
      setEditor((current) => ({
        ...current,
        revision: result.revision,
        status: result.status,
        latestVersionKey: result.latestVersionKey,
      }));
      setMessage(
        action === "publish_version"
          ? "Version published."
          : action === "archive_draft"
            ? "Draft archived."
            : "Draft restored.",
      );
      setSuccess(true);
    } catch (error) {
      setMessage(commandError(error));
      setSuccess(false);
    }
  }

  async function loadImport() {
    try {
      const parsed = parseImportPayload(editor.text);
      const validation = await customFrameworksApi.validate(parsed);
      if (!validation.valid) {
        setFieldErrors(validation.errors);
        setMessage("Import validation found field errors.");
        setSuccess(false);
        return;
      }
      updateContent(parsed.content);
      setEditor((current) => ({
        ...current,
        source: "new",
        draftId: null,
        revision: null,
        status: null,
        latestVersionKey: null,
      }));
      setSavedText(null);
      setServerRefreshPending(false);
      setFieldErrors([]);
      setMessage("Import is valid. Save it to create a draft.");
      setSuccess(true);
    } catch (error) {
      setFieldErrors(fieldErrorsFrom(error));
      setMessage(importError(error));
      setSuccess(false);
    }
  }

  function reloadServerDraft() {
    if (!detail.data) return;
    const next = editorFromDetail(detail.data);
    setEditor(next);
    setExportChoice("draft");
    setExportText(next.text);
    setDownload(null);
    setSavedText(next.text);
    setServerRefreshPending(false);
    setFieldErrors([]);
    setMessage("Server draft reloaded.");
    setSuccess(true);
  }

  async function loadExport() {
    if (exportChoice === "draft") {
      try {
        const content = parseEditorContent(editor.text);
        setExportText(parsedExport);
        updateDownload(parsedExport, content, null);
        setFieldErrors([]);
        setMessage("Draft export prepared.");
        setSuccess(true);
      } catch (error) {
        setFieldErrors(fieldErrorsFrom(error));
        setMessage(importError(error));
        setSuccess(false);
      }
      return;
    }
    if (editor.draftId === null || editor.latestVersionKey === null) return;
    setExportLoading(true);
    try {
      const exported = await customFrameworksApi.export(
        editor.draftId,
        editor.latestVersionKey,
      );
      const text = pretty(exported);
      setExportText(text);
      updateDownload(text, exported.content, editor.latestVersionKey);
      setFieldErrors([]);
      setMessage(
        `Published version ${editor.latestVersionKey} export prepared.`,
      );
      setSuccess(true);
    } catch (error) {
      setMessage(commandError(error));
      setSuccess(false);
    } finally {
      setExportLoading(false);
    }
  }

  const hasUnsavedEdits =
    editor.source === "existing" &&
    savedText !== null &&
    editor.text !== savedText;
  const canPrepareExport =
    exportChoice === "published" || parsedContent !== null;

  return (
    <SectionCard title="Custom frameworks">
      <div
        className={cn(
          "grid min-w-0 max-w-full overflow-hidden gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]",
        )}
      >
        <div className={cn("min-w-0 max-w-full")}>
          <p className={cn("text-subhead-regular text-fg-muted")}>
            Import organization-owned requirement packs, preserve drafts, and
            publish reviewed versions for workspace selection.
          </p>
          {list.isLoading ? (
            <p
              role="status"
              className={cn("mt-4 text-subhead-regular text-fg-muted")}
            >
              Loading custom frameworks…
            </p>
          ) : list.isError ? (
            <p
              role="alert"
              className={cn("mt-4 text-caption-1-regular text-danger")}
            >
              Custom frameworks could not be loaded.
            </p>
          ) : (
            <>
              <ul
                className={cn("mt-4 min-w-0 max-w-full space-y-2")}
                aria-label="Custom framework drafts"
              >
                {(list.data?.items ?? []).map((item) => (
                  <li key={item.draftId} className={cn("min-w-0 max-w-full")}>
                    <button
                      type="button"
                      onClick={() => setSelectedDraftId(item.draftId)}
                      className={cn(
                        "w-full min-w-0 max-w-full rounded-xl border border-border bg-canvas p-3 text-left focus-visible:outline-2 focus-visible:outline-active-500",
                        selectedDraftId === item.draftId
                          ? "ring-2 ring-active-500"
                          : "",
                      )}
                    >
                      <span
                        className={cn(
                          "block truncate text-subhead-regular text-fg",
                        )}
                      >
                        {item.title}
                      </span>
                      <span
                        className={cn(
                          "mt-1 block break-words text-caption-1-regular text-fg-muted",
                        )}
                      >
                        {statusLabel(item.status)} · revision {item.revision}
                        {item.latestVersionKey
                          ? ` · ${item.latestVersionKey}`
                          : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <nav
                aria-label="Custom framework pages"
                className={cn("mt-3 flex items-center gap-3")}
              >
                <Button
                  type="button"
                  variant="outline"
                  disabled={listOffset === 0}
                  onClick={() =>
                    setListOffset((offset) => Math.max(0, offset - 20))
                  }
                >
                  Previous custom frameworks
                </Button>
                <span
                  className={cn("text-caption-1-regular text-fg-muted")}
                  aria-live="polite"
                >
                  Page {Math.floor(listOffset / 20) + 1}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    list.data?.nextOffset === null ||
                    list.data?.nextOffset === undefined
                  }
                  onClick={() =>
                    setListOffset(list.data?.nextOffset ?? listOffset)
                  }
                >
                  Next custom frameworks
                </Button>
              </nav>
            </>
          )}
          <Button
            type="button"
            variant="outline"
            className={cn("mt-4")}
            onClick={() => {
              const next = newEditor();
              setSelectedDraftId(null);
              setEditor(next);
              setExportChoice("draft");
              setExportText(next.text);
              setMessage(null);
              setSuccess(false);
            }}
          >
            Start new custom framework
          </Button>
        </div>

        <div className={cn("min-w-0 max-w-full overflow-hidden space-y-6")}>
          {parsedContent ? (
            <fieldset
              className={cn(
                "min-w-0 max-w-full [min-inline-size:0] rounded-2xl border border-border p-4",
              )}
            >
              <legend className={cn("px-1 text-subhead-semibold text-fg")}>
                Framework details
              </legend>
              <div className={cn("grid min-w-0 gap-4 md:grid-cols-2")}>
                <label className={cn("block text-caption-1-regular text-fg")}>
                  Title
                  <input
                    value={parsedContent.title}
                    onChange={(event) =>
                      updateContent({
                        ...parsedContent,
                        title: event.target.value,
                      })
                    }
                    className={fieldClass()}
                  />
                </label>
                <label className={cn("block text-caption-1-regular text-fg")}>
                  Edition date
                  <input
                    type="date"
                    value={parsedContent.editionDate}
                    onChange={(event) =>
                      updateContent({
                        ...parsedContent,
                        editionDate: event.target.value,
                      })
                    }
                    className={fieldClass()}
                  />
                </label>
                <label className={cn("block text-caption-1-regular text-fg")}>
                  Language
                  <input
                    value={parsedContent.language}
                    onChange={(event) =>
                      updateContent({
                        ...parsedContent,
                        language: event.target.value,
                      })
                    }
                    className={fieldClass()}
                  />
                </label>
                <label className={cn("block text-caption-1-regular text-fg")}>
                  Source URL
                  <input
                    value={parsedContent.sourceUrl ?? ""}
                    onChange={(event) =>
                      updateContent({
                        ...parsedContent,
                        sourceUrl:
                          event.target.value.trim() === ""
                            ? undefined
                            : event.target.value,
                      })
                    }
                    className={fieldClass()}
                  />
                </label>
              </div>
              <label
                className={cn("mt-4 block text-caption-1-regular text-fg")}
              >
                Attribution
                <textarea
                  value={parsedContent.attribution}
                  onChange={(event) =>
                    updateContent({
                      ...parsedContent,
                      attribution: event.target.value,
                    })
                  }
                  rows={3}
                  className={fieldClass()}
                />
              </label>
            </fieldset>
          ) : (
            <p
              role="alert"
              className={cn("text-caption-1-regular text-danger")}
            >
              The JSON import is not valid. Fix it or load the sample before
              using the form fields.
            </p>
          )}

          {parsedContent ? (
            <fieldset
              className={cn(
                "min-w-0 max-w-full [min-inline-size:0] rounded-2xl border border-border p-4",
              )}
            >
              <legend className={cn("px-1 text-subhead-semibold text-fg")}>
                Requirements
              </legend>
              <div
                className={cn(
                  "w-full min-w-0 max-w-full overflow-auto overscroll-x-contain [min-inline-size:0] [contain:inline-size]",
                )}
              >
                <table
                  className={cn(
                    "w-full min-w-0 border-separate border-spacing-y-2 sm:w-max sm:min-w-[52rem] sm:max-w-none",
                  )}
                >
                  <thead>
                    <tr
                      className={cn(
                        "text-left text-caption-1-regular text-fg-muted",
                      )}
                    >
                      <th scope="col" className={cn("pr-3")}>
                        Key
                      </th>
                      <th scope="col" className={cn("pr-3")}>
                        Identifier
                      </th>
                      <th scope="col" className={cn("pr-3")}>
                        Heading
                      </th>
                      <th scope="col" className={cn("pr-3")}>
                        Text
                      </th>
                      <th scope="col">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedContent.requirements
                      .slice(0, 5)
                      .map((requirement, index) => (
                        <tr key={`${requirement.requirementKey}:${index}`}>
                          <td className={cn("pr-3 align-top")}>
                            <input
                              aria-label={`Requirement ${index + 1} key`}
                              value={requirement.requirementKey}
                              onChange={(event) =>
                                updateRequirement(index, {
                                  requirementKey: event.target.value,
                                })
                              }
                              className={fieldClass("min-w-0 sm:min-w-[10rem]")}
                            />
                          </td>
                          <td className={cn("pr-3 align-top")}>
                            <input
                              aria-label={`Requirement ${index + 1} identifier`}
                              value={requirement.identifier}
                              onChange={(event) =>
                                updateRequirement(index, {
                                  identifier: event.target.value,
                                })
                              }
                              className={fieldClass("min-w-0 sm:min-w-[8rem]")}
                            />
                          </td>
                          <td className={cn("pr-3 align-top")}>
                            <input
                              aria-label={`Requirement ${index + 1} heading`}
                              value={requirement.heading ?? ""}
                              onChange={(event) =>
                                updateRequirement(index, {
                                  heading:
                                    event.target.value.trim() === ""
                                      ? null
                                      : event.target.value,
                                })
                              }
                              className={fieldClass("min-w-0 sm:min-w-[12rem]")}
                            />
                          </td>
                          <td className={cn("pr-3 align-top")}>
                            <textarea
                              aria-label={`Requirement ${index + 1} text`}
                              value={requirement.text}
                              onChange={(event) =>
                                updateRequirement(index, {
                                  text: event.target.value,
                                })
                              }
                              rows={3}
                              className={fieldClass("min-w-0 sm:min-w-[18rem]")}
                            />
                          </td>
                          <td className={cn("align-top")}>
                            <input
                              aria-label={`Requirement ${index + 1} source reference`}
                              value={requirement.sourceReference}
                              onChange={(event) =>
                                updateRequirement(index, {
                                  sourceReference: event.target.value,
                                })
                              }
                              className={fieldClass("min-w-0 sm:min-w-[12rem]")}
                            />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {parsedContent.requirements.length > 5 ? (
                <p className={cn("mt-2 text-caption-1-regular text-fg-muted")}>
                  Showing the first five requirements. Use JSON import for bulk
                  edits.
                </p>
              ) : null}
              <Button
                type="button"
                variant="outline"
                className={cn("mt-3")}
                onClick={() =>
                  updateContent({
                    ...parsedContent,
                    requirements: [
                      ...parsedContent.requirements,
                      nextRequirement(parsedContent.requirements.length + 1),
                    ],
                  })
                }
              >
                Add requirement
              </Button>
            </fieldset>
          ) : null}

          <div>
            <div className={cn("flex flex-wrap gap-2")}>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const text = pretty(sampleImport);
                  setEditor((current) => ({ ...current, text }));
                  setExportChoice("draft");
                  setExportText(text);
                  setDownload(null);
                  setFieldErrors([]);
                  setMessage(null);
                  setSuccess(false);
                }}
              >
                Load sample
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void loadImport()}
              >
                Validate JSON import
              </Button>
            </div>
            <label className={cn("mt-4 block text-caption-1-regular text-fg")}>
              JSON import
              <textarea
                value={editor.text}
                onChange={(event) => {
                  setEditor((current) => ({
                    ...current,
                    text: event.target.value,
                  }));
                  setExportChoice("draft");
                  setExportText(event.target.value);
                  setDownload(null);
                  setFieldErrors([]);
                  setMessage(null);
                  setSuccess(false);
                }}
                rows={8}
                spellCheck={false}
                className={cn(
                  "mt-2 w-full min-w-0 max-w-full rounded-xl border border-border bg-canvas p-3 font-mono text-caption-1-regular text-fg focus-visible:outline-2 focus-visible:outline-active-500",
                )}
              />
            </label>
          </div>

          {fieldErrors.length > 0 ? (
            <div
              role="alert"
              className={cn("rounded-xl border border-danger/40 p-3")}
            >
              <p className={cn("text-caption-1-semibold text-danger")}>
                Import field errors
              </p>
              <ul
                aria-label="Import validation errors"
                className={cn(
                  "mt-2 space-y-1 text-caption-1-regular text-danger",
                )}
              >
                {fieldErrors.map((error) => (
                  <li key={`${error.path}:${error.message}`}>
                    <code>{error.path}</code>: {error.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {message ? (
            <p
              role={success ? "status" : "alert"}
              className={cn(
                "text-caption-1-regular",
                success ? "text-fg" : "text-danger",
              )}
            >
              {message}
            </p>
          ) : null}

          {serverRefreshPending ? (
            <Button type="button" variant="outline" onClick={reloadServerDraft}>
              Reload server draft
            </Button>
          ) : null}

          {hasUnsavedEdits ? (
            <p className={cn("text-caption-1-regular text-fg-muted")}>
              Save the draft before publishing this edited content.
            </p>
          ) : null}

          <div className={cn("flex flex-wrap gap-2")}>
            <Button
              type="button"
              disabled={
                !canManage || command.isPending || parsedContent === null
              }
              loading={command.isPending}
              onClick={() => void runCreateOrSave()}
            >
              {editor.source === "new" ? "Save imported draft" : "Save draft"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={
                !canManage ||
                editor.draftId === null ||
                editor.status === "archived" ||
                hasUnsavedEdits ||
                command.isPending
              }
              onClick={() => void runRevisioned("publish_version")}
            >
              Publish version
            </Button>
            {editor.status === "archived" ? (
              <Button
                type="button"
                variant="outline"
                disabled={
                  !canManage || editor.draftId === null || command.isPending
                }
                onClick={() => void runRevisioned("restore_draft")}
              >
                Restore draft
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                disabled={
                  !canManage || editor.draftId === null || command.isPending
                }
                onClick={() => void runRevisioned("archive_draft")}
              >
                Archive draft
              </Button>
            )}
          </div>

          <fieldset
            className={cn(
              "min-w-0 max-w-full [min-inline-size:0] rounded-2xl border border-border p-4",
            )}
          >
            <legend className={cn("px-1 text-subhead-semibold text-fg")}>
              Export
            </legend>
            <div
              className={cn(
                "flex flex-wrap gap-4 text-subhead-regular text-fg",
              )}
            >
              <label className={cn("flex items-center gap-2")}>
                <input
                  type="radio"
                  name="custom-framework-export"
                  value="draft"
                  checked={exportChoice === "draft"}
                  onChange={() => setExportChoice("draft")}
                  className={cn(
                    "size-4 accent-active-500 focus-visible:outline-2 focus-visible:outline-active-500",
                  )}
                />
                Current draft
              </label>
              <label
                className={cn(
                  "flex items-center gap-2",
                  editor.latestVersionKey ? "" : "text-fg-muted",
                )}
              >
                <input
                  type="radio"
                  name="custom-framework-export"
                  value="published"
                  checked={exportChoice === "published"}
                  disabled={!editor.latestVersionKey}
                  onChange={() => setExportChoice("published")}
                  className={cn(
                    "size-4 accent-active-500 focus-visible:outline-2 focus-visible:outline-active-500",
                  )}
                />
                Published version {editor.latestVersionKey ?? "unavailable"}
              </label>
            </div>
            <Button
              type="button"
              variant="outline"
              className={cn("mt-3")}
              loading={exportLoading}
              disabled={
                exportLoading ||
                !canPrepareExport ||
                (exportChoice === "published" &&
                  (!editor.draftId || !editor.latestVersionKey))
              }
              onClick={() => void loadExport()}
            >
              Prepare export
            </Button>
            {!canPrepareExport && exportChoice === "draft" ? (
              <p className={cn("mt-3 text-caption-1-regular text-fg-muted")}>
                Fix JSON import errors before preparing a draft export.
              </p>
            ) : null}
            {download ? (
              <Button asChild variant="outline" className={cn("mt-3")}>
                <a href={download.href} download={download.filename}>
                  Download JSON
                </a>
              </Button>
            ) : null}
            <label className={cn("mt-4 block text-caption-1-regular text-fg")}>
              Export JSON
              <textarea
                readOnly
                value={exportText}
                rows={8}
                className={cn(
                  "mt-2 w-full min-w-0 max-w-full rounded-xl border border-border bg-canvas p-3 font-mono text-caption-1-regular text-fg focus-visible:outline-2 focus-visible:outline-active-500",
                )}
              />
            </label>
          </fieldset>

          {!canManage ? (
            <p className={cn("text-caption-1-regular text-fg-muted")}>
              You can review custom framework content but cannot save drafts or
              publish versions.
            </p>
          ) : null}
        </div>
      </div>
    </SectionCard>
  );
}
