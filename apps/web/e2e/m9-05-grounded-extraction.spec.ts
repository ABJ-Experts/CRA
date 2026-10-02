import { expect, test } from "@playwright/test";
import { join } from "node:path";

/* eslint-disable turbo/no-undeclared-env-vars -- Opt-in local E2E settings are not Turbo build inputs. */

const supplierId = "9247c281-2fe5-4d55-8ac9-7fbe44ecb94a";
const requestId = "f50e1a38-f648-4eb4-b8b2-c3e8f3e0ebfd";
const runId = "bbd3b891-f92d-43de-8e86-3098474b0484";
const fileName = "m9-05-synthetic-certificate.pdf";
const correctedCertificate = "ISO 9001:2015 (reviewed)";

test("owner grounds, corrects, and rejects synthetic document fields", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.M9_05_ALLOW_LOCAL_FIXTURE !== "yes" ||
      process.env.E2E_WEB_ORIGIN !== "http://localhost:3002",
    "Requires explicit synthetic fixture opt-in on the local web server",
  );
  test.setTimeout(120_000);
  await page.goto("/sign-in");
  await page.getByTestId("si-identifier").fill("owner@cra.test");
  await page.getByTestId("si-password").fill("Password123");
  const signedIn = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/auth/sign-in"),
  );
  await page.getByTestId("si-submit").click();
  expect((await signedIn).status()).toBe(200);

  await page.goto(`/suppliers/${supplierId}`);
  await expect(
    page.getByRole("heading", { name: "Supplier evidence review" }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Evidence request" })
    .selectOption(requestId);
  const panel = page.getByRole("region", {
    name: `Document fields for ${fileName}`,
  });
  await expect(panel).toBeVisible();
  await expect(
    panel.getByText("m9-05-fixture:v1 · supplier-fields-v1", { exact: true }),
  ).toBeVisible();

  const certificate = panel
    .getByRole("list", { name: "Document field suggestions" })
    .locator("li")
    .filter({ hasText: "ISO 9001:2015" })
    .filter({ hasText: runId });
  const expiry = panel
    .getByRole("list", { name: "Document field suggestions" })
    .locator("li")
    .filter({ hasText: "2027-12-31" })
    .filter({ hasText: runId });
  await expect(certificate).toBeVisible();
  await expect(expiry).toBeVisible();

  const verifiedPdf = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/evidence-delivery/") &&
      response.request().method() === "GET",
  );
  await certificate
    .getByRole("button", { name: "View source for ISO 9001:2015" })
    .click();
  expect((await verifiedPdf).status()).toBe(200);
  const passage = panel.getByLabel("Highlighted extracted passage");
  await expect(passage.locator("mark")).toHaveText("ISO 9001:2015");
  await expect(
    panel.getByTitle(`Verified ${fileName}, page 1`),
  ).toHaveAttribute("src", /#page=1$/);
  const screenshotDirectory = process.env.M9_05_SCREENSHOT_DIR;
  await panel.screenshot({
    path: screenshotDirectory
      ? join(screenshotDirectory, "m9-05-grounded-panel.png")
      : testInfo.outputPath("m9-05-grounded-panel.png"),
  });
  await page.screenshot({
    path: screenshotDirectory
      ? join(screenshotDirectory, "m9-05-grounded-before-decisions.png")
      : testInfo.outputPath("m9-05-grounded-before-decisions.png"),
    fullPage: true,
  });

  if (
    await certificate.getByRole("button", { name: "Confirm field" }).count()
  ) {
    const correctedValue = certificate.getByRole("textbox", {
      name: "Confirmed value for Certification Held",
    });
    await certificate
      .getByRole("button", { name: "View source for ISO 9001:2015" })
      .focus();
    await page.keyboard.press("Tab");
    await expect(correctedValue).toBeFocused();
    await expect(correctedValue).not.toHaveCSS("box-shadow", "none");
    await correctedValue.fill(correctedCertificate);
    await certificate.getByRole("button", { name: "Confirm field" }).click();
    await expect(
      panel.getByText("Field confirmed and recorded."),
    ).toBeVisible();
  }
  await expect(certificate).toContainText("Confirmed");
  await expect(certificate).toContainText(
    `Recorded value: ${correctedCertificate}`,
  );

  await expiry
    .getByRole("button", { name: "View source for 2027-12-31" })
    .click();
  await expect(passage.locator("mark")).toHaveText("2027-12-31");
  if (await expiry.getByRole("button", { name: "Reject suggestion" }).count()) {
    await expiry.getByRole("button", { name: "Reject suggestion" }).click();
    await expect(
      panel.getByText("Suggestion rejected; source document unchanged."),
    ).toBeVisible();
  }
  await expect(expiry).toContainText("Rejected");
  await page.screenshot({
    path: screenshotDirectory
      ? join(screenshotDirectory, "m9-05-grounded-after-decisions.png")
      : testInfo.outputPath("m9-05-grounded-after-decisions.png"),
    fullPage: true,
  });
});

test("grounded review remains readable and keyboard reachable without changing fields", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.M9_05_ALLOW_LOCAL_FIXTURE !== "yes" ||
      process.env.E2E_WEB_ORIGIN !== "http://localhost:3002",
    "Requires explicit synthetic fixture opt-in on the local web server",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/sign-in");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("si-identifier").fill("owner@cra.test");
  await page.getByTestId("si-password").fill("Password123");
  const signedIn = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/auth/sign-in"),
  );
  await page.getByTestId("si-submit").click();
  expect((await signedIn).status()).toBe(200);

  await page.goto(`/suppliers/${supplierId}`);
  await page
    .getByRole("combobox", { name: "Evidence request" })
    .selectOption(requestId);
  const panel = page.getByRole("region", {
    name: `Document fields for ${fileName}`,
  });
  await expect(panel).toBeVisible();
  const certificate = panel
    .getByRole("list", { name: "Document field suggestions" })
    .locator("li")
    .filter({ hasText: "ISO 9001:2015" })
    .filter({ hasText: runId });
  await expect(certificate).toContainText("Confirmed");
  const sourceButton = certificate.getByRole("button", {
    name: "View source for ISO 9001:2015",
  });
  const accessResponses: string[] = [];
  page.on("response", (response) => {
    if (
      response.url().includes("/api/v1/") &&
      response.url().endsWith("/access")
    ) {
      accessResponses.push(`${response.status()} ${response.url()}`);
    }
  });
  await sourceButton.focus();
  await expect(sourceButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    panel.getByLabel("Highlighted extracted passage").locator("mark"),
  ).toHaveText("ISO 9001:2015");
  await expect(
    panel.getByTitle(`Verified ${fileName}, page 1`),
    `Verified PDF access responses: ${accessResponses.join(", ") || "none"}`,
  ).toHaveAttribute("src", /#page=1$/);

  await panel.getByRole("combobox", { name: "Field" }).focus();
  await expect(panel.getByRole("combobox", { name: "Field" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    panel.getByRole("textbox", { name: "Value", exact: true }),
  ).toBeFocused();
  await expect(
    panel.getByRole("button", { name: "Record manual field" }),
  ).toBeDisabled();
  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    overflowing: Array.from(document.querySelectorAll("body *"))
      .filter(
        (element) =>
          element.getBoundingClientRect().right > window.innerWidth + 1,
      )
      .slice(0, 10)
      .map((element) => ({
        tag: element.tagName,
        className: element.className,
        right: element.getBoundingClientRect().right,
        text: element.textContent?.slice(0, 60),
      })),
    scrolling: Array.from(document.querySelectorAll("body *"))
      .filter((element) => element.scrollWidth > element.clientWidth + 1)
      .sort((a, b) => b.scrollWidth - a.scrollWidth)
      .slice(0, 10)
      .map((element) => ({
        tag: element.tagName,
        className: element.className,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      })),
  }));
  await page.screenshot({
    path: testInfo.outputPath(`m9-05-read-only-${testInfo.project.name}.png`),
    fullPage: true,
  });
  expect(viewport.scrollWidth, JSON.stringify(viewport)).toBeLessThanOrEqual(
    viewport.width,
  );
});
