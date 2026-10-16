import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UpgradeHostJournal } from "../journal/upgrade-host-journal";
import {
  createUpgradeAuditRuntime,
  upgradeAuditRuntimeConfigurationSchema,
} from "./upgrade-audit-runtime";
const id = "15000000-0000-4000-8000-000000000606";
const actorId = "15000000-0000-4000-8000-000000000601";
const jwt = (role: string) =>
  `header.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature`;

describe("production durable upgrade audit runtime", () => {
  let root: string;
  let server: Server;
  let endpoint: string;
  let requests: Record<string, unknown>[];
  let status: number;
  let payload: unknown;
  let redirect: boolean;
  const audit = {
    actorId,
    action: "upgrade.apply",
    outcome: "intent",
    metadata: { runId: id, stage: "ready", version: 1 },
  };
  const journal = () =>
    new UpgradeHostJournal({
      root: join(root, "journal"),
      key: Buffer.alloc(32, 7),
      instanceId: id,
      minimumSequence: 0,
      lock: { run: (_path, effect) => effect(new AbortController().signal) },
    });
  const config = () => ({
    endpoint,
    projectApiKey: "sb_publishable_local",
    credentialPath: join(root, "credential"),
  });
  const append = () =>
    journal().append({
      expectedVersion: 0,
      idempotencyKey: "apply-1",
      runId: id,
      kind: "audit-pending",
      data: { audit },
    });
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "upgrade-audit-runtime-"));
    await mkdir(join(root, "journal"), { mode: 0o700 });
    await writeFile(join(root, "credential"), jwt("service_role"), {
      mode: 0o600,
    });
    requests = [];
    status = 200;
    payload = [{ outcome: "inserted", audit_id: id }];
    redirect = false;
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        requests.push({
          path: req.url,
          authorization: req.headers.authorization,
          apikey: req.headers.apikey,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
        });
        if (redirect) {
          res.writeHead(302, { location: `${endpoint}/other` });
          res.end();
          return;
        }
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw Error("server");
    endpoint = `http://127.0.0.1:${address.port}`;
  });
  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(root, { recursive: true, force: true });
  });
  it("writes only authenticated already durable facts to fixed local RPC and durably acknowledges", async () => {
    const record = await append();
    const runtime = await createUpgradeAuditRuntime(config(), {
      journal: journal(),
    });
    await runtime.flush();
    await runtime.flush();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      path: "/rest/v1/rpc/m13_01_append_audit_event",
      authorization: `Bearer ${jwt("service_role")}`,
      apikey: "sb_publishable_local",
      body: {
        p_event_key: `upgrade:${id}:1`,
        p_actor_type: "operator",
        p_actor_id: actorId,
        p_action: "upgrade.apply",
        p_after_redacted: audit.metadata,
      },
    });
    const records = await journal().read();
    expect(records[1]).toMatchObject({
      kind: "audit-ack",
      data: { auditSequence: 1, auditHash: record.hash, auditId: id },
    });
  });
  it("replays a lost acknowledgement idempotently without changing the original projection", async () => {
    const record = await append();
    const runtime = await createUpgradeAuditRuntime(config(), {
      journal: journal(),
    });
    await runtime.appendPending(record);
    payload = [{ outcome: "replayed", audit_id: id }];
    await runtime.flush();
    expect(requests).toHaveLength(2);
    expect(requests[0]?.body).toEqual(requests[1]?.body);
    expect(await journal().read()).toHaveLength(2);
  });
  it("rejects forged sequence/hash/projection before HTTP", async () => {
    const record = await append();
    const runtime = await createUpgradeAuditRuntime(config(), {
      journal: journal(),
    });
    await expect(
      runtime.appendPending({ ...record, hash: "a".repeat(64) }),
    ).rejects.toThrow();
    await expect(
      runtime.appendPending({
        ...record,
        data: { audit: { ...audit, outcome: "completed" } },
      }),
    ).rejects.toThrow();
    await expect(
      runtime.appendPending({
        ...record,
        data: { audit: { ...audit, metadata: { password: "secret" } } },
      }),
    ).rejects.toThrow();
    expect(requests).toHaveLength(0);
  });
  it.each([503, 401])(
    "leaves pending intent durable and unacknowledged on HTTP %s",
    async (code) => {
      await append();
      const runtime = await createUpgradeAuditRuntime(config(), {
        journal: journal(),
      });
      status = code;
      await expect(runtime.flush()).rejects.toThrow("unavailable");
      expect(await journal().read()).toHaveLength(1);
      status = 200;
      await runtime.flush();
      expect(await journal().read()).toHaveLength(2);
    },
  );
  it("refuses redirects, oversized and conflicting receipts without losing durable intent", async () => {
    await append();
    const runtime = await createUpgradeAuditRuntime(config(), {
      journal: journal(),
    });
    redirect = true;
    await expect(runtime.flush()).rejects.toThrow("unavailable");
    redirect = false;
    payload = [{ outcome: "conflict", audit_id: id }];
    await expect(runtime.flush()).rejects.toThrow("unavailable");
    payload = "x".repeat(9000);
    await expect(runtime.flush()).rejects.toThrow("unavailable");
    expect(await journal().read()).toHaveLength(1);
  });
  it("fails closed on invalid private credentials, public key or endpoint configuration", async () => {
    expect(() =>
      upgradeAuditRuntimeConfigurationSchema.parse({
        ...config(),
        endpoint: "https://remote.example",
      }),
    ).toThrow();
    expect(() =>
      upgradeAuditRuntimeConfigurationSchema.parse({
        ...config(),
        endpoint: `${endpoint}/arbitrary`,
      }),
    ).toThrow();
    await chmod(join(root, "credential"), 0o644);
    await expect(
      createUpgradeAuditRuntime(config(), { journal: journal() }),
    ).rejects.toThrow();
    await chmod(join(root, "credential"), 0o600);
    await writeFile(join(root, "credential"), jwt("anon"));
    await expect(
      createUpgradeAuditRuntime(config(), { journal: journal() }),
    ).rejects.toThrow();
    await writeFile(join(root, "credential"), jwt("service_role"));
    await expect(
      createUpgradeAuditRuntime(
        { ...config(), projectApiKey: jwt("service_role") },
        { journal: journal() },
      ),
    ).rejects.toThrow();
    await expect(
      createUpgradeAuditRuntime(
        { ...config(), projectApiKey: jwt("anon") },
        { journal: journal() },
      ),
    ).resolves.toBeDefined();
  });
  it("rejects authenticated but invalid acknowledgement bindings", async () => {
    const record = await append();
    await journal().append({
      expectedVersion: 1,
      runId: id,
      kind: "audit-ack",
      idempotencyKey: "bad-ack",
      data: {
        auditSequence: record.sequence,
        auditHash: "f".repeat(64),
        auditId: id,
      },
    });
    const runtime = await createUpgradeAuditRuntime(config(), {
      journal: journal(),
    });
    await expect(runtime.flush()).rejects.toThrow("unavailable");
    expect(requests).toHaveLength(0);
  });
});
