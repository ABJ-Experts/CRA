import { Injectable } from "@nestjs/common";
import {
  acquireReportingStageDraftLockResponseSchema,
  reportingFamilyTemplateResponseSchema,
  reportingFamilyTemplatesResponseSchema,
  reportingStageDraftResponseSchema,
  reportingStageDraftApprovalResponseSchema,
  reportingStageSubmissionSnapshotResponseSchema,
  reauthenticateReportingStageApprovalResponseSchema,
  reportingObligationDetailResponseSchema,
  reportingObligationListResponseSchema,
  reportingObligationMutationResponseSchema,
  reportingDeadlineSummaryResponseSchema,
  type AcquireReportingStageDraftLockInput,
  type AcquireReportingStageDraftLockResponse,
  type ApproveReportingStageDraftInput,
  type ApplyReportingFamilyTemplateInput,
  type CancelReportingObligationInput,
  type CorrectReportingObligationAnchorInput,
  type CreateReportingFamilyTemplateInput,
  type CreateReportingFamilyTemplateVersionInput,
  type CreateReportingObligationInput,
  type CreateReportingStageDraftInput,
  type RecordReportingObligationStageSubmissionInput,
  type ReportingObligationDetailResponse,
  type ReportingObligationListQuery,
  type ReportingObligationListResponse,
  type ReportingObligationMutationResponse,
  type ReportingDeadlineSummaryResponse,
  type ReportingFamilyTemplateListQuery,
  type ReportingFamilyTemplateParams,
  type ReportingFamilyTemplateResponse,
  type ReportingFamilyTemplatesResponse,
  type ReportingStageDraftParams,
  type ReportingStageDraftResponse,
  type ReportingStageDraftApprovalResponse,
  type ReportingStageSubmissionSnapshotResponse,
  type SaveReportingStageDraftInput,
  type ReauthenticateReportingStageApprovalResponse,
  type SubmitReportingStageDraftInput,
} from "@repo/contracts/reporting";
import { z } from "zod";

import { SupabaseService } from "../../supabase/supabase.service";
import {
  ReportingObligationConflictError,
  ReportingObligationInvalidRequestError,
  ReportingObligationInvalidStateError,
  ReportingStageDraftConflictError,
  ReportingStageDraftLockedError,
  ReportingStageApprovalProofError,
  ReportingStageApprovalSodError,
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

  async getStageDraft(
    organizationId: string,
    input: Readonly<{ actorId: string } & ReportingStageDraftParams>,
  ): Promise<ReportingStageDraftResponse | null> {
    const rpc = await this.result("get_reporting_stage_draft", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_stage_id: input.stageId,
    });
    const response = this.stageDraftResult(rpc);
    return response?.draft.obligationId === input.obligationId
      ? response
      : null;
  }

  async createStageDraft(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        obligationId: string;
        stageId: string;
      } & CreateReportingStageDraftInput
    >,
  ): Promise<ReportingStageDraftResponse | null> {
    const rpc = await this.result("create_reporting_stage_draft_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_obligation_id: input.obligationId,
      p_stage_id: input.stageId,
      p_release_id: input.releaseId,
      p_idempotency_key: input.idempotencyKey,
      p_correlation_id: null,
    });
    return this.stageDraftResult(rpc);
  }

  async acquireStageDraftLock(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        obligationId: string;
        stageId: string;
      } & AcquireReportingStageDraftLockInput
    >,
  ): Promise<AcquireReportingStageDraftLockResponse | null> {
    const draft = await this.draftForStage(organizationId, input);
    if (draft === null) return null;
    const rpc = await this.result("acquire_reporting_stage_draft_lock_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_draft_id: draft.id,
      p_expected_version: input.expectedRevision,
      p_idempotency_key: input.idempotencyKey,
      p_correlation_id: null,
    });
    this.throwStageDraftFailure(rpc);
    if (!["updated", "found"].includes(rpc.outcome)) {
      throw new Error("reporting stage draft unavailable");
    }
    return acquireReportingStageDraftLockResponseSchema.parse(
      normalizeWireTimestamps(rpc.result),
    );
  }

  async saveStageDraft(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        obligationId: string;
        stageId: string;
      } & SaveReportingStageDraftInput
    >,
  ): Promise<ReportingStageDraftResponse | null> {
    const draft = await this.draftForStage(organizationId, input);
    if (draft === null) return null;
    const rpc = await this.result("save_reporting_stage_draft_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_draft_id: draft.id,
      p_expected_version: input.expectedRevision,
      p_lock_token: input.lockToken,
      ...draftPersistence(input),
      p_idempotency_key: input.idempotencyKey,
      p_correlation_id: null,
    });
    return this.stageDraftResult(rpc);
  }

  async submitStageDraft(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        obligationId: string;
        stageId: string;
      } & SubmitReportingStageDraftInput
    >,
  ): Promise<ReportingStageSubmissionSnapshotResponse | null> {
    const draft = await this.draftForStage(organizationId, input);
    if (draft === null) return null;
    const rpc = await this.result("submit_reporting_stage_draft_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_draft_id: draft.id,
      p_expected_version: input.expectedRevision,
      p_lock_token: input.lockToken,
      p_submission_reference: input.submissionReference,
      p_idempotency_key: input.idempotencyKey,
      p_correlation_id: null,
    });
    this.throwStageDraftFailure(rpc);
    if (rpc.outcome === "not_found") return null;
    if (rpc.outcome !== "updated") {
      throw new Error("reporting stage draft unavailable");
    }
    return reportingStageSubmissionSnapshotResponseSchema.parse(
      normalizeWireTimestamps(submissionResult(rpc.result)),
    );
  }

  async createStageApprovalProof(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      sessionId: string;
      obligationId: string;
      stageId: string;
      draftRevision: number;
      draftHash: string;
      expiresAt: string;
    }>,
  ): Promise<ReauthenticateReportingStageApprovalResponse | null> {
    const draft = await this.draftForStage(organizationId, input);
    if (draft === null) return null;
    const rpc = await this.result(
      "create_reporting_stage_approval_proof_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_session_id: input.sessionId,
        p_draft_id: draft.id,
        p_draft_revision: input.draftRevision,
        p_draft_hash: input.draftHash,
        p_expires_at: input.expiresAt,
        p_correlation_id: null,
      },
    );
    if (rpc.outcome === "not_found") return null;
    if (rpc.outcome === "conflict")
      throw new ReportingStageDraftConflictError(draft);
    if (rpc.outcome !== "created")
      throw new ReportingObligationInvalidRequestError();
    return reauthenticateReportingStageApprovalResponseSchema.parse(
      normalizeWireTimestamps(rpc.result),
    );
  }

  async approveStageDraft(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        sessionId: string;
        obligationId: string;
        stageId: string;
      } & ApproveReportingStageDraftInput
    >,
  ): Promise<ReportingStageDraftApprovalResponse | null> {
    const draft = await this.draftForStage(organizationId, input);
    if (draft === null) return null;
    const rpc = await this.result("approve_reporting_stage_draft_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_session_id: input.sessionId,
      p_draft_id: draft.id,
      p_draft_revision: input.draftRevision,
      p_draft_hash: input.draftHash,
      p_reauthentication_proof_id: input.reauthenticationProofId,
      // Retained only for the expand/rollback-compatible RPC signature.
      // M6-05 approval is no longer evidence of an external filing.
      p_submission_reference: "",
      p_sod_override_reason: input.segregationOfDutiesOverrideReason ?? null,
      p_idempotency_key: input.idempotencyKey,
      p_correlation_id: null,
    });
    if (rpc.outcome === "not_found") return null;
    if (rpc.outcome === "conflict")
      throw new ReportingStageDraftConflictError(draft);
    if (rpc.outcome === "proof_invalid")
      throw new ReportingStageApprovalProofError();
    if (rpc.outcome === "sod_conflict")
      throw new ReportingStageApprovalSodError();
    this.throwStageDraftFailure(rpc);
    if (rpc.outcome !== "updated")
      throw new Error("reporting stage approval unavailable");
    return reportingStageDraftApprovalResponseSchema.parse(
      normalizeWireTimestamps(rpc.result),
    );
  }

  async listFamilyTemplates(
    organizationId: string,
    input: Readonly<{ actorId: string } & ReportingFamilyTemplateListQuery>,
  ): Promise<ReportingFamilyTemplatesResponse | null> {
    const rpc = await this.result("list_reporting_family_templates", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_obligation_type: input.obligationType ?? null,
      p_stage_kind: input.stage ?? null,
    });
    // A tenant with no reusable content has an empty collection, not a missing
    // resource. The RPC reserves not_found for that normal empty state.
    if (rpc.outcome === "not_found") return { templates: [] };
    if (rpc.outcome !== "found") {
      throw new Error("reporting family templates unavailable");
    }
    return reportingFamilyTemplatesResponseSchema.parse(
      normalizeWireTimestamps(rpc.result),
    );
  }

  async createFamilyTemplate(
    organizationId: string,
    input: Readonly<{ actorId: string } & CreateReportingFamilyTemplateInput>,
  ): Promise<ReportingFamilyTemplateResponse | null> {
    const rpc = await this.result("create_reporting_family_template_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_name: input.name,
      p_obligation_type: input.obligationType,
      p_stage_kind: input.stage,
      p_description: input.description ?? null,
      p_content: templatePersistence(input.fields),
      p_idempotency_key: input.idempotencyKey,
      p_correlation_id: null,
    });
    return this.familyTemplateResult(rpc);
  }

  async createFamilyTemplateVersion(
    organizationId: string,
    input: Readonly<
      { actorId: string } & ReportingFamilyTemplateParams &
        CreateReportingFamilyTemplateVersionInput
    >,
  ): Promise<ReportingFamilyTemplateResponse | null> {
    const rpc = await this.result("update_reporting_family_template_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_template_id: input.templateId,
      p_expected_version: input.expectedVersion,
      p_content: templatePersistence(input.fields),
      p_idempotency_key: input.idempotencyKey,
      p_correlation_id: null,
    });
    return this.familyTemplateResult(rpc);
  }

  async applyFamilyTemplate(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        obligationId: string;
        stageId: string;
      } & ApplyReportingFamilyTemplateInput
    >,
  ): Promise<ReportingStageDraftResponse | null> {
    const draft = await this.draftForStage(organizationId, input);
    if (draft === null) return null;
    const rpc = await this.result("apply_reporting_family_template_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_draft_id: draft.id,
      p_template_version_id: input.templateVersionId,
      p_expected_draft_version: input.expectedRevision,
      p_lock_token: input.lockToken,
      p_idempotency_key: input.idempotencyKey,
      p_correlation_id: null,
    });
    return this.stageDraftResult(rpc);
  }

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

  private async draftForStage(
    organizationId: string,
    input: Readonly<{ actorId: string; obligationId: string; stageId: string }>,
  ) {
    const response = await this.getStageDraft(organizationId, input);
    return response?.draft ?? null;
  }

  private stageDraftResult(
    rpc: Readonly<{ outcome: string; result: unknown }>,
  ): ReportingStageDraftResponse | null {
    this.throwStageDraftFailure(rpc);
    if (rpc.outcome === "not_found") return null;
    if (!["created", "updated", "found", "idempotent"].includes(rpc.outcome)) {
      throw new Error("reporting stage draft unavailable");
    }
    return reportingStageDraftResponseSchema.parse(
      normalizeWireTimestamps(rpc.result),
    );
  }

  private familyTemplateResult(
    rpc: Readonly<{ outcome: string; result: unknown }>,
  ): ReportingFamilyTemplateResponse | null {
    if (isConflict(rpc.outcome)) throw new ReportingObligationConflictError();
    if (rpc.outcome === "not_found") return null;
    if (rpc.outcome === "invalid_request") {
      throw new ReportingObligationInvalidRequestError();
    }
    if (!["created", "updated", "found", "idempotent"].includes(rpc.outcome)) {
      throw new Error("reporting family template unavailable");
    }
    return reportingFamilyTemplateResponseSchema.parse(
      normalizeWireTimestamps(rpc.result),
    );
  }

  private throwStageDraftFailure(
    rpc: Readonly<{ outcome: string; result: unknown }>,
  ): void {
    if (isConflict(rpc.outcome)) {
      const response = reportingStageDraftResponseSchema.parse(
        normalizeWireTimestamps(rpc.result),
      );
      throw new ReportingStageDraftConflictError(response.draft);
    }
    if (rpc.outcome === "locked") {
      const response = reportingStageDraftResponseSchema.parse(
        normalizeWireTimestamps(rpc.result),
      );
      throw new ReportingStageDraftLockedError(response.draft);
    }
    if (rpc.outcome === "invalid_request") {
      throw new ReportingObligationInvalidRequestError();
    }
    if (rpc.outcome === "invalid_state") {
      throw new ReportingObligationInvalidStateError();
    }
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

function draftPersistence(input: SaveReportingStageDraftInput) {
  return {
    p_content: Object.fromEntries(
      input.fields.map((field) => [field.value.key, field.value.value]),
    ),
    p_field_provenance: Object.fromEntries(
      input.fields.map((field) => [
        field.value.key,
        { ...field.provenance, updatedAt: field.updatedAt },
      ]),
    ),
    p_member_states: input.memberStates,
  };
}

function templatePersistence(
  fields: ReadonlyArray<{
    value: Readonly<{ key: string; value: unknown }>;
    provenance: unknown;
    updatedAt: string;
  }>,
) {
  return {
    fields: fields.map((field) => ({
      value: field.value,
      provenance: field.provenance,
      updatedAt: field.updatedAt,
    })),
  };
}

function submissionResult(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const submission = (value as Record<string, unknown>).submission;
  return submission === undefined ? value : { submission };
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
