import { Injectable } from "@nestjs/common";
import { z } from "zod";
import {
  productClassificationRunSchema,
  productClassificationHistoryResponseSchema,
  deriveProductClassification,
  productClassificationsResponseSchema,
  type ProductClassificationPolicy,
  type SaveProductClassificationInput,
  type ProductClassificationHistoryQuery,
  type ProductClassificationLatestQuery,
} from "@repo/contracts/products";
import { SupabaseService } from "../../supabase/supabase.service";
import {
  ClassificationFailure,
  type ProductClassificationRepository,
} from "../application/product-classification";
type ProviderResult = { data: unknown; error: unknown; count?: number | null };
const historySchema = productClassificationHistoryResponseSchema.omit({
  policy: true,
});
@Injectable()
export class SupabaseProductClassificationRepository implements ProductClassificationRepository {
  constructor(private readonly supabase: SupabaseService) {}
  private client() {
    return this.supabase.admin();
  }
  private data(result: ProviderResult): unknown {
    if (result.error) throw new ClassificationFailure("unavailable");
    return result.data;
  }
  private wireRun(value: unknown) {
    const parsed = productClassificationRunSchema.safeParse(value);
    if (
      !parsed.success ||
      deriveProductClassification(parsed.data.answers) !==
        parsed.data.classification
    )
      throw new ClassificationFailure("malformed_provider");
    return parsed.data;
  }
  async save(
    orgId: string,
    actorId: string,
    productId: string,
    input: SaveProductClassificationInput,
    policy: ProductClassificationPolicy,
  ) {
    const result = this.data(
      await this.client().rpc("save_product_classification_atomic", {
        p_organization_id: orgId,
        p_actor_user_id: actorId,
        p_product_id: productId,
        p_expected_product_version: input.expectedProductVersion,
        p_expected_revision: input.expectedRevision,
        p_policy_snapshot: policy,
        p_policy_hash: policy.hash,
        p_answers: input.answers,
        p_rationale: input.rationale,
        p_idempotency_key: input.idempotencyKey,
      }),
    );
    const parsed = z
      .array(z.object({ outcome: z.string(), run: z.unknown() }))
      .length(1)
      .safeParse(result);
    if (!parsed.success) throw new ClassificationFailure("malformed_provider");
    const row = parsed.data[0]!;
    if (row.outcome === "saved" || row.outcome === "replayed")
      return { run: this.wireRun(row.run) };
    const outcome = z
      .enum([
        "not_found",
        "forbidden",
        "invalid_request",
        "conflict",
        "invalid_state",
        "idempotency_mismatch",
      ])
      .safeParse(row.outcome);
    throw new ClassificationFailure(
      outcome.success ? outcome.data : "malformed_provider",
    );
  }
  async history(
    orgId: string,
    actorId: string,
    productId: string,
    query: ProductClassificationHistoryQuery,
  ) {
    const result = this.data(
      await this.client().rpc("get_product_classification_history", {
        p_organization_id: orgId,
        p_actor_user_id: actorId,
        p_product_id: productId,
        p_page: query.page,
        p_page_size: query.pageSize,
      }),
    );
    const parsed = z
      .array(z.object({ outcome: z.string(), history: z.unknown() }))
      .length(1)
      .safeParse(result);
    if (!parsed.success) throw new ClassificationFailure("malformed_provider");
    const row = parsed.data[0]!;
    if (row.outcome !== "found") {
      const outcome = z
        .enum(["forbidden", "not_found", "invalid_request"])
        .safeParse(row.outcome);
      throw new ClassificationFailure(
        outcome.success ? outcome.data : "malformed_provider",
      );
    }
    const response = historySchema.safeParse(row.history);
    if (!response.success)
      throw new ClassificationFailure("malformed_provider");
    const history = response.data;
    if (
      history.runs.page !== query.page ||
      history.runs.pageSize !== query.pageSize ||
      history.runs.rows.length > query.pageSize ||
      history.runs.rows.length > history.runs.total ||
      history.runs.pageCount !==
        Math.max(1, Math.ceil(history.runs.total / query.pageSize)) ||
      (history.latest !== null && history.latest.productId !== productId) ||
      history.runs.rows.some((run) => run.productId !== productId)
    )
      throw new ClassificationFailure("malformed_provider");
    if (history.latest) this.wireRun(history.latest);
    history.runs.rows.forEach((run) => this.wireRun(run));
    return history;
  }
  async latest(
    orgId: string,
    _actorId: string,
    query: ProductClassificationLatestQuery,
  ) {
    const value = this.data(
      await this.client().rpc("get_product_classifications_latest", {
        p_organization_id: orgId,
        p_actor_user_id: _actorId,
        p_product_ids: query.productIds,
      }),
    );
    const parsed = z
      .array(z.object({ outcome: z.string(), classifications: z.unknown() }))
      .length(1)
      .safeParse(value);
    if (!parsed.success) throw new ClassificationFailure("malformed_provider");
    const row = parsed.data[0]!;
    if (row.outcome !== "found") {
      const outcome = z
        .enum(["forbidden", "invalid_request", "not_found"])
        .safeParse(row.outcome);
      throw new ClassificationFailure(
        outcome.success ? outcome.data : "malformed_provider",
      );
    }
    const response = productClassificationsResponseSchema.safeParse({
      classifications: row.classifications,
    });
    if (
      !response.success ||
      response.data.classifications.length !== query.productIds.length ||
      query.productIds.some(
        (id) =>
          !response.data.classifications.some((row) => row.productId === id),
      )
    )
      throw new ClassificationFailure("malformed_provider");
    return response.data;
  }
}
