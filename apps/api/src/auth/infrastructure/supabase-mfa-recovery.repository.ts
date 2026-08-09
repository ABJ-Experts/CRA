import { Injectable } from "@nestjs/common";
import { z } from "zod";

import type {
  MfaRecoveryClaim,
  MfaRecoveryRepository,
  MfaRecoveryStatus,
} from "../application/mfa-recovery-repository.port";
import { SupabaseService } from "../../supabase/supabase.service";

const RECOVERY_STATUSES: readonly MfaRecoveryStatus[] = [
  "claimed",
  "failed",
  "factors_removed",
  "completed",
];
const uuidSchema = z.uuid();

export class MfaRecoveryRepositoryUnavailableError extends Error {
  constructor() {
    super("MFA recovery repository unavailable");
    this.name = "MfaRecoveryRepositoryUnavailableError";
  }
}

@Injectable()
export class SupabaseMfaRecoveryRepository implements MfaRecoveryRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async claim(userId: string, codeHash: string): Promise<MfaRecoveryClaim> {
    try {
      const { data, error } = await this.supabase
        .admin()
        .rpc("claim_mfa_recovery", {
          p_user_id: userId,
          p_code_hash: codeHash,
        });
      if (error || !Array.isArray(data) || data.length !== 1) {
        throw new MfaRecoveryRepositoryUnavailableError();
      }
      return this.mapClaim(data[0]);
    } catch {
      throw new MfaRecoveryRepositoryUnavailableError();
    }
  }

  async status(
    operationId: string,
    userId: string,
  ): Promise<MfaRecoveryStatus> {
    const data = await this.rpc("get_mfa_recovery_status", {
      p_operation_id: operationId,
      p_user_id: userId,
    });
    if (
      typeof data !== "string" ||
      !RECOVERY_STATUSES.includes(data as MfaRecoveryStatus)
    ) {
      throw new MfaRecoveryRepositoryUnavailableError();
    }
    return data as MfaRecoveryStatus;
  }

  async markFactorsRemoved(operationId: string, userId: string): Promise<void> {
    const data = await this.rpc("mark_mfa_factors_removed", {
      p_operation_id: operationId,
      p_user_id: userId,
    });
    if (data !== "factors_removed") {
      throw new MfaRecoveryRepositoryUnavailableError();
    }
  }

  async complete(operationId: string, userId: string): Promise<void> {
    const data = await this.rpc("complete_mfa_recovery", {
      p_operation_id: operationId,
      p_user_id: userId,
    });
    if (data !== "completed") {
      throw new MfaRecoveryRepositoryUnavailableError();
    }
  }

  async fail(
    operationId: string,
    userId: string,
    errorCode: string,
  ): Promise<void> {
    const data = await this.rpc("fail_mfa_recovery", {
      p_operation_id: operationId,
      p_user_id: userId,
      p_error_code: errorCode,
    });
    if (data !== "failed") {
      throw new MfaRecoveryRepositoryUnavailableError();
    }
  }

  private mapClaim(value: unknown): MfaRecoveryClaim {
    const row = value as
      | Readonly<{
          outcome?: unknown;
          operation_id?: unknown;
          auth_user_id?: unknown;
          status?: unknown;
        }>
      | undefined;
    if (!row || typeof row.outcome !== "string") {
      throw new MfaRecoveryRepositoryUnavailableError();
    }
    if (row.outcome === "invalid") {
      if (
        row.operation_id != null ||
        row.auth_user_id != null ||
        row.status != null
      ) {
        throw new MfaRecoveryRepositoryUnavailableError();
      }
      return Object.freeze({ outcome: "invalid" });
    }
    const operationId = uuidSchema.safeParse(row.operation_id);
    const authUserId = uuidSchema.safeParse(row.auth_user_id);
    if (
      !["claimed", "resumed", "in_progress"].includes(row.outcome) ||
      !operationId.success ||
      !authUserId.success ||
      typeof row.status !== "string" ||
      !RECOVERY_STATUSES.includes(row.status as MfaRecoveryStatus) ||
      (row.outcome === "claimed" && row.status !== "claimed") ||
      (row.outcome === "in_progress" &&
        !["claimed", "failed"].includes(row.status))
    ) {
      throw new MfaRecoveryRepositoryUnavailableError();
    }
    return Object.freeze({
      outcome: row.outcome as "claimed" | "resumed" | "in_progress",
      operationId: operationId.data,
      authUserId: authUserId.data,
      status: row.status as MfaRecoveryStatus,
    });
  }

  private async rpc(
    name:
      | "get_mfa_recovery_status"
      | "mark_mfa_factors_removed"
      | "complete_mfa_recovery"
      | "fail_mfa_recovery",
    args: Readonly<Record<string, string>>,
  ): Promise<unknown> {
    try {
      const { data, error } = await this.supabase
        .admin()
        .rpc(name, args as never);
      if (error) throw new MfaRecoveryRepositoryUnavailableError();
      return data;
    } catch {
      throw new MfaRecoveryRepositoryUnavailableError();
    }
  }
}
