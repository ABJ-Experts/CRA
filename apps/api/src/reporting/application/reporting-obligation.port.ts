import type {
  AcquireReportingStageDraftLockInput,
  AcquireReportingStageDraftLockResponse,
  ApplyReportingFamilyTemplateInput,
  ApproveReportingStageDraftInput,
  CancelReportingObligationInput,
  CreateReportingStageAcknowledgementInput,
  CreateReportingFamilyTemplateInput,
  CreateReportingFamilyTemplateVersionInput,
  CorrectReportingObligationAnchorInput,
  CreateReportingStageDraftInput,
  CreateReportingObligationInput,
  RecordReportingObligationStageSubmissionInput,
  RecordReportingStageExternalFilingFields,
  ReauthenticateReportingStageFilingResponse,
  ReportingObligationEvidencePackDownloadResponse,
  ReportingObligationEvidencePackResponse,
  ReportingStageAcknowledgementResponse,
  ReportingStageEvidencePackageDownloadResponse,
  ReportingStageEvidencePackageResponse,
  ReportingStageEvidenceTimelineResponse,
  ReportingStageExternalFilingResponse,
  ReportingFamilyTemplateParams,
  ReportingFamilyTemplateResponse,
  ReportingFamilyTemplatesResponse,
  ReportingFamilyTemplateListQuery,
  ReportingStageDraft,
  ReportingStageDraftApprovalResponse,
  ReportingStageDraftParams,
  ReportingStageDraftResponse,
  ReportingStageSubmissionSnapshotResponse,
  ReauthenticateReportingStageApprovalResponse,
  ReportingObligationDetailResponse,
  ReportingObligationListQuery,
  ReportingObligationListResponse,
  ReportingObligationMutationResponse,
  ReportingDeadlineSummaryResponse,
  SaveReportingStageDraftInput,
  SubmitReportingStageDraftInput,
} from "@repo/contracts/reporting";

export const REPORTING_OBLIGATION_REPOSITORY = Symbol(
  "REPORTING_OBLIGATION_REPOSITORY",
);
export const REPORTING_STAGE_APPROVAL_REAUTHENTICATION = Symbol(
  "REPORTING_STAGE_APPROVAL_REAUTHENTICATION",
);
export const REPORTING_EVIDENCE_WORKFLOW = Symbol(
  "REPORTING_EVIDENCE_WORKFLOW",
);
export interface ReportingStageApprovalReauthenticationPort {
  verify(
    input: Readonly<{
      email: string;
      password: string;
      accessToken: string;
      actorId: string;
      mfaCode?: string;
    }>,
  ): Promise<
    Readonly<{
      outcome: "verified" | "invalid" | "mfa_required" | "unavailable";
    }>
  >;
}

export class ReportingObligationConflictError extends Error {}
export class ReportingObligationInvalidRequestError extends Error {}
export class ReportingObligationInvalidStateError extends Error {}
export class ReportingStageDraftConflictError extends Error {
  constructor(readonly draft: ReportingStageDraft) {
    super("Reporting stage draft has a stale revision.");
  }
}
export class ReportingStageDraftLockedError extends Error {
  constructor(readonly draft: ReportingStageDraft) {
    super("Reporting stage draft is locked.");
  }
}
export class ReportingStageApprovalProofError extends Error {}
export class ReportingStageApprovalSodError extends Error {}
export class ReportingStageFilingProofError extends Error {}

/**
 * The controller validates the untrusted multipart boundary; infrastructure
 * receives only immutable bytes plus the server-derived digest and safe name.
 */
export type ReportingStageReceiptUpload = Readonly<{
  bytes: Buffer;
  fileName: string;
  mimeType: "application/pdf" | "image/png" | "image/jpeg" | "text/plain";
}>;

export interface ReportingEvidenceWorkflowPort {
  generateStageSubmissionPackage(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      obligationId: string;
      stageId: string;
      approvalId: string;
      draftRevision: number;
      draftHash: string;
      idempotencyKey: string;
    }>,
  ): Promise<ReportingStageEvidencePackageResponse | null>;
  getStageSubmissionPackageDownload(
    organizationId: string,
    input: Readonly<{ actorId: string; stageId: string; packageId: string }>,
  ): Promise<ReportingStageEvidencePackageDownloadResponse | null>;
  createStageFilingProof(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      sessionId: string;
      obligationId: string;
      stageId: string;
      packageId: string;
      idempotencyKey: string;
      expiresAt: string;
    }>,
  ): Promise<ReauthenticateReportingStageFilingResponse | null>;
  recordStageExternalFiling(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      sessionId: string;
      obligationId: string;
      stageId: string;
      fields: RecordReportingStageExternalFilingFields;
      receipt: ReportingStageReceiptUpload;
    }>,
  ): Promise<ReportingStageExternalFilingResponse | null>;
  appendStageAcknowledgement(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        obligationId: string;
      } & CreateReportingStageAcknowledgementInput
    >,
  ): Promise<ReportingStageAcknowledgementResponse | null>;
  stageEvidenceTimeline(
    organizationId: string,
    input: Readonly<{ actorId: string; obligationId: string; stageId: string }>,
  ): Promise<ReportingStageEvidenceTimelineResponse | null>;
  generateObligationEvidencePack(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      obligationId: string;
      idempotencyKey: string;
    }>,
  ): Promise<ReportingObligationEvidencePackResponse | null>;
  getObligationEvidencePackDownload(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      obligationId: string;
      evidencePackId: string;
    }>,
  ): Promise<ReportingObligationEvidencePackDownloadResponse | null>;
}

export interface ReportingObligationRepository {
  getStageDraft(
    organizationId: string,
    input: Readonly<{ actorId: string } & ReportingStageDraftParams>,
  ): Promise<ReportingStageDraftResponse | null>;
  createStageDraft(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        obligationId: string;
        stageId: string;
      } & CreateReportingStageDraftInput
    >,
  ): Promise<ReportingStageDraftResponse | null>;
  acquireStageDraftLock(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        obligationId: string;
        stageId: string;
      } & AcquireReportingStageDraftLockInput
    >,
  ): Promise<AcquireReportingStageDraftLockResponse | null>;
  saveStageDraft(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        obligationId: string;
        stageId: string;
      } & SaveReportingStageDraftInput
    >,
  ): Promise<ReportingStageDraftResponse | null>;
  submitStageDraft(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        obligationId: string;
        stageId: string;
      } & SubmitReportingStageDraftInput
    >,
  ): Promise<ReportingStageSubmissionSnapshotResponse | null>;
  createStageApprovalProof(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      sessionId: string;
      obligationId: string;
      stageId: string;
      draftRevision: number;
      draftHash: string;
      expiresAt: string;
    }>,
  ): Promise<ReauthenticateReportingStageApprovalResponse | null>;
  approveStageDraft(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        sessionId: string;
        obligationId: string;
        stageId: string;
      } & ApproveReportingStageDraftInput
    >,
  ): Promise<ReportingStageDraftApprovalResponse | null>;
  listFamilyTemplates(
    organizationId: string,
    input: Readonly<{ actorId: string } & ReportingFamilyTemplateListQuery>,
  ): Promise<ReportingFamilyTemplatesResponse | null>;
  createFamilyTemplate(
    organizationId: string,
    input: Readonly<{ actorId: string } & CreateReportingFamilyTemplateInput>,
  ): Promise<ReportingFamilyTemplateResponse | null>;
  createFamilyTemplateVersion(
    organizationId: string,
    input: Readonly<
      { actorId: string } & ReportingFamilyTemplateParams &
        CreateReportingFamilyTemplateVersionInput
    >,
  ): Promise<ReportingFamilyTemplateResponse | null>;
  applyFamilyTemplate(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        obligationId: string;
        stageId: string;
      } & ApplyReportingFamilyTemplateInput
    >,
  ): Promise<ReportingStageDraftResponse | null>;
  deadlineSummary(
    organizationId: string,
    input: Readonly<{ actorId: string }>,
  ): Promise<ReportingDeadlineSummaryResponse | null>;
  list(
    organizationId: string,
    input: Readonly<{ actorId: string } & ReportingObligationListQuery>,
  ): Promise<ReportingObligationListResponse | null>;
  detail(
    organizationId: string,
    input: Readonly<{ actorId: string; obligationId: string }>,
  ): Promise<ReportingObligationDetailResponse | null>;
  create(
    organizationId: string,
    input: Readonly<{ actorId: string } & CreateReportingObligationInput>,
  ): Promise<ReportingObligationMutationResponse | null>;
  correctAnchor(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        obligationId: string;
      } & CorrectReportingObligationAnchorInput
    >,
  ): Promise<ReportingObligationMutationResponse | null>;
  recordSubmission(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        obligationId: string;
      } & RecordReportingObligationStageSubmissionInput
    >,
  ): Promise<ReportingObligationMutationResponse | null>;
  cancel(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        obligationId: string;
      } & CancelReportingObligationInput
    >,
  ): Promise<ReportingObligationMutationResponse | null>;
}
