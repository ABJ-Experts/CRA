# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: product-relationships.spec.ts >> a run-scoped owner records baseline, variant, component preview, and a rejected cycle
- Location: e2e/product-relationships.spec.ts:144:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 200
Received: 503
```

# Test source

```ts
  119 |     },
  120 |   );
  121 |   expect(response.status()).toBe(201);
  122 |   return ((await response.json()) as CreatedProduct).product.id;
  123 | }
  124 | 
  125 | async function createRelease(
  126 |   context: BrowserContext,
  127 |   productId: string,
  128 |   label: string,
  129 | ): Promise<string> {
  130 |   const response = await context.request.post(
  131 |     `${LIVE_API_ORIGIN}/api/v1/products/${productId}/releases`,
  132 |     {
  133 |       data: {
  134 |         label,
  135 |         version: "1.0.0",
  136 |         idempotencyKey: randomUUID(),
  137 |       },
  138 |     },
  139 |   );
  140 |   expect(response.status()).toBe(201);
  141 |   return ((await response.json()) as CreatedRelease).release.id;
  142 | }
  143 | 
  144 | test("a run-scoped owner records baseline, variant, component preview, and a rejected cycle", async ({
  145 |   browser,
  146 | }, testInfo) => {
  147 |   test.setTimeout(120_000);
  148 |   const fixtures = new RunScopedAccounts(testInfo);
  149 |   const context = await browser.newContext({ baseURL: WEB_ORIGIN });
  150 | 
  151 |   const requestStarts = new Map<Request, number>();
  152 |   const requests: {
  153 |     method: string;
  154 |     path: string;
  155 |     elapsedMs: number;
  156 |     status?: number;
  157 |     failure?: string;
  158 |   }[] = [];
  159 |   const isRelevant = (request: Request) => {
  160 |     const path = new URL(request.url()).pathname;
  161 |     return (
  162 |       path.startsWith("/api/v1/products") ||
  163 |       path === "/api/v1/auth/session" ||
  164 |       path.endsWith("/legal-entities")
  165 |     );
  166 |   };
  167 |   const safePath = (request: Request) =>
  168 |     new URL(request.url()).pathname.replace(
  169 |       /[0-9a-f]{8}-[0-9a-f-]{27}/gi,
  170 |       "<fixture-id>",
  171 |     );
  172 |   context.on("request", (request) => {
  173 |     if (isRelevant(request)) requestStarts.set(request, Date.now());
  174 |   });
  175 |   context.on("response", (response) => {
  176 |     const request = response.request();
  177 |     const startedAt = requestStarts.get(request);
  178 |     if (startedAt === undefined) return;
  179 |     requests.push({
  180 |       method: request.method(),
  181 |       path: safePath(request),
  182 |       status: response.status(),
  183 |       elapsedMs: Date.now() - startedAt,
  184 |     });
  185 |     requestStarts.delete(request);
  186 |   });
  187 |   context.on("requestfailed", (request) => {
  188 |     const startedAt = requestStarts.get(request);
  189 |     if (startedAt === undefined) return;
  190 |     requests.push({
  191 |       method: request.method(),
  192 |       path: safePath(request),
  193 |       failure: request.failure()?.errorText,
  194 |       elapsedMs: Date.now() - startedAt,
  195 |     });
  196 |     requestStarts.delete(request);
  197 |   });
  198 |   let fixtureOrganizationId: string | undefined;
  199 |   let journeyError: unknown;
  200 |   let cleanupFailure: unknown;
  201 |   try {
  202 |     const account = await fixtures.createVerified(
  203 |       context,
  204 |       "relationship-owner",
  205 |     );
  206 |     const page = await context.newPage();
  207 |     page.setDefaultTimeout(30_000);
  208 |     const organizationId = await onboardRunOrganization(
  209 |       page,
  210 |       account.email,
  211 |       `E2E Relationships ${testInfo.parallelIndex}-${Date.now()}`,
  212 |     );
  213 |     fixtures.trackOrganization(organizationId);
  214 |     fixtureOrganizationId = organizationId;
  215 | 
  216 |     const legalEntitiesResponse = await context.request.get(
  217 |       `${LIVE_API_ORIGIN}/api/v1/organizations/current/legal-entities`,
  218 |     );
> 219 |     expect(legalEntitiesResponse.status()).toBe(200);
      |                                            ^ Error: expect(received).toBe(expected) // Object.is equality
  220 |     const legalEntity = (
  221 |       (await legalEntitiesResponse.json()) as LegalEntitiesResponse
  222 |     ).legalEntities[0];
  223 |     expect(legalEntity).toBeDefined();
  224 |     if (!legalEntity)
  225 |       throw new Error("Run-scoped organization has no legal entity");
  226 | 
  227 |     const baseProductId = await createProduct(context, {
  228 |       name: "E2E Relationship Base",
  229 |       internalCode: `BASE-${testInfo.parallelIndex}-${Date.now()}`,
  230 |       legalEntityId: legalEntity.id,
  231 |       responsibleOwnerId: account.publicUserId,
  232 |     });
  233 |     const variantProductId = await createProduct(context, {
  234 |       name: "E2E Relationship Variant",
  235 |       internalCode: `VARIANT-${testInfo.parallelIndex}-${Date.now()}`,
  236 |       legalEntityId: legalEntity.id,
  237 |       responsibleOwnerId: account.publicUserId,
  238 |     });
  239 |     const componentProductId = await createProduct(context, {
  240 |       name: "E2E Relationship Component",
  241 |       internalCode: `COMPONENT-${testInfo.parallelIndex}-${Date.now()}`,
  242 |       legalEntityId: legalEntity.id,
  243 |       responsibleOwnerId: account.publicUserId,
  244 |     });
  245 |     const baseReleaseId = await createRelease(
  246 |       context,
  247 |       baseProductId,
  248 |       "Base 1.0",
  249 |     );
  250 |     const variantReleaseId = await createRelease(
  251 |       context,
  252 |       variantProductId,
  253 |       "Variant 1.0",
  254 |     );
  255 | 
  256 |     await page.goto(`/products/${baseProductId}`);
  257 |     await expect(
  258 |       page.getByRole("heading", { name: "E2E Relationship Base", exact: true }),
  259 |     ).toBeVisible();
  260 |     await openRelationshipManager(page);
  261 |     await expect(
  262 |       page.getByRole("combobox", {
  263 |         name: "Relationship release",
  264 |         exact: true,
  265 |       }),
  266 |     ).toHaveValue(baseReleaseId);
  267 |     await page
  268 |       .getByLabel("Baseline identifier", { exact: true })
  269 |       .fill("e2e-runtime");
  270 |     await page.getByLabel("Baseline name", { exact: true }).fill("E2E runtime");
  271 |     await page
  272 |       .getByLabel("Baseline revision summary", { exact: true })
  273 |       .fill("Initial E2E runtime revision");
  274 |     await page
  275 |       .getByLabel("Relationship source", { exact: true })
  276 |       .fill("E2E architecture record");
  277 |     await page
  278 |       .getByLabel("Relationship provenance", { exact: true })
  279 |       .fill("E2E test fixture");
  280 |     await page
  281 |       .getByLabel("Relationship reason", { exact: true })
  282 |       .fill("E2E relationship verification");
  283 |     await page
  284 |       .getByLabel("Relationship effective start", { exact: true })
  285 |       .fill("2026-08-17T10:00");
  286 |     await page
  287 |       .getByRole("button", { name: "Record software baseline", exact: true })
  288 |       .click();
  289 |     await expect(
  290 |       page.getByText("Software baseline recorded and selected for membership."),
  291 |     ).toBeVisible();
  292 |     await page
  293 |       .getByRole("button", { name: "Record baseline membership", exact: true })
  294 |       .click();
  295 |     await expect(
  296 |       page.getByText("Software baseline membership recorded."),
  297 |     ).toBeVisible();
  298 | 
  299 |     await page
  300 |       .getByLabel("Search variant product", { exact: true })
  301 |       .fill("E2E Relationship Variant");
  302 |     await page
  303 |       .getByLabel("Variant product", { exact: true })
  304 |       .selectOption(variantProductId);
  305 |     await page
  306 |       .getByLabel("Variant release", { exact: true })
  307 |       .selectOption(variantReleaseId);
  308 |     await page
  309 |       .getByRole("button", { name: "Record variant relationship", exact: true })
  310 |       .click();
  311 |     await expect(
  312 |       page.getByText("Variant relationship recorded."),
  313 |     ).toBeVisible();
  314 | 
  315 |     await page
  316 |       .getByLabel("Search component product", { exact: true })
  317 |       .fill("E2E Relationship Component");
  318 |     await page
  319 |       .getByLabel("Component product", { exact: true })
```