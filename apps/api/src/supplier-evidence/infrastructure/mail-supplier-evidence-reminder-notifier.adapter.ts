import { Injectable } from "@nestjs/common";

import {
  MailService,
  RequiredMailDeliveryError,
} from "../../mail/mail.service";
import type {
  PreparedSupplierEvidenceReminderDelivery,
  SupplierEvidenceReminderNotifier,
} from "../worker/supplier-evidence-reminder-worker.port";

type Notification = Parameters<SupplierEvidenceReminderNotifier["deliver"]>[0];

/** Sends only SQL-authorized, supplier-safe reminder data to the mail boundary. */
@Injectable()
export class MailSupplierEvidenceReminderNotifierAdapter implements SupplierEvidenceReminderNotifier {
  constructor(private readonly mail: MailService) {}

  async deliver(
    input: Notification,
  ): Promise<"delivered" | "recipient_unavailable"> {
    try {
      if (input.recipientKind === "supplier") {
        await this.mail.sendSupplierEvidenceReminder(
          input.email,
          {
            portalTitle: input.requestTitle,
            instructions: input.instructions,
            dueAt: input.dueAt,
          },
          input.rawToken,
          input.deliveryId,
        );
      } else {
        await this.mail.sendSupplierEvidenceReminderEscalation(
          input.email,
          { portalTitle: input.requestTitle, dueAt: input.dueAt },
          input.deliveryId,
        );
      }
      return "delivered";
    } catch (error) {
      if (error instanceof RequiredMailDeliveryError) throw error;
      throw new Error("supplier evidence reminder notification unavailable");
    }
  }
}

export type SupplierEvidenceReminderPreparedDelivery = Extract<
  PreparedSupplierEvidenceReminderDelivery,
  { outcome: "prepared" }
>;
