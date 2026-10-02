import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";

import {
  MailService,
  RequiredMailDeliveryError,
  type MailDeliveryReceipt,
} from "../../mail/mail.service";
import {
  NotificationDispatchFailure,
  type NotificationDispatchWorkerDependencies,
  type NotificationPayload,
} from "./notification-dispatch-worker";

type DeliveryInput = Parameters<
  NotificationDispatchWorkerDependencies["delivery"]["send"]
>[0];

/** Uses reviewed source templates and discards raw SMTP response material. */
@Injectable()
export class MailNotificationDispatchDeliveryAdapter {
  constructor(private readonly mail: MailService) {}

  async send(input: DeliveryInput): Promise<{
    status: "provider_accepted";
    messageIdHash: string | null;
  }> {
    let receipt: MailDeliveryReceipt;
    try {
      receipt = await this.sendPayload(
        input.recipient.email,
        input.payload,
        input.idempotencyKey,
      );
    } catch (error) {
      if (error instanceof RequiredMailDeliveryError) {
        throw new NotificationDispatchFailure(error.code, true);
      }
      throw new NotificationDispatchFailure("provider_unavailable", true);
    }

    const intended = input.recipient.email.trim().toLowerCase();
    const accepted = receipt.acceptedRecipients.some(
      (email) => email.trim().toLowerCase() === intended,
    );
    const rejected = receipt.rejectedRecipients.some(
      (email) => email.trim().toLowerCase() === intended,
    );
    if (
      receipt.status !== "provider_accepted" ||
      receipt.deliveryConfirmed !== false ||
      !accepted ||
      rejected
    ) {
      throw new NotificationDispatchFailure("malformed_provider", false);
    }
    return {
      status: "provider_accepted",
      messageIdHash:
        receipt.providerMessageId && receipt.providerMessageId.length <= 512
          ? createHash("sha256").update(receipt.providerMessageId).digest("hex")
          : null,
    };
  }

  private sendPayload(
    to: string,
    payload: NotificationPayload,
    idempotencyKey: string,
  ): Promise<MailDeliveryReceipt> {
    switch (payload.kind) {
      case "finding_triage":
        return this.mail.sendVulnerabilityTriageAlert(
          to,
          {
            advisoryId: payload.advisoryId,
            severity: payload.severity,
            kind: payload.alertKind,
          },
          idempotencyKey,
        );
      case "evidence_quarantined":
        return this.mail.sendEvidenceQuarantinedAlert(to, idempotencyKey);
      case "evidence_integrity_failure":
        return this.mail.sendEvidenceIntegrityFailureAlert(to, idempotencyKey);
      case "evidence_validity":
        return this.mail.sendEvidenceValidityExpiryAlert(
          to,
          {
            title: payload.title,
            validUntil: payload.validUntil,
            thresholdDays: payload.thresholdDays,
            productId: payload.productId,
          },
          idempotencyKey,
        );
      case "supplier_owner":
        return this.mail.sendSupplierEvidenceReminderEscalation(
          to,
          { portalTitle: payload.portalTitle, dueAt: payload.dueAt },
          idempotencyKey,
        );
      case "digest":
        return this.mail.sendNotificationDigest(
          to,
          payload.items,
          idempotencyKey,
        );
    }
  }
}
