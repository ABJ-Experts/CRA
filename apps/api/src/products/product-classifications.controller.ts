import {
  BadGatewayException,
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  productParamsSchema,
  productClassificationPolicyResponseSchema,
  productClassificationLatestQuerySchema,
  productClassificationsResponseSchema,
  productClassificationHistoryQuerySchema,
  productClassificationHistoryResponseSchema,
  saveProductClassificationInputSchema,
  saveProductClassificationResponseSchema,
  type ProductParams,
  type ProductClassificationLatestQuery,
  type ProductClassificationHistoryQuery,
  type SaveProductClassificationInput,
} from "@repo/contracts/products";
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
import {
  ClassificationFailure,
  ProductClassificationUseCases,
} from "./application/product-classification";
@Controller("products")
export class ProductClassificationsController {
  constructor(
    private readonly classifications: ProductClassificationUseCases,
  ) {}
  @Get("classification-policy")
  @RequirePermissions("can_view_products")
  @ZodResponse(productClassificationPolicyResponseSchema)
  policy(@CurrentUser() user: RequestUser) {
    this.scope(user);
    return this.classifications.policy();
  }
  @Get("classifications")
  @RequirePermissions("can_view_products")
  @ZodResponse(productClassificationsResponseSchema)
  latest(
    @Query(zodQuery(productClassificationLatestQuerySchema))
    query: ProductClassificationLatestQuery,
    @CurrentUser() user: RequestUser,
  ) {
    return this.invoke(() =>
      this.classifications.latest(this.scope(user), user.id, query),
    );
  }
  @Get(":productId/classifications")
  @RequirePermissions("can_view_products")
  @ZodResponse(productClassificationHistoryResponseSchema)
  history(
    @Param(zodParams(productParamsSchema)) params: ProductParams,
    @Query(zodQuery(productClassificationHistoryQuerySchema))
    query: ProductClassificationHistoryQuery,
    @CurrentUser() user: RequestUser,
  ) {
    return this.invoke(() =>
      this.classifications.history(
        this.scope(user),
        user.id,
        params.productId,
        query,
      ),
    );
  }
  @Post(":productId/classifications")
  @HttpCode(200)
  @RequirePermissions("can_edit_products")
  @ZodResponse(saveProductClassificationResponseSchema)
  save(
    @Param(zodParams(productParamsSchema)) params: ProductParams,
    @Body(zodBody(saveProductClassificationInputSchema))
    input: SaveProductClassificationInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.invoke(() =>
      this.classifications.save(
        this.scope(user),
        user.id,
        params.productId,
        input,
      ),
    );
  }
  private scope(user: RequestUser) {
    if (!user.organizationId)
      throw new ForbiddenException("An organization is required.");
    return user.organizationId;
  }
  private async invoke<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      if (!(error instanceof ClassificationFailure))
        throw new ServiceUnavailableException(
          "Product classifications are temporarily unavailable.",
        );
      const body = { message: error.message, code: error.code };
      switch (error.code) {
        case "not_found":
          throw new NotFoundException(body);
        case "forbidden":
          throw new ForbiddenException(body);
        case "invalid_request":
          throw new BadRequestException(body);
        case "conflict":
        case "invalid_state":
        case "idempotency_mismatch":
          throw new ConflictException(body);
        case "malformed_provider":
          throw new BadGatewayException(body);
        case "unavailable":
          throw new ServiceUnavailableException(body);
      }
    }
  }
}
