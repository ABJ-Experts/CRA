import { Logger } from "@nestjs/common";

import {
  NotificationDispatchFailure,
  type NotificationPayload,
  type NotificationSendReceipt,
} from "./notification-dispatch-worker";

const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const sha256Pattern = /^[a-f0-9]{64}$/;
const maximumClaimsPerOrganizationPerCycle = 100;
const maximumOrganizationPagesPerCycle = 100;

type Claim =
  | Readonly<{
      outcome: "claimed";
      batchId: string;
      leaseOwner: string;
      checkpointVersion: number;
    }>
  | Readonly<{ outcome: "none_available" | "conflict" }>;

type Prepared =
  | Readonly<{
      outcome: "ready";
      recipient: Readonly<{ userId: string; email: string }>;
      idempotencyKey: string;
      payload: Extract<NotificationPayload, { kind: "digest" }>;
    }>
  | Readonly<{ outcome: "cancelled" | "deferred" | "conflict" | "not_found" }>;

type Fence = Readonly<{
  organizationId: string;
  batchId: string;
  leaseOwner: string;
  checkpointVersion: number;
}>;

export interface DigestNotificationDispatchWorkerDependencies {
  workerId: string;
  leaseSeconds: number;
  queue: Readonly<{
    reconcileAmbiguousLeases(): Promise<
      Readonly<{
        outcome: "reconciled";
        dispatches: number;
        digests: number;
      }>
    >;
    dueOrganizations(afterOrganizationId: string | null): Promise<
      Readonly<{
        organizationIds: readonly string[];
        nextOrganizationId: string | null;
      }>
    >;
    schedule(organizationId: string): Promise<
      Readonly<{
        outcome: "scheduled" | "legacy";
        created: number;
      }>
    >;
    claim(
      input: Readonly<{
        organizationId: string;
        workerId: string;
        leaseSeconds: number;
      }>,
    ): Promise<Claim>;
    prepare(input: Fence): Promise<Prepared>;
    complete(
      input: Fence & Readonly<{ messageIdHash: string | null }>,
    ): Promise<
      Readonly<{
        outcome: "completed" | "conflict";
      }>
    >;
    fail(
      input: Fence &
        Readonly<{
          code: string;
          retryable: boolean;
        }>,
    ): Promise<
      Readonly<{
        outcome: "retry_scheduled" | "exhausted" | "conflict";
      }>
    >;
  }>;
  delivery: Readonly<{
    send(
      input: Readonly<{
        organizationId: string;
        batchId: string;
        recipient: Readonly<{ userId: string; email: string }>;
        idempotencyKey: string;
        payload: Extract<NotificationPayload, { kind: "digest" }>;
      }>,
    ): Promise<NotificationSendReceipt>;
  }>;
}

/** Bounded, tenant-fair digest work; SQL freezes and rechecks every batch. */
export class DigestNotificationDispatchWorker {
  private readonly logger = new Logger(DigestNotificationDispatchWorker.name);
  private afterOrganizationId: string | null = null;

  constructor(
    private readonly dependencies: DigestNotificationDispatchWorkerDependencies,
  ) {
    if (
      !uuidPattern.test(dependencies.workerId) ||
      !Number.isInteger(dependencies.leaseSeconds) ||
      dependencies.leaseSeconds < 30 ||
      dependencies.leaseSeconds > 900
    ) {
      throw new Error("invalid notification digest worker configuration");
    }
  }

  async runOnce(): Promise<void> {
    const reconciliation =
      await this.dependencies.queue.reconcileAmbiguousLeases();
    if (reconciliation.outcome !== "reconciled") throw malformedProvider();

    for (let page = 0; page < maximumOrganizationPagesPerCycle; page += 1) {
      const after = this.afterOrganizationId;
      const result = await this.dependencies.queue.dueOrganizations(after);
      for (const organizationId of new Set(result.organizationIds)) {
        if (!uuidPattern.test(organizationId)) throw malformedProvider();
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
        throw malformedProvider();
      }
      this.afterOrganizationId = result.nextOrganizationId;
    }
  }

  private async processOrganization(organizationId: string): Promise<void> {
    try {
      const result = await this.dependencies.queue.schedule(organizationId);
      if (result.outcome === "legacy") return;
      if (result.outcome !== "scheduled") throw malformedProvider();
    } catch {
      this.logger.error("Notification digest scheduling unavailable");
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
      if (
        !uuidPattern.test(claim.batchId) ||
        claim.leaseOwner !== this.dependencies.workerId ||
        !Number.isSafeInteger(claim.checkpointVersion) ||
        claim.checkpointVersion < 1
      )
        throw malformedProvider();

      const fence = {
        organizationId,
        batchId: claim.batchId,
        leaseOwner: claim.leaseOwner,
        checkpointVersion: claim.checkpointVersion,
      };
      let prepared: Prepared;
      try {
        prepared = await this.dependencies.queue.prepare(fence);
      } catch {
        await this.fail(fence, "provider_unavailable", true);
        continue;
      }
      if (prepared.outcome !== "ready") continue;

      let receipt: NotificationSendReceipt;
      try {
        receipt = await this.dependencies.delivery.send({
          organizationId,
          batchId: claim.batchId,
          recipient: prepared.recipient,
          idempotencyKey: prepared.idempotencyKey,
          payload: prepared.payload,
        });
        if (
          receipt.status !== "provider_accepted" ||
          (receipt.messageIdHash !== null &&
            !sha256Pattern.test(receipt.messageIdHash))
        )
          throw new NotificationDispatchFailure("malformed_provider", false);
      } catch (error) {
        const failure =
          error instanceof NotificationDispatchFailure
            ? error
            : new NotificationDispatchFailure("provider_unavailable", true);
        await this.fail(fence, failure.code, failure.retryable);
        continue;
      }

      try {
        const result = await this.dependencies.queue.complete({
          ...fence,
          messageIdHash: receipt.messageIdHash,
        });
        if (result.outcome !== "completed") {
          this.logger.warn(
            "Notification digest acceptance completion conflicted",
          );
        }
      } catch {
        // SMTP may have accepted this batch; let lease reconciliation mark it ambiguous.
        this.logger.error(
          "Notification digest acceptance completion unavailable",
        );
      }
    }
  }

  private async fail(
    fence: Fence,
    code: string,
    retryable: boolean,
  ): Promise<void> {
    try {
      await this.dependencies.queue.fail({ ...fence, code, retryable });
    } catch {
      this.logger.error("Notification digest failure recording unavailable");
    }
  }
}

function malformedProvider(): NotificationDispatchFailure {
  return new NotificationDispatchFailure("malformed_provider", false);
}
