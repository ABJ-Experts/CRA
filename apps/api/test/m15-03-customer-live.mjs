import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { test as liveTest } from "node:test";
import { customerSystemHealthResponseSchema } from "@repo/contracts/system/schemas";
import { sessionResponseSchema } from "@repo/contracts/auth/schemas";
import { exportJobResponseSchema } from "@repo/contracts/exports/schemas";

const origin = process.env.M15_03_API_ORIGIN ?? "http://127.0.0.1:3338";
assert.ok(
  ["127.0.0.1", "localhost"].includes(new URL(origin).hostname),
  "Live harness requires local API",
);
const path = "/api/v1/system/health";
const pacingPath = fileURLToPath(
  new URL(
    "../../../.superpowers/sdd/2026-10-14-m15-03/sign-in-pacing.json",
    import.meta.url,
  ),
);
const manifest = process.env.M15_03_FIXTURE_MANIFEST
  ? JSON.parse(await readFile(process.env.M15_03_FIXTURE_MANIFEST, "utf8"))
  : null;
const signingSecretPath =
  manifest?.jwtSecretFile ?? process.env.M15_03_JWT_SECRET_FILE;

async function request(route, cookie = "", init = {}) {
  assert.ok(route.startsWith("/api/v1/"), "Only local API paths are allowed");
  return fetch(new URL(route, origin), {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...init.headers,
    },
  });
}

async function signIn(email, password = "Password123") {
  await mkdir(dirname(pacingPath), { recursive: true });
  const previous = await readFile(pacingPath, "utf8").catch((error) => {
    if (error.code === "ENOENT") return "0";
    throw error;
  });
  const delay = Math.max(0, Number(previous) + 8_000 - Date.now());
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
  const response = await request("/api/v1/auth/sign-in", "", {
    method: "POST",
    body: JSON.stringify({ email, password, remember: true }),
  });
  await writeFile(pacingPath, String(Date.now()));
  assert.equal(
    response.status,
    200,
    "Live sign-in must succeed with unchanged throttles",
  );
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  assert.ok(cookie.includes("cra_at="), "API owns an HttpOnly access session");
  return cookie;
}

async function health(cookie) {
  const response = await request(path, cookie);
  assert.equal(
    response.status,
    200,
    "Authorized local customer health must exist",
  );
  return customerSystemHealthResponseSchema.parse(await response.json());
}

liveTest(
  "local live authorization, strict tenant scope, independent unknown sources and cross-realm denial",
  async (t) => {
    assert.equal((await request(path)).status, 401);
    const ownerCookie = await signIn(
      manifest?.owner?.email ?? "owner@cra.test",
      manifest?.owner?.password ?? "Password123",
    );
    const sessionResponse = await request("/api/v1/auth/session", ownerCookie);
    assert.equal(sessionResponse.status, 200);
    const session = sessionResponseSchema.parse(await sessionResponse.json());
    const result = await health(ownerCookie);
    assert.equal(result.organizationId, session.organization.id);
    assert.equal(result.backup.status, "unknown");
    assert.equal(result.backup.lastExecutionAt, null);
    assert.equal(result.backup.lastVerifiedRestoreAt, null);
    assert.ok(result.backup.reasons.includes("m15_05_not_available"));
    assert.equal(result.storage.integrity, "unknown");
    assert.equal(result.evidenceExportPreserved, true);
    for (const component of result.components)
      if (component.status === "healthy") {
        assert.ok(component.sourceAt && component.observedAt);
        assert.deepEqual(component.reasons, []);
      }
    for (const parameter of ["organizationId", "orgId", "tenantId", "source"]) {
      assert.equal(
        (await request(`${path}?${parameter}=${randomUUID()}`, ownerCookie))
          .status,
        400,
      );
    }
    assert.equal(
      (await health(ownerCookie)).organizationId,
      result.organizationId,
    );
    const memberCookie = await signIn(
      manifest?.member?.email ?? "member@cra.test",
      manifest?.member?.password ?? "Password123",
    );
    assert.equal((await request(path, memberCookie)).status, 403);
    // Authenticated owner privileges do not expose a private operator route.
    for (const route of ["session", "instances", "instance-metadata"]) {
      assert.equal(
        (
          await request(`/api/v1/operator/${route}`, ownerCookie, {
            headers: { "X-Client-Cert": "forged", "X-Operator-Role": "owner" },
          })
        ).status,
        404,
      );
    }

    await t.test(
      "custom health grant retains source permission redaction",
      { skip: !manifest?.restricted },
      async () => {
        const fixture = manifest.restricted;
        const cookie = await signIn(fixture.email, fixture.password);
        const restricted = await health(cookie);
        assert.equal(restricted.organizationId, fixture.organizationId);
        assert.ok(
          restricted.queues.length > 0,
          "Queue authority must be explicit",
        );
        for (const queue of restricted.queues) {
          assert.equal(queue.availability, "withheld");
          assert.equal(queue.pending, null);
          assert.equal(queue.running, null);
          assert.equal(queue.countRelation, null);
          assert.ok(queue.reasons.includes("source_permission_withheld"));
        }
      },
    );

    await t.test(
      "valid narrow role JWT with forged owner identity cannot enter tenant auth",
      { skip: !signingSecretPath },
      async () => {
        const access = ownerCookie
          .split("; ")
          .find((value) => value.startsWith("cra_at="))
          .slice(7);
        const claims = JSON.parse(
          Buffer.from(access.split(".")[1], "base64url").toString("utf8"),
        );
        const secret = (await readFile(signingSecretPath, "utf8")).trim();
        const header = Buffer.from(
          JSON.stringify({ alg: "HS256", typ: "JWT" }),
        ).toString("base64url");
        const body = Buffer.from(
          JSON.stringify({
            ...claims,
            role: "cra_operator_registry_reader",
            exp: Math.floor(Date.now() / 1000) + 300,
          }),
        ).toString("base64url");
        const unsigned = `${header}.${body}`;
        const jwt = `${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`;
        const denied = await request(path, `cra_at=${jwt}`);
        assert.equal(denied.status, 401);
        const sessionDenied = await request(
          "/api/v1/auth/session",
          `cra_at=${jwt}`,
        );
        assert.equal(sessionDenied.status, 401);
      },
    );

    await t.test(
      "task-owned missing licence has no active authority",
      { skip: !manifest?.missing },
      async () => {
        const fixture = manifest.missing;
        const cookie = await signIn(fixture.email, fixture.password);
        const missing = await health(cookie);
        assert.equal(missing.organizationId, fixture.organizationId);
        assert.ok(["missing", null].includes(missing.licence.state));
        assert.equal(missing.licence.expiresAt, null);
        assert.equal(missing.licence.graceEndsAt, null);
        assert.equal(missing.backup.lastVerifiedRestoreAt, null);
      },
    );

    await t.test(
      "fixture expired read-only licence preserves source read and authorized evidence export",
      { skip: !manifest?.expired },
      async () => {
        const fixture = manifest.expired;
        const cookie = await signIn(fixture.email, fixture.password);
        const expired = await health(cookie);
        assert.equal(expired.organizationId, fixture.organizationId);
        assert.equal(expired.licence.state, "expired_read_only");
        assert.equal((await request(fixture.readPath, cookie)).status, 200);
        const response = await request(fixture.exportPath, cookie, {
          method: "POST",
          body: JSON.stringify({
            ...fixture.exportInput,
            idempotencyKey: randomUUID(),
          }),
        });
        assert.equal(response.status, fixture.exportStatus ?? 202);
        const receipt = await response.json();
        assert.ok(Object.hasOwn(receipt, fixture.receiptField ?? "jobId"));
        if (fixture.exportPath === "/api/v1/exports") {
          const job = exportJobResponseSchema.parse(receipt).data;
          assert.equal(job.source, fixture.exportInput.source);
          assert.equal(job.format, fixture.exportInput.format);
        }
      },
    );
  },
);
