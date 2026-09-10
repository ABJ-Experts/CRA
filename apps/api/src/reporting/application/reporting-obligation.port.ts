import type {
  AcquireReportingStageDraftLockInput,
  AcquireReportingStageDraftLockResponse,
  ApplyReportingFamilyTemplateInput,
  CancelReportingObligationInput,
  CreateReportingFamilyTemplateInput,
  CreateReportingFamilyTemplateVersionInput,
  CorrectReportingObligationAnchorInput,
  CreateReportingStageDraftInput,
  CreateReportingObligationInput,
  RecordReportingObligationStageSubmissionInput,
  ReportingFamilyTemplateParams,
  ReportingFamilyTemplateResponse,
  ReportingFamilyTemplatesResponse,
  ReportingFamilyTemplateListQuery,
  ReportingStageDraft,
  ReportingStageDraftParams,
  ReportingStageDraftResponse,
  ReportingStageSubmissionSnapshotResponse,
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
