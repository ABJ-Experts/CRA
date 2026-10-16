import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
  commitFrameworkUpgradeResponseSchema,
  createFrameworkUpgradeReviewResponseSchema,
  frameworkCrosswalkEvidenceReuseResponseSchema,
  frameworkCrosswalkResponseSchema,
  frameworkUpgradeDecisionResponseSchema,
  frameworkUpgradePreviewResponseSchema,
  frameworkUpgradeReviewResponseSchema,
} from "@repo/contracts/frameworks";
import type { z } from "zod";
import { SupabaseService } from "../../supabase/supabase.service";
import {
  UpgradeBlockedError,
  UpgradeConflictError,
  UpgradeForbiddenError,
  UpgradeInvalidRequestError,
  UpgradeNotFoundError,
  type UpgradeRepository,
} from "../application/upgrade-use-cases";

const unavailable = () =>
  new ServiceUnavailableException({
    message: "Framework upgrades are temporarily unavailable.",
    code: "framework_upgrade_unavailable",
  });

type RpcResult = { outcome: string; result: unknown };

function offsetCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  if (
    !/^(0|[1-9]\d{0,8})$/.test(decoded) ||
    Buffer.from(decoded).toString("base64url") !== cursor
  ) {
    throw new UpgradeInvalidRequestError();
  }
  return Number(decoded);
}

function uuidCursor(cursor: string | undefined): string | null {
  if (!cursor) return null;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      cursor,
    )
  ) {
    throw new UpgradeInvalidRequestError();
  }
  return cursor;
}

function parseResult<T extends z.ZodTypeAny>(
  row: RpcResult,
  schema: T,
): z.output<T> {
  if (row.outcome === "conflict" || row.outcome === "upgrade_required")
    throw new UpgradeConflictError();
  if (row.outcome === "forbidden") throw new UpgradeForbiddenError();
  if (row.outcome === "invalid_request") throw new UpgradeInvalidRequestError();
  if (row.outcome === "not_found") throw new UpgradeNotFoundError();
  if (row.outcome === "blocked") throw new UpgradeBlockedError();
  if (
    ![
      "previewed",
      "created",
      "recorded",
      "upgraded",
      "listed",
      "unchanged",
    ].includes(row.outcome)
  ) {
    throw unavailable();
  }
  const parsed = schema.safeParse(row.result);
  if (!parsed.success) throw unavailable();
  return parsed.data;
}

@Injectable()
export class SupabaseUpgradeRepository implements UpgradeRepository {
  constructor(private readonly supabase: SupabaseService) {}

  private async call(
    name: string,
    args: Record<string, unknown>,
  ): Promise<RpcResult> {
    // Migrations and generated Supabase types are applied together. The cast
    // only bridges dynamically named RPCs; all public results are Zod parsed.
    const client = this.supabase.admin() as unknown as {
      rpc(
        functionName: string,
        parameters: Record<string, unknown>,
      ): Promise<{ data: unknown; error: unknown }>;
    };
    const { data, error } = await client.rpc(name, args);
    if (error || !data) throw unavailable();
    const row: unknown = Array.isArray(data) ? (data as unknown[])[0] : data;
    if (
      !row ||
      typeof row !== "object" ||
      !("outcome" in row) ||
      !("result" in row) ||
      typeof row.outcome !== "string"
    )
      throw unavailable();
    return row as RpcResult;
  }

  async crosswalks(
    orgId: string,
    input: Parameters<UpgradeRepository["crosswalks"]>[1],
  ) {
    const row = await this.call("m10_crosswalk_page", {
      p_organization_id: orgId,
      p_actor_user_id: input.actorId,
      p_pack_key: input.packKey,
      p_version_key: input.versionKey,
      p_limit: input.limit,
      p_offset: offsetCursor(input.cursor),
    });
    return parseResult(row, frameworkCrosswalkResponseSchema);
  }

  async preview(
    orgId: string,
    input: Parameters<UpgradeRepository["preview"]>[1],
  ) {
    const row = await this.call("m10_upgrade_preview", {
      p_organization_id: orgId,
      p_actor_user_id: input.actorId,
      p_pack_key: input.packKey,
      p_target_version_key: input.targetVersionKey,
      p_limit: input.limit,
      p_cursor: uuidCursor(input.cursor),
    });
    const result = parseResult(row, frameworkUpgradePreviewResponseSchema);
    if (
      result.packKey !== input.packKey ||
      result.targetVersionKey !== input.targetVersionKey
    )
      throw unavailable();
    return result;
  }

  async createReview(
    orgId: string,
    input: Parameters<UpgradeRepository["createReview"]>[1],
  ) {
    const row = await this.call("m10_create_upgrade_review", {
      p_organization_id: orgId,
      p_actor_user_id: input.actorId,
      p_pack_key: input.packKey,
      p_target_version_key: input.targetVersionKey,
      p_expected_selection_revision: input.expectedSelectionRevision,
      p_idempotency_key: input.idempotencyKey,
    });
    const result = parseResult(row, createFrameworkUpgradeReviewResponseSchema);
    if (
      result.packKey !== input.packKey ||
      result.targetVersionKey !== input.targetVersionKey
    )
      throw unavailable();
    return result;
  }

  async review(
    orgId: string,
    input: Parameters<UpgradeRepository["review"]>[1],
  ) {
    const row = await this.call("m10_upgrade_review_page", {
      p_organization_id: orgId,
      p_actor_user_id: input.actorId,
      p_review_id: input.reviewId,
      p_limit: input.limit,
      p_offset: offsetCursor(input.cursor),
    });
    const result = parseResult(row, frameworkUpgradeReviewResponseSchema);
    if (result.packKey !== input.packKey || result.reviewId !== input.reviewId)
      throw unavailable();
    return result;
  }

  async decide(
    orgId: string,
    input: Parameters<UpgradeRepository["decide"]>[1],
  ) {
    const row = await this.call("m10_set_upgrade_decision", {
      p_organization_id: orgId,
      p_actor_user_id: input.actorId,
      p_review_id: input.reviewId,
      p_mapping_id: input.mappingId,
      p_target_keys:
        input.action === "leave_gap" ? [] : input.targetRequirementKeys,
      p_expected_review_revision: input.expectedReviewRevision,
      p_idempotency_key: input.idempotencyKey,
    });
    const result = parseResult(row, frameworkUpgradeDecisionResponseSchema);
    if (result.reviewId !== input.reviewId) throw unavailable();
    return result;
  }

  async commit(
    orgId: string,
    input: Parameters<UpgradeRepository["commit"]>[1],
  ) {
    const row = await this.call("m10_commit_upgrade", {
      p_organization_id: orgId,
      p_actor_user_id: input.actorId,
      p_review_id: input.reviewId,
      p_expected_review_revision: input.expectedReviewRevision,
      p_idempotency_key: input.idempotencyKey,
    });
    const result = parseResult(row, commitFrameworkUpgradeResponseSchema);
    if (
      result.reviewId !== input.reviewId ||
      result.selection.packKey !== input.packKey
    )
      throw unavailable();
    return result;
  }

  async evidenceReuse(
    orgId: string,
    input: Parameters<UpgradeRepository["evidenceReuse"]>[1],
  ) {
    const row = await this.call("m10_crosswalk_evidence_reuse", {
      p_organization_id: orgId,
      p_actor_user_id: input.actorId,
      p_evidence_version_id: input.evidenceVersionId,
      p_product_id: input.productId,
      p_limit: input.limit,
      p_offset: offsetCursor(input.cursor),
    });
    return parseResult(row, frameworkCrosswalkEvidenceReuseResponseSchema);
  }
}
