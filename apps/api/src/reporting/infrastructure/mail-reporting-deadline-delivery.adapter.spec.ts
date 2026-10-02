import { RequiredMailDeliveryError } from "../../mail/mail.service";
import { ReportingDeadlineMonitorFailure } from "../worker/reporting-deadline-monitor-worker";
import { MailReportingDeadlineDeliveryAdapter } from "./mail-reporting-deadline-delivery.adapter";

const input = {
  idempotencyKey: "reporting-deadline:44444444-4444-4444-8444-444444444444",
  recipient: {
    userId: "66666666-6666-4666-8666-666666666666",
    email: "alternate@cra.test",
  },
  alert: {
    obligationId: "22222222-2222-4222-8222-222222222222",
    stageKind: "early_warning" as const,
    thresholdPercent: 50 as const,
    dueAt: "2026-09-10T10:00:00Z",
    idempotencyKey: "reporting-deadline:44444444-4444-4444-8444-444444444444",
  },
};

describe("MailReportingDeadlineDeliveryAdapter", () => {
  it("returns provider acceptance without claiming inbox delivery", async () => {
    const sendReportingDeadlineAlert = jest.fn().mockResolvedValue({
      status: "provider_accepted",
      providerMessageId: "message-1",
      providerResponse: "queued",
      acceptedRecipients: ["alternate@cra.test"],
      rejectedRecipients: [],
      deliveryConfirmed: false,
    });
    const adapter = new MailReportingDeadlineDeliveryAdapter({
      sendReportingDeadlineAlert,
    } as never);

    await expect(adapter.deliver(input)).resolves.toEqual({
      status: "provider_accepted",
      deliveryConfirmed: false,
    });
    expect(sendReportingDeadlineAlert).toHaveBeenCalledWith(
      "alternate@cra.test",
      {
        obligationId: input.alert.obligationId,
        stage: "early_warning",
        thresholdPercent: 50,
        dueAt: input.alert.dueAt,
      },
      input.idempotencyKey,
    );
  });

  it.each([
    { acceptedRecipients: [], rejectedRecipients: ["alternate@cra.test"] },
    { acceptedRecipients: ["other@cra.test"], rejectedRecipients: [] },
    { status: "delivered", deliveryConfirmed: true },
  ])(
    "rejects a receipt that does not prove provider acceptance for the recipient",
    async (override) => {
      const adapter = new MailReportingDeadlineDeliveryAdapter({
        sendReportingDeadlineAlert: jest.fn().mockResolvedValue({
          status: "provider_accepted",
          acceptedRecipients: ["alternate@cra.test"],
          rejectedRecipients: [],
          deliveryConfirmed: false,
          ...override,
        }),
      } as never);

      await expect(adapter.deliver(input)).rejects.toMatchObject({
        code: "provider_receipt_invalid",
        retryable: false,
      });
    },
  );

  it("keeps required mail failures as safe retryable codes", async () => {
    const adapter = new MailReportingDeadlineDeliveryAdapter({
      sendReportingDeadlineAlert: jest
        .fn()
        .mockRejectedValue(
          new RequiredMailDeliveryError("provider_unavailable"),
        ),
    } as never);

    await expect(adapter.deliver(input)).rejects.toEqual(
      new ReportingDeadlineMonitorFailure("provider_unavailable", true),
    );
  });
});
