"use client";

import {
  createSubstantialModificationAssessmentDraftInputSchema,
  createSubstantialModificationAssessmentInputSchema,
  reserveSecurityUpdateArtifactInputSchema,
  reviewSubstantialModificationAssessmentInputSchema,
  updateSecurityUpdateArtifactMetadataInputSchema,
  type SecurityUpdateArtifact,
  type SubstantialModificationAnswers,
  type SubstantialModificationAssessment,
} from "@repo/contracts/products";
import { Button } from "@repo/ui/button";
import { useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import {
  useCreateSubstantialModificationAssessmentDraftMutation,
  useCreateSubstantialModificationAssessmentMutation,
  useFinalizeSecurityUpdateArtifactMutation,
  useFinalizeReservedSecurityUpdateArtifactMutation,
  usePublishSecurityUpdateArtifactMutation,
  useReassessSubstantialModificationAssessmentMutation,
  useReplaceSecurityUpdateArtifactMutation,
  useReserveSecurityUpdateArtifactMutation,
  useReviewSecurityUpdateArtifactMutation,
  useReviewSubstantialModificationAssessmentMutation,
  useSecurityUpdateArtifactsQuery,
  useSubstantialModificationAssessmentHistoryQuery,
  useSubstantialModificationAssessmentsQuery,
  useUpdateSecurityUpdateArtifactMetadataMutation,
  useWithdrawSecurityUpdateArtifactMutation,
} from "../../_features/products/products.queries";
import { productsApi } from "../../_features/products/products.api";

const questions = Object.freeze([
  ["changesIntendedPurpose", "Changes intended purpose"],
  [
    "changesSecurityArchitectureOrTrustBoundary",
    "Changes security architecture or trust boundary",
  ],
  [
    "changesNetworkInterfaceOrPrivilegedRemoteControl",
    "Changes network interface or privileged remote control",
  ],
  [
    "changesCryptographyOrIdentityAccessControl",
    "Changes cryptography or identity and access control",
  ],
  [
    "changesSafetyOrSecurityRelevantComponent",
    "Changes a safety or security relevant component",
  ],
] as const);

const fieldClassName =
  "h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-active-500 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

function idempotencyKey(): string {
  return crypto.randomUUID();
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError && error.status === 403)
    return "You do not have permission to perform that action.";
  if (error instanceof ApiClientError && error.status === 404)
    return "This product evidence is unavailable.";
  if (
    error instanceof ApiClientError &&
    (error.kind === "network" ||
      error.kind === "invalid_response" ||
      (error.status !== undefined && error.status >= 500))
  )
    return "The registry is temporarily unavailable. Try again.";
  return error instanceof ApiClientError ? error.message : fallback;
}

/** Same optimistic-lock signal `support-period-retention-section.tsx` reuses. */
function isConflict(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === "conflict";
}

const flaggedOutcomes = new Set(["potentially_substantial", "substantial"]);

/** An assessment is flagged once it has a substantial-leaning outcome and is
 * still the governing revision — a superseded row's outcome is history. */
function isFlagged(assessment: SubstantialModificationAssessment): boolean {
  const outcome = assessment.determination ?? assessment.suggestion;
  return (
    assessment.status !== "superseded" &&
    outcome !== null &&
    flaggedOutcomes.has(outcome)
  );
}

/** Only the states that currently render with no visual distinction from
 * "everything is fine" get a short, distinct alert; the rest fall through. */
function integrityAlertMessage(
  status: SecurityUpdateArtifact["integrityStatus"],
): string | null {
  switch (status) {
    case "hash_mismatch":
      return "Hash mismatch";
    case "type_mismatch":
      return "Content type mismatch";
    case "corrupt":
      return "Artifact corrupt";
    case "unavailable":
      return "Artifact unavailable";
    case "provider_unavailable":
      return "Storage provider unavailable";
    default:
      return null;
  }
}

function formatStatus(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function winningRuleLabel(rule: string): string {
  if (rule === "issued_at_plus_10_calendar_years")
    return "Issued at plus 10 calendar years";
  if (rule === "support_period_end") return "Support period end";
  if (rule === "equal") return "Both candidates equal";
  return formatStatus(rule);
}

/**
 * A reassessment must be able to re-select the release it supersedes even
 * when that release falls outside the page of releases the detail view
 * loaded; missing ids keep a stable fallback label instead of vanishing.
 */
function mergeReleaseOptions(
  releases: readonly ReleaseOption[],
  assessmentReleaseIds: readonly string[],
): readonly ReleaseOption[] {
  const known = new Set(releases.map((release) => release.id));
  const missing = assessmentReleaseIds
    .filter((id) => !known.has(id))
    .map((id) => ({ id, label: "Previously assessed release", version: "" }));
  return [...releases, ...missing];
}

export function productComplianceHeadingId(title: string): string {
  return `product-compliance-${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
}

export function triggerEphemeralDownload(
  download: Readonly<{ downloadUrl: string; fileName: string }>,
): void {
  const anchor = document.createElement("a");
  anchor.href = download.downloadUrl;
  anchor.download = download.fileName;
  anchor.rel = "noreferrer";
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function Section({
  title,
  children,
}: Readonly<{ title: string; children: React.ReactNode }>) {
  return (
    <section
      aria-labelledby={productComplianceHeadingId(title)}
      className="rounded-xl border border-border bg-canvas p-4 sm:p-6"
    >
      <h2
        id={productComplianceHeadingId(title)}
        className="text-title-semibold text-fg"
      >
        {title}
      </h2>
      <div className="mt-4 grid gap-4">{children}</div>
    </section>
  );
}

/** The `support-period-retention-section.tsx` conflict affordance, reused
 * verbatim: a stale write only needs a way back to the latest version. */
function ReloadButton({ onReload }: Readonly<{ onReload: () => void }>) {
  return (
    <Button type="button" variant="outline" tone="grey" onClick={onReload}>
      Reload current data
    </Button>
  );
}

function AssessmentForm({
  productId,
  releases,
  assessment,
  onDone,
  onReload,
}: Readonly<{
  productId: string;
  releases: readonly ReleaseOption[];
  assessment?: SubstantialModificationAssessment;
  onDone?: () => void;
  onReload?: () => void;
}>) {
  const create = useCreateSubstantialModificationAssessmentMutation(productId);
  const saveDraft =
    useCreateSubstantialModificationAssessmentDraftMutation(productId);
  const reassess = useReassessSubstantialModificationAssessmentMutation(
    productId,
    assessment?.id ?? "",
  );
  // The releases query can resolve after this form mounts, so the submitted
  // release is derived: an explicit selection wins, otherwise the first
  // release, otherwise empty (and the parse reports it). Initializing state
  // once from `releases[0]?.id` raced the query and froze an empty selection.
  const [selectedReleaseId, setSelectedReleaseId] = useState<string | null>(
    assessment?.releaseIds[0] ?? null,
  );
  const releaseId =
    selectedReleaseId &&
    releases.some((release) => release.id === selectedReleaseId)
      ? selectedReleaseId
      : (releases[0]?.id ?? "");
  const [answers, setAnswers] = useState<SubstantialModificationAnswers>(
    assessment &&
      Object.values(assessment.answers).every((answer) => answer !== null)
      ? (assessment.answers as SubstantialModificationAnswers)
      : (Object.fromEntries(
          questions.map(([key]) => [key, "unknown"]),
        ) as SubstantialModificationAnswers),
  );
  const [modificationIdentifier, setModificationIdentifier] = useState(
    assessment?.modificationIdentifier ?? "",
  );
  const [title, setTitle] = useState(assessment?.title ?? "");
  const [description, setDescription] = useState(assessment?.description ?? "");
  const [technicalScope, setTechnicalScope] = useState(
    assessment?.technicalScope ?? "",
  );
  const [introducedAt, setIntroducedAt] = useState(
    assessment?.introducedAt ?? "",
  );
  const [detectedOrAssessedAt, setDetectedOrAssessedAt] = useState(
    assessment?.detectedOrAssessedAt ?? "",
  );
  const [previousState, setPreviousState] = useState(
    assessment?.previousState ?? "",
  );
  const [resultingState, setResultingState] = useState(
    assessment?.resultingState ?? "",
  );
  const [followUpActions, setFollowUpActions] = useState(
    assessment?.requiredFollowUpActions?.join("\n") ?? "",
  );
  const [rationale, setRationale] = useState(assessment?.rationale ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [staleUpdate, setStaleUpdate] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setStaleUpdate(false);
    const base = {
      releaseIds: [releaseId],
      modificationIdentifier,
      title,
      description,
      technicalScope,
      introducedAt,
      detectedOrAssessedAt,
      previousState,
      resultingState,
      requiredFollowUpActions: followUpActions
        .split("\n")
        .map((action) => action.trim())
        .filter(Boolean),
      policyVersion: "m2.v2.substantial-modification.v1" as const,
      answers,
      rationale,
      evidenceReferences: [],
      idempotencyKey: idempotencyKey(),
    };
    const parsed =
      createSubstantialModificationAssessmentInputSchema.safeParse(base);
    if (!parsed.success) {
      setMessage(parsed.error.issues[0]?.message ?? "Complete the assessment.");
      return;
    }
    try {
      if (assessment) {
        await reassess.mutateAsync({
          ...parsed.data,
          expectedVersion: assessment.version,
        });
        setMessage("Reassessment submitted for review.");
      } else {
        await create.mutateAsync(parsed.data);
        setMessage("Assessment submitted for review.");
      }
      onDone?.();
    } catch (error) {
      setStaleUpdate(isConflict(error));
      setMessage(errorMessage(error, "The assessment could not be saved."));
    }
  }

  async function saveAssessmentDraft() {
    setMessage(null);
    const parsed =
      createSubstantialModificationAssessmentDraftInputSchema.safeParse({
        releaseIds: releaseId ? [releaseId] : undefined,
        modificationIdentifier: modificationIdentifier || undefined,
        title: title || undefined,
        description: description || undefined,
        technicalScope: technicalScope || undefined,
        introducedAt: introducedAt || undefined,
        detectedOrAssessedAt: detectedOrAssessedAt || undefined,
        previousState: previousState || undefined,
        resultingState: resultingState || undefined,
        requiredFollowUpActions: followUpActions
          .split("\n")
          .map((action) => action.trim())
          .filter(Boolean),
        policyVersion: "m2.v2.substantial-modification.v1",
        completenessState: "in_progress",
        answers,
        rationale: rationale || undefined,
        evidenceReferences: [],
        idempotencyKey: idempotencyKey(),
      });
    if (!parsed.success) {
      setMessage(parsed.error.issues[0]?.message ?? "The draft is invalid.");
      return;
    }
    try {
      await saveDraft.mutateAsync(parsed.data);
      setMessage("Assessment draft saved.");
      onDone?.();
    } catch (error) {
      setMessage(
        errorMessage(error, "The assessment draft could not be saved."),
      );
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="grid gap-3 rounded-xl bg-surface-subtle p-4"
    >
      <h3 className="text-subhead-semibold text-fg">
        {assessment ? "Reassess modification" : "Create assessment"}
      </h3>
      <label className="grid gap-2 text-caption-1-semibold text-fg">
        Affected release
        <select
          aria-label="Affected release"
          className={fieldClassName}
          value={releaseId}
          onChange={(event) => setSelectedReleaseId(event.target.value)}
        >
          {releases.map((release) => (
            <option key={release.id} value={release.id}>
              {release.label} {release.version}
            </option>
          ))}
        </select>
      </label>
      <p role="status" className="text-caption-1-regular text-fg">
        {assessment?.completenessState === "in_progress"
          ? "Assessment in progress"
          : "Draft assessment"}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-2 text-caption-1-semibold text-fg">
          Modification identifier
          <input
            className={fieldClassName}
            value={modificationIdentifier}
            onChange={(event) => setModificationIdentifier(event.target.value)}
          />
        </label>
        <label className="grid gap-2 text-caption-1-semibold text-fg">
          Modification title
          <input
            className={fieldClassName}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="grid gap-2 text-caption-1-semibold text-fg">
          Introduced at (UTC)
          <input
            className={fieldClassName}
            value={introducedAt}
            onChange={(event) => setIntroducedAt(event.target.value)}
          />
        </label>
        <label className="grid gap-2 text-caption-1-semibold text-fg">
          Detected or assessed at (UTC)
          <input
            className={fieldClassName}
            value={detectedOrAssessedAt}
            onChange={(event) => setDetectedOrAssessedAt(event.target.value)}
          />
        </label>
      </div>
      <label className="grid gap-2 text-caption-1-semibold text-fg">
        Modification description
        <textarea
          className="min-h-20 rounded-xl border border-border bg-canvas p-3 text-subhead-regular text-fg"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <label className="grid gap-2 text-caption-1-semibold text-fg">
        Technical scope
        <textarea
          className="min-h-20 rounded-xl border border-border bg-canvas p-3 text-subhead-regular text-fg"
          value={technicalScope}
          onChange={(event) => setTechnicalScope(event.target.value)}
        />
      </label>
      <label className="grid gap-2 text-caption-1-semibold text-fg">
        Previous state
        <textarea
          className="min-h-20 rounded-xl border border-border bg-canvas p-3 text-subhead-regular text-fg"
          value={previousState}
          onChange={(event) => setPreviousState(event.target.value)}
        />
      </label>
      <label className="grid gap-2 text-caption-1-semibold text-fg">
        Resulting state
        <textarea
          className="min-h-20 rounded-xl border border-border bg-canvas p-3 text-subhead-regular text-fg"
          value={resultingState}
          onChange={(event) => setResultingState(event.target.value)}
        />
      </label>
      <label className="grid gap-2 text-caption-1-semibold text-fg">
        Required follow-up actions (one per line)
        <textarea
          className="min-h-20 rounded-xl border border-border bg-canvas p-3 text-subhead-regular text-fg"
          value={followUpActions}
          onChange={(event) => setFollowUpActions(event.target.value)}
        />
      </label>
      <fieldset className="grid gap-3" aria-label="Assessment questions">
        <legend className="text-caption-1-semibold text-fg">
          Assessment questions
        </legend>
        {questions.map(([key, label]) => (
          <label
            key={key}
            className="grid gap-2 text-caption-1-regular text-fg"
          >
            {label}
            <select
              className={fieldClassName}
              value={answers[key]}
              onChange={(event) =>
                setAnswers((current) => ({
                  ...current,
                  [key]: event.target
                    .value as SubstantialModificationAnswers[typeof key],
                }))
              }
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
        ))}
      </fieldset>
      <label className="grid gap-2 text-caption-1-semibold text-fg">
        Assessment rationale
        <textarea
          className="min-h-24 rounded-xl border border-border bg-canvas p-3 text-subhead-regular text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-active-500"
          value={rationale}
          onChange={(event) => setRationale(event.target.value)}
        />
      </label>
      {message ? (
        <p role="status" className="text-caption-1-regular text-fg">
          {message}
        </p>
      ) : null}
      {staleUpdate && onReload ? <ReloadButton onReload={onReload} /> : null}
      <Button
        type="submit"
        loading={create.isPending || reassess.isPending}
        loadingLabel="Saving assessment"
      >
        {assessment ? "Reassess assessment" : "Create assessment"}
      </Button>
      {!assessment ? (
        <Button
          type="button"
          variant="outline"
          tone="grey"
          loading={saveDraft.isPending}
          loadingLabel="Saving draft"
          onClick={() => void saveAssessmentDraft()}
        >
          Save draft
        </Button>
      ) : null}
    </form>
  );
}

function AssessmentHistory({
  productId,
  modificationId,
}: Readonly<{ productId: string; modificationId: string }>) {
  const history = useSubstantialModificationAssessmentHistoryQuery(
    productId,
    modificationId,
    true,
  );
  return (
    <div className="grid gap-2 rounded-xl bg-surface-subtle p-4">
      <h4 className="text-caption-1-semibold text-fg">Assessment history</h4>
      {history.isPending ? (
        <p role="status" className="text-caption-1-regular text-fg-muted">
          Loading history…
        </p>
      ) : history.isError ? (
        <p role="alert" className="text-caption-1-regular text-danger">
          {errorMessage(
            history.error,
            "Assessment history could not be loaded.",
          )}
        </p>
      ) : (
        <ul aria-label="Assessment revisions" className="grid gap-2">
          {(history.data ?? []).map((revision, index) => {
            const previous = (history.data ?? [])[index - 1];
            const changed = new Set(
              questions
                .map(([key]) => key)
                .filter(
                  (key) =>
                    previous !== undefined &&
                    revision.answers[key] !== previous.answers[key],
                ),
            );
            return (
              <li
                key={revision.id}
                className="rounded-lg bg-canvas p-3 text-caption-1-regular text-fg"
              >
                <p className="text-caption-1-semibold text-fg">
                  Revision {index + 1} · {formatStatus(revision.status)}
                  {revision.determination
                    ? ` · ${formatStatus(revision.determination)}`
                    : ""}
                </p>
                {revision.reviewedBy ? (
                  <p className="text-fg-muted">
                    Reviewed by {revision.reviewedBy}
                  </p>
                ) : null}
                <dl className="mt-1 grid gap-1">
                  {questions.map(([key, label]) => (
                    <div
                      key={key}
                      className={
                        changed.has(key)
                          ? "rounded bg-warning-surface px-1 text-warning-fg"
                          : undefined
                      }
                    >
                      <dt className="inline text-fg-muted">{label}: </dt>
                      <dd className="inline">
                        {revision.answers[key] === null
                          ? "Not recorded"
                          : formatStatus(revision.answers[key])}
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function AssessmentRow({
  productId,
  releases,
  assessment,
  canEdit,
  canApprove,
  onReload,
}: Readonly<{
  productId: string;
  releases: readonly ReleaseOption[];
  assessment: SubstantialModificationAssessment;
  canEdit: boolean;
  canApprove: boolean;
  onReload: () => void;
}>) {
  const review = useReviewSubstantialModificationAssessmentMutation(
    productId,
    assessment.id,
  );
  const [showReassess, setShowReassess] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [determination, setDetermination] = useState("potentially_substantial");
  const [rationale, setRationale] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [staleUpdate, setStaleUpdate] = useState(false);
  async function submitReview() {
    setStaleUpdate(false);
    const parsed = reviewSubstantialModificationAssessmentInputSchema.safeParse(
      {
        determination,
        rationale,
        overrideReason: overrideReason || undefined,
        expectedVersion: assessment.version,
        idempotencyKey: idempotencyKey(),
      },
    );
    if (!parsed.success) {
      setMessage(parsed.error.issues[0]?.message ?? "Complete the review.");
      return;
    }
    try {
      await review.mutateAsync(parsed.data);
      setMessage("Assessment review recorded.");
    } catch (error) {
      setStaleUpdate(isConflict(error));
      setMessage(errorMessage(error, "The assessment could not be reviewed."));
    }
  }
  return (
    <li className="grid gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-subhead-semibold text-fg">
          Modification assessment
        </h3>
        <span className="rounded-full bg-surface-muted px-2 py-1 text-caption-1-semibold text-fg">
          {formatStatus(assessment.status)}
        </span>
        {isFlagged(assessment) ? (
          <span
            role="alert"
            className="rounded-full bg-danger-surface px-2 py-1 text-caption-1-semibold text-danger-fg"
          >
            Flagged for conformity follow-up
          </span>
        ) : null}
      </div>
      <p className="text-caption-1-regular text-fg">
        {assessment.modificationIdentifier ?? "Draft modification identifier"}
        {assessment.title ? ` · ${assessment.title}` : ""}
      </p>
      <p role="status" className="text-caption-1-regular text-fg">
        {assessment.completenessState === "draft"
          ? "Draft assessment"
          : assessment.completenessState === "in_progress"
            ? "Assessment in progress"
            : "Complete assessment"}
      </p>
      {assessment.description ? (
        <p className="text-caption-1-regular text-fg">
          {assessment.description}
        </p>
      ) : null}
      {assessment.technicalScope ? (
        <p className="text-caption-1-regular text-fg">
          Technical scope: {assessment.technicalScope}
        </p>
      ) : null}
      {assessment.previousState || assessment.resultingState ? (
        <p className="text-caption-1-regular text-fg">
          Previous state: {assessment.previousState ?? "Not recorded"}.
          Resulting state: {assessment.resultingState ?? "Not recorded"}.
        </p>
      ) : null}
      {assessment.requiredFollowUpActions?.length ? (
        <ul
          aria-label="Required follow-up actions"
          className="list-disc pl-5 text-caption-1-regular text-fg"
        >
          {assessment.requiredFollowUpActions.map((action) => (
            <li key={action}>{action}</li>
          ))}
        </ul>
      ) : null}
      <p className="text-subhead-regular text-fg">
        Policy suggestion:{" "}
        {assessment.suggestion
          ? formatStatus(assessment.suggestion)
          : "Not yet assessed"}
        .
      </p>
      {assessment.status === "submitted_for_review" ? (
        <p role="status" className="text-caption-1-regular text-fg">
          Review required
        </p>
      ) : null}
      {assessment.determination ? (
        <p className="text-caption-1-regular text-fg">
          Authoritative determination: {formatStatus(assessment.determination)}
          {assessment.overrideReason
            ? `. Override reason: ${assessment.overrideReason}`
            : ""}
        </p>
      ) : null}
      <p className="text-caption-1-regular text-fg">{assessment.rationale}</p>
      {canEdit && assessment.status !== "superseded" ? (
        <Button
          type="button"
          variant="outline"
          tone="grey"
          onClick={() => setShowReassess((current) => !current)}
        >
          Reassess assessment
        </Button>
      ) : null}
      {showReassess ? (
        <AssessmentForm
          productId={productId}
          releases={mergeReleaseOptions(releases, assessment.releaseIds)}
          assessment={assessment}
          onReload={onReload}
        />
      ) : null}
      <Button
        type="button"
        variant="outline"
        tone="grey"
        onClick={() => setShowHistory((current) => !current)}
      >
        {showHistory ? "Hide history" : "View history"}
      </Button>
      {showHistory ? (
        <AssessmentHistory
          productId={productId}
          modificationId={assessment.modificationId}
        />
      ) : null}
      {canApprove && assessment.status === "submitted_for_review" ? (
        <div className="grid gap-3 rounded-xl bg-surface-subtle p-4">
          <label className="grid gap-2 text-caption-1-semibold text-fg">
            Authoritative determination
            <select
              className={fieldClassName}
              value={determination}
              onChange={(event) => setDetermination(event.target.value)}
            >
              <option value="substantial">Substantial</option>
              <option value="potentially_substantial">
                Potentially substantial
              </option>
              <option value="not_substantial">Not substantial</option>
              <option value="undetermined">Undetermined</option>
            </select>
          </label>
          <label className="grid gap-2 text-caption-1-semibold text-fg">
            Review rationale
            <textarea
              className="min-h-20 rounded-xl border border-border bg-canvas p-3 text-subhead-regular text-fg"
              value={rationale}
              onChange={(event) => setRationale(event.target.value)}
            />
          </label>
          <label className="grid gap-2 text-caption-1-semibold text-fg">
            Override reason (when different from the policy suggestion)
            <input
              className={fieldClassName}
              value={overrideReason}
              onChange={(event) => setOverrideReason(event.target.value)}
            />
          </label>
          <Button
            type="button"
            onClick={() => void submitReview()}
            loading={review.isPending}
            loadingLabel="Reviewing assessment"
          >
            Review assessment
          </Button>
        </div>
      ) : null}
      {message ? (
        <p role="status" className="text-caption-1-regular text-fg">
          {message}
        </p>
      ) : null}
      {staleUpdate ? <ReloadButton onReload={onReload} /> : null}
    </li>
  );
}

function ArtifactRow({
  productId,
  artifact,
  canEdit,
  canApprove,
  knownArtifactIds,
  onReload,
}: Readonly<{
  productId: string;
  artifact: SecurityUpdateArtifact;
  canEdit: boolean;
  canApprove: boolean;
  knownArtifactIds: ReadonlySet<string>;
  onReload: () => void;
}>) {
  const finalize = useFinalizeSecurityUpdateArtifactMutation(
    productId,
    artifact.id,
  );
  const review = useReviewSecurityUpdateArtifactMutation(
    productId,
    artifact.id,
  );
  const publish = usePublishSecurityUpdateArtifactMutation(
    productId,
    artifact.id,
  );
  const replace = useReplaceSecurityUpdateArtifactMutation(
    productId,
    artifact.id,
  );
  const withdraw = useWithdrawSecurityUpdateArtifactMutation(
    productId,
    artifact.id,
  );
  const [reason, setReason] = useState("");
  const [replacementId, setReplacementId] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [showMetadataForm, setShowMetadataForm] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [staleUpdate, setStaleUpdate] = useState(false);
  const command = async (
    operation: () => Promise<unknown>,
    success: string,
  ) => {
    setStaleUpdate(false);
    try {
      await operation();
      setMessage(success);
    } catch (error) {
      setStaleUpdate(isConflict(error));
      setMessage(
        errorMessage(error, "The artifact action could not be completed."),
      );
    }
  };
  const download = async () => {
    try {
      const response = await productsApi.downloadSecurityUpdateArtifact(
        productId,
        artifact.id,
      );
      triggerEphemeralDownload(response.download);
    } catch (error) {
      setMessage(errorMessage(error, "The artifact could not be downloaded."));
    }
  };
  return (
    <li
      id={`artifact-${artifact.id}`}
      className="grid gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-subhead-semibold text-fg">{artifact.title}</h3>
        <span className="rounded-full bg-surface-muted px-2 py-1 text-caption-1-semibold text-fg">
          {formatStatus(artifact.publicationStatus)}
        </span>
      </div>
      <dl className="grid gap-2 text-caption-1-regular text-fg sm:grid-cols-2">
        <div>
          <dt className="text-fg-muted">SHA-256</dt>
          <dd className="break-all">{artifact.sha256}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Artifact type</dt>
          <dd>{formatStatus(artifact.artifactType)}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Integrity</dt>
          <dd>{formatStatus(artifact.integrityStatus)}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Availability until</dt>
          <dd>
            {artifact.availabilityUntil ??
              (artifact.availabilityStatus === "blocked"
                ? "Availability blocked"
                : "Awaiting publication")}
          </dd>
        </div>
        <div>
          <dt className="text-fg-muted">
            Issued candidate (issue date plus 10 calendar years)
          </dt>
          <dd>{artifact.issuedCandidate ?? "Awaiting publication"}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Support period candidate</dt>
          <dd>{artifact.supportCandidate ?? "Awaiting publication"}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Winning rule</dt>
          <dd>
            {artifact.availabilityWinningRule
              ? `${winningRuleLabel(artifact.availabilityWinningRule)} · ${artifact.availabilityRuleVersion}`
              : "Awaiting publication"}
          </dd>
        </div>
        <div>
          <dt className="text-fg-muted">Distribution</dt>
          <dd>
            {artifact.distributionKind === "external_reference" &&
            artifact.distributionReference ? (
              <>
                Validated external reference ·{" "}
                <span className="break-all">
                  {artifact.distributionReference.title}
                </span>{" "}
                <span className="break-all">
                  ({artifact.distributionReference.uri})
                </span>
              </>
            ) : (
              formatStatus(artifact.distributionKind)
            )}
          </dd>
        </div>
      </dl>
      {artifact.signatureMetadata ? (
        <p className="text-caption-1-regular text-fg">
          Signed with {artifact.signatureMetadata.algorithm} by{" "}
          {artifact.signatureMetadata.signer}
          {artifact.signatureMetadata.certificateSha256
            ? ` (certificate ${artifact.signatureMetadata.certificateSha256})`
            : ""}
          .
        </p>
      ) : null}
      {artifact.nonReductionApplied ? (
        <p role="status" className="text-caption-1-regular text-fg">
          Availability floor preserved: an earlier, longer availability window
          was retained during recalculation.
        </p>
      ) : null}
      {integrityAlertMessage(artifact.integrityStatus) ? (
        <p role="alert" className="text-caption-1-regular text-danger">
          {integrityAlertMessage(artifact.integrityStatus)}
        </p>
      ) : null}
      {artifact.availabilityStatus === "blocked" ? (
        <p role="alert" className="text-caption-1-regular text-danger">
          Availability blocked
        </p>
      ) : null}
      {artifact.statusExplanation ? (
        <p className="text-caption-1-regular text-fg">
          {artifact.statusExplanation.message}
        </p>
      ) : null}
      {artifact.publicationStatus === "replaced" &&
      artifact.replacementArtifactId ? (
        <p className="text-caption-1-regular text-fg">
          Replaced by artifact{" "}
          {knownArtifactIds.has(artifact.replacementArtifactId) ? (
            <a
              href={`#artifact-${artifact.replacementArtifactId}`}
              className="break-all underline"
            >
              {artifact.replacementArtifactId}
            </a>
          ) : (
            <span className="break-all">
              {artifact.replacementArtifactId}
            </span>
          )}
        </p>
      ) : null}
      {canApprove ? (
        <div className="flex flex-wrap gap-2">
          {artifact.distributionKind === "authenticated_download" &&
          artifact.uploadStatus !== "finalized" &&
          artifact.uploadStatus !== "missing" ? (
            <Button
              type="button"
              variant="outline"
              tone="grey"
              onClick={() =>
                void command(
                  () =>
                    finalize.mutateAsync({
                      expectedVersion: artifact.version,
                      idempotencyKey: idempotencyKey(),
                    }),
                  "Finalization requested.",
                )
              }
            >
              Finalize upload
            </Button>
          ) : null}
          {artifact.reviewStatus === "pending_review" &&
          artifact.integrityStatus === "verified" ? (
            <Button
              type="button"
              onClick={() =>
                void command(
                  () =>
                    review.mutateAsync({
                      decision: "clear",
                      reason:
                        reason || "Integrity and quarantine review completed.",
                      expectedVersion: artifact.version,
                      idempotencyKey: idempotencyKey(),
                    }),
                  "Quarantine cleared.",
                )
              }
            >
              Clear quarantine
            </Button>
          ) : null}
          {artifact.reviewStatus === "pending_review" ? (
            <Button
              type="button"
              variant="outline"
              tone="grey"
              onClick={() => setShowRejectForm((current) => !current)}
            >
              Reject artifact
            </Button>
          ) : null}
          {artifact.reviewStatus === "cleared" &&
          artifact.integrityStatus === "verified" &&
          artifact.publicationStatus === "draft" ? (
            <Button
              type="button"
              onClick={() =>
                void command(
                  () =>
                    publish.mutateAsync({
                      expectedVersion: artifact.version,
                      idempotencyKey: idempotencyKey(),
                    }),
                  "Artifact published.",
                )
              }
            >
              Publish artifact
            </Button>
          ) : null}
          {artifact.publicationStatus === "published" ? (
            <Button
              type="button"
              variant="outline"
              tone="grey"
              onClick={() =>
                void command(
                  () =>
                    withdraw.mutateAsync({
                      reason:
                        reason || "Withdrawal requested after replacement.",
                      expectedVersion: artifact.version,
                      idempotencyKey: idempotencyKey(),
                    }),
                  "Artifact withdrawn.",
                )
              }
            >
              Withdraw artifact
            </Button>
          ) : null}
        </div>
      ) : null}
      {canApprove && showRejectForm && artifact.reviewStatus === "pending_review" ? (
        <div className="grid gap-2 rounded-xl bg-surface-subtle p-4">
          <label className="grid gap-1 text-caption-1-semibold text-fg">
            Rejection reason
            <input
              className={fieldClassName}
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
            />
          </label>
          <Button
            type="button"
            variant="outline"
            tone="grey"
            onClick={() =>
              void command(
                () =>
                  review.mutateAsync({
                    decision: "reject",
                    reason: rejectReason || "Quarantine review rejected.",
                    expectedVersion: artifact.version,
                    idempotencyKey: idempotencyKey(),
                  }),
                "Artifact rejected.",
              )
            }
          >
            Confirm rejection
          </Button>
        </div>
      ) : null}
      {artifact.availabilityStatus === "available" ? (
        <Button
          type="button"
          variant="outline"
          tone="grey"
          onClick={() => void download()}
        >
          Download artifact
        </Button>
      ) : null}
      {canEdit && artifact.publicationStatus !== "withdrawn" ? (
        <Button
          type="button"
          variant="outline"
          tone="grey"
          onClick={() => setShowMetadataForm((current) => !current)}
        >
          {showMetadataForm ? "Hide metadata editor" : "Edit metadata"}
        </Button>
      ) : null}
      {showMetadataForm ? (
        <ArtifactMetadataForm
          productId={productId}
          artifact={artifact}
          onReload={onReload}
        />
      ) : null}
      {canApprove && artifact.publicationStatus === "published" ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1 text-caption-1-semibold text-fg">
            Replacement artifact ID
            <input
              className={fieldClassName}
              value={replacementId}
              onChange={(event) => setReplacementId(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-caption-1-semibold text-fg">
            Artifact action reason
            <input
              className={fieldClassName}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <Button
            type="button"
            variant="outline"
            tone="grey"
            onClick={() =>
              void command(
                () =>
                  replace.mutateAsync({
                    replacementArtifactId: replacementId,
                    reason,
                    expectedVersion: artifact.version,
                    idempotencyKey: idempotencyKey(),
                  }),
                "Replacement recorded.",
              )
            }
          >
            Replace artifact
          </Button>
        </div>
      ) : null}
      {message ? (
        <p role="status" className="text-caption-1-regular text-fg">
          {message}
        </p>
      ) : null}
      {staleUpdate ? <ReloadButton onReload={onReload} /> : null}
    </li>
  );
}

function ArtifactMetadataForm({
  productId,
  artifact,
  onDone,
  onReload,
}: Readonly<{
  productId: string;
  artifact: SecurityUpdateArtifact;
  onDone?: () => void;
  onReload: () => void;
}>) {
  const update = useUpdateSecurityUpdateArtifactMetadataMutation(
    productId,
    artifact.id,
  );
  const [title, setTitle] = useState(artifact.title);
  const [supportedPlatform, setSupportedPlatform] = useState(
    artifact.supportedPlatform,
  );
  const [algorithm, setAlgorithm] = useState(
    artifact.signatureMetadata?.algorithm ?? "",
  );
  const [signer, setSigner] = useState(artifact.signatureMetadata?.signer ?? "");
  const [certificateSha256, setCertificateSha256] = useState(
    artifact.signatureMetadata?.certificateSha256 ?? "",
  );
  const [message, setMessage] = useState<string | null>(null);
  const [staleUpdate, setStaleUpdate] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setStaleUpdate(false);
    const parsed = updateSecurityUpdateArtifactMetadataInputSchema.safeParse({
      expectedVersion: artifact.version,
      title,
      supportedPlatform,
      signatureMetadata:
        algorithm || signer
          ? {
              algorithm,
              signer,
              certificateSha256: certificateSha256 || undefined,
            }
          : undefined,
    });
    if (!parsed.success) {
      setMessage(
        parsed.error.issues[0]?.message ?? "Check the artifact metadata.",
      );
      return;
    }
    try {
      await update.mutateAsync(parsed.data);
      setMessage("Artifact metadata updated.");
      onDone?.();
    } catch (error) {
      setStaleUpdate(isConflict(error));
      setMessage(
        errorMessage(error, "The artifact metadata could not be updated."),
      );
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="grid gap-3 rounded-xl bg-surface-subtle p-4"
    >
      <h4 className="text-subhead-semibold text-fg">Edit artifact metadata</h4>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-caption-1-semibold text-fg">
          Updated artifact title
          <input
            className={fieldClassName}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-caption-1-semibold text-fg">
          Updated supported platform
          <input
            className={fieldClassName}
            value={supportedPlatform}
            onChange={(event) => setSupportedPlatform(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-caption-1-semibold text-fg">
          Signature algorithm
          <input
            className={fieldClassName}
            value={algorithm}
            onChange={(event) => setAlgorithm(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-caption-1-semibold text-fg">
          Signer
          <input
            className={fieldClassName}
            value={signer}
            onChange={(event) => setSigner(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-caption-1-semibold text-fg">
          Certificate SHA-256
          <input
            className={fieldClassName}
            value={certificateSha256}
            onChange={(event) => setCertificateSha256(event.target.value)}
          />
        </label>
      </div>
      {message ? (
        <p role="status" className="text-caption-1-regular text-fg">
          {message}
        </p>
      ) : null}
      {staleUpdate ? <ReloadButton onReload={onReload} /> : null}
      <Button
        type="submit"
        loading={update.isPending}
        loadingLabel="Saving artifact metadata"
      >
        Save artifact metadata
      </Button>
    </form>
  );
}

function ArtifactReservationForm({
  productId,
  releases,
}: Readonly<{ productId: string; releases: readonly ReleaseOption[] }>) {
  const reserve = useReserveSecurityUpdateArtifactMutation(productId);
  const finalize = useFinalizeReservedSecurityUpdateArtifactMutation(productId);
  // Same derived-selection rule as the assessment form: the releases query
  // can resolve after mount, so an initialized empty selection must not win.
  const [selectedReleaseId, setSelectedReleaseId] = useState<string | null>(
    null,
  );
  const releaseId =
    selectedReleaseId &&
    releases.some((release) => release.id === selectedReleaseId)
      ? selectedReleaseId
      : (releases[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [sha256, setSha256] = useState("");
  const [title, setTitle] = useState("");
  const [updateVersion, setUpdateVersion] = useState("");
  const [platform, setPlatform] = useState("");
  const [artifactType, setArtifactType] = useState<
    "software_update" | "firmware_update" | "security_advisory"
  >("software_update");
  const [issuedAt, setIssuedAt] = useState(() =>
    // datetime-local holds the user's wall clock; seed it with the local
    // time, not the UTC slice, or an untouched field records a shifted
    // issue instant across timezones.
    new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16),
  );
  const [distributionKind, setDistributionKind] = useState<
    "authenticated_download" | "external_reference"
  >("authenticated_download");
  const [externalTitle, setExternalTitle] = useState("");
  const [externalUri, setExternalUri] = useState("");
  const [externalByteSize, setExternalByteSize] = useState("");
  const [externalContentType, setExternalContentType] = useState(
    "application/octet-stream",
  );
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  async function selectFile(selected: File | null) {
    setFile(selected);
    setSha256("");
    if (!selected) return;
    try {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        await selected.arrayBuffer(),
      );
      setSha256(
        Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join(""),
      );
    } catch {
      // Hashing is a convenience; the field stays editable for manual entry.
    }
  }
  async function reserveAndUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const parsed = reserveSecurityUpdateArtifactInputSchema.safeParse({
      releaseId,
      updateVersion,
      title,
      artifactType,
      supportedPlatform: platform,
      distributionKind,
      externalReferenceCandidates:
        distributionKind === "external_reference"
          ? [
              {
                id: idempotencyKey(),
                title: externalTitle,
                uri: externalUri,
              },
            ]
          : undefined,
      serverValidationRequired:
        distributionKind === "external_reference" ? true : undefined,
      fileName:
        distributionKind === "external_reference"
          ? `${updateVersion || "external-update"}.bin`
          : file?.name,
      contentType:
        distributionKind === "external_reference"
          ? externalContentType
          : file?.type || "application/octet-stream",
      byteSize:
        distributionKind === "external_reference"
          ? Number(externalByteSize)
          : file?.size,
      sha256,
      // An emptied field must reach the schema, not throw here.
      issuedAt: issuedAt ? new Date(issuedAt).toISOString() : "",
      idempotencyKey: idempotencyKey(),
    });
    if (
      !parsed.success ||
      (distributionKind === "authenticated_download" && !file)
    ) {
      setMessage(
        parsed.error?.issues[0]?.message ?? "Choose an artifact file.",
      );
      return;
    }
    try {
      const response = await reserve.mutateAsync(parsed.data);
      if (response.upload === null) {
        setMessage(
          "External reference reserved and queued for server integrity inspection.",
        );
        return;
      }
      if (!file) {
        setMessage("This artifact reservation does not include an upload URL.");
        return;
      }
      setProgress(0);
      await productsApi.uploadReservedSecurityUpdateArtifact(
        response.upload.uploadUrl,
        file,
        setProgress,
      );
      await finalize.mutateAsync({
        artifactId: response.artifact.id,
        input: {
          expectedVersion: response.artifact.version,
          idempotencyKey: idempotencyKey(),
        },
      });
      setProgress(1);
      setMessage("Upload finalized and queued for integrity review.");
    } catch (error) {
      setMessage(
        errorMessage(
          error,
          "The upload failed. Retry the same reservation before it expires.",
        ),
      );
    }
  }
  return (
    <form
      onSubmit={(event) => void reserveAndUpload(event)}
      className="grid gap-3 rounded-xl bg-surface-subtle p-4"
    >
      <h3 className="text-subhead-semibold text-fg">
        Reserve security update artifact
      </h3>
      <label className="grid gap-1 text-caption-1-semibold text-fg">
        Release selector
        <select
          className={fieldClassName}
          value={releaseId}
          onChange={(event) => setSelectedReleaseId(event.target.value)}
        >
          {releases.map((release) => (
            <option key={release.id} value={release.id}>
              {release.label} {release.version}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-caption-1-semibold text-fg">
        Distribution
        <select
          className={fieldClassName}
          value={distributionKind}
          onChange={(event) =>
            setDistributionKind(
              event.target.value as
                "authenticated_download" | "external_reference",
            )
          }
        >
          <option value="authenticated_download">Authenticated download</option>
          <option value="external_reference">
            Validated external reference
          </option>
        </select>
      </label>
      <label className="grid gap-1 text-caption-1-semibold text-fg">
        Artifact type
        <select
          className={fieldClassName}
          value={artifactType}
          onChange={(event) =>
            setArtifactType(
              event.target.value as
                "software_update" | "firmware_update" | "security_advisory",
            )
          }
        >
          <option value="software_update">Software update</option>
          <option value="firmware_update">Firmware update</option>
          <option value="security_advisory">Security advisory</option>
        </select>
      </label>
      {distributionKind === "authenticated_download" ? (
        <label className="grid gap-1 text-caption-1-semibold text-fg">
          Artifact file
          <input
            className={fieldClassName}
            type="file"
            onChange={(event) =>
              void selectFile(event.target.files?.[0] ?? null)
            }
          />
        </label>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-caption-1-semibold text-fg">
            External reference title
            <input
              className={fieldClassName}
              value={externalTitle}
              onChange={(event) => setExternalTitle(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-caption-1-semibold text-fg">
            External reference HTTPS URI
            <input
              className={fieldClassName}
              type="url"
              value={externalUri}
              onChange={(event) => setExternalUri(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-caption-1-semibold text-fg">
            Expected byte size
            <input
              className={fieldClassName}
              inputMode="numeric"
              value={externalByteSize}
              onChange={(event) => setExternalByteSize(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-caption-1-semibold text-fg">
            Expected content type
            <input
              className={fieldClassName}
              value={externalContentType}
              onChange={(event) => setExternalContentType(event.target.value)}
            />
          </label>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-caption-1-semibold text-fg">
          Update version
          <input
            className={fieldClassName}
            value={updateVersion}
            onChange={(event) => setUpdateVersion(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-caption-1-semibold text-fg">
          Artifact title
          <input
            className={fieldClassName}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-caption-1-semibold text-fg">
          Supported platform
          <input
            className={fieldClassName}
            value={platform}
            onChange={(event) => setPlatform(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-caption-1-semibold text-fg">
          SHA-256
          <input
            className={fieldClassName}
            value={sha256}
            onChange={(event) => setSha256(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-caption-1-semibold text-fg">
          Issued at (local time, stored as UTC)
          <input
            className={fieldClassName}
            type="datetime-local"
            value={issuedAt}
            onChange={(event) => setIssuedAt(event.target.value)}
          />
        </label>
      </div>
      {distributionKind === "authenticated_download" ? (
        <p id="sha256-helper" className="text-caption-1-regular text-fg-muted">
          Computed automatically from the selected file; edit only when
          submitting a pre-computed digest.
        </p>
      ) : null}
      {progress !== null ? (
        <p role="status" className="text-caption-1-regular text-fg">
          Upload progress {Math.round(progress * 100)}%
        </p>
      ) : null}
      {message ? (
        <p role="status" className="text-caption-1-regular text-fg">
          {message}
        </p>
      ) : null}
      <Button
        type="submit"
        loading={reserve.isPending}
        loadingLabel="Reserving artifact"
      >
        Reserve security update artifact
      </Button>
    </form>
  );
}

type ReleaseOption = Readonly<{ id: string; label: string; version: string }>;

export function ProductComplianceSections({
  productId,
  releases,
  canEdit,
  canApprove,
  enabled,
}: Readonly<{
  productId: string;
  releases: readonly ReleaseOption[];
  canEdit: boolean;
  canApprove: boolean;
  enabled: boolean;
}>) {
  const [assessmentPage, setAssessmentPage] = useState(1);
  const [artifactPage, setArtifactPage] = useState(1);
  const assessments = useSubstantialModificationAssessmentsQuery(
    productId,
    { page: assessmentPage, pageSize: 15 },
    enabled,
  );
  const artifacts = useSecurityUpdateArtifactsQuery(
    productId,
    { page: artifactPage, pageSize: 15 },
    enabled,
  );
  const knownArtifactIds = new Set(
    (artifacts.data?.artifacts.rows ?? []).map((artifact) => artifact.id),
  );
  return (
    <div className="grid gap-6">
      <Section title="Substantial modifications">
        {assessments.isPending ? (
          <p role="status" className="text-subhead-regular text-fg-muted">
            Loading assessments…
          </p>
        ) : assessments.isError ? (
          <p role="alert" className="text-subhead-regular text-danger">
            {errorMessage(
              assessments.error,
              "Assessments could not be loaded.",
            )}
          </p>
        ) : assessments.data?.assessments.rows.length === 0 ? (
          <p className="text-subhead-regular text-fg">
            No substantial modification assessments have been recorded.
          </p>
        ) : (
          <ul className="grid gap-4">
            {assessments.data?.assessments.rows.map((assessment) => (
              <AssessmentRow
                key={assessment.id}
                productId={productId}
                releases={releases}
                assessment={assessment}
                canEdit={canEdit}
                canApprove={canApprove}
                onReload={() => void assessments.refetch()}
              />
            ))}
          </ul>
        )}
        {(assessments.data?.assessments.pageCount ?? 1) > 1 ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              tone="grey"
              disabled={
                Math.min(
                  assessmentPage,
                  assessments.data?.assessments.pageCount ?? 1,
                ) <= 1
              }
              onClick={() => setAssessmentPage((page) => page - 1)}
            >
              Previous assessments
            </Button>
            <p className="text-caption-1-regular text-fg">
              Page{" "}
              {Math.min(
                assessmentPage,
                assessments.data?.assessments.pageCount ?? 1,
              )}{" "}
              of {assessments.data?.assessments.pageCount}
            </p>
            <Button
              type="button"
              variant="outline"
              tone="grey"
              disabled={
                Math.min(
                  assessmentPage,
                  assessments.data?.assessments.pageCount ?? 1,
                ) >= (assessments.data?.assessments.pageCount ?? 1)
              }
              onClick={() => setAssessmentPage((page) => page + 1)}
            >
              Next assessments
            </Button>
          </div>
        ) : null}
        {canEdit ? (
          <AssessmentForm
            productId={productId}
            releases={releases}
            onReload={() => void assessments.refetch()}
          />
        ) : null}
      </Section>
      <Section title="Security update artifacts">
        {artifacts.isPending ? (
          <p role="status" className="text-subhead-regular text-fg-muted">
            Loading security update artifacts…
          </p>
        ) : artifacts.isError ? (
          <p role="alert" className="text-subhead-regular text-danger">
            {errorMessage(
              artifacts.error,
              "Security update artifacts could not be loaded.",
            )}
          </p>
        ) : artifacts.data?.artifacts.rows.length === 0 ? (
          <p className="text-subhead-regular text-fg">
            No security update artifacts have been recorded.
          </p>
        ) : (
          <ul className="grid gap-4">
            {artifacts.data?.artifacts.rows.map((artifact) => (
              <ArtifactRow
                key={artifact.id}
                productId={productId}
                artifact={artifact}
                canEdit={canEdit}
                canApprove={canApprove}
                knownArtifactIds={knownArtifactIds}
                onReload={() => void artifacts.refetch()}
              />
            ))}
          </ul>
        )}
        {(artifacts.data?.artifacts.pageCount ?? 1) > 1 ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              tone="grey"
              disabled={
                Math.min(
                  artifactPage,
                  artifacts.data?.artifacts.pageCount ?? 1,
                ) <= 1
              }
              onClick={() => setArtifactPage((page) => page - 1)}
            >
              Previous artifacts
            </Button>
            <p className="text-caption-1-regular text-fg">
              Page{" "}
              {Math.min(artifactPage, artifacts.data?.artifacts.pageCount ?? 1)}{" "}
              of {artifacts.data?.artifacts.pageCount}
            </p>
            <Button
              type="button"
              variant="outline"
              tone="grey"
              disabled={
                Math.min(
                  artifactPage,
                  artifacts.data?.artifacts.pageCount ?? 1,
                ) >= (artifacts.data?.artifacts.pageCount ?? 1)
              }
              onClick={() => setArtifactPage((page) => page + 1)}
            >
              Next artifacts
            </Button>
          </div>
        ) : null}
        {canEdit ? (
          <ArtifactReservationForm productId={productId} releases={releases} />
        ) : null}
      </Section>
    </div>
  );
}
