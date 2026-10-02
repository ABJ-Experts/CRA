import { createHash, randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { SupabaseService } from "../../supabase/supabase.service";
import {
  evidenceDocumentListResponseSchema,
  evidenceExtractedTextResponseSchema,
  evidenceExpiryAlertIntervalsResponseSchema,
  evidenceRetentionReviewResponseSchema,
  evidenceSearchResponseSchema,
  evidenceVersionReuseResponseSchema,
  retryEvidenceExtractionResponseSchema,
  type EvidenceExpiryAlertIntervalsResponse,
  type EvidenceExtractedTextResponse,
  type EvidenceSearchQuery,
  type EvidenceSearchResponse,
  type EvidenceVersionReuseResponse,
  type EvidenceRetentionBlocker,
  type RetryEvidenceExtractionInput,
  type RetryEvidenceExtractionResponse,
  type UpdateEvidenceExpiryAlertIntervalsInput,
  evidenceWatermarkExportSchema,
  type EvidenceWatermarkExport,
} from "@repo/contracts/evidence";
import type {
  EvidenceRepository,
  EvidenceReservation,
} from "../application/evidence-intake-use-cases";
import type {
  EvidenceAccessRepository,
  EvidenceAccessSource,
} from "../application/evidence-access-use-cases";
import type { EvidenceTextSearchRepository } from "../application/evidence-text-search-use-cases";
import type { EvidenceReuseValidityRepository } from "../application/evidence-reuse-validity-use-cases";
import type {
  EvidenceRetentionMutationResult,
  EvidenceRetentionRepository,
  EvidenceRetentionReview,
} from "../application/evidence-retention-use-cases";
import type {
  BulkIntakeCreateItem,
  BulkIntakeMutation,
  EvidenceBulkIntakeRepository,
} from "../application/evidence-bulk-intake-use-cases";
import {
  evidenceWatermarkExportRequestDigest,
  type EvidenceWatermarkExportClaim,
  type EvidenceWatermarkExportRepository,
} from "../application/evidence-watermark-export-use-cases";

type Rpc = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message?: string } | null }>;
};
type Row = Readonly<{ outcome?: unknown; result?: unknown }>;
type WatermarkCreateResult = Awaited<
  ReturnType<EvidenceWatermarkExportRepository["createWatermarkExport"]>
>;
type WatermarkPreviewResult = Awaited<
  ReturnType<EvidenceWatermarkExportRepository["createWatermarkPreviewAccess"]>
>;
type WatermarkDeliveryResult = Awaited<
  ReturnType<EvidenceWatermarkExportRepository["createWatermarkDeliveryAccess"]>
>;
type WatermarkRedeemResult = Awaited<
  ReturnType<EvidenceWatermarkExportRepository["redeemWatermarkDelivery"]>
>;

@Injectable()
export class SupabaseEvidenceRepository
  implements
    EvidenceRepository,
    EvidenceAccessRepository,
    EvidenceTextSearchRepository,
    EvidenceReuseValidityRepository,
    EvidenceRetentionRepository,
    EvidenceBulkIntakeRepository,
    EvidenceWatermarkExportRepository
{
  constructor(private readonly supabase: SupabaseService) {}
  private client(): Rpc {
    return this.supabase.admin() as unknown as Rpc;
  }

  async reserve(
    organizationId: string,
    input: Parameters<EvidenceRepository["reserve"]>[1],
  ) {
    const objectKey = `${organizationId}/${randomUUID()}/${randomUUID()}/${randomUUID()}`;
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    const response = await this.client().rpc(
      "reserve_evidence_document_upload_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_title: input.title,
        p_document_class: input.evidenceClass,
        p_owner_user_id: input.ownerUserId,
        p_product_ids: [...input.applicableProductIds],
        p_validity_starts_on: dateOnly(input.validFrom),
        p_validity_ends_on: dateOnly(input.validUntil),
        p_original_filename: input.fileName,
        p_declared_size_bytes: input.declaredByteSize,
        p_object_key: objectKey,
        p_upload_expires_at: expiresAt,
        p_idempotency_key: input.idempotencyKey,
        p_request_digest: requestDigest(input),
      },
    );
    if (response.error) return { outcome: "conflict" as const };
    const row = firstRow(response.data);
    const result = asObject(row?.result);
    if (row?.outcome === "reserved" || row?.outcome === "replayed") {
      const reservation: EvidenceReservation = Object.freeze({
        documentId: stringAt(result, "documentId"),
        versionId: stringAt(result, "versionId"),
        objectKey: stringAt(result, "objectKey"),
        expiresAt: stringAt(result, "uploadExpiresAt"),
        state: "uploading",
      });
      return {
        outcome:
          row.outcome === "reserved"
            ? ("created" as const)
            : ("replayed" as const),
        reservation,
      };
    }
    return {
      outcome:
        row?.outcome === "idempotency_conflict"
          ? ("idempotency_mismatch" as const)
          : row?.outcome === "not_found"
            ? ("not_found" as const)
            : ("invalid_request" as const),
    };
  }

  async createBatch(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      items: readonly BulkIntakeCreateItem[];
      idempotencyKey: string;
    }>,
  ) {
    const response = await this.client().rpc(
      "create_evidence_bulk_intake_batch_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_product_id: input.productId,
        p_items: input.items,
        p_idempotency_key: input.idempotencyKey,
      },
    );
    return bulkMutation(response, ["created", "replayed"]);
  }

  async batch(
    organizationId: string,
    input: Readonly<{ actorId: string; productId: string; batchId: string }>,
  ) {
    const response = await this.client().rpc(
      "get_evidence_bulk_intake_batch_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_product_id: input.productId,
        p_batch_id: input.batchId,
      },
    );
    return bulkMutation(response, ["found"]);
  }

  async initializeItem(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      batchId: string;
      itemId: string;
      idempotencyKey: string;
      documentClass: string;
      classificationDecision: "accepted" | "corrected";
      objectKey: string;
      uploadExpiresAt: string;
      requestDigest: string;
    }>,
  ) {
    const response = await this.client().rpc(
      "initialize_evidence_bulk_intake_item_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_product_id: input.productId,
        p_batch_id: input.batchId,
        p_item_id: input.itemId,
        p_document_class: input.documentClass,
        p_classification_decision: input.classificationDecision,
        p_object_key: input.objectKey,
        p_upload_expires_at: input.uploadExpiresAt,
        p_idempotency_key: input.idempotencyKey,
        p_request_digest: input.requestDigest,
      },
    );
    return bulkMutation(response, ["reserved", "replayed"]);
  }

  async getUploadItem(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      batchId: string;
      itemId: string;
    }>,
  ) {
    const response = await this.client().rpc(
      "get_evidence_bulk_intake_item_upload_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_product_id: input.productId,
        p_batch_id: input.batchId,
        p_item_id: input.itemId,
      },
    );
    const row = firstRow(response.data);
    const result = asObject(row?.result);
    if (response.error || row?.outcome !== "found") return null;
    const objectKey = stringValue(result.objectKey);
    const versionId = stringValue(result.versionId);
    const declaredByteSize = numberValue(result.declaredByteSize);
    return objectKey && versionId && declaredByteSize !== null
      ? { objectKey, versionId, declaredByteSize }
      : null;
  }

  async completeItem(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      batchId: string;
      itemId: string;
      versionId: string;
      idempotencyKey: string;
      sha256: string | null;
      byteSize: number | null;
      mediaType: string | null;
      failureCode: string | null;
      requestDigest: string;
    }>,
  ) {
    const response = await this.client().rpc(
      "complete_evidence_bulk_intake_item_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_product_id: input.productId,
        p_batch_id: input.batchId,
        p_item_id: input.itemId,
        p_version_id: input.versionId,
        p_actual_size_bytes: input.byteSize,
        p_detected_media_type: input.mediaType,
        p_original_sha256: input.sha256,
        p_failure_code: input.failureCode,
        p_idempotency_key: input.idempotencyKey,
        p_request_digest: input.requestDigest,
      },
    );
    return bulkMutation(response, ["scan_pending", "failed", "replayed"]);
  }

  async cancelItem(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      batchId: string;
      itemId: string;
      idempotencyKey: string;
    }>,
  ) {
    const response = await this.client().rpc(
      "cancel_evidence_bulk_intake_item_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_product_id: input.productId,
        p_batch_id: input.batchId,
        p_item_id: input.itemId,
        p_idempotency_key: input.idempotencyKey,
      },
    );
    return bulkMutation(response, ["cancelled", "replayed"]);
  }

  async retryItem(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      batchId: string;
      itemId: string;
      idempotencyKey: string;
      documentClass: string;
      classificationDecision: "accepted" | "corrected";
      fileName: string;
      declaredByteSize: number;
      objectKey: string;
      uploadExpiresAt: string;
      requestDigest: string;
    }>,
  ) {
    const response = await this.client().rpc(
      "retry_evidence_bulk_intake_item_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_product_id: input.productId,
        p_batch_id: input.batchId,
        p_item_id: input.itemId,
        p_document_class: input.documentClass,
        p_classification_decision: input.classificationDecision,
        p_original_filename: input.fileName,
        p_declared_size_bytes: input.declaredByteSize,
        p_object_key: input.objectKey,
        p_upload_expires_at: input.uploadExpiresAt,
        p_idempotency_key: input.idempotencyKey,
        p_request_digest: input.requestDigest,
      },
    );
    return bulkMutation(response, ["reserved", "replayed"]);
  }

  async reserveReplacement(
    organizationId: string,
    input: Parameters<EvidenceRepository["reserveReplacement"]>[1],
  ) {
    const objectKey = `${organizationId}/${input.documentId}/${randomUUID()}/${randomUUID()}`;
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    const response = await this.client().rpc(
      "reserve_evidence_document_replacement_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_document_id: input.documentId,
        p_expected_current_version_id: input.expectedCurrentVersionId,
        p_title: input.title,
        p_document_class: input.evidenceClass,
        p_owner_user_id: input.ownerUserId,
        p_product_ids: [...input.applicableProductIds],
        p_validity_starts_on: dateOnly(input.validFrom),
        p_validity_ends_on: dateOnly(input.validUntil),
        p_original_filename: input.fileName,
        p_declared_size_bytes: input.declaredByteSize,
        p_object_key: objectKey,
        p_upload_expires_at: expiresAt,
        p_idempotency_key: input.idempotencyKey,
        p_request_digest: requestDigest(input),
      },
    );
    if (response.error) return { outcome: "conflict" as const };
    const row = firstRow(response.data);
    const result = asObject(row?.result);
    if (row?.outcome === "reserved" || row?.outcome === "replayed") {
      const reservation: EvidenceReservation = Object.freeze({
        documentId: stringAt(result, "documentId"),
        versionId: stringAt(result, "versionId"),
        objectKey: stringAt(result, "objectKey"),
        expiresAt: stringAt(result, "uploadExpiresAt"),
        state: "uploading",
      });
      return {
        outcome:
          row.outcome === "reserved"
            ? ("created" as const)
            : ("replayed" as const),
        reservation,
      };
    }
    return {
      outcome:
        row?.outcome === "idempotency_conflict"
          ? ("idempotency_mismatch" as const)
          : row?.outcome === "not_found"
            ? ("not_found" as const)
            : ("invalid_request" as const),
    };
  }

  async finalize(
    organizationId: string,
    input: Parameters<EvidenceRepository["finalize"]>[1],
  ) {
    const response = await this.client().rpc(
      "finalize_evidence_document_upload_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_version_id: input.versionId,
        p_actual_size_bytes: input.byteSize,
        p_detected_media_type: input.mediaType,
        p_original_sha256: input.sha256,
        p_idempotency_key: input.idempotencyKey,
        p_request_digest: requestDigest(input),
      },
    );
    if (response.error) return { outcome: "conflict" as const };
    const row = firstRow(response.data);
    const state = stringAt(asObject(row?.result), "state") as
      "uploading" | "scan_pending" | "clean" | "quarantined" | "failed";
    if (row?.outcome === "scan_pending")
      return { outcome: "queued" as const, state };
    if (row?.outcome === "failed") return { outcome: "failed" as const, state };
    if (row?.outcome === "replayed")
      return { outcome: "replayed" as const, state };
    return {
      outcome:
        row?.outcome === "idempotency_conflict"
          ? ("idempotency_mismatch" as const)
          : ("not_found" as const),
    };
  }

  async getUploadVersion(
    orgId: string,
    input: Readonly<{ actorId: string; versionId: string }>,
  ) {
    const client = this.supabase.admin() as unknown as {
      from(table: string): {
        select(columns: string): {
          eq(
            column: string,
            value: string,
          ): {
            eq(
              column: string,
              value: string,
            ): {
              maybeSingle(): Promise<{ data: unknown; error: unknown }>;
              limit(value: number): Promise<{ data: unknown; error: unknown }>;
            };
          };
        };
      };
    };
    const response = await client
      .from("evidence_document_versions")
      .select("object_key")
      .eq("organization_id", orgId)
      .eq("id", input.versionId)
      .maybeSingle();
    const row = asObject(response.data);
    if (typeof row.object_key !== "string") return null;
    const products = await client
      .from("evidence_document_version_products")
      .select("product_id")
      .eq("organization_id", orgId)
      .eq("version_id", input.versionId)
      .limit(1);
    const productId = asObject(
      Array.isArray(products.data) ? products.data[0] : null,
    ).product_id;
    return typeof productId === "string"
      ? { objectKey: row.object_key, productId }
      : null;
  }

  async list(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      limit: number;
      cursor?: string;
      status?: string;
      documentClass?: string;
      validity?: string;
    }>,
  ) {
    const cursor = decodeListCursor(input.cursor);
    if (input.cursor && !cursor) return null;
    const response = await this.client().rpc("list_evidence_documents", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_product_id: input.productId,
      p_status: input.status ?? null,
      p_document_class: input.documentClass ?? null,
      p_validity_status: input.validity ?? null,
      p_cursor_created_at: cursor?.createdAt ?? null,
      p_cursor_id: cursor?.id ?? null,
      p_limit: input.limit,
    });
    if (response.error) return null;
    const parsed = evidenceDocumentListResponseSchema.safeParse(response.data);
    return parsed.success ? parsed.data : null;
  }

  async search(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      query: EvidenceSearchQuery;
    }>,
  ): Promise<EvidenceSearchResponse | null> {
    const cursor = decodeSearchCursor(input.query.cursor, input.query);
    if (input.query.cursor && !cursor) return null;
    const response = await this.client().rpc(
      "search_evidence_documents_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_product_id: input.productId,
        p_query: input.query.q,
        p_document_class: input.query.documentClass ?? null,
        p_include_historical: input.query.includeHistorical,
        p_limit: input.query.limit,
        p_after_rank: cursor?.rank ?? null,
        p_after_created_at: cursor?.createdAt ?? null,
        p_after_version_id: cursor?.versionId ?? null,
      },
    );
    const row = firstRow(response.data);
    const result = asObject(row?.result);
    if (response.error || row?.outcome !== "found") return null;
    const items = Array.isArray(result.items)
      ? result.items.map((item) =>
          mapSearchResult(asObject(item), input.query.q),
        )
      : [];
    const rawItems = Array.isArray(result.items) ? result.items : [];
    const last =
      rawItems.length === input.query.limit
        ? asObject(rawItems.at(-1)).cursor
        : null;
    const output = {
      results: items,
      totalCount: numberValue(result.total) ?? 0,
      facets: Array.isArray(result.facets) ? result.facets : [],
      coverage: asObject(result.coverage),
      nextCursor: last ? encodeSearchCursor(asObject(last), input.query) : null,
    };
    const parsed = evidenceSearchResponseSchema.safeParse(output);
    return parsed.success ? parsed.data : null;
  }

  async extractedText(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      documentId: string;
      versionId: string;
    }>,
  ): Promise<EvidenceExtractedTextResponse | null> {
    const response = await this.client().rpc(
      "get_evidence_document_extracted_text_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_product_id: input.productId,
        p_document_id: input.documentId,
        p_version_id: input.versionId,
      },
    );
    const row = firstRow(response.data);
    const result = asObject(row?.result);
    if (
      response.error ||
      !row ||
      !["found", "unavailable"].includes(String(row.outcome))
    )
      return null;
    const metadata = mapExtraction(result);
    const output = {
      extractedText: {
        documentId: stringValue(result.documentId) ?? input.documentId,
        versionId: stringValue(result.versionId) ?? input.versionId,
        extraction: metadata,
        snippet:
          row.outcome === "found"
            ? snippet(stringValue(result.snippetText) ?? "")
            : null,
      },
    };
    const parsed = evidenceExtractedTextResponseSchema.safeParse(output);
    return parsed.success ? parsed.data : null;
  }

  async retryExtraction(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      documentId: string;
      versionId: string;
      retry: RetryEvidenceExtractionInput;
    }>,
  ): Promise<RetryEvidenceExtractionResponse | null> {
    const response = await this.client().rpc(
      "retry_evidence_text_extraction_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_product_id: input.productId,
        p_document_id: input.documentId,
        p_version_id: input.versionId,
      },
    );
    const row = firstRow(response.data);
    const result = asObject(row?.result);
    if (
      response.error ||
      !row ||
      !["queued", "replayed"].includes(String(row.outcome))
    )
      return null;
    const parsed = retryEvidenceExtractionResponseSchema.safeParse({
      extraction: mapExtraction(result),
    });
    return parsed.success ? parsed.data : null;
  }

  async reuse(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      documentId: string;
      versionId: string;
    }>,
  ): Promise<EvidenceVersionReuseResponse | null> {
    const response = await this.client().rpc(
      "get_evidence_document_reuse_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_product_id: input.productId,
        p_document_id: input.documentId,
        p_version_id: input.versionId,
      },
    );
    const row = firstRow(response.data);
    if (response.error || row?.outcome !== "found") return null;
    const parsed = evidenceVersionReuseResponseSchema.safeParse({
      reuse: asObject(row.result),
    });
    return parsed.success ? parsed.data : null;
  }

  async expiryAlertIntervals(
    organizationId: string,
    input: Readonly<{ actorId: string }>,
  ): Promise<EvidenceExpiryAlertIntervalsResponse | null> {
    const response = await this.client().rpc(
      "get_evidence_expiry_alert_intervals_atomic",
      { p_organization_id: organizationId, p_actor_user_id: input.actorId },
    );
    const row = firstRow(response.data);
    if (response.error || row?.outcome !== "found") return null;
    const parsed = evidenceExpiryAlertIntervalsResponseSchema.safeParse({
      expiryAlertIntervals: asObject(row.result),
    });
    return parsed.success ? parsed.data : null;
  }

  async updateExpiryAlertIntervals(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      input: UpdateEvidenceExpiryAlertIntervalsInput;
    }>,
  ) {
    const response = await this.client().rpc(
      "update_evidence_expiry_alert_intervals_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_expected_version: input.input.expectedVersion,
        p_threshold_days: [...input.input.thresholdDays],
        p_idempotency_key: input.input.idempotencyKey,
      },
    );
    const row = firstRow(response.data);
    if (response.error) return { outcome: "conflict" as const };
    if (row?.outcome === "updated" || row?.outcome === "replayed") {
      const parsed = evidenceExpiryAlertIntervalsResponseSchema.safeParse({
        expiryAlertIntervals: asObject(row.result),
      });
      return parsed.success
        ? { outcome: "updated" as const, value: parsed.data }
        : { outcome: "conflict" as const };
    }
    if (row?.outcome === "forbidden") return { outcome: "forbidden" as const };
    if (row?.outcome === "not_found") return { outcome: "not_found" as const };
    return { outcome: "conflict" as const };
  }

  async retentionReview(
    organizationId: string,
    input: Readonly<{ actorId: string; documentId: string }>,
  ): Promise<EvidenceRetentionReview | null> {
    const response = await this.client().rpc(
      "get_evidence_document_retention_review_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_document_id: input.documentId,
      },
    );
    const row = firstRow(response.data);
    if (response.error || row?.outcome !== "found") return null;
    return retentionReview(asObject(row.result));
  }

  async legalHolds(
    organizationId: string,
    input: Readonly<{ actorId: string; documentId: string }>,
  ): Promise<Readonly<{ legalHolds: readonly unknown[] }> | null> {
    const response = await this.client().rpc(
      "list_evidence_document_legal_holds_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_document_id: input.documentId,
      },
    );
    const row = firstRow(response.data);
    if (response.error || row?.outcome !== "found") return null;
    const result = asObject(row.result);
    return Array.isArray(result.legalHolds)
      ? { legalHolds: result.legalHolds }
      : null;
  }

  async placeLegalHold(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      documentId: string;
      reason: string;
      idempotencyKey: string;
    }>,
  ): Promise<EvidenceRetentionMutationResult> {
    const response = await this.client().rpc(
      "place_evidence_document_legal_hold_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_document_id: input.documentId,
        p_reason: input.reason,
        p_idempotency_key: input.idempotencyKey,
      },
    );
    return retentionMutation(response, ["placed", "replayed"]);
  }

  async releaseLegalHold(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      documentId: string;
      holdId: string;
      reason: string;
      idempotencyKey: string;
    }>,
  ): Promise<EvidenceRetentionMutationResult> {
    const response = await this.client().rpc(
      "release_evidence_document_legal_hold_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_document_id: input.documentId,
        p_hold_id: input.holdId,
        p_reason: input.reason,
        p_idempotency_key: input.idempotencyKey,
      },
    );
    return retentionMutation(response, ["released", "replayed"]);
  }

  async confirmDeletion(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      documentId: string;
      expectedCurrentVersionId: string;
      reviewFingerprint: string;
      reason: string;
      idempotencyKey: string;
    }>,
  ): Promise<EvidenceRetentionMutationResult> {
    const response = await this.client().rpc(
      "confirm_evidence_document_deletion_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_document_id: input.documentId,
        p_expected_current_version_id: input.expectedCurrentVersionId,
        p_review_fingerprint: input.reviewFingerprint,
        p_reason: input.reason,
        p_idempotency_key: input.idempotencyKey,
      },
    );
    return retentionMutation(response, ["queued", "replayed"]);
  }

  async createWatermarkExport(
    organizationId: string,
    input: Parameters<
      EvidenceWatermarkExportRepository["createWatermarkExport"]
    >[1],
  ): Promise<WatermarkCreateResult> {
    const response = await this.client().rpc(
      "create_evidence_document_watermark_export_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_product_id: input.productId,
        p_document_id: input.documentId,
        p_version_id: input.versionId,
        p_recipient: input.recipient,
        p_purpose: input.purpose,
        p_idempotency_key: input.idempotencyKey,
        p_request_digest: evidenceWatermarkExportRequestDigest({
          productId: input.productId,
          documentId: input.documentId,
          versionId: input.versionId,
          recipient: input.recipient,
          purpose: input.purpose,
        }),
      },
    );
    const row = firstRow(response.data);
    const exportRecord = watermarkExport(asObject(row?.result));
    if (
      !response.error &&
      exportRecord &&
      (row?.outcome === "queued" || row?.outcome === "replayed")
    )
      return {
        outcome: row.outcome === "queued" ? "queued" : "replayed",
        export: exportRecord,
      };
    return { outcome: watermarkMutationOutcome(row?.outcome) };
  }

  async getWatermarkExport(
    organizationId: string,
    input: Parameters<
      EvidenceWatermarkExportRepository["getWatermarkExport"]
    >[1],
  ): Promise<EvidenceWatermarkExport | null> {
    const response = await this.client().rpc(
      "get_evidence_document_watermark_export_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_product_id: input.productId,
        p_document_id: input.documentId,
        p_version_id: input.versionId,
        p_export_id: input.exportId,
      },
    );
    const row = firstRow(response.data);
    return !response.error && row?.outcome === "found"
      ? watermarkExport(asObject(row.result))
      : null;
  }

  async createWatermarkPreviewAccess(
    organizationId: string,
    input: Parameters<
      EvidenceWatermarkExportRepository["createWatermarkPreviewAccess"]
    >[1],
  ): Promise<WatermarkPreviewResult> {
    const result = await this.createWatermarkAccess(
      "preview_evidence_document_watermark_export_atomic",
      organizationId,
      input,
    );
    return result.outcome === "ready"
      ? result
      : { outcome: watermarkPreviewOutcome(result.outcome) };
  }

  async createWatermarkDeliveryAccess(
    organizationId: string,
    input: Parameters<
      EvidenceWatermarkExportRepository["createWatermarkDeliveryAccess"]
    >[1],
  ): Promise<WatermarkDeliveryResult> {
    const result = await this.createWatermarkAccess(
      "create_evidence_document_watermark_export_delivery_atomic",
      organizationId,
      input,
    );
    return result.outcome === "ready"
      ? result
      : { outcome: watermarkDeliveryOutcome(result.outcome) };
  }

  async redeemWatermarkDelivery(
    organizationId: string,
    input: Parameters<
      EvidenceWatermarkExportRepository["redeemWatermarkDelivery"]
    >[1],
  ): Promise<WatermarkRedeemResult> {
    const response = await this.client().rpc(
      "redeem_evidence_document_watermark_export_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_export_id: input.exportId,
        p_token_sha256: input.tokenDigest,
        p_delivery: input.delivery,
        p_correlation_id: input.correlationId,
      },
    );
    const row = firstRow(response.data);
    if (!response.error && row?.outcome === "redeemed") {
      const source = watermarkDelivery(asObject(row.result));
      if (source) return { outcome: "ready" as const, source };
    }
    return { outcome: watermarkRedeemOutcome(row?.outcome) };
  }

  async claimWatermarkExport(
    input: Parameters<
      EvidenceWatermarkExportRepository["claimWatermarkExport"]
    >[0],
  ): Promise<EvidenceWatermarkExportClaim | null> {
    const response = await this.client().rpc(
      "claim_evidence_document_watermark_export",
      { p_worker_id: input.workerId, p_lease_seconds: input.leaseSeconds },
    );
    const row = firstRow(response.data);
    if (response.error || row?.outcome !== "claimed") return null;
    const result = asObject(row.result);
    const exportRecord = watermarkExport(asObject(result.export));
    const organizationId = stringValue(result.organizationId);
    const objectKey = stringValue(result.objectKey);
    const sourceByteSize = numberValue(result.sourceByteSize);
    const sourceMediaType = stringValue(result.sourceMediaType);
    if (
      !exportRecord ||
      !organizationId ||
      !objectKey ||
      !sourceByteSize ||
      !sourceMediaType
    )
      return null;
    return {
      export: exportRecord,
      organizationId,
      objectKey,
      sourceByteSize,
      sourceMediaType,
    };
  }

  async finalizeWatermarkExport(
    organizationId: string,
    input: Parameters<
      EvidenceWatermarkExportRepository["finalizeWatermarkExport"]
    >[1],
  ) {
    const response = await this.client().rpc(
      "finalize_evidence_document_watermark_export_atomic",
      {
        p_organization_id: organizationId,
        p_export_id: input.exportId,
        p_worker_id: input.workerId,
        p_derivative_object_key: input.objectKey,
        p_derivative_sha256: input.sha256,
        p_derivative_size_bytes: input.byteSize,
        p_derivative_media_type: input.mediaType,
      },
    );
    return !response.error && firstRow(response.data)?.outcome === "ready";
  }

  async failWatermarkExport(
    organizationId: string,
    input: Parameters<
      EvidenceWatermarkExportRepository["failWatermarkExport"]
    >[1],
  ) {
    const response = await this.client().rpc(
      "fail_evidence_document_watermark_export_atomic",
      {
        p_organization_id: organizationId,
        p_export_id: input.exportId,
        p_worker_id: input.workerId,
        p_failure_code: input.failureCode,
      },
    );
    return !response.error && firstRow(response.data)?.outcome === "failed";
  }

  async isWatermarkExportDurablyFailed(
    orgId: string,
    input: Parameters<
      EvidenceWatermarkExportRepository["isWatermarkExportDurablyFailed"]
    >[1],
  ) {
    const client = this.supabase.admin() as unknown as {
      from(table: "evidence_document_watermark_exports"): {
        select(columns: "status, lease_owner"): {
          eq(
            column: "organization_id",
            value: string,
          ): {
            eq(
              column: "id",
              value: string,
            ): {
              maybeSingle(): Promise<{ data: unknown; error: unknown }>;
            };
          };
        };
      };
    };
    const response = await client
      .from("evidence_document_watermark_exports")
      .select("status, lease_owner")
      .eq("organization_id", orgId)
      .eq("id", input.exportId)
      .maybeSingle();
    const row = asObject(response.data);
    return row.status === "failed" && row.lease_owner === null;
  }

  private async createWatermarkAccess(
    functionName: string,
    organizationId: string,
    input: Readonly<{
      actorId: string;
      exportId: string;
      idempotencyKey: string;
      requestDigest: string;
    }>,
  ) {
    const response = await this.client().rpc(functionName, {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_export_id: input.exportId,
      p_idempotency_key: input.idempotencyKey,
      p_request_digest: input.requestDigest,
    });
    const row = firstRow(response.data);
    const result = asObject(row?.result);
    const token = stringValue(result.token);
    const fileName = stringValue(result.fileName);
    const mediaType = stringValue(result.mediaType);
    const expiresAt = stringValue(result.expiresAt);
    if (
      !response.error &&
      (row?.outcome === "ready" || row?.outcome === "replayed") &&
      token &&
      fileName &&
      mediaType &&
      expiresAt
    )
      return {
        outcome: "ready" as const,
        access: { token, fileName, mediaType, expiresAt },
      };
    return { outcome: watermarkAccessOutcome(row?.outcome) };
  }

  async versions(
    organizationId: string,
    input: Readonly<{ actorId: string; productId: string; documentId: string }>,
  ) {
    const response = await this.client().rpc(
      "list_evidence_document_versions",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_product_id: input.productId,
        p_document_id: input.documentId,
      },
    );
    const projection = asObject(response.data);
    const items = projection.items;
    return response.error || !Array.isArray(items) ? null : { versions: items };
  }

  async authorize(
    organizationId: string,
    input: Parameters<EvidenceAccessRepository["authorize"]>[1],
  ) {
    const response = await this.client().rpc(
      "authorize_evidence_document_access_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_product_id: input.productId,
        p_document_id: input.documentId,
        p_version_id: input.versionId,
        p_access_mode: input.mode,
        p_purpose: input.purpose,
        p_request_correlation_id: input.correlationId,
        p_token_sha256: input.tokenDigest,
        p_expires_at: input.expiresAt,
      },
    );
    return accessResult(response, "authorized");
  }

  async redeem(
    organizationId: string,
    input: Parameters<EvidenceAccessRepository["redeem"]>[1],
  ) {
    const response = await this.client().rpc(
      "redeem_evidence_document_access_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_token_sha256: input.tokenDigest,
        p_request_correlation_id: input.correlationId,
        p_range_start: input.rangeStart,
        p_range_end: input.rangeEnd,
      },
    );
    return accessResult(response, "redeemed");
  }

  async integrityFailure(
    organizationId: string,
    input: Parameters<EvidenceAccessRepository["integrityFailure"]>[1],
  ) {
    const response = await this.client().rpc(
      "record_evidence_document_integrity_failure_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_version_id: input.versionId,
        p_observed_size_bytes: null,
        p_observed_media_type: null,
        p_observed_sha256: null,
        p_request_correlation_id: input.correlationId,
      },
    );
    if (response.error)
      throw new Error("Evidence integrity audit could not be recorded");
  }
}

function accessResult(
  response: Awaited<ReturnType<Rpc["rpc"]>>,
  readyOutcome: "authorized" | "redeemed",
) {
  const row = firstRow(response.data);
  const result = asObject(row?.result);
  if (!response.error && row?.outcome === readyOutcome) {
    const mode = stringAt(result, "mode");
    if (mode !== "preview" && mode !== "download" && mode !== "export")
      return { outcome: "not_found" as const };
    const source: EvidenceAccessSource = Object.freeze({
      versionId: stringAt(result, "versionId"),
      objectKey: stringAt(result, "objectKey"),
      fileName: stringAt(result, "filename"),
      mediaType: stringAt(result, "mediaType"),
      sha256: stringAt(result, "sha256"),
      byteSize: numberAt(result, "byteSize"),
      mode,
    });
    return { outcome: "ready" as const, source };
  }
  const outcome = row?.outcome;
  if (outcome === "expired") return { outcome: "expired" as const };
  if (outcome === "forbidden") return { outcome: "forbidden" as const };
  if (outcome === "unavailable" || outcome === "not_clean")
    return { outcome: "not_clean" as const };
  return { outcome: "not_found" as const };
}

function retentionReview(
  value: Record<string, unknown>,
): EvidenceRetentionReview | null {
  const linkedProductIds = Array.isArray(value.linkedProductIds)
    ? value.linkedProductIds.filter(
        (productId): productId is string => typeof productId === "string",
      )
    : [];
  if (!Array.isArray(value.linkedProductIds)) return null;
  const reviewedAt = stringValue(value.reviewedAt);
  const retentionUntil = stringValue(value.retentionUntil);
  const retentionProtectionUntil = stringValue(value.retentionProtectionUntil);
  const retentionIncomplete = value.retentionIncomplete === true;
  const legalHoldActive =
    value.productLegalHoldActive === true ||
    (Array.isArray(value.activeHolds) && value.activeHolds.length > 0);
  const status = retentionIncomplete
    ? "incomplete"
    : retentionUntil && retentionProtectionUntil
      ? "current"
      : "unavailable";
  const blockers: EvidenceRetentionBlocker[] = Array.isArray(
    value.blockingReasons,
  )
    ? value.blockingReasons.map(mapRetentionBlocker).filter(isDefined)
    : [];
  if (status === "unavailable") {
    blockers.push({
      visibility: "visible",
      kind: "protection_unavailable",
      obligation: "Retention protection could not be verified.",
      productId: null,
      productName: null,
      protectThrough: null,
    });
  }
  const publicLifecycle = lifecycle(value.lifecycleState);
  const eligibleForDeletion =
    status === "current" &&
    !legalHoldActive &&
    blockers.length === 0 &&
    publicLifecycle === "active" &&
    retentionUntil !== null &&
    retentionProtectionUntil !== null &&
    Date.parse(retentionUntil) <= Date.parse(reviewedAt ?? "") &&
    Date.parse(retentionProtectionUntil) <= Date.parse(reviewedAt ?? "");
  const parsed = evidenceRetentionReviewResponseSchema.safeParse({
    review: {
      documentId: value.documentId,
      currentVersionId: value.currentVersionId,
      lifecycle: publicLifecycle,
      reviewedAt,
      reviewFingerprint: value.reviewFingerprint,
      eligibleForDeletion,
      blockers,
      protection: {
        status,
        retentionUntil: status === "current" ? retentionUntil : null,
        retentionProtectionUntil:
          status === "current" ? retentionProtectionUntil : null,
        legalHoldActive,
        identityHandling: "legal_review_required",
      },
    },
  });
  return parsed.success
    ? Object.freeze({
        ...parsed.data.review,
        linkedProductIds: Object.freeze(linkedProductIds),
      })
    : null;
}

function mapRetentionBlocker(value: unknown) {
  const row = asObject(value);
  const kind = stringValue(row.kind);
  if (!kind) return null;
  if (kind === "reference") {
    return {
      visibility: "restricted" as const,
      kind: "protected_reference" as const,
      message: "A protected related record prevents deletion." as const,
    };
  }
  if (kind === "retention" && typeof row.productId === "string") {
    if (typeof row.productName !== "string") {
      return {
        visibility: "restricted" as const,
        kind: "protected_reference" as const,
        message: "A protected related record prevents deletion." as const,
      };
    }
    return {
      visibility: "visible" as const,
      kind: "product_retention" as const,
      obligation: "A linked product retention obligation prevents deletion.",
      productId: row.productId,
      productName: row.productName,
      protectThrough: stringValue(row.retentionProtectionUntil),
    };
  }
  return {
    visibility: "visible" as const,
    kind:
      kind === "legal_hold"
        ? ("legal_hold" as const)
        : kind === "lifecycle"
          ? ("deletion_in_progress" as const)
          : ("incomplete_retention" as const),
    obligation:
      kind === "legal_hold"
        ? "An active legal hold prevents deletion."
        : kind === "lifecycle"
          ? "Deletion is already in progress."
          : "Retention information is incomplete; deletion cannot be approved.",
    productId: null,
    productName: null,
    protectThrough: null,
  };
}

function lifecycle(value: unknown) {
  if (value === "queued_cleanup") return "cleanup_queued" as const;
  if (value === "cleanup_claimed") return "cleanup_claimed" as const;
  if (value === "cleanup_failed") return "cleanup_failed" as const;
  if (value === "deleted") return "deleted" as const;
  return "active" as const;
}

function retentionMutation(
  response: Awaited<ReturnType<Rpc["rpc"]>>,
  successful: readonly ("placed" | "released" | "queued" | "replayed")[],
): EvidenceRetentionMutationResult {
  const row = firstRow(response.data);
  const outcome = response.error ? "conflict" : row?.outcome;
  if (
    outcome === "placed" ||
    outcome === "released" ||
    outcome === "queued" ||
    outcome === "replayed"
  ) {
    return successful.includes(outcome)
      ? { outcome, value: asObject(row?.result) }
      : { outcome: "conflict" };
  }
  if (outcome === "idempotency_conflict")
    return { outcome: "idempotency_mismatch" };
  if (
    outcome === "forbidden" ||
    outcome === "not_found" ||
    outcome === "blocked" ||
    outcome === "invalid_request" ||
    outcome === "conflict"
  )
    return { outcome };
  return { outcome: "conflict" };
}

function bulkMutation(
  response: Awaited<ReturnType<Rpc["rpc"]>>,
  successful: readonly string[],
): BulkIntakeMutation {
  const row = firstRow(response.data);
  const outcome = response.error ? "conflict" : row?.outcome;
  if (typeof outcome === "string" && successful.includes(outcome)) {
    return {
      outcome: outcome as Extract<
        BulkIntakeMutation["outcome"],
        | "created"
        | "found"
        | "replayed"
        | "reserved"
        | "scan_pending"
        | "failed"
        | "cancelled"
      >,
      value: asObject(row?.result),
    };
  }
  if (outcome === "idempotency_conflict")
    return { outcome: "idempotency_mismatch" as const };
  if (
    outcome === "not_found" ||
    outcome === "forbidden" ||
    outcome === "invalid_request" ||
    outcome === "conflict"
  )
    return { outcome };
  return { outcome: "conflict" as const };
}

function isDefined<T>(value: T | null): value is T {
  return value !== null;
}

function requestDigest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function dateOnly(value: string | null) {
  return value ? value.slice(0, 10) : null;
}
function firstRow(value: unknown): Row | null {
  return Array.isArray(value) &&
    value.length > 0 &&
    typeof value[0] === "object" &&
    value[0] !== null
    ? (value[0] as Row)
    : null;
}
function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}
function stringAt(value: Record<string, unknown>, key: string) {
  const result = value[key];
  if (typeof result !== "string")
    throw new Error(`Evidence RPC returned an invalid ${key}`);
  return result;
}
function numberAt(value: Record<string, unknown>, key: string) {
  const result = value[key];
  if (typeof result !== "number" || !Number.isSafeInteger(result))
    throw new Error(`Evidence RPC returned an invalid ${key}`);
  return result;
}

type SearchCursor = Readonly<{
  rank: number;
  createdAt: string;
  versionId: string;
}>;

function cursorFingerprint(query: EvidenceSearchQuery) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        q: query.q,
        documentClass: query.documentClass ?? null,
        includeHistorical: query.includeHistorical,
      }),
    )
    .digest("base64url");
}
function decodeSearchCursor(
  cursor: string | undefined,
  query: EvidenceSearchQuery,
): SearchCursor | null {
  if (!cursor) return null;
  try {
    const value = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    return value.fingerprint === cursorFingerprint(query) &&
      typeof value.rank === "number" &&
      Number.isSafeInteger(value.rank) &&
      typeof value.createdAt === "string" &&
      typeof value.versionId === "string"
      ? Object.freeze({
          rank: value.rank,
          createdAt: value.createdAt,
          versionId: value.versionId,
        })
      : null;
  } catch {
    return null;
  }
}
function encodeSearchCursor(
  value: Record<string, unknown>,
  query: EvidenceSearchQuery,
) {
  const rank = numberValue(value.rank);
  const createdAt = stringValue(value.createdAt);
  const versionId = stringValue(value.versionId);
  if (rank === null || !createdAt || !versionId) return null;
  return Buffer.from(
    JSON.stringify({
      fingerprint: cursorFingerprint(query),
      rank,
      createdAt,
      versionId,
    }),
  ).toString("base64url");
}
function mapSearchResult(value: Record<string, unknown>, query: string) {
  return {
    documentId: stringValue(value.documentId),
    versionId: stringValue(value.versionId),
    versionNumber: numberValue(value.versionNumber),
    title: stringValue(value.title),
    documentClass: stringValue(value.documentClass),
    fileName: stringValue(value.fileName),
    createdAt: stringValue(value.createdAt),
    validUntil: stringValue(value.validUntil),
    currentVersion: Boolean(value.currentVersion),
    score: numberValue(value.score) ?? 0,
    snippet: snippet(stringValue(value.snippetText) ?? "", query),
    extraction: mapExtraction(value),
  };
}
function mapExtraction(value: Record<string, unknown>) {
  const status =
    stringValue(value.status) ??
    stringValue(asObject(value.extraction).status) ??
    "failed";
  const sourceSha256 =
    stringValue(value.sourceSha256) ??
    stringValue(asObject(value.extraction).sourceSha256) ??
    "0".repeat(64);
  const extractorVersion =
    stringValue(value.extractorVersion) ??
    stringValue(asObject(value.extraction).extractorVersion) ??
    "m8-03-local-v1";
  const updatedAt =
    stringValue(value.updatedAt) ??
    stringValue(asObject(value.extraction).updatedAt) ??
    new Date(0).toISOString();
  const failureCode =
    stringValue(value.failureCode) ??
    stringValue(asObject(value.extraction).failureCode);
  return {
    status,
    sourceSha256,
    extractorVersion,
    updatedAt,
    failureCode:
      status === "failed"
        ? failureCode === "unsupported"
          ? "unsupported_media_type"
          : (failureCode ?? "failed")
        : null,
    truncated: Boolean(
      value.truncated ??
      value.isTruncated ??
      asObject(value.extraction).truncated,
    ),
    quality:
      status === "complete"
        ? "sufficient"
        : failureCode === "low_quality"
          ? "low"
          : "not_assessed",
  };
}
function snippet(text: string, query?: string) {
  const normalized = text
    .split("")
    .map((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127 ? " " : character;
    })
    .join("")
    .replace(/\s+/gu, " ")
    .trim();
  const safe = normalized.slice(0, 1_000) || "Extraction unavailable";
  const terms = query?.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const segments: Array<{ text: string; highlighted: boolean }> = [];
  let offset = 0;
  while (offset < safe.length && segments.length < 31) {
    const lower = safe.slice(offset).toLocaleLowerCase();
    const hits = terms
      .map((term) => lower.indexOf(term))
      .filter((position) => position >= 0);
    const position = hits.length === 0 ? -1 : Math.min(...hits);
    if (position < 0) {
      segments.push({ text: safe.slice(offset), highlighted: false });
      break;
    }
    if (position > 0)
      segments.push({
        text: safe.slice(offset, offset + position),
        highlighted: false,
      });
    const term = terms.find((candidate) =>
      lower.startsWith(candidate, position),
    )!;
    segments.push({
      text: safe.slice(offset + position, offset + position + term.length),
      highlighted: true,
    });
    offset += position + term.length;
  }
  if (offset < safe.length)
    segments.push({ text: safe.slice(offset), highlighted: false });
  return {
    segments: segments
      .filter((segment) => segment.text.length > 0)
      .slice(0, 32),
    truncated: normalized.length > safe.length,
  };
}
function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}
function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function watermarkExport(
  value: Record<string, unknown>,
): EvidenceWatermarkExport | null {
  const derivativeValue = asObject(value.derivative);
  const derivative =
    Object.keys(derivativeValue).length === 0
      ? null
      : {
          fileName: stringValue(derivativeValue.fileName),
          mediaType: stringValue(derivativeValue.mediaType),
          byteSize: numberValue(derivativeValue.byteSize),
          sha256: stringValue(derivativeValue.sha256),
          createdAt: stringValue(derivativeValue.createdAt),
        };
  const parsed = evidenceWatermarkExportSchema.safeParse({
    id: stringValue(value.id),
    organizationId: stringValue(value.organizationId),
    productId: stringValue(value.productId),
    documentId: stringValue(value.documentId),
    sourceVersionId: stringValue(value.sourceVersionId),
    sourceSha256: stringValue(value.sourceSha256),
    requestedByUserId: stringValue(value.requestedByUserId),
    requestedAt: stringValue(value.requestedAt),
    recipient: stringValue(value.recipient),
    purpose: stringValue(value.purpose),
    status: stringValue(value.status),
    failureCode: stringValue(value.failureCode),
    derivative,
    previewedAt: stringValue(value.previewedAt),
    deliveredAt: stringValue(value.deliveredAt),
  });
  return parsed.success ? parsed.data : null;
}
function watermarkDelivery(value: Record<string, unknown>) {
  const objectKey = stringValue(value.objectKey);
  const sha256 = stringValue(value.sha256);
  const byteSize = numberValue(value.byteSize);
  const mediaType = stringValue(value.mediaType);
  const fileName = stringValue(value.fileName);
  return objectKey && sha256 && byteSize && mediaType && fileName
    ? { objectKey, sha256, byteSize, mediaType, fileName }
    : null;
}
function watermarkMutationOutcome(
  value: unknown,
):
  | "not_found"
  | "forbidden"
  | "not_clean"
  | "unsupported"
  | "lifecycle_blocked"
  | "idempotency_mismatch"
  | "conflict" {
  switch (value) {
    case "not_found":
    case "forbidden":
    case "not_clean":
    case "unsupported":
    case "lifecycle_blocked":
    case "idempotency_mismatch":
      return value;
    default:
      return "conflict";
  }
}
function watermarkAccessOutcome(
  value: unknown,
):
  | "not_found"
  | "forbidden"
  | "not_ready"
  | "preview_required"
  | "idempotency_mismatch"
  | "expired"
  | "conflict" {
  switch (value) {
    case "not_found":
    case "forbidden":
    case "not_ready":
    case "preview_required":
    case "idempotency_mismatch":
    case "expired":
      return value;
    default:
      return "conflict";
  }
}
function watermarkPreviewOutcome(
  outcome: ReturnType<typeof watermarkAccessOutcome>,
): Exclude<WatermarkPreviewResult, { outcome: "ready" }>["outcome"] {
  return outcome === "expired" || outcome === "preview_required"
    ? "conflict"
    : outcome;
}
function watermarkDeliveryOutcome(
  outcome: ReturnType<typeof watermarkAccessOutcome>,
): Exclude<WatermarkDeliveryResult, { outcome: "ready" }>["outcome"] {
  return outcome === "expired" ? "conflict" : outcome;
}
function watermarkRedeemOutcome(
  value: unknown,
): Exclude<WatermarkRedeemResult, { outcome: "ready" }>["outcome"] {
  const outcome = watermarkAccessOutcome(value);
  return outcome === "idempotency_mismatch" || outcome === "preview_required"
    ? "conflict"
    : outcome;
}
function decodeListCursor(cursor: string | undefined) {
  if (!cursor) return null;
  try {
    const [createdAt, id, ...rest] = Buffer.from(cursor, "base64url")
      .toString("utf8")
      .split("|");
    return rest.length === 0 &&
      createdAt &&
      /^\d{4}-\d\d-\d\dT/.test(createdAt) &&
      id &&
      /^[0-9a-f-]{36}$/i.test(id)
      ? { createdAt, id }
      : null;
  } catch {
    return null;
  }
}
