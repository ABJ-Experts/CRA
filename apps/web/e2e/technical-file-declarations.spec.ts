import { expect, test } from "@playwright/test";

/* eslint-disable turbo/no-undeclared-env-vars -- Playwright is outside Turbo. */

const apiOrigin = process.env.E2E_API_ORIGIN ?? "http://127.0.0.1:3333";
const webOrigin = process.env.E2E_WEB_ORIGIN ?? "http://localhost:3000";
const productId = process.env.E2E_M7_COMPLETE_PRODUCT_ID;
const ownerEmail = process.env.E2E_OWNER_EMAIL;
const ownerPassword = process.env.E2E_OWNER_PASSWORD;

test.skip(
  !productId || !ownerEmail || !ownerPassword,
  "A complete M7 fixture and local owner credentials are required.",
);

function sessionCookies(header: string, domain: string) {
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

async function signInAsOwner(page: import("@playwright/test").Page) {
  const response = await page.request.post(`${apiOrigin}/api/v1/auth/sign-in`, {
    data: { email: ownerEmail, password: ownerPassword, remember: true },
  });
  expect(response.status()).toBe(200);
  await page.context().addCookies(
    response
      .headersArray()
      .filter((header) => header.name.toLowerCase() === "set-cookie")
      .flatMap((header) => sessionCookies(header.value, new URL(webOrigin).hostname)),
  );
  await page.goto("/dashboard");
  const switched = await page.evaluate(async () => {
    const session = await fetch("/api/v1/auth/session");
    if (!session.ok) return false;
    const body = (await session.json()) as {
      organizations: Array<{ id: string; role: string }>;
    };
    const organization =
      body.organizations.find((candidate) => candidate.role === "owner") ??
      body.organizations[0];
    if (!organization) return false;
    return (
      await fetch("/api/v1/organizations/switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId: organization.id }),
      })
    ).ok;
  });
  expect(switched).toBe(true);
}

test("owner explicitly prepares a declaration from a complete immutable snapshot", async ({
  page,
}, testInfo) => {
  await signInAsOwner(page);
  await page.goto(`/products/${productId}/technical-file`);
  await expect(
    page.getByRole("heading", { name: "EU declarations of conformity" }),
  ).toBeVisible();
  await page.getByLabel("Responsible signatory capacity").fill("Compliance officer");
  await page.getByLabel("Place of issue").fill("Brussels");
  const reissue = page.getByRole("button", { name: "Reissue" }).first();
  if (await reissue.isVisible()) {
    await reissue.click();
    await page
      .getByLabel("Reason for reissue")
      .fill("Local E2E verifies immutable declaration supersession.");
    await page.getByRole("button", { name: "Create reissue draft" }).click();
    await expect(page.getByRole("status")).toContainText("new declaration draft");
  } else {
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/products/${productId}/technical-file/declarations`) &&
        ["POST", "PATCH"].includes(response.request().method()),
    );
    await page.getByRole("button", { name: "Save declaration draft" }).click();
    expect((await saved).status()).toBe(201);
    await expect(page.getByRole("status")).toContainText("draft saved");
  }

  const review = page.getByRole("button", { name: /Review and issue version/ });
  await expect(review).toBeVisible();
  await review.click();
  await expect(page.getByRole("dialog")).toContainText(
    "not a cryptographic or qualified electronic signature",
  );
  await page
    .getByLabel(
      "I confirm that I am authorized to issue this exact declaration revision from the identified immutable snapshot.",
    )
    .check();
  const issued = page.waitForResponse(
    (response) =>
      /\/technical-file\/declarations\/[^/]+\/issue$/.test(response.url()) &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Confirm issue" }).click();
  expect((await issued).status()).toBe(201);
  await expect(page.getByRole("status")).toContainText("prepared");
  await page.screenshot({
    path: testInfo.outputPath("technical-file-declaration-prepared.png"),
    fullPage: true,
  });
});
