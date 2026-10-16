import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, open, unlink } from "node:fs/promises";
import { createServer, request, type Server } from "node:http";
import { createConnection } from "node:net";
import { dirname } from "node:path";
import {
  upgradeControlRequestSchema,
  upgradeControlResponseSchema,
} from "@repo/contracts/upgrades/schemas";
import type {
  UpgradeControlRequest,
  UpgradeControlResponse,
} from "@repo/contracts/upgrades/types";
import type {
  UpgradeActor,
  UpgradeControlAction,
  UpgradeControlPort,
} from "../../application/upgrade-control.port";
import { UpgradeControlError } from "../../application/upgrade-supervisor.port";
import { NativeFlock, type UpgradeJournalLock } from "../journal/native-flock";

interface Configuration {
  readonly socketPath: string;
  readonly key: Buffer;
  readonly instanceId: string;
  readonly lock?: UpgradeJournalLock;
}
const REQUEST_LIMIT = 32 * 1024;
const RESPONSE_LIMIT = 1024 * 1024;
const TIMEOUT = 10_000;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function signature(
  key: Buffer,
  kind: "request" | "response",
  value: unknown,
): string {
  return createHmac("sha256", key)
    .update(`CRA-UPGRADE-CONTROL-${kind}-V1\0`)
    .update(canonical(value))
    .digest("hex");
}
function authentic(
  key: Buffer,
  kind: "request" | "response",
  value: { mac: string },
): boolean {
  const { mac, ...payload } = value;
  return timingSafeEqual(
    Buffer.from(mac, "hex"),
    Buffer.from(signature(key, kind, payload), "hex"),
  );
}
function check(config: Configuration) {
  if (
    config.key.length < 32 ||
    !config.socketPath.startsWith("/") ||
    config.socketPath.length > 100
  )
    throw new Error("Private upgrade control configuration required");
}
export class UpgradeControlTransportError extends UpgradeControlError {
  constructor(readonly status: 401 | 403 | 409 | 503 = 503) {
    super(status);
  }
}
export async function readUpgradeControlKey(path: string): Promise<Buffer> {
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await fd.stat();
    if (
      !stat.isFile() ||
      stat.size < 32 ||
      stat.size > 4096 ||
      (stat.mode & 0o077) !== 0
    )
      throw new UpgradeControlTransportError();
    const key = await fd.readFile();
    if (key.length !== stat.size) throw new UpgradeControlTransportError();
    return key;
  } finally {
    await fd.close();
  }
}

/** Independent ingress owns no Docker credentials; only this private authenticated channel. */
export class LocalUpgradeControlClient implements UpgradeControlPort {
  private readonly key: Buffer;
  constructor(private readonly config: Configuration) {
    check(config);
    this.key = Buffer.from(config.key);
  }
  async execute(
    instanceId: string,
    actor: UpgradeActor,
    action: UpgradeControlAction,
    input?: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (instanceId !== this.config.instanceId)
      throw new UpgradeControlTransportError(403);
    const payload = {
      requestId: randomUUID(),
      instanceId,
      actor,
      action,
      ...(input ? { input } : {}),
      issuedAt: new Date().toISOString(),
    };
    const envelope = upgradeControlRequestSchema.parse({
      ...payload,
      mac: signature(this.key, "request", payload),
    });
    const bytes = JSON.stringify(envelope);
    if (Buffer.byteLength(bytes) > REQUEST_LIMIT)
      throw new UpgradeControlTransportError();
    return new Promise((resolve, reject) => {
      const call = request(
        {
          socketPath: this.config.socketPath,
          path: "/execute",
          method: "POST",
          timeout: TIMEOUT,
          signal,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(bytes),
          },
        },
        (response) => {
          let received = 0;
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => {
            received += chunk.length;
            if (received > RESPONSE_LIMIT)
              response.destroy(new UpgradeControlTransportError());
            else chunks.push(chunk);
          });
          response.on("error", () =>
            reject(new UpgradeControlTransportError()),
          );
          response.on("end", () => {
            try {
              if (response.statusCode !== 200)
                throw new UpgradeControlTransportError();
              const result = upgradeControlResponseSchema.parse(
                JSON.parse(Buffer.concat(chunks).toString("utf8")),
              );
              if (
                result.requestId !== envelope.requestId ||
                !authentic(this.key, "response", result)
              )
                throw new UpgradeControlTransportError();
              if (!result.ok)
                throw new UpgradeControlTransportError(result.status);
              resolve(result.value);
            } catch (error) {
              reject(
                error instanceof UpgradeControlTransportError
                  ? error
                  : new UpgradeControlTransportError(),
              );
            }
          });
        },
      );
      call.on("timeout", () =>
        call.destroy(new UpgradeControlTransportError()),
      );
      call.on("error", () => reject(new UpgradeControlTransportError()));
      call.end(bytes);
    });
  }
}

/** No public TCP listener, unsigned responses, secret arguments or exception text. */
export async function createUpgradeControlServer(
  config: Configuration,
  control: UpgradeControlPort,
): Promise<Server> {
  check(config);
  const directory = await lstat(dirname(config.socketPath));
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    (directory.mode & 0o077) !== 0
  )
    throw new UpgradeControlTransportError();
  const key = Buffer.from(config.key);
  const server = createServer((incoming, response) => {
    if (
      incoming.method !== "POST" ||
      incoming.url !== "/execute" ||
      incoming.headers["content-type"] !== "application/json"
    ) {
      response.writeHead(401).end();
      return;
    }
    let received = 0;
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > REQUEST_LIMIT) {
        response.writeHead(413).end();
        incoming.destroy();
      } else chunks.push(chunk);
    });
    incoming.on("error", () => {
      if (!response.writableEnded) response.writeHead(503).end();
    });
    incoming.on("end", () => {
      let envelope: UpgradeControlRequest;
      try {
        envelope = upgradeControlRequestSchema.parse(
          JSON.parse(Buffer.concat(chunks).toString("utf8")),
        );
        if (
          envelope.instanceId !== config.instanceId ||
          !authentic(key, "request", envelope) ||
          Math.abs(Date.now() - Date.parse(envelope.issuedAt)) > 30_000
        )
          throw new UpgradeControlTransportError();
      } catch {
        response.writeHead(401).end();
        return;
      }
      const abort = new AbortController();
      response.on("close", () => abort.abort());
      const send = (result: Omit<UpgradeControlResponse, "mac">) => {
        try {
          const value = upgradeControlResponseSchema.parse({
            ...result,
            mac: signature(key, "response", result),
          });
          const output = JSON.stringify(value);
          if (Buffer.byteLength(output) > RESPONSE_LIMIT)
            throw new UpgradeControlTransportError();
          response
            .writeHead(200, {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            })
            .end(output);
        } catch {
          response.writeHead(503).end();
        }
      };
      void control
        .execute(
          envelope.instanceId,
          envelope.actor,
          envelope.action,
          envelope.input,
          abort.signal,
        )
        .then(
          (value) =>
            send({
              requestId: envelope.requestId,
              ok: true,
              status: 200,
              value,
            } as Omit<UpgradeControlResponse, "mac">),
          (error: unknown) => {
            const candidate =
              error instanceof UpgradeControlError ? error.status : 503;
            send({
              requestId: envelope.requestId,
              ok: false,
              status: candidate,
            });
          },
        );
    });
  });
  server.requestTimeout = TIMEOUT;
  server.headersTimeout = TIMEOUT;
  try {
    await (config.lock ?? new NativeFlock()).run(
      `${config.socketPath}.startup-lock`,
      async (signal) => {
        signal.throwIfAborted();
        await removeOwnedStaleSocket(config.socketPath);
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(config.socketPath, () => {
            server.off("error", reject);
            resolve();
          });
        });
        await chmod(config.socketPath, 0o600);
        signal.throwIfAborted();
      },
    );
  } catch (error) {
    if (server.listening)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    throw error;
  }
  return server;
}

/** A kernel startup lock serializes probe/unlink/bind; never remove a live or foreign path. */
async function removeOwnedStaleSocket(path: string): Promise<void> {
  const previous = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw new UpgradeControlTransportError();
  });
  if (!previous) return;
  if (
    !previous.isSocket() ||
    (previous.mode & 0o077) !== 0 ||
    previous.uid !== process.getuid?.()
  )
    throw new UpgradeControlTransportError();
  const refused = await new Promise<boolean>((resolve) => {
    const probe = createConnection(path);
    probe.setTimeout(1000);
    probe.once("connect", () => {
      probe.destroy();
      resolve(false);
    });
    probe.once("error", (error: NodeJS.ErrnoException) => {
      resolve(error.code === "ECONNREFUSED");
    });
    probe.once("timeout", () => {
      probe.destroy();
      resolve(false);
    });
  });
  if (!refused) throw new UpgradeControlTransportError(409);
  const current = await lstat(path);
  if (
    !current.isSocket() ||
    current.ino !== previous.ino ||
    current.dev !== previous.dev
  )
    throw new UpgradeControlTransportError(409);
  await unlink(path);
}
