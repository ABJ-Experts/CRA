"use client";
import { useRef, useState } from "react";
import type {
  SiemDelivery,
  SiemDeliveryDetail,
  SiemReplayPreview,
} from "@repo/contracts/audit/types";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { cn } from "@repo/ui/cn";
import { auditSiemGateway } from "./siem.api";
export function SiemHistory({
  items,
  destinationId,
  version,
  canEdit,
  pending,
  run,
}: Readonly<{
  items: readonly SiemDelivery[];
  destinationId: string;
  version: number;
  canEdit: boolean;
  pending: boolean;
  run: <T>(command: () => Promise<T>) => Promise<T | undefined>;
}>) {
  const [detail, setDetail] = useState<SiemDeliveryDetail | null>(null),
    [preview, setPreview] = useState<SiemReplayPreview | null>(null),
    [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [message, setMessage] = useState("");
  const replayIdentity = useRef<{ criteria: string; requestId: string } | null>(
    null,
  );
  return (
    <section className={cn("space-y-4")}>
      <h2 className={cn("text-h4 text-fg")}>Delivery history</h2>
      <p className={cn("max-w-prose text-caption-1-regular text-fg-muted")}>
        HTTPS accepted means a collector returned 2xx. TLS syslog sent
        unacknowledged does not confirm collector receipt. Retries can duplicate
        the stable event ID.
      </p>
      {items.length === 0 ? (
        <p role="status">No deliveries for this destination.</p>
      ) : (
        <div className={cn("overflow-x-auto")}>
          <table className={cn("w-full text-left text-caption-1-regular")}>
            <caption className={cn("sr-only")}>
              Authorized forwarding history
            </caption>
            <thead>
              <tr>
                {[
                  "Event / sequence",
                  "Status",
                  "Attempts",
                  "Created",
                  "Actions",
                ].map((label) => (
                  <th key={label} scope="col" className={cn("p-3")}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className={cn("border-t border-border align-top")}
                >
                  <th scope="row" className={cn("p-3 font-medium")}>
                    {item.event.action}
                    <br />
                    Sequence {item.event.chainSequence}
                  </th>
                  <td className={cn("p-3")}>
                    {item.state.replaceAll("_", " ")}
                    {item.safeFailureCode ? (
                      <p>{item.safeFailureCode.replaceAll("_", " ")}</p>
                    ) : null}
                  </td>
                  <td className={cn("p-3 tabular-nums")}>
                    {item.attemptCount}
                  </td>
                  <td className={cn("p-3")}>
                    {new Date(item.createdAt).toLocaleString()}
                  </td>
                  <td className={cn("flex flex-wrap gap-2 p-3")}>
                    <Button
                      variant="outline"
                      disabled={pending}
                      onClick={() => {
                        void run(() =>
                          auditSiemGateway.detail(
                            destinationId,
                            item.id,
                            crypto.randomUUID(),
                          ),
                        ).then((value) => {
                          if (value) setDetail(value);
                        });
                      }}
                    >
                      Inspect delivery
                    </Button>
                    {canEdit &&
                    ["failed", "cancelled", "sent_unacknowledged"].includes(
                      item.state,
                    ) ? (
                      <Button
                        variant="outline"
                        disabled={pending}
                        onClick={() => {
                          setPreview(null);
                          setConfirmed(false);
                          setReason("");
                          void run(() =>
                            auditSiemGateway.preview(destinationId, item.id, {
                              requestId: crypto.randomUUID(),
                              expectedVersion: version,
                            }),
                          ).then((value) => {
                            if (value) setPreview(value);
                          });
                        }}
                      >
                        Review replay
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {detail ? (
        <section
          className={cn("space-y-3 rounded-lg border border-border p-4")}
          aria-label="Delivery details"
        >
          <h3 className={cn("text-subhead-semibold")}>Attempt details</h3>
          <p>Event ID {detail.eventId}</p>
          <p>Destination revision {detail.destinationRevision}</p>
          <ol>
            {detail.attempts.map((attempt) => (
              <li key={attempt.id}>
                Attempt {attempt.attempt}: {attempt.state.replaceAll("_", " ")}{" "}
                {attempt.safeFailureCode ?? ""}
                {attempt.httpStatus ? ` HTTP ${attempt.httpStatus}` : ""}
              </li>
            ))}
          </ol>
          <Button variant="outline" onClick={() => setDetail(null)}>
            Close details
          </Button>
        </section>
      ) : null}
      {preview ? (
        <section
          aria-label="Reviewed replay"
          className={cn("space-y-4 rounded-lg border border-border p-4")}
        >
          <h3 className={cn("text-subhead-semibold")}>
            Review the current recipient
          </h3>
          <p>{preview.endpoint}</p>
          <p>
            {preview.transport} / {preview.format}; preview expires{" "}
            {new Date(preview.expiresAt).toLocaleString()}
          </p>
          <p>
            {preview.event.action}, sequence {preview.event.chainSequence},
            event ID {preview.event.eventId}
          </p>
          <Input
            label="Replay reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <label
            className={cn("flex items-center gap-2 text-caption-1-regular")}
          >
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            I reviewed this recipient and event.
          </label>
          <Button
            disabled={
              pending ||
              !confirmed ||
              !reason.trim() ||
              Date.parse(preview.expiresAt) <= Date.now()
            }
            onClick={() => {
              const criteria = JSON.stringify({
                digest: preview.previewDigest,
                reason,
              });
              if (replayIdentity.current?.criteria !== criteria)
                replayIdentity.current = {
                  criteria,
                  requestId: crypto.randomUUID(),
                };
              const requestId = replayIdentity.current.requestId;
              void run(() =>
                auditSiemGateway.replay(destinationId, preview.deliveryId, {
                  requestId,
                  expectedVersion: preview.expectedVersion,
                  previewDigest: preview.previewDigest,
                  reason,
                  confirmRecipient: true,
                }),
              ).then((value) => {
                if (value) {
                  setPreview(null);
                  replayIdentity.current = null;
                  setMessage("Replay queued with the original event identity.");
                }
              });
            }}
          >
            Queue reviewed replay
          </Button>
          <Button variant="outline" onClick={() => setPreview(null)}>
            Cancel replay review
          </Button>
        </section>
      ) : null}
      <p role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
