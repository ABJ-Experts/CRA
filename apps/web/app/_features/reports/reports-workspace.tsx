"use client";

import { reportConfigurationSchema } from "@repo/contracts/reports";
import type {
  ReportConfiguration,
  ReportDefinition,
  ReportRun,
  ReportRunDetailResponse,
  ReportSelection,
} from "@repo/contracts/reports";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PageHeading } from "../../dashboard/_components/dashboard-chrome";
import { ApiClientError } from "../../_lib/http/api-client";
import { useSession } from "../../_providers/session-provider";
import { clearReportDraftSeed, readReportDraftSeed } from "./report-draft";
import { reportsGateway, type ReportsGateway } from "./reports.api";
import { ReportsAdministration } from "./reports-administration";
import { ReportEditor } from "./report-editor";

function messageFor(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 409)
      return "This report changed in another session. Refresh the server version, review your draft, then save again.";
    if (error.status === 401 || error.status === 403 || error.status === 404)
      return "Access to this report changed. Refresh your session or choose another report.";
    if (error.status === 422 || error.kind === "invalid_request")
      return "The report selection or schedule is no longer supported. Review the fields and preview again.";
    if (error.kind === "invalid_response")
      return "The report schema changed. Refresh the page before continuing.";
  }
  return "Reports are temporarily unavailable. Your draft is preserved; try again.";
}

function initialConfiguration(
  report: ReportSelection,
  ownerUserId: string,
): ReportConfiguration {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const title =
    report.kind === "readiness"
      ? "Product readiness report"
      : `${report.source.replaceAll(".", " · ").replaceAll("_", " ")} report`;
  return reportConfigurationSchema.parse({
    title,
    report,
    schedule: { frequency: "daily", timezone, localTime: "09:00" },
    dateWindow: { kind: "fixed" },
    recipientUserIds: [ownerUserId],
    emailEnabled: false,
  });
}

function dateLabel(value: string | null): string {
  return value
    ? new Date(value).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Not scheduled";
}

function isFreshPreview(
  run: ReportRun | null,
  definition: ReportDefinition | null,
  dirty: boolean,
): boolean {
  return Boolean(
    definition &&
    run &&
    !dirty &&
    run.kind === "preview" &&
    run.id === definition.previewRunId &&
    run.definitionVersion === definition.definitionVersion &&
    run.state === "succeeded" &&
    Date.now() - Date.parse(run.finishedAt ?? "") < 86_400_000,
  );
}

type Recipient = Readonly<{ id: string; displayName: string }>;

/** Owner workspace: durable definitions and history stay distinct from the local editor draft. */
export function ReportsWorkspace({
  gateway = reportsGateway,
}: {
  gateway?: ReportsGateway;
}) {
  const { session, isLoading, role } = useSession();
  const scope = `${session?.organization?.id ?? "none"}:${session?.user?.id ?? "none"}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const selectedIdRef = useRef<string | null>(null);
  const [stateScope, setStateScope] = useState(scope);
  const [definitions, setDefinitions] = useState<ReportDefinition[]>([]);
  const [selected, setSelected] = useState<ReportDefinition | null>(null);
  const [config, setConfig] = useState<ReportConfiguration | null>(null);
  const [savedConfig, setSavedConfig] = useState<string | null>(null);
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  const [preview, setPreview] = useState<ReportRun | null>(null);
  const [previewEligibility, setPreviewEligibility] = useState<
    ReportRunDetailResponse["recipientEligibility"]
  >([]);
  const [runs, setRuns] = useState<ReportRun[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [recipientCursor, setRecipientCursor] = useState<string | null>(null);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [emailPreference, setEmailPreference] = useState<{
    mode: "immediate" | "off";
    version: number;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  const seededScope = useRef<string | null>(null);
  const dirty =
    config !== null &&
    savedConfig !== null &&
    JSON.stringify(config) !== savedConfig;

  useEffect(() => {
    if (stateScope !== scope) {
      setDefinitions([]);
      setSelected(null);
      selectedIdRef.current = null;
      setConfig(null);
      setSavedConfig(null);
      setBaseVersion(null);
      setPreview(null);
      setPreviewEligibility([]);
      setRuns([]);
      setRecipients([]);
      setRecipientCursor(null);
      setLoadingRecipients(false);
      setEmailPreference(null);
      setNotice(null);
      setError(null);
      setNextCursor(null);
      attempt.current = null;
      setStateScope(scope);
      return;
    }
    if (isLoading || !session?.organization?.id || !session.user?.id) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    void Promise.all([
      gateway.list({}, controller.signal),
      gateway.recipients({}, controller.signal),
      gateway.emailPreference(controller.signal),
    ])
      .then(([definitionsResponse, recipientsResponse, preference]) => {
        if (controller.signal.aborted || scopeRef.current !== scope) return;
        setDefinitions(definitionsResponse.items);
        setNextCursor(definitionsResponse.nextCursor);
        setRecipients(recipientsResponse.items);
        setRecipientCursor(recipientsResponse.nextCursor);
        setEmailPreference(preference);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted && scopeRef.current === scope)
          setError(messageFor(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted && scopeRef.current === scope)
          setLoading(false);
      });
    return () => controller.abort();
  }, [
    gateway,
    isLoading,
    scope,
    session?.organization?.id,
    session?.user?.id,
    stateScope,
  ]);

  useEffect(() => {
    if (
      !session?.organization?.id ||
      !session.user?.id ||
      seededScope.current === scope
    )
      return;
    seededScope.current = scope;
    const seed = new URLSearchParams(window.location.search).get("draft");
    const report = readReportDraftSeed(seed, scope);
    if (!report) return;
    const draft = initialConfiguration(report, session.user.id);
    setConfig(draft);
    setSavedConfig(null);
    setSelected(null);
    setPreview(null);
    setPreviewEligibility([]);
    setNotice(
      "Report selection loaded. Review the schedule and recipients, then save the draft.",
    );
  }, [scope, session?.organization?.id, session?.user?.id]);

  function choose(definition: ReportDefinition) {
    selectedIdRef.current = definition.id;
    const chosenScope = scope;
    setSelected(definition);
    setConfig(definition.config);
    setSavedConfig(JSON.stringify(definition.config));
    setBaseVersion(definition.version);
    setPreview(null);
    setPreviewEligibility([]);
    setError(null);
    setNotice(null);
    setRuns([]);
    void gateway
      .runs({ definitionId: definition.id })
      .then((response) => {
        if (
          scopeRef.current === chosenScope &&
          selectedIdRef.current === definition.id
        )
          setRuns(response.items);
      })
      .catch((reason: unknown) => {
        if (
          scopeRef.current === chosenScope &&
          selectedIdRef.current === definition.id
        )
          setError(messageFor(reason));
      });
    if (definition.previewRunId) {
      void gateway
        .run(definition.previewRunId)
        .then((response) => {
          if (
            scopeRef.current === chosenScope &&
            selectedIdRef.current === definition.id
          )
            setPreview(response.run);
          setPreviewEligibility(response.recipientEligibility ?? []);
        })
        .catch(() => {
          if (
            scopeRef.current === chosenScope &&
            selectedIdRef.current === definition.id
          )
            setPreview(null);
          setPreviewEligibility([]);
        });
    }
  }

  function replaceConfig(next: ReportConfiguration) {
    setConfig(next);
    setPreview(null);
    setPreviewEligibility([]);
    setNotice(null);
  }

  async function loadMoreRecipients() {
    if (!recipientCursor || loadingRecipients) return;
    const requestedScope = scope;
    setLoadingRecipients(true);
    try {
      const response = await gateway.recipients({ cursor: recipientCursor });
      if (scopeRef.current !== requestedScope) return;
      setRecipients((current) => [
        ...current,
        ...response.items.filter(
          (item) => !current.some((known) => known.id === item.id),
        ),
      ]);
      setRecipientCursor(response.nextCursor);
      setError(null);
    } catch (reason) {
      if (scopeRef.current === requestedScope) setError(messageFor(reason));
    } finally {
      if (scopeRef.current === requestedScope) setLoadingRecipients(false);
    }
  }

  function commandKey(signature: string): string {
    if (attempt.current?.signature !== signature)
      attempt.current = { signature, key: crypto.randomUUID() };
    return attempt.current.key;
  }

  async function save() {
    if (!config) return;
    const requestedScope = scope;
    const parsed = reportConfigurationSchema.safeParse(config);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Review the report fields.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const signature = JSON.stringify({
        id: selected?.id,
        config: parsed.data,
        baseVersion,
      });
      const idempotencyKey = commandKey(signature);
      const response = selected
        ? await gateway.update(selected.id, {
            config: parsed.data,
            expectedVersion: baseVersion!,
            idempotencyKey,
          })
        : await gateway.create({ config: parsed.data, idempotencyKey });
      if (scopeRef.current !== requestedScope) return;
      const updated = response.data;
      selectedIdRef.current = updated.id;
      setDefinitions((current) => [
        updated,
        ...current.filter((item) => item.id !== updated.id),
      ]);
      setSelected(updated);
      setConfig(updated.config);
      setSavedConfig(JSON.stringify(updated.config));
      setBaseVersion(updated.version);
      setPreview(null);
      setPreviewEligibility([]);
      setNotice("Draft saved. Run a preview before activation.");
      if (!selected) {
        clearReportDraftSeed(
          new URLSearchParams(window.location.search).get("draft"),
        );
        window.history.replaceState(null, "", "/dashboard/reports");
      }
      attempt.current = null;
    } catch (reason) {
      if (scopeRef.current === requestedScope) setError(messageFor(reason));
    } finally {
      setBusy(false);
    }
  }

  async function refreshVersion() {
    if (!selected) return;
    const requestedScope = scope;
    try {
      const response = await gateway.get(selected.id);
      if (scopeRef.current !== requestedScope) return;
      setSelected(response.data);
      setBaseVersion(response.data.version);
      setPreview(null);
      setPreviewEligibility([]);
      setNotice(
        "Server version refreshed. Your edited draft is still here; review it before saving.",
      );
      setError(null);
      attempt.current = null;
    } catch (reason) {
      if (scopeRef.current === requestedScope) setError(messageFor(reason));
    }
  }

  async function previewReport() {
    if (!selected || dirty) return;
    const requestedScope = scope;
    setBusy(true);
    setError(null);
    try {
      const response = await gateway.preview(selected.id, {
        expectedVersion: selected.version,
        idempotencyKey: commandKey(
          `preview:${selected.id}:${selected.version}`,
        ),
      });
      if (scopeRef.current !== requestedScope) return;
      setPreview(response.run);
      setPreviewEligibility(response.recipientEligibility ?? []);
      const updated = await gateway.get(selected.id);
      if (scopeRef.current !== requestedScope) return;
      setSelected(updated.data);
      setBaseVersion(updated.data.version);
      setRuns((current) => [
        response.run,
        ...current.filter((item) => item.id !== response.run.id),
      ]);
      setNotice(
        response.run.state === "succeeded"
          ? "Preview succeeded. Review its result, then activate."
          : "Preview started. Refresh its status before activation.",
      );
      attempt.current = null;
    } catch (reason) {
      if (scopeRef.current === requestedScope) setError(messageFor(reason));
    } finally {
      setBusy(false);
    }
  }

  async function refreshPreview() {
    if (!preview) return;
    const requestedScope = scope;
    try {
      const response = await gateway.run(preview.id);
      if (scopeRef.current !== requestedScope) return;
      setPreview(response.run);
      setPreviewEligibility(response.recipientEligibility ?? []);
      setRuns((current) => [
        response.run,
        ...current.filter((item) => item.id !== response.run.id),
      ]);
      setError(null);
    } catch (reason) {
      if (scopeRef.current === requestedScope) setError(messageFor(reason));
    }
  }

  async function mutate(
    operation: "activate" | "pause" | "resume" | "archive",
  ) {
    if (
      !selected ||
      (operation === "activate" && !isFreshPreview(preview, selected, dirty))
    )
      return;
    const requestedScope = scope;
    setBusy(true);
    setError(null);
    try {
      const signature = `${operation}:${selected.id}:${selected.version}:${preview?.id ?? ""}`;
      const input = {
        expectedVersion: selected.version,
        idempotencyKey: commandKey(signature),
        ...((operation === "activate" || operation === "resume") && preview
          ? { previewRunId: preview.id }
          : {}),
      };
      const response = await gateway[operation](selected.id, input);
      if (scopeRef.current !== requestedScope) return;
      setSelected(response.data);
      setBaseVersion(response.data.version);
      setDefinitions((current) => [
        response.data,
        ...current.filter((item) => item.id !== response.data.id),
      ]);
      setNotice(
        `Report ${operation === "activate" ? "activated" : operation === "archive" ? "archived" : operation === "resume" ? "resumed" : "paused"}.`,
      );
      attempt.current = null;
    } catch (reason) {
      if (scopeRef.current === requestedScope) setError(messageFor(reason));
    } finally {
      setBusy(false);
    }
  }

  async function setPreference(mode: "immediate" | "off") {
    if (!emailPreference) return;
    const requestedScope = scope;
    setBusy(true);
    setError(null);
    try {
      const response = await gateway.setEmailPreference({
        mode,
        expectedVersion: emailPreference.version,
        idempotencyKey: commandKey(
          `preference:${emailPreference.version}:${mode}`,
        ),
      });
      if (scopeRef.current !== requestedScope) return;
      setEmailPreference(response);
      setNotice(
        mode === "off"
          ? "Report email is off. Inbox links remain available."
          : "Report email is on for new deliveries.",
      );
      attempt.current = null;
    } catch (reason) {
      if (scopeRef.current === requestedScope) setError(messageFor(reason));
    } finally {
      setBusy(false);
    }
  }

  if (
    isLoading ||
    stateScope !== scope ||
    !session?.organization?.id ||
    !session.user?.id
  ) {
    return (
      <div className="px-6 py-6">
        <p role="status">Loading report access…</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-8 px-6 py-6 text-fg lg:px-[30px]",
      )}
    >
      <PageHeading
        title="Scheduled reports"
        subtitle="Save an approved export, preview it, then choose when members receive protected links."
      />
      {error ? (
        <p
          role="alert"
          className="max-w-prose rounded-lg border border-danger bg-surface p-4 text-subhead-regular text-danger"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="max-w-prose text-subhead-regular text-fg">
          {notice}
        </p>
      ) : null}
      <section
        aria-labelledby="report-definitions"
        className="border-b border-border pb-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="report-definitions" className="text-h4">
            Your schedules
          </h2>
          <p className="text-caption-1-regular text-fg-muted">
            Start a new schedule beside any member export.
          </p>
        </div>
        {loading ? (
          <p role="status" className="mt-4">
            Loading schedules…
          </p>
        ) : definitions.length === 0 ? (
          <p className="mt-4 max-w-prose text-subhead-regular text-fg-muted">
            No saved schedules yet. Open a source list or readiness report and
            choose Schedule report.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border border-y border-border">
            {definitions.map((definition) => (
              <li
                key={definition.id}
                className="flex flex-wrap items-center justify-between gap-3 py-4"
              >
                <div className="min-w-0">
                  <p className="text-subhead-medium">
                    {definition.config.title}
                  </p>
                  <p className="text-caption-1-regular text-fg-muted">
                    {definition.state} · Next {dateLabel(definition.nextDueAt)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => choose(definition)}
                >
                  Edit {definition.config.title}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {nextCursor ? (
          <Button
            type="button"
            variant="outline"
            className="mt-4"
            onClick={() => {
              const requestedScope = scope;
              void gateway
                .list({ cursor: nextCursor })
                .then((response) => {
                  if (scopeRef.current !== requestedScope) return;
                  setDefinitions((current) => [...current, ...response.items]);
                  setNextCursor(response.nextCursor);
                })
                .catch((reason: unknown) => {
                  if (scopeRef.current === requestedScope)
                    setError(messageFor(reason));
                });
            }}
          >
            Load more schedules
          </Button>
        ) : null}
      </section>
      {config ? (
        <ReportEditor
          config={config}
          selected={selected}
          preview={preview}
          previewEligibility={previewEligibility}
          recipients={recipients}
          recipientNextCursor={recipientCursor}
          loadingRecipients={loadingRecipients}
          busy={busy}
          dirty={dirty}
          previewReady={isFreshPreview(preview, selected, dirty)}
          onChange={replaceConfig}
          onSave={save}
          onPreview={previewReport}
          onRefreshVersion={refreshVersion}
          onRefreshPreview={refreshPreview}
          onMutate={mutate}
          onLoadMoreRecipients={loadMoreRecipients}
        />
      ) : null}
      <section
        aria-labelledby="report-history"
        className="border-t border-border pt-6"
      >
        <h2 id="report-history" className="text-h4">
          Run history
        </h2>
        {selected ? (
          runs.length ? (
            <ul className="mt-4 divide-y divide-border border-y border-border">
              {runs.map((run) => (
                <li
                  key={run.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 text-subhead-regular"
                >
                  <span>
                    {run.kind === "preview" ? "Preview" : "Scheduled"} ·{" "}
                    {run.state} · {dateLabel(run.scheduledFor)}
                  </span>
                  <Link
                    className="text-active-500 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                    href={`/dashboard/reports/runs/${run.id}`}
                  >
                    View run
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-subhead-regular text-fg-muted">
              No runs for this report yet.
            </p>
          )
        ) : (
          <p className="mt-3 text-subhead-regular text-fg-muted">
            Select a saved schedule to inspect its runs.
          </p>
        )}
      </section>
      <section
        aria-labelledby="report-email"
        className="border-t border-border pt-6"
      >
        <h2 id="report-email" className="text-h4">
          Your report email
        </h2>
        <p className="mt-2 max-w-prose text-subhead-regular text-fg-muted">
          Inbox notices stay on. This preference only changes email for your
          scheduled reports.
        </p>
        {emailPreference ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="text-subhead-regular">
              Email is {emailPreference.mode === "off" ? "off" : "immediate"}
            </span>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void setPreference(
                  emailPreference.mode === "off" ? "immediate" : "off",
                )
              }
            >
              {emailPreference.mode === "off"
                ? "Turn on email"
                : "Turn off email"}
            </Button>
          </div>
        ) : null}
      </section>
      {role === "owner" || role === "admin" ? (
        <ReportsAdministration
          key={scope}
          gateway={gateway}
          currentUserId={session.user.id}
          recipients={recipients}
        />
      ) : null}
    </div>
  );
}
