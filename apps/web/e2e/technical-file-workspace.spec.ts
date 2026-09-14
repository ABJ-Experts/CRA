import { expect, test } from "@playwright/test";

/* eslint-disable turbo/no-undeclared-env-vars -- Playwright is outside Turbo. */

const apiOrigin = process.env.E2E_API_ORIGIN ?? "http://127.0.0.1:3333";
const webOrigin = process.env.E2E_WEB_ORIGIN ?? "http://127.0.0.1:3002";
const productId = process.env.E2E_M7_PRODUCT_ID;
const ownerEmail = process.env.E2E_OWNER_EMAIL;
const ownerPassword = process.env.E2E_OWNER_PASSWORD;

test.skip(
  !productId || !ownerEmail || !ownerPassword,
  "E2E_M7_PRODUCT_ID, E2E_OWNER_EMAIL, and E2E_OWNER_PASSWORD are required for the local M7 journey.",
);

function cookiesForBrowser(header: string, domain: string) {
  const [pair, ...attributes] = header.split(";");
  const separator = pair?.indexOf("=") ?? -1;
  if (!pair || separator < 1) return [];

  const name = pair.slice(0, separator).trim();
  if (!name.startsWith("cra_")) return [];
  const attribute = (key: string) =>
    attributes.find((value) =>
      value.trim().toLowerCase().startsWith(`${key}=`),
    );

  return [
    {
      name,
      value: pair.slice(separator + 1),
      domain,
      path: attribute("path")?.split("=").slice(1).join("=") ?? "/",
      httpOnly: attributes.some(
        (value) => value.trim().toLowerCase() === "httponly",
      ),
      sameSite: "Lax" as const,
    },
  ];
}

async function signInAsLocalOwner(page: import("@playwright/test").Page) {
  const response = await page.request.post(`${apiOrigin}/api/v1/auth/sign-in`, {
    data: { email: ownerEmail, password: ownerPassword, remember: true },
  });
  expect(response.status()).toBe(200);

  const domain = new URL(webOrigin).hostname;
  await page.context().addCookies(
    response
      .headersArray()
      .filter((header) => header.name.toLowerCase() === "set-cookie")
      .flatMap((header) => cookiesForBrowser(header.value, domain)),
  );

  await page.goto("/dashboard");
  const selectedOrganization = await page.evaluate(async () => {
    const sessionResponse = await fetch("/api/v1/auth/session");
    if (!sessionResponse.ok) return false;
    const session = (await sessionResponse.json()) as {
      organizations: Array<{ id: string; role: string }>;
    };
    const organization =
      session.organizations.find((candidate) => candidate.role === "owner") ??
      session.organizations[0];
    if (!organization) return false;
    const switchResponse = await fetch("/api/v1/organizations/switch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId: organization.id }),
    });
    return switchResponse.ok;
  });
  expect(selectedOrganization).toBe(true);
}

test("owner creates and edits the source-linked Annex VII workspace", async ({
  page,
}, testInfo) => {
  await signInAsLocalOwner(page);
  await page.goto(`/products/${productId}/technical-file`);

  await expect(
    page.getByRole("heading", { name: "Technical file" }),
  ).toBeVisible();

  const sessionStatuses = await page.evaluate(async () =>
    Promise.all(
      [
        "/api/v1/auth/session",
        "/api/v1/permissions/effective",
        "/api/v1/permissions/menu",
      ].map(async (path) => ({ path, status: (await fetch(path)).status })),
    ),
  );
  expect(sessionStatuses).toEqual([
    { path: "/api/v1/auth/session", status: 200 },
    { path: "/api/v1/permissions/effective", status: 200 },
    { path: "/api/v1/permissions/menu", status: 200 },
  ]);

  const create = page.getByRole("button", { name: "Create technical file" });
  const existingWorkspace = page.getByRole("heading", {
    name: "Annex VII technical file",
  });
  await expect(create.or(existingWorkspace)).toBeVisible();
  if (await create.isVisible()) {
    const created = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/products/${productId}/technical-file`) &&
        response.request().method() === "POST",
    );
    await create.click();
    expect((await created).status()).toBe(201);
  }

  await expect(
    page.getByRole("heading", { name: "Annex VII technical file" }),
  ).toBeVisible();
  await expect(
    page.getByText("This workspace organizes evidence against the template."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open section" }).first().click();
  await expect(page.getByText("Annex VII requirement")).toBeVisible();
  await expect(
    page.getByText("Document attachments are unavailable in M7-01."),
  ).toBeVisible();
  await page
    .getByLabel("Narrative")
    .fill(
      "Local M7 browser verification: controlled product description reviewed.",
    );
  await page.getByRole("button", { name: "Save section" }).click();
  await expect(page.getByRole("status").last()).toHaveText("Section saved.");

  await page.getByRole("button", { name: "Back to file" }).click();
  const designSection = page
    .getByRole("heading", { name: "Design, development, and production" })
    .locator("xpath=../..");
  await designSection.getByRole("button", { name: "Open section" }).click();

  const sourceTitle = `Local M7 browser verification ${testInfo.retry}-${Date.now()}`;
  await page.getByLabel("Title").fill(sourceTitle);
  await page.getByLabel("Edition or revision").fill("2026-09-14");
  await page.getByRole("button", { name: "Link source" }).click();
  await expect(page.getByRole("status").last()).toContainText("Source linked.");
  await expect(
    page.getByRole("list", { name: "Linked source references" }),
  ).toContainText(sourceTitle);

  await page
    .getByRole("button", { name: "Record changed standard edition" })
    .last()
    .click();
  await page.getByLabel("Current edition or revision").fill("2026-09-15");
  await page
    .getByLabel("Current version fingerprint")
    .fill("local-m7-readiness-edition-2026-09-15");
  await page.getByRole("button", { name: "Mark for review" }).last().click();
  await expect(page.getByRole("status").last()).toContainText("marked for review");

  await page
    .getByRole("button", { name: "Review stale evidence" })
    .last()
    .click();
  await page
    .getByLabel("Review rationale")
    .fill("The locally pinned edition remains suitable for this test release.");
  await page.getByRole("button", { name: "Record decision" }).last().click();
  await expect(page.getByRole("status").last()).toContainText("retained");

  await page.screenshot({
    path: testInfo.outputPath("technical-file-section-editor.png"),
    fullPage: true,
  });
});

test("owner can inspect the product-scoped cybersecurity risk register", async ({
  page,
}, testInfo) => {
  await signInAsLocalOwner(page);
  await page.goto(`/products/${productId}/technical-file`);

  await expect(
    page.getByRole("heading", { name: "Cybersecurity risk register" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Pinned method: CRA 5×5 v1. This is a risk method, not a compliance score.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(/M7-03 source readiness is available/i),
  ).toBeVisible();

  await page.screenshot({
    path: testInfo.outputPath("technical-file-risk-register.png"),
    fullPage: true,
  });
});
