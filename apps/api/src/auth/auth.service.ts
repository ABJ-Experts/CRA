import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type {
  ForgotPasswordInput,
  ResetPasswordInput,
  SessionResponse,
  SignInInput,
  SignUpInput,
} from "@repo/contracts/auth";

import { TooManyRequestsException } from "../common/exceptions/too-many-requests.exception";
import {
  AuthenticateUserUseCase,
  IssueVerificationArtifactUseCase,
  ManageEmailVerificationUseCase,
  ManagePasswordRecoveryUseCase,
  ReadSessionQuery,
  ReauthenticateUserUseCase,
  RefreshSessionUseCase,
  RegisterUserUseCase,
  RequestPasswordResetUseCase,
  SignOutEverywhereUseCase,
} from "./application/auth-use-cases";
import {
  AuthSecurityAudit,
  type AuthAuditContext,
} from "./application/auth-security-audit";

interface Tokens {
  access_token: string;
  refresh_token: string;
}
const wireTokens = (
  tokens: Readonly<{ accessToken: string; refreshToken: string }>,
): Tokens => ({
  access_token: tokens.accessToken,
  refresh_token: tokens.refreshToken,
});

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly registerUser: RegisterUserUseCase,
    private readonly authenticateUser: AuthenticateUserUseCase,
    private readonly refreshSession: RefreshSessionUseCase,
    private readonly signOutAll: SignOutEverywhereUseCase,
    private readonly issueVerification: IssueVerificationArtifactUseCase,
    private readonly emailVerification: ManageEmailVerificationUseCase,
    private readonly requestRecovery: RequestPasswordResetUseCase,
    private readonly passwordRecovery: ManagePasswordRecoveryUseCase,
    private readonly readSession: ReadSessionQuery,
    private readonly reauthenticate: ReauthenticateUserUseCase,
    private readonly securityAudit: AuthSecurityAudit,
  ) {}

  private async critical<T>(
    action: string,
    userId: string | null,
    context: AuthAuditContext | undefined,
    work: () => Promise<T>,
    actorFromResult?: (result: T) => string | null,
  ): Promise<T> {
    let attempt;
    try {
      attempt = await this.securityAudit.beginCritical(action, userId, context);
    } catch {
      throw new ServiceUnavailableException({
        message:
          "This security action is temporarily unavailable. Please try again.",
        code: "audit_unavailable",
      });
    }
    let result: T;
    try {
      result = await work();
    } catch (error) {
      try {
        await this.securityAudit.finishCritical(
          attempt,
          "failed",
          "operation_failed",
        );
      } catch {
        throw new ServiceUnavailableException({
          message:
            "The security action outcome needs review. Please contact support.",
          code: "audit_outcome_uncertain",
        });
      }
      throw error;
    }
    try {
      await this.securityAudit.finishCritical(
        attempt,
        "completed",
        null,
        actorFromResult?.(result),
      );
    } catch {
      throw new ServiceUnavailableException({
        message:
          "The security action outcome needs review. Please contact support.",
        code: "audit_outcome_uncertain",
      });
    }
    return result;
  }

  async signUp(
    input: SignUpInput,
    context?: AuthAuditContext,
  ): Promise<{ tokens: Tokens; userId: string }> {
    return this.critical(
      "auth.sign_up",
      null,
      context,
      () => this.signUpCore(input),
      (result) => result.userId,
    );
  }

  private async signUpCore(
    input: SignUpInput,
  ): Promise<{ tokens: Tokens; userId: string }> {
    const result = await this.registerUser.execute(input);
    if (result.ok)
      return {
        tokens: wireTokens(result.value.tokens),
        userId: result.value.userId,
      };
    if (result.error.code === "username_taken")
      throw new ConflictException({
        message: "That user name is already taken.",
        code: "username_taken",
        fieldErrors: { username: "That user name is already taken." },
      });
    if (result.error.code === "email_taken")
      throw new ConflictException({
        message: "That email is already registered.",
        code: "email_taken",
        fieldErrors: { email: "That email is already registered." },
      });
    if (result.error.code === "profile_missing")
      throw new ServiceUnavailableException({
        message: "We could not finish setting up that account.",
        code: "profile_missing",
      });
    if (result.error.code === "auth_unavailable")
      throw new ServiceUnavailableException({
        message: "Sign-up is temporarily unavailable. Please try again.",
        code: "auth_unavailable",
      });
    if (result.error.code === "otp_store_failed")
      throw new ServiceUnavailableException({
        message: "We could not send that code. Please try again.",
        code: "otp_store_failed",
      });
    throw new BadRequestException({
      message: "We could not create that account.",
      code: "signup_failed",
    });
  }

  async signIn(
    input: SignInInput,
    context?: AuthAuditContext,
  ): Promise<{ tokens: Tokens; userId: string; emailVerified: boolean }> {
    let result;
    try {
      result = await this.authenticateUser.execute({
        identifier: input.email,
        password: input.password,
      });
    } catch (error) {
      void this.securityAudit.recordBestEffort(
        "auth.sign_in",
        "failed",
        null,
        context,
        "auth_unavailable",
      );
      throw error;
    }
    if (result.ok) {
      void this.securityAudit.recordBestEffort(
        "auth.sign_in",
        "completed",
        result.value.userId,
        context,
      );
      return {
        tokens: wireTokens(result.value.tokens),
        userId: result.value.userId,
        emailVerified: result.value.emailVerified,
      };
    }
    void this.securityAudit.recordBestEffort(
      "auth.sign_in",
      result.error.code === "invalid_credentials" ||
        result.error.code === "account_locked"
        ? "denied"
        : "failed",
      null,
      context,
      result.error.code,
    );
    if (result.error.code === "account_locked")
      throw new TooManyRequestsException({
        message: "Too many attempts. Please try again later.",
        code: "account_locked",
      });
    if (result.error.code === "auth_unavailable")
      throw new ServiceUnavailableException({
        message: "Sign-in is temporarily unavailable. Please try again.",
        code: "auth_unavailable",
      });
    throw new UnauthorizedException({
      message: "That email and password do not match.",
      code: "invalid_credentials",
    });
  }

  async refresh(
    refreshToken: string,
    context?: AuthAuditContext,
  ): Promise<Tokens> {
    let result;
    try {
      result = await this.refreshSession.execute({ refreshToken });
    } catch (error) {
      void this.securityAudit.recordBestEffort(
        "auth.refresh",
        "failed",
        null,
        context,
        "auth_unavailable",
      );
      throw error;
    }
    void this.securityAudit.recordBestEffort(
      "auth.refresh",
      result.ok ? "completed" : "denied",
      null,
      context,
      result.ok ? null : result.error.code,
    );
    if (result.ok) return wireTokens(result.value);
    if (result.error.code === "auth_unavailable")
      throw new ServiceUnavailableException({
        message: "Sign-in is temporarily unavailable. Please try again.",
        code: "auth_unavailable",
      });
    throw new UnauthorizedException({
      message: "Your session has expired. Please sign in again.",
      code: "refresh_failed",
    });
  }

  noteMfaChallenge(userId: string, context?: AuthAuditContext): void {
    void this.securityAudit.recordBestEffort(
      "auth.mfa_challenge",
      "intent",
      userId,
      context,
    );
  }

  async signOutEverywhere(
    userId: string,
    accessToken: string,
    context?: AuthAuditContext,
  ): Promise<void> {
    return this.critical("auth.sign_out_everywhere", userId, context, () =>
      this.signOutCore(userId, accessToken),
    );
  }

  private async signOutCore(
    userId: string,
    accessToken: string,
  ): Promise<void> {
    const result = await this.signOutAll.execute({ userId, accessToken });
    if (result.ok) return;
    this.logger.error("Session epoch revocation failed");
    throw new ServiceUnavailableException({
      message: "We could not end your sessions. Please try again.",
      code: "revoke_failed",
    });
  }

  async issueVerificationCode(userId: string, email: string): Promise<void> {
    const result = await this.issueVerification.execute({ userId, email });
    if (result.ok) return;
    this.logger.error("Could not store verification artifact");
    throw new ServiceUnavailableException({
      message: "We could not send that code. Please try again.",
      code: "otp_store_failed",
    });
  }

  async verifyEmailCode(userId: string, code: string): Promise<void> {
    const result = await this.emailVerification.execute({ userId, code });
    if (result.ok) return;
    switch (result.error.code) {
      case "otp_missing":
        throw new BadRequestException({
          message: "That code is not right. Request a new one.",
          code: result.error.code,
        });
      case "otp_expired":
        throw new BadRequestException({
          message: "That code has expired. Request a new one.",
          code: result.error.code,
        });
      case "otp_attempts_exhausted":
        throw new TooManyRequestsException({
          message: "Too many attempts. Request a new code.",
          code: result.error.code,
        });
      case "otp_invalid":
        throw new BadRequestException({
          message: "That code is not right. Check it and try again.",
          code: result.error.code,
        });
      case "email_verification_failed":
        this.logger.error("Atomic email verification failed");
        throw new ServiceUnavailableException({
          message:
            "We could not finish verifying your email. Please try again.",
          code: result.error.code,
        });
    }
  }

  async requestPasswordReset(input: ForgotPasswordInput): Promise<void> {
    await this.requestRecovery.execute({ email: input.email });
  }

  async resetPassword(
    input: ResetPasswordInput,
    context?: AuthAuditContext,
  ): Promise<void> {
    return this.critical("auth.password_reset", null, context, () =>
      this.resetPasswordCore(input),
    );
  }

  private async resetPasswordCore(input: ResetPasswordInput): Promise<void> {
    const result = await this.passwordRecovery.execute(input);
    if (result.ok) return;
    if (
      result.error.code === "reset_token_invalid" ||
      result.error.code === "reset_token_expired"
    )
      throw new BadRequestException({
        message: "That reset link has expired.",
        code: result.error.code,
      });
    if (result.error.code === "password_reset_unavailable") {
      this.logger.error(
        "Password reset consumption failed before provider update",
      );
      throw new ServiceUnavailableException({
        message: "We could not update that password.",
        code: "password_update_failed",
      });
    }
    this.logger.error("Password update failed after reset token consumption");
    throw new BadRequestException({
      message: "We could not update that password.",
      code: "password_update_failed",
    });
  }

  async session(
    userId: string,
    organizationId: string | null,
  ): Promise<SessionResponse> {
    const result = await this.readSession.execute({ userId, organizationId });
    if (result.ok) return result.value as SessionResponse;
    throw new UnauthorizedException({
      message: "Your account is not set up.",
      code: "profile_missing",
    });
  }

  async verifyPassword(
    email: string,
    password: string,
    context?: AuthAuditContext,
    actorId?: string,
  ): Promise<boolean> {
    const result = await this.reauthenticate.execute({ email, password });
    void this.securityAudit.recordBestEffort(
      "auth.reauthenticate",
      result.ok ? (result.value ? "completed" : "denied") : "failed",
      actorId ?? null,
      context,
      result.ok
        ? result.value
          ? null
          : "invalid_credentials"
        : result.error.code,
    );
    if (result.ok) return result.value;
    if (result.error.code === "auth_unavailable")
      throw new ServiceUnavailableException({
        message: "Sign-in is temporarily unavailable. Please try again.",
        code: "auth_unavailable",
      });
    throw new TooManyRequestsException({
      message: "Too many attempts. Please try again later.",
      code: "account_locked",
    });
  }
}
