import { readFile } from "node:fs/promises";
import https from "node:https";
import { test, expect, type Locator } from "@playwright/test";
import { operatorSessionResponseSchema } from "@repo/contracts/operator/schemas";

async function assertDistinctLicenceLabels(table: Locator) {
  for (const summary of await table.locator("dl").all()) {
    const labels = await summary.evaluate((element) =>
      Array.from(element.querySelectorAll("dt"), (label) => {
        const range = document.createRange();
        range.selectNodeContents(label);
        const rectangle = range.getBoundingClientRect();
        return {
          text: label.textContent,
          left: rectangle.left,
          right: rectangle.right,
          top: rectangle.top,
          bottom: rectangle.bottom,
        };
      }),
    );
    expect(labels).toHaveLength(6);
    const overlaps = labels.flatMap((left, index) =>
      labels
        .slice(index + 1)
        .filter(
          (right) =>
            Math.min(left.right, right.right) >
              Math.max(left.left, right.left) + 1 &&
            Math.min(left.bottom, right.bottom) >
              Math.max(left.top, right.top) + 1,
        )
        .map((right) => [left.text, right.text]),
    );
    expect(overlaps).toEqual([]);
  }
}

/* eslint-disable turbo/no-undeclared-env-vars -- Task verification is outside Turbo. */
test("private static registry hydrates with a client certificate and stays scoped on desktop/mobile", async ({
  browser,
}, info) => {
  const path = process.env.M15_03_FIXTURE_MANIFEST;
  test.skip(
    !path,
    "Requires parent-owned private TLS listener and certificate paths.",
  );
  const fixture = JSON.parse(await readFile(path!, "utf8")).operatorBrowser;
  test.skip(!fixture, "Operator browser fixture was not provided.");
  const origin = new URL(fixture.origin);
  expect(origin.protocol).toBe("https:");
  expect(["127.0.0.1", "localhost"]).toContain(origin.hostname);
  const [ca, cert, key] = await Promise.all([
    readFile(fixture.caCertPath),
    readFile(fixture.clientCertPath),
    readFile(fixture.clientKeyPath),
  ]);
  const agent = new https.Agent({ ca, cert, key, rejectUnauthorized: true });
  try {
    // Native TLS validates the exact operator origin's server chain first.
    // Browser trust relaxation remains isolated to this fresh presentation
    // context; no host/system trust-store modifications are made.
    const verified = await new Promise<string>((resolve, reject) => {
      const request = https.get(
        new URL("/api/v1/operator/session", origin),
        { agent },
        (response) => {
          if (response.statusCode !== 200) {
            response.resume();
            reject(new Error("Operator TLS session denied"));
            return;
          }
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () =>
            resolve(Buffer.concat(chunks).toString("utf8")),
          );
          response.on("error", reject);
        },
      );
      request.setTimeout(5_000, () =>
        request.destroy(new Error("Operator TLS budget exceeded")),
      );
      request.on("error", reject);
    });
    expect(
      operatorSessionResponseSchema.parse(JSON.parse(verified)).principalId,
    ).toBe(fixture.principalId);
  } finally {
    agent.destroy();
  }
  const browserOrigin = new URL(origin.origin);
  // Playwright's macOS WebKit workaround maps this alias inside its task-owned
  // SOCKS transport; it never modifies host DNS or trust stores.
  // https://playwright.dev/docs/api/class-browser#browser-new-context-option-client-certificates
  if (info.project.name === "webkit" && process.platform === "darwin")
    browserOrigin.hostname = "local.playwright";
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    clientCertificates: [{ origin: browserOrigin.origin, cert, key }],
    reducedMotion: "reduce",
  });
  try {
    await context.route(
      (url) =>
        ["http:", "https:"].includes(url.protocol) &&
        url.origin !== browserOrigin.origin,
      (route) => route.abort("blockedbyclient"),
    );
    const page = await context.newPage();
    const errors: string[] = [];
    const authRequests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/v1/auth/"))
        authRequests.push(request.method());
    });
    await page.goto(browserOrigin.origin);
    const instances = page.getByRole("table", {
      name: "Authorized instances",
      exact: true,
    });
    await expect(instances).toBeVisible();
    await page.screenshot({
      path: info.outputPath("operator-registry-desktop.png"),
      fullPage: true,
    });
    await assertDistinctLicenceLabels(instances);
    const details = fixture.instanceLabel
      ? page.getByRole("button", {
          name: `View ${fixture.instanceLabel}`,
          exact: true,
        })
      : instances.getByRole("button", { name: /^View / }).first();
    if ((await details.count()) > 0) {
      await details.focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("table", { name: "Authorized tenants", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Deployment health", exact: true }),
      ).toBeFocused();
      await page
        .getByRole("button", { name: "Back to instances", exact: true })
        .click();
      await expect(instances).toBeVisible();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const region = page.getByRole("region", {
      name: "Authorized instances table scroll area",
      exact: true,
    });
    await region.focus();
    await page.keyboard.press("ArrowRight");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await assertDistinctLicenceLabels(instances);
    await page.screenshot({
      path: info.outputPath("operator-registry-mobile.png"),
      fullPage: true,
    });
    expect(errors).toEqual([]);
    expect(authRequests).toEqual([]);
    expect(
      (await context.cookies()).filter((cookie) =>
        ["cra_at", "cra_rt"].includes(cookie.name),
      ),
    ).toEqual([]);
  } finally {
    await context.close();
  }
});
