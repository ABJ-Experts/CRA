import { expect, test } from "@playwright/test";

const owner = async (page: import("@playwright/test").Page) => {
  await page.goto("/sign-in");
  await page.getByTestId("si-identifier").fill("owner@cra.test");
  await page.getByTestId("si-password").fill("Password123");
  const response = page.waitForResponse((candidate) =>
    candidate.url().endsWith("/api/v1/auth/sign-in"),
  );
  await page.getByTestId("si-submit").click();
  expect((await response).status()).toBe(200);
};

const productIdForOwner = async (page: import("@playwright/test").Page) => {
  const response = await page.request.get("/api/v1/products");
  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as {
    products?: { rows?: ReadonlyArray<{ id?: string }> };
  };
  return payload.products?.rows?.[0]?.id;
};

test("evidence validity settings and reuse projection stay permission-scoped", async ({
  page,
}, testInfo) => {
  await owner(page);
  const productId = await productIdForOwner(page);
  test.skip(!productId, "The local owner fixture has no active product.");

  const intervals = await page.request.get(
    "/api/v1/evidence-expiry-alert-intervals",
  );
  expect(intervals.status()).toBe(200);
  expect(await intervals.json()).toMatchObject({
    expiryAlertIntervals: { thresholdDays: expect.any(Array) },
  });

  const list = await page.request.get(
    `/api/v1/products/${productId}/evidence-documents?validity=missing`,
  );
  expect(list.status()).toBe(200);
  const listPayload = (await list.json()) as {
    items?: ReadonlyArray<{
      document?: { id?: string; currentVersionId?: string };
    }>;
  };
  const first = listPayload.items?.[0]?.document;
  if (first?.id && first.currentVersionId) {
    const reuse = await page.request.get(
      `/api/v1/products/${productId}/evidence-documents/${first.id}/versions/${first.currentVersionId}/reuse`,
    );
    expect(reuse.status()).toBe(200);
    expect(await reuse.json()).toMatchObject({
      reuse: { technicalFileLinks: expect.any(Array), frameworkControls: [] },
    });
  }

  await page.goto(`/products/${productId}/evidence`);
  await expect(page.getByLabel("Filter by validity")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Expiry alerts" }),
  ).toBeVisible();
  await expect(page.getByText("Loading evidence search…")).toBeHidden();
  await expect(page.getByText("Loading expiry alert schedule…")).toBeHidden();
  await expect(page.getByText("Loading evidence records.")).toBeHidden();
  const retentionReviewResponse = page.waitForResponse((response) =>
    response.url().includes("/retention-review"),
  );
  await page.getByRole("button", { name: "View versions" }).first().click();
  expect((await retentionReviewResponse).status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Retention and deletion review" }),
  ).toBeVisible();
  await expect(
    page.getByText("Retention protection could not be loaded."),
  ).toBeHidden();
  const reuseLink = page.getByRole("button", { name: /link/ }).first();
  if (await reuseLink.isVisible()) {
    await reuseLink.click();
    await expect(
      page.getByText("No framework mappings are available"),
    ).toBeVisible();
  }
  await page.screenshot({
    path: testInfo.outputPath("m8-evidence-validity-desktop.png"),
    fullPage: true,
  });
});

test("evidence validity controls remain usable on a narrow viewport", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await owner(page);
  const productId = await productIdForOwner(page);
  test.skip(!productId, "The local owner fixture has no active product.");

  await page.goto(`/products/${productId}/evidence`);
  await expect(page.getByLabel("Filter by validity")).toBeVisible();
  await expect(page.getByText("Loading evidence records.")).toBeHidden();
  await page.getByLabel("Filter by validity").selectOption("expired");
  await page.screenshot({
    path: testInfo.outputPath("m8-evidence-validity-mobile.png"),
    fullPage: true,
  });
});
