import type {
  SiemReadQuery,
  SiemDestinationParams,
  SiemDeliveryParams,
  SiemPageQuery,
  SiemOperation,
  SiemCreateDestination,
  SiemUpdateDestination,
  SiemCredentialInput,
  SiemReplayInput,
} from "@repo/contracts/audit/types";
import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  HttpCode,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  ServiceUnavailableException,
  UseFilters,
} from "@nestjs/common";

import {
  CurrentUser,
  RequirePermissions,
  RequireRole,
  type RequestUser,
} from "../../auth/auth.types";
import { ZodResponse } from "../../common/http/zod-response.interceptor";
import {
  zodBody,
  zodParams,
  zodQuery,
} from "../../common/pipes/zod-validation.pipe";
import { SiemUseCases } from "./application/siem-use-cases";
import { SiemDeniedFilter } from "./siem-denied.filter";
import {
  SiemForbiddenError,
  SiemNotFoundError,
  SiemConflictError,
  SiemInputError,
  SiemUnavailableError,
} from "./siem.errors";
import {
  siemCatalogueSchema,
  siemCreateDestinationSchema,
  siemCredentialInputSchema,
  siemDeliveryDetailSchema,
  siemDeliveryPageSchema,
  siemDeliveryParamsSchema,
  siemDeliverySchema,
  siemDestinationListSchema,
  siemDestinationParamsSchema,
  siemDestinationSchema,
  siemOperationSchema,
  siemPageQuerySchema,
  siemReadQuerySchema,
  siemReplayInputSchema,
  siemReplayPreviewSchema,
  siemTestResultSchema,
  siemUpdateDestinationSchema,
} from "@repo/contracts/audit/schemas";
@UseFilters(SiemDeniedFilter)
@Controller("audit/siem")
export class SiemController {
  constructor(private readonly siem: SiemUseCases) {}
  @Get("catalogue")
  @RequirePermissions("can_view_audit", "can_view_connectors")
  @ZodResponse(siemCatalogueSchema)
  catalogue(
    @CurrentUser() user: RequestUser,
    @Query(zodQuery(siemReadQuerySchema))
    input: SiemReadQuery,
  ) {
    return this.safe(() => this.siem.execute(user, "catalogue", null, input));
  }
  @Get("destinations")
  @RequirePermissions("can_view_audit", "can_view_connectors")
  @ZodResponse(siemDestinationListSchema)
  list(
    @CurrentUser() user: RequestUser,
    @Query(zodQuery(siemReadQuerySchema))
    input: SiemReadQuery,
  ) {
    return this.safe(() => this.siem.execute(user, "list", null, input));
  }
  @Get("destinations/:id")
  @RequirePermissions("can_view_audit", "can_view_connectors")
  @ZodResponse(siemDestinationSchema)
  get(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(siemDestinationParamsSchema))
    params: SiemDestinationParams,
    @Query(zodQuery(siemReadQuerySchema))
    input: SiemReadQuery,
  ) {
    return this.safe(() => this.siem.execute(user, "get", params.id, input));
  }
  @Post("destinations")
  @HttpCode(200)
  @RequirePermissions(
    "can_view_audit",
    "can_view_connectors",
    "can_export_audit",
    "can_create_connectors",
  )
  @ZodResponse(siemDestinationSchema)
  create(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(siemCreateDestinationSchema))
    input: SiemCreateDestination,
  ) {
    return this.safe(() =>
      this.siem.execute(user, "create", input.destinationId, input),
    );
  }
  @Patch("destinations/:id")
  @HttpCode(200)
  @RequirePermissions(
    "can_view_audit",
    "can_view_connectors",
    "can_export_audit",
    "can_edit_connectors",
  )
  @ZodResponse(siemDestinationSchema)
  update(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(siemDestinationParamsSchema))
    params: SiemDestinationParams,
    @Body(zodBody(siemUpdateDestinationSchema))
    input: SiemUpdateDestination,
  ) {
    return this.safe(() => this.siem.execute(user, "update", params.id, input));
  }
  @Post("destinations/:id/credentials")
  @HttpCode(200)
  @RequirePermissions(
    "can_view_audit",
    "can_view_connectors",
    "can_export_audit",
    "can_edit_connectors",
  )
  @RequireRole("owner")
  @ZodResponse(siemDestinationSchema)
  rotate_credentials(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(siemDestinationParamsSchema))
    params: SiemDestinationParams,
    @Body(zodBody(siemCredentialInputSchema))
    input: SiemCredentialInput,
  ) {
    return this.safe(() =>
      this.siem.execute(user, "rotate_credentials", params.id, input),
    );
  }
  @Post("destinations/:id/credentials/revoke")
  @HttpCode(200)
  @RequirePermissions(
    "can_view_audit",
    "can_view_connectors",
    "can_export_audit",
    "can_edit_connectors",
  )
  @RequireRole("owner")
  @ZodResponse(siemDestinationSchema)
  revoke_credentials(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(siemDestinationParamsSchema))
    params: SiemDestinationParams,
    @Body(zodBody(siemOperationSchema))
    input: SiemOperation,
  ) {
    return this.safe(() =>
      this.siem.execute(user, "revoke_credentials", params.id, input),
    );
  }
  @Post("destinations/:id/test")
  @HttpCode(200)
  @RequirePermissions(
    "can_view_audit",
    "can_view_connectors",
    "can_export_audit",
    "can_edit_connectors",
  )
  @ZodResponse(siemTestResultSchema)
  test(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(siemDestinationParamsSchema))
    params: SiemDestinationParams,
    @Body(zodBody(siemOperationSchema))
    input: SiemOperation,
  ) {
    return this.safe(() => this.siem.execute(user, "test", params.id, input));
  }
  @Post("destinations/:id/enable")
  @HttpCode(200)
  @RequirePermissions(
    "can_view_audit",
    "can_view_connectors",
    "can_export_audit",
    "can_edit_connectors",
  )
  @ZodResponse(siemDestinationSchema)
  enable(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(siemDestinationParamsSchema))
    params: SiemDestinationParams,
    @Body(zodBody(siemOperationSchema))
    input: SiemOperation,
  ) {
    return this.safe(() => this.siem.execute(user, "enable", params.id, input));
  }
  @Post("destinations/:id/disable")
  @HttpCode(200)
  @RequirePermissions(
    "can_view_audit",
    "can_view_connectors",
    "can_export_audit",
    "can_edit_connectors",
  )
  @ZodResponse(siemDestinationSchema)
  disable(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(siemDestinationParamsSchema))
    params: SiemDestinationParams,
    @Body(zodBody(siemOperationSchema))
    input: SiemOperation,
  ) {
    return this.safe(() =>
      this.siem.execute(user, "disable", params.id, input),
    );
  }
  @Get("destinations/:id/deliveries")
  @RequirePermissions("can_view_audit", "can_view_connectors")
  @ZodResponse(siemDeliveryPageSchema)
  deliveries(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(siemDestinationParamsSchema))
    params: SiemDestinationParams,
    @Query(zodQuery(siemPageQuerySchema))
    input: SiemPageQuery,
  ) {
    return this.safe(() =>
      this.siem.execute(user, "deliveries", params.id, input),
    );
  }
  @Get("destinations/:id/deliveries/:deliveryId")
  @RequirePermissions("can_view_audit", "can_view_connectors")
  @ZodResponse(siemDeliveryDetailSchema)
  delivery(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(siemDeliveryParamsSchema))
    params: SiemDeliveryParams,
    @Query(zodQuery(siemReadQuerySchema))
    input: SiemReadQuery,
  ) {
    return this.safe(() =>
      this.siem.execute(user, "delivery", params.id, {
        ...input,
        deliveryId: params.deliveryId,
      }),
    );
  }
  @Post("destinations/:id/deliveries/:deliveryId/replay-preview")
  @HttpCode(200)
  @RequirePermissions(
    "can_view_audit",
    "can_view_connectors",
    "can_export_audit",
    "can_edit_connectors",
  )
  @ZodResponse(siemReplayPreviewSchema)
  replay_preview(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(siemDeliveryParamsSchema))
    params: SiemDeliveryParams,
    @Body(zodBody(siemOperationSchema))
    input: SiemOperation,
  ) {
    return this.safe(() =>
      this.siem.execute(user, "replay_preview", params.id, {
        ...input,
        deliveryId: params.deliveryId,
      }),
    );
  }
  @Post("destinations/:id/deliveries/:deliveryId/replay")
  @HttpCode(200)
  @RequirePermissions(
    "can_view_audit",
    "can_view_connectors",
    "can_export_audit",
    "can_edit_connectors",
  )
  @ZodResponse(siemDeliverySchema)
  replay(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(siemDeliveryParamsSchema))
    params: SiemDeliveryParams,
    @Body(zodBody(siemReplayInputSchema))
    input: SiemReplayInput,
  ) {
    return this.safe(() =>
      this.siem.execute(user, "replay", params.id, {
        ...input,
        deliveryId: params.deliveryId,
      }),
    );
  }
  private async safe(operation: () => Promise<unknown>) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof SiemForbiddenError)
        throw new ForbiddenException({
          message: "SIEM access denied",
          code: "forbidden",
        });
      if (error instanceof SiemNotFoundError)
        throw new NotFoundException({
          message: "Not found",
          code: "not_found",
        });
      if (error instanceof SiemConflictError)
        throw new ConflictException({
          message: "Configuration changed; refresh and retry",
          code: "conflict",
        });
      if (error instanceof SiemInputError)
        throw new BadRequestException({
          message: "Invalid SIEM request",
          code: "invalid_input",
        });
      if (error instanceof SiemUnavailableError)
        throw new ServiceUnavailableException({
          message: "SIEM unavailable",
          code: "unavailable",
        });
      throw error;
    }
  }
}
