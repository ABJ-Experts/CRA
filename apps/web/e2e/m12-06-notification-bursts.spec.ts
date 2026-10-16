import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";
import { notificationBurstPolicyResponseSchema } from "@repo/contracts/notifications";
import { legalEntitiesResponseSchema } from "@repo/contracts/organizations/schemas";
import {
  productResponseSchema,
  releaseResponseSchema,
} from "@repo/contracts/products/schemas";

import { LIVE_API_ORIGIN, RunScopedAccounts } from "./helpers/accounts";

/* eslint-disable turbo/no-undeclared-env-vars -- Live Playwright fixtures run outside Turbo. */

const WEB_ORIGIN = process.env.E2E_WEB_ORIGIN ?? "http://127.0.0.1:3000";
const SUPABASE_ORIGIN = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const MAILPIT_ORIGIN =
  process.env.E2E_MAILPIT_ORIGIN ?? "http://127.0.0.1:54324";
const fixtureHoldMs = Number(process.env.E2E_M12_06_HOLD_MS ?? "0");
if (!Number.isInteger(fixtureHoldMs) || fixtureHoldMs < 0 || fixtureHoldMs > 60_000)
  throw new Error("E2E_M12_06_HOLD_MS must be between 0 and 60000");
const api = (path: string) => `${LIVE_API_ORIGIN}/api/v1${path}`;
const templateFindingId = "90100000-0000-4000-8000-000000000014";

async function localSupabase(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key)
    throw new Error(
      "Scoped M12-06 browser fixture requires a local service-role key",
    );
  const response = await fetch(`${SUPABASE_ORIGIN}${path}`, {
    ...init,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(
      `Scoped Supabase fixture request failed: ${response.status}`,
    );
  return response;
}

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

async function matchingBurstMail(
  previousIds: ReadonlySet<string>,
  batchId: string,
): Promise<readonly string[]> {
  const matches: string[] = [];
  for (const id of await mailpitIds()) {
    if (previousIds.has(id)) continue;
    const response = await fetch(`${MAILPIT_ORIGIN}/api/v1/message/${id}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) continue;
    const message = (await response.json()) as {
      To?: readonly { Address?: string }[];
      Subject?: string;
      Text?: string;
      HTML?: string;
    };
    if (
      message.To?.some(
        ({ Address }) => Address?.toLowerCase() === "owner@cra.test",
      ) &&
      message.Subject === "CRA notification updates (2)" &&
      `${message.Text ?? ""}${message.HTML ?? ""}`.includes(
        `/notifications?batchId=${batchId}`,
      )
    )
      matches.push(id);
  }
  return matches;
}

function runScopedBurstWorker(organizationId: string): void {
  const script = `
    const { randomUUID } = require("node:crypto");
    const { NestFactory } = require("@nestjs/core");
    const { AppModule } = require("./dist/app.module");
    const { MailService } = require("./dist/mail/mail.service");
    const { SupabaseService } = require("./dist/supabase/supabase.service");
    const { BurstNotificationDispatchWorker } = require("./dist/notifications/worker/burst-notification-dispatch-worker");
    const { SupabaseNotificationBurstQueueAdapter } = require("./dist/notifications/worker/supabase-notification-burst-queue.adapter");
    const { MailNotificationDispatchDeliveryAdapter } = require("./dist/notifications/worker/mail-notification-dispatch-delivery.adapter");
    (async () => {
      const organizationId = process.argv[1];
      const context = await NestFactory.createApplicationContext(AppModule, { bufferLogs: false });
      try {
        const adapter = new SupabaseNotificationBurstQueueAdapter(context.get(SupabaseService));
        const mail = new MailNotificationDispatchDeliveryAdapter(context.get(MailService));
        const queue = {
          reconcileAmbiguousLeases: async () => ({ outcome: "reconciled", dispatches: 0, digests: 0 }),
          dueOrganizations: async (after) => ({ organizationIds: after === null ? [organizationId] : [], nextOrganizationId: null }),
          schedule: (id) => adapter.schedule(id),
          claim: (input) => adapter.claim(input),
          prepare: (input) => adapter.prepare(input),
          revalidate: (input) => adapter.revalidate(input),
          complete: (input) => adapter.complete(input),
          fail: (input) => adapter.fail(input),
        };
        const worker = new BurstNotificationDispatchWorker({
          workerId: randomUUID(), leaseSeconds: 120, queue,
          delivery: { send: (input) => mail.send({ ...input, dispatchId: input.batchId }) },
        });
        await worker.runOnce();
      } finally {
        await context.close();
      }
    })().catch(() => { process.exitCode = 1; });
  `;
  const result = spawnSync("node", ["-e", script, organizationId], {
    cwd: resolve(process.cwd(), "../api"),
    env: { ...process.env, APP_URL: WEB_ORIGIN },
    encoding: "utf8",
    timeout: 90_000,
    maxBuffer: 2_000_000,
  });
  if (result.status !== 0)
    throw new Error("Run-scoped notification burst worker failed");
}

test("M12-06 organization opt-in and grouped inbox remain scoped and usable", async ({
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  expect(["localhost", "127.0.0.1"]).toContain(new URL(WEB_ORIGIN).hostname);
  expect(new URL(LIVE_API_ORIGIN).hostname).toBe(new URL(WEB_ORIGIN).hostname);
  expect(["localhost", "127.0.0.1"]).toContain(
    new URL(SUPABASE_ORIGIN).hostname,
  );
  const fixtures = new RunScopedAccounts(testInfo);
  const owner = await browser.newContext({
    baseURL: WEB_ORIGIN,
    reducedMotion: "reduce",
  });
  let previousOrganizationId: string | null = null;
  let fixtureOrganizationId: string | null = null;
  let fixtureFindingId: string | null = null;
  const fixtureEventIds: string[] = [];
  const fixtureDispatchIds: string[] = [];
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

    const sessionResponse = await owner.request.get(api("/auth/session"));
    expect(sessionResponse.status()).toBe(200);
    const session = (await sessionResponse.json()) as {
      user: { id: string };
      organization: { id: string } | null;
    };
    previousOrganizationId = session.organization?.id ?? null;
    const created = await owner.request.post(api("/organizations"), {
      data: {
        idempotencyKey: randomUUID(),
        legalName: `M12-06 notification E2E ${randomUUID()}`,
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
    fixtureOrganizationId = organizationId;
    fixtures.trackM2V2Organization(organizationId);
    const mode = await localSupabase(
      "/rest/v1/rpc/set_notification_delivery_mode_atomic",
      {
        method: "POST",
        body: JSON.stringify({
          p_organization_id: organizationId,
          p_mode: "unified",
        }),
      },
    );
    expect(((await mode.json()) as { outcome: string }[])[0]?.outcome).toBe(
      "updated",
    );

    const entitiesResponse = await owner.request.get(
      api("/organizations/current/legal-entities"),
    );
    expect(entitiesResponse.status()).toBe(200);
    const legalEntity = legalEntitiesResponseSchema.parse(
      await entitiesResponse.json(),
    ).legalEntities[0];
    if (!legalEntity)
      throw new Error("Scoped organization has no legal entity");
    const productResponse = await owner.request.post(api("/products"), {
      data: {
        name: "M12-06 scoped burst fixture",
        internalCode: `M1206-${randomUUID()}`,
        productType: "standalone_software",
        responsibleOwnerId: session.user.id,
        legalEntityId: legalEntity.id,
        idempotencyKey: randomUUID(),
      },
    });
    expect(productResponse.status()).toBe(201);
    const product = productResponseSchema.parse(
      await productResponse.json(),
    ).product;
    const releaseResponse = await owner.request.post(
      api(`/products/${product.id}/releases`),
      {
        data: {
          label: "Scoped burst release",
          version: "1.0.0",
          idempotencyKey: randomUUID(),
        },
      },
    );
    expect(releaseResponse.status()).toBe(201);
    const release = releaseResponseSchema.parse(
      await releaseResponse.json(),
    ).release;

    await page.goto("/organization");
    await page.getByRole("button", { name: "Organization settings" }).click();
    const dialog = page.getByRole("dialog", { name: "Organization settings" });
    await dialog.getByRole("tab", { name: "Notifications" }).click();
    const panel = dialog.getByRole("region", { name: "Notification bursts" });
    await expect(panel).toBeVisible();
    const toggle = panel.getByRole("checkbox", {
      name: /Batch eligible notifications/,
    });
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await panel.getByRole("button", { name: "Save burst policy" }).click();
    await expect(panel.getByText("Burst policy saved.")).toBeVisible();
    const current = await owner.request.get(api("/notifications/burst-policy"));
    expect(current.status()).toBe(200);
    expect(
      notificationBurstPolicyResponseSchema.parse(await current.json()).policy
        .enabled,
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("m12-06-burst-policy-desktop.png"),
      animations: "disabled",
    });

    const windowStartMs =
      Math.floor((Date.now() - 240_000) / 120_000) * 120_000;
    const windowStart = new Date(windowStartMs).toISOString();
    const createdAt = new Date(windowStartMs + 30_000).toISOString();
    const startedAt = new Date(windowStartMs - 1_000).toISOString();
    await localSupabase(
      `/rest/v1/organization_settings?organization_id=eq.${organizationId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          notification_burst_started_at: startedAt,
          notification_feed_started_at: startedAt,
        }),
      },
    );
    const select = [
      "component_identity",
      "canonical_advisory_id",
      "vulnerability_id",
      "source_feed_key",
      "source_record_id",
      "source_record_version_id",
      "affected_range_id",
      "match_method",
      "comparator_name",
      "comparator_version",
      "evaluated_component_value",
      "affected_range",
      "event_sequence",
      "confidence",
      "confidence_table_version",
      "confidence_explanation",
    ].join(",");
    const templateResponse = await localSupabase(
      `/rest/v1/vulnerability_findings?select=${select}&id=eq.${templateFindingId}`,
    );
    const template = (
      (await templateResponse.json()) as Record<string, unknown>[]
    )[0];
    if (!template) throw new Error("Local M5 source fixture is unavailable");
    fixtureFindingId = randomUUID();
    await localSupabase("/rest/v1/vulnerability_findings", {
      method: "POST",
      body: JSON.stringify({
        ...template,
        id: fixtureFindingId,
        organization_id: organizationId,
        release_id: release.id,
        component_identity: `pkg:npm/m1206-${fixtureFindingId}@1.0.0`,
      }),
    });
    const firstEventId = randomUUID();
    const secondEventId = randomUUID();
    fixtureEventIds.push(firstEventId, secondEventId);
    await localSupabase("/rest/v1/vulnerability_triage_alert_events", {
      method: "POST",
      body: JSON.stringify(
        [firstEventId, secondEventId].map((id, index) => ({
          id,
          organization_id: organizationId,
          finding_id: fixtureFindingId,
          event_kind: "internal_sla_breached",
          event_key: `m1206_e2e:${id}:${index}`,
          state: "delivered",
          created_at: createdAt,
          due_at: createdAt,
          delivered_at: new Date().toISOString(),
        })),
      ),
    });

    await page.goto("/notifications");
    await page.getByLabel("Feed view").selectOption("grouped");
    await expect(page.getByText("2 visible events; 2 unread.")).toBeVisible();
    await expect(
      page.getByRole("list", { name: /Representative events/ }),
    ).toBeVisible();
    const summary = page.getByRole("link", { name: /filtered inbox/ });
    await expect(summary).toHaveAttribute(
      "href",
      `/notifications?eventClass=finding_sla_breached&windowStart=${windowStart}`,
    );
    await page.getByLabel("Read state").focus();
    await page.keyboard.press("Tab");
    await expect(summary).toBeFocused();
    await summary.click();
    await expect(
      page.getByRole("link", { name: "Clear batch filter" }),
    ).toBeVisible();
    await expect(page.getByText("Finding triage SLA breached")).toHaveCount(2);
    await page.getByRole("link", { name: "Clear batch filter" }).click();
    await page.getByLabel("Feed view").selectOption("grouped");
    await expect(page.getByText("2 visible events; 2 unread.")).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("m12-06-grouped-inbox-desktop.png"),
      animations: "disabled",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByLabel("Feed view")).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("m12-06-grouped-inbox-mobile.png"),
      animations: "disabled",
    });
    if (fixtureHoldMs > 0) {
      console.log(
        `M12-06 scoped organization ${organizationId} available for ${fixtureHoldMs} ms`,
      );
      await page.waitForTimeout(fixtureHoldMs);
    }

    // A second, still queued pair exercises the real scoped worker and SMTP
    // path. Backdated ingestion is confined to this disposable organization.
    const mailBefore = new Set(await mailpitIds());
    const queuedEventIds = [randomUUID(), randomUUID()];
    fixtureEventIds.push(...queuedEventIds);
    await localSupabase("/rest/v1/vulnerability_triage_alert_events", {
      method: "POST",
      body: JSON.stringify(
        queuedEventIds.map((id, index) => ({
          id,
          organization_id: organizationId,
          finding_id: fixtureFindingId,
          event_kind: "internal_sla_breached",
          event_key: `m1206_mail:${id}:${index}`,
          state: "queued",
          created_at: createdAt,
          due_at: createdAt,
        })),
      ),
    });
    const dispatchIds = [randomUUID(), randomUUID()];
    fixtureDispatchIds.push(...dispatchIds);
    await localSupabase("/rest/v1/notification_dispatches", {
      method: "POST",
      body: JSON.stringify(
        dispatchIds.map((id, index) => ({
          id,
          organization_id: organizationId,
          category: "finding_triage",
          source_type: "finding_triage_alert",
          source_id: queuedEventIds[index],
          source_subtype: "internal_sla_breached",
          source_link: `/findings?findingId=${fixtureFindingId}`,
          safe_title: `M12-06 scoped burst ${index + 1}`,
          original_recipient_user_id: session.user.id,
          effective_recipient_user_id: session.user.id,
          status: "queued",
          next_attempt_at: createdAt,
          created_at: createdAt,
        })),
      ),
    });
    const pending = await localSupabase(
      `/rest/v1/notification_dispatches?select=id,status&organization_id=eq.${organizationId}&id=in.(${dispatchIds.join(",")})`,
    );
    expect((await pending.json()) as { status: string }[]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "burst_pending" }),
        expect.objectContaining({ status: "burst_pending" }),
      ]),
    );
    runScopedBurstWorker(organizationId);
    const batches = await localSupabase(
      `/rest/v1/notification_digest_batches?select=id,status,dispatch_ids,prepared_dispatch_ids&organization_id=eq.${organizationId}&batch_kind=eq.burst`,
    );
    const batchRows = (await batches.json()) as {
      id: string;
      status: string;
      dispatch_ids: string[];
      prepared_dispatch_ids: string[];
    }[];
    expect(batchRows).toHaveLength(1);
    expect(batchRows[0]).toMatchObject({
      status: "provider_accepted",
      dispatch_ids: expect.arrayContaining(dispatchIds),
      prepared_dispatch_ids: expect.arrayContaining(dispatchIds),
    });
    const batchId = batchRows[0]?.id;
    if (!batchId) throw new Error("Scoped burst batch was not persisted");
    await expect
      .poll(() => matchingBurstMail(mailBefore, batchId), { timeout: 20_000 })
      .toHaveLength(1);
    runScopedBurstWorker(organizationId);
    expect(await matchingBurstMail(mailBefore, batchId)).toHaveLength(1);

    await page.goto(`/notifications?batchId=${batchId}`);
    await expect(
      page.getByRole("link", { name: "Clear batch filter" }),
    ).toBeVisible();
    await expect(page.getByText("Finding triage SLA breached")).toHaveCount(2);

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({
      path: testInfo.outputPath("m12-06-mail-batch-inbox-desktop.png"),
      animations: "disabled",
    });
    await page.goto("/organization");
    await page.getByRole("button", { name: "Organization settings" }).click();
    const historyDialog = page.getByRole("dialog", {
      name: "Organization settings",
    });
    await historyDialog.getByRole("tab", { name: "Notifications" }).click();
    const historyTable = historyDialog.getByRole("table", {
      name: "Notification burst deliveries",
    });
    await expect(historyTable).toBeVisible();
    await expect(
      historyDialog.getByRole("cell", {
        name: "Provider accepted; final delivery unconfirmed",
      }),
    ).toBeVisible();
    await historyTable.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath("m12-06-burst-history-desktop.png"),
      animations: "disabled",
    });
  } finally {
    try {
      if (fixtureOrganizationId) {
        await localSupabase(
          `/rest/v1/notification_digest_batches?organization_id=eq.${fixtureOrganizationId}&batch_kind=eq.burst`,
          { method: "DELETE" },
        );
      }
      if (fixtureOrganizationId && fixtureDispatchIds.length > 0) {
        await localSupabase(
          `/rest/v1/notification_dispatches?organization_id=eq.${fixtureOrganizationId}&id=in.(${fixtureDispatchIds.join(",")})`,
          { method: "DELETE" },
        );
      }
      if (fixtureOrganizationId && fixtureEventIds.length > 0) {
        await localSupabase(
          `/rest/v1/vulnerability_triage_alert_events?organization_id=eq.${fixtureOrganizationId}&id=in.(${fixtureEventIds.join(",")})`,
          { method: "DELETE" },
        );
      }
      if (fixtureOrganizationId && fixtureFindingId) {
        await localSupabase(
          `/rest/v1/vulnerability_findings?organization_id=eq.${fixtureOrganizationId}&id=eq.${fixtureFindingId}`,
          { method: "DELETE" },
        );
      }
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
      await owner.close();
      await fixtures.cleanup();
    }
  }
});
