"use client";

import { type SupplierSbomSubmission } from "@repo/contracts/sboms";
import { Button } from "@repo/ui/button";
import { Select, SelectItem } from "@repo/ui/select";
import { Tag, type TagProps } from "@repo/ui/tag";
import { ClipboardCopy, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import {
  useCreateSupplierSbomInvitationMutation,
  useCreateSupplierSbomRequestMutation,
  useReviewSupplierSbomSubmissionMutation,
  useSupplierSbomRequestsQuery,
} from "../../_features/sboms/sboms.queries";

type ReleaseOption = Readonly<{ id: string; label: string; version: string }>;
type SubmissionDecision = "accept" | "reject";

function titleCase(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatInstant(value: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function defaultExpiry(): string {
  const value = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000);
  return value.toISOString().slice(0, 16);
}

function statusTone(state: string): TagProps["tone"] {
  if (state === "accepted") return "green";
  if (state === "rejected" || state === "validation_failed") return "red";
  if (state === "awaiting_review" || state === "superseded") return "orange";
  return "blue";
}

function supplierErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 403) {
    return "You no longer have permission to review supplier evidence.";
  }
  if (error instanceof ApiClientError && error.status === 404) {
    return "This supplier request or submission is unavailable.";
  }
  if (error instanceof ApiClientError && error.status === 409) {
    return "This supplier evidence changed in another session. Refresh it before continuing.";
  }
  if (
    error instanceof ApiClientError &&
    (error.kind === "network" ||
      error.kind === "invalid_response" ||
      (error.status !== undefined && error.status >= 500))
  ) {
    return "Supplier evidence is temporarily unavailable. No review decision was recorded; try again.";
  }
  return error instanceof ApiClientError
    ? error.message
    : "The supplier SBOM action could not be completed.";
}

function SubmissionReview({
  submission,
  disabled,
  onReview,
}: Readonly<{
  submission: SupplierSbomSubmission;
  disabled: boolean;
  onReview: (decision: SubmissionDecision, reason: string) => void;
}>) {
  const [decision, setDecision] = useState<SubmissionDecision>("accept");
  const [reason, setReason] = useState("");
  const isReviewable = submission.state === "awaiting_review";
  return (
    <li className="rounded-xl border border-border bg-canvas p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-subhead-semibold text-fg">
            {submission.fileName}
          </p>
          <p className="mt-1 break-all text-caption-2-regular text-fg-muted">
            SHA-256 {submission.sha256}
          </p>
        </div>
        <Tag variant="dot" size="sm" tone={statusTone(submission.state)}>
          {titleCase(submission.state)}
        </Tag>
      </div>
      <dl className="mt-3 grid gap-2 text-caption-1-regular sm:grid-cols-2">
        <div>
          <dt className="text-fg-muted">Submitted</dt>
          <dd className="mt-1 text-fg">
            {formatInstant(submission.createdAt)} UTC
          </dd>
        </div>
        <div>
          <dt className="text-fg-muted">Source evidence</dt>
          <dd className="mt-1 break-all text-fg">
            {submission.sourceId ?? "Not available until upload completes"}
          </dd>
        </div>
      </dl>
      {submission.validationMessage ? (
        <p role="alert" className="mt-3 text-caption-1-regular text-danger">
          {submission.validationMessage}
        </p>
      ) : null}
      {submission.reviewReason ? (
        <p className="mt-3 text-caption-1-regular text-fg-muted">
          Review rationale: {submission.reviewReason}
        </p>
      ) : null}
      {isReviewable ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-2 text-caption-1-semibold text-fg">
            Decision
            <Select
              aria-label={`Decision for supplier submission ${submission.id}`}
              value={decision}
              disabled={disabled}
              onValueChange={(value) =>
                setDecision(value as SubmissionDecision)
              }
            >
              <SelectItem value="accept">
                Accept into composite eligibility
              </SelectItem>
              <SelectItem value="reject">Reject and retain evidence</SelectItem>
            </Select>
          </label>
          <label className="flex flex-col gap-2 text-caption-1-semibold text-fg sm:col-span-2">
            Review rationale
            <textarea
              value={reason}
              disabled={disabled}
              onChange={(event) => setReason(event.target.value)}
              className="min-h-24 rounded-xl border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-active-500 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            />
          </label>
          <Button
            type="button"
            className="w-full sm:w-fit"
            disabled={disabled || reason.trim().length === 0}
            onClick={() => onReview(decision, reason.trim())}
          >
            Record {decision}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

export function SbomSupplierReviewSection({
  productId,
  releases,
  canReview,
  enabled,
}: Readonly<{
  productId: string;
  releases: readonly ReleaseOption[];
  canReview: boolean;
  enabled: boolean;
}>) {
  const [releaseId, setReleaseId] = useState(releases[0]?.id ?? "");
  const [supplierDisplayName, setSupplierDisplayName] = useState("");
  const [allowedComponentRef, setAllowedComponentRef] = useState("");
  const [expiresAt, setExpiresAt] = useState(defaultExpiry);
  const [message, setMessage] = useState<string | null>(null);
  const [latestInvitation, setLatestInvitation] = useState<string | null>(null);
  const requests = useSupplierSbomRequestsQuery(
    { productId, releaseId, limit: 100 },
    enabled && canReview && releaseId !== "",
  );
  const createRequest = useCreateSupplierSbomRequestMutation();
  const createInvitation = useCreateSupplierSbomInvitationMutation();
  const reviewSubmission = useReviewSupplierSbomSubmissionMutation();
  const busy =
    createRequest.isPending ||
    createInvitation.isPending ||
    reviewSubmission.isPending;

  useEffect(() => {
    if (releases.some((release) => release.id === releaseId)) return;
    setReleaseId(releases[0]?.id ?? "");
  }, [releaseId, releases]);

  useEffect(() => {
    setLatestInvitation(null);
  }, [releaseId]);

  async function createRequestAndInvitation() {
    if (
      releaseId === "" ||
      supplierDisplayName.trim() === "" ||
      allowedComponentRef.trim() === "" ||
      expiresAt === ""
    ) {
      setMessage(
        "Enter the supplier, allowed component reference, and invitation expiry.",
      );
      return;
    }
    const expiry = new Date(expiresAt);
    if (!Number.isFinite(expiry.getTime()) || expiry <= new Date()) {
      setMessage("Choose an invitation expiry in the future.");
      return;
    }
    setMessage(null);
    setLatestInvitation(null);
    try {
      const created = await createRequest.mutateAsync({
        productId,
        releaseId,
        input: {
          productId,
          releaseId,
          supplierDisplayName: supplierDisplayName.trim(),
          allowedComponentRef: allowedComponentRef.trim(),
          expiresAt: expiry.toISOString(),
          idempotencyKey: crypto.randomUUID(),
        },
      });
      const invitation = await createInvitation.mutateAsync({
        requestId: created.request.id,
        input: {
          expiresAt: expiry.toISOString(),
          idempotencyKey: crypto.randomUUID(),
        },
      });
      setLatestInvitation(invitation.invitationToken);
      setSupplierDisplayName("");
      setAllowedComponentRef("");
      setExpiresAt(defaultExpiry());
      setMessage(
        "Supplier request created. Copy the invitation once and deliver it through an approved channel.",
      );
    } catch (error) {
      setMessage(supplierErrorMessage(error));
    }
  }

  async function copyInvitation() {
    if (!latestInvitation) return;
    try {
      await navigator.clipboard.writeText(latestInvitation);
      setMessage(
        "Invitation copied. It is shown only for this session; do not place it in a ticket or audit note.",
      );
    } catch {
      setMessage(
        "Copy is unavailable in this browser. Select the invitation text and transfer it through an approved channel.",
      );
    }
  }

  async function review(
    submissionId: string,
    decision: SubmissionDecision,
    reason: string,
  ) {
    setMessage(null);
    try {
      await reviewSubmission.mutateAsync({
        submissionId,
        input: { decision, reason, idempotencyKey: crypto.randomUUID() },
      });
      setMessage(
        decision === "accept"
          ? "Supplier submission accepted for authoritative composite eligibility."
          : "Supplier submission rejected. The original submission remains auditable.",
      );
    } catch (error) {
      setMessage(supplierErrorMessage(error));
    }
  }

  return (
    <section
      aria-labelledby="supplier-sbom-review-heading"
      className="w-full min-w-0 max-w-full rounded-xl border border-border bg-canvas p-4 sm:p-6"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2
            id="supplier-sbom-review-heading"
            className="text-title-semibold text-fg"
          >
            Supplier SBOM review
          </h2>
          <p className="mt-1 max-w-3xl text-subhead-regular text-fg-muted">
            Issue a component-scoped invitation, then accept or reject supplier
            evidence after the standard validation and normalization pipeline
            completes.
          </p>
        </div>
      </div>

      {!canReview ? (
        <p role="alert" className="mt-4 text-subhead-regular text-danger">
          You do not have permission to review supplier SBOM evidence.
        </p>
      ) : releases.length === 0 ? (
        <p className="mt-4 text-subhead-regular text-fg-muted">
          Create a product release before requesting a supplier SBOM.
        </p>
      ) : (
        <div className="mt-5 grid gap-5">
          <div className="grid gap-3 rounded-xl border border-border bg-surface-subtle p-4 sm:grid-cols-2">
            <Select
              label="Target release"
              value={releaseId}
              disabled={busy}
              onValueChange={setReleaseId}
            >
              {releases.map((release) => (
                <SelectItem key={release.id} value={release.id}>
                  {release.label} - {release.version}
                </SelectItem>
              ))}
            </Select>
            <label className="flex flex-col gap-2 text-caption-1-semibold text-fg">
              Supplier display name
              <input
                value={supplierDisplayName}
                disabled={busy}
                onChange={(event) => setSupplierDisplayName(event.target.value)}
                className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-active-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-subtle"
              />
            </label>
            <label className="flex flex-col gap-2 text-caption-1-semibold text-fg">
              Allowed component reference
              <input
                value={allowedComponentRef}
                disabled={busy}
                onChange={(event) => setAllowedComponentRef(event.target.value)}
                className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-active-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-subtle"
              />
            </label>
            <label className="flex flex-col gap-2 text-caption-1-semibold text-fg">
              Invitation expiry
              <input
                type="datetime-local"
                value={expiresAt}
                disabled={busy}
                onChange={(event) => setExpiresAt(event.target.value)}
                className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-active-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-subtle"
              />
            </label>
            <div className="sm:col-span-2">
              <Button
                type="button"
                className="w-full sm:w-fit"
                disabled={busy}
                loading={createRequest.isPending || createInvitation.isPending}
                loadingLabel="Creating supplier invitation"
                onClick={() => void createRequestAndInvitation()}
              >
                Create supplier invitation
              </Button>
            </div>
          </div>

          {message ? (
            <p
              role={
                message.includes("unavailable") ||
                message.includes("permission")
                  ? "alert"
                  : "status"
              }
              className="text-caption-1-regular text-fg"
            >
              {message}
            </p>
          ) : null}

          {latestInvitation ? (
            <div className="rounded-xl border border-border bg-surface-subtle p-4">
              <p className="text-subhead-semibold text-fg">
                One-time supplier invitation
              </p>
              <p className="mt-1 text-caption-1-regular text-fg-muted">
                This token is not stored in the browser after this session.
                Share it only through an approved supplier channel.
              </p>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
                <textarea
                  readOnly
                  aria-label="One-time supplier invitation token"
                  value={latestInvitation}
                  className="min-h-20 flex-1 rounded-xl border border-border bg-canvas px-3 py-2 font-mono text-caption-2-regular text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-active-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-subtle"
                />
                <Button
                  type="button"
                  variant="outline"
                  tone="grey"
                  className="w-full sm:w-auto"
                  startIcon={<ClipboardCopy aria-hidden="true" />}
                  onClick={() => void copyInvitation()}
                >
                  Copy invitation
                </Button>
              </div>
            </div>
          ) : null}

          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-subhead-semibold text-fg">
                  Supplier submissions
                </h3>
                <p className="mt-1 text-caption-1-regular text-fg-muted">
                  Rejected evidence remains retained for audit and cannot enter
                  an authoritative composite.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                tone="grey"
                disabled={requests.isPending}
                onClick={() => void requests.refetch()}
              >
                <RefreshCw aria-hidden="true" className="mr-2 size-4" />
                Refresh
              </Button>
            </div>
            {requests.isPending ? (
              <p
                role="status"
                className="mt-4 text-caption-1-regular text-fg-muted"
              >
                Loading supplier requests...
              </p>
            ) : requests.isError ? (
              <p
                role="alert"
                className="mt-4 text-caption-1-regular text-danger"
              >
                {supplierErrorMessage(requests.error)}
              </p>
            ) : (requests.data?.requests.length ?? 0) === 0 ? (
              <p className="mt-4 rounded-xl border border-border bg-surface-subtle p-4 text-caption-1-regular text-fg-muted">
                No supplier SBOM requests exist for this release.
              </p>
            ) : (
              <ul
                className="mt-4 grid gap-4"
                aria-label="Supplier SBOM requests"
              >
                {requests.data?.requests.map((summary) => (
                  <li
                    key={summary.request.id}
                    className="rounded-xl border border-border bg-surface-subtle p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-subhead-semibold text-fg">
                          {summary.request.supplierDisplayName}
                        </p>
                        <p className="mt-1 break-words text-caption-1-regular text-fg-muted">
                          Allowed component:{" "}
                          {summary.request.allowedComponentRef} · expires{" "}
                          {formatInstant(summary.request.expiresAt)} UTC
                        </p>
                      </div>
                      <Tag
                        variant="dot"
                        size="sm"
                        tone={statusTone(summary.request.state)}
                      >
                        {titleCase(summary.request.state)}
                      </Tag>
                    </div>
                    <p className="mt-3 text-caption-1-regular text-fg-muted">
                      {summary.invitations.length} invitation
                      {summary.invitations.length === 1 ? "" : "s"} ·{" "}
                      {summary.submissions.length} submission
                      {summary.submissions.length === 1 ? "" : "s"}
                    </p>
                    {summary.submissions.length > 0 ? (
                      <ul
                        className="mt-3 grid gap-3"
                        aria-label={`Supplier submissions for ${summary.request.supplierDisplayName}`}
                      >
                        {summary.submissions.map((submission) => (
                          <SubmissionReview
                            key={submission.id}
                            submission={submission}
                            disabled={busy}
                            onReview={(decision, reason) =>
                              void review(submission.id, decision, reason)
                            }
                          />
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
