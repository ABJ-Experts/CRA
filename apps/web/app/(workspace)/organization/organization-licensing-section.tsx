"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import { SectionCard } from "../../dashboard/_components/dashboard-chrome";
import { useLicensingQueries } from "../../_features/licensing/licensing.queries";
import {
  LICENCE_STATE_LABELS,
  licenceDate,
  licenceReason,
} from "../../_features/licensing/licensing-status";
import { ApiClientError } from "../../_lib/http/api-client";

const FIELD_CLASS =
  "w-full rounded-lg border border-border bg-canvas p-3 text-subhead-regular text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-active-500";
const MAX_ARTIFACT_BYTES = 32 * 1024;

export function OrganizationLicensingSection({
  organizationId,
}: {
  organizationId: string;
}) {
  const { current, history, activation, canView, canManage, revoked } =
    useLicensingQueries();
  const [draft, setDraft] = useState({ organizationId, artifact: "" });
  const artifact =
    draft.organizationId === organizationId ? draft.artifact : "";
  const [feedback, setFeedback] = useState<{
    organizationId: string;
    message: string;
    error: boolean;
  } | null>(null);
  const attempt = useRef<{
    organizationId: string;
    artifact: string;
    version: number;
    id: string;
  } | null>(null);
  const artifactId = useId();
  const feedbackId = useId();
  const data = current.data;
  const message = feedback?.organizationId === organizationId ? feedback : null;
  function report(text: string, error: boolean) {
    setFeedback({ organizationId, message: text, error });
  }
  async function activate() {
    if (!data || !canManage) return;
    if (new TextEncoder().encode(artifact).byteLength > MAX_ARTIFACT_BYTES) {
      report("Licence artifacts must be no larger than 32 KiB.", true);
      return;
    }
    if (
      !attempt.current ||
      attempt.current.organizationId !== organizationId ||
      attempt.current.artifact !== artifact
    )
      attempt.current = {
        organizationId,
        artifact,
        version: data.version,
        id: crypto.randomUUID(),
      };
    try {
      await activation.mutateAsync({
        artifact,
        expectedVersion: attempt.current.version,
        idempotencyKey: attempt.current.id,
      });
      report("Licence activated. Current policy has been refreshed.", false);
      setDraft({ organizationId, artifact: "" });
      attempt.current = null;
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 409)
        attempt.current = null;
      report(
        error instanceof ApiClientError && error.status === 409
          ? "The licence changed while you were editing. Refresh, review the current version, and retry. Your draft is preserved."
          : error instanceof Error
            ? error.message
            : "Activation failed. Your current licence and draft are preserved.",
        true,
      );
    }
  }
  async function readFile(file?: File) {
    if (!file) return;
    if (file.size > MAX_ARTIFACT_BYTES) {
      report("Licence artifacts must be no larger than 32 KiB.", true);
      return;
    }
    try {
      const text = await file.text();
      setDraft({ organizationId, artifact: text.trim() });
      setFeedback(null);
    } catch {
      report(
        "The file could not be read. Try again or paste the artifact.",
        true,
      );
    }
  }
  if (!canView || revoked)
    return (
      <SectionCard title="Licence">
        <p role="alert" className={cn("text-subhead-regular text-fg-muted")}>
          You do not have permission to view licences.
        </p>
      </SectionCard>
    );
  return (
    <SectionCard title="Licence">
      <p className={cn("text-subhead-regular text-fg-muted")}>
        Signed licences are verified locally. Licence policy never replaces your
        permissions or regulatory approvals.
      </p>
      {current.isPending ? (
        <p
          role="status"
          className={cn("mt-4 text-subhead-regular text-fg-muted")}
        >
          Loading licence…
        </p>
      ) : null}
      {current.error ? (
        <div
          role="alert"
          className={cn("mt-4 text-subhead-regular text-danger")}
        >
          <p>
            Licence status is unavailable
            {data ? "; previously loaded information may be stale" : ""}. Your
            draft is preserved.
          </p>
          <Button
            type="button"
            variant="outline"
            tone="grey"
            onClick={() => void current.refetch()}
          >
            Retry licence status
          </Button>
        </div>
      ) : null}
      {data ? (
        <div className={cn("mt-5 flex min-w-0 flex-col gap-5")}>
          <div>
            <h3 className={cn("text-subhead-semibold text-fg")}>
              {LICENCE_STATE_LABELS[data.policy.state]}
            </h3>
            <p className={cn("mt-1 text-caption-1-regular text-fg-muted")}>
              {data.policy.customerWritesAllowed
                ? "Entitled customer writes are available."
                : "Customer writes are restricted. Authenticated manual evidence export remains available."}
            </p>
            {[...data.policy.reasons, ...data.policy.warnings].map((reason) => (
              <p
                key={reason}
                className={cn("mt-1 text-caption-1-regular text-fg-muted")}
              >
                {licenceReason(reason)}
              </p>
            ))}
          </div>
          <dl
            className={cn(
              "grid min-w-0 gap-3 sm:grid-cols-2 text-caption-1-regular text-fg-muted",
            )}
          >
            <div>
              <dt>Instance binding</dt>
              <dd className={cn("break-all text-fg")}>{data.instanceId}</dd>
            </div>
            <div>
              <dt>Organization binding</dt>
              <dd className={cn("break-all text-fg")}>
                {data.claims?.organizationId ?? organizationId}
              </dd>
            </div>
            <div>
              <dt>Expires</dt>
              <dd className={cn("text-fg")}>
                {licenceDate(data.policy.expiresAt)}
              </dd>
            </div>
            <div>
              <dt>Grace ends</dt>
              <dd className={cn("text-fg")}>
                {licenceDate(data.policy.graceEndsAt)}
              </dd>
            </div>
          </dl>
          {data.lastRejected ? (
            <p
              role="status"
              className={cn(
                "rounded-lg border border-border p-3 text-caption-1-regular text-fg-muted",
              )}
            >
              Last rejected replacement:{" "}
              {licenceReason(data.lastRejected.reason)} ·{" "}
              {licenceDate(data.lastRejected.occurredAt)}. The current licence
              was preserved.
            </p>
          ) : null}
          <div className={cn("overflow-x-auto")}>
            <table
              aria-label="Licence capacity"
              className={cn("w-full text-left text-caption-1-regular text-fg")}
            >
              <thead>
                <tr>
                  <th className={cn("p-2")}>Resource</th>
                  <th className={cn("p-2")}>Used / reserved</th>
                  <th className={cn("p-2")}>Limit</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    [
                      "Active members and reserved invitations",
                      data.usage.activeMembers,
                      data.claims?.limits.activeMembers,
                    ],
                    [
                      "Nonarchived products",
                      data.usage.products,
                      data.claims?.limits.products,
                    ],
                    [
                      "Customer storage bytes",
                      data.usage.storageBytes + data.usage.storageReservedBytes,
                      data.claims?.limits.storageBytes,
                    ],
                  ] as const
                ).map(([label, used, limit]) => (
                  <tr key={label} className={cn("border-t border-border")}>
                    <th scope="row" className={cn("p-2 font-normal")}>
                      {label}
                    </th>
                    <td className={cn("p-2")}>
                      {data.usage.availability === "ready"
                        ? used.toLocaleString()
                        : "Unavailable"}
                    </td>
                    <td className={cn("p-2")}>
                      {limit === null
                        ? "Unlimited"
                        : limit === undefined
                          ? "No licence"
                          : limit.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={cn("text-caption-1-regular text-fg-muted")}>
            Protected storage:{" "}
            {data.usage.availability === "ready"
              ? `${data.usage.protectedStorageBytes.toLocaleString()} bytes`
              : "Unavailable"}
            . Generated protective evidence and exports are exempt from the
            customer storage limit.
          </p>
          <div>
            <h3 className={cn("text-subhead-semibold text-fg")}>
              Effective capabilities
            </h3>
            <p className={cn("mt-1 text-caption-1-regular text-fg-muted")}>
              {data.policy.effectiveCapabilities
                .map(licenceReason)
                .join(", ") || "No licensed capabilities enabled."}
            </p>
            {data.policy.disabledCapabilities.length ? (
              <p className={cn("mt-1 text-caption-1-regular text-fg-muted")}>
                Disabled by configuration:{" "}
                {data.policy.disabledCapabilities.map(licenceReason).join(", ")}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className={cn("mt-6 border-t border-border pt-5")}>
        <h3 className={cn("text-subhead-semibold text-fg")}>
          Activate or replace a licence
        </h3>
        <label
          htmlFor={artifactId}
          className={cn("mt-3 block text-caption-1-regular text-fg")}
        >
          Signed licence artifact
        </label>
        <textarea
          id={artifactId}
          rows={5}
          value={artifact}
          disabled={!canManage || activation.isPending}
          aria-describedby={feedbackId}
          className={cn(FIELD_CLASS, "mt-1 resize-y break-all")}
          onChange={(event) =>
            setDraft({ organizationId, artifact: event.target.value })
          }
        />
        <label className={cn("mt-3 block text-caption-1-regular text-fg")}>
          Upload licence file
          <input
            type="file"
            accept=".jws,.txt,.licence"
            disabled={!canManage || activation.isPending}
            className={cn(FIELD_CLASS, "mt-1")}
            onChange={(event) => {
              void readFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </label>
        <p
          id={feedbackId}
          role={message?.error ? "alert" : "status"}
          className={cn(
            "mt-3 text-caption-1-regular",
            message?.error ? "text-danger" : "text-fg-muted",
          )}
        >
          {message?.message ??
            "Maximum 32 KiB. Invalid replacements preserve the current valid licence."}
        </p>
        <Button
          type="button"
          className={cn("mt-3")}
          disabled={
            !canManage ||
            !data ||
            current.isError ||
            !artifact.trim() ||
            activation.isPending
          }
          onClick={() => void activate()}
        >
          {activation.isPending ? "Activating…" : "Activate licence"}
        </Button>
        {!canManage ? (
          <p className={cn("mt-2 text-caption-1-regular text-fg-muted")}>
            You can view the licence but cannot replace it.
          </p>
        ) : null}
      </div>
      <div className={cn("mt-6 border-t border-border pt-5")}>
        <h3 className={cn("text-subhead-semibold text-fg")}>
          Recent activation history
        </h3>
        {history.isPending ? (
          <p
            role="status"
            className={cn("mt-2 text-caption-1-regular text-fg-muted")}
          >
            Loading activation history…
          </p>
        ) : history.isError ? (
          <div
            role="alert"
            className={cn("mt-2 text-caption-1-regular text-danger")}
          >
            <p>Activation history is unavailable.</p>
            <Button
              type="button"
              variant="outline"
              tone="grey"
              onClick={() => void history.refetch()}
            >
              Retry history
            </Button>
          </div>
        ) : history.data?.items.length ? (
          <ul
            className={cn(
              "mt-2 space-y-2 text-caption-1-regular text-fg-muted",
            )}
          >
            {history.data.items.map((item) => (
              <li key={item.id}>
                {licenceDate(item.occurredAt)} · {item.action}
                {item.reason ? ` · ${licenceReason(item.reason)}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className={cn("mt-2 text-caption-1-regular text-fg-muted")}>
            No activation history is available.
          </p>
        )}
      </div>
    </SectionCard>
  );
}
