"use client";

import type {
  VulnerabilityRemediationAnchor,
  VulnerabilityRemediationLinkedTicket,
  VulnerabilityRemediationOperational,
  VulnerabilityRemediationTicketPreviewResponse,
} from "@repo/contracts/vulnerabilities";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import { Input } from "@repo/ui/input";
import {
  ModalBody,
  ModalClose,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalRoot,
  ModalTitle,
  ModalTrigger,
} from "@repo/ui/modal";
import { Tag, type TagProps } from "@repo/ui/tag";
import { useEffect, useState } from "react";

import {
  useHasPermission,
  useSession,
} from "../../_providers/session-provider";
import { ApiClientError } from "../../_lib/http/api-client";
import { RemediationTicketBindingSetup } from "./remediation-ticket-binding-setup";
import {
  useCorrectVulnerabilityRemediationMutation,
  useRecordVulnerabilityRemediationMutation,
  usePreviewVulnerabilityRemediationTicketMutation,
  useReplayVulnerabilityRemediationTicketMutation,
  useSyncVulnerabilityRemediationTicketMutation,
  useVulnerabilityRemediationHistoryQuery,
  useVulnerabilityRemediationTicketsQuery,
} from "./triage.queries";

function titleCase(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatInstant(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function toDateTimeLocal(value: string | null): string {
  if (value === null) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function uuid(): string {
  return crypto.randomUUID();
}

function remediationTone(
  state: VulnerabilityRemediationOperational["state"],
): TagProps["tone"] {
  if (state === "applied") return "green";
  if (state === "available") return "orange";
  return "purple";
}

function reintroductionTone(
  state: VulnerabilityRemediationOperational["reintroduction"]["state"],
): TagProps["tone"] {
  if (state === "reintroduced") return "red";
  return "purple";
}

function remediationLabel(state: VulnerabilityRemediationOperational["state"]) {
  if (state === "planned") return "Fix planned";
  if (state === "available") return "Fix available";
  if (state === "applied") return "Fix applied";
  return "No remediation anchor";
}

function reintroductionLabel(
  state: VulnerabilityRemediationOperational["reintroduction"]["state"],
) {
  if (state === "reintroduced") return "Reintroduced";
  if (state === "not_evaluated") return "Reintroduction not evaluated";
  return "Not reintroduced";
}

export function remediationRequestMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 403)
    return "You no longer have permission to change this remediation anchor.";
  if (error instanceof ApiClientError && error.status === 409)
    return "This remediation anchor changed in another session. Reload the detail and try again.";
  if (error instanceof ApiClientError && error.kind === "network")
    return "You are offline. Your entered remediation is still here; reconnect and try again.";
  return "This remediation anchor could not be saved. Try again.";
}

function ticketRequestMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 403)
    return "You no longer have permission to change this remediation ticket.";
  if (error instanceof ApiClientError && error.status === 409)
    return "The linked ticket or approved preview changed. Refresh the preview or ticket state before retrying.";
  if (error instanceof ApiClientError && error.kind === "network")
    return "You are offline. The request outcome is unknown; refresh linked ticket state before retrying.";
  if (error instanceof ApiClientError && (error.status ?? 0) >= 500)
    return "The Jira integration is unavailable. The request outcome is unknown; refresh linked ticket state before retrying.";
  return "This remediation ticket request could not be completed. Try again.";
}

function ticketListMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 403)
    return "You no longer have permission to view linked tickets. Remediation evidence remains available.";
  if (error instanceof ApiClientError && error.kind === "network")
    return "You are offline. Linked ticket state is unavailable; remediation evidence remains available.";
  return "Linked ticket state is unavailable. Core remediation evidence remains usable.";
}

export function FindingRemediation({
  findingId,
  remediation,
}: Readonly<{
  findingId: string;
  remediation: VulnerabilityRemediationOperational;
}>) {
  const canEdit = useHasPermission("can_edit_findings");
  const canEditOrganization = useHasPermission("can_edit_organization");
  const { role, session } = useSession();
  const history = useVulnerabilityRemediationHistoryQuery(findingId, true);
  const tickets = useVulnerabilityRemediationTicketsQuery(findingId, true);
  const anchor = remediation.anchor;
  const reintroduction = remediation.reintroduction;

  return (
    <section className="mt-6" aria-labelledby="remediation-heading">
      <div className="rounded-xl border border-border bg-canvas p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3
              id="remediation-heading"
              className="text-subhead-semibold text-fg"
            >
              Remediation anchor
            </h3>
            <p className="mt-1 text-caption-1-regular text-fg-muted">
              Human/business availability evidence. Recording it does not change
              VEX, risk, regulatory obligations, or release history.
            </p>
          </div>
          {canEdit ? (
            <RemediationEditor findingId={findingId} anchor={anchor} />
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Tag variant="dot" tone={remediationTone(remediation.state)}>
            {remediationLabel(remediation.state)}
          </Tag>
          <Tag variant="dot" tone={reintroductionTone(reintroduction.state)}>
            {reintroductionLabel(reintroduction.state)}
          </Tag>
        </div>

        {anchor === null ? (
          <p className="mt-4 text-caption-1-regular text-fg-muted">
            No remediation availability evidence has been recorded for this
            finding.
          </p>
        ) : (
          <AnchorSummary anchor={anchor} />
        )}

        {reintroduction.state === "reintroduced" ? (
          <p role="status" className="mt-3 text-caption-1-regular text-danger">
            This component and version reappeared in this release lineage on{" "}
            {formatInstant(reintroduction.detectedAt!)}. The prior fixed release
            remains historically accurate.
          </p>
        ) : null}
        {reintroduction.state === "not_evaluated" ? (
          <p className="mt-3 text-caption-1-regular text-fg-muted">
            Reintroduction is not evaluated because a completed SBOM release
            lineage is unavailable.
          </p>
        ) : null}

        {history.isLoading ? (
          <p
            role="status"
            className="mt-4 text-caption-1-regular text-fg-muted"
          >
            Loading remediation history…
          </p>
        ) : null}
        {history.isError ? (
          <div role="alert" className="mt-4 text-caption-1-regular text-danger">
            Remediation history is unavailable. It does not change the current
            anchor shown above.
            <Button
              className="ml-2"
              size="sm"
              variant="gap"
              tone="grey"
              onClick={() => void history.refetch()}
            >
              Retry history
            </Button>
          </div>
        ) : null}
        <RemediationTicketPanel
          findingId={findingId}
          canEdit={canEdit}
          ticketsQuery={tickets}
        />
        {role === "owner" &&
        canEditOrganization &&
        !tickets.isLoading &&
        !tickets.isError &&
        tickets.data ? (
          <RemediationTicketBindingSetup
            key={session?.organization?.id ?? "no-organization"}
            findingId={findingId}
            bindings={tickets.data.bindings}
          />
        ) : null}

        {history.data && history.data.history.length > 1 ? (
          <RemediationHistory history={history.data.history} />
        ) : null}
      </div>
    </section>
  );
}

function ticketTone(
  status: VulnerabilityRemediationLinkedTicket["status"],
): TagProps["tone"] {
  if (status === "external_closed_pending_review") return "orange";
  if (status === "sync_error" || status === "conflict") return "red";
  if (status === "deleted_or_moved") return "purple";
  return "green";
}

function approvedTicketUrl(
  url: string | null,
  baseUrl: string | null,
): string | null {
  if (!url || !baseUrl) return null;
  try {
    const target = new URL(url);
    const approved = new URL(baseUrl);
    return target.protocol === "https:" && target.origin === approved.origin
      ? target.href
      : null;
  } catch {
    return null;
  }
}

function RemediationTicketPanel({
  findingId,
  canEdit,
  ticketsQuery,
}: Readonly<{
  findingId: string;
  canEdit: boolean;
  ticketsQuery: ReturnType<typeof useVulnerabilityRemediationTicketsQuery>;
}>) {
  const sync = useSyncVulnerabilityRemediationTicketMutation();
  const preview = usePreviewVulnerabilityRemediationTicketMutation();
  const replay = useReplayVulnerabilityRemediationTicketMutation();
  const [message, setMessage] = useState<string | null>(null);
  const [approvedPreview, setApprovedPreview] = useState<{
    findingId: string;
    bindingId: string;
    bindingVersion: number;
    ticketVersion: number;
    idempotencyKey: string;
    value: VulnerabilityRemediationTicketPreviewResponse["preview"];
  } | null>(null);
  const [previewStale, setPreviewStale] = useState(false);
  const [replayRequest, setReplayRequest] = useState<{
    ticketId: string;
    version: number;
    idempotencyKey: string;
  } | null>(null);
  const binding =
    ticketsQuery.data?.bindings.find(
      (candidate) =>
        candidate.status === "active" && candidate.provider === "jira",
    ) ??
    ticketsQuery.data?.bindings.find(
      (candidate) => candidate.provider === "jira",
    );
  const ticket = ticketsQuery.data?.tickets.find(
    (candidate) => candidate.bindingId === binding?.id,
  );
  const canAct =
    canEdit &&
    !ticketsQuery.isLoading &&
    !ticketsQuery.isError &&
    binding?.status === "active";
  const currentApproval =
    approvedPreview?.findingId === findingId &&
    approvedPreview.bindingId === binding?.id
      ? approvedPreview
      : null;
  const currentPreview = currentApproval?.value ?? null;
  const isStale =
    previewStale ||
    (currentApproval !== null &&
      (currentApproval.bindingVersion !== binding?.version ||
        currentApproval.ticketVersion !== (ticket?.version ?? 0)));
  const replayable =
    ticket?.status === "sync_pending" ||
    ticket?.status === "sync_error" ||
    ticket?.status === "conflict" ||
    ticket?.status === "deleted_or_moved";

  async function previewTicket() {
    if (!canAct || binding === undefined) return;
    setMessage(null);
    setPreviewStale(true);
    try {
      const result = await preview.mutateAsync({
        findingId,
        input: { bindingId: binding.id },
      });
      setApprovedPreview({
        findingId,
        bindingId: binding.id,
        bindingVersion: binding.version,
        ticketVersion: ticket?.version ?? 0,
        idempotencyKey: uuid(),
        value: result.preview,
      });
      setPreviewStale(false);
    } catch (error) {
      setMessage(ticketRequestMessage(error));
    }
  }

  async function syncTicket() {
    if (!canAct || binding === undefined || currentApproval === null || isStale)
      return;
    setMessage(null);
    try {
      const result = await sync.mutateAsync({
        findingId,
        input: {
          bindingId: binding.id,
          expectedTicketVersion: ticket?.version ?? 0,
          contextDigest: currentApproval.value.contextDigest,
          idempotencyKey: currentApproval.idempotencyKey,
        },
      });
      setApprovedPreview(null);
      setMessage(
        result.ticket.status === "sync_pending"
          ? "Ticket request is pending. The Jira issue is not confirmed yet."
          : "Jira ticket state updated. Review the linked status below.",
      );
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 409)
        setPreviewStale(true);
      setMessage(ticketRequestMessage(error));
    }
  }

  async function replayTicket() {
    if (!canAct || ticket === undefined || !replayable) return;
    setMessage(null);
    const request =
      replayRequest?.ticketId === ticket.id &&
      replayRequest.version === ticket.version
        ? replayRequest
        : {
            ticketId: ticket.id,
            version: ticket.version,
            idempotencyKey: uuid(),
          };
    setReplayRequest(request);
    try {
      const result = await replay.mutateAsync({
        findingId,
        ticketId: ticket.id,
        input: {
          expectedVersion: ticket.version,
          idempotencyKey: request.idempotencyKey,
        },
      });
      setReplayRequest(null);
      setMessage(
        result.ticket.status === "sync_pending"
          ? "Ticket recovery is pending. Check the linked state before retrying."
          : "Reconciliation completed. Review the linked Jira state below.",
      );
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 409)
        setReplayRequest(null);
      setMessage(ticketRequestMessage(error));
    }
  }

  return (
    <section
      className="mt-5 border-t border-border pt-4"
      aria-labelledby="remediation-tickets-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4
            id="remediation-tickets-heading"
            className="text-subhead-semibold text-fg"
          >
            Linked remediation tickets
          </h4>
          <p className="mt-1 text-caption-1-regular text-fg-muted">
            External closure starts internal review. It does not prove
            remediation availability or approve VEX.
          </p>
        </div>
        {canAct ? (
          <div className={cn("flex flex-wrap gap-2")}>
            {!replayable && ticket?.status !== "sync_pending" ? (
              <Button
                size="sm"
                variant="outline"
                tone="grey"
                disabled={sync.isPending || replay.isPending}
                loading={preview.isPending}
                onClick={() => void previewTicket()}
              >
                {ticket === undefined
                  ? "Preview Jira ticket"
                  : "Preview Jira update"}
              </Button>
            ) : null}
            {replayable ? (
              <Button
                size="sm"
                variant="outline"
                tone="grey"
                disabled={sync.isPending || preview.isPending}
                loading={replay.isPending}
                onClick={() => void replayTicket()}
              >
                Reconcile with Jira
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {ticketsQuery.isLoading ? (
        <p role="status" className="mt-3 text-caption-1-regular text-fg-muted">
          Loading linked tickets…
        </p>
      ) : null}
      {ticketsQuery.isError ? (
        <div role="alert" className="mt-3 text-caption-1-regular text-danger">
          {ticketListMessage(ticketsQuery.error)}
          <Button
            className="ml-2"
            size="sm"
            variant="gap"
            tone="grey"
            onClick={() => void ticketsQuery.refetch()}
          >
            Retry tickets
          </Button>
        </div>
      ) : null}
      {!ticketsQuery.isLoading && ticketsQuery.data?.bindings.length === 0 ? (
        <p className="mt-3 text-caption-1-regular text-fg-muted">
          No owner-managed Jira remediation binding is configured for this
          product and release.
        </p>
      ) : null}
      {!ticketsQuery.isLoading &&
      !ticketsQuery.isError &&
      ticketsQuery.data?.bindings.length !== 0 &&
      ticketsQuery.data?.tickets.length === 0 ? (
        <p className={cn("mt-3 text-caption-1-regular text-fg-muted")}>
          No Jira ticket is linked to this finding. Preview the approved context
          before requesting one.
        </p>
      ) : null}
      {!ticketsQuery.isLoading &&
      !ticketsQuery.isError &&
      binding?.status === "revoked" ? (
        <p
          role="status"
          className={cn("mt-3 text-caption-1-regular text-danger")}
        >
          This Jira binding has been revoked. Ask an organization owner to
          restore an approved connection.
        </p>
      ) : null}
      {!ticketsQuery.isLoading && !ticketsQuery.isError && replayable ? (
        <p className={cn("mt-3 text-caption-1-regular text-fg-muted")}>
          Reconciliation checks the recorded Jira correlation. Reconciliation
          does not create another issue; an unresolved or ambiguous match needs
          owner review.
        </p>
      ) : null}
      {!ticketsQuery.isLoading &&
      !ticketsQuery.isError &&
      !canEdit &&
      binding?.status === "active" ? (
        <p className={cn("mt-3 text-caption-1-regular text-fg-muted")}>
          You can view the linked ticket, but do not have permission to change
          it.
        </p>
      ) : null}
      {currentPreview !== null && canAct ? (
        <div
          className={cn(
            "mt-3 rounded-lg border border-border bg-canvas p-3 text-caption-1-regular text-fg",
          )}
        >
          <h5 className={cn("text-subhead-semibold text-fg")}>
            Approved Jira preview
          </h5>
          <p className={cn("mt-1 text-fg-muted")}>
            Project {currentPreview.projectKey} · Issue type{" "}
            {currentPreview.issueTypeId}. Review this server-approved text
            before sending it to Jira.
          </p>
          <p className={cn("mt-3 font-medium")}>{currentPreview.summary}</p>
          <p className={cn("mt-2 whitespace-pre-wrap")}>
            {currentPreview.description}
          </p>
          {isStale ? (
            <p role="alert" className={cn("mt-2 text-danger")}>
              The approved context changed. Refresh the preview before retrying.
            </p>
          ) : null}
          {canAct && !replayable && ticket?.status !== "sync_pending" ? (
            <Button
              className={cn("mt-3")}
              size="sm"
              variant="outline"
              tone="grey"
              disabled={isStale || preview.isPending}
              loading={sync.isPending}
              onClick={() => void syncTicket()}
            >
              {ticket === undefined ? "Create Jira ticket" : "Sync Jira ticket"}
            </Button>
          ) : null}
        </div>
      ) : null}
      {message ? (
        <p role="alert" className="mt-3 text-caption-1-regular text-danger">
          {message}
        </p>
      ) : null}
      {!ticketsQuery.isLoading && !ticketsQuery.isError
        ? ticketsQuery.data?.tickets.map((linkedTicket) => (
            <LinkedTicket
              key={linkedTicket.id}
              ticket={linkedTicket}
              approvedBaseUrl={
                ticketsQuery.data?.bindings.find(
                  (candidate) => candidate.id === linkedTicket.bindingId,
                )?.externalBaseUrl ?? null
              }
            />
          ))
        : null}
    </section>
  );
}

function LinkedTicket({
  ticket,
  approvedBaseUrl,
}: Readonly<{
  ticket: VulnerabilityRemediationLinkedTicket;
  approvedBaseUrl: string | null;
}>) {
  const safeUrl = approvedTicketUrl(ticket.externalUrl, approvedBaseUrl);
  return (
    <div className="mt-3 rounded-lg border border-border p-3 text-caption-1-regular text-fg">
      <div className="flex flex-wrap items-center gap-2">
        {ticket.externalIssueKey && safeUrl ? (
          <a
            className={cn(
              "font-medium text-link underline-offset-2 hover:underline",
            )}
            href={safeUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            {ticket.externalIssueKey}
          </a>
        ) : (
          <span className={cn("font-medium")}>
            {ticket.externalIssueKey ?? "Awaiting Jira issue"}
          </span>
        )}
        <Tag variant="dot" tone={ticketTone(ticket.status)}>
          {titleCase(ticket.status)}
        </Tag>
      </div>
      <dl className="mt-2 grid gap-2 sm:grid-cols-2">
        <RemediationFact
          label="Provider status"
          value={ticket.externalStatus ?? "Pending provider confirmation"}
        />
        <RemediationFact
          label="Last sync"
          value={
            ticket.lastSyncDirection && ticket.lastSyncAt
              ? `${titleCase(ticket.lastSyncDirection)} · ${formatInstant(ticket.lastSyncAt)}`
              : "Awaiting first provider sync"
          }
        />
        <RemediationFact
          label="Sync revision"
          value={String(ticket.syncRevision)}
        />
        <RemediationFact
          label="Inbound event"
          value={ticket.lastInboundEventId ?? "No inbound event recorded"}
        />
        <RemediationFact label="Correlation" value={ticket.correlationId} />
        <RemediationFact
          label="Ticket version"
          value={String(ticket.version)}
        />
      </dl>
      {ticket.conflictReason ? (
        <p role="status" className="mt-2 text-caption-1-regular text-danger">
          Conflict: {ticket.conflictReason}
        </p>
      ) : null}
    </div>
  );
}

function AnchorSummary({
  anchor,
}: Readonly<{ anchor: VulnerabilityRemediationAnchor }>) {
  return (
    <dl className="mt-4 grid gap-3 text-caption-1-regular sm:grid-cols-2">
      <RemediationFact
        label="Remediation kind"
        value={titleCase(anchor.remediationKind)}
      />
      <RemediationFact
        label="Fix version"
        value={anchor.fixVersion ?? "Mitigation-only remediation"}
      />
      <RemediationFact
        label="Availability"
        value={
          anchor.availabilityAt === null
            ? "Fix planned; availability not yet asserted"
            : formatInstant(anchor.availabilityAt)
        }
      />
      <RemediationFact
        label="Provenance"
        value={
          anchor.availabilityProvenance === null
            ? "Not asserted; remediation is still planned"
            : "Human asserted"
        }
      />
      <RemediationFact
        label="Recorded"
        value={`${formatInstant(anchor.recordedAt)} · revision ${anchor.revision}`}
      />
      <RemediationFact
        label="Availability basis"
        value={
          anchor.availabilityBasis ??
          "Not asserted; remediation is still planned."
        }
      />
      <div className="sm:col-span-2">
        <dt className="text-caption-2-uppercase text-fg-subtle">
          Mitigation description
        </dt>
        <dd className="mt-1 whitespace-pre-wrap text-caption-1-regular text-fg">
          {anchor.mitigationDescription}
        </dd>
      </div>
    </dl>
  );
}

function RemediationFact({
  label,
  value,
}: Readonly<{ label: string; value: string }>) {
  return (
    <div>
      <dt className="text-caption-2-uppercase text-fg-subtle">{label}</dt>
      <dd className="mt-1 text-caption-1-regular text-fg">{value}</dd>
    </div>
  );
}

function RemediationHistory({
  history,
}: Readonly<{ history: readonly VulnerabilityRemediationAnchor[] }>) {
  return (
    <section
      className="mt-5 border-t border-border pt-4"
      aria-labelledby="remediation-history-heading"
    >
      <h4
        id="remediation-history-heading"
        className="text-subhead-semibold text-fg"
      >
        Anchor history
      </h4>
      <ul className="mt-2 grid gap-2" aria-label="Remediation anchor history">
        {history.map((revision) => (
          <li
            key={revision.id}
            className="rounded-lg border border-border p-3 text-caption-1-regular text-fg"
          >
            Revision {revision.revision} · {titleCase(revision.remediationKind)}
            {revision.fixVersion ? ` · ${revision.fixVersion}` : ""}
            <span className="block text-fg-muted">
              {formatInstant(revision.recordedAt)}
              {revision.correctionReason
                ? ` · correction: ${revision.correctionReason}`
                : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RemediationEditor({
  findingId,
  anchor,
}: Readonly<{
  findingId: string;
  anchor: VulnerabilityRemediationAnchor | null;
}>) {
  const record = useRecordVulnerabilityRemediationMutation();
  const correct = useCorrectVulnerabilityRemediationMutation();
  const [open, setOpen] = useState(false);
  const [remediationKind, setRemediationKind] = useState<
    "corrective" | "mitigation"
  >(anchor?.remediationKind ?? "corrective");
  const [fixVersion, setFixVersion] = useState(anchor?.fixVersion ?? "");
  const [mitigationDescription, setMitigationDescription] = useState(
    anchor?.mitigationDescription ?? "",
  );
  const [availabilityAt, setAvailabilityAt] = useState(
    toDateTimeLocal(anchor?.availabilityAt ?? null),
  );
  const [availabilityBasis, setAvailabilityBasis] = useState(
    anchor?.availabilityBasis ?? "",
  );
  const [correctionReason, setCorrectionReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const isCorrection = anchor !== null;
  const isPending = record.isPending || correct.isPending;

  useEffect(() => {
    if (!open) return;
    setRemediationKind(anchor?.remediationKind ?? "corrective");
    setFixVersion(anchor?.fixVersion ?? "");
    setMitigationDescription(anchor?.mitigationDescription ?? "");
    setAvailabilityAt(toDateTimeLocal(anchor?.availabilityAt ?? null));
    setAvailabilityBasis(anchor?.availabilityBasis ?? "");
    setCorrectionReason("");
    setMessage(null);
  }, [anchor, open]);

  async function save() {
    const trimmedFixVersion = fixVersion.trim();
    if (remediationKind === "corrective" && trimmedFixVersion === "") {
      setMessage("Corrective remediation requires a fix version.");
      return;
    }
    if (mitigationDescription.trim() === "") {
      setMessage("A mitigation description is required.");
      return;
    }
    const availability =
      availabilityAt === "" ? null : new Date(availabilityAt);
    if (availability !== null && Number.isNaN(availability.getTime())) {
      setMessage(
        "Enter a valid availability timestamp or leave it blank for a planned fix.",
      );
      return;
    }
    if (availability !== null && availability > new Date()) {
      setMessage("Availability must be in the past or present.");
      return;
    }
    if (availability !== null && availabilityBasis.trim() === "") {
      setMessage("A human/business availability basis is required.");
      return;
    }
    if (isCorrection && correctionReason.trim() === "") {
      setMessage("A reason is required when correcting an existing anchor.");
      return;
    }
    setMessage(null);
    const values = {
      remediationKind,
      fixVersion: trimmedFixVersion === "" ? null : trimmedFixVersion,
      mitigationDescription: mitigationDescription.trim(),
      availabilityAt: availability === null ? null : availability.toISOString(),
      availabilityProvenance:
        availability === null ? null : ("human_asserted" as const),
      availabilityBasis:
        availability === null ? null : availabilityBasis.trim(),
      expectedVersion: anchor?.revision ?? 0,
      idempotencyKey: uuid(),
    };
    try {
      if (anchor === null) {
        await record.mutateAsync({ findingId, input: values });
      } else {
        await correct.mutateAsync({
          findingId,
          input: { ...values, correctionReason: correctionReason.trim() },
        });
      }
      setOpen(false);
    } catch (error) {
      setMessage(remediationRequestMessage(error));
    }
  }

  return (
    <ModalRoot open={open} onOpenChange={setOpen}>
      <ModalTrigger asChild>
        <Button size="sm" variant="outline" tone="grey">
          {isCorrection ? "Correct remediation" : "Record remediation"}
        </Button>
      </ModalTrigger>
      <ModalContent
        aria-label={
          isCorrection
            ? "Correct remediation anchor"
            : "Record remediation anchor"
        }
      >
        <ModalHeader>
          <ModalTitle>
            {isCorrection
              ? "Correct remediation anchor"
              : "Record remediation anchor"}
          </ModalTitle>
          <ModalDescription>
            Record only a human/business availability assertion. This never
            marks a release fixed or changes a regulatory deadline.
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          <label className="flex flex-col gap-1 text-caption-1-regular text-fg">
            Remediation type
            <select
              aria-label="Remediation type"
              value={remediationKind}
              onChange={(event) =>
                setRemediationKind(
                  event.target.value as "corrective" | "mitigation",
                )
              }
              className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
            >
              <option value="corrective">Corrective fix</option>
              <option value="mitigation">Mitigation</option>
            </select>
          </label>
          <label className="mt-3 flex flex-col gap-1 text-caption-1-regular text-fg">
            Fix version{" "}
            {remediationKind === "corrective" ? "(required)" : "(optional)"}
            <Input
              aria-label="Fix version"
              value={fixVersion}
              onChange={(event) => setFixVersion(event.target.value)}
            />
          </label>
          <label className="mt-3 flex flex-col gap-1 text-caption-1-regular text-fg">
            Mitigation description
            <textarea
              aria-label="Mitigation description"
              value={mitigationDescription}
              onChange={(event) => setMitigationDescription(event.target.value)}
              className="min-h-24 rounded-xl border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg"
            />
          </label>
          <label className="mt-3 flex flex-col gap-1 text-caption-1-regular text-fg">
            Availability timestamp (UTC stored)
            <Input
              aria-label="Availability timestamp"
              type="datetime-local"
              value={availabilityAt}
              onChange={(event) => setAvailabilityAt(event.target.value)}
            />
          </label>
          <p className="mt-1 text-caption-1-regular text-fg-muted">
            Leave blank for a planned remediation. Local time is converted to
            UTC when saved.
          </p>
          <label className="mt-3 flex flex-col gap-1 text-caption-1-regular text-fg">
            Human/business availability basis{" "}
            {availabilityAt === ""
              ? "(not required for planned remediation)"
              : "(required)"}
            <textarea
              aria-label="Human/business availability basis"
              value={availabilityBasis}
              onChange={(event) => setAvailabilityBasis(event.target.value)}
              className="min-h-20 rounded-xl border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg"
            />
          </label>
          {isCorrection ? (
            <label className="mt-3 flex flex-col gap-1 text-caption-1-regular text-fg">
              Correction reason
              <textarea
                aria-label="Correction reason"
                value={correctionReason}
                onChange={(event) => setCorrectionReason(event.target.value)}
                className="min-h-20 rounded-xl border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg"
              />
            </label>
          ) : null}
          {message ? (
            <p role="alert" className="mt-3 text-caption-1-regular text-danger">
              {message}
            </p>
          ) : null}
        </ModalBody>
        <ModalFooter>
          <ModalClose asChild>
            <Button variant="outline" tone="grey">
              Cancel
            </Button>
          </ModalClose>
          <Button loading={isPending} onClick={() => void save()}>
            {isCorrection ? "Save correction" : "Record remediation"}
          </Button>
        </ModalFooter>
      </ModalContent>
    </ModalRoot>
  );
}
