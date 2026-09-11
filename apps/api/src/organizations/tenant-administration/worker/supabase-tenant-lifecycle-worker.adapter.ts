import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";

import { SupabaseService } from "../../../supabase/supabase.service";
import { exportSourceRegistry } from "./export-archive";
import {
  WorkerFailure,
  type TenantLifecycleWorkerDependencies,
} from "./tenant-lifecycle-worker";

type ProviderRow = Readonly<Record<string, unknown>>;
type ProviderResult = Readonly<{ data: unknown; error: unknown }>;

const uuidSchema = z.uuid();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const exportPartSchema = z
  .object({
    source_id: z.string().min(1),
    part_number: z.number().int().positive(),
    object_path: z.string().min(1),
    sha256: sha256Schema,
    byte_size: z.number().int().nonnegative(),
  })
  .strict();
const claimSnapshotSchema = z
  .object({ sourceIds: z.array(z.string().min(1)).min(1) })
  .strict();

const exportPageSize = 1000;

const sensitiveKey =
  /(?:token|password|secret|credential|otp|recovery|api[_-]?key|access[_-]?token|refresh[_-]?token|(?:encryption|private|signing|provider)[_-]?key)/i;

const hasSensitiveKey = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(hasSensitiveKey);
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([key, nested]) => sensitiveKey.test(key) || hasSensitiveKey(nested),
  );
};

const snapshotRecordSchema = z
  .object({
    table_name: z.string().min(1),
    table_sort: z.number().int().positive(),
    record_index: z.number().int().positive(),
    record_payload: z.record(z.string(), z.unknown()),
  })
  .strict();

const record = (value: unknown): ProviderRow => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkerFailure("malformed_provider", false);
  }
  return value as ProviderRow;
};

const single = (value: unknown): ProviderRow => {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new WorkerFailure("malformed_provider", false);
  }
  return record(value[0]);
};

const outcome = (row: ProviderRow): string => {
  if (typeof row.outcome !== "string")
    throw new WorkerFailure("malformed_provider", false);
  return row.outcome;
};

/**
 * Concrete worker persistence adapter. Global due-list reads expose only
 * scheduling organization IDs; every job claim/checkpoint/finalize call takes
 * its organization ID first and the SQL RPC rechecks tenant state.
 */
@Injectable()
export class SupabaseTenantLifecycleWorkerRepository {
  constructor(private readonly supabase: SupabaseService) {}

  readonly export: TenantLifecycleWorkerDependencies["export"] = Object.freeze({
    dueOrganizationIds: async () =>
      this.dueOrganizations("organization_export_jobs", ["queued", "running"]),
    claim: async (organizationId, workerId, leaseSeconds) => {
      const row = await this.rpc("claim_organization_export_atomic", {
        p_organization_id: organizationId,
        p_lease_owner: workerId,
        p_lease_seconds: leaseSeconds,
      });
      const value = outcome(row);
      if (value !== "claimed")
        return Object.freeze({ outcome: this.exportClaimFailure(value) });
      const snapshot = claimSnapshotSchema.safeParse(row.snapshot);
      if (
        !snapshot.success ||
        !uuidSchema.safeParse(row.export_job_id).success ||
        !uuidSchema.safeParse(row.lease_owner).success ||
        !Number.isInteger(row.checkpoint_version)
      ) {
        throw new WorkerFailure("malformed_provider", false);
      }
      return Object.freeze({
        outcome: "claimed" as const,
        jobId: row.export_job_id as string,
        leaseOwner: row.lease_owner as string,
        checkpointVersion: row.checkpoint_version as number,
        sourceIds: Object.freeze(snapshot.data.sourceIds),
      });
    },
    materialize: async (command) => {
      const row = await this.rpc(
        "materialize_organization_export_snapshot_atomic",
        {
          p_organization_id: command.organizationId,
          p_export_job_id: command.exportId,
          p_lease_owner: command.leaseOwner,
          p_expected_checkpoint_version: command.checkpointVersion,
        },
      );
      const value = outcome(row);
      if (
        ![
          "materialized",
          "replayed",
          "conflict",
          "not_found",
          "invalid_request",
        ].includes(value)
      ) {
        throw new WorkerFailure("malformed_provider", false);
      }
      return Object.freeze({
        outcome: value as
          | "materialized"
          | "replayed"
          | "conflict"
          | "not_found"
          | "invalid_request",
        ...(typeof row.checkpoint_version === "number"
          ? { checkpointVersion: row.checkpoint_version }
          : {}),
      });
    },
    parts: async (organizationId, exportId) => {
      const result = await this.query(
        this.supabase
          .admin()
          .from("organization_export_parts")
          .select("source_id, part_number, object_path, sha256, byte_size")
          .eq("organization_id", organizationId)
          .eq("export_job_id", exportId)
          .order("source_id", { ascending: true }),
      );
      if (!Array.isArray(result.data))
        throw new WorkerFailure("malformed_provider", false);
      return Object.freeze(
        result.data.map((value) => {
          const parsed = exportPartSchema.safeParse(value);
          if (!parsed.success)
            throw new WorkerFailure("malformed_provider", false);
          return Object.freeze({
            sourceId: parsed.data.source_id,
            partNumber: parsed.data.part_number,
            objectPath: parsed.data.object_path,
            sha256: parsed.data.sha256,
            byteSize: parsed.data.byte_size,
          });
        }),
      );
    },
    context: async (organizationId, exportId) => {
      const result = await this.query(
        this.supabase
          .admin()
          .from("organization_export_jobs")
          .select("actor_user_id, created_at")
          .eq("organization_id", organizationId)
          .eq("id", exportId)
          .maybeSingle(),
      );
      if (!result.data) return null;
      const row = record(result.data);
      if (
        !uuidSchema.safeParse(row.actor_user_id).success ||
        typeof row.created_at !== "string"
      ) {
        throw new WorkerFailure("malformed_provider", false);
      }
      return Object.freeze({
        actorId: row.actor_user_id as string,
        requestedAt: row.created_at,
      });
    },
    checkpoint: async (command) => {
      const row = await this.rpc("checkpoint_organization_export_atomic", {
        p_organization_id: command.organizationId,
        p_export_job_id: command.exportId,
        p_lease_owner: command.leaseOwner,
        p_expected_checkpoint_version: command.checkpointVersion,
        p_completed_parts: command.completedParts,
        p_total_parts: command.totalParts,
        p_parts: command.parts.map((part) => ({
          sourceId: part.sourceId,
          partNumber: part.partNumber,
          objectPath: part.objectPath,
          sha256: part.sha256,
          byteSize: part.byteSize,
        })),
      });
      const value = outcome(row);
      if (
        !["checkpointed", "conflict", "not_found", "invalid_request"].includes(
          value,
        )
      ) {
        throw new WorkerFailure("malformed_provider", false);
      }
      return Object.freeze({
        outcome: value as
          "checkpointed" | "conflict" | "not_found" | "invalid_request",
        ...(typeof row.checkpoint_version === "number"
          ? { checkpointVersion: row.checkpoint_version }
          : {}),
      });
    },
    complete: async (command) => {
      const row = await this.rpc("complete_organization_export_atomic", {
        p_organization_id: command.organizationId,
        p_export_job_id: command.exportId,
        p_lease_owner: command.leaseOwner,
        p_expected_checkpoint_version: command.checkpointVersion,
        p_manifest_file_count: command.manifestFileCount,
        p_manifest_sha256: command.manifestSha256,
        p_artifact_sha256: command.artifactSha256,
        p_artifact_object_path: command.artifactObjectPath,
      });
      const value = outcome(row);
      if (
        !["completed", "conflict", "verification_failed", "not_found"].includes(
          value,
        )
      ) {
        throw new WorkerFailure("malformed_provider", false);
      }
      return Object.freeze({
        outcome: value as
          "completed" | "conflict" | "verification_failed" | "not_found",
      });
    },
    fail: async (command) => {
      await this.rpc("fail_organization_export_atomic", {
        p_organization_id: command.organizationId,
        p_export_job_id: command.exportId,
        p_lease_owner: command.leaseOwner,
        p_expected_checkpoint_version: command.checkpointVersion,
        p_safe_error_code: command.code,
        p_retryable: command.retryable,
        p_pause: false,
        p_safe_diagnostics: { code: command.code },
      });
    },
  });

  readonly cleanup: TenantLifecycleWorkerDependencies["cleanup"] =
    Object.freeze({
      dueOrganizationIds: async () =>
        this.dueOrganizations("retention_cleanup_runs", [
          "queued",
          "retry",
          "running",
        ]),
      claim: async (organizationId, workerId, leaseSeconds) => {
        const row = await this.rpc("claim_retention_cleanup_atomic", {
          p_organization_id: organizationId,
          p_lease_owner: workerId,
          p_lease_seconds: leaseSeconds,
        });
        const value = outcome(row);
        if (value !== "claimed") {
          if (
            !["none_available", "unavailable", "blocked", "not_found"].includes(
              value,
            )
          )
            throw new WorkerFailure("malformed_provider", false);
          return Object.freeze({
            outcome: value as
              "none_available" | "unavailable" | "blocked" | "not_found",
          });
        }
        if (
          !uuidSchema.safeParse(row.cleanup_run_id).success ||
          !uuidSchema.safeParse(row.lease_owner).success ||
          !Number.isInteger(row.checkpoint_version)
        ) {
          throw new WorkerFailure("malformed_provider", false);
        }
        const run = await this.query(
          this.supabase
            .admin()
            .from("retention_cleanup_runs")
            .select("evidence_class")
            .eq("organization_id", organizationId)
            .eq("id", row.cleanup_run_id as string)
            .maybeSingle(),
        );
        const runRow = record(run.data);
        if (typeof runRow.evidence_class !== "string")
          throw new WorkerFailure("malformed_provider", false);
        const items = await this.query(
          this.supabase
            .admin()
            .from("retention_cleanup_items")
            .select("id, source_record_id")
            .eq("organization_id", organizationId)
            .eq("cleanup_run_id", row.cleanup_run_id as string)
            .eq("status", "pending")
            .order("id", { ascending: true }),
        );
        if (!Array.isArray(items.data))
          throw new WorkerFailure("malformed_provider", false);
        return Object.freeze({
          outcome: "claimed" as const,
          runId: row.cleanup_run_id as string,
          leaseOwner: row.lease_owner as string,
          checkpointVersion: row.checkpoint_version as number,
          evidenceClass: runRow.evidence_class,
          items: Object.freeze(
            items.data.map((value) => {
              const item = record(value);
              if (
                !uuidSchema.safeParse(item.id).success ||
                !uuidSchema.safeParse(item.source_record_id).success
              )
                throw new WorkerFailure("malformed_provider", false);
              return Object.freeze({
                itemId: item.id as string,
                sourceRecordId: item.source_record_id as string,
              });
            }),
          ),
        });
      },
      complete: async (command) => {
        const row = await this.rpc("complete_retention_cleanup_atomic", {
          p_organization_id: command.organizationId,
          p_cleanup_run_id: command.runId,
          p_lease_owner: command.leaseOwner,
          p_expected_checkpoint_version: command.checkpointVersion,
          p_item_results: command.results.map((result) => ({
            itemId: result.itemId,
            status: result.status,
            ...(result.safeErrorCode
              ? { safeErrorCode: result.safeErrorCode }
              : {}),
          })),
        });
        const value = outcome(row);
        if (
          ![
            "completed",
            "blocked",
            "conflict",
            "not_found",
            "invalid_request",
          ].includes(value)
        )
          throw new WorkerFailure("malformed_provider", false);
        return Object.freeze({
          outcome: value as
            | "completed"
            | "blocked"
            | "conflict"
            | "not_found"
            | "invalid_request",
        });
      },
      fail: async (command) => {
        await this.rpc("fail_retention_cleanup_atomic", {
          p_organization_id: command.organizationId,
          p_cleanup_run_id: command.runId,
          p_lease_owner: command.leaseOwner,
          p_expected_checkpoint_version: command.checkpointVersion,
          p_safe_error_code: command.code,
          p_retryable: command.retryable,
          p_safe_diagnostics: { code: command.code },
        });
      },
    });

  readonly purge: TenantLifecycleWorkerDependencies["purge"] = Object.freeze({
    dueOrganizationIds: async () =>
      this.dueOrganizations("organization_purge_jobs", [
        "scheduled",
        "retry",
        "running",
      ]),
    claim: async (organizationId, workerId, leaseSeconds) => {
      const row = await this.rpc("claim_organization_purge_atomic", {
        p_organization_id: organizationId,
        p_lease_owner: workerId,
        p_lease_seconds: leaseSeconds,
      });
      const value = outcome(row);
      if (value !== "claimed") {
        if (
          !["none_available", "blocked", "invalid_state", "not_found"].includes(
            value,
          )
        )
          throw new WorkerFailure("malformed_provider", false);
        return Object.freeze({
          outcome: value as
            "none_available" | "blocked" | "invalid_state" | "not_found",
        });
      }
      if (
        !uuidSchema.safeParse(row.purge_job_id).success ||
        !uuidSchema.safeParse(row.lease_owner).success ||
        !Number.isInteger(row.checkpoint_version)
      )
        throw new WorkerFailure("malformed_provider", false);
      return Object.freeze({
        outcome: "claimed" as const,
        jobId: row.purge_job_id as string,
        leaseOwner: row.lease_owner as string,
        checkpointVersion: row.checkpoint_version as number,
      });
    },
    complete: async (command) => {
      const row = await this.rpc("complete_organization_purge_atomic", {
        p_organization_id: command.organizationId,
        p_purge_job_id: command.purgeJobId,
        p_lease_owner: command.leaseOwner,
        p_expected_checkpoint_version: command.checkpointVersion,
      });
      const value = outcome(row);
      if (!["purged", "blocked", "conflict", "not_found"].includes(value))
        throw new WorkerFailure("malformed_provider", false);
      return Object.freeze({
        outcome: value as "purged" | "blocked" | "conflict" | "not_found",
      });
    },
    fail: async (command) => {
      await this.rpc("fail_organization_purge_atomic", {
        p_organization_id: command.organizationId,
        p_purge_job_id: command.purgeJobId,
        p_lease_owner: command.leaseOwner,
        p_expected_checkpoint_version: command.checkpointVersion,
        p_safe_error_code: command.code,
        p_retryable: command.retryable,
        p_safe_diagnostics: { code: command.code },
      });
    },
  });

  readonly artifactWork: TenantLifecycleWorkerDependencies["artifactWork"] =
    Object.freeze({
      claim: async (workerId, leaseSeconds) => {
        const row = await this.rpc(
          "claim_organization_deletion_artifact_work_atomic",
          {
            p_lease_owner: workerId,
            p_lease_seconds: leaseSeconds,
          },
        );
        const value = outcome(row);
        if (value !== "claimed") {
          if (value !== "none_available" && value !== "not_found") {
            throw new WorkerFailure("malformed_provider", false);
          }
          return Object.freeze({
            outcome: value,
          });
        }
        if (
          !uuidSchema.safeParse(row.work_id).success ||
          typeof row.object_prefix !== "string" ||
          row.object_prefix.length === 0
        ) {
          throw new WorkerFailure("malformed_provider", false);
        }
        return Object.freeze({
          outcome: "claimed" as const,
          workId: row.work_id as string,
          objectPrefix: row.object_prefix,
        });
      },
      complete: async (workId, leaseOwner) => {
        const row = await this.rpc(
          "complete_organization_deletion_artifact_work_atomic",
          { p_work_id: workId, p_lease_owner: leaseOwner },
        );
        const value = outcome(row);
        if (!["completed", "conflict", "not_found"].includes(value)) {
          throw new WorkerFailure("malformed_provider", false);
        }
        return Object.freeze({
          outcome: value as "completed" | "conflict" | "not_found",
        });
      },
      fail: async (command) => {
        await this.rpc("fail_organization_deletion_artifact_work_atomic", {
          p_work_id: command.workId,
          p_lease_owner: command.leaseOwner,
          p_safe_error_code: command.code,
          p_retryable: command.retryable,
        });
      },
    });

  private async dueOrganizations(
    table:
      | "organization_export_jobs"
      | "retention_cleanup_runs"
      | "organization_purge_jobs",
    statuses: readonly string[],
  ): Promise<readonly string[]> {
    const result = await this.query(
      this.supabase
        .admin()
        .from(table)
        .select("organization_id")
        .in("status", [...statuses])
        .lte("available_at", new Date().toISOString())
        .limit(1000),
    );
    if (!Array.isArray(result.data))
      throw new WorkerFailure("malformed_provider", false);
    return Object.freeze(
      result.data.flatMap((value) => {
        const parsed = uuidSchema.safeParse(record(value).organization_id);
        return parsed.success ? [parsed.data] : [];
      }),
    );
  }

  private async rpc(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<ProviderRow> {
    const result = await this.query(
      (
        this.supabase.admin() as unknown as {
          rpc(
            name: string,
            args: Readonly<Record<string, unknown>>,
          ): Promise<ProviderResult>;
        }
      ).rpc(name, args),
    );
    return single(result.data);
  }

  private async query(
    pending: PromiseLike<ProviderResult>,
  ): Promise<ProviderResult> {
    try {
      const result = await pending;
      if (result.error) throw new WorkerFailure("provider_unavailable", true);
      return result;
    } catch (error) {
      if (error instanceof WorkerFailure) throw error;
      throw new WorkerFailure("provider_unavailable", true);
    }
  }

  private exportClaimFailure(
    value: string,
  ): "none_available" | "invalid_state" | "not_found" {
    if (["none_available", "invalid_state", "not_found"].includes(value))
      return value as "none_available" | "invalid_state" | "not_found";
    throw new WorkerFailure("malformed_provider", false);
  }
}

/** Writes and verifies only private tenant-export objects. */
@Injectable()
export class SupabaseTenantLifecycleStorageAdapter {
  constructor(private readonly supabase: SupabaseService) {}

  async read(path: string): Promise<Buffer | null> {
    try {
      const { data, error } = await this.supabase
        .admin()
        .storage.from("tenant-exports")
        .download(path);
      if (error) return null;
      if (!data) throw new WorkerFailure("malformed_provider", false);
      return Buffer.from(await data.arrayBuffer());
    } catch (error) {
      if (error instanceof WorkerFailure) throw error;
      throw new WorkerFailure("provider_unavailable", true);
    }
  }

  async write(
    path: string,
    bytes: Buffer,
    contentType = "application/octet-stream",
  ): Promise<void> {
    try {
      const { error } = await this.supabase
        .admin()
        .storage.from("tenant-exports")
        .upload(path, bytes, {
          contentType,
          upsert: true,
        });
      if (error) throw new WorkerFailure("provider_unavailable", true);
    } catch (error) {
      if (error instanceof WorkerFailure) throw error;
      throw new WorkerFailure("provider_unavailable", true);
    }
  }

  async inventory(organizationId: string): Promise<readonly string[]> {
    return this.listPrefix(`${organizationId}/`);
  }

  async deletePrefix(prefix: string): Promise<void> {
    const paths = await this.listPrefix(prefix);
    for (let index = 0; index < paths.length; index += 100) {
      const { error } = await this.supabase
        .admin()
        .storage.from("tenant-exports")
        .remove(paths.slice(index, index + 100));
      if (error) throw new WorkerFailure("provider_unavailable", true);
    }
  }

  private async listPrefix(prefix: string): Promise<readonly string[]> {
    try {
      const bucket = this.supabase.admin().storage.from("tenant-exports");
      const paths: string[] = [];
      let offset = 0;
      for (;;) {
        const { data, error } = await bucket.list(prefix, {
          limit: 1000,
          offset,
        });
        if (error) throw new WorkerFailure("provider_unavailable", true);
        if (!Array.isArray(data))
          throw new WorkerFailure("malformed_provider", false);
        for (const entry of data) {
          if (!/^[a-zA-Z0-9._-]+$/.test(entry.name)) {
            throw new WorkerFailure("malformed_provider", false);
          }
          const path = `${prefix}${entry.name}`;
          if (entry.id === null) {
            paths.push(...(await this.listPrefix(`${path}/`)));
          } else {
            paths.push(path);
          }
        }
        if (data.length < 1000) break;
        offset += data.length;
      }
      return Object.freeze(paths.sort());
    } catch (error) {
      if (error instanceof WorkerFailure) throw error;
      throw new WorkerFailure("provider_unavailable", true);
    }
  }
}

/** Reads only immutable, SQL-redacted records from a claimed export snapshot. */
@Injectable()
export class SupabaseTenantExportSourceAdapter {
  private readonly maximumSourceBytes: number;

  constructor(
    private readonly supabase: SupabaseService,
    config: ConfigService,
  ) {
    this.maximumSourceBytes = config.getOrThrow<number>(
      "TENANT_EXPORT_MAX_ARCHIVE_BYTES",
    );
  }

  async read(
    organizationId: string,
    exportId: string,
    sourceId: string,
  ): Promise<Buffer> {
    const source = exportSourceRegistry.find(
      (entry) => entry.sourceId === sourceId,
    );
    if (!source) throw new WorkerFailure("invalid_export_source", false);
    const records = await this.readSnapshotRecords(
      organizationId,
      exportId,
      sourceId,
    );
    const lines: string[] = [];
    let byteSize = 0;
    for (const snapshot of records) {
      if (!source.tables.includes(snapshot.tableName)) {
        throw new WorkerFailure("malformed_provider", false);
      }
      if (hasSensitiveKey(snapshot.payload)) {
        throw new WorkerFailure("snapshot_sensitive_payload", false);
      }
      const line = JSON.stringify(
        source.tables.length === 1
          ? snapshot.payload
          : { table: snapshot.tableName, record: snapshot.payload },
      );
      byteSize += Buffer.byteLength(line, "utf8") + 1;
      if (byteSize > this.maximumSourceBytes) {
        throw new WorkerFailure("export_size_limit", false);
      }
      lines.push(line);
    }
    return Buffer.from(
      lines.length === 0 ? "" : `${lines.join("\n")}\n`,
      "utf8",
    );
  }

  private async readSnapshotRecords(
    organizationId: string,
    exportId: string,
    sourceId: string,
  ): Promise<
    readonly Readonly<{
      tableName: string;
      tableSort: number;
      recordIndex: number;
      payload: Readonly<Record<string, unknown>>;
    }>[]
  > {
    const client = this.supabase.admin() as unknown as {
      from(tableName: string): {
        select(columns: string): {
          eq(
            column: string,
            value: string,
          ): {
            eq(
              column: string,
              value: string,
            ): {
              eq(
                column: string,
                value: string,
              ): {
                order(
                  column: string,
                  options: Readonly<{ ascending: boolean }>,
                ): {
                  order(
                    column: string,
                    options: Readonly<{ ascending: boolean }>,
                  ): {
                    range(
                      from: number,
                      to: number,
                    ): PromiseLike<ProviderResult>;
                  };
                };
              };
            };
          };
        };
      };
    };
    try {
      const query = client
        .from("organization_export_snapshot_records")
        .select("table_name, table_sort, record_index, record_payload")
        .eq("organization_id", organizationId)
        .eq("export_job_id", exportId)
        .eq("source_id", sourceId)
        .order("table_sort", { ascending: true })
        .order("record_index", { ascending: true });
      const records: Readonly<{
        tableName: string;
        tableSort: number;
        recordIndex: number;
        payload: Readonly<Record<string, unknown>>;
      }>[] = [];
      let offset = 0;
      for (;;) {
        const result = await query.range(offset, offset + exportPageSize - 1);
        if (result.error) throw new WorkerFailure("provider_unavailable", true);
        if (!Array.isArray(result.data))
          throw new WorkerFailure("malformed_provider", false);
        for (const value of result.data) {
          const parsed = snapshotRecordSchema.safeParse(value);
          if (!parsed.success) {
            throw new WorkerFailure("malformed_provider", false);
          }
          records.push(
            Object.freeze({
              tableName: parsed.data.table_name,
              tableSort: parsed.data.table_sort,
              recordIndex: parsed.data.record_index,
              payload: Object.freeze(parsed.data.record_payload),
            }),
          );
        }
        if (result.data.length < exportPageSize) break;
        offset += result.data.length;
      }
      return Object.freeze(records);
    } catch (error) {
      if (error instanceof WorkerFailure) throw error;
      throw new WorkerFailure("provider_unavailable", true);
    }
  }
}

/** Missing M2/M3 artifact ownership fails closed instead of direct table access. */
@Injectable()
export class UnavailableEvidenceCleanupAdapter {
  remove(): Promise<never> {
    return Promise.reject(new WorkerFailure("dependency_unavailable", true));
  }
}

/**
 * Product/SBOM/evidence artifacts have no owning production adapter in M1.
 * Export therefore fails closed rather than declaring an incomplete ZIP final.
 * A future owner must copy immutable bytes and record their hash/metadata
 * before returning `snapshotted` through this port.
 */
@Injectable()
export class UnavailableTenantExportArtifactSnapshotAdapter {
  snapshot(): Promise<Readonly<{ outcome: "unavailable" }>> {
    return Promise.resolve(Object.freeze({ outcome: "unavailable" as const }));
  }
}
