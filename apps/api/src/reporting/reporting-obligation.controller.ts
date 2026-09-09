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
} from "@nestjs/common";
import {
  cancelReportingObligationInputSchema,
  correctReportingObligationAnchorInputSchema,
  createReportingObligationInputSchema,
  recordReportingObligationStageSubmissionInputSchema,
  reportingObligationDetailResponseSchema,
  reportingObligationListQuerySchema,
  reportingObligationListResponseSchema,
  reportingObligationMutationResponseSchema,
  reportingObligationParamsSchema,
  type CancelReportingObligationInput,
  type CorrectReportingObligationAnchorInput,
  type CreateReportingObligationInput,
  type RecordReportingObligationStageSubmissionInput,
  type ReportingObligationListQuery,
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
