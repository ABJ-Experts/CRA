import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Throttle } from "@nestjs/throttler";
import {
  authNextResponseSchema,
  mfaConfirmInputSchema,
  mfaConfirmResponseSchema,
  mfaEnrollmentResponseSchema,
  mfaFactorParamSchema,
  mfaFactorsResponseSchema,
  twoFactorInputSchema,
} from "@repo/contracts/auth/schemas";
import type {
  AuthNextResponse,
  MfaConfirmInput,
  MfaConfirmResponse,
  MfaEnrollmentResponse,
  MfaFactorParam,
  MfaFactorsResponse,
  TwoFactorInput,
} from "@repo/contracts/auth/types";
import { okResponseSchema } from "@repo/contracts/shared/schemas";
import type { OkResponse } from "@repo/contracts/shared/types";
import type { Response } from "express";

import { ZodResponse } from "../../common/http/zod-response.interceptor";
import { zodBody, zodParams } from "../../common/pipes/zod-validation.pipe";
import {
  AllowMfaPending,
  CurrentUser,
  SelfScoped,
  type AuthedRequest,
  type RequestUser,
} from "../auth.types";
import {
  clearMfaCookie,
  readRememberMeCookie,
  setSessionCookies,
  type CookieConfig,
} from "../cookies.util";
import { MfaService } from "./mfa.service";

/**
 * Two-factor authentication.
 *
 * `POST two-factor/verify` is the endpoint the FROZEN `verifyTwoFactor({code,
 * recovery})` in `auth-actions.ts` calls. Like the other frozen actions it
 * carries no identity — the pending user comes from the session, which at this
 * point is aal1 and carries the `cra_mfa` marker.
 *
 * That marker is why this route needs `@AllowMfaPending()`: the global guard
 * rejects any request from a session that still owes a challenge, which would
 * otherwise make the verification endpoint itself unreachable.
 */
@Controller("auth")
export class MfaController {
  private readonly cookieConfig: CookieConfig;

  constructor(
    private readonly mfa: MfaService,
    private readonly config: ConfigService,
  ) {
    this.cookieConfig = {
      domain: this.config.get<string>("COOKIE_DOMAIN") ?? "",
      secure: this.config.get<boolean>("COOKIE_SECURE") ?? false,
      sameSite:
        this.config.get<"lax" | "strict" | "none">("COOKIE_SAMESITE") ?? "lax",
      accessMaxAge: this.config.getOrThrow<number>("ACCESS_TOKEN_MAX_AGE"),
      refreshMaxAge: this.config.getOrThrow<number>("REFRESH_TOKEN_MAX_AGE"),
      signingSecret: this.config.getOrThrow<string>("COOKIE_SIGNING_SECRET"),
    };
  }

  @SelfScoped("Enrols a second factor on the caller's own account.")
  @Post("mfa/enroll")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(mfaEnrollmentResponseSchema)
  async enroll(
    @CurrentUser() user: RequestUser,
  ): Promise<MfaEnrollmentResponse> {
    return this.mfa.enroll(user.accessToken);
  }

  @SelfScoped("Confirms enrolment of the caller's own factor.")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("mfa/enroll/confirm")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(mfaConfirmResponseSchema)
  async confirm(
    @Body(zodBody(mfaConfirmInputSchema)) dto: MfaConfirmInput,
    @CurrentUser() user: RequestUser,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MfaConfirmResponse> {
    // Shown exactly once — only hashes are stored, so there is no way to
    // retrieve them later.
    const { recoveryCodes, tokens } = await this.mfa.confirmEnrollment(
      user.accessToken,
      user.id,
      dto.factorId,
      dto.code,
    );
    const cookies = req.cookies as Record<string, string> | undefined;
    setSessionCookies(res, tokens, this.cookieConfig, {
      rememberMe: readRememberMeCookie(cookies, this.cookieConfig),
    });
    return { recoveryCodes };
  }

  @SelfScoped("Reports the caller's own enrolled factors.")
  @Get("mfa/factors")
  @ZodResponse(mfaFactorsResponseSchema)
  async factors(@CurrentUser() user: RequestUser): Promise<MfaFactorsResponse> {
    return { enrolled: await this.mfa.hasVerifiedFactor(user.accessToken) };
  }

  @SelfScoped("Removes a factor from the caller's own account.")
  @Delete("mfa/factors/:id")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(okResponseSchema)
  async unenroll(
    @Param(zodParams(mfaFactorParamSchema)) { id }: MfaFactorParam,
    @CurrentUser() user: RequestUser,
  ): Promise<OkResponse> {
    await this.mfa.unenroll(user.accessToken, user.id, id);
    return { ok: true };
  }

  /**
   * The frozen screen's endpoint.
   *
   * `@AllowMfaPending()` is mandatory: without it the guard rejects the very
   * session that is trying to complete its challenge.
   */
  @AllowMfaPending()
  @SelfScoped("Completes the caller's own pending MFA challenge.")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("two-factor/verify")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(authNextResponseSchema)
  async verifyTwoFactor(
    @Body(zodBody(twoFactorInputSchema)) dto: TwoFactorInput,
    @CurrentUser() user: RequestUser,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthNextResponse> {
    if (dto.recovery) {
      await this.mfa.redeemRecoveryCode(user.id, user.authUserId, dto.code);
    } else {
      const tokens = await this.mfa.verify(user.accessToken, user.id, dto.code);
      const cookies = req.cookies as Record<string, string> | undefined;
      setSessionCookies(res, tokens, this.cookieConfig, {
        rememberMe: readRememberMeCookie(cookies, this.cookieConfig),
      });
    }

    // Challenge settled — clear the browser routing marker. Server-side access
    // is controlled by a verified factor plus the token's `aal` claim.
    clearMfaCookie(res, this.cookieConfig);
    return { next: "dashboard" };
  }
}
