# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: m9-06-supplier-sbom-portal.spec.ts >> assigned supplier uploads, corrects, and reviews an SBOM through the M9 link
- Location: e2e/m9-06-supplier-sbom-portal.spec.ts:328:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 201
Received: 429
```

# Test source

```ts
  251 |           continue;
  252 |         const match =
  253 |           /https?:\/\/[^\s<>"']+\/supplier-evidence#[A-Za-z0-9_%.-]+/u.exec(
  254 |             `${message.Text ?? ""}\n${message.HTML ?? ""}`,
  255 |           );
  256 |         if (match) return match[0];
  257 |       }
  258 |     }
  259 |     await new Promise((resolve) => setTimeout(resolve, 250));
  260 |   }
  261 |   throw new Error(
  262 |     `No M9 supplier invitation arrived in local Mailpit for ${email}`,
  263 |   );
  264 | }
  265 | 
  266 | function sbomBytes(componentRef: string, valid: boolean): Buffer {
  267 |   return Buffer.from(
  268 |     `${JSON.stringify({
  269 |       bomFormat: "CycloneDX",
  270 |       specVersion: "1.6",
  271 |       version: 1,
  272 |       components: [
  273 |         {
  274 |           type: "library",
  275 |           "bom-ref": componentRef,
  276 |           ...(valid ? { name: "m906-component", version: "1.0.0" } : {}),
  277 |           purl: componentRef,
  278 |         },
  279 |       ],
  280 |     })}\n`,
  281 |     "utf8",
  282 |   );
  283 | }
  284 | 
  285 | async function runWorkerOnce(): Promise<void> {
  286 |   const result = await execFileAsync(
  287 |     "pnpm",
  288 |     [
  289 |       "--filter",
  290 |       "api",
  291 |       "exec",
  292 |       "ts-node",
  293 |       "-r",
  294 |       "tsconfig-paths/register",
  295 |       "src/sbom-ingest-worker.ts",
  296 |       "--once",
  297 |     ],
  298 |     { cwd: REPO_ROOT, env: process.env, timeout: 60_000 },
  299 |   );
  300 |   expect(result.stderr).not.toContain("SBOM ingest worker cycle failed safely");
  301 | }
  302 | 
  303 | async function supplierSubmission(
  304 |   request: APIRequestContext,
  305 |   requestId: string,
  306 |   productId: string,
  307 | ): Promise<SupplierSubmission> {
  308 |   const response = await json<{
  309 |     requests: Array<{
  310 |       request: { id: string };
  311 |       submissions: SupplierSubmission[];
  312 |     }>;
  313 |   }>(
  314 |     await request.get(
  315 |       `${API}/supplier-sbom-requests?productId=${productId}&limit=100`,
  316 |     ),
  317 |     200,
  318 |   );
  319 |   const summary = response.requests.find((row) => row.request.id === requestId);
  320 |   const pending = summary?.submissions.find(
  321 |     (submission) => submission.state === "awaiting_review",
  322 |   );
  323 |   if (!pending)
  324 |     throw new Error("Linked M3 submission is not visible to the owner");
  325 |   return pending;
  326 | }
  327 | 
  328 | test("assigned supplier uploads, corrects, and reviews an SBOM through the M9 link", async ({
  329 |   browser,
  330 | }, testInfo) => {
  331 |   test.setTimeout(240_000);
  332 |   assertLocalOrigins();
  333 |   expect(browser.browserType().name()).toBe(browserName);
  334 |   const runId = `${Date.now()}-${testInfo.parallelIndex}`;
  335 |   const owner = await browser.newContext({ baseURL: WEB_ORIGIN });
  336 |   const supplier = await browser.newContext({ baseURL: WEB_ORIGIN });
  337 |   try {
  338 |     expect((await signIn(owner.request, "owner@cra.test")).status()).toBe(200);
  339 |     const fixture = await issuedFixture(owner.request, runId);
  340 |     const invitation = new URL(await invitationLink(fixture.contactEmail));
  341 |     const link = `${WEB_ORIGIN}/supplier-evidence${invitation.hash}`;
  342 |     const page = await supplier.newPage();
  343 |     const opened = page.waitForResponse(
  344 |       (response) =>
  345 |         new URL(response.url()).pathname ===
  346 |           "/api/v1/supplier-evidence-portal/sessions" &&
  347 |         response.request().method() === "POST",
  348 |     );
  349 |     await page.goto(link);
  350 |     const openedResponse = await opened;
> 351 |     expect(openedResponse.status()).toBe(201);
      |                                     ^ Error: expect(received).toBe(expected) // Object.is equality
  352 |     const portalPayload = JSON.stringify(await openedResponse.json());
  353 |     expect(portalPayload).not.toContain('"organizationId"');
  354 |     expect(portalPayload).not.toContain('"productId"');
  355 |     expect(portalPayload).not.toContain('"findings"');
  356 |     await expect(
  357 |       page.getByRole("heading", { name: fixture.title }),
  358 |     ).toBeVisible();
  359 |     await expect(
  360 |       page.getByText(`Allowed component: ${fixture.componentRef}`),
  361 |     ).toBeVisible();
  362 |     await expect(page.getByText("No SBOM submitted yet.")).toBeVisible();
  363 |     await expect(
  364 |       page.getByText(/100 MiB maximum.*does not accept a product baseline/u),
  365 |     ).toBeVisible();
  366 |     await page.getByLabel("SBOM file").focus();
  367 |     await page.keyboard.press("Tab");
  368 |     await expect(page.getByLabel("Declared format (optional)")).toBeFocused();
  369 |     await page.keyboard.press("Tab");
  370 |     await expect(
  371 |       page.getByLabel("Specification version (optional)"),
  372 |     ).toBeFocused();
  373 |     await page.screenshot({
  374 |       path: testInfo.outputPath("m9-06-supplier-desktop.png"),
  375 |       fullPage: true,
  376 |     });
  377 | 
  378 |     await page.getByLabel("SBOM file").setInputFiles({
  379 |       name: `m906-invalid-${runId}.cdx.json`,
  380 |       mimeType: "application/json",
  381 |       buffer: sbomBytes(fixture.componentRef, false),
  382 |     });
  383 |     const invalidCompletion = page.waitForResponse((response) =>
  384 |       /\/supplier-evidence-portal\/sbom-items\/[^/]+\/submissions\/[^/]+\/complete$/u.test(
  385 |         new URL(response.url()).pathname,
  386 |       ),
  387 |     );
  388 |     await page.getByRole("button", { name: "Upload SBOM" }).focus();
  389 |     await expect(
  390 |       page.getByRole("button", { name: "Upload SBOM" }),
  391 |     ).toBeFocused();
  392 |     await page.keyboard.press("Enter");
  393 |     expect((await invalidCompletion).status()).toBe(202);
  394 |     await runWorkerOnce();
  395 |     await page.getByRole("button", { name: "Refresh status" }).click();
  396 |     await expect(
  397 |       page.getByRole("status").filter({
  398 |         hasText: /Validation failed; a corrected file may be submitted/u,
  399 |       }),
  400 |     ).toBeVisible({ timeout: 30_000 });
  401 |     await page.screenshot({
  402 |       path: testInfo.outputPath("m9-06-validation-failed.png"),
  403 |       fullPage: true,
  404 |     });
  405 | 
  406 |     await page.getByLabel("SBOM file").setInputFiles({
  407 |       name: `m906-corrected-${runId}.cdx.json`,
  408 |       mimeType: "application/json",
  409 |       buffer: sbomBytes(fixture.componentRef, true),
  410 |     });
  411 |     const completed = page.waitForResponse((response) =>
  412 |       /\/supplier-evidence-portal\/sbom-items\/[^/]+\/submissions\/[^/]+\/complete$/u.test(
  413 |         new URL(response.url()).pathname,
  414 |       ),
  415 |     );
  416 |     await page.getByRole("button", { name: "Upload SBOM" }).click();
  417 |     expect((await completed).status()).toBe(202);
  418 |     await runWorkerOnce();
  419 |     await page.getByRole("button", { name: "Refresh status" }).click();
  420 |     await expect(
  421 |       page.getByRole("status").filter({
  422 |         hasText: /Awaiting internal SBOM review/u,
  423 |       }),
  424 |     ).toBeVisible({ timeout: 30_000 });
  425 | 
  426 |     const pending = await supplierSubmission(
  427 |       owner.request,
  428 |       fixture.m3RequestId,
  429 |       fixture.productId,
  430 |     );
  431 |     expect(pending.state).toBe("awaiting_review");
  432 |     expect(pending.sourceId).not.toBeNull();
  433 |     await json(
  434 |       await owner.request.post(
  435 |         `${API}/supplier-sbom-submissions/${pending.id}/review`,
  436 |         {
  437 |           data: {
  438 |             decision: "accept",
  439 |             reason:
  440 |               "Component identity and normalized evidence verified in local E2E review.",
  441 |             idempotencyKey: randomUUID(),
  442 |           },
  443 |         },
  444 |       ),
  445 |       201,
  446 |     );
  447 |     await page.getByRole("button", { name: "Refresh status" }).click();
  448 |     await expect(
  449 |       page.getByText(/Accepted by an authorized SBOM reviewer/u),
  450 |     ).toBeVisible();
  451 |     await page.setViewportSize({ width: 390, height: 844 });
```