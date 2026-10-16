import { Injectable } from "@nestjs/common";
import {
  supplierDocumentExtractionResponseSchema,
  supplierDocumentExtractionRunSchema,
  supplierDocumentFieldResponseSchema,
} from "@repo/contracts/supplier-evidence";

import { SupabaseService } from "../../supabase/supabase.service";
import {
  SupplierEvidenceConflictError,
  SupplierEvidenceForbiddenError,
  SupplierEvidenceInvalidRequestError,
  SupplierEvidenceUnavailableError,
} from "../application/supplier-evidence-use-cases";
import type { SupplierDocumentExtractionRepository } from "../application/supplier-document-extraction.use-cases";

type RpcRow = Readonly<{ outcome?: unknown; result?: unknown }>;
type RpcClient = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{
    data: unknown;
    error: { message?: string } | null;
  }>;
};

@Injectable()
export class SupabaseSupplierDocumentExtractionRepository implements SupplierDocumentExtractionRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async start(
    organizationId: string,
    input: Parameters<SupplierDocumentExtractionRepository["start"]>[1],
  ) {
    const row = await this.row("start_supplier_document_extraction_atomic", {
      ...sourceArgs(organizationId, input),
      p_idempotency_key: input.idempotencyKey,
    });
    raise(row);
    if (row?.outcome !== "queued" && row?.outcome !== "replayed")
      throw unavailable();
    const snapshot = await this.read(organizationId, { ...input, limit: 25 });
    return supplierDocumentExtractionResponseSchema.parse({
      ...snapshot,
      run: supplierDocumentExtractionRunSchema.parse(row?.result),
    });
  }

  async read(
    organizationId: string,
    input: Parameters<SupplierDocumentExtractionRepository["read"]>[1],
  ) {
    const row = await this.row("get_supplier_document_extraction_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_product_id: input.productId,
      p_submission_id: input.submissionId,
      p_cursor: input.cursor ?? null,
      p_limit: input.limit,
    });
    raise(row);
    if (row?.outcome !== "found") throw unavailable();
    return supplierDocumentExtractionResponseSchema.parse(row?.result);
  }

  async decide(
    organizationId: string,
    input: Parameters<SupplierDocumentExtractionRepository["decide"]>[1],
  ) {
    const row = await this.row("decide_supplier_document_field_atomic", {
      ...sourceArgs(organizationId, input),
      p_field_id: input.fieldId,
      p_expected_version: input.expectedFieldVersion,
      p_decision: input.decision === "confirm" ? "confirmed" : "rejected",
      p_corrected_value:
        input.decision === "confirm" ? input.correctedValue : null,
      p_idempotency_key: input.idempotencyKey,
    });
    raise(row);
    if (!["confirmed", "rejected", "replayed"].includes(String(row?.outcome)))
      throw unavailable();
    return supplierDocumentFieldResponseSchema.parse(row?.result);
  }

  async manual(
    organizationId: string,
    input: Parameters<SupplierDocumentExtractionRepository["manual"]>[1],
  ) {
    const row = await this.row("add_supplier_document_field_atomic", {
      ...sourceArgs(organizationId, input),
      p_field_key: input.fieldKey,
      p_value: input.value,
      p_idempotency_key: input.idempotencyKey,
    });
    raise(row);
    if (row?.outcome !== "confirmed" && row?.outcome !== "replayed")
      throw unavailable();
    return supplierDocumentFieldResponseSchema.parse(row?.result);
  }

  private async row(
    name: string,
    args: Record<string, unknown>,
  ): Promise<RpcRow | null> {
    const { data, error } = await (
      this.supabase.admin() as unknown as RpcClient
    ).rpc(name, args);
    if (error) throw unavailable();
    const rows = Array.isArray(data) ? data : [];
    return isRecord(rows[0]) ? rows[0] : null;
  }
}

function sourceArgs(
  organizationId: string,
  input: Parameters<SupplierDocumentExtractionRepository["start"]>[1],
) {
  return {
    p_organization_id: organizationId,
    p_actor_user_id: input.actorId,
    p_product_id: input.productId,
    p_request_id: input.requestId,
    p_submission_id: input.submissionId,
    p_expected_request_version: input.expectedRequestVersion,
    p_expected_submission_updated_at: input.expectedSubmissionUpdatedAt,
    p_expected_evidence_version_id: input.expectedEvidenceVersionId,
    p_expected_sha256: input.expectedSha256,
  };
}

function raise(row: RpcRow | null): void {
  if (row?.outcome === "forbidden") throw new SupplierEvidenceForbiddenError();
  if (row?.outcome === "invalid_request")
    throw new SupplierEvidenceInvalidRequestError();
  if (
    [
      "conflict",
      "idempotency_conflict",
      "stale_source",
      "not_found",
      "low_confidence",
    ].includes(String(row?.outcome))
  ) {
    throw new SupplierEvidenceConflictError();
  }
  if (row?.outcome === "budget_exhausted" || row?.outcome === "unavailable")
    throw unavailable();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unavailable() {
  return new SupplierEvidenceUnavailableError(
    "Supplier document extraction unavailable.",
  );
}
