import type { Result } from "../../common/domain/result";
import {
  AuthIdentityProviderUnavailableError,
  AuthIdentityProvider,
  MfaEnrollment,
} from "./auth-identity-provider.port";
import {
  AuthProfileRepositoryUnavailableError,
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

const valueSuccess = <Value>(value: Value): Result<Value, never> =>
  Object.freeze({ ok: true, value });

const normalizeEmail = (value: string): string => value.trim().toLowerCase();
const isAuthUnavailableError = (
  error: unknown,
): error is
  | AuthIdentityProviderUnavailableError
  | AuthProfileRepositoryUnavailableError =>
  error instanceof AuthIdentityProviderUnavailableError ||
  error instanceof AuthProfileRepositoryUnavailableError ||
  (error instanceof Error &&
    (error.message === "auth identity provider unavailable" ||
      error.message === "auth profile repository unavailable"));

export interface AuthNotifierPort {
  sendVerificationCode(email: string, code: string): Promise<void>;
  sendPasswordReset(email: string, token: string): Promise<void>;
}

export interface AuthAuditPort {
  log(
    event: Readonly<{
      organizationId: null;
      userId: string;
      action: "mfa.enrolled" | "mfa.verified" | "mfa.unenrolled";
      entityType: "user";
      entityId: string;
    }>,
  ): void;
}

export interface AuthRandomPort {
  otp(): string;
  token(): string;
  recoveryCode(): string;
}

export interface ClockPort {
  now(): Date;
}

export class IssueVerificationArtifactUseCase {
  constructor(
    private readonly profiles: AuthProfileRepository,
    private readonly hashes: SecretHashPort,
    private readonly random: AuthRandomPort,
    private readonly clock: ClockPort,
    private readonly notifier: AuthNotifierPort,
    private readonly ttlMinutes: number,
  ) {}

  async execute(command: Readonly<{ userId: string; email: string }>) {
    const code = this.random.otp();
    await this.profiles.supersedeVerification(command.userId);
    try {
      await this.profiles.storeVerification({
        userId: command.userId,
        email: command.email,
        codeHash: this.hashes.hash(code),
        expiresAt: new Date(
          this.clock.now().getTime() + this.ttlMinutes * 60_000,
        ).toISOString(),
      });
    } catch {
      return failure("otp_store_failed");
    }
    await this.notifier.sendVerificationCode(command.email, code);
    return success();
  }
}

export class RequestPasswordResetUseCase {
  constructor(
    private readonly profiles: AuthProfileRepository,
    private readonly hashes: SecretHashPort,
    private readonly random: AuthRandomPort,
    private readonly clock: ClockPort,
    private readonly notifier: AuthNotifierPort,
    private readonly delay: DelayPort,
    private readonly ttlMinutes: number,
    private readonly minimumDurationMs = 300,
  ) {}

  async execute(
    command: Readonly<{ email: string }>,
  ): Promise<Result<void, never>> {
    await Promise.all([
      this.request(normalizeEmail(command.email)),
      this.delay.wait(this.minimumDurationMs),
    ]);
    return success();
  }

  private async request(email: string): Promise<void> {
    try {
      const profile = await this.profiles.findByEmail(email);
      if (!profile?.isActive) return;
      const token = this.random.token();
      await this.profiles.storePasswordReset({
        userId: profile.id,
        tokenHash: this.hashes.hash(token),
        expiresAt: new Date(
          this.clock.now().getTime() + this.ttlMinutes * 60_000,
        ).toISOString(),
      });
      await this.notifier.sendPasswordReset(email, token);
    } catch {
      /* Deliberately uniform for account-enumeration resistance. */
    }
  }
}

export class RegisterUserUseCase {
  constructor(
    private readonly profiles: AuthProfileRepository,
    private readonly identity: AuthIdentityProvider,
    private readonly verification: Pick<
      IssueVerificationArtifactUseCase,
      "execute"
    >,
  ) {}

  async execute(
    command: Readonly<{ email: string; username: string; password: string }>,
  ) {
    const email = normalizeEmail(command.email);
    if (await this.profiles.isUsernameTaken(command.username))
      return failure("username_taken");
    let registration;
    try {
      registration = await this.identity.register(
        email,
        command.password,
        command.username,
      );
    } catch (error) {
      if (isAuthUnavailableError(error)) return failure("auth_unavailable");
      throw error;
    }
    if (registration.outcome !== "created")
      return failure(
        registration.outcome === "email_taken"
          ? "email_taken"
          : "signup_failed",
      );
    const profile = await this.profiles.findByAuthUserId(
      registration.identity.authUserId,
    );
    if (!profile) return failure("profile_missing");
    const issued = await this.verification.execute({
      userId: profile.id,
      email,
    });
    if (!issued.ok) return issued;
    return valueSuccess(
      Object.freeze({
        tokens: registration.identity.tokens,
        userId: profile.id,
      }),
    );
  }
}

export class AuthenticateUserUseCase {
  constructor(
    private readonly profiles: AuthProfileRepository,
    private readonly identity: AuthIdentityProvider,
    private readonly delay: DelayPort,
    private readonly minimumDurationMs = 400,
    private readonly maxAttempts = 5,
    private readonly lockMinutes = 15,
  ) {}

  async execute(command: Readonly<{ identifier: string; password: string }>) {
    const identifier = command.identifier.trim();
    const email = identifier.includes("@")
      ? normalizeEmail(identifier)
      : ((await this.profiles.resolveUsername(identifier)) ??
        normalizeEmail(identifier));
    try {
      if (await this.profiles.lockedUntil(email))
        return failure("account_locked");
    } catch (error) {
      if (isAuthUnavailableError(error)) return failure("auth_unavailable");
      throw error;
    }
    let authenticated;
    try {
      [authenticated] = await Promise.all([
        this.identity.authenticate(email, command.password),
        this.delay.wait(this.minimumDurationMs),
      ]);
    } catch (error) {
      if (isAuthUnavailableError(error)) return failure("auth_unavailable");
      throw error;
    }
    if (!authenticated) {
      try {
        await this.profiles.recordLoginFailure(
          email,
          this.maxAttempts,
          this.lockMinutes,
        );
      } catch (error) {
        if (isAuthUnavailableError(error)) return failure("auth_unavailable");
        throw error;
      }
      return failure("invalid_credentials");
    }
    const profile = await this.profiles.findByAuthUserId(
      authenticated.authUserId,
    );
    if (!profile?.isActive) {
      try {
        await this.profiles.recordLoginFailure(
          email,
          this.maxAttempts,
          this.lockMinutes,
        );
      } catch (error) {
        if (isAuthUnavailableError(error)) return failure("auth_unavailable");
        throw error;
      }
      return failure("invalid_credentials");
    }
    try {
      await this.profiles.clearLoginFailures(email);
    } catch (error) {
      if (isAuthUnavailableError(error)) return failure("auth_unavailable");
      throw error;
    }
    return valueSuccess(
      Object.freeze({
        tokens: authenticated.tokens,
        userId: profile.id,
        emailVerified: Boolean(profile.emailVerifiedAt),
      }),
    );
  }
}

export class RefreshSessionUseCase {
  constructor(private readonly identity: AuthIdentityProvider) {}
  async execute(command: Readonly<{ refreshToken: string }>) {
    let tokens;
    try {
      tokens = await this.identity.refresh(command.refreshToken);
    } catch (error) {
      if (isAuthUnavailableError(error)) return failure("auth_unavailable");
      throw error;
    }
    return tokens ? valueSuccess(tokens) : failure("refresh_failed");
  }
}

export class SignOutEverywhereUseCase {
  constructor(
    private readonly identity: AuthIdentityProvider,
    private readonly profiles: AuthProfileRepository,
  ) {}
  async execute(command: Readonly<{ userId: string; accessToken: string }>) {
    try {
      await this.identity.signOutGlobally(command.accessToken);
    } catch {
      /* epoch revocation remains authoritative */
    }
    try {
      await this.profiles.bumpSessionEpoch(command.userId);
    } catch {
      return failure("revoke_failed");
    }
    return success();
  }
}

export class ReadSessionQuery {
  constructor(private readonly profiles: AuthProfileRepository) {}
  async execute(
    query: Readonly<{ userId: string; organizationId: string | null }>,
  ) {
    const profile = await this.profiles.findById(query.userId);
    if (!profile) return failure("profile_missing");
    const memberships = await this.profiles.listMemberships(query.userId);
    const organizations = Object.freeze(
      memberships.map(({ role, organization }) =>
        Object.freeze({ ...organization, role }),
      ),
    );
    return valueSuccess(
      Object.freeze({
        user: Object.freeze({
          id: profile.id,
          email: profile.email,
          username: profile.username,
          firstName: profile.firstName,
          lastName: profile.lastName,
          avatarUrl: profile.avatarUrl,
          isActive: profile.isActive,
        }),
        organization:
          organizations.find(({ id }) => id === query.organizationId) ??
          organizations[0] ??
          null,
        organizations,
      }),
    );
  }
}

export class ReauthenticateUserUseCase {
  constructor(
    private readonly profiles: AuthProfileRepository,
    private readonly identity: AuthIdentityProvider,
    private readonly delay: DelayPort,
    private readonly minimumDurationMs = 300,
    private readonly maxAttempts = 5,
    private readonly lockMinutes = 15,
  ) {}
  async execute(command: Readonly<{ email: string; password: string }>) {
    const email = normalizeEmail(command.email);
    try {
      if (await this.profiles.lockedUntil(email))
        return failure("account_locked");
    } catch (error) {
      if (isAuthUnavailableError(error)) return failure("auth_unavailable");
      throw error;
    }
    let authenticated;
    try {
      [authenticated] = await Promise.all([
        this.identity.authenticate(email, command.password),
        this.delay.wait(this.minimumDurationMs),
      ]);
    } catch (error) {
      if (isAuthUnavailableError(error)) return failure("auth_unavailable");
      throw error;
    }
    if (!authenticated) {
      try {
        await this.profiles.recordLoginFailure(
          email,
          this.maxAttempts,
          this.lockMinutes,
        );
      } catch (error) {
        if (isAuthUnavailableError(error)) return failure("auth_unavailable");
        throw error;
      }
      return valueSuccess(false);
    }
    try {
      await this.profiles.clearLoginFailures(email);
    } catch (error) {
      if (isAuthUnavailableError(error)) return failure("auth_unavailable");
      throw error;
    }
    return valueSuccess(true);
  }
}

export class EnrollMfaUseCase {
  constructor(private readonly identity: AuthIdentityProvider) {}
  async execute(
    command: Readonly<{ accessToken: string }>,
  ): Promise<
    Result<
      MfaEnrollment,
      Readonly<{ code: "mfa_enroll_failed" | "auth_unavailable" }>
    >
  > {
    try {
      const enrollment = await this.identity.enrollMfa(command.accessToken);
      return enrollment
        ? valueSuccess(enrollment)
        : failure("mfa_enroll_failed");
    } catch (error) {
      if (isAuthUnavailableError(error)) return failure("auth_unavailable");
      return failure("mfa_enroll_failed");
    }
  }
}

export class ConfirmMfaEnrollmentUseCase {
  constructor(
    private readonly identity: AuthIdentityProvider,
    private readonly profiles: AuthProfileRepository,
    private readonly hashes: SecretHashPort,
    private readonly random: AuthRandomPort,
    private readonly audit: AuthAuditPort,
    private readonly recoveryCodeCount = 10,
  ) {}

  async execute(
    command: Readonly<{
      accessToken: string;
      userId: string;
      factorId: string;
      code: string;
    }>,
  ) {
    let verified;
    try {
      verified = await this.identity.verifyMfa(
        command.accessToken,
        command.factorId,
        command.code,
      );
    } catch (error) {
      if (isAuthUnavailableError(error)) return failure("auth_unavailable");
      throw error;
    }
    if (verified.outcome !== "verified")
      return failure(
        verified.outcome === "challenge_failed"
          ? "mfa_challenge_failed"
          : "mfa_invalid_code",
      );
    const rawCodes = Array.from({ length: this.recoveryCodeCount }, () =>
      this.random.recoveryCode(),
    );
    try {
      await this.profiles.replaceRecoveryCodes(
        command.userId,
        rawCodes.map((code) => this.hashes.hash(code)),
      );
    } catch (error) {
      if (isAuthUnavailableError(error)) return failure("auth_unavailable");
      return failure("mfa_recovery_generate_failed");
    }
    this.audit.log({
      organizationId: null,
      userId: command.userId,
      action: "mfa.enrolled",
      entityType: "user",
      entityId: command.userId,
    });
    return valueSuccess(
      Object.freeze({
        recoveryCodes: Object.freeze(
          rawCodes.map((raw) => `${raw.slice(0, 4)}-${raw.slice(4)}`),
        ),
        tokens: verified.tokens,
      }),
    );
  }
}

export class VerifyMfaUseCase {
  constructor(
    private readonly identity: AuthIdentityProvider,
    private readonly audit: AuthAuditPort,
  ) {}
  async execute(
    command: Readonly<{ accessToken: string; userId: string; code: string }>,
  ) {
    let factors;
    try {
      factors = await this.identity.listUserMfaFactors(command.accessToken);
    } catch (error) {
      if (isAuthUnavailableError(error)) return failure("auth_unavailable");
      return failure("mfa_factors_failed");
    }
    if (!factors) return failure("mfa_factors_failed");
    const factor = factors.find(({ status }) => status === "verified");
    if (!factor) return failure("mfa_not_enrolled");
    let verified;
    try {
      verified = await this.identity.verifyMfa(
        command.accessToken,
        factor.id,
        command.code,
      );
    } catch (error) {
      if (isAuthUnavailableError(error)) return failure("auth_unavailable");
      throw error;
    }
    if (verified.outcome !== "verified")
      return failure(
        verified.outcome === "challenge_failed"
          ? "mfa_challenge_failed"
          : "mfa_invalid_code",
      );
    this.audit.log({
      organizationId: null,
      userId: command.userId,
      action: "mfa.verified",
      entityType: "user",
      entityId: command.userId,
    });
    return valueSuccess(verified.tokens);
  }
}

export class HasVerifiedMfaQuery {
  constructor(private readonly identity: AuthIdentityProvider) {}
  async execute(query: Readonly<{ accessToken: string }>) {
    try {
      const factors = await this.identity.listUserMfaFactors(query.accessToken);
      return factors
        ? valueSuccess(factors.some(({ status }) => status === "verified"))
        : failure("auth_unavailable");
    } catch {
      return failure("auth_unavailable");
    }
  }
}

export class UnenrollMfaUseCase {
  constructor(
    private readonly identity: AuthIdentityProvider,
    private readonly profiles: AuthProfileRepository,
    private readonly audit: AuthAuditPort,
  ) {}
  async execute(
    command: Readonly<{
      accessToken: string;
      userId: string;
      factorId: string;
    }>,
  ) {
    try {
      const unenrolled = await this.identity.unenrollMfa(
        command.accessToken,
        command.factorId,
      );
      if (!unenrolled) return failure("mfa_unenroll_failed");
    } catch (error) {
      if (isAuthUnavailableError(error)) return failure("auth_unavailable");
      return failure("mfa_unenroll_failed");
    }
    try {
      await this.profiles.clearRecoveryCodes(command.userId);
    } catch (error) {
      if (isAuthUnavailableError(error)) return failure("auth_unavailable");
      throw error;
    }
    this.audit.log({
      organizationId: null,
      userId: command.userId,
      action: "mfa.unenrolled",
      entityType: "user",
      entityId: command.userId,
    });
    return success();
  }
}

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
      const updated = await this.identity.updatePassword(
        claim.authUserId,
        command.password,
      );
      return updated ? success() : failure("password_update_failed");
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
