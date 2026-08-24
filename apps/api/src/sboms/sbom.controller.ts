import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  Body,
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
  UseGuards,
} from "@nestjs/common";
import {
  ciCompleteSbomUploadInputSchema,
  ciInitializeSbomUploadInputSchema,
  completeSbomUploadInputSchema,
  initializeSbomUploadInputSchema,
  sbomComponentSearchQuerySchema,
  sbomComponentSearchResponseSchema,
  sbomDependencyTreeQuerySchema,
  sbomDependencyTreeResponseSchema,
  sbomDocumentDetailResponseSchema,
  sbomDocumentListQuerySchema,
  sbomDocumentListResponseSchema,
  sbomDocumentParamsSchema,
  sbomQualityFindingsQuerySchema,
  sbomQualityFindingsResponseSchema,
  sbomQualityReportResponseSchema,
  sbomQualitySettingsResponseSchema,
  sbomSourceQualityParamsSchema,
  replaySbomJobInputSchema,
  sbomJobParamsSchema,
  sbomJobResponseSchema,
  sbomOriginalDownloadResponseSchema,
  sbomSourceHistoryQuerySchema,
  sbomSourceHistoryResponseSchema,
  sbomReleaseParamsSchema,
  sbomSourceParamsSchema,
  sbomValidationReportResponseSchema,
  sbomUploadInitializationResponseSchema,
  updateSbomQualitySettingsInputSchema,
  type CiCompleteSbomUploadInput,
  type CiInitializeSbomUploadInput,
  type CompleteSbomUploadInput,
  type InitializeSbomUploadInput,
  type ReplaySbomJobInput,
  type SbomJobParams,
  type SbomReleaseParams,
  type SbomSourceHistoryQuery,
  type SbomSourceParams,
  type SbomComponentSearchQuery,
  type SbomDependencyTreeQuery,
  type SbomDocumentListQuery,
  type SbomDocumentParams,
  type SbomQualityFindingsQuery,
  type SbomSourceQualityParams,
  type UpdateSbomQualitySettingsInput,
} from "@repo/contracts/sboms";

import {
  CurrentUser,
  Public,
  RequirePermissions,
  RequireRole,
  type RequestUser,
} from "../auth/auth.types";
import { ZodResponse } from "../common/http/zod-response.interceptor";
import {
  zodBody,
  zodParams,
  zodQuery,
} from "../common/pipes/zod-validation.pipe";
import {
  SbomCiCredentialGuard,
  type SbomCiRequest,
} from "./sbom-ci-credential.guard";
import { SbomService } from "./sbom.service";

@Controller("products/:productId/releases/:releaseId")
export class ProductReleaseSbomController {
  constructor(private readonly sboms: SbomService) {}

  @RequirePermissions("can_upload_sboms")
  @Post("sbom-uploads")
  @ZodResponse(sbomUploadInitializationResponseSchema)
  async initialize(
    @Param(zodParams(sbomReleaseParamsSchema)) params: SbomReleaseParams,
    @Body(zodBody(initializeSbomUploadInputSchema))
    input: InitializeSbomUploadInput,
    @CurrentUser() user: RequestUser,
  ) {
    if (
      input.productId !== params.productId ||
      input.releaseId !== params.releaseId
    )
      throw new BadRequestException({
        message: "SBOM upload path does not match its body.",
        code: "invalid_request",
      });
    const result = await this.sboms.initialize({
      organizationId: organizationId(user),
      actorId: user.id,
      productId: params.productId,
      releaseId: params.releaseId,
      filename: input.fileName,
      byteSize: input.byteSize,
      mediaType: input.mediaType,
      sha256: input.sha256,
      source: "manual_upload",
      idempotencyKey: input.idempotencyKey,
      declaredFormat: input.declaredFormat,
      declaredSpecVersion: input.declaredSpecVersion,
      supersedesSourceId: input.supersedesSourceId,
      correlationId: randomUUID(),
    });
    return { source: publicSource(result.reservation), upload: result.upload };
  }

  @RequirePermissions("can_view_sboms")
  @Get("sbom-sources")
  @ZodResponse(sbomSourceHistoryResponseSchema)
  async sources(
    @Param(zodParams(sbomReleaseParamsSchema)) params: SbomReleaseParams,
    @Query(zodQuery(sbomSourceHistoryQuerySchema))
    query: SbomSourceHistoryQuery,
    @CurrentUser() user: RequestUser,
  ) {
    return this.sboms.listSourcesForRelease({
      organizationId: organizationId(user),
      actorId: user.id,
      productId: params.productId,
      releaseId: params.releaseId,
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  @RequirePermissions("can_view_sboms")
  @Get("sbom-documents")
  @ZodResponse(sbomDocumentListResponseSchema)
  async documents(
    @Param(zodParams(sbomReleaseParamsSchema)) params: SbomReleaseParams,
    @Query(zodQuery(sbomDocumentListQuerySchema)) query: SbomDocumentListQuery,
    @CurrentUser() user: RequestUser,
  ) {
    return this.sboms.listDocuments({
      organizationId: organizationId(user),
      actorId: user.id,
      productId: params.productId,
      releaseId: params.releaseId,
      limit: query.limit,
      cursor: query.cursor,
    });
  }
}

@Controller("sbom-documents")
export class SbomDocumentsController {
  constructor(private readonly sboms: SbomService) {}

  @RequirePermissions("can_view_sboms")
  @Get(":documentId")
  @ZodResponse(sbomDocumentDetailResponseSchema)
  async document(
    @Param(zodParams(sbomDocumentParamsSchema)) params: SbomDocumentParams,
    @CurrentUser() user: RequestUser,
  ) {
    return this.sboms.document({
      organizationId: organizationId(user),
      actorId: user.id,
      documentId: params.documentId,
    });
  }

  @RequirePermissions("can_view_sboms")
  @Get(":documentId/components")
  @ZodResponse(sbomComponentSearchResponseSchema)
  async components(
    @Param(zodParams(sbomDocumentParamsSchema)) params: SbomDocumentParams,
    @Query(zodQuery(sbomComponentSearchQuerySchema))
    query: SbomComponentSearchQuery,
    @CurrentUser() user: RequestUser,
  ) {
    return this.sboms.searchComponents({
      organizationId: organizationId(user),
      actorId: user.id,
      documentId: params.documentId,
      q: query.q,
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  @RequirePermissions("can_view_sboms")
  @Get(":documentId/dependency-tree")
  @ZodResponse(sbomDependencyTreeResponseSchema)
  async dependencyTree(
    @Param(zodParams(sbomDocumentParamsSchema)) params: SbomDocumentParams,
    @Query(zodQuery(sbomDependencyTreeQuerySchema))
    query: SbomDependencyTreeQuery,
    @CurrentUser() user: RequestUser,
  ) {
    return this.sboms.dependencyTree({
      organizationId: organizationId(user),
      actorId: user.id,
      documentId: params.documentId,
      parentComponentId: query.parentComponentId,
      q: query.q,
      limit: query.limit,
      cursor: query.cursor,
    });
  }
}

@Controller("sbom-uploads")
export class SbomUploadsController {
  constructor(private readonly sboms: SbomService) {}
  @RequirePermissions("can_upload_sboms")
  @Post(":sourceId/complete")
  @HttpCode(HttpStatus.ACCEPTED)
  @ZodResponse(sbomJobResponseSchema)
  async complete(
    @Param(zodParams(sbomSourceParamsSchema)) params: SbomSourceParams,
    @Body(zodBody(completeSbomUploadInputSchema))
    input: CompleteSbomUploadInput,
    @CurrentUser() user: RequestUser,
  ) {
    const result = await this.sboms.complete({
      organizationId: organizationId(user),
      actorId: user.id,
      sourceId: params.sourceId,
      idempotencyKey: input.idempotencyKey,
      correlationId: randomUUID(),
    });
    return jobResponse(result.job);
  }
}

@Controller("sbom-jobs")
export class SbomJobsController {
  constructor(private readonly sboms: SbomService) {}
  @RequirePermissions("can_view_sboms")
  @Get(":jobId")
  @ZodResponse(sbomJobResponseSchema)
  async job(
    @Param(zodParams(sbomJobParamsSchema)) params: SbomJobParams,
    @CurrentUser() user: RequestUser,
  ) {
    return jobResponse(
      await this.sboms.job(organizationId(user), user.id, params.jobId),
    );
  }
  @RequireRole("owner")
  @Post(":jobId/replay")
  @HttpCode(HttpStatus.ACCEPTED)
  @ZodResponse(sbomJobResponseSchema)
  async replay(
    @Param(zodParams(sbomJobParamsSchema)) params: SbomJobParams,
    @Body(zodBody(replaySbomJobInputSchema)) input: ReplaySbomJobInput,
    @CurrentUser() user: RequestUser,
  ) {
    return jobResponse(
      await this.sboms.replay({
        organizationId: organizationId(user),
        actorId: user.id,
        jobId: params.jobId,
        idempotencyKey: input.idempotencyKey,
      }),
    );
  }
}

@Controller("sbom-sources")
export class SbomSourcesController {
  constructor(private readonly sboms: SbomService) {}
  @RequirePermissions("can_view_sboms")
  @Get(":sourceId/download")
  @ZodResponse(sbomOriginalDownloadResponseSchema)
  async download(
    @Param(zodParams(sbomSourceParamsSchema)) params: SbomSourceParams,
    @CurrentUser() user: RequestUser,
  ) {
    const download = await this.sboms.download(
      organizationId(user),
      user.id,
      params.sourceId,
    );
    return {
      download: {
        downloadUrl: download.downloadUrl,
        expiresAt: download.expiresAt,
        fileName: download.fileName,
        mediaType: download.contentType,
      },
    };
  }

  @RequirePermissions("can_view_sboms")
  @Get(":sourceId/validation-report")
  @ZodResponse(sbomValidationReportResponseSchema)
  async validationReport(
    @Param(zodParams(sbomSourceParamsSchema)) params: SbomSourceParams,
    @CurrentUser() user: RequestUser,
  ) {
    return this.sboms.validationReport({
      organizationId: organizationId(user),
      actorId: user.id,
      sourceId: params.sourceId,
    });
  }

  @RequirePermissions("can_view_sboms")
  @Get(":sourceId/quality-report")
  @ZodResponse(sbomQualityReportResponseSchema)
  async qualityReport(
    @Param(zodParams(sbomSourceQualityParamsSchema))
    params: SbomSourceQualityParams,
    @CurrentUser() user: RequestUser,
  ) {
    return this.sboms.qualityReport({
      organizationId: organizationId(user),
      actorId: user.id,
      sourceId: params.sourceId,
    });
  }

  @RequirePermissions("can_view_sboms")
  @Get(":sourceId/quality-findings")
  @ZodResponse(sbomQualityFindingsResponseSchema)
  async qualityFindings(
    @Param(zodParams(sbomSourceQualityParamsSchema))
    params: SbomSourceQualityParams,
    @Query(zodQuery(sbomQualityFindingsQuerySchema))
    query: SbomQualityFindingsQuery,
    @CurrentUser() user: RequestUser,
  ) {
    return this.sboms.qualityFindings({
      organizationId: organizationId(user),
      actorId: user.id,
      sourceId: params.sourceId,
      limit: query.limit,
      cursor: query.cursor,
      severity: query.severity,
      kind: query.kind,
    });
  }
}

@Controller("sbom-quality-settings")
export class SbomQualitySettingsController {
  constructor(private readonly sboms: SbomService) {}

  @RequireRole("owner")
  @Get()
  @ZodResponse(sbomQualitySettingsResponseSchema)
  async settings(@CurrentUser() user: RequestUser) {
    return this.sboms.qualitySettings({
      organizationId: organizationId(user),
      actorId: user.id,
    });
  }

  @RequireRole("owner")
  @Patch()
  @ZodResponse(sbomQualitySettingsResponseSchema)
  async updateSettings(
    @Body(zodBody(updateSbomQualitySettingsInputSchema))
    input: UpdateSbomQualitySettingsInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.sboms.updateQualitySettings({
      organizationId: organizationId(user),
      actorId: user.id,
      expectedVersion: input.expectedVersion,
      bsiProfileEnabled: input.bsiProfileEnabled,
      idempotencyKey: input.idempotencyKey,
    });
  }
}

@Controller("ci/sbom-uploads")
export class SbomCiController {
  constructor(private readonly sboms: SbomService) {}
  @Public()
  @UseGuards(SbomCiCredentialGuard)
  @Post()
  @ZodResponse(sbomUploadInitializationResponseSchema)
  async initialize(
    @Body(zodBody(ciInitializeSbomUploadInputSchema))
    input: CiInitializeSbomUploadInput,
    @Req() request: SbomCiRequest,
  ) {
    const principal = ciPrincipal(request);
    const result = await this.sboms.initialize({
      organizationId: principal.organizationId,
      actorId: principal.credentialId,
      ciCredentialId: principal.credentialId,
      productId: input.productId,
      releaseId: input.releaseId,
      filename: input.fileName,
      byteSize: input.byteSize,
      mediaType: input.mediaType,
      sha256: input.sha256,
      source: "ci_upload",
      idempotencyKey: input.idempotencyKey,
      correlationId: randomUUID(),
      declaredFormat: input.declaredFormat,
      declaredSpecVersion: input.declaredSpecVersion,
      supersedesSourceId: input.supersedesSourceId,
    });
    return { source: publicSource(result.reservation), upload: result.upload };
  }
  @Public()
  @UseGuards(SbomCiCredentialGuard)
  @Post(":sourceId/complete")
  @HttpCode(HttpStatus.ACCEPTED)
  @ZodResponse(sbomJobResponseSchema)
  async complete(
    @Param(zodParams(sbomSourceParamsSchema)) params: SbomSourceParams,
    @Body(zodBody(ciCompleteSbomUploadInputSchema))
    input: CiCompleteSbomUploadInput,
    @Req() request: SbomCiRequest,
  ) {
    const principal = ciPrincipal(request);
    const result = await this.sboms.complete({
      organizationId: principal.organizationId,
      actorId: principal.credentialId,
      ciCredentialId: principal.credentialId,
      sourceId: params.sourceId,
      idempotencyKey: input.idempotencyKey,
      correlationId: randomUUID(),
    });
    return jobResponse(result.job);
  }
}

function organizationId(user: RequestUser): string {
  if (user.organizationId) return user.organizationId;
  throw new NotFoundException({
    message: "SBOM intake request could not be completed.",
    code: "not_found",
  });
}
function ciPrincipal(request: SbomCiRequest) {
  if (request.sbomCiPrincipal) return request.sbomCiPrincipal;
  throw new NotFoundException({
    message: "CI credential is not valid.",
    code: "not_found",
  });
}
function publicSource(
  source: Awaited<ReturnType<SbomService["initialize"]>>["reservation"],
) {
  return {
    id: source.id,
    organizationId: source.organizationId,
    productId: source.productId,
    releaseId: source.releaseId,
    source: source.source,
    fileName: source.filename,
    mediaType: source.mediaType,
    byteSize: source.byteSize,
    sha256: source.sha256,
    status: source.status,
    ...(source.declaredFormat ? { declaredFormat: source.declaredFormat } : {}),
    ...(source.declaredSpecVersion
      ? { declaredSpecVersion: source.declaredSpecVersion }
      : {}),
    ...(source.supersedesSourceId
      ? { supersedesSourceId: source.supersedesSourceId }
      : {}),
    createdAt: source.createdAt,
    completedAt: source.completedAt,
  };
}

function jobResponse(job: Readonly<{ id: string }>) {
  return { job, progressUrl: `/api/v1/sbom-jobs/${job.id}` };
}
