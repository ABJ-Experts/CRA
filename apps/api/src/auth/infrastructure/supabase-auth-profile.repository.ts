import { Injectable } from "@nestjs/common";
import { z } from "zod";

import type {
  AuthProfileRepository,
  PasswordResetClaim,
  VerificationOutcome,
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

export class AuthProfileRepositoryUnavailableError extends Error {
  constructor() {
    super("auth profile repository unavailable");
    this.name = "AuthProfileRepositoryUnavailableError";
  }
}

@Injectable()
export class SupabaseAuthProfileRepository implements AuthProfileRepository {
  constructor(private readonly supabase: SupabaseService) {}

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
