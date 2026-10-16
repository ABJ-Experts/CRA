import { pipeline } from "node:stream/promises";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import {
  createExportJobSchema,
  createReadinessExportSchema,
  exportJobResponseSchema,
  exportManifestResponseSchema,
  exportJobListResponseSchema,
  exportJobParamsSchema,
  exportMutationSchema,
  exportJobListQuerySchema,
  exportDownloadGrantInputSchema,
  exportDownloadGrantResponseSchema,
  exportDownloadParamsSchema,
  exportReadinessProductParamsSchema,
} from "@repo/contracts/exports";
import type { z } from "zod";
import { API_PREFIX } from "../auth/cookies.util";
import { CurrentUser, SelfScoped, type RequestUser } from "../auth/auth.types";
import {
  NonJsonResponse,
  ZodResponse,
} from "../common/http/zod-response.interceptor";
import {
  zodBody,
  zodParams,
  zodQuery,
} from "../common/pipes/zod-validation.pipe";
import { ExportsUseCases } from "./application/exports.use-cases";
import {
  ExportAccessDeniedError,
  ExportConflictError,
  ExportInvalidRequestError,
  ExportUnavailableError,
} from "./domain/export.errors";

const scopeReason =
  "Only requester-owned exports with fresh source, product, row and field authorization are available; application and transaction RPCs enforce source permissions.";
export const EXPORT_GRANT_COOKIE = "cra_list_export";
export async function exportHttp<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ExportAccessDeniedError)
      throw new NotFoundException({
        code: "not_found",
        message: "Export is not available",
      });
    if (error instanceof ExportConflictError)
      throw new ConflictException({
        code: "export_conflict",
        message: "Export state changed; reload and try again",
      });
    if (error instanceof ExportInvalidRequestError)
      throw new BadRequestException({
        code: "export_invalid",
        message: "Narrow the filters or choose a supported export format",
      });
    if (error instanceof ExportUnavailableError)
      throw new ServiceUnavailableException({
        code: "export_unavailable",
        message: "Export service is temporarily unavailable",
      });
    throw error;
  }
}
@Controller("exports")
export class ExportsController {
  constructor(
    private readonly exports: ExportsUseCases,
    private readonly config: ConfigService,
  ) {}
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @SelfScoped(scopeReason)
  @ZodResponse(exportJobResponseSchema)
  async create(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(createExportJobSchema))
    input: z.output<typeof createExportJobSchema>,
  ) {
    return { data: await exportHttp(() => this.exports.create(user, input)) };
  }
  @Get()
  @SelfScoped(scopeReason)
  @ZodResponse(exportJobListResponseSchema)
  list(
    @CurrentUser() user: RequestUser,
    @Query(zodQuery(exportJobListQuerySchema))
    query: z.output<typeof exportJobListQuerySchema>,
  ) {
    return exportHttp(() => this.exports.list(user, query));
  }
  @Get(":jobId")
  @SelfScoped(scopeReason)
  @ZodResponse(exportJobResponseSchema)
  async get(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(exportJobParamsSchema))
    params: z.output<typeof exportJobParamsSchema>,
  ) {
    return {
      data: await exportHttp(() => this.exports.get(user, params.jobId)),
    };
  }
  @Get(":jobId/manifest")
  @SelfScoped(scopeReason)
  @ZodResponse(exportManifestResponseSchema)
  async manifest(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(exportJobParamsSchema))
    params: z.output<typeof exportJobParamsSchema>,
  ) {
    return {
      data: await exportHttp(() => this.exports.manifest(user, params.jobId)),
    };
  }
  @Post(":jobId/cancel")
  @HttpCode(HttpStatus.OK)
  @SelfScoped(scopeReason)
  @ZodResponse(exportJobResponseSchema)
  async cancel(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(exportJobParamsSchema))
    params: z.output<typeof exportJobParamsSchema>,
    @Body(zodBody(exportMutationSchema))
    input: z.output<typeof exportMutationSchema>,
  ) {
    return {
      data: await exportHttp(() =>
        this.exports.mutate(
          user,
          params.jobId,
          input.expectedVersion,
          input.idempotencyKey,
          "cancel",
        ),
      ),
    };
  }
  @Post(":jobId/retry")
  @HttpCode(HttpStatus.ACCEPTED)
  @SelfScoped(scopeReason)
  @ZodResponse(exportJobResponseSchema)
  async retry(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(exportJobParamsSchema))
    params: z.output<typeof exportJobParamsSchema>,
    @Body(zodBody(exportMutationSchema))
    input: z.output<typeof exportMutationSchema>,
  ) {
    return {
      data: await exportHttp(() =>
        this.exports.mutate(
          user,
          params.jobId,
          input.expectedVersion,
          input.idempotencyKey,
          "retry",
        ),
      ),
    };
  }
  @Post(":jobId/download-grants")
  @HttpCode(HttpStatus.OK)
  @SelfScoped(scopeReason)
  @ZodResponse(exportDownloadGrantResponseSchema)
  async grant(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(exportJobParamsSchema))
    params: z.output<typeof exportJobParamsSchema>,
    @Body(zodBody(exportDownloadGrantInputSchema))
    input: z.output<typeof exportDownloadGrantInputSchema>,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await exportHttp(() =>
      this.exports.grant(user, params.jobId, input.artifactId),
    );
    response.cookie(EXPORT_GRANT_COOKIE, result.cookieValue, {
      ...this.cookieOptions(params.jobId, result.grant.grantId),
      maxAge: 300_000,
    });
    return { data: result.grant };
  }
  @Get(":jobId/download/:grantId")
  @SelfScoped(scopeReason)
  @NonJsonResponse("stream")
  async download(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(exportDownloadParamsSchema))
    params: z.output<typeof exportDownloadParamsSchema>,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const cookies = request.cookies as
      Record<string, string | undefined> | undefined;
    const artifact = await exportHttp(() =>
      this.exports.download(
        user,
        params.jobId,
        params.grantId,
        cookies?.[EXPORT_GRANT_COOKIE],
      ),
    );
    response.clearCookie(
      EXPORT_GRANT_COOKIE,
      this.cookieOptions(params.jobId, params.grantId),
    );
    response.setHeader("Content-Type", artifact.mediaType);
    response.setHeader("Content-Length", String(artifact.byteLength));
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${artifact.name}"`,
    );
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Artifact-SHA256", artifact.sha256);
    try {
      await pipeline(artifact.body, response);
    } finally {
      await artifact.cleanup();
    }
  }
  private cookieOptions(jobId: string, grantId: string) {
    return {
      httpOnly: true,
      secure: this.config.get<boolean>("COOKIE_SECURE") ?? false,
      sameSite: "strict" as const,
      path: `/${API_PREFIX}/exports/${jobId}/download/${grantId}`,
      ...(this.config.get<string>("COOKIE_DOMAIN")
        ? { domain: this.config.get<string>("COOKIE_DOMAIN") }
        : {}),
    };
  }
}
@Controller("products/:productId/audit-readiness/exports")
export class ProductReadinessExportsController {
  constructor(private readonly exports: ExportsUseCases) {}
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @SelfScoped(scopeReason)
  @ZodResponse(exportJobResponseSchema)
  async create(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(exportReadinessProductParamsSchema))
    params: z.output<typeof exportReadinessProductParamsSchema>,
    @Body(zodBody(createReadinessExportSchema))
    input: z.output<typeof createReadinessExportSchema>,
  ) {
    if (params.productId !== input.productId)
      throw new BadRequestException({
        code: "export_invalid",
        message: "Product scope does not match",
      });
    return {
      data: await exportHttp(() => this.exports.createReadiness(user, input)),
    };
  }
}
