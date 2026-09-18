import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import {
  completeEvidenceUploadInputSchema,
  evidenceDocumentListQuerySchema,
  evidenceDocumentAccessParamsSchema,
  evidenceDeliveryParamsSchema,
  evidenceDocumentParamsSchema,
  evidenceDocumentVersionsResponseSchema,
  evidenceDocumentAccessInputSchema,
  evidenceDocumentAccessResponseSchema,
  createEvidenceReplacementInputSchema,
  evidenceProductParamsSchema,
  initializeEvidenceUploadInputSchema,
  type CompleteEvidenceUploadInput,
  type EvidenceDocumentListQuery,
  type EvidenceProductParams,
  type InitializeEvidenceUploadInput,
  evidenceDocumentListResponseSchema,
  evidenceUploadCompletionResponseSchema,
  evidenceUploadInitializationResponseSchema,
  evidenceUploadVersionParamsSchema,
  type CreateEvidenceReplacementInput,
  type EvidenceDocumentAccessInput,
} from "@repo/contracts/evidence";
import {
  CurrentUser,
  RequirePermissions,
  type RequestUser,
} from "../auth/auth.types";
import {
  zodBody,
  zodParams,
  zodQuery,
} from "../common/pipes/zod-validation.pipe";
import { ZodResponse } from "../common/http/zod-response.interceptor";
import { NonJsonResponse } from "../common/http/zod-response.interceptor";
import {
  EvidenceIntakeUseCases,
  EVIDENCE_REPOSITORY,
  type EvidenceRepository,
} from "./application/evidence-intake-use-cases";
import { EvidenceAccessUseCases } from "./application/evidence-access-use-cases";
import { SupabaseEvidenceStorageAdapter } from "./infrastructure/supabase-evidence-storage.adapter";

@Controller()
export class EvidenceController {
  constructor(
    private readonly intake: EvidenceIntakeUseCases,
    private readonly access: EvidenceAccessUseCases,
    // Reads retain the same org-first repository boundary as mutations.
    @Inject(EVIDENCE_REPOSITORY)
    private readonly repository: EvidenceRepository,
    private readonly storage: SupabaseEvidenceStorageAdapter,
  ) {}

  @RequirePermissions("can_upload_evidence")
  @Post("evidence-uploads")
  @ZodResponse(evidenceUploadInitializationResponseSchema)
  async initialize(
    @Body(zodBody(initializeEvidenceUploadInputSchema))
    input: InitializeEvidenceUploadInput,
    @CurrentUser() user: RequestUser,
  ) {
    const result = await this.intake.initialize({
      organizationId: organizationId(user),
      actorId: user.id,
      productId: input.productIds[0]!,
      title: input.title,
      evidenceClass: input.documentClass,
      ownerUserId: input.ownerUserId,
      applicableProductIds: input.productIds,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      fileName: input.fileName,
      declaredByteSize: input.byteSize,
      idempotencyKey: input.idempotencyKey,
      correlationId: randomUUID(),
    });
    if (
      (result.outcome !== "created" && result.outcome !== "replayed") ||
      !("upload" in result)
    ) {
      throw new NotFoundException({ code: result.outcome });
    }
    const document = await this.documentForVersion(
      organizationId(user),
      user.id,
      input.productIds[0]!,
      result.reservation.versionId,
    );
    return { document, upload: result.upload };
  }

  @RequirePermissions("can_upload_evidence")
  @Post("evidence-documents/:documentId/versions")
  @ZodResponse(evidenceUploadInitializationResponseSchema)
  async replace(
    @Param(zodParams(evidenceDocumentParamsSchema))
    params: { documentId: string },
    @Body(zodBody(createEvidenceReplacementInputSchema))
    input: CreateEvidenceReplacementInput,
    @CurrentUser() user: RequestUser,
  ) {
    if (params.documentId !== input.documentId)
      throw new UnprocessableEntityException({ code: "document_mismatch" });
    const result = await this.intake.initializeReplacement({
      organizationId: organizationId(user),
      actorId: user.id,
      productId: input.productIds[0]!,
      title: input.title,
      evidenceClass: input.documentClass,
      ownerUserId: input.ownerUserId,
      applicableProductIds: input.productIds,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      fileName: input.fileName,
      declaredByteSize: input.byteSize,
      idempotencyKey: input.idempotencyKey,
      correlationId: randomUUID(),
      documentId: input.documentId,
      expectedCurrentVersionId: input.expectedCurrentVersionId,
    });
    if (
      (result.outcome !== "created" && result.outcome !== "replayed") ||
      !("upload" in result)
    )
      throw new UnprocessableEntityException({ code: result.outcome });
    const document = await this.documentForVersion(
      organizationId(user),
      user.id,
      input.productIds[0]!,
      result.reservation.versionId,
    );
    return { document, upload: result.upload };
  }

  @RequirePermissions("can_upload_evidence")
  @Post("evidence-uploads/:versionId/complete")
  @ZodResponse(evidenceUploadCompletionResponseSchema)
  async complete(
    @Param(zodParams(evidenceUploadVersionParamsSchema))
    params: { versionId: string },
    @Body(zodBody(completeEvidenceUploadInputSchema))
    input: CompleteEvidenceUploadInput,
    @CurrentUser() user: RequestUser,
  ) {
    const orgId = organizationId(user);
    const source = await this.repository.getUploadVersion(orgId, {
      actorId: user.id,
      versionId: params.versionId,
    });
    if (!source) throw new NotFoundException({ code: "not_found" });
    const completed = await this.intake.complete({
      organizationId: orgId,
      actorId: user.id,
      versionId: params.versionId,
      objectKey: source.objectKey,
      idempotencyKey: input.idempotencyKey,
    });
    if (completed.outcome !== "queued" && completed.outcome !== "replayed") {
      throw new UnprocessableEntityException({ code: completed.outcome });
    }
    const version = (
      await this.documentForVersion(
        orgId,
        user.id,
        source.productId,
        params.versionId,
      )
    ).currentVersion;
    return {
      completion: {
        outcome: completed.outcome === "queued" ? "scan_pending" : "replayed",
        version,
      },
    };
  }

  @RequirePermissions("can_view_evidence")
  @Get("products/:productId/evidence-documents")
  @ZodResponse(evidenceDocumentListResponseSchema)
  async list(
    @Param(zodParams(evidenceProductParamsSchema))
    params: EvidenceProductParams,
    @Query(zodQuery(evidenceDocumentListQuerySchema))
    query: EvidenceDocumentListQuery,
    @CurrentUser() user: RequestUser,
  ) {
    return this.repository.list(organizationId(user), {
      actorId: user.id,
      productId: params.productId,
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  @RequirePermissions("can_view_evidence")
  @Get("products/:productId/evidence-documents/:documentId/versions")
  @ZodResponse(evidenceDocumentVersionsResponseSchema)
  async versions(
    @Param(
      zodParams(
        evidenceDocumentAccessParamsSchema.pick({
          productId: true,
          documentId: true,
        }),
      ),
    )
    params: { productId: string; documentId: string },
    @CurrentUser() user: RequestUser,
  ) {
    const versions = evidenceDocumentVersionsResponseSchema.safeParse(
      await this.repository.versions(organizationId(user), {
        actorId: user.id,
        productId: params.productId,
        documentId: params.documentId,
      }),
    );
    if (!versions.success) throw new NotFoundException({ code: "not_found" });
    return versions.data;
  }

  @RequirePermissions("can_view_evidence")
  @Post(
    "products/:productId/evidence-documents/:documentId/versions/:versionId/access",
  )
  @ZodResponse(evidenceDocumentAccessResponseSchema)
  async authorizeAccess(
    @Param(zodParams(evidenceDocumentAccessParamsSchema))
    params: { productId: string; documentId: string; versionId: string },
    @Body(zodBody(evidenceDocumentAccessInputSchema))
    input: EvidenceDocumentAccessInput,
    @CurrentUser() user: RequestUser,
  ) {
    const result = await this.access.authorize({
      organizationId: organizationId(user),
      actorId: user.id,
      productId: params.productId,
      documentId: params.documentId,
      versionId: params.versionId,
      disposition: input.disposition,
      purpose: input.purpose ?? null,
    });
    if (result.outcome !== "ready")
      throw new NotFoundException({ code: result.outcome });
    return {
      access: {
        deliveryUrl: `/api/v1/evidence-delivery/${result.token}`,
        expiresAt: result.expiresAt,
        fileName: result.source.fileName,
        mediaType: result.source.mediaType as never,
        disposition: input.disposition,
        previewSupported: result.previewSupported,
      },
    };
  }

  @RequirePermissions("can_view_evidence")
  @Get("evidence-delivery/:token")
  @NonJsonResponse("stream")
  async deliver(
    @Param(zodParams(evidenceDeliveryParamsSchema)) params: { token: string },
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const requestedRange = parseRange(request.headers.range);
    if (requestedRange === "invalid") {
      response.status(416).set("Content-Range", "bytes */*").end();
      return;
    }
    const redeemed = await this.access.redeem({
      organizationId: organizationId(user),
      actorId: user.id,
      token: params.token,
      rangeStart: requestedRange?.start ?? null,
      rangeEnd: requestedRange?.end ?? null,
    });
    if (redeemed.outcome !== "ready")
      throw new NotFoundException({ code: redeemed.outcome });
    const bytes = await this.storage.readVerified(redeemed.source);
    if (!bytes) {
      await this.access.integrityFailure({
        organizationId: organizationId(user),
        actorId: user.id,
        versionId: redeemed.source.versionId,
        correlationId: redeemed.correlationId,
      });
      throw new UnprocessableEntityException({ code: "integrity_failure" });
    }
    const range = requestedRange
      ? {
          start: requestedRange.start,
          end: Math.min(requestedRange.end, bytes.length - 1),
        }
      : null;
    if (range && range.start > range.end) {
      response
        .status(416)
        .set("Content-Range", `bytes */${bytes.length}`)
        .end();
      return;
    }
    const inline =
      redeemed.source.mode === "preview" &&
      (redeemed.source.mediaType === "application/pdf" ||
        redeemed.source.mediaType.startsWith("image/"));
    response.status(range ? 206 : 200).set({
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store, private",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "Content-Type": redeemed.source.mediaType,
      "Content-Disposition": contentDisposition(
        inline,
        redeemed.source.fileName,
      ),
      ...(range
        ? {
            "Content-Range": `bytes ${range.start}-${range.end}/${bytes.length}`,
            "Content-Length": String(range.end - range.start + 1),
          }
        : { "Content-Length": String(bytes.length) }),
    });
    response.send(range ? bytes.subarray(range.start, range.end + 1) : bytes);
  }

  private async documentForVersion(
    organizationId: string,
    actorId: string,
    productId: string,
    versionId: string,
  ) {
    const listed = evidenceDocumentListResponseSchema.safeParse(
      await this.repository.list(organizationId, {
        actorId,
        productId,
        limit: 100,
      }),
    );
    const document = listed.success
      ? listed.data.items.find(
          (item) => item.document.currentVersion.id === versionId,
        )?.document
      : undefined;
    if (!document)
      throw new NotFoundException({ code: "evidence_projection_unavailable" });
    return document;
  }
}

function organizationId(user: RequestUser): string {
  if (!user.organizationId)
    throw new NotFoundException({ code: "organization_required" });
  return user.organizationId;
}
function parseRange(
  value: string | undefined,
): { start: number; end: number } | null | "invalid" {
  if (!value) return null;
  const match = /^bytes=(\d+)-(\d+)$/.exec(value);
  if (!match) return "invalid";
  const start = Number(match[1]);
  const end = Number(match[2]);
  return Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    start <= end
    ? { start, end }
    : "invalid";
}
function contentDisposition(inline: boolean, fileName: string): string {
  const fallback =
    fileName.replace(/[^A-Za-z0-9._ -]/g, "_").replaceAll('"', "_") ||
    "evidence";
  return `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
