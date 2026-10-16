import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { resolve, dirname } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { sessionResponseSchema } from "@repo/contracts/auth/schemas";
import { customerSystemHealthResponseSchema } from "@repo/contracts/system/schemas";
import type { CustomerSystemHealthResponse } from "@repo/contracts/system/types";
import { licenseCurrentResponseSchema } from "@repo/contracts/licensing/schemas";
import {
  exportJobResponseSchema,
  exportManifestResponseSchema,
  exportDownloadGrantResponseSchema,
} from "@repo/contracts/exports/schemas";

/* eslint-disable turbo/no-undeclared-env-vars -- Task verification is outside Turbo. */
const healthPath = "/api/v1/system/health";
const pacingPath = resolve(
  "../../.superpowers/sdd/2026-10-14-m15-03/sign-in-pacing.json",
);

// Preserve the live throttle. One worker serializes projects; completion-based
// pacing prevents browser latency from shortening the interval between POSTs.
async function signIn(
  page: Page,
  email = "owner@cra.test",
  password = "Password123",
) {
  const manifest = process.env.M15_03_FIXTURE_MANIFEST
    ? JSON.parse(await readFile(process.env.M15_03_FIXTURE_MANIFEST, "utf8"))
    : null;
  const credentials = (email === "owner@cra.test"
    ? manifest?.owner
    : email === "member@cra.test"
      ? manifest?.member
      : null) ?? { email, password };
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Show password", exact: true })
    .click();
  await expect(page.getByTestId("si-password")).toHaveAttribute("type", "text");
  await page.getByTestId("si-identifier").fill(credentials.email);
  await page.getByTestId("si-password").fill(credentials.password);
  // Project changes create a fresh worker process. A task-owned completion
  // timestamp preserves pacing across Chromium, Firefox and WebKit too.
  await mkdir(dirname(pacingPath), { recursive: true });
  const previous = await readFile(pacingPath, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "0";
      throw error;
    },
  );
  const delay = Math.max(0, Number(previous) + 8_000 - Date.now());
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
  const response = page.waitForResponse(
    (value) =>
      new URL(value.url()).pathname === "/api/v1/auth/sign-in" &&
      value.request().method() === "POST",
  );
  await page.getByTestId("si-submit").click();
  expect((await response).status()).toBe(200);
  await writeFile(pacingPath, String(Date.now()));
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function readHealth(page: Page): Promise<CustomerSystemHealthResponse> {
  const response = await page.request.get(healthPath);
  expect(response.status()).toBe(200);
  return customerSystemHealthResponseSchema.parse(await response.json());
}

test.beforeEach(async ({ context, baseURL }) => {
  expect(["localhost", "127.0.0.1"]).toContain(new URL(baseURL!).hostname);
  await context.route(
    (url) =>
      ["http:", "https:"].includes(url.protocol) &&
      !["localhost", "127.0.0.1"].includes(url.hostname),
    (route) => route.abort("blockedbyclient"),
  );
});

test("live owner health has scoped provenance, unknown assurance and working licence/usage navigation", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page);
  const sessionResponse = await page.request.get("/api/v1/auth/session");
  expect(sessionResponse.status()).toBe(200);
  const session = sessionResponseSchema.parse(await sessionResponse.json());
  const snapshot = await readHealth(page);
  expect(snapshot.organizationId).toBe(session.organization!.id);
  expect(snapshot.backup).toMatchObject({
    status: "unknown",
    lastExecutionAt: null,
    lastVerifiedRestoreAt: null,
  });
  expect(snapshot.evidenceExportPreserved).toBe(true);
  await page.goto("/organization/health");
  const components = page.getByRole("table", {
    name: "Components",
    exact: true,
  });
  await expect(components).toBeVisible();
  for (const component of snapshot.components) {
    const row = components.getByRole("row").filter({
      has: page.getByRole("rowheader", {
        name: component.label,
        exact: true,
      }),
    });
    await expect(row).toContainText(component.summary);
    await expect(row).toContainText(new RegExp(component.status, "i"));
  }
  const queues = page.getByRole("table", {
    name: "Background work",
    exact: true,
  });
  for (const queue of snapshot.queues) {
    const row = queues.getByRole("row").filter({
      has: page.getByRole("rowheader", { name: queue.label, exact: true }),
    });
    await expect(row).toContainText(queue.availability);
    if (queue.availability === "withheld")
      await expect(row).toContainText("Unknown / withheld");
    if (queue.countRelation === "at_least")
      await expect(row).toContainText("At least");
  }
  const feeds = page.getByRole("table", {
    name: "Feed freshness",
    exact: true,
  });
  for (const feed of snapshot.feedFreshness) {
    const row = feeds.getByRole("row").filter({
      has: page.getByRole("rowheader", { name: feed.label, exact: true }),
    });
    await expect(row).toContainText(feed.status);
    await expect(row).toContainText(
      `${feed.staleAfterSeconds.toLocaleString()} seconds`,
    );
  }
  await expect(
    page.getByText("Last verified restore", { exact: true }).locator(".."),
  ).toContainText("Unknown");
  if (snapshot.currentVersion.version === null)
    await expect(
      page.getByText("Unverified version", { exact: true }),
    ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("customer-health-desktop.png"),
    fullPage: true,
  });
  const licence = page.getByRole("link", { name: "Licence", exact: true });
  await expect(licence).toHaveAttribute(
    "href",
    "/organization?settings=licence",
  );
  await licence.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/organization\?settings=licence$/);
  await expect(
    page.getByLabel("Signed licence artifact", { exact: true }),
  ).toBeVisible();
  await page.goto("/organization/health");
  const usage = page.getByRole("link", { name: "Usage", exact: true });
  await usage.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/organization\?settings=licence$/);
  await expect(
    page.getByRole("table", { name: "Licence capacity", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("live mobile health is keyboard readable with reduced motion and no page overflow", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page);
  await page.goto("/organization/health");
  await expect(
    page.getByRole("table", { name: "Components", exact: true }),
  ).toBeVisible();
  const region = page.getByRole("region", { name: /Components/ });
  await region.focus();
  await expect(region).toBeFocused();
  await page.keyboard.press("ArrowRight");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("customer-health-mobile.png"),
    fullPage: true,
  });
});

test("member and anonymous customer health are denied and tenant inputs cannot change owner scope", async ({
  page,
  browser,
  baseURL,
}) => {
  const anonymous = await browser.newContext({ baseURL });
  try {
    expect((await anonymous.request.get(healthPath)).status()).toBe(401);
    await signIn(page, "member@cra.test");
    expect((await page.request.get(healthPath)).status()).toBe(403);
    await page.goto("/organization/health");
    await expect(
      page.getByRole("alert").filter({ hasText: /permission/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("table", { name: "Components", exact: true }),
    ).toHaveCount(0);
  } finally {
    await anonymous.close();
  }
  const ownerContext = await browser.newContext({ baseURL });
  try {
    await ownerContext.route(
      (url) =>
        ["http:", "https:"].includes(url.protocol) &&
        !["localhost", "127.0.0.1"].includes(url.hostname),
      (route) => route.abort("blockedbyclient"),
    );
    const ownerPage = await ownerContext.newPage();
    await signIn(ownerPage);
    const snapshot = await readHealth(ownerPage);
    expect(
      (
        await ownerPage.request.get(
          `${healthPath}?organizationId=${randomUUID()}`,
        )
      ).status(),
    ).toBe(400);
    expect((await readHealth(ownerPage)).organizationId).toBe(
      snapshot.organizationId,
    );
    expect(
      (await ownerPage.request.get("/api/v1/operator/session")).status(),
    ).toBe(404);
  } finally {
    await ownerContext.close();
  }
});

test("task-owned expired licence preserves protected reads and an authorized evidence export", async ({
  page,
}) => {
  const manifestPath = process.env.M15_03_FIXTURE_MANIFEST;
  test.skip(
    !manifestPath,
    "Requires a task-owned expired tenant and existing source export fixture; original licences are never edited.",
  );
  const manifest = JSON.parse(await readFile(manifestPath!, "utf8"));
  const fixture = manifest.expired;
  expect(fixture).toBeDefined();
  expect(fixture.readPath).toMatch(/^\/api\/v1\//);
  expect(fixture.exportPath).toMatch(/^\/api\/v1\//);
  await signIn(page, fixture.email, fixture.password);
  const current = await page.request.get("/api/v1/licensing/current");
  expect(current.status()).toBe(200);
  expect(
    licenseCurrentResponseSchema.parse(await current.json()).policy.state,
  ).toBe("expired_read_only");
  const health = await readHealth(page);
  expect(health.organizationId).toBe(fixture.organizationId);
  expect(["expired_read_only", null]).toContain(health.licence.state);
  if (health.licence.state === null) {
    const licence = health.components.find(
      (component) => component.id === "licensing",
    )!;
    expect(licence.status).not.toBe("healthy");
    expect(
      licence.reasons.some((reason) =>
        [
          "source_timeout",
          "source_unavailable",
          "licence_unavailable",
        ].includes(reason),
      ),
    ).toBe(true);
  }
  expect((await page.request.get(fixture.readPath)).status()).toBe(200);
  const exported = await page.request.post(fixture.exportPath, {
    data: { ...fixture.exportInput, idempotencyKey: randomUUID() },
  });
  expect(exported.status()).toBe(fixture.exportStatus ?? 202);
  const response = await exported.json();
  expect(response).toHaveProperty(fixture.receiptField ?? "jobId");
  if (fixture.exportPath === "/api/v1/exports") {
    const job = exportJobResponseSchema.parse(response).data;
    expect(job.source).toBe(fixture.exportInput.source);
    expect(job.format).toBe(fixture.exportInput.format);
    if (process.env.M15_03_VERIFY_EXPORT_COMPLETION === "true") {
      await expect
        .poll(
          async () => {
            const response = await page.request.get(
              `${fixture.exportPath}/${job.id}`,
            );
            expect(response.status()).toBe(200);
            return exportJobResponseSchema.parse(await response.json()).data
              .state;
          },
          { timeout: 45_000, intervals: [1_000, 2_000, 4_000] },
        )
        .toBe("ready");
      const manifestResponse = await page.request.get(
        `${fixture.exportPath}/${job.id}/manifest`,
      );
      expect(manifestResponse.status()).toBe(200);
      const exportManifest = exportManifestResponseSchema.parse(
        await manifestResponse.json(),
      ).data;
      expect(exportManifest.rowCount).toBeGreaterThan(0);
      const artifact = exportManifest.artifacts[0]!;
      const granted = await page.request.post(
        `${fixture.exportPath}/${job.id}/download-grants`,
        { data: { artifactId: artifact.id } },
      );
      expect(granted.status()).toBe(200);
      const grant = exportDownloadGrantResponseSchema.parse(
        await granted.json(),
      ).data;
      const downloaded = await page.request.get(grant.downloadPath);
      expect(downloaded.status()).toBe(200);
      const bytes = await downloaded.body();
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        artifact.sha256,
      );
    }
  }
  await page.goto("/organization/health");
  await expect(
    page.getByRole("table", { name: "Components", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Existing evidence exports remain/),
  ).toBeVisible();
});
