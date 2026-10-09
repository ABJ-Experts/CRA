import { Logger } from "@nestjs/common";
import {
  enqueueFindingPropagationSourcePageInputSchema,
  findingPropagationPageCandidateSchema,
  persistFindingPropagationPageInputSchema,
  type EnqueueFindingPropagationSourcePageInput,
} from "@repo/contracts/findings";
import type {
  ProductRelationshipGraphEventWorkerPort,
  ProductRelationshipPropagationWorkerPort,
} from "../../products/application/product-relationship-worker.port";
import { z } from "zod";

const uuid = z.uuid();
const maximumClaimsPerStageCycle = 1_000;
const sourcePageSize = 100;
const eventDeliveryCursorSchema = z
  .string()
  .regex(
    /^(0|[1-9][0-9]*):(?:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})?$/i,
    "Use a canonical graph-event delivery cursor",
  );

export class FindingPropagationWorkerFailure extends Error {
  readonly name = "FindingPropagationWorkerFailure";

  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}

export type FindingPropagationJobClaim =
  | Readonly<{
      outcome: "claimed";
      jobId: string;
      organizationId: string;
      sourceId: string;
      sourceReleaseId: string | null;
      sourceBaselineRevisionId: string | null;
      graphVersion: number;
      asOf: string;
      cursor: string | null;
      checkpointVersion: number;
    }>
  | Readonly<{
      outcome: "none_available" | "conflict" | "not_found" | "invalid_request";
    }>;

/** Safe numeric operational data only: never product, finding, or evidence IDs. */
export type FindingPropagationMeasurement = Readonly<{
  metric:
    | "traversal_latency_ms"
    | "source_page_fanout"
    | "cycle_rejection"
    | "stale_propagation"
    | "retry_count"
    | "dead_letter";
  value: number;
}>;

/**
 * Finding-owned durable queue. Product relationships stay on the other side
 * of ProductRelationshipPropagationWorkerPort; this port never accepts a
 * product table row or an outbox payload.
 */
export interface FindingPropagationWorkerRepository {
  dueOrganizationIds(): Promise<readonly string[]>;
  claim(
    command: Readonly<{
      organizationId: string;
      workerId: string;
      leaseSeconds: number;
    }>,
  ): Promise<FindingPropagationJobClaim>;
  enqueueSourcePage(input: EnqueueFindingPropagationSourcePageInput): Promise<
    Readonly<{
      outcome: "enqueued_page" | "obsolete" | "invalid_request";
      sourceCount: number;
      nextCursor: string | null;
    }>
  >;
  persistPage(
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
  >;
  fail(
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
  >;
  obsolete(
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
  >;
}

export interface FindingPropagationWorkerDependencies {
  workerId: string;
  leaseSeconds: number;
  queue: FindingPropagationWorkerRepository;
  productEvents: ProductRelationshipGraphEventWorkerPort;
  relationships: ProductRelationshipPropagationWorkerPort;
  observe?: (measurement: FindingPropagationMeasurement) => void;
}

type EventCursor = Readonly<{
  scopeIndex: number;
  sourceCursor: string | null;
}>;

/**
 * Stateless worker for two independently durable steps:
 *
 * 1. Product graph events enqueue at most one page of finding sources before
 *    their outbox checkpoint advances. Replaying the same page is idempotent.
 * 2. Finding jobs resolve exactly one bounded graph page, then atomically
 *    persist both impact associations and their own checkpoint.
 *
 * Both stages use deterministic, round-robin passes. A busy tenant can use at
 * most one claim per pass and never consumes a per-tenant 1,000-item loop.
 */
export class FindingPropagationWorker {
  private readonly logger = new Logger(FindingPropagationWorker.name);

  constructor(
    private readonly dependencies: FindingPropagationWorkerDependencies,
  ) {
    if (!uuid.safeParse(dependencies.workerId).success) {
      throw new Error("invalid finding propagation worker id");
    }
    if (
      !Number.isInteger(dependencies.leaseSeconds) ||
      dependencies.leaseSeconds < 1 ||
      dependencies.leaseSeconds > 3_600
    ) {
      throw new Error("invalid finding propagation worker lease");
    }
  }

  async runOnce(): Promise<void> {
    await this.runFairStage(
      await this.dependencies.productEvents.dueOrganizationIds(),
      async (organizationId) =>
        this.processOneRelationshipEvent(organizationId),
    );
    await this.runFairStage(
      await this.dependencies.queue.dueOrganizationIds(),
      async (organizationId) => this.processOneFindingJob(organizationId),
    );
  }

  private async runFairStage(
    organizationIds: readonly string[],
    processOne: (organizationId: string) => Promise<boolean>,
  ): Promise<void> {
    let due = this.uniqueOrganizationIds(organizationIds);
    let remaining = maximumClaimsPerStageCycle;

    while (due.length > 0 && remaining > 0) {
      const nextRound: string[] = [];
      for (const organizationId of due) {
        if (remaining === 0) break;
        const claimed = await processOne(organizationId);
        if (!claimed) continue;
        remaining -= 1;
        nextRound.push(organizationId);
      }
      due = nextRound;
    }
  }

  private async processOneRelationshipEvent(
    organizationId: string,
  ): Promise<boolean> {
    const claim = await this.dependencies.productEvents.claim({
      organizationId,
      workerId: this.dependencies.workerId,
      leaseSeconds: this.dependencies.leaseSeconds,
    });
    if (claim.outcome !== "claimed") return false;

    try {
      const described = await this.dependencies.productEvents.describe({
        organizationId,
        eventId: claim.eventId,
        workerId: this.dependencies.workerId,
        checkpointVersion: claim.checkpointVersion,
      });
      if (described.outcome === "obsolete") {
        this.measure("stale_propagation", 1);
        return false;
      }
      if (described.outcome !== "found") {
        if (
          described.outcome === "conflict" ||
          described.outcome === "not_found"
        ) {
          return false;
        }
        throw new FindingPropagationWorkerFailure(
          "invalid_relationship_event",
          false,
        );
      }

      if (described.event.deliveryCursor !== claim.deliveryCursor) {
        throw new FindingPropagationWorkerFailure(
          "relationship_event_checkpoint_mismatch",
          true,
        );
      }

      const cursor = this.decodeEventCursor(claim.deliveryCursor);
      const sourceScope = described.event.sourceScopes[cursor.scopeIndex];
      if (!sourceScope) {
        throw new FindingPropagationWorkerFailure(
          "invalid_relationship_event_cursor",
          false,
        );
      }
      const pageCommand =
        enqueueFindingPropagationSourcePageInputSchema.safeParse({
          organizationId,
          eventId: described.event.eventId,
          eventKey: described.event.eventKey,
          graphVersion: described.event.graphVersion,
          correlationId: described.event.eventId,
          occurredAt: described.event.occurredAt,
          scopeKind: sourceScope.scopeKind,
          sourceProductId: sourceScope.sourceProductId,
          ...(sourceScope.scopeKind === "release"
            ? { sourceReleaseId: sourceScope.sourceReleaseId }
            : {}),
          ...(sourceScope.scopeKind === "baseline"
            ? { sourceBaselineRevisionId: sourceScope.sourceBaselineRevisionId }
            : {}),
          asOf: described.event.occurredAt,
          cursor: cursor.sourceCursor,
          pageSize: sourcePageSize,
        });
      if (!pageCommand.success) {
        throw new FindingPropagationWorkerFailure(
          "invalid_relationship_event",
          false,
        );
      }
      const enqueued = await this.dependencies.queue.enqueueSourcePage(
        pageCommand.data,
      );
      if (enqueued.outcome === "obsolete") {
        this.measure("stale_propagation", 1);
        await this.advanceRelationshipEvent(claim, null, true);
        return false;
      }
      if (enqueued.outcome !== "enqueued_page") {
        throw new FindingPropagationWorkerFailure("enqueue_rejected", false);
      }
      this.measure("source_page_fanout", enqueued.sourceCount);

      if (enqueued.nextCursor !== null) {
        return this.advanceRelationshipEvent(
          claim,
          this.encodeEventCursor({
            scopeIndex: cursor.scopeIndex,
            sourceCursor: enqueued.nextCursor,
          }),
          false,
        );
      }

      const nextScopeIndex = cursor.scopeIndex + 1;
      if (nextScopeIndex < described.event.sourceScopes.length) {
        return this.advanceRelationshipEvent(
          claim,
          this.encodeEventCursor({
            scopeIndex: nextScopeIndex,
            sourceCursor: null,
          }),
          false,
        );
      }
      await this.advanceRelationshipEvent(claim, null, true);
      return false;
    } catch (error) {
      await this.safeFailRelationshipEvent(claim, error);
      return false;
    }
  }

  private async advanceRelationshipEvent(
    claim: Extract<
      Awaited<ReturnType<ProductRelationshipGraphEventWorkerPort["claim"]>>,
      { outcome: "claimed" }
    >,
    deliveryCursor: string | null,
    isFinal: boolean,
  ): Promise<boolean> {
    const checkpoint = await this.dependencies.productEvents.checkpoint({
      organizationId: claim.organizationId,
      eventId: claim.eventId,
      workerId: this.dependencies.workerId,
      checkpointVersion: claim.checkpointVersion,
      checkpoint: { deliveryCursor, isFinal },
    });
    if (
      checkpoint.outcome === "scheduled" ||
      checkpoint.outcome === "completed" ||
      checkpoint.outcome === "delivered"
    ) {
      return checkpoint.outcome === "scheduled";
    }
    if (checkpoint.outcome === "obsolete") {
      this.measure("stale_propagation", 1);
      return false;
    }
    if (
      checkpoint.outcome === "conflict" ||
      checkpoint.outcome === "not_found"
    ) {
      return false;
    }
    throw new FindingPropagationWorkerFailure("checkpoint_rejected", false);
  }

  private async processOneFindingJob(organizationId: string): Promise<boolean> {
    const claim = await this.dependencies.queue.claim({
      organizationId,
      workerId: this.dependencies.workerId,
      leaseSeconds: this.dependencies.leaseSeconds,
    });
    if (claim.outcome !== "claimed") return false;

    try {
      const startedAt = Date.now();
      const page = await this.dependencies.relationships.getCandidatePage({
        organizationId: claim.organizationId,
        sourceReleaseId: claim.sourceReleaseId ?? undefined,
        sourceBaselineRevisionId: claim.sourceBaselineRevisionId ?? undefined,
        graphVersion: claim.graphVersion,
        asOf: claim.asOf,
        cursor: claim.cursor ?? undefined,
      });
      this.measure("traversal_latency_ms", Date.now() - startedAt);
      if (page.outcome === "conflict") {
        const obsolete = await this.dependencies.queue.obsolete({
          organizationId: claim.organizationId,
          jobId: claim.jobId,
          workerId: this.dependencies.workerId,
          checkpointVersion: claim.checkpointVersion,
          reason: "stale_graph",
        });
        if (obsolete.outcome === "obsolete")
          this.measure("stale_propagation", 1);
        if (
          obsolete.outcome === "obsolete" ||
          obsolete.outcome === "conflict" ||
          obsolete.outcome === "not_found"
        ) {
          return false;
        }
        throw new FindingPropagationWorkerFailure("obsolete_rejected", false);
      }
      if (page.outcome !== "found") {
        throw new FindingPropagationWorkerFailure(
          page.outcome === "not_found"
            ? "source_not_found"
            : "invalid_graph_query",
          false,
        );
      }
      if (page.graphVersion !== claim.graphVersion) {
        throw new FindingPropagationWorkerFailure(
          "malformed_relationship_page",
          false,
        );
      }

      const candidates = page.candidates.map((candidate) => {
        const parsed =
          findingPropagationPageCandidateSchema.safeParse(candidate);
        if (!parsed.success) {
          throw new FindingPropagationWorkerFailure(
            "malformed_relationship_page",
            false,
          );
        }
        return parsed.data;
      });
      const persist = persistFindingPropagationPageInputSchema.safeParse({
        organizationId: claim.organizationId,
        jobId: claim.jobId,
        leaseOwner: this.dependencies.workerId,
        expectedCheckpointVersion: claim.checkpointVersion,
        candidates,
        nextCursor: page.nextCursor,
        isFinal: page.nextCursor === null,
      });
      if (!persist.success) {
        throw new FindingPropagationWorkerFailure(
          "invalid_persist_page",
          false,
        );
      }
      const persisted = await this.dependencies.queue.persistPage(persist.data);
      if (persisted.outcome === "scheduled") {
        return true;
      }
      if (persisted.outcome === "completed") {
        return false;
      }
      if (
        persisted.outcome === "conflict" ||
        persisted.outcome === "not_found"
      ) {
        return false;
      }
      throw new FindingPropagationWorkerFailure("persist_rejected", false);
    } catch (error) {
      await this.safeFailJob(claim, error);
      return false;
    }
  }

  private async safeFailRelationshipEvent(
    claim: Extract<
      Awaited<ReturnType<ProductRelationshipGraphEventWorkerPort["claim"]>>,
      { outcome: "claimed" }
    >,
    error: unknown,
  ): Promise<void> {
    try {
      const outcome = await this.dependencies.productEvents.fail({
        organizationId: claim.organizationId,
        eventId: claim.eventId,
        workerId: this.dependencies.workerId,
        checkpointVersion: claim.checkpointVersion,
        errorCode: this.errorCode(error),
        retryable: this.retryable(error),
      });
      this.measureFailure(outcome.outcome);
    } catch {
      // The existing lease remains the durable recovery record.
    }
  }

  private async safeFailJob(
    claim: Extract<FindingPropagationJobClaim, { outcome: "claimed" }>,
    error: unknown,
  ): Promise<void> {
    try {
      const outcome = await this.dependencies.queue.fail({
        organizationId: claim.organizationId,
        jobId: claim.jobId,
        workerId: this.dependencies.workerId,
        checkpointVersion: claim.checkpointVersion,
        errorCode: this.errorCode(error),
        retryable: this.retryable(error),
      });
      this.measureFailure(outcome.outcome);
    } catch {
      // The existing lease remains the durable recovery record.
    }
  }

  private decodeEventCursor(value: string | null): EventCursor {
    if (value === null)
      return Object.freeze({ scopeIndex: 0, sourceCursor: null });
    const parsed = eventDeliveryCursorSchema.safeParse(value);
    if (!parsed.success) {
      throw new FindingPropagationWorkerFailure(
        "invalid_relationship_event_cursor",
        false,
      );
    }
    const [scopeIndex, sourceCursor] = parsed.data.split(":", 2);
    return Object.freeze({
      scopeIndex: Number.parseInt(scopeIndex!, 10),
      sourceCursor: sourceCursor === "" ? null : sourceCursor!,
    });
  }

  private encodeEventCursor(cursor: EventCursor): string {
    return `${cursor.scopeIndex}:${cursor.sourceCursor ?? ""}`;
  }

  private uniqueOrganizationIds(organizationIds: readonly string[]): string[] {
    return [
      ...new Set(
        organizationIds.filter(
          (organizationId) => uuid.safeParse(organizationId).success,
        ),
      ),
    ].sort((left, right) => left.localeCompare(right));
  }

  private errorCode(error: unknown): string {
    if (error instanceof FindingPropagationWorkerFailure) return error.code;
    return "provider_unavailable";
  }

  private retryable(error: unknown): boolean {
    return error instanceof FindingPropagationWorkerFailure
      ? error.retryable
      : true;
  }

  private measureFailure(
    outcome:
      | "retry_scheduled"
      | "dead_letter"
      | "conflict"
      | "not_found"
      | "invalid_request",
  ): void {
    if (outcome === "retry_scheduled") this.measure("retry_count", 1);
    if (outcome === "dead_letter") this.measure("dead_letter", 1);
  }

  private measure(
    metric: FindingPropagationMeasurement["metric"],
    value: number,
  ): void {
    const measurement = Object.freeze({ metric, value: Math.max(0, value) });
    if (this.dependencies.observe) {
      this.dependencies.observe(measurement);
      return;
    }
    this.logger.log(
      JSON.stringify({
        event: "finding_propagation_measurement",
        ...measurement,
      }),
    );
  }
}
