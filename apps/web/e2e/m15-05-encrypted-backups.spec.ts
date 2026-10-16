import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { test, expect } from "@playwright/test";
import {
  backupAssuranceSchema,
  backupPolicyResponseSchema,
  backupHistorySchema,
} from "@repo/contracts/backups/schemas";
import { customerSystemHealthV2ResponseSchema } from "@repo/contracts/system/schemas";

/* eslint-disable turbo/no-undeclared-env-vars -- Explicit local verification fixtures, outside Turbo. */
test("private operator backup assurance hydrates, preserves drafts and supports keyboard/mobile access", async ({
  browser,
}, info) => {
  const path = process.env.M15_05_OPERATOR_SERVER_CONFIG_FILE;
  test.skip(
    !path,
    "Requires a task-owned TLS listener and explicit backup grant.",
  );
  const fixture = JSON.parse(await readFile(path!, "utf8"));
  expect(fixture.host).toBe("127.0.0.1");
  expect(fixture.port).toBe(3447);
  const origin = new URL(`https://${fixture.host}:${fixture.port}`);
  if (info.project.name === "webkit" && process.platform === "darwin")
    origin.hostname = "local.playwright";
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    clientCertificates: [
      {
        origin: origin.origin,
        certPath: `${fixture.certificateDirectory}/client.crt`,
        keyPath: `${fixture.certificateDirectory}/client.key`,
      },
    ],
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 1000 },
  });
  try {
    await context.route(
      (url) =>
        ["http:", "https:"].includes(url.protocol) &&
        url.origin !== origin.origin,
      (route) => route.abort("blockedbyclient"),
    );
    const page = await context.newPage();
    const errors: string[] = [];
    const network: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/v1/operator/")) {
        network.push(`request ${new URL(r.url()).pathname}`);
        if (process.env.M15_05_TRACE_NETWORK === "true")
          console.log("request", r.url());
      }
    });
    page.on("response", (r) => {
      if (r.url().includes("/api/v1/operator/"))
        network.push(`response ${r.status()} ${new URL(r.url()).pathname}`);
    });
    page.on("requestfailed", (r) => {
      network.push(
        `failed ${new URL(r.url()).pathname}: ${r.failure()?.errorText}`,
      );
      if (process.env.M15_05_TRACE_NETWORK === "true")
        console.log("failed", r.url(), r.failure()?.errorText);
    });
    page.on("pageerror", (error) => errors.push(error.message));
    if (process.env.M15_05_TRACE_NETWORK === "true")
      page.on("response", (r) =>
        console.log(info.project.name, r.status(), new URL(r.url()).pathname),
      );
    await page.goto(origin.origin);
    const details = page.getByRole("button", {
      name: "View M15-05 isolated recovery profile",
      exact: true,
    });
    await details.waitFor({ timeout: 15_000 });
    await details.focus();
    await page.keyboard.press("Enter");
    const heading = page.getByRole("heading", {
      name: "Encrypted backups and restore verification",
      exact: true,
    });
    await expect(heading).toBeVisible();
    const repository = page.getByLabel("Repository alias", { exact: true });
    await expect(repository).toHaveValue("offhost");
    const read = (path: string) =>
      page.evaluate(async (path) => {
        const response = await fetch(path, { cache: "no-store" });
        return { status: response.status, body: await response.json() };
      }, path);
    const policy = await read(
      `/api/v1/operator/instances/${fixture.instanceId}/backups/policy`,
    );
    expect(policy.status).toBe(200);
    expect(
      backupPolicyResponseSchema.parse(policy.body).policy?.configuration
        .schedulingEnabled,
    ).toBe(false);
    const runs = await read(
      `/api/v1/operator/instances/${fixture.instanceId}/backups/runs`,
    );
    expect(runs.status).toBe(200);
    backupHistorySchema.parse(runs.body);
    await repository.fill("reviewed-draft");
    await page
      .getByRole("button", { name: "Refresh backup status", exact: true })
      .click();
    await expect(repository).toHaveValue("reviewed-draft");
    await expect(
      page.getByRole("button", { name: "Approve configuration", exact: true }),
    ).toBeDisabled();
    await page.screenshot({
      path: info.outputPath("backups-operator-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const history = page.getByRole("region", {
      name: "Backup runs table scroll area",
      exact: true,
    });
    await history.focus();
    await expect(history).toBeFocused();
    await page.keyboard.press("ArrowRight");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("backups-operator-mobile.png"),
      fullPage: true,
    });
    expect(errors).toEqual([]);
    expect(
      (await context.cookies()).filter((cookie) =>
        ["cra_at", "cra_rt"].includes(cookie.name),
      ),
    ).toEqual([]);
    await info.attach("browser-version", {
      body: Buffer.from(browser.version()),
      contentType: "text/plain",
    });
  } finally {
    await context.close();
  }
});

test("seeded owner sees scoped unknown assurance without receiving whole-instance execution authority", async ({
  page,
  baseURL,
  browser,
}, info) => {
  test.skip(
    process.env.M15_05_CUSTOMER_E2E !== "true",
    "Opt in against the original local development server.",
  );
  expect(new URL(baseURL!).origin).toBe("http://localhost:3010");
  await page.context().route(
    (url) =>
      ["http:", "https:"].includes(url.protocol) &&
      !["localhost", "127.0.0.1"].includes(url.hostname),
    (route) => route.abort("blockedbyclient"),
  );
  await page.goto("/sign-in");
  await page.getByTestId("si-identifier").fill("owner@cra.test");
  await page.getByTestId("si-password").fill("Password123");
  const pacingPath = resolve(
    "../../.superpowers/sdd/m15-05/sign-in-pacing.json",
  );
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
  const health = await page.request.get(
    "/api/v1/system/health?schemaVersion=2",
  );
  expect(health.status()).toBe(200);
  customerSystemHealthV2ResponseSchema.parse(await health.json());
  const scoped = await page.request.get("/api/v1/system/backups");
  expect(scoped.status()).toBe(200);
  expect(backupAssuranceSchema.parse(await scoped.json()).status).toBe(
    "unavailable",
  );
  expect(
    (
      await page.request.get(
        "/api/v1/system/backups?organizationId=00000000-0000-4000-8000-000000000000",
      )
    ).status(),
  ).toBe(400);
  expect(
    (
      await page.request.post(
        "/api/v1/operator/instances/00000000-0000-4000-8000-000000000000/backups/runs",
        { data: {} },
      )
    ).status(),
  ).toBe(404);
  await page.goto("/organization/health");
  await expect(
    page.getByRole("heading", {
      name: "Backup and restore assurance",
      exact: true,
    }),
  ).toBeVisible();
  const historyButton = page.getByRole("button", {
    name: "Show backup history",
    exact: true,
  });
  await historyButton.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("table", {
      name: "Organization backup assurance history",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("No backup assurance events are available.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("backups-customer-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const history = page.getByRole("region", {
    name: "Backup assurance history scroll area",
    exact: true,
  });
  await history.focus();
  await expect(history).toBeFocused();
  await page.keyboard.press("ArrowRight");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("backups-customer-mobile.png"),
    fullPage: true,
  });
  await info.attach("browser-version", {
    body: Buffer.from(browser.version()),
    contentType: "text/plain",
  });
});
