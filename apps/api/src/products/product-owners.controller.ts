import {
  Controller,
  ForbiddenException,
  Get,
  Query,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  productOwnerOptionsQuerySchema,
  productOwnerOptionsResponseSchema,
  type ProductOwnerOptionsQuery,
} from "@repo/contracts/products";
import {
  CurrentUser,
  RequirePermissions,
  type RequestUser,
} from "../auth/auth.types";
import { ZodResponse } from "../common/http/zod-response.interceptor";
import { zodQuery } from "../common/pipes/zod-validation.pipe";
import { PermissionsService } from "../permissions/permissions.service";
import { hasPermission } from "@repo/contracts/permissions";
import {
  ProductOwnerAccessDenied,
  ProductOwnerOptions,
} from "./application/product-owner-options";
@Controller("products")
export class ProductOwnersController {
  constructor(
    private readonly owners: ProductOwnerOptions,
    private readonly permissions: PermissionsService,
  ) {}
  @Get("owner-options")
  @RequirePermissions("can_view_products")
  @ZodResponse(productOwnerOptionsResponseSchema)
  async list(
    @Query(zodQuery(productOwnerOptionsQuerySchema))
    query: ProductOwnerOptionsQuery,
    @CurrentUser() user: RequestUser,
  ) {
    if (!user.organizationId || !user.role)
      throw new ForbiddenException("An organization is required.");
    try {
      const permissions = await this.permissions.effectivePermissions(
        user.organizationId,
        user.id,
        user.role,
      );
      const canListOwners = (
        ["can_create_products", "can_edit_products", "can_view_users"] as const
      ).some((key) => hasPermission(permissions, key));
      return await this.owners.list(user.organizationId, query, canListOwners);
    } catch (error) {
      if (error instanceof ProductOwnerAccessDenied)
        throw new ForbiddenException(error.message);
      throw new ServiceUnavailableException(
        "Responsible owners are temporarily unavailable.",
      );
    }
  }
}
