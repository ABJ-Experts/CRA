"use client";

import type {
  VulnerabilityAssessmentBulkOperation,
  VulnerabilityFindingAssessment,
  VulnerabilityTriageQueueQuery,
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
import { useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import {
  useCreateVulnerabilityAssessmentBulkPreviewMutation,
  useCreateVulnerabilityAssessmentPropagationPreviewMutation,
  useExecuteVulnerabilityAssessmentBulkOperationMutation,
  useRetryVulnerabilityAssessmentBulkOperationMutation,
  useUndoVulnerabilityAssessmentBulkOperationMutation,
} from "./triage.queries";

type QueueFilters = Omit<VulnerabilityTriageQueueQuery, "cursor" | "limit">;

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

function uuid() {
  return crypto.randomUUID();
}

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function vulnerabilityAssessmentBulkRequestMessage(error: unknown) {
  if (error instanceof ApiClientError && error.status === 403) {
    return "You no longer have permission to assess findings in this organization.";
  }
  if (error instanceof ApiClientError && error.status === 404) {
    return "This preview is no longer available in this organization.";
  }
  if (error instanceof ApiClientError && error.status === 409) {
    return "The preview changed or expired. Review the latest scope before continuing.";
  }
  if (error instanceof ApiClientError && error.kind === "network") {
    return "You are offline. Your entered assessment remains available; reconnect and try again.";
  }
  return "This bulk assessment could not be completed. Try again.";
}

function OutcomeSummary({
  operation,
}: Readonly<{ operation: VulnerabilityAssessmentBulkOperation }>) {
  const counts = operation.counts;
  return (
    <div className="mt-4 rounded-lg border border-border bg-surface-subtle p-3">
      <p className="text-caption-1-semibold text-fg">
        {operation.kind === "propagation"
          ? "Propagation preview"
          : "Bulk assessment preview"}
      </p>
      <p className="mt-1 text-caption-1-regular text-fg-muted">
        {operation.selectionMode === "all_matching"
          ? "All findings matching the server-validated filters are captured."
          : "Only the selected rows are captured."}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-caption-1-regular text-fg sm:grid-cols-4">
        <Count label="Captured" value={counts.selected} />
        <Count label="Eligible" value={counts.eligible} />
        <Count label="Excluded" value={counts.excluded} />
        <Count label="Applied" value={counts.applied} />
      </dl>
      {operation.targets.length > 0 ? (
        <ul
          className="mt-3 max-h-44 space-y-2 overflow-y-auto"
          aria-label="Bulk assessment target results"
        >
          {operation.targets.map((target) => (
            <li
              key={target.findingId}
              className="rounded-lg bg-canvas px-3 py-2 text-caption-1-regular text-fg"
            >
              <span className="font-medium">
                {target.product?.name ?? "Unavailable product"} /{" "}
                {target.release?.name ?? "Unavailable release"}
              </span>
              <span className="block text-fg-muted">
                {target.componentIdentity} {target.componentVersion} ·{" "}
                {titleCase(target.outcome)}
                {target.outcomeMessage ? ` — ${target.outcomeMessage}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Count({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <div>
      <dt className="text-caption-2-uppercase text-fg-subtle">{label}</dt>
      <dd className="mt-1 font-medium text-fg">{value}</dd>
    </div>
  );
}

function OperationControls({
  operation,
  onComplete,
}: Readonly<{
  operation: VulnerabilityAssessmentBulkOperation;
  onComplete: (operation: VulnerabilityAssessmentBulkOperation) => void;
}>) {
  const execute = useExecuteVulnerabilityAssessmentBulkOperationMutation();
  const retry = useRetryVulnerabilityAssessmentBulkOperationMutation();
  const undo = useUndoVulnerabilityAssessmentBulkOperationMutation();
  const [message, setMessage] = useState<string | null>(null);
  const canExecute =
    operation.state === "previewed" ||
    operation.state === "scope_changed" ||
    operation.state === "executing";
  const canRetry = operation.counts.failed > 0 || operation.counts.pending > 0;
  const canUndo = operation.counts.applied > operation.counts.undone;
  const busy = execute.isPending || retry.isPending || undo.isPending;

  async function run(
    kind: "execute" | "retry" | "undo",
    confirmScopeChanges = false,
  ) {
    setMessage(null);
    try {
      const result =
        kind === "execute"
          ? await execute.mutateAsync({
              operationId: operation.id,
              input: {
                expectedVersion: operation.version,
                snapshotDigest: operation.snapshotDigest,
                confirmScopeChanges,
                idempotencyKey: uuid(),
              },
            })
          : kind === "retry"
            ? await retry.mutateAsync({
                operationId: operation.id,
                input: {
                  expectedVersion: operation.version,
                  snapshotDigest: operation.snapshotDigest,
                  confirmScopeChanges,
                  idempotencyKey: uuid(),
                },
              })
            : await undo.mutateAsync({
                operationId: operation.id,
                input: {
                  expectedVersion: operation.version,
                  idempotencyKey: uuid(),
                },
              });
      onComplete(result.operation);
    } catch (error) {
      setMessage(vulnerabilityAssessmentBulkRequestMessage(error));
    }
  }

  return (
    <div className="mt-4">
      {operation.state === "scope_changed" ? (
        <p role="alert" className="text-caption-1-regular text-warning">
          Some captured findings changed. Confirming continues only for
          unchanged targets; changed findings stay listed as skipped.
        </p>
      ) : null}
      {operation.state === "expired" ? (
        <p role="alert" className="text-caption-1-regular text-warning">
          This preview expired after 30 minutes. Create a new preview to refresh
          the target scope.
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {canExecute ? (
          <Button
            loading={execute.isPending}
            disabled={busy}
            onClick={() =>
              void run("execute", operation.state === "scope_changed")
            }
          >
            {operation.state === "scope_changed"
              ? "Confirm changed scope"
              : "Apply next 100 findings"}
          </Button>
        ) : null}
        {canRetry ? (
          <Button
            size="sm"
            variant="outline"
            tone="grey"
            loading={retry.isPending}
            disabled={busy}
            onClick={() =>
              void run("retry", operation.state === "scope_changed")
            }
          >
            Retry remaining targets
          </Button>
        ) : null}
        {canUndo ? (
          <Button
            size="sm"
            variant="outline"
            tone="grey"
            loading={undo.isPending}
            disabled={busy}
            onClick={() => void run("undo")}
          >
            Undo applied revisions
          </Button>
        ) : null}
      </div>
      {message ? (
        <p role="alert" className="mt-3 text-caption-1-regular text-danger">
          {message}
        </p>
      ) : null}
    </div>
  );
}

export function FindingBulkAssessmentAction({
  filters,
  selectedFindingIds,
  onApplied,
}: Readonly<{
  filters: QueueFilters;
  selectedFindingIds: readonly string[];
  onApplied: () => void;
}>) {
  const preview = useCreateVulnerabilityAssessmentBulkPreviewMutation();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"selected_rows" | "all_matching">(
    "selected_rows",
  );
  const [status, setStatus] = useState<
    "under_investigation" | "affected" | "not_affected" | "fixed"
  >("under_investigation");
  const [justification, setJustification] = useState("");
  const [detail, setDetail] = useState("");
  const [changeReason, setChangeReason] = useState("");
  const [evidenceTitle, setEvidenceTitle] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [operation, setOperation] =
    useState<VulnerabilityAssessmentBulkOperation | null>(null);
  const needsJustification = status === "not_affected";
  const evidence = vulnerabilityAssessmentEvidenceLinkInputSchema.safeParse({
    kind: "external",
    title: evidenceTitle,
    url: evidenceUrl,
  });
  const partialEvidence =
    evidenceTitle.trim() !== "" || evidenceUrl.trim() !== "";
  const canPreview =
    (scope === "all_matching" || selectedFindingIds.length > 0) &&
    detail.trim() !== "" &&
    changeReason.trim() !== "" &&
    (!needsJustification || justification !== "") &&
    (!partialEvidence || evidence.success);

  async function createPreview() {
    if (!canPreview) return;
    try {
      const result = await preview.mutateAsync({
        selection:
          scope === "all_matching"
            ? { mode: "all_matching", filters: withoutQueueControls(filters) }
            : { mode: "selected_rows", findingIds: [...selectedFindingIds] },
        assessment: {
          status,
          ...(needsJustification
            ? { justification: justification as "component_not_present" }
            : {}),
          detail: detail.trim(),
          changeReason: changeReason.trim(),
          evidenceLinks: evidence.success ? [evidence.data] : [],
        },
        idempotencyKey: uuid(),
      });
      setOperation(result.operation);
    } catch {
      // Form state remains available and the typed mutation error is rendered below.
    }
  }

  return (
    <ModalRoot open={open} onOpenChange={setOpen}>
      <ModalTrigger asChild>
        <Button size="sm">Bulk assess findings</Button>
      </ModalTrigger>
      <ModalContent size="lg">
        <ModalHeader>
          <ModalTitle>Bulk VEX assessment</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <ModalDescription>
            Review a frozen server-side target list before applying immutable
            VEX revisions. Approval policy is evaluated for every target.
          </ModalDescription>
          {operation ? (
            <>
              <OutcomeSummary operation={operation} />
              <OperationControls
                operation={operation}
                onComplete={(next) => {
                  setOperation(next);
                  if (next.counts.applied > 0) onApplied();
                }}
              />
            </>
          ) : (
            <div className="mt-4 grid gap-4">
              <Select
                label="Scope"
                value={scope}
                onValueChange={(value) => setScope(value as typeof scope)}
              >
                <SelectItem value="selected_rows">
                  Selected rows ({selectedFindingIds.length})
                </SelectItem>
                <SelectItem value="all_matching">
                  All findings matching filters
                </SelectItem>
              </Select>
              <Select
                label="VEX status"
                value={status}
                onValueChange={(value) => setStatus(value as typeof status)}
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
                >
                  {JUSTIFICATIONS.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </Select>
              ) : null}
              <TextArea
                label="Assessment detail"
                value={detail}
                onChange={setDetail}
              />
              <TextArea
                label="Revision reason"
                value={changeReason}
                onChange={setChangeReason}
              />
              <div className="grid gap-3 rounded-lg bg-surface-muted p-3">
                <p className="text-caption-1-semibold text-fg">
                  Optional external evidence
                </p>
                <Input
                  label="Evidence title"
                  value={evidenceTitle}
                  onChange={(event) => setEvidenceTitle(event.target.value)}
                />
                <Input
                  label="HTTPS URL"
                  type="url"
                  value={evidenceUrl}
                  onChange={(event) => setEvidenceUrl(event.target.value)}
                  error={
                    partialEvidence && !evidence.success
                      ? "Enter a credential-free HTTPS URL and title, or clear both fields."
                      : undefined
                  }
                />
              </div>
              {preview.isError ? (
                <p role="alert" className="text-caption-1-regular text-danger">
                  {vulnerabilityAssessmentBulkRequestMessage(preview.error)}
                </p>
              ) : null}
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          {!operation ? (
            <Button
              loading={preview.isPending}
              disabled={!canPreview}
              onClick={() => void createPreview()}
            >
              Preview impact
            </Button>
          ) : null}
          <ModalClose asChild>
            <Button variant="gap" tone="grey" disabled={preview.isPending}>
              Close
            </Button>
          </ModalClose>
        </ModalFooter>
      </ModalContent>
    </ModalRoot>
  );
}

export function FindingAssessmentPropagationAction({
  findingId,
  assessment,
}: Readonly<{
  findingId: string;
  assessment: VulnerabilityFindingAssessment;
}>) {
  const preview = useCreateVulnerabilityAssessmentPropagationPreviewMutation();
  const [open, setOpen] = useState(false);
  const [changeReason, setChangeReason] = useState("");
  const [operation, setOperation] =
    useState<VulnerabilityAssessmentBulkOperation | null>(null);
  async function createPreview() {
    if (changeReason.trim() === "") return;
    try {
      const result = await preview.mutateAsync({
        sourceFindingId: findingId,
        sourceAssessmentId: assessment.id,
        sourceAssessmentVersion: assessment.version,
        changeReason: changeReason.trim(),
        idempotencyKey: uuid(),
      });
      setOperation(result.operation);
    } catch {
      // Preserve the reason for a safe retry.
    }
  }
  return (
    <ModalRoot open={open} onOpenChange={setOpen}>
      <ModalTrigger asChild>
        <Button size="sm" variant="outline" tone="grey">
          Preview propagation
        </Button>
      </ModalTrigger>
      <ModalContent size="lg">
        <ModalHeader>
          <ModalTitle>Propagate this VEX assessment</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <ModalDescription>
            Only same-tenant findings with the identical canonical component
            identity and version are included. Approval is not copied.
          </ModalDescription>
          {operation ? (
            <>
              <OutcomeSummary operation={operation} />
              <OperationControls
                operation={operation}
                onComplete={setOperation}
              />
            </>
          ) : (
            <div className="mt-4">
              <TextArea
                label="Propagation reason"
                value={changeReason}
                onChange={setChangeReason}
              />
              <p className="mt-2 text-caption-1-regular text-fg-muted">
                This appends immutable revisions; it does not overwrite later
                decisions.
              </p>
              {preview.isError ? (
                <p
                  role="alert"
                  className="mt-2 text-caption-1-regular text-danger"
                >
                  {vulnerabilityAssessmentBulkRequestMessage(preview.error)}
                </p>
              ) : null}
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          {!operation ? (
            <Button
              loading={preview.isPending}
              disabled={changeReason.trim() === ""}
              onClick={() => void createPreview()}
            >
              Preview blast radius
            </Button>
          ) : null}
          <ModalClose asChild>
            <Button variant="gap" tone="grey">
              Close
            </Button>
          </ModalClose>
        </ModalFooter>
      </ModalContent>
    </ModalRoot>
  );
}

function TextArea({
  label,
  value,
  onChange,
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
}>) {
  return (
    <label className="grid gap-1 text-caption-1-regular text-fg">
      {label}
      <textarea
        value={value}
        maxLength={4_000}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-24 rounded-xl border border-border bg-canvas p-3 text-subhead-regular text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      />
    </label>
  );
}

function withoutQueueControls(filters: QueueFilters) {
  return Object.fromEntries(
    Object.entries(filters).filter(
      ([key]) => key !== "sort" && key !== "order",
    ),
  );
}
