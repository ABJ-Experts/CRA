import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";

import {
  ConfirmMfaEnrollmentUseCase,
  EnrollMfaUseCase,
  HasVerifiedMfaQuery,
  RecoverMfaUseCase,
  UnenrollMfaUseCase,
  VerifyMfaUseCase,
} from "../application/auth-use-cases";
import {
  AuthSecurityAudit,
  type AuthAuditContext,
} from "../application/auth-security-audit";

class MfaRecoveryOutcomeUncertainError extends Error {}

@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);

  constructor(
    private readonly enrollMfa: EnrollMfaUseCase,
    private readonly confirmMfa: ConfirmMfaEnrollmentUseCase,
    private readonly verifyMfa: VerifyMfaUseCase,
    private readonly recoverMfa: RecoverMfaUseCase,
    private readonly hasMfa: HasVerifiedMfaQuery,
    private readonly unenrollMfa: UnenrollMfaUseCase,
    private readonly securityAudit: AuthSecurityAudit,
  ) {}

  private async critical<T>(
    action: string,
    userId: string,
    context: AuthAuditContext | undefined,
    work: () => Promise<T>,
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
      if (error instanceof MfaRecoveryOutcomeUncertainError) {
        throw new ServiceUnavailableException({
          message:
            "The security action outcome needs review. Please contact support.",
          code: "audit_outcome_uncertain",
        });
      }
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
      await this.securityAudit.finishCritical(attempt, "completed", null);
    } catch {
      throw new ServiceUnavailableException({
        message:
          "The security action outcome needs review. Please contact support.",
        code: "audit_outcome_uncertain",
      });
    }
    return result;
  }

  async enroll(
    accessToken: string,
    userId: string,
    context?: AuthAuditContext,
  ): Promise<{
    factorId: string;
    qrCode: string;
    secret: string;
    uri: string;
  }> {
    return this.critical("auth.mfa_enroll", userId, context, () =>
      this.enrollCore(accessToken),
    );
  }

  private async enrollCore(accessToken: string): Promise<{
    factorId: string;
    qrCode: string;
    secret: string;
    uri: string;
  }> {
    const result = await this.enrollMfa.execute({ accessToken });
    if (result.ok) return result.value;
    if (result.error.code === "auth_unavailable")
      throw new ServiceUnavailableException({
        message: "Sign-in is temporarily unavailable. Please try again.",
        code: "auth_unavailable",
      });
    throw new BadRequestException({
      message: "We could not start two-factor setup.",
      code: "mfa_enroll_failed",
    });
  }

  async confirmEnrollment(
    accessToken: string,
    userId: string,
    factorId: string,
    code: string,
    context?: AuthAuditContext,
  ): Promise<{
    recoveryCodes: string[];
    tokens: { access_token: string; refresh_token: string };
  }> {
    return this.critical("auth.mfa_confirm", userId, context, () =>
      this.confirmCore(accessToken, userId, factorId, code),
    );
  }

  private async confirmCore(
    accessToken: string,
    userId: string,
    factorId: string,
    code: string,
  ): Promise<{
    recoveryCodes: string[];
    tokens: { access_token: string; refresh_token: string };
  }> {
    const result = await this.confirmMfa.execute({
      accessToken,
      userId,
      factorId,
      code,
    });
    if (result.ok)
      return {
        recoveryCodes: [...result.value.recoveryCodes],
        tokens: {
          access_token: result.value.tokens.accessToken,
          refresh_token: result.value.tokens.refreshToken,
        },
      };
    if (result.error.code === "mfa_challenge_failed")
      throw new BadRequestException({
        message: "We could not verify that code.",
        code: result.error.code,
      });
    if (result.error.code === "auth_unavailable")
      throw new ServiceUnavailableException({
        message: "Sign-in is temporarily unavailable. Please try again.",
        code: "auth_unavailable",
      });
    if (result.error.code === "mfa_invalid_code")
      throw new BadRequestException({
        message: "That code is not right. Check your authenticator app.",
        code: result.error.code,
      });
    throw new BadRequestException({
      message: "We could not create your recovery codes.",
      code: "mfa_recovery_generate_failed",
    });
  }

  async verify(
    accessToken: string,
    userId: string,
    code: string,
    context?: AuthAuditContext,
  ): Promise<{ access_token: string; refresh_token: string }> {
    const result = await this.verifyMfa.execute({ accessToken, userId, code });
    void this.securityAudit.recordBestEffort(
      "auth.mfa_challenge",
      result.ok ? "completed" : "denied",
      userId,
      context,
      result.ok ? null : result.error.code,
    );
    if (result.ok)
      return {
        access_token: result.value.accessToken,
        refresh_token: result.value.refreshToken,
      };
    if (result.error.code === "auth_unavailable")
      throw new ServiceUnavailableException({
        message: "Sign-in is temporarily unavailable. Please try again.",
        code: "auth_unavailable",
      });
    if (result.error.code === "mfa_factors_failed")
      throw new BadRequestException({
        message: "We could not verify that code.",
        code: result.error.code,
      });
    if (result.error.code === "mfa_not_enrolled")
      throw new BadRequestException({
        message: "Two-factor authentication is not set up on this account.",
        code: result.error.code,
      });
    if (result.error.code === "mfa_challenge_failed")
      throw new BadRequestException({
        message: "We could not verify that code.",
        code: result.error.code,
      });
    throw new UnauthorizedException({
      message: "That code is not right. Check your authenticator app.",
      code: "mfa_invalid_code",
    });
  }

  async redeemRecoveryCode(
    userId: string,
    authUserId: string,
    code: string,
    context?: AuthAuditContext,
  ): Promise<void> {
    return this.critical("auth.mfa_recovery", userId, context, () =>
      this.redeemRecoveryCodeCore(userId, authUserId, code),
    );
  }

  private async redeemRecoveryCodeCore(
    userId: string,
    authUserId: string,
    code: string,
  ): Promise<void> {
    const result = await this.recoverMfa.execute({ userId, authUserId, code });
    if (result.ok) return;
    if (result.error.code === "mfa_recovery_invalid")
      throw new UnauthorizedException({
        message: "That recovery code is not valid.",
        code: result.error.code,
      });
    if (result.error.code === "mfa_recovery_uncertain")
      throw new MfaRecoveryOutcomeUncertainError();
    this.logger.error(
      `MFA recovery failed for user ${userId} with sanitized code auth_unavailable`,
    );
    throw new ServiceUnavailableException({
      message: "Sign-in is temporarily unavailable. Please try again.",
      code: "auth_unavailable",
    });
  }

  async hasVerifiedFactor(accessToken: string): Promise<boolean> {
    const result = await this.hasMfa.execute({ accessToken });
    if (result.ok) return result.value;
    this.logger.error("MFA factor lookup failed");
    throw new ServiceUnavailableException({
      message: "Sign-in is temporarily unavailable. Please try again.",
      code: "auth_unavailable",
    });
  }

  async unenroll(
    accessToken: string,
    userId: string,
    factorId: string,
    context?: AuthAuditContext,
  ): Promise<void> {
    return this.critical("auth.mfa_unenroll", userId, context, () =>
      this.unenrollCore(accessToken, userId, factorId),
    );
  }

  private async unenrollCore(
    accessToken: string,
    userId: string,
    factorId: string,
  ): Promise<void> {
    const result = await this.unenrollMfa.execute({
      accessToken,
      userId,
      factorId,
    });
    if (result.ok) return;
    if (result.error.code === "auth_unavailable")
      throw new ServiceUnavailableException({
        message: "Sign-in is temporarily unavailable. Please try again.",
        code: "auth_unavailable",
      });
    throw new BadRequestException({
      message: "We could not turn off two-factor authentication.",
      code: "mfa_unenroll_failed",
    });
  }
}
