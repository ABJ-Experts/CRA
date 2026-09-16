import { Body, Controller, Get, Inject, NotFoundException, Param, Post, Query, UnprocessableEntityException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  completeEvidenceUploadInputSchema,
  evidenceDocumentListQuerySchema,
  evidenceDocumentVersionParamsSchema,
  evidenceProductParamsSchema,
  initializeEvidenceUploadInputSchema,
  type CompleteEvidenceUploadInput,
  type EvidenceDocumentListQuery,
  type EvidenceDocumentVersionParams,
  type EvidenceProductParams,
  type InitializeEvidenceUploadInput,
  evidenceDocumentListResponseSchema,
  evidenceOriginalDownloadResponseSchema,
  evidenceUploadCompletionResponseSchema,
  evidenceUploadInitializationResponseSchema,
  evidenceUploadVersionParamsSchema,
} from "@repo/contracts/evidence";
import { CurrentUser, RequirePermissions, type RequestUser } from "../auth/auth.types";
import { zodBody, zodParams, zodQuery } from "../common/pipes/zod-validation.pipe";
import { ZodResponse } from "../common/http/zod-response.interceptor";
import { EvidenceIntakeUseCases, EVIDENCE_REPOSITORY, type EvidenceRepository } from "./application/evidence-intake-use-cases";
import { SupabaseEvidenceStorageAdapter } from "./infrastructure/supabase-evidence-storage.adapter";

@Controller()
export class EvidenceController {
  constructor(
    private readonly intake: EvidenceIntakeUseCases,
    // Reads retain the same org-first repository boundary as mutations.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @Inject(EVIDENCE_REPOSITORY) private readonly repository: EvidenceRepository,
    private readonly storage: SupabaseEvidenceStorageAdapter,
  ) {}

  @RequirePermissions("can_upload_evidence")
  @Post("evidence-uploads")
  @ZodResponse(evidenceUploadInitializationResponseSchema)
  async initialize(@Body(zodBody(initializeEvidenceUploadInputSchema)) input: InitializeEvidenceUploadInput, @CurrentUser() user: RequestUser) {
    const result = await this.intake.initialize({ organizationId: organizationId(user), actorId: user.id, productId: input.productIds[0]!, title: input.title, evidenceClass: input.documentClass, ownerUserId: input.ownerUserId, applicableProductIds: input.productIds, validFrom: input.validFrom, validUntil: input.validUntil, fileName: input.fileName, declaredByteSize: input.byteSize, idempotencyKey: input.idempotencyKey, correlationId: randomUUID() });
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
  @Post("evidence-uploads/:versionId/complete")
  @ZodResponse(evidenceUploadCompletionResponseSchema)
  async complete(@Param(zodParams(evidenceUploadVersionParamsSchema)) params: { versionId: string }, @Body(zodBody(completeEvidenceUploadInputSchema)) input: CompleteEvidenceUploadInput, @CurrentUser() user: RequestUser) {
    const orgId = organizationId(user);
    const source = await this.repository.getUploadVersion(orgId, { actorId: user.id, versionId: params.versionId });
    if (!source) throw new NotFoundException({ code: "not_found" });
    const completed = await this.intake.complete({ organizationId: orgId, actorId: user.id, versionId: params.versionId, objectKey: source.objectKey, idempotencyKey: input.idempotencyKey });
    if (completed.outcome !== "queued" && completed.outcome !== "replayed") {
      throw new UnprocessableEntityException({ code: completed.outcome });
    }
    const version = (await this.documentForVersion(orgId, user.id, source.productId, params.versionId)).currentVersion;
    return { completion: { outcome: completed.outcome === "queued" ? "scan_pending" : "replayed", version } };
  }

  @RequirePermissions("can_view_evidence")
  @Get("products/:productId/evidence-documents")
  @ZodResponse(evidenceDocumentListResponseSchema)
  async list(@Param(zodParams(evidenceProductParamsSchema)) params: EvidenceProductParams, @Query(zodQuery(evidenceDocumentListQuerySchema)) query: EvidenceDocumentListQuery, @CurrentUser() user: RequestUser) {
    return this.repository.list(organizationId(user), { actorId: user.id, productId: params.productId, limit: query.limit, cursor: query.cursor });
  }

  @RequirePermissions("can_view_evidence")
  @Get("evidence-documents/:documentId/versions/:versionId/download")
  @ZodResponse(evidenceOriginalDownloadResponseSchema)
  async download(@Param(zodParams(evidenceDocumentVersionParamsSchema)) params: EvidenceDocumentVersionParams, @CurrentUser() user: RequestUser) {
    const source = await this.repository.download(organizationId(user), { actorId: user.id, documentId: params.documentId, versionId: params.versionId, correlationId: randomUUID() });
    if (!source) throw new NotFoundException({ code: "not_found_or_not_clean" });
    return { download: await this.storage.createSignedDownload({ objectKey: source.objectKey, fileName: source.fileName, contentType: source.mediaType }) };
  }

  private async documentForVersion(
    organizationId: string,
    actorId: string,
    productId: string,
    versionId: string,
  ) {
    const listed = evidenceDocumentListResponseSchema.safeParse(
      await this.repository.list(organizationId, { actorId, productId, limit: 100 }),
    );
    const document = listed.success
      ? listed.data.items.find((item) => item.document.currentVersion.id === versionId)?.document
      : undefined;
    if (!document) throw new NotFoundException({ code: "evidence_projection_unavailable" });
    return document;
  }
}

function organizationId(user: RequestUser): string { if (!user.organizationId) throw new NotFoundException({ code: "organization_required" }); return user.organizationId; }
