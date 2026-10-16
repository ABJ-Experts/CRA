import assert from "node:assert/strict";
import { randomUUID, X509Certificate } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import https from "node:https";
import { test as liveTest } from "node:test";
import { createCertificates } from "./m15-03-tls-fixture.mjs";
import {
  operatorInstancesResponseSchema,
  operatorInstanceResponseSchema,
  operatorSessionResponseSchema,
  operatorTenantsResponseSchema,
} from "@repo/contracts/operator/schemas";

// No keys, credentials or certificates are committed. The actual listener and
// fixed narrow PostgREST adapter run against local, task-owned grants/fixtures.
const loadBuilt = createRequire(import.meta.url);
const databaseOrigin =
  process.env.M15_03_DATABASE_ORIGIN ?? "http://127.0.0.1:54321";
assert.ok(
  ["localhost", "127.0.0.1"].includes(new URL(databaseOrigin).hostname),
);
const fixture = process.env.M15_03_FIXTURE_MANIFEST
  ? JSON.parse(await readFile(process.env.M15_03_FIXTURE_MANIFEST, "utf8"))
      .operator
  : null;

function tlsRequest(origin, path, agent, headers = {}) {
  return new Promise((resolveResponse, reject) => {
    let socket;
    const request = https.get(
      new URL(path, origin),
      { agent, headers },
      (response) => {
        const chunks = [];
        let bytes = 0;
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 256 * 1024)
            response.destroy(new Error("Bounded operator response exceeded"));
          else chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () =>
          resolveResponse({
            status: response.statusCode,
            headers: response.headers,
            text: Buffer.concat(chunks).toString("utf8"),
            socket,
          }),
        );
      },
    );
    request.on("socket", (value) => {
      socket = value;
    });
    request.setTimeout(5_000, () =>
      request.destroy(new Error("TLS request budget exceeded")),
    );
    request.on("error", reject);
  });
}

liveTest(
  "real private mTLS listener with mounted grant revocation and narrow database authority",
  async (t) => {
    assert.ok(
      process.env.M15_03_READER_JWT_FILE,
      "Provide a mounted local narrow-reader JWT file",
    );
    const token = (
      await readFile(process.env.M15_03_READER_JWT_FILE, "utf8")
    ).trim();
    assert.ok(
      process.env.M15_03_PROJECT_API_KEY_FILE,
      "Provide a mounted local project API key file",
    );
    const projectApiKey = (
      await readFile(process.env.M15_03_PROJECT_API_KEY_FILE, "utf8")
    ).trim();
    const { createOperatorApplication } = loadBuilt(
      "../dist/operator/operator-listener.js",
    );
    const { NarrowRegistryClient } = loadBuilt(
      "../dist/operator/operator-registry.client.js",
    );
    const directory = await mkdtemp(join(tmpdir(), "cra-m15-03-tls-"));
    await chmod(directory, 0o700);
    try {
      const material = await createCertificates(directory);
      const fingerprint256 = new X509Certificate(material.cert).fingerprint256;
      const principalId = fixture?.principalId ?? randomUUID();
      const instanceId = fixture?.instanceId ?? randomUUID();
      const instanceIds = fixture?.instanceIds ?? [instanceId];
      const tenantScopes = fixture?.tenantScopes ?? [
        { instanceId, tenantIds: fixture?.tenantIds ?? [] },
      ];
      const tenantsFor = (id) =>
        tenantScopes
          .filter((scope) => scope.instanceId === id)
          .flatMap((scope) => scope.tenantIds);
      const tenantIds = tenantsFor(instanceId);
      const grant = { fingerprint256, principalId, instanceIds, tenantScopes };
      const grantsPath = join(directory, "grants.json");
      const grantFile = (revision, grants) =>
        writeFile(grantsPath, JSON.stringify({ revision, grants }), {
          mode: 0o600,
        });
      await grantFile("task-r1", [grant]);
      const app = await createOperatorApplication(
        {
          instanceId,
          host: "127.0.0.1",
          port: 0,
          ca: material.ca,
          cert: material.serverCert,
          key: material.serverKey,
          grantsPath,
          staticRoot: resolve(
            process.env.M15_03_OPERATOR_STATIC_ROOT ?? "apps/operator/out",
          ),
        },
        new NarrowRegistryClient(databaseOrigin, token, projectApiKey),
      );
      const allowed = new https.Agent({
        ca: material.ca,
        cert: material.cert,
        key: material.key,
        keepAlive: true,
        maxSockets: 1,
      });
      const noCertificate = new https.Agent({ ca: material.ca });
      const ungranted = new https.Agent({
        ca: material.ca,
        cert: material.ungrantedCert,
        key: material.ungrantedKey,
      });
      try {
        await app.listen(0, "127.0.0.1");
        const origin = await app.getUrl();
        await t.test(
          "raw TLS realm denies missing certificates and forwarded identity",
          async () => {
            await assert.rejects(
              tlsRequest(origin, "/api/v1/operator/session", noCertificate, {
                "X-Client-Cert": fingerprint256,
                Authorization: `Bearer ${token}`,
                Cookie: `cra_at=${token}`,
              }),
            );
            const denied = await tlsRequest(
              origin,
              "/api/v1/operator/session",
              ungranted,
              { "X-Operator-Role": "owner", "X-Client-Cert": fingerprint256 },
            );
            assert.equal(denied.status, 401);
          },
        );
        const first = await tlsRequest(
          origin,
          "/api/v1/operator/session",
          allowed,
          { "X-Operator-Role": "owner" },
        );
        assert.equal(first.status, 200);
        assert.equal(
          operatorSessionResponseSchema.parse(JSON.parse(first.text))
            .principalId,
          principalId,
        );
        assert.equal(first.headers["cache-control"], "no-store");
        await t.test(
          "static application shares authenticated TLS origin and tenant routes are absent",
          async () => {
            const staticPage = await tlsRequest(origin, "/", allowed);
            assert.equal(staticPage.status, 200);
            assert.match(staticPage.text, /<html/i);
            for (const path of [
              "/api/v1/auth/session",
              "/api/v1/system/health",
              "/api/v1/products",
            ]) {
              assert.equal(
                (await tlsRequest(origin, path, allowed)).status,
                404,
              );
            }
          },
        );
        await t.test("grant removal revokes a reused TLS socket", async () => {
          await grantFile("task-r2", []);
          const denied = await tlsRequest(
            origin,
            "/api/v1/operator/session",
            allowed,
          );
          assert.equal(
            denied.socket,
            first.socket,
            "Revocation must be checked on the existing TLS connection",
          );
          assert.equal(denied.status, 401);
          await grantFile("task-r3", [grant]);
          assert.equal(
            (await tlsRequest(origin, "/api/v1/operator/session", allowed))
              .status,
            200,
          );
        });
        await t.test(
          "narrow PostgREST credential cannot read tenant tables or invoke service RPCs",
          async () => {
            // A successful fixed metadata read proves the narrow credential passed
            // Kong and PostgREST; subsequent denials cannot pass from a bad API key.
            const permitted = await tlsRequest(
              origin,
              "/api/v1/operator/instances",
              allowed,
            );
            assert.equal(permitted.status, 200);
            operatorInstancesResponseSchema.parse(JSON.parse(permitted.text));
            for (const path of [
              "organizations?select=id&limit=1",
              "products?select=id&limit=1",
              "organization_license_states?select=organization_id&limit=1",
            ]) {
              const response = await fetch(
                `${databaseOrigin}/rest/v1/${path}`,
                {
                  headers: {
                    apikey: projectApiKey,
                    Authorization: `Bearer ${token}`,
                  },
                  redirect: "error",
                  signal: AbortSignal.timeout(5_000),
                },
              );
              assert.ok(
                [403, 404].includes(response.status),
                `Narrow reader must not expose ${path.split("?")[0]}`,
              );
            }
            const response = await fetch(
              `${databaseOrigin}/rest/v1/rpc/m15_02_read_usage`,
              {
                method: "POST",
                headers: {
                  apikey: projectApiKey,
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  p_organization_id: tenantIds[0] ?? randomUUID(),
                  p_actor_user_id: principalId,
                }),
                redirect: "error",
                signal: AbortSignal.timeout(5_000),
              },
            );
            assert.ok([403, 404].includes(response.status));
          },
        );
        await t.test(
          "actual scoped registry disclosure and cursor bind to mounted grant revision",
          { skip: !fixture?.seeded },
          async () => {
            const listed = await tlsRequest(
              origin,
              "/api/v1/operator/instances?limit=1",
              allowed,
            );
            assert.equal(listed.status, 200);
            const page = operatorInstancesResponseSchema.parse(
              JSON.parse(listed.text),
            );
            assert.ok(
              page.instances.length > 0,
              "Isolated registry fixture must be visible",
            );
            assert.ok(
              page.instances.every((item) =>
                instanceIds.includes(item.instanceId),
              ),
            );
            const detail = await tlsRequest(
              origin,
              `/api/v1/operator/instances/${instanceId}`,
              allowed,
            );
            assert.equal(detail.status, 200);
            assert.equal(
              operatorInstanceResponseSchema.parse(JSON.parse(detail.text))
                .instance.instanceId,
              instanceId,
            );
            const tenants = await tlsRequest(
              origin,
              `/api/v1/operator/instances/${instanceId}/tenants`,
              allowed,
            );
            assert.equal(tenants.status, 200);
            assert.ok(
              operatorTenantsResponseSchema
                .parse(JSON.parse(tenants.text))
                .tenants.every((item) => tenantIds.includes(item.tenantId)),
            );
            for (const otherInstanceId of instanceIds.filter(
              (id) => id !== instanceId,
            )) {
              const response = await tlsRequest(
                origin,
                `/api/v1/operator/instances/${otherInstanceId}/tenants`,
                allowed,
              );
              assert.equal(response.status, 200);
              const page = operatorTenantsResponseSchema.parse(
                JSON.parse(response.text),
              );
              assert.ok(
                page.tenants.every((item) =>
                  tenantsFor(otherInstanceId).includes(item.tenantId),
                ),
                "A reused remote tenant UUID must require a grant for the second instance tuple",
              );
              if (tenantsFor(otherInstanceId).length === 0)
                assert.deepEqual(page.tenants, []);
            }
            assert.equal(
              (
                await tlsRequest(
                  origin,
                  `/api/v1/operator/instances/${randomUUID()}`,
                  allowed,
                )
              ).status,
              404,
            );
            assert.equal(
              (
                await tlsRequest(
                  origin,
                  "/api/v1/operator/instances?limit=101",
                  allowed,
                )
              ).status,
              400,
            );
            assert.equal(
              (
                await tlsRequest(
                  origin,
                  "/api/v1/operator/instances?tenantId=forged",
                  allowed,
                )
              ).status,
              400,
            );
            const { PrivateMetadataTransport } = loadBuilt(
              "../dist/operator/operator-transport.js",
            );
            const { validateSourcePage } = loadBuilt(
              "../dist/operator/operator-collector.js",
            );
            const metadata = await new PrivateMetadataTransport().read(
              {
                instanceId,
                endpoint: origin,
                ca: material.ca,
                cert: material.cert,
                key: material.key,
              },
              null,
              AbortSignal.timeout(5_000),
            );
            assert.equal(
              validateSourcePage(metadata, instanceId, Date.now()).instanceId,
              instanceId,
            );
            assert.throws(
              () => validateSourcePage(metadata, randomUUID(), Date.now()),
              /binding/,
            );
            if (page.nextCursor) {
              const following = await tlsRequest(
                origin,
                `/api/v1/operator/instances?limit=1&cursor=${page.nextCursor}`,
                allowed,
              );
              assert.equal(following.status, 200);
              const nextPage = operatorInstancesResponseSchema.parse(
                JSON.parse(following.text),
              );
              assert.ok(nextPage.instances.length > 0);
              assert.ok(
                nextPage.instances.every((item) =>
                  instanceIds.includes(item.instanceId),
                ),
              );
              assert.notEqual(
                nextPage.instances[0].instanceId,
                page.instances[0].instanceId,
              );
              await grantFile("task-r4", [grant]);
              assert.equal(
                (
                  await tlsRequest(
                    origin,
                    `/api/v1/operator/instances?cursor=${page.nextCursor}`,
                    allowed,
                  )
                ).status,
                400,
              );
            }
            if (instanceIds.length > 1)
              assert.ok(
                page.nextCursor,
                "Multiple isolated instances must exercise keyset pagination",
              );
          },
        );
        await t.test(
          "failed private collection retains successful source times on task-owned observations",
          {
            skip:
              !fixture?.taskOwned ||
              !fixture?.seeded ||
              !process.env.M15_03_WORKER_JWT_FILE,
          },
          async () => {
            const { OperatorCollector } = loadBuilt(
              "../dist/operator/operator-collector.js",
            );
            const { PrivateMetadataTransport } = loadBuilt(
              "../dist/operator/operator-transport.js",
            );
            const { OperatorWorkerRepository } = loadBuilt(
              "../dist/operator/worker/operator-worker.repository.js",
            );
            const workerToken = (
              await readFile(process.env.M15_03_WORKER_JWT_FILE, "utf8")
            ).trim();
            const readDetail = async () => {
              const response = await tlsRequest(
                origin,
                `/api/v1/operator/instances/${instanceId}`,
                allowed,
              );
              assert.equal(response.status, 200);
              return operatorInstanceResponseSchema.parse(
                JSON.parse(response.text),
              ).instance;
            };
            const before = await readDetail();
            // Port 1 is a task-process request to an absent local source, not host
            // firewall or original audit/catalog alteration.
            const collector = new OperatorCollector(
              [
                {
                  instanceId,
                  endpoint: "https://127.0.0.1:1",
                  ca: material.ca,
                  cert: material.cert,
                  key: material.key,
                },
              ],
              new PrivateMetadataTransport(),
              new OperatorWorkerRepository(databaseOrigin, workerToken),
            );
            assert.equal(await collector.runOnce(), true);
            const after = await readDetail();
            assert.equal(after.status, "unreachable");
            assert.equal(after.lastObservedAt, before.lastObservedAt);
            assert.deepEqual(
              after.sources.map(
                ({
                  source,
                  sourceAt,
                  observedAt,
                  succeededAt,
                  receivedAt,
                }) => ({
                  source,
                  sourceAt,
                  observedAt,
                  succeededAt,
                  receivedAt,
                }),
              ),
              before.sources.map(
                ({
                  source,
                  sourceAt,
                  observedAt,
                  succeededAt,
                  receivedAt,
                }) => ({
                  source,
                  sourceAt,
                  observedAt,
                  succeededAt,
                  receivedAt,
                }),
              ),
            );
          },
        );
        await t.test(
          "a disposable database audit failure denies TLS metadata disclosure",
          {
            skip: !fixture?.auditFailure?.taskOwned,
          },
          async () => {
            const fault = fixture.auditFailure;
            assert.ok(
              ["localhost", "127.0.0.1"].includes(
                new URL(fault.databaseOrigin).hostname,
              ),
            );
            assert.notEqual(
              fault.databaseOrigin,
              databaseOrigin,
              "Failure injection requires the parent's disposable database",
            );
            const faultToken = (
              await readFile(fault.readerJwtFile, "utf8")
            ).trim();
            const faultApiKey = (
              await readFile(fault.projectApiKeyFile, "utf8")
            ).trim();
            const authenticated = await fetch(
              `${fault.databaseOrigin}/rest/v1/rpc/m15_03_operator_read`,
              {
                method: "POST",
                headers: {
                  apikey: faultApiKey,
                  Authorization: `Bearer ${faultToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  p_operator_id: null,
                  p_request_id: randomUUID(),
                  p_instance_ids: instanceIds,
                  p_tenant_ids: tenantIds,
                  p_kind: "instances",
                }),
                redirect: "error",
                signal: AbortSignal.timeout(5_000),
              },
            );
            assert.equal(
              authenticated.status,
              400,
              "Disposable fault credential must reach the authorized RPC input boundary",
            );
            assert.equal((await authenticated.json()).code, "22023");
            const faultApp = await createOperatorApplication(
              {
                instanceId,
                host: "127.0.0.1",
                port: 0,
                ca: material.ca,
                cert: material.serverCert,
                key: material.serverKey,
                grantsPath,
                staticRoot: resolve(
                  process.env.M15_03_OPERATOR_STATIC_ROOT ??
                    "apps/operator/out",
                ),
              },
              new NarrowRegistryClient(
                fault.databaseOrigin,
                faultToken,
                faultApiKey,
              ),
            );
            const faultAgent = new https.Agent({
              ca: material.ca,
              cert: material.cert,
              key: material.key,
            });
            try {
              await faultApp.listen(0, "127.0.0.1");
              const response = await tlsRequest(
                await faultApp.getUrl(),
                "/api/v1/operator/instances",
                faultAgent,
              );
              assert.equal(response.status, 503);
              assert.ok(!response.text.includes(faultToken));
              const body = JSON.parse(response.text);
              assert.ok(
                !Object.hasOwn(body, "instances"),
                "Audit failure must not disclose cached metadata",
              );
            } finally {
              faultAgent.destroy();
              await faultApp.close();
            }
          },
        );
      } finally {
        allowed.destroy();
        noCertificate.destroy();
        ungranted.destroy();
        await app.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
