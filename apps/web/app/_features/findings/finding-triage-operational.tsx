"use client";

import type {
  VulnerabilityTriageOperationalState,
  VulnerabilityTriageSlaPolicy,
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
import { useState } from "react";

import {
  useHasPermission,
  useSession,
} from "../../_providers/session-provider";
import { ApiClientError } from "../../_lib/http/api-client";
import {
  useAssignVulnerabilityTriageFindingMutation,
  useSuppressVulnerabilityTriageFindingMutation,
  useUpdateVulnerabilityTriageSlaPolicyMutation,
  useVulnerabilityTriageSlaPoliciesQuery,
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

function toDateTimeLocal(value: string): string {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function uuid(): string {
  return crypto.randomUUID();
}

function toneForOperationalState(value: string): TagProps["tone"] {
  if (value === "breached" || value === "dead_letter") return "red";
  if (value === "suppressed" || value === "paused" || value === "retrying")
    return "orange";
  if (value === "tracking" || value === "delivered") return "green";
  return "purple";
}

export function triageOperationalRequestMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 403)
    return "You no longer have permission to change this triage operation.";
  if (error instanceof ApiClientError && error.status === 409)
    return "This finding changed in another session. Reload the detail and try again.";
  if (error instanceof ApiClientError && error.kind === "network")
    return "You are offline. Your entered work is still here; reconnect and try again.";
  return "This triage operation could not be saved. Try again.";
}

export function FindingTriageOperational({
  findingId,
  operational,
}: Readonly<{
  findingId: string;
  operational: VulnerabilityTriageOperationalState;
}>) {
  const canEdit = useHasPermission("can_edit_findings");
  const { role } = useSession();
  const canEditOrganization = useHasPermission("can_edit_organization");
  const canManagePolicy = role === "owner" && canEditOrganization;
  const policies = useVulnerabilityTriageSlaPoliciesQuery(canManagePolicy);
  const suppression = operational.suppression;
  const sla = operational.internalSla;
  const notification = operational.notification;

  return (
    <section className="mt-6" aria-labelledby="triage-operations-heading">
      <div className="rounded-xl border border-border bg-canvas p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3
              id="triage-operations-heading"
              className="text-subhead-semibold text-fg"
            >
              Triage operations
            </h3>
            <p className="mt-1 text-caption-1-regular text-fg-muted">
              Operational queue state only. It does not change VEX, risk, or
              regulatory deadlines.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canEdit ? (
              <AssignmentDialog
                findingId={findingId}
                operational={operational}
              />
            ) : null}
            {canEdit ? (
              <SuppressionDialog
                findingId={findingId}
                operational={operational}
              />
            ) : null}
          </div>
        </div>

        <dl className="mt-4 grid gap-3 text-caption-1-regular sm:grid-cols-2">
          <OperationalFact
            label="Responsible user"
            value={operational.assignee?.displayName ?? "Unassigned"}
          />
          <OperationalFact
            label={
              suppression.state === "suppressed"
                ? "Suppressed until"
                : "Queue state"
            }
            value={
              suppression.state === "suppressed" &&
              suppression.expiresAt !== null
                ? formatInstant(suppression.expiresAt)
                : "Actionable"
            }
          />
          <OperationalFact
            label="Internal triage SLA"
            value={
              sla.state === "not_configured"
                ? "Internal SLA not configured"
                : sla.dueAt === null
                  ? `${titleCase(sla.state)} · due time unavailable`
                  : `${titleCase(sla.state)} · due ${formatInstant(sla.dueAt)}`
            }
          />
          <OperationalFact
            label="Alert delivery"
            value={`Delivery ${titleCase(notification.state)}`}
          />
        </dl>
        <div className="mt-3 flex flex-wrap gap-2">
          <Tag variant="dot" tone={toneForOperationalState(suppression.state)}>
            {titleCase(suppression.state)}
          </Tag>
          <Tag variant="dot" tone={toneForOperationalState(sla.state)}>
            Internal SLA {titleCase(sla.state)}
          </Tag>
          <Tag variant="dot" tone={toneForOperationalState(notification.state)}>
            Delivery {titleCase(notification.state)}
          </Tag>
        </div>
        {suppression.reason !== null ? (
          <p className="mt-3 text-caption-1-regular text-fg">
            Suppression reason: {suppression.reason}
          </p>
        ) : null}
        {notification.failureMessage !== null ? (
          <p role="status" className="mt-2 text-caption-1-regular text-warning">
            Delivery issue: {notification.failureMessage}
          </p>
        ) : null}
      </div>
      {canManagePolicy ? (
        <SlaPolicySettings
          policies={policies.data?.policies}
          isError={policies.isError}
        />
      ) : null}
    </section>
  );
}

function OperationalFact({
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

function AssignmentDialog({
  findingId,
  operational,
}: Readonly<{
  findingId: string;
  operational: VulnerabilityTriageOperationalState;
}>) {
  const assign = useAssignVulnerabilityTriageFindingMutation();
  const [open, setOpen] = useState(false);
  const [assigneeUserId, setAssigneeUserId] = useState(
    operational.assignee?.userId ?? "",
  );
  const [message, setMessage] = useState<string | null>(null);
  async function save() {
    const normalized = assigneeUserId.trim();
    if (
      normalized !== "" &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        normalized,
      )
    ) {
      setMessage(
        "Enter a valid user ID or leave it blank to clear assignment.",
      );
      return;
    }
    setMessage(null);
    try {
      await assign.mutateAsync({
        findingId,
        input: {
          assigneeUserId: normalized === "" ? null : normalized,
          expectedVersion: operational.version,
          idempotencyKey: uuid(),
        },
      });
      setOpen(false);
    } catch (error) {
      setMessage(triageOperationalRequestMessage(error));
    }
  }
  return (
    <ModalRoot open={open} onOpenChange={setOpen}>
      <ModalTrigger asChild>
        <Button size="sm" variant="outline" tone="grey">
          Assign owner
        </Button>
      </ModalTrigger>
      <ModalContent aria-label="Assign responsible user">
        <ModalHeader>
          <ModalTitle>Assign responsible user</ModalTitle>
          <ModalDescription>
            Only an active eligible organization member can be assigned.
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          <label className="flex flex-col gap-1 text-caption-1-regular text-fg">
            Assignee user ID
            <Input
              value={assigneeUserId}
              onChange={(event) => setAssigneeUserId(event.target.value)}
            />
          </label>
          <p className="mt-2 text-caption-1-regular text-fg-muted">
            Leave blank to clear the assignment; eligible owners or admins
            receive fallback alerts.
          </p>
          {message ? (
            <p role="alert" className="mt-2 text-caption-1-regular text-danger">
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
          <Button loading={assign.isPending} onClick={() => void save()}>
            Save assignment
          </Button>
        </ModalFooter>
      </ModalContent>
    </ModalRoot>
  );
}

function SuppressionDialog({
  findingId,
  operational,
}: Readonly<{
  findingId: string;
  operational: VulnerabilityTriageOperationalState;
}>) {
  const suppress = useSuppressVulnerabilityTriageFindingMutation();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(operational.suppression.reason ?? "");
  const [expiresAt, setExpiresAt] = useState(
    operational.suppression.expiresAt === null
      ? ""
      : toDateTimeLocal(operational.suppression.expiresAt),
  );
  const [message, setMessage] = useState<string | null>(null);
  async function save() {
    if (reason.trim() === "") {
      setMessage("A reason is required.");
      return;
    }
    const instant = new Date(expiresAt);
    if (
      expiresAt === "" ||
      Number.isNaN(instant.getTime()) ||
      instant <= new Date()
    ) {
      setMessage("Choose a future suppression expiry.");
      return;
    }
    setMessage(null);
    try {
      await suppress.mutateAsync({
        findingId,
        input: {
          reason: reason.trim(),
          expiresAt: instant.toISOString(),
          expectedVersion: operational.version,
          idempotencyKey: uuid(),
        },
      });
      setOpen(false);
    } catch (error) {
      setMessage(triageOperationalRequestMessage(error));
    }
  }
  const extending = operational.suppression.state === "suppressed";
  return (
    <ModalRoot open={open} onOpenChange={setOpen}>
      <ModalTrigger asChild>
        <Button size="sm" variant="outline" tone="grey">
          {extending ? "Extend suppression" : "Suppress finding"}
        </Button>
      </ModalTrigger>
      <ModalContent
        aria-label={extending ? "Extend suppression" : "Suppress finding"}
      >
        <ModalHeader>
          <ModalTitle>
            {extending ? "Extend suppression" : "Suppress finding"}
          </ModalTitle>
          <ModalDescription>
            Suppression is finite and preserves all VEX, risk, and regulatory
            evidence.
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          <label className="flex flex-col gap-1 text-caption-1-regular text-fg">
            Suppression reason
            <textarea
              aria-label="Suppression reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="min-h-24 rounded-xl border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg"
            />
          </label>
          <label className="mt-3 flex flex-col gap-1 text-caption-1-regular text-fg">
            Suppression expiry
            <Input
              aria-label="Suppression expiry"
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
          </label>
          {message ? (
            <p role="alert" className="mt-2 text-caption-1-regular text-danger">
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
          <Button loading={suppress.isPending} onClick={() => void save()}>
            Save suppression
          </Button>
        </ModalFooter>
      </ModalContent>
    </ModalRoot>
  );
}

function SlaPolicySettings({
  policies,
  isError,
}: Readonly<{
  policies: readonly VulnerabilityTriageSlaPolicy[] | undefined;
  isError: boolean;
}>) {
  const update = useUpdateVulnerabilityTriageSlaPolicyMutation();
  const [message, setMessage] = useState<string | null>(null);
  async function save(
    policy: VulnerabilityTriageSlaPolicy,
    enabled: boolean,
    target: string,
  ) {
    const targetMinutes = target === "" ? null : Number(target);
    if (
      enabled &&
      (!Number.isInteger(targetMinutes) ||
        targetMinutes === null ||
        targetMinutes <= 0)
    ) {
      setMessage(
        "Enabled internal SLA policies require a positive whole-minute target.",
      );
      return;
    }
    if (!enabled && targetMinutes !== null) {
      setMessage("Disable an SLA only with an empty target.");
      return;
    }
    setMessage(null);
    try {
      await update.mutateAsync({
        severity: policy.severity,
        enabled,
        targetMinutes,
        expectedVersion: policy.version,
        idempotencyKey: uuid(),
      });
    } catch (error) {
      setMessage(triageOperationalRequestMessage(error));
    }
  }
  return (
    <section
      className="mt-4 rounded-xl border border-border bg-surface p-4"
      aria-labelledby="internal-sla-policy-heading"
    >
      <h3
        id="internal-sla-policy-heading"
        className="text-subhead-semibold text-fg"
      >
        Internal SLA policy
      </h3>
      <p className="mt-1 text-caption-1-regular text-fg-muted">
        Owner configuration for internal remediation only; this is not a
        regulatory obligation.
      </p>
      {isError ? (
        <p role="alert" className="mt-3 text-caption-1-regular text-danger">
          Internal SLA policy is unavailable. Retry from this finding later.
        </p>
      ) : null}
      {policies?.length === 0 ? (
        <p className="mt-3 text-caption-1-regular text-fg-muted">
          Internal SLA not configured.
        </p>
      ) : null}
      <div className="mt-3 grid gap-3">
        {policies?.map((policy) => (
          <SlaPolicyRow
            key={policy.severity}
            policy={policy}
            disabled={update.isPending}
            onSave={save}
          />
        ))}
      </div>
      {message ? (
        <p role="alert" className="mt-3 text-caption-1-regular text-danger">
          {message}
        </p>
      ) : null}
    </section>
  );
}

function SlaPolicyRow({
  policy,
  disabled,
  onSave,
}: Readonly<{
  policy: VulnerabilityTriageSlaPolicy;
  disabled: boolean;
  onSave: (
    policy: VulnerabilityTriageSlaPolicy,
    enabled: boolean,
    target: string,
  ) => Promise<void>;
}>) {
  const [enabled, setEnabled] = useState(policy.enabled);
  const [target, setTarget] = useState(policy.targetMinutes?.toString() ?? "");
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-canvas p-3">
      <div>
        <label className="flex items-center gap-2 text-caption-1-regular text-fg">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />{" "}
          {titleCase(policy.severity)}
        </label>
        {!enabled ? (
          <p className="mt-1 text-caption-1-regular text-fg-muted">
            Internal SLA not configured
          </p>
        ) : null}
      </div>
      <label className="flex flex-col gap-1 text-caption-1-regular text-fg">
        Target minutes
        <Input
          aria-label={`${titleCase(policy.severity)} SLA target minutes`}
          type="number"
          min="1"
          disabled={!enabled}
          value={target}
          onChange={(event) => setTarget(event.target.value)}
        />
      </label>
      <Button
        size="sm"
        loading={disabled}
        onClick={() => void onSave(policy, enabled, target)}
      >
        Save
      </Button>
    </div>
  );
}
