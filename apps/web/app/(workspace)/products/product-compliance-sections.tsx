"use client";

import {
  createSubstantialModificationAssessmentDraftInputSchema,
  createSubstantialModificationAssessmentInputSchema,
  reserveSecurityUpdateArtifactInputSchema,
  reviewSubstantialModificationAssessmentInputSchema,
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
  useSubstantialModificationAssessmentsQuery,
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

function formatStatus(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
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

function AssessmentForm({
  productId,
  releases,
  assessment,
  onDone,
}: Readonly<{
  productId: string;
  releases: readonly ReleaseOption[];
  assessment?: SubstantialModificationAssessment;
  onDone?: () => void;
}>) {
  const create = useCreateSubstantialModificationAssessmentMutation(productId);
  const saveDraft =
    useCreateSubstantialModificationAssessmentDraftMutation(productId);
  const reassess = useReassessSubstantialModificationAssessmentMutation(
    productId,
    assessment?.id ?? "",
  );
  const [releaseId, setReleaseId] = useState(
    assessment?.releaseIds[0] ?? releases[0]?.id ?? "",
  );
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

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
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
          onChange={(event) => setReleaseId(event.target.value)}
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

function AssessmentRow({
  productId,
  assessment,
  canEdit,
  canApprove,
}: Readonly<{
  productId: string;
  assessment: SubstantialModificationAssessment;
  canEdit: boolean;
  canApprove: boolean;
}>) {
  const review = useReviewSubstantialModificationAssessmentMutation(
    productId,
    assessment.id,
  );
  const [showReassess, setShowReassess] = useState(false);
  const [determination, setDetermination] = useState("potentially_substantial");
  const [rationale, setRationale] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  async function submitReview() {
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
          releases={assessment.releaseIds.map((id) => ({
            id,
            label: "Selected release",
            version: "",
          }))}
          assessment={assessment}
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
    </li>
  );
}

function ArtifactRow({
  productId,
  artifact,
  canApprove,
}: Readonly<{
  productId: string;
  artifact: SecurityUpdateArtifact;
  canApprove: boolean;
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
  const [message, setMessage] = useState<string | null>(null);
  const command = async (
    operation: () => Promise<unknown>,
    success: string,
  ) => {
    try {
      await operation();
      setMessage(success);
    } catch (error) {
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
    <li className="grid gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
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
          <dt className="text-fg-muted">Integrity</dt>
          <dd>{formatStatus(artifact.integrityStatus)}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Availability rule</dt>
          <dd>{artifact.availabilityRuleVersion}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Availability candidate</dt>
          <dd>{artifact.availabilityUntil ?? "Availability blocked"}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Distribution</dt>
          <dd>{formatStatus(artifact.distributionKind)}</dd>
        </div>
      </dl>
      {artifact.integrityStatus === "hash_mismatch" ? (
        <p role="alert" className="text-caption-1-regular text-danger">
          Hash mismatch
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
      {canApprove ? (
        <div className="flex flex-wrap gap-2">
          {artifact.distributionKind === "authenticated_download" ? (
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
          {artifact.reviewStatus === "cleared" &&
          artifact.integrityStatus === "verified" ? (
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
          <Button
            type="button"
            variant="outline"
            tone="grey"
            onClick={() =>
              void command(
                () =>
                  withdraw.mutateAsync({
                    reason: reason || "Withdrawal requested after replacement.",
                    expectedVersion: artifact.version,
                    idempotencyKey: idempotencyKey(),
                  }),
                "Artifact withdrawn.",
              )
            }
          >
            Withdraw artifact
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
      {canApprove ? (
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
    </li>
  );
}

function ArtifactReservationForm({
  productId,
  releases,
}: Readonly<{ productId: string; releases: readonly ReleaseOption[] }>) {
  const reserve = useReserveSecurityUpdateArtifactMutation(productId);
  const finalize = useFinalizeReservedSecurityUpdateArtifactMutation(productId);
  const [releaseId, setReleaseId] = useState(releases[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [sha256, setSha256] = useState("");
  const [title, setTitle] = useState("");
  const [updateVersion, setUpdateVersion] = useState("");
  const [platform, setPlatform] = useState("");
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
  async function reserveAndUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const parsed = reserveSecurityUpdateArtifactInputSchema.safeParse({
      releaseId,
      updateVersion,
      title,
      artifactType: "software_update",
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
      issuedAt: new Date().toISOString(),
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
          onChange={(event) => setReleaseId(event.target.value)}
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
      {distributionKind === "authenticated_download" ? (
        <label className="grid gap-1 text-caption-1-semibold text-fg">
          Artifact file
          <input
            className={fieldClassName}
            type="file"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
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
      </div>
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
  const assessments = useSubstantialModificationAssessmentsQuery(
    productId,
    { page: 1, pageSize: 15 },
    enabled,
  );
  const artifacts = useSecurityUpdateArtifactsQuery(
    productId,
    { page: 1, pageSize: 15 },
    enabled,
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
            Assessments could not be loaded.
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
                assessment={assessment}
                canEdit={canEdit}
                canApprove={canApprove}
              />
            ))}
          </ul>
        )}
        {canEdit ? (
          <AssessmentForm productId={productId} releases={releases} />
        ) : null}
      </Section>
      <Section title="Security update artifacts">
        {artifacts.isPending ? (
          <p role="status" className="text-subhead-regular text-fg-muted">
            Loading security update artifacts…
          </p>
        ) : artifacts.isError ? (
          <p role="alert" className="text-subhead-regular text-danger">
            Security update artifacts could not be loaded.
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
                canApprove={canApprove}
              />
            ))}
          </ul>
        )}
        {canEdit ? (
          <ArtifactReservationForm productId={productId} releases={releases} />
        ) : null}
      </Section>
    </div>
  );
}
