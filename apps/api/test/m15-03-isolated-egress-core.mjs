// Browser egress proof on the task clone; direct requests remain on loopback.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { customerSystemHealthResponseSchema } from "@repo/contracts/system/schemas";
const runtime = resolve(process.argv[2]);
assert.ok(
  runtime.endsWith("/2026-10-14-m15-03-scoped-operator-system-health/isolated"),
);
const m = JSON.parse(
  await readFile(`${runtime}/fixture-manifest.private.json`, "utf8"),
);
assert.equal(m.webOrigin, "http://127.0.0.1:3008");
const apiOrigin = process.env.M15_03_EGRESS_API_ORIGIN ?? m.apiOrigin;
assert.ok([m.apiOrigin, "http://127.0.0.1:3340"].includes(apiOrigin));
const backendBlocked = apiOrigin === "http://127.0.0.1:3340";
const { chromium, firefox, webkit } = createRequire(
  resolve("apps/web/package.json"),
)("@playwright/test");
let records = [];
let lastSignIn = 0;
for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await engine.launch({ headless: true });
  const context = await browser.newContext();
  let blocked = [];
  if (backendBlocked) {
    // Test-only proxy destination override; functional web gateway remains intact.
    await context.route("**/api/v1/**", async (route) => {
      const requested = new URL(route.request().url());
      const response = await route.fetch({
        url: `${apiOrigin}${requested.pathname}${requested.search}`,
      });
      await route.fulfill({ response });
    });
  }
  await context.route(
    (url) =>
      ["http:", "https:"].includes(url.protocol) &&
      !["localhost", "127.0.0.1"].includes(url.hostname),
    async (route) => {
      blocked = [...blocked, new URL(route.request().url()).hostname];
      await route.abort("blockedbyclient");
    },
  );
  try {
    const page = await context.newPage();
    await page.goto("http://localhost:3008/sign-in");
    // Explicitly proves the interception, without permitting an external request.
    const probe = await page.evaluate(async () => {
      try {
        await fetch("https://m15-isolated-egress.invalid/proof", {
          mode: "no-cors",
        });
        return "unexpected";
      } catch {
        return "blocked";
      }
    });
    assert.equal(probe, "blocked");
    assert.ok(blocked.includes("m15-isolated-egress.invalid"));
    await page.getByTestId("si-identifier").fill(m.owner.email);
    await page.getByTestId("si-password").fill(m.owner.password);
    const delay = Math.max(0, lastSignIn + 8000 - Date.now());
    if (delay) await new Promise((r) => setTimeout(r, delay));
    const response = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/v1/auth/sign-in" &&
        r.request().method() === "POST",
    );
    await page.getByTestId("si-submit").click();
    assert.equal((await response).status(), 200);
    lastSignIn = Date.now();
    await page.waitForURL("**/dashboard");
    await page.goto("http://localhost:3008/organization/health");
    await page
      .getByRole("table", { name: "Components", exact: true })
      .waitFor();
    const fetched = await page.evaluate(async () => {
      const r = await fetch("/api/v1/system/health");
      return { status: r.status, body: await r.json() };
    });
    assert.equal(fetched.status, 200);
    const health = customerSystemHealthResponseSchema.parse(fetched.body);
    assert.equal(health.organizationId, m.owner.organizationId);
    assert.equal(health.backup.lastVerifiedRestoreAt, null);
    const grant = await page.evaluate(async () => {
      const r = await fetch("/api/v1/operator/session");
      return r.status;
    });
    assert.equal(grant, 404);
    await page.screenshot({
      path: `${runtime}/offline-${name}-health.png`,
      fullPage: true,
    });
    let operatorUiRendered = false;
    if (backendBlocked) {
      const operatorOrigin = new URL("https://127.0.0.1:3446");
      // Installed Playwright macOS WebKit client-certificate transport alias.
      if (name === "webkit" && process.platform === "darwin")
        operatorOrigin.hostname = "local.playwright";
      const operator = await browser.newContext({
        ignoreHTTPSErrors: true,
        clientCertificates: [
          {
            origin: operatorOrigin.origin,
            certPath: `${runtime}/tls/client.crt`,
            keyPath: `${runtime}/tls/client.key`,
          },
        ],
      });
      await operator.route(
        (url) =>
          ["http:", "https:"].includes(url.protocol) &&
          url.origin !== operatorOrigin.origin,
        (route) => route.abort("blockedbyclient"),
      );
      try {
        const page = await operator.newPage();
        await page.goto(operatorOrigin.origin);
        await page
          .getByRole("table", { name: "Authorized instances", exact: true })
          .waitFor();
        await page.getByRole("button", { name: /^View / }).click();
        await page
          .getByRole("table", { name: "Authorized tenants", exact: true })
          .waitFor();
        await page.screenshot({
          path: `${runtime}/offline-${name}-operator.png`,
          fullPage: true,
        });
        operatorUiRendered = true;
      } finally {
        await operator.close();
      }
    }
    records = [
      ...records,
      {
        engine: name,
        browserVersion: browser.version(),
        explicitNonLocalFetchBlocked: true,
        blockedHosts: [...new Set(blocked)],
        signInStatus: 200,
        healthStatus: 200,
        customerCannotEnterOperatorStatus: 404,
        healthUiRendered: true,
        backendProcessNonLoopbackBlocked: backendBlocked,
        privateMtlsOperatorUiRendered: operatorUiRendered,
        scope: backendBlocked
          ? "Browser non-loopback HTTP(S) blocked and test-only API process non-loopback Socket.connect/dns.lookup blocked; host firewall unchanged"
          : "Browser non-loopback HTTP(S) blocked; backend host egress not blocked",
      },
    ];
  } finally {
    await context.close();
    await browser.close();
  }
}
await writeFile(
  `${runtime}/egress-blocked-core-results.json`,
  JSON.stringify({ records, completedAt: new Date().toISOString() }, null, 2),
);
console.log(JSON.stringify({ records, completedAt: new Date().toISOString() }));
