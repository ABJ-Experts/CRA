import type {
  AcquireReportingStageDraftLockInput,
  ApplyReportingFamilyTemplateInput,
  CancelReportingObligationInput,
  CreateReportingStageAcknowledgementInput,
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
  ReauthenticateReportingStageApprovalInput,
  ApproveReportingStageDraftInput,
  GenerateReportingObligationEvidencePackInput,
  GenerateReportingStageSubmissionPackageInput,
  RecordReportingStageExternalFilingFields,
  ReauthenticateReportingStageFilingInput,
  ReportingObligationEvidencePackParams,
  ReportingStageEvidencePackageParams,
} from "@repo/contracts/reporting";

import type {
  ReportingObligationRepository,
  ReportingEvidenceWorkflowPort,
  ReportingStageApprovalReauthenticationPort,
  ReportingStageReceiptUpload,
} from "./reporting-obligation.port";

export class ReportingObligationUseCases {
  constructor(
    private readonly repository: ReportingObligationRepository,
    private readonly reauthentication: ReportingStageApprovalReauthenticationPort,
    private readonly evidence: ReportingEvidenceWorkflowPort,
  ) {}

  async reauthenticateStageApproval(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        sessionId: string;
        email: string;
        accessToken: string;
        obligationId: string;
        stageId: string;
      } & ReauthenticateReportingStageApprovalInput
    >,
  ) {
    const verified = await this.reauthentication.verify({
      email: input.email,
      password: input.password,
      accessToken: input.accessToken,
      actorId: input.actorId,
      ...(input.mfaCode ? { mfaCode: input.mfaCode } : {}),
    });
    if (verified.outcome !== "verified")
      return { outcome: verified.outcome } as const;
    const proof = await this.repository.createStageApprovalProof(
      organizationId,
      {
        actorId: input.actorId,
        sessionId: input.sessionId,
        obligationId: input.obligationId,
        stageId: input.stageId,
        draftRevision: input.draftRevision,
        draftHash: input.draftHash,
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      },
    );
    return proof === null
      ? { outcome: "not_found" as const }
      : { outcome: "created" as const, proof };
  }

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
  ) {
    return this.repository.approveStageDraft(organizationId, input);
  }

  generateStageSubmissionPackage(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        obligationId: string;
        stageId: string;
      } & GenerateReportingStageSubmissionPackageInput
    >,
  ) {
    return this.evidence.generateStageSubmissionPackage(organizationId, input);
  }

  getStageSubmissionPackageDownload(
    organizationId: string,
    input: Readonly<
      { actorId: string; stageId: string } & ReportingStageEvidencePackageParams
    >,
  ) {
    return this.evidence.getStageSubmissionPackageDownload(
      organizationId,
      input,
    );
  }

  async reauthenticateStageFiling(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        sessionId: string;
        email: string;
        accessToken: string;
        obligationId: string;
        stageId: string;
      } & ReauthenticateReportingStageFilingInput
    >,
  ) {
    const verified = await this.reauthentication.verify({
      email: input.email,
      password: input.password,
      accessToken: input.accessToken,
      actorId: input.actorId,
      ...(input.mfaCode ? { mfaCode: input.mfaCode } : {}),
    });
    if (verified.outcome !== "verified")
      return { outcome: verified.outcome } as const;
    const proof = await this.evidence.createStageFilingProof(organizationId, {
      actorId: input.actorId,
      sessionId: input.sessionId,
      obligationId: input.obligationId,
      stageId: input.stageId,
      packageId: input.packageId,
      idempotencyKey: input.idempotencyKey,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
    return proof === null
      ? { outcome: "not_found" as const }
      : { outcome: "created" as const, proof };
  }

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
  ) {
    return this.evidence.recordStageExternalFiling(organizationId, input);
  }

  appendStageAcknowledgement(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        obligationId: string;
      } & CreateReportingStageAcknowledgementInput
    >,
  ) {
    return this.evidence.appendStageAcknowledgement(organizationId, input);
  }

  stageEvidenceTimeline(
    organizationId: string,
    input: Readonly<{ actorId: string; obligationId: string; stageId: string }>,
  ) {
    return this.evidence.stageEvidenceTimeline(organizationId, input);
  }

  generateObligationEvidencePack(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        obligationId: string;
      } & GenerateReportingObligationEvidencePackInput
    >,
  ) {
    return this.evidence.generateObligationEvidencePack(organizationId, input);
  }

  getObligationEvidencePackDownload(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        obligationId: string;
      } & ReportingObligationEvidencePackParams
    >,
  ) {
    return this.evidence.getObligationEvidencePackDownload(
      organizationId,
      input,
    );
  }

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
