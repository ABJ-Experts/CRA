# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: sbom-validation.spec.ts >> owner uploads valid and invalid SBOMs, filters diagnostics, and corrects immutable evidence
- Location: e2e/sbom-validation.spec.ts:75:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: 'E2E SBOM 1787652631641-0-0', exact: true })
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByRole('heading', { name: 'E2E SBOM 1787652631641-0-0', exact: true })

```

```yaml
- complementary:
  - link "CRA Sentinel":
    - /url: /dashboard
  - button "Collapse sidebar"
  - navigation "Main":
    - list:
      - listitem:
        - link "Dashboard":
          - /url: /dashboard
      - listitem:
        - link "Management":
          - /url: /management
      - listitem:
        - link "Organization":
          - /url: /organization
      - listitem:
        - link "Products":
          - /url: /products
      - listitem:
        - link "Connectors":
          - /url: /connectors
    - paragraph: Account & access
    - list:
      - listitem:
        - button "Profile"
        - list:
          - listitem:
            - link "Account":
              - /url: /account
          - listitem:
            - link "Security":
              - /url: /security
      - listitem:
        - button "Authorization"
        - list:
          - listitem:
            - link "Roles":
              - /url: /roles
          - listitem:
            - link "Permissions":
              - /url: /permissions
  - button "Sign out"
- banner:
  - navigation "Breadcrumb":
    - list:
      - listitem:
        - link "Dashboard":
          - /url: /dashboard
      - listitem: E7530884 33b5 41d2 Ac67 543fe8fb9ac3
  - button "Search"
  - button "Notifications, 7 unread"
  - 'img "Ada Foster: online"'
- main:
  - heading "Product" [level=1]
  - paragraph: Product identity, release history, and lifecycle state.
  - button "Back to products"
  - status: Loading product…
```

# Test source

```ts
  4   | import { dirname, resolve } from "node:path";
  5   | import { promisify } from "node:util";
  6   | 
  7   | import {
  8   |   expect,
  9   |   type APIRequestContext,
  10  |   type Browser,
  11  |   type Page,
  12  |   type TestInfo,
  13  |   test,
  14  | } from "@playwright/test";
  15  | 
  16  | import { sbomValidationFixtures } from "./fixtures/sbom-validation";
  17  | import { LIVE_API_ORIGIN, signIn } from "./helpers/accounts";
  18  | 
  19  | /* eslint-disable turbo/no-undeclared-env-vars -- Playwright runs outside Turbo's cached task graph. */
  20  | 
  21  | const execFileAsync = promisify(execFile);
  22  | const WEB_ORIGIN = process.env.E2E_WEB_ORIGIN ?? "http://127.0.0.1:3000";
  23  | const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  24  | const API_PREFIX = "/api/v1";
  25  | const OWNER_EMAIL = "owner@cra.test";
  26  | const DESKTOP_VIEWPORT = Object.freeze({ width: 1440, height: 1100 });
  27  | const MOBILE_VIEWPORT = Object.freeze({ width: 390, height: 844 });
  28  | 
  29  | type SessionResponse = Readonly<{
  30  |   user: Readonly<{ id: string; email: string }>;
  31  | }>;
  32  | type LegalEntitiesResponse = Readonly<{
  33  |   legalEntities: readonly Readonly<{
  34  |     id: string;
  35  |     identifier: string | null;
  36  |     completionStatus: string;
  37  |     status: string;
  38  |   }>[];
  39  | }>;
  40  | type ProductResponse = Readonly<{
  41  |   product: Readonly<{ id: string; name: string }>;
  42  | }>;
  43  | type ReleaseResponse = Readonly<{
  44  |   release: Readonly<{ id: string; label: string; version: string }>;
  45  | }>;
  46  | type SbomUploadResponse = Readonly<{
  47  |   source: Readonly<{ id: string; fileName: string }>;
  48  | }>;
  49  | type SbomJobResponse = Readonly<{
  50  |   job: Readonly<{ id: string; sourceId: string }>;
  51  | }>;
  52  | type SbomValidationReportResponse = Readonly<{
  53  |   source: Readonly<{
  54  |     id: string;
  55  |     fileName: string;
  56  |     supersedesSourceId?: string;
  57  |   }>;
  58  |   report: Readonly<{
  59  |     status: "pending" | "valid" | "valid_with_warnings" | "invalid";
  60  |     errorCount: number;
  61  |     warningCount: number;
  62  |   }>;
  63  | }>;
  64  | type SbomSourceHistoryResponse = Readonly<{
  65  |   sources: readonly Readonly<{
  66  |     source: Readonly<{
  67  |       id: string;
  68  |       fileName: string;
  69  |       supersedesSourceId?: string;
  70  |     }>;
  71  |     validation: Readonly<{ status: string }>;
  72  |   }>[];
  73  | }>;
  74  | 
  75  | test("owner uploads valid and invalid SBOMs, filters diagnostics, and corrects immutable evidence", async ({
  76  |   browser,
  77  | }, testInfo) => {
  78  |   test.setTimeout(180_000);
  79  |   const runId = `${Date.now()}-${testInfo.parallelIndex}-${testInfo.retry}`;
  80  |   const context = await browser.newContext({
  81  |     baseURL: WEB_ORIGIN,
  82  |     viewport: DESKTOP_VIEWPORT,
  83  |   });
  84  | 
  85  |   try {
  86  |     expect((await signIn(context.request, OWNER_EMAIL)).status()).toBe(200);
  87  |     const session = await currentSession(context.request);
  88  |     const legalEntityId = await defaultLegalEntityId(context.request);
  89  |     const product = await createProduct(context.request, {
  90  |       runId,
  91  |       ownerId: session.user.id,
  92  |       legalEntityId,
  93  |     });
  94  |     const release = await createRelease(
  95  |       context.request,
  96  |       product.product.id,
  97  |       runId,
  98  |     );
  99  | 
  100 |     const page = await context.newPage();
  101 |     await page.goto(`/products/${product.product.id}`);
  102 |     await expect(
  103 |       page.getByRole("heading", { name: product.product.name, exact: true }),
> 104 |     ).toBeVisible();
      |       ^ Error: expect(locator).toBeVisible() failed
  105 |     await expect(
  106 |       page.getByRole("heading", { name: "SBOM evidence", exact: true }),
  107 |     ).toBeVisible();
  108 |     await expect(
  109 |       page.getByRole("combobox", { name: "Release", exact: true }),
  110 |     ).toContainText(release.release.label);
  111 | 
  112 |     const valid = await uploadFixture(page, {
  113 |       runId,
  114 |       fixture: sbomValidationFixtures.valid,
  115 |       buttonName: "Upload SBOM",
  116 |     });
  117 |     await runSbomWorkerOnce();
  118 |     await expectReportStatus(context.request, valid.sourceId, "valid");
  119 |     await page.reload();
  120 |     await expectReport(page, "Valid", valid.fileName);
  121 | 
  122 |     const invalid = await uploadFixture(page, {
  123 |       runId,
  124 |       fixture: sbomValidationFixtures.invalid,
  125 |       buttonName: "Upload SBOM",
  126 |     });
  127 |     await runSbomWorkerOnce();
  128 |     const invalidReport = await expectReportStatus(
  129 |       context.request,
  130 |       invalid.sourceId,
  131 |       "invalid",
  132 |     );
  133 |     expect(invalidReport.report.errorCount).toBeGreaterThan(0);
  134 |     await page.reload();
  135 |     await expectReport(page, "Invalid", invalid.fileName);
  136 |     await page.getByRole("button", { name: /^Errors [1-9]/u }).click();
  137 |     await expect(
  138 |       page.getByRole("table", { name: "SBOM diagnostics" }),
  139 |     ).toBeVisible();
  140 |     await expect(
  141 |       page.getByText("schema_violation", { exact: true }),
  142 |     ).toBeVisible();
  143 |     await captureValidationScreenshot(page, testInfo, {
  144 |       attachmentName: "desktop invalid SBOM diagnostics",
  145 |       fileName: "sbom-validation-desktop-invalid-diagnostics.png",
  146 |     });
  147 | 
  148 |     await page
  149 |       .getByRole("button", { name: "Upload corrected version", exact: true })
  150 |       .click();
  151 |     await expect(
  152 |       page.getByText(
  153 |         "Choose a corrected SBOM. The previous evidence remains immutable.",
  154 |       ),
  155 |     ).toBeVisible();
  156 |     const corrected = await uploadFixture(page, {
  157 |       runId,
  158 |       fixture: sbomValidationFixtures.corrected,
  159 |       buttonName: "Upload corrected SBOM",
  160 |     });
  161 |     expect(corrected.sourceId).not.toBe(invalid.sourceId);
  162 |     await runSbomWorkerOnce();
  163 |     await expectReportStatus(context.request, corrected.sourceId, "valid");
  164 |     const history = await sourceHistory(
  165 |       context.request,
  166 |       product.product.id,
  167 |       release.release.id,
  168 |     );
  169 |     expect(history.sources.map((item) => item.source.fileName)).toEqual(
  170 |       expect.arrayContaining([
  171 |         valid.fileName,
  172 |         invalid.fileName,
  173 |         corrected.fileName,
  174 |       ]),
  175 |     );
  176 |     expect(
  177 |       history.sources.find((item) => item.source.id === invalid.sourceId),
  178 |     ).toMatchObject({
  179 |       validation: { status: "invalid" },
  180 |     });
  181 |     expect(
  182 |       history.sources.find((item) => item.source.id === corrected.sourceId),
  183 |     ).toMatchObject({
  184 |       source: { supersedesSourceId: invalid.sourceId },
  185 |       validation: { status: "valid" },
  186 |     });
  187 |     await captureMobileValidationScreenshot(testInfo, {
  188 |       browser,
  189 |       productId: product.product.id,
  190 |       correctedFileName: corrected.fileName,
  191 |     });
  192 |   } finally {
  193 |     await context.close();
  194 |   }
  195 | });
  196 | 
  197 | async function currentSession(
  198 |   request: APIRequestContext,
  199 | ): Promise<SessionResponse> {
  200 |   const response = await request.get(
  201 |     `${LIVE_API_ORIGIN}${API_PREFIX}/auth/session`,
  202 |   );
  203 |   expect(response.status()).toBe(200);
  204 |   return (await response.json()) as SessionResponse;
```