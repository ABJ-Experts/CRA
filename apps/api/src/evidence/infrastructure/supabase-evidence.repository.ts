import { createHash, randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { SupabaseService } from "../../supabase/supabase.service";
import type { EvidenceRepository, EvidenceReservation } from "../application/evidence-intake-use-cases";

type Rpc = { rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message?: string } | null }> };
type Row = Readonly<{ outcome?: unknown; result?: unknown }>;

@Injectable()
export class SupabaseEvidenceRepository implements EvidenceRepository {
  constructor(private readonly supabase: SupabaseService) {}
  private client(): Rpc { return this.supabase.admin() as unknown as Rpc; }

  async reserve(organizationId: string, input: Parameters<EvidenceRepository["reserve"]>[1]) {
    const objectKey = `${organizationId}/${randomUUID()}/${randomUUID()}/${randomUUID()}`;
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    const response = await this.client().rpc("reserve_evidence_document_upload_atomic", {
      p_organization_id: organizationId, p_actor_user_id: input.actorId, p_title: input.title,
      p_document_class: input.evidenceClass, p_owner_user_id: input.ownerUserId,
      p_product_ids: [...input.applicableProductIds], p_validity_starts_on: dateOnly(input.validFrom),
      p_validity_ends_on: dateOnly(input.validUntil), p_original_filename: input.fileName,
      p_declared_size_bytes: input.declaredByteSize, p_object_key: objectKey,
      p_upload_expires_at: expiresAt, p_idempotency_key: input.idempotencyKey,
      p_request_digest: requestDigest(input),
    });
    if (response.error) return { outcome: "conflict" as const };
    const row = firstRow(response.data); const result = asObject(row?.result);
    if (row?.outcome === "reserved" || row?.outcome === "replayed") {
      const reservation: EvidenceReservation = Object.freeze({ documentId: stringAt(result, "documentId"), versionId: stringAt(result, "versionId"), objectKey: stringAt(result, "objectKey"), expiresAt: stringAt(result, "uploadExpiresAt"), state: "uploading" });
      return { outcome: row.outcome === "reserved" ? "created" as const : "replayed" as const, reservation };
    }
    return { outcome: row?.outcome === "idempotency_conflict" ? "idempotency_mismatch" as const : row?.outcome === "not_found" ? "not_found" as const : "invalid_request" as const };
  }

  async finalize(organizationId: string, input: Parameters<EvidenceRepository["finalize"]>[1]) {
    const response = await this.client().rpc("finalize_evidence_document_upload_atomic", {
      p_organization_id: organizationId, p_actor_user_id: input.actorId, p_version_id: input.versionId,
      p_actual_size_bytes: input.byteSize, p_detected_media_type: input.mediaType, p_original_sha256: input.sha256,
      p_idempotency_key: input.idempotencyKey, p_request_digest: requestDigest(input),
    });
    if (response.error) return { outcome: "conflict" as const };
    const row = firstRow(response.data); const state = stringAt(asObject(row?.result), "state") as "uploading" | "scan_pending" | "clean" | "quarantined" | "failed";
    if (row?.outcome === "scan_pending") return { outcome: "queued" as const, state };
    if (row?.outcome === "failed") return { outcome: "failed" as const, state };
    if (row?.outcome === "replayed") return { outcome: "replayed" as const, state };
    return { outcome: row?.outcome === "idempotency_conflict" ? "idempotency_mismatch" as const : "not_found" as const };
  }

  async getUploadVersion(orgId: string, input: Readonly<{ actorId: string; versionId: string }>) {
    const client = this.supabase.admin() as unknown as { from(table: string): { select(columns: string): { eq(column: string, value: string): { eq(column: string, value: string): { maybeSingle(): Promise<{ data: unknown; error: unknown }> } } } } };
    const response = await client.from("evidence_document_versions").select("object_key").eq("organization_id", orgId).eq("id", input.versionId).maybeSingle();
    const row = asObject(response.data);
    if (typeof row.object_key !== "string") return null;
    const products = await client
      .from("evidence_document_version_products")
      .select("product_id")
      .eq("organization_id", orgId)
      .eq("version_id", input.versionId)
      .maybeSingle();
    const productId = asObject(products.data).product_id;
    return typeof productId === "string"
      ? { objectKey: row.object_key, productId }
      : null;
  }

  async list(organizationId: string, input: Readonly<{ actorId: string; productId: string; limit: number; cursor?: string }>) {
    const response = await this.client().rpc("list_evidence_documents", { p_organization_id: organizationId, p_actor_user_id: input.actorId, p_product_id: input.productId });
    return response.error ? null : response.data;
  }

  async download(orgId: string, input: Readonly<{ actorId: string; documentId: string; versionId: string; correlationId: string }>) {
    const response = await this.client().rpc("get_evidence_document_download_atomic", { p_organization_id: orgId, p_actor_user_id: input.actorId, p_version_id: input.versionId, p_idempotency_key: input.correlationId });
    const row = firstRow(response.data); if (response.error || row?.outcome !== "ready") return null;
    const result = asObject(row.result);
    const client = this.supabase.admin() as unknown as { from(table: string): { select(columns: string): { eq(column: string, value: string): { eq(column: string, value: string): { maybeSingle(): Promise<{ data: unknown }> } } } } };
    const media = await client.from("evidence_document_versions").select("detected_media_type").eq("organization_id", orgId).eq("id", input.versionId).maybeSingle();
    const mediaType = asObject(media.data).detected_media_type;
    if (typeof mediaType !== "string") return null;
    return { objectKey: stringAt(result, "objectKey"), fileName: stringAt(result, "filename"), mediaType };
  }
}

function requestDigest(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function dateOnly(value: string | null) { return value ? value.slice(0, 10) : null; }
function firstRow(value: unknown): Row | null { return Array.isArray(value) && value.length > 0 && typeof value[0] === "object" && value[0] !== null ? value[0] as Row : null; }
function asObject(value: unknown): Record<string, unknown> { return typeof value === "object" && value !== null ? value as Record<string, unknown> : {}; }
function stringAt(value: Record<string, unknown>, key: string) { const result = value[key]; if (typeof result !== "string") throw new Error(`Evidence RPC returned an invalid ${key}`); return result; }
