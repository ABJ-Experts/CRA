import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createTransport } from "nodemailer";

import {
  MailService,
  RequiredMailDeliveryError,
  UncertainMailDeliveryError,
} from "./mail.service";

interface SentMessage {
  from: string;
  to: string;
  subject: string;
  html: string;
  messageId?: string;
  headers?: Readonly<Record<string, string>>;
}

type TransportWithTls = Readonly<{ tls?: Readonly<{ ca?: unknown }> }>;

const mockSendMail = jest.fn<Promise<unknown>, [SentMessage]>();

jest.mock("nodemailer", () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}));

const mockedCreateTransport = createTransport as jest.MockedFunction<
  typeof createTransport
>;

function config(values: Record<string, unknown>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
    getOrThrow: jest.fn((key: string) => {
      if (values[key] === undefined) throw new Error(`Missing ${key}`);
      return values[key];
    }),
  } as unknown as ConfigService;
}

function enabledConfig(overrides: Record<string, unknown> = {}): ConfigService {
  return config({
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: 54325,
    SMTP_FROM: "CRA <no-reply@cra.test>",
    APP_URL: "https://cra.test///",
    ...overrides,
  });
}

describe("MailService", () => {
  let loggerLog: jest.SpyInstance;
  let loggerWarn: jest.SpyInstance;
  let loggerError: jest.SpyInstance;

  beforeEach(() => {
    mockSendMail.mockReset().mockImplementation((message) =>
      Promise.resolve({
        messageId: "mail-1",
        accepted: [message.to],
        rejected: [],
        response: "250 queued as mail-1",
      }),
    );
    mockedCreateTransport.mockClear();
    loggerLog = jest.spyOn(Logger.prototype, "log").mockImplementation();
    loggerWarn = jest.spyOn(Logger.prototype, "warn").mockImplementation();
    loggerError = jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("suppresses delivery when SMTP is disabled", async () => {
    const service = new MailService(
      config({
        SMTP_FROM: "CRA <no-reply@cra.test>",
        APP_URL: "https://cra.test",
      }),
    );

    await service.sendVerificationCode("member@cra.test", "123456");

    expect(mockedCreateTransport).not.toHaveBeenCalled();
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(loggerWarn).toHaveBeenNthCalledWith(
      1,
      "SMTP_HOST is not set — email is disabled.",
    );
    expect(loggerWarn).toHaveBeenNthCalledWith(2, "Mail delivery suppressed");
    expect(loggerWarn).not.toHaveBeenCalledWith(
      expect.stringContaining("Your CRA verification code"),
    );
  });

  it("creates a Mailpit-compatible unauthenticated transport", () => {
    new MailService(enabledConfig({ SMTP_PORT: undefined }));

    expect(mockedCreateTransport).toHaveBeenCalledWith({
      host: "127.0.0.1",
      port: 587,
      secure: false,
      requireTLS: false,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
      tls: { rejectUnauthorized: false },
    });
    expect(loggerLog).toHaveBeenCalledWith(
      "Mail transport ready: 127.0.0.1:587 tls=mailpit",
    );
  });

  it("validates production relay TLS and loads an explicit customer CA", () => {
    new MailService(
      enabledConfig({
        SMTP_HOST: "10.0.0.5",
        SMTP_PORT: 587,
        SMTP_USER: "relay-user",
        SMTP_PASS: "relay-secret",
        SMTP_TLS_MODE: "starttls",
        SMTP_TLS_SERVERNAME: "smtp.customer.test",
        SMTP_CA_CERT_PATH: "package.json",
        SMTP_CONNECTION_TIMEOUT_MS: 7000,
        SMTP_GREETING_TIMEOUT_MS: 8000,
        SMTP_SOCKET_TIMEOUT_MS: 9000,
      }),
    );

    const transportOptions = mockedCreateTransport.mock.calls[0]?.[0] as
      TransportWithTls | undefined;
    expect(transportOptions).toMatchObject({
      host: "10.0.0.5",
      port: 587,
      secure: false,
      requireTLS: true,
      connectionTimeout: 7000,
      greetingTimeout: 8000,
      socketTimeout: 9000,
      auth: { user: "relay-user", pass: "relay-secret" },
      tls: {
        rejectUnauthorized: true,
        servername: "smtp.customer.test",
      },
    });
    expect(String(transportOptions?.tls?.ca)).toContain('"name": "api"');
    expect(loggerLog).toHaveBeenCalledWith(
      "Mail transport ready: 10.0.0.5:587 tls=starttls",
    );
    expect(loggerLog).not.toHaveBeenCalledWith(
      expect.stringContaining("relay-secret"),
    );
  });

  it("adds authentication only when both credentials are present", () => {
    new MailService(
      enabledConfig({ SMTP_USER: "mailer", SMTP_PASS: "secret" }),
    );

    expect(mockedCreateTransport).toHaveBeenCalledWith({
      host: "127.0.0.1",
      port: 54325,
      secure: false,
      requireTLS: false,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
      auth: { user: "mailer", pass: "secret" },
      tls: { rejectUnauthorized: false },
    });

    mockedCreateTransport.mockClear();
    new MailService(enabledConfig({ SMTP_USER: "mailer" }));
    expect(mockedCreateTransport.mock.calls[0]?.[0]).not.toHaveProperty("auth");
  });

  it("sends a verification code in the standard layout", async () => {
    const service = new MailService(enabledConfig());

    await service.sendVerificationCode("member@cra.test", "654321");

    const message = mockSendMail.mock.calls[0]?.[0];
    expect(message).toMatchObject({
      from: "CRA <no-reply@cra.test>",
      to: "member@cra.test",
      subject: "Your CRA verification code",
    });
    expect(message?.html).toContain("654321");
    expect(message?.html).toContain("Confirm your email");
    expect(message?.html).toContain("If you did not expect this email");
    expect(loggerLog).toHaveBeenCalledWith("Mail delivery accepted");
    expect(loggerLog).not.toHaveBeenCalledWith(
      expect.stringContaining("Your CRA verification code"),
    );
  });

  it("normalizes the app URL and safely encodes password reset tokens", async () => {
    const service = new MailService(enabledConfig());

    await service.sendPasswordReset("member@cra.test", "a/b?c=d e");

    const message = mockSendMail.mock.calls[0]?.[0];
    expect(message?.subject).toBe("Reset your CRA password");
    expect(message?.html).toContain(
      "https://cra.test/reset-password?token=a%2Fb%3Fc%3Dd%20e",
    );
    expect(message?.html).not.toContain("https://cra.test///reset-password");
  });

  it("delivers the supplier portal bearer only in a URL fragment", async () => {
    const service = new MailService(enabledConfig());

    await service.sendSupplierEvidenceInvitation(
      "supplier@example.test",
      "token/with spaces",
      "11111111-1111-4111-8111-111111111111",
    );

    const message = mockSendMail.mock.calls[0]?.[0];
    expect(message).toMatchObject({
      to: "supplier@example.test",
      subject: "Supplier evidence request",
    });
    expect(message?.html).toContain(
      "https://cra.test/supplier-evidence#token%2Fwith%20spaces",
    );
    expect(message?.html).not.toContain("?token=");
  });

  it("sends a supplier-safe reminder with a replacement portal bearer", async () => {
    const service = new MailService(enabledConfig());

    await service.sendSupplierEvidenceReminder(
      "supplier@example.test",
      {
        portalTitle: "Security evidence update",
        instructions: "Please provide the requested documents.",
        dueAt: "2026-10-01T09:00:00.000Z",
      },
      "replacement/token",
      "11111111-1111-4111-8111-111111111111",
    );

    const message = mockSendMail.mock.calls[0]?.[0];
    expect(message).toMatchObject({
      to: "supplier@example.test",
      subject: "Reminder: supplier evidence request",
    });
    expect(message?.html).toContain("Security evidence update");
    expect(message?.html).toContain("Please provide the requested documents.");
    expect(message?.html).toContain(
      "https://cra.test/supplier-evidence#replacement%2Ftoken",
    );
    expect(message?.html).not.toContain("?token=");
  });

  it("sends owner escalation without supplier portal credentials", async () => {
    const service = new MailService(enabledConfig());

    await service.sendSupplierEvidenceReminderEscalation(
      "owner@cra.test",
      {
        portalTitle: "Security evidence update",
        dueAt: "2026-10-01T09:00:00.000Z",
      },
      "22222222-2222-4222-8222-222222222222",
    );

    const message = mockSendMail.mock.calls[0]?.[0];
    expect(message).toMatchObject({
      to: "owner@cra.test",
      subject: "Overdue supplier evidence escalation",
    });
    expect(message?.html).toContain("Security evidence update");
    expect(message?.html).not.toContain("supplier-evidence#");
  });

  it.each([
    ["Grace", "Grace has invited"],
    [null, "You have been invited"],
  ])(
    "renders invitation copy for inviter %p",
    async (inviter, expectedCopy) => {
      const service = new MailService(enabledConfig());

      await service.sendInvitation(
        "member@cra.test",
        "token/with spaces",
        "Example Org",
        inviter,
      );

      const message = mockSendMail.mock.calls[0]?.[0];
      expect(message?.subject).toBe(
        "You have been invited to Example Org on CRA",
      );
      expect(message?.html).toContain(expectedCopy);
      expect(message?.html).toContain(
        "https://cra.test/accept-invitation?token=token%2Fwith%20spaces",
      );
    },
  );

  it.each([
    [new Error("connection refused"), "connection refused"],
    ["connection refused", "connection refused"],
  ])(
    "logs delivery failures without failing the request",
    async (failure, detail) => {
      mockSendMail.mockRejectedValueOnce(failure);
      const service = new MailService(enabledConfig());

      await expect(
        service.sendVerificationCode("member@cra.test", "123456"),
      ).resolves.toBeUndefined();
      expect(loggerError).toHaveBeenCalledWith("Mail delivery failed");
      expect(loggerError).not.toHaveBeenCalledWith(
        expect.stringContaining("Your CRA verification code"),
      );
      expect(loggerError).not.toHaveBeenCalledWith(
        expect.stringContaining(detail),
      );
    },
  );

  it("reports a required support alert delivery failure to its outbox owner", async () => {
    mockSendMail.mockRejectedValueOnce(new Error("connection refused"));
    const service = new MailService(enabledConfig());

    await expect(
      service.sendSupportPeriodAlert(
        "owner@cra.test",
        {
          productName: "Product <one>",
          supportEndsAt: "2036-02-28T00:00:00.000Z",
          thresholdDays: 30,
          missed: false,
        },
        "support-period:revision-1:30",
      ),
    ).rejects.toEqual(new RequiredMailDeliveryError("delivery_failed"));
    expect(mockSendMail.mock.calls[0]?.[0]?.html).toContain(
      "Product &lt;one&gt;",
    );
  });

  it("keeps configured relay credentials out of provider diagnostics", async () => {
    mockSendMail.mockRejectedValueOnce(
      new Error("Invalid login for relay-user using relay-secret"),
    );
    const service = new MailService(
      enabledConfig({
        SMTP_USER: "relay-user",
        SMTP_PASS: "relay-secret",
      }),
    );

    await expect(
      service.sendSupportPeriodAlert(
        "owner@cra.test",
        {
          productName: "Product one",
          supportEndsAt: "2036-02-28T00:00:00.000Z",
          thresholdDays: 30,
          missed: false,
        },
        "support-period:revision-1:30",
      ),
    ).rejects.toEqual(new RequiredMailDeliveryError("delivery_failed"));

    const loggerCalls = loggerError.mock.calls as unknown[][];
    const diagnostic = String(loggerCalls[0]?.[0]);
    expect(diagnostic).toBe("Mail delivery failed");
    expect(diagnostic).not.toContain("relay-secret");
    expect(diagnostic).not.toContain("relay-user");
  });

  it("does not log required-mail subjects or raw provider errors", async () => {
    mockSendMail.mockRejectedValueOnce(
      new Error("550 token=secret-token body=raw recipient=owner@cra.test"),
    );
    const service = new MailService(enabledConfig());

    await expect(
      service.sendSupportPeriodAlert(
        "owner@cra.test",
        {
          productName: "Sensitive Product",
          supportEndsAt: "2036-02-28T00:00:00.000Z",
          thresholdDays: 30,
          missed: false,
        },
        "support-period:revision-1:30",
      ),
    ).rejects.toEqual(new RequiredMailDeliveryError("delivery_failed"));

    const diagnostic = String((loggerError.mock.calls as unknown[][])[0]?.[0]);
    expect(diagnostic).toBe("Mail delivery failed");
    expect(diagnostic).not.toContain("Sensitive Product");
    expect(diagnostic).not.toContain("secret-token");
    expect(diagnostic).not.toContain("owner@cra.test");
  });

  it("reports a disabled required support alert delivery to its outbox owner", async () => {
    const service = new MailService(
      config({
        SMTP_FROM: "CRA <no-reply@cra.test>",
        APP_URL: "https://cra.test",
      }),
    );

    await expect(
      service.sendSupportPeriodAlert(
        "owner@cra.test",
        {
          productName: "Product one",
          supportEndsAt: "2036-02-28T00:00:00.000Z",
          thresholdDays: 30,
          missed: false,
        },
        "support-period:revision-1:30",
      ),
    ).rejects.toEqual(new RequiredMailDeliveryError("provider_unavailable"));
  });

  it("uses a stable provider idempotency message identifier for support alerts", async () => {
    const service = new MailService(enabledConfig());

    const receipt = await service.sendSupportPeriodAlert(
      "owner@cra.test",
      {
        productName: "Product one",
        supportEndsAt: "2036-02-28T00:00:00.000Z",
        thresholdDays: 30,
        missed: false,
      },
      "support-period:revision-1:30",
    );

    const mail = mockSendMail.mock.calls[0]?.[0] as
      | Readonly<{
          messageId?: unknown;
          headers?: Readonly<Record<string, unknown>>;
        }>
      | undefined;
    expect(mail?.messageId).toMatch(
      /^<support-period-[a-f0-9]{64}@cra\.local>$/,
    );
    expect(mail?.headers?.["X-CRA-Idempotency-Key"]).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt).toEqual({
      status: "provider_accepted",
      providerMessageId: "mail-1",
      acceptedRecipients: ["owner@cra.test"],
      rejectedRecipients: [],
      deliveryConfirmed: false,
    });
  });

  it("rejects required mail when SMTP resolves without accepting the intended recipient", async () => {
    mockSendMail.mockResolvedValueOnce({
      messageId: "mail-2",
      accepted: [],
      rejected: ["owner@cra.test"],
      response: "550 rejected raw detail",
    });
    const service = new MailService(enabledConfig());

    await expect(
      service.sendSupportPeriodAlert(
        "owner@cra.test",
        {
          productName: "Product one",
          supportEndsAt: "2036-02-28T00:00:00.000Z",
          thresholdDays: 30,
          missed: false,
        },
        "support-period:revision-1:30",
      ),
    ).rejects.toEqual(new RequiredMailDeliveryError("delivery_failed"));
    expect(loggerError).toHaveBeenCalledWith("Mail delivery failed");
    expect(loggerError).not.toHaveBeenCalledWith(
      expect.stringContaining("550 rejected raw detail"),
    );
  });

  it("keeps optional account mail non-failing when SMTP rejects the recipient", async () => {
    mockSendMail.mockResolvedValueOnce({
      messageId: "mail-2",
      accepted: ["other@cra.test"],
      rejected: ["member@cra.test"],
      response: "550 private provider detail",
    });
    const service = new MailService(enabledConfig());

    await expect(
      service.sendVerificationCode("member@cra.test", "123456"),
    ).resolves.toBeUndefined();
    expect(loggerError).toHaveBeenCalledWith("Mail delivery failed");
    expect(loggerError).not.toHaveBeenCalledWith(
      expect.stringContaining("550 private provider detail"),
    );
  });

  it("requires every intended recipient to be accepted and none rejected", async () => {
    mockSendMail.mockResolvedValueOnce({
      messageId: "mail-2",
      accepted: [" OWNER@CRA.TEST ", "admin@cra.test"],
      rejected: ["admin@cra.test"],
    });
    const service = new MailService(enabledConfig());

    await expect(
      service.sendEvidenceQuarantinedAlert(
        "owner@cra.test, admin@cra.test",
        "evidence:quarantine:1",
      ),
    ).rejects.toEqual(new RequiredMailDeliveryError("delivery_failed"));
  });

  it.each([
    ["11111111-1111-4111-8111-111111111111", true],
    [null, false],
  ])(
    "renders an evidence library link only when product scope exists",
    async (productId, hasLink) => {
      const service = new MailService(enabledConfig());

      const result = await service.sendEvidenceValidityExpiryAlert(
        "owner@cra.test",
        {
          title: "Proof <one>\r\nBcc: somebody@cra.test",
          validUntil: "2026-10-20T00:00:00Z",
          thresholdDays: 7,
          productId,
        },
        "evidence:validity:1",
      );

      const message = mockSendMail.mock.calls[0]?.[0];
      expect(message?.subject).toBe(
        "Evidence validity alert: Proof <one> Bcc: somebody@cra.test",
      );
      expect(message?.html).toContain("Proof &lt;one&gt;");
      expect(message?.html.includes("Open Evidence Library in CRA")).toBe(
        hasLink,
      );
      expect(
        message?.html.includes(
          "/products/11111111-1111-4111-8111-111111111111/evidence",
        ),
      ).toBe(hasLink);
      expect(result.status).toBe("provider_accepted");
    },
  );

  it("sends a bounded required digest with safe source links", async () => {
    const service = new MailService(enabledConfig());

    const receipt = await service.sendNotificationDigest(
      "owner@cra.test",
      [
        {
          title: "Review report <draft>",
          href: "/reporting?obligationId=11111111-1111-4111-8111-111111111111",
          date: "2026-10-01T09:00:00.000Z",
          category: "Reporting",
        },
      ],
      "digest:owner:2026-10-01",
    );

    const message = mockSendMail.mock.calls[0]?.[0];
    expect(message?.subject).toBe("CRA notification digest (1)");
    expect(message?.html).toContain("Review report &lt;draft&gt;");
    expect(message?.html).toContain(
      "https://cra.test/reporting?obligationId=11111111-1111-4111-8111-111111111111",
    );
    expect(receipt.status).toBe("provider_accepted");
    expect(receipt.deliveryConfirmed).toBe(false);
  });

  it("rejects oversized digests before sending", async () => {
    const service = new MailService(enabledConfig());

    await expect(
      service.sendNotificationDigest(
        "owner@cra.test",
        Array.from({ length: 101 }, (_, index) => ({
          title: `Task ${index}`,
          href: "/tasks",
          date: "2026-10-01T09:00:00.000Z",
          category: "Tasks",
        })),
        "digest:oversized",
      ),
    ).rejects.toEqual(new RequiredMailDeliveryError("delivery_failed"));
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("sends a bounded burst with an exact filtered inbox link and explicit preview count", async () => {
    const service = new MailService(enabledConfig());
    const batchId = "11111111-1111-4111-8111-111111111111";

    const receipt = await service.sendNotificationBurst(
      "owner@cra.test",
      {
        count: 7,
        href: `/notifications?batchId=${batchId}`,
        items: [
          {
            title: "Finding <update>",
            href: "/findings",
            date: "2026-10-05",
            category: "finding_triage",
          },
        ],
      },
      `notification-burst:${batchId}`,
    );

    const message = mockSendMail.mock.calls[0]?.[0];
    expect(message?.subject).toBe("CRA notification updates (7)");
    expect(message?.html).toContain("Finding &lt;update&gt;");
    expect(message?.html).toContain("Showing 1 of 7 updates");
    expect(message?.html).toContain(
      `https://cra.test/notifications?batchId=${batchId}`,
    );
    expect(receipt.deliveryConfirmed).toBe(false);
  });

  it.each([
    {
      count: 1,
      href: "/notifications?batchId=11111111-1111-4111-8111-111111111111",
    },
    {
      count: 101,
      href: "/notifications?batchId=11111111-1111-4111-8111-111111111111",
    },
    { count: 2, href: "//evil.test" },
    { count: 2, href: "/notifications?batchId=not-a-uuid" },
  ])("rejects an unsafe burst before SMTP: %j", async ({ count, href }) => {
    const service = new MailService(enabledConfig());
    await expect(
      service.sendNotificationBurst(
        "owner@cra.test",
        {
          count,
          href,
          items: [
            {
              title: "Finding",
              href: "/findings",
              date: "2026-10-05",
              category: "finding_triage",
            },
          ],
        },
        "notification-burst:test",
      ),
    ).rejects.toEqual(new RequiredMailDeliveryError("delivery_failed"));
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("classifies an in-flight burst SMTP rejection as uncertain without changing digest retries", async () => {
    const service = new MailService(enabledConfig());
    mockSendMail.mockRejectedValue(new Error("private timeout after DATA"));
    const burst = {
      count: 2,
      href: "/notifications?batchId=11111111-1111-4111-8111-111111111111",
      items: [
        {
          title: "Finding",
          href: "/findings",
          date: "2026-10-05",
          category: "finding_triage",
        },
      ],
    };

    await expect(
      service.sendNotificationBurst(
        "owner@cra.test",
        burst,
        "notification-burst:fixture",
      ),
    ).rejects.toEqual(new UncertainMailDeliveryError());
    await expect(
      service.sendNotificationDigest(
        "owner@cra.test",
        burst.items,
        "notification-digest:fixture",
      ),
    ).rejects.toEqual(new RequiredMailDeliveryError("delivery_failed"));
  });

  it("parks an unconfirmed burst receipt but retries an explicit recipient rejection", async () => {
    const service = new MailService(enabledConfig());
    const burst = {
      count: 2,
      href: "/notifications?batchId=11111111-1111-4111-8111-111111111111",
      items: [
        {
          title: "Finding",
          href: "/findings",
          date: "2026-10-05",
          category: "finding_triage",
        },
      ],
    };
    mockSendMail
      .mockResolvedValueOnce({ messageId: "maybe", accepted: [], rejected: [] })
      .mockResolvedValueOnce({
        messageId: "rejected",
        accepted: [],
        rejected: ["owner@cra.test"],
      })
      .mockResolvedValueOnce({
        messageId: "contradictory",
        accepted: ["owner@cra.test"],
        rejected: ["owner@cra.test"],
      });

    await expect(
      service.sendNotificationBurst("owner@cra.test", burst, "burst:maybe"),
    ).rejects.toEqual(new UncertainMailDeliveryError());
    await expect(
      service.sendNotificationBurst("owner@cra.test", burst, "burst:rejected"),
    ).rejects.toEqual(new RequiredMailDeliveryError("delivery_failed"));
    await expect(
      service.sendNotificationBurst("owner@cra.test", burst, "burst:conflict"),
    ).rejects.toEqual(new UncertainMailDeliveryError());
  });

  it("reports a missing SMTP transport as a provably pre-send burst outage", async () => {
    const service = new MailService(
      config({
        SMTP_FROM: "CRA <no-reply@cra.test>",
        APP_URL: "https://cra.test",
      }),
    );
    await expect(
      service.sendNotificationBurst(
        "owner@cra.test",
        {
          count: 2,
          href: "/notifications?batchId=11111111-1111-4111-8111-111111111111",
          items: [
            {
              title: "Finding",
              href: "/findings",
              date: "2026-10-05",
              category: "finding_triage",
            },
          ],
        },
        "notification-burst:fixture",
      ),
    ).rejects.toEqual(new RequiredMailDeliveryError("provider_unavailable"));
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("retries an explicit SMTP throttle before message data is sent", async () => {
    const service = new MailService(enabledConfig());
    mockSendMail.mockRejectedValue(
      Object.assign(new Error("private relay response"), {
        responseCode: 452,
        command: "RCPT TO",
      }),
    );
    await expect(
      service.sendNotificationBurst(
        "owner@cra.test",
        {
          count: 2,
          href: "/notifications?batchId=11111111-1111-4111-8111-111111111111",
          items: [
            {
              title: "Finding",
              href: "/findings",
              date: "2026-10-05",
              category: "finding_triage",
            },
          ],
        },
        "notification-burst:throttled",
      ),
    ).rejects.toEqual(new RequiredMailDeliveryError("delivery_failed"));
  });

  it("sends content-minimal required reporting deadline alerts", async () => {
    const service = new MailService(enabledConfig());

    await service.sendReportingDeadlineAlert(
      "owner@cra.test",
      {
        obligationId: "11111111-1111-4111-8111-111111111111",
        stage: "early_warning",
        thresholdPercent: 50,
        dueAt: "2026-09-10T10:00:00Z",
      },
      "reporting:stage:revision-1:50:recipient",
    );

    const message = mockSendMail.mock.calls[0]?.[0];
    expect(message?.subject).toBe("Reporting deadline 50%");
    expect(message?.html).toContain("early warning");
    expect(message?.html).toContain("2026-09-10T10:00:00Z");
    expect(message?.html).toContain(
      "https://cra.test/reporting?obligationId=11111111-1111-4111-8111-111111111111",
    );
    expect(message?.html).not.toContain("assessment");
    expect(message?.html).not.toContain("evidence");
  });

  it("sends required KEV alerts without raw SBOM content", async () => {
    const service = new MailService(enabledConfig());

    await service.sendKevAlert(
      "owner@cra.test",
      {
        productName: "Pump <controller>",
        releaseName: "2026.08",
        advisoryId: "CVE-2026-0001",
        lifecycleState: "in_support",
        kevListingDate: "2026-08-26",
      },
      "33333333-3333-4333-8333-333333333333",
    );

    const message = mockSendMail.mock.calls[0]?.[0] as Readonly<{
      html?: unknown;
    }>;
    expect(message?.html).toContain("Pump &lt;controller&gt;");
    expect(message?.html).toContain("CVE-2026-0001");
    expect(message?.html).toContain("No regulatory report has been created");
    expect(message?.html).not.toContain("bomFormat");
    expect(message?.html).not.toContain("components");
  });

  it("sends a required finding-review notification without evidence payloads", async () => {
    const service = new MailService(enabledConfig());

    await service.sendVulnerabilityFindingReviewAlert(
      "owner@cra.test",
      {
        advisoryId: "CVE-2026-0001",
        transition: "withdrawn",
        reviewState: "review_required",
      },
      "33333333-3333-4333-8333-333333333333",
    );

    const message = mockSendMail.mock.calls[0]?.[0] as Readonly<{
      subject?: unknown;
      html?: unknown;
    }>;
    expect(message?.subject).toBe("Finding review required: CVE-2026-0001");
    expect(message?.html).toContain("withdrawn");
    expect(message?.html).toContain("CVE-2026-0001");
    expect(message?.html).not.toContain("evidencePath");
    expect(message?.html).not.toContain("sha256");
  });

  it("normalizes advisory line breaks before composing a review-mail subject", async () => {
    const service = new MailService(enabledConfig());

    await service.sendVulnerabilityFindingReviewAlert(
      "owner@cra.test",
      {
        advisoryId: "CVE-2026-0001\r\nBcc: no-one@cra.test",
        transition: "withdrawn",
        reviewState: "review_required",
      },
      "33333333-3333-4333-8333-333333333333",
    );

    const message = mockSendMail.mock.calls[0]?.[0] as Readonly<{
      subject?: unknown;
    }>;
    expect(message?.subject).toBe(
      "Finding review required: CVE-2026-0001 Bcc: no-one@cra.test",
    );
  });

  it("sends an internal SLA alert without implying a regulatory change", async () => {
    const service = new MailService(enabledConfig());

    await service.sendVulnerabilityTriageAlert(
      "owner@cra.test",
      {
        advisoryId: "CVE-2026-0001",
        severity: "high",
        kind: "internal_sla_breached",
      },
      "33333333-3333-4333-8333-333333333333",
    );

    const message = mockSendMail.mock.calls[0]?.[0] as Readonly<{
      subject?: unknown;
      html?: unknown;
    }>;
    expect(message?.subject).toBe(
      "Internal triage SLA breached: CVE-2026-0001",
    );
    expect(message?.html).toContain("Internal triage SLA");
    expect(message?.html).toContain(
      "No regulatory deadline, obligation, or report was changed",
    );
  });
});
