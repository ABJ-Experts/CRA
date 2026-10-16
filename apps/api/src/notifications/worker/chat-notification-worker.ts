import { Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import type {
  ChatCredential,
  ChatMessage,
  ChatDeliveryResult,
} from "./chat-provider-delivery.adapter";

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const maxOrganizationPages = 100;
const maxClaimsPerOrganization = 20;

export type ChatDeliveryClaim =
  | Readonly<{
      outcome: "claimed";
      deliveryId: string;
      checkpointVersion: number;
    }>
  | Readonly<{ outcome: "none_available" | "conflict" }>;

export type PreparedChatDelivery =
  | Readonly<{
      outcome: "ready";
      credential: ChatCredential;
      message: ChatMessage;
    }>
  | Readonly<{ outcome: "cancelled" | "conflict" | "not_found" }>;

export interface ChatNotificationWorkerDependencies {
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
    ): Promise<ChatDeliveryClaim>;
    prepare(
      input: Readonly<{
        organizationId: string;
        deliveryId: string;
        workerId: string;
        checkpointVersion: number;
      }>,
    ): Promise<PreparedChatDelivery>;
    revalidate(
      input: Readonly<{
        organizationId: string;
        deliveryId: string;
        workerId: string;
        checkpointVersion: number;
      }>,
    ): Promise<boolean>;
    complete(
      input: Readonly<{
        organizationId: string;
        deliveryId: string;
        workerId: string;
        checkpointVersion: number;
        status:
          | "provider_accepted"
          | "failed"
          | "exhausted"
          | "uncertain"
          | "cancelled";
        safeErrorCode: string | null;
        providerMessageIdHash: string | null;
        retryAfterSeconds: number | null;
      }>,
    ): Promise<Readonly<{ outcome: "completed" | "conflict" }>>;
  }>;
  delivery: Readonly<{
    send(
      input: Readonly<{
        credential: ChatCredential;
        message: ChatMessage;
        beforeSend: () => Promise<boolean>;
      }>,
    ): Promise<ChatDeliveryResult>;
  }>;
}

/** Source outboxes own intent; this worker handles bounded external attempts. */
export class ChatNotificationWorker {
  private readonly logger = new Logger(ChatNotificationWorker.name);
  private afterOrganizationId: string | null = null;

  constructor(
    private readonly dependencies: ChatNotificationWorkerDependencies,
  ) {
    if (
      !uuid.test(dependencies.workerId) ||
      !Number.isInteger(dependencies.leaseSeconds) ||
      dependencies.leaseSeconds < 15 ||
      dependencies.leaseSeconds > 900
    ) {
      throw new Error("invalid chat worker configuration");
    }
  }

  async runOnce(): Promise<void> {
    for (let page = 0; page < maxOrganizationPages; page += 1) {
      const after = this.afterOrganizationId;
      const result = await this.dependencies.queue.dueOrganizations(after);
      for (const organizationId of new Set(result.organizationIds)) {
        if (!uuid.test(organizationId))
          throw new Error("invalid chat organization scope");
        await this.processOrganization(organizationId);
      }
      if (result.nextOrganizationId === null) {
        this.afterOrganizationId = null;
        return;
      }
      if (
        !uuid.test(result.nextOrganizationId) ||
        result.nextOrganizationId === after
      ) {
        throw new Error("invalid chat organization cursor");
      }
      this.afterOrganizationId = result.nextOrganizationId;
    }
  }

  private async processOrganization(organizationId: string): Promise<void> {
    try {
      await this.dependencies.queue.bridge(organizationId);
    } catch {
      this.logger.error("Chat source bridge unavailable");
      return;
    }
    for (let count = 0; count < maxClaimsPerOrganization; count += 1) {
      let claim: ChatDeliveryClaim;
      try {
        claim = await this.dependencies.queue.claim({
          organizationId,
          workerId: this.dependencies.workerId,
          leaseSeconds: this.dependencies.leaseSeconds,
        });
      } catch {
        this.logger.error("Chat claim unavailable");
        return;
      }
      if (claim.outcome !== "claimed") return;
      let prepared: PreparedChatDelivery;
      try {
        prepared = await this.dependencies.queue.prepare({
          organizationId,
          deliveryId: claim.deliveryId,
          workerId: this.dependencies.workerId,
          checkpointVersion: claim.checkpointVersion,
        });
      } catch {
        await this.completeFailure(
          organizationId,
          claim,
          "prepare_unavailable",
          true,
          false,
          null,
        );
        continue;
      }
      if (prepared.outcome !== "ready") continue;
      try {
        const result = await this.dependencies.delivery.send({
          credential: prepared.credential,
          message: prepared.message,
          beforeSend: () =>
            this.dependencies.queue.revalidate({
              organizationId,
              deliveryId: claim.deliveryId,
              workerId: this.dependencies.workerId,
              checkpointVersion: claim.checkpointVersion,
            }),
        });
        if (result.outcome === "provider_accepted") {
          await this.dependencies.queue.complete({
            organizationId,
            deliveryId: claim.deliveryId,
            workerId: this.dependencies.workerId,
            checkpointVersion: claim.checkpointVersion,
            status: "provider_accepted",
            safeErrorCode: null,
            providerMessageIdHash: result.providerMessageId
              ? createHash("sha256")
                  .update(result.providerMessageId)
                  .digest("hex")
              : null,
            retryAfterSeconds: null,
          });
        } else {
          await this.completeFailure(
            organizationId,
            claim,
            result.code,
            result.retryable,
            result.uncertain,
            result.retryAfterSeconds,
          );
        }
      } catch {
        // The request may have reached the vendor. A lease expiry is manual-review work.
        await this.completeFailure(
          organizationId,
          claim,
          "send_uncertain",
          false,
          true,
          null,
        );
      }
    }
  }

  private async completeFailure(
    organizationId: string,
    claim: Extract<ChatDeliveryClaim, { outcome: "claimed" }>,
    code: string,
    retryable: boolean,
    uncertain: boolean,
    retryAfterSeconds: number | null,
  ): Promise<void> {
    await this.dependencies.queue.complete({
      organizationId,
      deliveryId: claim.deliveryId,
      workerId: this.dependencies.workerId,
      checkpointVersion: claim.checkpointVersion,
      status: uncertain
        ? "uncertain"
        : code === "authorization_changed"
          ? "cancelled"
          : retryable
            ? "failed"
            : "exhausted",
      safeErrorCode: /^[a-z_]{1,50}$/.test(code)
        ? code
        : "provider_unavailable",
      providerMessageIdHash: null,
      retryAfterSeconds: retryable && !uncertain ? retryAfterSeconds : null,
    });
  }
}
