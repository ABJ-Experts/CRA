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
} from "@nestjs/common";
import {
  acquireReportingStageDraftLockInputSchema,
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
  saveReportingStageDraftInputSchema,
  submitReportingStageDraftInputSchema,
  type AcquireReportingStageDraftLockInput,
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
} from "./application/reporting-obligation.port";
import { ReportingObligationUseCases } from "./application/reporting-obligation-use-cases";

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
