import { execFileSync } from "node:child_process";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { mkdtemp, readFile, rm, chmod } from "node:fs/promises";
import { createServer, request } from "node:https";
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { WebhookTransportResult } from "../src/connectors/infrastructure/node-webhook-transport";

type Key = Readonly<{ keyId: string; secret: string }>;
type Capture = Readonly<{
  eventId: string;
  deliveryId: string;
  timestamp: string;
  body: string;
  sha256: string;
  verifiedKeyIds: readonly string[];
  status: number;
}>;
const hostname = "receiver.m11-03.test";

/** Test-only TLS adapter. Production DNS policy is verified separately; never inject this outside the fixture. */
export class M1103Receiver {
  readonly url = `https://${hostname}/delivery`;
  behavior: "success" | "outage" | "rate_limit" | "timeout" = "success";
  private keys: readonly Key[] = [];
  private observations: readonly Capture[] = [];
  private constructor(
    private readonly server: ReturnType<typeof createServer>,
    private readonly directory: string,
    private readonly certificate: Buffer,
  ) {}
  get captures() {
    return this.observations;
  }
  setKeys(keys: readonly Key[]) {
    this.keys = keys.map((key) => ({ ...key }));
  }

  static async start() {
    const directory = await mkdtemp(join(tmpdir(), "cra-m11-03-tls-"));
    try {
      const keyPath = join(directory, "receiver.key");
      const certPath = join(directory, "receiver.crt");
      execFileSync(
        "openssl",
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-keyout",
          keyPath,
          "-out",
          certPath,
          "-days",
          "1",
          "-subj",
          `/CN=${hostname}`,
          "-addext",
          `subjectAltName=DNS:${hostname}`,
        ],
        { stdio: "ignore" },
      );
      await chmod(keyPath, 0o600);
      const certificate = await readFile(certPath);
      const server = createServer({
        key: await readFile(keyPath),
        cert: certificate,
        maxHeaderSize: 16_384,
      });
      const receiver = new M1103Receiver(server, directory, certificate);
      server.on("request", (req, res) => {
        const chunks: Buffer[] = [];
        let length = 0;
        req.on("data", (chunk: Buffer) => {
          length += chunk.length;
          if (length > 8192) req.destroy();
          else chunks.push(chunk);
        });
        req.on("end", () => {
          const body = Buffer.concat(chunks);
          const verifiedKeyIds = receiver.verify(body, req.headers);
          const status = !verifiedKeyIds.length
            ? 401
            : receiver.behavior === "outage"
              ? 503
              : receiver.behavior === "rate_limit"
                ? 429
                : 204;
          receiver.observations = [
            ...receiver.observations,
            Object.freeze({
              eventId: header(req.headers, "cra-webhook-event-id"),
              deliveryId: header(req.headers, "cra-webhook-delivery-id"),
              timestamp: header(req.headers, "cra-webhook-timestamp"),
              body: body.toString("utf8"),
              sha256: createHash("sha256").update(body).digest("hex"),
              verifiedKeyIds,
              status,
            }),
          ];
          if (receiver.behavior === "timeout" && verifiedKeyIds.length) return;
          if (status === 429) res.setHeader("Retry-After", "5");
          res.writeHead(status);
          res.end(
            status === 204
              ? undefined
              : "m1103-receiver-body-canary-do-not-store",
          );
        });
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      return receiver;
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  readonly transport = {
    validate: (url: string) => {
      const target = new URL(url);
      if (
        target.protocol !== "https:" ||
        target.hostname !== hostname ||
        target.port ||
        target.username ||
        target.password ||
        target.search ||
        target.hash
      )
        return Promise.reject(
          new Error("Destination outside isolated fixture"),
        );
      return Promise.resolve();
    },
    post: async (input: {
      url: string;
      body: Buffer;
      headers: OutgoingHttpHeaders;
      beforeSend?: () => Promise<void | boolean>;
    }): Promise<WebhookTransportResult> => {
      await this.transport.validate(input.url);
      if (input.beforeSend && (await input.beforeSend()) === false)
        throw new Error("Fixture authorization denied");
      const started = Date.now();
      return new Promise((resolve) => {
        const failure = (
          status: number | null,
          category: string,
          code: string,
          retryAfterSeconds: number | null = null,
        ): WebhookTransportResult => ({
          outcome: "failed",
          status,
          category,
          code,
          retryAfterSeconds,
          durationMs: Date.now() - started,
          responseBytes: 0,
        });
        const req = request(
          {
            hostname,
            family: 4,
            servername: hostname,
            port: (this.server.address() as AddressInfo).port,
            path: new URL(input.url).pathname,
            method: "POST",
            ca: this.certificate,
            rejectUnauthorized: true,
            lookup: (_host, _options, callback) =>
              callback(null, "127.0.0.1", 4),
            headers: {
              ...input.headers,
              "content-type": "application/json",
              "content-length": input.body.length,
            },
            maxHeaderSize: 16_384,
          },
          (res) => {
            const status = res.statusCode ?? 0;
            resolve(
              status >= 200 && status < 300
                ? {
                    outcome: "succeeded",
                    status,
                    durationMs: Date.now() - started,
                    responseBytes: 0,
                  }
                : failure(
                    status,
                    status === 429
                      ? "rate_limit"
                      : status >= 500
                        ? "receiver_unavailable"
                        : "receiver_rejected",
                    `http_${status}`,
                    status === 429 ? 5 : null,
                  ),
            );
            res.destroy();
          },
        );
        req.setTimeout(1000, () => {
          resolve(failure(null, "timeout", "delivery_timeout"));
          req.destroy();
        });
        req.once("error", () =>
          resolve(failure(null, "receiver_unavailable", "network_error")),
        );
        req.end(input.body);
      });
    },
  };

  private verify(
    body: Buffer,
    headers: IncomingHttpHeaders,
  ): readonly string[] {
    const timestamp = header(headers, "cra-webhook-timestamp");
    if (
      !/^(0|[1-9]\d{0,15})$/.test(timestamp) ||
      !Number.isSafeInteger(Number(timestamp)) ||
      Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300
    )
      return [];
    const eventId = header(headers, "cra-webhook-event-id");
    const deliveryId = header(headers, "cra-webhook-delivery-id");
    return header(headers, "cra-webhook-signatures")
      .split(",")
      .flatMap((entry) => {
        const match = /^kid=([a-f0-9-]{36});v1=([a-f0-9]{64})$/.exec(entry);
        const key = this.keys.find(
          (candidate) => candidate.keyId === match?.[1],
        );
        if (!match || !key) return [];
        const expected = createHmac("sha256", Buffer.from(key.secret, "base64"))
          .update(`v1\n${timestamp}\n${key.keyId}\n${eventId}\n${deliveryId}\n`)
          .update(body)
          .digest();
        return timingSafeEqual(expected, Buffer.from(match[2]!, "hex"))
          ? [key.keyId]
          : [];
      });
  }

  async close() {
    this.server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      this.server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(this.directory, { recursive: true, force: true });
  }
}

function header(headers: IncomingHttpHeaders, name: string): string {
  const value = headers[name];
  return typeof value === "string" ? value : "";
}
