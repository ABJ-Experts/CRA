import {
  Body,
  Controller,
  ConflictException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Patch,
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
  evidenceSearchQuerySchema,
  evidenceSearchResponseSchema,
  evidenceExtractedTextParamsSchema,
  evidenceExtractedTextResponseSchema,
  evidenceExtractionRetryParamsSchema,
  evidenceExpiryAlertIntervalsResponseSchema,
  evidenceVersionReuseParamsSchema,
  evidenceVersionReuseResponseSchema,
  retryEvidenceExtractionInputSchema,
  retryEvidenceExtractionResponseSchema,
  type EvidenceSearchQuery,
  type EvidenceExtractedTextParams,
  type EvidenceExtractionRetryParams,
  type RetryEvidenceExtractionInput,
  type EvidenceVersionReuseParams,
  type UpdateEvidenceExpiryAlertIntervalsInput,
  updateEvidenceExpiryAlertIntervalsInputSchema,
  createEvidenceDeletionIntentInputSchema,
  evidenceDeletionIntentResponseSchema,
  evidenceLegalHoldListParamsSchema,
  evidenceLegalHoldListResponseSchema,
  evidenceLegalHoldParamsSchema,
  evidenceRetentionReviewParamsSchema,
  evidenceRetentionReviewResponseSchema,
  placeEvidenceLegalHoldInputSchema,
  placeEvidenceLegalHoldResponseSchema,
  releaseEvidenceLegalHoldInputSchema,
  releaseEvidenceLegalHoldResponseSchema,
  type CreateEvidenceDeletionIntentInput,
  type EvidenceLegalHoldListParams,
  type EvidenceLegalHoldParams,
  type EvidenceRetentionReviewParams,
  type EvidenceRetentionReview,
  type PlaceEvidenceLegalHoldInput,
  type ReleaseEvidenceLegalHoldInput,
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
import { EvidenceTextSearchUseCases } from "./application/evidence-text-search-use-cases";
import { EvidenceReuseValidityUseCases } from "./application/evidence-reuse-validity-use-cases";
import { EvidenceRetentionUseCases } from "./application/evidence-retention-use-cases";

@Controller()
export class EvidenceController {
  constructor(
    private readonly intake: EvidenceIntakeUseCases,
    private readonly access: EvidenceAccessUseCases,
    // Reads retain the same org-first repository boundary as mutations.
    @Inject(EVIDENCE_REPOSITORY)
    private readonly repository: EvidenceRepository,
    private readonly storage: SupabaseEvidenceStorageAdapter,
    private readonly textSearch: EvidenceTextSearchUseCases,
    private readonly reuseValidity: EvidenceReuseValidityUseCases,
    private readonly retention: EvidenceRetentionUseCases,
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
    const result = await this.repository.list(organizationId(user), {
      actorId: user.id,
      productId: params.productId,
      limit: query.limit,
      cursor: query.cursor,
      status: query.status,
      documentClass: query.documentClass,
      validity: query.validity,
    });
    if (!result)
      throw new NotFoundException({ code: "evidence_documents_unavailable" });
    return result;
  }

  @RequirePermissions("can_view_evidence")
  @Get("evidence/:documentId/retention-review")
  @ZodResponse(evidenceRetentionReviewResponseSchema)
  async retentionReview(
    @Param(zodParams(evidenceRetentionReviewParamsSchema))
    params: EvidenceRetentionReviewParams,
    @CurrentUser() user: RequestUser,
  ) {
    const review = await this.retention.review({
      organizationId: organizationId(user),
      actorId: user.id,
      documentId: params.documentId,
    });
    if (!review) throw new NotFoundException({ code: "not_found" });
    return { review: publicRetentionReview(review) };
  }

  @RequirePermissions("can_manage_evidence")
  @Post("evidence/:documentId/deletion-intents")
  @ZodResponse(evidenceDeletionIntentResponseSchema)
  async confirmDeletion(
    @Param(zodParams(evidenceRetentionReviewParamsSchema))
    params: EvidenceRetentionReviewParams,
    @Body(zodBody(createEvidenceDeletionIntentInputSchema))
    input: CreateEvidenceDeletionIntentInput,
    @CurrentUser() user: RequestUser,
  ) {
    const result = await this.retention.confirmDeletion({
      organizationId: organizationId(user),
      actorId: user.id,
      documentId: params.documentId,
      expectedCurrentVersionId: input.expectedCurrentVersionId,
      reviewFingerprint: input.reviewFingerprint,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
    });
    const deletion = asRecord(result.value).deletion ?? result.value;
    if (result.outcome === "queued" || result.outcome === "replayed") {
      const parsed = evidenceDeletionIntentResponseSchema.safeParse({
        outcome: result.outcome,
        deletion,
      });
      if (parsed.success) return parsed.data;
      throw new ConflictException({ code: "deletion_intent_unavailable" });
    }
    throw retentionMutationException(result.outcome);
  }

  @RequirePermissions("can_view_evidence")
  @Get("evidence/:documentId/legal-holds")
  @ZodResponse(evidenceLegalHoldListResponseSchema)
  async legalHolds(
    @Param(zodParams(evidenceLegalHoldListParamsSchema))
    params: EvidenceLegalHoldListParams,
    @CurrentUser() user: RequestUser,
  ) {
    const legalHolds = evidenceLegalHoldListResponseSchema.safeParse(
      await this.retention.legalHolds({
        organizationId: organizationId(user),
        actorId: user.id,
        documentId: params.documentId,
      }),
    );
    if (!legalHolds.success) throw new NotFoundException({ code: "not_found" });
    return legalHolds.data;
  }

  @RequirePermissions("can_manage_evidence")
  @Post("evidence/:documentId/legal-holds")
  @ZodResponse(placeEvidenceLegalHoldResponseSchema)
  async placeLegalHold(
    @Param(zodParams(evidenceLegalHoldListParamsSchema))
    params: EvidenceLegalHoldListParams,
    @Body(zodBody(placeEvidenceLegalHoldInputSchema))
    input: PlaceEvidenceLegalHoldInput,
    @CurrentUser() user: RequestUser,
  ) {
    const result = await this.retention.placeLegalHold({
      organizationId: organizationId(user),
      actorId: user.id,
      documentId: params.documentId,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
    });
    const legalHold = asRecord(result.value).legalHold ?? result.value;
    if (result.outcome === "placed" || result.outcome === "replayed") {
      const parsed = placeEvidenceLegalHoldResponseSchema.safeParse({
        outcome: result.outcome,
        legalHold,
      });
      if (parsed.success) return parsed.data;
      throw new ConflictException({ code: "legal_hold_unavailable" });
    }
    throw retentionMutationException(result.outcome);
  }

  @RequirePermissions("can_manage_evidence")
  @Post("evidence/:documentId/legal-holds/:holdId/release")
  @ZodResponse(releaseEvidenceLegalHoldResponseSchema)
  async releaseLegalHold(
    @Param(zodParams(evidenceLegalHoldParamsSchema))
    params: EvidenceLegalHoldParams,
    @Body(zodBody(releaseEvidenceLegalHoldInputSchema))
    input: ReleaseEvidenceLegalHoldInput,
    @CurrentUser() user: RequestUser,
  ) {
    const result = await this.retention.releaseLegalHold({
      organizationId: organizationId(user),
      actorId: user.id,
      documentId: params.documentId,
      holdId: params.holdId,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
    });
    const legalHold = asRecord(result.value).legalHold ?? result.value;
    if (result.outcome === "released" || result.outcome === "replayed") {
      const parsed = releaseEvidenceLegalHoldResponseSchema.safeParse({
        outcome: result.outcome,
        legalHold,
      });
      if (parsed.success) return parsed.data;
      throw new ConflictException({ code: "legal_hold_unavailable" });
    }
    throw retentionMutationException(result.outcome);
  }

  @RequirePermissions("can_view_evidence")
  @Get("products/:productId/evidence-search")
  @ZodResponse(evidenceSearchResponseSchema)
  async search(
    @Param(zodParams(evidenceProductParamsSchema))
    params: EvidenceProductParams,
    @Query(zodQuery(evidenceSearchQuerySchema)) query: EvidenceSearchQuery,
    @CurrentUser() user: RequestUser,
  ) {
    const result = await this.textSearch.search({
      organizationId: organizationId(user),
      actorId: user.id,
      productId: params.productId,
      query,
    });
    if (!result)
      throw new NotFoundException({ code: "evidence_search_unavailable" });
    return result;
  }

  @RequirePermissions("can_view_evidence")
  @Get(
    "products/:productId/evidence-documents/:documentId/versions/:versionId/extracted-text",
  )
  @ZodResponse(evidenceExtractedTextResponseSchema)
  async extractedText(
    @Param(zodParams(evidenceExtractedTextParamsSchema))
    params: EvidenceExtractedTextParams,
    @CurrentUser() user: RequestUser,
  ) {
    const result = await this.textSearch.extractedText({
      organizationId: organizationId(user),
      actorId: user.id,
      ...params,
    });
    if (!result)
      throw new NotFoundException({ code: "extraction_unavailable" });
    return result;
  }

  @RequirePermissions("can_view_evidence")
  @Get(
    "products/:productId/evidence-documents/:documentId/versions/:versionId/reuse",
  )
  @ZodResponse(evidenceVersionReuseResponseSchema)
  async reuse(
    @Param(zodParams(evidenceVersionReuseParamsSchema))
    params: EvidenceVersionReuseParams,
    @CurrentUser() user: RequestUser,
  ) {
    const reuse = await this.reuseValidity.reuse({
      organizationId: organizationId(user),
      actorId: user.id,
      ...params,
    });
    if (!reuse)
      throw new NotFoundException({ code: "evidence_reuse_unavailable" });
    return reuse;
  }

  @RequirePermissions("can_edit_organization")
  @Get("evidence-expiry-alert-intervals")
  @ZodResponse(evidenceExpiryAlertIntervalsResponseSchema)
  async expiryAlertIntervals(@CurrentUser() user: RequestUser) {
    const result = await this.reuseValidity.expiryAlertIntervals({
      organizationId: organizationId(user),
      actorId: user.id,
    });
    if (!result)
      throw new NotFoundException({ code: "expiry_alerts_unavailable" });
    return result;
  }

  @RequirePermissions("can_edit_organization")
  @Patch("evidence-expiry-alert-intervals")
  @ZodResponse(evidenceExpiryAlertIntervalsResponseSchema)
  async updateExpiryAlertIntervals(
    @Body(zodBody(updateEvidenceExpiryAlertIntervalsInputSchema))
    input: UpdateEvidenceExpiryAlertIntervalsInput,
    @CurrentUser() user: RequestUser,
  ) {
    const result = await this.reuseValidity.updateExpiryAlertIntervals({
      organizationId: organizationId(user),
      actorId: user.id,
      input,
    });
    if (result.outcome === "updated") return result.value;
    if (result.outcome === "forbidden")
      throw new NotFoundException({ code: "expiry_alerts_unavailable" });
    if (result.outcome === "not_found")
      throw new NotFoundException({ code: "organization_required" });
    throw new ConflictException({ code: "expiry_alert_intervals_conflict" });
  }

  @RequirePermissions("can_upload_evidence")
  @Post(
    "products/:productId/evidence-documents/:documentId/versions/:versionId/extraction/retry",
  )
  @ZodResponse(retryEvidenceExtractionResponseSchema)
  async retryExtraction(
    @Param(zodParams(evidenceExtractionRetryParamsSchema))
    params: EvidenceExtractionRetryParams,
    @Body(zodBody(retryEvidenceExtractionInputSchema))
    input: RetryEvidenceExtractionInput,
    @CurrentUser() user: RequestUser,
  ) {
    const result = await this.textSearch.retry({
      organizationId: organizationId(user),
      actorId: user.id,
      ...params,
      retry: input,
    });
    if (!result)
      throw new NotFoundException({ code: "extraction_unavailable" });
    return result;
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
function publicRetentionReview(
  review: EvidenceRetentionReview &
    Readonly<{ linkedProductIds: readonly string[] }>,
): EvidenceRetentionReview {
  return {
    documentId: review.documentId,
    currentVersionId: review.currentVersionId,
    lifecycle: review.lifecycle,
    reviewedAt: review.reviewedAt,
    reviewFingerprint: review.reviewFingerprint,
    eligibleForDeletion: review.eligibleForDeletion,
    blockers: review.blockers,
    protection: review.protection,
  };
}
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}
function retentionMutationException(
  outcome:
    | "placed"
    | "released"
    | "queued"
    | "replayed"
    | "idempotency_mismatch"
    | "forbidden"
    | "not_found"
    | "conflict"
    | "blocked"
    | "invalid_request",
): Error {
  if (
    outcome === "placed" ||
    outcome === "released" ||
    outcome === "queued" ||
    outcome === "replayed"
  )
    return new ConflictException({ code: "evidence_retention_conflict" });
  if (outcome === "not_found" || outcome === "forbidden")
    return new NotFoundException({ code: "not_found" });
  if (outcome === "invalid_request")
    return new UnprocessableEntityException({
      code: "invalid_retention_request",
    });
  return new ConflictException({
    code:
      outcome === "blocked"
        ? "evidence_retention_blocked"
        : outcome === "idempotency_mismatch"
          ? "idempotency_mismatch"
          : "evidence_retention_conflict",
  });
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
