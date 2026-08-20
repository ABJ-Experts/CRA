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
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ciCompleteSbomUploadInputSchema,
  ciInitializeSbomUploadInputSchema,
  completeSbomUploadInputSchema,
  initializeSbomUploadInputSchema,
  replaySbomJobInputSchema,
  sbomJobParamsSchema,
  sbomJobResponseSchema,
  sbomOriginalDownloadResponseSchema,
  sbomReleaseParamsSchema,
  sbomSourceParamsSchema,
  sbomUploadInitializationResponseSchema,
  type CiCompleteSbomUploadInput,
  type CiInitializeSbomUploadInput,
  type CompleteSbomUploadInput,
  type InitializeSbomUploadInput,
  type ReplaySbomJobInput,
  type SbomJobParams,
  type SbomReleaseParams,
  type SbomSourceParams,
} from "@repo/contracts/sboms";

import {
  CurrentUser,
  Public,
  RequirePermissions,
  RequireRole,
  type RequestUser,
} from "../auth/auth.types";
import { ZodResponse } from "../common/http/zod-response.interceptor";
import { zodBody, zodParams } from "../common/pipes/zod-validation.pipe";
import {
  SbomCiCredentialGuard,
  type SbomCiRequest,
} from "./sbom-ci-credential.guard";
import { SbomService } from "./sbom.service";

@Controller("products/:productId/releases/:releaseId/sbom-uploads")
export class ProductReleaseSbomController {
  constructor(private readonly sboms: SbomService) {}

  @RequirePermissions("can_upload_sboms")
  @Post()
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
      correlationId: randomUUID(),
    });
    return { source: publicSource(result.reservation), upload: result.upload };
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
    createdAt: source.createdAt,
    completedAt: source.completedAt,
  };
}

function jobResponse(job: Readonly<{ id: string }>) {
  return { job, progressUrl: `/api/v1/sbom-jobs/${job.id}` };
}
