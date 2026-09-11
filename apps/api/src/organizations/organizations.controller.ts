import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Patch,
  Post,
  Res,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Response } from "express";
import {
  createOrganizationInputSchema,
  currentOrganizationResponseSchema,
  onboardingResponseSchema,
  organizationSchema,
  switchOrganizationInputSchema,
  switchOrganizationResponseSchema,
  updateLegalProfileInputSchema,
} from "@repo/contracts/organizations/schemas";
import type {
  CreateOrganizationInput,
  CurrentOrganizationResponse,
  OnboardingResponse,
  Organization,
  SwitchOrganizationInput,
  SwitchOrganizationResponse,
  UpdateLegalProfileInput,
} from "@repo/contracts/organizations/types";

import {
  CurrentUser,
  RequirePermissions,
  SelfScoped,
  type RequestUser,
} from "../auth/auth.types";
import { ZodResponse } from "../common/http/zod-response.interceptor";
import { zodBody } from "../common/pipes/zod-validation.pipe";
import { setActiveOrgCookie, type CookieConfig } from "../auth/cookies.util";
import { OrganizationsService } from "./organizations.service";

@Controller("organizations")
export class OrganizationsController {
  private readonly cookieConfig: CookieConfig;

  constructor(
    private readonly organizations: OrganizationsService,
    config: ConfigService,
  ) {
    this.cookieConfig = {
      domain: config.get<string>("COOKIE_DOMAIN") ?? "",
      secure: config.get<boolean>("COOKIE_SECURE") ?? false,
      sameSite:
        config.get<"lax" | "strict" | "none">("COOKIE_SAMESITE") ?? "lax",
      accessMaxAge: config.getOrThrow<number>("ACCESS_TOKEN_MAX_AGE"),
      refreshMaxAge: config.getOrThrow<number>("REFRESH_TOKEN_MAX_AGE"),
      signingSecret: config.getOrThrow<string>("COOKIE_SIGNING_SECRET"),
    };
  }

  @SelfScoped("Creates an organization only for the authenticated caller.")
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ZodResponse(organizationSchema)
  async create(
    @Body(zodBody(createOrganizationInputSchema)) dto: CreateOrganizationInput,
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Organization> {
    const organization = await this.organizations.create(
      { id: user.id, email: user.email },
      dto,
    );
    await this.setVerifiedActiveOrganization(res, organization.id, user.id);
    return organization;
  }

  @RequirePermissions("can_view_organization")
  @Get("current")
  @ZodResponse(currentOrganizationResponseSchema)
  async current(
    @CurrentUser() user: RequestUser,
  ): Promise<CurrentOrganizationResponse> {
    return {
      organization: await this.organizations.current(
        user.organizationId,
        user.id,
      ),
    };
  }

  @RequirePermissions("can_edit_organization")
  @Patch("current/legal-profile")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(organizationSchema)
  async updateLegalProfile(
    @Body(zodBody(updateLegalProfileInputSchema)) dto: UpdateLegalProfileInput,
    @CurrentUser() user: RequestUser,
  ): Promise<Organization> {
    return this.organizations.updateLegalProfile(
      this.activeOrganizationId(user),
      { id: user.id, email: user.email },
      dto,
    );
  }

  @RequirePermissions("can_view_organization")
  @Get("current/onboarding")
  @ZodResponse(onboardingResponseSchema)
  async onboarding(
    @CurrentUser() user: RequestUser,
  ): Promise<OnboardingResponse> {
    return this.organizations.onboarding(
      this.activeOrganizationId(user),
      user.id,
    );
  }

  @SelfScoped("Switches only among memberships of the authenticated caller.")
  @Post("switch")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(switchOrganizationResponseSchema)
  async switch(
    @Body(zodBody(switchOrganizationInputSchema)) dto: SwitchOrganizationInput,
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SwitchOrganizationResponse> {
    const organization = await this.organizations.switch(dto.organizationId, {
      id: user.id,
      email: user.email,
    });
    await this.setVerifiedActiveOrganization(res, organization.id, user.id);
    return {
      organization,
    };
  }

  private activeOrganizationId(user: RequestUser): string {
    if (user.organizationId) return user.organizationId;
    throw new NotFoundException({
      message: "Organization not found.",
      code: "organization_not_found",
    });
  }

  private async setVerifiedActiveOrganization(
    res: Response,
    organizationId: string,
    userId: string,
  ): Promise<void> {
    if (!(await this.organizations.verifyMembership(organizationId, userId))) {
      throw new NotFoundException({
        message: "Organization not found.",
        code: "organization_not_found",
      });
    }
    setActiveOrgCookie(res, organizationId, this.cookieConfig);
  }
}
