import { Injectable } from "@nestjs/common";
import {
  productRelationshipGraphEventCheckpointSchema,
  productRelationshipGraphEventScopeSchema,
  relationshipPropagationCandidatesResponseSchema,
  relationshipPropagationQuerySchema,
} from "@repo/contracts/products";
import { z } from "zod";

import { SupabaseService } from "../../supabase/supabase.service";
import type {
  ProductRelationshipGraphEventClaim,
  ProductRelationshipGraphEventCompletion,
  ProductRelationshipGraphEventCheckpoint,
  ProductRelationshipGraphEventFailure,
  ProductRelationshipGraphEventWorkerPort,
  ProductRelationshipPropagationWorkerCommand,
  ProductRelationshipPropagationWorkerPort,
} from "../application/product-relationship-worker.port";

type ProviderRow = Readonly<Record<string, unknown>>;
type ProviderResult = Readonly<{ data: unknown; error: unknown }>;

const uuid = z.uuid();
const timestamp = z.string().datetime({ offset: true });
const nonnegativeInteger = z.number().int().nonnegative();

const graphEventDescription = z
  .object({
    eventId: uuid,
    organizationId: uuid,
    graphVersion: nonnegativeInteger,
    eventKey: z.string().trim().min(1).max(263),
    occurredAt: timestamp,
    deliveryCursor: z.string().trim().min(1).max(160).nullable(),
    sourceScopes: z
      .array(productRelationshipGraphEventScopeSchema)
      .min(1)
      .max(100),
  })
  .strict();

const claimedGraphEvent = z
  .object({
    event_id: uuid,
    organization_id: uuid,
    graph_version: nonnegativeInteger,
    event_key: z.string().trim().min(1).max(263),
    checkpoint_version: nonnegativeInteger,
    delivery_cursor: z.string().trim().min(1).max(160).nullable(),
    lease_owner: uuid,
    retry_count: nonnegativeInteger,
  })
  .strict();

const allowedClaimOutcomes = new Set([
  "claimed",
  "none_available",
  "conflict",
  "not_found",
  "invalid_request",
]);
const allowedCheckpointOutcomes = new Set([
  "scheduled",
  "completed",
  "delivered",
  "obsolete",
  "conflict",
  "not_found",
  "invalid_request",
]);
const allowedDescribeOutcomes = new Set([
  "found",
  "obsolete",
  "conflict",
  "not_found",
  "invalid_request",
]);
const allowedCompleteOutcomes = new Set([
  "completed",
  "delivered",
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
const allowedCandidateOutcomes = new Set([
  "found",
  "conflict",
  "not_found",
  "invalid_request",
]);

const asRecord = (value: unknown): ProviderRow => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProductRelationshipWorkerProviderError("malformed_provider");
  }
  return value as ProviderRow;
};

/**
 * Product-owned service-role adapter. Its RPC calls are all tenant-scoped,
 * and the only relationship-event data exposed outside Products is a strictly
 * parsed, payload-free source scope.
 */
@Injectable()
export class SupabaseProductRelationshipWorkerAdapter
  implements
    ProductRelationshipGraphEventWorkerPort,
    ProductRelationshipPropagationWorkerPort
{
  constructor(private readonly supabase: SupabaseService) {}

  async dueOrganizationIds(): Promise<readonly string[]> {
    const rows = await this.rows(
      "list_due_product_relationship_graph_event_organizations",
      Object.freeze({}),
    );
    const organizationIds = rows.map((row) => {
      const parsed = uuid.safeParse(row.organization_id);
      if (!parsed.success) {
        throw new ProductRelationshipWorkerProviderError("malformed_provider");
      }
      return parsed.data;
    });
    return Object.freeze([...new Set(organizationIds)]);
  }

  async claim(
    command: Readonly<{
      organizationId: string;
      workerId: string;
      leaseSeconds: number;
    }>,
  ): Promise<ProductRelationshipGraphEventClaim> {
    const row = await this.rpc(
      "claim_product_relationship_graph_event_atomic",
      Object.freeze({
        p_organization_id: command.organizationId,
        p_lease_owner: command.workerId,
        p_lease_seconds: command.leaseSeconds,
      }),
    );
    const value = this.outcome(row, allowedClaimOutcomes);
    if (value !== "claimed") {
      return Object.freeze({
        outcome: value as
          "none_available" | "conflict" | "not_found" | "invalid_request",
      });
    }
    const parsed = claimedGraphEvent.safeParse({
      event_id: row.event_id,
      organization_id: row.organization_id,
      graph_version: row.graph_version,
      event_key: row.event_key,
      checkpoint_version: row.checkpoint_version,
      delivery_cursor: row.delivery_cursor,
      lease_owner: row.lease_owner,
      retry_count: row.retry_count,
    });
    if (!parsed.success) {
      throw new ProductRelationshipWorkerProviderError("malformed_provider");
    }
    return Object.freeze({
      outcome: "claimed",
      eventId: parsed.data.event_id,
      organizationId: parsed.data.organization_id,
      graphVersion: parsed.data.graph_version,
      eventKey: parsed.data.event_key,
      checkpointVersion: parsed.data.checkpoint_version,
      deliveryCursor: parsed.data.delivery_cursor,
      leaseOwner: parsed.data.lease_owner,
      retryCount: parsed.data.retry_count,
    });
  }

  async describe(
    command: Readonly<{
      organizationId: string;
      eventId: string;
      workerId: string;
      checkpointVersion: number;
    }>,
  ) {
    const row = await this.rpc(
      "describe_product_relationship_graph_event_atomic",
      Object.freeze({
        p_organization_id: command.organizationId,
        p_event_id: command.eventId,
        p_lease_owner: command.workerId,
        p_expected_checkpoint_version: command.checkpointVersion,
      }),
    );
    const value = this.outcome(row, allowedDescribeOutcomes);
    if (value !== "found") {
      return Object.freeze({
        outcome: value as
          "obsolete" | "conflict" | "not_found" | "invalid_request",
      });
    }
    const parsed = graphEventDescription.safeParse(row.event);
    if (
      !parsed.success ||
      parsed.data.organizationId !== command.organizationId
    ) {
      throw new ProductRelationshipWorkerProviderError("malformed_provider");
    }
    return Object.freeze({ outcome: "found" as const, event: parsed.data });
  }

  async checkpoint(
    command: Readonly<{
      organizationId: string;
      eventId: string;
      workerId: string;
      checkpointVersion: number;
      checkpoint: Readonly<{ deliveryCursor: string | null; isFinal: boolean }>;
    }>,
  ): Promise<ProductRelationshipGraphEventCheckpoint> {
    const checkpoint = productRelationshipGraphEventCheckpointSchema.safeParse(
      command.checkpoint,
    );
    if (!checkpoint.success) {
      return Object.freeze({ outcome: "invalid_request" });
    }
    return Object.freeze({
      outcome: this.outcome(
        await this.rpc(
          "checkpoint_product_relationship_graph_event_atomic",
          Object.freeze({
            p_organization_id: command.organizationId,
            p_event_id: command.eventId,
            p_lease_owner: command.workerId,
            p_expected_checkpoint_version: command.checkpointVersion,
            p_delivery_cursor: checkpoint.data.deliveryCursor,
            p_is_final: checkpoint.data.isFinal,
          }),
        ),
        allowedCheckpointOutcomes,
      ) as ProductRelationshipGraphEventCheckpoint["outcome"],
    });
  }

  async complete(
    command: Readonly<{
      organizationId: string;
      eventId: string;
      workerId: string;
      checkpointVersion: number;
    }>,
  ): Promise<ProductRelationshipGraphEventCompletion> {
    return Object.freeze({
      outcome: this.outcome(
        await this.rpc(
          "complete_product_relationship_graph_event_atomic",
          Object.freeze({
            p_organization_id: command.organizationId,
            p_event_id: command.eventId,
            p_lease_owner: command.workerId,
            p_expected_checkpoint_version: command.checkpointVersion,
          }),
        ),
        allowedCompleteOutcomes,
      ) as ProductRelationshipGraphEventCompletion["outcome"],
    });
  }

  async fail(
    command: Readonly<{
      organizationId: string;
      eventId: string;
      workerId: string;
      checkpointVersion: number;
      errorCode: string;
      retryable: boolean;
    }>,
  ): Promise<ProductRelationshipGraphEventFailure> {
    return Object.freeze({
      outcome: this.outcome(
        await this.rpc(
          "fail_product_relationship_graph_event_atomic",
          Object.freeze({
            p_organization_id: command.organizationId,
            p_event_id: command.eventId,
            p_lease_owner: command.workerId,
            p_expected_checkpoint_version: command.checkpointVersion,
            p_error_code: command.errorCode,
            p_retryable: command.retryable,
          }),
        ),
        allowedFailOutcomes,
      ) as ProductRelationshipGraphEventFailure["outcome"],
    });
  }

  async getCandidatePage(command: ProductRelationshipPropagationWorkerCommand) {
    const parsedCommand = relationshipPropagationQuerySchema.safeParse({
      sourceReleaseId: command.sourceReleaseId,
      sourceBaselineRevisionId: command.sourceBaselineRevisionId,
      graphVersion: command.graphVersion,
      asOf: command.asOf,
      cursor: command.cursor,
      pageSize: command.pageSize,
    });
    if (!parsedCommand.success) {
      return Object.freeze({ outcome: "invalid_request" as const });
    }

    const row = await this.rpc(
      "get_product_relationship_propagation_candidates_system",
      Object.freeze({
        p_organization_id: command.organizationId,
        p_source_release_id: parsedCommand.data.sourceReleaseId ?? null,
        p_source_baseline_revision_id:
          parsedCommand.data.sourceBaselineRevisionId ?? null,
        p_graph_version: parsedCommand.data.graphVersion,
        p_as_of: parsedCommand.data.asOf ?? null,
        p_page_size: parsedCommand.data.pageSize,
        p_cursor: parsedCommand.data.cursor ?? null,
      }),
    );
    const value = this.outcome(row, allowedCandidateOutcomes);
    if (value !== "found") {
      return Object.freeze({
        outcome: value as "conflict" | "not_found" | "invalid_request",
      });
    }
    const parsed = relationshipPropagationCandidatesResponseSchema.safeParse(
      row.candidates,
    );
    if (!parsed.success) {
      throw new ProductRelationshipWorkerProviderError("malformed_provider");
    }
    return Object.freeze({
      outcome: "found" as const,
      candidates: Object.freeze([...parsed.data.candidates]),
      nextCursor: parsed.data.nextCursor,
      graphVersion: parsed.data.graphVersion,
      evaluatedAt: parsed.data.evaluatedAt,
    });
  }

  private async rpc(
    procedure: string,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<ProviderRow> {
    const result = await this.query(procedure, parameters);
    if (!Array.isArray(result.data) || result.data.length !== 1) {
      throw new ProductRelationshipWorkerProviderError("malformed_provider");
    }
    return asRecord(result.data[0]);
  }

  private async rows(
    procedure: string,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<readonly ProviderRow[]> {
    const result = await this.query(procedure, parameters);
    if (!Array.isArray(result.data)) {
      throw new ProductRelationshipWorkerProviderError("malformed_provider");
    }
    return Object.freeze(result.data.map(asRecord));
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
      if (result.error) {
        throw new ProductRelationshipWorkerProviderError(
          "provider_unavailable",
        );
      }
      return result;
    } catch (error) {
      if (error instanceof ProductRelationshipWorkerProviderError) throw error;
      throw new ProductRelationshipWorkerProviderError("provider_unavailable");
    }
  }

  private outcome(row: ProviderRow, allowed: ReadonlySet<string>): string {
    const value = row.outcome;
    if (typeof value !== "string" || !allowed.has(value)) {
      throw new ProductRelationshipWorkerProviderError("malformed_provider");
    }
    return value;
  }
}

export class ProductRelationshipWorkerProviderError extends Error {
  readonly name = "ProductRelationshipWorkerProviderError";

  constructor(readonly code: "malformed_provider" | "provider_unavailable") {
    super(code);
  }
}
