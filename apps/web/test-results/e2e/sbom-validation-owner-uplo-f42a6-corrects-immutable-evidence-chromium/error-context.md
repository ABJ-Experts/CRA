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

Locator: getByText('Original evidence is verified and queued for processing.', { exact: true })
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByText('Original evidence is verified and queued for processing.', { exact: true })

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
      - listitem: B6674352 Cf72 4b1d Bb1c 7b81d49daf15
  - button "Search"
  - button "Notifications, 7 unread"
  - text: AF
  - 'img "Ada Foster: online"'
- main:
  - heading "E2E SBOM 1787809293557-0-0" [level=1]
  - paragraph: Product identity, release history, and lifecycle state.
  - button "Back to products"
  - heading "Registry identity" [level=2]
  - button "Archive product"
  - text: Standalone software 1 releases Active
  - paragraph: Run-scoped SBOM validation E2E product.
  - term: Internal code
  - definition: E2E-SBOM-1787809293557-0-0
  - term: Legal entity
  - definition: CRA Seed Legal Entity
  - term: Responsible owner
  - definition: cfcf3423-33cb-41c1-a740-e573b9303ca3
  - term: Last updated
  - definition: 27 Aug 2026, 05:41 UTC
  - paragraph: If the responsible owner is inactive, assign an active organization member before continuing product work.
  - heading "Product workbench" [level=2]
  - paragraph: Open one focused workspace at a time. Product history remains available while you work.
  - button "Edit product": Edit product Update product identity and ownership.
  - button "Releases and compliance": Releases and compliance Manage releases, lifecycle, and retention.
  - button "Relationships": Relationships Review baselines, variants, and components.
  - button "Modifications": Modifications Assess substantial product changes.
  - button "Security artifacts": Security artifacts Manage security update evidence.
  - heading "Finding impact" [level=2]
  - paragraph: No propagated finding impacts are currently associated with this product.
  - region "SBOM evidence":
    - heading "SBOM evidence" [level=2]
    - paragraph: Preserve the exact original and queue it for secure intake. Parsed validation results stay linked to immutable evidence sources.
    - text: Upload pending Release
    - combobox "Release": SBOM validation 1787809293557-0-0 - 1.0.178780929355700
    - text: SBOM file
    - button "SBOM file"
    - button "Upload SBOM"
    - paragraph: "JSON, XML, text, approved SBOM media types, and unknown browser file types are accepted. Unknown types are declared as application/octet-stream. Maximum size: 100 MiB."
    - alert: The SBOM service is temporarily unavailable. Your file was not marked complete; try completing the same upload again.
    - button "Complete uploaded file"
    - paragraph: Source history
    - text: "0"
    - paragraph: No SBOM evidence has been uploaded for this release.
    - paragraph: Validation report
    - paragraph: e2e-valid-1787809293557-0-0.cdx.json
    - text: Pending
    - status: Loading validation report...
    - term: Detected
    - definition: Undetected
    - term: Serialization
    - definition: Pending
    - term: Immutable hash
    - definition: 1e55f1ce113e
    - term: Completed
    - definition: Pending
    - button "All 0" [pressed]
    - button "Errors 0"
    - button "Warnings 0"
    - status: Diagnostic details are still processing. Counts are available from the source summary and rows will appear when validation finishes.
    - region "Normalized documents":
      - paragraph: Evidence graph inventory
      - heading "Normalized documents" [level=3]
      - text: "0"
      - paragraph: Completed intake will appear here as an immutable normalized graph.
  - region "Composite SBOM review":
    - heading "Composite SBOM review" [level=2]
    - paragraph: Merge eligible release evidence without changing any source document. Conflicting values and unresolved dependencies require an auditable decision.
    - text: Target release
    - combobox "Target release": SBOM validation 1787809293557-0-0 - 1.0.178780929355700
    - heading "Eligible evidence" [level=3]
    - paragraph: Select normalized, valid source documents for this release. The server validates product structure, tenant scope, source state, and accepted supplier status again.
    - paragraph: No completed, valid source evidence is currently eligible for a composite review.
    - button "Prepare composite review" [disabled]
  - region "Supplier SBOM review":
    - heading "Supplier SBOM review" [level=2]
    - paragraph: Issue a component-scoped invitation, then accept or reject supplier evidence after the standard validation and normalization pipeline completes.
    - text: Target release
    - combobox "Target release": SBOM validation 1787809293557-0-0 - 1.0.178780929355700
    - text: Supplier display name
    - textbox "Supplier display name"
    - text: Allowed component reference
    - textbox "Allowed component reference"
    - text: Invitation expiry
    - textbox "Invitation expiry": 2026-09-03T05:41
    - button "Create supplier invitation"
    - heading "Supplier submissions" [level=3]
    - paragraph: Rejected evidence remains retained for audit and cannot enter an authoritative composite.
    - button "Refresh"
    - paragraph: No supplier SBOM requests exist for this release.
- alert
```

# Test source

```ts
  215 |   const legalEntity = body.legalEntities.find(
  216 |     (candidate) =>
  217 |       candidate.status === "active" &&
  218 |       candidate.completionStatus === "complete" &&
  219 |       candidate.identifier === "default",
  220 |   );
  221 |   if (!legalEntity)
  222 |     throw new Error("Seed owner has no active default legal entity");
  223 |   return legalEntity.id;
  224 | }
  225 | 
  226 | async function createProduct(
  227 |   request: APIRequestContext,
  228 |   input: Readonly<{ runId: string; ownerId: string; legalEntityId: string }>,
  229 | ): Promise<ProductResponse> {
  230 |   const response = await request.post(
  231 |     `${LIVE_API_ORIGIN}${API_PREFIX}/products`,
  232 |     {
  233 |       data: {
  234 |         name: `E2E SBOM ${input.runId}`,
  235 |         internalCode: `E2E-SBOM-${input.runId}`,
  236 |         productType: "standalone_software",
  237 |         description: "Run-scoped SBOM validation E2E product.",
  238 |         responsibleOwnerId: input.ownerId,
  239 |         legalEntityId: input.legalEntityId,
  240 |         idempotencyKey: randomUUID(),
  241 |       },
  242 |     },
  243 |   );
  244 |   expect(response.status()).toBe(201);
  245 |   return (await response.json()) as ProductResponse;
  246 | }
  247 | 
  248 | async function createRelease(
  249 |   request: APIRequestContext,
  250 |   productId: string,
  251 |   runId: string,
  252 | ): Promise<ReleaseResponse> {
  253 |   const response = await request.post(
  254 |     `${LIVE_API_ORIGIN}${API_PREFIX}/products/${productId}/releases`,
  255 |     {
  256 |       data: {
  257 |         label: `SBOM validation ${runId}`,
  258 |         version: `1.0.${runId.replaceAll("-", "")}`,
  259 |         description: "Run-scoped SBOM validation E2E release.",
  260 |         idempotencyKey: randomUUID(),
  261 |       },
  262 |     },
  263 |   );
  264 |   expect(response.status()).toBe(201);
  265 |   return (await response.json()) as ReleaseResponse;
  266 | }
  267 | 
  268 | async function uploadFixture(
  269 |   page: Page,
  270 |   input: Readonly<{
  271 |     runId: string;
  272 |     fixture: Readonly<{
  273 |       fileName: (runId: string) => string;
  274 |       mediaType: string;
  275 |       bytes: () => Buffer;
  276 |     }>;
  277 |     buttonName: string;
  278 |   }>,
  279 | ): Promise<Readonly<{ sourceId: string; jobId: string; fileName: string }>> {
  280 |   const fileName = input.fixture.fileName(input.runId);
  281 |   await page.getByLabel("SBOM file", { exact: true }).setInputFiles({
  282 |     name: fileName,
  283 |     mimeType: input.fixture.mediaType,
  284 |     buffer: input.fixture.bytes(),
  285 |   });
  286 |   await expect(
  287 |     page.getByRole("button", { name: input.buttonName, exact: true }),
  288 |   ).toBeEnabled();
  289 |   const initialized = page.waitForResponse(
  290 |     (response) =>
  291 |       /\/api\/v1\/products\/[^/]+\/releases\/[^/]+\/sbom-uploads$/u.test(
  292 |         new URL(response.url()).pathname,
  293 |       ) && response.request().method() === "POST",
  294 |   );
  295 |   const completed = page.waitForResponse(
  296 |     (response) =>
  297 |       /\/api\/v1\/sbom-uploads\/[^/]+\/complete$/u.test(
  298 |         new URL(response.url()).pathname,
  299 |       ) && response.request().method() === "POST",
  300 |   );
  301 |   await page
  302 |     .getByRole("button", { name: input.buttonName, exact: true })
  303 |     .click();
  304 |   const initializedResponse = await initialized;
  305 |   expect(initializedResponse.status()).toBe(201);
  306 |   const upload = (await initializedResponse.json()) as SbomUploadResponse;
  307 |   const completedResponse = await completed;
  308 |   expect(completedResponse.status()).toBe(202);
  309 |   const completion = (await completedResponse.json()) as SbomJobResponse;
  310 |   expect(completion.job.sourceId).toBe(upload.source.id);
  311 |   await expect(
  312 |     page.getByText("Original evidence is verified and queued for processing.", {
  313 |       exact: true,
  314 |     }),
> 315 |   ).toBeVisible();
      |     ^ Error: expect(locator).toBeVisible() failed
  316 |   return { sourceId: upload.source.id, jobId: completion.job.id, fileName };
  317 | }
  318 | 
  319 | async function runSbomWorkerOnce(): Promise<void> {
  320 |   const { stderr } = await execFileAsync(
  321 |     "pnpm",
  322 |     [
  323 |       "--filter",
  324 |       "api",
  325 |       "exec",
  326 |       "ts-node",
  327 |       "-r",
  328 |       "tsconfig-paths/register",
  329 |       "src/sbom-ingest-worker.ts",
  330 |       "--once",
  331 |     ],
  332 |     {
  333 |       cwd: REPO_ROOT,
  334 |       env: process.env,
  335 |       timeout: 60_000,
  336 |     },
  337 |   );
  338 |   expect(stderr).not.toContain("SBOM ingest worker cycle failed safely");
  339 | }
  340 | 
  341 | async function expectReportStatus(
  342 |   request: APIRequestContext,
  343 |   sourceId: string,
  344 |   status: "valid" | "invalid",
  345 | ): Promise<SbomValidationReportResponse> {
  346 |   let latest: SbomValidationReportResponse | null = null;
  347 |   await expect
  348 |     .poll(
  349 |       async () => {
  350 |         const response = await request.get(
  351 |           `${LIVE_API_ORIGIN}${API_PREFIX}/sbom-sources/${sourceId}/validation-report`,
  352 |         );
  353 |         expect(response.status()).toBe(200);
  354 |         latest = (await response.json()) as SbomValidationReportResponse;
  355 |         return latest.report.status;
  356 |       },
  357 |       { timeout: 60_000 },
  358 |     )
  359 |     .toBe(status);
  360 |   if (!latest) throw new Error("Validation report did not resolve");
  361 |   return latest;
  362 | }
  363 | 
  364 | async function sourceHistory(
  365 |   request: APIRequestContext,
  366 |   productId: string,
  367 |   releaseId: string,
  368 | ): Promise<SbomSourceHistoryResponse> {
  369 |   const response = await request.get(
  370 |     `${LIVE_API_ORIGIN}${API_PREFIX}/products/${productId}/releases/${releaseId}/sbom-sources?limit=10`,
  371 |   );
  372 |   expect(response.status()).toBe(200);
  373 |   return (await response.json()) as SbomSourceHistoryResponse;
  374 | }
  375 | 
  376 | async function expectReport(
  377 |   page: Page,
  378 |   label: string,
  379 |   fileName: string,
  380 | ): Promise<void> {
  381 |   await expect(
  382 |     page.getByRole("heading", { name: "SBOM evidence", exact: true }),
  383 |   ).toBeVisible();
  384 |   await expect(page.getByText(fileName, { exact: true }).first()).toBeVisible();
  385 |   await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  386 | }
  387 | 
  388 | async function captureValidationScreenshot(
  389 |   page: Page,
  390 |   testInfo: TestInfo,
  391 |   input: Readonly<{ attachmentName: string; fileName: string }>,
  392 | ): Promise<void> {
  393 |   const path = testInfo.outputPath(input.fileName);
  394 |   await page.screenshot({ path, fullPage: true });
  395 |   await testInfo.attach(input.attachmentName, {
  396 |     path,
  397 |     contentType: "image/png",
  398 |   });
  399 | }
  400 | 
  401 | async function captureMobileValidationScreenshot(
  402 |   testInfo: TestInfo,
  403 |   input: Readonly<{
  404 |     browser: Browser;
  405 |     productId: string;
  406 |     correctedFileName: string;
  407 |   }>,
  408 | ): Promise<void> {
  409 |   const mobileContext = await input.browser.newContext({
  410 |     baseURL: WEB_ORIGIN,
  411 |     viewport: MOBILE_VIEWPORT,
  412 |     isMobile: true,
  413 |     hasTouch: true,
  414 |     deviceScaleFactor: 3,
  415 |   });
```