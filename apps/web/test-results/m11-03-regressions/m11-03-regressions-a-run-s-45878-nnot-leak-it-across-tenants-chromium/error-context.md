# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: m11-03-regressions.spec.ts >> a run-scoped owner completes connector sync, observes retry safety, and cannot leak it across tenants
- Location: e2e/connector-sync.spec.ts:137:1

# Error details

```
TimeoutError: locator.fill: Timeout 15000ms exceeded.
Call log:
  - waiting for getByLabel('Set secret', { exact: true })

```

# Test source

```ts
  103 |     .getByRole("combobox", { name: "Field name", exact: true })
  104 |     .selectOption(policy.fieldName);
  105 |   await page
  106 |     .getByRole("combobox", { name: "Authority policy", exact: true })
  107 |     .selectOption("external_authoritative");
  108 | 
  109 |   const preview = page.waitForResponse(
  110 |     (response) =>
  111 |       new URL(response.url()).pathname.endsWith("/mapping/preview") &&
  112 |       response.request().method() === "POST",
  113 |     { timeout: 15_000 },
  114 |   );
  115 |   await page
  116 |     .getByRole("button", { name: "Preview impact", exact: true })
  117 |     .click();
  118 |   expect((await preview).status()).toBe(200);
  119 |   await expect(
  120 |     page.getByRole("button", { name: "Save", exact: true }),
  121 |   ).toBeEnabled();
  122 | 
  123 |   const save = page.waitForResponse(
  124 |     (response) =>
  125 |       /\/api\/v1\/connectors\/[^/]+\/mapping$/.test(
  126 |         new URL(response.url()).pathname,
  127 |       ) && response.request().method() === "POST",
  128 |     { timeout: 15_000 },
  129 |   );
  130 |   await page.getByRole("button", { name: "Save", exact: true }).click();
  131 |   expect((await save).status()).toBe(200);
  132 |   await expect(
  133 |     page.getByText("Field authority policy saved.", { exact: true }),
  134 |   ).toBeVisible();
  135 | }
  136 | 
  137 | test("a run-scoped owner completes connector sync, observes retry safety, and cannot leak it across tenants", async ({
  138 |   browser,
  139 | }, testInfo) => {
  140 |   // A single live-flow test deliberately exercises two account lifecycles,
  141 |   // durable worker retries, and the reference provider's rate-limit recovery.
  142 |   // The local auth rate limiter may defer either account creation by a minute,
  143 |   // so keep the complete resilient flow within one bounded five-minute budget.
  144 |   test.setTimeout(300_000);
  145 |   const fixtures = new RunScopedAccounts(testInfo);
  146 |   const context = await browser.newContext({ baseURL: WEB_ORIGIN });
  147 |   let otherContext: BrowserContext | null = null;
  148 |   let mobileContext: BrowserContext | null = null;
  149 | 
  150 |   let journeyError: unknown;
  151 |   let cleanupFailure: unknown;
  152 |   let stage = "sign up";
  153 |   try {
  154 |     const account = await fixtures.createVerified(context, "connector-owner");
  155 |     const page = await context.newPage();
  156 |     page.setDefaultTimeout(15_000);
  157 |     stage = "create organization";
  158 |     const organizationId = await createOrganization(
  159 |       context,
  160 |       account,
  161 |       `E2E Connector Sync ${testInfo.parallelIndex}-${Date.now()}`,
  162 |     );
  163 |     fixtures.trackM2V2Organization(organizationId);
  164 |     const proxiedSession = await context.request.get(
  165 |       `${WEB_ORIGIN}/api/v1/auth/session`,
  166 |       { timeout: 10_000 },
  167 |     );
  168 |     expect(proxiedSession.status()).toBe(200);
  169 |     expect(
  170 |       (
  171 |         (await proxiedSession.json()) as {
  172 |           organizations: readonly Readonly<{ id: string }>[];
  173 |         }
  174 |       ).organizations.some(
  175 |         (organization) => organization.id === organizationId,
  176 |       ),
  177 |     ).toBe(true);
  178 |     const legalEntityId = await currentLegalEntityId(context);
  179 |     const displayName = `E2E Reference Connector ${testInfo.parallelIndex}`;
  180 | 
  181 |     const connectorCreated = await context.request.post(
  182 |       `${LIVE_API_ORIGIN}/api/v1/connectors`,
  183 |       {
  184 |         timeout: 10_000,
  185 |         data: {
  186 |           connectorType: "reference_conformance",
  187 |           displayName,
  188 |           adapterVersion: "1.0.0",
  189 |           mappingVersion: "reference-conformance-v1",
  190 |           connectionConfig: JSON.parse(configFor(account, legalEntityId)),
  191 |           commitPolicy: "manual",
  192 |           idempotencyKey: randomUUID(),
  193 |         },
  194 |       },
  195 |     );
  196 |     expect(connectorCreated.status()).toBe(201);
  197 |     const connectorId = (
  198 |       (await connectorCreated.json()) as { connector: { id: string } }
  199 |     ).connector.id;
  200 |     await page.goto(`/connectors/${connectorId}`, { timeout: 10_000 });
  201 | 
  202 |     stage = "set secret";
> 203 |     await page.getByLabel("Set secret", { exact: true }).fill(CONNECTOR_SECRET);
      |                                                          ^ TimeoutError: locator.fill: Timeout 15000ms exceeded.
  204 |     const secretSaved = page.waitForResponse(
  205 |       (response) =>
  206 |         new URL(response.url()).pathname.endsWith("/secret") &&
  207 |         response.request().method() === "POST",
  208 |       { timeout: 15_000 },
  209 |     );
  210 |     await page.getByRole("button", { name: "Set secret", exact: true }).click();
  211 |     expect((await secretSaved).status()).toBe(200);
  212 |     await expect(
  213 |       page.getByText("Secret saved.", { exact: true }),
  214 |     ).toBeVisible();
  215 | 
  216 |     stage = "test connection";
  217 |     const tested = page.waitForResponse(
  218 |       (response) =>
  219 |         new URL(response.url()).pathname.endsWith("/test") &&
  220 |         response.request().method() === "POST",
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
```