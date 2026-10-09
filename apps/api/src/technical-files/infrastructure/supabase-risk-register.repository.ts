import { Injectable } from "@nestjs/common";
import {
  riskRegisterRiskResponseSchema,
  riskRegisterWorkspaceResponseSchema,
  type AcceptResidualRiskRequest,
  type ArchiveRiskRegisterRiskRequest,
  type CreateRiskRegisterRiskRequest,
  type RiskRegisterRisk,
  type RiskRegisterWorkspace,
  type UpdateRiskRegisterRiskRequest,
} from "@repo/contracts/risk-registers";

import { SupabaseService } from "../../supabase/supabase.service";
import {
  RiskRegisterConflictError,
  RiskRegisterInvalidRequestError,
  type RiskRegisterRepository,
} from "../application/risk-register.port";

type RpcClient = Readonly<{
  rpc(
    name: string,
    args?: Readonly<Record<string, unknown>>,
  ): Promise<
    Readonly<{
      data: unknown;
      error: Readonly<{ code?: string; message: string }> | null;
    }>
  >;
}>;

/** Service-role adapter; each function receives verified tenant and actor scope. */
@Injectable()
export class SupabaseRiskRegisterRepository implements RiskRegisterRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async get(
    organizationId: string,
    input: Readonly<{ actorId: string; productId: string }>,
  ) {
    const rpc = await this.call(
      "get_technical_file_risk_register",
      scope(organizationId, input),
    );
    this.throwFailure(rpc);
    if (rpc.outcome === "not_found") return null;
    if (rpc.outcome !== "found") throw new Error("risk register unavailable");
    return workspace(rpc.result).riskRegister;
  }

  async createRisk(
    organizationId: string,
    input: Readonly<
      { actorId: string; productId: string } & CreateRiskRegisterRiskRequest
    >,
  ) {
    const rpc = await this.call("create_technical_file_risk_atomic", {
      ...scope(organizationId, input),
      p_payload: payload(input, ["idempotencyKey"]),
      p_idempotency_key: input.idempotencyKey,
    });
    return this.risk(rpc);
  }

  async updateRisk(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        riskId: string;
      } & UpdateRiskRegisterRiskRequest
    >,
  ) {
    const rpc = await this.call("update_technical_file_risk_atomic", {
      ...scope(organizationId, input),
      p_risk_id: input.riskId,
      p_expected_version: input.expectedVersion,
      p_payload: payload(input, ["expectedVersion", "idempotencyKey"]),
      p_idempotency_key: input.idempotencyKey,
    });
    return this.risk(rpc, input.riskId);
  }

  async archiveRisk(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        riskId: string;
      } & ArchiveRiskRegisterRiskRequest
    >,
  ) {
    const rpc = await this.call("archive_technical_file_risk_atomic", {
      ...scope(organizationId, input),
      p_risk_id: input.riskId,
      p_expected_version: input.expectedVersion,
      p_archive_rationale: input.archiveRationale,
      p_idempotency_key: input.idempotencyKey,
    });
    return this.risk(rpc, input.riskId);
  }

  async acceptResidualRisk(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        riskId: string;
      } & AcceptResidualRiskRequest
    >,
  ) {
    const rpc = await this.call("accept_technical_file_residual_risk_atomic", {
      ...scope(organizationId, input),
      p_risk_id: input.riskId,
      p_expected_version: input.expectedVersion,
      p_acceptance_rationale: input.acceptanceRationale,
      p_idempotency_key: input.idempotencyKey,
    });
    return this.risk(rpc, input.riskId);
  }

  private async call(name: string, args: Readonly<Record<string, unknown>>) {
    const response = await this.client().rpc(name, args);
    if (response.error) {
      throw new Error(
        `risk register RPC ${name} failed${response.error.code ? ` (${response.error.code})` : ""}: ${response.error.message}`,
      );
    }
    const row = one(response.data);
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("invalid risk register RPC result");
    }
    const record = row as Record<string, unknown>;
    if (typeof record.outcome !== "string") {
      throw new Error("invalid risk register RPC outcome");
    }
    return { outcome: record.outcome, result: record.result };
  }

  private risk(
    rpc: Readonly<{ outcome: string; result: unknown }>,
    riskId?: string,
  ): RiskRegisterRisk | null {
    this.throwFailure(rpc, riskId);
    if (rpc.outcome === "not_found") return null;
    if (
      !["created", "updated", "archived", "accepted", "replayed"].includes(
        rpc.outcome,
      )
    ) {
      throw new Error("risk register unavailable");
    }
    const direct = riskRegisterRiskResponseSchema.safeParse(rpc.result);
    if (direct.success) return direct.data.risk;
    const register = workspace(rpc.result).riskRegister;
    const risk = register?.risks.find((candidate) => candidate.id === riskId);
    if (!risk)
      throw new Error("risk register mutation did not return the risk");
    return risk;
  }

  private throwFailure(
    rpc: Readonly<{ outcome: string; result: unknown }>,
    riskId?: string,
  ) {
    if (
      ["conflict", "version_conflict", "idempotency_conflict"].includes(
        rpc.outcome,
      )
    ) {
      const currentVersion = currentRiskVersion(rpc.result, riskId);
      throw new RiskRegisterConflictError(currentVersion);
    }
    if (rpc.outcome === "invalid_request" || rpc.outcome === "forbidden") {
      throw new RiskRegisterInvalidRequestError();
    }
  }

  private client(): RpcClient {
    return this.supabase.admin() as unknown as RpcClient;
  }
}

function scope(
  organizationId: string,
  input: Readonly<{ actorId: string; productId: string }>,
) {
  return {
    p_organization_id: organizationId,
    p_actor_user_id: input.actorId,
    p_product_id: input.productId,
  };
}

function payload<T extends Record<string, unknown>>(
  input: T,
  omitted: readonly string[],
) {
  return Object.fromEntries(
    Object.entries(input).filter(
      ([key]) => !["actorId", "productId", "riskId", ...omitted].includes(key),
    ),
  );
}

function one(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function workspace(value: unknown): RiskRegisterWorkspace {
  const direct = riskRegisterWorkspaceResponseSchema.safeParse(value);
  if (direct.success) return direct.data;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return riskRegisterWorkspaceResponseSchema.parse({
      riskRegister: record.register ?? record,
    });
  }
  return riskRegisterWorkspaceResponseSchema.parse(value);
}

function currentRiskVersion(value: unknown, riskId?: string): number | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const version = (value as Record<string, unknown>).currentVersion;
    if (typeof version === "number") return version;
  }
  const parsed = riskRegisterWorkspaceResponseSchema.safeParse(value);
  if (!parsed.success || !riskId) return null;
  return (
    parsed.data.riskRegister?.risks.find((risk) => risk.id === riskId)
      ?.version ?? null
  );
}
