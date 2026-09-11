import type {
  ArchiveProductInput,
  ArchiveSoftwareBaselineInput,
  ArchiveReleaseInput,
  AddReleaseMarketAvailabilityInput,
  CorrectPlacedOnMarketDateInput,
  CorrectReleaseMarketAvailabilityInput,
  CreateProductInput,
  CreateProductComponentLinkInput,
  CreateProductVariantRelationshipInput,
  CreateReleaseInput,
  CreateSoftwareBaselineInput,
  MemberStateReference,
  MoveProductLegalEntityInput,
  Product,
  ProductComponentLink,
  ProductRelationshipGraph,
  ProductRelationshipGraphQuery,
  ProductRelationshipPreview,
  RelationshipPropagationCandidate,
  RelationshipPropagationEvent,
  RelationshipPropagationEventsQuery,
  ProductListQuery,
  Release,
  ReleaseLifecycleTimelineEvent,
  ReleaseMarketAvailability,
  ReleaseListQuery,
  RemoveReleaseMarketAvailabilityInput,
  TransitionReleaseLifecycleInput,
  UpdateProductInput,
  UpdateReleaseInput,
  CreateSupportPeriodRequest,
  PreviewSupportPeriodChangeRequest,
  ProductRetentionCalculation,
  ProductSupportPeriod,
  SupportAlertHistoryItem,
  SupportAlertIntervals,
  SupportPeriodChangePreview,
  SupersedeSupportPeriodRequest,
  SoftwareBaseline,
  SoftwareBaselineListQuery,
  SoftwareBaselineReleaseMembership,
  ProductVariantRelationship,
  AppendSoftwareBaselineRevisionInput,
  AssignSoftwareBaselineMembershipInput,
  EndProductComponentLinkInput,
  EndProductVariantRelationshipInput,
  EndSoftwareBaselineMembershipInput,
  PreviewProductComponentLinkInput,
  RequestRelationshipReevaluationInput,
  SupersedeProductComponentLinkInput,
  UpdateSupportAlertIntervalsRequest,
} from "@repo/contracts/products";
import { relationshipPropagationQuerySchema } from "@repo/contracts/products";

import type { Result } from "../../common/domain/result";
import { failure, success } from "../../common/domain/result";
import type {
  LegalEntityContext,
  LegalEntityDirectory,
} from "../../organizations/legal-entities/application/legal-entity-ports";
import type {
  ReleaseMarketAvailabilityReader,
  ReleaseRegulatoryStateReader,
} from "./release-regulatory-reader.port";
import type {
  ProductRetentionProjectionPort,
  ProductRetentionReaderPort,
} from "./product-retention-reader.port";
import type {
  ProductRelationshipPropagationCommand,
  ProductRelationshipResolverPort,
} from "./product-relationship-reader.port";

export type ProductRepository = Readonly<{
  listProducts(
    organizationId: string,
    actorId: string,
    query: ProductListQuery,
  ): Promise<ProductListOutcome>;
  getProduct(
    organizationId: string,
    actorId: string,
    productId: string,
  ): Promise<ProductOutcome>;
  createProduct(
    organizationId: string,
    actorId: string,
    input: CreateProductInput,
  ): Promise<ProductMutationOutcome>;
  updateProduct(
    organizationId: string,
    actorId: string,
    productId: string,
    input: UpdateProductInput,
  ): Promise<ProductMutationOutcome>;
  assignProductLegalEntity(
    organizationId: string,
    actorId: string,
    productId: string,
    input: MoveProductLegalEntityInput,
  ): Promise<ProductMutationOutcome>;
  archiveProduct(
    organizationId: string,
    actorId: string,
    productId: string,
    input: ArchiveProductInput,
  ): Promise<ProductMutationOutcome>;
  listReleases(
    organizationId: string,
    actorId: string,
    productId: string,
    query: ReleaseListQuery,
  ): Promise<ReleaseListOutcome>;
  getRelease(
    organizationId: string,
    actorId: string,
    productId: string,
    releaseId: string,
  ): Promise<ReleaseOutcome>;
  createRelease(
    organizationId: string,
    actorId: string,
    productId: string,
    input: CreateReleaseInput,
  ): Promise<ReleaseMutationOutcome>;
  updateRelease(
    organizationId: string,
    actorId: string,
    productId: string,
    releaseId: string,
    input: UpdateReleaseInput,
  ): Promise<ReleaseMutationOutcome>;
  archiveRelease(
    organizationId: string,
    actorId: string,
    productId: string,
    releaseId: string,
    input: ArchiveReleaseInput,
  ): Promise<ReleaseMutationOutcome>;
  listMemberStates(
    organizationId: string,
    actorId: string,
  ): Promise<MemberStatesOutcome>;
  getReleaseMarketAvailability(
    organizationId: string,
    actorId: string,
    productId: string,
    releaseId: string,
  ): Promise<ReleaseMarketAvailabilityOutcome>;
  addReleaseMarketAvailability(
    organizationId: string,
    actorId: string,
    productId: string,
    releaseId: string,
    input: AddReleaseMarketAvailabilityInput,
  ): Promise<ReleaseMutationOutcome>;
  removeReleaseMarketAvailability(
    organizationId: string,
    actorId: string,
    productId: string,
    releaseId: string,
    countryCode: string,
    input: RemoveReleaseMarketAvailabilityInput,
  ): Promise<ReleaseMutationOutcome>;
  correctReleaseMarketAvailability(
    organizationId: string,
    actorId: string,
    productId: string,
    releaseId: string,
    input: CorrectReleaseMarketAvailabilityInput,
  ): Promise<ReleaseMutationOutcome>;
  transitionReleaseLifecycle(
    organizationId: string,
    actorId: string,
    productId: string,
    releaseId: string,
    input: TransitionReleaseLifecycleInput,
  ): Promise<ReleaseMutationOutcome>;
  correctPlacedOnMarketDate(
    organizationId: string,
    actorId: string,
    productId: string,
    releaseId: string,
    input: CorrectPlacedOnMarketDateInput,
  ): Promise<ReleaseMutationOutcome>;
  getReleaseLifecycleTimeline(
    organizationId: string,
    actorId: string,
    productId: string,
    releaseId: string,
  ): Promise<ReleaseLifecycleTimelineOutcome>;
  getSupportPeriods(
    organizationId: string,
    actorId: string,
    productId: string,
  ): Promise<SupportPeriodHistoryOutcome>;
  previewSupportPeriodChange(
    organizationId: string,
    actorId: string,
    productId: string,
    input: PreviewSupportPeriodChangeRequest,
  ): Promise<SupportPeriodPreviewOutcome>;
  createSupportPeriod(
    organizationId: string,
    actorId: string,
    productId: string,
    input: CreateSupportPeriodRequest,
  ): Promise<SupportPeriodMutationOutcome>;
  supersedeSupportPeriod(
    organizationId: string,
    actorId: string,
    productId: string,
    supportPeriodId: string,
    input: SupersedeSupportPeriodRequest,
    allowProtectionReduction: boolean,
  ): Promise<SupportPeriodMutationOutcome>;
  getProductRetentionCalculation(
    organizationId: string,
    actorId: string,
    productId: string,
  ): Promise<ProductRetentionOutcome>;
  getSupportAlertHistory(
    organizationId: string,
    actorId: string,
    productId: string,
  ): Promise<SupportAlertHistoryOutcome>;
  getSupportAlertIntervals(
    organizationId: string,
    actorId: string,
  ): Promise<SupportAlertIntervalsOutcome>;
  updateSupportAlertIntervals(
    organizationId: string,
    actorId: string,
    input: UpdateSupportAlertIntervalsRequest,
  ): Promise<SupportAlertIntervalsMutationOutcome>;
  getRelationshipPropagationCandidates(
    organizationId: string,
    actorId: string,
    query: ProductRelationshipPropagationCommand,
  ): Promise<RelationshipPropagationCandidatesOutcome>;
  createSoftwareBaseline(
    organizationId: string,
    actorId: string,
    input: CreateSoftwareBaselineInput,
  ): Promise<SoftwareBaselineMutationOutcome>;
  appendSoftwareBaselineRevision(
    organizationId: string,
    actorId: string,
    baselineId: string,
    input: AppendSoftwareBaselineRevisionInput,
  ): Promise<SoftwareBaselineMutationOutcome>;
  getSoftwareBaselineHistory(
    organizationId: string,
    actorId: string,
    baselineId: string,
  ): Promise<SoftwareBaselineHistoryOutcome>;
  listSoftwareBaselines(
    organizationId: string,
    actorId: string,
    query: SoftwareBaselineListQuery,
  ): Promise<SoftwareBaselineListOutcome>;
  archiveSoftwareBaseline(
    organizationId: string,
    actorId: string,
    baselineId: string,
    input: ArchiveSoftwareBaselineInput,
  ): Promise<SoftwareBaselineMutationOutcome>;
  assignSoftwareBaselineMembership(
    organizationId: string,
    actorId: string,
    productId: string,
    input: AssignSoftwareBaselineMembershipInput,
  ): Promise<SoftwareBaselineMembershipMutationOutcome>;
  endSoftwareBaselineMembership(
    organizationId: string,
    actorId: string,
    productId: string,
    membershipId: string,
    input: EndSoftwareBaselineMembershipInput,
  ): Promise<SoftwareBaselineMembershipMutationOutcome>;
  getSoftwareBaselineMemberships(
    organizationId: string,
    actorId: string,
    productId: string,
    asOf?: string,
  ): Promise<SoftwareBaselineMembershipsOutcome>;
  createProductVariantRelationship(
    organizationId: string,
    actorId: string,
    targetProductId: string,
    input: CreateProductVariantRelationshipInput,
  ): Promise<ProductRelationshipMutationOutcome<ProductVariantRelationship>>;
  endProductVariantRelationship(
    organizationId: string,
    actorId: string,
    productId: string,
    relationshipId: string,
    input: EndProductVariantRelationshipInput,
  ): Promise<ProductRelationshipMutationOutcome<ProductVariantRelationship>>;
  getProductVariantRelationships(
    organizationId: string,
    actorId: string,
    productId: string,
    asOf?: string,
  ): Promise<ProductVariantRelationshipsOutcome>;
  previewProductComponentLink(
    organizationId: string,
    actorId: string,
    parentProductId: string,
    input: PreviewProductComponentLinkInput,
  ): Promise<ProductRelationshipPreviewOutcome>;
  createProductComponentLink(
    organizationId: string,
    actorId: string,
    parentProductId: string,
    input: CreateProductComponentLinkInput,
  ): Promise<ProductRelationshipMutationOutcome<ProductComponentLink>>;
  endProductComponentLink(
    organizationId: string,
    actorId: string,
    productId: string,
    relationshipId: string,
    input: EndProductComponentLinkInput,
  ): Promise<ProductRelationshipMutationOutcome<ProductComponentLink>>;
  supersedeProductComponentLink(
    organizationId: string,
    actorId: string,
    productId: string,
    relationshipId: string,
    input: SupersedeProductComponentLinkInput,
  ): Promise<ProductRelationshipMutationOutcome<ProductComponentLink>>;
  getProductComponentLinks(
    organizationId: string,
    actorId: string,
    productId: string,
    asOf?: string,
  ): Promise<ProductComponentLinksOutcome>;
  getProductRelationshipGraph(
    organizationId: string,
    actorId: string,
    productId: string,
    query: ProductRelationshipGraphQuery,
  ): Promise<ProductRelationshipGraphOutcome>;
  getRelationshipPropagationEvents(
    organizationId: string,
    actorId: string,
    productId: string,
    query: RelationshipPropagationEventsQuery,
  ): Promise<RelationshipPropagationEventsOutcome>;
  requestRelationshipReevaluation(
    organizationId: string,
    actorId: string,
    productId: string,
    input: RequestRelationshipReevaluationInput,
  ): Promise<RelationshipPropagationEventMutationOutcome>;
}>;

export const PRODUCT_REPOSITORY = Symbol("PRODUCT_REPOSITORY");

export type ProductPage = Readonly<{
  rows: readonly Product[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}>;
export type ReleasePage = Readonly<{
  rows: readonly Release[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}>;
export type ProductOutcome =
  | Readonly<{ outcome: "found"; product: Product }>
  | Readonly<{ outcome: "not_found" }>;
export type ProductListOutcome =
  | Readonly<{ outcome: "found"; products: ProductPage }>
  | Readonly<{ outcome: "not_found" }>;
export type ReleaseOutcome =
  | Readonly<{ outcome: "found"; release: Release }>
  | Readonly<{ outcome: "not_found" }>;
export type ReleaseListOutcome =
  | Readonly<{ outcome: "found"; releases: ReleasePage }>
  | Readonly<{ outcome: "not_found" }>;
export type MemberStatesOutcome =
  | Readonly<{
      outcome: "found";
      memberStates: readonly MemberStateReference[];
    }>
  | Readonly<{ outcome: "not_found" }>;
export type ReleaseMarketAvailabilityOutcome =
  | Readonly<{
      outcome: "found";
      marketAvailability: readonly ReleaseMarketAvailability[];
    }>
  | Readonly<{ outcome: "not_found" }>;
export type ReleaseLifecycleTimelineOutcome =
  | Readonly<{
      outcome: "found";
      timeline: readonly ReleaseLifecycleTimelineEvent[];
    }>
  | Readonly<{ outcome: "not_found" }>;
export type SupportPeriodHistoryOutcome =
  | Readonly<{
      outcome: "found";
      supportPeriods: readonly ProductSupportPeriod[];
    }>
  | Readonly<{ outcome: "not_found" }>;
export type SupportPeriodPreviewOutcome =
  | Readonly<{ outcome: "found"; preview: SupportPeriodChangePreview }>
  | Readonly<{ outcome: "not_found" | "conflict" | "invalid_request" }>;
export type SupportPeriodMutationOutcome =
  | Readonly<{
      outcome: "created" | "superseded";
      supportPeriod: ProductSupportPeriod;
    }>
  | Readonly<{
      outcome:
        | "conflict"
        | "idempotency_mismatch"
        | "blocked"
        | "not_found"
        | "invalid_request";
    }>;
export type ProductRetentionOutcome =
  | Readonly<{ outcome: "found"; retention: ProductRetentionCalculation }>
  | Readonly<{ outcome: "not_found" }>;
export type SupportAlertHistoryOutcome =
  | Readonly<{ outcome: "found"; alerts: readonly SupportAlertHistoryItem[] }>
  | Readonly<{ outcome: "not_found" }>;
export type SupportAlertIntervalsOutcome =
  | Readonly<{ outcome: "found"; intervals: SupportAlertIntervals }>
  | Readonly<{ outcome: "not_found" }>;
export type SupportAlertIntervalsMutationOutcome =
  | Readonly<{ outcome: "updated"; intervals: SupportAlertIntervals }>
  | Readonly<{ outcome: "conflict" | "not_found" | "invalid_request" }>;
export type RelationshipPropagationCandidatesOutcome =
  | Readonly<{
      outcome: "found";
      candidates: readonly RelationshipPropagationCandidate[];
      nextCursor: string | null;
      graphVersion: number;
      evaluatedAt: string;
    }>
  | Readonly<{ outcome: "conflict" | "not_found" | "invalid_request" }>;
export type SoftwareBaselineMutationOutcome =
  | Readonly<{
      outcome: "created" | "updated" | "archived" | "replayed";
      baseline: SoftwareBaseline;
    }>
  | Readonly<{
      outcome:
        | "conflict"
        | "idempotency_mismatch"
        | "blocked"
        | "not_found"
        | "invalid_request";
    }>;
export type SoftwareBaselineHistoryOutcome =
  | Readonly<{ outcome: "found"; baselines: readonly SoftwareBaseline[] }>
  | Readonly<{ outcome: "not_found" }>;
export type SoftwareBaselineList = Readonly<{
  items: readonly SoftwareBaseline[];
  nextCursor: string | null;
}>;
export type SoftwareBaselineListOutcome =
  | Readonly<{ outcome: "found"; baselines: SoftwareBaselineList }>
  | Readonly<{ outcome: "not_found" }>;
export type SoftwareBaselineMembershipMutationOutcome =
  | Readonly<{
      outcome: "created" | "ended" | "replayed";
      membership: SoftwareBaselineReleaseMembership;
    }>
  | Readonly<{
      outcome:
        | "conflict"
        | "idempotency_mismatch"
        | "blocked"
        | "not_found"
        | "invalid_request";
    }>;
export type SoftwareBaselineMembershipsOutcome =
  | Readonly<{
      outcome: "found";
      memberships: readonly SoftwareBaselineReleaseMembership[];
    }>
  | Readonly<{ outcome: "not_found" }>;
export type ProductRelationshipMutationOutcome<T> =
  | Readonly<{
      outcome: "created" | "ended" | "replayed";
      relationship: T;
      graphVersion: number;
    }>
  | Readonly<{
      outcome:
        | "conflict"
        | "idempotency_mismatch"
        | "cycle_detected"
        | "depth_exceeded"
        | "blocked"
        | "not_found"
        | "invalid_request";
    }>;
export type ProductVariantRelationshipsOutcome =
  | Readonly<{
      outcome: "found";
      relationships: readonly ProductVariantRelationship[];
    }>
  | Readonly<{ outcome: "not_found" }>;
export type ProductRelationshipPreviewOutcome =
  | Readonly<{ outcome: "found"; preview: ProductRelationshipPreview }>
  | Readonly<{
      outcome:
        | "conflict"
        | "cycle_detected"
        | "depth_exceeded"
        | "not_found"
        | "invalid_request";
    }>;
export type ProductComponentLinksOutcome =
  | Readonly<{
      outcome: "found";
      links: readonly ProductComponentLink[];
    }>
  | Readonly<{ outcome: "not_found" }>;
export type ProductRelationshipGraphOutcome =
  | Readonly<{ outcome: "found"; graph: ProductRelationshipGraph }>
  | Readonly<{ outcome: "not_found" | "invalid_request" }>;
export type RelationshipPropagationEventsOutcome =
  | Readonly<{
      outcome: "found";
      events: readonly RelationshipPropagationEvent[];
      nextCursor: string | null;
    }>
  | Readonly<{ outcome: "not_found" | "invalid_request" }>;
export type RelationshipPropagationEventMutationOutcome =
  | Readonly<{ outcome: "created"; event: RelationshipPropagationEvent }>
  | Readonly<{
      outcome: "conflict" | "blocked" | "not_found" | "invalid_request";
    }>;
export type ProductMutationOutcome =
  | Readonly<{
      outcome: "created" | "replayed" | "updated" | "assigned" | "archived";
      product: Product;
    }>
  | Readonly<{ outcome: "conflict"; product?: Product }>
  | Readonly<{
      outcome:
        | "idempotency_mismatch"
        | "invalid_request"
        | "invalid_state"
        | "blocked"
        | "not_found";
    }>;
export type ReleaseMutationOutcome =
  | Readonly<{
      outcome:
        | "created"
        | "replayed"
        | "updated"
        | "archived"
        | "transitioned"
        | "corrected";
      release: Release;
    }>
  | Readonly<{ outcome: "conflict"; release?: Release }>
  | Readonly<{
      outcome:
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
        | "market_availability_not_found";
    }>;

export type ProductError = Readonly<{
  code:
    | "invalid_request"
    | "conflict"
    | "not_found"
    | "invalid_state"
    | "dependency_blocked"
    | "inactive"
    | "incomplete"
    | "invalid_transition"
    | "placement_requires_placed_on_market_at"
    | "placement_requires_active_market_availability"
    | "placed_on_market_date_not_set"
    | "member_state_unavailable"
    | "market_availability_not_found"
    | "cycle_detected"
    | "depth_exceeded"
    | "unavailable"
    | "malformed_provider";
  current?: Product | Release;
}>;

type ProductResult<T> = Result<T, ProductError>;

/** Framework-free tenant-scoped product and release workflows. */
export class ProductUseCases
  implements
    ReleaseMarketAvailabilityReader,
    ReleaseRegulatoryStateReader,
    ProductRetentionReaderPort,
    ProductRetentionProjectionPort,
    ProductRelationshipResolverPort
{
  constructor(
    private readonly repository: ProductRepository,
    private readonly legalEntities: LegalEntityDirectory,
  ) {}

  async list(
    organizationId: string,
    actorId: string,
    query: ProductListQuery,
  ): Promise<ProductResult<Readonly<{ products: ProductPage }>>> {
    try {
      const outcome = await this.repository.listProducts(
        organizationId,
        actorId,
        query,
      );
      return outcome.outcome === "found"
        ? success(
            Object.freeze({ products: immutableProductPage(outcome.products) }),
          )
        : this.notFound();
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async get(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
    }>,
  ): Promise<ProductResult<Readonly<{ product: Product }>>> {
    try {
      const outcome = await this.repository.getProduct(
        command.organizationId,
        command.actorId,
        command.productId,
      );
      return outcome.outcome === "found"
        ? success(Object.freeze({ product: outcome.product }))
        : this.notFound();
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async create(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      input: CreateProductInput;
    }>,
  ): Promise<ProductResult<Readonly<{ product: Product }>>> {
    const legalEntity = await this.activeEntity(
      command.organizationId,
      command.input.legalEntityId,
    );
    if (!legalEntity.ok) return legalEntity;
    try {
      return this.productMutation(
        await this.repository.createProduct(
          command.organizationId,
          command.actorId,
          command.input,
        ),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async update(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      input: UpdateProductInput;
    }>,
  ): Promise<ProductResult<Readonly<{ product: Product }>>> {
    try {
      return this.productMutation(
        await this.repository.updateProduct(
          command.organizationId,
          command.actorId,
          command.productId,
          command.input,
        ),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async assignLegalEntity(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      input: MoveProductLegalEntityInput;
    }>,
  ): Promise<ProductResult<Readonly<{ product: Product }>>> {
    const legalEntity = await this.activeEntity(
      command.organizationId,
      command.input.legalEntityId,
    );
    if (!legalEntity.ok) return legalEntity;
    try {
      return this.productMutation(
        await this.repository.assignProductLegalEntity(
          command.organizationId,
          command.actorId,
          command.productId,
          command.input,
        ),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async archive(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      input: ArchiveProductInput;
    }>,
  ): Promise<ProductResult<Readonly<{ product: Product }>>> {
    try {
      return this.productMutation(
        await this.repository.archiveProduct(
          command.organizationId,
          command.actorId,
          command.productId,
          command.input,
        ),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async listReleases(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      query: ReleaseListQuery;
    }>,
  ): Promise<ProductResult<Readonly<{ releases: ReleasePage }>>> {
    try {
      const outcome = await this.repository.listReleases(
        command.organizationId,
        command.actorId,
        command.productId,
        command.query,
      );
      return outcome.outcome === "found"
        ? success(
            Object.freeze({ releases: immutableReleasePage(outcome.releases) }),
          )
        : this.notFound();
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async getRelease(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      releaseId: string;
    }>,
  ): Promise<ProductResult<Readonly<{ release: Release }>>> {
    try {
      const outcome = await this.repository.getRelease(
        command.organizationId,
        command.actorId,
        command.productId,
        command.releaseId,
      );
      return outcome.outcome === "found"
        ? success(Object.freeze({ release: outcome.release }))
        : this.notFound();
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async getReleaseRegulatoryState(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      releaseId: string;
    }>,
  ): Promise<ProductResult<Readonly<{ release: Release }>>> {
    return this.getRelease(command);
  }

  async createRelease(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      input: CreateReleaseInput;
    }>,
  ): Promise<ProductResult<Readonly<{ release: Release }>>> {
    try {
      return this.releaseMutation(
        await this.repository.createRelease(
          command.organizationId,
          command.actorId,
          command.productId,
          command.input,
        ),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async updateRelease(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      releaseId: string;
      input: UpdateReleaseInput;
    }>,
  ): Promise<ProductResult<Readonly<{ release: Release }>>> {
    try {
      return this.releaseMutation(
        await this.repository.updateRelease(
          command.organizationId,
          command.actorId,
          command.productId,
          command.releaseId,
          command.input,
        ),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async archiveRelease(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      releaseId: string;
      input: ArchiveReleaseInput;
    }>,
  ): Promise<ProductResult<Readonly<{ release: Release }>>> {
    try {
      return this.releaseMutation(
        await this.repository.archiveRelease(
          command.organizationId,
          command.actorId,
          command.productId,
          command.releaseId,
          command.input,
        ),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async listMemberStates(
    command: Readonly<{ organizationId: string; actorId: string }>,
  ) {
    try {
      const outcome = await this.repository.listMemberStates(
        command.organizationId,
        command.actorId,
      );
      return outcome.outcome === "found"
        ? success(
            Object.freeze({
              memberStates: Object.freeze([...outcome.memberStates]),
            }),
          )
        : this.notFound();
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async getReleaseMarketAvailability(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      releaseId: string;
    }>,
  ): Promise<
    ProductResult<
      Readonly<{ marketAvailability: readonly ReleaseMarketAvailability[] }>
    >
  > {
    try {
      const outcome = await this.repository.getReleaseMarketAvailability(
        command.organizationId,
        command.actorId,
        command.productId,
        command.releaseId,
      );
      return outcome.outcome === "found"
        ? success(
            Object.freeze({
              marketAvailability: Object.freeze([
                ...outcome.marketAvailability,
              ]),
            }),
          )
        : this.notFound();
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async addReleaseMarketAvailability(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      releaseId: string;
      input: AddReleaseMarketAvailabilityInput;
    }>,
  ): Promise<ProductResult<Readonly<{ release: Release }>>> {
    try {
      return this.releaseMutation(
        await this.repository.addReleaseMarketAvailability(
          command.organizationId,
          command.actorId,
          command.productId,
          command.releaseId,
          command.input,
        ),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async removeReleaseMarketAvailability(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      releaseId: string;
      countryCode: string;
      input: RemoveReleaseMarketAvailabilityInput;
    }>,
  ): Promise<ProductResult<Readonly<{ release: Release }>>> {
    try {
      return this.releaseMutation(
        await this.repository.removeReleaseMarketAvailability(
          command.organizationId,
          command.actorId,
          command.productId,
          command.releaseId,
          command.countryCode,
          command.input,
        ),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async correctReleaseMarketAvailability(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      releaseId: string;
      input: CorrectReleaseMarketAvailabilityInput;
    }>,
  ): Promise<ProductResult<Readonly<{ release: Release }>>> {
    try {
      return this.releaseMutation(
        await this.repository.correctReleaseMarketAvailability(
          command.organizationId,
          command.actorId,
          command.productId,
          command.releaseId,
          command.input,
        ),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async transitionReleaseLifecycle(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      releaseId: string;
      input: TransitionReleaseLifecycleInput;
    }>,
  ): Promise<ProductResult<Readonly<{ release: Release }>>> {
    try {
      return this.releaseMutation(
        await this.repository.transitionReleaseLifecycle(
          command.organizationId,
          command.actorId,
          command.productId,
          command.releaseId,
          command.input,
        ),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async correctPlacedOnMarketDate(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      releaseId: string;
      input: CorrectPlacedOnMarketDateInput;
    }>,
  ): Promise<ProductResult<Readonly<{ release: Release }>>> {
    try {
      return this.releaseMutation(
        await this.repository.correctPlacedOnMarketDate(
          command.organizationId,
          command.actorId,
          command.productId,
          command.releaseId,
          command.input,
        ),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async getReleaseLifecycleTimeline(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      releaseId: string;
    }>,
  ) {
    try {
      const outcome = await this.repository.getReleaseLifecycleTimeline(
        command.organizationId,
        command.actorId,
        command.productId,
        command.releaseId,
      );
      return outcome.outcome === "found"
        ? success(
            Object.freeze({ timeline: Object.freeze([...outcome.timeline]) }),
          )
        : this.notFound();
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async getSupportPeriods(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
    }>,
  ): Promise<
    ProductResult<Readonly<{ supportPeriods: readonly ProductSupportPeriod[] }>>
  > {
    try {
      const outcome = await this.repository.getSupportPeriods(
        command.organizationId,
        command.actorId,
        command.productId,
      );
      return outcome.outcome === "found"
        ? success(
            Object.freeze({
              supportPeriods: Object.freeze([...outcome.supportPeriods]),
            }),
          )
        : this.notFound();
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async previewSupportPeriodChange(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      input: PreviewSupportPeriodChangeRequest;
    }>,
  ): Promise<ProductResult<Readonly<{ preview: SupportPeriodChangePreview }>>> {
    try {
      const outcome = await this.repository.previewSupportPeriodChange(
        command.organizationId,
        command.actorId,
        command.productId,
        command.input,
      );
      if (outcome.outcome === "found")
        return success(Object.freeze({ preview: outcome.preview }));
      return failure(
        Object.freeze({ code: this.mutationErrorCode(outcome.outcome) }),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async createSupportPeriod(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      input: CreateSupportPeriodRequest;
    }>,
  ): Promise<ProductResult<Readonly<{ supportPeriod: ProductSupportPeriod }>>> {
    try {
      return this.supportPeriodMutation(
        await this.repository.createSupportPeriod(
          command.organizationId,
          command.actorId,
          command.productId,
          command.input,
        ),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async supersedeSupportPeriod(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      supportPeriodId: string;
      input: SupersedeSupportPeriodRequest;
      allowProtectionReduction: boolean;
    }>,
  ): Promise<ProductResult<Readonly<{ supportPeriod: ProductSupportPeriod }>>> {
    try {
      return this.supportPeriodMutation(
        await this.repository.supersedeSupportPeriod(
          command.organizationId,
          command.actorId,
          command.productId,
          command.supportPeriodId,
          command.input,
          command.allowProtectionReduction,
        ),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async getProductRetentionCalculation(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
    }>,
  ): Promise<
    ProductResult<Readonly<{ retention: ProductRetentionCalculation }>>
  > {
    try {
      const outcome = await this.repository.getProductRetentionCalculation(
        command.organizationId,
        command.actorId,
        command.productId,
      );
      return outcome.outcome === "found"
        ? success(Object.freeze({ retention: outcome.retention }))
        : this.notFound();
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async getRetentionProjection(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
    }>,
  ): Promise<
    ProductResult<Readonly<{ retention: ProductRetentionCalculation }>>
  > {
    return this.getProductRetentionCalculation(command);
  }

  async createSoftwareBaseline(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      input: CreateSoftwareBaselineInput;
    }>,
  ): Promise<ProductResult<Readonly<{ baseline: SoftwareBaseline }>>> {
    try {
      return this.softwareBaselineMutation(
        await this.repository.createSoftwareBaseline(
          command.organizationId,
          command.actorId,
          command.input,
        ),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async appendSoftwareBaselineRevision(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      baselineId: string;
      input: AppendSoftwareBaselineRevisionInput;
    }>,
  ): Promise<ProductResult<Readonly<{ baseline: SoftwareBaseline }>>> {
    try {
      return this.softwareBaselineMutation(
        await this.repository.appendSoftwareBaselineRevision(
          command.organizationId,
          command.actorId,
          command.baselineId,
          command.input,
        ),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async getSoftwareBaselineHistory(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      baselineId: string;
    }>,
  ): Promise<
    ProductResult<Readonly<{ baselines: readonly SoftwareBaseline[] }>>
  > {
    try {
      const outcome = await this.repository.getSoftwareBaselineHistory(
        command.organizationId,
        command.actorId,
        command.baselineId,
      );
      return outcome.outcome === "found"
        ? success(
            Object.freeze({ baselines: Object.freeze([...outcome.baselines]) }),
          )
        : this.notFound();
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async listSoftwareBaselines(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      query: SoftwareBaselineListQuery;
    }>,
  ): Promise<ProductResult<Readonly<{ baselines: SoftwareBaselineList }>>> {
    try {
      const outcome = await this.repository.listSoftwareBaselines(
        command.organizationId,
        command.actorId,
        command.query,
      );
      return outcome.outcome === "found"
        ? success(
            Object.freeze({
              baselines: Object.freeze({
                ...outcome.baselines,
                items: Object.freeze([...outcome.baselines.items]),
              }),
            }),
          )
        : this.notFound();
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async archiveSoftwareBaseline(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      baselineId: string;
      input: ArchiveSoftwareBaselineInput;
    }>,
  ): Promise<ProductResult<Readonly<{ baseline: SoftwareBaseline }>>> {
    try {
      return this.softwareBaselineMutation(
        await this.repository.archiveSoftwareBaseline(
          command.organizationId,
          command.actorId,
          command.baselineId,
          command.input,
        ),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async assignSoftwareBaselineMembership(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      input: AssignSoftwareBaselineMembershipInput;
    }>,
  ): Promise<
    ProductResult<Readonly<{ membership: SoftwareBaselineReleaseMembership }>>
  > {
    try {
      return this.softwareBaselineMembershipMutation(
        await this.repository.assignSoftwareBaselineMembership(
          command.organizationId,
          command.actorId,
          command.productId,
          command.input,
        ),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async endSoftwareBaselineMembership(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      membershipId: string;
      input: EndSoftwareBaselineMembershipInput;
    }>,
  ): Promise<
    ProductResult<Readonly<{ membership: SoftwareBaselineReleaseMembership }>>
  > {
    try {
      return this.softwareBaselineMembershipMutation(
        await this.repository.endSoftwareBaselineMembership(
          command.organizationId,
          command.actorId,
          command.productId,
          command.membershipId,
          command.input,
        ),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async getSoftwareBaselineMemberships(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      asOf?: string;
    }>,
  ): Promise<
    ProductResult<
      Readonly<{ memberships: readonly SoftwareBaselineReleaseMembership[] }>
    >
  > {
    try {
      const outcome = await this.repository.getSoftwareBaselineMemberships(
        command.organizationId,
        command.actorId,
        command.productId,
        command.asOf,
      );
      return outcome.outcome === "found"
        ? success(
            Object.freeze({
              memberships: Object.freeze([...outcome.memberships]),
            }),
          )
        : this.notFound();
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async createProductVariantRelationship(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      targetProductId: string;
      input: CreateProductVariantRelationshipInput;
    }>,
  ): Promise<
    ProductResult<
      Readonly<{
        relationship: ProductVariantRelationship;
        graphVersion: number;
      }>
    >
  > {
    if (command.input.variantProductId !== command.targetProductId) {
      return failure(Object.freeze({ code: "invalid_request" }));
    }
    try {
      return this.productRelationshipMutation(
        await this.repository.createProductVariantRelationship(
          command.organizationId,
          command.actorId,
          command.targetProductId,
          command.input,
        ),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async endProductVariantRelationship(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      relationshipId: string;
      input: EndProductVariantRelationshipInput;
    }>,
  ): Promise<
    ProductResult<
      Readonly<{
        relationship: ProductVariantRelationship;
        graphVersion: number;
      }>
    >
  > {
    try {
      return this.productRelationshipMutation(
        await this.repository.endProductVariantRelationship(
          command.organizationId,
          command.actorId,
          command.productId,
          command.relationshipId,
          command.input,
        ),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async getProductVariantRelationships(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      asOf?: string;
    }>,
  ): Promise<
    ProductResult<
      Readonly<{ relationships: readonly ProductVariantRelationship[] }>
    >
  > {
    try {
      const outcome = await this.repository.getProductVariantRelationships(
        command.organizationId,
        command.actorId,
        command.productId,
        command.asOf,
      );
      return outcome.outcome === "found"
        ? success(
            Object.freeze({
              relationships: Object.freeze([...outcome.relationships]),
            }),
          )
        : this.notFound();
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async previewProductComponentLink(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      parentProductId: string;
      input: PreviewProductComponentLinkInput;
    }>,
  ): Promise<ProductResult<Readonly<{ preview: ProductRelationshipPreview }>>> {
    try {
      const outcome = await this.repository.previewProductComponentLink(
        command.organizationId,
        command.actorId,
        command.parentProductId,
        command.input,
      );
      return outcome.outcome === "found"
        ? success(Object.freeze({ preview: outcome.preview }))
        : failure(
            Object.freeze({ code: this.mutationErrorCode(outcome.outcome) }),
          );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async createProductComponentLink(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      parentProductId: string;
      input: CreateProductComponentLinkInput;
    }>,
  ): Promise<
    ProductResult<
      Readonly<{ relationship: ProductComponentLink; graphVersion: number }>
    >
  > {
    try {
      return this.productRelationshipMutation(
        await this.repository.createProductComponentLink(
          command.organizationId,
          command.actorId,
          command.parentProductId,
          command.input,
        ),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async endProductComponentLink(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      relationshipId: string;
      input: EndProductComponentLinkInput;
    }>,
  ): Promise<
    ProductResult<
      Readonly<{ relationship: ProductComponentLink; graphVersion: number }>
    >
  > {
    try {
      return this.productRelationshipMutation(
        await this.repository.endProductComponentLink(
          command.organizationId,
          command.actorId,
          command.productId,
          command.relationshipId,
          command.input,
        ),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async supersedeProductComponentLink(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      relationshipId: string;
      input: SupersedeProductComponentLinkInput;
    }>,
  ): Promise<
    ProductResult<
      Readonly<{ relationship: ProductComponentLink; graphVersion: number }>
    >
  > {
    try {
      return this.productRelationshipMutation(
        await this.repository.supersedeProductComponentLink(
          command.organizationId,
          command.actorId,
          command.productId,
          command.relationshipId,
          command.input,
        ),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async getProductComponentLinks(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      asOf?: string;
    }>,
  ): Promise<
    ProductResult<Readonly<{ links: readonly ProductComponentLink[] }>>
  > {
    try {
      const outcome = await this.repository.getProductComponentLinks(
        command.organizationId,
        command.actorId,
        command.productId,
        command.asOf,
      );
      return outcome.outcome === "found"
        ? success(Object.freeze({ links: Object.freeze([...outcome.links]) }))
        : this.notFound();
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async getProductRelationshipGraph(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      query: ProductRelationshipGraphQuery;
    }>,
  ): Promise<ProductResult<Readonly<{ graph: ProductRelationshipGraph }>>> {
    try {
      const outcome = await this.repository.getProductRelationshipGraph(
        command.organizationId,
        command.actorId,
        command.productId,
        command.query,
      );
      return outcome.outcome === "found"
        ? success(Object.freeze({ graph: outcome.graph }))
        : failure(Object.freeze({ code: outcome.outcome }));
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async getRelationshipPropagationEvents(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      query: RelationshipPropagationEventsQuery;
    }>,
  ): Promise<
    ProductResult<
      Readonly<{
        events: readonly RelationshipPropagationEvent[];
        nextCursor: string | null;
      }>
    >
  > {
    try {
      const outcome = await this.repository.getRelationshipPropagationEvents(
        command.organizationId,
        command.actorId,
        command.productId,
        command.query,
      );
      return outcome.outcome === "found"
        ? success(
            Object.freeze({
              events: Object.freeze([...outcome.events]),
              nextCursor: outcome.nextCursor,
            }),
          )
        : failure(Object.freeze({ code: outcome.outcome }));
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async requestRelationshipReevaluation(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      input: RequestRelationshipReevaluationInput;
    }>,
  ): Promise<ProductResult<Readonly<{ event: RelationshipPropagationEvent }>>> {
    try {
      const outcome = await this.repository.requestRelationshipReevaluation(
        command.organizationId,
        command.actorId,
        command.productId,
        command.input,
      );
      return outcome.outcome === "created"
        ? success(Object.freeze({ event: outcome.event }))
        : failure(
            Object.freeze({ code: this.mutationErrorCode(outcome.outcome) }),
          );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async getRelationshipPropagationCandidates(
    command: ProductRelationshipPropagationCommand,
  ): Promise<
    ProductResult<
      Readonly<{
        candidates: readonly RelationshipPropagationCandidate[];
        nextCursor: string | null;
        graphVersion: number;
        evaluatedAt: string;
      }>
    >
  > {
    const parsed = relationshipPropagationQuerySchema.safeParse({
      sourceReleaseId: command.sourceReleaseId,
      sourceBaselineRevisionId: command.sourceBaselineRevisionId,
      graphVersion: command.graphVersion,
      asOf: command.asOf,
      cursor: command.cursor,
      pageSize: command.pageSize,
    });
    if (!parsed.success) {
      return failure(Object.freeze({ code: "invalid_request" }));
    }
    try {
      const outcome =
        await this.repository.getRelationshipPropagationCandidates(
          command.organizationId,
          command.actorId,
          Object.freeze({
            organizationId: command.organizationId,
            actorId: command.actorId,
            ...parsed.data,
          }),
        );
      return outcome.outcome === "found"
        ? success(
            Object.freeze({
              candidates: Object.freeze([...outcome.candidates]),
              nextCursor: outcome.nextCursor,
              graphVersion: outcome.graphVersion,
              evaluatedAt: outcome.evaluatedAt,
            }),
          )
        : failure(Object.freeze({ code: outcome.outcome }));
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async getSupportAlertHistory(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
    }>,
  ): Promise<
    ProductResult<Readonly<{ alerts: readonly SupportAlertHistoryItem[] }>>
  > {
    try {
      const outcome = await this.repository.getSupportAlertHistory(
        command.organizationId,
        command.actorId,
        command.productId,
      );
      return outcome.outcome === "found"
        ? success(Object.freeze({ alerts: Object.freeze([...outcome.alerts]) }))
        : this.notFound();
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async getSupportAlertIntervals(
    command: Readonly<{ organizationId: string; actorId: string }>,
  ): Promise<ProductResult<Readonly<{ intervals: SupportAlertIntervals }>>> {
    try {
      const outcome = await this.repository.getSupportAlertIntervals(
        command.organizationId,
        command.actorId,
      );
      return outcome.outcome === "found"
        ? success(Object.freeze({ intervals: outcome.intervals }))
        : this.notFound();
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async updateSupportAlertIntervals(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      input: UpdateSupportAlertIntervalsRequest;
    }>,
  ): Promise<ProductResult<Readonly<{ intervals: SupportAlertIntervals }>>> {
    try {
      const outcome = await this.repository.updateSupportAlertIntervals(
        command.organizationId,
        command.actorId,
        command.input,
      );
      return outcome.outcome === "updated"
        ? success(Object.freeze({ intervals: outcome.intervals }))
        : failure(
            Object.freeze({ code: this.mutationErrorCode(outcome.outcome) }),
          );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  private async activeEntity(
    organizationId: string,
    legalEntityId: string,
  ): Promise<Result<LegalEntityContext, ProductError>> {
    const result = await this.legalEntities.resolveActiveContext(
      organizationId,
      legalEntityId,
    );
    return result.ok
      ? result
      : failure(Object.freeze({ code: result.error.code }));
  }
  private productMutation(
    outcome: ProductMutationOutcome,
  ): ProductResult<Readonly<{ product: Product }>> {
    if (outcome.outcome === "conflict")
      return failure(
        Object.freeze({
          code: "conflict",
          ...(outcome.product ? { current: outcome.product } : {}),
        }),
      );
    if ("product" in outcome && outcome.product)
      return success(Object.freeze({ product: outcome.product }));
    return failure(
      Object.freeze({ code: this.mutationErrorCode(outcome.outcome) }),
    );
  }
  private releaseMutation(
    outcome: ReleaseMutationOutcome,
  ): ProductResult<Readonly<{ release: Release }>> {
    if (outcome.outcome === "conflict")
      return failure(
        Object.freeze({
          code: "conflict",
          ...(outcome.release ? { current: outcome.release } : {}),
        }),
      );
    if ("release" in outcome && outcome.release)
      return success(Object.freeze({ release: outcome.release }));
    return failure(
      Object.freeze({ code: this.mutationErrorCode(outcome.outcome) }),
    );
  }
  private supportPeriodMutation(
    outcome: SupportPeriodMutationOutcome,
  ): ProductResult<Readonly<{ supportPeriod: ProductSupportPeriod }>> {
    if (outcome.outcome === "created" || outcome.outcome === "superseded") {
      return success(Object.freeze({ supportPeriod: outcome.supportPeriod }));
    }
    return failure(
      Object.freeze({ code: this.mutationErrorCode(outcome.outcome) }),
    );
  }
  private softwareBaselineMutation(
    outcome: SoftwareBaselineMutationOutcome,
  ): ProductResult<Readonly<{ baseline: SoftwareBaseline }>> {
    if ("baseline" in outcome) {
      return success(Object.freeze({ baseline: outcome.baseline }));
    }
    return failure(
      Object.freeze({ code: this.mutationErrorCode(outcome.outcome) }),
    );
  }
  private softwareBaselineMembershipMutation(
    outcome: SoftwareBaselineMembershipMutationOutcome,
  ): ProductResult<
    Readonly<{ membership: SoftwareBaselineReleaseMembership }>
  > {
    if ("membership" in outcome) {
      return success(Object.freeze({ membership: outcome.membership }));
    }
    return failure(
      Object.freeze({ code: this.mutationErrorCode(outcome.outcome) }),
    );
  }
  private productRelationshipMutation<T>(
    outcome: ProductRelationshipMutationOutcome<T>,
  ): ProductResult<Readonly<{ relationship: T; graphVersion: number }>> {
    if ("relationship" in outcome) {
      return success(
        Object.freeze({
          relationship: outcome.relationship,
          graphVersion: outcome.graphVersion,
        }),
      );
    }
    return failure(
      Object.freeze({ code: this.mutationErrorCode(outcome.outcome) }),
    );
  }
  private notFound<T>(): ProductResult<T> {
    return failure(Object.freeze({ code: "not_found" }));
  }
  private providerFailure<T>(error?: unknown): ProductResult<T> {
    if (error instanceof Error && error.message === "malformed")
      return failure(Object.freeze({ code: "malformed_provider" }));
    return failure(Object.freeze({ code: "unavailable" }));
  }
  private mutationErrorCode(outcome: string): ProductError["code"] {
    switch (outcome) {
      case "blocked":
        return "dependency_blocked";
      case "conflict":
      case "idempotency_mismatch":
        return "conflict";
      case "invalid_request":
      case "invalid_state":
      case "not_found":
      case "invalid_transition":
      case "placement_requires_placed_on_market_at":
      case "placement_requires_active_market_availability":
      case "placed_on_market_date_not_set":
      case "member_state_unavailable":
      case "market_availability_not_found":
      case "cycle_detected":
      case "depth_exceeded":
        return outcome;
      default:
        return "unavailable";
    }
  }
}

function immutableProductPage(page: ProductPage): ProductPage {
  return Object.freeze({ ...page, rows: Object.freeze([...page.rows]) });
}
function immutableReleasePage(page: ReleasePage): ReleasePage {
  return Object.freeze({ ...page, rows: Object.freeze([...page.rows]) });
}
