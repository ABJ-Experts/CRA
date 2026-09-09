import { Injectable } from "@nestjs/common";

import {
  MailService,
  RequiredMailDeliveryError,
} from "../../mail/mail.service";
import {
  ReportingDeadlineMonitorFailure,
  type ReportingDeadlineDeliveryPort,
} from "../worker/reporting-deadline-monitor-worker";

/** Required-delivery adapter for the reporting deadline durable outbox. */
@Injectable()
export class MailReportingDeadlineDeliveryAdapter implements ReportingDeadlineDeliveryPort {
  constructor(private readonly mail: MailService) {}

  async deliver(
    input: Parameters<ReportingDeadlineDeliveryPort["deliver"]>[0],
  ): Promise<void> {
    try {
      await this.mail.sendReportingDeadlineAlert(
        input.recipient.email,
        {
          obligationId: input.alert.obligationId,
          stage: input.alert.stageKind,
          thresholdPercent: input.alert.thresholdPercent,
          dueAt: input.alert.dueAt,
        },
        input.idempotencyKey,
      );
    } catch (error) {
      if (error instanceof RequiredMailDeliveryError) {
        throw new ReportingDeadlineMonitorFailure(error.code, true);
      }
      throw new ReportingDeadlineMonitorFailure("provider_unavailable", true);
    }
  }
}
