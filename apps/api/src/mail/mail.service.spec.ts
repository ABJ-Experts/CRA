import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createTransport } from "nodemailer";

import { MailService, RequiredMailDeliveryError } from "./mail.service";

interface SentMessage {
  from: string;
  to: string;
  subject: string;
  html: string;
}

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
    mockSendMail.mockReset().mockResolvedValue({ messageId: "mail-1" });
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
    expect(loggerWarn).toHaveBeenNthCalledWith(
      2,
      'Email suppressed (no transport): "Your CRA verification code"',
    );
  });

  it("creates a Mailpit-compatible unauthenticated transport", () => {
    new MailService(enabledConfig({ SMTP_PORT: undefined }));

    expect(mockedCreateTransport).toHaveBeenCalledWith({
      host: "127.0.0.1",
      port: 587,
      secure: false,
      tls: { rejectUnauthorized: false },
    });
    expect(loggerLog).toHaveBeenCalledWith(
      "Mail transport ready: 127.0.0.1:587",
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
    expect(loggerLog).toHaveBeenCalledWith('Sent "Your CRA verification code"');
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
      expect(loggerError).toHaveBeenCalledWith(
        `Failed to send "Your CRA verification code": ${detail}`,
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

    await service.sendSupportPeriodAlert(
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
});
