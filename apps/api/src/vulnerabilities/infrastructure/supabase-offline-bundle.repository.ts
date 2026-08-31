import {
  vulnerabilityCsafReconciliationDetailSchema,
  vulnerabilityOfflineBundleImportSchema,
  type VulnerabilityCsafReconciliationDetail,
  type VulnerabilityOfflineBundleImport,
} from "@repo/contracts/vulnerabilities";
import { Injectable, Logger } from "@nestjs/common";

import { SupabaseService } from "../../supabase/supabase.service";
import type { VulnerabilityOfflineBundleRepository } from "../application/offline-bundle-import.port";
import type { OfflineBundlePreparedImport } from "../application/offline-bundle-import.port";
import { z } from "zod";
import { vulnerabilityFeedRecordToNormalizedPayload } from "./supabase-vulnerability-feed.repository";

type RpcResult = Readonly<{ data: unknown; error: unknown }>;
type RpcClient = Readonly<{
  rpc(
    name: string,
    args?: Readonly<Record<string, unknown>>,
  ): Promise<RpcResult>;
}>;
type Row = Readonly<Record<string, unknown>>;

/**
 * Service-role adapter for deployment-global imports. SQL owns the durable
 * staging, stable-lock ordering, rollback recheck, promotion, and audit fact.
 */
@Injectable()
export class SupabaseOfflineBundleRepository implements VulnerabilityOfflineBundleRepository {
  private readonly logger = new Logger(SupabaseOfflineBundleRepository.name);

  constructor(private readonly supabase: SupabaseService) {}

  async preflight(
    input: Parameters<VulnerabilityOfflineBundleRepository["preflight"]>[0],
  ): Promise<OfflineBundlePreparedImport> {
    return this.preflightFromRpc({
      p_bundle_id: input.bundleId,
      p_bundle_version: input.bundleVersion,
      p_manifest_sha256: input.manifestSha256,
      p_signing_key_id: input.signingKeyId,
      p_manifest: input.manifest,
      p_verification_receipt: input.verificationReceipt,
      p_actor_user_id: input.actorId,
      p_idempotency_key: input.idempotencyKey,
      p_correlation_id: input.correlationId,
      p_payloads: input.payloads,
      p_staging_worker_id: input.stagingWorkerId,
    });
  }

  async confirm(
    input: Parameters<VulnerabilityOfflineBundleRepository["confirm"]>[0],
  ): Promise<VulnerabilityOfflineBundleImport> {
    return this.importFromRpc("confirm_vulnerability_offline_bundle_import", {
      p_import_id: input.importId,
      p_actor_user_id: input.actorId,
      p_idempotency_key: input.idempotencyKey,
    });
  }

  async get(importId: string): Promise<VulnerabilityOfflineBundleImport> {
    return this.importFromRpc("get_vulnerability_offline_bundle_import", {
      p_import_id: importId,
    });
  }

  async csafReconciliation(
    canonicalId: string,
  ): Promise<VulnerabilityCsafReconciliationDetail | null> {
    const value = await this.scalar(
      "get_vulnerability_csaf_reconciliation_detail",
      {
        p_canonical_id: canonicalId,
      },
    );
    if (value === null) return null;
    return vulnerabilityCsafReconciliationDetailSchema.parse(camelize(value));
  }

  async stage(
    input: Parameters<VulnerabilityOfflineBundleRepository["stage"]>[0],
  ): Promise<void> {
    const record = input.record;
    const outcome = await this.textOutcome("stage_vulnerability_feed_record", {
      p_run_id: input.runId,
      p_worker_id: input.workerId,
      p_source_record_key: record.sourceRecordId,
      p_canonical_id: record.canonicalId,
      p_record_state: record.status,
      p_source_update_marker: record.upstreamUpdatedAt,
      p_source_updated_at: record.upstreamUpdatedAt,
      p_raw_payload: record.rawPayload,
      p_normalized_payload: vulnerabilityFeedRecordToNormalizedPayload(record),
      p_record_sha256: record.rawPayloadSha256,
    });
    if (outcome !== "staged")
      throw new Error("offline bundle import unavailable");
  }

  async completeStaging(
    input: Parameters<
      VulnerabilityOfflineBundleRepository["completeStaging"]
    >[0],
  ): Promise<void> {
    const outcome = await this.textOutcome(
      "complete_vulnerability_feed_staging",
      {
        p_run_id: input.runId,
        p_worker_id: input.workerId,
        p_expected_record_count: input.expectedRecordCount,
      },
    );
    if (outcome !== "ready_to_promote") {
      throw new Error("offline bundle import unavailable");
    }
  }

  private async importFromRpc(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<VulnerabilityOfflineBundleImport> {
    let result: RpcResult;
    try {
      result = await this.client().rpc(name, args);
    } catch {
      throw new Error("offline bundle import unavailable");
    }
    const row = firstRow(result.data);
    if (result.error || !isRow(row) || !isRow(row.import)) {
      this.logger.warn(`offline_bundle_rpc_unavailable rpc=${name}`);
      throw new Error("offline bundle import unavailable");
    }
    const outcome = row.outcome;
    if (
      outcome !== "preflight_created" &&
      outcome !== "replayed" &&
      outcome !== "promoted" &&
      outcome !== "already_promoted" &&
      outcome !== "found" &&
      outcome !== "incomplete_staging" &&
      // These outcomes have already been persisted by the transactional RPC.
      // Returning the durable, schema-checked report lets the operator see the
      // safe failure state instead of turning an intentional rejection into a
      // misleading provider outage.
      outcome !== "rollback_rejected" &&
      outcome !== "promotion_failed" &&
      outcome !== "conflict"
    ) {
      throw new Error("offline bundle import unavailable");
    }
    return parseOfflineBundleImport(row.import);
  }

  private async preflightFromRpc(
    args: Readonly<Record<string, unknown>>,
  ): Promise<OfflineBundlePreparedImport> {
    let result: RpcResult;
    try {
      result = await this.client().rpc(
        "preflight_vulnerability_offline_bundle_import",
        args,
      );
    } catch {
      throw new Error("offline bundle import unavailable");
    }
    const row = firstRow(result.data);
    if (
      result.error ||
      !isRow(row) ||
      (row.outcome !== "preflight_created" && row.outcome !== "replayed") ||
      !isRow(row.import)
    ) {
      throw new Error("offline bundle import unavailable");
    }
    const raw = camelize(row.import);
    if (!isRow(raw)) throw new Error("offline bundle import unavailable");
    const runs = offlineBundleRunSchema.safeParse(raw.runs);
    if (!runs.success) throw new Error("offline bundle import unavailable");
    return {
      import: parseOfflineBundleImport(row.import),
      runs: runs.data,
    };
  }

  private client(): RpcClient {
    return this.supabase.admin() as unknown as RpcClient;
  }

  private async textOutcome(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<string> {
    let result: RpcResult;
    try {
      result = await this.client().rpc(name, args);
    } catch {
      throw new Error("offline bundle import unavailable");
    }
    if (result.error || typeof result.data !== "string") {
      throw new Error("offline bundle import unavailable");
    }
    return result.data;
  }

  private async scalar(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    let result: RpcResult;
    try {
      result = await this.client().rpc(name, args);
    } catch {
      throw new Error("offline bundle import unavailable");
    }
    if (result.error) throw new Error("offline bundle import unavailable");
    return result.data;
  }
}

const offlineBundleRunSchema = z
  .array(
    z
      .object({
        id: z.uuid(),
        feedKey: z.enum([
          "nvd",
          "osv",
          "cisa_kev",
          "epss",
          "github_advisory",
          "vendor_csaf",
        ]),
      })
      .strict(),
  )
  .max(6);

function isRow(value: unknown): value is Row {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function camelize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelize);
  if (!isRow(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
      camelize(nested),
    ]),
  );
}

function parseOfflineBundleImport(
  value: unknown,
): VulnerabilityOfflineBundleImport {
  const raw = camelize(value);
  if (!isRow(raw)) throw new Error("offline bundle import unavailable");
  const contractValue = Object.fromEntries(
    Object.entries(raw).filter(([key]) => key !== "runs"),
  );
  return vulnerabilityOfflineBundleImportSchema.parse(contractValue);
}

function firstRow(value: unknown): unknown {
  if (!Array.isArray(value)) return null;
  const rows = value as unknown[];
  return rows[0] ?? null;
}
