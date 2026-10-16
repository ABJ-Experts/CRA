# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: m3-gap-closure.spec.ts >> M3 streaming format validation preserves originals, pages history and exports scoped normalized graphs
- Location: e2e/m3-gap-closure.spec.ts:174:1

# Error details

```
Error: {"statusCode":409,"message":"SBOM intake request could not be completed.","code":"content_hash_mismatch"}

expect(received).toBe(expected) // Object.is equality

Expected: 202
Received: 409
```

# Test source

```ts
  68  |     {
  69  |       name: `cyclonedx-${version}.json`,
  70  |       mediaType: "application/vnd.cyclonedx+json",
  71  |       version,
  72  |       serialization: "json",
  73  |     },
  74  |     {
  75  |       name: `cyclonedx-${version}.xml`,
  76  |       mediaType: "application/vnd.cyclonedx+xml",
  77  |       version,
  78  |       serialization: "xml",
  79  |     },
  80  |   ]),
  81  |   ...["2.2", "2.3"].flatMap((version) => [
  82  |     {
  83  |       name: `spdx-${version}.json`,
  84  |       mediaType: "application/spdx+json",
  85  |       version,
  86  |       serialization: "json",
  87  |     },
  88  |     {
  89  |       name: `spdx-${version}.spdx`,
  90  |       mediaType: "text/plain",
  91  |       version,
  92  |       serialization: "tag_value",
  93  |     },
  94  |   ]),
  95  |   {
  96  |     name: "spdx-3.0.json",
  97  |     mediaType: "application/spdx+json",
  98  |     version: "3.0",
  99  |     serialization: "json",
  100 |   },
  101 | ] as const;
  102 | 
  103 | async function capture(page: Page, info: TestInfo, label: string) {
  104 |   await page.screenshot({
  105 |     path: info.outputPath(`${label}-desktop.png`),
  106 |     fullPage: true,
  107 |   });
  108 |   await page.setViewportSize({ width: 390, height: 844 });
  109 |   await page.screenshot({
  110 |     path: info.outputPath(`${label}-mobile.png`),
  111 |     fullPage: true,
  112 |   });
  113 |   await page.setViewportSize({ width: 1440, height: 1100 });
  114 | }
  115 | 
  116 | async function worker() {
  117 |   const result = await execute(
  118 |     "pnpm",
  119 |     [
  120 |       "--filter",
  121 |       "api",
  122 |       "exec",
  123 |       "ts-node",
  124 |       "-r",
  125 |       "tsconfig-paths/register",
  126 |       "src/sbom-ingest-worker.ts",
  127 |       "--once",
  128 |     ],
  129 |     { cwd: root, env: process.env, timeout: 120_000, maxBuffer: 1024 * 1024 },
  130 |   );
  131 |   expect(result.stderr).not.toContain("SBOM ingest worker cycle failed safely");
  132 | }
  133 | 
  134 | async function upload(
  135 |   request: APIRequestContext,
  136 |   productId: string,
  137 |   releaseId: string,
  138 |   fileName: string,
  139 |   mediaType: string,
  140 |   bytes: Buffer,
  141 |   supersedesSourceId?: string,
  142 | ) {
  143 |   const command = {
  144 |     productId,
  145 |     releaseId,
  146 |     fileName,
  147 |     mediaType,
  148 |     byteSize: bytes.length,
  149 |     sha256: digest(bytes),
  150 |     idempotencyKey: randomUUID(),
  151 |     ...(supersedesSourceId ? { supersedesSourceId } : {}),
  152 |   };
  153 |   const endpoint = `${api}/products/${productId}/releases/${releaseId}/sbom-uploads`;
  154 |   const initialized = await request.post(endpoint, { data: command });
  155 |   expect(initialized.status(), await initialized.text()).toBe(201);
  156 |   const result = sbomUploadInitializationResponseSchema.parse(
  157 |     await initialized.json(),
  158 |   );
  159 |   const put = await request.put(result.upload.uploadUrl, {
  160 |     data: bytes,
  161 |     headers: { "content-type": mediaType },
  162 |   });
  163 |   expect(put.ok(), await put.text()).toBe(true);
  164 |   const completion = await request.post(
  165 |     `${api}/sbom-uploads/${result.source.id}/complete`,
  166 |     { data: { idempotencyKey: command.idempotencyKey } },
  167 |   );
> 168 |   expect(completion.status(), await completion.text()).toBe(202);
      |                                                        ^ Error: {"statusCode":409,"message":"SBOM intake request could not be completed.","code":"content_hash_mismatch"}
  169 |   const job = sbomUploadCompletionResponseSchema.parse(await completion.json());
  170 |   expect(job.job.sourceId).toBe(result.source.id);
  171 |   return result.source;
  172 | }
  173 | 
  174 | test("M3 streaming format validation preserves originals, pages history and exports scoped normalized graphs", async ({
  175 |   browser,
  176 | }, info) => {
  177 |   test.setTimeout(360_000);
  178 |   const fixtures = new RunScopedAccounts(info);
  179 |   const context = await browser.newContext({
  180 |     baseURL: origin,
  181 |     viewport: { width: 1440, height: 1100 },
  182 |   });
  183 |   const foreign = await browser.newContext({ baseURL: origin });
  184 |   let journeyFailure: unknown;
  185 |   let cleanupFailure: unknown;
  186 |   try {
  187 |     const account = await fixtures.createVerified(context, "m3-owner");
  188 |     const page = await context.newPage();
  189 |     const orgId = await onboardSbomOrganization(
  190 |       page,
  191 |       account.email,
  192 |       `E2E M3 ${randomUUID()}`,
  193 |     );
  194 |     fixtures.trackM3Organization(orgId);
  195 |     const legal = await context.request.get(
  196 |       `${api}/organizations/current/legal-entities`,
  197 |     );
  198 |     expect(legal.status()).toBe(200);
  199 |     const legalEntityId = (
  200 |       (await legal.json()) as { legalEntities: { id: string }[] }
  201 |     ).legalEntities[0]!.id;
  202 |     const productResult = await context.request.post(`${api}/products`, {
  203 |       data: {
  204 |         name: "M3 private format matrix",
  205 |         internalCode: `M3-${randomUUID()}`,
  206 |         productType: "standalone_software",
  207 |         responsibleOwnerId: account.publicUserId,
  208 |         legalEntityId,
  209 |         idempotencyKey: randomUUID(),
  210 |       },
  211 |     });
  212 |     expect(productResult.status()).toBe(201);
  213 |     const productId = (
  214 |       (await productResult.json()) as { product: { id: string } }
  215 |     ).product.id;
  216 |     const releaseResult = await context.request.post(
  217 |       `${api}/products/${productId}/releases`,
  218 |       {
  219 |         data: {
  220 |           label: "M3 matrix",
  221 |           version: "1.0.0",
  222 |           idempotencyKey: randomUUID(),
  223 |         },
  224 |       },
  225 |     );
  226 |     expect(releaseResult.status()).toBe(201);
  227 |     const releaseId = (
  228 |       (await releaseResult.json()) as { release: { id: string } }
  229 |     ).release.id;
  230 |     const sources: string[] = [];
  231 |     for (const format of formats) {
  232 |       const fixtureBytes = await readFile(
  233 |         resolve(root, "apps/api/src/sboms/validation/fixtures", format.name),
  234 |       );
  235 |       const bytes =
  236 |         format.name === "spdx-3.0.json"
  237 |           ? Buffer.from(
  238 |               JSON.stringify({
  239 |                 ...JSON.parse(fixtureBytes.toString()),
  240 |                 "@graph": [
  241 |                   ...JSON.parse(fixtureBytes.toString())["@graph"],
  242 |                   {
  243 |                     type: "software_Package",
  244 |                     spdxId: "https://cra.test/spdx/dependency",
  245 |                     creationInfo: "_:creationinfo",
  246 |                     name: "dependency",
  247 |                     software_packageVersion: "2.0.0",
  248 |                     software_downloadLocation: "NOASSERTION",
  249 |                   },
  250 |                   {
  251 |                     type: "Relationship",
  252 |                     spdxId: "https://cra.test/spdx/relationship",
  253 |                     creationInfo: "_:creationinfo",
  254 |                     from: "https://cra.test/spdx/package",
  255 |                     to: ["https://cra.test/spdx/dependency"],
  256 |                     relationshipType: "dependsOn",
  257 |                   },
  258 |                 ],
  259 |               }),
  260 |             )
  261 |           : fixtureBytes;
  262 |       const source = await upload(
  263 |         context.request,
  264 |         productId,
  265 |         releaseId,
  266 |         format.name,
  267 |         format.mediaType,
  268 |         bytes,
```