import {
  ChatHttpsTransport,
  type ChatPostInput,
  type ChatPostResult,
} from "./chat-https-transport";
import { trustedNotificationRouteSchema } from "@repo/contracts/notifications";

export type ChatCredential =
  | Readonly<{ mode: "slack_webhook"; webhookUrl: string }>
  | Readonly<{ mode: "slack_bot"; botToken: string; channelId: string }>
  | Readonly<{ mode: "teams_workflow_webhook"; webhookUrl: string }>
  | Readonly<{
      mode: "teams_bot_proactive";
      tenantId: string;
      appId: string;
      appSecret: string;
      conversationId: string;
      serviceUrl: string;
    }>;

export type ChatMessage =
  | Readonly<{
      eventClass:
        "high_severity_alert" | "countdown_warning" | "approval_prompt";
      severity: "high" | "critical";
      eventAt: string;
      link: string;
    }>
  | Readonly<{
      eventClass: "test";
      severity: "test";
      displayName: string;
      confirmationCode: string;
    }>;

export type ChatDeliveryResult =
  | Readonly<{
      outcome: "provider_accepted";
      status: number;
      providerMessageId?: string;
    }>
  | Readonly<{
      outcome: "failed";
      status: number | null;
      code: string;
      retryable: boolean;
      retryAfterSeconds: number | null;
      uncertain: boolean;
    }>;

export type ChatSendInput = Readonly<{
  credential: ChatCredential;
  message: ChatMessage;
  beforeSend?: () => Promise<boolean>;
}>;

type Poster = (input: ChatPostInput) => Promise<ChatPostResult>;
const defaultTransport = new ChatHttpsTransport();
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const slackChannel = /^[CGD][A-Z0-9]{8,}$/;
const microsoftWorkflowHost =
  /(?:^|\.)(?:logic\.azure\.com|environment\.api\.powerplatform\.com)$/i;
const botServiceHost = /(?:^|\.)smba\.trafficmanager\.net$/i;

/** Provider-specific acknowledgment only; no adapter claims confirmed message delivery. */
export class ChatProviderDeliveryAdapter {
  constructor(
    private readonly post: Poster = (input) => defaultTransport.post(input),
    private readonly appUrl = process.env.APP_URL ?? "http://localhost:3000",
  ) {}

  async send(input: ChatSendInput): Promise<ChatDeliveryResult> {
    const text = renderMessage(input.message, this.appUrl);
    if (!text) return failed("invalid_message");
    switch (input.credential.mode) {
      case "slack_webhook":
        return this.sendSlackWebhook(input.credential, text, input.beforeSend);
      case "slack_bot":
        return this.sendSlackBot(input.credential, text, input.beforeSend);
      case "teams_workflow_webhook":
        return this.sendTeamsWorkflow(input.credential, text, input.beforeSend);
      case "teams_bot_proactive":
        return this.sendTeamsBot(input.credential, text, input.beforeSend);
    }
  }

  private async sendSlackWebhook(
    credential: Extract<ChatCredential, { mode: "slack_webhook" }>,
    text: string,
    beforeSend?: () => Promise<boolean>,
  ): Promise<ChatDeliveryResult> {
    const url = safeUrl(
      credential.webhookUrl,
      (host) => host === "hooks.slack.com",
    );
    if (
      !url ||
      !/^\/services\/[^/]+\/[^/]+\/[^/]+$/.test(url.pathname) ||
      url.search
    )
      return failed("invalid_configuration");
    const result = await this.post({
      url: url.toString(),
      allowedHosts: [url.hostname],
      headers: { "content-type": "application/json" },
      body: Buffer.from(
        JSON.stringify({ text, unfurl_links: false, unfurl_media: false }),
      ),
      beforeSend,
    });
    if (result.outcome === "failure") return transportFailure(result);
    if (result.status < 200 || result.status >= 300) return httpFailure(result);
    return result.body.trim() === "ok"
      ? accepted(result.status)
      : failed("malformed_response", result.status, false, null, true);
  }

  private async sendSlackBot(
    credential: Extract<ChatCredential, { mode: "slack_bot" }>,
    text: string,
    beforeSend?: () => Promise<boolean>,
  ): Promise<ChatDeliveryResult> {
    if (
      !/^xoxb-[A-Za-z0-9-]{8,}$/.test(credential.botToken) ||
      !slackChannel.test(credential.channelId)
    )
      return failed("invalid_configuration");
    const result = await this.post({
      url: "https://slack.com/api/chat.postMessage",
      allowedHosts: ["slack.com"],
      headers: {
        "content-type": "application/json; charset=utf-8",
        authorization: `Bearer ${credential.botToken}`,
      },
      body: Buffer.from(
        JSON.stringify({
          channel: credential.channelId,
          text,
          link_names: false,
          parse: "none",
          unfurl_links: false,
          unfurl_media: false,
        }),
      ),
      beforeSend,
    });
    if (result.outcome === "failure") return transportFailure(result);
    if (result.status < 200 || result.status >= 300) return httpFailure(result);
    const body = parseJson(result.body);
    if (body?.ok === false) return failed("provider_rejected", result.status);
    if (body?.ok !== true)
      return failed("malformed_response", result.status, false, null, true);
    return accepted(result.status, safeProviderId(body.ts));
  }

  private async sendTeamsWorkflow(
    credential: Extract<ChatCredential, { mode: "teams_workflow_webhook" }>,
    text: string,
    beforeSend?: () => Promise<boolean>,
  ): Promise<ChatDeliveryResult> {
    const url = safeUrl(credential.webhookUrl, (host) =>
      microsoftWorkflowHost.test(host),
    );
    if (
      !url ||
      !url.pathname.includes("/workflows/") ||
      !url.pathname.includes("/triggers/")
    )
      return failed("invalid_configuration");
    const result = await this.post({
      url: url.toString(),
      allowedHosts: [url.hostname],
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify({ text })),
      beforeSend,
    });
    if (result.outcome === "failure") return transportFailure(result);
    if (result.status < 200 || result.status >= 300) return httpFailure(result);
    const body = result.body.trim() ? parseJson(result.body) : null;
    if (result.body.trim() && !body)
      return failed("malformed_response", result.status, false, null, true);
    if (body && "error" in body && body.error !== null)
      return failed("provider_rejected", result.status);
    return accepted(result.status);
  }

  private async sendTeamsBot(
    credential: Extract<ChatCredential, { mode: "teams_bot_proactive" }>,
    text: string,
    beforeSend?: () => Promise<boolean>,
  ): Promise<ChatDeliveryResult> {
    const serviceUrl = safeUrl(credential.serviceUrl, (host) =>
      botServiceHost.test(host),
    );
    if (
      !serviceUrl ||
      !uuid.test(credential.tenantId) ||
      !uuid.test(credential.appId) ||
      credential.appSecret.length < 1 ||
      credential.appSecret.length > 4096 ||
      credential.conversationId.length < 1 ||
      credential.conversationId.length > 512 ||
      serviceUrl.search ||
      !serviceUrl.pathname.endsWith("/")
    )
      return failed("invalid_configuration");
    if (beforeSend && !(await beforeSend().catch(() => false)))
      return failed("authorization_changed");
    const tokenResult = await this.post({
      url: `https://login.microsoftonline.com/${credential.tenantId}/oauth2/v2.0/token`,
      allowedHosts: ["login.microsoftonline.com"],
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: Buffer.from(
        new URLSearchParams({
          grant_type: "client_credentials",
          client_id: credential.appId,
          client_secret: credential.appSecret,
          scope: "https://api.botframework.com/.default",
        }).toString(),
      ),
      beforeSend,
    });
    if (tokenResult.outcome === "failure") return transportFailure(tokenResult);
    if (tokenResult.status < 200 || tokenResult.status >= 300)
      return httpFailure(tokenResult);
    const tokenBody = parseJson(tokenResult.body);
    const token = tokenBody?.access_token;
    if (
      typeof token !== "string" ||
      !/^[-._~+/=A-Za-z0-9]{20,8192}$/.test(token)
    )
      return failed("malformed_response", tokenResult.status);
    const activityUrl = new URL(
      `v3/conversations/${encodeURIComponent(credential.conversationId)}/activities`,
      serviceUrl,
    );
    const result = await this.post({
      url: activityUrl.toString(),
      allowedHosts: [serviceUrl.hostname],
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: Buffer.from(JSON.stringify({ type: "message", text })),
      beforeSend,
    });
    if (result.outcome === "failure") return transportFailure(result);
    if (result.status < 200 || result.status >= 300) return httpFailure(result);
    const body = parseJson(result.body);
    if (!body)
      return failed("malformed_response", result.status, false, null, true);
    if ("error" in body && body.error !== null)
      return failed("provider_rejected", result.status);
    return accepted(result.status, safeProviderId(body?.id));
  }
}

function renderMessage(message: ChatMessage, appUrl: string): string | null {
  if (message.eventClass === "test") {
    if (
      !/^[\p{L}\p{N} &().,_-]{1,120}$/u.test(message.displayName) ||
      !/^\d{6}$/.test(message.confirmationCode)
    )
      return null;
    return `CRA Sentinel test notification\nChannel: ${message.displayName}\nConfirmation code: ${message.confirmationCode}\nNo record data is included.`;
  }
  const app = safeUrl(appUrl, () => true);
  const link = safeUrl(message.link, (host) => host === app?.hostname);
  if (
    !app ||
    !link ||
    link.origin !== app.origin ||
    !trustedNotificationRouteSchema.safeParse(`${link.pathname}${link.search}`)
      .success ||
    !Number.isFinite(Date.parse(message.eventAt)) ||
    new Date(message.eventAt).toISOString() !== message.eventAt
  )
    return null;
  const category = {
    high_severity_alert: "High-severity alert",
    countdown_warning: "Countdown warning",
    approval_prompt: "Approval prompt",
  }[message.eventClass];
  const severity = message.severity === "critical" ? "Critical" : "High";
  return `CRA Sentinel\n${category} · ${severity}\nEvent time: ${message.eventAt}\nOpen in CRA: ${link.toString()}`;
}

function safeUrl(
  value: string,
  hostAllowed: (host: string) => boolean,
): URL | null {
  try {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
      url.username ||
      url.password ||
      url.hash ||
      !hostAllowed(url.hostname)
    )
      return null;
    return url;
  } catch {
    return null;
  }
}

function parseJson(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function safeProviderId(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value)
    ? value
    : undefined;
}

function accepted(
  status: number,
  providerMessageId?: string,
): ChatDeliveryResult {
  return providerMessageId
    ? { outcome: "provider_accepted", status, providerMessageId }
    : { outcome: "provider_accepted", status };
}

function failed(
  code: string,
  status: number | null = null,
  retryable = false,
  retryAfterSeconds: number | null = null,
  uncertain = false,
): ChatDeliveryResult {
  return {
    outcome: "failed",
    status,
    code,
    retryable,
    retryAfterSeconds,
    uncertain,
  };
}

function transportFailure(
  result: Extract<ChatPostResult, { outcome: "failure" }>,
): ChatDeliveryResult {
  return failed(
    result.code,
    null,
    !result.uncertain &&
      ["network_error", "delivery_timeout"].includes(result.code),
    null,
    result.uncertain,
  );
}

function httpFailure(
  result: Extract<ChatPostResult, { outcome: "response" }>,
): ChatDeliveryResult {
  if (result.status >= 300 && result.status < 400)
    return failed("redirect_rejected", result.status);
  if (result.status === 429)
    return failed(
      "rate_limited",
      result.status,
      true,
      result.retryAfterSeconds,
    );
  if (
    result.status === 408 ||
    result.status === 425 ||
    (result.status >= 500 &&
      result.status < 600 &&
      result.status !== 501 &&
      result.status !== 505)
  )
    return failed(
      "provider_unavailable",
      result.status,
      true,
      result.retryAfterSeconds,
    );
  return failed("provider_rejected", result.status);
}
