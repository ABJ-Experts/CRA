import { Controller, Get, Query, ForbiddenException } from "@nestjs/common";
import {
  customerSystemHealthQuerySchema,
  customerSystemHealthResponseSchema,
} from "@repo/contracts/system/schemas";
import type {
  CustomerSystemHealthResponse,
  CustomerSystemHealthQuery,
} from "@repo/contracts/system/types";
import {
  CurrentUser,
  RequirePermissions,
  type RequestUser,
} from "../auth/auth.types";
import { zodQuery } from "../common/pipes/zod-validation.pipe";
import { ZodResponse } from "../common/http/zod-response.interceptor";
import { SystemHealthUseCases } from "./application/system-health.use-cases";
import { SystemHealthAuthorizationError } from "./application/system-health.port";
@Controller("system")
export class SystemHealthController {
  constructor(private readonly health: SystemHealthUseCases) {}
  @Get("health")
  @RequirePermissions("can_view_system_health")
  @ZodResponse(customerSystemHealthResponseSchema)
  async read(
    @CurrentUser() user: RequestUser,
    @Query(zodQuery(customerSystemHealthQuerySchema))
    _query: CustomerSystemHealthQuery,
  ): Promise<CustomerSystemHealthResponse> {
    void _query;
    if (!user.organizationId)
      throw new ForbiddenException({
        code: "forbidden",
        message: "A current organization is required",
      });
    try {
      return await this.health.read(user.organizationId, user.id);
    } catch (error) {
      if (error instanceof SystemHealthAuthorizationError)
        throw new ForbiddenException({
          code: "forbidden",
          message: error.message,
        });
      throw error;
    }
  }
}
