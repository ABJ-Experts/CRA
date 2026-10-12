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
  Patch,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import type { z } from "zod";
import {
  createReportDefinitionSchema,
  updateReportDefinitionSchema,
  reportMutationSchema,
  reportDefinitionParamsSchema,
  reportRunParamsSchema,
  reportRecipientParamsSchema,
  reportDownloadParamsSchema,
  reportListQuerySchema,
  reportRunsQuerySchema,
  reportGrantInputSchema,
  reportEmailPreferenceInputSchema,
  reportDefinitionResponseSchema,
  reportDefinitionListResponseSchema,
  reportRunDetailResponseSchema,
  reportRunListResponseSchema,
  reportRecipientsResponseSchema,
  reportManifestResponseSchema,
  reportDownloadGrantResponseSchema,
  reportEmailPreferenceSchema,
  reportAdministrationListResponseSchema,
  reportAdministrationMutationResponseSchema,
} from "@repo/contracts/reports/schemas";
import {
  CurrentUser,
  RequireRole,
  SelfScoped,
  type RequestUser,
} from "../auth/auth.types";
import { API_PREFIX } from "../auth/cookies.util";
import {
  ExportAccessDeniedError,
  ExportUnavailableError,
} from "../exports/domain/export.errors";
import {
  NonJsonResponse,
  ZodResponse,
} from "../common/http/zod-response.interceptor";
import {
  zodBody,
  zodParams,
  zodQuery,
} from "../common/pipes/zod-validation.pipe";
import { ReportsUseCases } from "./application/reports.use-cases";
import {
  ReportAccessDeniedError,
  ReportConflictError,
  ReportInvalidRequestError,
  ReportUnavailableError,
} from "./domain/report.errors";

const scopeReason =
  "Definitions, occurrences and recipient artifacts are scoped by current database membership, source authorization and immutable recipient identity.";
export const REPORT_GRANT_COOKIE = "cra_report_download";

export async function reportHttp<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof ReportAccessDeniedError ||
      error instanceof ExportAccessDeniedError
    )
      throw new NotFoundException({
        code: "not_found",
        message: "Report is not available",
      });
    if (error instanceof ReportConflictError)
      throw new ConflictException({
        code: "report_conflict",
        message: "Report state changed; reload and try again",
      });
    if (error instanceof ReportInvalidRequestError)
      throw new BadRequestException({
        code: "report_invalid",
        message: "Report request is invalid",
      });
    if (
      error instanceof ReportUnavailableError ||
      error instanceof ExportUnavailableError
    )
      throw new ServiceUnavailableException({
        code: "report_unavailable",
        message: "Report service is temporarily unavailable",
      });
    throw error;
  }
}

@Controller("reports")
export class ReportsController {
  constructor(
    private readonly reports: ReportsUseCases,
    private readonly config: ConfigService,
  ) {}

  @Post("definitions")
  @HttpCode(HttpStatus.CREATED)
  @SelfScoped(scopeReason)
  @ZodResponse(reportDefinitionResponseSchema)
  create(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(createReportDefinitionSchema))
    input: z.output<typeof createReportDefinitionSchema>,
  ) {
    return reportHttp(() => this.reports.create(user, input));
  }

  @Get("definitions")
  @SelfScoped(scopeReason)
  @ZodResponse(reportDefinitionListResponseSchema)
  list(
    @CurrentUser() user: RequestUser,
    @Query(zodQuery(reportListQuerySchema))
    query: z.output<typeof reportListQuerySchema>,
  ) {
    return reportHttp(() => this.reports.list(user, query));
  }

  @Get("definitions/:definitionId")
  @SelfScoped(scopeReason)
  @ZodResponse(reportDefinitionResponseSchema)
  get(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(reportDefinitionParamsSchema))
    params: z.output<typeof reportDefinitionParamsSchema>,
  ) {
    return reportHttp(() => this.reports.get(user, params.definitionId));
  }

  @Patch("definitions/:definitionId")
  @SelfScoped(scopeReason)
  @ZodResponse(reportDefinitionResponseSchema)
  update(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(reportDefinitionParamsSchema))
    params: z.output<typeof reportDefinitionParamsSchema>,
    @Body(zodBody(updateReportDefinitionSchema))
    input: z.output<typeof updateReportDefinitionSchema>,
  ) {
    return reportHttp(() =>
      this.reports.update(user, params.definitionId, input),
    );
  }

  @Post("definitions/:definitionId/preview")
  @SelfScoped(scopeReason)
  @ZodResponse(reportRunDetailResponseSchema)
  preview(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(reportDefinitionParamsSchema))
    params: z.output<typeof reportDefinitionParamsSchema>,
    @Body(zodBody(reportMutationSchema))
    input: z.output<typeof reportMutationSchema>,
  ) {
    return reportHttp(() =>
      this.reports.preview(user, params.definitionId, input),
    );
  }

  @Post("definitions/:definitionId/activate")
  @SelfScoped(scopeReason)
  @ZodResponse(reportDefinitionResponseSchema)
  activate(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(reportDefinitionParamsSchema))
    params: z.output<typeof reportDefinitionParamsSchema>,
    @Body(zodBody(reportMutationSchema))
    input: z.output<typeof reportMutationSchema>,
  ) {
    return reportHttp(() =>
      this.reports.mutate(user, params.definitionId, "activate", input),
    );
  }

  @Post("definitions/:definitionId/pause")
  @SelfScoped(scopeReason)
  @ZodResponse(reportDefinitionResponseSchema)
  pause(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(reportDefinitionParamsSchema))
    params: z.output<typeof reportDefinitionParamsSchema>,
    @Body(zodBody(reportMutationSchema))
    input: z.output<typeof reportMutationSchema>,
  ) {
    return reportHttp(() =>
      this.reports.mutate(user, params.definitionId, "pause", input),
    );
  }

  @Post("definitions/:definitionId/resume")
  @SelfScoped(scopeReason)
  @ZodResponse(reportDefinitionResponseSchema)
  resume(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(reportDefinitionParamsSchema))
    params: z.output<typeof reportDefinitionParamsSchema>,
    @Body(zodBody(reportMutationSchema))
    input: z.output<typeof reportMutationSchema>,
  ) {
    return reportHttp(() =>
      this.reports.mutate(user, params.definitionId, "resume", input),
    );
  }

  @Post("definitions/:definitionId/archive")
  @SelfScoped(scopeReason)
  @ZodResponse(reportDefinitionResponseSchema)
  archive(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(reportDefinitionParamsSchema))
    params: z.output<typeof reportDefinitionParamsSchema>,
    @Body(zodBody(reportMutationSchema))
    input: z.output<typeof reportMutationSchema>,
  ) {
    return reportHttp(() =>
      this.reports.mutate(user, params.definitionId, "archive", input),
    );
  }

  @Get("runs")
  @SelfScoped(scopeReason)
  @ZodResponse(reportRunListResponseSchema)
  listRuns(
    @CurrentUser() user: RequestUser,
    @Query(zodQuery(reportRunsQuerySchema))
    query: z.output<typeof reportRunsQuerySchema>,
  ) {
    return reportHttp(() => this.reports.listRuns(user, query));
  }

  @Get("runs/:runId")
  @SelfScoped(scopeReason)
  @ZodResponse(reportRunDetailResponseSchema)
  getRun(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(reportRunParamsSchema))
    params: z.output<typeof reportRunParamsSchema>,
  ) {
    return reportHttp(() => this.reports.getRun(user, params.runId));
  }

  @Post("runs/:runId/replay")
  @SelfScoped(scopeReason)
  @ZodResponse(reportRunDetailResponseSchema)
  replay(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(reportRunParamsSchema))
    params: z.output<typeof reportRunParamsSchema>,
    @Body(zodBody(reportMutationSchema))
    input: z.output<typeof reportMutationSchema>,
  ) {
    return reportHttp(() => this.reports.replay(user, params.runId, input));
  }

  @Get("recipients")
  @SelfScoped(scopeReason)
  @ZodResponse(reportRecipientsResponseSchema)
  recipients(
    @CurrentUser() user: RequestUser,
    @Query(zodQuery(reportListQuerySchema))
    query: z.output<typeof reportListQuerySchema>,
  ) {
    return reportHttp(() => this.reports.recipients(user, query));
  }

  @Get("runs/:runId/recipients/:recipientId/manifest")
  @SelfScoped(scopeReason)
  @ZodResponse(reportManifestResponseSchema)
  manifest(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(reportRecipientParamsSchema))
    params: z.output<typeof reportRecipientParamsSchema>,
  ) {
    return reportHttp(() =>
      this.reports.manifest(user, params.runId, params.recipientId),
    );
  }

  @Post("runs/:runId/recipients/:recipientId/download-grants")
  @SelfScoped(scopeReason)
  @ZodResponse(reportDownloadGrantResponseSchema)
  async grant(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(reportRecipientParamsSchema))
    params: z.output<typeof reportRecipientParamsSchema>,
    @Body(zodBody(reportGrantInputSchema))
    input: z.output<typeof reportGrantInputSchema>,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await reportHttp(() =>
      this.reports.grant(
        user,
        params.runId,
        params.recipientId,
        input.artifactId,
      ),
    );
    response.cookie(REPORT_GRANT_COOKIE, result.cookieValue, {
      ...this.cookieOptions(
        params.runId,
        params.recipientId,
        result.response.data.grantId,
      ),
      maxAge: 300_000,
    });
    return result.response;
  }

  @Get("runs/:runId/recipients/:recipientId/download/:grantId")
  @SelfScoped(scopeReason)
  @NonJsonResponse("stream")
  async download(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(reportDownloadParamsSchema))
    params: z.output<typeof reportDownloadParamsSchema>,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const cookies = request.cookies as
      Record<string, string | undefined> | undefined;
    const artifact = await reportHttp(() =>
      this.reports.download(
        user,
        params.runId,
        params.recipientId,
        params.grantId,
        cookies?.[REPORT_GRANT_COOKIE],
      ),
    );
    response.clearCookie(
      REPORT_GRANT_COOKIE,
      this.cookieOptions(params.runId, params.recipientId, params.grantId),
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

  @Get("email-preference")
  @SelfScoped(scopeReason)
  @ZodResponse(reportEmailPreferenceSchema)
  emailPreference(@CurrentUser() user: RequestUser) {
    return reportHttp(() => this.reports.getEmailPreference(user));
  }

  @Patch("email-preference")
  @SelfScoped(scopeReason)
  @ZodResponse(reportEmailPreferenceSchema)
  setEmailPreference(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(reportEmailPreferenceInputSchema))
    input: z.output<typeof reportEmailPreferenceInputSchema>,
  ) {
    return reportHttp(() => this.reports.setEmailPreference(user, input));
  }

  @Get("administration")
  @RequireRole("admin")
  @ZodResponse(reportAdministrationListResponseSchema)
  listAdministration(
    @CurrentUser() user: RequestUser,
    @Query(zodQuery(reportListQuerySchema))
    query: z.output<typeof reportListQuerySchema>,
  ) {
    return reportHttp(() => this.reports.listAdministration(user, query));
  }

  @Post("administration/:definitionId/pause")
  @RequireRole("admin")
  @ZodResponse(reportAdministrationMutationResponseSchema)
  adminPause(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(reportDefinitionParamsSchema))
    params: z.output<typeof reportDefinitionParamsSchema>,
    @Body(zodBody(reportMutationSchema))
    input: z.output<typeof reportMutationSchema>,
  ) {
    return reportHttp(() =>
      this.reports.adminPause(user, params.definitionId, input),
    );
  }

  private cookieOptions(runId: string, recipientId: string, grantId: string) {
    return {
      httpOnly: true,
      secure: this.config.get<boolean>("COOKIE_SECURE") ?? false,
      sameSite: "strict" as const,
      path: `/${API_PREFIX}/reports/runs/${runId}/recipients/${recipientId}/download/${grantId}`,
      ...(this.config.get<string>("COOKIE_DOMAIN")
        ? { domain: this.config.get<string>("COOKIE_DOMAIN") }
        : {}),
    };
  }
}
