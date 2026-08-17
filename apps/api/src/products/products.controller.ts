import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  addReleaseMarketAvailabilityInputSchema,
  archiveProductInputSchema,
  archiveReleaseInputSchema,
  correctPlacedOnMarketDateInputSchema,
  correctReleaseMarketAvailabilityInputSchema,
  createSupportPeriodRequestSchema,
  createSoftwareBaselineInputSchema,
  appendSoftwareBaselineRevisionInputSchema,
  archiveSoftwareBaselineInputSchema,
  assignSoftwareBaselineMembershipInputSchema,
  endSoftwareBaselineMembershipInputSchema,
  createProductVariantRelationshipInputSchema,
  endProductVariantRelationshipInputSchema,
  previewProductComponentLinkInputSchema,
  createProductComponentLinkInputSchema,
  supersedeProductComponentLinkInputSchema,
  endProductComponentLinkInputSchema,
  productRelationshipGraphQuerySchema,
  relationshipPropagationEventsQuerySchema,
  requestRelationshipReevaluationInputSchema,
  createProductInputSchema,
  createReleaseInputSchema,
  memberStatesResponseSchema,
  moveProductLegalEntityInputSchema,
  productListQuerySchema,
  productParamsSchema,
  productResponseSchema,
  productRetentionResponseSchema,
  productsResponseSchema,
  releaseLifecycleTimelineResponseSchema,
  releaseListQuerySchema,
  releaseMarketAvailabilityParamsSchema,
  releaseMarketAvailabilityResponseSchema,
  releaseParamsSchema,
  releaseResponseSchema,
  releasesResponseSchema,
  removeReleaseMarketAvailabilityInputSchema,
  previewSupportPeriodChangeRequestSchema,
  supportAlertHistoryResponseSchema,
  supportAlertIntervalsResponseSchema,
  supportPeriodChangePreviewResponseSchema,
  supportPeriodHistoryResponseSchema,
  supportPeriodIdParamsSchema,
  supportPeriodResponseSchema,
  softwareBaselineResponseSchema,
  softwareBaselineListQuerySchema,
  softwareBaselineListResponseSchema,
  softwareBaselinesResponseSchema,
  softwareBaselineMembershipsResponseSchema,
  softwareBaselineMembershipResponseSchema,
  productVariantRelationshipResponseSchema,
  productVariantRelationshipsResponseSchema,
  productComponentLinkResponseSchema,
  productComponentLinksResponseSchema,
  productRelationshipGraphResponseSchema,
  productRelationshipPreviewResponseSchema,
  relationshipPropagationEventsResponseSchema,
  requestRelationshipReevaluationResponseSchema,
  softwareBaselineParamsSchema,
  softwareBaselineMembershipParamsSchema,
  productRelationshipParamsSchema,
  supersedeSupportPeriodRequestSchema,
  transitionReleaseLifecycleInputSchema,
  updateSupportAlertIntervalsRequestSchema,
  updateProductInputSchema,
  updateReleaseInputSchema,
  type AddReleaseMarketAvailabilityInput,
  type ArchiveProductInput,
  type ArchiveReleaseInput,
  type CorrectPlacedOnMarketDateInput,
  type CorrectReleaseMarketAvailabilityInput,
  type CreateSupportPeriodRequest,
  type CreateProductInput,
  type CreateReleaseInput,
  type MoveProductLegalEntityInput,
  type ProductListQuery,
  type ProductParams,
  type PreviewSupportPeriodChangeRequest,
  type ReleaseMarketAvailabilityParams,
  type ReleaseListQuery,
  type ReleaseParams,
  type RemoveReleaseMarketAvailabilityInput,
  type SupersedeSupportPeriodRequest,
  type TransitionReleaseLifecycleInput,
  type UpdateSupportAlertIntervalsRequest,
  type UpdateProductInput,
  type UpdateReleaseInput,
  type CreateSoftwareBaselineInput,
  type SoftwareBaselineListQuery,
  type AppendSoftwareBaselineRevisionInput,
  type ArchiveSoftwareBaselineInput,
  type AssignSoftwareBaselineMembershipInput,
  type EndSoftwareBaselineMembershipInput,
  type CreateProductVariantRelationshipInput,
  type EndProductVariantRelationshipInput,
  type PreviewProductComponentLinkInput,
  type CreateProductComponentLinkInput,
  type SupersedeProductComponentLinkInput,
  type EndProductComponentLinkInput,
  type ProductRelationshipGraphQuery,
  type RelationshipPropagationEventsQuery,
  type RequestRelationshipReevaluationInput,
} from "@repo/contracts/products";

import {
  CurrentUser,
  RequirePermissions,
  RequireRole,
  type RequestUser,
} from "../auth/auth.types";
import { ZodResponse } from "../common/http/zod-response.interceptor";
import {
  zodBody,
  zodParams,
  zodQuery,
} from "../common/pipes/zod-validation.pipe";
import { PermissionsService } from "../permissions/permissions.service";
import { ProductsService } from "./products.service";

@Controller("products")
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly permissions: PermissionsService,
  ) {}

  @RequirePermissions("can_view_products")
  @Get()
  @ZodResponse(productsResponseSchema)
  list(
    @Query(zodQuery(productListQuerySchema)) query: ProductListQuery,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.list(this.organizationId(user), user.id, query);
  }

  @RequirePermissions("can_view_products")
  @Get("member-states")
  @ZodResponse(memberStatesResponseSchema)
  listMemberStates(@CurrentUser() user: RequestUser) {
    return this.products.listMemberStates({
      organizationId: this.organizationId(user),
      actorId: user.id,
    });
  }

  // Register this static path before the one-segment :productId route.
  @RequirePermissions("can_view_products")
  @Get("support-alert-intervals")
  @ZodResponse(supportAlertIntervalsResponseSchema)
  async getSupportAlertIntervals(@CurrentUser() user: RequestUser) {
    const { intervals } = await this.products.getSupportAlertIntervals({
      organizationId: this.organizationId(user),
      actorId: user.id,
    });
    return intervals;
  }

  @RequirePermissions("can_edit_products")
  @Patch("support-alert-intervals")
  @ZodResponse(supportAlertIntervalsResponseSchema)
  async updateSupportAlertIntervals(
    @Body(zodBody(updateSupportAlertIntervalsRequestSchema))
    input: UpdateSupportAlertIntervalsRequest,
    @CurrentUser() user: RequestUser,
  ) {
    const { intervals } = await this.products.updateSupportAlertIntervals({
      organizationId: this.organizationId(user),
      actorId: user.id,
      input,
    });
    return intervals;
  }

  @RequirePermissions("can_edit_products")
  @Post("baselines")
  @HttpCode(HttpStatus.CREATED)
  @ZodResponse(softwareBaselineResponseSchema)
  createSoftwareBaseline(
    @Body(zodBody(createSoftwareBaselineInputSchema))
    input: CreateSoftwareBaselineInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.createSoftwareBaseline({
      organizationId: this.organizationId(user),
      actorId: user.id,
      input,
    });
  }

  @RequirePermissions("can_view_products")
  @Get("baselines")
  @ZodResponse(softwareBaselineListResponseSchema)
  listSoftwareBaselines(
    @Query(zodQuery(softwareBaselineListQuerySchema))
    query: SoftwareBaselineListQuery,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.listSoftwareBaselines({
      organizationId: this.organizationId(user),
      actorId: user.id,
      query,
    });
  }

  @RequirePermissions("can_view_products")
  @Get("baselines/:baselineId/revisions")
  @ZodResponse(softwareBaselinesResponseSchema)
  getSoftwareBaselineHistory(
    @Param(zodParams(softwareBaselineParamsSchema))
    params: Readonly<{ baselineId: string }>,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.getSoftwareBaselineHistory({
      organizationId: this.organizationId(user),
      actorId: user.id,
      baselineId: params.baselineId,
    });
  }

  @RequirePermissions("can_edit_products")
  @Post("baselines/:baselineId/revisions")
  @ZodResponse(softwareBaselineResponseSchema)
  appendSoftwareBaselineRevision(
    @Param(zodParams(softwareBaselineParamsSchema))
    params: Readonly<{ baselineId: string }>,
    @Body(zodBody(appendSoftwareBaselineRevisionInputSchema))
    input: AppendSoftwareBaselineRevisionInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.appendSoftwareBaselineRevision({
      organizationId: this.organizationId(user),
      actorId: user.id,
      baselineId: params.baselineId,
      input,
    });
  }

  @RequirePermissions("can_edit_products")
  @Post("baselines/:baselineId/archive")
  @ZodResponse(softwareBaselineResponseSchema)
  archiveSoftwareBaseline(
    @Param(zodParams(softwareBaselineParamsSchema))
    params: Readonly<{ baselineId: string }>,
    @Body(zodBody(archiveSoftwareBaselineInputSchema))
    input: ArchiveSoftwareBaselineInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.archiveSoftwareBaseline({
      organizationId: this.organizationId(user),
      actorId: user.id,
      baselineId: params.baselineId,
      input,
    });
  }

  @RequirePermissions("can_view_products")
  @Get(":productId")
  @ZodResponse(productResponseSchema)
  get(
    @Param(zodParams(productParamsSchema)) params: ProductParams,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.get({
      organizationId: this.organizationId(user),
      actorId: user.id,
      productId: params.productId,
    });
  }

  @RequirePermissions("can_create_products")
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ZodResponse(productResponseSchema)
  create(
    @Body(zodBody(createProductInputSchema)) input: CreateProductInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.create({
      organizationId: this.organizationId(user),
      actorId: user.id,
      input,
    });
  }

  @RequirePermissions("can_edit_products")
  @Patch(":productId")
  @ZodResponse(productResponseSchema)
  update(
    @Param(zodParams(productParamsSchema)) params: ProductParams,
    @Body(zodBody(updateProductInputSchema)) input: UpdateProductInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.update({
      organizationId: this.organizationId(user),
      actorId: user.id,
      productId: params.productId,
      input,
    });
  }

  @RequireRole("owner")
  @RequirePermissions("can_edit_products")
  @Post(":productId/legal-entity-assignment")
  @ZodResponse(productResponseSchema)
  assignLegalEntity(
    @Param(zodParams(productParamsSchema)) params: ProductParams,
    @Body(zodBody(moveProductLegalEntityInputSchema))
    input: MoveProductLegalEntityInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.assignLegalEntity({
      organizationId: this.organizationId(user),
      actorId: user.id,
      productId: params.productId,
      input,
    });
  }

  @RequirePermissions("can_delete_products")
  @Post(":productId/archive")
  @ZodResponse(productResponseSchema)
  archive(
    @Param(zodParams(productParamsSchema)) params: ProductParams,
    @Body(zodBody(archiveProductInputSchema)) input: ArchiveProductInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.archive({
      organizationId: this.organizationId(user),
      actorId: user.id,
      productId: params.productId,
      input,
    });
  }

  @RequirePermissions("can_view_products")
  @Get(":productId/baseline-memberships")
  @ZodResponse(softwareBaselineMembershipsResponseSchema)
  getSoftwareBaselineMemberships(
    @Param(zodParams(productParamsSchema)) params: ProductParams,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.getSoftwareBaselineMemberships({
      organizationId: this.organizationId(user),
      actorId: user.id,
      productId: params.productId,
    });
  }

  @RequirePermissions("can_edit_products")
  @Post(":productId/baseline-memberships")
  @HttpCode(HttpStatus.CREATED)
  @ZodResponse(softwareBaselineMembershipResponseSchema)
  assignSoftwareBaselineMembership(
    @Param(zodParams(productParamsSchema)) params: ProductParams,
    @Body(zodBody(assignSoftwareBaselineMembershipInputSchema))
    input: AssignSoftwareBaselineMembershipInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.assignSoftwareBaselineMembership({
      organizationId: this.organizationId(user),
      actorId: user.id,
      productId: params.productId,
      input,
    });
  }

  @RequirePermissions("can_edit_products")
  @Post(":productId/baseline-memberships/:membershipId/end")
  @ZodResponse(softwareBaselineMembershipResponseSchema)
  endSoftwareBaselineMembership(
    @Param(zodParams(softwareBaselineMembershipParamsSchema))
    params: Readonly<{ productId: string; membershipId: string }>,
    @Body(zodBody(endSoftwareBaselineMembershipInputSchema))
    input: EndSoftwareBaselineMembershipInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.endSoftwareBaselineMembership({
      organizationId: this.organizationId(user),
      actorId: user.id,
      productId: params.productId,
      membershipId: params.membershipId,
      input,
    });
  }

  @RequirePermissions("can_view_products")
  @Get(":productId/variant-relationships")
  @ZodResponse(productVariantRelationshipsResponseSchema)
  getProductVariantRelationships(
    @Param(zodParams(productParamsSchema)) params: ProductParams,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.getProductVariantRelationships({
      organizationId: this.organizationId(user),
      actorId: user.id,
      productId: params.productId,
    });
  }

  @RequirePermissions("can_edit_products")
  @Post(":productId/variant-relationships")
  @HttpCode(HttpStatus.CREATED)
  @ZodResponse(productVariantRelationshipResponseSchema)
  createProductVariantRelationship(
    @Param(zodParams(productParamsSchema)) params: ProductParams,
    @Body(zodBody(createProductVariantRelationshipInputSchema))
    input: CreateProductVariantRelationshipInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.createProductVariantRelationship({
      organizationId: this.organizationId(user),
      actorId: user.id,
      targetProductId: params.productId,
      input,
    });
  }

  @RequirePermissions("can_edit_products")
  @Post(":productId/variant-relationships/:relationshipId/end")
  @ZodResponse(productVariantRelationshipResponseSchema)
  endProductVariantRelationship(
    @Param(zodParams(productRelationshipParamsSchema))
    params: Readonly<{ productId: string; relationshipId: string }>,
    @Body(zodBody(endProductVariantRelationshipInputSchema))
    input: EndProductVariantRelationshipInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.endProductVariantRelationship({
      organizationId: this.organizationId(user),
      actorId: user.id,
      productId: params.productId,
      relationshipId: params.relationshipId,
      input,
    });
  }

  @RequirePermissions("can_view_products")
  @Get(":productId/component-links")
  @ZodResponse(productComponentLinksResponseSchema)
  getProductComponentLinks(
    @Param(zodParams(productParamsSchema)) params: ProductParams,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.getProductComponentLinks({
      organizationId: this.organizationId(user),
      actorId: user.id,
      productId: params.productId,
    });
  }

  @RequirePermissions("can_edit_products")
  @Post(":productId/component-links/preview")
  @ZodResponse(productRelationshipPreviewResponseSchema)
  previewProductComponentLink(
    @Param(zodParams(productParamsSchema)) params: ProductParams,
    @Body(zodBody(previewProductComponentLinkInputSchema))
    input: PreviewProductComponentLinkInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.previewProductComponentLink({
      organizationId: this.organizationId(user),
      actorId: user.id,
      parentProductId: params.productId,
      input,
    });
  }

  @RequirePermissions("can_edit_products")
  @Post(":productId/component-links")
  @HttpCode(HttpStatus.CREATED)
  @ZodResponse(productComponentLinkResponseSchema)
  createProductComponentLink(
    @Param(zodParams(productParamsSchema)) params: ProductParams,
    @Body(zodBody(createProductComponentLinkInputSchema))
    input: CreateProductComponentLinkInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.createProductComponentLink({
      organizationId: this.organizationId(user),
      actorId: user.id,
      parentProductId: params.productId,
      input,
    });
  }

  @RequirePermissions("can_edit_products")
  @Post(":productId/component-links/:relationshipId/supersessions")
  @ZodResponse(productComponentLinkResponseSchema)
  supersedeProductComponentLink(
    @Param(zodParams(productRelationshipParamsSchema))
    params: Readonly<{ productId: string; relationshipId: string }>,
    @Body(zodBody(supersedeProductComponentLinkInputSchema))
    input: SupersedeProductComponentLinkInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.supersedeProductComponentLink({
      organizationId: this.organizationId(user),
      actorId: user.id,
      productId: params.productId,
      relationshipId: params.relationshipId,
      input,
    });
  }

  @RequirePermissions("can_edit_products")
  @Post(":productId/component-links/:relationshipId/end")
  @ZodResponse(productComponentLinkResponseSchema)
  endProductComponentLink(
    @Param(zodParams(productRelationshipParamsSchema))
    params: Readonly<{ productId: string; relationshipId: string }>,
    @Body(zodBody(endProductComponentLinkInputSchema))
    input: EndProductComponentLinkInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.endProductComponentLink({
      organizationId: this.organizationId(user),
      actorId: user.id,
      productId: params.productId,
      relationshipId: params.relationshipId,
      input,
    });
  }

  @RequirePermissions("can_view_products")
  @Get(":productId/relationship-graph")
  @ZodResponse(productRelationshipGraphResponseSchema)
  getProductRelationshipGraph(
    @Param(zodParams(productParamsSchema)) params: ProductParams,
    @Query(zodQuery(productRelationshipGraphQuerySchema))
    query: ProductRelationshipGraphQuery,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.getProductRelationshipGraph({
      organizationId: this.organizationId(user),
      actorId: user.id,
      productId: params.productId,
      query,
    });
  }

  @RequirePermissions("can_view_products")
  @Get(":productId/relationship-propagation-events")
  @ZodResponse(relationshipPropagationEventsResponseSchema)
  getRelationshipPropagationEvents(
    @Param(zodParams(productParamsSchema)) params: ProductParams,
    @Query(zodQuery(relationshipPropagationEventsQuerySchema))
    query: RelationshipPropagationEventsQuery,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.getRelationshipPropagationEvents({
      organizationId: this.organizationId(user),
      actorId: user.id,
      productId: params.productId,
      query,
    });
  }

  @RequirePermissions("can_edit_products")
  @Post(":productId/relationship-reevaluations")
  @HttpCode(HttpStatus.CREATED)
  @ZodResponse(requestRelationshipReevaluationResponseSchema)
  requestRelationshipReevaluation(
    @Param(zodParams(productParamsSchema)) params: ProductParams,
    @Body(zodBody(requestRelationshipReevaluationInputSchema))
    input: RequestRelationshipReevaluationInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.requestRelationshipReevaluation({
      organizationId: this.organizationId(user),
      actorId: user.id,
      productId: params.productId,
      input,
    });
  }

  @RequirePermissions("can_view_products")
  @Get(":productId/releases")
  @ZodResponse(releasesResponseSchema)
  listReleases(
    @Param(zodParams(productParamsSchema)) params: ProductParams,
    @Query(zodQuery(releaseListQuerySchema)) query: ReleaseListQuery,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.listReleases({
      organizationId: this.organizationId(user),
      actorId: user.id,
      productId: params.productId,
      query,
    });
  }

  @RequirePermissions("can_create_products")
  @Post(":productId/releases")
  @HttpCode(HttpStatus.CREATED)
  @ZodResponse(releaseResponseSchema)
  createRelease(
    @Param(zodParams(productParamsSchema)) params: ProductParams,
    @Body(zodBody(createReleaseInputSchema)) input: CreateReleaseInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.createRelease({
      organizationId: this.organizationId(user),
      actorId: user.id,
      productId: params.productId,
      input,
    });
  }

  @RequirePermissions("can_view_products")
  @Get(":productId/releases/:releaseId")
  @ZodResponse(releaseResponseSchema)
  getRelease(
    @Param(zodParams(releaseParamsSchema)) params: ReleaseParams,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.getRelease({
      organizationId: this.organizationId(user),
      actorId: user.id,
      productId: params.productId,
      releaseId: params.releaseId,
    });
  }

  @RequirePermissions("can_edit_products")
  @Patch(":productId/releases/:releaseId")
  @ZodResponse(releaseResponseSchema)
  updateRelease(
    @Param(zodParams(releaseParamsSchema)) params: ReleaseParams,
    @Body(zodBody(updateReleaseInputSchema)) input: UpdateReleaseInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.updateRelease({
      organizationId: this.organizationId(user),
      actorId: user.id,
      productId: params.productId,
      releaseId: params.releaseId,
      input,
    });
  }

  @RequirePermissions("can_delete_products")
  @Post(":productId/releases/:releaseId/archive")
  @ZodResponse(releaseResponseSchema)
  archiveRelease(
    @Param(zodParams(releaseParamsSchema)) params: ReleaseParams,
    @Body(zodBody(archiveReleaseInputSchema)) input: ArchiveReleaseInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.archiveRelease({
      organizationId: this.organizationId(user),
      actorId: user.id,
      productId: params.productId,
      releaseId: params.releaseId,
      input,
    });
  }

  @RequirePermissions("can_view_products")
  @Get(":productId/releases/:releaseId/market-availability")
  @ZodResponse(releaseMarketAvailabilityResponseSchema)
  getReleaseMarketAvailability(
    @Param(zodParams(releaseParamsSchema)) params: ReleaseParams,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.getReleaseMarketAvailability({
      organizationId: this.organizationId(user),
      actorId: user.id,
      productId: params.productId,
      releaseId: params.releaseId,
    });
  }

  @RequirePermissions("can_edit_products")
  @Post(":productId/releases/:releaseId/market-availability")
  @ZodResponse(releaseResponseSchema)
  addReleaseMarketAvailability(
    @Param(zodParams(releaseParamsSchema)) params: ReleaseParams,
    @Body(zodBody(addReleaseMarketAvailabilityInputSchema))
    input: AddReleaseMarketAvailabilityInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.addReleaseMarketAvailability({
      organizationId: this.organizationId(user),
      actorId: user.id,
      productId: params.productId,
      releaseId: params.releaseId,
      input,
    });
  }

  @RequirePermissions("can_edit_products")
  @Delete(":productId/releases/:releaseId/market-availability/:countryCode")
  @ZodResponse(releaseResponseSchema)
  removeReleaseMarketAvailability(
    @Param(zodParams(releaseMarketAvailabilityParamsSchema))
    params: ReleaseMarketAvailabilityParams,
    @Body(zodBody(removeReleaseMarketAvailabilityInputSchema))
    input: RemoveReleaseMarketAvailabilityInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.removeReleaseMarketAvailability({
      organizationId: this.organizationId(user),
      actorId: user.id,
      productId: params.productId,
      releaseId: params.releaseId,
      countryCode: params.countryCode,
      input,
    });
  }

  @RequirePermissions("can_edit_products")
  @Post(":productId/releases/:releaseId/market-availability/corrections")
  @ZodResponse(releaseResponseSchema)
  correctReleaseMarketAvailability(
    @Param(zodParams(releaseParamsSchema)) params: ReleaseParams,
    @Body(zodBody(correctReleaseMarketAvailabilityInputSchema))
    input: CorrectReleaseMarketAvailabilityInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.correctReleaseMarketAvailability({
      organizationId: this.organizationId(user),
      actorId: user.id,
      productId: params.productId,
      releaseId: params.releaseId,
      input,
    });
  }

  @RequirePermissions("can_edit_products")
  @Post(":productId/releases/:releaseId/lifecycle-transitions")
  @ZodResponse(releaseResponseSchema)
  async transitionReleaseLifecycle(
    @Param(zodParams(releaseParamsSchema)) params: ReleaseParams,
    @Body(zodBody(transitionReleaseLifecycleInputSchema))
    input: TransitionReleaseLifecycleInput,
    @CurrentUser() user: RequestUser,
  ) {
    await this.ensureDeletePermissionForWithdrawal(input, user);
    return this.products.transitionReleaseLifecycle({
      organizationId: this.organizationId(user),
      actorId: user.id,
      productId: params.productId,
      releaseId: params.releaseId,
      input,
    });
  }

  @RequireRole("owner")
  @RequirePermissions("can_edit_products")
  @Post(":productId/releases/:releaseId/placed-on-market-date-corrections")
  @ZodResponse(releaseResponseSchema)
  correctPlacedOnMarketDate(
    @Param(zodParams(releaseParamsSchema)) params: ReleaseParams,
    @Body(zodBody(correctPlacedOnMarketDateInputSchema))
    input: CorrectPlacedOnMarketDateInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.correctPlacedOnMarketDate({
      organizationId: this.organizationId(user),
      actorId: user.id,
      productId: params.productId,
      releaseId: params.releaseId,
      input,
    });
  }

  @RequirePermissions("can_view_products")
  @Get(":productId/releases/:releaseId/lifecycle-timeline")
  @ZodResponse(releaseLifecycleTimelineResponseSchema)
  getReleaseLifecycleTimeline(
    @Param(zodParams(releaseParamsSchema)) params: ReleaseParams,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.getReleaseLifecycleTimeline({
      organizationId: this.organizationId(user),
      actorId: user.id,
      productId: params.productId,
      releaseId: params.releaseId,
    });
  }

  @RequirePermissions("can_view_products")
  @Get(":productId/support-periods")
  @ZodResponse(supportPeriodHistoryResponseSchema)
  getSupportPeriods(
    @Param(zodParams(productParamsSchema)) params: ProductParams,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.getSupportPeriods({
      organizationId: this.organizationId(user),
      actorId: user.id,
      productId: params.productId,
    });
  }

  @RequirePermissions("can_edit_products")
  @Post(":productId/support-period-preview")
  @ZodResponse(supportPeriodChangePreviewResponseSchema)
  previewSupportPeriodChange(
    @Param(zodParams(productParamsSchema)) params: ProductParams,
    @Body(zodBody(previewSupportPeriodChangeRequestSchema))
    input: PreviewSupportPeriodChangeRequest,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.previewSupportPeriodChange({
      organizationId: this.organizationId(user),
      actorId: user.id,
      productId: params.productId,
      input,
    });
  }

  @RequirePermissions("can_edit_products")
  @Post(":productId/support-periods")
  @HttpCode(HttpStatus.CREATED)
  @ZodResponse(supportPeriodResponseSchema)
  createSupportPeriod(
    @Param(zodParams(productParamsSchema)) params: ProductParams,
    @Body(zodBody(createSupportPeriodRequestSchema))
    input: CreateSupportPeriodRequest,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.createSupportPeriod({
      organizationId: this.organizationId(user),
      actorId: user.id,
      productId: params.productId,
      input,
    });
  }

  @RequirePermissions("can_edit_products")
  @Post(":productId/support-periods/:supportPeriodId/supersessions")
  @ZodResponse(supportPeriodResponseSchema)
  async supersedeSupportPeriod(
    @Param(zodParams(supportPeriodIdParamsSchema))
    params: ProductParams & Readonly<{ supportPeriodId: string }>,
    @Body(zodBody(supersedeSupportPeriodRequestSchema))
    input: SupersedeSupportPeriodRequest,
    @CurrentUser() user: RequestUser,
  ) {
    const organizationId = this.organizationId(user);
    const history = await this.products.getSupportPeriods({
      organizationId,
      actorId: user.id,
      productId: params.productId,
    });
    const current = history.supportPeriods.find(
      (period) => period.id === params.supportPeriodId,
    );
    if (!current || current.supersededAt !== null) {
      throw new NotFoundException({
        message: "Product registry request could not be completed.",
        code: "not_found",
      });
    }
    const shortening =
      Date.parse(input.supportEndsAt) < Date.parse(current.supportEndsAt);
    await this.ensureElevatedShorteningPermission(shortening, user);
    return this.products.supersedeSupportPeriod({
      organizationId,
      actorId: user.id,
      productId: params.productId,
      supportPeriodId: params.supportPeriodId,
      input,
      allowProtectionReduction: shortening,
    });
  }

  @RequirePermissions("can_view_products")
  @Get(":productId/retention")
  @ZodResponse(productRetentionResponseSchema)
  getProductRetentionCalculation(
    @Param(zodParams(productParamsSchema)) params: ProductParams,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.getProductRetentionCalculation({
      organizationId: this.organizationId(user),
      actorId: user.id,
      productId: params.productId,
    });
  }

  @RequirePermissions("can_view_products")
  @Get(":productId/support-alerts")
  @ZodResponse(supportAlertHistoryResponseSchema)
  getSupportAlertHistory(
    @Param(zodParams(productParamsSchema)) params: ProductParams,
    @CurrentUser() user: RequestUser,
  ) {
    return this.products.getSupportAlertHistory({
      organizationId: this.organizationId(user),
      actorId: user.id,
      productId: params.productId,
    });
  }

  private organizationId(user: RequestUser): string {
    if (user.organizationId) return user.organizationId;
    throw new NotFoundException({
      message: "Product registry request could not be completed.",
      code: "not_found",
    });
  }

  private async ensureDeletePermissionForWithdrawal(
    input: TransitionReleaseLifecycleInput,
    user: RequestUser,
  ): Promise<void> {
    if (input.targetState !== "withdrawn") return;
    if (
      !user.organizationId ||
      !user.role ||
      (await this.permissions.can(user.organizationId, user.id, user.role, [
        "can_delete_products",
      ]))
    ) {
      return;
    }
    throw new ForbiddenException({
      message: "You do not have access to this.",
      code: "insufficient_permissions",
    });
  }

  /**
   * Editing products is sufficient for a non-reducing correction. A reduction
   * is deliberately stricter: the actor must be the tenant owner *and* retain
   * the independent deletion permission. This prevents ownership labels from
   * becoming an implicit compliance override.
   */
  private async ensureElevatedShorteningPermission(
    shortening: boolean,
    user: RequestUser,
  ): Promise<void> {
    if (!shortening) return;
    if (!user.organizationId || user.role !== "owner") {
      throw new ForbiddenException({
        message: "You do not have access to this.",
        code: "insufficient_permissions",
      });
    }
    if (
      await this.permissions.can(user.organizationId, user.id, user.role, [
        "can_delete_products",
      ])
    ) {
      return;
    }
    throw new ForbiddenException({
      message: "You do not have access to this.",
      code: "insufficient_permissions",
    });
  }
}
