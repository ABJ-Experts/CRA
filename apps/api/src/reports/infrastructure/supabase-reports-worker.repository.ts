import { z } from "zod";
import { SupabaseService } from "../../supabase/supabase.service";
import {
  SupabaseExportWorkerRepository,
  parseJob,
} from "../../exports/infrastructure/export-worker.repository";
import type { FrozenExportJob } from "../../exports/worker/export-worker.types";
import {
  reportRecipientClaimSchema,
  type ReportRecipientClaim,
  type ReportsWorkerQueue,
} from "../worker/reports-worker";

type RpcResult = Readonly<{ data: unknown; error: { code?: string } | null }>;
type RpcClient = Readonly<{
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
}>;
const workerConflict = (code: string | undefined) =>
  code === "40001" || code === "P0001";

export class SupabaseReportsWorkerRepository implements ReportsWorkerQueue {
  constructor(private readonly supabase: SupabaseService) {}
  async scheduleDue(workerId: string, limit: number): Promise<number> {
    return this.call(
      "m14_04_schedule_due",
      { p_worker_id: workerId, p_limit: limit },
      z.number().int().nonnegative(),
    );
  }
  claimRecipient(workerId: string): Promise<ReportRecipientClaim | null> {
    return this.call(
      "m14_04_claim_recipient",
      { p_worker_id: workerId },
      reportRecipientClaimSchema.nullable(),
    );
  }
  authorizeRecipient(claim: ReportRecipientClaim): Promise<boolean> {
    return this.call(
      "m14_04_authorize_recipient",
      {
        p_organization_id: claim.organizationId,
        p_recipient_id: claim.recipientId,
      },
      z.boolean(),
    );
  }
  admitExport(
    claim: ReportRecipientClaim,
    context: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    return this.call(
      "m14_04_admit_export",
      {
        ...this.fence(claim),
        p_context: context,
      },
      z.unknown().nullable(),
    );
  }
  publishRecipient(claim: ReportRecipientClaim): Promise<unknown> {
    return this.call(
      "m14_04_publish_recipient",
      {
        ...this.fence(claim),
        p_manifest: {},
      },
      z.unknown().nullable(),
    );
  }
  failRecipient(claim: ReportRecipientClaim, code: string): Promise<unknown> {
    return this.call(
      "m14_04_fail_recipient",
      {
        ...this.fence(claim),
        p_code: code,
      },
      z.unknown(),
    );
  }
  heartbeatRecipient(claim: ReportRecipientClaim): Promise<boolean> {
    return this.call(
      "m14_04_heartbeat_recipient",
      this.fence(claim),
      z.boolean(),
    );
  }
  private fence(claim: ReportRecipientClaim) {
    return {
      p_organization_id: claim.organizationId,
      p_recipient_id: claim.recipientId,
      p_worker_id: claim.workerId,
      p_expected_version: claim.version,
    };
  }
  private async call<T>(
    name: string,
    args: Record<string, unknown>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    let response: RpcResult;
    try {
      response = await (this.supabase.admin() as unknown as RpcClient).rpc(
        name,
        args,
      );
    } catch {
      throw new Error("provider_unavailable");
    }
    if (response.error) {
      const code = response.error.code;
      if (code === "42501") throw new Error("access_changed");
      if (workerConflict(code)) throw new Error("lease_conflict");
      if (code === "57014") throw new Error("capture_timeout");
      throw new Error("provider_unavailable");
    }
    const parsed = schema.safeParse(response.data);
    if (!parsed.success) throw new Error("provider_unavailable");
    return parsed.data;
  }
}

/** Scheduled jobs reuse the existing bounded renderer, capture and storage flow. */
export class ScheduledExportWorkerRepository extends SupabaseExportWorkerRepository {
  constructor(private readonly reportsSupabase: SupabaseService) {
    super(reportsSupabase);
  }
  override async claim(workerId: string): Promise<FrozenExportJob | null> {
    const client = this.reportsSupabase.admin() as unknown as RpcClient;
    let response: RpcResult;
    try {
      response = await client.rpc("m14_04_claim_export", {
        p_worker_id: workerId,
      });
    } catch {
      throw new Error("provider_unavailable");
    }
    if (response.error)
      throw new Error(
        workerConflict(response.error.code)
          ? "lease_conflict"
          : "provider_unavailable",
      );
    if (response.data === null) return null;
    try {
      return parseJob(response.data);
    } catch {
      throw new Error("provider_unavailable");
    }
  }
}
