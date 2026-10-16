import { z } from "zod";
import {
  exportArtifactSchema,
  exportJobSchema,
  exportScopeSchema,
  exportSnapshotRowSchema,
  exportSources,
} from "@repo/contracts/exports";
import { SupabaseService } from "../../supabase/supabase.service";
import type {
  ExportPartCheckpoint,
  ExportWorkerRepository,
  FrozenExportJob,
} from "../worker/export-worker.types";
const partSchema = exportArtifactSchema.extend({
  objectPath: z.string(),
  startOrdinal: z.number().int().positive(),
  endOrdinal: z.number().int().nonnegative(),
});
const privateJobSchema = z.object({
  publicJob: z.unknown(),
  organizationId: z.uuid(),
  source: z.string(),
  format: z.enum(["csv", "xlsx", "report"]),
  scope: exportScopeSchema,
  columns: z.array(z.string()),
  requestDigest: z.string().regex(/^[0-9a-f]{64}$/),
  snapshotAsOf: z.string().nullable(),
  totalRows: z.number().int().nonnegative().nullable(),
  parts: z.array(partSchema).max(512),
  workerId: z.string(),
  version: z.number().int().positive(),
  sourceVersionsDigest: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
});
type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{
  data: unknown;
  error: { message: string; code?: string } | null;
}>;

export class SupabaseExportWorkerRepository implements ExportWorkerRepository {
  constructor(private readonly supabase: SupabaseService) {}
  async claim(workerId: string) {
    const value = await this.rpc("claim_export", { p_worker_id: workerId });
    return value === null ? null : parseJob(value);
  }
  async capture(job: FrozenExportJob) {
    return parseJob(await this.rpc("capture_export", args(job)));
  }
  async publishCapture(job: FrozenExportJob) {
    return parseJob(await this.rpc("publish_capture", args(job)));
  }
  async heartbeat(job: FrozenExportJob) {
    return parseJob(await this.rpc("heartbeat_export", args(job)));
  }
  async authorize(job: FrozenExportJob) {
    return z
      .boolean()
      .parse(await this.rpc("authorize_export_worker", args(job)));
  }
  async rows(job: FrozenExportJob, afterOrdinal: number, limit: number) {
    return z
      .array(exportSnapshotRowSchema)
      .max(250)
      .parse(
        await this.rpc("read_export_rows", {
          ...args(job),
          p_after_ordinal: afterOrdinal,
          p_limit: limit,
        }),
      );
  }
  async checkpoint(
    job: FrozenExportJob,
    parts: readonly ExportPartCheckpoint[],
  ) {
    return parseJob(
      await this.rpc("checkpoint_export", {
        ...args(job),
        p_parts: parts,
        p_processed_rows: parts.at(-1)?.endOrdinal ?? 0,
      }),
    );
  }
  async complete(
    job: FrozenExportJob,
    manifest: Readonly<Record<string, unknown>>,
  ) {
    await this.rpc("complete_export", { ...args(job), p_manifest: manifest });
  }
  async fail(job: FrozenExportJob, code: string) {
    await this.rpc("fail_export", { ...args(job), p_failure_code: code });
  }
  private async rpc(name: string, parameters: Record<string, unknown>) {
    const client = this.supabase.admin() as unknown as { rpc: Rpc };
    const response = await client.rpc(`m14_03_${name}`, parameters);
    if (response.error) {
      const safeFailure =
        (
          {
            "54000": "export_limit",
            "42501": "access_changed",
            "57014": "capture_timeout",
            "40001": "lease_conflict",
          } as Readonly<Record<string, string>>
        )[response.error.code ?? ""] ?? "provider_unavailable";
      throw new Error(safeFailure);
    }
    return response.data;
  }
}
function args(job: FrozenExportJob) {
  return {
    p_organization_id: job.organizationId,
    p_job_id: job.id,
    p_worker_id: job.workerId,
    p_expected_version: job.version,
  };
}
export function parseJob(value: unknown): FrozenExportJob {
  const row = privateJobSchema.parse(value);
  const publicJob = exportJobSchema.parse(row.publicJob);
  const definition = exportSources[row.source as keyof typeof exportSources];
  const columns =
    row.format === "report"
      ? []
      : row.columns.map((key) => {
          const column = definition?.columns.find((entry) => entry.key === key);
          if (!column) throw new Error("malformed_provider");
          return column;
        });
  return {
    id: publicJob.id,
    organizationId: row.organizationId,
    workerId: row.workerId,
    version: row.version,
    source: row.source,
    requestedAt: publicJob.requestedAt,
    requestDigest: row.requestDigest,
    scope: row.scope,
    format: row.format,
    snapshotAsOf: row.snapshotAsOf,
    totalRows: row.totalRows ?? 0,
    columns,
    parts: row.parts,
    captureState:
      publicJob.state === "audit_pending"
        ? "captured"
        : publicJob.state === "rendering"
          ? "published"
          : "pending",
    sourceVersionsDigest: row.sourceVersionsDigest,
  };
}
