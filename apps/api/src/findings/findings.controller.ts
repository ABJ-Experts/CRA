import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  createFindingProductImpactOverrideInputSchema,
  createFindingProductImpactOverrideParamsSchema,
  endFindingProductImpactOverrideInputSchema,
  findingProductImpactOverrideParamsSchema,
  findingProductImpactOverrideResponseSchema,
  findingImpactSummaryQuerySchema,
  findingImpactSummaryResponseSchema,
  findingPropagationSourceMutationResponseSchema,
  productParamsSchema,
  registerFindingPropagationSourceInputSchema,
  findingPropagationSourceParamsSchema,
  updateFindingPropagationSourceInputSchema,
  type FindingImpactSummaryQuery,
  type FindingProductImpactOverrideParams,
  type CreateFindingProductImpactOverrideInput,
  type CreateFindingProductImpactOverrideParams,
  type EndFindingProductImpactOverrideInput,
  type ProductParams,
  type RegisterFindingPropagationSourceInput,
  type FindingPropagationSourceParams,
  type UpdateFindingPropagationSourceInput,
} from "@repo/contracts";

import {
  CurrentUser,
  RequirePermissions,
  type RequestUser,
} from "../auth/auth.types";
import { ZodResponse } from "../common/http/zod-response.interceptor";
import {
  zodBody,
  zodParams,
  zodQuery,
} from "../common/pipes/zod-validation.pipe";
import { FindingsService } from "./findings.service";

@Controller("findings/propagation-sources")
export class FindingPropagationSourcesController {
  constructor(private readonly findings: FindingsService) {}

  @RequirePermissions("can_edit_findings")
  @Post()
  @ZodResponse(findingPropagationSourceMutationResponseSchema)
  register(
    @Body(zodBody(registerFindingPropagationSourceInputSchema))
    input: RegisterFindingPropagationSourceInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.findings.registerSource({
      organizationId: this.organizationId(user),
      actorId: user.id,
      input,
    });
  }

  @RequirePermissions("can_edit_findings")
  @Patch(":sourceId")
  @ZodResponse(findingPropagationSourceMutationResponseSchema)
  update(
    @Param(zodParams(findingPropagationSourceParamsSchema))
    params: FindingPropagationSourceParams,
    @Body(zodBody(updateFindingPropagationSourceInputSchema))
    input: UpdateFindingPropagationSourceInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.findings.updateSource({
      organizationId: this.organizationId(user),
      actorId: user.id,
      sourceId: params.sourceId,
      input,
    });
  }

  private organizationId(user: RequestUser): string {
    if (user.organizationId) return user.organizationId;
    throw new NotFoundException({
      message: "Finding propagation request could not be completed.",
      code: "not_found",
    });
  }
}

/**
 * Product-detail aggregate only. It is purposefully not a findings read API:
 * it leaks neither source identity nor evidence and retains product read RBAC.
 */
@Controller("products")
export class ProductFindingImpactSummaryController {
  constructor(private readonly findings: FindingsService) {}

  @RequirePermissions("can_view_products")
  @Get(":productId/finding-impact-summary")
  @ZodResponse(findingImpactSummaryResponseSchema)
  getSummary(
    @Param(zodParams(productParamsSchema)) params: ProductParams,
    @Query(zodQuery(findingImpactSummaryQuerySchema))
    query: FindingImpactSummaryQuery,
    @CurrentUser() user: RequestUser,
  ) {
    return this.findings.getProductImpactSummary({
      organizationId: this.organizationId(user),
      actorId: user.id,
      productId: params.productId,
      query,
    });
  }

  @RequirePermissions("can_edit_findings")
  @Post(":productId/finding-propagation-sources/:sourceId/overrides")
  @ZodResponse(findingProductImpactOverrideResponseSchema)
  createOverride(
    @Param(zodParams(createFindingProductImpactOverrideParamsSchema))
    params: CreateFindingProductImpactOverrideParams,
    @Body(zodBody(createFindingProductImpactOverrideInputSchema))
    input: CreateFindingProductImpactOverrideInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.findings.createProductImpactOverride({
      organizationId: this.organizationId(user),
      actorId: user.id,
      productId: params.productId,
      sourceId: params.sourceId,
      input,
    });
  }

  @RequirePermissions("can_edit_findings")
  @Post(
    ":productId/finding-propagation-sources/:sourceId/overrides/:overrideId/end",
  )
  @ZodResponse(findingProductImpactOverrideResponseSchema)
  endOverride(
    @Param(zodParams(findingProductImpactOverrideParamsSchema))
    params: FindingProductImpactOverrideParams,
    @Body(zodBody(endFindingProductImpactOverrideInputSchema))
    input: EndFindingProductImpactOverrideInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.findings.endProductImpactOverride({
      organizationId: this.organizationId(user),
      actorId: user.id,
      productId: params.productId,
      sourceId: params.sourceId,
      overrideId: params.overrideId,
      input,
    });
  }

  private organizationId(user: RequestUser): string {
    if (user.organizationId) return user.organizationId;
    throw new NotFoundException({
      message: "Finding propagation request could not be completed.",
      code: "not_found",
    });
  }
}
