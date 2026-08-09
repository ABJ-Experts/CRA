import type { Result } from "../../common/domain/result";
import type { AuthIdentityProvider } from "./auth-identity-provider.port";
import type {
  AuthProfileRepository,
  PasswordResetClaim,
  VerificationOutcome,
} from "./auth-profile-repository.port";
import type {
  MfaRecoveryClaim,
  MfaRecoveryRepository,
} from "./mfa-recovery-repository.port";

export interface SecretHashPort {
  hash(value: string): string;
}

export interface DelayPort {
  wait(milliseconds: number): Promise<void>;
}

type EmailVerificationErrorCode =
  | "otp_missing"
  | "otp_expired"
  | "otp_attempts_exhausted"
  | "otp_invalid"
  | "email_verification_failed";

type PasswordRecoveryErrorCode =
  | "reset_token_invalid"
  | "reset_token_expired"
  | "password_reset_unavailable"
  | "password_update_failed";

type MfaRecoveryErrorCode = "mfa_recovery_invalid" | "auth_unavailable";

const success = (): Result<void, never> =>
  Object.freeze({ ok: true, value: undefined });

const failure = <Code extends string>(
  code: Code,
): Result<never, Readonly<{ code: Code }>> =>
  Object.freeze({ ok: false, error: Object.freeze({ code }) });

const EMAIL_ERRORS: Readonly<
  Record<Exclude<VerificationOutcome, "verified">, EmailVerificationErrorCode>
> = Object.freeze({
  missing: "otp_missing",
  expired: "otp_expired",
  attempts_exhausted: "otp_attempts_exhausted",
  invalid: "otp_invalid",
});

export class ManageEmailVerificationUseCase {
  constructor(
    private readonly profiles: AuthProfileRepository,
    private readonly hashes: SecretHashPort,
    private readonly maxAttempts: number,
  ) {}

  async execute(
    command: Readonly<{ userId: string; code: string }>,
  ): Promise<Result<void, Readonly<{ code: EmailVerificationErrorCode }>>> {
    try {
      const outcome = await this.profiles.verifyEmailCode(
        command.userId,
        this.hashes.hash(command.code),
        this.maxAttempts,
      );
      return outcome === "verified"
        ? success()
        : failure(EMAIL_ERRORS[outcome]);
    } catch {
      return failure("email_verification_failed");
    }
  }
}

export class ManagePasswordRecoveryUseCase {
  constructor(
    private readonly profiles: AuthProfileRepository,
    private readonly identity: AuthIdentityProvider,
    private readonly hashes: SecretHashPort,
  ) {}

  async execute(
    command: Readonly<{ token: string; password: string }>,
  ): Promise<Result<void, Readonly<{ code: PasswordRecoveryErrorCode }>>> {
    let claim: PasswordResetClaim;
    try {
      claim = await this.profiles.consumePasswordReset(
        this.hashes.hash(command.token),
      );
    } catch {
      return failure("password_reset_unavailable");
    }
    if (claim.outcome !== "consumed") {
      return failure(
        claim.outcome === "expired"
          ? "reset_token_expired"
          : "reset_token_invalid",
      );
    }
    try {
      await this.identity.updatePassword(claim.authUserId, command.password);
      return success();
    } catch {
      return failure("password_update_failed");
    }
  }
}

type ActiveRecoveryClaim = Exclude<MfaRecoveryClaim, { outcome: "invalid" }>;

export class RecoverMfaUseCase {
  constructor(
    private readonly recovery: MfaRecoveryRepository,
    private readonly identity: AuthIdentityProvider,
    private readonly hashes: SecretHashPort,
    private readonly delay: DelayPort,
    private readonly pollAttempts = 60,
    private readonly pollDelayMs = 250,
  ) {}

  async execute(
    command: Readonly<{
      userId: string;
      authUserId: string;
      code: string;
    }>,
  ): Promise<Result<void, Readonly<{ code: MfaRecoveryErrorCode }>>> {
    let claim: MfaRecoveryClaim;
    try {
      const normalized = command.code.trim().toLowerCase().replace(/-/g, "");
      claim = await this.recovery.claim(
        command.userId,
        this.hashes.hash(normalized),
      );
    } catch {
      return failure("auth_unavailable");
    }

    if (claim.outcome === "invalid") return failure("mfa_recovery_invalid");
    if (
      claim.authUserId !== command.authUserId ||
      claim.status === "completed"
    ) {
      return failure("auth_unavailable");
    }
    if (claim.outcome === "in_progress") {
      return this.waitForCompletion(claim, command.userId);
    }

    if (claim.status !== "factors_removed") {
      const removed = await this.removeFactors(claim, command.userId);
      if (!removed) return failure("auth_unavailable");
      try {
        await this.recovery.markFactorsRemoved(
          claim.operationId,
          command.userId,
        );
      } catch {
        return failure("auth_unavailable");
      }
    }

    try {
      await this.recovery.complete(claim.operationId, command.userId);
      return success();
    } catch {
      return failure("auth_unavailable");
    }
  }

  private async waitForCompletion(
    claim: ActiveRecoveryClaim,
    userId: string,
  ): Promise<Result<void, Readonly<{ code: "auth_unavailable" }>>> {
    for (let attempt = 0; attempt < this.pollAttempts; attempt += 1) {
      try {
        const status = await this.recovery.status(claim.operationId, userId);
        if (status === "completed") return success();
        if (status === "failed") return failure("auth_unavailable");
      } catch {
        return failure("auth_unavailable");
      }
      try {
        await this.delay.wait(this.pollDelayMs);
      } catch {
        return failure("auth_unavailable");
      }
    }
    return failure("auth_unavailable");
  }

  private async removeFactors(
    claim: ActiveRecoveryClaim,
    userId: string,
  ): Promise<boolean> {
    let factors: readonly Readonly<{ id: string }>[];
    try {
      factors = await this.identity.listMfaFactors(claim.authUserId);
    } catch {
      await this.persistProviderFailure(
        claim.operationId,
        userId,
        "list_factors_failed",
      );
      return false;
    }

    for (const factor of factors) {
      if (!factor.id) {
        await this.persistProviderFailure(
          claim.operationId,
          userId,
          "list_factors_failed",
        );
        return false;
      }
      try {
        await this.identity.deleteMfaFactor(claim.authUserId, factor.id);
      } catch {
        await this.persistProviderFailure(
          claim.operationId,
          userId,
          "delete_factor_failed",
        );
        return false;
      }
    }
    return true;
  }

  private async persistProviderFailure(
    operationId: string,
    userId: string,
    errorCode: "list_factors_failed" | "delete_factor_failed",
  ): Promise<void> {
    try {
      await this.recovery.fail(operationId, userId, errorCode);
    } catch {
      // The caller still receives the same conservative failure. There is no
      // safe compensating action after a provider-side factor deletion.
    }
  }
}
