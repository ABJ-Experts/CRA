import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { Agent, request, createServer } from "node:https";
import { PrivateMetadataTransport } from "./operator-transport";
import {
  createOperatorApplication,
  OperatorIngressModule,
} from "./operator-listener";
import { TLSSocket } from "node:tls";
import type { INestApplication } from "@nestjs/common";
const instanceId = "20000000-0000-4000-8000-000000000001";
const principalId = "10000000-0000-4000-8000-000000000001";
import { OperatorController } from "./operator.controller";
it("exposes the private controller through only its dedicated static module graph", () => {
  expect(Reflect.getMetadata("controllers", OperatorIngressModule)).toEqual([
    OperatorController,
  ]);
});
describe("real mTLS private operator composition", () => {
  let successfulReads = false;
  let directory: string;
  let app: INestApplication;
  let ca: Buffer;
  let cert: Buffer;
  let key: Buffer;
  let url: string;
  let agent: Agent;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "operator-tls-"));
    const openssl = (args: string[]) =>
      execFileSync("openssl", args, { cwd: directory, stdio: "ignore" });
    openssl([
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      "ca.key",
      "-out",
      "ca.pem",
      "-days",
      "1",
      "-subj",
      "/CN=Task operator CA",
    ]);
    for (const name of ["server", "client"]) {
      openssl([
        "req",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        `${name}.key`,
        "-out",
        `${name}.csr`,
        "-subj",
        `/CN=${name}`,
      ]);
      await writeFile(
        join(directory, `${name}.ext`),
        name === "server"
          ? "subjectAltName=IP:127.0.0.1\nextendedKeyUsage=serverAuth"
          : "extendedKeyUsage=clientAuth",
      );
      openssl([
        "x509",
        "-req",
        "-in",
        `${name}.csr`,
        "-CA",
        "ca.pem",
        "-CAkey",
        "ca.key",
        "-CAcreateserial",
        "-out",
        `${name}.pem`,
        "-days",
        "1",
        "-extfile",
        `${name}.ext`,
      ]);
    }
    ca = await readFile(join(directory, "ca.pem"));
    cert = await readFile(join(directory, "client.pem"));
    key = await readFile(join(directory, "client.key"));
    const grant = {
      fingerprint256: new X509Certificate(cert).fingerprint256,
      principalId,
      instanceIds: [instanceId],
      tenantScopes: [],
    };
    await writeFile(
      join(directory, "grants.json"),
      JSON.stringify({ revision: "r1", grants: [grant] }),
    );
    await writeFile(
      join(directory, "index.html"),
      "<html><script>window.operatorReady = true;</script></html>",
    );
    app = await createOperatorApplication(
      {
        instanceId,
        host: "127.0.0.1",
        port: 0,
        ca,
        cert: await readFile(join(directory, "server.pem")),
        key: await readFile(join(directory, "server.key")),
        grantsPath: join(directory, "grants.json"),
        staticRoot: directory,
      },
      {
        read: (_identity, kind) => {
          if (!successfulReads)
            return Promise.reject(new Error("audit unavailable secret"));
          const stamp = "2026-01-01T00:00:00.000Z";
          const instance = { instanceId, label: "Private" };
          return Promise.resolve(
            kind === "instances"
              ? {
                  schemaVersion: 1,
                  observedAt: stamp,
                  instances: [instance],
                  nextCursor: null,
                }
              : kind === "detail"
                ? { schemaVersion: 1, observedAt: stamp, instance }
                : kind === "tenants"
                  ? {
                      schemaVersion: 1,
                      observedAt: stamp,
                      instanceId,
                      tenants: [],
                      nextCursor: null,
                    }
                  : {
                      schemaVersion: 1,
                      observedAt: stamp,
                      sourceAt: stamp,
                      revision: 1,
                      instanceId,
                      instance,
                      tenants: [],
                      nextCursor: null,
                    },
          );
        },
      },
    );
    await app.listen(0, "127.0.0.1");
    url = await app.getUrl();
    agent = new Agent({ ca, cert, key, keepAlive: true, maxSockets: 1 });
  });
  afterAll(async () => {
    agent?.destroy();
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  });
  const get = (
    path: string,
    client: Agent = agent,
    headers: Record<string, string> = {},
  ) =>
    new Promise<{
      status: number;
      body: string;
      socket: unknown;
      headers: Record<string, unknown>;
    }>((resolve, reject) => {
      const req = request(
        `${url}${path}`,
        { agent: client, headers },
        (res) => {
          const socket = res.socket;
          let body = "";
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () =>
            resolve({
              status: res.statusCode!,
              body,
              socket,
              headers: res.headers,
            }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    });
  it("rejects header/JWT/cookie authority without a verified client certificate", async () => {
    const anonymous = new Agent({ ca });
    await expect(
      get("/api/v1/operator/session", anonymous, {
        "x-forwarded-client-cert": "operator",
        authorization: "Bearer owner",
        cookie: "cra_at=owner",
      }),
    ).rejects.toThrow();
    anonymous.destroy();
  });
  it("serves only scoped operator routes and redacts audit failures", async () => {
    expect(
      JSON.parse((await get("/api/v1/operator/session")).body),
    ).toMatchObject({ principalId, allowedInstanceIds: [instanceId] });
    expect((await get("/api/v1/auth/me")).status).toBe(404);
    expect(
      (await get("/api/v1/operator/instances?tenantId=forged")).status,
    ).toBe(400);
    const failed = await get("/api/v1/operator/instances");
    expect(failed.status).toBe(500);
    expect(failed.body).not.toContain("secret");
  });
  it("exposes only parsed scoped metadata successes and domain denial statuses", async () => {
    successfulReads = true;
    for (const path of [
      "/api/v1/operator/instances",
      `/api/v1/operator/instances/${instanceId}`,
      `/api/v1/operator/instances/${instanceId}/tenants`,
      "/api/v1/operator/instance-metadata",
    ])
      expect((await get(path)).status).toBe(200);
    expect(
      (
        await get(
          "/api/v1/operator/instances/30000000-0000-4000-8000-000000000001",
        )
      ).status,
    ).toBe(404);
    expect(
      (await get("/api/v1/operator/instances?cursor=eyJ4IjoxfQ")).status,
    ).toBe(400);
    expect((await get("/api/v1/operator/instances/not-a-uuid")).status).toBe(
      400,
    );
    successfulReads = false;
  });
  it("serves exported assets with their inline hydration hash and refuses mounted secrets", async () => {
    const document = await get("/");
    expect(document.status).toBe(200);
    const hash = createHash("sha256")
      .update("window.operatorReady = true;")
      .digest("base64");
    expect(document.headers["content-security-policy"]).toContain(
      `'sha256-${hash}'`,
    );
    expect((await get("/ca.key")).status).toBe(404);
    expect((await get("/grants.json")).status).toBe(404);
  });
  it("uses fixed verified private transport and rejects redirect/oversize/malformed pages", async () => {
    let body = '{"safe":true}';
    let status = 200;
    let declared: string | undefined;
    const server = createServer(
      {
        ca,
        cert: await readFile(join(directory, "server.pem")),
        key: await readFile(join(directory, "server.key")),
        requestCert: true,
        rejectUnauthorized: true,
      },
      (req, res) => {
        res.statusCode = status;
        if (declared) res.setHeader("Content-Length", declared);
        res.end(body);
      },
    );
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as { port: number };
    const target = {
      instanceId,
      endpoint: `https://127.0.0.1:${address.port}`,
      ca,
      cert,
      key,
    };
    const transport = new PrivateMetadataTransport();
    try {
      expect(
        await transport.read(target, "cursor", AbortSignal.timeout(5000)),
      ).toEqual({ safe: true });
      status = 302;
      await expect(
        transport.read(target, null, AbortSignal.timeout(5000)),
      ).rejects.toThrow();
      status = 200;
      declared = "300000";
      await expect(
        transport.read(target, null, AbortSignal.timeout(5000)),
      ).rejects.toThrow();
      declared = undefined;
      body = "x".repeat(256 * 1024 + 1);
      await expect(
        transport.read(target, null, AbortSignal.timeout(5000)),
      ).rejects.toThrow();
      body = "{bad";
      await expect(
        transport.read(target, null, AbortSignal.timeout(5000)),
      ).rejects.toThrow("Invalid private metadata JSON");
      await expect(
        transport.read(
          { ...target, ca: Buffer.alloc(0) },
          null,
          AbortSignal.timeout(5000),
        ),
      ).rejects.toThrow();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("fails closed on changed malformed grant mounts and keeps dependency errors private", async () => {
    const path = join(directory, "grants.json");
    const original = await readFile(path);
    await writeFile(path, "{bad");
    try {
      const denied = await get("/api/v1/operator/session");
      expect(denied.status).toBe(503);
      expect(denied.body).not.toContain("SyntaxError");
    } finally {
      await writeFile(path, original);
    }
    await expect(
      createOperatorApplication(
        {
          instanceId,
          host: "0.0.0.0",
          port: 3444,
          ca,
          cert,
          key,
          grantsPath: path,
          staticRoot: directory,
        },
        { read: () => Promise.resolve({}) },
      ),
    ).rejects.toThrow("private bind address");
  });
  it("throttles verified certificate traffic and resets the bounded window", async () => {
    let status = 200;
    for (let index = 0; index < 121; index++) {
      status = (await get("/api/v1/operator/session")).status;
      if (status === 429) break;
    }
    expect(status).toBe(429);
    const realNow = Date.now();
    const now = jest.spyOn(Date, "now").mockReturnValue(realNow + 61000);
    try {
      expect((await get("/api/v1/operator/session")).status).toBe(200);
    } finally {
      now.mockRestore();
    }
  });
  it("revokes an already authenticated keepalive connection from fresh mounted grants", async () => {
    const before = await get("/api/v1/operator/session");
    expect(before.status).toBe(200);
    expect(before.socket).toBeInstanceOf(TLSSocket);
    expect((before.socket as TLSSocket).getProtocol()).toMatch(/^TLSv1\.[23]$/);
    await writeFile(
      join(directory, "grants.json"),
      JSON.stringify({ revision: "r2", grants: [] }),
    );
    const revoked = await get("/api/v1/operator/session", agent, {
      "x-operator-role": "owner",
    });
    expect(revoked.status).toBe(401);
    expect(revoked.socket).toBe(before.socket);
  });
});
