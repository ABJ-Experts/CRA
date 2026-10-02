# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: connector-sync.spec.ts >> a run-scoped owner completes connector sync, observes retry safety, and cannot leak it across tenants
- Location: e2e/connector-sync.spec.ts:137:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 200
Received: 503
```

# Test source

```ts
  221 |       { timeout: 15_000 },
  222 |     );
  223 |     await page
  224 |       .getByRole("button", { name: "Test connection", exact: true })
  225 |       .click();
  226 |     expect((await tested).status()).toBe(200);
  227 |     await expect(
  228 |       page.getByText("Connection successful", { exact: true }),
  229 |     ).toBeVisible();
  230 | 
  231 |     for (const policy of REQUIRED_POLICIES) {
  232 |       stage = `authority policy ${policy.entityType}.${policy.fieldName}`;
  233 |       await savePolicy(page, policy);
  234 |     }
  235 |     await expect(
  236 |       page.getByText(
  237 |         "Configure every required field authority policy before starting a sync.",
  238 |       ),
  239 |     ).toHaveCount(0);
  240 | 
  241 |     stage = "start dry run";
  242 |     const dryRunStarted = page.waitForResponse(
  243 |       (response) =>
  244 |         /\/api\/v1\/connectors\/[^/]+\/sync-runs$/.test(
  245 |           new URL(response.url()).pathname,
  246 |         ) && response.request().method() === "POST",
  247 |       { timeout: 15_000 },
  248 |     );
  249 |     await page
  250 |       .getByRole("button", { name: "Start dry run (incremental)", exact: true })
  251 |       .click();
  252 |     expect((await dryRunStarted).status()).toBe(202);
  253 |     await expect(
  254 |       page.getByText("Waiting for review", { exact: true }),
  255 |     ).toBeVisible({
  256 |       timeout: 40_000,
  257 |     });
  258 |     await expect(page.getByText("1", { exact: true })).toBeVisible();
  259 |     await expect(page.getByText("create", { exact: true })).toBeVisible();
  260 | 
  261 |     stage = "commit sync";
  262 |     const commitRequested = page.waitForResponse(
  263 |       (response) =>
  264 |         new URL(response.url()).pathname.endsWith("/request-commit") &&
  265 |         response.request().method() === "POST",
  266 |       { timeout: 15_000 },
  267 |     );
  268 |     await page
  269 |       .getByRole("button", { name: "Request commit", exact: true })
  270 |       .click();
  271 |     expect((await commitRequested).status()).toBe(200);
  272 |     await expect(page.getByText("Completed", { exact: true })).toBeVisible({
  273 |       timeout: 40_000,
  274 |     });
  275 | 
  276 |     const download = page.waitForEvent("download");
  277 |     await page
  278 |       .getByRole("button", { name: "Export diagnostics", exact: true })
  279 |       .click();
  280 |     const diagnostics = await download;
  281 |     const diagnosticsPath = await diagnostics.path();
  282 |     expect(diagnosticsPath).not.toBeNull();
  283 |     const report = await readFile(diagnosticsPath as string, "utf8");
  284 |     expect(report).toContain(connectorId);
  285 |     expect(report).not.toContain(CONNECTOR_SECRET);
  286 | 
  287 |     await page.goto("/products");
  288 |     await expect(
  289 |       page.getByText("Sentinel Gateway", { exact: true }),
  290 |     ).toBeVisible();
  291 | 
  292 |     stage = "retry scenario connection config";
  293 |     await page.goto(`/connectors/${connectorId}`);
  294 |     await page
  295 |       .getByRole("textbox", {
  296 |         name: "Connection config (JSON, no secrets)",
  297 |         exact: true,
  298 |       })
  299 |       .fill(configFor(account, legalEntityId, "rate_limit"));
  300 |     stage = "retry scenario connection config";
  301 |     const connectionSaved = page.waitForResponse(
  302 |       (response) =>
  303 |         /\/api\/v1\/connectors\/[^/]+$/.test(
  304 |           new URL(response.url()).pathname,
  305 |         ) && response.request().method() === "PATCH",
  306 |       { timeout: 15_000 },
  307 |     );
  308 |     await page
  309 |       .getByRole("button", { name: "Save connection", exact: true })
  310 |       .click();
  311 |     expect((await connectionSaved).status()).toBe(200);
  312 |     // New connection revision needs explicit fixture validation before work starts.
  313 |     const retested = page.waitForResponse(
  314 |       (response) =>
  315 |         response.url().endsWith("/test") &&
  316 |         response.request().method() === "POST",
  317 |     );
  318 |     await page
  319 |       .getByRole("button", { name: "Test connection", exact: true })
  320 |       .click();
> 321 |     expect((await retested).status()).toBe(200);
      |                                       ^ Error: expect(received).toBe(expected) // Object.is equality
  322 | 
  323 |     await page
  324 |       .getByRole("button", { name: "Start dry run (incremental)", exact: true })
  325 |       .click();
  326 |     await expect(page.getByText("Retrying", { exact: true })).toBeVisible({
  327 |       timeout: 40_000,
  328 |     });
  329 |     await page.goto("/products");
  330 |     await expect(
  331 |       page.getByText("Sentinel Gateway", { exact: true }),
  332 |     ).toBeVisible();
  333 | 
  334 |     mobileContext = await browser.newContext({
  335 |       baseURL: WEB_ORIGIN,
  336 |       viewport: { width: 390, height: 844 },
  337 |     });
  338 |     await mobileContext.addCookies(await context.cookies());
  339 |     const mobile = await mobileContext.newPage();
  340 |     await mobile.goto(`/connectors/${connectorId}`);
  341 |     await expect(
  342 |       mobile.getByRole("heading", { name: displayName, exact: true }),
  343 |     ).toBeVisible();
  344 |     await mobile.screenshot({
  345 |       path: testInfo.outputPath("connector-mobile.png"),
  346 |       fullPage: true,
  347 |     });
  348 |     await page.screenshot({
  349 |       path: testInfo.outputPath("connector-desktop.png"),
  350 |       fullPage: true,
  351 |     });
  352 | 
  353 |     otherContext = await browser.newContext({ baseURL: WEB_ORIGIN });
  354 |     const otherAccount = await fixtures.createVerified(
  355 |       otherContext,
  356 |       "connector-other-tenant",
  357 |     );
  358 |     const otherOrganizationId = await createOrganization(
  359 |       otherContext,
  360 |       otherAccount,
  361 |       `E2E Connector Isolation ${testInfo.parallelIndex}-${Date.now()}`,
  362 |     );
  363 |     fixtures.trackM2V2Organization(otherOrganizationId);
  364 |     const hidden = await otherContext.request.get(
  365 |       `${LIVE_API_ORIGIN}/api/v1/connectors/${connectorId}`,
  366 |     );
  367 |     expect(hidden.status()).toBe(404);
  368 |     expect(await hidden.text()).not.toContain(displayName);
  369 |   } catch (error) {
  370 |     journeyError = error;
  371 |     process.stderr.write(
  372 |       `Connector journey failed at ${stage}: ${error instanceof Error ? error.stack : String(error)}\n`,
  373 |     );
  374 |   } finally {
  375 |     const cleanup = await Promise.allSettled([
  376 |       mobileContext?.close(),
  377 |       otherContext?.close(),
  378 |       context.close(),
  379 |     ]);
  380 |     try {
  381 |       await fixtures.cleanup();
  382 |     } catch (cleanupError) {
  383 |       cleanupFailure = cleanupError;
  384 |       await testInfo.attach("scoped-cleanup-failure", {
  385 |         body: String(cleanupError),
  386 |         contentType: "text/plain",
  387 |       });
  388 |     }
  389 |     const closeFailure = cleanup.find((result) => result.status === "rejected");
  390 |     if (!cleanupFailure && closeFailure?.status === "rejected") {
  391 |       cleanupFailure = closeFailure.reason;
  392 |     }
  393 |   }
  394 |   if (journeyError) throw journeyError;
  395 |   if (cleanupFailure) throw cleanupFailure;
  396 | });
  397 | 
```