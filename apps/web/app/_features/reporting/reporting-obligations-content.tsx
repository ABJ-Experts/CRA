"use client";

import type {
  ReportingObligationAnchorKind,
  ReportingObligationListResponse,
} from "@repo/contracts/reporting";
import { reportingObligationParamsSchema } from "@repo/contracts/reporting";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Tag } from "@repo/ui/tag";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { ApiClientError } from "../../_lib/http/api-client";
import {
  useHasPermission,
  useSession,
} from "../../_providers/session-provider";
import {
  PageHeading,
  SectionCard,
} from "../../dashboard/_components/dashboard-chrome";
import {
  useCancelReportingObligationMutation,
  useCorrectReportingAnchorMutation,
  useCreateReportingObligationMutation,
  useRecordReportingSubmissionMutation,
  useReportingDeadlineSummaryQuery,
  useReportingObligationsQuery,
} from "./reporting.queries";
import { ReportingStageDraftEditor } from "./reporting-stage-draft-editor";

const TYPE_OPTIONS = [
  {
    value: "actively_exploited_vulnerability",
    label: "Actively exploited vulnerability",
  },
  { value: "severe_incident", label: "Severe incident" },
] as const;

type ReportingObligation =
  ReportingObligationListResponse["obligations"][number];

function uuid() {
  return crypto.randomUUID();
}

function nowLocalMinute() {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function toUtcSecond(value: string): string {
  return new Date(value).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function formatInstant(value: string | null) {
  if (value === null) return "Pending anchor";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    timeZoneName: "short",
    year: "numeric",
  }).format(new Date(value));
}

function requestMessage(error: unknown) {
  if (error instanceof ApiClientError && error.status === 409)
    return "This obligation changed in another session. Refresh and retry with the latest version.";
  if (error instanceof ApiClientError && error.kind === "network")
    return "You appear offline. Your entered content is still here; reconnect and retry.";
  if (error instanceof ApiClientError && error.status === 403)
    return "You no longer have permission to change reporting obligations.";
  return "Reporting obligations are unavailable. Try again.";
}

export function ReportingObligationsContent() {
  const searchParams = useSearchParams();
  const { isLoading: sessionLoading } = useSession();
  const canView = useHasPermission("can_view_findings");
  const canEdit = useHasPermission("can_edit_findings");
  const query = useReportingObligationsQuery(
    { limit: 50 },
    canView && !sessionLoading,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedFromUrl = useMemo(() => {
    const parsed = reportingObligationParamsSchema.safeParse({
      obligationId: searchParams.get("obligationId"),
    });
    return parsed.success ? parsed.data.obligationId : null;
  }, [searchParams]);
  useEffect(() => {
    if (selectedFromUrl !== null) setSelectedId(selectedFromUrl);
  }, [selectedFromUrl]);
  const summary = useReportingDeadlineSummaryQuery(canView && !sessionLoading);
  const selected =
    query.data?.obligations.find((item) => item.id === selectedId) ??
    query.data?.obligations[0] ??
    null;

  if (sessionLoading) {
    return (
      <div className="flex flex-col gap-6 px-6 py-6 lg:px-[30px]">
        <PageHeading
          title="Reporting obligations"
          subtitle="Track CRA reporting timers from human-asserted awareness, frozen rule versions, and durable anchor corrections."
        />
        <SectionCard>
          <p role="status" className="text-subhead-regular text-fg-muted">
            Loading reporting workspace…
          </p>
        </SectionCard>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="flex flex-col gap-6 px-6 py-6 lg:px-[30px]">
        <PageHeading
          title="Reporting obligations"
          subtitle="Track CRA reporting timers from human-asserted awareness, frozen rule versions, and durable anchor corrections."
        />
        <SectionCard>
          <p role="alert" className="text-subhead-regular text-danger">
            You do not have access to reporting obligations in this
            organization.
          </p>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6 px-6 py-6 lg:px-[30px]">
      <PageHeading
        title="Reporting obligations"
        subtitle="Track CRA reporting timers from human-asserted awareness, frozen rule versions, and durable anchor corrections."
      />

      <DeadlineMonitorStatus summary={summary.data?.summary} />

      {canEdit ? <CreateObligationForm /> : null}

      {query.isLoading ? (
        <SectionCard>
          <p role="status" className="text-subhead-regular text-fg-muted">
            Loading reporting obligations…
          </p>
        </SectionCard>
      ) : null}
      {query.isError ? (
        <SectionCard>
          <div role="alert" className="flex flex-wrap items-center gap-3">
            <p className="text-subhead-regular text-danger">
              {requestMessage(query.error)}
            </p>
            <Button
              size="sm"
              variant="outline"
              tone="grey"
              onClick={() => void query.refetch()}
            >
              Retry
            </Button>
          </div>
        </SectionCard>
      ) : null}
      {query.data?.obligations.length === 0 ? (
        <SectionCard>
          <p className="text-subhead-regular text-fg-muted">
            No reporting obligations have been opened yet.
          </p>
        </SectionCard>
      ) : null}

      {query.data && query.data.obligations.length > 0 ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
          <div className="overflow-x-auto rounded-2xl border border-border bg-canvas">
            <table className="min-w-full text-left text-caption-1-regular">
              <thead className="border-b border-border text-fg-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Next deadline</th>
                  <th className="px-3 py-2 font-medium">Version</th>
                </tr>
              </thead>
              <tbody>
                {query.data.obligations.map((obligation) => (
                  <tr
                    key={obligation.id}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-3 py-3">
                      <button
                        className="text-left text-link underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                        onClick={() => setSelectedId(obligation.id)}
                      >
                        {typeLabel(obligation.type)}
                      </button>
                      <p className="mt-1 text-fg-muted">
                        Awareness {formatInstant(obligation.awarenessAt)}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <Tag
                        variant="dot"
                        tone={
                          obligation.status === "cancelled" ? "purple" : "green"
                        }
                      >
                        {obligation.status}
                      </Tag>
                    </td>
                    <td className="px-3 py-3 text-fg-muted">
                      {nextDeadline(obligation)}
                    </td>
                    <td className="px-3 py-3 text-fg-muted">
                      {obligation.version}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selected ? (
            <ObligationDetail
              obligation={selected}
              canEdit={canEdit}
              serverNow={summary.data?.summary.serverNow}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CreateObligationForm() {
  const create = useCreateReportingObligationMutation();
  const [type, setType] = useState<(typeof TYPE_OPTIONS)[number]["value"]>(
    "actively_exploited_vulnerability",
  );
  const [awarenessAt, setAwarenessAt] = useState(nowLocalMinute);
  const [basis, setBasis] = useState("");
  const [findingId, setFindingId] = useState("");
  const [sourceKind, setSourceKind] = useState<"manual" | "finding">("manual");
  const [idempotencyKey, setIdempotencyKey] = useState(uuid);

  return (
    <form
      className="rounded-2xl border border-border bg-canvas p-6"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate(
          {
            type,
            source:
              sourceKind === "finding"
                ? { kind: "finding", findingId: findingId.trim() }
                : { kind: "manual" },
            awarenessAt: toUtcSecond(awarenessAt),
            awarenessBasis: basis,
            idempotencyKey,
          },
          { onSuccess: () => setIdempotencyKey(uuid()) },
        );
      }}
    >
      <h2 className="text-subhead-semibold text-fg">Open obligation</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="text-caption-1-regular text-fg-muted">
          Obligation type
          <select
            className="mt-1 w-full rounded-lg border border-border bg-canvas px-3 py-2 text-body-regular text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            value={type}
            onChange={(event) => setType(event.target.value as typeof type)}
          >
            {TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-caption-1-regular text-fg-muted">
          Awareness time
          <Input
            type="datetime-local"
            value={awarenessAt}
            onChange={(event) => setAwarenessAt(event.target.value)}
            required
          />
        </label>
        <label className="text-caption-1-regular text-fg-muted">
          Source
          <select
            className="mt-1 w-full rounded-lg border border-border bg-canvas px-3 py-2 text-body-regular text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            value={sourceKind}
            onChange={(event) =>
              setSourceKind(event.target.value as "manual" | "finding")
            }
          >
            <option value="manual">Manual</option>
            <option value="finding">From finding</option>
          </select>
        </label>
        {sourceKind === "finding" ? (
          <label className="text-caption-1-regular text-fg-muted">
            Finding ID
            <Input
              value={findingId}
              onChange={(event) => setFindingId(event.target.value)}
              placeholder="UUID"
              required
            />
          </label>
        ) : null}
      </div>
      <label className="mt-3 block text-caption-1-regular text-fg-muted">
        Awareness basis
        <textarea
          className="mt-1 min-h-24 w-full rounded-lg border border-border bg-canvas px-3 py-2 text-body-regular text-fg placeholder:text-fg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          value={basis}
          maxLength={4000}
          onChange={(event) => setBasis(event.target.value)}
          placeholder="Record the human assertion and evidence basis. This is distinct from creation time."
          required
        />
      </label>
      <div className="mt-3 flex items-center gap-3">
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? "Opening…" : "Open obligation"}
        </Button>
        <span className="text-caption-1-regular text-fg-muted">
          {basis.length}/4,000
        </span>
      </div>
      {create.isError ? (
        <p role="alert" className="mt-3 text-caption-1-regular text-danger">
          {requestMessage(create.error)}
        </p>
      ) : null}
    </form>
  );
}

function ObligationDetail({
  obligation,
  canEdit,
  serverNow,
}: Readonly<{
  obligation: ReportingObligation;
  canEdit: boolean;
  serverNow: string | undefined;
}>) {
  return (
    <aside
      className="rounded-xl border border-border bg-canvas p-4"
      aria-labelledby="obligation-detail-heading"
    >
      <h2
        id="obligation-detail-heading"
        className="text-subhead-semibold text-fg"
      >
        Selected obligation
      </h2>
      <p className="mt-1 break-all text-caption-1-regular text-fg-muted">
        {obligation.id}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-caption-1-regular">
        <div>
          <dt className="text-fg-muted">Rule version</dt>
          <dd className="text-fg">
            {obligation.ruleSet.jurisdiction} v{obligation.ruleSet.version}
          </dd>
        </div>
        <div>
          <dt className="text-fg-muted">Author</dt>
          <dd className="text-fg">{obligation.createdBy.displayName}</dd>
        </div>
      </dl>
      <ol className="mt-4 space-y-2">
        {obligation.stages.map((stage) => (
          <li
            key={stage.id}
            className="rounded-lg border border-border p-3 text-caption-1-regular"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-fg">
                {stageLabel(stage.kind)}
              </span>
              <Tag
                variant="dot"
                tone={
                  stage.state === "overdue"
                    ? "red"
                    : stage.state === "submitted"
                      ? "green"
                      : "purple"
                }
              >
                {stage.state}
              </Tag>
            </div>
            <p className="mt-1 text-fg-muted">
              Due {formatInstant(stage.dueAt)}
            </p>
            <p className="mt-1 text-fg-muted">
              <Countdown dueAt={stage.dueAt} serverNow={serverNow} />
              {stage.elapsedPercent !== null
                ? ` · ${Math.floor(stage.elapsedPercent)}% elapsed`
                : ""}
            </p>
            {stage.breachedAt !== null && stage.state === "submitted" ? (
              <p className="mt-1 text-danger">Submitted late</p>
            ) : null}
            {canEdit &&
            obligation.status === "active" &&
            stage.state !== "submitted" ? (
              <ReportingStageDraftEditor
                obligation={obligation}
                stage={stage}
                canEdit={canEdit}
              />
            ) : null}
          </li>
        ))}
      </ol>
      {canEdit && obligation.status === "active" ? (
        <TransitionForms obligation={obligation} />
      ) : null}
      {obligation.status === "cancelled" ? (
        <p className="mt-4 text-caption-1-regular text-fg-muted">
          Cancelled: {obligation.cancellationReason}
        </p>
      ) : null}
    </aside>
  );
}

function DeadlineMonitorStatus({
  summary,
}: Readonly<{
  summary:
    | {
        serverNow: string;
        overdueCount: number;
        nextDeadline: {
          stage: string;
          dueAt: string;
          elapsedPercent: number;
        } | null;
      }
    | undefined;
}>) {
  if (summary === undefined) return null;
  if (summary.nextDeadline === null && summary.overdueCount === 0) {
    return (
      <SectionCard>
        <p role="status" className="text-subhead-regular text-fg-muted">
          No active reporting deadline.
        </p>
      </SectionCard>
    );
  }
  return (
    <SectionCard>
      <p role="status" className="text-subhead-regular text-fg">
        {summary.nextDeadline === null
          ? "No running reporting deadline."
          : `${stageLabel(summary.nextDeadline.stage)} · ${formatInstant(summary.nextDeadline.dueAt)}`}
      </p>
      {summary.nextDeadline !== null ? (
        <p className="mt-1 text-caption-1-regular text-fg-muted">
          <Countdown
            dueAt={summary.nextDeadline.dueAt}
            serverNow={summary.serverNow}
          />
          {` · ${Math.floor(summary.nextDeadline.elapsedPercent)}% elapsed`}
        </p>
      ) : null}
      {summary.overdueCount > 0 ? (
        <p className="mt-1 text-caption-1-regular text-danger">
          {summary.overdueCount} overdue reporting deadline
          {summary.overdueCount === 1 ? "" : "s"}.
        </p>
      ) : null}
    </SectionCard>
  );
}

export function Countdown({
  dueAt,
  serverNow,
}: Readonly<{ dueAt: string | null; serverNow: string | undefined }>) {
  const [tick, setTick] = useState(0);
  const baseline = useRef<Readonly<{ server: number; browser: number }> | null>(
    null,
  );
  useEffect(() => {
    baseline.current =
      serverNow === undefined
        ? null
        : { server: new Date(serverNow).getTime(), browser: Date.now() };
    // The baseline is intentionally retained outside rendering so the browser
    // can only present elapsed time from the server snapshot. Trigger one
    // render after replacing it; otherwise the initial render stays on the
    // accessible "Updating countdown…" placeholder until the next minute.
    setTick((value) => value + 1);
  }, [serverNow]);
  useEffect(() => {
    const timer = window.setInterval(
      () => setTick((value) => value + 1),
      60_000,
    );
    return () => window.clearInterval(timer);
  }, []);
  void tick;
  if (dueAt === null) return <>Pending anchor</>;
  if (baseline.current === null) return <>Updating countdown…</>;
  const estimate =
    baseline.current.server + (Date.now() - baseline.current.browser);
  const seconds = Math.ceil((new Date(dueAt).getTime() - estimate) / 1_000);
  if (seconds <= 0) return <>Deadline reached; refreshing status…</>;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return <>{`${hours > 0 ? `${hours}h ` : ""}${minutes}m remaining`}</>;
}

function TransitionForms({
  obligation,
}: Readonly<{ obligation: ReportingObligation }>) {
  const correct = useCorrectReportingAnchorMutation();
  const submit = useRecordReportingSubmissionMutation();
  const cancel = useCancelReportingObligationMutation();
  const [anchorAt, setAnchorAt] = useState(nowLocalMinute);
  const [reason, setReason] = useState("");
  const [basis, setBasis] = useState("");
  const [reference, setReference] = useState("");
  const [submittedAt, setSubmittedAt] = useState(nowLocalMinute);
  const [correctionIdempotencyKey, setCorrectionIdempotencyKey] =
    useState(uuid);
  const [submissionIdempotencyKey, setSubmissionIdempotencyKey] =
    useState(uuid);
  const [cancellationIdempotencyKey, setCancellationIdempotencyKey] =
    useState(uuid);
  const [stage, setStage] = useState<
    "early_warning" | "notification" | "final_report"
  >("early_warning");
  const correctionAnchors = useMemo(
    (): ReportingObligationAnchorKind[] =>
      obligation.type === "actively_exploited_vulnerability"
        ? ["awareness", "remediation_available"]
        : ["awareness", "notification_submitted"],
    [obligation.type],
  );
  const [anchor, setAnchor] =
    useState<ReportingObligationAnchorKind>("awareness");
  const transitionPending =
    correct.isPending || submit.isPending || cancel.isPending;

  useEffect(() => {
    const firstAnchor = correctionAnchors[0];
    if (firstAnchor && !correctionAnchors.includes(anchor))
      setAnchor(firstAnchor);
  }, [anchor, correctionAnchors]);

  return (
    <div className="mt-4 space-y-4 border-t border-border pt-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          correct.mutate(
            {
              obligationId: obligation.id,
              input: {
                anchor,
                anchorAt: toUtcSecond(anchorAt),
                basis: anchor === "awareness" ? basis : undefined,
                reason,
                expectedVersion: obligation.version,
                idempotencyKey: correctionIdempotencyKey,
              },
            },
            { onSuccess: () => setCorrectionIdempotencyKey(uuid()) },
          );
        }}
      >
        <h3 className="text-caption-1-semibold text-fg">Correct anchor</h3>
        <div className="mt-2 grid gap-2">
          <select
            className="rounded-lg border border-border bg-canvas px-3 py-2 text-caption-1-regular text-fg"
            value={anchor}
            onChange={(event) => setAnchor(event.target.value as typeof anchor)}
          >
            {correctionAnchors.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <Input
            type="datetime-local"
            value={anchorAt}
            onChange={(event) => setAnchorAt(event.target.value)}
            required
          />
          {anchor === "awareness" ? (
            <Input
              value={basis}
              onChange={(event) => setBasis(event.target.value)}
              placeholder="Awareness basis"
              required
            />
          ) : null}
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Correction reason"
            required
          />
          <Button size="sm" type="submit" disabled={transitionPending}>
            Save correction
          </Button>
        </div>
        {correct.isError ? (
          <p role="alert" className="mt-2 text-caption-1-regular text-danger">
            {requestMessage(correct.error)}
          </p>
        ) : null}
      </form>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit.mutate(
            {
              obligationId: obligation.id,
              input: {
                stage,
                submittedAt: toUtcSecond(submittedAt),
                submissionReference: reference,
                expectedVersion: obligation.version,
                idempotencyKey: submissionIdempotencyKey,
              },
            },
            { onSuccess: () => setSubmissionIdempotencyKey(uuid()) },
          );
        }}
      >
        <h3 className="text-caption-1-semibold text-fg">Record submission</h3>
        <div className="mt-2 grid gap-2">
          <select
            className="rounded-lg border border-border bg-canvas px-3 py-2 text-caption-1-regular text-fg"
            value={stage}
            onChange={(event) => setStage(event.target.value as typeof stage)}
          >
            {obligation.stages.map((item) => (
              <option key={item.kind} value={item.kind}>
                {stageLabel(item.kind)}
              </option>
            ))}
          </select>
          <Input
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            placeholder="Submission reference"
            required
          />
          <label className="text-caption-1-regular text-fg-muted">
            Submission time
            <Input
              type="datetime-local"
              value={submittedAt}
              onChange={(event) => setSubmittedAt(event.target.value)}
              required
            />
          </label>
          <Button size="sm" type="submit" disabled={transitionPending}>
            Record submission
          </Button>
        </div>
        {submit.isError ? (
          <p role="alert" className="mt-2 text-caption-1-regular text-danger">
            {requestMessage(submit.error)}
          </p>
        ) : null}
      </form>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          cancel.mutate(
            {
              obligationId: obligation.id,
              input: {
                reason,
                expectedVersion: obligation.version,
                idempotencyKey: cancellationIdempotencyKey,
              },
            },
            { onSuccess: () => setCancellationIdempotencyKey(uuid()) },
          );
        }}
      >
        <Button
          size="sm"
          variant="gap"
          tone="grey"
          type="submit"
          disabled={transitionPending || reason.trim().length === 0}
        >
          Cancel obligation
        </Button>
        {cancel.isError ? (
          <p role="alert" className="mt-2 text-caption-1-regular text-danger">
            {requestMessage(cancel.error)}
          </p>
        ) : null}
      </form>
    </div>
  );
}

function nextDeadline(obligation: ReportingObligation) {
  const stage =
    obligation.stages.find((item) => item.state === "running") ??
    obligation.stages.find((item) => item.state === "overdue") ??
    obligation.stages.find((item) => item.state === "pending_anchor");
  return stage
    ? `${stageLabel(stage.kind)} · ${formatInstant(stage.dueAt)}`
    : "No active timer";
}

function typeLabel(value: ReportingObligation["type"]) {
  return TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function stageLabel(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
