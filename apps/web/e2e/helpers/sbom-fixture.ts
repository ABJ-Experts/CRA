import { expect, type Page } from "@playwright/test";

/** Native onboarding creates a private tenant; no seeded organization is edited. */
export async function onboardSbomOrganization(
  page: Page,
  email: string,
  name: string,
): Promise<string> {
  await page.goto("/onboarding");
  await page
    .getByRole("textbox", { name: "Legal organization name", exact: true })
    .fill(name);
  for (const label of [
    "Main establishment country",
    "Registered address country",
  ]) {
    const country = page.getByRole("combobox", { name: label, exact: true });
    await country.press("Space");
    await expect(
      page.getByRole("option", { name: "United Kingdom", exact: true }),
    ).toBeVisible();
    await page.keyboard.type("United Kingdom", { delay: 25 });
    await page.keyboard.press("Enter");
    await expect(country).toContainText("United Kingdom");
  }
  for (const [label, value] of [
    ["Registered address line 1", "100 SBOM Test Street"],
    ["City or locality", "London"],
    ["Postal code", "SW1A 1AA"],
    ["Manufacturer contact name", "SBOM Test Owner"],
    ["Manufacturer contact email", email],
  ] as const) {
    await page.getByRole("textbox", { name: label, exact: true }).fill(value);
  }
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
