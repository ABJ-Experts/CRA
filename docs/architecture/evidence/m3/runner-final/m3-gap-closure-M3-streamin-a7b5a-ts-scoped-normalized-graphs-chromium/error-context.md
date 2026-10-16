# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: m3-gap-closure.spec.ts >> M3 streaming format validation preserves originals, pages history and exports scoped normalized graphs
- Location: e2e/m3-gap-closure.spec.ts:187:1

# Error details

```
Error: expect(received).toHaveLength(expected)

Expected length: 3
Received length: 2
Received array:  [{"source": {"byteSize": 352, "completedAt": "2026-09-28T09:27:23.576454+00:00", "createdAt": "2026-09-28T09:27:23.42261+00:00", "fileName": "cyclonedx-1.4.xml", "id": "dec0eb9a-832d-44cf-a15f-8bda38e69864", "mediaType": "application/vnd.cyclonedx+xml", "organizationId": "f840e679-0025-4f09-a78d-ec7f5af5419a", "productId": "ce0d80ec-df02-4574-8d59-2c3021da8d9d", "releaseId": "d6e9c609-3de7-4d4f-9d4b-484769087399", "sha256": "005946b074a36f4a763abf033aa7e3abc8d223a8f37f55d8c5919a37eb7d7785", "source": "manual_upload", "status": "verified"}, "validation": {"completedAt": "2026-09-28T09:27:24.558+00:00", "errorCount": 0, "omittedDiagnosticCount": 0, "status": "valid", "warningCount": 0}}, {"source": {"byteSize": 284, "completedAt": "2026-09-28T09:27:21.599641+00:00", "createdAt": "2026-09-28T09:27:21.357198+00:00", "fileName": "cyclonedx-1.4.json", "id": "3533cc12-9869-4877-a991-622ce23d5dd6", "mediaType": "application/vnd.cyclonedx+json", "organizationId": "f840e679-0025-4f09-a78d-ec7f5af5419a", "productId": "ce0d80ec-df02-4574-8d59-2c3021da8d9d", "releaseId": "d6e9c609-3de7-4d4f-9d4b-484769087399", "sha256": "d5ba28b9bce5e23020af0b6e444dbb69883ca776a9fa4dd2de0c571913d6a2af", "source": "manual_upload", "status": "verified"}, "validation": {"completedAt": "2026-09-28T09:27:23.024+00:00", "errorCount": 0, "omittedDiagnosticCount": 0, "status": "valid", "warningCount": 0}}]
```

# Test source

```ts
  308 |       expect(report.report.status, format.name).toBe("valid");
  309 |       expect(report.report.detected).toMatchObject({
  310 |         specificationVersion: format.version,
  311 |         serialization: format.serialization,
  312 |       });
  313 |       console.info(`M3 validated ${format.name}`);
  314 |       const downloadResponse = await context.request.get(
  315 |         `${api}/sbom-sources/${source.id}/download`,
  316 |       );
  317 |       const download = sbomOriginalDownloadResponseSchema.parse(
  318 |         await downloadResponse.json(),
  319 |       );
  320 |       const original = await context.request.get(download.download.downloadUrl);
  321 |       expect(digest(await original.body())).toBe(source.sha256);
  322 |       expect(await original.body()).toEqual(bytes);
  323 |       if (format.name === "spdx-3.0.json") {
  324 |         const graphResponse = await context.request.get(
  325 |           `${api}/products/${productId}/releases/${releaseId}/sbom-documents?limit=100`,
  326 |         );
  327 |         const graphs = sbomDocumentListResponseSchema.parse(
  328 |           await graphResponse.json(),
  329 |         );
  330 |         const graph = graphs.documents.find(
  331 |           (item) => item.sourceId === source.id,
  332 |         );
  333 |         expect(graph?.dependencyCount).toBe(1);
  334 |         const treeResponse = await context.request.get(
  335 |           `${api}/sbom-documents/${graph!.id}/dependency-tree`,
  336 |         );
  337 |         const tree = sbomDependencyTreeResponseSchema.parse(
  338 |           await treeResponse.json(),
  339 |         );
  340 |         expect(tree.items.some((item) => item.childCount === 1)).toBe(true);
  341 |         const components = sbomComponentSearchResponseSchema.parse(
  342 |           await (
  343 |             await context.request.get(
  344 |               `${api}/sbom-documents/${graph!.id}/components`,
  345 |             )
  346 |           ).json(),
  347 |         );
  348 |         expect(
  349 |           components.components.some((item) =>
  350 |             item.hashes.some(
  351 |               (hash) =>
  352 |                 hash.algorithm === "SHA256" && hash.value === "a".repeat(64),
  353 |             ),
  354 |           ),
  355 |         ).toBe(true);
  356 |       }
  357 |     }
  358 |     const invalidBytes = Buffer.from(
  359 |       '{"bomFormat":"CycloneDX","specVersion":"1.6","version":1,"components":[{"type":"library","bom-ref":"invalid"}]}',
  360 |     );
  361 |     const invalid = await upload(
  362 |       context.request,
  363 |       productId,
  364 |       releaseId,
  365 |       "invalid.cdx.json",
  366 |       "application/vnd.cyclonedx+json",
  367 |       invalidBytes,
  368 |     );
  369 |     await worker();
  370 |     const invalidResponse = await context.request.get(
  371 |       `${api}/sbom-sources/${invalid.id}/validation-report`,
  372 |     );
  373 |     const invalidReport = sbomValidationReportResponseSchema.parse(
  374 |       await invalidResponse.json(),
  375 |     );
  376 |     expect(invalidReport.report.status).toBe("invalid");
  377 |     expect(invalidReport.report.errorCount).toBeGreaterThan(0);
  378 |     const correctedBytes = await readFile(
  379 |       resolve(
  380 |         root,
  381 |         "apps/api/src/sboms/validation/fixtures/cyclonedx-1.6.json",
  382 |       ),
  383 |     );
  384 |     const corrected = await upload(
  385 |       context.request,
  386 |       productId,
  387 |       releaseId,
  388 |       "corrected.cdx.json",
  389 |       "application/vnd.cyclonedx+json",
  390 |       correctedBytes,
  391 |       invalid.id,
  392 |     );
  393 |     await worker();
  394 |     sources.push(invalid.id, corrected.id);
  395 |     const historyEndpoint = `${api}/products/${productId}/releases/${releaseId}/sbom-sources?limit=10`;
  396 |     const firstPage = sbomSourceHistoryResponseSchema.parse(
  397 |       await (await context.request.get(historyEndpoint)).json(),
  398 |     );
  399 |     expect(firstPage.sources).toHaveLength(10);
  400 |     expect(firstPage.nextCursor).not.toBeNull();
  401 |     const secondPage = sbomSourceHistoryResponseSchema.parse(
  402 |       await (
  403 |         await context.request.get(
  404 |           `${historyEndpoint}&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
  405 |         )
  406 |       ).json(),
  407 |     );
> 408 |     expect(secondPage.sources).toHaveLength(3);
      |                                ^ Error: expect(received).toHaveLength(expected)
  409 |     expect(secondPage.nextCursor).toBeNull();
  410 |     expect(
  411 |       new Set(
  412 |         [...firstPage.sources, ...secondPage.sources].map(
  413 |           ({ source }) => source.id,
  414 |         ),
  415 |       ),
  416 |     ).toEqual(new Set(sources));
  417 |     if (process.env.E2E_M3_READ_LOAD === "true") {
  418 |       const timings: number[] = [];
  419 |       const statuses: number[] = [];
  420 |       for (let sample = 0; sample < 30; sample += 1) {
  421 |         const started = performance.now();
  422 |         const response = await context.request.get(historyEndpoint);
  423 |         statuses.push(response.status());
  424 |         if (response.status() !== 200) break;
  425 |         sbomSourceHistoryResponseSchema.parse(await response.json());
  426 |         timings.push(performance.now() - started);
  427 |       }
  428 |       const sorted = [...timings].sort((left, right) => left - right);
  429 |       await info.attach("m3-bounded-read-timings", {
  430 |         body: Buffer.from(JSON.stringify({ scope: "Local authenticated Nest API, one private release, limit 10; not production load", samples: timings.length, statuses, p95Milliseconds: sorted[Math.ceil(sorted.length * .95) - 1] ?? null, p99Milliseconds: sorted[Math.ceil(sorted.length * .99) - 1] ?? null, timingsMilliseconds: timings }, null, 2)),
  431 |         contentType: "application/json",
  432 |       });
  433 |       // Respect the existing shared minute window before the browser's many
  434 |       // parallel workspace reads; no rate limit or production config changes.
  435 |       await new Promise((resolve) => setTimeout(resolve, 60_100));
  436 |     }
  437 |     await page.goto(`/products/${productId}`);
  438 |     await expect(
  439 |       page.getByRole("heading", { name: "SBOM evidence", exact: true }),
  440 |     ).toBeVisible();
  441 |     await capture(page, info, "m3-validated-history");
  442 |     await page
  443 |       .getByRole("button", { name: "Load older sources", exact: true })
  444 |       .click();
  445 |     await expect(
  446 |       page.getByText(formats[0]!.name, { exact: true }).first(),
  447 |     ).toBeVisible();
  448 |     await expect(
  449 |       page.getByRole("button", { name: "Load older sources", exact: true }),
  450 |     ).toHaveCount(0);
  451 |     await capture(page, info, "m3-history-older-page");
  452 |     const docsResponse = await context.request.get(
  453 |       `${api}/products/${productId}/releases/${releaseId}/sbom-documents?limit=100`,
  454 |     );
  455 |     expect(docsResponse.status()).toBe(200);
  456 |     const documents = sbomDocumentListResponseSchema.parse(
  457 |       await docsResponse.json(),
  458 |     );
  459 |     // Identical corrected bytes reuse the existing immutable graph; the source
  460 |     // alias is exact evidence attribution, not a second normalized document.
  461 |     const document = documents.documents.find(
  462 |       (item) => item.sourceId === sources[4],
  463 |     );
  464 |     expect(document).toBeDefined();
  465 |     for (const format of ["cyclonedx", "spdx"] as const) {
  466 |       const response = await context.request.get(
  467 |         `${api}/sbom-documents/${document!.id}/export?sourceId=${corrected.id}&format=${format}`,
  468 |       );
  469 |       expect(response.status()).toBe(200);
  470 |       const exported = sbomExportResponseSchema.parse(
  471 |         await response.json(),
  472 |       ).export;
  473 |       expect(digest(Buffer.from(exported.content))).toBe(exported.sha256);
  474 |       expect(exported.vex.status).toBe("not_requested");
  475 |       const roundTrip = await upload(
  476 |         context.request,
  477 |         productId,
  478 |         releaseId,
  479 |         exported.fileName,
  480 |         exported.mediaType,
  481 |         Buffer.from(exported.content),
  482 |       );
  483 |       await worker();
  484 |       const validation = sbomValidationReportResponseSchema.parse(
  485 |         await (
  486 |           await context.request.get(
  487 |             `${api}/sbom-sources/${roundTrip.id}/validation-report`,
  488 |           )
  489 |         ).json(),
  490 |       );
  491 |       expect(validation.report.status).toBe("valid");
  492 |     }
  493 |     expect(
  494 |       (
  495 |         await context.request.get(
  496 |           `${api}/sbom-documents/${document!.id}/export?sourceId=${corrected.id}&format=spdx&includeVex=true`,
  497 |         )
  498 |       ).status(),
  499 |     ).toBe(400);
  500 |     expect(
  501 |       (
  502 |         await context.request.get(
  503 |           `${api}/sbom-documents/${document!.id}/export?sourceId=${corrected.id}&format=cyclonedx&includeVex=true`,
  504 |         )
  505 |       ).status(),
  506 |     ).toBe(409);
  507 |     await page.goto(
  508 |       `/products/${productId}/sboms/${document!.id}?sourceId=${corrected.id}`,
```