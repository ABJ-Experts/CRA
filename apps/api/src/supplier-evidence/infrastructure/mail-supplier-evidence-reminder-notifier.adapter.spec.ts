import { MailSupplierEvidenceReminderNotifierAdapter } from "./mail-supplier-evidence-reminder-notifier.adapter";
import { RequiredMailDeliveryError } from "../../mail/mail.service";

describe("MailSupplierEvidenceReminderNotifierAdapter", () => {
  const mail = {
    sendSupplierEvidenceReminder: jest.fn(),
    sendSupplierEvidenceReminderEscalation: jest.fn(),
  };

  beforeEach(() => jest.resetAllMocks());

  it("sends only supplier-safe portal content and the in-memory bearer", async () => {
    mail.sendSupplierEvidenceReminder.mockResolvedValue(undefined);
    const notifier = new MailSupplierEvidenceReminderNotifierAdapter(
      mail as never,
    );

    await expect(
      notifier.deliver({
        outcome: "prepared",
        organizationId: "00000000-0000-4000-8000-000000000001",
        deliveryId: "00000000-0000-4000-8000-000000000002",
        recipientKind: "supplier",
        email: "supplier@cra.test",
        requestTitle: "Evidence requested",
        instructions: "Please upload the signed certificate.",
        dueAt: "2026-10-18T00:00:00.000Z",
        rawToken: "opaque-bearer",
      }),
    ).resolves.toBe("delivered");

    expect(mail.sendSupplierEvidenceReminder).toHaveBeenCalledWith(
      "supplier@cra.test",
      {
        portalTitle: "Evidence requested",
        instructions: "Please upload the signed certificate.",
        dueAt: "2026-10-18T00:00:00.000Z",
      },
      "opaque-bearer",
      "00000000-0000-4000-8000-000000000002",
    );
    expect(mail.sendSupplierEvidenceReminderEscalation).not.toHaveBeenCalled();
  });

  it("sends owner escalation without a supplier bearer", async () => {
    mail.sendSupplierEvidenceReminderEscalation.mockResolvedValue(undefined);
    const notifier = new MailSupplierEvidenceReminderNotifierAdapter(
      mail as never,
    );

    await notifier.deliver({
      outcome: "prepared",
      organizationId: "00000000-0000-4000-8000-000000000001",
      deliveryId: "00000000-0000-4000-8000-000000000002",
      recipientKind: "owner",
      email: "owner@cra.test",
      requestTitle: "Evidence requested",
      dueAt: "2026-10-18T00:00:00.000Z",
    });

    expect(mail.sendSupplierEvidenceReminderEscalation).toHaveBeenCalledWith(
      "owner@cra.test",
      {
        portalTitle: "Evidence requested",
        dueAt: "2026-10-18T00:00:00.000Z",
      },
      "00000000-0000-4000-8000-000000000002",
    );
  });

  it("preserves required delivery failures for the durable queue", async () => {
    const failure = new RequiredMailDeliveryError("delivery_failed");
    mail.sendSupplierEvidenceReminder.mockRejectedValue(failure);
    const notifier = new MailSupplierEvidenceReminderNotifierAdapter(
      mail as never,
    );

    await expect(
      notifier.deliver({
        outcome: "prepared",
        organizationId: "00000000-0000-4000-8000-000000000001",
        deliveryId: "00000000-0000-4000-8000-000000000002",
        recipientKind: "supplier",
        email: "supplier@cra.test",
        requestTitle: "Evidence requested",
        instructions: null,
        dueAt: "2026-10-18T00:00:00.000Z",
        rawToken: "opaque-bearer",
      }),
    ).rejects.toBe(failure);
  });

  it("normalizes unexpected mail failures without leaking provider detail", async () => {
    mail.sendSupplierEvidenceReminderEscalation.mockRejectedValue(
      new Error("SMTP password rejected"),
    );
    const notifier = new MailSupplierEvidenceReminderNotifierAdapter(
      mail as never,
    );

    await expect(
      notifier.deliver({
        outcome: "prepared",
        organizationId: "00000000-0000-4000-8000-000000000001",
        deliveryId: "00000000-0000-4000-8000-000000000002",
        recipientKind: "owner",
        email: "owner@cra.test",
        requestTitle: "Evidence requested",
        dueAt: "2026-10-18T00:00:00.000Z",
      }),
    ).rejects.toThrow("supplier evidence reminder notification unavailable");
  });
});
