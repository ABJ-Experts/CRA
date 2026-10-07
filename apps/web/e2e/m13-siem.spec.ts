import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  siemCredentialSchema,
  siemDestinationListSchema,
  siemDestinationSchema,
  siemDeliveryPageSchema,
  siemReplayPreviewSchema,
} from "@repo/contracts/audit/schemas";
/* eslint-disable turbo/no-undeclared-env-vars -- Local browser verification runs outside Turbo. */
const origin = process.env.E2E_WEB_ORIGIN ?? "http://localhost:3101";
const root = resolve(new URL("../../..", import.meta.url).pathname);
const evidenceRoot = join(
  root,
  "docs/architecture/evidence/m13-05/screenshots",
);
const base = "/api/v1/audit/siem/destinations";
// Playwright's automatic AI error snapshot can otherwise capture a PEM textarea.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";
// Credential inputs are exercised here. Capture only explicit, post-clear screenshots.
test.use({ screenshot: "off", video: "off", trace: "off" });
async function isolate(context: BrowserContext) {
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.origin === origin || !["http:", "https:"].includes(url.protocol)
      ? route.continue()
      : route.abort("blockedbyclient");
  });
}
async function login(page: Page, email: string) {
  await page.goto("/sign-in");
  const identifier = page.getByTestId("si-identifier");
  const password = page.getByTestId("si-password");
  await identifier.fill(email);
  await password.fill("Password123");
  // Reuse the incumbent browser helper's WebKit hydration-reset handling.
  for (const [input, value] of [
    [identifier, email],
    [password, "Password123"],
  ] as const) {
    if ((await input.inputValue()) !== value) {
      await input.click();
      await input.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
      await input.press("Backspace");
      await input.pressSequentially(value);
    }
    expect(
      (await input.inputValue()) === value,
      "Seeded sign-in input did not retain its value",
    ).toBe(true);
  }
  await page.getByTestId("si-submit").click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/connectors/siem");
}
async function mutate(
  page: Page,
  suffix: string,
  method: string,
  action: () => Promise<void>,
) {
  const response = page.waitForResponse(
    (res) =>
      new URL(res.url()).pathname.endsWith(suffix) &&
      res.request().method() === method,
  );
  await action();
  const result = await response;
  expect(result.status(), `SIEM ${method} ${suffix}`).toBeLessThan(300);
  return result;
}
test("M13-05 real UI forwarding, private credentials, replay and restricted access", async ({
  browser,
}, testInfo) => {
  const evidence = join(evidenceRoot, testInfo.project.name);
  test.setTimeout(480_000);
  const url = new URL(origin);
  expect(["localhost", "127.0.0.1"]).toContain(url.hostname);
  expect(url.port).toBe("3101");
  await expect
    .poll(
      async () =>
        (await fetch(`${origin}${base}?requestId=${randomUUID()}`)).status,
      { timeout: 75_000, intervals: [5000] },
    )
    .not.toBe(429);
  await mkdir(evidence, { recursive: true });
  const owner = await browser.newContext({ baseURL: origin });
  const viewer = await browser.newContext({ baseURL: origin });
  let id: string | undefined;
  const page = await owner.newPage();
  page.setDefaultTimeout(15_000);
  try {
    await isolate(owner);
    await isolate(viewer);
    await login(page, "owner@cra.test");
    console.info("Owner signed in; checking SIEM destination form");
    await expect(
      page.getByRole("heading", { name: "SIEM forwarding", exact: true }),
    ).toBeVisible();
    const listResponse = await page.request.get(
      `${base}?requestId=${randomUUID()}`,
    );
    expect(listResponse.status()).toBe(200);
    const list = siemDestinationListSchema.parse(await listResponse.json());
    id = list.items.find(
      (item) => item.name === "SIEM browser verification",
    )?.id;
    if (!id) {
      await page
        .getByRole("button", { name: "New destination", exact: true })
        .click();
      await page
        .getByLabel("Destination name")
        .fill("SIEM browser verification");
      await page
        .getByLabel("Collector endpoint")
        .fill("https://collector.example/events");
      // Source-owned organization facts, rather than synthetic audit inserts.
      await page.getByLabel(/^access control$/i).uncheck();
      await page.getByLabel(/^organization$/i).check();
      const created = await mutate(page, "/destinations", "POST", () =>
        page.getByRole("button", { name: "Save destination" }).click(),
      );
      id = siemDestinationSchema.parse(await created.json()).id;
    } else await page.getByLabel("Current destination").selectOption(id);
    await page.screenshot({
      path: join(evidence, "siem-draft.png"),
      fullPage: true,
      animations: "disabled",
    });
    const credential = siemCredentialSchema.parse(
      JSON.parse(await readFile("/tmp/m13-05-browser-credential.json", "utf8")),
    );
    expect(credential.mode).toBe("mtls");
    if (credential.mode !== "mtls")
      throw new Error("Loopback fixture requires mTLS");
    let lastDeliveryId = "";
    for (const [transport, format] of [
      ["https", "json"],
      ["https", "cef"],
      ["syslog_tls", "json"],
      ["syslog_tls", "cef"],
    ] as const) {
      console.info(`Verifying ${transport} ${format} UI delivery`);
      await page
        .getByLabel("Transport", { exact: true })
        .selectOption(transport);
      await page.getByLabel("Format", { exact: true }).selectOption(format);
      await page
        .getByLabel("Collector endpoint")
        .fill(
          transport === "https"
            ? "https://collector.example/events"
            : "tls://collector.example:6514",
        );
      await page
        .getByLabel("Configuration change reason")
        .fill(`Browser verifies ${transport} ${format}`);
      await mutate(page, `/${id}`, "PATCH", () =>
        page.getByRole("button", { name: "Save destination" }).click(),
      );
      if (transport === "https" && format === "json")
        await page
          .getByLabel("Bearer token", { exact: true })
          .fill("fixture-browser-token");
      else {
        if (transport === "https")
          await page.getByLabel("Authentication").selectOption("mtls");
        await page
          .getByLabel("Client certificate")
          .fill(credential.certificate);
        await page.getByLabel("Client private key").fill(credential.privateKey);
        await page.getByLabel("Custom CA (optional)").fill(credential.ca ?? "");
      }
      await mutate(page, "/credentials", "POST", () =>
        page.getByRole("button", { name: "Rotate credentials" }).click(),
      );
      for (const label of [
        "Bearer token",
        "Client certificate",
        "Client private key",
        "Custom CA (optional)",
      ]) {
        const input = page.getByLabel(label, { exact: true });
        if (await input.count()) {
          // A failed assertion must never print the credential value.
          expect(
            (await input.inputValue()) === "",
            "Credential input did not clear",
          ).toBe(true);
        }
      }
      await mutate(page, "/test", "POST", () =>
        page.getByRole("button", { name: "Test collector" }).click(),
      );
      await expect(
        page.getByRole("status").filter({
          hasText:
            transport === "https"
              ? "Collector accepted the test"
              : "Test sent unacknowledged",
        }),
      ).toBeVisible();
      await mutate(page, "/enable", "POST", () =>
        page
          .getByRole("button", { name: "Enable future events / take over" })
          .click(),
      );
      const beforeResponse = await page.request.get(
        `${base}/${id}/deliveries?requestId=${randomUUID()}&limit=50`,
      );
      const existingIds = new Set(
        siemDeliveryPageSchema
          .parse(await beforeResponse.json())
          .items.map((item) => item.id),
      );
      const sessionResponse = await page.request.get("/api/v1/auth/session");
      const session = (await sessionResponse.json()) as {
        organization: { id: string };
      };
      const switched = await page.request.post("/api/v1/organizations/switch", {
        data: { organizationId: session.organization.id },
      });
      expect(switched.status()).toBeLessThan(300);
      await expect
        .poll(
          async () => {
            const response = await page.request.get(
              `${base}/${id}/deliveries?requestId=${randomUUID()}&limit=50`,
            );
            expect(response.status()).toBe(200);
            const history = siemDeliveryPageSchema.parse(await response.json());
            const delivered = history.items.find(
              (item) =>
                item.state ===
                  (transport === "https"
                    ? "accepted"
                    : "sent_unacknowledged") && !existingIds.has(item.id),
            );
            if (delivered) lastDeliveryId = delivered.id;
            return Boolean(delivered);
          },
          { timeout: 35_000, intervals: [2000] },
        )
        .toBe(true);
      await page.reload();
      await page.getByLabel("Current destination").selectOption(id);
      await expect(
        page
          .getByText(
            transport === "https" ? "accepted" : "sent unacknowledged",
            { exact: true },
          )
          .first(),
      ).toBeVisible();
      await page.screenshot({
        path: join(evidence, `siem-${transport}-${format}.png`),
        fullPage: true,
        animations: "disabled",
      });
      await mutate(page, "/disable", "POST", () =>
        page
          .getByRole("button", { name: "Disable and cancel pending" })
          .click(),
      );
    }
    await mutate(page, "/enable", "POST", () =>
      page
        .getByRole("button", { name: "Enable future events / take over" })
        .click(),
    );
    await page
      .getByRole("button", { name: "Inspect delivery" })
      .first()
      .click();
    await expect(
      page.getByRole("region", { name: "Delivery details" }),
    ).toBeVisible();
    const previewResponse = await mutate(page, "/replay-preview", "POST", () =>
      page.getByRole("button", { name: "Review replay" }).first().click(),
    );
    const preview = siemReplayPreviewSchema.parse(await previewResponse.json());
    expect(preview.deliveryId).toBe(lastDeliveryId);
    await page
      .getByLabel("Replay reason")
      .fill("Browser reviews uncertain syslog delivery");
    await page.getByLabel("I reviewed this recipient and event.").check();
    await mutate(page, "/replay", "POST", () =>
      page.getByRole("button", { name: "Queue reviewed replay" }).click(),
    );
    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `${base}/${id}/deliveries?requestId=${randomUUID()}&limit=50`,
          );
          const history = siemDeliveryPageSchema.parse(await response.json());
          return history.items.some(
            (item) =>
              item.parentDeliveryId === lastDeliveryId &&
              item.eventId === preview.event.eventId &&
              item.state === "sent_unacknowledged",
          );
        },
        { timeout: 35_000, intervals: [2000] },
      )
      .toBe(true);
    await page.screenshot({
      path: join(evidence, "siem-reviewed-replay.png"),
      fullPage: true,
      animations: "disabled",
    });
    const refreshCookie = (await owner.cookies()).find(
      (cookie) => cookie.name === "cra_rt",
    );
    expect(refreshCookie?.path).toBe("/api/v1/auth/refresh");
    await owner.clearCookies({ name: "cra_at" });
    const refreshed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v1/auth/refresh" &&
        response.status() === 200,
      { timeout: 30_000 },
    );
    // Existing mounted GET polling exercises transport refresh; a new navigation
    // would correctly fail middleware before the browser transport can refresh.
    await refreshed;
    await expect(page.getByLabel("Current destination")).toBeVisible();
    await page.getByLabel("Current destination").selectOption(id);
    const restricted = await viewer.newPage();
    await login(restricted, "viewer@cra.test");
    const denied = await restricted.request.get(
      `${base}?requestId=${randomUUID()}`,
    );
    if (denied.status() === 403) {
      await expect(
        restricted.getByText(
          "Audit and connector read permissions are required.",
          { exact: true },
        ),
      ).toBeVisible();
    } else {
      // Existing local organization overrides can grant a viewer audit reads.
      // Preserve those grants and prove the independent write permission instead.
      expect(denied.status()).toBe(200);
      await expect(
        restricted.getByRole("button", {
          name: "New destination",
          exact: true,
        }),
      ).toHaveCount(0);
      const forbiddenWrite = await restricted.request.post(
        `${base}/${id}/disable`,
        { data: { requestId: randomUUID(), expectedVersion: 1 } },
      );
      expect(forbiddenWrite.status()).toBe(403);
      console.info(
        "Seeded viewer has existing audit-read overrides; independent SIEM write denial verified.",
      );
    }
    await restricted.screenshot({
      path: join(evidence, "siem-denied.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    // Start at a known form control: Safari's default Tab policy excludes links.
    await page.getByLabel("Current destination").focus();
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe(
      "BODY",
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: join(evidence, "siem-mobile.png"),
      fullPage: true,
    });
    const session = (await (
      await page.request.get("/api/v1/auth/session")
    ).json()) as {
      organization: { id: string };
      organizations: { id: string }[];
    };
    const alternate = session.organizations.find(
      (organization) => organization.id !== session.organization.id,
    );
    if (alternate) {
      const switched = await page.request.post("/api/v1/organizations/switch", {
        data: { organizationId: alternate.id },
      });
      expect(switched.status()).toBeLessThan(300);
      await page.reload();
      if (await page.getByLabel("Current destination").count())
        await expect(page.getByLabel("Current destination")).toHaveValue("");
      await expect(
        page.getByRole("region", { name: "Reviewed replay" }),
      ).toHaveCount(0);
      const restored = await page.request.post("/api/v1/organizations/switch", {
        data: { organizationId: session.organization.id },
      });
      expect(restored.status()).toBeLessThan(300);
    }
  } finally {
    if (id) {
      const current = await page.request
        .get(`${base}/${id}?requestId=${randomUUID()}`)
        .catch(() => null);
      if (current?.ok()) {
        const destination = siemDestinationSchema.parse(await current.json());
        await page.request.post(`${base}/${id}/disable`, {
          data: {
            requestId: randomUUID(),
            expectedVersion: destination.version,
          },
        });
      }
    }
    await owner.close();
    await viewer.close();
  }
});
