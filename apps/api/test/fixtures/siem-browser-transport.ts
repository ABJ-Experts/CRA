import { request } from "node:https";
import { connect } from "node:tls";
import type {
  SiemSendInput,
  SiemTransportPort,
  SiemTransportResult,
} from "../../src/audit/siem/application/siem-transport.port";
import type { startSiemCollector } from "./siem-collector";
/** Explicit TEST adapter: fixed logical target -> owned loopback receiver. Never import in production. */
export class SiemBrowserFixtureTransport implements SiemTransportPort {
  constructor(
    private readonly collector: Awaited<ReturnType<typeof startSiemCollector>>,
  ) {}
  validate(
    protocol: SiemSendInput["protocol"],
    endpoint: string,
  ): Promise<void> {
    const expected =
      protocol === "https"
        ? "https://collector.example/events"
        : "tls://collector.example:6514";
    return endpoint === expected
      ? Promise.resolve()
      : Promise.reject(new Error("Wrong fixture collector"));
  }
  async send(input: SiemSendInput): Promise<SiemTransportResult> {
    await this.validate(input.protocol, input.endpoint);
    if (input.body.length > 8192 || !input.body.length)
      throw new Error("Invalid fixture payload");
    if (input.beforeSend && (await input.beforeSend()) === false)
      return result("failed", null, "authorization_changed", false);
    return new Promise((resolve) => {
      let settled = false;
      let socket: { destroy: () => void } | undefined;
      const finish = (value: SiemTransportResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => {
        socket?.destroy();
        finish(result("failed", null, "delivery_timeout", true));
      }, 10000);
      const tls = {
        servername: "collector.example",
        minVersion: "TLSv1.2" as const,
        rejectUnauthorized: true,
        ca: this.collector.credential.ca,
        ...(input.credential.mode === "mtls"
          ? {
              cert: input.credential.certificate,
              key: input.credential.privateKey,
            }
          : {}),
      };
      if (input.protocol === "https") {
        const req = request(
          {
            hostname: "127.0.0.1",
            port: this.collector.httpsPort,
            path: "/events",
            method: "POST",
            agent: false,
            ...tls,
            headers: {
              "content-type":
                input.format === "json"
                  ? "application/json"
                  : "text/plain; charset=utf-8",
              "content-length": input.body.length,
              ...(input.credential.mode === "bearer"
                ? { authorization: `Bearer ${input.credential.token}` }
                : {}),
            },
          },
          (res) => {
            const status = res.statusCode ?? 0;
            finish(
              status >= 200 && status < 300
                ? result("accepted", status, null, false)
                : result(
                    "failed",
                    status,
                    `http_${status}`,
                    status === 429 || status >= 500,
                  ),
            );
            res.destroy();
          },
        );
        socket = req;
        req.on("error", () =>
          finish(result("failed", null, "network_error", true)),
        );
        req.end(input.body);
      } else {
        if (input.credential.mode !== "mtls") {
          finish(result("failed", null, "credential_invalid", false));
          return;
        }
        const conn = connect(
          { host: "127.0.0.1", port: this.collector.syslogPort, ...tls },
          () => {
            const message = Buffer.concat([
              Buffer.from(
                `<134>1 ${new Date().toISOString()} - CRA-Sentinel - audit - `,
              ),
              input.body,
            ]);
            conn.write(
              Buffer.concat([Buffer.from(`${message.length} `), message]),
              (err) => {
                finish(
                  err
                    ? result("failed", null, "network_error", true)
                    : result("sent_unacknowledged", null, null, false),
                );
                conn.end();
              },
            );
          },
        );
        socket = conn;
        conn.on("error", () =>
          finish(result("failed", null, "network_error", true)),
        );
      }
    });
  }
}
function result(
  outcome: SiemTransportResult["outcome"],
  status: number | null,
  code: string | null,
  retryable: boolean,
): SiemTransportResult {
  return {
    outcome,
    status,
    code,
    retryable,
    category: code ? "fixture" : null,
    retryAfterSeconds: status === 429 ? 1 : null,
    durationMs: 1,
    responseBytes: 0,
  };
}
