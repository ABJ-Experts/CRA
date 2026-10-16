# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: m3-gap-closure.spec.ts >> M3 streaming format validation preserves originals, pages history and exports scoped normalized graphs
- Location: e2e/m3-gap-closure.spec.ts:177:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "87cc13c2-f2c9-4c7c-b458-55df8195207e"
Received: "868a41a8-fdf0-477e-9231-888704326723"
```

# Test source

```ts
  73  |       serialization: "json",
  74  |     },
  75  |     {
  76  |       name: `cyclonedx-${version}.xml`,
  77  |       mediaType: "application/vnd.cyclonedx+xml",
  78  |       version,
  79  |       serialization: "xml",
  80  |     },
  81  |   ]),
  82  |   ...["2.2", "2.3"].flatMap((version) => [
  83  |     {
  84  |       name: `spdx-${version}.json`,
  85  |       mediaType: "application/spdx+json",
  86  |       version,
  87  |       serialization: "json",
  88  |     },
  89  |     {
  90  |       name: `spdx-${version}.spdx`,
  91  |       mediaType: "text/plain",
  92  |       version,
  93  |       serialization: "tag_value",
  94  |     },
  95  |   ]),
  96  |   {
  97  |     name: "spdx-3.0.json",
  98  |     mediaType: "application/spdx+json",
  99  |     version: "3.0",
  100 |     serialization: "json",
  101 |   },
  102 | ] as const;
  103 | 
  104 | async function capture(page: Page, info: TestInfo, label: string) {
  105 |   await page.screenshot({
  106 |     path: info.outputPath(`${label}-desktop.png`),
  107 |     fullPage: true,
  108 |   });
  109 |   await page.setViewportSize({ width: 390, height: 844 });
  110 |   await page.screenshot({
  111 |     path: info.outputPath(`${label}-mobile.png`),
  112 |     fullPage: true,
  113 |   });
  114 |   await page.setViewportSize({ width: 1440, height: 1100 });
  115 | }
  116 | 
  117 | async function worker() {
  118 |   const result = await execute(
  119 |     "pnpm",
  120 |     [
  121 |       "--filter",
  122 |       "api",
  123 |       "exec",
  124 |       "ts-node",
  125 |       "-r",
  126 |       "tsconfig-paths/register",
  127 |       "src/sbom-ingest-worker.ts",
  128 |       "--once",
  129 |     ],
  130 |     { cwd: root, env: process.env, timeout: 120_000, maxBuffer: 1024 * 1024 },
  131 |   );
  132 |   expect(result.stderr).not.toContain("SBOM ingest worker cycle failed safely");
  133 | }
  134 | 
  135 | async function upload(
  136 |   request: APIRequestContext,
  137 |   productId: string,
  138 |   releaseId: string,
  139 |   fileName: string,
  140 |   mediaType: string,
  141 |   bytes: Buffer,
  142 |   supersedesSourceId?: string,
  143 | ) {
  144 |   const command = {
  145 |     productId,
  146 |     releaseId,
  147 |     fileName,
  148 |     mediaType,
  149 |     byteSize: bytes.length,
  150 |     sha256: digest(bytes),
  151 |     idempotencyKey: randomUUID(),
  152 |     ...(supersedesSourceId ? { supersedesSourceId } : {}),
  153 |   };
  154 |   const endpoint = `${api}/products/${productId}/releases/${releaseId}/sbom-uploads`;
  155 |   const initialized = await request.post(endpoint, { data: command });
  156 |   expect(initialized.status(), await initialized.text()).toBe(201);
  157 |   const result = sbomUploadInitializationResponseSchema.parse(
  158 |     await initialized.json(),
  159 |   );
  160 |   const put = await request.put(result.upload.uploadUrl, {
  161 |     data: bytes,
  162 |     headers: { "content-type": mediaType },
  163 |   });
  164 |   expect(put.ok(), await put.text()).toBe(true);
  165 |   const completion = await request.post(
  166 |     `${api}/sbom-uploads/${result.source.id}/complete`,
  167 |     { data: { idempotencyKey: command.idempotencyKey } },
  168 |   );
  169 |   expect(completion.status(), `${fileName}: ${await completion.text()}`).toBe(
  170 |     202,
  171 |   );
  172 |   const job = sbomUploadCompletionResponseSchema.parse(await completion.json());
> 173 |   expect(job.job.sourceId).toBe(result.source.id);
      |                            ^ Error: expect(received).toBe(expected) // Object.is equality
  174 |   return result.source;
  175 | }
  176 | 
  177 | test("M3 streaming format validation preserves originals, pages history and exports scoped normalized graphs", async ({
  178 |   browser,
  179 | }, info) => {
  180 |   test.setTimeout(360_000);
  181 |   const fixtures = new RunScopedAccounts(info);
  182 |   const context = await browser.newContext({
  183 |     baseURL: origin,
  184 |     viewport: { width: 1440, height: 1100 },
  185 |   });
  186 |   const foreign = await browser.newContext({ baseURL: origin });
  187 |   let journeyFailure: unknown;
  188 |   let cleanupFailure: unknown;
  189 |   try {
  190 |     const account = await fixtures.createVerified(context, "m3-owner");
  191 |     const page = await context.newPage();
  192 |     const orgId = await onboardSbomOrganization(
  193 |       page,
  194 |       account.email,
  195 |       `E2E M3 ${randomUUID()}`,
  196 |     );
  197 |     fixtures.trackM3Organization(orgId);
  198 |     const legal = await context.request.get(
  199 |       `${api}/organizations/current/legal-entities`,
  200 |     );
  201 |     expect(legal.status()).toBe(200);
  202 |     const legalEntityId = (
  203 |       (await legal.json()) as { legalEntities: { id: string }[] }
  204 |     ).legalEntities[0]!.id;
  205 |     const productResult = await context.request.post(`${api}/products`, {
  206 |       data: {
  207 |         name: "M3 private format matrix",
  208 |         internalCode: `M3-${randomUUID()}`,
  209 |         productType: "standalone_software",
  210 |         responsibleOwnerId: account.publicUserId,
  211 |         legalEntityId,
  212 |         idempotencyKey: randomUUID(),
  213 |       },
  214 |     });
  215 |     expect(productResult.status()).toBe(201);
  216 |     const productId = (
  217 |       (await productResult.json()) as { product: { id: string } }
  218 |     ).product.id;
  219 |     const releaseResult = await context.request.post(
  220 |       `${api}/products/${productId}/releases`,
  221 |       {
  222 |         data: {
  223 |           label: "M3 matrix",
  224 |           version: "1.0.0",
  225 |           idempotencyKey: randomUUID(),
  226 |         },
  227 |       },
  228 |     );
  229 |     expect(releaseResult.status()).toBe(201);
  230 |     const releaseId = (
  231 |       (await releaseResult.json()) as { release: { id: string } }
  232 |     ).release.id;
  233 |     const sources: string[] = [];
  234 |     for (const format of formats) {
  235 |       const fixtureBytes = await readFile(
  236 |         resolve(root, "apps/api/src/sboms/validation/fixtures", format.name),
  237 |       );
  238 |       const bytes =
  239 |         format.name === "spdx-3.0.json"
  240 |           ? Buffer.from(
  241 |               JSON.stringify({
  242 |                 ...JSON.parse(fixtureBytes.toString()),
  243 |                 "@graph": [
  244 |                   ...JSON.parse(fixtureBytes.toString())["@graph"].map(
  245 |                     (element: Record<string, unknown>) =>
  246 |                       element.type === "software_Package"
  247 |                         ? {
  248 |                             ...element,
  249 |                             verifiedUsing: ["https://cra.test/spdx/hash"],
  250 |                           }
  251 |                         : element,
  252 |                   ),
  253 |                   {
  254 |                     type: "software_Package",
  255 |                     spdxId: "https://cra.test/spdx/dependency",
  256 |                     creationInfo: "_:creationinfo",
  257 |                     name: "dependency",
  258 |                     software_packageVersion: "2.0.0",
  259 |                     software_downloadLocation: "NOASSERTION",
  260 |                   },
  261 |                   {
  262 |                     type: "Relationship",
  263 |                     spdxId: "https://cra.test/spdx/relationship",
  264 |                     creationInfo: "_:creationinfo",
  265 |                     from: "https://cra.test/spdx/package",
  266 |                     to: ["https://cra.test/spdx/dependency"],
  267 |                     relationshipType: "dependsOn",
  268 |                   },
  269 |                   {
  270 |                     type: "Hash",
  271 |                     spdxId: "https://cra.test/spdx/hash",
  272 |                     algorithm: "sha256",
  273 |                     hashValue: "a".repeat(64),
```