import type {
  AcquireReportingStageDraftLockInput,
  ApplyReportingFamilyTemplateInput,
  CancelReportingObligationInput,
  CreateReportingFamilyTemplateInput,
  CreateReportingFamilyTemplateVersionInput,
  CorrectReportingObligationAnchorInput,
  CreateReportingStageDraftInput,
  CreateReportingObligationInput,
  RecordReportingObligationStageSubmissionInput,
  ReportingFamilyTemplateParams,
  ReportingFamilyTemplateListQuery,
  ReportingObligationListQuery,
  ReportingStageDraftParams,
  SaveReportingStageDraftInput,
  SubmitReportingStageDraftInput,
} from "@repo/contracts/reporting";

import type { ReportingObligationRepository } from "./reporting-obligation.port";

export class ReportingObligationUseCases {
  constructor(private readonly repository: ReportingObligationRepository) {}

  getStageDraft(
    organizationId: string,
    input: Readonly<{ actorId: string } & ReportingStageDraftParams>,
  ) {
    return this.repository.getStageDraft(organizationId, input);
  }

  createStageDraft(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        obligationId: string;
        stageId: string;
      } & CreateReportingStageDraftInput
    >,
  ) {
    return this.repository.createStageDraft(organizationId, input);
  }

  acquireStageDraftLock(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        obligationId: string;
        stageId: string;
      } & AcquireReportingStageDraftLockInput
    >,
  ) {
    return this.repository.acquireStageDraftLock(organizationId, input);
  }

  saveStageDraft(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        obligationId: string;
        stageId: string;
      } & SaveReportingStageDraftInput
    >,
  ) {
    return this.repository.saveStageDraft(organizationId, input);
  }

  submitStageDraft(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        obligationId: string;
        stageId: string;
      } & SubmitReportingStageDraftInput
    >,
  ) {
    return this.repository.submitStageDraft(organizationId, input);
  }

  listFamilyTemplates(
    organizationId: string,
    input: Readonly<{ actorId: string } & ReportingFamilyTemplateListQuery>,
  ) {
    return this.repository.listFamilyTemplates(organizationId, input);
  }

  createFamilyTemplate(
    organizationId: string,
    input: Readonly<{ actorId: string } & CreateReportingFamilyTemplateInput>,
  ) {
    return this.repository.createFamilyTemplate(organizationId, input);
  }

  createFamilyTemplateVersion(
    organizationId: string,
    input: Readonly<
      { actorId: string } & ReportingFamilyTemplateParams &
        CreateReportingFamilyTemplateVersionInput
    >,
  ) {
    return this.repository.createFamilyTemplateVersion(organizationId, input);
  }

  applyFamilyTemplate(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        obligationId: string;
        stageId: string;
      } & ApplyReportingFamilyTemplateInput
    >,
  ) {
    return this.repository.applyFamilyTemplate(organizationId, input);
  }

  deadlineSummary(
    organizationId: string,
    input: Readonly<{ actorId: string }>,
  ) {
    return this.repository.deadlineSummary(organizationId, input);
  }

  list(
    organizationId: string,
    input: Readonly<{ actorId: string } & ReportingObligationListQuery>,
  ) {
    return this.repository.list(organizationId, input);
  }

  detail(
    organizationId: string,
    input: Readonly<{ actorId: string; obligationId: string }>,
  ) {
    return this.repository.detail(organizationId, input);
  }

  create(
    organizationId: string,
    input: Readonly<{ actorId: string } & CreateReportingObligationInput>,
  ) {
    return this.repository.create(organizationId, input);
  }

  correctAnchor(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        obligationId: string;
      } & CorrectReportingObligationAnchorInput
    >,
  ) {
    return this.repository.correctAnchor(organizationId, input);
  }

  recordSubmission(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        obligationId: string;
      } & RecordReportingObligationStageSubmissionInput
    >,
  ) {
    return this.repository.recordSubmission(organizationId, input);
  }

  cancel(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        obligationId: string;
      } & CancelReportingObligationInput
    >,
  ) {
    return this.repository.cancel(organizationId, input);
  }
}
