"use client";

import type {
  VulnerabilityAssessmentApprovalPolicyListResponse,
  VulnerabilityFindingAssessmentResponse,
} from "@repo/contracts/vulnerabilities";
import { vulnerabilityAssessmentEvidenceLinkInputSchema } from "@repo/contracts/vulnerabilities";
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
import { Select, SelectItem } from "@repo/ui/select";
import { Tag, type TagProps } from "@repo/ui/tag";
import { useState } from "react";

import { useHasPermission } from "../../_providers/session-provider";
import { ApiClientError } from "../../_lib/http/api-client";
import {
  useApproveVulnerabilityFindingAssessmentMutation,
  useRejectVulnerabilityFindingAssessmentMutation,
  useSubmitVulnerabilityFindingAssessmentMutation,
  useUpdateVulnerabilityAssessmentApprovalPolicyMutation,
  useVulnerabilityAssessmentApprovalPolicyQuery,
  useVulnerabilityFindingAssessmentQuery,
} from "./triage.queries";

type Assessment = NonNullable<
  VulnerabilityFindingAssessmentResponse["assessment"]
>;

const JUSTIFICATIONS = [
  ["component_not_present", "Component not present"],
  ["vulnerable_code_not_present", "Vulnerable code not present"],
  ["vulnerable_code_not_in_execute_path", "Not in an executable path"],
  [
    "vulnerable_code_cannot_be_controlled_by_adversary",
    "Cannot be controlled by an adversary",
  ],
  ["inline_mitigations_already_exist", "Inline mitigations already exist"],
] as const;

function titleCase(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatInstant(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function approvalTone(state: Assessment["approvalState"]): TagProps["tone"] {
  if (state === "approved" || state === "approval_not_required") return "green";
  if (state === "rejected") return "red";
  return "orange";
}

export function vulnerabilityAssessmentRequestMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 403) {
    if (error.code === "mfa_required") {
      return "Two-factor verification is required before approving or rejecting an assessment.";
    }
    if (error.code === "forbidden") {
      return "You cannot approve or reject your own assessment.";
    }
    return "You no longer have permission for this assessment action.";
  }
  if (error instanceof ApiClientError && error.status === 409) {
    return "This assessment changed in another session. Reload the detail and try again.";
  }
  if (error instanceof ApiClientError && error.kind === "network") {
    return "You are offline. Your entered assessment is still here; reconnect and try again.";
  }
  return "This assessment could not be saved. Try again.";
}

function uuid(): string {
  return crypto.randomUUID();
}

export function FindingAssessment({
  findingId,
}: Readonly<{ findingId: string }>) {
  const canEdit = useHasPermission("can_edit_findings");
  const canApprove = useHasPermission("can_approve_findings");
  const canManagePolicy = useHasPermission(
    "can_manage_finding_approval_policy",
  );
  const assessment = useVulnerabilityFindingAssessmentQuery(findingId, true);
  const policy = useVulnerabilityAssessmentApprovalPolicyQuery(canManagePolicy);

  if (assessment.isLoading) {
    return (
      <section
        aria-label="VEX assessment"
        className="mt-6 rounded-xl border border-border p-4"
      >
        <p role="status" className="text-caption-1-regular text-fg-muted">
          Loading VEX assessment…
        </p>
      </section>
    );
  }
  if (assessment.isError) {
    return (
      <section
        aria-label="VEX assessment"
        className="mt-6 rounded-xl border border-danger p-4"
      >
        <p role="alert" className="text-caption-1-regular text-danger">
          {vulnerabilityAssessmentRequestMessage(assessment.error)}
        </p>
        <Button
          className="mt-3"
          size="sm"
          onClick={() => void assessment.refetch()}
        >
          Retry assessment
        </Button>
      </section>
    );
  }

  return (
    <section className="mt-6" aria-labelledby="vex-assessment-heading">
      <div className="rounded-xl border border-border bg-canvas p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3
              id="vex-assessment-heading"
              className="text-subhead-semibold text-fg"
            >
              VEX assessment
            </h3>
            <p className="mt-1 text-caption-1-regular text-fg-muted">
              Immutable revision history is retained separately from matching
              evidence.
            </p>
          </div>
          {canEdit ? (
            <AssessmentEditor
              findingId={findingId}
              assessment={assessment.data?.assessment ?? null}
              onReload={() => void assessment.refetch()}
            />
          ) : null}
        </div>

        <AssessmentSummary
          assessment={assessment.data?.assessment ?? null}
          findingId={findingId}
          canApprove={canApprove}
          onReload={() => void assessment.refetch()}
        />
        <AssessmentHistory history={assessment.data?.history ?? []} />
      </div>
      {canManagePolicy ? (
        <ApprovalPolicyEditor policy={policy.data} error={policy.isError} />
      ) : null}
    </section>
  );
}

function AssessmentSummary({
  assessment,
  findingId,
  canApprove,
  onReload,
}: Readonly<{
  assessment: Assessment | null;
  findingId: string;
  canApprove: boolean;
  onReload: () => void;
}>) {
  if (assessment === null) {
    return (
      <p className="mt-4 text-caption-1-regular text-fg-muted">
        No VEX assessment has been submitted for this finding.
      </p>
    );
  }
  return (
    <div className="mt-4 grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tag variant="dot" tone="purple">
          {titleCase(assessment.status)}
        </Tag>
        <Tag variant="dot" tone={approvalTone(assessment.approvalState)}>
          {titleCase(assessment.approvalState)}
        </Tag>
        <span className="text-caption-1-regular text-fg-muted">
          Revision {assessment.revision} · submitted{" "}
          {formatInstant(assessment.submittedAt)}
        </span>
      </div>
      <dl className="grid gap-3 text-caption-1-regular sm:grid-cols-2">
        <AssessmentFact
          label="Policy snapshot"
          value={`${titleCase(assessment.policySeverity)} · policy version ${assessment.policyVersion}`}
        />
        <AssessmentFact
          label="Approval"
          value={
            assessment.approvalRequired
              ? "Required before this assessment is approved"
              : "Not required by the submission-time policy"
          }
        />
        {assessment.justification !== null ? (
          <AssessmentFact
            label="VEX justification"
            value={titleCase(assessment.justification)}
          />
        ) : null}
        {assessment.decidedAt !== null ? (
          <AssessmentFact
            label="Decision"
            value={`${titleCase(assessment.approvalState)} · ${formatInstant(assessment.decidedAt)}`}
          />
        ) : null}
      </dl>
      <p className="whitespace-pre-wrap text-caption-1-regular text-fg">
        {assessment.detail}
      </p>
      <p className="text-caption-1-regular text-fg-muted">
        Revision reason: {assessment.changeReason}
      </p>
      <EvidenceLinks assessment={assessment} />
      {assessment.decisionReason !== null ? (
        <p className="text-caption-1-regular text-fg-muted">
          Decision reason: {assessment.decisionReason}
        </p>
      ) : null}
      {canApprove &&
      assessment.isCurrent &&
      assessment.approvalState === "awaiting_approval" ? (
        <AssessmentDecisionControls
          findingId={findingId}
          assessment={assessment}
          onReload={onReload}
        />
      ) : null}
    </div>
  );
}

function AssessmentFact({
  label,
  value,
}: Readonly<{ label: string; value: string }>) {
  return (
    <div>
      <dt className="text-caption-2-uppercase text-fg-subtle">{label}</dt>
      <dd className="mt-1 text-fg">{value}</dd>
    </div>
  );
}

function EvidenceLinks({ assessment }: Readonly<{ assessment: Assessment }>) {
  if (assessment.evidenceLinks.length === 0) {
    return (
      <p className="text-caption-1-regular text-fg-muted">
        No supporting evidence is linked to this revision.
      </p>
    );
  }
  return (
    <div>
      <p className="text-caption-2-uppercase text-fg-subtle">Evidence</p>
      <ul className="mt-2 grid gap-2" aria-label="Assessment evidence">
        {assessment.evidenceLinks.map((evidence) => (
          <li
            key={evidence.id}
            className="rounded-lg bg-surface-muted px-3 py-2 text-caption-1-regular text-fg"
          >
            {evidence.kind === "external" ? (
              <a
                href={evidence.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-border-strong underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                {evidence.title} (external evidence)
              </a>
            ) : (
              <span>
                {evidence.title} (tenant-authorized internal evidence)
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AssessmentHistory({
  history,
}: Readonly<{ history: VulnerabilityFindingAssessmentResponse["history"] }>) {
  return (
    <div className="mt-5 border-t border-border pt-4">
      <h4 className="text-subhead-semibold text-fg">Assessment history</h4>
      {history.length === 0 ? (
        <p className="mt-2 text-caption-1-regular text-fg-muted">
          No assessment history has been recorded.
        </p>
      ) : (
        <ol className="mt-3 grid gap-2" aria-label="Assessment history">
          {history.map((event) => (
            <li
              key={event.id}
              className="rounded-lg border border-border p-3 text-caption-1-regular text-fg"
            >
              <span className="font-medium">{titleCase(event.eventType)}</span>
              <span className="text-fg-muted">
                {" "}
                · {formatInstant(event.occurredAt)}
              </span>
              {event.reason !== null ? (
                <p className="mt-1 text-fg-muted">{event.reason}</p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function AssessmentEditor({
  findingId,
  assessment,
  onReload,
}: Readonly<{
  findingId: string;
  assessment: Assessment | null;
  onReload: () => void;
}>) {
  const submit = useSubmitVulnerabilityFindingAssessmentMutation();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Assessment["status"]>(
    assessment?.status ?? "under_investigation",
  );
  const [justification, setJustification] = useState<string>(
    assessment?.justification ?? "",
  );
  const [detail, setDetail] = useState(assessment?.detail ?? "");
  const [changeReason, setChangeReason] = useState("");
  const [externalEvidenceTitle, setExternalEvidenceTitle] = useState("");
  const [externalEvidenceUrl, setExternalEvidenceUrl] = useState("");
  const needsJustification = status === "not_affected";
  const evidenceLink = vulnerabilityAssessmentEvidenceLinkInputSchema.safeParse(
    {
      kind: "external",
      title: externalEvidenceTitle,
      url: externalEvidenceUrl,
    },
  );
  const hasPartialEvidence =
    externalEvidenceTitle.trim() !== "" || externalEvidenceUrl.trim() !== "";
  const canSubmit =
    detail.trim().length > 0 &&
    changeReason.trim().length > 0 &&
    (!needsJustification || justification !== "") &&
    (!hasPartialEvidence || evidenceLink.success);

  async function save() {
    if (!canSubmit) return;
    try {
      await submit.mutateAsync({
        findingId,
        input: {
          status,
          ...(needsJustification
            ? {
                justification: justification as NonNullable<
                  Assessment["justification"]
                >,
              }
            : {}),
          detail: detail.trim(),
          changeReason: changeReason.trim(),
          evidenceLinks: evidenceLink.success ? [evidenceLink.data] : [],
          expectedVersion: assessment?.version ?? 0,
          idempotencyKey: uuid(),
        },
      });
      setOpen(false);
      setChangeReason("");
    } catch {
      // Mutation state retains the typed transport error and entered form values.
    }
  }

  return (
    <ModalRoot open={open} onOpenChange={setOpen}>
      <ModalTrigger asChild>
        <Button size="sm">
          {assessment === null ? "Create assessment" : "Revise assessment"}
        </Button>
      </ModalTrigger>
      <ModalContent size="md">
        <ModalHeader>
          <ModalTitle>
            {assessment === null
              ? "Create VEX assessment"
              : "Revise VEX assessment"}
          </ModalTitle>
        </ModalHeader>
        <ModalBody>
          <ModalDescription>
            Submitted revisions are immutable. This action creates a new
            revision and may require approval under the policy in effect now.
          </ModalDescription>
          <div className="mt-4 grid gap-4">
            <Select
              label="VEX status"
              value={status}
              onValueChange={(value) =>
                setStatus(value as Assessment["status"])
              }
            >
              <SelectItem value="under_investigation">
                Under investigation
              </SelectItem>
              <SelectItem value="affected">Affected</SelectItem>
              <SelectItem value="not_affected">Not affected</SelectItem>
              <SelectItem value="fixed">Fixed</SelectItem>
            </Select>
            {needsJustification ? (
              <Select
                label="Permitted VEX justification"
                required
                value={justification}
                onValueChange={setJustification}
                error={
                  justification === ""
                    ? "Select a permitted justification."
                    : undefined
                }
              >
                {JUSTIFICATIONS.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </Select>
            ) : null}
            <TextAreaField
              label="Assessment detail"
              value={detail}
              onChange={setDetail}
              required
              maxLength={4_000}
            />
            <TextAreaField
              label="Revision reason"
              value={changeReason}
              onChange={setChangeReason}
              required
              maxLength={2_000}
              helper="Explain why this revision is being submitted."
            />
            <div className="grid gap-3 rounded-lg bg-surface-muted p-3">
              <p className="text-caption-1-semibold text-fg">
                Optional external evidence
              </p>
              <Input
                label="Evidence title"
                value={externalEvidenceTitle}
                maxLength={500}
                onChange={(event) =>
                  setExternalEvidenceTitle(event.target.value)
                }
              />
              <Input
                label="HTTPS URL"
                type="url"
                inputMode="url"
                value={externalEvidenceUrl}
                maxLength={2_048}
                onChange={(event) => setExternalEvidenceUrl(event.target.value)}
                error={
                  hasPartialEvidence && !evidenceLink.success
                    ? "Enter a credential-free HTTPS URL and evidence title, or clear both fields."
                    : undefined
                }
              />
            </div>
            <p className="text-caption-1-regular text-fg-muted">
              No supporting evidence is represented explicitly as absent.
              Internal evidence can only be linked when a tenant-authorized
              record is available.
            </p>
            {submit.isError ? (
              <div role="alert" className="text-caption-1-regular text-danger">
                <p>{vulnerabilityAssessmentRequestMessage(submit.error)}</p>
                <Button
                  className="mt-2"
                  size="sm"
                  variant="outline"
                  tone="grey"
                  onClick={onReload}
                >
                  Reload assessment
                </Button>
              </div>
            ) : null}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button
            loading={submit.isPending}
            disabled={!canSubmit}
            onClick={() => void save()}
          >
            {assessment === null ? "Submit assessment" : "Submit revision"}
          </Button>
          <ModalClose asChild>
            <Button variant="gap" tone="grey" disabled={submit.isPending}>
              Cancel
            </Button>
          </ModalClose>
        </ModalFooter>
      </ModalContent>
    </ModalRoot>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  required = false,
  helper,
  maxLength,
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  helper?: string;
  maxLength: number;
}>) {
  return (
    <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
      {label}
      {required ? (
        <span aria-hidden="true" className="ml-0.5 text-danger">
          *
        </span>
      ) : null}
      <textarea
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-24 rounded-xl border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-active-500"
      />
      {helper ? (
        <span className="text-caption-2-regular text-fg-subtle">{helper}</span>
      ) : null}
    </label>
  );
}

function AssessmentDecisionControls({
  findingId,
  assessment,
  onReload,
}: Readonly<{
  findingId: string;
  assessment: Assessment;
  onReload: () => void;
}>) {
  const approve = useApproveVulnerabilityFindingAssessmentMutation();
  const reject = useRejectVulnerabilityFindingAssessmentMutation();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  async function approveCurrent() {
    setMessage(null);
    try {
      await approve.mutateAsync({
        findingId,
        assessmentId: assessment.id,
        input: { expectedVersion: assessment.version, idempotencyKey: uuid() },
      });
    } catch (error) {
      setMessage(vulnerabilityAssessmentRequestMessage(error));
    }
  }
  async function rejectCurrent() {
    if (reason.trim() === "") return;
    setMessage(null);
    try {
      await reject.mutateAsync({
        findingId,
        assessmentId: assessment.id,
        input: {
          expectedVersion: assessment.version,
          decisionReason: reason.trim(),
          idempotencyKey: uuid(),
        },
      });
      setRejectOpen(false);
      setReason("");
    } catch (error) {
      setMessage(vulnerabilityAssessmentRequestMessage(error));
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
      <Button
        size="sm"
        loading={approve.isPending}
        onClick={() => void approveCurrent()}
      >
        Approve assessment
      </Button>
      <ModalRoot open={rejectOpen} onOpenChange={setRejectOpen}>
        <ModalTrigger asChild>
          <Button size="sm" variant="outline" tone="grey">
            Reject assessment
          </Button>
        </ModalTrigger>
        <ModalContent size="sm">
          <ModalHeader>
            <ModalTitle>Reject assessment</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <ModalDescription>
              A rejection is durable history. Give the security engineer a
              specific reason.
            </ModalDescription>
            <div className="mt-4">
              <TextAreaField
                label="Decision reason"
                value={reason}
                onChange={setReason}
                required
                maxLength={2_000}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              loading={reject.isPending}
              disabled={reason.trim() === ""}
              onClick={() => void rejectCurrent()}
            >
              Reject assessment
            </Button>
            <ModalClose asChild>
              <Button variant="gap" tone="grey" disabled={reject.isPending}>
                Cancel
              </Button>
            </ModalClose>
          </ModalFooter>
        </ModalContent>
      </ModalRoot>
      {message ? (
        <div role="alert" className="text-caption-1-regular text-danger">
          <p>{message}</p>
          <Button
            className="mt-2"
            size="sm"
            variant="outline"
            tone="grey"
            onClick={onReload}
          >
            Reload assessment
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ApprovalPolicyEditor({
  policy,
  error,
}: Readonly<{
  policy: VulnerabilityAssessmentApprovalPolicyListResponse | undefined;
  error: boolean;
}>) {
  const update = useUpdateVulnerabilityAssessmentApprovalPolicyMutation();
  const [message, setMessage] = useState<string | null>(null);
  async function save(
    severity: string,
    approvalRequired: boolean,
    expectedVersion: number,
  ) {
    setMessage(null);
    try {
      await update.mutateAsync({
        severity,
        input: { approvalRequired, expectedVersion, idempotencyKey: uuid() },
      });
    } catch (requestError) {
      setMessage(vulnerabilityAssessmentRequestMessage(requestError));
    }
  }
  return (
    <section
      className="mt-4 rounded-xl border border-border bg-canvas p-4"
      aria-labelledby="assessment-policy-heading"
    >
      <h3
        id="assessment-policy-heading"
        className="text-subhead-semibold text-fg"
      >
        Assessment approval policy
      </h3>
      <p className="mt-1 text-caption-1-regular text-fg-muted">
        Changes apply only to future submissions. Pending assessment snapshots
        are unchanged.
      </p>
      {error ? (
        <p role="alert" className="mt-3 text-caption-1-regular text-danger">
          The approval policy could not be loaded.
        </p>
      ) : null}
      {policy ? (
        <ul
          className="mt-3 grid gap-2"
          aria-label="Approval policy by severity"
        >
          {policy.policies.map((entry) => (
            <li
              key={entry.severity}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-muted p-3"
            >
              <span className="text-caption-1-regular text-fg">
                {titleCase(entry.severity)} ·{" "}
                {entry.approvalRequired
                  ? "approval required"
                  : "approval not required"}
              </span>
              <Button
                size="sm"
                variant="outline"
                tone="grey"
                loading={update.isPending}
                onClick={() =>
                  void save(
                    entry.severity,
                    !entry.approvalRequired,
                    entry.version,
                  )
                }
              >
                {entry.approvalRequired
                  ? "Make approval optional"
                  : "Require approval"}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {message ? (
        <p role="alert" className="mt-3 text-caption-1-regular text-danger">
          {message}
        </p>
      ) : null}
    </section>
  );
}
