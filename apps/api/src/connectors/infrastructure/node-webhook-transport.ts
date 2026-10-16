import { request as httpsRequest } from "node:https";
import type { ClientRequest, OutgoingHttpHeaders } from "node:http";
import { webhookUrlInputSchema } from "@repo/contracts/connectors/schemas";
import { resolveApprovedHttpsTarget } from "../../products/infrastructure/node-product-compliance-external-reference-validator";
import { ConnectorError } from "../application/connector-errors";

export type WebhookTransportResult =
  | Readonly<{
      outcome: "succeeded";
      status: number;
      durationMs: number;
      responseBytes: number;
    }>
  | Readonly<{
      outcome: "failed";
      category: string;
      code: string;
      status: number | null;
      durationMs: number;
      responseBytes: number;
      retryAfterSeconds: number | null;
    }>;
type PostInput = Readonly<{
  url: string;
  body: Buffer;
  headers: OutgoingHttpHeaders;
  beforeSend?: () => Promise<void | boolean>;
}>;
type Resolver = (
  hostname: string,
) => Promise<readonly Readonly<{ address: string }>[]>;

/** Public DNS is checked on every send; each resulting socket uses only its approved address. */
export class NodeWebhookTransport {
  private readonly allowedHosts: ReadonlySet<string>;
  constructor(
    allowedHosts: readonly string[],
    private readonly lookup?: Resolver,
    private readonly timeoutMs = 10_000,
  ) {
    this.allowedHosts = new Set(
      allowedHosts.map((host) => host.toLowerCase().trim()).filter(Boolean),
    );
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000)
      throw new Error("Invalid delivery deadline");
  }

  async validate(url: string): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const target = await Promise.race([
        this.target(url),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), this.timeoutMs);
        }),
      ]);
      if (!target)
        throw new ConnectorError(
          "invalid_request",
          "Use an approved public HTTPS destination",
        );
    } finally {
      clearTimeout(timer);
    }
  }

  post(input: PostInput): Promise<WebhookTransportResult> {
    const started = Date.now();
    if (input.body.byteLength > 8192 || input.body.byteLength < 1)
      return Promise.resolve(
        failure("configuration", "payload_size_invalid", null, 0),
      );
    return new Promise((resolve) => {
      let settled = false;
      let request: ClientRequest | undefined;
      const finish = (result: WebhookTransportResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(Object.freeze(result));
      };
      const elapsed = () => Math.min(Date.now() - started, 10_000);
      const timer = setTimeout(() => {
        finish(failure("timeout", "delivery_timeout", null, elapsed()));
        request?.destroy();
      }, this.timeoutMs);
      void this.target(input.url)
        .then(async (target) => {
          if (settled) return;
          if (!target) {
            finish(
              failure(
                "egress_blocked",
                "endpoint_not_approved",
                null,
                elapsed(),
              ),
            );
            return;
          }
          try {
            if (input.beforeSend && (await input.beforeSend()) === false)
              throw new Error("authorization");
          } catch {
            finish(
              failure(
                "authorization",
                "authorization_changed",
                null,
                elapsed(),
              ),
            );
            return;
          }
          if (settled) return;
          request = httpsRequest(
            {
              protocol: "https:",
              hostname: target.url.hostname,
              family: target.family,
              servername: target.url.hostname,
              method: "POST",
              path: target.url.pathname,
              maxHeaderSize: 16_384,
              headers: {
                ...input.headers,
                "content-type": "application/json",
                "content-length": input.body.byteLength,
              },
              lookup: (_hostname, _options, callback) =>
                callback(null, target.address, target.family),
            },
            (response) => {
              // The acknowledgement is the status headers. Never consume/log a body,
              // including streaming, oversized or secret-bearing error responses.
              finish(
                classify(
                  response.statusCode ?? 0,
                  response.headers["retry-after"],
                  elapsed(),
                ),
              );
              response.destroy();
            },
          );
          request.once("error", (error: NodeJS.ErrnoException) => {
            const code = error.code ?? "";
            const tls =
              /^(?:CERT_|ERR_TLS_|DEPTH_|UNABLE_TO_|SELF_SIGNED)/.test(code);
            if (code === "HPE_HEADER_OVERFLOW")
              finish(
                failure(
                  "receiver_rejected",
                  "response_headers_too_large",
                  null,
                  elapsed(),
                ),
              );
            else if (tls)
              finish(
                failure(
                  "egress_blocked",
                  "tls_verification_failed",
                  null,
                  elapsed(),
                ),
              );
            else
              finish(
                failure(
                  "receiver_unavailable",
                  "network_error",
                  null,
                  elapsed(),
                ),
              );
          });
          request.end(input.body);
        })
        .catch(() =>
          finish(
            failure("receiver_unavailable", "network_error", null, elapsed()),
          ),
        );
    });
  }

  private target(url: string) {
    const parsed = webhookUrlInputSchema.safeParse(url);
    if (!parsed.success) return Promise.resolve(null);
    return resolveApprovedHttpsTarget(
      parsed.data,
      this.allowedHosts,
      this.lookup ? { lookup: this.lookup } : undefined,
    );
  }
}

function classify(
  status: number,
  retryHeader: string | string[] | undefined,
  duration: number,
): WebhookTransportResult {
  if (status >= 200 && status < 300)
    return {
      outcome: "succeeded",
      status,
      durationMs: duration,
      responseBytes: 0,
    };
  if (status >= 300 && status < 400)
    return failure("egress_blocked", "redirect_rejected", status, duration);
  const retryAfterSeconds = retryAfter(retryHeader);
  if (status === 429)
    return failure(
      "rate_limit",
      "http_429",
      status,
      duration,
      retryAfterSeconds,
    );
  if (status === 408)
    return failure("timeout", "http_408", status, duration, retryAfterSeconds);
  if (
    status === 425 ||
    (status >= 500 && status < 600 && status !== 501 && status !== 505)
  )
    return failure(
      "receiver_unavailable",
      `http_${status}`,
      status,
      duration,
      retryAfterSeconds,
    );
  return failure(
    "receiver_rejected",
    status >= 100 && status <= 599 ? `http_${status}` : "invalid_http_status",
    status >= 100 && status <= 599 ? status : null,
    duration,
  );
}

function retryAfter(value: string | string[] | undefined): number | null {
  if (typeof value !== "string" || value.length > 80) return null;
  if (/^\d{1,10}$/.test(value)) return Number(value);
  if (
    !/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(
      value,
    )
  )
    return null;
  const date = Date.parse(value);
  return Number.isFinite(date) && new Date(date).toUTCString() === value
    ? Math.max(0, Math.ceil((date - Date.now()) / 1000))
    : null;
}

function failure(
  category: string,
  code: string,
  status: number | null,
  durationMs: number,
  retryAfterSeconds: number | null = null,
): WebhookTransportResult {
  return {
    outcome: "failed",
    category,
    code,
    status,
    durationMs,
    responseBytes: 0,
    retryAfterSeconds,
  };
}
