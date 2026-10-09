import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  notificationDeliveriesResponseSchema,
  notificationPreferencesResponseSchema,
} from "@repo/contracts/notifications";
import { reportingObligationMutationResponseSchema } from "@repo/contracts/reporting/schemas";

import { LIVE_API_ORIGIN, RunScopedAccounts } from "./helpers/accounts";

/* eslint-disable turbo/no-undeclared-env-vars -- Live Playwright fixtures run outside Turbo. */

const WEB_ORIGIN = process.env.E2E_WEB_ORIGIN ?? "http://127.0.0.1:3000";
const MAILPIT_ORIGIN =
  process.env.E2E_MAILPIT_ORIGIN ?? "http://127.0.0.1:54324";
const api = (path: string) => `${LIVE_API_ORIGIN}/api/v1${path}`;

async function mailpitIds(): Promise<readonly string[]> {
  const response = await fetch(`${MAILPIT_ORIGIN}/api/v1/messages?limit=100`, {
    signal: AbortSignal.timeout(10_000),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    messages?: readonly { ID?: string; Id?: string }[];
  };
  return (body.messages ?? [])
    .map((message) => message.ID ?? message.Id)
    .filter((id): id is string => Boolean(id));
}

async function matchingMailCount(
  previousIds: ReadonlySet<string>,
  obligationId: string,
): Promise<number> {
  let count = 0;
  for (const id of await mailpitIds()) {
    if (previousIds.has(id)) continue;
    const response = await fetch(`${MAILPIT_ORIGIN}/api/v1/message/${id}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) continue;
    const message = (await response.json()) as {
      To?: readonly { Address?: string }[];
      Text?: string;
      HTML?: string;
    };
    if (
      message.To?.some(
        (recipient) => recipient.Address?.toLowerCase() === "owner@cra.test",
      ) &&
      `${message.Text ?? ""}${message.HTML ?? ""}`.includes(obligationId)
    )
      count += 1;
  }
  return count;
}

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
    if (!response.ok) {
      throw new Error(`Could not verify isolated ${table} scope`);
    }
    const rows: unknown = await response.json();
    if (!Array.isArray(rows)) {
      throw new Error(`Could not verify isolated ${table} scope`);
    }
    if (rows.length !== 0) {
      throw new Error(
        `Refusing to run a global worker with other ${table} work`,
      );
    }
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

async function openNotificationAdministration(page: Page) {
  await page.goto("/organization");
  await expect(
    page.getByRole("heading", { name: "Organization administration" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Organization settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Organization settings" });
  await dialog.getByRole("tab", { name: "Notifications" }).click();
  await expect(
    dialog.getByRole("heading", { name: "Notification delivery" }),
  ).toBeVisible();
  return dialog;
}

async function setViewerAuditPermission(
  owner: BrowserContext,
  allowed: boolean,
) {
  const response = await owner.request.put(api("/roles/overrides"), {
    data: {
      baseRole: "viewer",
      permissions: { can_view_audit: allowed },
    },
  });
  expect(response.status()).toBe(200);
}

async function setOwnerFindingPermission(
  owner: BrowserContext,
  allowed: boolean,
) {
  const response = await owner.request.put(api("/roles/overrides"), {
    data: {
      baseRole: "owner",
      permissions: { can_view_findings: allowed },
    },
  });
  expect(response.status()).toBe(200);
}

test("M12-03 preserves preference drafts and gates delivery history across permission changes", async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  expect(["localhost", "127.0.0.1"]).toContain(new URL(WEB_ORIGIN).hostname);
  expect(new URL(LIVE_API_ORIGIN).hostname).toBe(new URL(WEB_ORIGIN).hostname);

  const fixtures = new RunScopedAccounts(testInfo);
  const owner = await browser.newContext({
    baseURL: WEB_ORIGIN,
    reducedMotion: "reduce",
  });
  const viewer = await browser.newContext({
    baseURL: WEB_ORIGIN,
    reducedMotion: "reduce",
  });
  let previousOrganizationId: string | null = null;

  try {
    const ownerPage = await owner.newPage();
    await ownerPage.goto("/sign-in");
    await ownerPage.getByTestId("si-identifier").fill("owner@cra.test");
    await ownerPage.getByTestId("si-password").fill("Password123");
    const signedIn = ownerPage.waitForResponse((response) =>
      response.url().endsWith("/api/v1/auth/sign-in"),
    );
    await ownerPage.getByTestId("si-submit").click();
    expect((await signedIn).status()).toBe(200);

    const originalSession = await owner.request.get(api("/auth/session"));
    expect(originalSession.status()).toBe(200);
    previousOrganizationId =
      (
        (await originalSession.json()) as {
          organization: { id: string } | null;
        }
      ).organization?.id ?? null;

    const created = await owner.request.post(api("/organizations"), {
      data: {
        idempotencyKey: randomUUID(),
        legalName: `M12-03 notification E2E ${randomUUID()}`,
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

    await ownerPage.goto("/account");
    const preferences = ownerPage.locator("form").filter({
      has: ownerPage.getByRole("heading", { name: "Notification preferences" }),
    });
    await expect(preferences).toBeVisible();
    let preferenceWrites = 0;
    ownerPage.on("request", (request) => {
      if (
        new URL(request.url()).pathname ===
          "/api/v1/notifications/preferences" &&
        request.method() === "PATCH"
      )
        preferenceWrites += 1;
    });
    await preferences
      .getByRole("combobox", { name: "Finding triage" })
      .selectOption("daily");
    const quietHours = preferences.getByRole("textbox", {
      name: "Quiet hours",
    });
    await quietHours.fill("99:99-10:00");
    await preferences
      .getByRole("button", { name: "Save notification preferences" })
      .click();
    await expect(
      preferences
        .getByRole("alert")
        .getByText("Quiet hours must use valid 24-hour times (00:00-23:59)."),
    ).toBeVisible();
    await expect(quietHours).toHaveValue("99:99-10:00");
    expect(preferenceWrites).toBe(0);

    await quietHours.fill("10:00-10:00");
    await preferences
      .getByRole("button", { name: "Save notification preferences" })
      .click();
    await expect(
      preferences
        .getByRole("alert")
        .getByText("Quiet hours must have different start and end times."),
    ).toBeVisible();
    await expect(quietHours).toHaveValue("10:00-10:00");
    expect(preferenceWrites).toBe(0);
    await quietHours.focus();
    await ownerPage.keyboard.press("Tab");
    await expect(
      preferences.getByRole("button", {
        name: "Save notification preferences",
      }),
    ).toBeFocused();

    await quietHours.fill("22:00-06:00");
    const saved = ownerPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          "/api/v1/notifications/preferences" &&
        response.request().method() === "PATCH",
    );
    await preferences
      .getByRole("button", { name: "Save notification preferences" })
      .click();
    expect((await saved).status()).toBe(200);
    expect(preferenceWrites).toBe(1);
    await expect(
      preferences
        .getByRole("status")
        .getByText("Notification preferences saved."),
    ).toBeVisible();
    await ownerPage.evaluate(() => window.scrollTo(0, 0));
    await ownerPage.screenshot({
      path: testInfo.outputPath("m12-03-preferences-desktop.png"),
      fullPage: true,
      animations: "disabled",
    });
    await ownerPage.setViewportSize({ width: 390, height: 844 });
    await ownerPage.screenshot({
      path: testInfo.outputPath("m12-03-preferences-mobile.png"),
      fullPage: true,
      animations: "disabled",
    });
    await ownerPage.setViewportSize({ width: 1280, height: 900 });

    if (previousOrganizationId) {
      const switchedAway = await owner.request.post(
        api("/organizations/switch"),
        {
          data: { organizationId: previousOrganizationId },
        },
      );
      expect(switchedAway.status()).toBe(200);
      const switchedBack = await owner.request.post(
        api("/organizations/switch"),
        {
          data: { organizationId },
        },
      );
      expect(switchedBack.status()).toBe(200);
    }
    await ownerPage.goto("/account");
    await expect(
      ownerPage.getByRole("textbox", { name: "Quiet hours" }),
    ).toHaveValue("22:00-06:00");
    await expect(
      ownerPage.getByRole("combobox", { name: "Finding triage" }),
    ).toHaveValue("daily");

    const currentPreferences = notificationPreferencesResponseSchema.parse(
      await (await owner.request.get(api("/notifications/preferences"))).json(),
    ).preferences;
    const muted = await owner.request.patch(api("/notifications/preferences"), {
      data: {
        expectedVersion: currentPreferences.version,
        idempotencyKey: randomUUID(),
        modes: {
          finding_triage: "off",
          evidence: "off",
          supplier_owner: "off",
        },
        schedule: {
          ...currentPreferences.schedule,
          quietHours: { start: "00:00", end: "23:59" },
        },
      },
    });
    expect(muted.status()).toBe(200);
    const awarenessAt = new Date(Date.now() - 13 * 60 * 60 * 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z");
    const opened = await owner.request.post(api("/reporting/obligations"), {
      data: {
        type: "severe_incident",
        source: { kind: "manual" },
        awarenessAt,
        awarenessBasis: "Run-scoped mandatory email delivery verification.",
        idempotencyKey: randomUUID(),
      },
    });
    expect(opened.status()).toBe(201);
    const obligationId = reportingObligationMutationResponseSchema.parse(
      await opened.json(),
    ).obligation.id;
    await assertNoOtherReportingWork(organizationId);
    const mailBefore = new Set(await mailpitIds());
    runReportingWorker();
    const criticalDeliveries = notificationDeliveriesResponseSchema.parse(
      await (
        await owner.request.get(
          api(
            "/notifications/deliveries?status=provider_accepted&category=reporting_deadline&limit=50",
          ),
        )
      ).json(),
    );
    expect(
      criticalDeliveries.rows.some(
        (delivery) =>
          delivery.category === "reporting_deadline" &&
          delivery.status === "provider_accepted",
      ),
    ).toBe(true);
    await expect
      .poll(() => matchingMailCount(mailBefore, obligationId), {
        timeout: 20_000,
      })
      .toBe(1);
    runReportingWorker();
    expect(await matchingMailCount(mailBefore, obligationId)).toBe(1);

    const ownerDeliveries = ownerPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          "/api/v1/notifications/deliveries" &&
        response.request().method() === "GET",
    );
    const ownerDialog = await openNotificationAdministration(ownerPage);
    expect((await ownerDeliveries).status()).toBe(200);
    await expect(ownerDialog.getByLabel("Delivery status")).toBeVisible();
    await ownerDialog
      .getByLabel("Delivery status")
      .selectOption("provider_accepted");
    await ownerDialog.getByLabel("Category").selectOption("reporting_deadline");
    await expect(
      ownerDialog.getByRole("list", { name: "Notification deliveries" }),
    ).toBeVisible();
    await ownerPage.screenshot({
      path: testInfo.outputPath("m12-03-administration-desktop.png"),
      fullPage: true,
      animations: "disabled",
    });
    await ownerPage.setViewportSize({ width: 390, height: 844 });
    await ownerDialog
      .getByRole("list", { name: "Notification deliveries" })
      .scrollIntoViewIfNeeded();
    await ownerPage.screenshot({
      path: testInfo.outputPath("m12-03-administration-mobile.png"),
      animations: "disabled",
    });
    await ownerPage.setViewportSize({ width: 1280, height: 900 });

    const blockedObligation = await owner.request.post(
      api("/reporting/obligations"),
      {
        data: {
          type: "severe_incident",
          source: { kind: "manual" },
          awarenessAt,
          awarenessBasis:
            "Run-scoped unavailable-recipient retry verification.",
          idempotencyKey: randomUUID(),
        },
      },
    );
    expect(blockedObligation.status()).toBe(201);
    const blockedObligationId = reportingObligationMutationResponseSchema.parse(
      await blockedObligation.json(),
    ).obligation.id;
    await setOwnerFindingPermission(owner, false);
    await assertNoOtherReportingWork(organizationId);
    const mailBeforeFailure = new Set(await mailpitIds());
    runReportingWorker();
    expect(
      await matchingMailCount(mailBeforeFailure, blockedObligationId),
    ).toBe(0);
    const exhausted = notificationDeliveriesResponseSchema
      .parse(
        await (
          await owner.request.get(
            api(
              "/notifications/deliveries?status=exhausted&category=reporting_deadline&limit=50",
            ),
          )
        ).json(),
      )
      .rows.find(
        (delivery) => delivery.safeErrorCode === "recipient_unavailable",
      );
    expect(exhausted).toBeDefined();
    await ownerDialog.getByLabel("Delivery status").selectOption("exhausted");
    const retryButton = ownerDialog.getByRole("button", {
      name: `Retry delivery ${exhausted?.deliveryRef}`,
    });
    await expect(retryButton).toBeVisible();
    await ownerPage.screenshot({
      path: testInfo.outputPath("m12-03-recipient-failure.png"),
      animations: "disabled",
    });
    await ownerPage.setViewportSize({ width: 390, height: 844 });
    await retryButton.scrollIntoViewIfNeeded();
    await ownerPage.screenshot({
      path: testInfo.outputPath("m12-03-recipient-failure-mobile.png"),
      animations: "disabled",
    });
    await ownerPage.setViewportSize({ width: 1280, height: 900 });
    await setOwnerFindingPermission(owner, true);
    await retryButton.click();
    const retryQueuedMessage = ownerDialog
      .getByRole("status")
      .getByText("Delivery retry queued.");
    await expect(retryQueuedMessage).toBeVisible();
    await expect(retryButton).toHaveCount(0);
    await retryQueuedMessage.scrollIntoViewIfNeeded();
    await ownerPage.screenshot({
      path: testInfo.outputPath("m12-03-retry-queued.png"),
      animations: "disabled",
    });
    await ownerPage.setViewportSize({ width: 390, height: 844 });
    await retryQueuedMessage.scrollIntoViewIfNeeded();
    await ownerPage.screenshot({
      path: testInfo.outputPath("m12-03-retry-queued-mobile.png"),
      animations: "disabled",
    });
    await ownerPage.setViewportSize({ width: 1280, height: 900 });
    await assertNoOtherReportingWork(organizationId);
    runReportingWorker();
    await expect
      .poll(() => matchingMailCount(mailBeforeFailure, blockedObligationId), {
        timeout: 20_000,
      })
      .toBe(1);
    runReportingWorker();
    expect(
      await matchingMailCount(mailBeforeFailure, blockedObligationId),
    ).toBe(1);

    const viewerAccount = await fixtures.createVerified(
      viewer,
      "m12-03-viewer",
    );
    const invited = await owner.request.post(api("/invitations"), {
      data: { email: viewerAccount.email, role: "viewer" },
    });
    expect(invited.status()).toBe(201);
    fixtures.trackInvitation(((await invited.json()) as { id: string }).id);
    const accepted = await viewer.request.post(api("/invitations/accept"), {
      data: { token: await fixtures.invitationToken(viewerAccount.email) },
    });
    expect(accepted.status()).toBe(200);
    const viewerSwitch = await viewer.request.post(
      api("/organizations/switch"),
      {
        data: { organizationId },
      },
    );
    expect(viewerSwitch.status()).toBe(200);

    const viewerPage = await viewer.newPage();
    let unauthorizedDeliveryReads = 0;
    viewerPage.on("request", (request) => {
      if (
        new URL(request.url()).pathname ===
          "/api/v1/notifications/deliveries" &&
        request.method() === "GET"
      )
        unauthorizedDeliveryReads += 1;
    });
    const forbiddenDialog = await openNotificationAdministration(viewerPage);
    await expect(
      forbiddenDialog.getByText(
        "You do not have permission to view notification delivery history.",
      ),
    ).toBeVisible();
    await expect(forbiddenDialog.getByLabel("Delivery status")).toBeHidden();
    expect(unauthorizedDeliveryReads).toBe(0);
    await viewerPage.screenshot({
      path: testInfo.outputPath("m12-03-forbidden.png"),
      animations: "disabled",
    });

    await setViewerAuditPermission(owner, true);
    await viewerPage.reload();
    const auditRead = viewerPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          "/api/v1/notifications/deliveries" &&
        response.request().method() === "GET",
    );
    const auditDialog = await openNotificationAdministration(viewerPage);
    expect((await auditRead).status()).toBe(200);
    await expect(auditDialog.getByLabel("Delivery status")).toBeVisible();
    await auditDialog
      .getByLabel("Delivery status")
      .selectOption("provider_accepted");
    await auditDialog.getByLabel("Category").selectOption("reporting_deadline");
    await expect(
      auditDialog.getByRole("list", { name: "Notification deliveries" }),
    ).toBeVisible();
    await expect(
      auditDialog.getByRole("button", { name: "Save critical route" }),
    ).toHaveCount(0);
    await viewerPage.screenshot({
      path: testInfo.outputPath("m12-03-audit-only.png"),
      fullPage: true,
      animations: "disabled",
    });
    await viewerPage.setViewportSize({ width: 390, height: 844 });
    await auditDialog
      .getByRole("list", { name: "Notification deliveries" })
      .scrollIntoViewIfNeeded();
    await viewerPage.screenshot({
      path: testInfo.outputPath("m12-03-audit-only-mobile.png"),
      animations: "disabled",
    });
    await viewerPage.setViewportSize({ width: 1280, height: 900 });

    await setViewerAuditPermission(owner, false);
    unauthorizedDeliveryReads = 0;
    await viewerPage.reload();
    const revokedDialog = await openNotificationAdministration(viewerPage);
    await expect(
      revokedDialog.getByText(
        "You do not have permission to view notification delivery history.",
      ),
    ).toBeVisible();
    expect(unauthorizedDeliveryReads).toBe(0);
  } finally {
    try {
      if (previousOrganizationId) {
        const restored = await owner.request.post(
          api("/organizations/switch"),
          {
            data: { organizationId: previousOrganizationId },
          },
        );
        expect(restored.status()).toBe(200);
      }
    } finally {
      await Promise.allSettled([viewer.close(), owner.close()]);
      await fixtures.cleanup();
    }
  }
});
