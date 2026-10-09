import type { SecurityUpdateArtifact } from "@repo/contracts/products";
import { z } from "zod";

import {
  calculateSecurityUpdateAvailability,
  type SecurityUpdateAvailabilityResult,
} from "../application/security-update-availability-policy";

const uuid = z.uuid();
const maximumClaimsPerCycle = 1_000;

export type ProductComplianceMeasurement = Readonly<{
  metric:
    | "review_backlog"
    | "flagged_assessments"
    | "upload_failure"
    | "upload_failed"
    | "inspection_failure"
    | "quarantine"
    | "hash_mismatch"
    | "expiring_availability"
    | "missing_object"
    | "blocked_cleanup"
    | "availability_blocked"
    | "retry_count";
  value: number;
}>;

type RecalculationEvent = Readonly<{
  kind: "availability_recalculate";
  organizationId: string;
  productId: string;
  artifactId: string;
  actorId: string;
  issuedAt: string | null;
  supportEndsAt: string | null;
  existingAvailabilityUntil: string | null;
}>;
type ArtifactEvent = Readonly<{
  kind: "inspect" | "cleanup" | "integrity_reverify";
  organizationId: string;
  productId: string;
  artifactId: string;
  actorId: string;
  expectedVersion: number;
  sha256: string;
  byteSize: number;
  contentType: string;
  objectKey?: string;
  distributionKind?: SecurityUpdateArtifact["distributionKind"];
  externalReferenceCandidates?: readonly Pick<
    SecurityUpdateArtifact["publishedExternalReferences"][number],
    "id" | "title" | "uri"
  >[];
}>;
type ExternalReferenceMonitorEvent = Readonly<{
  kind: "external_reference_monitor";
  organizationId: string;
  productId: string;
  artifactId: string;
  actorId: string;
  expectedVersion: number;
  sha256: string;
  byteSize: number;
  externalReferenceCandidates: readonly Pick<
    SecurityUpdateArtifact["publishedExternalReferences"][number],
    "id" | "title" | "uri"
  >[];
}>;
export type ProductComplianceOutboxEvent =
  RecalculationEvent | ArtifactEvent | ExternalReferenceMonitorEvent;

export type ProductComplianceClaim =
  | Readonly<{
      outcome: "claimed";
      deliveryId: string;
      leaseOwner: string;
      checkpointVersion: number;
      event: ProductComplianceOutboxEvent;
    }>
  | Readonly<{
      outcome: "none_available" | "conflict" | "not_found" | "invalid_state";
    }>;

export interface ProductComplianceWorkerDependencies {
  workerId: string;
  leaseSeconds: number;
  queue: Readonly<{
    dueOrganizationIds(): Promise<readonly string[]>;
    claim(
      command: Readonly<{
        organizationId: string;
        workerId: string;
        leaseSeconds: number;
      }>,
    ): Promise<ProductComplianceClaim>;
    complete(
      command: Readonly<{
        organizationId: string;
        deliveryId: string;
        leaseOwner: string;
        checkpointVersion: number;
      }>,
    ): Promise<Readonly<{ outcome: "completed" | "conflict" | "not_found" }>>;
    fail(
      command: Readonly<{
        organizationId: string;
        deliveryId: string;
        leaseOwner: string;
        checkpointVersion: number;
        code: string;
        retryable: boolean;
      }>,
    ): Promise<Readonly<{ outcome: "failed" | "conflict" | "not_found" }>>;
  }>;
  processor: Readonly<{
    recalculate(
      command: Readonly<{
        organizationId: string;
        productId: string;
        artifactId: string;
        actorId: string;
        calculation: SecurityUpdateAvailabilityResult;
      }>,
    ): Promise<
      Readonly<{ outcome: "recalculated" | "conflict" | "not_found" }>
    >;
    inspect(
      command: Readonly<{
        organizationId: string;
        productId: string;
        artifactId: string;
        actorId: string;
        expectedVersion: number;
        sha256: string;
        byteSize: number;
        contentType: string;
        objectKey?: string;
        distributionKind?: SecurityUpdateArtifact["distributionKind"];
        externalReferenceCandidates?: ArtifactEvent["externalReferenceCandidates"];
      }>,
    ): Promise<Readonly<{ outcome: "inspected" | "conflict" | "not_found" }>>;
    cleanup(
      command: Readonly<{
        organizationId: string;
        productId: string;
        artifactId: string;
        actorId: string;
      }>,
    ): Promise<
      Readonly<{ outcome: "cleaned" | "blocked" | "conflict" | "not_found" }>
    >;
    reverify(
      command: Readonly<{
        organizationId: string;
        productId: string;
        artifactId: string;
        actorId: string;
        expectedVersion: number;
        sha256: string;
        byteSize: number;
        contentType: string;
        objectKey?: string;
      }>,
    ): Promise<Readonly<{ outcome: "reverified" | "conflict" | "not_found" }>>;
    monitorExternalReference(
      command: Readonly<{
        organizationId: string;
        productId: string;
        artifactId: string;
        actorId: string;
        expectedVersion: number;
        sha256: string;
        byteSize: number;
        externalReferenceCandidates: ExternalReferenceMonitorEvent["externalReferenceCandidates"];
      }>,
    ): Promise<Readonly<{ outcome: "monitored" | "conflict" | "not_found" }>>;
  }>;
  observe?: (measurement: ProductComplianceMeasurement) => void;
  /**
   * Optional per-organization gauge provider. Observability only: a gauge
   * failure never interrupts claim processing.
   */
  gauges?: (
    organizationId: string,
  ) => Promise<readonly ProductComplianceMeasurement[]>;
}

export class ProductComplianceWorkerFailure extends Error {
  readonly name = "ProductComplianceWorkerFailure";

  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}

/**
 * Focused, restart-safe product-compliance outbox processor. Every state
 * transition remains claimed and completed in PostgreSQL; this process holds
 * no progress and never logs artifact bytes, URLs, or assessment text.
 */
export class ProductComplianceWorker {
  constructor(
    private readonly dependencies: ProductComplianceWorkerDependencies,
  ) {
    if (!uuid.safeParse(dependencies.workerId).success) {
      throw new Error("invalid product compliance worker id");
    }
    if (
      !Number.isInteger(dependencies.leaseSeconds) ||
      dependencies.leaseSeconds < 1 ||
      dependencies.leaseSeconds > 3_600
    ) {
      throw new Error("invalid product compliance worker lease");
    }
  }

  async runOnce(): Promise<void> {
    const due = await this.dependencies.queue.dueOrganizationIds();
    let remaining = maximumClaimsPerCycle;
    for (const organizationId of uniqueOrganizationIds(due)) {
      await this.emitGauges(organizationId);
      while (remaining > 0) {
        const claimed = await this.dependencies.queue.claim({
          organizationId,
          workerId: this.dependencies.workerId,
          leaseSeconds: this.dependencies.leaseSeconds,
        });
        if (claimed.outcome !== "claimed") break;
        remaining -= 1;
        await this.processClaim(claimed);
      }
      if (remaining === 0) return;
    }
  }

  private async processClaim(
    claim: Extract<ProductComplianceClaim, { outcome: "claimed" }>,
  ) {
    try {
      await this.processEvent(claim.event);
      const completed = await this.dependencies.queue.complete({
        organizationId: claim.event.organizationId,
        deliveryId: claim.deliveryId,
        leaseOwner: claim.leaseOwner,
        checkpointVersion: claim.checkpointVersion,
      });
      if (
        completed.outcome !== "completed" &&
        completed.outcome !== "conflict" &&
        completed.outcome !== "not_found"
      ) {
        throw new ProductComplianceWorkerFailure("completion_rejected", true);
      }
    } catch (error) {
      const failure = toFailure(error);
      await this.dependencies.queue.fail({
        organizationId: claim.event.organizationId,
        deliveryId: claim.deliveryId,
        leaseOwner: claim.leaseOwner,
        checkpointVersion: claim.checkpointVersion,
        code: failure.code,
        retryable: failure.retryable,
      });
      this.observe(this.failureMetricFor(claim.event), 1);
      if (failure.retryable) this.observe("retry_count", 1);
    }
  }

  private async processEvent(
    event: ProductComplianceOutboxEvent,
  ): Promise<void> {
    switch (event.kind) {
      case "availability_recalculate": {
        const calculation = calculateSecurityUpdateAvailability({
          issuedAt: event.issuedAt,
          supportEndsAt: event.supportEndsAt,
          existingAvailabilityUntil: event.existingAvailabilityUntil,
        });
        const outcome = await this.dependencies.processor.recalculate({
          organizationId: event.organizationId,
          productId: event.productId,
          artifactId: event.artifactId,
          actorId: event.actorId,
          calculation,
        });
        this.ensureActiveActorResult(outcome);
        return;
      }
      case "inspect": {
        if (
          event.distributionKind === "authenticated_download" &&
          typeof event.objectKey !== "string"
        ) {
          throw new ProductComplianceWorkerFailure("malformed_provider", false);
        }
        const outcome = await this.dependencies.processor.inspect(event);
        this.ensureActiveActorResult(outcome);
        return;
      }
      case "cleanup": {
        const outcome = await this.dependencies.processor.cleanup(event);
        if (outcome.outcome === "blocked") {
          this.observe("blocked_cleanup", 1);
          return;
        }
        this.ensureActiveActorResult(outcome);
        return;
      }
      case "external_reference_monitor": {
        const outcome =
          await this.dependencies.processor.monitorExternalReference(event);
        this.ensureActiveActorResult(outcome);
        return;
      }
      case "integrity_reverify": {
        if (typeof event.objectKey !== "string") {
          throw new ProductComplianceWorkerFailure("malformed_provider", false);
        }
        const outcome = await this.dependencies.processor.reverify(event);
        this.ensureActiveActorResult(outcome);
        return;
      }
    }
  }

  private async emitGauges(organizationId: string): Promise<void> {
    if (!this.dependencies.gauges) return;
    try {
      for (const measurement of await this.dependencies.gauges(
        organizationId,
      )) {
        this.observe(measurement.metric, measurement.value);
      }
    } catch {
      // Observability must never fail a compliance cycle.
    }
  }

  private ensureActiveActorResult(result: Readonly<{ outcome: string }>): void {
    if (result.outcome === "not_found") {
      throw new ProductComplianceWorkerFailure(
        "worker_actor_unavailable",
        true,
      );
    }
  }

  private failureMetricFor(
    event: ProductComplianceOutboxEvent,
  ): ProductComplianceMeasurement["metric"] {
    switch (event.kind) {
      case "inspect":
        return "inspection_failure";
      case "integrity_reverify":
        return "inspection_failure";
      case "cleanup":
        return "blocked_cleanup";
      case "availability_recalculate":
        return "expiring_availability";
      case "external_reference_monitor":
        return "upload_failure";
    }
  }

  private observe(
    metric: ProductComplianceMeasurement["metric"],
    value: number,
  ): void {
    this.dependencies.observe?.(Object.freeze({ metric, value }));
  }
}

const uniqueOrganizationIds = (
  organizationIds: readonly string[],
): readonly string[] =>
  Object.freeze([
    ...new Set(
      organizationIds.filter((value) => uuid.safeParse(value).success),
    ),
  ]);

const toFailure = (error: unknown): ProductComplianceWorkerFailure =>
  error instanceof ProductComplianceWorkerFailure
    ? error
    : new ProductComplianceWorkerFailure("unavailable", true);
