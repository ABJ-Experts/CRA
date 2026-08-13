import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
  memberStatesResponseSchema,
  productResponseSchema,
  productsResponseSchema,
  releaseLifecycleTimelineResponseSchema,
  releaseMarketAvailabilityResponseSchema,
  releaseResponseSchema,
  releasesResponseSchema,
  type AddReleaseMarketAvailabilityInput,
  type ArchiveProductInput,
  type ArchiveReleaseInput,
  type CorrectPlacedOnMarketDateInput,
  type CorrectReleaseMarketAvailabilityInput,
  type CreateProductInput,
  type CreateReleaseInput,
  type MemberStateReference,
  type MoveProductLegalEntityInput,
  type Product,
  type ProductListQuery,
  type Release,
  type ReleaseLifecycleTimelineEvent,
  type ReleaseMarketAvailability,
  type ReleaseListQuery,
  type RemoveReleaseMarketAvailabilityInput,
  type TransitionReleaseLifecycleInput,
  type UpdateProductInput,
  type UpdateReleaseInput,
} from "@repo/contracts/products";

import { SupabaseService } from "../../supabase/supabase.service";
import type {
  ProductMutationOutcome,
  ProductRepository,
  ReleaseMutationOutcome,
} from "../application/product-use-cases";

type ProviderRow = Readonly<Record<string, unknown>>;
type ProviderResult = Readonly<{
  data: unknown;
  error: Readonly<{ message: string }> | null;
}>;
interface ProductRpcClient {
  rpc(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): PromiseLike<ProviderResult>;
}

const PRODUCT_OUTCOMES = new Set([
  "created",
  "replayed",
  "updated",
  "assigned",
  "archived",
  "conflict",
  "idempotency_mismatch",
  "invalid_request",
  "invalid_state",
  "blocked",
  "not_found",
]);
const RELEASE_OUTCOMES = new Set([
  "created",
  "replayed",
  "updated",
  "archived",
  "transitioned",
  "corrected",
  "conflict",
  "idempotency_mismatch",
  "invalid_request",
  "invalid_state",
  "blocked",
  "not_found",
  "invalid_transition",
  "placement_requires_placed_on_market_at",
  "placement_requires_active_market_availability",
  "placed_on_market_date_not_set",
  "member_state_unavailable",
  "market_availability_not_found",
]);

/** Service-role adapter: organizationId is the first argument of every operation. */
@Injectable()
export class SupabaseProductRepository implements ProductRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async listProducts(
    organizationId: string,
    actorId: string,
    query: ProductListQuery,
  ) {
    const row = await this.singleRpc(
      "list_products",
      Object.freeze({
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_page: query.page,
        p_page_size: query.pageSize,
        p_q: query.q ?? null,
        p_archived: query.archived ?? null,
        p_product_type: query.productType ?? null,
        p_responsible_owner_id: query.responsibleOwnerId ?? null,
      }),
    );
    if (this.outcome(row, new Set(["found", "not_found"])) === "not_found")
      return Object.freeze({ outcome: "not_found" as const });
    return Object.freeze({
      outcome: "found" as const,
      products: this.products(row.products),
    });
  }

  async getProduct(organizationId: string, actorId: string, productId: string) {
    const row = await this.singleRpc(
      "get_product",
      Object.freeze({
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_product_id: productId,
      }),
    );
    if (this.outcome(row, new Set(["found", "not_found"])) === "not_found")
      return Object.freeze({ outcome: "not_found" as const });
    return Object.freeze({
      outcome: "found" as const,
      product: this.product(row.product),
    });
  }

  async createProduct(
    organizationId: string,
    actorId: string,
    input: CreateProductInput,
  ) {
    const row = await this.singleRpc(
      "create_product_atomic",
      this.productInput(organizationId, actorId, input),
    );
    return this.productMutation(row);
  }
  async updateProduct(
    organizationId: string,
    actorId: string,
    productId: string,
    input: UpdateProductInput,
  ) {
    const row = await this.singleRpc(
      "update_product_atomic",
      Object.freeze({
        ...this.productInput(organizationId, actorId, input),
        p_product_id: productId,
        p_expected_version: input.expectedVersion,
        p_description_provided: Object.hasOwn(input, "description"),
      }),
    );
    return this.productMutation(row);
  }
  async assignProductLegalEntity(
    organizationId: string,
    actorId: string,
    productId: string,
    input: MoveProductLegalEntityInput,
  ) {
    const row = await this.singleRpc(
      "assign_product_legal_entity_atomic",
      Object.freeze({
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_product_id: productId,
        p_legal_entity_id: input.legalEntityId,
        p_expected_version: input.expectedVersion,
        p_reason: input.reason,
      }),
    );
    return this.productMutation(row);
  }
  async archiveProduct(
    organizationId: string,
    actorId: string,
    productId: string,
    input: ArchiveProductInput,
  ) {
    const row = await this.singleRpc(
      "archive_product_atomic",
      Object.freeze({
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_product_id: productId,
        p_expected_version: input.expectedVersion,
        p_reason: input.reason ?? null,
      }),
    );
    return this.productMutation(row);
  }

  async listReleases(
    organizationId: string,
    actorId: string,
    productId: string,
    query: ReleaseListQuery,
  ) {
    const row = await this.singleRpc(
      "list_product_releases",
      Object.freeze({
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_product_id: productId,
        p_page: query.page,
        p_page_size: query.pageSize,
        p_archived: query.archived ?? null,
        p_lifecycle: query.lifecycle ?? null,
      }),
    );
    if (this.outcome(row, new Set(["found", "not_found"])) === "not_found")
      return Object.freeze({ outcome: "not_found" as const });
    return Object.freeze({
      outcome: "found" as const,
      releases: this.releases(row.releases),
    });
  }
  async getRelease(
    organizationId: string,
    actorId: string,
    productId: string,
    releaseId: string,
  ) {
    const row = await this.singleRpc(
      "get_product_release",
      Object.freeze({
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_product_id: productId,
        p_release_id: releaseId,
      }),
    );
    if (this.outcome(row, new Set(["found", "not_found"])) === "not_found")
      return Object.freeze({ outcome: "not_found" as const });
    return Object.freeze({
      outcome: "found" as const,
      release: this.release(row.release),
    });
  }
  async createRelease(
    organizationId: string,
    actorId: string,
    productId: string,
    input: CreateReleaseInput,
  ) {
    const row = await this.singleRpc(
      "create_product_release_atomic",
      Object.freeze({
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_product_id: productId,
        p_label: input.label,
        p_release_version: input.version,
        p_description: input.description ?? null,
        p_idempotency_key: input.idempotencyKey,
      }),
    );
    return this.releaseMutation(row);
  }
  async updateRelease(
    organizationId: string,
    actorId: string,
    productId: string,
    releaseId: string,
    input: UpdateReleaseInput,
  ) {
    const row = await this.singleRpc(
      "update_product_release_atomic",
      Object.freeze({
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_product_id: productId,
        p_release_id: releaseId,
        p_label: input.label ?? null,
        p_release_version: input.version ?? null,
        p_description: input.description ?? null,
        p_description_provided: Object.hasOwn(input, "description"),
        p_expected_version: input.expectedVersion,
      }),
    );
    return this.releaseMutation(row);
  }

  async listMemberStates(organizationId: string, actorId: string) {
    const row = await this.singleRpc(
      "get_m2_member_states",
      Object.freeze({
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
      }),
    );
    if (this.outcome(row, new Set(["found", "not_found"])) === "not_found")
      return Object.freeze({ outcome: "not_found" as const });
    return Object.freeze({
      outcome: "found" as const,
      memberStates: this.memberStates(row.member_states),
    });
  }

  async getReleaseMarketAvailability(
    organizationId: string,
    actorId: string,
    productId: string,
    releaseId: string,
  ) {
    const row = await this.singleRpc(
      "get_product_release_market_availability",
      Object.freeze({
        p_organization_id: organizationId,
        p_product_id: productId,
        p_release_id: releaseId,
        p_actor_user_id: actorId,
      }),
    );
    if (this.outcome(row, new Set(["found", "not_found"])) === "not_found")
      return Object.freeze({ outcome: "not_found" as const });
    return Object.freeze({
      outcome: "found" as const,
      marketAvailability: this.marketAvailability(row.market_availability),
    });
  }

  async addReleaseMarketAvailability(
    organizationId: string,
    actorId: string,
    productId: string,
    releaseId: string,
    input: AddReleaseMarketAvailabilityInput,
  ) {
    const row = await this.singleRpc(
      "add_product_release_market_availability_atomic",
      Object.freeze({
        p_organization_id: organizationId,
        p_product_id: productId,
        p_release_id: releaseId,
        p_actor_user_id: actorId,
        p_expected_version: input.expectedVersion,
        p_country_code: input.countryCode,
        p_reason: input.reason ?? null,
        p_correlation_id: randomUUID(),
      }),
    );
    return this.releaseMutation(row);
  }

  async removeReleaseMarketAvailability(
    organizationId: string,
    actorId: string,
    productId: string,
    releaseId: string,
    countryCode: string,
    input: RemoveReleaseMarketAvailabilityInput,
  ) {
    const row = await this.singleRpc(
      "remove_product_release_market_availability_atomic",
      Object.freeze({
        p_organization_id: organizationId,
        p_product_id: productId,
        p_release_id: releaseId,
        p_actor_user_id: actorId,
        p_expected_version: input.expectedVersion,
        p_country_code: countryCode,
        p_reason: input.reason ?? null,
        p_correlation_id: randomUUID(),
      }),
    );
    return this.releaseMutation(row);
  }

  async correctReleaseMarketAvailability(
    organizationId: string,
    actorId: string,
    productId: string,
    releaseId: string,
    input: CorrectReleaseMarketAvailabilityInput,
  ) {
    const row = await this.singleRpc(
      "correct_product_release_market_availability_atomic",
      Object.freeze({
        p_organization_id: organizationId,
        p_product_id: productId,
        p_release_id: releaseId,
        p_actor_user_id: actorId,
        p_expected_version: input.expectedVersion,
        p_from_country_code: input.fromCountryCode,
        p_to_country_code: input.toCountryCode,
        p_reason: input.reason ?? null,
        p_correlation_id: randomUUID(),
      }),
    );
    return this.releaseMutation(row);
  }

  async transitionReleaseLifecycle(
    organizationId: string,
    actorId: string,
    productId: string,
    releaseId: string,
    input: TransitionReleaseLifecycleInput,
  ) {
    const row = await this.singleRpc(
      "transition_product_release_lifecycle_atomic",
      Object.freeze({
        p_organization_id: organizationId,
        p_product_id: productId,
        p_release_id: releaseId,
        p_actor_user_id: actorId,
        p_expected_version: input.expectedVersion,
        p_target_lifecycle: input.targetState,
        p_placed_on_market_at: input.placedOnMarketAt ?? null,
        p_reason: input.reason ?? null,
        p_correlation_id: randomUUID(),
      }),
    );
    return this.releaseMutation(row);
  }

  async correctPlacedOnMarketDate(
    organizationId: string,
    actorId: string,
    productId: string,
    releaseId: string,
    input: CorrectPlacedOnMarketDateInput,
  ) {
    const row = await this.singleRpc(
      "correct_product_release_placed_on_market_at_atomic",
      Object.freeze({
        p_organization_id: organizationId,
        p_product_id: productId,
        p_release_id: releaseId,
        p_actor_user_id: actorId,
        p_expected_version: input.expectedVersion,
        p_corrected_placed_on_market_at: input.correctedPlacedOnMarketAt,
        p_reason: input.reason,
        p_correlation_id: randomUUID(),
      }),
    );
    return this.releaseMutation(row);
  }

  async getReleaseLifecycleTimeline(
    organizationId: string,
    actorId: string,
    productId: string,
    releaseId: string,
  ) {
    const row = await this.singleRpc(
      "get_product_release_lifecycle_timeline",
      Object.freeze({
        p_organization_id: organizationId,
        p_product_id: productId,
        p_release_id: releaseId,
        p_actor_user_id: actorId,
      }),
    );
    if (this.outcome(row, new Set(["found", "not_found"])) === "not_found")
      return Object.freeze({ outcome: "not_found" as const });
    return Object.freeze({
      outcome: "found" as const,
      timeline: this.timeline(row.timeline),
    });
  }
  async archiveRelease(
    organizationId: string,
    actorId: string,
    productId: string,
    releaseId: string,
    input: ArchiveReleaseInput,
  ) {
    const row = await this.singleRpc(
      "archive_product_release_atomic",
      Object.freeze({
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_product_id: productId,
        p_release_id: releaseId,
        p_expected_version: input.expectedVersion,
        p_reason: input.reason ?? null,
      }),
    );
    return this.releaseMutation(row);
  }

  private productInput(
    organizationId: string,
    actorId: string,
    input: CreateProductInput | UpdateProductInput,
  ): Readonly<Record<string, unknown>> {
    return Object.freeze({
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      ...("idempotencyKey" in input
        ? { p_idempotency_key: input.idempotencyKey }
        : {}),
      ...("legalEntityId" in input
        ? { p_legal_entity_id: input.legalEntityId }
        : {}),
      p_name: input.name ?? null,
      p_internal_code: input.internalCode ?? null,
      p_product_type: input.productType ?? null,
      p_description: input.description ?? null,
      p_responsible_owner_id: input.responsibleOwnerId ?? null,
    });
  }
  private productMutation(row: ProviderRow): ProductMutationOutcome {
    const outcome = this.outcome(row, PRODUCT_OUTCOMES);
    if (outcome === "conflict")
      return Object.freeze({
        outcome,
        ...(row.product === null ? {} : { product: this.product(row.product) }),
      });
    if (
      ["created", "replayed", "updated", "assigned", "archived"].includes(
        outcome,
      )
    )
      return Object.freeze({
        outcome: outcome as
          "created" | "replayed" | "updated" | "assigned" | "archived",
        product: this.product(row.product),
      });
    return Object.freeze({
      outcome: outcome as
        | "idempotency_mismatch"
        | "invalid_request"
        | "invalid_state"
        | "blocked"
        | "not_found",
    });
  }
  private releaseMutation(row: ProviderRow): ReleaseMutationOutcome {
    const outcome = this.outcome(row, RELEASE_OUTCOMES);
    if (outcome === "conflict")
      return Object.freeze({
        outcome,
        ...(row.release === null ? {} : { release: this.release(row.release) }),
      });
    if (
      [
        "created",
        "replayed",
        "updated",
        "archived",
        "transitioned",
        "corrected",
      ].includes(outcome)
    )
      return Object.freeze({
        outcome: outcome as
          | "created"
          | "replayed"
          | "updated"
          | "archived"
          | "transitioned"
          | "corrected",
        release: this.release(row.release),
      });
    return Object.freeze({
      outcome: outcome as
        | "idempotency_mismatch"
        | "invalid_request"
        | "invalid_state"
        | "blocked"
        | "not_found"
        | "invalid_transition"
        | "placement_requires_placed_on_market_at"
        | "placement_requires_active_market_availability"
        | "placed_on_market_date_not_set"
        | "member_state_unavailable"
        | "market_availability_not_found",
    });
  }
  private product(value: unknown): Product {
    return this.parse(productResponseSchema, { product: value }).product;
  }
  private products(value: unknown) {
    return this.parse(productsResponseSchema, { products: value }).products;
  }
  private release(value: unknown): Release {
    return this.parse(releaseResponseSchema, { release: value }).release;
  }
  private releases(value: unknown) {
    return this.parse(releasesResponseSchema, { releases: value }).releases;
  }
  private memberStates(value: unknown): readonly MemberStateReference[] {
    return Object.freeze(
      this.parse(memberStatesResponseSchema, value).memberStates,
    );
  }
  private marketAvailability(
    value: unknown,
  ): readonly ReleaseMarketAvailability[] {
    return Object.freeze(
      this.parse(releaseMarketAvailabilityResponseSchema, value)
        .marketAvailability,
    );
  }
  private timeline(value: unknown): readonly ReleaseLifecycleTimelineEvent[] {
    return Object.freeze(
      this.parse(releaseLifecycleTimelineResponseSchema, value).timeline,
    );
  }
  private async singleRpc(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<ProviderRow> {
    let result: ProviderResult;
    try {
      result = await (this.supabase.admin() as unknown as ProductRpcClient).rpc(
        name,
        args,
      );
    } catch {
      throw new ProductProviderError("unavailable");
    }
    if (result.error) throw new ProductProviderError("unavailable");
    if (!Array.isArray(result.data) || result.data.length !== 1)
      throw new ProductProviderError("malformed");
    return this.record(result.data[0]);
  }
  private outcome<T extends string>(
    row: ProviderRow,
    allowed: ReadonlySet<T>,
  ): T {
    const outcome = row.outcome;
    if (typeof outcome !== "string" || !allowed.has(outcome as T))
      throw new ProductProviderError("malformed");
    return outcome as T;
  }
  private parse<T>(
    schema: Readonly<{
      safeParse(value: unknown): Readonly<{ success: boolean; data?: T }>;
    }>,
    value: unknown,
  ): T {
    const result = schema.safeParse(value);
    if (!result.success || result.data === undefined)
      throw new ProductProviderError("malformed");
    return result.data;
  }
  private record(value: unknown): ProviderRow {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      throw new ProductProviderError("malformed");
    return value as ProviderRow;
  }
}

export class ProductProviderError extends Error {
  readonly name = "ProductProviderError";
  constructor(readonly code: "unavailable" | "malformed") {
    super(code);
  }
}
