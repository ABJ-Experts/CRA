const organizationIdPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const utcTimestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const isCompletionConflict = (outcome: string): boolean =>
  outcome === "conflict" || outcome === "not_found";

// A single organisation can legitimately have several due thresholds at once
// (for example a catch-up after worker downtime). Drain the durable queue in
// one cycle so the 30-second scheduler can meet the 60-second notification
// objective. Failed work is rescheduled by PostgreSQL before the next claim,
// so this cannot spin on the same failed record.
const maximumClaimsPerOrganizationPerCycle = 1_000;

const safeErrorCode = (value: unknown): string =>
  value instanceof ProductRetentionWorkerFailure
    ? value.code
    : "provider_unavailable";

const retryable = (value: unknown): boolean =>
  !(value instanceof ProductRetentionWorkerFailure) || value.retryable;

export type ProductRetentionDeliveryState = "current" | "missed_catch_up";

export type ProductRetentionRecipient = Readonly<{
  userId: string;
  email: string;
}>;

export type ProductRetentionEvent = Readonly<{
  organizationId: string;
  productId: string;
  /** A display-safe product label emitted by the tenant-scoped claim RPC. */
  productName: string;
  releaseId: string | null;
  /** This mail worker never delivers generic regulatory lifecycle events. */
  eventType: "support_period.alert";
  eventKey: string;
  supportPeriodId: string;
  supportPeriodRevision: number;
  thresholdDays: number;
  supportEndsAt: string;
  dueAt: string;
  deliveryState: ProductRetentionDeliveryState;
}>;

export type ProductRetentionClaim =
  | Readonly<{
      outcome: "claimed";
      deliveryId: string;
      leaseOwner: string;
      checkpointVersion: number;
      event: ProductRetentionEvent;
    }>
  | Readonly<{
      outcome: "none_available" | "conflict" | "not_found" | "invalid_state";
    }>;

export class ProductRetentionWorkerFailure extends Error {
  readonly name = "ProductRetentionWorkerFailure";

  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}

/**
 * Required-delivery boundary for the durable notification queue. Adapters must
 * reject their promise when the underlying provider cannot accept a message;
 * using MailService is unsafe here because its public methods intentionally
 * log and swallow provider failures for request/response flows.
 */
export interface ProductRetentionDeliveryPort {
  deliver(
    delivery: Readonly<{
      idempotencyKey: string;
      recipient: ProductRetentionRecipient;
      event: ProductRetentionEvent;
    }>,
  ): Promise<void>;
}

export interface ProductRetentionWorkerDependencies {
  workerId: string;
  leaseSeconds: number;
  maximumClockSkewMilliseconds: number;
  /**
   * Scheduling is bound to PostgreSQL time. Local time is recorded only as an
   * operational skew observation; it must never delay a database-due alert.
   */
  clock: Readonly<{
    databaseNow(): Promise<Date>;
    localNow(): Date;
    observeSkew(
      input: Readonly<{
        databaseNow: Date;
        localNow: Date;
        skewMilliseconds: number;
      }>,
    ): Promise<void>;
  }>;
  queue: Readonly<{
    dueOrganizationIds(databaseNow: Date): Promise<readonly string[]>;
    claim(
      command: Readonly<{
        organizationId: string;
        workerId: string;
        leaseSeconds: number;
        databaseNow: Date;
      }>,
    ): Promise<ProductRetentionClaim>;
    complete(
      command: Readonly<{
        organizationId: string;
        deliveryId: string;
        leaseOwner: string;
        checkpointVersion: number;
        recipientId: string;
        databaseNow: Date;
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
        nextDeliveryState: "missed_catch_up";
        databaseNow: Date;
      }>,
    ): Promise<void>;
  }>;
  recipients: Readonly<{
    /** The adapter must return only an active product owner in this tenant. */
    productOwner(
      input: Readonly<{ organizationId: string; productId: string }>,
    ): Promise<ProductRetentionRecipient | null>;
    /** The adapter must return only an active organization owner or admin. */
    organizationOwnerOrAdmin(
      input: Readonly<{ organizationId: string }>,
    ): Promise<ProductRetentionRecipient | null>;
  }>;
  delivery: ProductRetentionDeliveryPort;
}

/**
 * Stateless durable outbox processor for M2 regulatory retention signals.
 * Claims, attempts, catch-up state, and completion all belong to the database;
 * a restart can therefore repeat a provider request only with its stable event
 * key, allowing the required-delivery adapter to deduplicate it safely.
 */
export class ProductRetentionWorker {
  constructor(
    private readonly dependencies: ProductRetentionWorkerDependencies,
  ) {
    if (
      !Number.isInteger(dependencies.leaseSeconds) ||
      dependencies.leaseSeconds < 1 ||
      dependencies.leaseSeconds > 3600
    ) {
      throw new Error("invalid product retention worker lease");
    }
    if (
      !Number.isSafeInteger(dependencies.maximumClockSkewMilliseconds) ||
      dependencies.maximumClockSkewMilliseconds < 0
    ) {
      throw new Error("invalid product retention worker clock skew");
    }
  }

  async runOnce(): Promise<void> {
    const databaseNow = await this.databaseNow();
    await this.observeClockSkew(databaseNow);
    const organizationIds =
      await this.dependencies.queue.dueOrganizationIds(databaseNow);
    for (const organizationId of this.uniqueOrganizationIds(organizationIds)) {
      await this.processOrganization(organizationId, databaseNow);
    }
  }

  private async processOrganization(
    organizationId: string,
    databaseNow: Date,
  ): Promise<void> {
    for (
      let claimedCount = 0;
      claimedCount < maximumClaimsPerOrganizationPerCycle;
      claimedCount += 1
    ) {
      const claim = await this.dependencies.queue.claim({
        organizationId,
        workerId: this.dependencies.workerId,
        leaseSeconds: this.dependencies.leaseSeconds,
        databaseNow,
      });
      if (claim.outcome !== "claimed") return;

      try {
        if (!this.isSupportPeriodAlert(claim.event)) {
          throw new ProductRetentionWorkerFailure(
            "unexpected_alert_event",
            false,
          );
        }
        const recipient = await this.recipientFor(claim.event);
        if (!recipient) {
          throw new ProductRetentionWorkerFailure(
            "recipient_unavailable",
            true,
          );
        }
        await this.dependencies.delivery.deliver({
          idempotencyKey: claim.event.eventKey,
          recipient,
          event: claim.event,
        });
        const completion = await this.dependencies.queue.complete({
          organizationId,
          deliveryId: claim.deliveryId,
          leaseOwner: claim.leaseOwner,
          checkpointVersion: claim.checkpointVersion,
          recipientId: recipient.userId,
          databaseNow,
        });
        if (
          completion.outcome !== "completed" &&
          !isCompletionConflict(completion.outcome)
        ) {
          throw new ProductRetentionWorkerFailure("completion_rejected", false);
        }
      } catch (error) {
        await this.dependencies.queue.fail({
          organizationId,
          deliveryId: claim.deliveryId,
          leaseOwner: claim.leaseOwner,
          checkpointVersion: claim.checkpointVersion,
          code: safeErrorCode(error),
          retryable: retryable(error),
          nextDeliveryState: "missed_catch_up",
          databaseNow,
        });
      }
    }
  }

  private async recipientFor(
    event: ProductRetentionEvent,
  ): Promise<ProductRetentionRecipient | null> {
    const productOwner = await this.dependencies.recipients.productOwner({
      organizationId: event.organizationId,
      productId: event.productId,
    });
    if (this.isRecipient(productOwner)) return productOwner;

    const organizationOwnerOrAdmin =
      await this.dependencies.recipients.organizationOwnerOrAdmin({
        organizationId: event.organizationId,
      });
    return this.isRecipient(organizationOwnerOrAdmin)
      ? organizationOwnerOrAdmin
      : null;
  }

  private async databaseNow(): Promise<Date> {
    const value = await this.dependencies.clock.databaseNow();
    if (!Number.isFinite(value.getTime())) {
      throw new Error("invalid product retention worker database time");
    }
    return value;
  }

  private async observeClockSkew(databaseNow: Date): Promise<void> {
    const localNow = this.dependencies.clock.localNow();
    if (!Number.isFinite(localNow.getTime())) {
      throw new Error("invalid product retention worker local time");
    }
    const skewMilliseconds = Math.abs(
      localNow.getTime() - databaseNow.getTime(),
    );
    if (skewMilliseconds > this.dependencies.maximumClockSkewMilliseconds) {
      try {
        await this.dependencies.clock.observeSkew({
          databaseNow,
          localNow,
          skewMilliseconds,
        });
      } catch {
        // Database time is the delivery authority, so telemetry persistence
        // must not postpone an already due durable alert.
      }
    }
  }

  private uniqueOrganizationIds(values: readonly string[]): string[] {
    return [
      ...new Set(values.filter((value) => organizationIdPattern.test(value))),
    ];
  }

  private isSupportPeriodAlert(event: ProductRetentionEvent): boolean {
    return (
      event.eventType === "support_period.alert" &&
      organizationIdPattern.test(event.organizationId) &&
      organizationIdPattern.test(event.productId) &&
      event.productName.trim().length > 0 &&
      (event.releaseId === null ||
        organizationIdPattern.test(event.releaseId)) &&
      organizationIdPattern.test(event.supportPeriodId) &&
      Number.isSafeInteger(event.supportPeriodRevision) &&
      event.supportPeriodRevision >= 0 &&
      Number.isSafeInteger(event.thresholdDays) &&
      event.thresholdDays >= 0 &&
      event.eventKey.trim().length > 0 &&
      utcTimestampPattern.test(event.supportEndsAt) &&
      utcTimestampPattern.test(event.dueAt)
    );
  }

  private isRecipient(
    value: ProductRetentionRecipient | null,
  ): value is ProductRetentionRecipient {
    return Boolean(
      value && value.userId.trim().length > 0 && value.email.trim().length > 0,
    );
  }
}
