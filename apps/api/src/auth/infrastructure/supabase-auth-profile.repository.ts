import { Injectable } from "@nestjs/common";
import { z } from "zod";

import {
  AuthProfileRepositoryUnavailableError,
  type AuthProfileRepository,
  type AuthUserProfile,
  type PasswordResetClaim,
  type VerificationOutcome,
} from "../application/auth-profile-repository.port";
import { SupabaseService } from "../../supabase/supabase.service";

const VERIFICATION_OUTCOMES: readonly VerificationOutcome[] = [
  "verified",
  "missing",
  "expired",
  "attempts_exhausted",
  "invalid",
];
const uuidSchema = z.uuid();
const userRowSchema = z.object({
  id: z.string(),
  auth_user_id: z.string().nullable(),
  email: z.string(),
  username: z.string().nullable(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  avatar_url: z.string().nullable(),
  is_active: z.boolean(),
  email_verified_at: z.string().nullable(),
});
const membershipRowSchema = z.object({
  role: z.string(),
  organizations: z
    .object({ id: z.string(), name: z.string(), slug: z.string() })
    .nullable(),
});

@Injectable()
export class SupabaseAuthProfileRepository implements AuthProfileRepository {
  constructor(private readonly supabase: SupabaseService) {}

  private profile(row: unknown): AuthUserProfile | null {
    const parsed = userRowSchema.safeParse(row);
    if (!parsed.success) return null;
    const value = parsed.data;
    return Object.freeze({
      id: value.id,
      authUserId: value.auth_user_id,
      email: value.email,
      username: value.username,
      firstName: value.first_name,
      lastName: value.last_name,
      avatarUrl: value.avatar_url,
      isActive: value.is_active,
      emailVerifiedAt: value.email_verified_at,
    });
  }

  async isUsernameTaken(username: string): Promise<boolean> {
    const { data } = await this.supabase
      .admin()
      .from("users")
      .select("id")
      .ilike("username", username)
      .maybeSingle();
    return Boolean(data);
  }

  async findByAuthUserId(authUserId: string) {
    const { data } = await this.supabase
      .admin()
      .from("users")
      .select(
        "id, auth_user_id, email, username, first_name, last_name, avatar_url, is_active, email_verified_at",
      )
      .eq("auth_user_id", authUserId)
      .maybeSingle();
    return this.profile(data);
  }

  async findById(userId: string) {
    const { data } = await this.supabase
      .admin()
      .from("users")
      .select(
        "id, auth_user_id, email, username, first_name, last_name, avatar_url, is_active, email_verified_at",
      )
      .eq("id", userId)
      .maybeSingle();
    return this.profile(data);
  }

  async findByEmail(email: string) {
    const { data } = await this.supabase
      .admin()
      .from("users")
      .select(
        "id, auth_user_id, email, username, first_name, last_name, avatar_url, is_active, email_verified_at",
      )
      .eq("email", email.trim().toLowerCase())
      .maybeSingle();
    return this.profile(data);
  }

  async resolveUsername(username: string): Promise<string | null> {
    const { data } = await this.supabase
      .admin()
      .from("users")
      .select("email")
      .ilike("username", username)
      .maybeSingle();
    return data?.email ?? null;
  }

  async listMemberships(userId: string) {
    const { data } = await this.supabase
      .admin()
      .from("organization_members")
      .select("role, organizations(id, name, slug)")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    return Object.freeze(
      (data ?? []).flatMap((row: unknown) => {
        const parsed = membershipRowSchema.safeParse(row);
        if (!parsed.success || !parsed.data.organizations) return [];
        return [
          Object.freeze({
            role: parsed.data.role,
            organization: Object.freeze(parsed.data.organizations),
          }),
        ];
      }),
    );
  }

  async lockedUntil(email: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .admin()
      .rpc("is_login_locked", { p_email: email });
    if (error) throw new AuthProfileRepositoryUnavailableError();
    return data;
  }

  async recordLoginFailure(
    email: string,
    maxAttempts: number,
    lockMinutes: number,
  ): Promise<void> {
    const { error } = await this.supabase.admin().rpc("record_login_failure", {
      p_email: email,
      p_max_attempts: maxAttempts,
      p_window: `${lockMinutes} minutes`,
      p_lock_duration: `${lockMinutes} minutes`,
    });
    if (error) throw new AuthProfileRepositoryUnavailableError();
  }

  async clearLoginFailures(email: string): Promise<void> {
    const { error } = await this.supabase
      .admin()
      .rpc("clear_login_attempts", { p_email: email });
    if (error) throw new AuthProfileRepositoryUnavailableError();
  }

  async bumpSessionEpoch(userId: string): Promise<void> {
    const { error } = await this.supabase
      .admin()
      .rpc("bump_session_epoch", { p_user_id: userId });
    if (error) throw new AuthProfileRepositoryUnavailableError();
  }

  async supersedeVerification(userId: string): Promise<void> {
    await this.supabase
      .admin()
      .from("auth_email_verifications")
      .update({ consumed_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("purpose", "signup")
      .is("consumed_at", null);
  }

  async storeVerification(
    artifact: Readonly<{
      userId: string;
      email: string;
      codeHash: string;
      expiresAt: string;
    }>,
  ): Promise<void> {
    const { error } = await this.supabase
      .admin()
      .from("auth_email_verifications")
      .insert({
        user_id: artifact.userId,
        email: artifact.email,
        code_hash: artifact.codeHash,
        purpose: "signup",
        expires_at: artifact.expiresAt,
      });
    if (error) throw new AuthProfileRepositoryUnavailableError();
  }

  async storePasswordReset(
    artifact: Readonly<{
      userId: string;
      tokenHash: string;
      expiresAt: string;
    }>,
  ): Promise<void> {
    const { error } = await this.supabase
      .admin()
      .from("auth_recovery_tokens")
      .insert({
        user_id: artifact.userId,
        token_hash: artifact.tokenHash,
        expires_at: artifact.expiresAt,
      });
    if (error) throw new AuthProfileRepositoryUnavailableError();
  }

  async replaceRecoveryCodes(
    userId: string,
    codeHashes: readonly string[],
  ): Promise<void> {
    await this.clearRecoveryCodes(userId);
    const { error } = await this.supabase
      .admin()
      .from("auth_mfa_recovery_codes")
      .insert(
        codeHashes.map((codeHash) => ({
          user_id: userId,
          code_hash: codeHash,
        })),
      );
    if (error) throw new AuthProfileRepositoryUnavailableError();
  }

  async clearRecoveryCodes(userId: string): Promise<void> {
    await this.supabase
      .admin()
      .from("auth_mfa_recovery_codes")
      .delete()
      .eq("user_id", userId);
  }

  async verifyEmailCode(
    userId: string,
    codeHash: string,
    maxAttempts: number,
  ): Promise<VerificationOutcome> {
    try {
      const { data, error } = await this.supabase
        .admin()
        .rpc("verify_email_code_atomic", {
          p_user_id: userId,
          p_code_hash: codeHash,
          p_max_attempts: maxAttempts,
        });
      if (
        error ||
        typeof data !== "string" ||
        !VERIFICATION_OUTCOMES.includes(data as VerificationOutcome)
      ) {
        throw new AuthProfileRepositoryUnavailableError();
      }
      return data as VerificationOutcome;
    } catch {
      throw new AuthProfileRepositoryUnavailableError();
    }
  }

  async consumePasswordReset(tokenHash: string): Promise<PasswordResetClaim> {
    try {
      const { data, error } = await this.supabase
        .admin()
        .rpc("consume_password_reset", { p_token_hash: tokenHash });
      if (error || !Array.isArray(data) || data.length !== 1) {
        throw new AuthProfileRepositoryUnavailableError();
      }

      const row = data[0] as
        | Readonly<{
            outcome?: unknown;
            user_id?: unknown;
            auth_user_id?: unknown;
          }>
        | undefined;
      if (!row || typeof row.outcome !== "string") {
        throw new AuthProfileRepositoryUnavailableError();
      }
      if (row.outcome === "consumed") {
        const userId = uuidSchema.safeParse(row.user_id);
        const authUserId = uuidSchema.safeParse(row.auth_user_id);
        if (!userId.success || !authUserId.success) {
          throw new AuthProfileRepositoryUnavailableError();
        }
        return Object.freeze({
          outcome: "consumed",
          userId: userId.data,
          authUserId: authUserId.data,
        });
      }
      if (
        !["invalid", "expired", "profile_missing"].includes(row.outcome) ||
        row.user_id != null ||
        row.auth_user_id != null
      ) {
        throw new AuthProfileRepositoryUnavailableError();
      }
      return Object.freeze({
        outcome: row.outcome as "invalid" | "expired" | "profile_missing",
      });
    } catch {
      throw new AuthProfileRepositoryUnavailableError();
    }
  }
}
