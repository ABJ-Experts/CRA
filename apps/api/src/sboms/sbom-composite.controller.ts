import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import {
  createSbomCompositeReviewInputSchema,
  generateSbomCompositeInputSchema,
  resolveSbomCompositeConflictInputSchema,
  resolveSbomCompositeRelationshipInputSchema,
  sbomCompositeConflictParamsSchema,
  sbomCompositeGenerationResponseSchema,
  sbomCompositeRelationshipParamsSchema,
  sbomCompositeReleaseParamsSchema,
  sbomCompositeReviewParamsSchema,
  sbomCompositeReviewResponseSchema,
  type CreateSbomCompositeReviewInput,
  type GenerateSbomCompositeInput,
  type ResolveSbomCompositeConflictInput,
  type ResolveSbomCompositeRelationshipInput,
  type SbomCompositeConflictParams,
  type SbomCompositeRelationshipParams,
  type SbomCompositeReleaseParams,
  type SbomCompositeReviewParams,
} from "@repo/contracts/sboms";

import {
  CurrentUser,
  RequirePermissions,
  type RequestUser,
} from "../auth/auth.types";
import { ZodResponse } from "../common/http/zod-response.interceptor";
import { zodBody, zodParams } from "../common/pipes/zod-validation.pipe";
import { SbomService } from "./sbom.service";

/** Internal review endpoints only; supplier-facing access is a separate opaque session. */
@Controller("products/:productId/releases/:releaseId")
export class ProductReleaseSbomCompositeController {
  constructor(private readonly sboms: SbomService) {}

  @RequirePermissions("can_review_sboms")
  @Post("sbom-composite-reviews")
  @ZodResponse(sbomCompositeReviewResponseSchema)
  async create(
    @Param(zodParams(sbomCompositeReleaseParamsSchema))
    params: SbomCompositeReleaseParams,
    @Body(zodBody(createSbomCompositeReviewInputSchema))
    input: CreateSbomCompositeReviewInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.sboms.createCompositeReview({
      organizationId: compositeOrganizationId(user),
      actorId: user.id,
      productId: params.productId,
      releaseId: params.releaseId,
      sourceIds: input.sourceIds,
      idempotencyKey: input.idempotencyKey,
    });
  }
}

@Controller("sbom-composite-reviews")
export class SbomCompositeReviewsController {
  constructor(private readonly sboms: SbomService) {}

  @RequirePermissions("can_review_sboms")
  @Get(":reviewId")
  @ZodResponse(sbomCompositeReviewResponseSchema)
  async review(
    @Param(zodParams(sbomCompositeReviewParamsSchema))
    params: SbomCompositeReviewParams,
    @CurrentUser() user: RequestUser,
  ) {
    return this.sboms.compositeReview({
      organizationId: compositeOrganizationId(user),
      actorId: user.id,
      reviewId: params.reviewId,
    });
  }

  @RequirePermissions("can_review_sboms")
  @Post(":reviewId/conflicts/:conflictId/resolve")
  @ZodResponse(sbomCompositeReviewResponseSchema)
  async resolveConflict(
    @Param(zodParams(sbomCompositeConflictParamsSchema))
    params: SbomCompositeConflictParams,
    @Body(zodBody(resolveSbomCompositeConflictInputSchema))
    input: ResolveSbomCompositeConflictInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.sboms.resolveCompositeConflict({
      organizationId: compositeOrganizationId(user),
      actorId: user.id,
      reviewId: params.reviewId,
      conflictId: params.conflictId,
      decision: input.decision,
      ...(input.selectedComponentId
        ? { selectedComponentId: input.selectedComponentId }
        : {}),
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
    });
  }

  @RequirePermissions("can_review_sboms")
  @Post(":reviewId/relationships/:relationshipId/resolve")
  @ZodResponse(sbomCompositeReviewResponseSchema)
  async resolveRelationship(
    @Param(zodParams(sbomCompositeRelationshipParamsSchema))
    params: SbomCompositeRelationshipParams,
    @Body(zodBody(resolveSbomCompositeRelationshipInputSchema))
    input: ResolveSbomCompositeRelationshipInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.sboms.resolveCompositeRelationship({
      organizationId: compositeOrganizationId(user),
      actorId: user.id,
      reviewId: params.reviewId,
      relationshipId: params.relationshipId,
      decision: input.decision,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
    });
  }

  @RequirePermissions("can_review_sboms")
  @Post(":reviewId/generate")
  @HttpCode(HttpStatus.ACCEPTED)
  @ZodResponse(sbomCompositeGenerationResponseSchema)
  async generate(
    @Param(zodParams(sbomCompositeReviewParamsSchema))
    params: SbomCompositeReviewParams,
    @Body(zodBody(generateSbomCompositeInputSchema))
    input: GenerateSbomCompositeInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.sboms.generateComposite({
      organizationId: compositeOrganizationId(user),
      actorId: user.id,
      reviewId: params.reviewId,
      idempotencyKey: input.idempotencyKey,
    });
  }
}

function compositeOrganizationId(user: RequestUser): string {
  if (user.organizationId) return user.organizationId;
  throw new NotFoundException({
    message: "SBOM composite request could not be completed.",
    code: "not_found",
  });
}
