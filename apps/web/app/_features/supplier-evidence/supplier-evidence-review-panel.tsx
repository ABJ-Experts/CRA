"use client";

import {
  reRequestSupplierEvidenceRequestInputSchema,
  reviewSupplierEvidenceSubmissionInputSchema,
  type SupplierEvidenceInternalSubmission,
  type SupplierEvidenceReviewRequestDetail,
  type SupplierEvidenceRequestSummary,
} from "@repo/contracts/supplier-evidence";
import { Button } from "@repo/ui/button";
import { Tag, type TagProps } from "@repo/ui/tag";
import { Eye, RefreshCw } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import { evidenceApi } from "../evidence/evidence.api";
import {
  useReRequestSupplierEvidenceRequestMutation,
  useReviewSupplierEvidenceSubmissionMutation,
  useSupplierEvidenceReviewRequestQuery,
} from "./supplier-evidence.queries";

type Decision = "accept" | "reject";
type Delivery = Readonly<{
  url: string;
  mediaType: string;
  fileName: string;
  previewSupported: boolean;
}>;

const PREVIEW_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const SupplierDocumentExtractionPanel = dynamic(
  () =>
    import("./supplier-document-extraction-panel").then(
      (module) => module.SupplierDocumentExtractionPanel,
    ),
  {
    loading: () => (
      <p role="status" className="mt-4 text-caption-1-regular text-fg-muted">
        Loading document fields…
      </p>
    ),
  },
);

function label(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function tone(state: string): TagProps["tone"] {
  if (state === "accepted") return "green";
  if (state === "rejected" || state === "failed") return "red";
  if (state === "re_requested" || state === "awaiting_review") return "orange";
  return "blue";
}

function reviewMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 403)
    return "You no longer have permission to review supplier evidence.";
  if (error instanceof ApiClientError && error.status === 404)
    return "This evidence request or submission is no longer available.";
  if (error instanceof ApiClientError && error.status === 409)
    return "This evidence changed elsewhere. Reload the request before recording a decision.";
  if (error instanceof ApiClientError && error.kind === "network")
    return "You are offline. Your review text is still available to retry.";
  return error instanceof ApiClientError
    ? error.message
    : "The supplier evidence review could not be completed.";
}

function SubmissionReview({
  requestId,
  requestVersion,
  productId,
  submission,
  disabled,
}: Readonly<{
  requestId: string;
  requestVersion: number;
  productId: string;
  submission: SupplierEvidenceInternalSubmission;
  disabled: boolean;
}>) {
  const review = useReviewSupplierEvidenceSubmissionMutation(requestId);
  const [decision, setDecision] = useState<Decision>("accept");
  const [supplierVisibleReason, setSupplierVisibleReason] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  const reviewable =
    submission.state === "submitted_pending_review" &&
    submission.evidenceProcessingState === "clean";

  function changeDecision(value: Decision) {
    setDecision(value);
    setConfirmed(false);
    idempotencyKey.current = null;
  }

  async function preview() {
    setMessage(null);
    try {
      const response = await evidenceApi.access(
        productId,
        submission.evidenceDocumentId,
        submission.evidenceVersionId,
        { disposition: "inline", purpose: "supplier evidence review" },
      );
      setDelivery({
        url: response.access.deliveryUrl,
        mediaType: response.access.mediaType,
        fileName: response.access.fileName,
        previewSupported: response.access.previewSupported,
      });
    } catch (error) {
      setMessage(reviewMessage(error));
    }
  }

  async function submit() {
    if (decision === "reject" && supplierVisibleReason.trim() === "") {
      setMessage(
        "Enter a supplier-visible reason before rejecting this evidence.",
      );
      return;
    }
    if (!confirmed) {
      setConfirmed(true);
      setMessage(
        `Confirm ${decision === "accept" ? "acceptance" : "rejection"} for this exact immutable version.`,
      );
      return;
    }
    setMessage(null);
    try {
      await review.mutateAsync({
        submissionId: submission.id,
        input: reviewSupplierEvidenceSubmissionInputSchema.parse({
          expectedRequestVersion: requestVersion,
          expectedSubmissionUpdatedAt: submission.updatedAt,
          expectedEvidenceVersionId: submission.evidenceVersionId,
          expectedSha256: submission.sha256,
          decision,
          supplierVisibleReason:
            decision === "reject" ? supplierVisibleReason.trim() : undefined,
          internalNote: internalNote.trim() || undefined,
          idempotencyKey: (idempotencyKey.current ??= crypto.randomUUID()),
        }),
      });
      setConfirmed(false);
      setMessage(
        decision === "accept"
          ? "Evidence accepted. It remains a version-pinned, attributable record and is only eligible for separately authorized reuse."
          : "Evidence rejected. The supplier can see the rejection reason; the internal note remains internal.",
      );
    } catch (error) {
      setConfirmed(false);
      setMessage(reviewMessage(error));
    }
  }

  return (
    <li className="min-w-0 rounded-xl border border-border bg-canvas p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-subhead-semibold text-fg">
            {submission.fileName}
          </p>
          <p className="mt-1 break-all text-caption-1-regular text-fg-muted">
            SHA-256 {submission.sha256}
          </p>
        </div>
        <Tag variant="dot" size="sm" tone={tone(submission.state)}>
          {label(submission.state)}
        </Tag>
      </div>
      <dl className="mt-3 grid gap-2 text-caption-1-regular sm:grid-cols-2">
        <div>
          <dt className="text-fg-muted">Submitted</dt>
          <dd className="mt-1 text-fg">{formatDate(submission.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Scan state</dt>
          <dd className="mt-1 text-fg">
            {label(submission.evidenceProcessingState)}
          </dd>
        </div>
        <div>
          <dt className="text-fg-muted">Evidence version</dt>
          <dd className="mt-1 break-all text-fg">
            {submission.evidenceVersionId}
          </dd>
        </div>
        <div>
          <dt className="text-fg-muted">Evidence document</dt>
          <dd className="mt-1 break-all text-fg">
            {submission.evidenceDocumentId}
          </dd>
        </div>
      </dl>
      {submission.evidenceProcessingState === "clean" ? (
        <div className="mt-4">
          <Button
            type="button"
            variant="outline"
            tone="grey"
            onClick={() => void preview()}
          >
            <Eye aria-hidden="true" /> Preview verified content
          </Button>
          {delivery ? (
            <div className="mt-3 min-h-64 rounded-xl border border-border bg-surface p-3">
              {!delivery.previewSupported ||
              !PREVIEW_TYPES.has(delivery.mediaType) ? (
                <p className="text-caption-1-regular text-fg-muted">
                  Inline preview is unavailable for this verified file. Its
                  version and hash remain available above.
                </p>
              ) : delivery.mediaType === "application/pdf" ? (
                <iframe
                  title={`Preview of ${delivery.fileName}`}
                  src={delivery.url}
                  sandbox="allow-same-origin"
                  referrerPolicy="no-referrer"
                  className="h-[32rem] w-full rounded-lg border border-border bg-canvas"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- verified application-mediated delivery must bypass Next's image cache.
                <img
                  src={delivery.url}
                  alt={`Preview of ${delivery.fileName}`}
                  referrerPolicy="no-referrer"
                  className="max-h-[32rem] w-full object-contain"
                />
              )}
            </div>
          ) : null}
        </div>
      ) : (
        <p role="status" className="mt-3 text-caption-1-regular text-fg-muted">
          This version cannot be reviewed or previewed until the protected scan
          is clean.
        </p>
      )}
      {submission.reviews.length > 0 ? (
        <ol className="mt-4 grid gap-2" aria-label="Recorded review history">
          {submission.reviews.map((record) => (
            <li
              key={record.id}
              className="rounded-lg bg-surface p-3 text-caption-1-regular text-fg"
            >
              <p>
                {label(record.decision)} by reviewer record{" "}
                {record.reviewedByUserId} on {formatDate(record.reviewedAt)}.
              </p>
              {record.supplierVisibleReason ? (
                <p className="mt-1 text-fg-muted">
                  Supplier-visible reason: {record.supplierVisibleReason}
                </p>
              ) : null}
              {record.internalNote ? (
                <p className="mt-1 text-fg-muted">
                  Internal note: {record.internalNote}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      {reviewable ? (
        <div className="mt-4 grid gap-3 border-t border-border pt-4">
          <label className="grid gap-1 text-caption-1-semibold text-fg">
            Decision
            <select
              aria-label={`Decision for supplier evidence ${submission.fileName}`}
              value={decision}
              disabled={disabled || review.isPending}
              onChange={(event) =>
                changeDecision(event.target.value as Decision)
              }
              className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <option value="accept">
                Accept for authorized reuse eligibility
              </option>
              <option value="reject">Reject and retain evidence</option>
            </select>
          </label>
          {decision === "reject" ? (
            <label className="grid gap-1 text-caption-1-semibold text-fg">
              Supplier-visible rejection reason
              <textarea
                required
                maxLength={500}
                value={supplierVisibleReason}
                disabled={disabled || review.isPending}
                onChange={(event) => {
                  setSupplierVisibleReason(event.target.value);
                  setConfirmed(false);
                  idempotencyKey.current = null;
                }}
                className="min-h-24 rounded-xl border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              />
            </label>
          ) : null}
          <label className="grid gap-1 text-caption-1-semibold text-fg">
            Internal review note{" "}
            <span className="text-fg-muted">(not shared with supplier)</span>
            <textarea
              maxLength={2000}
              value={internalNote}
              disabled={disabled || review.isPending}
              onChange={(event) => {
                setInternalNote(event.target.value);
                setConfirmed(false);
                idempotencyKey.current = null;
              }}
              className="min-h-24 rounded-xl border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            />
          </label>
          {message ? (
            <p role="status" className="text-caption-1-regular text-fg-muted">
              {message}
            </p>
          ) : null}
          <div>
            <Button
              type="button"
              disabled={
                disabled ||
                review.isPending ||
                (decision === "reject" && supplierVisibleReason.trim() === "")
              }
              onClick={() => void submit()}
            >
              {review.isPending
                ? "Recording decision…"
                : confirmed
                  ? `Confirm ${decision}`
                  : `Review ${decision}`}
            </Button>
          </div>
        </div>
      ) : null}
      {submission.state === "accepted" &&
      submission.evidenceProcessingState === "clean" ? (
        <SupplierDocumentExtractionPanel
          requestId={requestId}
          requestVersion={requestVersion}
          productId={productId}
          submission={submission}
        />
      ) : null}
    </li>
  );
}

function ReRequestForm({
  request,
  disabled,
}: Readonly<{
  request: SupplierEvidenceReviewRequestDetail;
  disabled: boolean;
}>) {
  const reRequest = useReRequestSupplierEvidenceRequestMutation(request.id);
  const [open, setOpen] = useState(false);
  const [dueAt, setDueAt] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  const followUpItems = useMemo(
    () =>
      request.reviewItems.filter(
        (item) => item.state === "rejected" || item.state === "missing",
      ),
    [request.reviewItems],
  );

  useEffect(() => {
    setConfirmed(false);
    idempotencyKey.current = null;
  }, [dueAt]);

  async function submit() {
    if (dueAt === "") {
      setMessage("Choose a new supplier due date for the follow-up cycle.");
      return;
    }
    const parsedDueAt = new Date(dueAt);
    if (!Number.isFinite(parsedDueAt.getTime())) {
      setMessage("Choose a valid follow-up due date.");
      return;
    }
    if (!confirmed) {
      setConfirmed(true);
      setMessage(
        "Confirm the follow-up checklist and due date. Prior submissions and decisions stay unchanged.",
      );
      return;
    }
    try {
      await reRequest.mutateAsync(
        reRequestSupplierEvidenceRequestInputSchema.parse({
          expectedVersion: request.version,
          dueAt: parsedDueAt.toISOString(),
          items: followUpItems.map((item) => ({
            sourceRequestItemId: item.id,
            title: item.title,
            instructions: item.instructions ?? undefined,
            documentClass: item.documentClass,
            kind: item.kind,
            supplierSbomRequestId: item.supplierSbomRequestId,
          })),
          idempotencyKey: (idempotencyKey.current ??= crypto.randomUUID()),
        }),
      );
      setOpen(false);
      setConfirmed(false);
      setMessage(
        "A new follow-up cycle was created. Previously accepted evidence remains version-pinned.",
      );
    } catch (error) {
      setConfirmed(false);
      setMessage(reviewMessage(error));
    }
  }

  if (followUpItems.length === 0) return null;

  return (
    <section
      className="mt-5 border-t border-border pt-4"
      aria-labelledby={`rerequest-${request.id}`}
    >
      <h3
        id={`rerequest-${request.id}`}
        className="text-subhead-semibold text-fg"
      >
        Re-request missing or rejected evidence
      </h3>
      <p className="mt-1 text-caption-1-regular text-fg-muted">
        The new cycle contains only missing or rejected items. It does not
        replace accepted evidence, prior submissions, or review history.
      </p>
      {!open ? (
        <Button
          type="button"
          variant="outline"
          tone="grey"
          className="mt-3"
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          Start re-request cycle
        </Button>
      ) : (
        <div className="mt-3 grid gap-3">
          <ul className="grid gap-2" aria-label="Follow-up evidence items">
            {followUpItems.map((item) => (
              <li
                key={item.id}
                className="rounded-lg bg-surface p-3 text-caption-1-regular text-fg"
              >
                {item.title} · {label(item.state)}
              </li>
            ))}
          </ul>
          <label className="grid gap-1 text-caption-1-semibold text-fg">
            New due date
            <input
              type="datetime-local"
              required
              value={dueAt}
              disabled={disabled || reRequest.isPending}
              onChange={(event) => setDueAt(event.target.value)}
              className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            />
          </label>
          {message ? (
            <p role="status" className="text-caption-1-regular text-fg-muted">
              {message}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={disabled || reRequest.isPending}
              onClick={() => void submit()}
            >
              {reRequest.isPending
                ? "Creating cycle…"
                : confirmed
                  ? "Confirm re-request"
                  : "Review follow-up"}
            </Button>
            <Button
              type="button"
              variant="outline"
              tone="grey"
              disabled={reRequest.isPending}
              onClick={() => {
                setOpen(false);
                setConfirmed(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Lazy internal control room for attributable supplier-evidence decisions. */
export function SupplierEvidenceReviewPanel({
  requests,
  canReview,
  enabled,
}: Readonly<{
  requests: readonly SupplierEvidenceRequestSummary[];
  canReview: boolean;
  enabled: boolean;
}>) {
  const [requestId, setRequestId] = useState(requests[0]?.id ?? "");
  const detail = useSupplierEvidenceReviewRequestQuery(
    requestId || null,
    enabled && canReview,
  );

  useEffect(() => {
    if (requests.some((request) => request.id === requestId)) return;
    setRequestId(requests[0]?.id ?? "");
  }, [requestId, requests]);

  if (!canReview) return null;
  if (requests.length === 0)
    return (
      <p className="text-caption-1-regular text-fg-muted">
        No supplier evidence requests are available for review.
      </p>
    );
  const request = detail.data?.request;
  return (
    <section
      className="mt-6 min-w-0 rounded-xl border border-border bg-surface p-4 sm:p-6"
      aria-labelledby="supplier-evidence-review-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="supplier-evidence-review-heading"
            className="text-title-semibold text-fg"
          >
            Supplier evidence review
          </h2>
          <p className="mt-1 text-subhead-regular text-fg-muted">
            Review only the exact clean version shown. Acceptance permits later
            authorized reuse; it does not claim conformity or link a technical
            file.
          </p>
        </div>
        {request ? (
          <Tag variant="dot" tone={tone(request.aggregateReviewState)}>
            {label(request.aggregateReviewState)}
          </Tag>
        ) : null}
      </div>
      <label className="mt-4 grid min-w-0 gap-1 text-caption-1-semibold text-fg">
        Evidence request
        <select
          value={requestId}
          disabled={detail.isLoading}
          onChange={(event) => setRequestId(event.target.value)}
          className="h-10 w-full min-w-0 overflow-hidden text-ellipsis rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          {requests.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.currentRevision.title} ·{" "}
              {label(candidate.aggregateReviewState)}
            </option>
          ))}
        </select>
      </label>
      {detail.isLoading ? (
        <p role="status" className="mt-4 text-caption-1-regular text-fg-muted">
          Loading review checklist…
        </p>
      ) : null}
      {detail.isError ? (
        <div className="mt-4 grid gap-2">
          <p role="alert" className="text-caption-1-regular text-danger">
            The review checklist could not be loaded.
          </p>
          <Button
            type="button"
            variant="outline"
            tone="grey"
            onClick={() => void detail.refetch()}
          >
            <RefreshCw aria-hidden="true" /> Reload checklist
          </Button>
        </div>
      ) : null}
      {request ? (
        <div className="mt-5 grid min-w-0 gap-5">
          {request.reviewItems.map((item) => (
            <section
              key={item.id}
              className="min-w-0 rounded-xl border border-border bg-canvas p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-subhead-semibold text-fg">
                    {item.position + 1}. {item.title}
                  </h3>
                  {item.instructions ? (
                    <p className="mt-1 whitespace-pre-wrap text-caption-1-regular text-fg-muted">
                      {item.instructions}
                    </p>
                  ) : null}
                </div>
                <Tag variant="dot" size="sm" tone={tone(item.state)}>
                  {label(item.state)}
                </Tag>
              </div>
              {item.kind === "sbom" ? (
                <p
                  role="status"
                  className="mt-3 text-caption-1-regular text-fg"
                >
                  SBOM processing and acceptance are handled in Product SBOM
                  review. This evidence review cannot accept an SBOM as a
                  product baseline.
                </p>
              ) : item.submissions.length === 0 ? (
                <p className="mt-3 text-caption-1-regular text-fg-muted">
                  No supplier submission is available for this item.
                </p>
              ) : (
                <ul
                  className="mt-3 grid min-w-0 gap-3"
                  aria-label={`Submissions for ${item.title}`}
                >
                  {item.submissions.map((submission) => (
                    <SubmissionReview
                      key={submission.id}
                      requestId={request.id}
                      requestVersion={request.version}
                      productId={request.productId}
                      submission={submission}
                      disabled={request.state !== "open" || !canReview}
                    />
                  ))}
                </ul>
              )}
            </section>
          ))}
          {(() => {
            const currentIds = new Set(
              request.reviewItems.flatMap((item) =>
                item.submissions.map((submission) => submission.id),
              ),
            );
            const priorAccepted = request.submissions.filter(
              (submission) =>
                submission.state === "accepted" &&
                submission.evidenceProcessingState === "clean" &&
                !currentIds.has(submission.id),
            );
            if (priorAccepted.length === 0) return null;
            return (
              <section className="min-w-0 rounded-xl border border-border bg-canvas p-4">
                <h3 className="text-subhead-semibold text-fg">
                  Accepted evidence from earlier cycles
                </h3>
                <p className="mt-1 text-caption-1-regular text-fg-muted">
                  Earlier accepted submissions remain available for
                  version-pinned field review.
                </p>
                <ul
                  className="mt-3 grid min-w-0 gap-3"
                  aria-label="Earlier accepted submissions"
                >
                  {priorAccepted.map((submission) => (
                    <SubmissionReview
                      key={submission.id}
                      requestId={request.id}
                      requestVersion={request.version}
                      productId={request.productId}
                      submission={submission}
                      disabled={request.state !== "open" || !canReview}
                    />
                  ))}
                </ul>
              </section>
            );
          })()}
          <ReRequestForm
            request={request}
            disabled={request.state !== "open" || !canReview}
          />
        </div>
      ) : null}
    </section>
  );
}
