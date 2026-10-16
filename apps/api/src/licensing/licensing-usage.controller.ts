import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  ForbiddenException,
} from "@nestjs/common";
import {
  licenseUsageSnapshotSchema,
  licenseUsageOperationInputSchema,
  licenseUsageExportResponseSchema,
  licenseUsageReconciliationResponseSchema,
  licenseUsageQuerySchema,
} from "@repo/contracts/licensing/schemas";
import type {
  LicenseUsageOperationInput,
  LicenseUsageQuery,
} from "@repo/contracts/licensing/types";
import {
  CurrentUser,
  RequirePermissions,
  type RequestUser,
} from "../auth/auth.types";
import { ZodResponse } from "../common/http/zod-response.interceptor";
import { zodBody, zodQuery } from "../common/pipes/zod-validation.pipe";
import { licensingHttp } from "./infrastructure/licensing-http";
import {
  LICENSING_USAGE_APPLICATION,
  type LicensingUsageApplication,
} from "./application/license-usage.service";

@Controller("licensing/usage")
export class LicensingUsageController {
  constructor(
    @Inject(LICENSING_USAGE_APPLICATION)
    private readonly usage: LicensingUsageApplication,
  ) {}
  @Get()
  @RequirePermissions("can_view_licensing")
  @ZodResponse(licenseUsageSnapshotSchema)
  getUsage(
    @CurrentUser() user: RequestUser,
    @Query(zodQuery(licenseUsageQuerySchema)) _query: LicenseUsageQuery,
  ) {
    void _query;
    return licensingHttp(() => this.usage.getUsage(this.org(user), user.id));
  }
  @Post("export")
  @HttpCode(200)
  @RequirePermissions("can_view_licensing")
  @ZodResponse(licenseUsageExportResponseSchema)
  exportUsage(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(licenseUsageOperationInputSchema))
    input: LicenseUsageOperationInput,
    @Query(zodQuery(licenseUsageQuerySchema)) _query: LicenseUsageQuery,
  ) {
    void _query;
    return licensingHttp(() =>
      this.usage.exportUsage(this.org(user), user.id, input),
    );
  }
  @Post("reconcile")
  @HttpCode(200)
  @RequirePermissions("can_manage_licensing")
  @ZodResponse(licenseUsageReconciliationResponseSchema)
  reconcileUsage(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(licenseUsageOperationInputSchema))
    input: LicenseUsageOperationInput,
    @Query(zodQuery(licenseUsageQuerySchema)) _query: LicenseUsageQuery,
  ) {
    void _query;
    return licensingHttp(() =>
      this.usage.reconcileUsage(this.org(user), user.id, input),
    );
  }
  private org(user: RequestUser): string {
    if (!user.organizationId)
      throw new ForbiddenException({
        code: "forbidden",
        message: "A current organization is required",
      });
    return user.organizationId;
  }
}
