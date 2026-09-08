"use client";

import type {
  VulnerabilityRemediationAnchor,
  VulnerabilityRemediationOperational,
} from "@repo/contracts/vulnerabilities";
import { Button } from "@repo/ui/button";
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

import { useHasPermission } from "../../_providers/session-provider";
import { ApiClientError } from "../../_lib/http/api-client";
import {
  useCorrectVulnerabilityRemediationMutation,
  useRecordVulnerabilityRemediationMutation,
  useVulnerabilityRemediationHistoryQuery,
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

export function FindingRemediation({
  findingId,
  remediation,
}: Readonly<{
  findingId: string;
  remediation: VulnerabilityRemediationOperational;
}>) {
  const canEdit = useHasPermission("can_edit_findings");
  const history = useVulnerabilityRemediationHistoryQuery(findingId, true);
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
        {history.data && history.data.history.length > 1 ? (
          <RemediationHistory history={history.data.history} />
        ) : null}
      </div>
    </section>
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
