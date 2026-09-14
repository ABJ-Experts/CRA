import { Injectable } from "@nestjs/common";
import {
  technicalFileEvidenceLinkResponseSchema,
  technicalFileEvidenceReviewResponseSchema,
  technicalFileReadinessResponseSchema,
  type RecalculateTechnicalFileReadinessRequest,
  type ReviewTechnicalFileSourceRequest,
  type SignalTechnicalFileSourceMaterialChangeRequest,
  type TechnicalFileEvidenceLink,
  type TechnicalFileEvidenceReviewResponse,
  type TechnicalFileReadiness,
} from "@repo/contracts/technical-files";

import { SupabaseService } from "../../supabase/supabase.service";
import {
  TechnicalFileReadinessConflictError,
  TechnicalFileReadinessInvalidRequestError,
  type TechnicalFileReadinessRepository,
} from "../application/technical-file-readiness.port";

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

/** Service-role adapter: each DB function receives verified org, actor, and product scope. */
@Injectable()
export class SupabaseTechnicalFileReadinessRepository implements TechnicalFileReadinessRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async get(
    organizationId: string,
    input: Readonly<{ actorId: string; productId: string }>,
  ) {
    const rpc = await this.call(
      "get_technical_file_readiness",
      scope(organizationId, input),
    );
    this.throwFailure(rpc);
    if (rpc.outcome === "not_found") return null;
    if (rpc.outcome !== "found")
      throw new Error("technical file readiness unavailable");
    return readiness(rpc.result);
  }

  async recalculate(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
      } & RecalculateTechnicalFileReadinessRequest
    >,
  ) {
    const rpc = await this.call("recalculate_technical_file_readiness_atomic", {
      ...scope(organizationId, input),
      p_idempotency_key: input.idempotencyKey,
    });
    this.throwFailure(rpc);
    if (rpc.outcome === "not_found") return null;
    if (!["recalculated", "replayed", "found"].includes(rpc.outcome)) {
      throw new Error("technical file readiness unavailable");
    }
    return readiness(rpc.result);
  }

  async reviewSource(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        sectionKey: string;
        sourceId: string;
      } & ReviewTechnicalFileSourceRequest
    >,
  ) {
    const rpc = await this.call("review_technical_file_section_source_atomic", {
      ...scope(organizationId, input),
      p_section_key: input.sectionKey,
      p_source_id: input.sourceId,
      p_expected_version: input.expectedVersion,
      p_decision: input.decision,
      p_rationale: input.rationale,
      p_idempotency_key: input.idempotencyKey,
    });
    this.throwFailure(rpc);
    if (rpc.outcome === "not_found") return null;
    if (!["found", "reviewed", "replayed"].includes(rpc.outcome)) {
      throw new Error("technical file source review unavailable");
    }
    return review(rpc.result);
  }

  async signalMaterialChange(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        sectionKey: string;
        sourceId: string;
      } & SignalTechnicalFileSourceMaterialChangeRequest
    >,
  ) {
    const rpc = await this.call(
      "mark_technical_file_section_source_material_change_atomic",
      {
        ...scope(organizationId, input),
        p_section_key: input.sectionKey,
        p_source_id: input.sourceId,
        p_expected_version: input.expectedVersion,
        p_reason: input.reason,
        p_current_observed_revision: input.currentObservedRevision,
        p_current_fingerprint: input.currentFingerprint,
        p_idempotency_key: input.idempotencyKey,
      },
    );
    this.throwFailure(rpc);
    if (rpc.outcome === "not_found") return null;
    if (!["found", "marked_stale", "replayed"].includes(rpc.outcome)) {
      throw new Error("technical file source change unavailable");
    }
    return source(rpc.result);
  }

  private async call(name: string, args: Readonly<Record<string, unknown>>) {
    const response = await this.client().rpc(name, args);
    if (response.error) {
      throw new Error(
        `technical file readiness RPC ${name} failed${response.error.code ? ` (${response.error.code})` : ""}: ${response.error.message}`,
      );
    }
    const row = one(response.data);
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("invalid technical file readiness RPC result");
    }
    const record = row as Record<string, unknown>;
    if (typeof record.outcome !== "string") {
      throw new Error("invalid technical file readiness RPC outcome");
    }
    return { outcome: record.outcome, result: record.result };
  }

  private throwFailure(rpc: Readonly<{ outcome: string; result: unknown }>) {
    if (
      ["conflict", "version_conflict", "idempotency_conflict"].includes(
        rpc.outcome,
      )
    ) {
      throw new TechnicalFileReadinessConflictError(currentVersion(rpc.result));
    }
    if (rpc.outcome === "invalid_request" || rpc.outcome === "forbidden") {
      throw new TechnicalFileReadinessInvalidRequestError();
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

function one(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function readiness(value: unknown): TechnicalFileReadiness {
  const direct = technicalFileReadinessResponseSchema.safeParse(value);
  if (direct.success) return direct.data.readiness;
  return technicalFileReadinessResponseSchema.parse({ readiness: value })
    .readiness;
}

function review(value: unknown): TechnicalFileEvidenceReviewResponse {
  return technicalFileEvidenceReviewResponseSchema.parse(value);
}

function source(value: unknown): TechnicalFileEvidenceLink {
  return technicalFileEvidenceLinkResponseSchema.parse(value).source;
}

function currentVersion(value: unknown): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const version = (value as Record<string, unknown>).currentVersion;
  return typeof version === "number" ? version : null;
}
