import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
  memberStatesResponseSchema,
  productComponentLinkResponseSchema,
  productComponentLinksResponseSchema,
  productRelationshipGraphResponseSchema,
  productRelationshipPreviewResponseSchema,
  relationshipPropagationCandidatesResponseSchema,
  relationshipPropagationEventsResponseSchema,
  requestRelationshipReevaluationResponseSchema,
  productVariantRelationshipResponseSchema,
  productVariantRelationshipsResponseSchema,
  productResponseSchema,
  productsResponseSchema,
  releaseLifecycleTimelineResponseSchema,
  releaseMarketAvailabilityResponseSchema,
  releaseResponseSchema,
  releasesResponseSchema,
  productRetentionResponseSchema,
  supportAlertHistoryResponseSchema,
  supportAlertIntervalsResponseSchema,
  supportPeriodChangePreviewResponseSchema,
  supportPeriodHistoryResponseSchema,
  supportPeriodResponseSchema,
  softwareBaselineResponseSchema,
  softwareBaselinesResponseSchema,
  softwareBaselineMembershipsResponseSchema,
  softwareBaselineMembershipResponseSchema,
  type ArchiveSoftwareBaselineInput,
  type AddReleaseMarketAvailabilityInput,
  type ArchiveProductInput,
  type ArchiveReleaseInput,
  type CorrectPlacedOnMarketDateInput,
  type CorrectReleaseMarketAvailabilityInput,
  type CreateProductInput,
  type CreateProductComponentLinkInput,
  type CreateProductVariantRelationshipInput,
  type CreateReleaseInput,
  type CreateSoftwareBaselineInput,
  type MemberStateReference,
  type MoveProductLegalEntityInput,
  type Product,
  type ProductComponentLink,
  type ProductRelationshipGraph,
  type ProductRelationshipGraphQuery,
  type ProductRelationshipPreview,
  type ProductVariantRelationship,
  type ProductListQuery,
  type Release,
  type ReleaseLifecycleTimelineEvent,
  type ReleaseMarketAvailability,
  type ReleaseListQuery,
  type RelationshipPropagationEvent,
  type RelationshipPropagationEventsQuery,
  type RemoveReleaseMarketAvailabilityInput,
  type TransitionReleaseLifecycleInput,
  type UpdateProductInput,
  type UpdateReleaseInput,
  type CreateSupportPeriodRequest,
  type PreviewSupportPeriodChangeRequest,
  type ProductRetentionCalculation,
  type ProductSupportPeriod,
  type SupportAlertHistoryItem,
  type SupportAlertIntervals,
  type SupportPeriodChangePreview,
  type SupersedeSupportPeriodRequest,
  type UpdateSupportAlertIntervalsRequest,
  type SoftwareBaseline,
  type SoftwareBaselineReleaseMembership,
  type AppendSoftwareBaselineRevisionInput,
  type AssignSoftwareBaselineMembershipInput,
  type EndProductComponentLinkInput,
  type EndProductVariantRelationshipInput,
  type EndSoftwareBaselineMembershipInput,
  type PreviewProductComponentLinkInput,
  type RequestRelationshipReevaluationInput,
  type SupersedeProductComponentLinkInput,
} from "@repo/contracts/products";

import { SupabaseService } from "../../supabase/supabase.service";
import type {
  ProductMutationOutcome,
  ProductRepository,
  ReleaseMutationOutcome,
  SupportAlertHistoryOutcome,
  SupportAlertIntervalsMutationOutcome,
  SupportAlertIntervalsOutcome,
  SupportPeriodHistoryOutcome,
  SupportPeriodMutationOutcome,
  SupportPeriodPreviewOutcome,
  ProductRetentionOutcome,
  ProductComponentLinksOutcome,
  ProductRelationshipGraphOutcome,
  ProductRelationshipMutationOutcome,
  ProductRelationshipPreviewOutcome,
  ProductVariantRelationshipsOutcome,
  RelationshipPropagationCandidatesOutcome,
  RelationshipPropagationEventsOutcome,
  RelationshipPropagationEventMutationOutcome,
  SoftwareBaselineHistoryOutcome,
  SoftwareBaselineMembershipMutationOutcome,
  SoftwareBaselineMembershipsOutcome,
  SoftwareBaselineMutationOutcome,
} from "../application/product-use-cases";
import type { ProductRelationshipPropagationCommand } from "../application/product-relationship-reader.port";

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
const SUPPORT_MUTATION_OUTCOMES = new Set([
  "created",
  "superseded",
  "conflict",
  "idempotency_mismatch",
  "blocked",
  "not_found",
  "invalid_request",
]);
const BASELINE_MUTATION_OUTCOMES = new Set([
  "created",
  "updated",
  "archived",
  "replayed",
  "conflict",
  "idempotency_mismatch",
  "blocked",
  "not_found",
  "invalid_request",
]);
const BASELINE_MEMBERSHIP_MUTATION_OUTCOMES = new Set([
  "created",
  "ended",
  "replayed",
  "conflict",
  "idempotency_mismatch",
  "blocked",
  "not_found",
  "invalid_request",
]);
const PRODUCT_RELATIONSHIP_MUTATION_OUTCOMES = new Set([
  "created",
  "ended",
  "replayed",
  "conflict",
  "idempotency_mismatch",
  "cycle_detected",
  "depth_exceeded",
  "blocked",
  "not_found",
  "invalid_request",
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

  async getSupportPeriods(
    organizationId: string,
    actorId: string,
    productId: string,
  ): Promise<SupportPeriodHistoryOutcome> {
    const row = await this.singleRpc("get_product_support_periods", {
      p_organization_id: organizationId,
      p_product_id: productId,
      p_actor_user_id: actorId,
    });
    if (this.outcome(row, new Set(["found", "not_found"])) === "not_found") {
      return Object.freeze({ outcome: "not_found" });
    }
    return Object.freeze({
      outcome: "found",
      supportPeriods: this.supportPeriods(row.support_periods),
    });
  }

  async previewSupportPeriodChange(
    organizationId: string,
    actorId: string,
    productId: string,
    input: PreviewSupportPeriodChangeRequest,
  ): Promise<SupportPeriodPreviewOutcome> {
    const row = await this.singleRpc("preview_product_support_period_change", {
      p_organization_id: organizationId,
      p_product_id: productId,
      p_release_id: input.releaseId ?? null,
      p_actor_user_id: actorId,
      p_expected_version: input.expectedVersion,
      p_support_starts_at: input.proposed.supportStartsAt,
      p_support_ends_at: input.proposed.supportEndsAt,
      p_expected_lifetime_justification:
        input.proposed.expectedLifetimeJustification,
    });
    const outcome = this.outcome(
      row,
      new Set(["found", "not_found", "conflict", "invalid_request"]),
    );
    if (outcome !== "found")
      return Object.freeze({
        outcome: outcome as "not_found" | "conflict" | "invalid_request",
      });
    return Object.freeze({
      outcome,
      preview: this.supportPreview(row.preview),
    });
  }

  async createSupportPeriod(
    organizationId: string,
    actorId: string,
    productId: string,
    input: CreateSupportPeriodRequest,
  ): Promise<SupportPeriodMutationOutcome> {
    const row = await this.singleRpc("create_product_support_period_atomic", {
      p_organization_id: organizationId,
      p_product_id: productId,
      p_release_id: input.releaseId ?? null,
      p_actor_user_id: actorId,
      p_support_starts_at: input.supportStartsAt,
      p_support_ends_at: input.supportEndsAt,
      p_expected_lifetime_justification: input.expectedLifetimeJustification,
      p_idempotency_key: input.idempotencyKey,
      p_correlation_id: randomUUID(),
    });
    return this.supportPeriodMutation(row);
  }

  async supersedeSupportPeriod(
    organizationId: string,
    actorId: string,
    productId: string,
    supportPeriodId: string,
    input: SupersedeSupportPeriodRequest,
    allowProtectionReduction: boolean,
  ): Promise<SupportPeriodMutationOutcome> {
    const row = await this.singleRpc(
      "supersede_product_support_period_atomic",
      {
        p_organization_id: organizationId,
        p_product_id: productId,
        p_support_period_id: supportPeriodId,
        p_actor_user_id: actorId,
        p_expected_version: input.expectedVersion,
        p_support_starts_at: input.supportStartsAt,
        p_support_ends_at: input.supportEndsAt,
        p_expected_lifetime_justification: input.expectedLifetimeJustification,
        p_reason: input.reason,
        p_preview_digest: input.previewDigest ?? null,
        p_allow_protection_reduction: allowProtectionReduction,
        p_idempotency_key: input.idempotencyKey ?? randomUUID(),
        p_correlation_id: randomUUID(),
      },
    );
    return this.supportPeriodMutation(row);
  }

  async getProductRetentionCalculation(
    organizationId: string,
    actorId: string,
    productId: string,
  ): Promise<ProductRetentionOutcome> {
    const row = await this.singleRpc("get_product_retention_calculation", {
      p_organization_id: organizationId,
      p_product_id: productId,
      p_actor_user_id: actorId,
    });
    if (this.outcome(row, new Set(["found", "not_found"])) === "not_found") {
      return Object.freeze({ outcome: "not_found" });
    }
    return Object.freeze({
      outcome: "found",
      retention: this.retention(row.retention),
    });
  }

  async getSupportAlertHistory(
    organizationId: string,
    actorId: string,
    productId: string,
  ): Promise<SupportAlertHistoryOutcome> {
    const row = await this.singleRpc("get_product_support_alert_history", {
      p_organization_id: organizationId,
      p_product_id: productId,
      p_actor_user_id: actorId,
    });
    if (this.outcome(row, new Set(["found", "not_found"])) === "not_found") {
      return Object.freeze({ outcome: "not_found" });
    }
    return Object.freeze({ outcome: "found", alerts: this.alerts(row.alerts) });
  }

  async getSupportAlertIntervals(
    organizationId: string,
    actorId: string,
  ): Promise<SupportAlertIntervalsOutcome> {
    const row = await this.singleRpc(
      "get_organization_support_alert_intervals",
      {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
      },
    );
    if (this.outcome(row, new Set(["found", "not_found"])) === "not_found") {
      return Object.freeze({ outcome: "not_found" });
    }
    return Object.freeze({
      outcome: "found",
      intervals: this.intervals(row.intervals),
    });
  }

  async updateSupportAlertIntervals(
    organizationId: string,
    actorId: string,
    input: UpdateSupportAlertIntervalsRequest,
  ): Promise<SupportAlertIntervalsMutationOutcome> {
    const row = await this.singleRpc(
      "update_organization_support_alert_intervals_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_expected_version: input.expectedVersion,
        p_alert_intervals: input.alertIntervalsDays,
        p_correlation_id: randomUUID(),
      },
    );
    const outcome = this.outcome(
      row,
      new Set(["updated", "conflict", "not_found", "invalid_request"]),
    );
    return outcome === "updated"
      ? Object.freeze({ outcome, intervals: this.intervals(row.intervals) })
      : Object.freeze({
          outcome: outcome as "conflict" | "not_found" | "invalid_request",
        });
  }

  async createSoftwareBaseline(
    organizationId: string,
    actorId: string,
    input: CreateSoftwareBaselineInput,
  ): Promise<SoftwareBaselineMutationOutcome> {
    const row = await this.singleRpc(
      "create_software_baseline_atomic",
      Object.freeze({
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_identifier: input.identifier,
        p_name: input.name,
        p_description: input.description ?? null,
        p_revision_summary: input.revisionSummary,
        p_source: input.source,
        p_provenance: input.provenance,
        p_effective_starts_at: input.effectiveStartsAt,
        p_effective_ends_at: input.effectiveEndsAt ?? null,
        p_idempotency_key: input.idempotencyKey,
        p_correlation_id: randomUUID(),
      }),
    );
    return this.softwareBaselineMutation(row);
  }

  async appendSoftwareBaselineRevision(
    organizationId: string,
    actorId: string,
    baselineId: string,
    input: AppendSoftwareBaselineRevisionInput,
  ): Promise<SoftwareBaselineMutationOutcome> {
    const row = await this.singleRpc(
      "append_software_baseline_revision_atomic",
      Object.freeze({
        p_organization_id: organizationId,
        p_baseline_id: baselineId,
        p_actor_user_id: actorId,
        p_expected_version: input.expectedVersion,
        p_name: input.name,
        p_description: input.description ?? null,
        p_revision_summary: input.revisionSummary,
        p_source: input.source,
        p_provenance: input.provenance,
        p_effective_starts_at: input.effectiveStartsAt,
        p_effective_ends_at: input.effectiveEndsAt ?? null,
        p_idempotency_key: input.idempotencyKey,
        p_correlation_id: randomUUID(),
      }),
    );
    return this.softwareBaselineMutation(row);
  }

  async getSoftwareBaselineHistory(
    organizationId: string,
    actorId: string,
    baselineId: string,
  ): Promise<SoftwareBaselineHistoryOutcome> {
    const row = await this.singleRpc(
      "get_software_baseline_history",
      Object.freeze({
        p_organization_id: organizationId,
        p_baseline_id: baselineId,
        p_actor_user_id: actorId,
      }),
    );
    if (this.outcome(row, new Set(["found", "not_found"])) === "not_found") {
      return Object.freeze({ outcome: "not_found" });
    }
    return Object.freeze({
      outcome: "found",
      baselines: this.baselines(row.baselines),
    });
  }

  async archiveSoftwareBaseline(
    organizationId: string,
    actorId: string,
    baselineId: string,
    input: ArchiveSoftwareBaselineInput,
  ): Promise<SoftwareBaselineMutationOutcome> {
    const row = await this.singleRpc(
      "archive_software_baseline_atomic",
      Object.freeze({
        p_organization_id: organizationId,
        p_baseline_id: baselineId,
        p_actor_user_id: actorId,
        p_expected_version: input.expectedVersion,
        p_reason: input.reason,
        p_correlation_id: randomUUID(),
      }),
    );
    return this.softwareBaselineMutation(row);
  }

  async assignSoftwareBaselineMembership(
    organizationId: string,
    actorId: string,
    productId: string,
    input: AssignSoftwareBaselineMembershipInput,
  ): Promise<SoftwareBaselineMembershipMutationOutcome> {
    const row = await this.singleRpc(
      "assign_software_baseline_membership_atomic",
      Object.freeze({
        p_organization_id: organizationId,
        p_product_id: productId,
        p_baseline_id: input.baselineId,
        p_baseline_revision_id: input.baselineRevisionId,
        p_release_id: input.releaseId,
        p_actor_user_id: actorId,
        p_expected_baseline_version: input.expectedBaselineVersion,
        p_source: input.source,
        p_provenance: input.provenance,
        p_effective_starts_at: input.effectiveStartsAt,
        p_effective_ends_at: input.effectiveEndsAt ?? null,
        p_idempotency_key: input.idempotencyKey,
        p_correlation_id: randomUUID(),
      }),
    );
    return this.softwareBaselineMembershipMutation(row);
  }

  async endSoftwareBaselineMembership(
    organizationId: string,
    actorId: string,
    productId: string,
    membershipId: string,
    input: EndSoftwareBaselineMembershipInput,
  ): Promise<SoftwareBaselineMembershipMutationOutcome> {
    const row = await this.singleRpc(
      "end_software_baseline_membership_atomic",
      Object.freeze({
        p_organization_id: organizationId,
        p_product_id: productId,
        p_membership_id: membershipId,
        p_actor_user_id: actorId,
        p_expected_version: input.expectedVersion,
        p_reason: input.reason,
        p_effective_ends_at: input.effectiveEndsAt,
        p_correlation_id: randomUUID(),
      }),
    );
    return this.softwareBaselineMembershipMutation(row);
  }

  async getSoftwareBaselineMemberships(
    organizationId: string,
    actorId: string,
    productId: string,
    asOf?: string,
  ): Promise<SoftwareBaselineMembershipsOutcome> {
    const row = await this.singleRpc(
      "get_product_software_baseline_memberships",
      Object.freeze({
        p_organization_id: organizationId,
        p_product_id: productId,
        p_actor_user_id: actorId,
        p_as_of: asOf ?? null,
      }),
    );
    if (this.outcome(row, new Set(["found", "not_found"])) === "not_found") {
      return Object.freeze({ outcome: "not_found" });
    }
    return Object.freeze({
      outcome: "found",
      memberships: this.baselineMemberships(row.memberships),
    });
  }

  async createProductVariantRelationship(
    organizationId: string,
    actorId: string,
    targetProductId: string,
    input: CreateProductVariantRelationshipInput,
  ): Promise<ProductRelationshipMutationOutcome<ProductVariantRelationship>> {
    const row = await this.singleRpc(
      "create_product_variant_relationship_atomic",
      Object.freeze({
        p_organization_id: organizationId,
        p_base_release_id: input.baseReleaseId ?? null,
        p_baseline_revision_id: input.baselineRevisionId ?? null,
        p_variant_product_id: targetProductId,
        p_variant_release_id: input.variantReleaseId ?? null,
        p_actor_user_id: actorId,
        p_expected_graph_version: input.expectedGraphVersion,
        p_source: input.source,
        p_provenance: input.provenance,
        p_idempotency_key: input.idempotencyKey,
        p_reason: input.reason,
        p_effective_starts_at: input.effectiveStartsAt,
        p_effective_ends_at: input.effectiveEndsAt ?? null,
        p_correlation_id: randomUUID(),
      }),
    );
    return this.productVariantRelationshipMutation(row);
  }

  async endProductVariantRelationship(
    organizationId: string,
    actorId: string,
    productId: string,
    relationshipId: string,
    input: EndProductVariantRelationshipInput,
  ): Promise<ProductRelationshipMutationOutcome<ProductVariantRelationship>> {
    const row = await this.singleRpc(
      "end_product_variant_relationship_atomic",
      Object.freeze({
        p_organization_id: organizationId,
        p_product_id: productId,
        p_relationship_id: relationshipId,
        p_actor_user_id: actorId,
        p_expected_version: input.expectedVersion,
        p_expected_graph_version: input.expectedGraphVersion,
        p_reason: input.reason,
        p_effective_ends_at: input.effectiveEndsAt,
        p_correlation_id: randomUUID(),
      }),
    );
    return this.productVariantRelationshipMutation(row);
  }

  async getProductVariantRelationships(
    organizationId: string,
    actorId: string,
    productId: string,
    asOf?: string,
  ): Promise<ProductVariantRelationshipsOutcome> {
    const row = await this.singleRpc(
      "get_product_variant_relationships",
      Object.freeze({
        p_organization_id: organizationId,
        p_product_id: productId,
        p_actor_user_id: actorId,
        p_as_of: asOf ?? null,
      }),
    );
    if (this.outcome(row, new Set(["found", "not_found"])) === "not_found") {
      return Object.freeze({ outcome: "not_found" });
    }
    return Object.freeze({
      outcome: "found",
      relationships: this.variantRelationships(row.relationships),
    });
  }

  async previewProductComponentLink(
    organizationId: string,
    actorId: string,
    parentProductId: string,
    input: PreviewProductComponentLinkInput,
  ): Promise<ProductRelationshipPreviewOutcome> {
    const row = await this.singleRpc(
      "preview_product_component_link",
      Object.freeze({
        p_organization_id: organizationId,
        p_parent_product_id: parentProductId,
        p_component_product_id: input.componentProductId,
        p_actor_user_id: actorId,
        p_expected_graph_version: input.expectedGraphVersion,
        p_parent_release_id: input.parentReleaseId ?? null,
        p_component_release_id: input.componentReleaseId ?? null,
        p_quantity: input.quantity,
        p_source: input.source,
        p_provenance: input.provenance,
        p_reason: input.reason,
        p_effective_starts_at: input.effectiveStartsAt,
        p_effective_ends_at: input.effectiveEndsAt ?? null,
      }),
    );
    const outcome = this.outcome(
      row,
      new Set([
        "found",
        "conflict",
        "cycle_detected",
        "depth_exceeded",
        "not_found",
        "invalid_request",
      ]),
    );
    return outcome === "found"
      ? Object.freeze({
          outcome,
          preview: this.relationshipPreview(row.preview),
        })
      : Object.freeze({
          outcome: outcome as
            | "conflict"
            | "cycle_detected"
            | "depth_exceeded"
            | "not_found"
            | "invalid_request",
        });
  }

  async createProductComponentLink(
    organizationId: string,
    actorId: string,
    parentProductId: string,
    input: CreateProductComponentLinkInput,
  ): Promise<ProductRelationshipMutationOutcome<ProductComponentLink>> {
    const row = await this.singleRpc(
      "create_product_component_link_atomic",
      Object.freeze({
        p_organization_id: organizationId,
        p_parent_product_id: parentProductId,
        p_component_product_id: input.componentProductId,
        p_actor_user_id: actorId,
        p_expected_graph_version: input.expectedGraphVersion,
        p_parent_release_id: input.parentReleaseId ?? null,
        p_component_release_id: input.componentReleaseId ?? null,
        p_quantity: input.quantity,
        p_source: input.source,
        p_provenance: input.provenance,
        p_reason: input.reason,
        p_effective_starts_at: input.effectiveStartsAt,
        p_effective_ends_at: input.effectiveEndsAt ?? null,
        p_idempotency_key: input.idempotencyKey,
        p_correlation_id: randomUUID(),
      }),
    );
    return this.productComponentLinkMutation(row);
  }

  async endProductComponentLink(
    organizationId: string,
    actorId: string,
    productId: string,
    relationshipId: string,
    input: EndProductComponentLinkInput,
  ): Promise<ProductRelationshipMutationOutcome<ProductComponentLink>> {
    const row = await this.singleRpc(
      "end_product_component_link_atomic",
      Object.freeze({
        p_organization_id: organizationId,
        p_product_id: productId,
        p_relationship_id: relationshipId,
        p_actor_user_id: actorId,
        p_expected_version: input.expectedVersion,
        p_expected_graph_version: input.expectedGraphVersion,
        p_reason: input.reason,
        p_effective_ends_at: input.effectiveEndsAt,
        p_correlation_id: randomUUID(),
      }),
    );
    return this.productComponentLinkMutation(row);
  }

  async supersedeProductComponentLink(
    organizationId: string,
    actorId: string,
    productId: string,
    relationshipId: string,
    input: SupersedeProductComponentLinkInput,
  ): Promise<ProductRelationshipMutationOutcome<ProductComponentLink>> {
    const row = await this.singleRpc(
      "supersede_product_component_link_atomic",
      Object.freeze({
        p_organization_id: organizationId,
        p_product_id: productId,
        p_relationship_id: relationshipId,
        p_actor_user_id: actorId,
        p_expected_version: input.expectedVersion,
        p_expected_graph_version: input.expectedGraphVersion,
        p_component_product_id: input.componentProductId,
        p_parent_release_id: input.parentReleaseId ?? null,
        p_component_release_id: input.componentReleaseId ?? null,
        p_quantity: input.quantity,
        p_reason: input.reason,
        p_source: input.source,
        p_provenance: input.provenance,
        p_effective_starts_at: input.effectiveStartsAt,
        p_effective_ends_at: input.effectiveEndsAt ?? null,
        p_idempotency_key: input.idempotencyKey,
        p_correlation_id: randomUUID(),
      }),
    );
    return this.productComponentLinkMutation(row);
  }

  async getProductComponentLinks(
    organizationId: string,
    actorId: string,
    productId: string,
    asOf?: string,
  ): Promise<ProductComponentLinksOutcome> {
    const row = await this.singleRpc(
      "get_product_component_links",
      Object.freeze({
        p_organization_id: organizationId,
        p_product_id: productId,
        p_actor_user_id: actorId,
        p_as_of: asOf ?? null,
      }),
    );
    if (this.outcome(row, new Set(["found", "not_found"])) === "not_found") {
      return Object.freeze({ outcome: "not_found" });
    }
    return Object.freeze({
      outcome: "found",
      links: this.componentLinks(row.links),
    });
  }

  async getProductRelationshipGraph(
    organizationId: string,
    actorId: string,
    productId: string,
    query: ProductRelationshipGraphQuery,
  ): Promise<ProductRelationshipGraphOutcome> {
    const row = await this.singleRpc(
      "get_product_relationship_graph",
      Object.freeze({
        p_organization_id: organizationId,
        p_product_id: productId,
        p_actor_user_id: actorId,
        p_as_of: query.asOf ?? null,
        p_root_release_id: query.rootReleaseId ?? null,
        p_max_depth: query.maxDepth,
        p_include_ended: query.includeEnded ?? false,
      }),
    );
    const outcome = this.outcome(
      row,
      new Set<"found" | "not_found" | "invalid_request">([
        "found",
        "not_found",
        "invalid_request",
      ]),
    );
    if (outcome !== "found") return Object.freeze({ outcome });
    return Object.freeze({
      outcome: "found",
      graph: this.relationshipGraph(row.graph),
    });
  }

  async getRelationshipPropagationCandidates(
    organizationId: string,
    actorId: string,
    query: ProductRelationshipPropagationCommand,
  ): Promise<RelationshipPropagationCandidatesOutcome> {
    const row = await this.singleRpc(
      "get_product_relationship_propagation_candidates",
      Object.freeze({
        p_organization_id: organizationId,
        p_source_release_id: query.sourceReleaseId ?? null,
        p_source_baseline_revision_id: query.sourceBaselineRevisionId ?? null,
        p_actor_user_id: actorId,
        p_graph_version: query.graphVersion,
        p_as_of: query.asOf ?? null,
        p_page_size: query.pageSize ?? null,
        p_cursor: query.cursor ?? null,
      }),
    );
    const outcome = this.outcome(
      row,
      new Set<"found" | "conflict" | "not_found" | "invalid_request">([
        "found",
        "conflict",
        "not_found",
        "invalid_request",
      ]),
    );
    if (outcome !== "found") return Object.freeze({ outcome });
    return this.relationshipPropagationCandidates(row.candidates);
  }

  async getRelationshipPropagationEvents(
    organizationId: string,
    actorId: string,
    productId: string,
    query: RelationshipPropagationEventsQuery,
  ): Promise<RelationshipPropagationEventsOutcome> {
    const row = await this.singleRpc(
      "get_product_relationship_propagation_events",
      Object.freeze({
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_product_id: productId,
        p_cursor: query.cursor ?? null,
        p_page_size: query.pageSize,
        p_delivery_state: query.deliveryState ?? null,
      }),
    );
    const outcome = this.outcome(
      row,
      new Set<"found" | "not_found" | "invalid_request">([
        "found",
        "not_found",
        "invalid_request",
      ]),
    );
    if (outcome !== "found") return Object.freeze({ outcome });
    return this.relationshipPropagationEvents(row.events);
  }

  async requestRelationshipReevaluation(
    organizationId: string,
    actorId: string,
    productId: string,
    input: RequestRelationshipReevaluationInput,
  ): Promise<RelationshipPropagationEventMutationOutcome> {
    const row = await this.singleRpc(
      "request_product_relationship_reevaluation_atomic",
      Object.freeze({
        p_organization_id: organizationId,
        p_product_id: productId,
        p_actor_user_id: actorId,
        p_expected_graph_version: input.expectedGraphVersion,
        p_reason: input.reason,
        p_source: input.source,
        p_provenance: input.provenance,
        p_idempotency_key: input.idempotencyKey,
        p_correlation_id: randomUUID(),
      }),
    );
    const outcome = this.outcome(
      row,
      new Set([
        "created",
        "conflict",
        "blocked",
        "not_found",
        "invalid_request",
      ]),
    );
    return outcome === "created"
      ? Object.freeze({
          outcome,
          event: this.relationshipPropagationEvent(row.event),
        })
      : Object.freeze({
          outcome: outcome as
            "conflict" | "blocked" | "not_found" | "invalid_request",
        });
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
  private supportPeriodMutation(
    row: ProviderRow,
  ): SupportPeriodMutationOutcome {
    const outcome = this.outcome(row, SUPPORT_MUTATION_OUTCOMES);
    return outcome === "created" || outcome === "superseded"
      ? Object.freeze({
          outcome,
          supportPeriod: this.supportPeriod(row.support_period),
        })
      : Object.freeze({
          outcome: outcome as
            | "conflict"
            | "idempotency_mismatch"
            | "blocked"
            | "not_found"
            | "invalid_request",
        });
  }
  private softwareBaselineMutation(
    row: ProviderRow,
  ): SoftwareBaselineMutationOutcome {
    const outcome = this.outcome(row, BASELINE_MUTATION_OUTCOMES);
    return ["created", "updated", "archived", "replayed"].includes(outcome)
      ? Object.freeze({
          outcome: outcome as "created" | "updated" | "archived" | "replayed",
          baseline: this.baseline(row.baseline),
        })
      : Object.freeze({
          outcome: outcome as
            | "conflict"
            | "idempotency_mismatch"
            | "blocked"
            | "not_found"
            | "invalid_request",
        });
  }
  private softwareBaselineMembershipMutation(
    row: ProviderRow,
  ): SoftwareBaselineMembershipMutationOutcome {
    const outcome = this.outcome(row, BASELINE_MEMBERSHIP_MUTATION_OUTCOMES);
    return ["created", "ended", "replayed"].includes(outcome)
      ? Object.freeze({
          outcome: outcome as "created" | "ended" | "replayed",
          membership: this.baselineMembership(row.membership),
        })
      : Object.freeze({
          outcome: outcome as
            | "conflict"
            | "idempotency_mismatch"
            | "blocked"
            | "not_found"
            | "invalid_request",
        });
  }
  private productVariantRelationshipMutation(
    row: ProviderRow,
  ): ProductRelationshipMutationOutcome<ProductVariantRelationship> {
    return this.productRelationshipMutation(
      row,
      productVariantRelationshipResponseSchema,
    );
  }
  private productComponentLinkMutation(
    row: ProviderRow,
  ): ProductRelationshipMutationOutcome<ProductComponentLink> {
    return this.productRelationshipMutation(
      row,
      productComponentLinkResponseSchema,
    );
  }
  private productRelationshipMutation<T>(
    row: ProviderRow,
    schema: Readonly<{
      safeParse(value: unknown): Readonly<{
        success: boolean;
        data?: Readonly<{ relationship: T; graphVersion: number }>;
      }>;
    }>,
  ): ProductRelationshipMutationOutcome<T> {
    const outcome = this.outcome(row, PRODUCT_RELATIONSHIP_MUTATION_OUTCOMES);
    if (["created", "ended", "replayed"].includes(outcome)) {
      const parsed = this.parse(schema, {
        relationship: row.relationship,
        graphVersion: row.graph_version,
      });
      return Object.freeze({
        outcome: outcome as "created" | "ended" | "replayed",
        relationship: parsed.relationship,
        graphVersion: parsed.graphVersion,
      });
    }
    return Object.freeze({
      outcome: outcome as
        | "conflict"
        | "idempotency_mismatch"
        | "cycle_detected"
        | "depth_exceeded"
        | "blocked"
        | "not_found"
        | "invalid_request",
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
  private supportPeriods(value: unknown): readonly ProductSupportPeriod[] {
    return Object.freeze(
      this.parse(supportPeriodHistoryResponseSchema, { supportPeriods: value })
        .supportPeriods,
    );
  }
  private supportPeriod(value: unknown): ProductSupportPeriod {
    return this.parse(supportPeriodResponseSchema, { supportPeriod: value })
      .supportPeriod;
  }
  private supportPreview(value: unknown): SupportPeriodChangePreview {
    return this.parse(supportPeriodChangePreviewResponseSchema, {
      preview: value,
    }).preview;
  }
  private retention(value: unknown): ProductRetentionCalculation {
    return this.parse(productRetentionResponseSchema, { retention: value })
      .retention;
  }
  private alerts(value: unknown): readonly SupportAlertHistoryItem[] {
    return Object.freeze(
      this.parse(supportAlertHistoryResponseSchema, { alerts: value }).alerts,
    );
  }
  private intervals(value: unknown): SupportAlertIntervals {
    return this.parse(supportAlertIntervalsResponseSchema, value);
  }
  private baseline(value: unknown): SoftwareBaseline {
    return this.parse(softwareBaselineResponseSchema, { baseline: value })
      .baseline;
  }
  private baselines(value: unknown): readonly SoftwareBaseline[] {
    return Object.freeze(
      this.parse(softwareBaselinesResponseSchema, { baselines: value })
        .baselines,
    );
  }
  private baselineMembership(
    value: unknown,
  ): SoftwareBaselineReleaseMembership {
    return this.parse(softwareBaselineMembershipResponseSchema, {
      membership: value,
    }).membership;
  }
  private baselineMemberships(
    value: unknown,
  ): readonly SoftwareBaselineReleaseMembership[] {
    return Object.freeze(
      this.parse(softwareBaselineMembershipsResponseSchema, {
        memberships: value,
      }).memberships,
    );
  }
  private variantRelationships(
    value: unknown,
  ): readonly ProductVariantRelationship[] {
    return Object.freeze(
      this.parse(productVariantRelationshipsResponseSchema, {
        relationships: value,
      }).relationships,
    );
  }
  private componentLinks(value: unknown): readonly ProductComponentLink[] {
    return Object.freeze(
      this.parse(productComponentLinksResponseSchema, { links: value }).links,
    );
  }
  private relationshipPreview(value: unknown): ProductRelationshipPreview {
    return this.parse(productRelationshipPreviewResponseSchema, {
      preview: value,
    }).preview;
  }
  private relationshipGraph(value: unknown): ProductRelationshipGraph {
    return this.parse(productRelationshipGraphResponseSchema, { graph: value })
      .graph;
  }
  private relationshipPropagationCandidates(
    value: unknown,
  ): RelationshipPropagationCandidatesOutcome {
    const parsed = this.parse(
      relationshipPropagationCandidatesResponseSchema,
      value,
    );
    return Object.freeze({
      outcome: "found",
      candidates: Object.freeze([...parsed.candidates]),
      nextCursor: parsed.nextCursor,
      graphVersion: parsed.graphVersion,
      evaluatedAt: parsed.evaluatedAt,
    });
  }
  private relationshipPropagationEvents(
    value: unknown,
  ): RelationshipPropagationEventsOutcome {
    const parsed = this.parse(
      relationshipPropagationEventsResponseSchema,
      value,
    );
    return Object.freeze({
      outcome: "found",
      events: Object.freeze([...parsed.events]),
      nextCursor: parsed.nextCursor,
    });
  }
  private relationshipPropagationEvent(
    value: unknown,
  ): RelationshipPropagationEvent {
    return this.parse(requestRelationshipReevaluationResponseSchema, {
      event: value,
    }).event;
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
