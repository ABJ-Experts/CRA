import {
  Body,
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  ServiceUnavailableException,
  UseFilters,
} from "@nestjs/common";
import {
  auditRangeCreateInputSchema,
  auditRangeOperationInputSchema,
  auditRangeParamsSchema,
  auditRangeStatusQuerySchema,
  auditRangeJobSchema,
} from "@repo/contracts/audit/schemas";
import type {
  AuditRangeCreateInput,
  AuditRangeOperationInput,
  AuditRangeParams,
  AuditRangeStatusQuery,
} from "@repo/contracts/audit/types";
import {
  CurrentUser,
  RequirePermissions,
  type RequestUser,
} from "../../auth/auth.types";
import { ZodResponse } from "../../common/http/zod-response.interceptor";
import {
  zodBody,
  zodParams,
  zodQuery,
} from "../../common/pipes/zod-validation.pipe";
import { AuditRangeUseCases } from "./application/audit-range.use-cases";
import { AuditRangeDeniedFilter } from "./audit-range-denied.filter";
import {
  AuditRangeInputError,
  AuditRangeConflictError,
  AuditRangeForbiddenError,
  AuditRangeNotFoundError,
  AuditRangeUnavailableError,
} from "./audit-range.errors";
@UseFilters(AuditRangeDeniedFilter)
@Controller("audit/chain-verifications")
export class AuditRangeController {
  constructor(private readonly audit: AuditRangeUseCases) {}
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions("can_view_audit")
  @ZodResponse(auditRangeJobSchema)
  create(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(auditRangeCreateInputSchema)) input: AuditRangeCreateInput,
  ) {
    return this.safe(() => this.audit.create(user, input));
  }
  @Get(":jobId")
  @RequirePermissions("can_view_audit")
  @ZodResponse(auditRangeJobSchema)
  status(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(auditRangeParamsSchema)) params: AuditRangeParams,
    @Query(zodQuery(auditRangeStatusQuerySchema)) query: AuditRangeStatusQuery,
  ) {
    return this.safe(() =>
      this.audit.status(user, params.jobId, query.requestId),
    );
  }
  @Post(":jobId/cancel")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("can_view_audit")
  @ZodResponse(auditRangeJobSchema)
  cancel(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(auditRangeParamsSchema)) params: AuditRangeParams,
    @Body(zodBody(auditRangeOperationInputSchema))
    input: AuditRangeOperationInput,
  ) {
    return this.safe(() => this.audit.cancel(user, params.jobId, input));
  }
  @Post(":jobId/resume")
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions("can_view_audit")
  @ZodResponse(auditRangeJobSchema)
  resume(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(auditRangeParamsSchema)) params: AuditRangeParams,
    @Body(zodBody(auditRangeOperationInputSchema))
    input: AuditRangeOperationInput,
  ) {
    return this.safe(() => this.audit.resume(user, params.jobId, input));
  }
  private async safe<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (
        error instanceof AuditRangeForbiddenError ||
        error instanceof AuditRangeNotFoundError
      )
        throw new NotFoundException({
          message: "Not found",
          code: "not_found",
        });
      if (error instanceof AuditRangeInputError)
        throw new BadRequestException({
          message: "Invalid verification range or checkpoint",
          code: "invalid_range",
        });
      if (error instanceof AuditRangeConflictError)
        throw new ConflictException({
          message: "Verification changed; refresh its status",
          code: "conflict",
        });
      if (error instanceof AuditRangeUnavailableError)
        throw new ServiceUnavailableException({
          message: "Audit verification is unavailable",
          code: "audit_unavailable",
        });
      throw error;
    }
  }
}
