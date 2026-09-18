const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const utcTimestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const maximumClaimsPerOrganizationPerCycle = 1_000;

export type ReportingDeadlineThreshold = 50 | 75 | 90 | 100;

export type ReportingDeadlineDeliveryDetails =
  | Readonly<{
      outcome: "deliverable";
      recipient: Readonly<{ userId: string; email: string }>;
      alert: Readonly<{
        obligationId: string;
        stageKind: "early_warning" | "notification" | "final_report";
        thresholdPercent: ReportingDeadlineThreshold;
        dueAt: string;
        idempotencyKey: string;
      }>;
    }>
  | Readonly<{ outcome: "cancelled" | "conflict" | "not_found" }>;

export type ReportingDeadlineDeliveryClaim =
  | Readonly<{
      outcome: "claimed";
      organizationId: string;
      deliveryId: string;
      leaseOwner: string;
      checkpointVersion: number;
    }>
  | Readonly<{
      outcome: "none_available" | "conflict" | "not_found" | "invalid_state";
    }>;

export class ReportingDeadlineMonitorFailure extends Error {
  readonly name = "ReportingDeadlineMonitorFailure";

  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}

export interface ReportingDeadlineDeliveryPort {
  deliver(
    input: Readonly<{
      idempotencyKey: string;
      recipient: Readonly<{ userId: string; email: string }>;
      alert: Extract<
        ReportingDeadlineDeliveryDetails,
        { outcome: "deliverable" }
      >["alert"];
    }>,
  ): Promise<void>;
}

export interface ReportingDeadlineMonitorDependencies {
  workerId: string;
  leaseSeconds: number;
  maximumClockSkewMilliseconds: number;
  clock: Readonly<{
    databaseNow(): Promise<Date>;
    localNow(): Date;
    /** Records both healthy and critical observations so readiness can recover. */
    observeSkew(
      input: Readonly<{
        databaseNow: Date;
        localNow: Date;
        skewMilliseconds: number;
        critical: boolean;
      }>,
    ): Promise<void>;
  }>;
  queue: Readonly<{
    /** Atomically catches up crossed thresholds before claims are listed. */
    reconcile(databaseNow: Date): Promise<void>;
    dueOrganizationIds(databaseNow: Date): Promise<readonly string[]>;
    claim(
      input: Readonly<{
        organizationId: string;
        workerId: string;
        leaseSeconds: number;
        databaseNow: Date;
      }>,
    ): Promise<ReportingDeadlineDeliveryClaim>;
    /** Rechecks tenant, membership, permission, active account, and cancellation. */
    deliveryDetails(
      input: Readonly<{
        organizationId: string;
        deliveryId: string;
        leaseOwner: string;
        checkpointVersion: number;
      }>,
    ): Promise<ReportingDeadlineDeliveryDetails>;
    complete(
      input: Readonly<{
        organizationId: string;
        deliveryId: string;
        leaseOwner: string;
        checkpointVersion: number;
        databaseNow: Date;
      }>,
    ): Promise<Readonly<{ outcome: "completed" | "conflict" | "not_found" }>>;
    fail(
      input: Readonly<{
        organizationId: string;
        deliveryId: string;
        leaseOwner: string;
        checkpointVersion: number;
        code: string;
        retryable: boolean;
        databaseNow: Date;
      }>,
    ): Promise<void>;
  }>;
  delivery: ReportingDeadlineDeliveryPort;
}

/**
 * PostgreSQL is the sole deadline authority. This process only reconciles its
 * durable outbox, leases a delivery, and invokes the email provider. A worker
 * restart therefore catches up all crossed thresholds without browser or
 * transport clocks inventing deadline state.
 */
export class ReportingDeadlineMonitorWorker {
  constructor(
    private readonly dependencies: ReportingDeadlineMonitorDependencies,
  ) {
    if (!uuidPattern.test(dependencies.workerId)) {
      throw new Error("invalid reporting deadline monitor worker id");
    }
    if (
      !Number.isInteger(dependencies.leaseSeconds) ||
      dependencies.leaseSeconds < 15 ||
      dependencies.leaseSeconds > 900
    ) {
      throw new Error("invalid reporting deadline monitor worker lease");
    }
    if (
      !Number.isSafeInteger(dependencies.maximumClockSkewMilliseconds) ||
      dependencies.maximumClockSkewMilliseconds < 1_000
    ) {
      throw new Error("invalid reporting deadline monitor worker clock skew");
    }
  }

  async runOnce(): Promise<void> {
    const databaseNow = await this.databaseNow();
    await this.observeClockSkew(databaseNow);
    await this.dependencies.queue.reconcile(databaseNow);
    const organizationIds =
      await this.dependencies.queue.dueOrganizationIds(databaseNow);
    for (const organizationId of uniqueOrganizationIds(organizationIds)) {
      await this.processOrganization(organizationId, databaseNow);
    }
  }

  private async processOrganization(
    organizationId: string,
    databaseNow: Date,
  ): Promise<void> {
    for (
      let claimCount = 0;
      claimCount < maximumClaimsPerOrganizationPerCycle;
      claimCount += 1
    ) {
      const claim = await this.dependencies.queue.claim({
        organizationId,
        workerId: this.dependencies.workerId,
        leaseSeconds: this.dependencies.leaseSeconds,
        databaseNow,
      });
      if (claim.outcome !== "claimed") return;

      try {
        const details = await this.dependencies.queue.deliveryDetails({
          organizationId,
          deliveryId: claim.deliveryId,
          leaseOwner: claim.leaseOwner,
          checkpointVersion: claim.checkpointVersion,
        });
        // The SQL details RPC cancels an ineligible delivery before returning
        // this outcome. Do not complete or retry a deliberately cancelled row.
        if (details.outcome !== "deliverable") continue;
        if (!isDeliverable(details)) {
          throw new ReportingDeadlineMonitorFailure(
            "malformed_delivery_details",
            false,
          );
        }
        await this.dependencies.delivery.deliver({
          idempotencyKey: details.alert.idempotencyKey,
          recipient: details.recipient,
          alert: details.alert,
        });
        const completion = await this.dependencies.queue.complete({
          organizationId,
          deliveryId: claim.deliveryId,
          leaseOwner: claim.leaseOwner,
          checkpointVersion: claim.checkpointVersion,
          databaseNow,
        });
        if (
          completion.outcome !== "completed" &&
          completion.outcome !== "conflict" &&
          completion.outcome !== "not_found"
        ) {
          throw new ReportingDeadlineMonitorFailure(
            "completion_rejected",
            false,
          );
        }
      } catch (error) {
        await this.dependencies.queue.fail({
          organizationId,
          deliveryId: claim.deliveryId,
          leaseOwner: claim.leaseOwner,
          checkpointVersion: claim.checkpointVersion,
          code: safeErrorCode(error),
          retryable: isRetryable(error),
          databaseNow,
        });
      }
    }
  }

  private async databaseNow(): Promise<Date> {
    const value = await this.dependencies.clock.databaseNow();
    if (!Number.isFinite(value.getTime())) {
      throw new Error("invalid reporting deadline monitor database time");
    }
    return value;
  }

  private async observeClockSkew(databaseNow: Date): Promise<void> {
    const localNow = this.dependencies.clock.localNow();
    if (!Number.isFinite(localNow.getTime())) {
      throw new Error("invalid reporting deadline monitor local time");
    }
    const skewMilliseconds = Math.abs(
      localNow.getTime() - databaseNow.getTime(),
    );
    try {
      await this.dependencies.clock.observeSkew({
        databaseNow,
        localNow,
        skewMilliseconds,
        critical:
          skewMilliseconds >= this.dependencies.maximumClockSkewMilliseconds,
      });
    } catch {
      // Evaluation stays database-time authoritative even if monitor telemetry
      // cannot be persisted. A later cycle retries the health observation.
    }
  }
}

function uniqueOrganizationIds(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => uuidPattern.test(value)))];
}

function isDeliverable(
  value: Extract<ReportingDeadlineDeliveryDetails, { outcome: "deliverable" }>,
): boolean {
  const alert = value.alert;
  return (
    uuidPattern.test(value.recipient.userId) &&
    value.recipient.email.trim().length > 0 &&
    uuidPattern.test(alert.obligationId) &&
    ["early_warning", "notification", "final_report"].includes(
      alert.stageKind,
    ) &&
    [50, 75, 90, 100].includes(alert.thresholdPercent) &&
    utcTimestampPattern.test(alert.dueAt) &&
    alert.idempotencyKey.trim().length > 0
  );
}

function safeErrorCode(error: unknown): string {
  return error instanceof ReportingDeadlineMonitorFailure
    ? error.code
    : "provider_unavailable";
}

function isRetryable(error: unknown): boolean {
  return !(error instanceof ReportingDeadlineMonitorFailure) || error.retryable;
}
