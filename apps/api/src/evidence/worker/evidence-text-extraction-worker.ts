import { randomUUID } from "node:crypto";
import { SupabaseService } from "../../supabase/supabase.service";
import type { SupabaseEvidenceStorageAdapter } from "../infrastructure/supabase-evidence-storage.adapter";
import type {
  EvidenceExtractionFailure,
  EvidenceTextExtractionResult,
  LocalEvidenceTextExtractorAdapter,
} from "../infrastructure/local-evidence-text-extractor.adapter";

type RpcClient = Readonly<{
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message?: string } | null }>;
  from(table: string): {
    select(columns: string): Query;
  };
}>;
type Query = Readonly<{
  eq(column: string, value: string): Query;
  limit(value: number): Promise<{ data: unknown; error?: unknown }>;
}>;

type ClaimedJob = Readonly<{
  organizationId: string;
  versionId: string;
  sourceSha256: string;
  extractorVersion: string;
}>;

const extractorVersion = "m8-03-local-v1";

/** Claims only one organization-scoped job at a time. Job transitions are
 * entirely in the database, making process restart and duplicate workers safe. */
export class EvidenceTextExtractionWorker {
  private readonly workerId: string;

  constructor(
    private readonly dependencies: Readonly<{
      supabase: SupabaseService;
      storage: Pick<SupabaseEvidenceStorageAdapter, "openVerified">;
      extractor: Pick<LocalEvidenceTextExtractorAdapter, "extract">;
      leaseSeconds: number;
    }>,
    workerId = randomUUID(),
  ) {
    this.workerId = workerId;
  }

  async runOnce(): Promise<number> {
    const client = this.dependencies.supabase.admin() as unknown as RpcClient;
    const organizations = await client
      .from("evidence_document_extraction_jobs")
      .select("organization_id")
      .limit(32);
    let completed = 0;
    for (const organizationId of organizationIds(organizations.data)) {
      const claimed = await this.claim(client, organizationId);
      if (!claimed) continue;
      await this.process(client, claimed);
      completed += 1;
    }
    return completed;
  }

  private async claim(
    client: RpcClient,
    organizationId: string,
  ): Promise<ClaimedJob | null> {
    const response = await client.rpc(
      "claim_evidence_text_extraction_job_atomic",
      {
        p_organization_id: organizationId,
        p_worker_id: this.workerId,
        p_lease_seconds: this.dependencies.leaseSeconds,
      },
    );
    if (response.error)
      throw new Error("Evidence extraction claim unavailable");
    const row = object(first(response.data));
    if (!row || row.outcome === "empty") return null;
    const result = object(row.result) ?? row;
    const versionId = string(result.versionId);
    const sourceSha256 = string(result.sourceSha256);
    const jobExtractorVersion =
      string(result.extractorVersion) ?? extractorVersion;
    const claimedOrg = string(result.organizationId) ?? organizationId;
    return versionId && sourceSha256
      ? Object.freeze({
          organizationId: claimedOrg,
          versionId,
          sourceSha256,
          extractorVersion: jobExtractorVersion,
        })
      : null;
  }

  private async process(client: RpcClient, job: ClaimedJob) {
    let result: EvidenceTextExtractionResult;
    try {
      const source = await this.source(client, job);
      if (!source)
        result = { outcome: "failed", failureCode: "source_unavailable" };
      else {
        const stream = await this.dependencies.storage.openVerified({
          objectKey: source.objectKey,
          sha256: job.sourceSha256,
          byteSize: source.byteSize,
        });
        result = stream
          ? await this.dependencies.extractor.extract({
              source: stream,
              mediaType: source.mediaType,
            })
          : { outcome: "failed", failureCode: "source_unavailable" };
      }
    } catch {
      result = { outcome: "failed", failureCode: "source_unavailable" };
    }
    const response = await client.rpc(
      "complete_evidence_text_extraction_job_atomic",
      {
        p_organization_id: job.organizationId,
        p_worker_id: this.workerId,
        p_version_id: job.versionId,
        p_source_sha256: job.sourceSha256,
        p_extractor_version: job.extractorVersion,
        p_outcome: completionOutcome(result),
        p_extracted_text: result.outcome === "complete" ? result.text : null,
        p_quality:
          result.outcome === "complete"
            ? "sufficient"
            : result.failureCode === "low_quality"
              ? "low"
              : "not_assessed",
        p_is_truncated:
          result.outcome === "complete" ? result.truncated : false,
        p_failure_code:
          result.outcome === "failed"
            ? databaseFailure(result.failureCode)
            : null,
        p_retry_after_seconds: retryAfter(result),
      },
    );
    if (response.error || !completionAccepted(response.data))
      throw new Error("Evidence extraction completion was not accepted");
  }

  private async source(client: RpcClient, job: ClaimedJob) {
    const versions = await client
      .from("evidence_document_versions")
      .select(
        "object_key,actual_size_bytes,detected_media_type,original_sha256",
      )
      .eq("organization_id", job.organizationId)
      .eq("id", job.versionId)
      .limit(1);
    const row = object(Array.isArray(versions.data) ? versions.data[0] : null);
    const objectKey = row && string(row.object_key);
    const byteSize = row && number(row.actual_size_bytes);
    const mediaType = row && string(row.detected_media_type);
    const sha = row && string(row.original_sha256);
    if (!objectKey || !byteSize || !mediaType || sha !== job.sourceSha256)
      return null;
    return Object.freeze({ objectKey, byteSize, mediaType });
  }
}

function completionAccepted(value: unknown) {
  const firstValue = first(value);
  const row = object(firstValue);
  const outcome =
    typeof firstValue === "string" ? firstValue : string(row?.outcome);
  return (
    outcome === "completed" ||
    outcome === "queued" ||
    outcome === "failed" ||
    outcome === "replayed"
  );
}
function retryAfter(result: EvidenceTextExtractionResult) {
  return result.outcome === "failed" &&
    ["source_unavailable", "timeout"].includes(result.failureCode)
    ? 300
    : null;
}
function completionOutcome(result: EvidenceTextExtractionResult) {
  if (result.outcome === "complete") return "complete";
  return retryAfter(result) ? "retry" : "failed";
}
function databaseFailure(value: EvidenceExtractionFailure) {
  if (value === "source_unavailable" || value === "extractor_unavailable")
    return "unavailable";
  if (value === "unsupported") return "unsupported_media_type";
  return value;
}
function first(value: unknown): unknown {
  return Array.isArray(value) ? (value as readonly unknown[])[0] : value;
}
function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}
function string(value: unknown) {
  return typeof value === "string" ? value : null;
}
function number(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}
function organizationIds(value: unknown) {
  return [
    ...new Set(
      Array.isArray(value)
        ? value
            .map((row) => string(object(row)?.organization_id))
            .filter((id): id is string => Boolean(id))
        : [],
    ),
  ];
}
