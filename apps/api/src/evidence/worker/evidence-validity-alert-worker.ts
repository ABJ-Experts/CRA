import { Logger } from "@nestjs/common";
import { z } from "zod";

import type {
  EvidenceValidityAlertNotifier,
  EvidenceValidityAlertQueue,
} from "../application/evidence-validity-alert.port";

const maximumClaimsPerOrganizationPerCycle = 1_000;

/** Delivers database-deduplicated validity alerts after reconciling catch-up work. */
export class EvidenceValidityAlertWorker {
  private readonly logger = new Logger(EvidenceValidityAlertWorker.name);

  constructor(
    private readonly dependencies: Readonly<{
      workerId: string;
      leaseSeconds: number;
      queue: EvidenceValidityAlertQueue;
      notifier: EvidenceValidityAlertNotifier;
    }>,
  ) {
    if (
      !z.uuid().safeParse(dependencies.workerId).success ||
      !Number.isInteger(dependencies.leaseSeconds) ||
      dependencies.leaseSeconds < 15 ||
      dependencies.leaseSeconds > 900
    ) {
      throw new Error("invalid evidence validity alert worker configuration");
    }
  }

  async runOnce(): Promise<void> {
    let afterOrganizationId: string | null = null;
    do {
      const page =
        await this.dependencies.queue.dueOrganizationIds(afterOrganizationId);
      for (const organizationId of [...new Set(page.organizationIds)]) {
        await this.dependencies.queue.reconcile(organizationId, {
          workerId: this.dependencies.workerId,
        });
        for (
          let count = 0;
          count < maximumClaimsPerOrganizationPerCycle;
          count += 1
        ) {
          const claim = await this.dependencies.queue.claimDelivery(
            organizationId,
            {
              workerId: this.dependencies.workerId,
              leaseSeconds: this.dependencies.leaseSeconds,
            },
          );
          if (claim.outcome !== "claimed") break;
          try {
            const outcome = await this.dependencies.notifier.deliver(claim);
            await this.dependencies.queue.complete(claim.organizationId, {
              outboxId: claim.outboxId,
              workerId: this.dependencies.workerId,
              outcome:
                outcome === "delivered" ? "sent" : "recipient_unavailable",
              error:
                outcome === "delivered"
                  ? null
                  : "No eligible evidence validity alert recipient is available.",
            });
          } catch {
            try {
              await this.dependencies.queue.complete(claim.organizationId, {
                outboxId: claim.outboxId,
                workerId: this.dependencies.workerId,
                outcome: "retry",
                error:
                  "Evidence validity alert notification could not be delivered.",
              });
            } catch {
              this.logger.error(
                "Evidence validity alert failure could not be recorded",
              );
            }
          }
        }
      }
      afterOrganizationId = page.nextOrganizationId;
    } while (afterOrganizationId);
  }
}
