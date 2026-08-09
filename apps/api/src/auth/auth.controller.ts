import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import type {
  AuthNext,
  SessionResponse,
  SignInInput,
  SignUpInput,
} from "@repo/contracts/auth";
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
  unlockSchema,
  verifyEmailSchema,
} from "@repo/contracts/auth";

import { zodBody } from "../common/pipes/zod-validation.pipe";
import { AuthService } from "./auth.service";
import { MfaService } from "./mfa/mfa.service";
import { CurrentUser, Public, type AuthedRequest } from "./auth.types";
import {
  PENDING_COOKIE,
  REFRESH_COOKIE,
  clearPendingCookie,
  clearSessionCookies,
  readRememberMeCookie,
  setMfaCookie,
  setPendingCookie,
  setSessionCookies,
  unsign,
  type CookieConfig,
} from "./cookies.util";

/**
 * The auth surface.
 *
 * Shaped by a hard constraint: `apps/web/app/(auth)/_components/auth-actions.ts`
 * is FROZEN, and three of its eight functions carry no identity at all —
 * `verifyCode({code})`, `unlock({password})` and `resendCode()` (no arguments
 * whatsoever). The pending user is therefore resolved from the signed,
 * HttpOnly `cra_pending` cookie rather than from the request body, which is
 * also why email verification is ours rather than GoTrue's.
 *
 * Rate limits are per-route because the interesting attack is a burst against
 * one endpoint, not overall volume. They complement, and do not replace, the
 * durable per-account lockout in the database — per-IP limits are evaded by
 * rotating IPs.
 */
@Controller("auth")
export class AuthController {
  private readonly cookieConfig: CookieConfig;

  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
    private readonly mfa: MfaService,
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

  // -------------------------------------------------------------------------

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("sign-up")
  @HttpCode(HttpStatus.CREATED)
  async signUp(
    @Body(zodBody(signUpSchema)) dto: SignUpInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ next: AuthNext }> {
    const { tokens, userId } = await this.auth.signUp(dto);

    /*
     * The session is issued immediately — GoTrue has confirmed the account
     * (enable_confirmations is false) — but `cra_pending` is set alongside it.
     * The web middleware treats a pending cookie as "not finished yet" and
     * holds the user on /verify, so the account exists and is authenticated
     * while still being gated behind the code.
     */
    setSessionCookies(res, tokens, this.cookieConfig);
    setPendingCookie(res, userId, this.cookieConfig);

    return { next: "verify" };
  }

  @Public()
  // Tighter than the others: this is the endpoint worth guessing at.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("sign-in")
  @HttpCode(HttpStatus.OK)
  async signIn(
    @Body(zodBody(signInSchema)) dto: SignInInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ next: AuthNext }> {
    const { tokens, userId, emailVerified } = await this.auth.signIn(dto);

    setSessionCookies(res, tokens, this.cookieConfig, {
      rememberMe: dto.remember,
    });

    // A signed pending cookie restores the verification screen after a user
    // signs in before finishing email confirmation. The API guard still checks
    // the database flag, so deleting this browser-only routing marker cannot
    // grant access.
    if (!emailVerified) {
      setPendingCookie(res, userId, this.cookieConfig);
      return { next: "verify" };
    }

    // The cookie is UX only. The guard checks GoTrue's verified-factor state
    // and the JWT's `aal` claim, so deleting the cookie cannot bypass MFA.
    if (await this.mfa.hasVerifiedFactor(tokens.access_token)) {
      setMfaCookie(res, userId, this.cookieConfig);
      return { next: "two-factor" };
    }

    return { next: "dashboard" };
  }

  /**
   * GET, and a REDIRECT rather than JSON.
   *
   * The web middleware bounces an expired navigation straight here as a
   * top-level navigation; answering with JSON would leave the user staring at a
   * raw response body. `redirectTo` is validated as a same-site path before
   * being used — accepting an absolute URL here would make this an open
   * redirect that happens to also hand over a fresh session.
   */
  @Public()
  @Get("refresh")
  async refresh(
    @Req() req: AuthedRequest,
    @Res() res: Response,
    @Query("redirectTo") redirectTo?: string,
  ): Promise<void> {
    const cookies = req.cookies as Record<string, string> | undefined;
    const refreshToken = cookies?.[REFRESH_COOKIE];
    const appUrl = this.config
      .getOrThrow<string>("APP_URL")
      .replace(/\/+$/, "");

    const safePath =
      redirectTo && redirectTo.startsWith("/") && !redirectTo.startsWith("//")
        ? redirectTo
        : "/dashboard";

    if (!refreshToken) {
      clearSessionCookies(res, this.cookieConfig);
      res.redirect(`${appUrl}/sign-in`);
      return;
    }

    try {
      const tokens = await this.auth.refresh(refreshToken);
      setSessionCookies(res, tokens, this.cookieConfig, {
        rememberMe: readRememberMeCookie(cookies, this.cookieConfig),
      });
      res.redirect(`${appUrl}${safePath}`);
    } catch {
      clearSessionCookies(res, this.cookieConfig);
      res.redirect(`${appUrl}/sign-in`);
    }
  }

  /** The XHR counterpart, for a client that wants a status rather than a hop. */
  @Public()
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refreshJson(
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const cookies = req.cookies as Record<string, string> | undefined;
    const refreshToken = cookies?.[REFRESH_COOKIE];

    if (!refreshToken) {
      throw new UnauthorizedException({
        message: "Your session has expired. Please sign in again.",
        code: "no_refresh_token",
      });
    }

    const tokens = await this.auth.refresh(refreshToken);
    setSessionCookies(res, tokens, this.cookieConfig, {
      rememberMe: readRememberMeCookie(cookies, this.cookieConfig),
    });
    return { ok: true };
  }

  @Post("sign-out")
  @HttpCode(HttpStatus.OK)
  async signOut(
    @CurrentUser("id") userId: string,
    @CurrentUser("accessToken") accessToken: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    await this.auth.signOutEverywhere(userId, accessToken);
    clearSessionCookies(res, this.cookieConfig);
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // Email verification — driven by cra_pending, never by a body field.
  // -------------------------------------------------------------------------

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("verify-email")
  @HttpCode(HttpStatus.OK)
  async verifyEmail(
    @Body(zodBody(verifyEmailSchema)) dto: { code: string },
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ next: AuthNext }> {
    const userId = this.pendingUserId(req);
    await this.auth.verifyEmailCode(userId, dto.code);
    clearPendingCookie(res, this.cookieConfig);
    return { next: "dashboard" };
  }

  @Public()
  // Deliberately strict: each call sends an email, so this is the endpoint an
  // attacker would use to make us a spam relay against a third party.
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post("resend-code")
  @HttpCode(HttpStatus.OK)
  async resendCode(@Req() req: AuthedRequest): Promise<{ ok: true }> {
    const userId = this.pendingUserId(req);
    const session = await this.auth.session(userId, null);
    await this.auth.issueVerificationCode(userId, session.user.email);
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // Password
  // -------------------------------------------------------------------------

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("forgot-password")
  @HttpCode(HttpStatus.OK)
  async forgotPassword(
    @Body(zodBody(forgotPasswordSchema)) dto: { email: string },
  ): Promise<{ ok: true }> {
    // Always succeeds. Reporting whether the address exists — by status, body,
    // or response time — is an account-enumeration oracle, which is exactly
    // what the frozen stub's comment said when it always returned ok.
    await this.auth.requestPasswordReset(dto);
    return { ok: true };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("reset-password")
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body(zodBody(resetPasswordSchema))
    dto: { token: string; password: string },
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ next: AuthNext }> {
    await this.auth.resetPassword(dto);
    // Every session is now invalid, including any this browser held.
    clearSessionCookies(res, this.cookieConfig);
    return { next: "sign-in" };
  }

  /** Lock Screen re-authentication. Carries no identity — uses the session. */
  @Post("unlock")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async unlock(
    @Body(zodBody(unlockSchema)) dto: { password: string },
    @CurrentUser("email") email: string,
  ): Promise<{ next: AuthNext }> {
    const ok = await this.auth.verifyPassword(email, dto.password);
    if (!ok) {
      throw new UnauthorizedException({
        message: "Wrong password.",
        code: "invalid_credentials",
      });
    }
    return { next: "dashboard" };
  }

  // -------------------------------------------------------------------------
  // Session
  // -------------------------------------------------------------------------

  @Get("session")
  async session(
    @CurrentUser("id") userId: string,
    @CurrentUser("organizationId") organizationId: string | null,
  ): Promise<SessionResponse> {
    return this.auth.session(userId, organizationId);
  }

  // -------------------------------------------------------------------------

  private pendingUserId(req: AuthedRequest): string {
    const cookies = req.cookies as Record<string, string> | undefined;
    const userId = unsign(
      cookies?.[PENDING_COOKIE],
      this.cookieConfig.signingSecret,
    );

    if (!userId) {
      throw new BadRequestException({
        message: "That request has expired. Please sign up again.",
        code: "no_pending_session",
      });
    }

    return userId;
  }
}
