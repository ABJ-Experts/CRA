import { createHash, randomBytes, randomInt } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type {
  ForgotPasswordInput,
  ResetPasswordInput,
  SessionResponse,
  SignInInput,
  SignUpInput,
} from "@repo/contracts/auth";
import { normalizeEmail } from "@repo/contracts/auth";

import { TooManyRequestsException } from "../common/exceptions/too-many-requests.exception";
import { MailService } from "../mail/mail.service";
import { SupabaseService } from "../supabase/supabase.service";
import {
  ManageEmailVerificationUseCase,
  ManagePasswordRecoveryUseCase,
} from "./application/auth-use-cases";

interface Tokens {
  access_token: string;
  refresh_token: string;
}

interface UserRow {
  id: string;
  auth_user_id: string | null;
  email: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  is_active: boolean;
  email_verified_at: string | null;
}

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

/**
 * A 6-digit code from a CRYPTOGRAPHIC source.
 *
 * `Math.random()` is predictable enough that an attacker who sees one code can
 * narrow the next; for a value that authorises an account it has to be
 * randomInt.
 */
const otp = (): string => String(randomInt(0, 1_000_000)).padStart(6, "0");

/**
 * Keep an operation on the clock for at least `ms`.
 *
 * Applied to sign-in and forgot-password so response TIMING does not leak
 * whether an account exists. Returning a uniform body is not enough on its own:
 * "user not found" answers in 5 ms while a real bcrypt comparison takes ~100 ms,
 * and that difference is trivially measurable.
 */
async function withMinimumDuration<T>(
  ms: number,
  work: Promise<T>,
): Promise<T> {
  const [result] = await Promise.all([
    work,
    new Promise((resolve) => setTimeout(resolve, ms)),
  ]);
  return result;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly emailVerification: ManageEmailVerificationUseCase,
    private readonly passwordRecovery: ManagePasswordRecoveryUseCase,
  ) {}

  // -------------------------------------------------------------------------
  // Sign up
  // -------------------------------------------------------------------------

  async signUp(
    input: SignUpInput,
  ): Promise<{ tokens: Tokens; userId: string }> {
    const email = normalizeEmail(input.email);

    // Username uniqueness is a friendly, checkable error rather than a raw
    // constraint violation surfacing as a 500.
    const { data: takenUsername } = await this.supabase
      .admin()
      .from("users")
      .select("id")
      .ilike("username", input.username)
      .maybeSingle();

    if (takenUsername) {
      throw new ConflictException({
        message: "That user name is already taken.",
        code: "username_taken",
        fieldErrors: { username: "That user name is already taken." },
      });
    }

    const { data, error } = await this.supabase.anon().auth.signUp({
      email,
      password: input.password,
      options: { data: { username: input.username } },
    });

    if (error) {
      /*
       * GoTrue reports an existing address with a generic message. We surface it
       * as a field error on `email` because sign-up is one of the few places
       * where telling the truth is correct: the user is standing at a form that
       * cannot succeed, and the address is one they already control.
       */
      if (/already registered|already exists/i.test(error.message)) {
        throw new ConflictException({
          message: "That email is already registered.",
          code: "email_taken",
          fieldErrors: { email: "That email is already registered." },
        });
      }
      this.logger.error(`Sign-up failed: ${error.message}`);
      throw new BadRequestException({
        message: "We could not create that account.",
        code: "signup_failed",
      });
    }

    if (!data.session || !data.user) {
      throw new BadRequestException({
        message: "We could not create that account.",
        code: "signup_failed",
      });
    }

    // Created by the on_auth_user_created trigger, not by us.
    const profile = await this.profileByAuthId(data.user.id);
    if (!profile) {
      this.logger.error(
        `Trigger did not create a profile for ${data.user.id} — check on_auth_user_created`,
      );
      throw new ServiceUnavailableException({
        message: "We could not finish setting up that account.",
        code: "profile_missing",
      });
    }

    await this.issueVerificationCode(profile.id, email);

    return {
      tokens: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      },
      userId: profile.id,
    };
  }

  // -------------------------------------------------------------------------
  // Sign in
  // -------------------------------------------------------------------------

  async signIn(
    input: SignInInput,
  ): Promise<{ tokens: Tokens; userId: string; emailVerified: boolean }> {
    // The screen's field is "email or user name", so resolve a username to its
    // address before touching GoTrue.
    const email = await this.resolveIdentifier(input.email);

    const lockedUntil = await this.lockedUntil(email);
    if (lockedUntil) {
      throw new TooManyRequestsException({
        message: "Too many attempts. Please try again later.",
        code: "account_locked",
      });
    }

    const { data, error } = await withMinimumDuration(
      400,
      this.supabase.anon().auth.signInWithPassword({
        email,
        password: input.password,
      }),
    );

    if (error || !data.session || !data.user) {
      await this.recordFailure(email);
      /*
       * One message for every failure mode — wrong password, unknown address,
       * deactivated account. Distinguishing them turns this endpoint into an
       * account-enumeration oracle.
       */
      throw new UnauthorizedException({
        message: "That email and password do not match.",
        code: "invalid_credentials",
      });
    }

    const profile = await this.profileByAuthId(data.user.id);

    if (!profile || !profile.is_active) {
      await this.recordFailure(email);
      throw new UnauthorizedException({
        message: "That email and password do not match.",
        code: "invalid_credentials",
      });
    }

    await this.clearFailures(email);

    return {
      tokens: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      },
      userId: profile.id,
      emailVerified: Boolean(profile.email_verified_at),
    };
  }

  // -------------------------------------------------------------------------
  // Refresh / sign out
  // -------------------------------------------------------------------------

  async refresh(refreshToken: string): Promise<Tokens> {
    const { data, error } = await this.supabase
      .anon()
      .auth.refreshSession({ refresh_token: refreshToken });

    if (error || !data.session) {
      throw new UnauthorizedException({
        message: "Your session has expired. Please sign in again.",
        code: "refresh_failed",
      });
    }

    return {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    };
  }

  /**
   * Sign out everywhere.
   *
   * BOTH halves are required and neither is sufficient alone:
   *   - GoTrue global sign-out revokes the REFRESH tokens, so no new access
   *     token can be minted;
   *   - bumping session_epoch_at invalidates the access token already sitting in
   *     the user's browser, which stays cryptographically valid for up to
   *     jwt_expiry regardless of what GoTrue thinks.
   */
  async signOutEverywhere(userId: string, accessToken: string): Promise<void> {
    try {
      await this.supabase.asUser(accessToken).auth.signOut({ scope: "global" });
    } catch (error) {
      this.logger.warn(
        `Global sign-out failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await this.bumpEpoch(userId);
  }

  // -------------------------------------------------------------------------
  // Email verification
  // -------------------------------------------------------------------------

  async issueVerificationCode(userId: string, email: string): Promise<void> {
    const code = otp();
    const ttl = this.config.getOrThrow<number>("OTP_TTL_MINUTES");

    /*
     * Supersede any live code first. The partial unique index
     * (user_id, purpose) WHERE consumed_at IS NULL enforces one at a time, so a
     * resend must retire the previous one rather than colliding with it — and
     * retiring it also keeps the guessing surface at exactly one code.
     */
    await this.supabase
      .admin()
      .from("auth_email_verifications")
      .update({ consumed_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("purpose", "signup")
      .is("consumed_at", null);

    const { error } = await this.supabase
      .admin()
      .from("auth_email_verifications")
      .insert({
        user_id: userId,
        email,
        code_hash: sha256(code),
        purpose: "signup",
        expires_at: new Date(Date.now() + ttl * 60_000).toISOString(),
      });

    if (error) {
      this.logger.error(`Could not store verification code: ${error.message}`);
      throw new ServiceUnavailableException({
        message: "We could not send that code. Please try again.",
        code: "otp_store_failed",
      });
    }

    await this.mail.sendVerificationCode(email, code);
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

  // -------------------------------------------------------------------------
  // Password reset
  // -------------------------------------------------------------------------

  /**
   * ALWAYS resolves successfully, whatever happens internally.
   *
   * The frozen `requestPasswordReset` stub already returned `{ ok: true }`
   * unconditionally with a comment explaining why, and the real implementation
   * has to preserve that property: any observable difference between "we sent a
   * link" and "no such account" is an account-enumeration oracle. The minimum
   * duration closes the timing side of the same leak.
   */
  async requestPasswordReset(input: ForgotPasswordInput): Promise<void> {
    await withMinimumDuration(300, this.doRequestPasswordReset(input.email));
  }

  private async doRequestPasswordReset(email: string): Promise<void> {
    try {
      const profile = await this.profileByEmail(email);
      if (!profile || !profile.is_active) return;

      const token = randomBytes(32).toString("hex");
      const ttl = this.config.getOrThrow<number>("RECOVERY_TTL_MINUTES");

      const { error } = await this.supabase
        .admin()
        .from("auth_recovery_tokens")
        .insert({
          user_id: profile.id,
          token_hash: sha256(token),
          expires_at: new Date(Date.now() + ttl * 60_000).toISOString(),
        });

      if (error) {
        this.logger.error(`Could not store recovery token: ${error.message}`);
        return;
      }

      await this.mail.sendPasswordReset(email, token);
    } catch (error) {
      // Swallowed on purpose: an internal failure must not become an
      // observable difference for the caller.
      this.logger.error(
        `Password reset request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const result = await this.passwordRecovery.execute(input);
    if (result.ok) return;

    if (
      result.error.code === "reset_token_invalid" ||
      result.error.code === "reset_token_expired"
    ) {
      throw new BadRequestException({
        message: "That reset link has expired.",
        code: result.error.code,
      });
    }

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

  // -------------------------------------------------------------------------
  // Session
  // -------------------------------------------------------------------------

  async session(
    userId: string,
    organizationId: string | null,
  ): Promise<SessionResponse> {
    const profile = await this.profileById(userId);
    if (!profile) {
      throw new UnauthorizedException({
        message: "Your account is not set up.",
        code: "profile_missing",
      });
    }

    const { data: memberships } = await this.supabase
      .admin()
      .from("organization_members")
      .select("role, organizations(id, name, slug)")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    const organizations = (memberships ?? [])
      .filter((m) => m.organizations !== null)
      .map((m) => ({
        id: m.organizations.id,
        name: m.organizations.name,
        slug: m.organizations.slug,
        role: m.role,
      }));

    return {
      user: {
        id: profile.id,
        email: profile.email,
        username: profile.username,
        firstName: profile.first_name,
        lastName: profile.last_name,
        avatarUrl: profile.avatar_url,
        isActive: profile.is_active,
      },
      organization:
        organizations.find((o) => o.id === organizationId) ??
        organizations[0] ??
        null,
      organizations,
    };
  }

  /** Re-authenticate an existing session — the Lock Screen. */
  async verifyPassword(emailInput: string, password: string): Promise<boolean> {
    const email = normalizeEmail(emailInput);
    const lockedUntil = await this.lockedUntil(email);
    if (lockedUntil) {
      throw new TooManyRequestsException({
        message: "Too many attempts. Please try again later.",
        code: "account_locked",
      });
    }

    const { data, error } = await withMinimumDuration(
      300,
      this.supabase.anon().auth.signInWithPassword({ email, password }),
    );
    if (error || !data.session) {
      await this.recordFailure(email);
      return false;
    }

    await this.clearFailures(email);
    return true;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async resolveIdentifier(identifier: string): Promise<string> {
    const value = identifier.trim();
    if (value.includes("@")) return normalizeEmail(value);

    const { data } = await this.supabase
      .admin()
      .from("users")
      .select("email")
      .ilike("username", value)
      .maybeSingle();

    // Fall through to the address form when no username matches, so an unknown
    // username fails at the password step exactly like a wrong password would
    // rather than short-circuiting with a distinguishable response.
    return data?.email ?? normalizeEmail(value);
  }

  private async profileByAuthId(authUserId: string): Promise<UserRow | null> {
    const { data } = await this.supabase
      .admin()
      .from("users")
      .select(
        "id, auth_user_id, email, username, first_name, last_name, avatar_url, is_active, email_verified_at",
      )
      .eq("auth_user_id", authUserId)
      .maybeSingle();
    return data;
  }

  private async profileById(id: string): Promise<UserRow | null> {
    const { data } = await this.supabase
      .admin()
      .from("users")
      .select(
        "id, auth_user_id, email, username, first_name, last_name, avatar_url, is_active, email_verified_at",
      )
      .eq("id", id)
      .maybeSingle();
    return data;
  }

  private async profileByEmail(email: string): Promise<UserRow | null> {
    const { data } = await this.supabase
      .admin()
      .from("users")
      .select(
        "id, auth_user_id, email, username, first_name, last_name, avatar_url, is_active, email_verified_at",
      )
      .eq("email", normalizeEmail(email))
      .maybeSingle();
    return data;
  }

  /*
   * Every RPC below CHECKS ITS ERROR. An earlier version ignored them, and when
   * `service_role` turned out to lack EXECUTE (see the rpc_grants migration)
   * the lockout silently recorded nothing — the control was present in the
   * schema, passed its SQL tests, and did nothing through the application.
   * A security control that fails quietly is worse than one that is absent,
   * because it is believed.
   */
  private async lockedUntil(email: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .admin()
      .rpc("is_login_locked", { p_email: email });

    if (error) {
      this.logger.error(`is_login_locked failed: ${error.message}`);
      // Fail OPEN on an infrastructure error: a broken lockout table must not
      // make sign-in impossible for everyone. The failure is loud in the log.
      return null;
    }
    return data;
  }

  private async recordFailure(email: string): Promise<void> {
    const { error } = await this.supabase.admin().rpc("record_login_failure", {
      p_email: email,
      p_max_attempts: this.config.getOrThrow<number>("LOGIN_MAX_ATTEMPTS"),
      p_window: `${this.config.getOrThrow<number>("LOGIN_LOCK_MINUTES")} minutes`,
      p_lock_duration: `${this.config.getOrThrow<number>("LOGIN_LOCK_MINUTES")} minutes`,
    });

    if (error) {
      this.logger.error(`record_login_failure failed: ${error.message}`);
    }
  }

  private async clearFailures(email: string): Promise<void> {
    const { error } = await this.supabase
      .admin()
      .rpc("clear_login_attempts", { p_email: email });

    if (error) {
      this.logger.error(`clear_login_attempts failed: ${error.message}`);
    }
  }

  private async bumpEpoch(userId: string): Promise<void> {
    const { error } = await this.supabase
      .admin()
      .rpc("bump_session_epoch", { p_user_id: userId });

    if (error) {
      // Unlike the lockout, this one must NOT be swallowed: if the epoch does
      // not move, "sign out everywhere" silently leaves every session alive.
      this.logger.error(`bump_session_epoch failed: ${error.message}`);
      throw new ServiceUnavailableException({
        message: "We could not end your sessions. Please try again.",
        code: "revoke_failed",
      });
    }
  }
}
