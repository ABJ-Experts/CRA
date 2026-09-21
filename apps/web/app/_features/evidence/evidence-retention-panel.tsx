"use client";

import type { EvidenceRetentionReview } from "@repo/contracts/evidence";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import { CircleAlert, LockKeyhole, Scale, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import {
  useCreateEvidenceDeletionIntentMutation,
  useEvidenceLegalHoldsQuery,
  useEvidenceRetentionReviewQuery,
  usePlaceEvidenceLegalHoldMutation,
  useReleaseEvidenceLegalHoldMutation,
} from "./evidence.queries";

function requestId(): string {
  return crypto.randomUUID();
}

function date(value: string | null): string {
  return value === null
    ? "No final date is available"
    : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(
        new Date(value),
      );
}

function requestError(error: unknown, subject: string): string {
  if (error instanceof ApiClientError && error.status === 403)
    return `You no longer have permission to ${subject}.`;
  if (error instanceof ApiClientError && error.status === 409)
    return `This evidence changed elsewhere. Your entered details are still here; reload the review and try again.`;
  if (
    error instanceof ApiClientError &&
    (error.kind === "network" ||
      error.kind === "invalid_response" ||
      (error.status ?? 0) >= 500)
  )
    return `Evidence services are temporarily unavailable. Your entered details are still here; retry when the connection is restored.`;
  return error instanceof ApiClientError
    ? error.message
    : `The ${subject} request could not be completed.`;
}

function lifecycleLabel(lifecycle: EvidenceRetentionReview["lifecycle"]): string {
  return lifecycle.replaceAll("_", " ");
}

function blockerText(blocker: EvidenceRetentionReview["blockers"][number]): string {
  if (blocker.visibility === "restricted") return blocker.message;
  const product = blocker.productName ? ` for ${blocker.productName}` : "";
  const through = blocker.protectThrough
    ? ` until ${date(blocker.protectThrough)}`
    : "";
  return `${blocker.obligation}${product}${through}.`;
}

function ProtectionSummary({ review }: Readonly<{ review: EvidenceRetentionReview }>) {
  if (review.eligibleForDeletion) {
    return (
      <p className="flex items-center gap-2 text-caption-1-regular text-fg">
        <ShieldCheck aria-hidden="true" className="size-4 shrink-0" />
        This document is eligible for a reviewed deletion request. Deletion is
        never automatic.
      </p>
    );
  }

  if (review.lifecycle !== "active") {
    return (
      <p className="flex items-center gap-2 text-caption-1-regular text-fg">
        <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
        Deletion lifecycle: {lifecycleLabel(review.lifecycle)}.
      </p>
    );
  }

  return (
    <p className="flex items-center gap-2 text-caption-1-regular text-fg">
      <LockKeyhole aria-hidden="true" className="size-4 shrink-0" />
      This document is protected and cannot be deleted.
    </p>
  );
}

export function EvidenceRetentionPanel({
  productId,
  documentId,
  enabled,
  canManage,
}: Readonly<{
  productId: string;
  documentId: string;
  enabled: boolean;
  canManage: boolean;
}>) {
  const reviewQuery = useEvidenceRetentionReviewQuery(documentId, enabled);
  const holdsQuery = useEvidenceLegalHoldsQuery(documentId, enabled);
  const createDeletion = useCreateEvidenceDeletionIntentMutation(productId);
  const placeHold = usePlaceEvidenceLegalHoldMutation(productId);
  const releaseHold = useReleaseEvidenceLegalHoldMutation(productId);
  const [deletionReason, setDeletionReason] = useState("");
  const [deletionConfirmed, setDeletionConfirmed] = useState(false);
  const [holdReason, setHoldReason] = useState("");
  const [releaseHoldId, setReleaseHoldId] = useState<string | null>(null);
  const [releaseReason, setReleaseReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const canRequestDeletion =
    canManage &&
    reviewQuery.data?.review.eligibleForDeletion === true &&
    holdsQuery.data !== undefined &&
    !holdsQuery.isError;

  async function requestDeletion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const review = reviewQuery.data?.review;
    if (!review || !review.eligibleForDeletion) {
      setMessage("Refresh the current retention review before requesting deletion.");
      return;
    }
    if (!deletionConfirmed || deletionReason.trim().length === 0) {
      setMessage("Confirm this reviewed deletion and provide a reason.");
      return;
    }
    setMessage(null);
    try {
      await createDeletion.mutateAsync({
        documentId,
        input: {
          expectedCurrentVersionId: review.currentVersionId,
          reviewFingerprint: review.reviewFingerprint,
          confirmed: true,
          reason: deletionReason,
          idempotencyKey: requestId(),
        },
      });
      setDeletionConfirmed(false);
      setDeletionReason("");
      setMessage(
        "Deletion review was recorded. Private cleanup remains protected and will recheck this document before it runs.",
      );
    } catch (error) {
      setMessage(requestError(error, "request deletion"));
    }
  }

  async function submitHold(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (holdReason.trim().length === 0) {
      setMessage("Provide a reason before placing a legal hold.");
      return;
    }
    setMessage(null);
    try {
      await placeHold.mutateAsync({
        documentId,
        input: { reason: holdReason, idempotencyKey: requestId() },
      });
      setHoldReason("");
      setMessage("Legal hold placed. It protects every immutable document version.");
    } catch (error) {
      setMessage(requestError(error, "place a legal hold"));
    }
  }

  async function submitRelease(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!releaseHoldId || releaseReason.trim().length === 0) {
      setMessage("Provide a reason before releasing this legal hold.");
      return;
    }
    setMessage(null);
    try {
      await releaseHold.mutateAsync({
        documentId,
        holdId: releaseHoldId,
        input: { reason: releaseReason, idempotencyKey: requestId() },
      });
      setReleaseHoldId(null);
      setReleaseReason("");
      setMessage(
        "Legal hold released. Other holds and statutory retention remain in effect.",
      );
    } catch (error) {
      setMessage(requestError(error, "release this legal hold"));
    }
  }

  return (
    <section
      aria-labelledby="evidence-retention-title"
      className="grid gap-4 rounded-xl border border-border bg-surface p-4"
    >
      <div className="grid gap-1">
        <h3 id="evidence-retention-title" className="text-h5 text-fg">
          Retention and deletion review
        </h3>
        <p className="text-caption-1-regular text-fg-muted">
          Protection is inherited from linked products and retained references.
          A legal hold applies to all immutable versions of this document.
        </p>
      </div>

      {reviewQuery.isLoading ? (
        <p role="status" className="text-caption-1-regular text-fg-muted">
          Loading retention protection…
        </p>
      ) : reviewQuery.isError ? (
        <div className="grid gap-2">
          <p role="alert" className="text-caption-1-regular text-danger">
            Retention protection could not be loaded. No deletion action is available.
          </p>
          <div>
            <Button
              type="button"
              variant="outline"
              tone="grey"
              onClick={() => void reviewQuery.refetch()}
            >
              Retry review
            </Button>
          </div>
        </div>
      ) : reviewQuery.data ? (
        <div className="grid gap-3">
          <div
            className={cn(
              "rounded-lg border px-3 py-2",
              reviewQuery.data.review.eligibleForDeletion
                ? "border-border bg-canvas"
                : "border-border-strong bg-canvas",
            )}
          >
            <ProtectionSummary review={reviewQuery.data.review} />
          </div>
          <dl className="grid gap-2 text-caption-1-regular sm:grid-cols-2">
            <div>
              <dt className="text-fg-muted">Retention status</dt>
              <dd className="text-fg">
                {reviewQuery.data.review.protection.status.replaceAll("_", " ")}
              </dd>
            </div>
            <div>
              <dt className="text-fg-muted">Protection through</dt>
              <dd className="text-fg">
                {date(reviewQuery.data.review.protection.retentionProtectionUntil)}
              </dd>
            </div>
          </dl>
          {reviewQuery.data.review.protection.identityHandling ===
          "legal_review_required" ? (
            <p className="text-caption-1-regular text-fg-muted">
              Original evidence remains immutable. Review redacted derivative handling
              with legal counsel; pseudonymising a user record cannot erase embedded
              names or signatures.
            </p>
          ) : null}
          {reviewQuery.data.review.blockers.length > 0 ? (
            <ul className="grid gap-2" aria-label="Deletion blockers">
              {reviewQuery.data.review.blockers.map((blocker, index) => (
                <li
                  key={`${blocker.visibility}-${blocker.kind}-${index}`}
                  className="flex gap-2 text-caption-1-regular text-fg-muted"
                >
                  <LockKeyhole aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  {blockerText(blocker)}
                </li>
              ))}
            </ul>
          ) : null}
          {canRequestDeletion ? (
            <form className="grid gap-3" noValidate onSubmit={requestDeletion}>
              <label className="grid gap-1 text-caption-1-semibold text-fg">
                Deletion review reason
                <textarea
                  value={deletionReason}
                  onChange={(event) => setDeletionReason(event.target.value)}
                  maxLength={2_000}
                  rows={3}
                  required
                  className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
                />
              </label>
              <label className="flex items-start gap-2 text-caption-1-regular text-fg">
                <input
                  type="checkbox"
                  checked={deletionConfirmed}
                  onChange={(event) => setDeletionConfirmed(event.target.checked)}
                  className="mt-0.5 size-4 rounded border-border text-active-500 focus-visible:ring-2 focus-visible:ring-focus"
                />
                I reviewed the current protection and request deletion of every version
                of this document. Cleanup is not automatic and will recheck protection.
              </label>
              <div>
                <Button
                  type="submit"
                  variant="outline"
                  tone="primary"
                  loading={createDeletion.isPending}
                  loadingLabel="Requesting reviewed deletion"
                >
                  <Trash2 aria-hidden="true" />
                  Request reviewed deletion
                </Button>
              </div>
            </form>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-3 border-t border-border pt-4">
        <div className="flex items-center gap-2">
          <Scale aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
          <h4 className="text-subhead-semibold text-fg">Legal holds</h4>
        </div>
        {holdsQuery.isLoading ? (
          <p role="status" className="text-caption-1-regular text-fg-muted">
            Loading legal holds…
          </p>
        ) : holdsQuery.isError ? (
          <div className="grid gap-2">
            <p role="alert" className="text-caption-1-regular text-danger">
              Legal holds could not be loaded. Deletion remains unavailable until
              protection can be reviewed.
            </p>
            <div>
              <Button
                type="button"
                variant="outline"
                tone="grey"
                onClick={() => void holdsQuery.refetch()}
              >
                Retry legal holds
              </Button>
            </div>
          </div>
        ) : holdsQuery.data?.legalHolds.length === 0 ? (
          <p className="text-caption-1-regular text-fg-muted">
            No legal holds are recorded for this document.
          </p>
        ) : (
          <ul className="grid gap-2" aria-label="Document legal holds">
            {holdsQuery.data?.legalHolds.map((hold) => (
              <li
                key={hold.id}
                className="grid gap-2 rounded-lg border border-border bg-canvas p-3"
              >
                <p className="text-caption-1-regular text-fg">
                  <span className="font-semibold">{hold.status === "active" ? "Active" : "Released"}</span>{" "}
                  {hold.reason}
                </p>
                <p className="text-caption-1-regular text-fg-muted">
                  Placed {date(hold.placedAt)}
                  {hold.status === "released" && hold.releasedAt
                    ? ` · Released ${date(hold.releasedAt)}`
                    : ""}
                </p>
                {canManage && hold.status === "active" ? (
                  releaseHoldId === hold.id ? (
                    <form className="grid gap-2" noValidate onSubmit={submitRelease}>
                      <label className="grid gap-1 text-caption-1-semibold text-fg">
                        Release reason
                        <textarea
                          value={releaseReason}
                          onChange={(event) => setReleaseReason(event.target.value)}
                          maxLength={2_000}
                          rows={2}
                          required
                          className="rounded-lg border border-border bg-surface px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
                        />
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="submit"
                          variant="outline"
                          tone="primary"
                          loading={releaseHold.isPending}
                          loadingLabel="Releasing legal hold"
                        >
                          Release hold
                        </Button>
                        <Button
                          type="button"
                          variant="invisible"
                          tone="grey"
                          onClick={() => {
                            setReleaseHoldId(null);
                            setReleaseReason("");
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <div>
                      <Button
                        type="button"
                        variant="invisible"
                        tone="grey"
                        onClick={() => setReleaseHoldId(hold.id)}
                      >
                        Release hold
                      </Button>
                    </div>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canManage ? (
          <form className="grid gap-2" noValidate onSubmit={submitHold}>
            <label className="grid gap-1 text-caption-1-semibold text-fg">
              Legal hold reason
              <textarea
                value={holdReason}
                onChange={(event) => setHoldReason(event.target.value)}
                maxLength={2_000}
                rows={3}
                required
                className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
              />
            </label>
            <div>
              <Button
                type="submit"
                variant="outline"
                tone="primary"
                loading={placeHold.isPending}
                loadingLabel="Placing legal hold"
              >
                <LockKeyhole aria-hidden="true" />
                Place legal hold
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-caption-1-regular text-fg-muted">
            You can review protection but need evidence-management permission to place
            or release a legal hold.
          </p>
        )}
      </div>
      {message ? (
        <p role="status" className="text-caption-1-regular text-fg">
          {message}
        </p>
      ) : null}
    </section>
  );
}
