"use client";

import {
  calculateRiskLevel,
  type CreateRiskRegisterRiskRequest,
  type RiskRegisterRisk,
} from "@repo/contracts/risk-registers";
import { Button } from "@repo/ui/button";
import { useEffect, useMemo, useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import { useSession } from "../../_providers/session-provider";
import { SectionCard } from "../../dashboard/_components/dashboard-chrome";
import {
  useAcceptResidualRiskMutation,
  useArchiveRiskMutation,
  useCreateRiskMutation,
  useRiskRegisterQuery,
  useUpdateRiskMutation,
} from "./risk-register.queries";

type AssessmentDraft = Readonly<{
  likelihood: string;
  impact: string;
  likelihoodRationale: string;
  impactRationale: string;
}>;

type RiskDraft = Readonly<{
  threat: string;
  componentIds: string;
  requirements: RequirementDraft[];
  inherent: AssessmentDraft;
  mitigations: string;
  residual: AssessmentDraft;
  revisionRationale: string;
  ownerId: string;
  evidenceReferences: EvidenceDraft[];
}>;

type RequirementDraft = Readonly<{
  identifier: string;
  edition: string;
  sourceReference: string;
  rationale: string;
}>;

type EvidenceDraft = Readonly<{
  title: string;
  recordId: string | null;
  observedRevision: string | null;
  locator: string;
  rationale: string;
}>;

const emptyAssessment = (): AssessmentDraft => ({
  likelihood: "",
  impact: "",
  likelihoodRationale: "",
  impactRationale: "",
});
const emptyRequirement = (): RequirementDraft => ({
  identifier: "",
  edition: "",
  sourceReference: "",
  rationale: "",
});
const emptyManualEvidence = (): EvidenceDraft => ({
  title: "",
  recordId: null,
  observedRevision: null,
  locator: "",
  rationale: "",
});
const emptyDraft = (ownerId = ""): RiskDraft => ({
  threat: "",
  componentIds: "",
  requirements: [emptyRequirement()],
  inherent: emptyAssessment(),
  mitigations: "",
  residual: emptyAssessment(),
  revisionRationale: "",
  ownerId,
  evidenceReferences: [],
});

function requestId(): string {
  return crypto.randomUUID();
}

function friendlyError(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError && error.status === 403)
    return "You no longer have permission to change this risk register.";
  if (error instanceof ApiClientError && error.status === 409)
    return "This risk changed elsewhere. Your draft is still here; reload the latest record before retrying.";
  if (
    error instanceof ApiClientError &&
    (error.kind === "network" ||
      error.kind === "invalid_response" ||
      (error.status ?? 0) >= 500)
  )
    return "The risk register is temporarily unavailable. Your entered work has not been discarded; try again when the connection is restored.";
  return error instanceof ApiClientError ? error.message : fallback;
}

function assessmentFrom(
  value: RiskRegisterRisk["currentRevision"]["inherentAssessment"],
): AssessmentDraft {
  return {
    likelihood: String(value.likelihood),
    impact: String(value.impact),
    likelihoodRationale: value.likelihoodRationale,
    impactRationale: value.impactRationale,
  };
}

function draftFromRisk(risk: RiskRegisterRisk): RiskDraft {
  const revision = risk.currentRevision;
  return {
    threat: revision.threat,
    componentIds: revision.affectedAssets
      .map((item) => item.componentId)
      .join("\n"),
    requirements:
      revision.requirements.length > 0
        ? revision.requirements.map((requirement) => ({
            identifier: requirement.identifier,
            edition: requirement.edition,
            sourceReference: requirement.sourceReference,
            rationale: requirement.rationale,
          }))
        : [emptyRequirement()],
    inherent: assessmentFrom(revision.inherentAssessment),
    mitigations: revision.mitigations,
    residual: assessmentFrom(revision.residualAssessment),
    revisionRationale: revision.revisionRationale,
    ownerId: revision.ownerId,
    evidenceReferences: revision.evidenceReferences.map((reference) => ({
      title: reference.title,
      recordId: reference.recordId,
      observedRevision: reference.observedRevision,
      locator: reference.locator ?? "",
      rationale: reference.rationale,
    })),
  };
}

function parseAssessment(value: AssessmentDraft) {
  const likelihood = Number(value.likelihood);
  const impact = Number(value.impact);
  if (
    !Number.isInteger(likelihood) ||
    likelihood < 1 ||
    likelihood > 5 ||
    !Number.isInteger(impact) ||
    impact < 1 ||
    impact > 5 ||
    value.likelihoodRationale.trim() === "" ||
    value.impactRationale.trim() === ""
  )
    return null;
  return {
    likelihood,
    impact,
    likelihoodRationale: value.likelihoodRationale.trim(),
    impactRationale: value.impactRationale.trim(),
  };
}

function levelLabel(assessment: AssessmentDraft): string {
  const parsed = parseAssessment(assessment);
  return parsed
    ? calculateRiskLevel(parsed.likelihood, parsed.impact)
    : "not assessed";
}

function statusLabel(status: string): string {
  return status.replaceAll("_", " ");
}

function replaceAt<T>(
  values: readonly T[],
  index: number,
  next: T,
): T[] {
  return values.map((value, candidate) => (candidate === index ? next : value));
}

function AssessmentFields({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: AssessmentDraft;
  onChange: (next: AssessmentDraft) => void;
  disabled: boolean;
}) {
  return (
    <fieldset
      disabled={disabled}
      className="grid gap-3 rounded-xl border border-border bg-surface-subtle p-4"
    >
      <legend className="px-1 text-subhead-semibold text-fg">{label}</legend>
      <p className="text-caption-1-regular text-fg-muted">
        Method: likelihood × impact. Current level:{" "}
        <span className="font-semibold text-fg">{levelLabel(value)}</span>.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
          Likelihood (1–5)
          <select
            value={value.likelihood}
            required
            onChange={(event) =>
              onChange({ ...value, likelihood: event.target.value })
            }
            className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <option value="">Select likelihood</option>
            {[1, 2, 3, 4, 5].map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
          Impact (1–5)
          <select
            value={value.impact}
            required
            onChange={(event) =>
              onChange({ ...value, impact: event.target.value })
            }
            className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <option value="">Select impact</option>
            {[1, 2, 3, 4, 5].map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
        Likelihood rationale
        <textarea
          value={value.likelihoodRationale}
          required
          maxLength={4_000}
          rows={3}
          onChange={(event) =>
            onChange({ ...value, likelihoodRationale: event.target.value })
          }
          className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
        />
      </label>
      <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
        Impact rationale
        <textarea
          value={value.impactRationale}
          required
          maxLength={4_000}
          rows={3}
          onChange={(event) =>
            onChange({ ...value, impactRationale: event.target.value })
          }
          className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
        />
      </label>
    </fieldset>
  );
}

function RiskEditor({
  productId,
  risk,
  canEdit,
  onClose,
}: {
  productId: string;
  risk: RiskRegisterRisk | null;
  canEdit: boolean;
  onClose: () => void;
}) {
  const { session, role } = useSession();
  const canAccept = role === "owner" || role === "admin";
  const create = useCreateRiskMutation(productId);
  const update = useUpdateRiskMutation(productId, risk?.id ?? "");
  const accept = useAcceptResidualRiskMutation(productId, risk?.id ?? "");
  const archive = useArchiveRiskMutation(productId, risk?.id ?? "");
  const [draft, setDraft] = useState<RiskDraft>(() =>
    risk ? draftFromRisk(risk) : emptyDraft(session?.user.id),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [acceptanceRationale, setAcceptanceRationale] = useState("");
  const [archiveRationale, setArchiveRationale] = useState("");
  useEffect(() => {
    setDraft(risk ? draftFromRisk(risk) : emptyDraft(session?.user.id));
    setMessage(null);
  }, [risk, session?.user.id]);
  const working =
    create.isPending ||
    update.isPending ||
    accept.isPending ||
    archive.isPending;
  const editable = canEdit && risk?.status !== "archived";

  const input = useMemo((): Omit<
    CreateRiskRegisterRiskRequest,
    "idempotencyKey"
  > | null => {
    const inherentAssessment = parseAssessment(draft.inherent);
    const residualAssessment = parseAssessment(draft.residual);
    const componentIds = [
      ...new Set(draft.componentIds.split(/\s+/).filter(Boolean)),
    ];
    const requirements = draft.requirements.map((requirement) => ({
      identifier: requirement.identifier.trim(),
      edition: requirement.edition.trim(),
      sourceReference: requirement.sourceReference.trim(),
      rationale: requirement.rationale.trim(),
    }));
    const evidenceReferences = draft.evidenceReferences.map((reference) => ({
      title: reference.title.trim(),
      recordId: reference.recordId,
      observedRevision: reference.observedRevision,
      locator: reference.locator.trim() || null,
      rationale: reference.rationale.trim(),
    }));
    if (
      !inherentAssessment ||
      !residualAssessment ||
      !draft.threat.trim() ||
      componentIds.length === 0 ||
      requirements.length === 0 ||
      requirements.some(
        (requirement) =>
          !requirement.identifier ||
          !requirement.edition ||
          !requirement.sourceReference ||
          !requirement.rationale,
      ) ||
      evidenceReferences.some(
        (reference) =>
          !reference.title ||
          !reference.rationale ||
          (reference.recordId === null) !== (reference.observedRevision === null),
      ) ||
      !draft.mitigations.trim() ||
      !draft.revisionRationale.trim() ||
      !draft.ownerId.trim()
    )
      return null;
    return {
      threat: draft.threat.trim(),
      affectedAssets: componentIds.map((componentId) => ({ componentId })),
      requirements,
      inherentAssessment,
      mitigations: draft.mitigations.trim(),
      residualAssessment,
      revisionRationale: draft.revisionRationale.trim(),
      ownerId: draft.ownerId.trim(),
      evidenceReferences,
    };
  }, [draft]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (!input) {
      setMessage(
        "Complete every required risk field, including both assessments and rationales.",
      );
      return;
    }
    try {
      if (risk)
        await update.mutateAsync({
          ...input,
          expectedVersion: risk.version,
          idempotencyKey: requestId(),
        });
      else await create.mutateAsync({ ...input, idempotencyKey: requestId() });
      setMessage(risk ? "Risk revision saved." : "Risk created.");
    } catch (error) {
      setMessage(friendlyError(error, "The risk could not be saved."));
    }
  }
  async function acceptResidualRisk(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (!risk || acceptanceRationale.trim() === "") {
      setMessage("Provide a rationale before accepting residual risk.");
      return;
    }
    try {
      await accept.mutateAsync({
        expectedVersion: risk.version,
        acceptanceRationale: acceptanceRationale.trim(),
        idempotencyKey: requestId(),
      });
      setAcceptanceRationale("");
      setMessage("Residual-risk acceptance recorded.");
    } catch (error) {
      setMessage(friendlyError(error, "Residual risk could not be accepted."));
    }
  }
  async function archiveRisk(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (!risk || archiveRationale.trim() === "") {
      setMessage("Provide an archival rationale before archiving this risk.");
      return;
    }
    try {
      await archive.mutateAsync({
        expectedVersion: risk.version,
        archiveRationale: archiveRationale.trim(),
        idempotencyKey: requestId(),
      });
      setMessage("Risk archived. Its prior revisions remain preserved.");
    } catch (error) {
      setMessage(friendlyError(error, "The risk could not be archived."));
    }
  }

  return (
    <SectionCard
      title={risk ? "Risk detail" : "Create cybersecurity risk"}
      action={
        <Button type="button" variant="outline" tone="grey" onClick={onClose}>
          Back to register
        </Button>
      }
    >
      <div className="flex flex-col gap-6">
        {message ? (
          <p
            role={
              message.includes("permission") || message.includes("Complete")
                ? "alert"
                : "status"
            }
            aria-live="polite"
            className="text-subhead-regular text-fg-muted"
          >
            {message}
          </p>
        ) : null}
        {risk ? (
          <div className="rounded-xl border border-border bg-surface-subtle p-4 text-subhead-regular text-fg">
            <p>
              Status:{" "}
              <span className="font-semibold">{statusLabel(risk.status)}</span>{" "}
              · Revision {risk.currentRevision.revision}
            </p>
            <p className="mt-1 text-caption-1-regular text-fg-muted">
              Initial assessment and prior revisions are retained. Requirement
              mappings are unresolved until M10 supplies an authoritative pack.
            </p>
          </div>
        ) : null}
        <form onSubmit={save} className="flex flex-col gap-4" noValidate>
          <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
            Threat
            <textarea
              value={draft.threat}
              disabled={!editable || working}
              onChange={(event) =>
                setDraft({ ...draft, threat: event.target.value })
              }
              required
              maxLength={4_000}
              rows={4}
              className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
            />
          </label>
          <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
            Affected SBOM component IDs
            <textarea
              value={draft.componentIds}
              disabled={!editable || working}
              onChange={(event) =>
                setDraft({ ...draft, componentIds: event.target.value })
              }
              required
              rows={3}
              className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
              aria-describedby="risk-component-help"
            />
          </label>
          <p
            id="risk-component-help"
            className="text-caption-1-regular text-fg-muted"
          >
            Use a component from a completed SBOM for this active product
            release. The service verifies ownership and availability.
          </p>
          <div className="grid gap-3 rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-h5 text-fg">Annex I Part I mappings</h2>
                <p className="mt-1 text-caption-1-regular text-fg-muted">
                  Manual V1 mappings stay unresolved until M10 provides an
                  authoritative framework pack.
                </p>
              </div>
              {editable ? (
                <Button
                  type="button"
                  variant="outline"
                  tone="grey"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      requirements: [
                        ...draft.requirements,
                        emptyRequirement(),
                      ],
                    })
                  }
                >
                  Add mapping
                </Button>
              ) : null}
            </div>
            {draft.requirements.map((requirement, index) => (
              <div
                key={index}
                className="grid gap-3 rounded-xl border border-border bg-surface-subtle p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-caption-1-semibold text-fg">
                    Mapping {index + 1}
                  </p>
                  {editable && draft.requirements.length > 1 ? (
                    <Button
                      type="button"
                      variant="outline"
                      tone="grey"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          requirements: draft.requirements.filter(
                            (_, candidate) => candidate !== index,
                          ),
                        })
                      }
                    >
                      Remove mapping
                    </Button>
                  ) : null}
                </div>
                <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
                  Identifier
                  <input
                    value={requirement.identifier}
                    disabled={!editable || working}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        requirements: replaceAt(draft.requirements, index, {
                          ...requirement,
                          identifier: event.target.value,
                        }),
                      })
                    }
                    required
                    maxLength={200}
                    className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  />
                </label>
                <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
                  Edition
                  <input
                    value={requirement.edition}
                    disabled={!editable || working}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        requirements: replaceAt(draft.requirements, index, {
                          ...requirement,
                          edition: event.target.value,
                        }),
                      })
                    }
                    required
                    maxLength={200}
                    className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  />
                </label>
                <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
                  Source reference
                  <textarea
                    value={requirement.sourceReference}
                    disabled={!editable || working}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        requirements: replaceAt(draft.requirements, index, {
                          ...requirement,
                          sourceReference: event.target.value,
                        }),
                      })
                    }
                    required
                    maxLength={2_000}
                    rows={2}
                    className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  />
                </label>
                <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
                  Mapping rationale
                  <textarea
                    value={requirement.rationale}
                    disabled={!editable || working}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        requirements: replaceAt(draft.requirements, index, {
                          ...requirement,
                          rationale: event.target.value,
                        }),
                      })
                    }
                    required
                    maxLength={4_000}
                    rows={3}
                    className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  />
                </label>
              </div>
            ))}
          </div>
          <div className="grid gap-3 rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-h5 text-fg">Evidence references</h2>
                <p className="mt-1 text-caption-1-regular text-fg-muted">
                  Manual bibliographic references are allowed in V1. M7-03
                  source readiness is available; M8 attachment versions remain
                  unavailable.
                </p>
              </div>
              {editable ? (
                <Button
                  type="button"
                  variant="outline"
                  tone="grey"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      evidenceReferences: [
                        ...draft.evidenceReferences,
                        emptyManualEvidence(),
                      ],
                    })
                  }
                >
                  Add evidence reference
                </Button>
              ) : null}
            </div>
            {draft.evidenceReferences.length === 0 ? (
              <p className="rounded-xl border border-border bg-surface-subtle p-3 text-caption-1-regular text-fg-muted">
                No evidence references are linked to this revision yet.
              </p>
            ) : (
              draft.evidenceReferences.map((reference, index) => (
                <div
                  key={index}
                  className="grid gap-3 rounded-xl border border-border bg-surface-subtle p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-caption-1-semibold text-fg">
                      Evidence {index + 1}
                      {reference.recordId ? " · technical-file source" : ""}
                    </p>
                    {editable ? (
                      <Button
                        type="button"
                        variant="outline"
                        tone="grey"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            evidenceReferences:
                              draft.evidenceReferences.filter(
                                (_, candidate) => candidate !== index,
                              ),
                          })
                        }
                      >
                        Remove evidence
                      </Button>
                    ) : null}
                  </div>
                  <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
                    Title
                    <input
                      value={reference.title}
                      disabled={!editable || working}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          evidenceReferences: replaceAt(
                            draft.evidenceReferences,
                            index,
                            { ...reference, title: event.target.value },
                          ),
                        })
                      }
                      required
                      maxLength={500}
                      className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
                    Locator
                    <input
                      value={reference.locator}
                      disabled={!editable || working}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          evidenceReferences: replaceAt(
                            draft.evidenceReferences,
                            index,
                            { ...reference, locator: event.target.value },
                          ),
                        })
                      }
                      maxLength={2_000}
                      className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
                    Evidence rationale
                    <textarea
                      value={reference.rationale}
                      disabled={!editable || working}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          evidenceReferences: replaceAt(
                            draft.evidenceReferences,
                            index,
                            { ...reference, rationale: event.target.value },
                          ),
                        })
                      }
                      required
                      maxLength={4_000}
                      rows={3}
                      className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    />
                  </label>
                </div>
              ))
            )}
          </div>
          <AssessmentFields
            label="Initial assessment"
            value={draft.inherent}
            disabled={!editable || working}
            onChange={(inherent) => setDraft({ ...draft, inherent })}
          />
          <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
            Mitigations
            <textarea
              value={draft.mitigations}
              disabled={!editable || working}
              onChange={(event) =>
                setDraft({ ...draft, mitigations: event.target.value })
              }
              required
              maxLength={12_000}
              rows={5}
              className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
            />
          </label>
          <AssessmentFields
            label="Residual assessment"
            value={draft.residual}
            disabled={!editable || working}
            onChange={(residual) => setDraft({ ...draft, residual })}
          />
          <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
            Revision rationale
            <textarea
              value={draft.revisionRationale}
              disabled={!editable || working}
              onChange={(event) =>
                setDraft({ ...draft, revisionRationale: event.target.value })
              }
              required
              maxLength={4_000}
              rows={3}
              className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
            />
          </label>
          <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
            Risk owner user ID
            <input
              value={draft.ownerId}
              disabled={!editable || working}
              onChange={(event) =>
                setDraft({ ...draft, ownerId: event.target.value })
              }
              required
              className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
            />
          </label>
          {editable ? (
            <div>
              <Button
                type="submit"
                loading={create.isPending || update.isPending}
                loadingLabel="Saving risk"
              >
                {risk ? "Save risk revision" : "Create risk"}
              </Button>
            </div>
          ) : null}
        </form>
        {risk &&
        canAccept &&
        risk.status !== "archived" &&
        risk.residualRiskAcceptance === null ? (
          <form
            onSubmit={acceptResidualRisk}
            className="border-t border-border pt-6"
          >
            <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
              Residual-risk acceptance rationale
              <textarea
                value={acceptanceRationale}
                disabled={working}
                onChange={(event) => setAcceptanceRationale(event.target.value)}
                required
                maxLength={4_000}
                rows={3}
                className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
              />
            </label>
            <div className="mt-3">
              <Button
                type="submit"
                variant="outline"
                tone="grey"
                loading={accept.isPending}
                loadingLabel="Recording acceptance"
              >
                Accept residual risk
              </Button>
            </div>
          </form>
        ) : null}
        {risk?.residualRiskAcceptance ? (
          <p className="rounded-xl border border-border bg-surface-subtle p-3 text-subhead-regular text-fg">
            Residual risk explicitly accepted for revision{" "}
            {risk.residualRiskAcceptance.revision}.
          </p>
        ) : null}
        {risk && editable ? (
          <form onSubmit={archiveRisk} className="border-t border-border pt-6">
            <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
              Archive rationale
              <textarea
                value={archiveRationale}
                disabled={working}
                onChange={(event) => setArchiveRationale(event.target.value)}
                required
                maxLength={4_000}
                rows={3}
                className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
              />
            </label>
            <div className="mt-3">
              <Button
                type="submit"
                variant="outline"
                tone="grey"
                loading={archive.isPending}
                loadingLabel="Archiving risk"
              >
                Archive risk
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </SectionCard>
  );
}

export function RiskRegisterWorkspace({
  productId,
  enabled,
  canEdit,
}: {
  productId: string;
  enabled: boolean;
  canEdit: boolean;
}) {
  const query = useRiskRegisterQuery(productId, enabled);
  const [selected, setSelected] = useState<RiskRegisterRisk | null | "create">(
    null,
  );
  if (!enabled) return null;
  if (selected === "create")
    return (
      <RiskEditor
        productId={productId}
        risk={null}
        canEdit={canEdit}
        onClose={() => setSelected(null)}
      />
    );
  if (selected)
    return (
      <RiskEditor
        productId={productId}
        risk={selected}
        canEdit={canEdit}
        onClose={() => setSelected(null)}
      />
    );
  if (query.isPending)
    return (
      <SectionCard title="Cybersecurity risk register">
        <p role="status" className="text-subhead-regular text-fg-muted">
          Loading risk register…
        </p>
      </SectionCard>
    );
  if (query.isError)
    return (
      <SectionCard title="Cybersecurity risk register">
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <p className="text-subhead-regular text-danger">
            {friendlyError(
              query.error,
              "The risk register could not be loaded.",
            )}
          </p>
          <Button
            type="button"
            variant="outline"
            tone="grey"
            onClick={() => void query.refetch()}
          >
            Try again
          </Button>
        </div>
      </SectionCard>
    );
  const risks = query.data?.riskRegister?.risks ?? [];
  return (
    <SectionCard
      title="Cybersecurity risk register"
      action={
        canEdit ? (
          <Button type="button" onClick={() => setSelected("create")}>
            Create risk
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-subhead-regular text-fg-muted">
          Pinned method: CRA 5×5 v1. This is a risk method, not a compliance
          score.
        </p>
        {risks.length === 0 ? (
          <p className="rounded-xl border border-border bg-surface-subtle p-4 text-subhead-regular text-fg-muted">
            No cybersecurity risks have been recorded for this technical file.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left">
              <caption className="sr-only">
                Cybersecurity risks for this technical file
              </caption>
              <thead>
                <tr className="text-caption-1-semibold text-fg-muted">
                  <th className="border-b border-border px-3 py-2">Threat</th>
                  <th className="border-b border-border px-3 py-2">State</th>
                  <th className="border-b border-border px-3 py-2">Initial</th>
                  <th className="border-b border-border px-3 py-2">Residual</th>
                  <th className="border-b border-border px-3 py-2">Mappings</th>
                  <th className="border-b border-border px-3 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {risks.map((risk) => (
                  <tr key={risk.id} className="text-subhead-regular text-fg">
                    <td className="border-b border-border px-3 py-3">
                      <p className="max-w-[36ch] font-medium">
                        {risk.currentRevision.threat}
                      </p>
                      <p className="mt-1 text-caption-1-regular text-fg-muted">
                        {risk.currentRevision.affectedAssets.length} asset link
                        {risk.currentRevision.affectedAssets.length === 1
                          ? ""
                          : "s"}
                      </p>
                    </td>
                    <td className="border-b border-border px-3 py-3">
                      {statusLabel(risk.status)}
                    </td>
                    <td className="border-b border-border px-3 py-3">
                      {risk.currentRevision.inherentAssessment.level}
                    </td>
                    <td className="border-b border-border px-3 py-3">
                      {risk.currentRevision.residualAssessment.level}
                    </td>
                    <td className="border-b border-border px-3 py-3">
                      {risk.currentRevision.requirements.length} unresolved
                    </td>
                    <td className="border-b border-border px-3 py-3">
                      <Button
                        type="button"
                        variant="outline"
                        tone="grey"
                        onClick={() => setSelected(risk)}
                      >
                        Open risk
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="rounded-xl border border-border bg-surface-subtle p-3 text-caption-1-regular text-fg-muted">
          M7-03 source readiness is available. M8 attachment document versions
          remain unavailable, so this form does not represent an attachment as
          complete.
        </p>
      </div>
    </SectionCard>
  );
}
