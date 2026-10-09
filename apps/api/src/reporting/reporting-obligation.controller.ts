import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  ServiceUnavailableException,
  HttpException,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import {
  acquireReportingStageDraftLockInputSchema,
  approveReportingStageDraftInputSchema,
  acquireReportingStageDraftLockResponseSchema,
  applyReportingFamilyTemplateInputSchema,
  cancelReportingObligationInputSchema,
  createReportingFamilyTemplateInputSchema,
  createReportingFamilyTemplateVersionInputSchema,
  createReportingStageDraftInputSchema,
  correctReportingObligationAnchorInputSchema,
  createReportingObligationInputSchema,
  recordReportingObligationStageSubmissionInputSchema,
  reportingObligationDetailResponseSchema,
  reportingObligationListQuerySchema,
  reportingObligationListResponseSchema,
  reportingObligationMutationResponseSchema,
  reportingObligationParamsSchema,
  reportingDeadlineSummaryQuerySchema,
  reportingDeadlineSummaryResponseSchema,
  reportingFamilyTemplateParamsSchema,
  reportingFamilyTemplateListQuerySchema,
  reportingFamilyTemplateResponseSchema,
  reportingFamilyTemplatesResponseSchema,
  reportingStageDraftMutationResponseSchema,
  reportingStageDraftParamsSchema,
  reportingStageDraftResponseSchema,
  reportingStageSubmissionSnapshotResponseSchema,
  reportingStageDraftApprovalResponseSchema,
  reauthenticateReportingStageApprovalInputSchema,
  reauthenticateReportingStageApprovalResponseSchema,
  createReportingStageAcknowledgementInputSchema,
  generateReportingObligationEvidencePackInputSchema,
  generateReportingStageSubmissionPackageInputSchema,
  recordReportingStageExternalFilingFieldsSchema,
  reauthenticateReportingStageFilingInputSchema,
  reauthenticateReportingStageFilingResponseSchema,
  reportingObligationEvidencePackDownloadResponseSchema,
  reportingObligationEvidencePackRouteParamsSchema,
  reportingObligationEvidencePackResponseSchema,
  reportingStageAcknowledgementResponseSchema,
  reportingStageEvidencePackageDownloadResponseSchema,
  reportingStageEvidencePackageRouteParamsSchema,
  reportingStageEvidencePackageResponseSchema,
  reportingStageEvidenceTimelineResponseSchema,
  reportingStageExternalFilingResponseSchema,
  reportingSubmissionAcknowledgementRouteParamsSchema,
  saveReportingStageDraftInputSchema,
  submitReportingStageDraftInputSchema,
  type AcquireReportingStageDraftLockInput,
  type ApproveReportingStageDraftInput,
  type ApplyReportingFamilyTemplateInput,
  type CancelReportingObligationInput,
  type CorrectReportingObligationAnchorInput,
  type CreateReportingObligationInput,
  type CreateReportingFamilyTemplateInput,
  type CreateReportingFamilyTemplateVersionInput,
  type CreateReportingStageDraftInput,
  type RecordReportingObligationStageSubmissionInput,
  type ReportingObligationListQuery,
  type ReportingDeadlineSummaryQuery,
  type ReportingFamilyTemplateParams,
  type ReportingFamilyTemplateListQuery,
  type ReportingStageDraftParams,
  type SaveReportingStageDraftInput,
  type SubmitReportingStageDraftInput,
  type ReauthenticateReportingStageApprovalInput,
  type CreateReportingStageAcknowledgementInput,
  type GenerateReportingObligationEvidencePackInput,
  type GenerateReportingStageSubmissionPackageInput,
  type RecordReportingStageExternalFilingFields,
  type ReauthenticateReportingStageFilingInput,
  type ReportingObligationEvidencePackParams,
  type ReportingStageEvidencePackageParams,
} from "@repo/contracts/reporting";

import {
  CurrentUser,
  RequirePermissions,
  type RequestUser,
} from "../auth/auth.types";
import { ZodResponse } from "../common/http/zod-response.interceptor";
import {
  zodBody,
  zodParams,
  zodQuery,
} from "../common/pipes/zod-validation.pipe";
import {
  ReportingObligationConflictError,
  ReportingObligationInvalidRequestError,
  ReportingObligationInvalidStateError,
  ReportingStageDraftConflictError,
  ReportingStageDraftLockedError,
  ReportingStageApprovalProofError,
  ReportingStageApprovalSodError,
  ReportingStageFilingProofError,
} from "./application/reporting-obligation.port";
import { ReportingObligationUseCases } from "./application/reporting-obligation-use-cases";
import { ReportingEvidenceWorkflowError } from "./infrastructure/reporting-evidence-workflow.service";

const receiptMimeTypes = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "text/plain",
]);
const receiptMaximumBytes = 10 * 1024 * 1024;
@Controller("reporting/obligations")
export class ReportingObligationController {
  constructor(private readonly reporting: ReportingObligationUseCases) {}

  @Get()
  @RequirePermissions("can_view_findings")
  @ZodResponse(reportingObligationListResponseSchema)
  async list(
    @Query(zodQuery(reportingObligationListQuerySchema))
    query: ReportingObligationListQuery,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const result = await this.reporting.list(organizationId(user), {
        actorId: user.id,
        ...query,
      });
      if (result) return result;
    } catch (error) {
      throw readFailure(error);
    }
    throw notFound();
  }

  @Get("deadline-summary")
  @RequirePermissions("can_view_findings")
  @ZodResponse(reportingDeadlineSummaryResponseSchema)
  async deadlineSummary(
    @Query(zodQuery(reportingDeadlineSummaryQuerySchema))
    _query: ReportingDeadlineSummaryQuery,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const result = await this.reporting.deadlineSummary(
        organizationId(user),
        {
          actorId: user.id,
        },
      );
      if (result) return result;
    } catch (error) {
      throw readFailure(error);
    }
    throw notFound();
  }

  @Post()
  @RequirePermissions("can_view_findings", "can_edit_findings")
  @ZodResponse(reportingObligationMutationResponseSchema)
  async create(
    @Body(zodBody(createReportingObligationInputSchema))
    input: CreateReportingObligationInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const result = await this.reporting.create(organizationId(user), {
        actorId: user.id,
        ...input,
      });
      if (result) return result;
    } catch (error) {
      throw mutationFailure(error);
    }
    throw notFound();
  }

  @Get("templates")
  @RequirePermissions("can_edit_organization")
  @ZodResponse(reportingFamilyTemplatesResponseSchema)
  async listTemplates(
    @Query(zodQuery(reportingFamilyTemplateListQuerySchema))
    query: ReportingFamilyTemplateListQuery,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const result = await this.reporting.listFamilyTemplates(
        organizationId(user),
        {
          actorId: user.id,
          ...query,
        },
      );
      if (result) return result;
    } catch (error) {
      throw readFailure(error);
    }
    throw notFound();
  }

  @Post("templates")
  @RequirePermissions("can_edit_organization")
  @ZodResponse(reportingFamilyTemplateResponseSchema)
  async createTemplate(
    @Body(zodBody(createReportingFamilyTemplateInputSchema))
    input: CreateReportingFamilyTemplateInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const result = await this.reporting.createFamilyTemplate(
        organizationId(user),
        {
          actorId: user.id,
          ...input,
        },
      );
      if (result) return result;
    } catch (error) {
      throw draftMutationFailure(error);
    }
    throw notFound();
  }

  @Post("templates/:templateId/versions")
  @RequirePermissions("can_edit_organization")
  @ZodResponse(reportingFamilyTemplateResponseSchema)
  async createTemplateVersion(
    @Param(zodParams(reportingFamilyTemplateParamsSchema))
    params: ReportingFamilyTemplateParams,
    @Body(zodBody(createReportingFamilyTemplateVersionInputSchema))
    input: CreateReportingFamilyTemplateVersionInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const result = await this.reporting.createFamilyTemplateVersion(
        organizationId(user),
        { actorId: user.id, ...params, ...input },
      );
      if (result) return result;
    } catch (error) {
      throw draftMutationFailure(error);
    }
    throw notFound();
  }

  @Get(":obligationId/stages/:stageId/draft")
  @RequirePermissions("can_view_findings")
  @ZodResponse(reportingStageDraftResponseSchema)
  async getStageDraft(
    @Param(zodParams(reportingStageDraftParamsSchema))
    params: ReportingStageDraftParams,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const result = await this.reporting.getStageDraft(organizationId(user), {
        actorId: user.id,
        ...params,
      });
      if (result) return result;
    } catch (error) {
      throw readFailure(error);
    }
    throw notFound();
  }

  @Post(":obligationId/stages/:stageId/draft")
  @RequirePermissions("can_view_findings", "can_edit_findings")
  @ZodResponse(reportingStageDraftResponseSchema)
  async createStageDraft(
    @Param(zodParams(reportingStageDraftParamsSchema))
    params: ReportingStageDraftParams,
    @Body(zodBody(createReportingStageDraftInputSchema))
    input: CreateReportingStageDraftInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const result = await this.reporting.createStageDraft(
        organizationId(user),
        {
          actorId: user.id,
          ...params,
          ...input,
        },
      );
      if (result) return result;
    } catch (error) {
      throw draftMutationFailure(error);
    }
    throw notFound();
  }

  @Post(":obligationId/stages/:stageId/draft/lock")
  @RequirePermissions("can_view_findings", "can_edit_findings")
  @ZodResponse(acquireReportingStageDraftLockResponseSchema)
  async acquireStageDraftLock(
    @Param(zodParams(reportingStageDraftParamsSchema))
    params: ReportingStageDraftParams,
    @Body(zodBody(acquireReportingStageDraftLockInputSchema))
    input: AcquireReportingStageDraftLockInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const result = await this.reporting.acquireStageDraftLock(
        organizationId(user),
        {
          actorId: user.id,
          ...params,
          ...input,
        },
      );
      if (result) return result;
    } catch (error) {
      throw draftMutationFailure(error);
    }
    throw notFound();
  }

  @Patch(":obligationId/stages/:stageId/draft/save")
  @RequirePermissions("can_view_findings", "can_edit_findings")
  @ZodResponse(reportingStageDraftMutationResponseSchema)
  async saveStageDraft(
    @Param(zodParams(reportingStageDraftParamsSchema))
    params: ReportingStageDraftParams,
    @Body(zodBody(saveReportingStageDraftInputSchema))
    input: SaveReportingStageDraftInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const result = await this.reporting.saveStageDraft(organizationId(user), {
        actorId: user.id,
        ...params,
        ...input,
      });
      if (result) return result;
    } catch (error) {
      throw draftMutationFailure(error);
    }
    throw notFound();
  }

  @Post(":obligationId/stages/:stageId/draft/submit")
  @RequirePermissions("can_view_findings", "can_edit_findings")
  @ZodResponse(reportingStageSubmissionSnapshotResponseSchema)
  async submitStageDraft(
    @Param(zodParams(reportingStageDraftParamsSchema))
    params: ReportingStageDraftParams,
    @Body(zodBody(submitReportingStageDraftInputSchema))
    input: SubmitReportingStageDraftInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const result = await this.reporting.submitStageDraft(
        organizationId(user),
        {
          actorId: user.id,
          ...params,
          ...input,
        },
      );
      if (result) return result;
    } catch (error) {
      throw draftMutationFailure(error);
    }
    throw notFound();
  }

  @Post(":obligationId/stages/:stageId/draft/reauthentication")
  @RequirePermissions("can_view_findings", "can_submit_reporting")
  @ZodResponse(reauthenticateReportingStageApprovalResponseSchema)
  async reauthenticateStageApproval(
    @Param(zodParams(reportingStageDraftParamsSchema))
    params: ReportingStageDraftParams,
    @Body(zodBody(reauthenticateReportingStageApprovalInputSchema))
    input: ReauthenticateReportingStageApprovalInput,
    @CurrentUser() user: RequestUser,
  ) {
    if (!user.sessionId)
      throw approvalForbidden("A valid organization session is required.");
    const result = await this.reporting.reauthenticateStageApproval(
      organizationId(user),
      {
        actorId: user.id,
        sessionId: user.sessionId,
        email: user.email,
        accessToken: user.accessToken,
        ...params,
        ...input,
      },
    );
    if (result.outcome === "created") return result.proof;
    if (result.outcome === "mfa_required")
      throw approvalForbidden(
        "Two-factor verification is required for report approval.",
      );
    if (result.outcome === "invalid")
      throw approvalForbidden("Reauthentication failed.");
    if (result.outcome === "not_found") throw notFound();
    throw unavailable();
  }

  @Post(":obligationId/stages/:stageId/draft/approve")
  @RequirePermissions("can_view_findings", "can_submit_reporting")
  @ZodResponse(reportingStageDraftApprovalResponseSchema)
  async approveStageDraft(
    @Param(zodParams(reportingStageDraftParamsSchema))
    params: ReportingStageDraftParams,
    @Body(zodBody(approveReportingStageDraftInputSchema))
    input: ApproveReportingStageDraftInput,
    @CurrentUser() user: RequestUser,
  ) {
    if (!user.sessionId)
      throw approvalForbidden("A valid organization session is required.");
    try {
      const result = await this.reporting.approveStageDraft(
        organizationId(user),
        {
          actorId: user.id,
          sessionId: user.sessionId,
          ...params,
          ...input,
        },
      );
      if (result) return result;
    } catch (error) {
      if (error instanceof ReportingStageApprovalProofError)
        throw approvalForbidden(
          "The fresh approval proof is expired or already used. Reauthenticate and retry.",
        );
      if (error instanceof ReportingStageApprovalSodError)
        throw new ConflictException({
          code: "segregation_of_duties",
          message:
            "A different authorized approver is required, or an owner must provide an exception reason.",
        });
      throw draftMutationFailure(error);
    }
    throw notFound();
  }

  @Post(":obligationId/stages/:stageId/draft/packages")
  @RequirePermissions("can_view_findings", "can_submit_reporting")
  @ZodResponse(reportingStageEvidencePackageResponseSchema)
  async generateStagePackage(
    @Param(zodParams(reportingStageDraftParamsSchema))
    params: ReportingStageDraftParams,
    @Body(zodBody(generateReportingStageSubmissionPackageInputSchema))
    input: GenerateReportingStageSubmissionPackageInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const result = await this.reporting.generateStageSubmissionPackage(
        organizationId(user),
        {
          actorId: user.id,
          ...params,
          ...input,
        },
      );
      if (result) return result;
    } catch (error) {
      throw evidenceFailure(error);
    }
    throw notFound();
  }

  @Get(":obligationId/stages/:stageId/draft/packages/:packageId/download")
  @RequirePermissions("can_view_findings", "can_submit_reporting")
  @ZodResponse(reportingStageEvidencePackageDownloadResponseSchema)
  async downloadStagePackage(
    @Param(zodParams(reportingStageEvidencePackageRouteParamsSchema))
    params: ReportingStageDraftParams & ReportingStageEvidencePackageParams,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const result = await this.reporting.getStageSubmissionPackageDownload(
        organizationId(user),
        { actorId: user.id, ...params },
      );
      if (result) return result;
    } catch (error) {
      throw evidenceFailure(error);
    }
    throw notFound();
  }

  @Post(":obligationId/stages/:stageId/draft/filing-reauthentication")
  @RequirePermissions("can_view_findings", "can_submit_reporting")
  @ZodResponse(reauthenticateReportingStageFilingResponseSchema)
  async reauthenticateStageFiling(
    @Param(zodParams(reportingStageDraftParamsSchema))
    params: ReportingStageDraftParams,
    @Body(zodBody(reauthenticateReportingStageFilingInputSchema))
    input: ReauthenticateReportingStageFilingInput,
    @CurrentUser() user: RequestUser,
  ) {
    if (!user.sessionId)
      throw approvalForbidden("A valid organization session is required.");
    const result = await this.reporting.reauthenticateStageFiling(
      organizationId(user),
      {
        actorId: user.id,
        sessionId: user.sessionId,
        email: user.email,
        accessToken: user.accessToken,
        ...params,
        ...input,
      },
    );
    if (result.outcome === "created") return result.proof;
    if (result.outcome === "mfa_required")
      throw approvalForbidden(
        "Two-factor verification is required for external filing.",
      );
    if (result.outcome === "invalid")
      throw approvalForbidden("Reauthentication failed.");
    if (result.outcome === "not_found") throw notFound();
    throw unavailable();
  }

  @Post(":obligationId/stages/:stageId/draft/filings")
  @RequirePermissions("can_view_findings", "can_submit_reporting")
  @UseInterceptors(
    FileInterceptor("receipt", {
      storage: memoryStorage(),
      limits: {
        fileSize: receiptMaximumBytes,
        files: 1,
        fields: 7,
        fieldSize: 4_096,
      },
    }),
  )
  @ZodResponse(reportingStageExternalFilingResponseSchema)
  async recordStageExternalFiling(
    @Param(zodParams(reportingStageDraftParamsSchema))
    params: ReportingStageDraftParams,
    @Body(zodBody(recordReportingStageExternalFilingFieldsSchema))
    fields: RecordReportingStageExternalFilingFields,
    @UploadedFile() receipt: Express.Multer.File | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    if (!user.sessionId)
      throw approvalForbidden("A valid organization session is required.");
    const upload = validatedReceipt(receipt);
    try {
      const result = await this.reporting.recordStageExternalFiling(
        organizationId(user),
        {
          actorId: user.id,
          sessionId: user.sessionId,
          ...params,
          fields,
          receipt: upload,
        },
      );
      if (result) return result;
    } catch (error) {
      throw evidenceFailure(error);
    }
    throw notFound();
  }

  @Get(":obligationId/stages/:stageId/draft/evidence-timeline")
  @RequirePermissions("can_view_findings")
  @ZodResponse(reportingStageEvidenceTimelineResponseSchema)
  async stageEvidenceTimeline(
    @Param(zodParams(reportingStageDraftParamsSchema))
    params: ReportingStageDraftParams,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const result = await this.reporting.stageEvidenceTimeline(
        organizationId(user),
        { actorId: user.id, ...params },
      );
      if (result) return result;
    } catch (error) {
      throw evidenceFailure(error);
    }
    throw notFound();
  }

  @Post(":obligationId/submissions/:submissionId/acknowledgements")
  @RequirePermissions("can_view_findings", "can_submit_reporting")
  @ZodResponse(reportingStageAcknowledgementResponseSchema)
  async appendStageAcknowledgement(
    @Param(zodParams(reportingSubmissionAcknowledgementRouteParamsSchema))
    params: { obligationId: string; submissionId: string },
    @Body(zodBody(createReportingStageAcknowledgementInputSchema))
    input: CreateReportingStageAcknowledgementInput,
    @CurrentUser() user: RequestUser,
  ) {
    if (params.submissionId !== input.submissionId) {
      throw new BadRequestException({
        code: "invalid_request",
        message: "The acknowledgement submission does not match the route.",
      });
    }
    try {
      const result = await this.reporting.appendStageAcknowledgement(
        organizationId(user),
        { actorId: user.id, ...params, ...input },
      );
      if (result) return result;
    } catch (error) {
      throw evidenceFailure(error);
    }
    throw notFound();
  }

  @Post(":obligationId/evidence-packs")
  @RequirePermissions("can_view_findings", "can_submit_reporting")
  @ZodResponse(reportingObligationEvidencePackResponseSchema)
  async generateEvidencePack(
    @Param(zodParams(reportingObligationParamsSchema))
    params: { obligationId: string },
    @Body(zodBody(generateReportingObligationEvidencePackInputSchema))
    input: GenerateReportingObligationEvidencePackInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const result = await this.reporting.generateObligationEvidencePack(
        organizationId(user),
        { actorId: user.id, ...params, ...input },
      );
      if (result) return result;
    } catch (error) {
      throw evidenceFailure(error);
    }
    throw notFound();
  }

  @Get(":obligationId/evidence-packs/:evidencePackId/download")
  @RequirePermissions("can_view_findings", "can_submit_reporting")
  @ZodResponse(reportingObligationEvidencePackDownloadResponseSchema)
  async downloadEvidencePack(
    @Param(zodParams(reportingObligationEvidencePackRouteParamsSchema))
    params: { obligationId: string } & ReportingObligationEvidencePackParams,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const result = await this.reporting.getObligationEvidencePackDownload(
        organizationId(user),
        { actorId: user.id, ...params },
      );
      if (result) return result;
    } catch (error) {
      throw evidenceFailure(error);
    }
    throw notFound();
  }

  @Post(":obligationId/stages/:stageId/draft/templates/apply")
  @RequirePermissions("can_view_findings", "can_edit_findings")
  @ZodResponse(reportingStageDraftMutationResponseSchema)
  async applyTemplate(
    @Param(zodParams(reportingStageDraftParamsSchema))
    params: ReportingStageDraftParams,
    @Body(zodBody(applyReportingFamilyTemplateInputSchema))
    input: ApplyReportingFamilyTemplateInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const result = await this.reporting.applyFamilyTemplate(
        organizationId(user),
        {
          actorId: user.id,
          ...params,
          ...input,
        },
      );
      if (result) return result;
    } catch (error) {
      throw draftMutationFailure(error);
    }
    throw notFound();
  }

  @Get(":obligationId")
  @RequirePermissions("can_view_findings")
  @ZodResponse(reportingObligationDetailResponseSchema)
  async detail(
    @Param(zodParams(reportingObligationParamsSchema))
    params: { obligationId: string },
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const result = await this.reporting.detail(organizationId(user), {
        actorId: user.id,
        obligationId: params.obligationId,
      });
      if (result) return result;
    } catch (error) {
      throw readFailure(error);
    }
    throw notFound();
  }

  @Patch(":obligationId/anchors")
  @RequirePermissions("can_view_findings", "can_edit_findings")
  @ZodResponse(reportingObligationMutationResponseSchema)
  async correctAnchor(
    @Param(zodParams(reportingObligationParamsSchema))
    params: { obligationId: string },
    @Body(zodBody(correctReportingObligationAnchorInputSchema))
    input: CorrectReportingObligationAnchorInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const result = await this.reporting.correctAnchor(organizationId(user), {
        actorId: user.id,
        obligationId: params.obligationId,
        ...input,
      });
      if (result) return result;
    } catch (error) {
      throw mutationFailure(error);
    }
    throw notFound();
  }

  @Post(":obligationId/stage-submissions")
  @RequirePermissions("can_view_findings", "can_edit_findings")
  @ZodResponse(reportingObligationMutationResponseSchema)
  async recordSubmission(
    @Param(zodParams(reportingObligationParamsSchema))
    params: { obligationId: string },
    @Body(zodBody(recordReportingObligationStageSubmissionInputSchema))
    input: RecordReportingObligationStageSubmissionInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const result = await this.reporting.recordSubmission(
        organizationId(user),
        {
          actorId: user.id,
          obligationId: params.obligationId,
          ...input,
        },
      );
      if (result) return result;
    } catch (error) {
      throw mutationFailure(error);
    }
    throw notFound();
  }

  @Post(":obligationId/cancellation")
  @RequirePermissions("can_view_findings", "can_edit_findings")
  @ZodResponse(reportingObligationMutationResponseSchema)
  async cancel(
    @Param(zodParams(reportingObligationParamsSchema))
    params: { obligationId: string },
    @Body(zodBody(cancelReportingObligationInputSchema))
    input: CancelReportingObligationInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const result = await this.reporting.cancel(organizationId(user), {
        actorId: user.id,
        obligationId: params.obligationId,
        ...input,
      });
      if (result) return result;
    } catch (error) {
      throw mutationFailure(error);
    }
    throw notFound();
  }
}

function organizationId(user: RequestUser): string {
  if (user.organizationId) return user.organizationId;
  throw notFound();
}

function notFound(): NotFoundException {
  return new NotFoundException({
    message: "Reporting obligation was not found.",
    code: "not_found",
  });
}

function unavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    message: "Reporting obligations are temporarily unavailable.",
    code: "unavailable",
  });
}

function approvalForbidden(message: string): HttpException {
  return new HttpException({ code: "approval_forbidden", message }, 403);
}

function readFailure(error: unknown): Error {
  return error instanceof ReportingObligationInvalidRequestError
    ? new BadRequestException({
        message: "The reporting request is invalid.",
        code: "invalid_request",
      })
    : unavailable();
}

function mutationFailure(error: unknown): Error {
  if (error instanceof ReportingObligationConflictError)
    return new ConflictException({
      message: "The reporting obligation changed. Refresh and retry.",
      code: "conflict",
    });
  if (error instanceof ReportingObligationInvalidStateError)
    return new ConflictException({
      message: "That reporting transition is not available.",
      code: "invalid_state",
    });
  if (error instanceof ReportingObligationInvalidRequestError)
    return new BadRequestException({
      message: "The reporting request is invalid.",
      code: "invalid_request",
    });
  return unavailable();
}

function draftMutationFailure(error: unknown): Error {
  if (error instanceof ReportingStageDraftConflictError) {
    return new ConflictException({
      code: "stale_revision",
      message:
        "The draft changed. Reload or compare the current revision before saving.",
      currentDraft: error.draft,
    });
  }
  if (error instanceof ReportingStageDraftLockedError) {
    return new HttpException(
      {
        code: "locked",
        message: "This draft is currently being edited by another member.",
        currentDraft: error.draft,
      },
      423,
    );
  }
  return mutationFailure(error);
}

function validatedReceipt(file: Express.Multer.File | undefined) {
  if (
    !file ||
    file.buffer.byteLength < 1 ||
    file.buffer.byteLength > receiptMaximumBytes
  ) {
    throw new BadRequestException({
      code: "invalid_receipt",
      message: "One receipt file of up to 10 MiB is required.",
    });
  }
  const mimeType = file.mimetype.toLowerCase();
  if (!receiptMimeTypes.has(mimeType)) {
    throw new BadRequestException({
      code: "invalid_receipt",
      message: "Receipt files must be PDF, PNG, JPEG, or plain text.",
    });
  }
  return {
    bytes: Buffer.from(file.buffer),
    fileName: file.originalname,
    mimeType: mimeType as
      "application/pdf" | "image/png" | "image/jpeg" | "text/plain",
  };
}

function evidenceFailure(error: unknown): Error {
  if (error instanceof ReportingObligationInvalidStateError)
    return new ConflictException({
      code: "rehearsal_filing_forbidden",
      message:
        "Synthetic rehearsals must use the rehearsal filing workflow and cannot be filed as real reports.",
    });
  if (error instanceof ReportingEvidenceWorkflowError) {
    if (error.code === "conflict")
      return new ConflictException({
        code: "evidence_conflict",
        message: "The approved package or filing changed. Reload and retry.",
      });
    if (error.code === "invalid_request")
      return new BadRequestException({
        code: "invalid_request",
        message: "The reporting evidence request is invalid.",
      });
  }
  if (error instanceof ReportingStageFilingProofError) {
    return approvalForbidden(
      "The fresh filing proof is expired or already used. Reauthenticate and retry.",
    );
  }
  return unavailable();
}
