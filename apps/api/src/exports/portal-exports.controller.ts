import { pipeline } from "node:stream/promises";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import {
  createExportJobSchema,
  exportJobResponseSchema,
  exportManifestResponseSchema,
  exportJobListResponseSchema,
  exportJobParamsSchema,
  exportMutationSchema,
  exportJobListQuerySchema,
  exportDownloadGrantInputSchema,
  exportDownloadGrantResponseSchema,
  exportDownloadParamsSchema,
} from "@repo/contracts/exports";
import type { z } from "zod";
import { Public } from "../auth/auth.types";
import {
  NonJsonResponse,
  ZodResponse,
} from "../common/http/zod-response.interceptor";
import {
  zodBody,
  zodParams,
  zodQuery,
} from "../common/pipes/zod-validation.pipe";
import { PortalExportsUseCases } from "./application/portal-exports.use-cases";
import { portalExportPrincipal } from "./application/portal-export-principal";
import { ExportAccessDeniedError } from "./domain/export.errors";
import { exportHttp } from "./exports.controller";
const cookieName = "cra_portal_export";

export function portalSubject(request: Request, deliveryCookie = false) {
  if (
    /^\/api\/v1\/supplier-evidence-portal\/exports(?:\/|$)/.test(request.path)
  ) {
    const header = request.headers["x-supplier-evidence-session"];
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const token =
      typeof header === "string"
        ? header
        : deliveryCookie
          ? cookies?.cra_supplier_export_session
          : undefined;
    return portalExportPrincipal(
      "supplier_session",
      typeof token === "string" ? token : undefined,
    );
  }
  if (/^\/api\/v1\/auditor\/exports(?:\/|$)/.test(request.path)) {
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const token = cookies?.cra_auditor;
    return portalExportPrincipal(
      "auditor_session",
      typeof token === "string" ? token : undefined,
    );
  }
  throw new ExportAccessDeniedError();
}
export function assertPortalExportOrigin(
  request: Request,
  appUrl: string | undefined,
): void {
  const origin = request.headers.origin;
  if (request.headers["sec-fetch-site"] === "cross-site")
    throw new ExportAccessDeniedError();
  if (origin) {
    try {
      if (!appUrl || new URL(origin).origin !== new URL(appUrl).origin)
        throw new ExportAccessDeniedError();
    } catch {
      throw new ExportAccessDeniedError();
    }
  } else if (portalSubject(request).kind === "auditor_session")
    throw new ExportAccessDeniedError();
}
@Controller(["auditor/exports", "supplier-evidence-portal/exports"])
export class PortalExportsController {
  constructor(
    private readonly exports: PortalExportsUseCases,
    private readonly config: ConfigService,
  ) {}
  @Public()
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ZodResponse(exportJobResponseSchema)
  async create(
    @Req() request: Request,
    @Body(zodBody(createExportJobSchema))
    input: z.output<typeof createExportJobSchema>,
  ) {
    return exportHttp(async () => {
      assertPortalExportOrigin(request, this.config.get<string>("APP_URL"));
      return { data: await this.exports.create(portalSubject(request), input) };
    });
  }
  @Public()
  @Get()
  @ZodResponse(exportJobListResponseSchema)
  list(
    @Req() request: Request,
    @Query(zodQuery(exportJobListQuerySchema))
    query: z.output<typeof exportJobListQuerySchema>,
  ) {
    return exportHttp(() => this.exports.list(portalSubject(request), query));
  }
  @Public()
  @Get(":jobId")
  @ZodResponse(exportJobResponseSchema)
  async get(
    @Req() request: Request,
    @Param(zodParams(exportJobParamsSchema))
    params: z.output<typeof exportJobParamsSchema>,
  ) {
    return exportHttp(async () => ({
      data: await this.exports.get(portalSubject(request), params.jobId),
    }));
  }
  @Public()
  @Get(":jobId/manifest")
  @ZodResponse(exportManifestResponseSchema)
  async manifest(
    @Req() request: Request,
    @Param(zodParams(exportJobParamsSchema))
    params: z.output<typeof exportJobParamsSchema>,
  ) {
    return exportHttp(async () => ({
      data: await this.exports.manifest(portalSubject(request), params.jobId),
    }));
  }
  @Public()
  @Post(":jobId/cancel")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(exportJobResponseSchema)
  async cancel(
    @Req() request: Request,
    @Param(zodParams(exportJobParamsSchema))
    params: z.output<typeof exportJobParamsSchema>,
    @Body(zodBody(exportMutationSchema))
    input: z.output<typeof exportMutationSchema>,
  ) {
    return exportHttp(async () => {
      assertPortalExportOrigin(request, this.config.get<string>("APP_URL"));
      return {
        data: await this.exports.mutate(
          portalSubject(request),
          params.jobId,
          input.expectedVersion,
          input.idempotencyKey,
          "cancel",
        ),
      };
    });
  }
  @Public()
  @Post(":jobId/retry")
  @HttpCode(HttpStatus.ACCEPTED)
  @ZodResponse(exportJobResponseSchema)
  async retry(
    @Req() request: Request,
    @Param(zodParams(exportJobParamsSchema))
    params: z.output<typeof exportJobParamsSchema>,
    @Body(zodBody(exportMutationSchema))
    input: z.output<typeof exportMutationSchema>,
  ) {
    return exportHttp(async () => {
      assertPortalExportOrigin(request, this.config.get<string>("APP_URL"));
      return {
        data: await this.exports.mutate(
          portalSubject(request),
          params.jobId,
          input.expectedVersion,
          input.idempotencyKey,
          "retry",
        ),
      };
    });
  }
  @Public()
  @Post(":jobId/download-grants")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(exportDownloadGrantResponseSchema)
  async grant(
    @Req() request: Request,
    @Param(zodParams(exportJobParamsSchema))
    params: z.output<typeof exportJobParamsSchema>,
    @Body(zodBody(exportDownloadGrantInputSchema))
    input: z.output<typeof exportDownloadGrantInputSchema>,
    @Res({ passthrough: true }) response: Response,
  ) {
    return exportHttp(async () => {
      assertPortalExportOrigin(request, this.config.get<string>("APP_URL"));
      const result = await this.exports.grant(
        portalSubject(request),
        params.jobId,
        input.artifactId,
      );
      const expectedPath = `/api/v1/${portalSubject(request).kind === "auditor_session" ? "auditor" : "supplier-evidence-portal"}/exports/${params.jobId}/download/${result.grant.grantId}`;
      if (result.grant.downloadPath !== expectedPath)
        throw new ExportAccessDeniedError();
      if (portalSubject(request).kind === "supplier_session")
        response.cookie(
          "cra_supplier_export_session",
          request.headers["x-supplier-evidence-session"],
          { ...this.cookieOptions(expectedPath), maxAge: 300_000 },
        );
      response.cookie(cookieName, result.cookieValue, {
        ...this.cookieOptions(result.grant.downloadPath),
        maxAge: 300_000,
      });
      return { data: result.grant };
    });
  }
  @Public()
  @Get(":jobId/download/:grantId")
  @NonJsonResponse("stream")
  async download(
    @Req() request: Request,
    @Param(zodParams(exportDownloadParamsSchema))
    params: z.output<typeof exportDownloadParamsSchema>,
    @Res() response: Response,
  ): Promise<void> {
    const artifact = await exportHttp(() => {
      const cookies = request.cookies as
        Record<string, string | undefined> | undefined;
      return this.exports.download(
        portalSubject(request, true),
        params.jobId,
        params.grantId,
        cookies?.[cookieName],
      );
    });
    response.clearCookie(cookieName, this.cookieOptions(request.path));
    response.clearCookie(
      "cra_supplier_export_session",
      this.cookieOptions(request.path),
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
  private cookieOptions(path: string) {
    return {
      httpOnly: true,
      secure: this.config.get<boolean>("COOKIE_SECURE") ?? false,
      sameSite: "strict" as const,
      path,
      ...(this.config.get<string>("COOKIE_DOMAIN")
        ? { domain: this.config.get<string>("COOKIE_DOMAIN") }
        : {}),
    };
  }
}
