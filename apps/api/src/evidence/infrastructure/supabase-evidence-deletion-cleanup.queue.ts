import { Injectable } from "@nestjs/common";

import { SupabaseService } from "../../supabase/supabase.service";
import type {
  EvidenceDeletionCleanupClaim,
  EvidenceDeletionCleanupQueue,
} from "../worker/evidence-deletion-cleanup-worker";

type Rpc = Readonly<{
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: Readonly<{ message?: string }> | null }>;
}>;

/** Narrow RPC-only adapter. The worker never scans cross-tenant rows directly. */
@Injectable()
export class SupabaseEvidenceDeletionCleanupQueue implements EvidenceDeletionCleanupQueue {
  constructor(private readonly supabase: SupabaseService) {}

  private client(): Rpc {
    return this.supabase.admin() as unknown as Rpc;
  }

  async organizationIds(limit: number): Promise<readonly string[]> {
    const response = await this.client().rpc(
      "list_evidence_document_deletion_cleanup_organizations_atomic",
      { p_limit: limit },
    );
    if (response.error || !Array.isArray(response.data)) return [];
    return response.data.flatMap((row) => {
      const value = object(row).organization_id;
      return typeof value === "string" ? [value] : [];
    });
  }

  async claim(
    organizationId: string,
    input: Readonly<{ workerId: string; leaseSeconds: number }>,
  ): Promise<EvidenceDeletionCleanupClaim | null> {
    const response = await this.client().rpc(
      "claim_evidence_document_deletion_cleanup_atomic",
      {
        p_organization_id: organizationId,
        p_worker_id: input.workerId,
        p_lease_seconds: input.leaseSeconds,
      },
    );
    if (response.error)
      throw new Error("Evidence deletion cleanup claim unavailable");
    const first: unknown = Array.isArray(response.data)
      ? response.data[0]
      : response.data;
    const row = object(first);
    const result = object(row.result ?? first);
    const intentId = text(result.intentId);
    const cleanupItemId = text(result.cleanupItemId);
    const documentId = text(result.documentId);
    // The durable RPC owns the Storage bucket selection. Keep the allowlist
    // narrow so a malformed cleanup row can never select arbitrary Storage.
    const bucket = text(result.bucket ?? result.objectBucket);
    const objectKey = text(result.objectKey);
    return intentId &&
      cleanupItemId &&
      documentId &&
      (bucket === "evidence-documents" ||
        bucket === "evidence-watermark-exports") &&
      objectKey
      ? Object.freeze({
          organizationId: text(result.organizationId) ?? organizationId,
          intentId,
          cleanupItemId,
          documentId,
          bucket,
          objectKey,
        })
      : null;
  }

  async complete(
    organizationId: string,
    input: Readonly<{
      workerId: string;
      intentId: string;
      cleanupItemId: string;
      outcome: "deleted" | "retry";
      error: string | null;
    }>,
  ): Promise<void> {
    const response = await this.client().rpc(
      "complete_evidence_document_deletion_cleanup_atomic",
      {
        p_organization_id: organizationId,
        p_worker_id: input.workerId,
        p_intent_id: input.intentId,
        p_cleanup_item_id: input.cleanupItemId,
        p_outcome: input.outcome,
        p_error: input.error,
      },
    );
    if (response.error)
      throw new Error("Evidence deletion cleanup completion unavailable");
  }
}

function object(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
