import { expect, test } from "@playwright/test";

test("evidence search validates input and scopes authenticated results", async ({
  page,
}, testInfo) => {
  await page.goto("/sign-in");
  await page.getByTestId("si-identifier").fill("owner@cra.test");
  await page.getByTestId("si-password").fill("Password123");
  const signIn = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/auth/sign-in"),
  );
  await page.getByTestId("si-submit").click();
  expect((await signIn).status()).toBe(200);

  const products = await page.request.get("/api/v1/products");
  expect(products.ok()).toBe(true);
  const payload = (await products.json()) as {
    products?: { rows?: ReadonlyArray<{ id?: string }> };
  };
  const productId = payload.products?.rows?.[0]?.id;
  test.skip(!productId, "The local owner fixture has no active product.");

  const invalid = await page.request.get(
    `/api/v1/products/${productId}/evidence-search?q=x`,
  );
  expect(invalid.status()).toBe(400);

  const search = await page.request.get(
    `/api/v1/products/${productId}/evidence-search?q=policy`,
  );
  expect(search.status()).toBe(200);
  expect(await search.json()).toMatchObject({
    results: expect.any(Array),
    totalCount: expect.any(Number),
    facets: expect.any(Array),
    coverage: expect.any(Object),
  });

  await page.goto(`/products/${productId}/evidence`);
  await expect(
    page.getByRole("heading", { name: "Search extracted text" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("m8-evidence-search-desktop.png"),
    fullPage: true,
  });
});
