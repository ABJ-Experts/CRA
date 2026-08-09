import { createHash, randomBytes } from "node:crypto";

import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";

import { AuditService } from "../../audit/audit.service";
import { SupabaseService } from "../../supabase/supabase.service";
import { RecoverMfaUseCase } from "../application/auth-use-cases";

const sha256 = (v: string): string =>
  createHash("sha256").update(v).digest("hex");

/** Ten single-use codes, shown once at enrolment and never again. */
const RECOVERY_CODE_COUNT = 10;

/**
 * Time-based one-time passwords, via Supabase Auth factors.
 *
 * EVERY GoTrue CALL HERE USES THE USER-SCOPED CLIENT, never service_role.
 * MFA enrolment is something a user does for themselves — GoTrue binds a factor
 * to the session that created it, and the admin client has no session, so
 * `service_role` simply cannot enrol on someone's behalf. That constraint is
 * the reason `SupabaseService.asUser()` exists.
 *
 * RECOVERY CODES ARE OURS, not GoTrue's. Supabase has no recovery-code concept
 * at all — it offers TOTP factors and nothing else — but
 * `two-factor/page.tsx` already ships a recovery mode. So they live in
 * `auth_mfa_recovery_codes`, hashed and single-use, and a consumed code is
 * marked rather than deleted so "you have 3 codes left" stays answerable.
 */
@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly audit: AuditService,
    private readonly recoverMfa: RecoverMfaUseCase,
  ) {}

  /** Begin enrolment. Returns the QR payload the user scans. */
  async enroll(accessToken: string): Promise<{
    factorId: string;
    qrCode: string;
    secret: string;
    uri: string;
  }> {
    const client = this.supabase.asUser(accessToken);

    const { data, error } = await client.auth.mfa.enroll({
      factorType: "totp",
      // Names must be unique per user; a fixed name makes a second enrolment
      // attempt fail with a confusing duplicate error instead of superseding.
      friendlyName: `CRA ${new Date().toISOString()}`,
    });

    if (error || !data) {
      this.logger.error(`MFA enroll failed: ${error?.message}`);
      throw new BadRequestException({
        message: "We could not start two-factor setup.",
        code: "mfa_enroll_failed",
      });
    }

    return {
      factorId: data.id,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
      uri: data.totp.uri,
    };
  }

  /**
   * Confirm enrolment with the first code from the authenticator.
   *
   * Recovery codes are generated only once the factor is VERIFIED — issuing
   * them at enroll time would hand out working bypass codes for a factor the
   * user never finished setting up.
   */
  async confirmEnrollment(
    accessToken: string,
    userId: string,
    factorId: string,
    code: string,
  ): Promise<{
    recoveryCodes: string[];
    tokens: { access_token: string; refresh_token: string };
  }> {
    const client = this.supabase.asUser(accessToken);

    const { data: challenge, error: challengeError } =
      await client.auth.mfa.challenge({ factorId });

    if (challengeError || !challenge) {
      throw new BadRequestException({
        message: "We could not verify that code.",
        code: "mfa_challenge_failed",
      });
    }

    const { data: verified, error } = await client.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code,
    });

    if (error || !verified) {
      throw new BadRequestException({
        message: "That code is not right. Check your authenticator app.",
        code: "mfa_invalid_code",
      });
    }

    const recoveryCodes = await this.issueRecoveryCodes(userId);

    this.audit.log({
      organizationId: null,
      userId,
      action: "mfa.enrolled",
      entityType: "user",
      entityId: userId,
    });

    return {
      recoveryCodes,
      tokens: {
        access_token: verified.access_token,
        refresh_token: verified.refresh_token,
      },
    };
  }

  /** Verify a TOTP at sign-in, raising the session from aal1 to aal2. */
  async verify(
    accessToken: string,
    userId: string,
    code: string,
  ): Promise<{ access_token: string; refresh_token: string }> {
    const client = this.supabase.asUser(accessToken);

    const { data: factors, error: factorsError } =
      await client.auth.mfa.listFactors();

    if (factorsError || !factors) {
      throw new BadRequestException({
        message: "We could not verify that code.",
        code: "mfa_factors_failed",
      });
    }

    const factor = factors.totp.find((f) => f.status === "verified");
    if (!factor) {
      throw new BadRequestException({
        message: "Two-factor authentication is not set up on this account.",
        code: "mfa_not_enrolled",
      });
    }

    const { data: challenge, error: challengeError } =
      await client.auth.mfa.challenge({ factorId: factor.id });

    if (challengeError || !challenge) {
      throw new BadRequestException({
        message: "We could not verify that code.",
        code: "mfa_challenge_failed",
      });
    }

    const { data: verified, error } = await client.auth.mfa.verify({
      factorId: factor.id,
      challengeId: challenge.id,
      code,
    });

    if (error || !verified) {
      throw new UnauthorizedException({
        message: "That code is not right. Check your authenticator app.",
        code: "mfa_invalid_code",
      });
    }

    this.audit.log({
      organizationId: null,
      userId,
      action: "mfa.verified",
      entityType: "user",
      entityId: userId,
    });

    return {
      access_token: verified.access_token,
      refresh_token: verified.refresh_token,
    };
  }

  /**
   * Redeem a recovery code, and REMOVE the factor it bypassed.
   *
   * Redeeming does not raise the session to aal2 — GoTrue only does that for a
   * real factor challenge — and GoTrue requires aal2 to delete a factor. Left
   * alone, that is a trap with no way out: someone who lost their authenticator
   * signs in with a recovery code, cannot remove the factor they can no longer
   * satisfy, and is prompted for it again on their next sign-in forever.
   *
   * So the factor is deleted server-side through the admin API, which needs no
   * session. The user is signed in and MFA is off, so they can re-enrol with a
   * device they actually have.
   *
   * This does mean one recovery code disables two-factor for the account — but
   * that is what a recovery code IS. The alternative is a permanent lockout,
   * and the codes are hashed, single-use, and shown exactly once.
   */
  async redeemRecoveryCode(
    userId: string,
    authUserId: string,
    code: string,
  ): Promise<void> {
    const result = await this.recoverMfa.execute({ userId, authUserId, code });
    if (result.ok) return;

    if (result.error.code === "mfa_recovery_invalid") {
      throw new UnauthorizedException({
        message: "That recovery code is not valid.",
        code: result.error.code,
      });
    }

    this.logger.error(
      `MFA recovery failed for user ${userId} with sanitized code auth_unavailable`,
    );
    throw new ServiceUnavailableException({
      message: "Sign-in is temporarily unavailable. Please try again.",
      code: "auth_unavailable",
    });
  }

  /** Whether this account owes a TOTP challenge at sign-in. */
  async hasVerifiedFactor(accessToken: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .asUser(accessToken)
      .auth.mfa.listFactors();

    if (error) {
      this.logger.error(`MFA factor lookup failed: ${error.message}`);
      throw new ServiceUnavailableException({
        message: "Sign-in is temporarily unavailable. Please try again.",
        code: "auth_unavailable",
      });
    }

    return (data?.totp ?? []).some((f) => f.status === "verified");
  }

  async unenroll(
    accessToken: string,
    userId: string,
    factorId: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .asUser(accessToken)
      .auth.mfa.unenroll({ factorId });

    if (error) {
      throw new BadRequestException({
        message: "We could not turn off two-factor authentication.",
        code: "mfa_unenroll_failed",
      });
    }

    // Recovery codes for a removed factor are dead weight and a standing
    // bypass; clear them with the factor.
    await this.supabase
      .admin()
      .from("auth_mfa_recovery_codes")
      .delete()
      .eq("user_id", userId);

    this.audit.log({
      organizationId: null,
      userId,
      action: "mfa.unenrolled",
      entityType: "user",
      entityId: userId,
    });
  }

  /**
   * Fresh recovery codes, replacing any that exist.
   *
   * Returned in plaintext exactly once — only the hashes are stored, so they
   * cannot be shown again. Formatted `xxxx-xxxx` for legibility, and normalised
   * back before hashing so a user typing the dashes (or not) both work.
   */
  private async issueRecoveryCodes(userId: string): Promise<string[]> {
    await this.supabase
      .admin()
      .from("auth_mfa_recovery_codes")
      .delete()
      .eq("user_id", userId);

    const plain: string[] = [];
    const rows: { user_id: string; code_hash: string }[] = [];

    for (let i = 0; i < RECOVERY_CODE_COUNT; i += 1) {
      const raw = randomBytes(4).toString("hex"); // 8 hex chars
      plain.push(`${raw.slice(0, 4)}-${raw.slice(4)}`);
      rows.push({ user_id: userId, code_hash: sha256(raw) });
    }

    const { error } = await this.supabase
      .admin()
      .from("auth_mfa_recovery_codes")
      .insert(rows);

    if (error) {
      this.logger.error(`Recovery code insert failed: ${error.message}`);
      throw new BadRequestException({
        message: "We could not create your recovery codes.",
        code: "mfa_recovery_generate_failed",
      });
    }

    return plain;
  }
}
