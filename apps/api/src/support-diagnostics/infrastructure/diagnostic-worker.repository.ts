import { z } from "zod";
import {
  diagnosticJobSchema,
  diagnosticLogSchema,
  diagnosticOmissionSchema,
} from "@repo/contracts/support-diagnostics";
import type {
  SupportDiagnosticJob,
  SupportDiagnosticManifest,
  SupportDiagnosticOmission,
} from "@repo/contracts/support-diagnostics";
import { SupabaseService } from "../../supabase/supabase.service";
import type {
  DiagnosticClaim,
  DiagnosticCleanupClaim,
  DiagnosticWorkerRepository,
} from "../worker/diagnostic-worker.port";
const claimSchema = z.object({
  job: diagnosticJobSchema,
  creatorUserId: z.uuid(),
  sessionId: z.uuid(),
  permissionVersion: z.string().min(1),
  objectPath: z.string(),
  objectPaths: z.array(z.string()).max(3).optional(),
});
const cleanupClaimSchema = claimSchema.extend({
  objectPath: z.string().nullable(),
  objectPaths: z.array(z.string()).max(3),
});
const envelope = z.object({
  outcome: z.string(),
  result: z.unknown().optional(),
});
export class DiagnosticWorkerRepositoryAdapter implements DiagnosticWorkerRepository {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly workerId: string,
  ) {}
  private async rpc(
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal = AbortSignal.timeout(10_000),
  ) {
    const client = this.supabase.adminWithSignal(signal) as unknown as {
      rpc(
        name: string,
        args: Record<string, unknown>,
      ): Promise<{ data: unknown; error: unknown }>;
    };
    const result = await client.rpc(name, args);
    if (result.error) throw new Error("provider_unavailable");
    const checked = envelope.safeParse(result.data);
    if (!checked.success) throw new Error("invalid_value");
    const parsed = checked.data;
    if (parsed.outcome === "empty") return null;
    if (parsed.outcome === "invalid") throw new Error("invalid_value");
    if (parsed.outcome !== "ok") throw new Error("access_changed");
    return parsed.result;
  }
  private args(claim: Pick<DiagnosticClaim, "job">) {
    return {
      p_organization_id: claim.job.organizationId,
      p_job_id: claim.job.id,
      p_worker_id: this.workerId,
      p_expected_version: claim.job.version,
    };
  }
  async claim(signal?: AbortSignal) {
    const result = await this.rpc(
      "m15_04_claim",
      {
        p_worker_id: this.workerId,
      },
      signal,
    );
    return result === null ? null : claimSchema.parse(result);
  }
  async authorize(claim: DiagnosticClaim, signal?: AbortSignal) {
    return claimSchema.parse(
      await this.rpc("m15_04_authorize_worker", this.args(claim), signal),
    );
  }
  async heartbeat(claim: DiagnosticClaim, signal?: AbortSignal) {
    return claimSchema.parse(
      await this.rpc("m15_04_heartbeat", this.args(claim), signal),
    );
  }
  async checkpoint(
    claim: DiagnosticClaim,
    stage: "collecting" | "redacting" | "packaging",
    completed: number,
    omissions: SupportDiagnosticOmission[],
    signal?: AbortSignal,
  ) {
    return claimSchema.parse(
      await this.rpc(
        "m15_04_checkpoint",
        {
          ...this.args(claim),
          p_stage: stage,
          p_progress: {
            completed,
            total: claim.job.selection.categories.length,
          },
          p_omissions: omissions,
        },
        signal,
      ),
    );
  }
  async complete(
    claim: DiagnosticClaim,
    artifact: NonNullable<SupportDiagnosticJob["artifact"]>,
    manifest: SupportDiagnosticManifest,
    signal?: AbortSignal,
  ) {
    diagnosticJobSchema.parse(
      await this.rpc(
        "m15_04_complete",
        {
          ...this.args(claim),
          p_artifact: artifact,
          p_manifest: manifest,
        },
        signal,
      ),
    );
  }
  async fail(claim: DiagnosticClaim, code: string, signal?: AbortSignal) {
    diagnosticJobSchema.parse(
      await this.rpc(
        "m15_04_fail",
        {
          ...this.args(claim),
          p_failure_code: code,
        },
        signal,
      ),
    );
  }
  async logs(claim: DiagnosticClaim, signal?: AbortSignal) {
    return z
      .strictObject({
        logs: z.array(diagnosticLogSchema).max(5000),
        omissions: z.array(diagnosticOmissionSchema).max(30),
      })
      .parse(await this.rpc("m15_04_logs", this.args(claim), signal));
  }
  async claimCleanup(signal?: AbortSignal) {
    const result = await this.rpc(
      "m15_04_claim_cleanup",
      {
        p_worker_id: this.workerId,
      },
      signal,
    );
    return result === null ? null : cleanupClaimSchema.parse(result);
  }
  async authorizeCleanup(claim: DiagnosticCleanupClaim, signal?: AbortSignal) {
    return cleanupClaimSchema.parse(
      await this.rpc("m15_04_authorize_cleanup", this.args(claim), signal),
    );
  }
  async finishCleanup(
    claim: DiagnosticCleanupClaim,
    deleted: boolean,
    signal?: AbortSignal,
  ) {
    diagnosticJobSchema.parse(
      await this.rpc(
        "m15_04_finish_cleanup",
        {
          ...this.args(claim),
          p_deleted: deleted,
        },
        signal,
      ),
    );
  }
}
