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
  createProductInputSchema,
  createReleaseInputSchema,
  memberStatesResponseSchema,
  moveProductLegalEntityInputSchema,
  productListQuerySchema,
  productParamsSchema,
  productResponseSchema,
  productsResponseSchema,
  releaseLifecycleTimelineResponseSchema,
  releaseListQuerySchema,
  releaseMarketAvailabilityParamsSchema,
  releaseMarketAvailabilityResponseSchema,
  releaseParamsSchema,
  releaseResponseSchema,
  releasesResponseSchema,
  removeReleaseMarketAvailabilityInputSchema,
  transitionReleaseLifecycleInputSchema,
  updateProductInputSchema,
  updateReleaseInputSchema,
  type AddReleaseMarketAvailabilityInput,
  type ArchiveProductInput,
  type ArchiveReleaseInput,
  type CorrectPlacedOnMarketDateInput,
  type CorrectReleaseMarketAvailabilityInput,
  type CreateProductInput,
  type CreateReleaseInput,
  type MoveProductLegalEntityInput,
  type ProductListQuery,
  type ProductParams,
  type ReleaseMarketAvailabilityParams,
  type ReleaseListQuery,
  type ReleaseParams,
  type RemoveReleaseMarketAvailabilityInput,
  type TransitionReleaseLifecycleInput,
  type UpdateProductInput,
  type UpdateReleaseInput,
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
}
