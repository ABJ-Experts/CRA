# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: product-relationships.spec.ts >> a run-scoped owner records baseline, variant, component preview, and a rejected cycle
- Location: e2e/product-relationships.spec.ts:145:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Software baseline membership recorded.')
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByText('Software baseline membership recorded.')

```

```yaml
- dialog "Relationships":
  - heading "Relationships" [level=2]
  - paragraph: Review baselines, variants, and components.
  - tablist "Relationships sections":
    - tab "Overview"
    - tab "Record change" [selected]
  - button "Close"
  - tabpanel "Record change":
    - region "Product relationships":
      - paragraph: Relationship ledger
      - heading "Product relationships" [level=2]
      - paragraph: Review dependency evidence, then make one versioned change at a time.
      - term: Baselines
      - definition: "0"
      - term: Variants
      - definition: "0"
      - term: Components
      - definition: "0"
      - term: Graph
      - definition: v0
      - region "Relationship commands":
        - heading "Record a change" [level=3]
        - paragraph: Times display in UTC and submit as UTC.
        - region "Relationship evidence":
          - heading "Evidence for this change" [level=4]
          - paragraph: Set the source, evidence, and effective interval once.
          - text: Relationship source
          - textbox "Relationship source": E2E architecture record
          - text: Provenance
          - textbox "Relationship provenance": E2E test fixture
          - text: Relationship effective start
          - textbox "Relationship effective start": 2026-08-17T10:00
          - text: Relationship effective end
          - textbox "Relationship effective end"
          - text: Reason
          - textbox "Relationship reason": E2E relationship verification
        - heading "Software baseline" [level=4]
        - text: Baseline identifier
        - textbox "Baseline identifier": e2e-runtime
        - text: Baseline name
        - textbox "Baseline name": E2E runtime
        - text: Revision summary
        - textbox "Baseline revision summary": Initial E2E runtime revision
        - button "Record software baseline"
        - button "Record baseline revision"
        - button "Archive software baseline"
        - heading "Assign baseline" [level=4]
        - text: Release
        - combobox "Relationship release":
          - option "Select release"
          - option "Base 1.0 1.0.0" [selected]
        - text: Search software baselines
        - textbox "Search software baselines":
          - /placeholder: Type a baseline name or identifier
          - text: E2E runtime
        - text: Software baseline
        - combobox "Software baseline":
          - option "Select baseline"
          - option "E2E runtime · e2e-runtime · revision 1" [selected]
        - text: Baseline revision
        - combobox "Baseline revision":
          - option "Select revision"
          - option "Revision 1 · version 0" [selected]
        - button "Record baseline membership Recording baseline membership" [disabled]
        - heading "Variant relationship" [level=4]
        - text: Variant source
        - combobox "Variant source":
          - option "Base release" [selected]
          - option "Baseline revision"
        - text: Search variant product
        - textbox "Search variant product":
          - /placeholder: Type a product name or internal code
        - text: Variant product
        - combobox "Variant product" [disabled]:
          - option "Searching products…" [selected]
        - paragraph: Search the current organization before selecting a product.
        - text: Variant release
        - combobox "Variant release" [disabled]:
          - option "Loading releases…" [selected]
        - button "Record variant relationship"
        - heading "Embedded component" [level=4]
        - paragraph: Preview the graph impact before recording or replacing a link.
        - text: Graph v0 Search component product
        - textbox "Search component product":
          - /placeholder: Type a product name or internal code
        - text: Component product
        - combobox "Component product" [disabled]:
          - option "Searching products…" [selected]
        - paragraph: Search the current organization before selecting a product.
        - text: Component release (optional)
        - combobox "Component release" [disabled]:
          - option "Loading releases…" [selected]
        - text: Quantity
        - textbox "Component quantity": "1"
        - button "Preview component link"
        - button "Record component link"
        - region "Relationship lifecycle controls":
          - heading "End or update a relationship" [level=3]
          - paragraph: Ending and replacement commands preserve the prior relationship history.
          - text: Baseline membership
          - combobox "Baseline membership to end":
            - option "Select active membership" [selected]
          - text: Variant relationship
          - combobox "Variant relationship to end":
            - option "Select active variant" [selected]
          - text: Component link
          - combobox "Component link to change":
            - option "Select active component" [selected]
          - text: Relationship effective end
          - textbox "Relationship effective end"
          - button "End baseline membership" [disabled]
          - button "End variant relationship" [disabled]
          - button "End component link" [disabled]
          - button "Update component link" [disabled]
          - heading "Re-evaluate relationships" [level=3]
          - paragraph: Queue durable propagation for the current graph version.
          - button "Queue relationship re-evaluation"
        - alert: Software baseline recorded and selected for membership.
```

# Test source

```ts
  223 |       method: string;
  224 |       path: string;
  225 |       status: number;
  226 |       elapsedMs: number;
  227 |       errorCode?: string;
  228 |     } = {
  229 |       method: "GET",
  230 |       path: "/api/v1/organizations/current/legal-entities",
  231 |       status: legalEntitiesResponse.status(),
  232 |       elapsedMs: Date.now() - legalReadStarted,
  233 |     };
  234 |     if (!legalEntitiesResponse.ok()) {
  235 |       const errorBody: unknown = await legalEntitiesResponse.json();
  236 |       if (
  237 |         errorBody &&
  238 |         typeof errorBody === "object" &&
  239 |         "code" in errorBody &&
  240 |         typeof errorBody.code === "string"
  241 |       )
  242 |         legalReadEntry.errorCode = errorBody.code;
  243 |     }
  244 |     requests.push(legalReadEntry);
  245 |     expect(legalEntitiesResponse.status()).toBe(200);
  246 |     const legalEntity = (
  247 |       (await legalEntitiesResponse.json()) as LegalEntitiesResponse
  248 |     ).legalEntities[0];
  249 |     expect(legalEntity).toBeDefined();
  250 |     if (!legalEntity)
  251 |       throw new Error("Run-scoped organization has no legal entity");
  252 | 
  253 |     const baseProductId = await createProduct(context, {
  254 |       name: "E2E Relationship Base",
  255 |       internalCode: `BASE-${testInfo.parallelIndex}-${Date.now()}`,
  256 |       legalEntityId: legalEntity.id,
  257 |       responsibleOwnerId: account.publicUserId,
  258 |     });
  259 |     const variantProductId = await createProduct(context, {
  260 |       name: "E2E Relationship Variant",
  261 |       internalCode: `VARIANT-${testInfo.parallelIndex}-${Date.now()}`,
  262 |       legalEntityId: legalEntity.id,
  263 |       responsibleOwnerId: account.publicUserId,
  264 |     });
  265 |     const componentProductId = await createProduct(context, {
  266 |       name: "E2E Relationship Component",
  267 |       internalCode: `COMPONENT-${testInfo.parallelIndex}-${Date.now()}`,
  268 |       legalEntityId: legalEntity.id,
  269 |       responsibleOwnerId: account.publicUserId,
  270 |     });
  271 |     const baseReleaseId = await createRelease(
  272 |       context,
  273 |       baseProductId,
  274 |       "Base 1.0",
  275 |     );
  276 |     const variantReleaseId = await createRelease(
  277 |       context,
  278 |       variantProductId,
  279 |       "Variant 1.0",
  280 |     );
  281 | 
  282 |     await page.goto(`/products/${baseProductId}`);
  283 |     await expect(
  284 |       page.getByRole("heading", { name: "E2E Relationship Base", exact: true }),
  285 |     ).toBeVisible();
  286 |     await openRelationshipManager(page);
  287 |     await expect(
  288 |       page.getByRole("combobox", {
  289 |         name: "Relationship release",
  290 |         exact: true,
  291 |       }),
  292 |     ).toHaveValue(baseReleaseId);
  293 |     await page
  294 |       .getByLabel("Baseline identifier", { exact: true })
  295 |       .fill("e2e-runtime");
  296 |     await page.getByLabel("Baseline name", { exact: true }).fill("E2E runtime");
  297 |     await page
  298 |       .getByLabel("Baseline revision summary", { exact: true })
  299 |       .fill("Initial E2E runtime revision");
  300 |     await page
  301 |       .getByLabel("Relationship source", { exact: true })
  302 |       .fill("E2E architecture record");
  303 |     await page
  304 |       .getByLabel("Relationship provenance", { exact: true })
  305 |       .fill("E2E test fixture");
  306 |     await page
  307 |       .getByLabel("Relationship reason", { exact: true })
  308 |       .fill("E2E relationship verification");
  309 |     await page
  310 |       .getByLabel("Relationship effective start", { exact: true })
  311 |       .fill("2026-08-17T10:00");
  312 |     await page
  313 |       .getByRole("button", { name: "Record software baseline", exact: true })
  314 |       .click();
  315 |     await expect(
  316 |       page.getByText("Software baseline recorded and selected for membership."),
  317 |     ).toBeVisible();
  318 |     await page
  319 |       .getByRole("button", { name: "Record baseline membership", exact: true })
  320 |       .click();
  321 |     await expect(
  322 |       page.getByText("Software baseline membership recorded."),
> 323 |     ).toBeVisible();
      |       ^ Error: expect(locator).toBeVisible() failed
  324 | 
  325 |     await page
  326 |       .getByLabel("Search variant product", { exact: true })
  327 |       .fill("E2E Relationship Variant");
  328 |     await page
  329 |       .getByLabel("Variant product", { exact: true })
  330 |       .selectOption(variantProductId);
  331 |     await page
  332 |       .getByLabel("Variant release", { exact: true })
  333 |       .selectOption(variantReleaseId);
  334 |     await page
  335 |       .getByRole("button", { name: "Record variant relationship", exact: true })
  336 |       .click();
  337 |     await expect(
  338 |       page.getByText("Variant relationship recorded."),
  339 |     ).toBeVisible();
  340 | 
  341 |     await page
  342 |       .getByLabel("Search component product", { exact: true })
  343 |       .fill("E2E Relationship Component");
  344 |     await page
  345 |       .getByLabel("Component product", { exact: true })
  346 |       .selectOption(componentProductId);
  347 |     await page
  348 |       .getByRole("button", { name: "Preview component link", exact: true })
  349 |       .click();
  350 |     await expect(page.getByText(/Preview: allowed/)).toBeVisible();
  351 |     const componentCreated = page.waitForResponse(
  352 |       (response) =>
  353 |         new URL(response.url()).pathname ===
  354 |           `/api/v1/products/${baseProductId}/component-links` &&
  355 |         response.request().method() === "POST",
  356 |       { timeout: 15_000 },
  357 |     );
  358 |     process.stderr.write(
  359 |       `Component POST begins for fixture organization ${organizationId}, product ${baseProductId}\n`,
  360 |     );
  361 |     await page
  362 |       .getByRole("button", { name: "Record component link", exact: true })
  363 |       .click();
  364 |     const componentResponse = await componentCreated;
  365 |     expect(componentResponse.status()).toBe(201);
  366 |     const componentBody = productComponentLinkResponseSchema.parse(
  367 |       await componentResponse.json(),
  368 |     );
  369 |     expect(componentBody.relationship).toMatchObject({
  370 |       parentProductId: baseProductId,
  371 |       componentProductId,
  372 |     });
  373 |     await expect(page.getByText("Component link recorded.")).toBeVisible();
  374 |     await page.screenshot({
  375 |       path: testInfo.outputPath("relationship-component-recorded-desktop.png"),
  376 |       fullPage: false,
  377 |     });
  378 |     await page.reload();
  379 |     await openRelationshipOverview(page);
  380 |     await expect(
  381 |       page
  382 |         .getByRole("region", {
  383 |           name: "Relationship propagation events",
  384 |           exact: true,
  385 |         })
  386 |         .getByText(/^(scheduled|processing|completed)$/)
  387 |         .first(),
  388 |     ).toBeVisible();
  389 | 
  390 |     await page.goto(`/products/${componentProductId}`);
  391 |     await openRelationshipManager(page);
  392 |     await page
  393 |       .getByLabel("Relationship source", { exact: true })
  394 |       .fill("E2E architecture record");
  395 |     await page
  396 |       .getByLabel("Relationship provenance", { exact: true })
  397 |       .fill("E2E test fixture");
  398 |     await page
  399 |       .getByLabel("Relationship reason", { exact: true })
  400 |       .fill("E2E cycle preview verification");
  401 |     await page
  402 |       .getByLabel("Relationship effective start", { exact: true })
  403 |       .fill("2026-08-17T10:00");
  404 |     await page
  405 |       .getByLabel("Search component product", { exact: true })
  406 |       .fill("E2E Relationship Base");
  407 |     await page
  408 |       .getByLabel("Component product", { exact: true })
  409 |       .selectOption(baseProductId);
  410 |     await page
  411 |       .getByRole("button", { name: "Preview component link", exact: true })
  412 |       .click();
  413 |     await expect(
  414 |       page.getByText("This link would create a cycle and was not recorded."),
  415 |     ).toBeVisible();
  416 |   } catch (error) {
  417 |     journeyError = error;
  418 |     process.stderr.write(
  419 |       `Relationship journey failed: ${error instanceof Error ? error.stack : String(error)}\n`,
  420 |     );
  421 |     const page = context.pages()[0];
  422 |     if (page && !page.isClosed()) {
  423 |       await page
```