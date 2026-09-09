import { Injectable } from "@nestjs/common";
import {
  reportingObligationDetailResponseSchema,
  reportingObligationListResponseSchema,
  reportingObligationMutationResponseSchema,
  reportingDeadlineSummaryResponseSchema,
  type CancelReportingObligationInput,
  type CorrectReportingObligationAnchorInput,
  type CreateReportingObligationInput,
  type RecordReportingObligationStageSubmissionInput,
  type ReportingObligationDetailResponse,
  type ReportingObligationListQuery,
  type ReportingObligationListResponse,
  type ReportingObligationMutationResponse,
  type ReportingDeadlineSummaryResponse,
} from "@repo/contracts/reporting";
import { z } from "zod";

import { SupabaseService } from "../../supabase/supabase.service";
import {
  ReportingObligationConflictError,
  ReportingObligationInvalidRequestError,
  ReportingObligationInvalidStateError,
  type ReportingObligationRepository,
} from "../application/reporting-obligation.port";

type RpcClient = Readonly<{
  rpc(
    name: string,
    args?: Readonly<Record<string, unknown>>,
  ): Promise<
    Readonly<{
      data: unknown;
      error: Readonly<{ code?: string; message: string }> | null;
    }>
  >;
}>;

@Injectable()
export class SupabaseReportingObligationRepository implements ReportingObligationRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async deadlineSummary(
    organizationId: string,
    input: Readonly<{ actorId: string }>,
  ): Promise<ReportingDeadlineSummaryResponse | null> {
    const rpc = await this.summaryResult("get_reporting_deadline_summary", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
    });
    if (rpc.outcome === "not_found") return null;
    if (rpc.outcome !== "found") {
      throw new Error("reporting deadline summary unavailable");
    }
    return reportingDeadlineSummaryResponseSchema.parse(
      reportingDeadlineSummaryFromWire(normalizeWireTimestamps(rpc.summary)),
    );
  }

  async list(
    organizationId: string,
    input: Readonly<{ actorId: string } & ReportingObligationListQuery>,
  ): Promise<ReportingObligationListResponse | null> {
    const payload = await this.rpcOrNull("list_reporting_obligations", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_cursor: input.cursor ?? null,
      p_limit: input.limit,
      p_type: input.type ?? null,
      p_status: input.status ?? null,
      p_finding_id: input.findingId ?? null,
    });
    return payload === null
      ? null
      : reportingObligationListResponseSchema.parse(
          normalizeWireTimestamps(payload),
        );
  }

  async detail(
    organizationId: string,
    input: Readonly<{ actorId: string; obligationId: string }>,
  ): Promise<ReportingObligationDetailResponse | null> {
    const payload = await this.rpcOrNull("get_reporting_obligation", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_obligation_id: input.obligationId,
    });
    return payload === null
      ? null
      : reportingObligationDetailResponseSchema.parse(
          normalizeWireTimestamps(payload),
        );
  }

  async create(
    organizationId: string,
    input: Readonly<{ actorId: string } & CreateReportingObligationInput>,
  ): Promise<ReportingObligationMutationResponse | null> {
    return this.mutation("create_reporting_obligation_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_obligation_type: input.type,
      p_source_finding_id:
        input.source.kind === "finding" ? input.source.findingId : null,
      p_awareness_at: input.awarenessAt,
      p_awareness_basis: input.awarenessBasis,
      p_idempotency_key: input.idempotencyKey,
      p_correlation_id: null,
    });
  }

  async correctAnchor(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        obligationId: string;
      } & CorrectReportingObligationAnchorInput
    >,
  ): Promise<ReportingObligationMutationResponse | null> {
    return this.mutation("correct_reporting_obligation_anchor_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_obligation_id: input.obligationId,
      p_anchor_kind: input.anchor,
      p_anchor_at: input.anchorAt,
      p_basis: input.basis ?? null,
      p_reason: input.reason,
      p_expected_version: input.expectedVersion,
      p_idempotency_key: input.idempotencyKey,
      p_correlation_id: null,
    });
  }

  async recordSubmission(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        obligationId: string;
      } & RecordReportingObligationStageSubmissionInput
    >,
  ): Promise<ReportingObligationMutationResponse | null> {
    return this.mutation(
      "record_reporting_obligation_stage_submission_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_obligation_id: input.obligationId,
        p_stage_kind: input.stage,
        p_submitted_at: input.submittedAt,
        p_submission_reference: input.submissionReference,
        p_expected_version: input.expectedVersion,
        p_idempotency_key: input.idempotencyKey,
        p_correlation_id: null,
      },
    );
  }

  async cancel(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        obligationId: string;
      } & CancelReportingObligationInput
    >,
  ): Promise<ReportingObligationMutationResponse | null> {
    return this.mutation("cancel_reporting_obligation_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_obligation_id: input.obligationId,
      p_reason: input.reason,
      p_expected_version: input.expectedVersion,
      p_idempotency_key: input.idempotencyKey,
      p_correlation_id: null,
    });
  }

  private async mutation(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<ReportingObligationMutationResponse | null> {
    const rpc = await this.result(name, args);
    if (isConflict(rpc.outcome)) throw new ReportingObligationConflictError();
    if (rpc.outcome === "not_found") return null;
    if (rpc.outcome === "invalid_request")
      throw new ReportingObligationInvalidRequestError();
    if (rpc.outcome === "invalid_state")
      throw new ReportingObligationInvalidStateError();
    if (
      !["created", "updated", "cancelled", "idempotent"].includes(rpc.outcome)
    )
      throw new Error("reporting obligation unavailable");
    return reportingObligationMutationResponseSchema.parse(
      normalizeWireTimestamps(rpc.result),
    );
  }

  private async rpcOrNull(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const rpc = await this.result(name, args);
    if (rpc.outcome === "not_found") return null;
    if (rpc.outcome === "invalid_request")
      throw new ReportingObligationInvalidRequestError();
    if (rpc.outcome !== "found")
      throw new Error("reporting obligation unavailable");
    return rpc.result;
  }

  private async result(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<Readonly<{ outcome: string; result: unknown }>> {
    const response = await this.client().rpc(name, args);
    if (response.error) throw new Error("reporting obligation unavailable");
    const row = one(response.data);
    if (row === null || typeof row !== "object" || Array.isArray(row))
      throw new Error("invalid reporting obligation result");
    const outcome = (row as Record<string, unknown>).outcome;
    if (typeof outcome !== "string")
      throw new Error("invalid reporting obligation outcome");
    return { outcome, result: (row as Record<string, unknown>).result };
  }

  private async summaryResult(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<Readonly<{ outcome: string; summary: unknown }>> {
    const response = await this.client().rpc(name, args);
    if (response.error)
      throw new Error("reporting deadline summary unavailable");
    const row = one(response.data);
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("invalid reporting deadline summary result");
    }
    const outcome = (row as Record<string, unknown>).outcome;
    if (typeof outcome !== "string") {
      throw new Error("invalid reporting deadline summary outcome");
    }
    return { outcome, summary: (row as Record<string, unknown>).summary };
  }

  private client(): RpcClient {
    return this.supabase.admin() as unknown as RpcClient;
  }
}

function isConflict(outcome: string): boolean {
  return ["conflict", "idempotency_conflict", "version_conflict"].includes(
    outcome,
  );
}

function one(data: unknown): unknown {
  if (!Array.isArray(data) || data.length !== 1)
    throw new Error("invalid reporting obligation result");
  return data[0];
}

function normalizeWireTimestamps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeWireTimestamps);
  if (value === null || typeof value !== "object") {
    if (typeof value !== "string" || !value.includes("T")) return value;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp)
      ? new Date(timestamp).toISOString().replace(".000Z", "Z")
      : value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      normalizeWireTimestamps(nested),
    ]),
  );
}

const reportingDeadlineSummaryWireSchema = z
  .object({
    serverNow: z.string(),
    overdueCount: z.number().int().nonnegative(),
    nextDeadline: z
      .object({
        obligationId: z.uuid(),
        stage: z.enum(["early_warning", "notification", "final_report"]),
        dueAt: z.string(),
        elapsedPercent: z.number().min(0).max(100),
        reportingHref: z.string(),
      })
      .strict()
      .nullable(),
  })
  .strict();

function reportingDeadlineSummaryFromWire(value: unknown): unknown {
  const summary = reportingDeadlineSummaryWireSchema.parse(value);
  return {
    summary: {
      serverNow: summary.serverNow,
      overdueCount: summary.overdueCount,
      nextDeadline: summary.nextDeadline,
    },
  };
}
