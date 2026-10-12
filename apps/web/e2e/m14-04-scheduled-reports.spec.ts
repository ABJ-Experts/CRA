import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/* eslint-disable turbo/no-undeclared-env-vars -- Local browser gates run outside Turbo. */
const origin = process.env.E2E_WEB_ORIGIN ?? "http://localhost:3000";

async function signIn(page: Page, email: string) {
  await page.goto(`${origin}/sign-in`);
  await page
    .getByRole("button", { name: "Show password", exact: true })
    .click();
  await page.getByTestId("si-identifier").fill(email);
  await page.getByTestId("si-password").fill("Password123");
  await page.getByTestId("si-submit").click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function blockExternal(context: BrowserContext) {
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.origin === origin || !["http:", "https:"].includes(url.protocol)
      ? route.continue()
      : route.abort("blockedbyclient");
  });
}

/** Cleanup is restricted to the definition created by this test. */
async function archiveSavedReport(page: Page, reportId: string) {
  async function current() {
    const response = await page.request.get(
      `${origin}/api/v1/reports/definitions/${reportId}`,
    );
    if (!response.ok())
      throw new Error(
        `Could not load the test report for cleanup (${response.status()})`,
      );
    const body = (await response.json()) as {
      data: { id: string; state: string; version: number };
    };
    if (body.data.id !== reportId)
      throw new Error("Cleanup report identity changed");
    return body.data;
  }

  async function command(operation: "pause" | "archive", version: number) {
    const response = await page.request.post(
      `${origin}/api/v1/reports/definitions/${reportId}/${operation}`,
      {
        data: { expectedVersion: version, idempotencyKey: crypto.randomUUID() },
      },
    );
    if (!response.ok())
      throw new Error(
        `Could not ${operation} the test report (${response.status()})`,
      );
  }

  const saved = await current();
  if (saved.state === "archived") return;
  if (saved.state === "active") await command("pause", saved.version);
  const latest = await current();
  if (latest.state !== "archived") await command("archive", latest.version);
}

test("owner previews and activates a member report; recipient link is single-use and other members are denied", async ({
  page,
  context,
  browser,
}, testInfo) => {
  test.setTimeout(420_000);
  test.skip(
    process.env.E2E_REPORTS_LIVE !== "true",
    "Requires the local M14-04 API, scheduler, export worker, and seeded users.",
  );
  expect(["localhost", "127.0.0.1"]).toContain(new URL(origin).hostname);
  await blockExternal(context);
  await signIn(page, "owner@cra.test");

  await page.goto(`${origin}/products`);
  await page.getByRole("link", { name: "Schedule report" }).first().click();
  await expect(page).toHaveURL(/\/dashboard\/reports\?draft=/);
  const title = `M14-04 browser schedule ${Date.now()}`;
  await page.getByLabel("Report title").fill(title);
  const due = new Date(Date.now() + 3 * 60_000);
  const localTime = `${String(due.getUTCHours()).padStart(2, "0")}:${String(due.getUTCMinutes()).padStart(2, "0")}`;
  await page.getByLabel("Time zone").fill("UTC");
  await page.getByLabel("Local time").fill(localTime);
  await page
    .getByRole("checkbox", {
      name: "Request email links for eligible recipients",
    })
    .check();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `${origin}/api/v1/reports/definitions`,
        );
        if (response.status() !== 200) return null;
        const body = (await response.json()) as {
          items: { id: string; config: { title: string } }[];
        };
        return (
          body.items.find((item) => item.config.title === title)?.id ?? null
        );
      },
      { timeout: 20_000 },
    )
    .not.toBeNull();
  const listResponse = await page.request.get(
    `${origin}/api/v1/reports/definitions`,
  );
  const list = (await listResponse.json()) as {
    items: {
      id: string;
      ownerUserId: string;
      config: { title: string };
      version: number;
    }[];
  };
  const saved = list.items.find((item) => item.config.title === title);
  expect(saved).toBeDefined();
  const reportId = saved!.id;
  try {
    const emailToggle = page.getByRole("button", { name: "Turn on email" });
    if (await emailToggle.isVisible()) await emailToggle.click();

    await page.getByRole("button", { name: "Preview report" }).click();
    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `${origin}/api/v1/reports/runs?definitionId=${reportId}`,
          );
          if (response.status() !== 200) return "unavailable";
          const body = (await response.json()) as {
            items: { kind: string; state: string }[];
          };
          return (
            body.items.find((item) => item.kind === "preview")?.state ??
            "pending"
          );
        },
        { timeout: 120_000, intervals: [1000, 2000, 3000] },
      )
      .toBe("succeeded");
    await page.getByRole("button", { name: "Refresh preview" }).click();
    await expect(
      page.getByRole("button", { name: "Activate schedule" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Activate schedule" }).click();
    await expect(page.getByText("Report activated.")).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("scheduled-report-desktop.png"),
      fullPage: true,
      animations: "disabled",
    });

    const viewerContext = await browser.newContext();
    try {
      await blockExternal(viewerContext);
      const viewer = await viewerContext.newPage();
      await signIn(viewer, "viewer@cra.test");
      const denied = await viewer.request.get(
        `${origin}/api/v1/reports/definitions/${reportId}`,
      );
      expect([403, 404]).toContain(denied.status());
    } finally {
      await viewerContext.close();
    }

    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `${origin}/api/v1/reports/runs?definitionId=${reportId}`,
          );
          if (response.status() !== 200) return null;
          const body = (await response.json()) as {
            items: { id: string; kind: string; state: string }[];
          };
          return (
            body.items.find(
              (item) => item.kind === "scheduled" && item.state === "succeeded",
            )?.id ?? null
          );
        },
        { timeout: 240_000, intervals: [3000, 5000] },
      )
      .not.toBeNull();
    const runsResponse = await page.request.get(
      `${origin}/api/v1/reports/runs?definitionId=${reportId}`,
    );
    const runs = (await runsResponse.json()) as {
      items: { id: string; kind: string; state: string }[];
    };
    const runId = runs.items.find(
      (item) => item.kind === "scheduled" && item.state === "succeeded",
    )!.id;
    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `${origin}/api/v1/reports/runs/${runId}`,
          );
          if (!response.ok()) return null;
          const body = (await response.json()) as {
            recipients: {
              userId: string;
              generationState: string;
              emailState: string;
            }[];
          };
          const ownerResult = body.recipients.find(
            (recipient) => recipient.userId === saved!.ownerUserId,
          );
          return ownerResult
            ? {
                generationState: ownerResult.generationState,
                emailState: ownerResult.emailState,
              }
            : null;
        },
        { timeout: 60_000, intervals: [1000, 3000] },
      )
      .toEqual({ generationState: "ready", emailState: "accepted" });
    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `${origin}/api/v1/notifications/feed?includeScheduledReports=true&category=scheduled_report`,
          );
          if (response.status() !== 200) return false;
          const body = (await response.json()) as {
            items: { category: string }[];
          };
          return body.items.some(
            (item) => item.category === "scheduled_report",
          );
        },
        { timeout: 60_000, intervals: [1000, 3000] },
      )
      .toBe(true);
    const deliveryResponse = await page.request.get(
      `${origin}/api/v1/notifications/deliveries?includeScheduledReports=true&category=scheduled_report`,
    );
    expect(deliveryResponse.status()).toBe(200);
    const deliveries = (await deliveryResponse.json()) as {
      rows: { category: string; status: string }[];
    };
    expect(
      deliveries.rows.some((row) => row.category === "scheduled_report"),
    ).toBe(true);
    await page.goto(`${origin}/dashboard/reports/runs/${runId}`);
    await expect(
      page.getByRole("heading", { name: "Report run" }),
    ).toBeVisible();
    await expect(page.getByText(/Generation: ready/).first()).toBeVisible();
    await page
      .getByRole("button", { name: "Prepare protected download" })
      .first()
      .click();
    const link = page.getByRole("link", { name: "Open protected download" });
    const protectedPath = await link.getAttribute("href");
    expect(protectedPath).toMatch(/^\/api\/v1\/reports\/runs\//);
    const first = await page.request.get(`${origin}${protectedPath}`);
    expect(first.status()).toBe(200);
    const repeated = await page.request.get(`${origin}${protectedPath}`);
    expect([403, 404, 409, 410]).toContain(repeated.status());
    const replay = await page.request.post(
      `${origin}/api/v1/reports/runs/${runId}/replay`,
      { data: { expectedVersion: 1, idempotencyKey: crypto.randomUUID() } },
    );
    expect([403, 409, 422]).toContain(replay.status());
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      ),
    ).toBe(false);
    await page.screenshot({
      path: testInfo.outputPath("scheduled-report-mobile.png"),
      fullPage: true,
      animations: "disabled",
    });
  } finally {
    await archiveSavedReport(page, reportId);
  }
});
