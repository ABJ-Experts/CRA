import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
/* eslint-disable turbo/no-undeclared-env-vars -- Playwright runs outside Turbo. */
const webOrigin = process.env.E2E_WEB_ORIGIN ?? "http://localhost:3100";
const fixtureSequence = process.env.E2E_AUDIT_RANGE_SEQUENCE;
const repoRoot = resolve(new URL("../../..", import.meta.url).pathname);
const evidenceDir =
  process.env.E2E_ARTIFACTS_DIR ??
  join(repoRoot, "docs/architecture/evidence/m13-04/screenshots");
const rangePath = "/api/v1/audit/chain-verifications";
function assertDevelopmentOrigin() {
  const url = new URL(webOrigin);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "3100")
    throw new Error(
      "Range journey requires the CRA development origin on port 3100.",
    );
}
async function localOnly(context: BrowserContext) {
  const blocked: string[] = [];
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.origin === new URL(webOrigin).origin
    )
      return route.continue();
    blocked.push(url.origin);
    await route.abort("blockedbyclient");
  });
  return blocked;
}
async function login(page: Page, email: string) {
  await page.goto("/sign-in");
  const identifier = page.getByTestId("si-identifier");
  const password = page.getByTestId("si-password");
  await identifier.fill(email);
  await password.fill("Password123");
  // The incumbent login helper handles WebKit's controlled-input hydration reset.
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
    await expect(input).toHaveValue(value);
  }
  await page.getByTestId("si-submit").click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/audit");
}
function workerOnce() {
  const result = spawnSync(
    "pnpm",
    ["--filter", "api", "worker:audit-range-verification", "--once"],
    {
      cwd: repoRoot,
      env: process.env,
      encoding: "utf8",
      timeout: 55_000,
      maxBuffer: 1_048_576,
    },
  );
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
}
async function postResponse(
  page: Page,
  suffix: string,
  click: () => Promise<void>,
) {
  const response = page.waitForResponse(
    (candidate) =>
      new URL(candidate.url()).pathname.endsWith(suffix) &&
      candidate.request().method() === "POST",
  );
  await click();
  return response;
}
test("M13-04 authorized range lifecycle, precise results, and restricted access", async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  assertDevelopmentOrigin();
  expect(
    fixtureSequence,
    "Parent supplies an appended source-authorized organization event sequence",
  ).toMatch(/^[1-9][0-9]*$/);
  await mkdir(evidenceDir, { recursive: true });
  const owner = await browser.newContext({ baseURL: webOrigin });
  const viewer = await browser.newContext({ baseURL: webOrigin });
  try {
    const blocked = await localOnly(owner);
    await localOnly(viewer);
    const deniedPage = await viewer.newPage();
    await login(deniedPage, "viewer@cra.test");
    const deniedPanel = deniedPage.getByRole("region", {
      name: "Audit-chain range verification",
    });
    await expect(
      deniedPanel.getByText("Audit permission required."),
    ).toBeVisible();
    const denied = await deniedPage.request.post(rangePath, {
      data: {
        requestId: randomUUID(),
        fromSequence: fixtureSequence,
        toSequence: fixtureSequence,
      },
    });
    expect(denied.status()).toBe(403);
    await deniedPage.screenshot({
      path: join(evidenceDir, `range-denied-${testInfo.project.name}.png`),
      fullPage: true,
      animations: "disabled",
    });

    const page = await owner.newPage();
    await login(page, "owner@cra.test");
    const panel = page.getByRole("region", {
      name: "Audit-chain range verification",
    });
    await expect(
      panel.getByRole("button", { name: "Verify range" }),
    ).toBeEnabled();
    await panel.getByLabel("From sequence").fill("3");
    await panel.getByLabel("To sequence (optional)").fill("2");
    await panel.getByRole("button", { name: "Verify range" }).click();
    await expect(panel.getByRole("alert")).toContainText(
      "Check your range and checkpoint",
    );
    await expect(panel.getByLabel("From sequence")).toHaveValue("3");
    await panel.getByLabel("From sequence").fill(fixtureSequence!);
    await panel.getByLabel("To sequence (optional)").fill(fixtureSequence!);
    await panel.getByLabel(/Prior checkpoint JSON/).fill("{invalid");
    await panel.getByRole("button", { name: "Verify range" }).click();
    await expect(panel.getByRole("alert")).toBeVisible();
    await expect(panel.getByLabel(/Prior checkpoint JSON/)).toHaveValue(
      "{invalid",
    );
    const checkpointText = process.env.E2E_AUDIT_RANGE_CHECKPOINT_FILE
      ? await readFile(process.env.E2E_AUDIT_RANGE_CHECKPOINT_FILE, "utf8")
      : process.env.E2E_AUDIT_RANGE_CHECKPOINT_JSON;
    expect(
      checkpointText,
      "A saved source-authorized fixture checkpoint is required",
    ).toBeTruthy();
    await panel.getByLabel(/Prior checkpoint JSON/).fill(checkpointText!);
    await panel.getByLabel("From sequence").focus();
    // Safari's native full-control navigation uses Option+Tab when plain Tab skips buttons.
    const navigationKey =
      testInfo.project.name === "webkit" ? "Alt+Tab" : "Tab";
    await page.keyboard.press(navigationKey);
    await expect(panel.getByLabel("To sequence (optional)")).toBeFocused();
    await page.keyboard.press(navigationKey);
    await expect(panel.getByLabel(/Prior checkpoint JSON/)).toBeFocused();
    await page.keyboard.press(navigationKey);
    const verifyButton = panel.getByRole("button", { name: "Verify range" });
    await expect(verifyButton).toBeFocused();
    expect(
      await verifyButton.evaluate((element) =>
        element.matches(":focus-visible"),
      ),
    ).toBe(true);
    await page.screenshot({
      path: join(evidenceDir, `range-keyboard-${testInfo.project.name}.png`),
      fullPage: true,
      animations: "disabled",
    });
    const created = await postResponse(page, rangePath, () =>
      page.keyboard.press("Enter"),
    );
    expect(created.status()).toBe(202);
    const initial = await created.json();
    await expect(panel.getByText("Verification queued")).toBeVisible();
    const cancelled = await postResponse(page, "/cancel", () =>
      panel.getByRole("button", { name: "Cancel verification" }).click(),
    );
    expect(cancelled.status()).toBe(200);
    await expect(panel.getByText("Verification cancelled")).toBeVisible();
    await page.screenshot({
      path: join(evidenceDir, `range-cancelled-${testInfo.project.name}.png`),
      fullPage: true,
      animations: "disabled",
    });
    const resumed = await postResponse(page, "/resume", () =>
      panel.getByRole("button", { name: "Resume verification" }).click(),
    );
    expect(resumed.status()).toBe(202);
    let workerRuns = 0;
    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `${rangePath}/${initial.id}?requestId=${randomUUID()}`,
          );
          expect(response.status()).toBe(200);
          const current = await response.json();
          if (
            ["queued", "processing"].includes(current.status) &&
            workerRuns++ < 30
          )
            workerOnce();
          return current.status;
        },
        { timeout: 180_000, intervals: [500, 1000] },
      )
      .toBe("completed");
    await panel.getByRole("button", { name: "Refresh status" }).click();
    await expect(panel.getByText("Range internally consistent")).toBeVisible();
    await expect(panel.getByText(/does not prove authenticity/)).toBeVisible();
    await expect(panel.getByText("matched", { exact: true })).toBeVisible();
    await page.screenshot({
      path: join(evidenceDir, `range-consistent-${testInfo.project.name}.png`),
      fullPage: true,
      animations: "disabled",
    });
    await panel.screenshot({
      path: join(
        evidenceDir,
        `range-consistent-panel-${testInfo.project.name}.png`,
      ),
      // Capture-only chrome exclusion prevents the sticky header covering the panel.
      style: "header { visibility: hidden !important; }",
      animations: "disabled",
    });

    // Only this disposable browser context's access cookie is removed.
    await owner.clearCookies({ name: "cra_at" });
    const expiredRead = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `${rangePath}/${initial.id}` &&
        response.request().method() === "GET" &&
        response.status() === 401,
    );
    const refreshedSession = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v1/auth/refresh" &&
        response.request().method() === "POST" &&
        response.status() === 200,
    );
    const retriedRead = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `${rangePath}/${initial.id}` &&
        response.request().method() === "GET" &&
        response.status() === 200,
    );
    await panel.getByRole("button", { name: "Refresh status" }).click();
    await Promise.all([expiredRead, refreshedSession, retriedRead]);
    await expect(panel.getByText("Range internally consistent")).toBeVisible();
    const refreshed = await page.request.get("/api/v1/auth/session");
    expect(refreshed.status()).toBe(200);

    // Explicitly labelled UI fixture; live audit history is never tampered with.
    const currentResponse = await page.request.get(
      `${rangePath}/${initial.id}?requestId=${randomUUID()}`,
    );
    const current = await currentResponse.json();
    await page.route(`**${rangePath}/${initial.id}?*`, async (route) => {
      await route.fulfill({
        json: {
          ...current,
          result: {
            ...current.result,
            outcome: "integrity_break",
            verifiedPrefix: null,
            firstAffectedSequence: fixtureSequence,
            breaks: [
              {
                category: "hash_mismatch",
                fromSequence: fixtureSequence,
                toSequence: fixtureSequence,
              },
            ],
            sampleSequences: [fixtureSequence],
          },
        },
      });
    });
    await panel.getByRole("button", { name: "Refresh status" }).click();
    await expect(panel.getByText("Integrity break detected")).toBeVisible();
    await expect(panel.getByRole("table")).toHaveAccessibleName(
      /Bounded integrity breaks/,
    );
    await page.evaluate(() => {
      const label = document.createElement("p");
      label.textContent = "Injected UI fixture — not live audit evidence";
      label.setAttribute("role", "note");
      document
        .querySelector("section[aria-label='Audit-chain range verification']")
        ?.prepend(label);
    });
    await page.screenshot({
      path: join(
        evidenceDir,
        `range-integrity-fixture-${testInfo.project.name}.png`,
      ),
      fullPage: true,
      animations: "disabled",
    });
    await panel.screenshot({
      path: join(
        evidenceDir,
        `range-integrity-fixture-panel-${testInfo.project.name}.png`,
      ),
      style: "header { visibility: hidden !important; }",
      animations: "disabled",
    });
    const sessionResponse = await page.request.get("/api/v1/auth/session");
    expect(sessionResponse.status()).toBe(200);
    const session = await sessionResponse.json();
    const alternate = session.organizations.find(
      (organization: { id: string }) =>
        organization.id !== session.organization.id,
    );
    if (alternate) {
      const switched = await page.request.post("/api/v1/organizations/switch", {
        data: { organizationId: alternate.id },
      });
      expect(switched.status()).toBe(200);
      await page.reload();
      await expect(
        panel.getByText("Range internally consistent"),
      ).not.toBeVisible();
      await expect(
        panel.getByText("Integrity break detected"),
      ).not.toBeVisible();
      await expect(panel.getByText("Verification completed")).not.toBeVisible();
      const hiddenOldJob = await page.request.get(
        `${rangePath}/${initial.id}?requestId=${randomUUID()}`,
      );
      expect([403, 404]).toContain(hiddenOldJob.status());
      await page.screenshot({
        path: join(
          evidenceDir,
          `range-org-switched-${testInfo.project.name}.png`,
        ),
        fullPage: true,
        animations: "disabled",
      });
      const restoredOrganization = await page.request.post(
        "/api/v1/organizations/switch",
        { data: { organizationId: session.organization.id } },
      );
      expect(restoredOrganization.status()).toBe(200);
    } else
      testInfo.annotations.push({
        type: "limitation",
        description:
          "Seeded owner has no alternate existing membership; browser organization switching was unavailable.",
      });
    expect(blocked).toEqual([]);
    await writeFile(
      join(evidenceDir, `range-journey-${testInfo.project.name}.json`),
      JSON.stringify(
        {
          browserEngine: testInfo.project.name,
          browserVersion: browser.version(),
          developmentOrigin: webOrigin,
          driver: "installed Playwright CLI",
          sourceAuthorizedFixture: true,
          compactCheckpointMatched: true,
          keyboardFocusAndSubmit: true,
          keyboardNavigationKey: navigationKey,
          cancellationAndResume: true,
          actualWorkerConsistent: true,
          cookieRefreshNetworkSequence: [401, 200, 200],
          organizationSwitchExercised: Boolean(alternate),
          integrityScreenshotIsInjectedFixture: true,
          externalRequests: blocked.length,
          limitations: alternate
            ? []
            : [
                "Seeded owner has no alternate existing membership; organization switching is covered by unit/SQL tests, not this browser run.",
              ],
        },
        null,
        2,
      ),
    );
  } finally {
    await owner.close();
    await viewer.close();
  }
});
