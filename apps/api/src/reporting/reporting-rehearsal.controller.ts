import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  NotFoundException,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import {
  createReportingRehearsalInputSchema,
  replayReportingRehearsalInputSchema,
  recordReportingStageRehearsalFilingFieldsSchema,
  reportingObligationMutationResponseSchema,
  reportingObligationParamsSchema,
  reportingStageDraftParamsSchema,
  reportingStageRehearsalFilingResponseSchema,
  type CreateReportingRehearsalInput,
  type ReplayReportingRehearsalInput,
  type RecordReportingStageRehearsalFilingFields,
  type ReportingObligationParams,
  type ReportingStageDraftParams,
} from "@repo/contracts/reporting";

import {
  CurrentUser,
  RequirePermissions,
  type RequestUser,
} from "../auth/auth.types";
import { ZodResponse } from "../common/http/zod-response.interceptor";
import { zodBody, zodParams } from "../common/pipes/zod-validation.pipe";
import {
  ReportingObligationConflictError,
  ReportingObligationInvalidRequestError,
  ReportingObligationInvalidStateError,
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

/** Synthetic-only routes: no real filing endpoint accepts this route's shape. */
@Controller("reporting/rehearsals")
export class ReportingRehearsalController {
  constructor(private readonly reporting: ReportingObligationUseCases) {}

  @Post()
  @RequirePermissions("can_view_findings", "can_submit_reporting")
  @ZodResponse(reportingObligationMutationResponseSchema)
  async create(
    @Body(zodBody(createReportingRehearsalInputSchema))
    input: CreateReportingRehearsalInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const result = await this.reporting.createRehearsal(
        organizationId(user),
        {
          actorId: user.id,
          ...input,
        },
      );
      if (result) return result;
    } catch (error) {
      throw rehearsalMutationFailure(error);
    }
    throw new NotFoundException();
  }

  @Post(":obligationId/replay")
  @RequirePermissions("can_view_findings", "can_submit_reporting")
  @ZodResponse(reportingObligationMutationResponseSchema)
  async replay(
    @Param(zodParams(reportingObligationParamsSchema))
    params: ReportingObligationParams,
    @Body(zodBody(replayReportingRehearsalInputSchema))
    input: ReplayReportingRehearsalInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const result = await this.reporting.replayRehearsal(
        organizationId(user),
        {
          actorId: user.id,
          obligationId: params.obligationId,
          ...input,
        },
      );
      if (result) return result;
    } catch (error) {
      throw rehearsalMutationFailure(error);
    }
    throw new NotFoundException();
  }

  @Post(":obligationId/stages/:stageId/filings")
  @RequirePermissions("can_view_findings", "can_submit_reporting")
  @UseInterceptors(
    FileInterceptor("receipt", {
      storage: memoryStorage(),
      limits: {
        fileSize: receiptMaximumBytes,
        files: 1,
        fields: 8,
        fieldSize: 4_096,
      },
    }),
  )
  @ZodResponse(reportingStageRehearsalFilingResponseSchema)
  async recordSyntheticFiling(
    @Param(zodParams(reportingStageDraftParamsSchema))
    params: ReportingStageDraftParams,
    @Body(zodBody(recordReportingStageRehearsalFilingFieldsSchema))
    fields: RecordReportingStageRehearsalFilingFields,
    @UploadedFile() receipt: Express.Multer.File | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    if (!user.sessionId) {
      throw new BadRequestException({
        code: "session_required",
        message: "A valid organization session is required.",
      });
    }
    try {
      const result = await this.reporting.recordStageRehearsalFiling(
        organizationId(user),
        {
          actorId: user.id,
          sessionId: user.sessionId,
          ...params,
          fields,
          receipt: validatedReceipt(receipt),
        },
      );
      if (result) return result;
    } catch (error) {
      throw rehearsalEvidenceFailure(error);
    }
    throw new NotFoundException();
  }
}

function organizationId(user: RequestUser): string {
  if (!user.organizationId) throw new NotFoundException();
  return user.organizationId;
}

function validatedReceipt(file: Express.Multer.File | undefined) {
  if (
    !file ||
    file.buffer.byteLength < 1 ||
    file.buffer.byteLength > receiptMaximumBytes ||
    !receiptMimeTypes.has(file.mimetype.toLowerCase())
  ) {
    throw new BadRequestException({
      code: "invalid_receipt",
      message:
        "One PDF, PNG, JPEG, or plain-text receipt of up to 10 MiB is required.",
    });
  }
  return {
    bytes: Buffer.from(file.buffer),
    fileName: file.originalname,
    mimeType: file.mimetype.toLowerCase() as
      "application/pdf" | "image/png" | "image/jpeg" | "text/plain",
  };
}

function rehearsalMutationFailure(error: unknown): Error {
  if (
    error instanceof ReportingObligationConflictError ||
    error instanceof ReportingObligationInvalidStateError
  ) {
    return new ConflictException({
      code: "conflict",
      message: "The rehearsal changed. Refresh and retry.",
    });
  }
  if (error instanceof ReportingObligationInvalidRequestError) {
    return new BadRequestException({
      code: "invalid_request",
      message: "The rehearsal request is invalid.",
    });
  }
  return new BadRequestException({
    code: "rehearsal_unavailable",
    message: "The rehearsal operation is unavailable.",
  });
}

function rehearsalEvidenceFailure(error: unknown): Error {
  if (
    error instanceof ReportingEvidenceWorkflowError &&
    error.code === "conflict"
  ) {
    return new ConflictException({
      code: "evidence_conflict",
      message: "The approved rehearsal package changed. Reload and retry.",
    });
  }
  return rehearsalMutationFailure(error);
}
