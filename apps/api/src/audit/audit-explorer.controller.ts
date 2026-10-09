import { pipeline } from "node:stream/promises";

import {
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
  UseFilters,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import {
  auditDetailParamsSchema,
  auditDetailSchema,
  auditDownloadGrantInputSchema,
  auditDownloadGrantSchema,
  auditExportInputSchema,
  auditExportJobSchema,
  auditExportParamsSchema,
  auditOperationQuerySchema,
  auditPageQuerySchema,
  auditPageSchema,
  auditSearchInputSchema,
  auditSnapshotParamsSchema,
  auditSnapshotSchema,
  auditVerificationInputSchema,
  auditVerificationResultSchema,
} from "@repo/contracts/audit/schemas";
import type {
  AuditDetail,
  AuditDetailParams,
  AuditDownloadGrant,
  AuditDownloadGrantInput,
  AuditExportInput,
  AuditExportJob,
  AuditExportParams,
  AuditOperationQuery,
  AuditPage,
  AuditPageQuery,
  AuditSearchInput,
  AuditSnapshot,
  AuditSnapshotParams,
  AuditVerificationInput,
  AuditVerificationResult,
} from "@repo/contracts/audit/types";

import { API_PREFIX } from "../auth/cookies.util";
import {
  CurrentUser,
  RequirePermissions,
  type RequestUser,
} from "../auth/auth.types";
import {
  NonJsonResponse,
  ZodResponse,
} from "../common/http/zod-response.interceptor";
import {
  zodBody,
  zodParams,
  zodQuery,
} from "../common/pipes/zod-validation.pipe";
import {
  AuditExplorerConflictError,
  AuditExplorerForbiddenError,
  AuditExplorerNotFoundError,
  AuditExplorerStaleError,
  AuditExplorerUnavailableError,
} from "./audit-explorer.errors";
import { AuditExplorerDeniedFilter } from "./audit-explorer-denied.filter";
import { AuditExplorerUseCases } from "./application/audit-explorer.use-cases";

export const AUDIT_EXPORT_GRANT_COOKIE = "cra_audit_export";

@UseFilters(AuditExplorerDeniedFilter)
@Controller("audit")
export class AuditExplorerController {
  constructor(
    private readonly audit: AuditExplorerUseCases,
    private readonly config: ConfigService,
  ) {}

  @Post("searches")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("can_view_audit")
  @ZodResponse(auditSnapshotSchema)
  async search(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(auditSearchInputSchema)) input: AuditSearchInput,
  ): Promise<AuditSnapshot> {
    return this.safe(() => this.audit.createSnapshot(user, input));
  }

  @Get("searches/:snapshotToken/events")
  @RequirePermissions("can_view_audit")
  @ZodResponse(auditPageSchema)
  async page(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(auditSnapshotParamsSchema)) params: AuditSnapshotParams,
    @Query(zodQuery(auditPageQuerySchema)) query: AuditPageQuery,
  ): Promise<AuditPage> {
    return this.safe(() => this.audit.page(user, params.snapshotToken, query));
  }

  @Get("searches/:snapshotToken/events/:eventId")
  @RequirePermissions("can_view_audit")
  @ZodResponse(auditDetailSchema)
  async detail(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(auditDetailParamsSchema)) params: AuditDetailParams,
    @Query(zodQuery(auditOperationQuerySchema)) query: AuditOperationQuery,
  ): Promise<AuditDetail> {
    return this.safe(() =>
      this.audit.detail(user, params.snapshotToken, params.eventId, query),
    );
  }

  @Post("searches/:snapshotToken/verify")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("can_view_audit")
  @ZodResponse(auditVerificationResultSchema)
  async verify(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(auditSnapshotParamsSchema)) params: AuditSnapshotParams,
    @Body(zodBody(auditVerificationInputSchema)) input: AuditVerificationInput,
  ): Promise<AuditVerificationResult> {
    return this.safe(() =>
      this.audit.verify(user, params.snapshotToken, input),
    );
  }

  @Post("exports")
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions("can_view_audit", "can_export_audit")
  @ZodResponse(auditExportJobSchema)
  async createExport(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(auditExportInputSchema)) input: AuditExportInput,
  ): Promise<AuditExportJob> {
    return this.safe(() => this.audit.createExport(user, input));
  }

  @Get("exports/:jobId")
  @RequirePermissions("can_view_audit", "can_export_audit")
  @ZodResponse(auditExportJobSchema)
  async exportStatus(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(auditExportParamsSchema)) params: AuditExportParams,
    @Query(zodQuery(auditOperationQuerySchema)) query: AuditOperationQuery,
  ): Promise<AuditExportJob> {
    return this.safe(() => this.audit.getExport(user, params.jobId, query));
  }

  @Post("exports/:jobId/download-grants")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("can_view_audit", "can_export_audit")
  @ZodResponse(auditDownloadGrantSchema)
  async downloadGrant(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(auditExportParamsSchema)) params: AuditExportParams,
    @Body(zodBody(auditDownloadGrantInputSchema))
    input: AuditDownloadGrantInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuditDownloadGrant> {
    const result = await this.safe(() =>
      this.audit.issueDownloadGrant(user, params.jobId, input),
    );
    response.cookie(AUDIT_EXPORT_GRANT_COOKIE, result.cookieValue, {
      httpOnly: true,
      secure: this.config.get<boolean>("COOKIE_SECURE") ?? false,
      sameSite: "strict",
      ...(this.config.get<string>("COOKIE_DOMAIN")
        ? { domain: this.config.get<string>("COOKIE_DOMAIN") }
        : {}),
      path: `/${API_PREFIX}/audit/exports/${params.jobId}/download`,
      maxAge: result.cookieMaxAge * 1000,
    });
    return result.grant;
  }

  @Get("exports/:jobId/download")
  @RequirePermissions("can_view_audit", "can_export_audit")
  @NonJsonResponse("stream")
  async download(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(auditExportParamsSchema)) params: AuditExportParams,
    @Query(zodQuery(auditDownloadGrantInputSchema))
    query: AuditDownloadGrantInput,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const cookies = request.cookies as unknown as
      Record<string, string | undefined> | undefined;
    const cookie = cookies?.[AUDIT_EXPORT_GRANT_COOKIE];
    const archive = await this.safe(() =>
      this.audit.download(user, params.jobId, query.requestId, cookie),
    );
    response.setHeader("Content-Type", "application/zip");
    response.setHeader("Content-Length", String(archive.contentLength));
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="cra-audit-export-${params.jobId}.zip"`,
    );
    response.setHeader(
      "Digest",
      `sha-256=${Buffer.from(archive.packageHash, "hex").toString("base64")}`,
    );
    response.setHeader("X-Artifact-SHA256", archive.packageHash);
    response.clearCookie(AUDIT_EXPORT_GRANT_COOKIE, {
      httpOnly: true,
      secure: this.config.get<boolean>("COOKIE_SECURE") ?? false,
      sameSite: "strict",
      ...(this.config.get<string>("COOKIE_DOMAIN")
        ? { domain: this.config.get<string>("COOKIE_DOMAIN") }
        : {}),
      path: `/${API_PREFIX}/audit/exports/${params.jobId}/download`,
    });
    try {
      await pipeline(archive.body, response);
    } finally {
      await archive.cleanup();
    }
  }

  private async safe<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (
        error instanceof AuditExplorerForbiddenError ||
        error instanceof AuditExplorerNotFoundError
      ) {
        throw new NotFoundException({
          message: "Not found",
          code: "not_found",
        });
      }
      if (
        error instanceof AuditExplorerStaleError ||
        error instanceof AuditExplorerConflictError
      ) {
        throw new ConflictException({
          message: "Snapshot is stale",
          code: "stale",
        });
      }
      if (error instanceof AuditExplorerUnavailableError) {
        throw new ServiceUnavailableException({
          message: "Audit explorer is unavailable",
          code: "audit_unavailable",
        });
      }
      throw error;
    }
  }
}
