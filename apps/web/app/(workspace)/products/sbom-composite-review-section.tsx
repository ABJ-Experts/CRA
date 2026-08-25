"use client";

import {
  type SbomCompositeConflict,
  type SbomCompositeRelationship,
  type SbomCompositeReview,
  type SbomSourceHistoryItem,
} from "@repo/contracts/sboms";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import { Select, SelectItem } from "@repo/ui/select";
import { Tag, type TagProps } from "@repo/ui/tag";
import { GitMerge, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import {
  useCreateSbomCompositeReviewMutation,
  useGenerateSbomCompositeMutation,
  useResolveSbomCompositeConflictMutation,
  useResolveSbomCompositeRelationshipMutation,
  useSbomCompositeReviewQuery,
  useSbomSourceHistoryQuery,
} from "../../_features/sboms/sboms.queries";

type ReleaseOption = Readonly<{ id: string; label: string; version: string }>;
type ConflictDraft = Readonly<{
  decision: "select_source_component" | "exclude_identity";
  selectedComponentId: string;
  reason: string;
}>;
type RelationshipDraft = Readonly<{
  decision: "include" | "exclude";
  reason: string;
}>;

function titleCase(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatInstant(value: string | null): string {
  if (value === null) return "Not completed";
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

function compositeTone(state: SbomCompositeReview["state"]): TagProps["tone"] {
  if (state === "completed") return "green";
  if (state === "failed") return "red";
  if (state === "awaiting_review") return "orange";
  return "blue";
}

function reviewErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 403) {
    return "You no longer have permission to review composite SBOM evidence.";
  }
  if (error instanceof ApiClientError && error.status === 404) {
    return "This release or composite review is unavailable.";
  }
  if (error instanceof ApiClientError && error.status === 409) {
    return "The review changed in another session. Refresh it before continuing.";
  }
  if (
    error instanceof ApiClientError &&
    (error.kind === "network" ||
      error.kind === "invalid_response" ||
      (error.status !== undefined && error.status >= 500))
  ) {
    return "Composite review is temporarily unavailable. No source evidence was changed; try again.";
  }
  return error instanceof ApiClientError
    ? error.message
    : "The composite review could not be completed.";
}

function isEligibleSource(item: SbomSourceHistoryItem): boolean {
  return (
    item.source.status === "verified" &&
    (item.validation.status === "valid" ||
      item.validation.status === "valid_with_warnings")
  );
}

function sourceDescription(item: SbomSourceHistoryItem): string {
  return [
    item.source.fileName,
    item.source.source.replaceAll("_", " "),
    item.validation.status.replaceAll("_", " "),
  ].join(" · ");
}

function Metric({
  label,
  value,
  description,
}: Readonly<{ label: string; value: number; description: string }>) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface-subtle p-4">
      <p className="text-caption-1-semibold text-fg-muted">{label}</p>
      <p className="mt-1 text-title-2-semibold text-fg">{value}</p>
      <p className="mt-1 text-caption-2-regular text-fg-muted">{description}</p>
    </div>
  );
}

function ConflictResolution({
  conflict,
  draft,
  disabled,
  onChange,
  onResolve,
}: Readonly<{
  conflict: SbomCompositeConflict;
  draft: ConflictDraft;
  disabled: boolean;
  onChange: (draft: ConflictDraft) => void;
  onResolve: () => void;
}>) {
  const resolved = conflict.state !== "unresolved";
  return (
    <li className="rounded-xl border border-border bg-canvas p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-subhead-semibold text-fg">
            {conflict.field
              ? `${titleCase(conflict.field)} conflict`
              : "Unresolved identity"}
          </p>
          <p className="mt-1 break-words text-caption-1-regular text-fg-muted">
            {conflict.identity ??
              "No stable shared component identity is available."}
          </p>
        </div>
        <Tag variant="dot" size="sm" tone={resolved ? "green" : "orange"}>
          {titleCase(conflict.state)}
        </Tag>
      </div>
      <ul className="mt-3 grid gap-2" aria-label="Conflict source candidates">
        {conflict.candidates.map((candidate) => (
          <li
            key={candidate.component.componentId}
            className="min-w-0 rounded-xl border border-border bg-surface-subtle p-3"
          >
            <p className="break-words text-caption-1-semibold text-fg">
              {candidate.component.name}
              {candidate.component.version
                ? ` ${candidate.component.version}`
                : ""}
            </p>
            <p className="mt-1 break-all text-caption-2-regular text-fg-muted">
              Source component {candidate.component.sourceComponentRef} ·
              document {candidate.component.documentSha256}
            </p>
            {candidate.value !== null ? (
              <p className="mt-1 break-words text-caption-2-regular text-fg">
                Value: {candidate.value}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      {resolved ? (
        <p className="mt-3 text-caption-1-regular text-fg-muted">
          {conflict.state === "excluded"
            ? "Excluded"
            : "Selected source component"}
          {conflict.resolutionReason ? `: ${conflict.resolutionReason}` : "."}
        </p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-2 text-caption-1-semibold text-fg">
            Decision
            <Select
              aria-label={`Decision for conflict ${conflict.id}`}
              value={draft.decision}
              disabled={disabled}
              onValueChange={(decision) =>
                onChange({
                  ...draft,
                  decision: decision as ConflictDraft["decision"],
                })
              }
            >
              <SelectItem value="select_source_component">
                Select a source component
              </SelectItem>
              <SelectItem value="exclude_identity">Exclude identity</SelectItem>
            </Select>
          </label>
          {draft.decision === "select_source_component" ? (
            <label className="flex flex-col gap-2 text-caption-1-semibold text-fg">
              Source component
              <Select
                aria-label={`Source component for conflict ${conflict.id}`}
                value={draft.selectedComponentId}
                disabled={disabled}
                onValueChange={(selectedComponentId) =>
                  onChange({ ...draft, selectedComponentId })
                }
              >
                {conflict.candidates.map((candidate) => (
                  <SelectItem
                    key={candidate.component.componentId}
                    value={candidate.component.componentId}
                  >
                    {candidate.component.name}
                    {candidate.component.version
                      ? ` ${candidate.component.version}`
                      : ""}
                  </SelectItem>
                ))}
              </Select>
            </label>
          ) : null}
          <label className="flex flex-col gap-2 text-caption-1-semibold text-fg sm:col-span-2">
            Resolution rationale
            <textarea
              value={draft.reason}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...draft, reason: event.target.value })
              }
              className="min-h-24 rounded-xl border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-active-500 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            />
          </label>
          <Button
            type="button"
            className="w-full sm:w-fit"
            disabled={
              disabled ||
              draft.reason.trim().length === 0 ||
              (draft.decision === "select_source_component" &&
                draft.selectedComponentId === "")
            }
            onClick={onResolve}
          >
            Record resolution
          </Button>
        </div>
      )}
    </li>
  );
}

function RelationshipResolution({
  relationship,
  draft,
  disabled,
  onChange,
  onResolve,
}: Readonly<{
  relationship: SbomCompositeRelationship;
  draft: RelationshipDraft;
  disabled: boolean;
  onChange: (draft: RelationshipDraft) => void;
  onResolve: () => void;
}>) {
  const resolved = relationship.state !== "unresolved";
  return (
    <li className="rounded-xl border border-border bg-canvas p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-subhead-semibold text-fg">
            {titleCase(relationship.kind)}
          </p>
          <p className="mt-1 break-words text-caption-1-regular text-fg-muted">
            {relationship.sourceParentRef ?? "Unknown parent"} →{" "}
            {relationship.sourceChildRef ?? "Unknown child"}
          </p>
        </div>
        <Tag variant="dot" size="sm" tone={resolved ? "green" : "orange"}>
          {titleCase(relationship.state)}
        </Tag>
      </div>
      {resolved ? (
        <p className="mt-3 text-caption-1-regular text-fg-muted">
          {relationship.reason ?? "Decision recorded."}
        </p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-2 text-caption-1-semibold text-fg">
            Dependency decision
            <Select
              aria-label={`Decision for relationship ${relationship.id}`}
              value={draft.decision}
              disabled={disabled}
              onValueChange={(decision) =>
                onChange({
                  ...draft,
                  decision: decision as RelationshipDraft["decision"],
                })
              }
            >
              <SelectItem value="include">Include dependency</SelectItem>
              <SelectItem value="exclude">Exclude dependency</SelectItem>
            </Select>
          </label>
          <label className="flex flex-col gap-2 text-caption-1-semibold text-fg sm:col-span-2">
            Decision rationale
            <textarea
              value={draft.reason}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...draft, reason: event.target.value })
              }
              className="min-h-24 rounded-xl border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-active-500 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            />
          </label>
          <Button
            type="button"
            className="w-full sm:w-fit"
            disabled={disabled || draft.reason.trim().length === 0}
            onClick={onResolve}
          >
            Record dependency decision
          </Button>
        </div>
      )}
    </li>
  );
}

function CompletedComposite({
  review,
}: Readonly<{ review: SbomCompositeReview }>) {
  const manifest = review.provenanceManifest;
  return (
    <div className="rounded-xl border border-border bg-surface-subtle p-4">
      <p className="text-subhead-semibold text-fg">Immutable composite ready</p>
      <p className="mt-1 text-caption-1-regular text-fg-muted">
        Generated {formatInstant(review.completedAt)} UTC. The source evidence
        remains independently retained.
      </p>
      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <dt className="text-caption-2-regular text-fg-muted">
            Generated document
          </dt>
          <dd className="mt-1 break-all text-caption-2-regular text-fg">
            {review.generatedDocumentId}
          </dd>
        </div>
        <div>
          <dt className="text-caption-2-regular text-fg-muted">
            Provenance records
          </dt>
          <dd className="mt-1 text-caption-1-semibold text-fg">
            {manifest?.components.length ?? 0}
          </dd>
        </div>
        <div>
          <dt className="text-caption-2-regular text-fg-muted">Input hashes</dt>
          <dd className="mt-1 text-caption-1-semibold text-fg">
            {manifest?.sourceHashes.length ?? 0}
          </dd>
        </div>
      </dl>
      {manifest && manifest.components.length > 0 ? (
        <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-canvas">
          <table className="w-full min-w-[48rem] text-left">
            <caption className="sr-only">
              Composite component provenance
            </caption>
            <thead className="bg-surface">
              <tr>
                {[
                  "Composite component",
                  "Source component",
                  "Document hash",
                  "Supplier submission",
                ].map((label) => (
                  <th
                    key={label}
                    scope="col"
                    className="px-3 py-2 text-caption-2-uppercase text-fg-muted"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {manifest.components.slice(0, 25).map((provenance) => (
                <tr
                  key={`${provenance.compositeComponentRef}:${provenance.sourceComponentId}:${provenance.field ?? "component"}`}
                  className="border-t border-border align-top"
                >
                  <td className="max-w-60 break-words px-3 py-3 text-caption-2-regular text-fg">
                    {provenance.compositeComponentRef}
                  </td>
                  <td className="max-w-60 break-words px-3 py-3 text-caption-2-regular text-fg">
                    {provenance.sourceComponentRef}
                  </td>
                  <td className="max-w-64 break-all px-3 py-3 text-caption-2-regular text-fg-muted">
                    {provenance.documentSha256}
                  </td>
                  <td className="max-w-56 break-all px-3 py-3 text-caption-2-regular text-fg-muted">
                    {provenance.supplierSubmissionId ?? "Internal source"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function SbomCompositeReviewSection({
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
  const [selectedSourceIds, setSelectedSourceIds] = useState<readonly string[]>(
    [],
  );
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [conflictDrafts, setConflictDrafts] = useState<
    Readonly<Record<string, ConflictDraft>>
  >({});
  const [relationshipDrafts, setRelationshipDrafts] = useState<
    Readonly<Record<string, RelationshipDraft>>
  >({});
  const sourceHistory = useSbomSourceHistoryQuery(
    productId,
    releaseId,
    { limit: 100 },
    enabled && canReview && releaseId !== "",
  );
  const reviewQuery = useSbomCompositeReviewQuery(
    reviewId,
    enabled && canReview,
  );
  const create = useCreateSbomCompositeReviewMutation();
  const resolveConflict = useResolveSbomCompositeConflictMutation();
  const resolveRelationship = useResolveSbomCompositeRelationshipMutation();
  const generate = useGenerateSbomCompositeMutation();
  const review = reviewQuery.data?.review ?? create.data?.review ?? null;
  const eligibleSources = useMemo(
    () => (sourceHistory.data?.sources ?? []).filter(isEligibleSource),
    [sourceHistory.data?.sources],
  );
  const unresolvedConflictCount = review?.conflicts.filter(
    (conflict) => conflict.state === "unresolved",
  ).length;
  const unresolvedRelationshipCount = review?.relationships.filter(
    (relationship) => relationship.state === "unresolved",
  ).length;
  const busy =
    create.isPending ||
    resolveConflict.isPending ||
    resolveRelationship.isPending ||
    generate.isPending;

  useEffect(() => {
    if (releases.some((release) => release.id === releaseId)) return;
    setReleaseId(releases[0]?.id ?? "");
  }, [releaseId, releases]);

  useEffect(() => {
    setSelectedSourceIds([]);
    setReviewId(null);
    setMessage(null);
  }, [releaseId]);

  function toggleSource(sourceId: string) {
    setSelectedSourceIds((current) =>
      current.includes(sourceId)
        ? current.filter((id) => id !== sourceId)
        : [...current, sourceId],
    );
  }

  async function createReview() {
    if (releaseId === "" || selectedSourceIds.length === 0) return;
    setMessage(null);
    try {
      const response = await create.mutateAsync({
        productId,
        releaseId,
        input: {
          sourceIds: [...selectedSourceIds],
          idempotencyKey: crypto.randomUUID(),
        },
      });
      setReviewId(response.review.id);
    } catch (error) {
      setMessage(reviewErrorMessage(error));
    }
  }

  async function recordConflict(conflict: SbomCompositeConflict) {
    if (!review) return;
    const draft = conflictDrafts[conflict.id] ?? {
      decision: "select_source_component",
      selectedComponentId: conflict.candidates[0]?.component.componentId ?? "",
      reason: "",
    };
    setMessage(null);
    try {
      const response = await resolveConflict.mutateAsync({
        reviewId: review.id,
        conflictId: conflict.id,
        input:
          draft.decision === "exclude_identity"
            ? {
                decision: "exclude_identity",
                reason: draft.reason.trim(),
                idempotencyKey: crypto.randomUUID(),
              }
            : {
                decision: "select_source_component",
                selectedComponentId: draft.selectedComponentId,
                reason: draft.reason.trim(),
                idempotencyKey: crypto.randomUUID(),
              },
      });
      setReviewId(response.review.id);
    } catch (error) {
      setMessage(reviewErrorMessage(error));
    }
  }

  async function recordRelationship(relationship: SbomCompositeRelationship) {
    if (!review) return;
    const draft = relationshipDrafts[relationship.id] ?? {
      decision: "exclude",
      reason: "",
    };
    setMessage(null);
    try {
      const response = await resolveRelationship.mutateAsync({
        reviewId: review.id,
        relationshipId: relationship.id,
        input: {
          decision: draft.decision,
          reason: draft.reason.trim(),
          idempotencyKey: crypto.randomUUID(),
        },
      });
      setReviewId(response.review.id);
    } catch (error) {
      setMessage(reviewErrorMessage(error));
    }
  }

  async function generateComposite() {
    if (!review) return;
    setMessage(null);
    try {
      const response = await generate.mutateAsync({
        reviewId: review.id,
        input: { idempotencyKey: crypto.randomUUID() },
      });
      setReviewId(response.review.id);
    } catch (error) {
      setMessage(reviewErrorMessage(error));
    }
  }

  return (
    <section
      aria-labelledby="sbom-composite-review-heading"
      className="w-full min-w-0 max-w-full rounded-xl border border-border bg-canvas p-4 sm:p-6"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2
            id="sbom-composite-review-heading"
            className="text-title-semibold text-fg"
          >
            Composite SBOM review
          </h2>
          <p className="mt-1 max-w-3xl text-subhead-regular text-fg-muted">
            Merge eligible release evidence without changing any source
            document. Conflicting values and unresolved dependencies require an
            auditable decision.
          </p>
        </div>
        {review ? (
          <Tag variant="dot" size="sm" tone={compositeTone(review.state)}>
            {titleCase(review.state)}
          </Tag>
        ) : null}
      </div>

      {!canReview ? (
        <p role="alert" className="mt-4 text-subhead-regular text-danger">
          You do not have permission to review composite SBOM evidence.
        </p>
      ) : releases.length === 0 ? (
        <p className="mt-4 text-subhead-regular text-fg-muted">
          Create a product release before preparing a composite SBOM.
        </p>
      ) : (
        <div className="mt-5 grid gap-5">
          <Select
            label="Target release"
            value={releaseId}
            disabled={busy || review !== null}
            wrapperClassName="min-w-0 max-w-full sm:max-w-md"
            onValueChange={setReleaseId}
          >
            {releases.map((release) => (
              <SelectItem key={release.id} value={release.id}>
                {release.label} - {release.version}
              </SelectItem>
            ))}
          </Select>

          {message ? (
            <p role="alert" className="text-caption-1-regular text-danger">
              {message}
            </p>
          ) : null}

          {reviewQuery.isError || sourceHistory.isError ? (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-subtle p-4"
            >
              <p className="text-caption-1-regular text-danger">
                {reviewErrorMessage(reviewQuery.error ?? sourceHistory.error)}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                tone="grey"
                onClick={() => {
                  void sourceHistory.refetch();
                  void reviewQuery.refetch();
                }}
              >
                <RefreshCw aria-hidden="true" className="mr-2 size-4" />
                Try again
              </Button>
            </div>
          ) : null}

          {!review ? (
            <div className="grid gap-4">
              <div>
                <h3 className="text-subhead-semibold text-fg">
                  Eligible evidence
                </h3>
                <p className="mt-1 text-caption-1-regular text-fg-muted">
                  Select normalized, valid source documents for this release.
                  The server validates product structure, tenant scope, source
                  state, and accepted supplier status again.
                </p>
              </div>
              {sourceHistory.isPending ? (
                <p
                  role="status"
                  className="text-caption-1-regular text-fg-muted"
                >
                  Loading release evidence...
                </p>
              ) : eligibleSources.length === 0 ? (
                <p className="rounded-xl border border-border bg-surface-subtle p-4 text-caption-1-regular text-fg-muted">
                  No completed, valid source evidence is currently eligible for
                  a composite review.
                </p>
              ) : (
                <ul
                  className="grid gap-2"
                  aria-label="Eligible SBOM source documents"
                >
                  {eligibleSources.map((item) => {
                    const selected = selectedSourceIds.includes(item.source.id);
                    return (
                      <li key={item.source.id}>
                        <label
                          className={cn(
                            "flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-canvas p-4 transition-colors duration-150 motion-reduce:transition-none",
                            selected && "border-active-500 bg-active-50",
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={busy}
                            onChange={() => toggleSource(item.source.id)}
                            className="mt-1 size-4 rounded border-border text-active-600 focus-visible:ring-2 focus-visible:ring-active-500"
                          />
                          <span className="min-w-0">
                            <span className="block break-words text-subhead-semibold text-fg">
                              {item.source.fileName}
                            </span>
                            <span className="mt-1 block break-words text-caption-1-regular text-fg-muted">
                              {sourceDescription(item)}
                            </span>
                            <span className="mt-1 block break-all text-caption-2-regular text-fg-muted">
                              SHA-256 {item.source.sha256}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
              <Button
                type="button"
                className="w-full sm:w-fit"
                startIcon={<GitMerge aria-hidden="true" />}
                disabled={selectedSourceIds.length === 0 || busy}
                loading={create.isPending}
                loadingLabel="Preparing review"
                onClick={() => void createReview()}
              >
                Prepare composite review
              </Button>
            </div>
          ) : review.state === "completed" ? (
            <CompletedComposite review={review} />
          ) : (
            <div className="grid gap-5">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <Metric
                  label="Sources"
                  value={review.coverage.sourceCount}
                  description="Immutable inputs"
                />
                <Metric
                  label="Candidates"
                  value={review.coverage.componentCandidateCount}
                  description="Component records"
                />
                <Metric
                  label="Duplicates"
                  value={review.coverage.duplicateIdentityCount}
                  description="Shared identities"
                />
                <Metric
                  label="Conflicts"
                  value={review.coverage.conflictCount}
                  description="Require review"
                />
                <Metric
                  label="Relationships"
                  value={review.coverage.unresolvedRelationshipCount}
                  description="Need a decision"
                />
              </div>

              <div className="rounded-xl border border-border bg-surface-subtle p-4">
                <p className="text-subhead-semibold text-fg">
                  Immutable inputs
                </p>
                <ul className="mt-3 grid gap-2">
                  {review.sources.map((source) => (
                    <li
                      key={source.sourceId}
                      className="break-words text-caption-1-regular text-fg-muted"
                    >
                      {source.source.replaceAll("_", " ")} source · document{" "}
                      {source.documentSha256}
                      {source.supplierSubmissionId
                        ? ` · supplier submission ${source.supplierSubmissionId}`
                        : ""}
                      {source.retentionWarning
                        ? ` · ${source.retentionWarning}`
                        : ""}
                    </li>
                  ))}
                </ul>
              </div>

              {review.retentionWarnings.length > 0 ? (
                <div className="rounded-xl border border-border bg-surface-subtle p-4">
                  <p className="text-subhead-semibold text-fg">
                    Retention notices
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-caption-1-regular text-fg-muted">
                    {review.retentionWarnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {review.state === "failed" ? (
                <div
                  role="alert"
                  className="rounded-xl border border-border bg-surface-subtle p-4"
                >
                  <p className="text-subhead-semibold text-fg">
                    Generation failed
                  </p>
                  <p className="mt-1 text-caption-1-regular text-danger">
                    {review.error ??
                      "The immutable composite was not generated."}
                  </p>
                </div>
              ) : review.state === "generating" ||
                review.state === "processing" ? (
                <p
                  role="status"
                  className="rounded-xl border border-border bg-surface-subtle p-4 text-caption-1-regular text-fg-muted"
                >
                  Composite generation is {review.state}. This review refreshes
                  automatically; source evidence remains unchanged.
                </p>
              ) : null}

              {review.conflicts.length > 0 ? (
                <div>
                  <h3 className="text-subhead-semibold text-fg">
                    Conflicts and identity decisions
                  </h3>
                  <p className="mt-1 text-caption-1-regular text-fg-muted">
                    Select an actual source component or exclude the identity. A
                    rationale is retained with the review.
                  </p>
                  <ul className="mt-3 grid gap-3">
                    {review.conflicts.map((conflict) => {
                      const draft = conflictDrafts[conflict.id] ?? {
                        decision: "select_source_component" as const,
                        selectedComponentId:
                          conflict.candidates[0]?.component.componentId ?? "",
                        reason: "",
                      };
                      return (
                        <ConflictResolution
                          key={conflict.id}
                          conflict={conflict}
                          draft={draft}
                          disabled={busy || review.state !== "awaiting_review"}
                          onChange={(nextDraft) =>
                            setConflictDrafts((current) => ({
                              ...current,
                              [conflict.id]: nextDraft,
                            }))
                          }
                          onResolve={() => void recordConflict(conflict)}
                        />
                      );
                    })}
                  </ul>
                </div>
              ) : null}

              {review.relationships.length > 0 ? (
                <div>
                  <h3 className="text-subhead-semibold text-fg">
                    Unresolved relationships
                  </h3>
                  <p className="mt-1 text-caption-1-regular text-fg-muted">
                    Dependency relationships are never inferred when an endpoint
                    is unresolved or cyclic.
                  </p>
                  <ul className="mt-3 grid gap-3">
                    {review.relationships.map((relationship) => {
                      const draft = relationshipDrafts[relationship.id] ?? {
                        decision: "exclude" as const,
                        reason: "",
                      };
                      return (
                        <RelationshipResolution
                          key={relationship.id}
                          relationship={relationship}
                          draft={draft}
                          disabled={busy || review.state !== "awaiting_review"}
                          onChange={(nextDraft) =>
                            setRelationshipDrafts((current) => ({
                              ...current,
                              [relationship.id]: nextDraft,
                            }))
                          }
                          onResolve={() =>
                            void recordRelationship(relationship)
                          }
                        />
                      );
                    })}
                  </ul>
                </div>
              ) : null}

              {review.state === "awaiting_review" ||
              review.state === "failed" ? (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-subtle p-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-subhead-semibold text-fg">
                      Final composition
                    </p>
                    <p className="mt-1 text-caption-1-regular text-fg-muted">
                      {unresolvedConflictCount || unresolvedRelationshipCount
                        ? `${unresolvedConflictCount ?? 0} conflicts and ${unresolvedRelationshipCount ?? 0} relationships still require decisions.`
                        : "All explicit review decisions are recorded. Generate the immutable composite through the standard SBOM pipeline."}
                    </p>
                  </div>
                  <Button
                    type="button"
                    disabled={
                      busy ||
                      Boolean(unresolvedConflictCount) ||
                      Boolean(unresolvedRelationshipCount)
                    }
                    loading={generate.isPending}
                    loadingLabel="Generating composite"
                    onClick={() => void generateComposite()}
                  >
                    Generate immutable composite
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
