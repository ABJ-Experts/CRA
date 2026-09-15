import {
  createFindingProductImpactOverrideInputSchema,
  endFindingProductImpactOverrideInputSchema,
  findingImpactSummaryResponseSchema,
  findingProductImpactOverrideResponseSchema,
  enqueueFindingPropagationSourcePageInputSchema,
  enqueueFindingPropagationSourcePageResultSchema,
  findingPropagationPageCandidateSchema,
  findingPropagationSourceMutationResponseSchema,
  persistFindingPropagationPageInputSchema,
  registerFindingPropagationSourceInputSchema,
  updateFindingPropagationSourceInputSchema,
  type EnqueueFindingPropagationSourcePageInput,
  type CreateFindingProductImpactOverrideInput,
  type EndFindingProductImpactOverrideInput,
  type RegisterFindingPropagationSourceInput,
  type UpdateFindingPropagationSourceInput,
} from "@repo/contracts/findings";
import { Injectable } from "@nestjs/common";
import { z } from "zod";

import { SupabaseService } from "../../supabase/supabase.service";
import {
  type CreateFindingProductImpactOverrideOutcome,
  type EndFindingProductImpactOverrideOutcome,
  FindingPropagationProviderError,
  type FindingImpactSummaryOutcome,
  type FindingPropagationRepository,
  type RegisterFindingPropagationSourceOutcome,
  type UpdateFindingPropagationSourceOutcome,
} from "../application/finding-propagation-use-cases";
import type {
  FindingPropagationJobClaim,
  FindingPropagationWorkerRepository,
} from "../worker/finding-propagation-worker";

type ProviderRow = Readonly<Record<string, unknown>>;
type ProviderResult = Readonly<{ data: unknown; error: unknown }>;

const uuid = z.uuid();
const dateTime = z.string().datetime({ offset: true });
const nonnegativeInteger = z.number().int().nonnegative();

const claimedJobSchema = z
  .object({
    job_id: uuid,
    source_finding_id: uuid,
    source_release_id: uuid.nullable(),
    source_baseline_revision_id: uuid.nullable(),
    graph_version: nonnegativeInteger,
    as_of: dateTime,
    cursor: z.string().nullable(),
    checkpoint_version: nonnegativeInteger,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.source_release_id === null) ===
      (value.source_baseline_revision_id === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "A finding job must have exactly one source scope",
        path: ["source_release_id"],
      });
    }
  });

const allowedRegisterOutcomes = new Set([
  "created",
  "replayed",
  "invalid_request",
  "not_found",
  "conflict",
  "idempotency_mismatch",
]);
const allowedEndOverrideOutcomes = new Set([
  "ended",
  "replayed",
  "invalid_request",
  "not_found",
  "conflict",
  "idempotency_mismatch",
]);
const allowedUpdateSourceOutcomes = new Set([
  "updated",
  "replayed",
  "invalid_request",
  "not_found",
  "conflict",
  "idempotency_mismatch",
]);
const allowedSummaryOutcomes = new Set([
  "found",
  "not_found",
  "invalid_request",
]);
const allowedClaimOutcomes = new Set([
  "claimed",
  "none_available",
  "conflict",
  "not_found",
  "invalid_request",
]);
const allowedPersistOutcomes = new Set([
  "scheduled",
  "completed",
  "conflict",
  "not_found",
  "invalid_request",
]);
const allowedFailOutcomes = new Set([
  "retry_scheduled",
  "dead_letter",
  "conflict",
  "not_found",
  "invalid_request",
]);
const allowedObsoleteOutcomes = new Set([
  "obsolete",
  "conflict",
  "not_found",
  "invalid_request",
]);

const record = (value: unknown): ProviderRow => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FindingPropagationProviderError("malformed");
  }
  return value as ProviderRow;
};

/**
 * Service-role adapter for finding-owned tables and RPCs. Every operation
 * passes the verified organization ID first. Product rows are never selected:
 * graph candidates and graph-event scopes arrive solely through Products ports.
 */
@Injectable()
export class SupabaseFindingPropagationRepository
  implements FindingPropagationRepository, FindingPropagationWorkerRepository
{
  constructor(private readonly supabase: SupabaseService) {}

  async registerSource(
    organizationId: string,
    actorId: string,
    input: RegisterFindingPropagationSourceInput,
  ): Promise<RegisterFindingPropagationSourceOutcome> {
    const command =
      registerFindingPropagationSourceInputSchema.safeParse(input);
    if (
      !command.success ||
      !uuid.safeParse(organizationId).success ||
      !uuid.safeParse(actorId).success
    ) {
      return Object.freeze({ outcome: "invalid_request" });
    }
    const row = await this.one("register_finding_propagation_source_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_source_system: command.data.sourceSystem,
      p_source_finding_key: command.data.sourceFindingKey,
      p_source_product_id: command.data.sourceProductId,
      p_source_release_id: command.data.sourceReleaseId ?? null,
      p_source_baseline_revision_id:
        command.data.sourceBaselineRevisionId ?? null,
      p_rule_version: command.data.ruleVersion,
      p_source: command.data.source,
      p_provenance: command.data.provenance,
      p_idempotency_key: command.data.idempotencyKey,
      p_correlation_id: command.data.correlationId,
    });
    const outcome = this.outcome(row, allowedRegisterOutcomes);
    if (outcome !== "created" && outcome !== "replayed") {
      return Object.freeze({
        outcome: outcome as Exclude<
          RegisterFindingPropagationSourceOutcome["outcome"],
          "created" | "replayed"
        >,
      });
    }
    const source = z
      .object({
        id: uuid,
        organizationId: uuid,
        status: z.enum(["active", "resolved", "archived"]),
        version: nonnegativeInteger,
      })
      .strict()
      .safeParse(row.source);
    const jobId = uuid.safeParse(row.job_id);
    if (
      !source.success ||
      !jobId.success ||
      source.data.organizationId !== organizationId
    ) {
      throw new FindingPropagationProviderError("malformed");
    }
    const response = findingPropagationSourceMutationResponseSchema.safeParse({
      source: source.data,
      jobId: jobId.data,
      idempotent: outcome === "replayed",
    });
    if (!response.success)
      throw new FindingPropagationProviderError("malformed");
    return Object.freeze({ outcome, response: response.data });
  }

  async updateSource(
    organizationId: string,
    actorId: string,
    sourceId: string,
    input: UpdateFindingPropagationSourceInput,
  ): Promise<UpdateFindingPropagationSourceOutcome> {
    const command = updateFindingPropagationSourceInputSchema.safeParse(input);
    if (
      !command.success ||
      !uuid.safeParse(organizationId).success ||
      !uuid.safeParse(actorId).success ||
      !uuid.safeParse(sourceId).success
    ) {
      return Object.freeze({ outcome: "invalid_request" });
    }
    const row = await this.one("update_finding_propagation_source_atomic", {
      p_organization_id: organizationId,
      p_source_id: sourceId,
      p_actor_user_id: actorId,
      p_source_product_id: command.data.sourceProductId,
      p_source_release_id: command.data.sourceReleaseId ?? null,
      p_source_baseline_revision_id:
        command.data.sourceBaselineRevisionId ?? null,
      p_rule_version: command.data.ruleVersion,
      p_status: command.data.status,
      p_reason: command.data.reason,
      p_source: command.data.source,
      p_provenance: command.data.provenance,
      p_expected_version: command.data.expectedVersion,
      p_idempotency_key: command.data.idempotencyKey,
      p_correlation_id: command.data.correlationId,
    });
    const outcome = this.outcome(row, allowedUpdateSourceOutcomes);
    if (outcome !== "updated" && outcome !== "replayed") {
      return Object.freeze({
        outcome: outcome as Exclude<
          UpdateFindingPropagationSourceOutcome["outcome"],
          "updated" | "replayed"
        >,
      });
    }
    const source = z
      .object({
        id: uuid,
        organizationId: uuid,
        status: z.enum(["active", "resolved", "archived"]),
        version: nonnegativeInteger,
      })
      .strict()
      .safeParse(row.source);
    const jobId = uuid.safeParse(row.job_id);
    if (
      !source.success ||
      !jobId.success ||
      source.data.organizationId !== organizationId ||
      source.data.id !== sourceId
    ) {
      throw new FindingPropagationProviderError("malformed");
    }
    const response = findingPropagationSourceMutationResponseSchema.safeParse({
      source: source.data,
      jobId: jobId.data,
      idempotent: outcome === "replayed",
    });
    if (!response.success)
      throw new FindingPropagationProviderError("malformed");
    return Object.freeze({ outcome, response: response.data });
  }

  async getProductImpactSummary(
    organizationId: string,
    actorId: string,
    productId: string,
    releaseId: string | null,
  ): Promise<FindingImpactSummaryOutcome> {
    if (
      !uuid.safeParse(organizationId).success ||
      !uuid.safeParse(actorId).success ||
      !uuid.safeParse(productId).success ||
      (releaseId !== null && !uuid.safeParse(releaseId).success)
    ) {
      return Object.freeze({ outcome: "invalid_request" });
    }
    const row = await this.one("get_finding_product_impact_summary", {
      p_organization_id: organizationId,
      p_product_id: productId,
      p_release_id: releaseId,
      p_actor_user_id: actorId,
    });
    const outcome = this.outcome(row, allowedSummaryOutcomes);
    if (outcome !== "found") {
      return Object.freeze({
        outcome: outcome as "not_found" | "invalid_request",
      });
    }
    const response = findingImpactSummaryResponseSchema.safeParse({
      summary: row.summary,
    });
    if (!response.success || response.data.summary.productId !== productId) {
      throw new FindingPropagationProviderError("malformed");
    }
    return Object.freeze({ outcome: "found", response: response.data });
  }

  async createProductImpactOverride(
    organizationId: string,
    actorId: string,
    sourceId: string,
    productId: string,
    input: CreateFindingProductImpactOverrideInput,
  ): Promise<CreateFindingProductImpactOverrideOutcome> {
    const command =
      createFindingProductImpactOverrideInputSchema.safeParse(input);
    if (
      !command.success ||
      !uuid.safeParse(organizationId).success ||
      !uuid.safeParse(actorId).success ||
      !uuid.safeParse(sourceId).success ||
      !uuid.safeParse(productId).success
    ) {
      return Object.freeze({ outcome: "invalid_request" });
    }
    const row = await this.one(
      "create_finding_product_impact_override_atomic",
      {
        p_organization_id: organizationId,
        p_source_finding_id: sourceId,
        p_product_id: productId,
        p_release_id: command.data.affectedReleaseId,
        p_actor_user_id: actorId,
        p_override_state: command.data.overrideState,
        p_reason: command.data.reason,
        p_source: command.data.source,
        p_provenance: command.data.provenance,
        p_effective_starts_at: command.data.effectiveStartsAt,
        p_effective_ends_at: command.data.effectiveEndsAt ?? null,
        p_idempotency_key: command.data.idempotencyKey,
        p_correlation_id: command.data.correlationId,
      },
    );
    const outcome = this.outcome(row, allowedRegisterOutcomes);
    if (outcome !== "created" && outcome !== "replayed") {
      return Object.freeze({
        outcome: outcome as Exclude<
          CreateFindingProductImpactOverrideOutcome["outcome"],
          "created" | "replayed"
        >,
      });
    }
    const response = findingProductImpactOverrideResponseSchema.safeParse({
      override: row.override,
      idempotent: outcome === "replayed",
    });
    if (
      !response.success ||
      response.data.override.organizationId !== organizationId ||
      response.data.override.sourceId !== sourceId ||
      response.data.override.affectedProductId !== productId
    ) {
      throw new FindingPropagationProviderError("malformed");
    }
    return Object.freeze({ outcome, response: response.data });
  }

  async endProductImpactOverride(
    organizationId: string,
    actorId: string,
    sourceId: string,
    productId: string,
    overrideId: string,
    input: EndFindingProductImpactOverrideInput,
  ): Promise<EndFindingProductImpactOverrideOutcome> {
    const command = endFindingProductImpactOverrideInputSchema.safeParse(input);
    if (
      !command.success ||
      !uuid.safeParse(organizationId).success ||
      !uuid.safeParse(actorId).success ||
      !uuid.safeParse(sourceId).success ||
      !uuid.safeParse(productId).success ||
      !uuid.safeParse(overrideId).success
    ) {
      return Object.freeze({ outcome: "invalid_request" });
    }
    const row = await this.one("end_finding_product_impact_override_atomic", {
      p_organization_id: organizationId,
      p_override_id: overrideId,
      p_actor_user_id: actorId,
      p_expected_version: command.data.expectedVersion,
      p_reason: command.data.reason,
      p_idempotency_key: command.data.idempotencyKey,
      p_correlation_id: command.data.correlationId,
    });
    const outcome = this.outcome(row, allowedEndOverrideOutcomes);
    if (outcome !== "ended" && outcome !== "replayed") {
      return Object.freeze({
        outcome: outcome as Exclude<
          EndFindingProductImpactOverrideOutcome["outcome"],
          "ended" | "replayed"
        >,
      });
    }
    const response = findingProductImpactOverrideResponseSchema.safeParse({
      override: row.override,
      idempotent: outcome === "replayed",
    });
    if (
      !response.success ||
      response.data.override.organizationId !== organizationId ||
      response.data.override.sourceId !== sourceId ||
      response.data.override.affectedProductId !== productId ||
      response.data.override.id !== overrideId
    ) {
      throw new FindingPropagationProviderError("malformed");
    }
    return Object.freeze({ outcome, response: response.data });
  }

  async dueOrganizationIds(): Promise<readonly string[]> {
    const rows = await this.rows(
      "list_due_finding_propagation_job_organizations",
      {},
    );
    return Object.freeze([
      ...new Set(rows.map((row) => this.requiredUuid(row, "organization_id"))),
    ]);
  }

  async claim(
    command: Readonly<{
      organizationId: string;
      workerId: string;
      leaseSeconds: number;
    }>,
  ): Promise<FindingPropagationJobClaim> {
    if (
      !uuid.safeParse(command.organizationId).success ||
      !uuid.safeParse(command.workerId).success ||
      !Number.isInteger(command.leaseSeconds) ||
      command.leaseSeconds < 1 ||
      command.leaseSeconds > 3_600
    ) {
      return Object.freeze({ outcome: "invalid_request" });
    }
    const row = await this.one("claim_finding_propagation_job_atomic", {
      p_organization_id: command.organizationId,
      p_lease_owner: command.workerId,
      p_lease_seconds: command.leaseSeconds,
    });
    const outcome = this.outcome(row, allowedClaimOutcomes);
    if (outcome !== "claimed") {
      return Object.freeze({
        outcome: outcome as
          "none_available" | "conflict" | "not_found" | "invalid_request",
      });
    }
    const job = claimedJobSchema.safeParse({
      job_id: row.job_id,
      source_finding_id: row.source_finding_id,
      source_release_id: row.source_release_id,
      source_baseline_revision_id: row.source_baseline_revision_id,
      graph_version: row.graph_version,
      as_of: row.as_of,
      cursor: row.cursor,
      checkpoint_version: row.checkpoint_version,
    });
    if (!job.success) throw new FindingPropagationProviderError("malformed");
    return Object.freeze({
      outcome: "claimed",
      jobId: job.data.job_id,
      organizationId: command.organizationId,
      sourceId: job.data.source_finding_id,
      sourceReleaseId: job.data.source_release_id,
      sourceBaselineRevisionId: job.data.source_baseline_revision_id,
      graphVersion: job.data.graph_version,
      asOf: job.data.as_of,
      cursor: job.data.cursor,
      checkpointVersion: job.data.checkpoint_version,
    });
  }

  async enqueueSourcePage(
    input: EnqueueFindingPropagationSourcePageInput,
  ): Promise<
    Readonly<{
      outcome: "enqueued_page" | "obsolete" | "invalid_request";
      sourceCount: number;
      nextCursor: string | null;
    }>
  > {
    const command =
      enqueueFindingPropagationSourcePageInputSchema.safeParse(input);
    if (!command.success) {
      return Object.freeze({
        outcome: "invalid_request",
        sourceCount: 0,
        nextCursor: null,
      });
    }
    const sourceReleaseId =
      command.data.scopeKind === "release"
        ? command.data.sourceReleaseId
        : null;
    const sourceBaselineRevisionId =
      command.data.scopeKind === "baseline"
        ? command.data.sourceBaselineRevisionId
        : null;
    const row = await this.one(
      "enqueue_finding_propagation_source_page_atomic",
      {
        p_organization_id: command.data.organizationId,
        p_event_key: command.data.eventKey,
        p_graph_version: command.data.graphVersion,
        p_scope_kind: command.data.scopeKind,
        p_source_product_id: command.data.sourceProductId,
        p_source_release_id: sourceReleaseId,
        p_source_baseline_revision_id: sourceBaselineRevisionId,
        p_as_of: command.data.asOf,
        p_cursor: command.data.cursor,
        p_page_size: command.data.pageSize,
      },
    );
    const parsed = enqueueFindingPropagationSourcePageResultSchema.safeParse({
      outcome: row.outcome,
      sourceCount: row.source_count,
      nextCursor: row.next_cursor,
    });
    if (!parsed.success) throw new FindingPropagationProviderError("malformed");
    return Object.freeze(parsed.data);
  }

  async persistPage(
    command: z.output<typeof persistFindingPropagationPageInputSchema>,
  ): Promise<
    Readonly<{
      outcome:
        | "scheduled"
        | "completed"
        | "conflict"
        | "not_found"
        | "invalid_request";
    }>
  > {
    const parsed = persistFindingPropagationPageInputSchema.safeParse(command);
    if (!parsed.success) return Object.freeze({ outcome: "invalid_request" });
    for (const candidate of parsed.data.candidates) {
      if (!findingPropagationPageCandidateSchema.safeParse(candidate).success) {
        return Object.freeze({ outcome: "invalid_request" });
      }
    }
    const row = await this.one("persist_finding_propagation_page_atomic", {
      p_organization_id: parsed.data.organizationId,
      p_job_id: parsed.data.jobId,
      p_lease_owner: parsed.data.leaseOwner,
      p_expected_checkpoint_version: parsed.data.expectedCheckpointVersion,
      p_candidates: parsed.data.candidates,
      p_next_cursor: parsed.data.nextCursor,
      p_is_final: parsed.data.isFinal,
    });
    return Object.freeze({
      outcome: this.outcome(row, allowedPersistOutcomes) as
        | "scheduled"
        | "completed"
        | "conflict"
        | "not_found"
        | "invalid_request",
    });
  }

  async fail(
    command: Readonly<{
      organizationId: string;
      jobId: string;
      workerId: string;
      checkpointVersion: number;
      errorCode: string;
      retryable: boolean;
    }>,
  ): Promise<
    Readonly<{
      outcome:
        | "retry_scheduled"
        | "dead_letter"
        | "conflict"
        | "not_found"
        | "invalid_request";
    }>
  > {
    if (
      !uuid.safeParse(command.organizationId).success ||
      !uuid.safeParse(command.jobId).success ||
      !uuid.safeParse(command.workerId).success ||
      !nonnegativeInteger.safeParse(command.checkpointVersion).success ||
      !/^[a-z0-9][a-z0-9_.:-]{0,99}$/.test(command.errorCode)
    ) {
      return Object.freeze({ outcome: "invalid_request" });
    }
    const row = await this.one("fail_finding_propagation_job_atomic", {
      p_organization_id: command.organizationId,
      p_job_id: command.jobId,
      p_lease_owner: command.workerId,
      p_expected_checkpoint_version: command.checkpointVersion,
      p_error_code: command.errorCode,
      p_retryable: command.retryable,
    });
    return Object.freeze({
      outcome: this.outcome(row, allowedFailOutcomes) as
        | "retry_scheduled"
        | "dead_letter"
        | "conflict"
        | "not_found"
        | "invalid_request",
    });
  }

  async obsolete(
    command: Readonly<{
      organizationId: string;
      jobId: string;
      workerId: string;
      checkpointVersion: number;
      reason: string;
    }>,
  ): Promise<
    Readonly<{
      outcome: "obsolete" | "conflict" | "not_found" | "invalid_request";
    }>
  > {
    if (
      !uuid.safeParse(command.organizationId).success ||
      !uuid.safeParse(command.jobId).success ||
      !uuid.safeParse(command.workerId).success ||
      !nonnegativeInteger.safeParse(command.checkpointVersion).success ||
      !/^[a-z0-9][a-z0-9_.:-]{0,99}$/.test(command.reason)
    ) {
      return Object.freeze({ outcome: "invalid_request" });
    }
    const row = await this.one("obsolete_finding_propagation_job_atomic", {
      p_organization_id: command.organizationId,
      p_job_id: command.jobId,
      p_lease_owner: command.workerId,
      p_expected_checkpoint_version: command.checkpointVersion,
      p_reason: command.reason,
    });
    return Object.freeze({
      outcome: this.outcome(row, allowedObsoleteOutcomes) as
        "obsolete" | "conflict" | "not_found" | "invalid_request",
    });
  }

  private async one(
    procedure: string,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<ProviderRow> {
    const result = await this.query(procedure, parameters);
    if (!Array.isArray(result.data) || result.data.length !== 1) {
      throw new FindingPropagationProviderError("malformed");
    }
    return record(result.data[0]);
  }

  private async rows(
    procedure: string,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<readonly ProviderRow[]> {
    const result = await this.query(procedure, parameters);
    if (!Array.isArray(result.data)) {
      throw new FindingPropagationProviderError("malformed");
    }
    return Object.freeze(result.data.map(record));
  }

  private async query(
    procedure: string,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<ProviderResult> {
    try {
      const result = await (
        this.supabase.admin() as unknown as {
          rpc(
            name: string,
            args: Readonly<Record<string, unknown>>,
          ): Promise<ProviderResult>;
        }
      ).rpc(procedure, parameters);
      if (result.error)
        throw new FindingPropagationProviderError("unavailable");
      return result;
    } catch (error) {
      if (error instanceof FindingPropagationProviderError) throw error;
      throw new FindingPropagationProviderError("unavailable");
    }
  }

  private outcome(row: ProviderRow, allowed: ReadonlySet<string>): string {
    if (typeof row.outcome !== "string" || !allowed.has(row.outcome)) {
      throw new FindingPropagationProviderError("malformed");
    }
    return row.outcome;
  }

  private requiredUuid(row: ProviderRow, key: string): string {
    const parsed = uuid.safeParse(row[key]);
    if (!parsed.success) throw new FindingPropagationProviderError("malformed");
    return parsed.data;
  }
}
