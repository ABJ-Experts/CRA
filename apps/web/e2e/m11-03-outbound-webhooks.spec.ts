import { randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
import { expect, test, type BrowserContext } from "@playwright/test";
import { z } from "zod";
import * as schemas from "@repo/contracts/connectors/schemas";
import type { WebhookDelivery } from "@repo/contracts/connectors/types";
import { LIVE_API_ORIGIN, RunScopedAccounts } from "./helpers/accounts";
import {
  webOrigin,
  api,
  endpointPath,
  pause,
  stateSchema,
  control,
  parsed,
  command,
  tenant,
  delivery,
  newest,
  waitDelivery,
  invite,
  checkActorRevocation,
  checkBrowserCaches,
  cleanupMail,
  mcpCheckpoint,
  type Keys,
} from "./m11-03-live.helpers";
/* eslint-disable turbo/no-undeclared-env-vars -- Isolated live Playwright fixture runs outside Turbo. */
test("M11-03 real owner delivery, rotation, outage retry, reviewed replay, cancellation and tenant/role fences", async ({
  browser,
}, testInfo) => {
  test.setTimeout(1_800_000);
  expect(new URL(LIVE_API_ORIGIN).hostname).toBe(new URL(webOrigin).hostname);
  const fixtures = new RunScopedAccounts(testInfo);
  const contexts: BrowserContext[] = [];
  const emails: string[] = [];
  const secrets = [
    randomBytes(32).toString("base64"),
    randomBytes(32).toString("base64"),
  ];
  let organizationId: string | undefined;
  let keys: Keys = [];
  let mcpManifest: Parameters<typeof mcpCheckpoint>[0] | undefined;
  let journeyFailure: unknown;
  let cleanupFailure: unknown;
  try {
    const ownerContext = await browser.newContext({
      baseURL: webOrigin,
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    contexts.push(ownerContext);
    const owner = await fixtures.createVerified(ownerContext, "m1103-owner");
    emails.push(owner.email);
    const scope = await tenant(ownerContext, owner, fixtures);
    organizationId = scope.organizationId;
    await control("/configure", {
      organizationId,
      keys,
      behavior: "success",
      workerActive: false,
    });
    const page = await ownerContext.newPage();
    page.setDefaultTimeout(15_000);
    await page.goto("/connectors/webhooks");
    await expect(
      page.getByRole("heading", { name: "Outbound webhooks", exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/^No endpoints configured\./)).toBeVisible();
    await page
      .getByRole("button", { name: "Add webhook endpoint", exact: true })
      .click();
    await page
      .getByLabel("Display name", { exact: true })
      .fill("M11-03 receiver");
    await page
      .getByLabel("HTTPS destination", { exact: true })
      .fill("https://receiver.m11-03.test/delivery");
    await page
      .getByLabel("product.release.lifecycle_changed", { exact: true })
      .check();
    await page
      .getByLabel("product.release.market_availability_changed", {
        exact: true,
      })
      .check();
    await page.getByLabel("M11-03 receiver scope", { exact: true }).check();
    await page.getByLabel("Maximum attempts", { exact: true }).fill("2");
    await page
      .getByLabel(/^Signing secret \(optional; write-only base64\)/)
      .fill(secrets[0]!);
    let endpoint = (
      await parsed(
        await command(page, "Create disabled endpoint", "/connectors/webhooks"),
        schemas.webhookEndpointResponseSchema,
        secrets,
      )
    ).endpoint;
    expect(endpoint.enabled).toBe(false);
    expect(endpoint.hasSecret).toBe(true);
    expect(endpoint.signingKeyId).toBeTruthy();
    keys = [{ keyId: endpoint.signingKeyId!, secret: secrets[0]! }];
    await control("/configure", {
      organizationId,
      keys,
      behavior: "success",
      workerActive: true,
    });
    endpoint = (
      await parsed(
        await command(
          page,
          "Enable endpoint",
          endpointPath(endpoint.id, "/enable"),
        ),
        schemas.webhookEndpointResponseSchema,
        secrets,
      )
    ).endpoint;
    const market = await ownerContext.request.post(
      api(
        `/products/${scope.productId}/releases/${scope.releaseId}/market-availability`,
      ),
      { data: { countryCode: "DE", expectedVersion: 0 } },
    );
    expect(market.status()).toBe(201);
    let first: WebhookDelivery | undefined;
    await expect
      .poll(
        async () => {
          first = (await newest(ownerContext, endpoint.id, secrets)).find(
            (item) =>
              item.eventType === "product.release.market_availability_changed",
          );
          return first?.status;
        },
        { timeout: 60_000, intervals: [1100, 2000] },
      )
      .toBe("succeeded");
    if (!first) throw new Error("Actual release mutation was not captured");
    const firstDetail = await delivery(
      ownerContext,
      endpoint.id,
      first.id,
      secrets,
    );
    expect(firstDetail.attempts.rows[0]).toMatchObject({
      outcome: "succeeded",
      httpStatus: 204,
      responseBytes: 0,
    });
    const firstCapture = stateSchema
      .parse(await control("/state"))
      .captures.find((item) => item.deliveryId === first!.deliveryId);
    expect(firstCapture?.verifiedKeyIds).toEqual([keys[0]!.keyId]);
    const transmitted = schemas.webhookEnvelopeSchema.parse(
      JSON.parse(firstCapture!.body),
    );
    expect(transmitted.resource).toMatchObject({
      type: "release",
      id: scope.releaseId,
    });
    expect(Object.keys(transmitted).sort()).toEqual([
      "deliveryId",
      "eventId",
      "eventType",
      "occurredAt",
      "organizationId",
      "resource",
      "schemaVersion",
    ]);

    await page
      .getByLabel("New signing secret (write-only base64)", { exact: true })
      .fill(secrets[1]!);
    endpoint = (
      await parsed(
        await command(
          page,
          "Rotate signing secret",
          endpointPath(endpoint.id, "/secret"),
        ),
        schemas.webhookEndpointResponseSchema,
        secrets,
      )
    ).endpoint;
    expect(endpoint.previousSigningKeyId).toBe(keys[0]!.keyId);
    keys = [{ keyId: endpoint.signingKeyId!, secret: secrets[1]! }, ...keys];
    await control("/configure", {
      organizationId,
      keys,
      behavior: "success",
      workerActive: true,
    });
    await expect(
      page.getByLabel("New signing secret (write-only base64)", {
        exact: true,
      }),
    ).toHaveValue("");
    const signedTest = (
      await parsed(
        await command(
          page,
          "Send signed test",
          endpointPath(endpoint.id, "/test"),
        ),
        schemas.webhookDeliveryResponseSchema,
        secrets,
      )
    ).delivery;
    await waitDelivery(
      ownerContext,
      endpoint.id,
      signedTest.id,
      "succeeded",
      secrets,
    );
    const overlapCapture = stateSchema
      .parse(await control("/state"))
      .captures.find((item) => item.deliveryId === signedTest.deliveryId);
    expect(overlapCapture?.verifiedKeyIds).toEqual(
      keys.map((key) => key.keyId),
    );

    await control("/configure", {
      organizationId,
      keys,
      behavior: "outage",
      workerActive: true,
    });
    await control("/seed", { ...scope, count: 1 });
    const outage = (await newest(ownerContext, endpoint.id, secrets))[0]!;
    const failed = await waitDelivery(
      ownerContext,
      endpoint.id,
      outage.id,
      "failed",
      secrets,
    );
    expect(failed.delivery).toMatchObject({
      attemptCount: 2,
      lastFailureCategory: "receiver_unavailable",
      lastHttpStatus: 503,
    });
    expect(failed.attempts.rows).toHaveLength(2);
    const outageCaptures = stateSchema
      .parse(await control("/state"))
      .captures.filter((item) => item.deliveryId === outage.deliveryId);
    expect(outageCaptures).toHaveLength(2);
    expect(new Set(outageCaptures.map((item) => item.sha256)).size).toBe(1);
    await control("/configure", {
      organizationId,
      keys,
      behavior: "timeout",
      workerActive: true,
    });
    await control("/seed", { ...scope, count: 1 });
    const uncertain = (await newest(ownerContext, endpoint.id, secrets))[0]!;
    const timedOut = await waitDelivery(
      ownerContext,
      endpoint.id,
      uncertain.id,
      "failed",
      secrets,
    );
    expect(timedOut.delivery).toMatchObject({
      attemptCount: 2,
      lastFailureCategory: "timeout",
      lastHttpStatus: null,
    });
    const uncertainCaptures = stateSchema
      .parse(await control("/state"))
      .captures.filter((item) => item.deliveryId === uncertain.deliveryId);
    expect(uncertainCaptures).toHaveLength(2);
    expect(new Set(uncertainCaptures.map((item) => item.sha256)).size).toBe(1);

    await control("/configure", {
      organizationId,
      keys,
      behavior: "success",
      workerActive: false,
    });
    await page.reload();
    await page
      .getByRole("button", {
        name: "Open webhook M11-03 receiver",
        exact: true,
      })
      .click();
    await page
      .getByLabel("HTTPS destination", { exact: true })
      .fill("https://receiver.m11-03.test/changed");
    endpoint = (
      await parsed(
        await command(
          page,
          "Save configuration",
          endpointPath(endpoint.id),
          "PATCH",
        ),
        schemas.webhookEndpointResponseSchema,
        secrets,
      )
    ).endpoint;
    if (!endpoint.enabled)
      endpoint = (
        await parsed(
          await command(
            page,
            "Enable endpoint",
            endpointPath(endpoint.id, "/enable"),
          ),
          schemas.webhookEndpointResponseSchema,
          secrets,
        )
      ).endpoint;
    await page
      .getByRole("button", {
        name: `Inspect delivery ${outage.deliveryId}`,
        exact: true,
      })
      .click();
    const preview = (
      await parsed(
        await command(
          page,
          "Preview reviewed replay",
          endpointPath(endpoint.id, `/deliveries/${outage.id}/replay/preview`),
        ),
        schemas.webhookReplayPreviewResponseSchema,
        secrets,
      )
    ).preview;
    expect(preview.receiverChanged).toBe(true);
    await page
      .getByLabel("Replay reason", { exact: true })
      .fill("Receiver repaired and changed destination reviewed");
    await expect(
      page.getByRole("button", { name: "Replay reviewed event", exact: true }),
    ).toBeDisabled();
    await page
      .getByLabel(/^I confirm sending this event to the changed receiver/)
      .check();
    const replay = (
      await parsed(
        await command(
          page,
          "Replay reviewed event",
          endpointPath(endpoint.id, `/deliveries/${outage.id}/replay`),
        ),
        schemas.webhookDeliveryResponseSchema,
        secrets,
      )
    ).delivery;
    expect(replay).toMatchObject({
      eventId: outage.eventId,
      replayParentId: outage.id,
    });
    expect(replay.deliveryId).not.toBe(outage.deliveryId);
    await control("/configure", {
      organizationId,
      keys,
      behavior: "success",
      workerActive: true,
    });
    await waitDelivery(
      ownerContext,
      endpoint.id,
      replay.id,
      "succeeded",
      secrets,
    );
    expect(
      (await delivery(ownerContext, endpoint.id, outage.id, secrets)).delivery
        .status,
    ).toBe("failed");

    await control("/configure", {
      organizationId,
      keys,
      behavior: "rate_limit",
      workerActive: true,
    });
    await control("/seed", { ...scope, count: 1 });
    const limited = (await newest(ownerContext, endpoint.id, secrets))[0]!;
    const retrying = await waitDelivery(
      ownerContext,
      endpoint.id,
      limited.id,
      "retrying",
      secrets,
    );
    expect(retrying.delivery).toMatchObject({
      attemptCount: 1,
      lastFailureCategory: "rate_limit",
      lastHttpStatus: 429,
    });
    expect(
      Date.parse(retrying.delivery.nextAttemptAt!) -
        Date.parse(retrying.attempts.rows[0]!.finishedAt!),
    ).toBeGreaterThanOrEqual(4900);
    await control("/configure", {
      organizationId,
      keys,
      behavior: "success",
      workerActive: true,
    });
    await waitDelivery(
      ownerContext,
      endpoint.id,
      limited.id,
      "succeeded",
      secrets,
    );

    await page.reload();
    await page
      .getByRole("button", {
        name: "Open webhook M11-03 receiver",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", {
        name: `Inspect delivery ${limited.deliveryId}`,
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("table", { name: "Delivery attempts", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("m11-03-delivery-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const deliveryRegion = page.getByRole("region", {
      name: "Webhook deliveries",
      exact: true,
    });
    await deliveryRegion.focus();
    await expect(deliveryRegion).toBeFocused();
    expect(
      await deliveryRegion.evaluate(
        (node) => node.scrollWidth > node.clientWidth,
      ),
    ).toBe(true);
    const scrollBefore = await deliveryRegion.evaluate(
      (node) => node.scrollLeft,
    );
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() => deliveryRegion.evaluate((node) => node.scrollLeft))
      .toBeGreaterThan(scrollBefore);
    await page.screenshot({
      path: testInfo.outputPath("m11-03-delivery-mobile.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await checkBrowserCaches(page, secrets, organizationId);

    const viewerContext = await browser.newContext({ baseURL: webOrigin });
    contexts.push(viewerContext);
    const viewer = await fixtures.createVerified(viewerContext, "m1103-viewer");
    emails.push(viewer.email);
    await invite(ownerContext, viewerContext, viewer, fixtures, "viewer");
    await parsed(
      await viewerContext.request.get(api(endpointPath(endpoint.id))),
      schemas.webhookEndpointResponseSchema,
      secrets,
    );
    for (const suffix of [
      "/enable",
      "/secret",
      "/disable",
      `/deliveries/${outage.id}/replay/preview`,
    ])
      expect(
        (
          await viewerContext.request.post(
            api(endpointPath(endpoint.id, suffix)),
            {
              data: {
                expectedVersion: endpoint.version,
                idempotencyKey: randomUUID(),
                secretValue: secrets[0],
                reason: "Forbidden fixture action",
              },
            },
          )
        ).status(),
      ).toBe(403);
    const viewerPage = await viewerContext.newPage();
    await viewerPage.goto("/connectors/webhooks");
    await viewerPage
      .getByRole("button", {
        name: "Open webhook M11-03 receiver",
        exact: true,
      })
      .click();
    await expect(
      viewerPage.getByRole("button", { name: "Enable endpoint", exact: true }),
    ).toHaveCount(0);
    await expect(viewerPage.locator('input[type="password"]')).toHaveCount(0);
    const otherContext = await browser.newContext({ baseURL: webOrigin });
    contexts.push(otherContext);
    const other = await fixtures.createVerified(otherContext, "m1103-other");
    emails.push(other.email);
    await tenant(otherContext, other, fixtures);
    expect(
      (await otherContext.request.get(api(endpointPath(endpoint.id)))).status(),
    ).toBe(404);
    expect(
      (
        await otherContext.request.get(
          api(endpointPath(endpoint.id, `/deliveries/${outage.id}`)),
        )
      ).status(),
    ).toBe(404);
    const foreign = await parsed(
      await otherContext.request.get(api("/connectors/webhooks")),
      schemas.webhookEndpointsResponseSchema,
      secrets,
    );
    expect(foreign.endpoints.rows).toHaveLength(0);
    const adminContext = await browser.newContext({ baseURL: webOrigin });
    contexts.push(adminContext);
    const admin = await fixtures.createVerified(adminContext, "m1103-admin");
    emails.push(admin.email);
    endpoint = await checkActorRevocation(
      ownerContext,
      adminContext,
      admin,
      fixtures,
      endpoint.id,
      scope,
      keys,
      secrets,
    );
    await page.reload();
    await page
      .getByRole("button", {
        name: "Open webhook M11-03 receiver",
        exact: true,
      })
      .click();

    await control("/configure", {
      organizationId,
      keys,
      behavior: "success",
      workerActive: false,
    });
    await control("/seed", { ...scope, count: 2 });
    const pending = (await newest(ownerContext, endpoint.id, secrets)).filter(
      (item) => item.status === "pending",
    );
    expect(pending).toHaveLength(2);
    await page
      .getByLabel("Change reason", { exact: true })
      .fill("Cancel pending fixture deliveries");
    endpoint = (
      await parsed(
        await command(
          page,
          "Disable and cancel pending",
          endpointPath(endpoint.id, "/disable"),
        ),
        schemas.webhookEndpointResponseSchema,
        secrets,
      )
    ).endpoint;
    for (const item of pending)
      expect(
        (await delivery(ownerContext, endpoint.id, item.id, secrets)).delivery
          .status,
      ).toBe("canceled");
    endpoint = (
      await parsed(
        await command(
          page,
          "Enable endpoint",
          endpointPath(endpoint.id, "/enable"),
        ),
        schemas.webhookEndpointResponseSchema,
        secrets,
      )
    ).endpoint;

    const manifest = {
      ownerEmail: owner.email,
      organizationId,
      endpointId: endpoint.id,
      webOrigin,
    };
    await mcpCheckpoint(manifest);
    mcpManifest = manifest;
    if (process.env.M1103_LOAD !== "false") {
      await control("/seed", { ...scope, count: 1000 });
      await control("/configure", {
        organizationId,
        keys,
        behavior: "success",
        workerActive: true,
        workerDelayMs: 500,
      });
      const reads = [
        "/connectors/webhooks?page=1&pageSize=15",
        endpointPath(endpoint.id),
        endpointPath(endpoint.id, "/deliveries?page=1&pageSize=15"),
        endpointPath(
          endpoint.id,
          `/deliveries/${limited.id}?page=1&pageSize=15`,
        ),
      ];
      const responseSchemas: z.ZodType<unknown>[] = [
        schemas.webhookEndpointsResponseSchema,
        schemas.webhookEndpointResponseSchema,
        schemas.webhookDeliveriesResponseSchema,
        schemas.webhookDeliveryDetailResponseSchema,
      ];
      const measurements: {
        path: string;
        durationMs: number;
        status: number;
      }[] = [];
      const capturesBefore = stateSchema.parse(await control("/state")).captures
        .length;
      for (let index = 0; index < 100; index += 1) {
        for (const [readIndex, path] of reads.entries()) {
          const started = performance.now();
          const response = await ownerContext.request.get(api(path));
          await parsed(response, responseSchemas[readIndex]!, secrets);
          measurements.push({
            path,
            durationMs: performance.now() - started,
            status: response.status(),
          });
          await pause(1100);
        }
      }
      const capturesAfter = stateSchema.parse(await control("/state")).captures
        .length;
      expect(capturesAfter).toBeGreaterThan(capturesBefore);
      const metrics = reads.map((path) => {
        const values = measurements
          .filter((row) => row.path === path)
          .map((row) => row.durationMs)
          .sort((a, b) => a - b);
        return {
          path,
          count: values.length,
          p95Ms: values[Math.ceil(values.length * 0.95) - 1]!,
          p99Ms: values[Math.ceil(values.length * 0.99) - 1]!,
        };
      });
      const loadEvidence = JSON.stringify(
        {
          environment: {
            apiOrigin: LIVE_API_ORIGIN,
            webOrigin,
            browser: browser.version(),
            database: "local Supabase, generated organization only",
            receiver:
              "isolated TLS virtual hostname with dedicated CA; production public egress not exercised",
            deliveryRows: 1000,
            spacingMs: 1100,
            workerDelayMs: 500,
            capturesBefore,
            capturesAfter,
          },
          metrics,
          measurements,
        },
        null,
        2,
      );
      await writeFile(
        testInfo.outputPath("m11-03-bounded-read-load.json"),
        loadEvidence,
      );
      await testInfo.attach("m11-03-bounded-read-load", {
        body: loadEvidence,
        contentType: "application/json",
      });
      for (const metric of metrics) {
        expect(metric.count).toBeGreaterThanOrEqual(100);
        expect(metric.p95Ms, metric.path).toBeLessThan(400);
        expect(metric.p99Ms, metric.path).toBeLessThan(1000);
      }
    }
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseKey)
      throw new Error(
        "Scoped audit check requires local service-role environment",
      );
    const audits = await fetch(
      `${process.env.SUPABASE_URL ?? "http://127.0.0.1:54321"}/rest/v1/audit_logs?organization_id=eq.${organizationId}&select=*`,
      {
        headers: {
          apikey: supabaseKey,
          authorization: `Bearer ${supabaseKey}`,
        },
      },
    );
    expect(audits.status).toBe(200);
    const auditText = await audits.text();
    for (const secret of [
      ...secrets,
      "m1103-receiver-body-canary-do-not-store",
    ])
      expect(auditText).not.toContain(secret);
    const boundaryEvidence = JSON.stringify({
      keyboard:
        "Native button Enter activation and focus asserted for configuration, rotation, enable, replay and cancellation",
      mobile:
        "390px document overflow asserted; horizontal history tables remain scrollable",
      browser: browser.version(),
      receiver:
        "Dedicated self-signed CA trusted only by test DI client, loopback socket, HTTPS SNI verified",
      productionEgress:
        "Public DNS/pinned production transport separately covered by unit tests; real public receiver not used",
      fixtureOrganizationId: organizationId,
      ownerEmail: owner.email,
    });
    await writeFile(
      testInfo.outputPath(
        "m11-03-accessibility-and-boundary-observations.json",
      ),
      boundaryEvidence,
    );
    await testInfo.attach("m11-03-accessibility-and-boundary-observations", {
      body: boundaryEvidence,
      contentType: "application/json",
    });
    expect(stateSchema.parse(await control("/state")).tickFailure).toBe(false);
  } catch (error) {
    journeyFailure = error;
  } finally {
    let cleanupAllowed = true;
    if (mcpManifest) {
      try {
        await mcpCheckpoint(mcpManifest, true);
      } catch (error) {
        cleanupFailure = error;
        cleanupAllowed = false;
      }
    }
    if (organizationId) {
      try {
        await control("/configure", {
          organizationId,
          keys,
          behavior: "success",
          workerActive: false,
        });
      } catch (error) {
        cleanupFailure = error;
      }
    }
    await Promise.all(contexts.map((context) => context.close()));
    try {
      if (cleanupAllowed) {
        await fixtures.cleanup();
        await cleanupMail(emails);
      }
    } catch (error) {
      cleanupFailure = cleanupFailure
        ? new AggregateError([cleanupFailure, error])
        : error;
    }
  }
  if (journeyFailure && cleanupFailure)
    throw new AggregateError(
      [journeyFailure, cleanupFailure],
      "M11-03 journey and scoped cleanup failed",
    );
  if (journeyFailure) throw journeyFailure;
  if (cleanupFailure) throw cleanupFailure;
});
