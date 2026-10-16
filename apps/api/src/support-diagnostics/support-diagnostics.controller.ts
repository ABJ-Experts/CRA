import { pipeline } from "node:stream/promises";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  HttpCode,
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
  diagnosticPreviewInputSchema,
  diagnosticPreviewSchema,
  diagnosticCreateSchema,
  diagnosticMutationSchema,
  diagnosticCleanupInputSchema,
  diagnosticJobParamsSchema,
  diagnosticDownloadParamsSchema,
  diagnosticListQuerySchema,
  diagnosticContentQuerySchema,
  diagnosticJobSchema,
  diagnosticListSchema,
  diagnosticContentSchema,
  diagnosticGrantSchema,
  diagnosticCleanupReviewSchema,
} from "@repo/contracts/support-diagnostics/schemas";
import type {
  SupportDiagnosticSelection,
  SupportDiagnosticCreate,
  SupportDiagnosticMutation,
  SupportDiagnosticCleanupInput,
  SupportDiagnosticJobParams,
  SupportDiagnosticDownloadParams,
  SupportDiagnosticListQuery,
  SupportDiagnosticContentQuery,
} from "@repo/contracts/support-diagnostics/types";
import {
  CurrentUser,
  RequirePermissions,
  RequireRole,
  type RequestUser,
} from "../auth/auth.types";
import { API_PREFIX } from "../auth/cookies.util";
import {
  ZodResponse,
  NonJsonResponse,
} from "../common/http/zod-response.interceptor";
import {
  zodBody,
  zodParams,
  zodQuery,
} from "../common/pipes/zod-validation.pipe";
import { SupportDiagnosticsUseCases } from "./application/support-diagnostics.use-cases";
import {
  DiagnosticDeniedError,
  DiagnosticConflictError,
  DiagnosticInvalidError,
  DiagnosticUnavailableError,
} from "./application/diagnostic-repository.port";
export const DIAGNOSTIC_GRANT_COOKIE = "cra_support_diagnostic";
export async function diagnosticHttp<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof DiagnosticDeniedError)
      throw new NotFoundException({
        code: "not_found",
        message: "Diagnostic is not available",
      });
    if (error instanceof DiagnosticConflictError)
      throw new ConflictException({
        code: "diagnostic_conflict",
        message: "Diagnostic state changed; reload and try again",
      });
    if (error instanceof DiagnosticInvalidError)
      throw new BadRequestException({
        code: "diagnostic_invalid",
        message: "Diagnostic request is not valid",
      });
    if (error instanceof DiagnosticUnavailableError)
      throw new ServiceUnavailableException({
        code: "diagnostic_unavailable",
        message: "Diagnostic service is temporarily unavailable",
      });
    throw error;
  }
}
@Controller("system/diagnostics")
export class SupportDiagnosticsController {
  constructor(
    private readonly diagnostics: SupportDiagnosticsUseCases,
    private readonly config: ConfigService,
  ) {}
  @Post("preview")
  @HttpCode(200)
  @RequireRole("admin")
  @RequirePermissions("can_export_system_health")
  @Header("Cache-Control", "private, no-store")
  @ZodResponse(diagnosticPreviewSchema)
  preview(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(diagnosticPreviewInputSchema))
    input: SupportDiagnosticSelection,
  ) {
    return diagnosticHttp(() => this.diagnostics.preview(user, input));
  }
  @Post("bundles")
  @HttpCode(202)
  @RequireRole("admin")
  @RequirePermissions("can_export_system_health")
  @Header("Cache-Control", "private, no-store")
  @ZodResponse(diagnosticJobSchema)
  create(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(diagnosticCreateSchema)) input: SupportDiagnosticCreate,
  ) {
    return diagnosticHttp(() => this.diagnostics.create(user, input));
  }
  @Get("bundles")
  @RequireRole("admin")
  @RequirePermissions("can_export_system_health")
  @Header("Cache-Control", "private, no-store")
  @ZodResponse(diagnosticListSchema)
  list(
    @CurrentUser() user: RequestUser,
    @Query(zodQuery(diagnosticListQuerySchema))
    query: SupportDiagnosticListQuery,
  ) {
    return diagnosticHttp(() => this.diagnostics.list(user, query));
  }
  @Get("bundles/:jobId")
  @RequireRole("admin")
  @RequirePermissions("can_export_system_health")
  @Header("Cache-Control", "private, no-store")
  @ZodResponse(diagnosticJobSchema)
  get(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(diagnosticJobParamsSchema))
    params: SupportDiagnosticJobParams,
  ) {
    return diagnosticHttp(() => this.diagnostics.get(user, params.jobId));
  }
  @Get("bundles/:jobId/content")
  @RequireRole("admin")
  @RequirePermissions("can_export_system_health")
  @Header("Cache-Control", "private, no-store")
  @ZodResponse(diagnosticContentSchema)
  content(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(diagnosticJobParamsSchema))
    params: SupportDiagnosticJobParams,
    @Query(zodQuery(diagnosticContentQuerySchema))
    query: SupportDiagnosticContentQuery,
  ) {
    return diagnosticHttp(() =>
      this.diagnostics.content(user, params.jobId, query),
    );
  }
  @Post("bundles/:jobId/cancel")
  @HttpCode(200)
  @RequireRole("admin")
  @RequirePermissions("can_export_system_health")
  @Header("Cache-Control", "private, no-store")
  @ZodResponse(diagnosticJobSchema)
  cancel(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(diagnosticJobParamsSchema))
    params: SupportDiagnosticJobParams,
    @Body(zodBody(diagnosticMutationSchema)) input: SupportDiagnosticMutation,
  ) {
    return diagnosticHttp(() =>
      this.diagnostics.cancel(user, params.jobId, input),
    );
  }
  @Post("bundles/:jobId/cleanup-review")
  @HttpCode(200)
  @RequireRole("admin")
  @RequirePermissions("can_export_system_health")
  @Header("Cache-Control", "private, no-store")
  @ZodResponse(diagnosticCleanupReviewSchema)
  cleanupReview(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(diagnosticJobParamsSchema))
    params: SupportDiagnosticJobParams,
  ) {
    return diagnosticHttp(() =>
      this.diagnostics.cleanupReview(user, params.jobId),
    );
  }
  @Post("bundles/:jobId/cleanup")
  @HttpCode(202)
  @RequireRole("admin")
  @RequirePermissions("can_export_system_health")
  @Header("Cache-Control", "private, no-store")
  @ZodResponse(diagnosticJobSchema)
  cleanup(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(diagnosticJobParamsSchema))
    params: SupportDiagnosticJobParams,
    @Body(zodBody(diagnosticCleanupInputSchema))
    input: SupportDiagnosticCleanupInput,
  ) {
    return diagnosticHttp(() =>
      this.diagnostics.cleanup(user, params.jobId, input),
    );
  }
  @Post("bundles/:jobId/download-grants")
  @HttpCode(200)
  @RequireRole("admin")
  @RequirePermissions("can_export_system_health")
  @Header("Cache-Control", "private, no-store")
  @ZodResponse(diagnosticGrantSchema)
  async grant(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(diagnosticJobParamsSchema))
    params: SupportDiagnosticJobParams,
    @Body(zodBody(diagnosticMutationSchema)) input: SupportDiagnosticMutation,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await diagnosticHttp(() =>
      this.diagnostics.grant(user, params.jobId, input),
    );
    response.cookie(DIAGNOSTIC_GRANT_COOKIE, result.cookieValue, {
      ...this.cookieOptions(params.jobId, result.grant.grantId),
      maxAge: 60_000,
    });
    return result.grant;
  }
  @Get("bundles/:jobId/download/:grantId")
  @RequireRole("admin")
  @RequirePermissions("can_export_system_health")
  @NonJsonResponse("stream")
  async download(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(diagnosticDownloadParamsSchema))
    params: SupportDiagnosticDownloadParams,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const raw = cookies?.[DIAGNOSTIC_GRANT_COOKIE];
    response.clearCookie(
      DIAGNOSTIC_GRANT_COOKIE,
      this.cookieOptions(params.jobId, params.grantId),
    );
    const artifact = await diagnosticHttp(() =>
      this.diagnostics.download(
        user,
        params.jobId,
        params.grantId,
        typeof raw === "string" ? raw : undefined,
      ),
    );
    response.setHeader("Content-Type", "application/zip");
    response.setHeader("Content-Length", String(artifact.byteSize));
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${artifact.fileName}"`,
    );
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Artifact-SHA256", artifact.sha256);
    await pipeline(artifact.body, response);
  }
  private cookieOptions(jobId: string, grantId: string) {
    return {
      httpOnly: true,
      secure: this.config.get<boolean>("COOKIE_SECURE") ?? false,
      sameSite: "strict" as const,
      path: `/${API_PREFIX}/system/diagnostics/bundles/${jobId}/download/${grantId}`,
      ...(this.config.get<string>("COOKIE_DOMAIN")
        ? { domain: this.config.get<string>("COOKIE_DOMAIN") }
        : {}),
    };
  }
}
