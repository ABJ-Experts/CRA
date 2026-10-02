# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: m3-gap-closure.spec.ts >> M3 streaming format validation preserves originals, pages history and exports scoped normalized graphs
- Location: e2e/m3-gap-closure.spec.ts:173:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 200
Received: 503
```

# Test source

```ts
  96  |     mediaType: "application/spdx+json",
  97  |     version: "3.0",
  98  |     serialization: "json",
  99  |   },
  100 | ] as const;
  101 | 
  102 | async function capture(page: Page, info: TestInfo, label: string) {
  103 |   await page.screenshot({
  104 |     path: info.outputPath(`${label}-desktop.png`),
  105 |     fullPage: true,
  106 |   });
  107 |   await page.setViewportSize({ width: 390, height: 844 });
  108 |   await page.screenshot({
  109 |     path: info.outputPath(`${label}-mobile.png`),
  110 |     fullPage: true,
  111 |   });
  112 |   await page.setViewportSize({ width: 1440, height: 1100 });
  113 | }
  114 | 
  115 | async function worker() {
  116 |   const result = await execute(
  117 |     "pnpm",
  118 |     [
  119 |       "--filter",
  120 |       "api",
  121 |       "exec",
  122 |       "ts-node",
  123 |       "-r",
  124 |       "tsconfig-paths/register",
  125 |       "src/sbom-ingest-worker.ts",
  126 |       "--once",
  127 |     ],
  128 |     { cwd: root, env: process.env, timeout: 120_000, maxBuffer: 1024 * 1024 },
  129 |   );
  130 |   expect(result.stderr).not.toContain("SBOM ingest worker cycle failed safely");
  131 | }
  132 | 
  133 | async function upload(
  134 |   request: APIRequestContext,
  135 |   productId: string,
  136 |   releaseId: string,
  137 |   fileName: string,
  138 |   mediaType: string,
  139 |   bytes: Buffer,
  140 |   supersedesSourceId?: string,
  141 | ) {
  142 |   const command = {
  143 |     productId,
  144 |     releaseId,
  145 |     fileName,
  146 |     mediaType,
  147 |     byteSize: bytes.length,
  148 |     sha256: digest(bytes),
  149 |     idempotencyKey: randomUUID(),
  150 |     ...(supersedesSourceId ? { supersedesSourceId } : {}),
  151 |   };
  152 |   const endpoint = `${api}/products/${productId}/releases/${releaseId}/sbom-uploads`;
  153 |   const initialized = await request.post(endpoint, { data: command });
  154 |   expect(initialized.status(), await initialized.text()).toBe(201);
  155 |   const result = sbomUploadInitializationResponseSchema.parse(
  156 |     await initialized.json(),
  157 |   );
  158 |   const put = await request.put(result.upload.uploadUrl, {
  159 |     data: bytes,
  160 |     headers: { "content-type": mediaType },
  161 |   });
  162 |   expect(put.ok(), await put.text()).toBe(true);
  163 |   const completion = await request.post(
  164 |     `${api}/sbom-uploads/${result.source.id}/complete`,
  165 |     { data: { idempotencyKey: command.idempotencyKey } },
  166 |   );
  167 |   expect(completion.status(), await completion.text()).toBe(202);
  168 |   const job = sbomUploadCompletionResponseSchema.parse(await completion.json());
  169 |   expect(job.job.sourceId).toBe(result.source.id);
  170 |   return result.source;
  171 | }
  172 | 
  173 | test("M3 streaming format validation preserves originals, pages history and exports scoped normalized graphs", async ({
  174 |   browser,
  175 | }, info) => {
  176 |   test.setTimeout(360_000);
  177 |   const fixtures = new RunScopedAccounts(info);
  178 |   const context = await browser.newContext({
  179 |     baseURL: origin,
  180 |     viewport: { width: 1440, height: 1100 },
  181 |   });
  182 |   const foreign = await browser.newContext({ baseURL: origin });
  183 |   let journeyFailure: unknown;
  184 |   try {
  185 |     const account = await fixtures.createVerified(context, "m3-owner");
  186 |     const page = await context.newPage();
  187 |     const orgId = await onboardSbomOrganization(
  188 |       page,
  189 |       account.email,
  190 |       `E2E M3 ${randomUUID()}`,
  191 |     );
  192 |     fixtures.trackM3Organization(orgId);
  193 |     const legal = await context.request.get(
  194 |       `${api}/organizations/current/legal-entities`,
  195 |     );
> 196 |     expect(legal.status()).toBe(200);
      |                            ^ Error: expect(received).toBe(expected) // Object.is equality
  197 |     const legalEntityId = (
  198 |       (await legal.json()) as { legalEntities: { id: string }[] }
  199 |     ).legalEntities[0]!.id;
  200 |     const productResult = await context.request.post(`${api}/products`, {
  201 |       data: {
  202 |         name: "M3 private format matrix",
  203 |         internalCode: `M3-${randomUUID()}`,
  204 |         productType: "standalone_software",
  205 |         responsibleOwnerId: account.publicUserId,
  206 |         legalEntityId,
  207 |         idempotencyKey: randomUUID(),
  208 |       },
  209 |     });
  210 |     expect(productResult.status()).toBe(201);
  211 |     const productId = (
  212 |       (await productResult.json()) as { product: { id: string } }
  213 |     ).product.id;
  214 |     const releaseResult = await context.request.post(
  215 |       `${api}/products/${productId}/releases`,
  216 |       {
  217 |         data: {
  218 |           label: "M3 matrix",
  219 |           version: "1.0.0",
  220 |           idempotencyKey: randomUUID(),
  221 |         },
  222 |       },
  223 |     );
  224 |     expect(releaseResult.status()).toBe(201);
  225 |     const releaseId = (
  226 |       (await releaseResult.json()) as { release: { id: string } }
  227 |     ).release.id;
  228 |     const sources: string[] = [];
  229 |     for (const format of formats) {
  230 |       const bytes = await readFile(
  231 |         resolve(root, "apps/api/src/sboms/validation/fixtures", format.name),
  232 |       );
  233 |       const source = await upload(
  234 |         context.request,
  235 |         productId,
  236 |         releaseId,
  237 |         format.name,
  238 |         format.mediaType,
  239 |         bytes,
  240 |       );
  241 |       sources.push(source.id);
  242 |       await worker();
  243 |       const validation = await context.request.get(
  244 |         `${api}/sbom-sources/${source.id}/validation-report`,
  245 |       );
  246 |       expect(validation.status()).toBe(200);
  247 |       const report = sbomValidationReportResponseSchema.parse(
  248 |         await validation.json(),
  249 |       );
  250 |       expect(report.report.status, format.name).toBe("valid");
  251 |       expect(report.report.detected).toMatchObject({
  252 |         specificationVersion: format.version,
  253 |         serialization: format.serialization,
  254 |       });
  255 |       const downloadResponse = await context.request.get(
  256 |         `${api}/sbom-sources/${source.id}/download`,
  257 |       );
  258 |       const download = sbomOriginalDownloadResponseSchema.parse(
  259 |         await downloadResponse.json(),
  260 |       );
  261 |       const original = await context.request.get(download.download.downloadUrl);
  262 |       expect(digest(await original.body())).toBe(source.sha256);
  263 |       expect(await original.body()).toEqual(bytes);
  264 |     }
  265 |     const invalidBytes = Buffer.from(
  266 |       '{"bomFormat":"CycloneDX","specVersion":"1.6","version":1,"components":[{"type":"library","bom-ref":"invalid"}]}',
  267 |     );
  268 |     const invalid = await upload(
  269 |       context.request,
  270 |       productId,
  271 |       releaseId,
  272 |       "invalid.cdx.json",
  273 |       "application/vnd.cyclonedx+json",
  274 |       invalidBytes,
  275 |     );
  276 |     await worker();
  277 |     const invalidResponse = await context.request.get(
  278 |       `${api}/sbom-sources/${invalid.id}/validation-report`,
  279 |     );
  280 |     const invalidReport = sbomValidationReportResponseSchema.parse(
  281 |       await invalidResponse.json(),
  282 |     );
  283 |     expect(invalidReport.report.status).toBe("invalid");
  284 |     expect(invalidReport.report.errorCount).toBeGreaterThan(0);
  285 |     const correctedBytes = await readFile(
  286 |       resolve(
  287 |         root,
  288 |         "apps/api/src/sboms/validation/fixtures/cyclonedx-1.6.json",
  289 |       ),
  290 |     );
  291 |     const corrected = await upload(
  292 |       context.request,
  293 |       productId,
  294 |       releaseId,
  295 |       "corrected.cdx.json",
  296 |       "application/vnd.cyclonedx+json",
```