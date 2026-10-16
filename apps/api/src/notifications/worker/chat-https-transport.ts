import { request as httpsRequest } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { resolveApprovedHttpsTarget } from "../../products/infrastructure/node-product-compliance-external-reference-validator";

export type ChatPostInput = Readonly<{
  url: string;
  allowedHosts: readonly string[];
  headers: Readonly<Record<string, string>>;
  body: Buffer;
  beforeSend?: () => Promise<boolean>;
}>;

export type ChatPostResult =
  | Readonly<{
      outcome: "response";
      status: number;
      body: string;
      retryAfterSeconds: number | null;
    }>
  | Readonly<{
      outcome: "failure";
      code:
        | "egress_blocked"
        | "tls_verification_failed"
        | "delivery_timeout"
        | "network_error"
        | "response_too_large"
        | "authorization_changed"
        | "payload_size_invalid";
      uncertain: boolean;
    }>;

type Resolver = (
  hostname: string,
) => Promise<readonly Readonly<{ address: string }>[]>;

const MAX_REQUEST_BYTES = 28 * 1024;
const MAX_RESPONSE_BYTES = 16 * 1024;
const MAX_RETRY_AFTER_SECONDS = 900;

/** An outbound-only POST with DNS pinning, certificate validation and no redirect handling. */
export class ChatHttpsTransport {
  constructor(
    private readonly lookup?: Resolver,
    private readonly timeoutMs = 10_000,
  ) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000)
      throw new Error("Invalid chat delivery timeout");
  }

  post(input: ChatPostInput): Promise<ChatPostResult> {
    if (input.body.length < 1 || input.body.length > MAX_REQUEST_BYTES)
      return Promise.resolve({
        outcome: "failure",
        code: "payload_size_invalid",
        uncertain: false,
      });
    return new Promise((resolve) => {
      let settled = false;
      let written = false;
      let request: ClientRequest | undefined;
      const finish = (result: ChatPostResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => {
        finish({
          outcome: "failure",
          code: "delivery_timeout",
          uncertain: written,
        });
        request?.destroy();
      }, this.timeoutMs);
      let parsed: URL;
      try {
        parsed = new URL(input.url);
      } catch {
        finish({
          outcome: "failure",
          code: "egress_blocked",
          uncertain: false,
        });
        return;
      }
      if (input.url.length > 4096 || parsed.hash) {
        finish({
          outcome: "failure",
          code: "egress_blocked",
          uncertain: false,
        });
        return;
      }
      const hosts = new Set(input.allowedHosts);
      void resolveApprovedHttpsTarget(
        parsed,
        hosts,
        this.lookup ? { lookup: this.lookup } : undefined,
      )
        .then(async (target) => {
          if (settled) return;
          if (!target) {
            finish({
              outcome: "failure",
              code: "egress_blocked",
              uncertain: false,
            });
            return;
          }
          if (input.beforeSend) {
            let authorized = false;
            try {
              authorized = await input.beforeSend();
            } catch {
              authorized = false;
            }
            if (settled) return;
            if (!authorized) {
              finish({
                outcome: "failure",
                code: "authorization_changed",
                uncertain: false,
              });
              return;
            }
          }
          try {
            request = httpsRequest(
              {
                protocol: "https:",
                hostname: target.url.hostname,
                family: target.family,
                servername: target.url.hostname,
                rejectUnauthorized: true,
                method: "POST",
                path: `${target.url.pathname}${target.url.search}`,
                maxHeaderSize: 16_384,
                headers: {
                  ...input.headers,
                  "content-length": input.body.length,
                },
                lookup: (_hostname, _options, callback) =>
                  callback(null, target.address, target.family),
              },
              (response) => this.readResponse(response, finish),
            );
            request.once("error", (error: NodeJS.ErrnoException) => {
              const code = error.code ?? "";
              const tls =
                /^(?:CERT_|ERR_TLS_|DEPTH_|UNABLE_TO_|SELF_SIGNED)/.test(code);
              // These errors occur before TCP can carry request bytes.
              const noConnection =
                /^(?:ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|ENETDOWN|EHOSTDOWN|EADDRNOTAVAIL|ENOTFOUND)$/.test(
                  code,
                );
              finish({
                outcome: "failure",
                code: tls ? "tls_verification_failed" : "network_error",
                uncertain: written && !tls && !noConnection,
              });
            });
            written = true;
            request.end(input.body);
          } catch {
            finish({
              outcome: "failure",
              code: "network_error",
              uncertain: written,
            });
          }
        })
        .catch(() =>
          finish({
            outcome: "failure",
            code: "egress_blocked",
            uncertain: false,
          }),
        );
    });
  }

  private readResponse(
    response: IncomingMessage,
    finish: (result: ChatPostResult) => void,
  ) {
    const status = response.statusCode ?? 0;
    if (status < 200 || status >= 300) {
      finish({
        outcome: "response",
        status,
        body: "",
        retryAfterSeconds: retryAfter(response.headers["retry-after"]),
      });
      response.destroy();
      return;
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    response.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_RESPONSE_BYTES) {
        response.destroy();
        finish({
          outcome: "failure",
          code: "response_too_large",
          uncertain: true,
        });
      } else {
        chunks.push(chunk);
      }
    });
    response.once("end", () =>
      finish({
        outcome: "response",
        status: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString("utf8"),
        retryAfterSeconds: retryAfter(response.headers["retry-after"]),
      }),
    );
    response.once("error", () =>
      finish({ outcome: "failure", code: "network_error", uncertain: true }),
    );
  }
}

function retryAfter(value: string | string[] | undefined): number | null {
  if (typeof value !== "string" || value.length > 80) return null;
  if (/^\d{1,10}$/.test(value))
    return Math.min(MAX_RETRY_AFTER_SECONDS, Number(value));
  if (
    !/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(
      value,
    )
  )
    return null;
  const date = Date.parse(value);
  return Number.isFinite(date) && new Date(date).toUTCString() === value
    ? Math.min(
        MAX_RETRY_AFTER_SECONDS,
        Math.max(0, Math.ceil((date - Date.now()) / 1000)),
      )
    : null;
}
