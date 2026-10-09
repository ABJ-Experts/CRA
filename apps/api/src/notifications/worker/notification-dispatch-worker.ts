import { Logger } from "@nestjs/common";

const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const sha256Pattern = /^[a-f0-9]{64}$/;
const maximumClaimsPerOrganizationPerCycle = 100;
const maximumOrganizationPagesPerCycle = 100;

export type NotificationPayload =
  | Readonly<{
      kind: "finding_triage";
      advisoryId: string;
      severity: string;
      alertKind: "suppression_expired" | "internal_sla_breached";
    }>
  | Readonly<{ kind: "evidence_quarantined" }>
  | Readonly<{ kind: "evidence_integrity_failure" }>
  | Readonly<{
      kind: "evidence_validity";
      title: string;
      validUntil: string;
      thresholdDays: number;
      productId: string | null;
    }>
  | Readonly<{
      kind: "supplier_owner";
      portalTitle: string;
      dueAt: string;
    }>
  | Readonly<{
      kind: "digest";
      items: readonly Readonly<{
        title: string;
        href: string;
        date: string;
        category: string;
      }>[];
    }>
  | Readonly<{
      kind: "burst";
      count: number;
      href: string;
      items: readonly Readonly<{
        title: string;
        href: string;
        date: string;
        category: string;
      }>[];
    }>;

export type NotificationDispatchClaim =
  | Readonly<{
      outcome: "claimed";
      dispatchId: string;
      leaseOwner: string;
      checkpointVersion: number;
    }>
  | Readonly<{ outcome: "none_available" | "conflict" }>;

export type NotificationPreparedDispatch =
  | Readonly<{
      outcome: "ready";
      recipient: Readonly<{ userId: string; email: string }>;
      idempotencyKey: string;
      payload: NotificationPayload;
    }>
  | Readonly<{ outcome: "cancelled" | "conflict" | "not_found" }>;

export type NotificationSendReceipt = Readonly<{
  status: "provider_accepted";
  messageIdHash: string | null;
}>;

export class NotificationDispatchFailure extends Error {
  readonly name = "NotificationDispatchFailure";

  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}

export interface NotificationDispatchWorkerDependencies {
  workerId: string;
  leaseSeconds: number;
  queue: Readonly<{
    dueOrganizations(afterOrganizationId: string | null): Promise<
      Readonly<{
        organizationIds: readonly string[];
        nextOrganizationId: string | null;
      }>
    >;
    bridge(organizationId: string): Promise<void>;
    claim(
      input: Readonly<{
        organizationId: string;
        workerId: string;
        leaseSeconds: number;
      }>,
    ): Promise<NotificationDispatchClaim>;
    prepare(
      input: Readonly<{
        organizationId: string;
        dispatchId: string;
        leaseOwner: string;
        checkpointVersion: number;
      }>,
    ): Promise<NotificationPreparedDispatch>;
    complete(
      input: Readonly<{
        organizationId: string;
        dispatchId: string;
        leaseOwner: string;
        checkpointVersion: number;
        messageIdHash: string | null;
      }>,
    ): Promise<Readonly<{ outcome: "completed" | "conflict" }>>;
    fail(
      input: Readonly<{
        organizationId: string;
        dispatchId: string;
        leaseOwner: string;
        checkpointVersion: number;
        code: string;
        retryable: boolean;
      }>,
    ): Promise<
      Readonly<{ outcome: "retry_scheduled" | "exhausted" | "conflict" }>
    >;
  }>;
  delivery: Readonly<{
    send(
      input: Readonly<{
        organizationId: string;
        dispatchId: string;
        recipient: Readonly<{ userId: string; email: string }>;
        idempotencyKey: string;
        payload: NotificationPayload;
      }>,
    ): Promise<NotificationSendReceipt>;
  }>;
}

/** The source outbox remains durable; this worker owns only optional email. */
export class NotificationDispatchWorker {
  private readonly logger = new Logger(NotificationDispatchWorker.name);
  private afterOrganizationId: string | null = null;

  constructor(
    private readonly dependencies: NotificationDispatchWorkerDependencies,
  ) {
    if (
      !uuidPattern.test(dependencies.workerId) ||
      !Number.isInteger(dependencies.leaseSeconds) ||
      dependencies.leaseSeconds < 15 ||
      dependencies.leaseSeconds > 900
    ) {
      throw new Error("invalid notification dispatch worker configuration");
    }
  }

  async runOnce(): Promise<void> {
    for (let page = 0; page < maximumOrganizationPagesPerCycle; page += 1) {
      const after = this.afterOrganizationId;
      const result = await this.dependencies.queue.dueOrganizations(after);
      for (const organizationId of new Set(result.organizationIds)) {
        if (!uuidPattern.test(organizationId)) {
          throw new NotificationDispatchFailure("malformed_provider", false);
        }
        await this.processOrganization(organizationId);
      }
      if (result.nextOrganizationId === null) {
        this.afterOrganizationId = null;
        return;
      }
      if (
        !uuidPattern.test(result.nextOrganizationId) ||
        result.nextOrganizationId === after
      ) {
        throw new NotificationDispatchFailure("malformed_provider", false);
      }
      this.afterOrganizationId = result.nextOrganizationId;
    }
  }

  private async processOrganization(organizationId: string): Promise<void> {
    try {
      await this.dependencies.queue.bridge(organizationId);
    } catch {
      this.logger.error("Notification source bridge unavailable");
      return;
    }
    for (
      let count = 0;
      count < maximumClaimsPerOrganizationPerCycle;
      count += 1
    ) {
      const claim = await this.dependencies.queue.claim({
        organizationId,
        workerId: this.dependencies.workerId,
        leaseSeconds: this.dependencies.leaseSeconds,
      });
      if (claim.outcome !== "claimed") return;

      let prepared: NotificationPreparedDispatch;
      try {
        prepared = await this.dependencies.queue.prepare({
          organizationId,
          dispatchId: claim.dispatchId,
          leaseOwner: claim.leaseOwner,
          checkpointVersion: claim.checkpointVersion,
        });
      } catch {
        await this.fail(organizationId, claim, "provider_unavailable", true);
        continue;
      }
      if (prepared.outcome !== "ready") continue;

      let receipt: NotificationSendReceipt;
      try {
        receipt = await this.dependencies.delivery.send({
          organizationId,
          dispatchId: claim.dispatchId,
          recipient: prepared.recipient,
          idempotencyKey: prepared.idempotencyKey,
          payload: prepared.payload,
        });
        if (
          receipt.status !== "provider_accepted" ||
          (receipt.messageIdHash !== null &&
            !sha256Pattern.test(receipt.messageIdHash))
        ) {
          throw new NotificationDispatchFailure("malformed_provider", false);
        }
      } catch (error) {
        const failure =
          error instanceof NotificationDispatchFailure
            ? error
            : new NotificationDispatchFailure("provider_unavailable", true);
        await this.fail(organizationId, claim, failure.code, failure.retryable);
        continue;
      }

      try {
        const result = await this.dependencies.queue.complete({
          organizationId,
          dispatchId: claim.dispatchId,
          leaseOwner: claim.leaseOwner,
          checkpointVersion: claim.checkpointVersion,
          messageIdHash: receipt.messageIdHash,
        });
        if (result.outcome !== "completed") {
          this.logger.warn("Notification acceptance completion conflicted");
        }
      } catch {
        // SMTP may already have accepted this message. Keep the lease for
        // reconciliation; recording a send failure here would provoke a retry.
        this.logger.error("Notification acceptance completion unavailable");
      }
    }
  }

  private async fail(
    organizationId: string,
    claim: Extract<NotificationDispatchClaim, { outcome: "claimed" }>,
    code: string,
    retryable: boolean,
  ): Promise<void> {
    try {
      await this.dependencies.queue.fail({
        organizationId,
        dispatchId: claim.dispatchId,
        leaseOwner: claim.leaseOwner,
        checkpointVersion: claim.checkpointVersion,
        code,
        retryable,
      });
    } catch {
      this.logger.error("Notification delivery failure could not be recorded");
    }
  }
}
