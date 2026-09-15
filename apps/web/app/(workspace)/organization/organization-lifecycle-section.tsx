"use client";

import type { OrganizationLifecycle } from "@repo/contracts";
import { Button } from "@repo/ui/button";
import { Input, PasswordInput } from "@repo/ui/input";
import { useState, type FormEvent } from "react";

import {
  useDeactivateOrganizationMutation,
  useReauthenticateOrganizationMutation,
  useRecoverOrganizationMutation,
  useScheduleOrganizationPurgeMutation,
} from "../../_features/organizations/organizations.queries";
import { ApiClientError } from "../../_lib/http/api-client";
import {
  ErrorText,
  formatOrganizationInstant,
  messageFor,
  ReadonlyNotice,
} from "./organization-administration-ui";
import { SectionCard } from "../../dashboard/_components/dashboard-chrome";

function labelize(value: string): string {
  return value
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function blockerText(blocker: OrganizationLifecycle["blockers"][number]) {
  if (blocker.kind === "unavailable" || blocker.kind === "worker_failure") {
    return labelize(blocker.code);
  }
  return `${labelize(blocker.kind)} ${blocker.recordId} requires ${
    blocker.requiredRetentionDays
  } days`;
}

function needsMfaCode(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    error.kind === "api" &&
    error.code === "mfa_required"
  );
}

export function OrganizationLifecycleSection({
  lifecycle,
  slug,
  canDelete,
  organizationTimezone,
}: {
  lifecycle: OrganizationLifecycle;
  slug: string;
  canDelete: boolean;
  organizationTimezone: string | null;
}) {
  const reauthenticate = useReauthenticateOrganizationMutation();
  const deactivate = useDeactivateOrganizationMutation();
  const schedulePurge = useScheduleOrganizationPurgeMutation();
  const recover = useRecoverOrganizationMutation();
  const [grantId, setGrantId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [deactivationConfirmation, setDeactivationConfirmation] = useState("");
  const [purgeConfirmation, setPurgeConfirmation] = useState("");
  const requiredPurgeConfirmation = `DELETE ${slug}`;

  async function reauth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const response = await reauthenticate.mutateAsync({
        password: String(data.get("password") ?? ""),
        mfaCode: String(data.get("mfaCode") ?? "").trim() || undefined,
      });
      setGrantId(response.reauthenticationGrantId);
      setMfaRequired(false);
      setMessage("Fresh destructive authorization is ready.");
      // Passwords and MFA codes remain only in the form during this request.
      form.reset();
    } catch (error) {
      setMfaRequired(needsMfaCode(error));
      setMessage(
        needsMfaCode(error)
          ? "Enter the requested MFA code to continue."
          : messageFor(error, "Reauthentication failed."),
      );
    }
  }

  async function runLifecycle(action: "deactivate" | "purge" | "recover") {
    if (!grantId) {
      setMessage("Reauthenticate before destructive lifecycle changes.");
      return;
    }
    setMessage(null);
    try {
      if (action === "deactivate") {
        await deactivate.mutateAsync({
          reauthenticationGrantId: grantId,
          expectedVersion: lifecycle.version,
          confirmation: "DEACTIVATE ORGANIZATION",
        });
        setDeactivationConfirmation("");
      } else if (action === "purge") {
        await schedulePurge.mutateAsync({
          reauthenticationGrantId: grantId,
          expectedVersion: lifecycle.version,
          // This is owner-entered exact text, never a programmatic substitute.
          confirmation: purgeConfirmation,
        });
        setPurgeConfirmation("");
      } else {
        await recover.mutateAsync({
          reauthenticationGrantId: grantId,
          expectedVersion: lifecycle.version,
        });
      }
      setGrantId(null);
      setMessage("Lifecycle state updated.");
    } catch (error) {
      setMessage(messageFor(error, "Lifecycle update failed."));
    }
  }

  const busy =
    reauthenticate.isPending ||
    deactivate.isPending ||
    schedulePurge.isPending ||
    recover.isPending;
  const canDeactivate =
    lifecycle.status === "active" &&
    grantId !== null &&
    deactivationConfirmation === "DEACTIVATE ORGANIZATION";
  const canSchedulePurge =
    lifecycle.status === "deactivated" &&
    grantId !== null &&
    purgeConfirmation === requiredPurgeConfirmation;

  return (
    <SectionCard title="Deactivation and deletion">
      <div className="flex flex-col gap-4">
        {!canDelete ? (
          <ReadonlyNotice>
            Only organization owners with deletion permission can deactivate,
            recover, or schedule purge.
          </ReadonlyNotice>
        ) : null}
        <div className="rounded-xl bg-surface-subtle p-4">
          <p className="text-subhead-semibold text-fg">
            Current lifecycle: {labelize(lifecycle.status)}
          </p>
          <p className="text-caption-1-regular text-fg-muted">
            Version {lifecycle.version}. Changed {" "}
            {formatOrganizationInstant(lifecycle.changedAt, organizationTimezone)}.
          </p>
          {lifecycle.blockers.length > 0 ? (
            <ul className="mt-2 list-disc pl-5 text-caption-1-regular text-danger">
              {lifecycle.blockers.map((blocker, index) => (
                <li key={`${blocker.kind}-${index}`}>{blockerText(blocker)}</li>
              ))}
            </ul>
          ) : null}
        </div>
        {canDelete ? (
          <>
            <form
              className="grid gap-3 lg:grid-cols-[1fr_1fr_auto]"
              onSubmit={reauth}
            >
              <PasswordInput
                name="password"
                label="Fresh password confirmation"
                disabled={busy}
                required
              />
              <Input
                name="mfaCode"
                label={mfaRequired ? "MFA code" : "MFA code if requested"}
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                disabled={busy}
                required={mfaRequired}
              />
              <Button
                type="submit"
                className="lg:self-end"
                loading={reauthenticate.isPending}
              >
                Reauthenticate
              </Button>
            </form>
            <div className="rounded-xl border border-danger p-4">
              <p className="mb-3 text-subhead-regular text-fg">
                High-friction confirmations are enforced by the server. Type
                the exact text requested for the action after reauthentication.
              </p>
              {lifecycle.status === "active" ? (
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                  <Input
                    label="Deactivation confirmation"
                    value={deactivationConfirmation}
                    onChange={(event) =>
                      setDeactivationConfirmation(event.target.value)
                    }
                    placeholder="DEACTIVATE ORGANIZATION"
                    disabled={busy}
                    autoCapitalize="characters"
                    autoComplete="off"
                  />
                  <Button
                    type="button"
                    className="lg:self-end"
                    onClick={() => void runLifecycle("deactivate")}
                    disabled={busy || !canDeactivate}
                  >
                    Deactivate tenant
                  </Button>
                </div>
              ) : null}
              {lifecycle.status === "deactivated" ? (
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                  <Input
                    label="Purge confirmation"
                    value={purgeConfirmation}
                    onChange={(event) => setPurgeConfirmation(event.target.value)}
                    placeholder={requiredPurgeConfirmation}
                    disabled={busy}
                    autoCapitalize="none"
                    autoComplete="off"
                    helperText="Type the exact confirmation to schedule irreversible deletion after the grace period."
                  />
                  <div className="flex flex-wrap gap-3 lg:self-end">
                    <Button
                      type="button"
                      variant="outline"
                      tone="grey"
                      onClick={() => void runLifecycle("recover")}
                      disabled={busy || grantId === null}
                    >
                      Recover tenant
                    </Button>
                    <Button
                      type="button"
                      onClick={() => void runLifecycle("purge")}
                      disabled={busy || !canSchedulePurge}
                    >
                      Schedule purge
                    </Button>
                  </div>
                </div>
              ) : null}
              {lifecycle.status === "purge_scheduled" ? (
                <div className="flex flex-col gap-3">
                  <p className="text-caption-1-regular text-fg-muted">
                    Purge is scheduled during the grace period. Recovery cancels
                    the scheduled deletion before purging begins.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    tone="grey"
                    onClick={() => void runLifecycle("recover")}
                    disabled={busy || grantId === null}
                  >
                    Recover tenant
                  </Button>
                </div>
              ) : null}
              {lifecycle.status === "purge_blocked" ? (
                <p className="text-caption-1-regular text-danger">
                  Purge remains blocked until every listed retention obligation
                  or legal hold is resolved.
                </p>
              ) : null}
              {lifecycle.status === "purging" || lifecycle.status === "purged" ? (
                <p className="text-caption-1-regular text-fg-muted">
                  Tenant restoration is unavailable after purging begins.
                </p>
              ) : null}
            </div>
          </>
        ) : null}
        <ErrorText>{message}</ErrorText>
      </div>
    </SectionCard>
  );
}
