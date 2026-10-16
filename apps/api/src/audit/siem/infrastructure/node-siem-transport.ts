import { request } from "node:https";
import { connect } from "node:tls";
import { isIP } from "node:net";
import { z } from "zod";
import { resolveApprovedHttpsTarget } from "../../../products/infrastructure/node-product-compliance-external-reference-validator";
import type {
  SiemSendInput,
  SiemTransportPort,
  SiemTransportResult,
} from "../application/siem-transport.port";
export type SiemApprovedTarget = Readonly<{
  protocol: "https" | "syslog_tls";
  hostname: string;
  port: number;
}>;
const targetsSchema = z
  .array(
    z
      .object({
        protocol: z.enum(["https", "syslog_tls"]),
        hostname: z
          .string()
          .regex(/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/)
          .refine((v) => !isIP(v) && v !== "localhost"),
        port: z.number().int().min(1).max(65535),
      })
      .strict(),
  )
  .max(100);
export function parseSiemApprovedTargets(
  value: string | undefined,
): readonly SiemApprovedTarget[] {
  return targetsSchema.parse(JSON.parse(value ?? "[]"));
}
type Resolver = (
  hostname: string,
) => Promise<readonly Readonly<{ address: string }>[]>;
/** Per-send DNS safety and socket pinning; no private-address test exception. */
export class NodeSiemTransport implements SiemTransportPort {
  private readonly targets: readonly SiemApprovedTarget[];
  constructor(
    targets: readonly SiemApprovedTarget[],
    private readonly lookup?: Resolver,
    private readonly timeoutMs = 10000,
  ) {
    this.targets = targetsSchema.parse(targets);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000)
      throw new Error("Invalid delivery deadline");
  }
  async validate(
    protocol: SiemSendInput["protocol"],
    endpoint: string,
  ): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const target = await Promise.race([
        this.target(protocol, endpoint),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), this.timeoutMs);
        }),
      ]);
      if (!target) throw new Error("Use an approved public collector");
    } finally {
      clearTimeout(timer);
    }
  }
  async send(input: SiemSendInput): Promise<SiemTransportResult> {
    if (input.body.byteLength < 1 || input.body.byteLength > 8192)
      return failed("configuration", "payload_size_invalid", false, 0);
    if (
      (input.protocol === "syslog_tls" && input.credential.mode !== "mtls") ||
      (input.credential.mode === "bearer" &&
        !/^[\x21-\x7e]{1,8192}$/.test(input.credential.token))
    )
      return failed("configuration", "credential_invalid", false, 0);
    const start = Date.now();
    return new Promise((resolve) => {
      let settled = false;
      let stream: { destroy: () => void } | undefined;
      const elapsed = () => Math.min(Date.now() - start, this.timeoutMs);
      const finish = (result: SiemTransportResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(Object.freeze(result));
      };
      const timer = setTimeout(() => {
        finish(failed("timeout", "delivery_timeout", true, elapsed()));
        stream?.destroy();
      }, this.timeoutMs);
      void this.target(input.protocol, input.endpoint)
        .then(async (target) => {
          if (settled) return;
          if (!target) {
            finish(
              failed(
                "egress_blocked",
                "endpoint_not_approved",
                false,
                elapsed(),
              ),
            );
            return;
          }
          try {
            if (input.beforeSend && (await input.beforeSend()) === false)
              throw new Error();
          } catch {
            finish(
              failed(
                "authorization",
                "authorization_changed",
                false,
                elapsed(),
              ),
            );
            return;
          }
          if (settled) return;
          const tlsOptions = {
            servername: target.url.hostname,
            rejectUnauthorized: true,
            minVersion: "TLSv1.2" as const,
            ...(input.credential.mode === "mtls"
              ? {
                  cert: input.credential.certificate,
                  key: input.credential.privateKey,
                  ...(input.credential.ca ? { ca: input.credential.ca } : {}),
                }
              : {}),
          };
          const error = (e: NodeJS.ErrnoException) => {
            const code = e.code ?? "";
            const tls =
              /^(?:CERT_|ERR_TLS_|DEPTH_|UNABLE_TO_|SELF_SIGNED)/.test(code);
            finish(
              failed(
                tls ? "egress_blocked" : "receiver_unavailable",
                tls
                  ? "tls_verification_failed"
                  : code.startsWith("HPE_")
                    ? "malformed_response"
                    : "network_error",
                !tls && !code.startsWith("HPE_"),
                elapsed(),
              ),
            );
          };
          if (input.protocol === "https") {
            const req = request(
              {
                hostname: target.url.hostname,
                port: target.port,
                path: target.url.pathname,
                method: "POST",
                family: target.family,
                ...tlsOptions,
                maxHeaderSize: 16384,
                agent: false,
                lookup: (_h, _o, cb) => cb(null, target.address, target.family),
                headers: {
                  "content-type":
                    input.format === "json"
                      ? "application/json"
                      : "text/plain; charset=utf-8",
                  "content-length": input.body.byteLength,
                  "x-cra-event-id": safeHeader(input.eventId),
                  ...(input.credential.mode === "bearer"
                    ? { authorization: `Bearer ${input.credential.token}` }
                    : {}),
                },
              },
              (res) => {
                finish(
                  classify(
                    res.statusCode ?? 0,
                    res.headers["retry-after"],
                    elapsed(),
                  ),
                );
                res.destroy();
              },
            );
            stream = req;
            req.once("error", error);
            req.end(input.body);
          } else {
            const socket = connect(
              { host: target.address, port: target.port, ...tlsOptions },
              () => {
                if (settled) {
                  socket.destroy();
                  return;
                }
                if (!socket.authorized) {
                  finish(
                    failed(
                      "egress_blocked",
                      "tls_verification_failed",
                      false,
                      elapsed(),
                    ),
                  );
                  socket.destroy();
                  return;
                }
                const message = Buffer.concat([
                  Buffer.from(
                    `<134>1 ${new Date().toISOString()} - CRA-Sentinel - audit - `,
                  ),
                  input.body,
                ]);
                const frame = Buffer.concat([
                  Buffer.from(`${message.byteLength} `),
                  message,
                ]);
                socket.write(frame, (err) => {
                  if (err) {
                    error(err);
                    socket.destroy();
                    return;
                  }
                  finish(success("sent_unacknowledged", null, elapsed()));
                  socket.end();
                });
              },
            );
            stream = socket;
            socket.once("error", error);
            socket.once("close", () => {
              if (!settled)
                finish(
                  failed(
                    "receiver_unavailable",
                    "connection_closed",
                    true,
                    elapsed(),
                  ),
                );
            });
          }
        })
        .catch(() =>
          finish(
            failed("receiver_unavailable", "network_error", true, elapsed()),
          ),
        );
    });
  }
  private async target(protocol: SiemSendInput["protocol"], endpoint: string) {
    if (/[\\\s]/.test(endpoint)) return null;
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      return null;
    }
    const hostname = url.hostname.toLowerCase();
    const port = Number(url.port || (protocol === "https" ? 443 : 6514));
    if (
      url.protocol !== (protocol === "https" ? "https:" : "tls:") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      isIP(hostname) ||
      !this.targets.some(
        (t) =>
          t.protocol === protocol && t.hostname === hostname && t.port === port,
      ) ||
      (protocol === "syslog_tls" && url.pathname !== "" && url.pathname !== "/")
    )
      return null;
    const resolved = await resolveApprovedHttpsTarget(
      `https://${hostname}`,
      new Set([hostname]),
      this.lookup ? { lookup: this.lookup } : undefined,
    );
    return resolved ? { ...resolved, url, port } : null;
  }
}
function safeHeader(value: string) {
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(value))
    throw new Error("Invalid event identity");
  return value;
}
function success(
  outcome: "accepted" | "sent_unacknowledged",
  status: number | null,
  durationMs: number,
): SiemTransportResult {
  return {
    outcome,
    status,
    durationMs,
    category: null,
    code: null,
    retryable: false,
    retryAfterSeconds: null,
    responseBytes: 0,
  };
}
function failed(
  category: string,
  code: string,
  retryable: boolean,
  durationMs: number,
  status: number | null = null,
  retryAfterSeconds: number | null = null,
): SiemTransportResult {
  return {
    outcome: "failed",
    category,
    code,
    retryable,
    durationMs,
    status,
    retryAfterSeconds,
    responseBytes: 0,
  };
}
function classify(
  status: number,
  header: string | string[] | undefined,
  duration: number,
): SiemTransportResult {
  if (status >= 200 && status < 300)
    return success("accepted", status, duration);
  if (status >= 300 && status < 400)
    return failed(
      "egress_blocked",
      "redirect_rejected",
      false,
      duration,
      status,
    );
  const retryable =
    status === 408 ||
    status === 425 ||
    status === 429 ||
    (status >= 500 && status < 600 && status !== 501 && status !== 505);
  let retryAfter: number | null = null;
  if (typeof header === "string" && header.length <= 80) {
    if (/^\d{1,10}$/.test(header)) retryAfter = Math.min(86400, Number(header));
    else if (new Date(Date.parse(header)).toUTCString() === header)
      retryAfter = Math.min(
        86400,
        Math.max(0, Math.ceil((Date.parse(header) - Date.now()) / 1000)),
      );
  }
  return failed(
    status === 429
      ? "rate_limit"
      : retryable
        ? "receiver_unavailable"
        : "receiver_rejected",
    status >= 100 && status <= 599 ? `http_${status}` : "invalid_http_status",
    retryable,
    duration,
    status >= 100 && status <= 599 ? status : null,
    retryAfter,
  );
}
