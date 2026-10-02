import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import {
  expect,
  test,
  type Page,
  type TestInfo,
  type Locator,
} from "@playwright/test";
import {
  productClassificationHistoryResponseSchema,
  productsResponseSchema,
  saveProductClassificationResponseSchema,
  type ProductClassificationAnswers,
  type ProductClassificationRun,
} from "@repo/contracts/products";
import { LIVE_API_ORIGIN, RunScopedAccounts, signIn } from "./helpers/accounts";
/* eslint-disable turbo/no-undeclared-env-vars -- Playwright runs outside Turbo. */
const WEB_ORIGIN = process.env.E2E_WEB_ORIGIN ?? "http://localhost:3002";
async function onboardRunOrganization(
  page: Page,
  email: string,
  fixtureName: string,
): Promise<string> {
  await page.goto("/onboarding");
  await page
    .getByRole("textbox", { name: "Legal organization name", exact: true })
    .fill(fixtureName);
  const establishmentCountry = page.getByRole("combobox", {
    name: "Main establishment country",
    exact: true,
  });
  await establishmentCountry.press("Space");
  await page.keyboard.type("United Kingdom");
  await page.keyboard.press("Enter");
  await expect(establishmentCountry).toContainText("United Kingdom");
  await page
    .getByRole("textbox", { name: "Registered address line 1", exact: true })
    .fill("100 Classification Test Street");
  await page
    .getByRole("textbox", { name: "City or locality", exact: true })
    .fill("London");
  await page
    .getByRole("textbox", { name: "Postal code", exact: true })
    .fill("SW1A 1AA");
  const addressCountry = page.getByRole("combobox", {
    name: "Registered address country",
    exact: true,
  });
  await addressCountry.press("Space");
  await page.keyboard.type("United Kingdom");
  await page.keyboard.press("Enter");
  await expect(addressCountry).toContainText("United Kingdom");
  await page
    .getByRole("textbox", { name: "Manufacturer contact name", exact: true })
    .fill("Classification Owner");
  await page
    .getByRole("textbox", { name: "Manufacturer contact email", exact: true })
    .fill(email);

  const created = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/organizations" &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Create organization", exact: true })
    .click();
  const response = await created;
  expect(response.status()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function capture(
  page: Page,
  testInfo: TestInfo,
  name: string,
  focus?: Locator,
) {
  const target =
    focus ??
    page.getByRole("heading", {
      name: "Classification history",
      exact: true,
    });
  await target.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath(`${name}-desktop.png`),
    fullPage: false,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await target.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath(`${name}-mobile.png`),
    fullPage: false,
  });
  await page.setViewportSize({ width: 1280, height: 720 });
}

test("classification declarations branch, retain immutable history, retry manually, and reject stale writes", async ({
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const fixtures = new RunScopedAccounts(testInfo);
  const context = await browser.newContext({ baseURL: WEB_ORIGIN });
  const viewer = await browser.newContext({ baseURL: WEB_ORIGIN });
  let journeyError: unknown;
  let cleanupError: unknown;
  try {
    const account = await fixtures.createVerified(
      context,
      "classification-owner",
    );
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const orgId = await onboardRunOrganization(
      page,
      account.email,
      `E2E Classification ${Date.now()}`,
    );
    fixtures.trackM2V2Organization(orgId);
    const legal = await context.request.get(
      `${LIVE_API_ORIGIN}/api/v1/organizations/current/legal-entities`,
    );
    expect(legal.status()).toBe(200);
    const legalBody = (await legal.json()) as {
      legalEntities: { id: string }[];
    };
    const created = await context.request.post(
      `${LIVE_API_ORIGIN}/api/v1/products`,
      {
        data: {
          name: "E2E Classification Product",
          internalCode: `CLASS-${Date.now()}`,
          productType: "standalone_software",
          legalEntityId: legalBody.legalEntities[0]!.id,
          responsibleOwnerId: account.publicUserId,
          idempotencyKey: randomUUID(),
        },
      },
    );
    expect(created.status()).toBe(201);
    const productId = ((await created.json()) as { product: { id: string } })
      .product.id;
    const endpoint = `/api/v1/products/${productId}/classifications`;
    const read = async () => {
      const response = await context.request.get(
        `${LIVE_API_ORIGIN}${endpoint}`,
      );
      expect(response.status()).toBe(200);
      return productClassificationHistoryResponseSchema.parse(
        await response.json(),
      );
    };
    await page.goto(`/products/${productId}`);
    await page
      .getByRole("button", { name: "CRA classification", exact: true })
      .click();
    const panel = page.getByRole("region", {
      name: "CRA classification",
      exact: true,
    });
    await expect(panel).toBeVisible();
    await expect(
      panel.getByText("Customer declaration, engineering provisional"),
    ).toBeVisible();
    const scope = panel.getByRole("combobox", { name: /Have you determined/ });
    const critical = () =>
      panel.getByRole("combobox", { name: /critical product category/ });
    const classII = () =>
      panel.getByRole("combobox", { name: /important Class II category/ });
    const classI = () =>
      panel.getByRole("combobox", { name: /important Class I category/ });
    const rationale = panel.getByRole("textbox", {
      name: "Classification rationale",
      exact: true,
    });
    const save = panel.getByRole("button", {
      name: "Save classification",
      exact: true,
    });
    const branches = [
      {
        scope: "out_of_scope",
        classification: "out_of_scope",
        label: "Out of scope",
      },
      {
        scope: "undetermined",
        classification: "undetermined",
        label: "Undetermined",
      },
      {
        scope: "in_scope",
        critical: "yes",
        classification: "critical",
        label: "Critical",
      },
      {
        scope: "in_scope",
        critical: "no",
        classII: "yes",
        classification: "important_class_ii",
        label: "Important Class II",
      },
      {
        scope: "in_scope",
        critical: "no",
        classII: "no",
        classI: "yes",
        classification: "important_class_i",
        label: "Important Class I",
      },
      {
        scope: "in_scope",
        critical: "no",
        classII: "no",
        classI: "no",
        classification: "default",
        label: "Default",
      },
      {
        scope: "in_scope",
        critical: "no",
        classII: "undetermined",
        classification: "undetermined",
        label: "Undetermined",
      },
      {
        scope: "in_scope",
        critical: "no",
        classII: "no",
        classI: "undetermined",
        classification: "undetermined",
        label: "Undetermined",
      },
      {
        scope: "in_scope",
        critical: "undetermined",
        classification: "undetermined",
        label: "Undetermined",
      },
    ];
    let previousId: string | null = null;
    const saved: ProductClassificationRun[] = [];
    for (const [index, branch] of branches.entries()) {
      await expect(save).toBeEnabled({ timeout: 30_000 });
      await scope.selectOption(branch.scope);
      if (branch.critical) await critical().selectOption(branch.critical);
      if (branch.classII) await classII().selectOption(branch.classII);
      if (branch.classI) await classI().selectOption(branch.classI);
      if (branch.scope !== "in_scope") await expect(critical()).toHaveCount(0);
      const text =
        index === 0
          ? '<img src=x onerror="window.classificationAttack=true">'
          : `Reviewed declaration ${index}`;
      await rationale.fill(text);
      const responseWait = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === endpoint &&
          r.request().method() === "POST",
        { timeout: 30_000 },
      );
      await save.click();
      const response = await responseWait;
      expect(response.status()).toBe(200);
      const { run } = saveProductClassificationResponseSchema.parse(
        await response.json(),
      );
      expect(run.classification).toBe(branch.classification);
      expect(run.revision).toBe(index + 1);
      expect(run.supersedesId).toBe(previousId);
      expect(run.policyHash).toBe(run.policySnapshot.hash);
      expect(run.policyHash).toMatch(/^[a-f0-9]{64}$/);
      previousId = run.id;
      saved.push(run);
      await expect(
        panel.getByText("Classification saved.", { exact: true }),
      ).toBeVisible();
      await expect(save).toBeEnabled({ timeout: 30_000 });
      await expect(
        panel
          .getByRole("list", { name: "Classification runs" })
          .getByText(`Provisional: ${branch.label} · Latest`, { exact: true }),
      ).toBeVisible();
    }
    await expect(
      panel
        .getByRole("list", { name: "Classification runs" })
        .getByText(saved[0]!.rationale, { exact: true }),
    ).toBeVisible();
    for (const run of saved) {
      const savedAnswers = panel.locator(
        `dl[aria-label="Saved answers, revision ${run.revision}"]`,
      );
      await expect(savedAnswers.locator("dt")).toHaveCount(4);
      const labels = Object.entries(run.answers).map(([key, value]) =>
        value === null
          ? "Skipped"
          : key === "scope"
            ? {
                in_scope: "In scope",
                out_of_scope: "Out of scope",
                undetermined: "Undetermined",
              }[value as ProductClassificationAnswers["scope"]]
            : { yes: "Yes", no: "No", undetermined: "Undetermined" }[
                value as "yes" | "no" | "undetermined"
              ],
      );
      await expect(savedAnswers.locator("dd")).toHaveText(labels);
      for (const question of run.policySnapshot.questions)
        await expect(savedAnswers).toContainText(question.prompt);
    }
    expect(await page.evaluate(() => "classificationAttack" in window)).toBe(
      false,
    );
    expect((await read()).runs.rows).toEqual([...saved].reverse());
    await capture(page, testInfo, "classification-immutable-history");

    // The server accepts the POST; only its response is lost. The user retries explicitly.
    const retryKeys: string[] = [];
    let loseResponse = true;
    await context.route(`**${endpoint}`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      retryKeys.push(
        (route.request().postDataJSON() as { idempotencyKey: string })
          .idempotencyKey,
      );
      const response = await route.fetch();
      if (loseResponse) {
        loseResponse = false;
        expect(response.status()).toBe(200);
        await route.abort("failed");
      } else await route.fulfill({ response });
    });
    await rationale.fill("Accepted response lost, manual retry");
    await save.click();
    await expect(panel.getByRole("alert")).toContainText(
      "Your draft is preserved",
    );
    await expect(rationale).toHaveValue("Accepted response lost, manual retry");
    await save.click();
    await expect(
      panel.getByText("Classification saved.", { exact: true }),
    ).toBeVisible();
    await expect(save).toBeEnabled({ timeout: 30_000 });
    expect(retryKeys).toHaveLength(2);
    expect(retryKeys[1]).toBe(retryKeys[0]);
    await context.unroute(`**${endpoint}`);
    const afterRetry = await read();
    expect(afterRetry.runs.rows).toHaveLength(saved.length + 1);
    await capture(page, testInfo, "classification-manual-retry");

    // An independent command changes the revision while this editor retains its draft.
    await rationale.fill("Keep this draft after concurrent edit");
    const latest = afterRetry.latest!;
    const external = await context.request.post(
      `${LIVE_API_ORIGIN}${endpoint}`,
      {
        data: {
          expectedProductVersion: afterRetry.productVersion,
          expectedRevision: latest.revision,
          policyVersion: afterRetry.policy.version,
          policyHash: afterRetry.policy.hash,
          idempotencyKey: randomUUID(),
          answers: {
            scope: "out_of_scope",
            criticalCoreFunction: null,
            classIICoreFunction: null,
            classICoreFunction: null,
          } satisfies ProductClassificationAnswers,
          rationale: "Independent reviewer revision",
        },
      },
    );
    expect(external.status()).toBe(200);
    const conflictResponse = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === endpoint &&
        r.request().method() === "POST",
    );
    await save.click();
    expect((await conflictResponse).status()).toBe(409);
    await expect(save).toBeDisabled();
    await expect(rationale).toHaveValue(
      "Keep this draft after concurrent edit",
    );
    await capture(
      page,
      testInfo,
      "classification-conflict-preserved",
      panel.getByRole("alert"),
    );
    await panel
      .getByRole("button", {
        name: "Refresh classification revision",
        exact: true,
      })
      .click();
    await expect(save).toBeEnabled({ timeout: 30_000 });
    await expect(rationale).toHaveValue(
      "Keep this draft after concurrent edit",
    );
    await save.click();
    await expect(
      panel.getByText("Classification saved.", { exact: true }),
    ).toBeVisible();
    await expect(save).toBeEnabled({ timeout: 30_000 });
    const final = await read();
    expect(final.latest!.revision).toBe(saved.length + 3);
    expect(final.runs.rows.find((run) => run.id === saved[0]!.id)).toEqual(
      saved[0],
    );

    expect((await signIn(viewer.request, "viewer@cra.test")).status()).toBe(
      200,
    );
    expect(
      (await viewer.request.get(`${LIVE_API_ORIGIN}${endpoint}`)).status(),
    ).toBe(404);
    expect(
      (
        await viewer.request.post(`${LIVE_API_ORIGIN}${endpoint}`, { data: {} })
      ).status(),
    ).toBe(403);
    const seedProducts = await viewer.request.get(
      `${LIVE_API_ORIGIN}/api/v1/products`,
    );
    expect(seedProducts.status()).toBe(200);
    const seedBody = productsResponseSchema.parse(await seedProducts.json());
    expect(seedBody.products.rows.length).toBeGreaterThan(0);
    const seedRead = await viewer.request.get(
      `${LIVE_API_ORIGIN}/api/v1/products/${seedBody.products.rows[0]!.id}/classifications`,
    );
    expect(seedRead.status()).toBe(200);

    if (process.env.E2E_CLASSIFICATION_READ_LOAD === "true") {
      // Local-stack diagnostic only: 50 bounded authenticated reads, four workers.
      const durations: {
        kind: "history" | "latest";
        elapsedMs: number;
        status: number;
      }[] = [];
      let nextRead = 0;
      await Promise.all(
        Array.from({ length: 4 }, async () => {
          while (nextRead < 50) {
            const index = nextRead++;
            const kind = index % 2 === 0 ? "history" : "latest";
            const path =
              kind === "history"
                ? endpoint
                : `/api/v1/products/classifications?productIds=${productId}`;
            const started = performance.now();
            const response = await context.request.get(
              `${LIVE_API_ORIGIN}${path}`,
            );
            await response.body();
            durations.push({
              kind,
              elapsedMs: Math.round(performance.now() - started),
              status: response.status(),
            });
            expect(response.status()).toBe(200);
          }
        }),
      );
      const sorted = durations
        .map((row) => row.elapsedMs)
        .sort((a, b) => a - b);
      const metrics = {
        environment:
          "local CRA, one product with 12 immutable runs; diagnostic, not production load",
        concurrency: 4,
        reads: durations,
        p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
        p99Ms: sorted[Math.ceil(sorted.length * 0.99) - 1],
      };
      await writeFile(
        testInfo.outputPath("classification-read-timings.json"),
        JSON.stringify(metrics, null, 2),
      );
    }

    await page.goto("/products");
    const row = page
      .getByRole("listitem")
      .filter({ hasText: "E2E Classification Product" });
    await expect(row).toContainText("Provisional: Undetermined");
    await row.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath("classification-registry-desktop.png"),
      fullPage: false,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await row.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath("classification-registry-mobile.png"),
      fullPage: false,
    });
  } catch (error) {
    journeyError = error;
    process.stderr.write(
      `Classification journey failed: ${error instanceof Error ? error.stack : String(error)}\n`,
    );
    const page = context.pages()[0];
    if (page && !page.isClosed())
      await page
        .screenshot({
          path: testInfo.outputPath("classification-failure.png"),
          fullPage: false,
        })
        .catch(() => undefined);
  } finally {
    await Promise.allSettled([context.close(), viewer.close()]);
    try {
      await fixtures.cleanup();
    } catch (error) {
      cleanupError = error;
    }
  }
  if (journeyError) throw journeyError;
  if (cleanupError) throw cleanupError;
});
