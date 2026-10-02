import { createHash } from "node:crypto";

import { RequiredMailDeliveryError } from "../../mail/mail.service";
import { MailNotificationDispatchDeliveryAdapter } from "./mail-notification-dispatch-delivery.adapter";
import { NotificationDispatchFailure } from "./notification-dispatch-worker";

const organizationId = "11111111-1111-4111-8111-111111111111";
const dispatchId = "22222222-2222-4222-8222-222222222222";
const recipient = {
  userId: "33333333-3333-4333-8333-333333333333",
  email: "owner@cra.test",
};
const receipt = {
  status: "provider_accepted" as const,
  providerMessageId: "<message@relay.test>",
  acceptedRecipients: [recipient.email],
  rejectedRecipients: [],
  deliveryConfirmed: false as const,
};
type DeliveryInput = Parameters<
  MailNotificationDispatchDeliveryAdapter["send"]
>[0];
const input = (payload: DeliveryInput["payload"]): DeliveryInput => ({
  organizationId,
  dispatchId,
  recipient,
  idempotencyKey: "notification:fixture:1",
  payload,
});

describe("MailNotificationDispatchDeliveryAdapter", () => {
  it("uses the existing triage template and stores only a message-id hash", async () => {
    const sendVulnerabilityTriageAlert = jest.fn().mockResolvedValue(receipt);
    const adapter = new MailNotificationDispatchDeliveryAdapter({
      sendVulnerabilityTriageAlert,
    } as never);

    await expect(
      adapter.send({
        organizationId,
        dispatchId,
        recipient,
        idempotencyKey: "notification:triage:1",
        payload: {
          kind: "finding_triage",
          advisoryId: "CVE-2026-1234",
          severity: "high",
          alertKind: "internal_sla_breached",
        },
      }),
    ).resolves.toEqual({
      status: "provider_accepted",
      messageIdHash: createHash("sha256")
        .update("<message@relay.test>")
        .digest("hex"),
    });
    expect(sendVulnerabilityTriageAlert).toHaveBeenCalledWith(
      recipient.email,
      {
        advisoryId: "CVE-2026-1234",
        severity: "high",
        kind: "internal_sla_breached",
      },
      "notification:triage:1",
    );
  });

  it("sends a frozen bounded digest through the required mail path", async () => {
    const sendNotificationDigest = jest.fn().mockResolvedValue(receipt);
    const adapter = new MailNotificationDispatchDeliveryAdapter({
      sendNotificationDigest,
    } as never);
    const items = [
      {
        title: "Review finding",
        href: "/findings?findingId=123",
        date: "2026-10-01",
        category: "Finding triage",
      },
    ];

    await adapter.send({
      organizationId,
      dispatchId,
      recipient,
      idempotencyKey: "notification:digest:1",
      payload: { kind: "digest", items },
    });

    expect(sendNotificationDigest).toHaveBeenCalledWith(
      recipient.email,
      items,
      "notification:digest:1",
    );
  });

  it("rejects any claimed inbox-delivered receipt or wrong recipient", async () => {
    const sendEvidenceQuarantinedAlert = jest.fn().mockResolvedValue({
      ...receipt,
      deliveryConfirmed: true,
      acceptedRecipients: ["other@cra.test"],
    });
    const adapter = new MailNotificationDispatchDeliveryAdapter({
      sendEvidenceQuarantinedAlert,
    } as never);

    await expect(
      adapter.send({
        organizationId,
        dispatchId,
        recipient,
        idempotencyKey: "notification:evidence:1",
        payload: { kind: "evidence_quarantined" },
      }),
    ).rejects.toThrow("malformed_provider");
  });

  it.each([
    [
      "sendEvidenceIntegrityFailureAlert",
      { kind: "evidence_integrity_failure" },
      [recipient.email, "notification:fixture:1"],
    ],
    [
      "sendEvidenceValidityExpiryAlert",
      {
        kind: "evidence_validity",
        title: "Evidence",
        validUntil: "2026-10-03",
        thresholdDays: 7,
        productId: null,
      },
      [
        recipient.email,
        {
          title: "Evidence",
          validUntil: "2026-10-03",
          thresholdDays: 7,
          productId: null,
        },
        "notification:fixture:1",
      ],
    ],
    [
      "sendSupplierEvidenceReminderEscalation",
      { kind: "supplier_owner", portalTitle: "Portal", dueAt: "2026-10-03" },
      [
        recipient.email,
        { portalTitle: "Portal", dueAt: "2026-10-03" },
        "notification:fixture:1",
      ],
    ],
  ] as const)(
    "routes %s through the reviewed template",
    async (method, payload, args) => {
      const send = jest.fn().mockResolvedValue(receipt);
      const adapter = new MailNotificationDispatchDeliveryAdapter({
        [method]: send,
      } as never);

      await expect(adapter.send(input(payload))).resolves.toMatchObject({
        status: "provider_accepted",
      });
      expect(send).toHaveBeenCalledWith(...args);
    },
  );

  it.each([
    { acceptedRecipients: ["other@cra.test"] },
    { rejectedRecipients: [recipient.email] },
    { status: "delivered" },
  ])("rejects a contradictory SMTP receipt: %j", async (override) => {
    const sendEvidenceQuarantinedAlert = jest
      .fn()
      .mockResolvedValue({ ...receipt, ...override });
    const adapter = new MailNotificationDispatchDeliveryAdapter({
      sendEvidenceQuarantinedAlert,
    } as never);

    await expect(
      adapter.send(input({ kind: "evidence_quarantined" })),
    ).rejects.toMatchObject({
      code: "malformed_provider",
      retryable: false,
    });
  });

  it.each([
    [new RequiredMailDeliveryError("delivery_failed"), "delivery_failed"],
    [new Error("smtp secret should not escape"), "provider_unavailable"],
  ])(
    "maps required-mail errors to a safe retryable code",
    async (failure, code) => {
      const sendEvidenceQuarantinedAlert = jest.fn().mockRejectedValue(failure);
      const adapter = new MailNotificationDispatchDeliveryAdapter({
        sendEvidenceQuarantinedAlert,
      } as never);

      await expect(
        adapter.send(input({ kind: "evidence_quarantined" })),
      ).rejects.toMatchObject({
        code,
        retryable: true,
      } satisfies Partial<NotificationDispatchFailure>);
    },
  );

  it.each([null, "x".repeat(513)])(
    "discards absent or oversized SMTP message identity",
    async (providerMessageId) => {
      const sendEvidenceQuarantinedAlert = jest.fn().mockResolvedValue({
        ...receipt,
        providerMessageId,
        acceptedRecipients: [" OWNER@CRA.TEST "],
      });
      const adapter = new MailNotificationDispatchDeliveryAdapter({
        sendEvidenceQuarantinedAlert,
      } as never);

      await expect(
        adapter.send(input({ kind: "evidence_quarantined" })),
      ).resolves.toEqual({
        status: "provider_accepted",
        messageIdHash: null,
      });
    },
  );
});
