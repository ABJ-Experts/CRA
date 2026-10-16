# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: m3-gap-closure.spec.ts >> M3 streaming format validation preserves originals, pages history and exports scoped normalized graphs
- Location: e2e/m3-gap-closure.spec.ts:175:1

# Error details

```
Error: expect(received).toMatchObject(expected)

- Expected  - 1
+ Received  + 1

  Object {
    "serialization": "json",
-   "specificationVersion": "2.2",
+   "specificationVersion": "SPDX-2.2",
  }
```

# Test source

```ts
  182 |     viewport: { width: 1440, height: 1100 },
  183 |   });
  184 |   const foreign = await browser.newContext({ baseURL: origin });
  185 |   let journeyFailure: unknown;
  186 |   let cleanupFailure: unknown;
  187 |   try {
  188 |     const account = await fixtures.createVerified(context, "m3-owner");
  189 |     const page = await context.newPage();
  190 |     const orgId = await onboardSbomOrganization(
  191 |       page,
  192 |       account.email,
  193 |       `E2E M3 ${randomUUID()}`,
  194 |     );
  195 |     fixtures.trackM3Organization(orgId);
  196 |     const legal = await context.request.get(
  197 |       `${api}/organizations/current/legal-entities`,
  198 |     );
  199 |     expect(legal.status()).toBe(200);
  200 |     const legalEntityId = (
  201 |       (await legal.json()) as { legalEntities: { id: string }[] }
  202 |     ).legalEntities[0]!.id;
  203 |     const productResult = await context.request.post(`${api}/products`, {
  204 |       data: {
  205 |         name: "M3 private format matrix",
  206 |         internalCode: `M3-${randomUUID()}`,
  207 |         productType: "standalone_software",
  208 |         responsibleOwnerId: account.publicUserId,
  209 |         legalEntityId,
  210 |         idempotencyKey: randomUUID(),
  211 |       },
  212 |     });
  213 |     expect(productResult.status()).toBe(201);
  214 |     const productId = (
  215 |       (await productResult.json()) as { product: { id: string } }
  216 |     ).product.id;
  217 |     const releaseResult = await context.request.post(
  218 |       `${api}/products/${productId}/releases`,
  219 |       {
  220 |         data: {
  221 |           label: "M3 matrix",
  222 |           version: "1.0.0",
  223 |           idempotencyKey: randomUUID(),
  224 |         },
  225 |       },
  226 |     );
  227 |     expect(releaseResult.status()).toBe(201);
  228 |     const releaseId = (
  229 |       (await releaseResult.json()) as { release: { id: string } }
  230 |     ).release.id;
  231 |     const sources: string[] = [];
  232 |     for (const format of formats) {
  233 |       const fixtureBytes = await readFile(
  234 |         resolve(root, "apps/api/src/sboms/validation/fixtures", format.name),
  235 |       );
  236 |       const bytes =
  237 |         format.name === "spdx-3.0.json"
  238 |           ? Buffer.from(
  239 |               JSON.stringify({
  240 |                 ...JSON.parse(fixtureBytes.toString()),
  241 |                 "@graph": [
  242 |                   ...JSON.parse(fixtureBytes.toString())["@graph"].map((element: Record<string, unknown>) => element.type === "software_Package" ? { ...element, verifiedUsing: ["https://cra.test/spdx/hash"] } : element),
  243 |                   {
  244 |                     type: "software_Package",
  245 |                     spdxId: "https://cra.test/spdx/dependency",
  246 |                     creationInfo: "_:creationinfo",
  247 |                     name: "dependency",
  248 |                     software_packageVersion: "2.0.0",
  249 |                     software_downloadLocation: "NOASSERTION",
  250 |                   },
  251 |                   {
  252 |                     type: "Relationship",
  253 |                     spdxId: "https://cra.test/spdx/relationship",
  254 |                     creationInfo: "_:creationinfo",
  255 |                     from: "https://cra.test/spdx/package",
  256 |                     to: ["https://cra.test/spdx/dependency"],
  257 |                     relationshipType: "dependsOn",
  258 |                   },
  259 |                   { type: "Hash", spdxId: "https://cra.test/spdx/hash", algorithm: "sha256", hashValue: "a".repeat(64) },
  260 |                 ],
  261 |               }),
  262 |             )
  263 |           : fixtureBytes;
  264 |       const source = await upload(
  265 |         context.request,
  266 |         productId,
  267 |         releaseId,
  268 |         format.name,
  269 |         format.mediaType,
  270 |         bytes,
  271 |       );
  272 |       sources.push(source.id);
  273 |       await worker();
  274 |       const validation = await context.request.get(
  275 |         `${api}/sbom-sources/${source.id}/validation-report`,
  276 |       );
  277 |       expect(validation.status()).toBe(200);
  278 |       const report = sbomValidationReportResponseSchema.parse(
  279 |         await validation.json(),
  280 |       );
  281 |       expect(report.report.status, format.name).toBe("valid");
> 282 |       expect(report.report.detected).toMatchObject({
      |                                      ^ Error: expect(received).toMatchObject(expected)
  283 |         specificationVersion: format.version,
  284 |         serialization: format.serialization,
  285 |       });
  286 |       console.info(`M3 validated ${format.name}`);
  287 |       const downloadResponse = await context.request.get(
  288 |         `${api}/sbom-sources/${source.id}/download`,
  289 |       );
  290 |       const download = sbomOriginalDownloadResponseSchema.parse(
  291 |         await downloadResponse.json(),
  292 |       );
  293 |       const original = await context.request.get(download.download.downloadUrl);
  294 |       expect(digest(await original.body())).toBe(source.sha256);
  295 |       expect(await original.body()).toEqual(bytes);
  296 |       if (format.name === "spdx-3.0.json") {
  297 |         const graphResponse = await context.request.get(
  298 |           `${api}/products/${productId}/releases/${releaseId}/sbom-documents?limit=100`,
  299 |         );
  300 |         const graphs = sbomDocumentListResponseSchema.parse(
  301 |           await graphResponse.json(),
  302 |         );
  303 |         const graph = graphs.documents.find(
  304 |           (item) => item.sourceId === source.id,
  305 |         );
  306 |         expect(graph?.dependencyCount).toBe(1);
  307 |         const treeResponse = await context.request.get(
  308 |           `${api}/sbom-documents/${graph!.id}/dependency-tree`,
  309 |         );
  310 |         const tree = sbomDependencyTreeResponseSchema.parse(
  311 |           await treeResponse.json(),
  312 |         );
  313 |         expect(tree.items.some((item) => item.childCount === 1)).toBe(true);
  314 |         const components = sbomComponentSearchResponseSchema.parse(await (await context.request.get(`${api}/sbom-documents/${graph!.id}/components`)).json());
  315 |         expect(components.components.some((item) => item.hashes.some((hash) => hash.algorithm === "SHA256" && hash.value === "a".repeat(64)))).toBe(true);
  316 |       }
  317 |     }
  318 |     const invalidBytes = Buffer.from(
  319 |       '{"bomFormat":"CycloneDX","specVersion":"1.6","version":1,"components":[{"type":"library","bom-ref":"invalid"}]}',
  320 |     );
  321 |     const invalid = await upload(
  322 |       context.request,
  323 |       productId,
  324 |       releaseId,
  325 |       "invalid.cdx.json",
  326 |       "application/vnd.cyclonedx+json",
  327 |       invalidBytes,
  328 |     );
  329 |     await worker();
  330 |     const invalidResponse = await context.request.get(
  331 |       `${api}/sbom-sources/${invalid.id}/validation-report`,
  332 |     );
  333 |     const invalidReport = sbomValidationReportResponseSchema.parse(
  334 |       await invalidResponse.json(),
  335 |     );
  336 |     expect(invalidReport.report.status).toBe("invalid");
  337 |     expect(invalidReport.report.errorCount).toBeGreaterThan(0);
  338 |     const correctedBytes = await readFile(
  339 |       resolve(
  340 |         root,
  341 |         "apps/api/src/sboms/validation/fixtures/cyclonedx-1.6.json",
  342 |       ),
  343 |     );
  344 |     const corrected = await upload(
  345 |       context.request,
  346 |       productId,
  347 |       releaseId,
  348 |       "corrected.cdx.json",
  349 |       "application/vnd.cyclonedx+json",
  350 |       correctedBytes,
  351 |       invalid.id,
  352 |     );
  353 |     await worker();
  354 |     sources.push(invalid.id, corrected.id);
  355 |     const historyEndpoint = `${api}/products/${productId}/releases/${releaseId}/sbom-sources?limit=10`;
  356 |     const firstPage = sbomSourceHistoryResponseSchema.parse(
  357 |       await (await context.request.get(historyEndpoint)).json(),
  358 |     );
  359 |     expect(firstPage.sources).toHaveLength(10);
  360 |     expect(firstPage.nextCursor).not.toBeNull();
  361 |     const secondPage = sbomSourceHistoryResponseSchema.parse(
  362 |       await (
  363 |         await context.request.get(
  364 |           `${historyEndpoint}&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
  365 |         )
  366 |       ).json(),
  367 |     );
  368 |     expect(secondPage.sources).toHaveLength(3);
  369 |     expect(secondPage.nextCursor).toBeNull();
  370 |     expect(
  371 |       new Set(
  372 |         [...firstPage.sources, ...secondPage.sources].map(
  373 |           ({ source }) => source.id,
  374 |         ),
  375 |       ),
  376 |     ).toEqual(new Set(sources));
  377 |     await page.goto(`/products/${productId}`);
  378 |     await expect(
  379 |       page.getByRole("heading", { name: "SBOM evidence", exact: true }),
  380 |     ).toBeVisible();
  381 |     await capture(page, info, "m3-validated-history");
  382 |     await page
```