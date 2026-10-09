import { Injectable } from "@nestjs/common";

import {
  MailService,
  RequiredMailDeliveryError,
} from "../../mail/mail.service";
import type {
  EvidenceValidityAlertNotifier,
  EvidenceValidityAlertDeliveryClaim,
} from "../application/evidence-validity-alert.port";

/** The SQL claim has already rechecked membership and evidence permission. */
@Injectable()
export class MailEvidenceValidityAlertNotifierAdapter implements EvidenceValidityAlertNotifier {
  constructor(private readonly mail: MailService) {}

  async deliver(
    input: Extract<EvidenceValidityAlertDeliveryClaim, { outcome: "claimed" }>,
  ): Promise<"delivered" | "recipient_unavailable"> {
    try {
      await this.mail.sendEvidenceValidityExpiryAlert(
        input.email,
        {
          title: input.title,
          validUntil: input.validUntil,
          thresholdDays: input.thresholdDays,
          productId: input.productId,
        },
        input.outboxId,
      );
      return "delivered";
    } catch (error) {
      if (error instanceof RequiredMailDeliveryError) throw error;
      throw new Error("evidence validity alert notification unavailable");
    }
  }
}
