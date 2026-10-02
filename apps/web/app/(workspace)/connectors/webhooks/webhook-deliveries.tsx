"use client";
import { useRef, useState } from "react";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import type {
  WebhookDeliveryDetail,
  WebhookEndpoint,
  WebhookReplayPreview,
} from "@repo/contracts/connectors/types";
import { webhooksApi } from "../../../_features/connectors/webhooks.api";
import { webhookInputClass } from "./webhook-form";

export function WebhookDeliveryPanel({
  detail,
  endpoint,
  canEdit,
  pending,
  run,
  onReplayed,
}: {
  detail: WebhookDeliveryDetail;
  endpoint: WebhookEndpoint;
  canEdit: boolean;
  pending: boolean;
  run: <T>(action: () => Promise<T>) => Promise<T>;
  onReplayed: (id: string) => void;
}) {
  const [preview, setPreview] = useState<WebhookReplayPreview | null>(null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const replayIdentity = useRef<{ intent: string; key: string } | null>(null);
  const delivery = detail.delivery;
  const replayable = ["failed", "canceled"].includes(delivery.status);
  const current =
    preview?.endpointVersion === endpoint.version &&
    preview.deliveryVersion === delivery.version;
  async function inspect() {
    setMessage(null);
    setPreview(null);
    setConfirmed(false);
    try {
      const result = await run(() =>
        webhooksApi.previewReplay(endpoint.id, delivery.id, {
          expectedDeliveryVersion: delivery.version,
          expectedEndpointVersion: endpoint.version,
        }),
      );
      setPreview(result.preview);
    } catch {
      setMessage(
        "Replay preview is unavailable. Reload and check current permission, subscription and source availability.",
      );
    }
  }
  async function replay() {
    if (
      !preview ||
      !current ||
      !reason.trim() ||
      (preview.receiverChanged && !confirmed)
    )
      return;
    setMessage(null);
    const intent = JSON.stringify([
      delivery.version,
      endpoint.version,
      preview.previewDigest,
      reason.trim(),
      confirmed,
    ]);
    if (replayIdentity.current?.intent !== intent)
      replayIdentity.current = { intent, key: crypto.randomUUID() };
    const idempotencyKey = replayIdentity.current.key;
    try {
      const result = await run(() =>
        webhooksApi.replay(endpoint.id, delivery.id, {
          expectedDeliveryVersion: delivery.version,
          expectedEndpointVersion: endpoint.version,
          previewDigest: preview.previewDigest,
          reason,
          confirmDestinationChange: confirmed,
          idempotencyKey,
        }),
      );
      setPreview(null);
      replayIdentity.current = null;
      onReplayed(result.delivery.id);
    } catch {
      setMessage(
        "Replay outcome is unavailable. Retry this reviewed request; if configuration changed, generate a fresh preview.",
      );
    }
  }
  return (
    <section
      aria-labelledby="webhook-delivery-heading"
      className={cn("space-y-4")}
    >
      <h3
        id="webhook-delivery-heading"
        className={cn("text-headline-semibold text-fg")}
      >
        Delivery details
      </h3>
      <dl
        className={cn(
          "grid gap-2 text-caption-1-regular text-fg sm:grid-cols-2",
        )}
      >
        <div>
          <dt>Event identity</dt>
          <dd className={cn("break-all")}>{delivery.eventId}</dd>
        </div>
        <div>
          <dt>Delivery identity</dt>
          <dd className={cn("break-all")}>{delivery.deliveryId}</dd>
        </div>
        <div>
          <dt>Recorded versions</dt>
          <dd>
            Endpoint {delivery.endpointVersion} · Scope {delivery.scopeRevision}{" "}
            · Destination {delivery.destinationRevision}
          </dd>
        </div>
        <div>
          <dt>Deadline</dt>
          <dd>{new Date(delivery.deadlineAt).toLocaleString()}</dd>
        </div>
      </dl>
      <p className={cn("text-caption-1-regular text-fg-muted")}>
        Status: {delivery.status}. Attempts may reach a receiver more than once.
        Receiver deduplication is required; no originating domain action is
        repeated.
      </p>
      <div
        role="region"
        aria-label="Webhook attempts, scroll horizontally"
        tabIndex={0}
        className={cn(
          "overflow-x-auto focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <table
          className={cn(
            "w-full min-w-[48rem] text-left text-caption-1-regular text-fg",
          )}
        >
          <caption className={cn("sr-only")}>Delivery attempts</caption>
          <thead>
            <tr>
              {[
                "Attempt",
                "Started",
                "Outcome",
                "HTTP",
                "Duration",
                "Safe category",
              ].map((heading) => (
                <th
                  key={heading}
                  scope="col"
                  className={cn(
                    "whitespace-nowrap border-b border-border px-2 py-3",
                  )}
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {detail.attempts.rows.map((attempt) => (
              <tr key={attempt.id}>
                <td className={cn("px-2 py-3 tabular-nums")}>
                  {attempt.attemptNumber} · lease {attempt.leaseGeneration}
                </td>
                <td className={cn("px-2 py-3")}>
                  {new Date(attempt.startedAt).toLocaleString()}
                </td>
                <td className={cn("px-2 py-3")}>{attempt.outcome}</td>
                <td className={cn("px-2 py-3 tabular-nums")}>
                  {attempt.httpStatus ?? "Unknown"}
                </td>
                <td className={cn("px-2 py-3 tabular-nums")}>
                  {attempt.durationMs === null
                    ? "Unknown"
                    : `${attempt.durationMs} ms`}
                </td>
                <td className={cn("px-2 py-3")}>
                  {attempt.failureCategory ?? "None"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {detail.attempts.rows.length === 0 && (
        <p className={cn("text-subhead-regular text-fg-muted")}>
          No attempts recorded yet.
        </p>
      )}
      {canEdit && replayable && (
        <Button
          type="button"
          variant="outline"
          loading={pending}
          onClick={() => void inspect()}
        >
          Preview reviewed replay
        </Button>
      )}
      {preview && (
        <div className={cn("space-y-3 rounded-xl border border-border p-4")}>
          <h4 className={cn("text-subhead-semibold text-fg")}>
            Review receiver and resource
          </h4>
          <p className={cn("break-words text-subhead-regular text-fg")}>
            Previous receiver: {preview.previousDestination ?? "Unknown"}.
            Current receiver: {preview.currentDestination}. Resource:{" "}
            {preview.resource.type} {preview.resource.id}.
          </p>
          <p className={cn("text-caption-1-regular text-fg-muted")}>
            Replay creates a new delivery with the same event identity. Payload
            includes currently authorized minimal context only.
          </p>
          {!current && (
            <p role="alert" className={cn("text-subhead-regular text-danger")}>
              Configuration or delivery changed. Generate a fresh preview.
            </p>
          )}
          {preview.receiverChanged && (
            <label
              className={cn(
                "flex items-start gap-2 text-subhead-regular text-fg",
              )}
            >
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              I confirm sending this event to the changed receiver{" "}
              {preview.currentDestination}.
            </label>
          )}
          <label className={cn("grid gap-2 text-subhead-regular text-fg")}>
            Replay reason
            <textarea
              maxLength={500}
              className={cn(webhookInputClass)}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <Button
            type="button"
            loading={pending}
            disabled={
              !current ||
              !reason.trim() ||
              (preview.receiverChanged && !confirmed)
            }
            onClick={() => void replay()}
          >
            Replay reviewed event
          </Button>
        </div>
      )}
      {message && (
        <p role="alert" className={cn("text-subhead-regular text-danger")}>
          {message}
        </p>
      )}
    </section>
  );
}
