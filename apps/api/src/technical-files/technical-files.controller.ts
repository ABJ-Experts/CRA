import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Delete,
  HttpException,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  addTechnicalFileSourceRequestSchema,
  createTechnicalFileRequestSchema,
  removeTechnicalFileSourceParamsSchema,
  removeTechnicalFileSourceRequestSchema,
  technicalFileProductParamsSchema,
  technicalFileWorkspaceResponseSchema,
  technicalFileSectionParamsSchema,
  technicalFileSectionResponseSchema,
  updateTechnicalFileSectionRequestSchema,
  type AddTechnicalFileSourceRequest,
  type CreateTechnicalFileRequest,
  type UpdateTechnicalFileSectionRequest,
} from "@repo/contracts/technical-files";

import {
  CurrentUser,
  RequirePermissions,
  type RequestUser,
} from "../auth/auth.types";
import { ZodResponse } from "../common/http/zod-response.interceptor";
import { zodBody, zodParams } from "../common/pipes/zod-validation.pipe";
import {
  TechnicalFileConflictError,
  TechnicalFileInvalidRequestError,
  TechnicalFileProductUnavailableError,
} from "./application/technical-file.port";
import { TechnicalFileUseCases } from "./application/technical-file-use-cases";

@Controller("products/:productId/technical-file")
export class TechnicalFilesController {
  private readonly logger = new Logger(TechnicalFilesController.name);

  constructor(private readonly technicalFiles: TechnicalFileUseCases) {}

  @Get()
  @RequirePermissions("can_view_technical_files")
  @ZodResponse(technicalFileWorkspaceResponseSchema)
  async get(
    @Param(zodParams(technicalFileProductParamsSchema))
    params: { productId: string },
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return this.require(
        await this.technicalFiles.get(organizationId(user), {
          actorId: user.id,
          ...params,
        }),
      );
    } catch (error) {
      this.logUnexpected(error);
      throw readFailure(error);
    }
  }

  private logUnexpected(error: unknown) {
    if (
      error instanceof HttpException ||
      error instanceof TechnicalFileProductUnavailableError ||
      error instanceof TechnicalFileInvalidRequestError
    ) {
      return;
    }
    this.logger.error(
      error instanceof Error ? error.message : "technical-file request failed",
    );
  }

  @Post()
  @RequirePermissions("can_edit_technical_files")
  @ZodResponse(technicalFileWorkspaceResponseSchema)
  async create(
    @Param(zodParams(technicalFileProductParamsSchema))
    params: { productId: string },
    @Body(zodBody(createTechnicalFileRequestSchema))
    input: CreateTechnicalFileRequest,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return this.require(
        await this.technicalFiles.create(organizationId(user), {
          actorId: user.id,
          ...params,
          ...input,
        }),
      );
    } catch (error) {
      throw mutationFailure(error);
    }
  }

  @Get("sections/:sectionKey")
  @RequirePermissions("can_view_technical_files")
  @ZodResponse(technicalFileSectionResponseSchema)
  async section(
    @Param(zodParams(technicalFileSectionParamsSchema))
    params: { productId: string; sectionKey: string },
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return this.requireSection(
        await this.technicalFiles.section(organizationId(user), {
          actorId: user.id,
          ...params,
        }),
      );
    } catch (error) {
      throw readFailure(error);
    }
  }

  @Patch("sections/:sectionKey")
  @RequirePermissions("can_edit_technical_files")
  @ZodResponse(technicalFileSectionResponseSchema)
  async updateSection(
    @Param(zodParams(technicalFileSectionParamsSchema))
    params: { productId: string; sectionKey: string },
    @Body(zodBody(updateTechnicalFileSectionRequestSchema))
    input: UpdateTechnicalFileSectionRequest,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return this.requireSection(
        await this.technicalFiles.updateSection(organizationId(user), {
          actorId: user.id,
          ...params,
          ...input,
        }),
      );
    } catch (error) {
      throw mutationFailure(error);
    }
  }

  @Post("sections/:sectionKey/sources")
  @RequirePermissions("can_edit_technical_files")
  @ZodResponse(technicalFileSectionResponseSchema)
  async addSource(
    @Param(zodParams(technicalFileSectionParamsSchema))
    params: { productId: string; sectionKey: string },
    @Body(zodBody(addTechnicalFileSourceRequestSchema))
    input: AddTechnicalFileSourceRequest,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return this.requireSection(
        await this.technicalFiles.addSource(organizationId(user), {
          actorId: user.id,
          ...params,
          ...input,
        }),
      );
    } catch (error) {
      throw mutationFailure(error);
    }
  }

  @Delete("sections/:sectionKey/sources/:sourceId")
  @RequirePermissions("can_edit_technical_files")
  @ZodResponse(technicalFileSectionResponseSchema)
  async removeSource(
    @Param(zodParams(removeTechnicalFileSourceParamsSchema))
    params: { productId: string; sectionKey: string; sourceId: string },
    @Body(zodBody(removeTechnicalFileSourceRequestSchema))
    input: { expectedVersion: number; idempotencyKey: string },
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return this.requireSection(
        await this.technicalFiles.removeSource(organizationId(user), {
          actorId: user.id,
          ...params,
          ...input,
        }),
      );
    } catch (error) {
      throw mutationFailure(error);
    }
  }

  private require<T>(value: T | null): T {
    if (value) return value;
    throw notFound();
  }

  private requireSection<T>(value: T | null): { section: T } {
    if (value) return { section: value };
    throw notFound();
  }
}

function organizationId(user: RequestUser): string {
  if (user.organizationId) return user.organizationId;
  throw notFound();
}

function notFound() {
  return new NotFoundException({
    code: "not_found",
    message: "The technical file is unavailable.",
  });
}

function mutationFailure(error: unknown): Error {
  if (error instanceof HttpException) return error;
  if (error instanceof TechnicalFileProductUnavailableError) return notFound();
  if (error instanceof TechnicalFileConflictError) {
    return new ConflictException({
      code: "stale_version",
      message: "This section changed. Reload before saving.",
      ...(error.section ? { currentSection: error.section } : {}),
    });
  }
  if (error instanceof TechnicalFileInvalidRequestError) {
    return new NotFoundException({
      code: "not_found",
      message: "The requested source is unavailable.",
    });
  }
  return new ServiceUnavailableException({
    code: "technical_file_unavailable",
    message: "The technical file is temporarily unavailable.",
  });
}

function readFailure(error: unknown): Error {
  if (error instanceof HttpException) return error;
  if (
    error instanceof TechnicalFileProductUnavailableError ||
    error instanceof TechnicalFileInvalidRequestError
  ) {
    return notFound();
  }
  return new ServiceUnavailableException({
    code: "technical_file_unavailable",
    message: "The technical file is temporarily unavailable.",
  });
}
