import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";
import { notificationFeedResponseSchema } from "@repo/contracts/notifications";
import { reportingObligationMutationResponseSchema } from "@repo/contracts/reporting/schemas";

import { LIVE_API_ORIGIN, RunScopedAccounts } from "./helpers/accounts";

/* eslint-disable turbo/no-undeclared-env-vars -- Live Playwright fixtures run outside Turbo. */

const WEB_ORIGIN = process.env.E2E_WEB_ORIGIN ?? "http://127.0.0.1:3000";
const api = (path: string) => `${LIVE_API_ORIGIN}/api/v1${path}`;
const eventId = "55555555-5555-4555-8555-555555555555";
const ref = `m6_${eventId}_event`;
const fingerprint = "a".repeat(64);

async function assertNoOtherReportingWork(organizationId: string) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error("Scoped live test requires a service key");
  const base = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
  for (const [table, filters] of [
    ["reporting_obligations", "status=eq.active&is_rehearsal=eq.false"],
    [
      "reporting_deadline_alert_deliveries",
      "delivery_state=in.(queued,retrying,leased)",
    ],
  ] as const) {
    const url = new URL(`/rest/v1/${table}`, base);
    url.search = `select=id&organization_id=neq.${organizationId}&${filters}&limit=1`;
    const response = await fetch(url, {
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new Error(`Could not verify isolated ${table} scope`);
    const rows: unknown = await response.json();
    if (!Array.isArray(rows))
      throw new Error(`Could not verify isolated ${table} scope`);
    if (rows.length !== 0)
      throw new Error(
        `Refusing to run a global worker with other ${table} work`,
      );
  }
}

function runReportingWorker() {
  const result = spawnSync(
    "node",
    ["dist/reporting-deadline-monitor-worker.js", "--once"],
    {
      cwd: resolve(process.cwd(), "../api"),
      env: { ...process.env, APP_URL: WEB_ORIGIN },
      encoding: "utf8",
      timeout: 90_000,
      maxBuffer: 2_000_000,
    },
  );
  if (result.status !== 0)
    throw new Error("Reporting deadline worker failed in the scoped live test");
}

test("M12-04 notification centre keeps scoped work usable through feed and link failures", async ({
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  expect(["localhost", "127.0.0.1"]).toContain(new URL(WEB_ORIGIN).hostname);
  expect(new URL(LIVE_API_ORIGIN).hostname).toBe(new URL(WEB_ORIGIN).hostname);

  const fixtures = new RunScopedAccounts(testInfo);
  const owner = await browser.newContext({
    baseURL: WEB_ORIGIN,
    reducedMotion: "reduce",
  });
  let previousOrganizationId: string | null = null;

  try {
    const page = await owner.newPage();
    await page.goto("/sign-in");
    await page.getByTestId("si-identifier").fill("owner@cra.test");
    await page.getByTestId("si-password").fill("Password123");
    const signIn = page.waitForResponse((response) =>
      response.url().endsWith("/api/v1/auth/sign-in"),
    );
    await page.getByTestId("si-submit").click();
    expect((await signIn).status()).toBe(200);

    const originalSession = await owner.request.get(api("/auth/session"));
    expect(originalSession.status()).toBe(200);
    const initialIdentity = (await originalSession.json()) as {
      user: { id: string };
      organization: { id: string } | null;
    };
    previousOrganizationId = initialIdentity.organization?.id ?? null;
    const ownerUserId = initialIdentity.user.id;

    const created = await owner.request.post(api("/organizations"), {
      data: {
        idempotencyKey: randomUUID(),
        legalName: `M12-04 notification E2E ${randomUUID()}`,
        registeredAddress: {
          addressLine1: "12 Notification Street",
          locality: "London",
          postalCode: "SW1A 1AA",
          country: "GB",
        },
        mainEstablishmentCountry: "GB",
        manufacturerContactName: "Notification Test Owner",
        manufacturerContactEmail: "owner@cra.test",
      },
    });
    expect(created.status()).toBe(201);
    const organizationId = ((await created.json()) as { id: string }).id;
    fixtures.trackOrganization(organizationId);

    const emptyFeed = await owner.request.get(api("/notifications/feed"));
    expect(emptyFeed.status()).toBe(200);
    expect(
      notificationFeedResponseSchema.parse(await emptyFeed.json()).items,
    ).toEqual([]);
    const unreadCount = await owner.request.get(
      api("/notifications/feed/unread-count"),
    );
    expect(unreadCount.status()).toBe(200);
    expect((await unreadCount.json()) as { count: number }).toEqual({
      count: 0,
    });

    await page.goto("/notifications");
    await expect(
      page.getByRole("heading", { name: "Notifications" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "No notifications" }),
    ).toBeVisible();

    const awarenessAt = new Date(Date.now() - 13 * 60 * 60 * 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z");
    const opened = await owner.request.post(api("/reporting/obligations"), {
      data: {
        type: "severe_incident",
        source: { kind: "manual" },
        awarenessAt,
        awarenessBasis: "Run-scoped in-app deadline notification verification.",
        idempotencyKey: randomUUID(),
      },
    });
    expect(opened.status()).toBe(201);
    const obligationId = reportingObligationMutationResponseSchema.parse(
      await opened.json(),
    ).obligation.id;
    await assertNoOtherReportingWork(organizationId);
    runReportingWorker();

    const realFeedResponse = await owner.request.get(
      api("/notifications/feed?limit=50"),
    );
    expect(realFeedResponse.status()).toBe(200);
    const realFeed = notificationFeedResponseSchema.parse(
      await realFeedResponse.json(),
    );
    const realEvent = realFeed.items.find(
      (entry) =>
        entry.category === "reporting_deadline" && entry.noticeKind === "event",
    );
    expect(realEvent).toBeDefined();
    if (!realEvent)
      throw new Error("Scoped deadline event did not reach the feed");
    await page.reload();
    await expect(page.getByText(realEvent.summary).first()).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("m12-04-real-feed-desktop.png"),
      animations: "disabled",
    });
    await page
      .getByRole("checkbox", { name: `Select ${realEvent.title}` })
      .first()
      .check();
    await page.getByRole("button", { name: "Mark selected as read" }).click();
    await expect
      .poll(async () => {
        const response = await owner.request.get(
          api("/notifications/feed?limit=50"),
        );
        if (!response.ok()) return false;
        return (
          notificationFeedResponseSchema
            .parse(await response.json())
            .items.find((entry) => entry.ref === realEvent.ref)?.read ?? false
        );
      })
      .toBe(true);
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) throw new Error("Scoped live test requires a service key");
    const dbUrl = new URL(
      "/rest/v1/notification_feed_reads",
      process.env.SUPABASE_URL ?? "http://127.0.0.1:54321",
    );
    dbUrl.search = `select=ref,read_at&organization_id=eq.${organizationId}&user_id=eq.${ownerUserId}&ref=eq.${encodeURIComponent(realEvent.ref)}`;
    const persistedRead = await fetch(dbUrl, {
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    expect(persistedRead.status).toBe(200);
    expect((await persistedRead.json()) as unknown[]).toHaveLength(1);
    await page
      .getByRole("button", { name: `Open ${realEvent.title}` })
      .first()
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/reporting\\?obligationId=${obligationId}`),
    );
    await page.goto("/notifications");

    let read = false;
    let forbidden = false;
    let offline = false;
    await page.route("**/api/v1/notifications/feed**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (offline && path === "/api/v1/notifications/feed") {
        await route.abort("failed");
        return;
      }
      if (forbidden && path === "/api/v1/notifications/feed") {
        await route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({
            success: false,
            message: "Forbidden",
            code: "forbidden",
          }),
        });
        return;
      }
      if (path === "/api/v1/notifications/feed" && request.method() === "GET") {
        const body = notificationFeedResponseSchema.parse({
          items: [
            {
              ref,
              category: "reporting_deadline",
              severity: "critical",
              occurredAt: "2026-10-01T10:00:00.000Z",
              title: "Reporting deadline",
              summary: "A regulatory deadline needs attention.",
              read,
              fingerprint,
              sourceState: "available",
              noticeKind: "event",
            },
          ],
          nextCursor: null,
        });
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(body),
        });
        return;
      }
      if (path.endsWith("/destination")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ state: "unavailable", url: null }),
        });
        return;
      }
      if (path.endsWith("/mark-read") && request.method() === "POST") {
        read = true;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: [{ ref, fingerprint, readAt: "2026-10-01T10:05:00.000Z" }],
            replayed: false,
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.reload();
    await expect(
      page.getByText("A regulatory deadline needs attention."),
    ).toBeVisible();
    await expect(page.getByText("Unread", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open Reporting deadline" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "Notification is no longer available",
    );
    await expect(page).toHaveURL(/\/notifications$/);
    await page
      .getByRole("checkbox", { name: "Select Reporting deadline" })
      .check();
    await page.getByRole("button", { name: "Mark selected as read" }).click();
    await expect(page.getByText("Read", { exact: true })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("m12-04-notifications-desktop.png"),
      animations: "disabled",
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: testInfo.outputPath("m12-04-notifications-mobile.png"),
      animations: "disabled",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 900 });

    forbidden = true;
    await page.reload();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "no longer have access",
    );
    forbidden = false;
    offline = true;
    await page.reload();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "offline",
    );
    await page.goto("/tasks");
    await expect(
      page.getByRole("heading", { name: "Task inbox" }),
    ).toBeVisible();
  } finally {
    try {
      if (previousOrganizationId) {
        const restored = await owner.request.post(
          api("/organizations/switch"),
          { data: { organizationId: previousOrganizationId } },
        );
        expect(restored.status()).toBe(200);
      }
    } finally {
      await owner.close();
      await fixtures.cleanup();
    }
  }
});
