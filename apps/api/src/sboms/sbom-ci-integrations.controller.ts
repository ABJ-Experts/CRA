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
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ciBuildGateVerdictResponseSchema,
  ciBuildUploadCompletionResponseSchema,
  ciBuildUploadInitializationResponseSchema,
  ciBindingRunsQuerySchema,
  ciBindingRunsResponseSchema,
  ciBuildParamsSchema,
  ciCompleteSbomWithBuildInputSchema,
  ciInitializeSbomWithBuildInputSchema,
  ciProviderReleaseBindingParamsSchema,
  ciProviderReleaseBindingResponseSchema,
  ciProviderReleaseBindingsResponseSchema,
  revokeCiProviderReleaseBindingInputSchema,
  sbomSourceParamsSchema,
  upsertCiProviderReleaseBindingInputSchema,
  type CiBuildParams,
  type CiBindingRunsQuery,
  type CiCompleteSbomWithBuildInput,
  type CiInitializeSbomWithBuildInput,
  type CiProviderReleaseBindingParams,
  type RevokeCiProviderReleaseBindingInput,
  type SbomSourceParams,
  type UpsertCiProviderReleaseBindingInput,
} from "@repo/contracts/sboms";

import {
  CurrentUser,
  Public,
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

@Controller("sbom-ci-bindings")
export class SbomCiReleaseBindingsController {
  constructor(private readonly sboms: SbomService) {}

  @RequireRole("owner")
  @Get()
  @ZodResponse(ciProviderReleaseBindingsResponseSchema)
  list(@CurrentUser() user: RequestUser) {
    return this.sboms.listCiReleaseBindings({
      organizationId: organizationId(user),
    });
  }

  @RequireRole("owner")
  @Get(":bindingId/runs")
  @ZodResponse(ciBindingRunsResponseSchema)
  runs(
    @Param(zodParams(ciProviderReleaseBindingParamsSchema))
    params: CiProviderReleaseBindingParams,
    @Query(zodQuery(ciBindingRunsQuerySchema)) query: CiBindingRunsQuery,
    @CurrentUser() user: RequestUser,
  ) {
    return this.sboms.listCiBuildRuns({
      organizationId: organizationId(user),
      bindingId: params.bindingId,
      limit: query.limit,
    });
  }

  @RequireRole("owner")
  @Post()
  @ZodResponse(ciProviderReleaseBindingResponseSchema)
  upsert(
    @Body(zodBody(upsertCiProviderReleaseBindingInputSchema))
    input: UpsertCiProviderReleaseBindingInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.sboms.createCiReleaseBinding({
      organizationId: organizationId(user),
      actorId: user.id,
      input,
    });
  }

  @RequireRole("owner")
  @Post(":bindingId/revoke")
  @ZodResponse(ciProviderReleaseBindingResponseSchema)
  revoke(
    @Param(zodParams(ciProviderReleaseBindingParamsSchema))
    params: CiProviderReleaseBindingParams,
    @Body(zodBody(revokeCiProviderReleaseBindingInputSchema))
    input: RevokeCiProviderReleaseBindingInput,
    @CurrentUser() user: RequestUser,
  ) {
    if (params.bindingId !== input.expectedBindingId)
      throw new BadRequestException({
        message: "CI binding path does not match its body.",
        code: "invalid_request",
      });
    return this.sboms.revokeCiReleaseBinding({
      organizationId: organizationId(user),
      actorId: user.id,
      input,
    });
  }
}

@Controller("ci")
export class SbomCiBuildController {
  constructor(private readonly sboms: SbomService) {}

  @Public()
  @UseGuards(SbomCiCredentialGuard)
  @Post("sbom-build-uploads")
  @ZodResponse(ciBuildUploadInitializationResponseSchema)
  async initialize(
    @Body(zodBody(ciInitializeSbomWithBuildInputSchema))
    input: CiInitializeSbomWithBuildInput,
    @Req() request: SbomCiRequest,
  ) {
    const principal = ciPrincipal(request);
    const result = await this.sboms.initializeCiBuildUpload({
      organizationId: principal.organizationId,
      credentialId: principal.credentialId,
      input,
      correlationId: randomUUID(),
    });
    return {
      source: publicSource(result.reservation),
      upload: result.upload,
      buildRunId: result.buildRunId,
      ...(result.upload === null ? { replayed: true as const } : {}),
    };
  }

  @Public()
  @UseGuards(SbomCiCredentialGuard)
  @Post("sbom-build-uploads/:sourceId/complete")
  @HttpCode(HttpStatus.ACCEPTED)
  @ZodResponse(ciBuildUploadCompletionResponseSchema)
  async complete(
    @Param(zodParams(sbomSourceParamsSchema)) params: SbomSourceParams,
    @Body(zodBody(ciCompleteSbomWithBuildInputSchema))
    input: CiCompleteSbomWithBuildInput,
    @Req() request: SbomCiRequest,
  ) {
    const principal = ciPrincipal(request);
    const result = await this.sboms.completeCiBuildUpload({
      organizationId: principal.organizationId,
      credentialId: principal.credentialId,
      sourceId: params.sourceId,
      input,
      correlationId: randomUUID(),
    });
    return completionResponse(result, params.sourceId);
  }

  @Public()
  @UseGuards(SbomCiCredentialGuard)
  @Get("sbom-build-gate")
  @ZodResponse(ciBuildGateVerdictResponseSchema)
  gate(
    @Query(zodQuery(ciBuildParamsSchema)) query: CiBuildParams,
    @Req() request: SbomCiRequest,
  ) {
    const principal = ciPrincipal(request);
    return this.sboms.ciBuildGate({
      organizationId: principal.organizationId,
      credentialId: principal.credentialId,
      input: query,
    });
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
  source: Awaited<
    ReturnType<SbomService["initializeCiBuildUpload"]>
  >["reservation"],
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

function completionResponse(
  result: Readonly<{
    job: Readonly<{ id: string; sourceId: string }>;
    outcome: "queued" | "replayed" | "deduplicated";
    buildRunId: string;
  }>,
  sourceId: string,
) {
  return {
    job: { id: result.job.id },
    progressUrl: `/api/v1/sbom-jobs/${result.job.id}`,
    completion: {
      outcome: result.outcome,
      sourceId,
      canonicalSourceId: result.job.sourceId,
    },
    buildRunId: result.buildRunId,
  };
}
