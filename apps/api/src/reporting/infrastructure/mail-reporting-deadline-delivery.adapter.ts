import { Injectable } from "@nestjs/common";
import { z } from "zod";

import {
  MailService,
  RequiredMailDeliveryError,
} from "../../mail/mail.service";
import {
  ReportingDeadlineMonitorFailure,
  type ReportingDeadlineDeliveryPort,
  type ReportingDeadlineProviderAcceptance,
} from "../worker/reporting-deadline-monitor-worker";

/** Required-delivery adapter for the reporting deadline durable outbox. */
const providerAcceptanceSchema = z.object({
  status: z.literal("provider_accepted"),
  deliveryConfirmed: z.literal(false),
  acceptedRecipients: z.array(z.string().email()).length(1),
  rejectedRecipients: z.array(z.string()).length(0),
});

@Injectable()
export class MailReportingDeadlineDeliveryAdapter implements ReportingDeadlineDeliveryPort {
  constructor(private readonly mail: MailService) {}

  async deliver(
    input: Parameters<ReportingDeadlineDeliveryPort["deliver"]>[0],
  ): Promise<ReportingDeadlineProviderAcceptance> {
    try {
      const receipt = await this.mail.sendReportingDeadlineAlert(
        input.recipient.email,
        {
          obligationId: input.alert.obligationId,
          stage: input.alert.stageKind,
          thresholdPercent: input.alert.thresholdPercent,
          dueAt: input.alert.dueAt,
        },
        input.idempotencyKey,
      );
      const accepted = providerAcceptanceSchema.safeParse(receipt);
      if (
        !accepted.success ||
        accepted.data.acceptedRecipients[0]?.trim().toLowerCase() !==
          input.recipient.email.trim().toLowerCase()
      ) {
        throw new ReportingDeadlineMonitorFailure(
          "provider_receipt_invalid",
          false,
        );
      }
      return Object.freeze({
        status: "provider_accepted" as const,
        deliveryConfirmed: false as const,
      });
    } catch (error) {
      if (error instanceof ReportingDeadlineMonitorFailure) throw error;
      if (error instanceof RequiredMailDeliveryError) {
        throw new ReportingDeadlineMonitorFailure(error.code, true);
      }
      throw new ReportingDeadlineMonitorFailure("provider_unavailable", true);
    }
  }
}
