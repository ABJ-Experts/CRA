import { ChatProviderDeliveryAdapter } from "./chat-provider-delivery.adapter";
import type { ChatPostInput, ChatPostResult } from "./chat-https-transport";

const event = {
  eventClass: "high_severity_alert" as const,
  severity: "critical" as const,
  eventAt: "2026-10-02T10:30:00.000Z",
  link: "https://cra.example/reporting?obligationId=00000000-0000-4000-8000-000000000001&stageId=00000000-0000-4000-8000-000000000004",
};
const response = (status: number, body: string): ChatPostResult => ({
  outcome: "response",
  status,
  body,
  retryAfterSeconds: null,
});
const sent: ChatPostInput[] = [];
const post = jest.fn((input: ChatPostInput): Promise<ChatPostResult> => {
  sent.push(input);
  return Promise.resolve(response(200, "ok"));
});
const adapter = () =>
  new ChatProviderDeliveryAdapter(post, "https://cra.example");

describe("chat provider delivery", () => {
  beforeEach(() => {
    sent.length = 0;
    post.mockReset();
    post.mockImplementation((input) => {
      sent.push(input);
      return Promise.resolve(response(200, "ok"));
    });
  });

  it("sends a generic Slack webhook alert with no mention or sensitive source content", async () => {
    const result = await adapter().send({
      credential: {
        mode: "slack_webhook",
        webhookUrl: "https://hooks.slack.com/services/T/B/secret",
      },
      message: event,
    });
    expect(result).toMatchObject({ outcome: "provider_accepted", status: 200 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      url: "https://hooks.slack.com/services/T/B/secret",
      allowedHosts: ["hooks.slack.com"],
    });
    const payload = JSON.parse(sent[0]!.body.toString()) as {
      text: string;
      unfurl_links: boolean;
      unfurl_media: boolean;
    };
    expect(payload.text).toContain("High-severity alert");
    expect(payload.text).toContain(event.link);
    expect(payload.text).not.toMatch(/@|<!|finding|draft|evidence/i);
    expect(payload).toMatchObject({ unfurl_links: false, unfurl_media: false });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("checks Slack bot JSON success even when HTTP status is 200", async () => {
    post.mockImplementation((input) => {
      sent.push(input);
      return Promise.resolve(
        response(200, '{"ok":true,"ts":"1727865000.000123"}'),
      );
    });
    const credential = {
      mode: "slack_bot" as const,
      botToken: "xoxb-secret123",
      channelId: "C12345678",
    };
    expect(
      await adapter().send({
        credential,
        message: event,
      }),
    ).toMatchObject({
      outcome: "provider_accepted",
      providerMessageId: "1727865000.000123",
    });
    expect(sent[0]).toMatchObject({
      url: "https://slack.com/api/chat.postMessage",
      headers: { authorization: "Bearer xoxb-secret123" },
      allowedHosts: ["slack.com"],
    });
    expect(JSON.parse(sent[0]!.body.toString())).toMatchObject({
      channel: "C12345678",
      link_names: false,
      parse: "none",
    });
    post.mockResolvedValue(
      response(200, '{"ok":false,"error":"invalid_auth"}'),
    );
    const rejected = await adapter().send({
      credential,
      message: event,
    });
    expect(rejected).toMatchObject({
      outcome: "failed",
      code: "provider_rejected",
      retryable: false,
    });
    expect(JSON.stringify(rejected)).not.toContain("invalid_auth");
  });

  it("sends a Teams Workflows payload and a synthetic test without source content", async () => {
    await adapter().send({
      credential: {
        mode: "teams_workflow_webhook",
        webhookUrl:
          "https://org.ae.environment.api.powerplatform.com/powerautomate/automations/direct/cu/20/workflows/abc/triggers/manual/paths/invoke?sig=secret",
      },
      message: event,
    });
    expect(sent[0]).toMatchObject({
      allowedHosts: ["org.ae.environment.api.powerplatform.com"],
    });
    expect(sent[0]!.url).toContain("?sig=secret");
    const payload = JSON.parse(sent[0]!.body.toString()) as { text: string };
    expect(payload.text).toContain(event.link);
    sent.length = 0;
    await adapter().send({
      credential: {
        mode: "slack_webhook",
        webhookUrl: "https://hooks.slack.com/services/T/B/secret",
      },
      message: {
        eventClass: "test",
        severity: "test",
        displayName: "Operations alerts",
        confirmationCode: "123456",
      },
    });
    expect(JSON.parse(sent[0]!.body.toString())).toEqual({
      text: "CRA Sentinel test notification\nChannel: Operations alerts\nConfirmation code: 123456\nNo record data is included.",
      unfurl_links: false,
      unfurl_media: false,
    });
    expect(sent[0]!.body.toString()).not.toContain("https://cra.example");
  });

  it("does not treat an explicit Workflows error in a 2xx response as acceptance", async () => {
    post.mockResolvedValue(
      response(200, '{"error":{"code":"FlowDisabled","message":"private"}}'),
    );
    const result = await adapter().send({
      credential: {
        mode: "teams_workflow_webhook",
        webhookUrl:
          "https://org.ae.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/abc/triggers/manual/paths/invoke?sig=secret",
      },
      message: event,
    });
    expect(result).toMatchObject({
      outcome: "failed",
      code: "provider_rejected",
    });
    expect(JSON.stringify(result)).not.toContain("FlowDisabled");
    post.mockResolvedValue(response(200, "private non-JSON error"));
    expect(
      await adapter().send({
        credential: {
          mode: "teams_workflow_webhook",
          webhookUrl:
            "https://org.ae.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/abc/triggers/manual/paths/invoke?sig=secret",
        },
        message: event,
      }),
    ).toMatchObject({
      outcome: "failed",
      code: "malformed_response",
      uncertain: true,
    });
  });

  it("acquires a Teams bot token and sends a proactive message to the bound conversation", async () => {
    post.mockImplementation((input) => {
      sent.push(input);
      return Promise.resolve(
        sent.length === 1
          ? response(
              200,
              '{"access_token":"ey-secret-token-123456789","token_type":"Bearer","expires_in":3600}',
            )
          : response(201, '{"id":"activity-123"}'),
      );
    });
    const result = await adapter().send({
      credential: {
        mode: "teams_bot_proactive",
        tenantId: "00000000-0000-4000-8000-000000000002",
        appId: "00000000-0000-4000-8000-000000000003",
        appSecret: "app-secret",
        conversationId: "19:channel-id@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/emea/",
      },
      message: event,
    });
    expect(result).toMatchObject({
      outcome: "provider_accepted",
      providerMessageId: "activity-123",
    });
    expect(sent[0]).toMatchObject({
      url: "https://login.microsoftonline.com/00000000-0000-4000-8000-000000000002/oauth2/v2.0/token",
      allowedHosts: ["login.microsoftonline.com"],
    });
    expect(sent[1]).toMatchObject({
      url: "https://smba.trafficmanager.net/emea/v3/conversations/19%3Achannel-id%40thread.tacv2/activities",
      headers: { authorization: "Bearer ey-secret-token-123456789" },
      allowedHosts: ["smba.trafficmanager.net"],
    });
    expect(JSON.stringify(result)).not.toMatch(/app-secret|ey-secret/);
  });

  it("classifies retry, permanent rejection and uncertain transport outcomes", async () => {
    const credential = {
      mode: "slack_webhook" as const,
      webhookUrl: "https://hooks.slack.com/services/T/B/secret",
    };
    post.mockResolvedValue({
      outcome: "response",
      status: 429,
      body: "rate limited",
      retryAfterSeconds: 9,
    });
    expect(await adapter().send({ credential, message: event })).toMatchObject({
      outcome: "failed",
      retryable: true,
      retryAfterSeconds: 9,
      uncertain: false,
    });
    post.mockResolvedValue(response(403, "revoked token detail"));
    expect(await adapter().send({ credential, message: event })).toMatchObject({
      outcome: "failed",
      retryable: false,
      code: "provider_rejected",
    });
    post.mockResolvedValue({
      outcome: "failure",
      code: "delivery_timeout",
      uncertain: true,
    });
    expect(await adapter().send({ credential, message: event })).toMatchObject({
      outcome: "failed",
      uncertain: true,
      retryable: false,
    });
    post.mockResolvedValue({
      outcome: "failure",
      code: "network_error",
      uncertain: false,
    });
    expect(await adapter().send({ credential, message: event })).toMatchObject({
      outcome: "failed",
      code: "network_error",
      uncertain: false,
      retryable: true,
    });
  });

  it("rejects unsafe destinations and links before transport", async () => {
    const invalid = await adapter().send({
      credential: {
        mode: "teams_workflow_webhook",
        webhookUrl: "https://127.0.0.1/secret",
      },
      message: event,
    });
    expect(invalid).toMatchObject({
      outcome: "failed",
      code: "invalid_configuration",
    });
    const unsafe = await adapter().send({
      credential: {
        mode: "slack_webhook",
        webhookUrl: "https://hooks.slack.com/services/T/B/secret",
      },
      message: { ...event, link: "javascript:alert(1)" },
    });
    expect(unsafe).toMatchObject({
      outcome: "failed",
      code: "invalid_message",
    });
    const untrustedAppRoute = await adapter().send({
      credential: {
        mode: "slack_webhook",
        webhookUrl: "https://hooks.slack.com/services/T/B/secret",
      },
      message: {
        ...event,
        link: "https://cra.example/redirect?to=https://evil.example",
      },
    });
    expect(untrustedAppRoute).toMatchObject({
      outcome: "failed",
      code: "invalid_message",
    });
    expect(post).not.toHaveBeenCalled();
  });

  it("rejects malformed provider credentials and unsafe synthetic labels", async () => {
    const invalidCredentials = [
      {
        mode: "slack_webhook" as const,
        webhookUrl: "https://attacker.example/services/T/B/secret",
      },
      {
        mode: "slack_bot" as const,
        botToken: "xoxb-invalid",
        channelId: "@here",
      },
      {
        mode: "teams_workflow_webhook" as const,
        webhookUrl: "https://attacker.example/workflows/a/triggers/manual",
      },
      {
        mode: "teams_bot_proactive" as const,
        tenantId: "00000000-0000-4000-8000-000000000002",
        appId: "00000000-0000-4000-8000-000000000003",
        appSecret: "app-secret",
        conversationId: "19:channel-id@thread.tacv2",
        serviceUrl: "https://127.0.0.1/emea/",
      },
    ];
    for (const credential of invalidCredentials)
      expect(
        await adapter().send({ credential, message: event }),
      ).toMatchObject({
        outcome: "failed",
        code: "invalid_configuration",
      });
    expect(
      await adapter().send({
        credential: {
          mode: "slack_webhook",
          webhookUrl: "https://hooks.slack.com/services/T/B/secret",
        },
        message: {
          eventClass: "test",
          severity: "test",
          displayName: "Ops @here",
          confirmationCode: "123456",
        },
      }),
    ).toMatchObject({ outcome: "failed", code: "invalid_message" });
    expect(post).not.toHaveBeenCalled();
  });

  it("stops proactive bot delivery when access is revoked or token exchange fails", async () => {
    const credential = {
      mode: "teams_bot_proactive" as const,
      tenantId: "00000000-0000-4000-8000-000000000002",
      appId: "00000000-0000-4000-8000-000000000003",
      appSecret: "app-secret",
      conversationId: "19:channel-id@thread.tacv2",
      serviceUrl: "https://smba.trafficmanager.net/emea/",
    };
    expect(
      await adapter().send({
        credential,
        message: event,
        beforeSend: () => Promise.resolve(false),
      }),
    ).toMatchObject({ outcome: "failed", code: "authorization_changed" });
    expect(post).not.toHaveBeenCalled();
    post.mockResolvedValueOnce(response(401, "secret token detail"));
    expect(await adapter().send({ credential, message: event })).toMatchObject({
      outcome: "failed",
      code: "provider_rejected",
      retryable: false,
    });
    post.mockResolvedValueOnce(response(200, "not JSON"));
    expect(await adapter().send({ credential, message: event })).toMatchObject({
      outcome: "failed",
      code: "malformed_response",
      retryable: false,
    });
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("revalidates again at the Teams token network boundary after the early check", async () => {
    const beforeSend = jest
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    post.mockImplementation(async (input) => {
      if (input.beforeSend && !(await input.beforeSend()))
        return {
          outcome: "failure",
          code: "authorization_changed",
          uncertain: false,
        };
      sent.push(input);
      return response(200, '{"access_token":"ey-secret-token-123456789"}');
    });
    const result = await adapter().send({
      credential: {
        mode: "teams_bot_proactive",
        tenantId: "00000000-0000-4000-8000-000000000002",
        appId: "00000000-0000-4000-8000-000000000003",
        appSecret: "app-secret",
        conversationId: "19:channel-id@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/emea/",
      },
      message: event,
      beforeSend,
    });
    expect(result).toMatchObject({
      outcome: "failed",
      code: "authorization_changed",
    });
    expect(beforeSend).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(0);
  });

  it("classifies proactive bot send failures after token acquisition", async () => {
    post.mockImplementation((input) => {
      sent.push(input);
      return Promise.resolve(
        sent.length === 1
          ? response(200, '{"access_token":"ey-secret-token-123456789"}')
          : response(503, "secret provider error"),
      );
    });
    expect(
      await adapter().send({
        credential: {
          mode: "teams_bot_proactive",
          tenantId: "00000000-0000-4000-8000-000000000002",
          appId: "00000000-0000-4000-8000-000000000003",
          appSecret: "app-secret",
          conversationId: "19:channel-id@thread.tacv2",
          serviceUrl: "https://smba.trafficmanager.net/emea/",
        },
        message: event,
      }),
    ).toMatchObject({
      outcome: "failed",
      code: "provider_unavailable",
      retryable: true,
    });
    expect(sent).toHaveLength(2);
  });

  it("does not accept a bot response that carries an explicit error", async () => {
    post.mockImplementation((input) => {
      sent.push(input);
      return Promise.resolve(
        sent.length === 1
          ? response(200, '{"access_token":"ey-secret-token-123456789"}')
          : response(200, '{"error":{"code":"Forbidden","message":"private"}}'),
      );
    });
    const result = await adapter().send({
      credential: {
        mode: "teams_bot_proactive",
        tenantId: "00000000-0000-4000-8000-000000000002",
        appId: "00000000-0000-4000-8000-000000000003",
        appSecret: "app-secret",
        conversationId: "19:channel-id@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/emea/",
      },
      message: event,
    });
    expect(result).toMatchObject({
      outcome: "failed",
      code: "provider_rejected",
    });
    expect(JSON.stringify(result)).not.toContain("Forbidden");
  });
});
