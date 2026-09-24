import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Put,
  Query,
} from "@nestjs/common";
import {
  frameworkCatalogResponseSchema,
  frameworkTreeParamsSchema,
  frameworkTreeQuerySchema,
  frameworkTreeResponseSchema,
  frameworkSelectionParamsSchema,
  frameworkSelectionResponseSchema,
  selectFrameworkInputSchema,
} from "@repo/contracts/frameworks";
import type { z } from "zod";

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
  FrameworkConflictError,
  FrameworkForbiddenError,
  FrameworkInvalidRequestError,
  FrameworkUseCases,
} from "./application/framework-use-cases";

type TreeParams = z.output<typeof frameworkTreeParamsSchema>;
type TreeQuery = z.output<typeof frameworkTreeQuerySchema>;
type SelectionParams = z.output<typeof frameworkSelectionParamsSchema>;
type SelectInput = z.output<typeof selectFrameworkInputSchema>;

function organizationId(user: RequestUser): string {
  if (user.organizationId) return user.organizationId;
  throw new ForbiddenException({
    message: "Select an organization first.",
    code: "no_organization",
  });
}

@Controller("frameworks")
export class FrameworksController {
  constructor(private readonly frameworks: FrameworkUseCases) {}

  @Get()
  @RequirePermissions("can_view_frameworks")
  @ZodResponse(frameworkCatalogResponseSchema)
  async catalog(@CurrentUser() user: RequestUser) {
    try {
      return await this.frameworks.catalog(organizationId(user), user.id);
    } catch (error) {
      if (error instanceof FrameworkForbiddenError) {
        throw new ForbiddenException({
          message: "You cannot view this organization’s frameworks.",
          code: "forbidden",
        });
      }
      throw error;
    }
  }

  @Get(":packKey/versions/:versionKey/tree")
  @RequirePermissions("can_view_frameworks")
  @ZodResponse(frameworkTreeResponseSchema)
  async tree(
    @Param(zodParams(frameworkTreeParamsSchema)) params: TreeParams,
    @Query(zodQuery(frameworkTreeQuerySchema)) query: TreeQuery,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const result = await this.frameworks.tree(organizationId(user), {
        actorId: user.id,
        ...params,
        ...query,
      });
      if (result) return result;
      throw new NotFoundException({
        message: "Framework version not found.",
        code: "framework_version_not_found",
      });
    } catch (error) {
      if (error instanceof FrameworkInvalidRequestError) {
        throw new BadRequestException({
          message: "Invalid framework cursor.",
          code: "validation_failed",
        });
      }
      if (error instanceof FrameworkForbiddenError) {
        throw new ForbiddenException({
          message: "You cannot view this organization’s frameworks.",
          code: "forbidden",
        });
      }
      throw error;
    }
  }

  @Put(":packKey/selection")
  @RequirePermissions("can_view_frameworks", "can_manage_frameworks")
  @ZodResponse(frameworkSelectionResponseSchema)
  async select(
    @Param(zodParams(frameworkSelectionParamsSchema)) params: SelectionParams,
    @Body(zodBody(selectFrameworkInputSchema)) body: SelectInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return await this.frameworks.select(organizationId(user), {
        actorId: user.id,
        packKey: params.packKey,
        ...body,
      });
    } catch (error) {
      if (error instanceof FrameworkConflictError) {
        throw new ConflictException({
          message: "The selected framework changed. Reload and try again.",
          code: "framework_selection_conflict",
        });
      }
      if (error instanceof FrameworkForbiddenError) {
        throw new ForbiddenException({
          message: "You cannot change framework selections.",
          code: "forbidden",
        });
      }
      if (error instanceof FrameworkInvalidRequestError) {
        throw new BadRequestException({
          message: "Select an available framework version.",
          code: "validation_failed",
        });
      }
      throw error;
    }
  }
}
