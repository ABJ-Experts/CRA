# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: sbom-validation.spec.ts >> owner uploads valid and invalid SBOMs, filters diagnostics, and corrects immutable evidence
- Location: e2e/sbom-validation.spec.ts:147:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('schema_violation', { exact: true })
Expected: visible
Error: strict mode violation: getByText('schema_violation', { exact: true }) resolved to 2 elements:
    1) <td class="break-words px-3 py-2 align-top font-mono text-caption-1-regular text-fg">schema_violation</td> aka getByRole('cell', { name: 'schema_violation' }).first()
    2) <td class="break-words px-3 py-2 align-top font-mono text-caption-1-regular text-fg">schema_violation</td> aka getByRole('cell', { name: 'schema_violation' }).nth(1)

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByText('schema_violation', { exact: true })

```

# Test source

```ts
  149 | }, testInfo) => {
  150 |   test.setTimeout(180_000);
  151 |   const runId = `${Date.now()}-${testInfo.parallelIndex}-${testInfo.retry}`;
  152 |   const fixtures = new RunScopedAccounts(testInfo);
  153 |   const context = await browser.newContext({
  154 |     baseURL: WEB_ORIGIN,
  155 |     viewport: DESKTOP_VIEWPORT,
  156 |   });
  157 | 
  158 |   try {
  159 |     const account = await fixtures.createVerified(context, "sbom-owner");
  160 |     const onboarding = await context.newPage();
  161 |     const organizationId = await onboardSbomOrganization(
  162 |       onboarding,
  163 |       account.email,
  164 |       `E2E SBOM ${runId}`,
  165 |     );
  166 |     fixtures.trackM3Organization(organizationId);
  167 |     await onboarding.close();
  168 |     const session = await currentSession(context.request);
  169 |     const legalEntityId = await defaultLegalEntityId(context.request);
  170 |     const product = await createProduct(context.request, {
  171 |       runId,
  172 |       ownerId: session.user.id,
  173 |       legalEntityId,
  174 |     });
  175 |     const release = await createRelease(
  176 |       context.request,
  177 |       product.product.id,
  178 |       runId,
  179 |     );
  180 | 
  181 |     const page = await context.newPage();
  182 |     await page.goto(`/products/${product.product.id}`);
  183 |     await expect(
  184 |       page.getByRole("heading", { name: product.product.name, exact: true }),
  185 |     ).toBeVisible();
  186 |     await expect(
  187 |       page.getByRole("heading", { name: "SBOM evidence", exact: true }),
  188 |     ).toBeVisible();
  189 |     await expect(
  190 |       page.getByRole("combobox", { name: "Release", exact: true }),
  191 |     ).toContainText(release.release.label);
  192 | 
  193 |     await page
  194 |       .getByLabel("Advisory or case ID", { exact: true })
  195 |       .fill("CVE-2026-10001");
  196 |     await page
  197 |       .getByLabel("Source reference", { exact: true })
  198 |       .fill(`Support case ${runId}`);
  199 |     await page
  200 |       .getByLabel("Evidence", { exact: true })
  201 |       .fill("The customer provided a reproducible affected-version log.");
  202 |     await page
  203 |       .getByLabel("Reason for retaining this finding", { exact: true })
  204 |       .fill("The report requires a security review.");
  205 |     const manualFindingResponse = page.waitForResponse(
  206 |       (response) =>
  207 |         new URL(response.url()).pathname ===
  208 |           "/api/v1/vulnerability-manual-findings" &&
  209 |         response.request().method() === "POST",
  210 |     );
  211 |     await page
  212 |       .getByRole("button", { name: "Record manual finding", exact: true })
  213 |       .click();
  214 |     expect((await manualFindingResponse).status()).toBe(201);
  215 |     await expect(page.getByRole("status")).toContainText(
  216 |       "was recorded for review",
  217 |     );
  218 | 
  219 |     const valid = await uploadFixture(page, {
  220 |       runId,
  221 |       fixture: sbomValidationFixtures.valid,
  222 |       buttonName: "Upload SBOM",
  223 |     });
  224 |     await runSbomWorkerOnce();
  225 |     await expectReportStatus(context.request, valid.sourceId, "valid");
  226 |     await page.reload();
  227 |     await expectReport(page, "Valid", valid.fileName);
  228 | 
  229 |     const invalid = await uploadFixture(page, {
  230 |       runId,
  231 |       fixture: sbomValidationFixtures.invalid,
  232 |       buttonName: "Upload SBOM",
  233 |     });
  234 |     await runSbomWorkerOnce();
  235 |     const invalidReport = await expectReportStatus(
  236 |       context.request,
  237 |       invalid.sourceId,
  238 |       "invalid",
  239 |     );
  240 |     expect(invalidReport.report.errorCount).toBeGreaterThan(0);
  241 |     await page.reload();
  242 |     await expectReport(page, "Invalid", invalid.fileName);
  243 |     await page.getByRole("button", { name: /^Errors [1-9]/u }).click();
  244 |     await expect(
  245 |       page.getByRole("table", { name: "SBOM diagnostics" }),
  246 |     ).toBeVisible();
  247 |     await expect(
  248 |       page.getByText("schema_violation", { exact: true }),
> 249 |     ).toBeVisible();
      |       ^ Error: expect(locator).toBeVisible() failed
  250 |     await captureValidationScreenshot(page, testInfo, {
  251 |       attachmentName: "desktop invalid SBOM diagnostics",
  252 |       fileName: "sbom-validation-desktop-invalid-diagnostics.png",
  253 |     });
  254 | 
  255 |     await page
  256 |       .getByRole("button", { name: "Upload corrected version", exact: true })
  257 |       .click();
  258 |     await expect(
  259 |       page.getByText(
  260 |         "Choose a corrected SBOM. The previous evidence remains immutable.",
  261 |       ),
  262 |     ).toBeVisible();
  263 |     const corrected = await uploadFixture(page, {
  264 |       runId,
  265 |       fixture: sbomValidationFixtures.corrected,
  266 |       buttonName: "Upload corrected SBOM",
  267 |     });
  268 |     expect(corrected.sourceId).not.toBe(invalid.sourceId);
  269 |     await runSbomWorkerOnce();
  270 |     await expectReportStatus(context.request, corrected.sourceId, "valid");
  271 |     const history = await sourceHistory(
  272 |       context.request,
  273 |       product.product.id,
  274 |       release.release.id,
  275 |     );
  276 |     expect(history.sources.map((item) => item.source.fileName)).toEqual(
  277 |       expect.arrayContaining([
  278 |         valid.fileName,
  279 |         invalid.fileName,
  280 |         corrected.fileName,
  281 |       ]),
  282 |     );
  283 |     expect(
  284 |       history.sources.find((item) => item.source.id === invalid.sourceId),
  285 |     ).toMatchObject({
  286 |       validation: { status: "invalid" },
  287 |     });
  288 |     expect(
  289 |       history.sources.find((item) => item.source.id === corrected.sourceId),
  290 |     ).toMatchObject({
  291 |       source: { supersedesSourceId: invalid.sourceId },
  292 |       validation: { status: "valid" },
  293 |     });
  294 |     await captureMobileValidationScreenshot(testInfo, {
  295 |       browser,
  296 |       productId: product.product.id,
  297 |       correctedFileName: corrected.fileName,
  298 |       storageState: await context.storageState(),
  299 |     });
  300 |   } finally {
  301 |     await context.close();
  302 |     await fixtures.cleanup();
  303 |   }
  304 | });
  305 | 
  306 | async function currentSession(
  307 |   request: APIRequestContext,
  308 | ): Promise<SessionResponse> {
  309 |   const response = await request.get(
  310 |     `${LIVE_API_ORIGIN}${API_PREFIX}/auth/session`,
  311 |   );
  312 |   expect(response.status()).toBe(200);
  313 |   return (await response.json()) as SessionResponse;
  314 | }
  315 | 
  316 | async function defaultLegalEntityId(
  317 |   request: APIRequestContext,
  318 | ): Promise<string> {
  319 |   const response = await request.get(
  320 |     `${LIVE_API_ORIGIN}${API_PREFIX}/organizations/current/legal-entities`,
  321 |   );
  322 |   expect(response.status()).toBe(200);
  323 |   const body = (await response.json()) as LegalEntitiesResponse;
  324 |   const legalEntity = body.legalEntities.find(
  325 |     (candidate) =>
  326 |       candidate.status === "active" &&
  327 |       candidate.completionStatus === "complete" &&
  328 |       candidate.identifier === "default",
  329 |   );
  330 |   if (!legalEntity)
  331 |     throw new Error("Seed owner has no active default legal entity");
  332 |   return legalEntity.id;
  333 | }
  334 | 
  335 | async function createProduct(
  336 |   request: APIRequestContext,
  337 |   input: Readonly<{ runId: string; ownerId: string; legalEntityId: string }>,
  338 | ): Promise<ProductResponse> {
  339 |   const response = await request.post(
  340 |     `${LIVE_API_ORIGIN}${API_PREFIX}/products`,
  341 |     {
  342 |       data: {
  343 |         name: `E2E SBOM ${input.runId}`,
  344 |         internalCode: `E2E-SBOM-${input.runId}`,
  345 |         productType: "standalone_software",
  346 |         description: "Run-scoped SBOM validation E2E product.",
  347 |         responsibleOwnerId: input.ownerId,
  348 |         legalEntityId: input.legalEntityId,
  349 |         idempotencyKey: randomUUID(),
```