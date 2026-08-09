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

const sha256 = (v: string): string =>
  createHash("sha256").update(v).digest("hex");

/** Ten single-use codes, shown once at enrolment and never again. */
const RECOVERY_CODE_COUNT = 10;
// Keep an overlapping HTTP request attached long enough for ordinary provider
// latency (list + N deletes) without holding it for the full five-minute crash
// lease. At 15 seconds, an upstream timeout still fails conservatively while
// normal double-submits converge on the first request's result.
const RECOVERY_STATUS_POLL_ATTEMPTS = 60;
const RECOVERY_STATUS_POLL_DELAY_MS = 250;

type MfaRecoveryStatus = "claimed" | "failed" | "factors_removed" | "completed";

type MfaRecoveryClaim =
  | Readonly<{ outcome: "invalid" }>
  | Readonly<{
      outcome: "claimed" | "resumed" | "in_progress";
      operationId: string;
      authUserId: string;
      status: MfaRecoveryStatus;
    }>;

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
    const normalized = code.trim().toLowerCase().replace(/-/g, "");
    const claim = await this.claimRecoveryOperation(userId, sha256(normalized));

    if (claim.outcome === "invalid") {
      throw new UnauthorizedException({
        message: "That recovery code is not valid.",
        code: "mfa_recovery_invalid",
      });
    }
    if (claim.authUserId !== authUserId || claim.status === "completed") {
      this.throwRecoveryUnavailable();
    }
    if (claim.outcome === "in_progress") {
      await this.waitForRecoveryCompletion(claim.operationId, userId);
      return;
    }

    if (claim.status !== "factors_removed") {
      await this.removeRecoveryFactors(claim, userId);
      await this.markRecoveryFactorsRemoved(claim.operationId, userId);
    }

    await this.completeRecoveryOperation(claim.operationId, userId);
  }

  private async claimRecoveryOperation(
    userId: string,
    codeHash: string,
  ): Promise<MfaRecoveryClaim> {
    try {
      const { data, error } = await this.supabase
        .admin()
        .rpc("claim_mfa_recovery", {
          p_user_id: userId,
          p_code_hash: codeHash,
        });
      if (error || !Array.isArray(data) || data.length !== 1) {
        this.throwRecoveryUnavailable();
      }

      const [row] = data;
      if (
        !row ||
        !["claimed", "resumed", "in_progress", "invalid"].includes(row.outcome)
      ) {
        this.throwRecoveryUnavailable();
      }
      const outcome = row.outcome as
        "claimed" | "resumed" | "in_progress" | "invalid";
      if (outcome === "invalid") {
        if (row.operation_id || row.auth_user_id || row.status) {
          this.throwRecoveryUnavailable();
        }
        return { outcome: "invalid" };
      }
      if (
        !row.operation_id ||
        !row.auth_user_id ||
        !["claimed", "failed", "factors_removed", "completed"].includes(
          row.status ?? "",
        ) ||
        (outcome === "claimed" && row.status !== "claimed") ||
        (outcome === "in_progress" &&
          !["claimed", "failed"].includes(row.status ?? ""))
      ) {
        this.throwRecoveryUnavailable();
      }

      return {
        outcome,
        operationId: row.operation_id,
        authUserId: row.auth_user_id,
        status: row.status as MfaRecoveryStatus,
      };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      this.throwRecoveryUnavailable();
    }
  }

  private async waitForRecoveryCompletion(
    operationId: string,
    userId: string,
  ): Promise<void> {
    for (
      let attempt = 0;
      attempt < RECOVERY_STATUS_POLL_ATTEMPTS;
      attempt += 1
    ) {
      try {
        const { data, error } = await this.supabase
          .admin()
          .rpc("get_mfa_recovery_status", {
            p_operation_id: operationId,
            p_user_id: userId,
          });
        if (
          error ||
          !["claimed", "failed", "factors_removed", "completed"].includes(data)
        ) {
          this.throwRecoveryUnavailable();
        }
        if (data === "completed") return;
        if (data === "failed") this.throwRecoveryUnavailable();
      } catch (error) {
        if (error instanceof ServiceUnavailableException) throw error;
        this.throwRecoveryUnavailable();
      }

      await new Promise((resolve) =>
        setTimeout(resolve, RECOVERY_STATUS_POLL_DELAY_MS),
      );
    }
    this.throwRecoveryUnavailable();
  }

  private async removeRecoveryFactors(
    claim: Exclude<MfaRecoveryClaim, { outcome: "invalid" }>,
    userId: string,
  ): Promise<void> {
    const factors = await this.listRecoveryFactors(claim, userId);

    for (const factor of factors) {
      if (!factor?.id) {
        await this.failRecoveryProviderStep(
          claim.operationId,
          userId,
          "list_factors_failed",
        );
      }
      try {
        const { error } = await this.supabase
          .admin()
          .auth.admin.mfa.deleteFactor({
            id: factor.id,
            userId: claim.authUserId,
          });
        if (error) throw error;
      } catch {
        await this.failRecoveryProviderStep(
          claim.operationId,
          userId,
          "delete_factor_failed",
        );
      }
    }
  }

  private async listRecoveryFactors(
    claim: Exclude<MfaRecoveryClaim, { outcome: "invalid" }>,
    userId: string,
  ): Promise<readonly Readonly<{ id: string }>[]> {
    try {
      const { data, error } = await this.supabase
        .admin()
        .auth.admin.mfa.listFactors({ userId: claim.authUserId });
      if (error || !data || !Array.isArray(data.factors)) {
        return this.failRecoveryProviderStep(
          claim.operationId,
          userId,
          "list_factors_failed",
        );
      }
      return data.factors;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      return this.failRecoveryProviderStep(
        claim.operationId,
        userId,
        "list_factors_failed",
      );
    }
  }

  private async failRecoveryProviderStep(
    operationId: string,
    userId: string,
    errorCode: "list_factors_failed" | "delete_factor_failed",
  ): Promise<never> {
    this.logger.error(
      `MFA recovery provider step failed for user ${userId}, operation ${operationId}, step ${errorCode}`,
    );
    try {
      const { data, error } = await this.supabase
        .admin()
        .rpc("fail_mfa_recovery", {
          p_operation_id: operationId,
          p_user_id: userId,
          p_error_code: errorCode,
        });
      if (error || data !== "failed") {
        this.logger.error(
          `Could not persist MFA recovery failure for operation ${operationId}`,
        );
      }
    } catch {
      this.logger.error(
        `Could not persist MFA recovery failure for operation ${operationId}`,
      );
    }
    this.throwRecoveryUnavailable();
  }

  private async markRecoveryFactorsRemoved(
    operationId: string,
    userId: string,
  ): Promise<void> {
    try {
      const { data, error } = await this.supabase
        .admin()
        .rpc("mark_mfa_factors_removed", {
          p_operation_id: operationId,
          p_user_id: userId,
        });
      if (error || data !== "factors_removed") {
        this.throwRecoveryUnavailable();
      }
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      this.throwRecoveryUnavailable();
    }
  }

  private async completeRecoveryOperation(
    operationId: string,
    userId: string,
  ): Promise<void> {
    try {
      const { data, error } = await this.supabase
        .admin()
        .rpc("complete_mfa_recovery", {
          p_operation_id: operationId,
          p_user_id: userId,
        });
      if (error || data !== "completed") this.throwRecoveryUnavailable();
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      this.throwRecoveryUnavailable();
    }
  }

  private throwRecoveryUnavailable(): never {
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
