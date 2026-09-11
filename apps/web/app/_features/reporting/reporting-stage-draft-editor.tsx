"use client";

import type {
  ReportingObligationListResponse,
  ReportingObligationEvidencePackResponse,
  ReportingStageEvidencePackage,
  ReportingStageDraft,
} from "@repo/contracts/reporting";
import { reportingStageDraftSchema } from "@repo/contracts/reporting";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Tag } from "@repo/ui/tag";
import { useEffect, useMemo, useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import { useHasPermission } from "../../_providers/session-provider";
import {
  useAcquireReportingStageDraftLockMutation,
  useApplyReportingFamilyTemplateMutation,
  useCreateReportingFamilyTemplateMutation,
  useCreateReportingStageDraftMutation,
  useReportingFamilyTemplatesQuery,
  useReportingStageDraftQuery,
  useSaveReportingStageDraftMutation,
  useApproveReportingStageDraftMutation,
  useDownloadReportingStageSubmissionPackageMutation,
  useDownloadReportingEvidencePackMutation,
  useGenerateReportingEvidencePackMutation,
  useGenerateReportingStageSubmissionPackageMutation,
  useRecordReportingStageExternalFilingMutation,
  useReportingStageEvidenceTimelineQuery,
  useReauthenticateReportingStageFilingMutation,
  useReauthenticateReportingStageApprovalMutation,
} from "./reporting.queries";

type Obligation = ReportingObligationListResponse["obligations"][number];
type Stage = Obligation["stages"][number];

function uuid() {
  return crypto.randomUUID();
}

function message(error: unknown) {
  if (error instanceof ApiClientError && error.status === 409)
    return "The draft changed in another editor. Reload it or compare the current revision before saving.";
  if (error instanceof ApiClientError && error.status === 423)
    return "This draft is locked by another editor. Wait for the lock to expire or ask them to finish.";
  if (error instanceof ApiClientError && error.status === 403)
    return "You no longer have permission to edit this draft.";
  if (error instanceof ApiClientError && error.kind === "network")
    return "You appear offline. Your entered content is still here; reconnect and retry.";
  return "The draft could not be updated. Review the values and try again.";
}

function sourceLabel(
  origin: ReportingStageDraft["fields"][number]["provenance"],
) {
  if (origin.origin === "human")
    return `Entered by ${origin.actor.displayName}`;
  if (origin.origin === "platform") return `Prepopulated from ${origin.source}`;
  return `AI suggestion accepted by ${origin.acceptedBy.displayName}`;
}

function cloneDraft(draft: ReportingStageDraft) {
  return structuredClone(draft);
}

function currentDraftFromConflict(error: unknown): ReportingStageDraft | null {
  if (!(error instanceof ApiClientError) || error.status !== 409) return null;
  const parsed = reportingStageDraftSchema.safeParse(
    (error.payload as { readonly currentDraft?: unknown } | undefined)
      ?.currentDraft,
  );
  return parsed.success ? parsed.data : null;
}

export function ReportingStageDraftEditor({
  obligation,
  stage,
  canEdit,
}: Readonly<{ obligation: Obligation; stage: Stage; canEdit: boolean }>) {
  const canManageTemplates = useHasPermission("can_edit_organization");
  const draftQuery = useReportingStageDraftQuery(obligation.id, stage.id, true);
  const create = useCreateReportingStageDraftMutation();
  const acquire = useAcquireReportingStageDraftLockMutation();
  const save = useSaveReportingStageDraftMutation();
  const reauthenticateApproval =
    useReauthenticateReportingStageApprovalMutation();
  const approve = useApproveReportingStageDraftMutation();
  const generatePackage = useGenerateReportingStageSubmissionPackageMutation();
  const downloadPackage = useDownloadReportingStageSubmissionPackageMutation();
  const reauthenticateFiling = useReauthenticateReportingStageFilingMutation();
  const recordFiling = useRecordReportingStageExternalFilingMutation();
  const generateEvidencePack = useGenerateReportingEvidencePackMutation();
  const downloadEvidencePack = useDownloadReportingEvidencePackMutation();
  const canSubmitReports = useHasPermission("can_submit_reporting");
  const applyTemplate = useApplyReportingFamilyTemplateMutation();
  const createTemplate = useCreateReportingFamilyTemplateMutation();
  const templates = useReportingFamilyTemplatesQuery(
    obligation.type,
    stage.kind,
    canManageTemplates && draftQuery.data?.draft !== undefined,
  );
  const timeline = useReportingStageEvidenceTimelineQuery(
    obligation.id,
    stage.id,
    canSubmitReports,
  );
  const [working, setWorking] = useState<ReportingStageDraft | null>(null);
  const [lockToken, setLockToken] = useState<string | null>(null);
  const [releaseId, setReleaseId] = useState("");
  const [conflict, setConflict] = useState<ReportingStageDraft | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(uuid);
  const [templateName, setTemplateName] = useState("");
  const [approvalPassword, setApprovalPassword] = useState("");
  const [approvalMfaCode, setApprovalMfaCode] = useState("");
  const [approvalProofId, setApprovalProofId] = useState<string | null>(null);
  const [sodOverrideReason, setSodOverrideReason] = useState("");
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const [evidencePackage, setEvidencePackage] =
    useState<ReportingStageEvidencePackage | null>(null);
  const [filingPassword, setFilingPassword] = useState("");
  const [filingMfaCode, setFilingMfaCode] = useState("");
  const [filingProofId, setFilingProofId] = useState<string | null>(null);
  const [filingReference, setFilingReference] = useState("");
  const [filingTimestamp, setFilingTimestamp] = useState(() =>
    new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  );
  const [filingTimestampBasis, setFilingTimestampBasis] = useState("");
  const [receipt, setReceipt] = useState<File | null>(null);
  const [evidencePack, setEvidencePack] = useState<
    ReportingObligationEvidencePackResponse["evidencePack"] | null
  >(null);

  useEffect(() => {
    if (draftQuery.data?.draft) {
      setWorking(cloneDraft(draftQuery.data.draft));
      setConflict(null);
    }
  }, [draftQuery.data]);
  const status =
    working?.status ?? (draftQuery.isLoading ? "loading" : "missing");
  const editable =
    canEdit &&
    working !== null &&
    working.status !== "submitted" &&
    lockToken !== null;
  const isPending =
    create.isPending ||
    acquire.isPending ||
    save.isPending ||
    reauthenticateApproval.isPending ||
    approve.isPending ||
    generatePackage.isPending ||
    downloadPackage.isPending ||
    reauthenticateFiling.isPending ||
    recordFiling.isPending ||
    generateEvidencePack.isPending ||
    downloadEvidencePack.isPending ||
    applyTemplate.isPending ||
    createTemplate.isPending;
  const error =
    create.error ??
    acquire.error ??
    save.error ??
    reauthenticateApproval.error ??
    approve.error ??
    generatePackage.error ??
    downloadPackage.error ??
    reauthenticateFiling.error ??
    recordFiling.error ??
    generateEvidencePack.error ??
    downloadEvidencePack.error ??
    applyTemplate.error ??
    draftQuery.error;

  const changed = useMemo(
    () =>
      working !== null &&
      draftQuery.data?.draft !== undefined &&
      (JSON.stringify(working.fields) !==
        JSON.stringify(draftQuery.data.draft.fields) ||
        JSON.stringify(working.memberStates) !==
          JSON.stringify(draftQuery.data.draft.memberStates) ||
        working.requiresTemplateReview),
    [working, draftQuery.data],
  );
  function reload() {
    setLockToken(null);
    setConflict(null);
    void draftQuery.refetch();
  }
  function updateField(key: string, value: string | boolean | string[] | null) {
    setWorking((current) =>
      current === null
        ? current
        : {
            ...current,
            fields: current.fields.map((field) =>
              field.value.key === key
                ? {
                    ...field,
                    value: { ...field.value, value } as typeof field.value,
                  }
                : field,
            ),
          },
    );
  }
  function updateMemberStates(value: string) {
    const countryCodes = [
      ...new Set(
        value
          .split(",")
          .map((item) => item.trim().toUpperCase())
          .filter(Boolean),
      ),
    ];
    setWorking((current) => {
      if (current === null) {
        return current;
      }
      const provenance =
        current.memberStates[0]?.provenance ?? current.fields[0]?.provenance;
      if (provenance === undefined) return current;
      return {
        ...current,
        memberStates: current.memberStates
          .filter((state) => countryCodes.includes(state.countryCode))
          .concat(
            countryCodes
              .filter(
                (countryCode) =>
                  !current.memberStates.some(
                    (state) => state.countryCode === countryCode,
                  ),
              )
              .map((countryCode) => ({
                countryCode:
                  countryCode as (typeof current.memberStates)[number]["countryCode"],
                // The server records the actual editor and timestamp on save.
                provenance,
              })),
          ),
      };
    });
  }
  function createDraft() {
    create.mutate(
      {
        obligationId: obligation.id,
        stageId: stage.id,
        input: { releaseId: releaseId.trim(), idempotencyKey },
      },
      { onSuccess: () => setIdempotencyKey(uuid()) },
    );
  }
  function acquireLock() {
    if (working === null) return;
    acquire.mutate(
      {
        obligationId: obligation.id,
        stageId: stage.id,
        input: { expectedRevision: working.revision, idempotencyKey },
      },
      {
        onSuccess: (result) => {
          setWorking(cloneDraft(result.draft));
          setLockToken(result.lockToken);
          setIdempotencyKey(uuid());
        },
      },
    );
  }
  function saveDraft() {
    if (working === null || lockToken === null) return;
    save.mutate(
      {
        obligationId: obligation.id,
        stageId: stage.id,
        input: {
          expectedRevision: working.revision,
          lockToken,
          fields: working.fields,
          memberStates: working.memberStates,
          idempotencyKey,
        },
      },
      {
        onSuccess: (result) => {
          setWorking(cloneDraft(result.draft));
          setApprovalId(null);
          setEvidencePackage(null);
          setFilingProofId(null);
          setIdempotencyKey(uuid());
        },
        onError: (error) => {
          setConflict(
            currentDraftFromConflict(error) ?? draftQuery.data?.draft ?? null,
          );
        },
      },
    );
  }
  function reauthenticateForApproval() {
    if (working === null) return;
    reauthenticateApproval.mutate(
      {
        obligationId: obligation.id,
        stageId: stage.id,
        input: {
          draftRevision: working.revision,
          draftHash: working.contentHash,
          password: approvalPassword,
          ...(approvalMfaCode ? { mfaCode: approvalMfaCode } : {}),
          idempotencyKey,
        },
      },
      {
        onSuccess: (proof) => {
          setApprovalProofId(proof.reauthenticationProofId);
          setApprovalPassword("");
          setApprovalMfaCode("");
          setIdempotencyKey(uuid());
        },
      },
    );
  }
  function approveDraft() {
    if (working === null || approvalProofId === null) return;
    approve.mutate(
      {
        obligationId: obligation.id,
        stageId: stage.id,
        input: {
          draftRevision: working.revision,
          draftHash: working.contentHash,
          reauthenticationProofId: approvalProofId,
          ...(sodOverrideReason.trim()
            ? { segregationOfDutiesOverrideReason: sodOverrideReason }
            : {}),
          idempotencyKey,
        },
      },
      {
        onSuccess: (result) => {
          setApprovalProofId(null);
          setApprovalId(result.approval.id);
          setEvidencePackage(null);
          setIdempotencyKey(uuid());
        },
      },
    );
  }
  function generateSubmissionPackage() {
    if (working === null || approvalId === null) return;
    generatePackage.mutate(
      {
        obligationId: obligation.id,
        stageId: stage.id,
        input: {
          approvalId,
          draftRevision: working.revision,
          draftHash: working.contentHash,
          idempotencyKey,
        },
      },
      {
        onSuccess: (result) => {
          setEvidencePackage(result.package);
          setIdempotencyKey(uuid());
        },
      },
    );
  }
  function downloadSubmissionPackage() {
    if (evidencePackage === null || evidencePackage.status !== "ready") return;
    downloadPackage.mutate(
      {
        obligationId: obligation.id,
        stageId: stage.id,
        packageId: evidencePackage.id,
      },
      {
        onSuccess: (result) => {
          // Keep the operational view open: a package download is not an
          // external filing and should not navigate away from entered filing
          // evidence. The short-lived URL is still issued only by the API.
          const link = document.createElement("a");
          link.href = result.download.downloadUrl;
          link.download = result.download.fileName;
          link.target = "_blank";
          link.rel = "noreferrer";
          link.click();
        },
      },
    );
  }
  function reauthenticateForFiling() {
    if (evidencePackage === null || filingPassword.length === 0) return;
    reauthenticateFiling.mutate(
      {
        obligationId: obligation.id,
        stageId: stage.id,
        input: {
          packageId: evidencePackage.id,
          password: filingPassword,
          ...(filingMfaCode ? { mfaCode: filingMfaCode } : {}),
          idempotencyKey,
        },
      },
      {
        onSuccess: (proof) => {
          setFilingProofId(proof.reauthenticationProofId);
          setFilingPassword("");
          setFilingMfaCode("");
          setIdempotencyKey(uuid());
        },
      },
    );
  }
  function recordExternalFiling() {
    if (
      evidencePackage === null ||
      filingProofId === null ||
      receipt === null ||
      filingReference.trim().length === 0 ||
      filingTimestampBasis.trim().length === 0
    )
      return;
    recordFiling.mutate(
      {
        obligationId: obligation.id,
        stageId: stage.id,
        fields: {
          packageId: evidencePackage.id,
          filingReauthenticationProofId: filingProofId,
          submissionReference: filingReference,
          submittedAt: filingTimestamp,
          submittedAtBasis: filingTimestampBasis,
          expectedStageVersion: stage.version,
          idempotencyKey,
        },
        receipt,
      },
      {
        onSuccess: () => {
          setFilingProofId(null);
          setReceipt(null);
          setIdempotencyKey(uuid());
        },
      },
    );
  }
  function generateObligationEvidencePack() {
    generateEvidencePack.mutate(
      { obligationId: obligation.id, input: { idempotencyKey } },
      {
        onSuccess: (result) => {
          setEvidencePack(result.evidencePack);
          setIdempotencyKey(uuid());
        },
      },
    );
  }
  function downloadObligationEvidencePack() {
    if (evidencePack === null) return;
    downloadEvidencePack.mutate(
      { obligationId: obligation.id, evidencePackId: evidencePack.id },
      {
        onSuccess: (result) => {
          const link = document.createElement("a");
          link.href = result.download.downloadUrl;
          link.download = result.download.fileName;
          link.target = "_blank";
          link.rel = "noreferrer";
          link.click();
        },
      },
    );
  }

  return (
    <section
      className="mt-4 border-t border-border pt-4"
      aria-labelledby={`stage-draft-${stage.id}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3
            id={`stage-draft-${stage.id}`}
            className="text-subhead-semibold text-fg"
          >
            {label(stage.kind)} draft
          </h3>
          <p className="text-caption-1-regular text-fg-muted">
            Release-scoped draft content is saved independently from the
            submitted stage record.
          </p>
        </div>
        <Tag
          variant="dot"
          tone={
            status === "submitted" || working?.completeness === "valid"
              ? "green"
              : status === "locked"
                ? "purple"
                : "orange"
          }
        >
          {status === "loading"
            ? "Loading"
            : working?.completeness === "incomplete"
              ? "Incomplete"
              : status}
        </Tag>
      </div>
      {draftQuery.isLoading ? (
        <p role="status" className="mt-3 text-caption-1-regular text-fg-muted">
          Loading stage draft…
        </p>
      ) : null}
      {draftQuery.isError ? (
        <div className="mt-3" role="alert">
          <p className="text-caption-1-regular text-danger">{message(error)}</p>
          <Button
            className="mt-2"
            size="sm"
            variant="outline"
            tone="grey"
            onClick={reload}
          >
            Retry
          </Button>
        </div>
      ) : null}
      {working === null && !draftQuery.isLoading && !draftQuery.isError ? (
        <div className="mt-3 rounded-xl border border-border p-3">
          <label className="block text-caption-1-regular text-fg-muted">
            Release ID
            <Input
              className="mt-1"
              value={releaseId}
              onChange={(event) => setReleaseId(event.target.value)}
              placeholder="Release UUID"
              aria-describedby={`release-help-${stage.id}`}
            />
          </label>
          <p
            id={`release-help-${stage.id}`}
            className="mt-1 text-caption-1-regular text-fg-muted"
          >
            The release determines the default Member States. Confirm it before
            creating the draft.
          </p>
          <Button
            className="mt-3"
            size="sm"
            disabled={
              !canEdit || releaseId.trim().length === 0 || create.isPending
            }
            onClick={createDraft}
          >
            {create.isPending ? "Creating…" : "Create draft"}
          </Button>
        </div>
      ) : null}
      {working !== null ? (
        <>
          {working.status === "locked" && lockToken === null ? (
            <p
              role="status"
              className="mt-3 text-caption-1-regular text-fg-muted"
            >
              Locked by {working.lock?.heldBy.displayName} until{" "}
              {working.lock?.expiresAt
                ? new Date(working.lock.expiresAt).toLocaleTimeString()
                : "expiry"}
              .
            </p>
          ) : null}
          {working.status !== "submitted" && lockToken === null ? (
            <Button
              className="mt-3"
              size="sm"
              disabled={!canEdit || acquire.isPending}
              onClick={acquireLock}
            >
              {acquire.isPending ? "Acquiring…" : "Edit draft"}
            </Button>
          ) : null}
          {lockToken !== null ? (
            <p
              role="status"
              className="mt-3 text-caption-1-regular text-success"
            >
              Editing lock acquired. Save before it expires.
            </p>
          ) : null}
          {conflict !== null ? (
            <div
              role="alert"
              className="mt-3 rounded-xl border border-danger p-3"
            >
              <p className="text-caption-1-regular text-danger">
                A newer revision exists. Your entered content remains on screen.
              </p>
              <details className="mt-2 text-caption-1-regular text-fg">
                <summary>Compare current revision</summary>
                <p className="mt-2 text-fg-muted">
                  Current revision {conflict.revision}; your revision{" "}
                  {working.revision}. Reload only after copying any edits you
                  need to keep.
                </p>
              </details>
              <Button
                className="mt-2"
                size="sm"
                variant="outline"
                tone="grey"
                onClick={reload}
              >
                Reload current revision
              </Button>
            </div>
          ) : null}
          <fieldset
            disabled={!editable || isPending}
            className="mt-3 space-y-3 disabled:opacity-70"
          >
            <legend className="sr-only">Draft fields</legend>
            {working.fieldDefinitions.map((definition) => {
              const field = working.fields.find(
                (item) => item.value.key === definition.key,
              );
              if (!field || definition.type === "member_states") return null;
              return (
                <label
                  key={definition.key}
                  className="block text-caption-1-regular text-fg-muted"
                >
                  <span className="text-fg">
                    {definition.label}
                    {definition.required ? " (required)" : ""}
                  </span>
                  {definition.description ? (
                    <span className="mt-1 block">{definition.description}</span>
                  ) : null}
                  {definition.type === "boolean" ? (
                    <input
                      className="ml-2 align-middle"
                      type="checkbox"
                      checked={field.value.value === true}
                      onChange={(event) =>
                        updateField(definition.key, event.target.checked)
                      }
                    />
                  ) : definition.type === "long_text" ? (
                    <textarea
                      className="mt-1 min-h-28 w-full rounded-xl border border-border bg-canvas px-3 py-2 text-body-regular text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                      value={
                        typeof field.value.value === "string"
                          ? field.value.value
                          : ""
                      }
                      onChange={(event) =>
                        updateField(definition.key, event.target.value)
                      }
                    />
                  ) : (
                    <Input
                      className="mt-1"
                      value={
                        typeof field.value.value === "string"
                          ? field.value.value
                          : ""
                      }
                      onChange={(event) =>
                        updateField(definition.key, event.target.value)
                      }
                    />
                  )}
                  <span className="mt-1 block text-caption-1-regular text-fg-muted">
                    Source: {sourceLabel(field.provenance)}
                  </span>
                </label>
              );
            })}
            <label className="block text-caption-1-regular text-fg-muted">
              <span className="text-fg">
                Member States (comma-separated ISO codes)
              </span>
              <Input
                className="mt-1"
                value={working.memberStates
                  .map((item) => item.countryCode)
                  .join(", ")}
                onChange={(event) => updateMemberStates(event.target.value)}
              />
              <span className="mt-1 block">
                Corrected states retain their origin in the submitted evidence.
              </span>
            </label>
          </fieldset>
          {canManageTemplates && lockToken !== null ? (
            <div className="mt-4 border-t border-border pt-3">
              <h4 className="text-caption-1-semibold text-fg">
                Reusable family template
              </h4>
              <p className="mt-1 text-caption-1-regular text-fg-muted">
                Templates exclude Member States and require review before
                submission.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {templates.data?.templates
                  .filter((template) => template.archivedAt === null)
                  .map((template) => (
                    <Button
                      key={template.id}
                      size="sm"
                      variant="outline"
                      tone="grey"
                      disabled={!editable}
                      onClick={() =>
                        applyTemplate.mutate(
                          {
                            obligationId: obligation.id,
                            stageId: stage.id,
                            input: {
                              templateVersionId: template.currentVersion.id,
                              expectedRevision: working.revision,
                              lockToken,
                              idempotencyKey,
                            },
                          },
                          {
                            onSuccess: (result) => {
                              setWorking(cloneDraft(result.draft));
                              setIdempotencyKey(uuid());
                            },
                          },
                        )
                      }
                    >
                      Apply {template.name}
                    </Button>
                  ))}
              </div>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="min-w-52 flex-1 text-caption-1-regular text-fg-muted">
                  Save current reusable content as
                  <Input
                    className="mt-1"
                    value={templateName}
                    maxLength={200}
                    onChange={(event) => setTemplateName(event.target.value)}
                    placeholder="Template name"
                  />
                </label>
                <Button
                  size="sm"
                  variant="outline"
                  tone="grey"
                  disabled={
                    !editable ||
                    templateName.trim().length === 0 ||
                    createTemplate.isPending
                  }
                  onClick={() =>
                    createTemplate.mutate(
                      {
                        obligationType: obligation.type,
                        stage: stage.kind,
                        name: templateName,
                        fields: working.fields.filter(
                          (field) => field.value.type !== "member_states",
                        ),
                        idempotencyKey,
                      },
                      {
                        onSuccess: () => {
                          setTemplateName("");
                          setIdempotencyKey(uuid());
                        },
                      },
                    )
                  }
                >
                  {createTemplate.isPending ? "Saving…" : "Save template"}
                </Button>
              </div>
            </div>
          ) : null}
          {lockToken !== null ? (
            <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-3">
              {working.requiresTemplateReview ? (
                <p
                  role="status"
                  className="basis-full text-caption-1-regular text-warning"
                >
                  Review and save the template-applied fields before submitting.
                </p>
              ) : null}
              <Button
                size="sm"
                disabled={!changed || isPending}
                onClick={saveDraft}
              >
                {save.isPending ? "Saving…" : "Save draft"}
              </Button>
            </div>
          ) : null}
          {canSubmitReports && working.status !== "submitted" ? (
            <div
              className="mt-4 border-t border-border pt-3"
              aria-label="Report approval"
            >
              <h4 className="text-caption-1-semibold text-fg">Approval</h4>
              <p className="mt-1 text-caption-1-regular text-fg-muted">
                Approve revision {working.revision}. The displayed content,
                provenance, validation state and hash are bound to a single-use
                fresh reauthentication proof.
              </p>
              <p className="mt-1 break-all text-caption-1-regular text-fg-muted">
                Content hash: {working.contentHash}
              </p>
              <label className="mt-3 block text-caption-1-regular text-fg-muted">
                Current password
                <Input
                  className="mt-1"
                  type="password"
                  autoComplete="current-password"
                  value={approvalPassword}
                  onChange={(event) => setApprovalPassword(event.target.value)}
                />
              </label>
              <label className="mt-3 block text-caption-1-regular text-fg-muted">
                MFA code (if required)
                <Input
                  className="mt-1"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={approvalMfaCode}
                  onChange={(event) => setApprovalMfaCode(event.target.value)}
                />
              </label>
              <label className="mt-3 block text-caption-1-regular text-fg-muted">
                Owner override reason (only when approving your own edits)
                <Input
                  className="mt-1"
                  value={sodOverrideReason}
                  onChange={(event) => setSodOverrideReason(event.target.value)}
                />
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  tone="grey"
                  disabled={
                    working.completeness !== "valid" ||
                    working.requiresTemplateReview ||
                    approvalPassword.length === 0 ||
                    isPending
                  }
                  onClick={reauthenticateForApproval}
                >
                  {reauthenticateApproval.isPending
                    ? "Verifying…"
                    : "Reauthenticate"}
                </Button>
                <Button
                  size="sm"
                  disabled={
                    working.completeness !== "valid" ||
                    working.requiresTemplateReview ||
                    approvalProofId === null ||
                    isPending
                  }
                  onClick={approveDraft}
                >
                  {approve.isPending ? "Approving…" : "Approve stage"}
                </Button>
              </div>
              {approvalProofId ? (
                <p
                  role="status"
                  className="mt-2 text-caption-1-regular text-success"
                >
                  Fresh approval proof ready. It will be consumed once.
                </p>
              ) : null}
            </div>
          ) : null}
          {canSubmitReports && working.status !== "submitted" ? (
            <div
              className="mt-4 border-t border-border pt-3"
              aria-label="Manual submission package"
            >
              <h4 className="text-caption-1-semibold text-fg">
                Signed manual package
              </h4>
              <p className="mt-1 text-caption-1-regular text-fg-muted">
                Package generation preserves the approved snapshot. Downloading
                it does not record an external filing or stop a deadline.
              </p>
              {approvalId === null ? (
                <p
                  role="status"
                  className="mt-2 text-caption-1-regular text-fg-muted"
                >
                  Approve this exact revision before generating its signed
                  package. If this was approved in another session, reload and
                  request a new approval if no current approval is shown.
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  tone="grey"
                  disabled={approvalId === null || isPending}
                  onClick={generateSubmissionPackage}
                >
                  {generatePackage.isPending
                    ? "Generating…"
                    : "Generate package"}
                </Button>
                <Button
                  size="sm"
                  disabled={evidencePackage?.status !== "ready" || isPending}
                  onClick={downloadSubmissionPackage}
                >
                  {downloadPackage.isPending
                    ? "Preparing…"
                    : "Download package"}
                </Button>
              </div>
              {evidencePackage ? (
                <p
                  role="status"
                  className="mt-2 break-all text-caption-1-regular text-fg-muted"
                >
                  {evidencePackage.status === "ready"
                    ? `Package ready: ${evidencePackage.fileName}. SHA-256 ${evidencePackage.sha256}.`
                    : evidencePackage.status === "failed"
                      ? "Package generation failed. Review the approval and retry."
                      : "Package generation is in progress."}
                </p>
              ) : null}
            </div>
          ) : null}
          {canSubmitReports &&
          working.status !== "submitted" &&
          evidencePackage?.status === "ready" ? (
            <div
              className="mt-4 border-t border-border pt-3"
              aria-label="Record external filing"
            >
              <h4 className="text-caption-1-semibold text-fg">
                Record external filing
              </h4>
              <p className="mt-1 text-caption-1-regular text-fg-muted">
                Record the actual external filing only after it has occurred. A
                fresh filing proof and one receipt are required.
              </p>
              <label className="mt-3 block text-caption-1-regular text-fg-muted">
                External filing reference
                <Input
                  className="mt-1"
                  value={filingReference}
                  onChange={(event) => setFilingReference(event.target.value)}
                  placeholder="Regulator portal or filing reference"
                />
              </label>
              <label className="mt-3 block text-caption-1-regular text-fg-muted">
                Actual filing timestamp (UTC)
                <Input
                  className="mt-1"
                  value={filingTimestamp}
                  onChange={(event) => setFilingTimestamp(event.target.value)}
                  placeholder="2026-01-31T15:30:00Z"
                />
              </label>
              <label className="mt-3 block text-caption-1-regular text-fg-muted">
                Timestamp basis
                <Input
                  className="mt-1"
                  value={filingTimestampBasis}
                  onChange={(event) =>
                    setFilingTimestampBasis(event.target.value)
                  }
                  placeholder="Portal receipt timestamp in UTC"
                />
              </label>
              <label className="mt-3 block text-caption-1-regular text-fg-muted">
                Receipt (PDF, PNG, JPEG, or text; 10 MiB maximum)
                <Input
                  className="mt-1"
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,text/plain"
                  onChange={(event) =>
                    setReceipt(event.target.files?.item(0) ?? null)
                  }
                />
              </label>
              <label className="mt-3 block text-caption-1-regular text-fg-muted">
                Current password
                <Input
                  className="mt-1"
                  type="password"
                  autoComplete="current-password"
                  value={filingPassword}
                  onChange={(event) => setFilingPassword(event.target.value)}
                />
              </label>
              <label className="mt-3 block text-caption-1-regular text-fg-muted">
                MFA code (if required)
                <Input
                  className="mt-1"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={filingMfaCode}
                  onChange={(event) => setFilingMfaCode(event.target.value)}
                />
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  tone="grey"
                  disabled={filingPassword.length === 0 || isPending}
                  onClick={reauthenticateForFiling}
                >
                  {reauthenticateFiling.isPending
                    ? "Verifying…"
                    : "Reauthenticate for filing"}
                </Button>
                <Button
                  size="sm"
                  disabled={
                    filingProofId === null ||
                    receipt === null ||
                    filingReference.trim().length === 0 ||
                    filingTimestampBasis.trim().length === 0 ||
                    isPending
                  }
                  onClick={recordExternalFiling}
                >
                  {recordFiling.isPending
                    ? "Recording…"
                    : "Record external filing"}
                </Button>
              </div>
              {filingProofId ? (
                <p
                  role="status"
                  className="mt-2 text-caption-1-regular text-success"
                >
                  Fresh filing proof ready. It will be consumed once.
                </p>
              ) : null}
            </div>
          ) : null}
          {canSubmitReports && timeline.data?.events.length ? (
            <div
              className="mt-4 border-t border-border pt-3"
              aria-label="Evidence timeline"
            >
              <h4 className="text-caption-1-semibold text-fg">
                Evidence timeline
              </h4>
              <ol className="mt-2 space-y-2 text-caption-1-regular text-fg-muted">
                {timeline.data.events.map((event) => (
                  <li key={event.id}>
                    <span className="font-medium text-fg">
                      {label(event.kind)}
                    </span>
                    {": "}
                    {event.summary}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          {canSubmitReports ? (
            <div
              className="mt-4 border-t border-border pt-3"
              aria-label="Export reporting evidence"
            >
              <h4 className="text-caption-1-semibold text-fg">
                Export reporting evidence
              </h4>
              <p className="mt-1 text-caption-1-regular text-fg-muted">
                Export an immutable, manifest-verified evidence pack for this
                obligation. The export does not alter the reporting record.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  tone="grey"
                  disabled={isPending}
                  onClick={generateObligationEvidencePack}
                >
                  {generateEvidencePack.isPending
                    ? "Generating…"
                    : "Generate evidence pack"}
                </Button>
                <Button
                  size="sm"
                  disabled={evidencePack === null || isPending}
                  onClick={downloadObligationEvidencePack}
                >
                  {downloadEvidencePack.isPending
                    ? "Preparing…"
                    : "Download evidence pack"}
                </Button>
              </div>
              {evidencePack ? (
                <p
                  role="status"
                  className="mt-2 break-all text-caption-1-regular text-fg-muted"
                >
                  Evidence pack ready: {evidencePack.fileName}. SHA-256{" "}
                  {evidencePack.sha256}.
                </p>
              ) : null}
            </div>
          ) : null}
          {error && !draftQuery.isError ? (
            <p role="alert" className="mt-3 text-caption-1-regular text-danger">
              {message(error)}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function label(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
