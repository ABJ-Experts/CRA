import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  ForbiddenException,
} from "@nestjs/common";
import {
  licenseActivationInputSchema,
  licenseActivationResponseSchema,
  licenseCurrentResponseSchema,
  licenseHistoryQuerySchema,
  licenseHistoryResponseSchema,
  licensePolicyResponseSchema,
} from "@repo/contracts/licensing/schemas";
import type {
  LicenseActivationInput,
  LicenseHistoryQuery,
} from "@repo/contracts/licensing/types";
import {
  CurrentUser,
  RequirePermissions,
  SelfScoped,
  type RequestUser,
} from "../auth/auth.types";
import { ZodResponse } from "../common/http/zod-response.interceptor";
import { zodBody, zodQuery } from "../common/pipes/zod-validation.pipe";
import { licensingHttp } from "./infrastructure/licensing-http";
import { LicensingService } from "./application/licensing.service";
@Controller("licensing")
export class LicensingController {
  constructor(private readonly licensing: LicensingService) {}
  @Get("policy")
  @SelfScoped(
    "Minimal policy is scoped to verified current membership; it grants no user authorization.",
  )
  @ZodResponse(licensePolicyResponseSchema)
  policy(@CurrentUser() user: RequestUser) {
    return licensingHttp(() =>
      this.licensing.getPolicy(this.org(user), user.id),
    );
  }
  @Get("current")
  @RequirePermissions("can_view_licensing")
  @ZodResponse(licenseCurrentResponseSchema)
  current(@CurrentUser() user: RequestUser) {
    return licensingHttp(() =>
      this.licensing.getCurrent(this.org(user), user.id),
    );
  }
  @Get("history")
  @RequirePermissions("can_view_licensing")
  @ZodResponse(licenseHistoryResponseSchema)
  history(
    @CurrentUser() user: RequestUser,
    @Query(zodQuery(licenseHistoryQuerySchema)) query: LicenseHistoryQuery,
  ) {
    return licensingHttp(() =>
      this.licensing.getHistory(this.org(user), user.id, query),
    );
  }
  @Post("activate")
  @HttpCode(200)
  @RequirePermissions("can_manage_licensing")
  @ZodResponse(licenseActivationResponseSchema)
  activate(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(licenseActivationInputSchema)) input: LicenseActivationInput,
  ) {
    return licensingHttp(() =>
      this.licensing.activate(this.org(user), user.id, input),
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
