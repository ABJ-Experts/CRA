import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { expect, test, type BrowserContext } from "@playwright/test";
import {
  agentStatusResponseSchema,
  connectorResponseSchema,
} from "@repo/contracts/connectors/schemas";
import { LIVE_API_ORIGIN, RunScopedAccounts } from "./helpers/accounts";

/* eslint-disable turbo/no-undeclared-env-vars -- Live Playwright fixtures run outside Turbo. */
const WEB_ORIGIN = process.env.E2E_WEB_ORIGIN ?? "http://localhost:3000";
const MAIL_ORIGIN = process.env.E2E_MAILPIT_ORIGIN ?? "http://127.0.0.1:54324";
const apiPath = (suffix: string) => `${LIVE_API_ORIGIN}/api/v1${suffix}`;

async function createOrganization(context: BrowserContext, ownerEmail: string) {
  const response = await context.request.post(apiPath("/organizations"), {
    data: {
      idempotencyKey: randomUUID(),
      legalName: `M11-06 agent fixture ${randomUUID()}`,
      registeredAddress: {
        addressLine1: "11 Integration Street",
        locality: "London",
        postalCode: "SW1A 1AA",
        country: "GB",
      },
      mainEstablishmentCountry: "GB",
      manufacturerContactName: "Agent Fixture Owner",
      manufacturerContactEmail: ownerEmail,
    },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { id: string };
  return body.id;
}

/** Delete only Mailpit messages addressed entirely to this run's generated accounts. */
async function cleanupRunMail(emails: readonly string[]) {
  if (!emails.length) return;
  const listing = await fetch(`${MAIL_ORIGIN}/api/v1/messages?limit=1000`);
  expect(listing.ok).toBe(true);
  const body = (await listing.json()) as {
    messages?: { ID?: string; Id?: string }[];
  };
  const owned: string[] = [];
  for (const item of body.messages ?? []) {
    const id = item.ID ?? item.Id;
    if (!id) continue;
    const response = await fetch(
      `${MAIL_ORIGIN}/api/v1/message/${encodeURIComponent(id)}`,
    );
    if (!response.ok) continue;
    const message = (await response.json()) as {
      To?: { Address?: string }[];
    };
    if (
      message.To?.length &&
      message.To.every(
        ({ Address }) =>
          Address !== undefined && emails.includes(Address.toLowerCase()),
      )
    )
      owned.push(id);
  }
  if (!owned.length) return;
  const deletion = await fetch(`${MAIL_ORIGIN}/api/v1/messages`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ IDs: owned }),
  });
  expect(deletion.ok).toBe(true);
}

test("M11-06 owner enrolls and revokes an outbound agent while a viewer remains read-only", async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  expect(new URL(LIVE_API_ORIGIN).hostname).toBe(new URL(WEB_ORIGIN).hostname);
  const fixtures = new RunScopedAccounts(testInfo);
  const ownerContext = await browser.newContext({
    baseURL: WEB_ORIGIN,
    reducedMotion: "reduce",
  });
  const viewerContext = await browser.newContext({
    baseURL: WEB_ORIGIN,
    reducedMotion: "reduce",
  });
  const emails: string[] = [];
  ownerContext.setDefaultTimeout(15_000);
  viewerContext.setDefaultTimeout(15_000);
  let journeyError: unknown;
  let cleanupError: unknown;
  try {
    const page = await ownerContext.newPage();
    await page.goto("/sign-in");
    await page.getByTestId("si-identifier").fill("owner@cra.test");
    await page.getByTestId("si-password").fill("Password123");
    const signIn = page.waitForResponse((response) =>
      response.url().endsWith("/api/v1/auth/sign-in"),
    );
    await page.getByTestId("si-submit").click();
    expect((await signIn).status()).toBe(200);
    await expect(page).toHaveURL(/\/dashboard$/);
    fixtures.trackOrganization(
      await createOrganization(ownerContext, "owner@cra.test"),
    );
    await page.goto("/connectors");
    await page
      .getByRole("button", { name: "Configure On-premises agent" })
      .click();
    await expect(page.getByLabel("Connector type")).toHaveValue(
      "on_prem_agent",
    );
    await page
      .getByLabel("Display name", { exact: true })
      .fill("M11-06 factory source");
    await expect(page.getByLabel("Mapping version")).toHaveValue(
      "on-prem-agent-v1",
    );
    const creation = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v1/connectors" &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Add connector", exact: true })
      .click();
    const created = await creation;
    expect(created.status()).toBe(201);
    const connectorId = connectorResponseSchema.parse(await created.json())
      .connector.id;
    await expect(page).toHaveURL(new RegExp(`/connectors/${connectorId}$`));
    await expect(
      page.getByText("No agent is enrolled for this connector."),
    ).toBeVisible();

    const enrollment = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/v1/connectors/${connectorId}/agents/enrollments` &&
        response.request().method() === "POST",
    );
    const issueButton = page.getByRole("button", {
      name: "Issue enrollment token",
    });
    await issueButton.focus();
    await expect(issueButton).toBeFocused();
    await page.keyboard.press("Enter");
    expect((await enrollment).status()).toBe(201);
    await expect(page.getByText("One-time enrollment token")).toBeVisible();
    const tokenLength = await page
      .getByText("One-time enrollment token")
      .locator("..")
      .locator("code")
      .evaluate((element) => element.textContent?.length ?? 0);
    expect(tokenLength).toBeGreaterThanOrEqual(32);
    const hideTokenButton = page.getByRole("button", {
      name: "Hide enrollment token",
    });
    await hideTokenButton.focus();
    await expect(hideTokenButton).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByText("One-time enrollment token")).toHaveCount(0);
    await page.reload();
    await expect(page.getByText("One-time enrollment token")).toHaveCount(0);

    const statusResponse = await ownerContext.request.get(
      apiPath(`/connectors/${connectorId}/agents`),
    );
    expect(statusResponse.status()).toBe(200);
    const status = agentStatusResponseSchema.parse(await statusResponse.json());
    expect(status.agent?.status).toBe("pending");
    const agentId = status.agent!.id;
    const readLatencies: number[] = [];
    // Stay below the existing 60/minute global IP throttle, including the UI's reads.
    for (let group = 0; group < 8; group += 1) {
      await Promise.all(
        Array.from({ length: 5 }, async () => {
          const started = performance.now();
          const response = await ownerContext.request.get(
            apiPath(`/connectors/${connectorId}/agents`),
          );
          expect(response.status()).toBe(200);
          readLatencies.push(performance.now() - started);
        }),
      );
    }
    const sortedLatencies = [...readLatencies].sort(
      (left, right) => left - right,
    );
    const p95 = sortedLatencies[Math.ceil(sortedLatencies.length * 0.95) - 1]!;
    const p99 = sortedLatencies[Math.ceil(sortedLatencies.length * 0.99) - 1]!;
    const readLoadPath = testInfo.outputPath("m11-06-agent-status-read-load.json");
    await writeFile(
      readLoadPath,
      JSON.stringify({ requests: 40, concurrency: 5, p95Ms: p95, p99Ms: p99 }),
    );
    await testInfo.attach("agent-status-read-load", {
      path: readLoadPath,
      contentType: "application/json",
    });
    expect(p95).toBeLessThan(400);
    expect(p99).toBeLessThan(1_000);
    await expect(page.getByText("Awaiting first contact")).toBeVisible();
    await expect(page.getByText("No pages have been staged.")).toBeVisible();
    const pendingScreenshot = testInfo.outputPath("m11-06-agent-pending.png");
    await page.screenshot({ path: pendingScreenshot, fullPage: true });
    await testInfo.attach("agent-pending", {
      path: pendingScreenshot,
      contentType: "image/png",
    });

    const viewer = await fixtures.createVerified(
      viewerContext,
      "m11-06-viewer",
    );
    emails.push(viewer.email);
    const invitation = await ownerContext.request.post(
      apiPath("/invitations"),
      {
        data: { email: viewer.email, role: "viewer" },
      },
    );
    expect(invitation.status()).toBe(201);
    const invitationBody = (await invitation.json()) as { id: string };
    fixtures.trackInvitation(invitationBody.id);
    const accepted = await viewerContext.request.post(
      apiPath("/invitations/accept"),
      { data: { token: await fixtures.invitationToken(viewer.email) } },
    );
    expect(accepted.status()).toBe(200);
    expect(
      (
        await viewerContext.request.get(
          apiPath(`/connectors/${connectorId}/agents`),
        )
      ).status(),
    ).toBe(200);
    expect(
      (
        await viewerContext.request.post(
          apiPath(`/connectors/${connectorId}/agents/enrollments`),
          { data: { idempotencyKey: randomUUID() } },
        )
      ).status(),
    ).toBe(403);
    expect(
      (
        await viewerContext.request.post(
          apiPath(`/connectors/${connectorId}/agents/${agentId}/revoke`),
          { data: { idempotencyKey: randomUUID() } },
        )
      ).status(),
    ).toBe(403);
    const viewerPage = await viewerContext.newPage();
    await viewerPage.goto(`/connectors/${connectorId}`);
    await expect(viewerPage.getByText("Awaiting first contact")).toBeVisible();
    await expect(
      viewerPage.getByRole("button", { name: "Revoke agent" }),
    ).toHaveCount(0);
    await expect(
      viewerPage.getByRole("button", { name: "Issue enrollment token" }),
    ).toHaveCount(0);
    const viewerScreenshot = testInfo.outputPath("m11-06-agent-viewer.png");
    await viewerPage.screenshot({ path: viewerScreenshot, fullPage: true });
    await testInfo.attach("agent-viewer", {
      path: viewerScreenshot,
      contentType: "image/png",
    });

    const revokeButton = page.getByRole("button", { name: "Revoke agent" });
    await revokeButton.focus();
    await expect(revokeButton).toBeFocused();
    await page.keyboard.press("Enter");
    const revocation = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/v1/connectors/${connectorId}/agents/${agentId}/revoke` &&
        response.request().method() === "POST",
    );
    const confirmRevokeButton = page.getByRole("button", {
      name: "Confirm revoke",
    });
    await confirmRevokeButton.focus();
    await expect(confirmRevokeButton).toBeFocused();
    await page.keyboard.press("Enter");
    expect((await revocation).status()).toBe(201);
    await expect(
      page.getByText(/Recovery requires a new on-premises connector/),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Issue enrollment token" }),
    ).toHaveCount(0);
    expect(
      (
        await ownerContext.request.post(
          apiPath(`/connectors/${connectorId}/agents/enrollments`),
          { data: { idempotencyKey: randomUUID() } },
        )
      ).status(),
    ).toBe(409);
    const revokedScreenshot = testInfo.outputPath("m11-06-agent-revoked.png");
    await page.screenshot({ path: revokedScreenshot, fullPage: true });
    await testInfo.attach("agent-revoked", {
      path: revokedScreenshot,
      contentType: "image/png",
    });
    await testInfo.attach("accessibility-checks", {
      body: "Native keyboard-operable buttons, focused enrollment token and revocation confirmation, textual status and safe errors, reduced motion. No automated WCAG conformance claim.",
      contentType: "text/plain",
    });
  } catch (error) {
    journeyError = error;
  } finally {
    const cleanup = await Promise.allSettled([
      ownerContext.close(),
      viewerContext.close(),
      fixtures.cleanup(),
      cleanupRunMail(emails),
    ]);
    const failures = cleanup.filter(
      (entry): entry is PromiseRejectedResult => entry.status === "rejected",
    );
    if (failures.length)
      cleanupError = new AggregateError(
        failures.map((entry) => entry.reason),
        "M11-06 exact fixture cleanup failed",
      );
  }
  if (journeyError && cleanupError)
    throw new AggregateError(
      [journeyError, cleanupError],
      "M11-06 journey and exact fixture cleanup failed",
    );
  if (journeyError) throw journeyError;
  if (cleanupError) throw cleanupError;
});
