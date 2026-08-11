import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import {
  createLegalEntityInputSchema,
  legalEntitiesResponseSchema,
  legalEntityParamsSchema,
  legalEntityResponseSchema,
  legalEntityVersionInputSchema,
  updateLegalEntityInputSchema,
  type CreateLegalEntityInput,
  type LegalEntityParams,
  type LegalEntityVersionInput,
  type UpdateLegalEntityInput,
} from "@repo/contracts/organizations";

import {
  CurrentUser,
  RequirePermissions,
  RequireRole,
  type RequestUser,
} from "../../auth/auth.types";
import { ZodResponse } from "../../common/http/zod-response.interceptor";
import { zodBody, zodParams } from "../../common/pipes/zod-validation.pipe";
import { LegalEntitiesService } from "./legal-entities.service";

@Controller("organizations/current/legal-entities")
export class LegalEntitiesController {
  constructor(private readonly legalEntities: LegalEntitiesService) {}

  @RequirePermissions("can_view_organization")
  @Get()
  @ZodResponse(legalEntitiesResponseSchema)
  list(@CurrentUser() user: RequestUser) {
    return this.legalEntities.list(this.organizationId(user), user.id);
  }

  @RequirePermissions("can_view_organization")
  @Get(":entityId")
  @ZodResponse(legalEntityResponseSchema)
  get(
    @Param(zodParams(legalEntityParamsSchema)) params: LegalEntityParams,
    @CurrentUser() user: RequestUser,
  ) {
    return this.legalEntities.get({
      organizationId: this.organizationId(user),
      actorId: user.id,
      legalEntityId: params.legalEntityId,
    });
  }

  @RequireRole("owner")
  @RequirePermissions("can_edit_organization")
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ZodResponse(legalEntityResponseSchema)
  create(
    @Body(zodBody(createLegalEntityInputSchema)) input: CreateLegalEntityInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.legalEntities.create({
      organizationId: this.organizationId(user),
      actorId: user.id,
      input,
    });
  }

  @RequireRole("owner")
  @RequirePermissions("can_edit_organization")
  @Patch(":entityId")
  @ZodResponse(legalEntityResponseSchema)
  update(
    @Param(zodParams(legalEntityParamsSchema)) params: LegalEntityParams,
    @Body(zodBody(updateLegalEntityInputSchema)) input: UpdateLegalEntityInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.legalEntities.update({
      organizationId: this.organizationId(user),
      actorId: user.id,
      legalEntityId: params.legalEntityId,
      input,
    });
  }

  @RequireRole("owner")
  @RequirePermissions("can_edit_organization")
  @Post(":entityId/activate")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(legalEntityResponseSchema)
  activate(
    @Param(zodParams(legalEntityParamsSchema)) params: LegalEntityParams,
    @Body(zodBody(legalEntityVersionInputSchema))
    input: LegalEntityVersionInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.transition(
      params.legalEntityId,
      input.expectedVersion,
      "active",
      user,
    );
  }

  @RequireRole("owner")
  @RequirePermissions("can_edit_organization")
  @Post(":entityId/deactivate")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(legalEntityResponseSchema)
  deactivate(
    @Param(zodParams(legalEntityParamsSchema)) params: LegalEntityParams,
    @Body(zodBody(legalEntityVersionInputSchema))
    input: LegalEntityVersionInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.transition(
      params.legalEntityId,
      input.expectedVersion,
      "inactive",
      user,
    );
  }

  @RequireRole("owner")
  @RequirePermissions("can_edit_organization")
  @Post(":entityId/delete")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(legalEntityResponseSchema)
  softDelete(
    @Param(zodParams(legalEntityParamsSchema)) params: LegalEntityParams,
    @Body(zodBody(legalEntityVersionInputSchema))
    input: LegalEntityVersionInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.transition(
      params.legalEntityId,
      input.expectedVersion,
      "deleted",
      user,
    );
  }

  private transition(
    legalEntityId: string,
    expectedVersion: number,
    status: "active" | "inactive" | "deleted",
    user: RequestUser,
  ) {
    return this.legalEntities.transition({
      organizationId: this.organizationId(user),
      actorId: user.id,
      legalEntityId,
      expectedVersion,
      status,
    });
  }

  private organizationId(user: RequestUser): string {
    if (user.organizationId) return user.organizationId;
    throw new NotFoundException({
      message: "Organization administration request could not be completed.",
      code: "not_found",
    });
  }
}
