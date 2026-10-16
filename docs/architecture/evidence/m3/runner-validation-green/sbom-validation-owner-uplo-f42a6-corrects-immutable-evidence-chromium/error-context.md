# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: sbom-validation.spec.ts >> owner uploads valid and invalid SBOMs, filters diagnostics, and corrects immutable evidence
- Location: e2e/sbom-validation.spec.ts:147:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "valid"
Received: "pending"

Call Log:
- Timeout 60000ms exceeded while waiting on the predicate
```

# Test source

```ts
  371 |     },
  372 |   );
  373 |   expect(response.status()).toBe(201);
  374 |   return (await response.json()) as ReleaseResponse;
  375 | }
  376 | 
  377 | async function uploadFixture(
  378 |   page: Page,
  379 |   input: Readonly<{
  380 |     runId: string;
  381 |     fixture: Readonly<{
  382 |       fileName: (runId: string) => string;
  383 |       mediaType: string;
  384 |       bytes: () => Buffer;
  385 |     }>;
  386 |     buttonName: string;
  387 |   }>,
  388 | ): Promise<Readonly<{ sourceId: string; jobId: string; fileName: string }>> {
  389 |   const fileName = input.fixture.fileName(input.runId);
  390 |   await page.getByLabel("SBOM file", { exact: true }).setInputFiles({
  391 |     name: fileName,
  392 |     mimeType: input.fixture.mediaType,
  393 |     buffer: input.fixture.bytes(),
  394 |   });
  395 |   await expect(
  396 |     page.getByRole("button", { name: input.buttonName, exact: true }),
  397 |   ).toBeEnabled();
  398 |   const initialized = page.waitForResponse(
  399 |     (response) =>
  400 |       /\/api\/v1\/products\/[^/]+\/releases\/[^/]+\/sbom-uploads$/u.test(
  401 |         new URL(response.url()).pathname,
  402 |       ) && response.request().method() === "POST",
  403 |   );
  404 |   const completed = page.waitForResponse(
  405 |     (response) =>
  406 |       /\/api\/v1\/sbom-uploads\/[^/]+\/complete$/u.test(
  407 |         new URL(response.url()).pathname,
  408 |       ) && response.request().method() === "POST",
  409 |   );
  410 |   await page
  411 |     .getByRole("button", { name: input.buttonName, exact: true })
  412 |     .click();
  413 |   const initializedResponse = await initialized;
  414 |   expect(initializedResponse.status()).toBe(201);
  415 |   const upload = (await initializedResponse.json()) as SbomUploadResponse;
  416 |   const completedResponse = await completed;
  417 |   expect(completedResponse.status()).toBe(202);
  418 |   const completion = sbomUploadCompletionResponseSchema.parse(
  419 |     await completedResponse.json(),
  420 |   );
  421 |   expect(completion.completion.sourceId).toBe(upload.source.id);
  422 |   expect(completion.job.sourceId).toBe(completion.completion.canonicalSourceId);
  423 |   await expect(
  424 |     page.getByText("Original evidence is verified and queued for processing.", {
  425 |       exact: true,
  426 |     }),
  427 |   ).toBeVisible();
  428 |   return { sourceId: upload.source.id, jobId: completion.job.id, fileName };
  429 | }
  430 | 
  431 | async function runSbomWorkerOnce(): Promise<void> {
  432 |   const { stderr } = await execFileAsync(
  433 |     "pnpm",
  434 |     [
  435 |       "--filter",
  436 |       "api",
  437 |       "exec",
  438 |       "ts-node",
  439 |       "-r",
  440 |       "tsconfig-paths/register",
  441 |       "src/sbom-ingest-worker.ts",
  442 |       "--once",
  443 |     ],
  444 |     {
  445 |       cwd: REPO_ROOT,
  446 |       env: process.env,
  447 |       timeout: 60_000,
  448 |     },
  449 |   );
  450 |   expect(stderr).not.toContain("SBOM ingest worker cycle failed safely");
  451 | }
  452 | 
  453 | async function expectReportStatus(
  454 |   request: APIRequestContext,
  455 |   sourceId: string,
  456 |   status: "valid" | "invalid",
  457 | ): Promise<SbomValidationReportResponse> {
  458 |   let latest: SbomValidationReportResponse | null = null;
  459 |   await expect
  460 |     .poll(
  461 |       async () => {
  462 |         const response = await request.get(
  463 |           `${LIVE_API_ORIGIN}${API_PREFIX}/sbom-sources/${sourceId}/validation-report`,
  464 |         );
  465 |         expect(response.status()).toBe(200);
  466 |         latest = (await response.json()) as SbomValidationReportResponse;
  467 |         return latest.report.status;
  468 |       },
  469 |       { timeout: 60_000 },
  470 |     )
> 471 |     .toBe(status);
      |      ^ Error: expect(received).toBe(expected) // Object.is equality
  472 |   if (!latest) throw new Error("Validation report did not resolve");
  473 |   return latest;
  474 | }
  475 | 
  476 | async function sourceHistory(
  477 |   request: APIRequestContext,
  478 |   productId: string,
  479 |   releaseId: string,
  480 | ): Promise<SbomSourceHistoryResponse> {
  481 |   const response = await request.get(
  482 |     `${LIVE_API_ORIGIN}${API_PREFIX}/products/${productId}/releases/${releaseId}/sbom-sources?limit=10`,
  483 |   );
  484 |   expect(response.status()).toBe(200);
  485 |   return (await response.json()) as SbomSourceHistoryResponse;
  486 | }
  487 | 
  488 | async function expectReport(
  489 |   page: Page,
  490 |   label: string,
  491 |   fileName: string,
  492 | ): Promise<void> {
  493 |   await expect(
  494 |     page.getByRole("heading", { name: "SBOM evidence", exact: true }),
  495 |   ).toBeVisible();
  496 |   await expect(page.getByText(fileName, { exact: true }).first()).toBeVisible();
  497 |   await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  498 | }
  499 | 
  500 | async function captureValidationScreenshot(
  501 |   page: Page,
  502 |   testInfo: TestInfo,
  503 |   input: Readonly<{ attachmentName: string; fileName: string }>,
  504 | ): Promise<void> {
  505 |   const path = testInfo.outputPath(input.fileName);
  506 |   await page.screenshot({ path, fullPage: true });
  507 |   await testInfo.attach(input.attachmentName, {
  508 |     path,
  509 |     contentType: "image/png",
  510 |   });
  511 | }
  512 | 
  513 | async function captureMobileValidationScreenshot(
  514 |   testInfo: TestInfo,
  515 |   input: Readonly<{
  516 |     browser: Browser;
  517 |     productId: string;
  518 |     correctedFileName: string;
  519 |     storageState: Awaited<
  520 |       ReturnType<import("@playwright/test").BrowserContext["storageState"]>
  521 |     >;
  522 |   }>,
  523 | ): Promise<void> {
  524 |   const mobileContext = await input.browser.newContext({
  525 |     baseURL: WEB_ORIGIN,
  526 |     viewport: MOBILE_VIEWPORT,
  527 |     isMobile: true,
  528 |     hasTouch: true,
  529 |     deviceScaleFactor: 3,
  530 |     storageState: input.storageState,
  531 |   });
  532 |   try {
  533 |     const mobilePage = await mobileContext.newPage();
  534 |     await mobilePage.goto(`/products/${input.productId}`);
  535 |     await expectReport(mobilePage, "Valid", input.correctedFileName);
  536 |     await expect(
  537 |       mobilePage.getByText("CycloneDX 1.6", { exact: true }).first(),
  538 |     ).toBeVisible();
  539 |     await expect(
  540 |       mobilePage.getByText("Json", { exact: true }).first(),
  541 |     ).toBeVisible();
  542 |     await captureValidationScreenshot(mobilePage, testInfo, {
  543 |       attachmentName: "mobile corrected SBOM report",
  544 |       fileName: "sbom-validation-mobile-corrected-valid.png",
  545 |     });
  546 |   } finally {
  547 |     await mobileContext.close();
  548 |   }
  549 | }
  550 | 
```