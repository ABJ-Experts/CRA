import { Logger } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

import type {
  SupplierEvidenceReminderNotifier,
  SupplierEvidenceReminderQueue,
} from "./supplier-evidence-reminder-worker.port";

const maximumClaimsPerOrganizationPerCycle = 1_000;

/** Delivers database-deduplicated supplier reminders and owner escalations. */
export class SupplierEvidenceReminderWorker {
  private readonly logger = new Logger(SupplierEvidenceReminderWorker.name);

  constructor(
    private readonly dependencies: Readonly<{
      workerId: string;
      leaseSeconds: number;
      queue: SupplierEvidenceReminderQueue;
      notifier: SupplierEvidenceReminderNotifier;
      createBearer?: () => string;
    }>,
  ) {
    if (
      !z.uuid().safeParse(dependencies.workerId).success ||
      !Number.isInteger(dependencies.leaseSeconds) ||
      dependencies.leaseSeconds < 15 ||
      dependencies.leaseSeconds > 900
    ) {
      throw new Error(
        "invalid supplier evidence reminder worker configuration",
      );
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
            const rawToken =
              claim.eventKind === "supplier_reminder"
                ? this.createBearer()
                : null;
            const prepared = await this.dependencies.queue.prepareDelivery(
              claim,
              {
                workerId: this.dependencies.workerId,
                tokenHash: rawToken
                  ? createHash("sha256").update(rawToken).digest("hex")
                  : null,
              },
            );
            if (prepared.outcome === "obsolete") {
              continue;
            }
            const outcome =
              prepared.recipientKind === "supplier"
                ? await this.deliverSupplierReminder(prepared, rawToken)
                : await this.dependencies.notifier.deliver(prepared);
            await this.complete(
              claim.organizationId,
              claim.deliveryId,
              outcome === "delivered" ? "sent" : "recipient_unavailable",
              outcome === "delivered"
                ? null
                : "No eligible supplier evidence reminder recipient is available.",
            );
          } catch {
            try {
              await this.complete(
                claim.organizationId,
                claim.deliveryId,
                "retry",
                "Supplier evidence reminder notification could not be delivered.",
              );
            } catch {
              this.logger.error(
                "Supplier evidence reminder failure could not be recorded",
              );
            }
          }
        }
      }
      afterOrganizationId = page.nextOrganizationId;
    } while (afterOrganizationId);
  }

  private createBearer(): string {
    return (
      this.dependencies.createBearer?.() ??
      randomBytes(32).toString("base64url")
    );
  }

  private complete(
    organizationId: string,
    deliveryId: string,
    outcome: "sent" | "retry" | "recipient_unavailable",
    error: string | null,
  ): Promise<void> {
    return this.dependencies.queue.complete(organizationId, {
      deliveryId,
      workerId: this.dependencies.workerId,
      outcome,
      error,
    });
  }

  private deliverSupplierReminder(
    input: Extract<
      Awaited<ReturnType<SupplierEvidenceReminderQueue["prepareDelivery"]>>,
      { outcome: "prepared"; recipientKind: "supplier" }
    >,
    rawToken: string | null,
  ): ReturnType<SupplierEvidenceReminderNotifier["deliver"]> {
    if (!rawToken)
      throw new Error("supplier reminder claim changed recipient kind");
    return this.dependencies.notifier.deliver({ ...input, rawToken });
  }
}
