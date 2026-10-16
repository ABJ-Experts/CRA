# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: m3-gap-closure.spec.ts >> M3 streaming format validation preserves originals, pages history and exports scoped normalized graphs
- Location: e2e/m3-gap-closure.spec.ts:173:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByRole('combobox', { name: 'Main establishment country', exact: true })
Expected substring: "United Kingdom"
Received string:    "Andorra"
Timeout: 10000ms

Call log:
  - Expect "toContainText" with timeout 10000ms
  - waiting for getByRole('combobox', { name: 'Main establishment country', exact: true })
    24 × locator resolved to <button dir="ltr" type="button" role="combobox" id="select-_r_1_" data-state="closed" aria-required="true" aria-expanded="false" aria-autocomplete="none" class="group/field relative flex w-full items-center rounded-xl bg-canvas transition-[box-shadow,background-color] duration-150 ease-out motion-reduce:transition-none [&_svg]:shrink-0 h-10 gap-3 px-3 text-subhead-regular [&_svg]:size-4 inset-ring-1 inset-ring-border hover:inset-ring-2 hover:inset-ring-accent-subtle focus-within:inset-ring-1 focus-wit…>…</button>
       - unexpected value "Andorra"

```

```yaml
- combobox "Main establishment country": Andorra
```

# Test source

```ts
  1  | import { expect, type Page } from "@playwright/test";
  2  | 
  3  | /** Native onboarding creates a private tenant; no seeded organization is edited. */
  4  | export async function onboardSbomOrganization(
  5  |   page: Page,
  6  |   email: string,
  7  |   name: string,
  8  | ): Promise<string> {
  9  |   await page.goto("/onboarding");
  10 |   await page
  11 |     .getByRole("textbox", { name: "Legal organization name", exact: true })
  12 |     .fill(name);
  13 |   for (const label of [
  14 |     "Main establishment country",
  15 |     "Registered address country",
  16 |   ]) {
  17 |     const country = page.getByRole("combobox", { name: label, exact: true });
  18 |     await country.press("Space");
  19 |     await page.keyboard.type("United Kingdom");
  20 |     await page.keyboard.press("Enter");
> 21 |     await expect(country).toContainText("United Kingdom");
     |                           ^ Error: expect(locator).toContainText(expected) failed
  22 |   }
  23 |   for (const [label, value] of [
  24 |     ["Registered address line 1", "100 SBOM Test Street"],
  25 |     ["City or locality", "London"],
  26 |     ["Postal code", "SW1A 1AA"],
  27 |     ["Manufacturer contact name", "SBOM Test Owner"],
  28 |     ["Manufacturer contact email", email],
  29 |   ] as const) {
  30 |     await page.getByRole("textbox", { name: label, exact: true }).fill(value);
  31 |   }
  32 |   const created = page.waitForResponse(
  33 |     (response) =>
  34 |       new URL(response.url()).pathname === "/api/v1/organizations" &&
  35 |       response.request().method() === "POST",
  36 |   );
  37 |   await page
  38 |     .getByRole("button", { name: "Create organization", exact: true })
  39 |     .click();
  40 |   const response = await created;
  41 |   expect(response.status()).toBe(201);
  42 |   return ((await response.json()) as { id: string }).id;
  43 | }
  44 | 
```