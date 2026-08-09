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
import type { AuthNext } from "@repo/contracts/auth";
import { twoFactorSchema } from "@repo/contracts/auth";
import type { Response } from "express";
import { z } from "zod";

import { zodBody } from "../../common/pipes/zod-validation.pipe";
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

const enrollConfirmSchema = z.object({
  factorId: z.string().min(1),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code"),
});

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
  async enroll(@CurrentUser() user: RequestUser) {
    return this.mfa.enroll(user.accessToken);
  }

  @SelfScoped("Confirms enrolment of the caller's own factor.")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("mfa/enroll/confirm")
  @HttpCode(HttpStatus.OK)
  async confirm(
    @Body(zodBody(enrollConfirmSchema))
    dto: z.infer<typeof enrollConfirmSchema>,
    @CurrentUser() user: RequestUser,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ recoveryCodes: string[] }> {
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
  async factors(@CurrentUser() user: RequestUser) {
    return { enrolled: await this.mfa.hasVerifiedFactor(user.accessToken) };
  }

  @SelfScoped("Removes a factor from the caller's own account.")
  @Delete("mfa/factors/:id")
  @HttpCode(HttpStatus.OK)
  async unenroll(
    @Param("id") id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<{ ok: true }> {
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
  async verifyTwoFactor(
    @Body(zodBody(twoFactorSchema)) dto: { code: string; recovery: boolean },
    @CurrentUser() user: RequestUser,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ next: AuthNext }> {
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
