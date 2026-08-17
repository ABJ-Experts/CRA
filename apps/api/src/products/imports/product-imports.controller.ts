import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  productImportCancelInputSchema,
  productImportCommitInputSchema,
  productImportListQuerySchema,
  productImportMaxBytes,
  productImportParamsSchema,
  productImportReportLinkResponseSchema,
  productImportResponseSchema,
  productImportRowsQuerySchema,
  productImportRowsResponseSchema,
  productImportsResponseSchema,
  productImportTemplateResponseSchema,
  productImportUploadFieldsSchema,
  type ProductImportCancelInput,
  type ProductImportCommitInput,
  type ProductImportListQuery,
  type ProductImportParams,
  type ProductImportRowsQuery,
  type ProductImportUploadFields,
} from "@repo/contracts/products";
import { memoryStorage } from "multer";

import {
  CurrentUser,
  RequirePermissions,
  type RequestUser,
} from "../../auth/auth.types";
import { ZodResponse } from "../../common/http/zod-response.interceptor";
import {
  zodBody,
  zodParams,
  zodQuery,
} from "../../common/pipes/zod-validation.pipe";
import { ProductImportsService } from "./product-imports.service";

const acceptedCsvContentTypes = new Set([
  "text/csv",
  "text/plain",
  "application/csv",
  "application/octet-stream",
]);

@Controller("products/imports")
export class ProductImportsController {
  constructor(private readonly imports: ProductImportsService) {}

  @RequirePermissions("can_view_products")
  @Get("template")
  @ZodResponse(productImportTemplateResponseSchema)
  template() {
    return this.imports.template();
  }

  @RequirePermissions("can_view_products")
  @Get()
  @ZodResponse(productImportsResponseSchema)
  list(
    @Query(zodQuery(productImportListQuerySchema))
    query: ProductImportListQuery,
    @CurrentUser() user: RequestUser,
  ) {
    return this.imports.list({
      organizationId: this.organizationId(user),
      actorId: user.id,
      query,
    });
  }

  @RequirePermissions("can_create_products", "can_edit_products")
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: {
        fileSize: productImportMaxBytes,
        files: 1,
        fields: 1,
        fieldSize: 128,
      },
    }),
  )
  @ZodResponse(productImportResponseSchema)
  dryRun(
    @Body(zodBody(productImportUploadFieldsSchema))
    fields: ProductImportUploadFields,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    if (!file || file.buffer.length === 0) {
      throw new BadRequestException({
        message: "A CSV file is required.",
        code: "invalid_request",
      });
    }
    if (!acceptedCsvContentTypes.has(file.mimetype.toLowerCase())) {
      throw new BadRequestException({
        message: "The uploaded file must be CSV.",
        code: "invalid_request",
      });
    }
    return this.imports.dryRun({
      organizationId: this.organizationId(user),
      actorId: user.id,
      fields,
      originalFilename: file.originalname,
      bytes: Buffer.from(file.buffer),
    });
  }

  @RequirePermissions("can_view_products")
  @Get(":importId")
  @ZodResponse(productImportResponseSchema)
  get(
    @Param(zodParams(productImportParamsSchema)) params: ProductImportParams,
    @CurrentUser() user: RequestUser,
  ) {
    return this.imports.get({
      organizationId: this.organizationId(user),
      actorId: user.id,
      importId: params.importId,
    });
  }

  @RequirePermissions("can_view_products")
  @Get(":importId/rows")
  @ZodResponse(productImportRowsResponseSchema)
  rows(
    @Param(zodParams(productImportParamsSchema)) params: ProductImportParams,
    @Query(zodQuery(productImportRowsQuerySchema))
    query: ProductImportRowsQuery,
    @CurrentUser() user: RequestUser,
  ) {
    return this.imports.rows({
      organizationId: this.organizationId(user),
      actorId: user.id,
      importId: params.importId,
      query,
    });
  }

  @RequirePermissions("can_create_products", "can_edit_products")
  @Post(":importId/commit")
  @ZodResponse(productImportResponseSchema)
  commit(
    @Param(zodParams(productImportParamsSchema)) params: ProductImportParams,
    @Body(zodBody(productImportCommitInputSchema))
    input: ProductImportCommitInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.imports.commit({
      organizationId: this.organizationId(user),
      actorId: user.id,
      importId: params.importId,
      input,
    });
  }

  @RequirePermissions("can_create_products", "can_edit_products")
  @Post(":importId/cancel")
  @ZodResponse(productImportResponseSchema)
  cancel(
    @Param(zodParams(productImportParamsSchema)) params: ProductImportParams,
    @Body(zodBody(productImportCancelInputSchema))
    input: ProductImportCancelInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.imports.cancel({
      organizationId: this.organizationId(user),
      actorId: user.id,
      importId: params.importId,
      reason: input.reason ?? null,
    });
  }

  @RequirePermissions("can_export_products")
  @Get(":importId/report")
  @ZodResponse(productImportReportLinkResponseSchema)
  report(
    @Param(zodParams(productImportParamsSchema)) params: ProductImportParams,
    @CurrentUser() user: RequestUser,
  ) {
    return this.imports.report({
      organizationId: this.organizationId(user),
      actorId: user.id,
      importId: params.importId,
    });
  }

  private organizationId(user: RequestUser): string {
    if (user.organizationId) return user.organizationId;
    throw new NotFoundException({
      message: "Product import request could not be completed.",
      code: "not_found",
    });
  }
}
