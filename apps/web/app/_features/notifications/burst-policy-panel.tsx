"use client";

import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import { useEffect, useRef, useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import { useSession } from "../../_providers/session-provider";
import {
  useNotificationBurstPolicyQuery,
  useUpdateNotificationBurstPolicyMutation,
} from "./notifications.queries";

function messageFor(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 403)
      return "You no longer have permission to manage notification batching.";
    if (error.status === 409)
      return "The burst policy changed in another tab. Your draft is still here; refresh before saving again.";
    if (error.kind === "network")
      return "Notification settings are offline. Your draft is still here; retry when connected.";
  }
  return "Notification batching settings are temporarily unavailable. Retry when connected.";
}

export function BurstPolicyPanel({
  canManage,
}: Readonly<{ canManage: boolean }>) {
  const { session } = useSession();
  const organizationId = session?.organization?.id ?? null;
  const lastOrganization = useRef(organizationId);
  const minimumConfirmedVersion = useRef<number | null>(null);
  const policyQuery = useNotificationBurstPolicyQuery(canManage);
  const updatePolicy = useUpdateNotificationBurstPolicyMutation();
  const [draftEnabled, setDraftEnabled] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const alertRef = useRef<HTMLParagraphElement | null>(null);
  const policy = policyQuery.data?.policy;

  useEffect(() => {
    if (lastOrganization.current === organizationId) return;
    lastOrganization.current = organizationId;
    setDirty(false);
    setError(null);
    setMessage(null);
    setDraftEnabled(false);
    minimumConfirmedVersion.current = null;
  }, [organizationId]);

  useEffect(() => {
    if (!policy || dirty) return;
    if (
      minimumConfirmedVersion.current !== null &&
      policy.version < minimumConfirmedVersion.current
    )
      return;
    minimumConfirmedVersion.current = null;
    setDraftEnabled(policy.enabled);
  }, [policy, dirty]);

  useEffect(() => {
    if (error) alertRef.current?.focus();
  }, [error]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (!canManage || !policy || !dirty || !organizationId) return;
    const requestedOrganization = organizationId;
    try {
      const result = await updatePolicy.mutateAsync({
        enabled: draftEnabled,
        expectedVersion: policy.version,
        idempotencyKey: crypto.randomUUID(),
      });
      if (lastOrganization.current !== requestedOrganization) return;
      minimumConfirmedVersion.current = result.policy.version;
      setDraftEnabled(result.policy.enabled);
      setDirty(false);
      setMessage("Burst policy saved.");
    } catch (cause) {
      if (lastOrganization.current === requestedOrganization)
        setError(messageFor(cause));
    }
  }

  return (
    <section
      aria-labelledby="burst-policy-title"
      className="space-y-3 rounded-xl border border-border bg-canvas p-4"
    >
      <div className="space-y-1">
        <h3 id="burst-policy-title" className="text-subhead-semibold text-fg">
          Notification bursts
        </h3>
        <p className="text-caption-1-regular text-fg-muted">
          Eligible feed and immediate email updates are grouped within two
          minutes or 100 email events. Regulatory deadlines, approvals,
          failures, and high or critical alerts remain immediate.
        </p>
      </div>
      {!canManage ? (
        <p className="text-caption-1-regular text-fg-muted">
          You do not have permission to change notification batching.
        </p>
      ) : null}
      {canManage && policyQuery.isLoading ? (
        <p role="status" className="text-caption-1-regular text-fg-muted">
          Loading burst policy…
        </p>
      ) : null}
      {canManage && policyQuery.isError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 text-caption-1-regular text-danger"
        >
          <span>{messageFor(policyQuery.error)}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void policyQuery.refetch()}
          >
            Retry burst policy
          </Button>
        </div>
      ) : null}
      {policy ? (
        <form className="space-y-3" onSubmit={(event) => void save(event)}>
          <label
            className={cn(
              "flex items-start gap-3 text-caption-1-regular text-fg",
              !canManage && "text-fg-muted",
            )}
          >
            <input
              type="checkbox"
              className="mt-1 size-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              checked={draftEnabled}
              disabled={!canManage || updatePolicy.isPending}
              onChange={(event) => {
                setDraftEnabled(event.target.checked);
                setDirty(event.target.checked !== policy.enabled);
                setError(null);
                setMessage(null);
              }}
            />
            Batch eligible notifications for this organization
          </label>
          <p className="text-caption-2-regular text-fg-muted">
            Current state: {policy.enabled ? "Enabled" : "Disabled"}. New source
            events follow this setting; critical alerts remain immediate.
          </p>
          {canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                size="sm"
                loading={updatePolicy.isPending}
                disabled={!dirty || updatePolicy.isPending}
              >
                Save burst policy
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void policyQuery.refetch()}
              >
                Refresh burst policy
              </Button>
            </div>
          ) : null}
        </form>
      ) : null}
      {error ? (
        <p
          ref={alertRef}
          tabIndex={-1}
          role="alert"
          className="text-caption-1-regular text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          {error}
        </p>
      ) : null}
      {message ? (
        <p
          role="status"
          aria-live="polite"
          className="text-caption-1-regular text-fg-muted"
        >
          {message}
        </p>
      ) : null}
    </section>
  );
}
