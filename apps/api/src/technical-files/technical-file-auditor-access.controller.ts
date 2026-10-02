import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpException,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import {
  createTechnicalFileAuditorGrantRequestSchema,
  redeemTechnicalFileAuditorGrantRequestSchema,
  revokeTechnicalFileAuditorGrantRequestSchema,
  technicalFileAuditorArtifactParamsSchema,
  technicalFileAuditorGrantCollectionParamsSchema,
  technicalFileAuditorGrantCreatedResponseSchema,
  technicalFileAuditorGrantParamsSchema,
  technicalFileAuditorGrantPreviewQuerySchema,
  technicalFileAuditorGrantPreviewResponseSchema,
  technicalFileAuditorGrantRedemptionResponseSchema,
  technicalFileAuditorGrantResponseSchema,
  technicalFileAuditorGrantsResponseSchema,
  technicalFileAuditorManifestResponseSchema,
  technicalFileAuditorSnapshotViewResponseSchema,
  type CreateTechnicalFileAuditorGrantRequest,
  type RedeemTechnicalFileAuditorGrantRequest,
  type RevokeTechnicalFileAuditorGrantRequest,
  type TechnicalFileAuditorArtifactParams,
  type TechnicalFileAuditorGrantCollectionParams,
  type TechnicalFileAuditorGrantParams,
  type TechnicalFileAuditorGrantPreviewQuery,
} from "@repo/contracts/technical-files";

import {
  CurrentUser,
  Public,
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
  AUDITOR_SESSION_MAX_AGE_SECONDS,
  TechnicalFileAuditorAccessUseCases,
} from "./application/technical-file-auditor-access-use-cases";
import {
  TechnicalFileAuditorAccessConflictError,
  TechnicalFileAuditorAccessUnavailableError,
} from "./application/technical-file-auditor-access.port";
import { TechnicalFileProductUnavailableError } from "./application/technical-file.port";

const AUDITOR_SESSION_COOKIE = "cra_auditor";
const AUDITOR_SESSION_PATH = "/api/v1/auditor";

/** Tenant-authenticated grant management only. */
@Controller(
  "products/:productId/technical-file/snapshots/:snapshotId/auditor-grants",
)
export class TechnicalFileAuditorGrantsController {
  constructor(
    private readonly auditorAccess: TechnicalFileAuditorAccessUseCases,
    private readonly config: ConfigService,
  ) {}

  @Get("preview")
  @RequirePermissions("can_share_technical_files")
  @ZodResponse(technicalFileAuditorGrantPreviewResponseSchema)
  async preview(
    @Param(zodParams(technicalFileAuditorGrantCollectionParamsSchema))
    params: TechnicalFileAuditorGrantCollectionParams,
    @Query(zodQuery(technicalFileAuditorGrantPreviewQuerySchema))
    query: TechnicalFileAuditorGrantPreviewQuery,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const preview = await this.auditorAccess.preview(organizationId(user), {
        actorId: user.id,
        ...params,
        ...query,
      });
      if (!preview) throw unavailable();
      return { preview };
    } catch (error) {
      throw grantFailure(error);
    }
  }

  @Get()
  @RequirePermissions("can_share_technical_files")
  @ZodResponse(technicalFileAuditorGrantsResponseSchema)
  async list(
    @Param(zodParams(technicalFileAuditorGrantCollectionParamsSchema))
    params: TechnicalFileAuditorGrantCollectionParams,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const grants = await this.auditorAccess.list(organizationId(user), {
        actorId: user.id,
        ...params,
      });
      if (!grants) throw unavailable();
      return { grants };
    } catch (error) {
      throw grantFailure(error);
    }
  }

  @Post()
  @RequirePermissions("can_share_technical_files")
  @ZodResponse(technicalFileAuditorGrantCreatedResponseSchema)
  async create(
    @Param(zodParams(technicalFileAuditorGrantCollectionParamsSchema))
    params: TechnicalFileAuditorGrantCollectionParams,
    @Body(zodBody(createTechnicalFileAuditorGrantRequestSchema))
    input: CreateTechnicalFileAuditorGrantRequest,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const created = await this.auditorAccess.create(organizationId(user), {
        actorId: user.id,
        ...params,
        ...input,
      });
      if (!created) throw unavailable();
      return {
        grant: created.grant,
        // The opaque token is only ever placed in this one response. Neither
        // logs nor durable records receive it.
        deliveryUrl: deliveryUrl(this.config, created.token),
      };
    } catch (error) {
      throw grantFailure(error);
    }
  }

  @Post(":grantId/revoke")
  @HttpCode(200)
  @RequirePermissions("can_share_technical_files")
  @ZodResponse(technicalFileAuditorGrantResponseSchema)
  async revoke(
    @Param(zodParams(technicalFileAuditorGrantParamsSchema))
    params: TechnicalFileAuditorGrantParams,
    @Body(zodBody(revokeTechnicalFileAuditorGrantRequestSchema))
    input: RevokeTechnicalFileAuditorGrantRequest,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const grant = await this.auditorAccess.revoke(organizationId(user), {
        actorId: user.id,
        ...params,
        ...input,
      });
      if (!grant) throw unavailable();
      return { grant };
    } catch (error) {
      throw grantFailure(error);
    }
  }
}

/**
 * This controller is deliberately public to the ordinary auth guard but is
 * still authenticated by its opaque, path-scoped auditor session on every
 * read. It never accepts tenant, product, snapshot, or export identifiers.
 */
@Controller("auditor")
export class TechnicalFileAuditorAccessController {
  constructor(
    private readonly auditorAccess: TechnicalFileAuditorAccessUseCases,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  @Post("redeem")
  @ZodResponse(technicalFileAuditorGrantRedemptionResponseSchema)
  async redeem(
    @Body(zodBody(redeemTechnicalFileAuditorGrantRequestSchema))
    input: RedeemTechnicalFileAuditorGrantRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const redeemed = await this.auditorAccess.redeem(input.token, request.ip);
    if (!redeemed) throw unavailable();
    const maxAge = Math.max(
      0,
      Math.min(
        AUDITOR_SESSION_MAX_AGE_SECONDS,
        Math.floor((Date.parse(redeemed.expiresAt) - Date.now()) / 1000),
      ),
    );
    response.cookie(AUDITOR_SESSION_COOKIE, redeemed.sessionToken, {
      httpOnly: true,
      secure: this.config.get<boolean>("COOKIE_SECURE") ?? false,
      sameSite:
        this.config.get<"lax" | "strict" | "none">("COOKIE_SAMESITE") ?? "lax",
      ...(this.config.get<string>("COOKIE_DOMAIN")
        ? { domain: this.config.get<string>("COOKIE_DOMAIN") }
        : {}),
      path: AUDITOR_SESSION_PATH,
      maxAge: maxAge * 1000,
    });
    return { status: "redeemed" as const, expiresAt: redeemed.expiresAt };
  }

  @Public()
  @Get("snapshot")
  @ZodResponse(technicalFileAuditorSnapshotViewResponseSchema)
  async snapshot(@Req() request: Request) {
    const snapshot = await this.auditorAccess.view(sessionToken(request));
    if (!snapshot) throw unavailable();
    return { snapshot };
  }

  @Public()
  @Get("snapshot/manifest")
  @ZodResponse(technicalFileAuditorManifestResponseSchema)
  async manifest(@Req() request: Request) {
    const manifest = await this.auditorAccess.manifest(sessionToken(request));
    if (!manifest) throw unavailable();
    return { manifest };
  }

  @Public()
  @Get("snapshot/artifacts/:artifact")
  @NonJsonResponse("stream")
  async artifact(
    @Param(zodParams(technicalFileAuditorArtifactParamsSchema))
    params: TechnicalFileAuditorArtifactParams,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const contents = await this.auditorAccess.artifact(
      sessionToken(request),
      params.artifact,
    );
    if (!contents) throw unavailable();
    response.setHeader("Content-Type", contents.mimeType);
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${contents.fileName}"`,
    );
    response.setHeader("Cache-Control", "no-store, private");
    response.status(200).send(Buffer.from(contents.bytes));
  }
}

function organizationId(user: RequestUser): string {
  if (!user.organizationId) throw unavailable();
  return user.organizationId;
}

function sessionToken(request: Request): string {
  const cookies = request.cookies as Record<string, unknown> | undefined;
  const token = cookies?.[AUDITOR_SESSION_COOKIE];
  if (typeof token !== "string" || token.length < 43 || token.length > 256)
    throw unavailable();
  return token;
}

function deliveryUrl(config: ConfigService, token: string): string {
  const appUrl = config.getOrThrow<string>("APP_URL");
  const url = new URL("/auditor", appUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

function unavailable(): NotFoundException {
  return new NotFoundException({
    code: "auditor_access_unavailable",
    message: "This auditor access is unavailable.",
  });
}

function grantFailure(error: unknown): Error {
  if (error instanceof HttpException) return error;
  if (error instanceof TechnicalFileAuditorAccessConflictError) {
    return new ConflictException({
      code: "version_conflict",
      message: "This auditor grant changed. Reload before continuing.",
      ...(error.currentVersion ? { currentVersion: error.currentVersion } : {}),
    });
  }
  if (
    error instanceof TechnicalFileProductUnavailableError ||
    error instanceof TechnicalFileAuditorAccessUnavailableError
  ) {
    return unavailable();
  }
  return new ServiceUnavailableException({
    code: "technical_file_auditor_unavailable",
    message: "Auditor access is temporarily unavailable. Please try again.",
  });
}
