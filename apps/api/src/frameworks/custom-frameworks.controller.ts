import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import {
  customFrameworkCommandInputSchema,
  customFrameworkCommandResponseSchema,
  customFrameworkDetailResponseSchema,
  customFrameworkExportQuerySchema,
  customFrameworkImportSchema,
  customFrameworkListQuerySchema,
  customFrameworkListResponseSchema,
  customFrameworkParamsSchema,
  customFrameworkValidationInputSchema,
  customFrameworkValidationResponseSchema,
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
  CustomFrameworkBlockedError,
  CustomFrameworkConflictError,
  CustomFrameworkForbiddenError,
  CustomFrameworkInvalidError,
  CustomFrameworkNotFoundError,
  CustomFrameworkUseCases,
} from "./application/custom-framework-use-cases";

type Command = z.output<typeof customFrameworkCommandInputSchema>;
type Params = z.output<typeof customFrameworkParamsSchema>;
type ListQuery = z.output<typeof customFrameworkListQuerySchema>;
type ExportQuery = z.output<typeof customFrameworkExportQuerySchema>;

function scope(user: RequestUser): string {
  if (user.organizationId) return user.organizationId;
  throw new ForbiddenException({
    message: "Select an organization first.",
    code: "no_organization",
  });
}

function convert(error: unknown): never {
  if (error instanceof CustomFrameworkForbiddenError) {
    throw new ForbiddenException({
      message: "Framework access denied.",
      code: "forbidden",
    });
  }
  if (error instanceof CustomFrameworkNotFoundError) {
    throw new NotFoundException({
      message: "Customer framework not found.",
      code: "framework_not_found",
    });
  }
  if (error instanceof CustomFrameworkConflictError) {
    throw new ConflictException({
      message: "Framework changed. Reload and review your edits.",
      code: "framework_conflict",
    });
  }
  if (error instanceof CustomFrameworkBlockedError) {
    throw new ConflictException({
      message: "This framework is archived.",
      code: "framework_archived",
    });
  }
  if (error instanceof CustomFrameworkInvalidError) {
    throw new BadRequestException({
      message: "Invalid framework content.",
      code: "validation_failed",
    });
  }
  throw error;
}

@Controller("frameworks/custom")
export class CustomFrameworksController {
  constructor(private readonly custom: CustomFrameworkUseCases) {}

  @Get()
  @RequirePermissions("can_view_frameworks")
  @ZodResponse(customFrameworkListResponseSchema)
  async list(
    @Query(zodQuery(customFrameworkListQuerySchema)) query: ListQuery,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return await this.custom.list(
        scope(user),
        user.id,
        query.limit,
        query.offset,
      );
    } catch (error) {
      convert(error);
    }
  }

  @Get(":draftId")
  @RequirePermissions("can_view_frameworks")
  @ZodResponse(customFrameworkDetailResponseSchema)
  async detail(
    @Param(zodParams(customFrameworkParamsSchema)) params: Params,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return await this.custom.detail(scope(user), user.id, params.draftId);
    } catch (error) {
      convert(error);
    }
  }

  @Get(":draftId/export")
  @RequirePermissions("can_view_frameworks")
  @ZodResponse(customFrameworkImportSchema)
  async export(
    @Param(zodParams(customFrameworkParamsSchema)) params: Params,
    @Query(zodQuery(customFrameworkExportQuerySchema)) query: ExportQuery,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return await this.custom.export(
        scope(user),
        user.id,
        params.draftId,
        query.versionKey,
      );
    } catch (error) {
      convert(error);
    }
  }

  @Post("validate")
  @RequirePermissions("can_manage_frameworks")
  @ZodResponse(customFrameworkValidationResponseSchema)
  async validate(
    @Body(zodBody(customFrameworkValidationInputSchema)) body: unknown,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return await this.custom.validateImport(scope(user), user.id, body);
    } catch (error) {
      convert(error);
    }
  }

  @Post()
  @RequirePermissions("can_manage_frameworks")
  @ZodResponse(customFrameworkCommandResponseSchema)
  async create(
    @Body(zodBody(customFrameworkCommandInputSchema)) body: Command,
    @CurrentUser() user: RequestUser,
  ) {
    if (body.action !== "create_draft") {
      throw new BadRequestException({
        message: "Create a draft first.",
        code: "validation_failed",
      });
    }
    try {
      return await this.custom.command(scope(user), user.id, null, body);
    } catch (error) {
      convert(error);
    }
  }

  @Put(":draftId")
  @RequirePermissions("can_manage_frameworks")
  @ZodResponse(customFrameworkCommandResponseSchema)
  async update(
    @Param(zodParams(customFrameworkParamsSchema)) params: Params,
    @Body(zodBody(customFrameworkCommandInputSchema)) body: Command,
    @CurrentUser() user: RequestUser,
  ) {
    if (body.action === "create_draft") {
      throw new BadRequestException({
        message: "Draft already exists.",
        code: "validation_failed",
      });
    }
    try {
      return await this.custom.command(
        scope(user),
        user.id,
        params.draftId,
        body,
      );
    } catch (error) {
      convert(error);
    }
  }
}
