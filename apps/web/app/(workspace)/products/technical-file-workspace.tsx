"use client";

import {
  type TechnicalFile,
  type TechnicalFileSection,
  type TechnicalFileSourceKind,
} from "@repo/contracts/technical-files";
import type { ProductRetentionCalculation } from "@repo/contracts/products";
import { Button } from "@repo/ui/button";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  useAddTechnicalFileSourceMutation,
  useCreateTechnicalFileMutation,
  useRecalculateTechnicalFileReadinessMutation,
  useRemoveTechnicalFileSourceMutation,
  useReviewTechnicalFileSourceMutation,
  useSignalTechnicalFileSourceMaterialChangeMutation,
  useTechnicalFileQuery,
  useTechnicalFileReadinessQuery,
  useUpdateTechnicalFileSectionMutation,
} from "../../_features/technical-files/technical-files.queries";
import { TechnicalFileSnapshots } from "../../_features/technical-files/technical-file-snapshots";
import { TechnicalFileDeclarations } from "../../_features/technical-files/technical-file-declarations";
import { RiskRegisterWorkspace } from "../../_features/risk-register/risk-register-workspace";
import { ApiClientError } from "../../_lib/http/api-client";
import { useMocksReady } from "../../_providers/providers";
import { useSession } from "../../_providers/session-provider";
import {
  PageHeading,
  SectionCard,
} from "../../dashboard/_components/dashboard-chrome";

const SECTION_LABELS = Object.freeze({
  general_description: "General description and intended purpose",
  user_instructions: "Annex II user instructions",
  design_development_production: "Design, development, and production",
  support_period_basis: "Support-period basis",
  vulnerability_handling: "Vulnerability handling and disclosure",
  test_reports: "Test reports",
  release_sbom: "Release SBOM reference",
  standards_common_specifications: "Standards and common specifications",
} satisfies Record<TechnicalFileSection["key"], string>);

const INTERNAL_SOURCE_KINDS = Object.freeze([
  "product",
  "release",
  "support_period",
  "sbom_document",
  "finding",
  "risk_register",
] as const satisfies readonly TechnicalFileSourceKind[]);

function requestId(): string {
  return crypto.randomUUID();
}

function friendlyError(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError && error.status === 403) {
    return "You no longer have permission to change this technical file.";
  }
  if (error instanceof ApiClientError && error.status === 409) {
    return "This section changed elsewhere. Your entered work is still here; reload the latest version before retrying.";
  }
  if (
    error instanceof ApiClientError &&
    (error.kind === "network" ||
      error.kind === "invalid_response" ||
      (error.status ?? 0) >= 500)
  ) {
    return "The workspace is temporarily unavailable. Your entered work has not been discarded; try again when the connection is restored.";
  }
  return error instanceof ApiClientError ? error.message : fallback;
}

function statusLabel(status: TechnicalFileSection["status"]): string {
  return status.replaceAll("_", " ");
}

function readinessStatusLabel(status: string): string {
  return status.replaceAll("_", " ");
}

function SourceReadinessControls({
  productId,
  section,
  source,
  canEdit,
  onMessage,
}: {
  productId: string;
  section: TechnicalFileSection;
  source: TechnicalFileSection["sources"][number];
  canEdit: boolean;
  onMessage: (message: string) => void;
}) {
  const review = useReviewTechnicalFileSourceMutation(
    productId,
    section.key,
    source.id,
  );
  const signal = useSignalTechnicalFileSourceMaterialChangeMutation(
    productId,
    section.key,
    source.id,
  );
  const [reviewOpen, setReviewOpen] = useState(false);
  const [decision, setDecision] = useState<"retain" | "update">("retain");
  const [reviewRationale, setReviewRationale] = useState("");
  const [changeOpen, setChangeOpen] = useState(false);
  const [observedRevision, setObservedRevision] = useState("");
  const [fingerprint, setFingerprint] = useState("");

  async function submitReview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reviewRationale.trim() === "") {
      onMessage("Record a review rationale before resolving stale evidence.");
      return;
    }
    try {
      await review.mutateAsync({
        expectedVersion: section.version,
        decision,
        rationale: reviewRationale,
        idempotencyKey: requestId(),
      });
      setReviewOpen(false);
      onMessage(
        decision === "retain"
          ? "The existing pinned evidence was retained with a review rationale."
          : "The evidence link was updated to the reviewed revision.",
      );
    } catch (error) {
      onMessage(
        friendlyError(error, "The evidence review could not be saved."),
      );
    }
  }

  async function submitMaterialChange(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (fingerprint.trim() === "") {
      onMessage("Provide the current edition or version fingerprint.");
      return;
    }
    try {
      await signal.mutateAsync({
        expectedVersion: section.version,
        reason: "standard_edition_changed",
        currentObservedRevision:
          observedRevision.trim() === "" ? null : observedRevision.trim(),
        currentFingerprint: fingerprint.trim(),
        idempotencyKey: requestId(),
      });
      setChangeOpen(false);
      onMessage("The changed standard edition is now marked for review.");
    } catch (error) {
      onMessage(
        friendlyError(
          error,
          "The material source change could not be recorded.",
        ),
      );
    }
  }

  if (!canEdit) return null;
  return (
    <div className="mt-3 flex flex-col items-start gap-3">
      {source.status === "stale" ? (
        <>
          <Button
            type="button"
            variant="outline"
            tone="grey"
            disabled={review.isPending}
            onClick={() => setReviewOpen((open) => !open)}
          >
            Review stale evidence
          </Button>
          {reviewOpen ? (
            <form
              onSubmit={submitReview}
              className="grid w-full gap-3"
              noValidate
            >
              <fieldset className="flex flex-wrap gap-4">
                <legend className="sr-only">Stale evidence decision</legend>
                <label className="flex items-center gap-2 text-caption-1-regular text-fg">
                  <input
                    type="radio"
                    name={`review-${source.id}`}
                    checked={decision === "retain"}
                    onChange={() => setDecision("retain")}
                  />
                  Retain pinned evidence
                </label>
                <label className="flex items-center gap-2 text-caption-1-regular text-fg">
                  <input
                    type="radio"
                    name={`review-${source.id}`}
                    checked={decision === "update"}
                    onChange={() => setDecision("update")}
                  />
                  Update to reviewed version
                </label>
              </fieldset>
              <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
                Review rationale
                <textarea
                  value={reviewRationale}
                  onChange={(event) => setReviewRationale(event.target.value)}
                  maxLength={4_000}
                  required
                  rows={3}
                  className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
                />
              </label>
              <div>
                <Button
                  type="submit"
                  loading={review.isPending}
                  loadingLabel="Saving review"
                >
                  Record decision
                </Button>
              </div>
            </form>
          ) : null}
        </>
      ) : null}
      {source.kind === "manual_reference" ? (
        <>
          <Button
            type="button"
            variant="outline"
            tone="grey"
            disabled={signal.isPending}
            onClick={() => setChangeOpen((open) => !open)}
          >
            Record changed standard edition
          </Button>
          {changeOpen ? (
            <form
              onSubmit={submitMaterialChange}
              className="grid w-full gap-3"
              noValidate
            >
              <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
                Current edition or revision
                <input
                  value={observedRevision}
                  onChange={(event) => setObservedRevision(event.target.value)}
                  maxLength={200}
                  className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
                />
              </label>
              <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
                Current version fingerprint
                <input
                  value={fingerprint}
                  onChange={(event) => setFingerprint(event.target.value)}
                  maxLength={200}
                  required
                  className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
                />
              </label>
              <p className="text-caption-1-regular text-fg-muted">
                M10 is not yet available to verify editions. This records a
                reviewer-reported material change; it does not substitute a
                newer reference.
              </p>
              <div>
                <Button
                  type="submit"
                  loading={signal.isPending}
                  loadingLabel="Recording change"
                >
                  Mark for review
                </Button>
              </div>
            </form>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function SectionEditor({
  productId,
  section,
  canEdit,
  onClose,
}: {
  productId: string;
  section: TechnicalFileSection;
  canEdit: boolean;
  onClose: () => void;
}) {
  const update = useUpdateTechnicalFileSectionMutation(productId, section.key);
  const addSource = useAddTechnicalFileSourceMutation(productId, section.key);
  const removeSource = useRemoveTechnicalFileSourceMutation(
    productId,
    section.key,
  );
  const [narrative, setNarrative] = useState(section.narrative ?? "");
  const [applicability, setApplicability] = useState(section.applicability);
  const [reason, setReason] = useState(section.nonApplicabilityReason ?? "");
  const [sourceKind, setSourceKind] =
    useState<TechnicalFileSourceKind>("manual_reference");
  const [recordId, setRecordId] = useState("");
  const [title, setTitle] = useState("");
  const [edition, setEdition] = useState("");
  const [issuer, setIssuer] = useState("");
  const [locator, setLocator] = useState("");
  const [rationale, setRationale] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setNarrative(section.narrative ?? "");
    setApplicability(section.applicability);
    setReason(section.nonApplicabilityReason ?? "");
  }, [section]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (applicability === "not_applicable" && reason.trim() === "") {
      setMessage("Provide a reason when this section is not applicable.");
      return;
    }
    try {
      await update.mutateAsync({
        expectedVersion: section.version,
        narrative: narrative.trim() === "" ? null : narrative,
        applicability,
        nonApplicabilityReason:
          applicability === "not_applicable" ? reason : null,
        idempotencyKey: requestId(),
      });
      setMessage("Section saved.");
    } catch (error) {
      setMessage(friendlyError(error, "The section could not be saved."));
    }
  }

  async function linkSource(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (sourceKind === "manual_reference" && title.trim() === "") {
      setMessage("A manual reference needs a title.");
      return;
    }
    if (sourceKind !== "manual_reference" && recordId.trim() === "") {
      setMessage("Enter the source record ID to link an internal record.");
      return;
    }
    try {
      await addSource.mutateAsync({
        expectedVersion: section.version,
        sourceKind,
        ...(sourceKind === "manual_reference"
          ? {
              manualReference: {
                title,
                editionOrRevision: edition === "" ? null : edition,
                issuer: issuer === "" ? null : issuer,
                locator: locator === "" ? null : locator,
                rationale: rationale === "" ? null : rationale,
              },
            }
          : { recordId }),
        idempotencyKey: requestId(),
      });
      setRecordId("");
      setTitle("");
      setEdition("");
      setIssuer("");
      setLocator("");
      setRationale("");
      setMessage(
        "Source linked. The section was refreshed with the verified reference.",
      );
    } catch (error) {
      setMessage(friendlyError(error, "The source could not be linked."));
    }
  }

  async function unlinkSource(sourceId: string) {
    setMessage(null);
    try {
      await removeSource.mutateAsync({
        sourceId,
        expectedVersion: section.version,
        idempotencyKey: requestId(),
      });
      setMessage("Source unlinked.");
    } catch (error) {
      setMessage(friendlyError(error, "The source could not be unlinked."));
    }
  }

  const working =
    update.isPending || addSource.isPending || removeSource.isPending;
  return (
    <SectionCard
      title={SECTION_LABELS[section.key]}
      action={
        <Button type="button" variant="outline" tone="grey" onClick={onClose}>
          Back to file
        </Button>
      }
    >
      <div className="flex flex-col gap-6">
        <div className="rounded-xl border border-border bg-surface-subtle p-4">
          <p className="text-caption-1-semibold text-fg-muted">
            Annex VII requirement
          </p>
          <p className="mt-2 whitespace-pre-wrap text-subhead-regular text-fg">
            {section.requirementText}
          </p>
        </div>
        {message ? (
          <p
            role="status"
            aria-live="polite"
            className="text-subhead-regular text-fg-muted"
          >
            {message}
          </p>
        ) : null}
        <form onSubmit={save} className="flex flex-col gap-4" noValidate>
          <label
            className="flex flex-col gap-2 text-subhead-semibold text-fg"
            htmlFor="technical-file-narrative"
          >
            Narrative
            <textarea
              id="technical-file-narrative"
              value={narrative}
              disabled={!canEdit || working}
              onChange={(event) => setNarrative(event.target.value)}
              rows={8}
              maxLength={20_000}
              className="min-h-40 rounded-xl border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
              aria-describedby="technical-file-narrative-help"
            />
          </label>
          <p
            id="technical-file-narrative-help"
            className="text-caption-1-regular text-fg-muted"
          >
            Describe how this product meets the stated requirement. Saved source
            links remain separately reviewable.
          </p>
          <fieldset
            disabled={!canEdit || working}
            className="flex flex-col gap-2"
          >
            <legend className="text-subhead-semibold text-fg">
              Applicability
            </legend>
            <label className="flex items-center gap-2 text-subhead-regular text-fg">
              <input
                type="radio"
                name="applicability"
                checked={applicability === "applicable"}
                onChange={() => setApplicability("applicable")}
              />{" "}
              Applicable
            </label>
            <label className="flex items-center gap-2 text-subhead-regular text-fg">
              <input
                type="radio"
                name="applicability"
                checked={applicability === "not_applicable"}
                onChange={() => setApplicability("not_applicable")}
              />{" "}
              Not applicable
            </label>
          </fieldset>
          {applicability === "not_applicable" ? (
            <label
              className="flex flex-col gap-2 text-subhead-semibold text-fg"
              htmlFor="technical-file-na-reason"
            >
              Reason for non-applicability
              <textarea
                id="technical-file-na-reason"
                value={reason}
                disabled={!canEdit || working}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                maxLength={2_000}
                required
                className="rounded-xl border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
              />
            </label>
          ) : null}
          {canEdit ? (
            <div>
              <Button
                type="submit"
                loading={update.isPending}
                loadingLabel="Saving section"
              >
                Save section
              </Button>
            </div>
          ) : null}
        </form>

        <div className="border-t border-border pt-6">
          <h2 className="text-h4 text-fg">Source references</h2>
          <p className="mt-1 text-subhead-regular text-fg-muted">
            Internal links are verified by the service. New releases and SBOM
            revisions are never substituted automatically.
          </p>
          {section.sources.length === 0 ? (
            <p className="mt-4 text-subhead-regular text-fg-muted">
              No source references are linked yet.
            </p>
          ) : (
            <ul
              className="mt-4 flex flex-col gap-3"
              aria-label="Linked source references"
            >
              {section.sources.map((source) => (
                <li
                  key={source.id}
                  className="rounded-xl border border-border bg-surface-subtle p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-subhead-semibold text-fg">
                        {source.title}
                      </p>
                      <p className="mt-1 text-caption-1-regular text-fg-muted">
                        {source.kind.replaceAll("_", " ")} · {source.status}
                        {source.observedRevision
                          ? ` · observed ${source.observedRevision}`
                          : ""}
                        {source.linkVersion
                          ? ` · pinned link ${source.linkVersion}`
                          : ""}
                      </p>
                      {source.status === "stale" ? (
                        <p className="mt-1 text-caption-1-regular text-fg-muted">
                          Changed:{" "}
                          {source.staleReason?.replaceAll("_", " ") ??
                            "source revision requires review"}
                          {source.currentObservedRevision
                            ? ` · current ${source.currentObservedRevision}`
                            : ""}
                          {source.currentFingerprint
                            ? ` · fingerprint ${source.currentFingerprint}`
                            : ""}
                        </p>
                      ) : null}
                    </div>
                    {canEdit ? (
                      <Button
                        type="button"
                        variant="outline"
                        tone="grey"
                        disabled={working}
                        onClick={() => void unlinkSource(source.id)}
                        aria-label={`Unlink ${source.title}`}
                      >
                        Unlink
                      </Button>
                    ) : null}
                  </div>
                  <SourceReadinessControls
                    productId={productId}
                    section={section}
                    source={source}
                    canEdit={canEdit}
                    onMessage={setMessage}
                  />
                  {(source.reviews ?? []).length > 0 ? (
                    <div className="mt-3 border-t border-border pt-3">
                      <h3 className="text-caption-1-semibold text-fg">
                        Review history
                      </h3>
                      <ul
                        className="mt-2 flex flex-col gap-2"
                        aria-label={`Review history for ${source.title}`}
                      >
                        {(source.reviews ?? []).map((review) => (
                          <li
                            key={review.id}
                            className="text-caption-1-regular text-fg-muted"
                          >
                            {review.decision} · {review.rationale} ·{" "}
                            {review.createdAt}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {canEdit ? (
            <form
              onSubmit={linkSource}
              className="mt-5 grid gap-3 rounded-xl border border-border p-4"
              noValidate
            >
              <h3 className="text-h5 text-fg">Link source</h3>
              <label
                className="flex flex-col gap-1 text-caption-1-semibold text-fg"
                htmlFor="technical-file-source-kind"
              >
                Source type
                <select
                  id="technical-file-source-kind"
                  value={sourceKind}
                  disabled={working}
                  onChange={(event) =>
                    setSourceKind(event.target.value as TechnicalFileSourceKind)
                  }
                  className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <option value="manual_reference">
                    Manual bibliographic reference
                  </option>
                  {INTERNAL_SOURCE_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {kind.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              {sourceKind === "manual_reference" ? (
                <>
                  <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
                    Title
                    <input
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      maxLength={500}
                      required
                      className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
                    Edition or revision
                    <input
                      value={edition}
                      onChange={(event) => setEdition(event.target.value)}
                      maxLength={200}
                      className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
                    Issuer
                    <input
                      value={issuer}
                      onChange={(event) => setIssuer(event.target.value)}
                      maxLength={300}
                      className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
                    Locator
                    <input
                      value={locator}
                      onChange={(event) => setLocator(event.target.value)}
                      maxLength={2_000}
                      className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
                    Rationale
                    <textarea
                      value={rationale}
                      onChange={(event) => setRationale(event.target.value)}
                      rows={2}
                      maxLength={2_000}
                      className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    />
                  </label>
                </>
              ) : (
                <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
                  Source record ID
                  <input
                    value={recordId}
                    onChange={(event) => setRecordId(event.target.value)}
                    inputMode="text"
                    required
                    className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  />
                  <span className="text-caption-1-regular text-fg-muted">
                    The API verifies tenant ownership and access before saving
                    this link.
                  </span>
                </label>
              )}
              <div>
                <Button
                  type="submit"
                  loading={addSource.isPending}
                  loadingLabel="Linking source"
                >
                  Link source
                </Button>
              </div>
            </form>
          ) : null}
          <p className="mt-4 rounded-xl border border-border bg-surface-subtle p-3 text-caption-1-regular text-fg-muted">
            Document attachments are unavailable in M7-01. M8 will add evidence
            attachment linking; this workspace does not represent an attachment
            as completed.
          </p>
        </div>
      </div>
    </SectionCard>
  );
}

function TechnicalFileReadinessOverview({
  productId,
  enabled,
  canEdit,
  onOpenSection,
}: {
  productId: string;
  enabled: boolean;
  canEdit: boolean;
  onOpenSection: (key: TechnicalFileSection["key"]) => void;
}) {
  const readiness = useTechnicalFileReadinessQuery(productId, enabled);
  const recalculate = useRecalculateTechnicalFileReadinessMutation(productId);
  const [message, setMessage] = useState<string | null>(null);

  async function recalculateReadiness() {
    setMessage(null);
    try {
      await recalculate.mutateAsync({ idempotencyKey: requestId() });
      setMessage("Readiness was recalculated from the pinned evidence links.");
    } catch (error) {
      setMessage(
        friendlyError(
          error,
          "Readiness could not be recalculated. Try again later.",
        ),
      );
    }
  }

  if (readiness.isPending) {
    return (
      <div className="rounded-xl border border-border bg-surface-subtle p-4">
        <p role="status" className="text-subhead-regular text-fg-muted">
          Calculating documentation readiness…
        </p>
      </div>
    );
  }
  if (readiness.isError || !readiness.data) {
    return (
      <div className="rounded-xl border border-border bg-surface-subtle p-4">
        <p className="text-subhead-semibold text-fg">
          Readiness is temporarily unavailable.
        </p>
        <p className="mt-1 text-caption-1-regular text-fg-muted">
          No evidence is treated as complete while this result is unavailable.
        </p>
        <Button
          type="button"
          variant="outline"
          tone="grey"
          className="mt-3"
          onClick={() => void readiness.refetch()}
        >
          Try again
        </Button>
      </div>
    );
  }

  const result = readiness.data.readiness;
  return (
    <section
      aria-labelledby="technical-file-readiness-heading"
      className="rounded-xl border border-border bg-surface-subtle p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="technical-file-readiness-heading" className="text-h4 text-fg">
            Documentation readiness
          </h2>
          <p className="mt-1 text-subhead-semibold text-fg">
            {readinessStatusLabel(result.overallStatus)}
          </p>
          <p className="mt-1 text-caption-1-regular text-fg-muted">
            {result.recalculationStatus === "current"
              ? "Calculated from the currently pinned source versions."
              : `Recalculation status: ${readinessStatusLabel(result.recalculationStatus)}.`}{" "}
            Documentation readiness does not certify legal completeness.
          </p>
        </div>
        {canEdit ? (
          <Button
            type="button"
            variant="outline"
            tone="grey"
            loading={recalculate.isPending}
            loadingLabel="Recalculating readiness"
            onClick={() => void recalculateReadiness()}
          >
            Recalculate
          </Button>
        ) : null}
      </div>
      {message ? (
        <p
          role="status"
          aria-live="polite"
          className="mt-3 text-caption-1-regular text-fg-muted"
        >
          {message}
        </p>
      ) : null}
      {result.gaps.length === 0 ? (
        <p className="mt-4 text-subhead-regular text-fg-muted">
          No actionable documentation gaps are currently reported.
        </p>
      ) : (
        <ol
          className="mt-4 flex flex-col gap-2"
          aria-label="Prioritised documentation gaps"
        >
          {[...result.gaps]
            .sort((left, right) => left.priority - right.priority)
            .map((gap) => (
              <li
                key={`${gap.sectionKey}-${gap.code}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-canvas p-3"
              >
                <div>
                  <p className="text-subhead-semibold text-fg">
                    {gap.actionLabel}
                  </p>
                  <p className="mt-1 text-caption-1-regular text-fg-muted">
                    {SECTION_LABELS[gap.sectionKey]} · priority {gap.priority}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  tone="grey"
                  onClick={() => onOpenSection(gap.sectionKey)}
                >
                  Open section
                </Button>
              </li>
            ))}
        </ol>
      )}
      <ul className="mt-4 grid gap-2" aria-label="Section readiness states">
        {result.sections.map((section) => (
          <li
            key={section.sectionKey}
            className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2"
          >
            <p className="text-caption-1-semibold text-fg">
              {SECTION_LABELS[section.sectionKey]}
            </p>
            <p className="text-caption-1-regular text-fg-muted">
              {readinessStatusLabel(section.status)} ·{" "}
              {section.validEvidenceCount} valid evidence · {section.gapCount}{" "}
              gap{section.gapCount === 1 ? "" : "s"}
              {section.staleReasons.length > 0
                ? ` · ${section.staleReasons
                    .map(readinessStatusLabel)
                    .join(", ")}`
                : ""}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TechnicalFileOverview({
  productId,
  technicalFile,
  retention,
  canEdit,
  canView,
  canSnapshot,
  canIssue,
  enabled,
}: {
  productId: string;
  technicalFile: TechnicalFile;
  retention: ProductRetentionCalculation;
  canEdit: boolean;
  canView: boolean;
  canSnapshot: boolean;
  canIssue: boolean;
  enabled: boolean;
}) {
  const [selectedKey, setSelectedKey] = useState<
    TechnicalFileSection["key"] | null
  >(null);
  const selected =
    technicalFile.sections.find((section) => section.key === selectedKey) ??
    null;
  if (selected)
    return (
      <SectionEditor
        productId={productId}
        section={selected}
        canEdit={canEdit}
        onClose={() => setSelectedKey(null)}
      />
    );
  return (
    <SectionCard title="Annex VII technical file">
      <div className="flex flex-col gap-5">
        <div className="rounded-xl border border-border bg-surface-subtle p-4">
          <p className="text-caption-1-semibold text-fg-muted">Template</p>
          <p className="mt-1 text-subhead-semibold text-fg">
            Annex VII · {technicalFile.templateVersion}
          </p>
          <p className="mt-2 text-caption-1-regular text-fg-muted">
            {technicalFile.legalSource}
          </p>
          <p className="mt-2 text-caption-1-regular text-fg-muted">
            This workspace organizes evidence against the template. It does not
            certify legal completeness.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface-subtle p-4">
          <p className="text-caption-1-semibold text-fg-muted">
            Support and retention basis
          </p>
          <p className="mt-1 text-subhead-semibold text-fg">
            {retention.status === "current"
              ? `Protected until ${retention.retentionProtectionUntil}`
              : "Retention basis is incomplete"}
          </p>
          <p className="mt-2 text-caption-1-regular text-fg-muted">
            {retention.legalHoldActive
              ? "An active legal hold applies."
              : "No active legal hold is recorded."}
            {retention.status === "incomplete" &&
            retention.incompleteReasons.length > 0
              ? ` Missing: ${retention.incompleteReasons.join(", ")}.`
              : ""}
          </p>
        </div>
        <TechnicalFileReadinessOverview
          productId={productId}
          enabled={enabled}
          canEdit={canEdit}
          onOpenSection={setSelectedKey}
        />
        <div className="grid gap-3">
          {technicalFile.sections.map((section) => (
            <div
              key={section.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4"
            >
              <div>
                <h2 className="text-subhead-semibold text-fg">
                  {SECTION_LABELS[section.key]}
                </h2>
                <p className="mt-1 text-caption-1-regular text-fg-muted">
                  Status: {statusLabel(section.status)} ·{" "}
                  {section.sources.length} linked source
                  {section.sources.length === 1 ? "" : "s"}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                tone="grey"
                onClick={() => setSelectedKey(section.key)}
              >
                Open section
              </Button>
            </div>
          ))}
        </div>
        <RiskRegisterWorkspace
          productId={productId}
          enabled={enabled}
          canEdit={canEdit}
        />
        <TechnicalFileSnapshots
          productId={productId}
          technicalFileVersion={technicalFile.version}
          enabled={enabled}
          canView={canView}
          canSnapshot={canSnapshot}
        />
        <TechnicalFileDeclarations
          productId={productId}
          enabled={enabled}
          canView={canView}
          canIssue={canIssue}
        />
      </div>
    </SectionCard>
  );
}

export function TechnicalFileWorkspace({ productId }: { productId: string }) {
  const router = useRouter();
  const mocksReady = useMocksReady();
  const { session, permissions, isLoading: sessionLoading } = useSession();
  const liveApiEnabled =
    mocksReady && process.env.NEXT_PUBLIC_ENABLE_MOCKS === "false";
  const hasMembership = (session?.organizations.length ?? 0) > 0;
  const canView = permissions.can_view_technical_files === true;
  const canEdit = permissions.can_edit_technical_files === true;
  const canSnapshot = permissions.can_snapshot_technical_files === true;
  const canIssue = permissions.can_issue_technical_files === true;
  const file = useTechnicalFileQuery(
    productId,
    liveApiEnabled && hasMembership && canView,
  );
  const create = useCreateTechnicalFileMutation(productId);
  const [message, setMessage] = useState<string | null>(null);

  async function createFile() {
    setMessage(null);
    try {
      await create.mutateAsync({ idempotencyKey: requestId() });
    } catch (error) {
      setMessage(
        friendlyError(error, "The technical file could not be created."),
      );
    }
  }
  return (
    <div className="flex flex-col gap-6 px-6 py-6 lg:px-[30px]">
      <PageHeading
        title="Technical file"
        subtitle="Annex VII source-linked technical documentation."
        actions={
          <Button
            type="button"
            variant="outline"
            tone="grey"
            onClick={() => router.push(`/products/${productId}`)}
          >
            Back to product
          </Button>
        }
      />
      {!liveApiEnabled ? (
        <SectionCard>
          <p className="text-subhead-regular text-fg-muted">
            Technical files are available when the live backend is enabled.
          </p>
        </SectionCard>
      ) : sessionLoading ? (
        <SectionCard>
          <p role="status" className="text-subhead-regular text-fg-muted">
            Loading technical-file access…
          </p>
        </SectionCard>
      ) : !hasMembership ? (
        <SectionCard>
          <p className="text-subhead-regular text-fg-muted">
            Create or join an organization before opening a technical file.
          </p>
        </SectionCard>
      ) : !canView ? (
        <SectionCard>
          <p role="alert" className="text-subhead-regular text-danger">
            You do not have permission to view technical files.
          </p>
        </SectionCard>
      ) : file.isPending ? (
        <SectionCard>
          <p role="status" className="text-subhead-regular text-fg-muted">
            Loading technical file…
          </p>
        </SectionCard>
      ) : file.isError &&
        file.error instanceof ApiClientError &&
        file.error.status === 404 ? (
        <SectionCard title="No active technical file">
          <div className="flex flex-col gap-4">
            <p className="text-subhead-regular text-fg-muted">
              Create the Annex VII workspace for this product once. The service
              makes repeated requests idempotent.
            </p>
            {message ? (
              <p role="alert" className="text-subhead-regular text-danger">
                {message}
              </p>
            ) : null}
            {canEdit ? (
              <div>
                <Button
                  type="button"
                  onClick={() => void createFile()}
                  loading={create.isPending}
                  loadingLabel="Creating technical file"
                >
                  Create technical file
                </Button>
              </div>
            ) : (
              <p role="alert" className="text-subhead-regular text-danger">
                You can view technical files but cannot create or edit one.
              </p>
            )}
          </div>
        </SectionCard>
      ) : file.isError ? (
        <SectionCard>
          <div role="alert" className="flex flex-wrap items-center gap-3">
            <p className="text-subhead-regular text-danger">
              {friendlyError(
                file.error,
                "The technical file could not be loaded.",
              )}
            </p>
            <Button
              type="button"
              variant="outline"
              tone="grey"
              onClick={() => void file.refetch()}
            >
              Try again
            </Button>
          </div>
        </SectionCard>
      ) : file.data ? (
        <TechnicalFileOverview
          productId={productId}
          technicalFile={file.data.technicalFile}
          retention={file.data.retention}
          canEdit={canEdit}
          canView={canView}
          canSnapshot={canSnapshot}
          canIssue={canIssue}
          enabled={liveApiEnabled && hasMembership && canView}
        />
      ) : null}
    </div>
  );
}
