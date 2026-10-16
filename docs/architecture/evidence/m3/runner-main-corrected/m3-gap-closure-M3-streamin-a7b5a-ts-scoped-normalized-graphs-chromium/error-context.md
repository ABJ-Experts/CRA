# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: m3-gap-closure.spec.ts >> M3 streaming format validation preserves originals, pages history and exports scoped normalized graphs
- Location: e2e/m3-gap-closure.spec.ts:173:1

# Error details

```
Error: Scoped M2 V2 cleanup assertion failed for sbom_dependency_edges / a3ef361c-220b-408c-a4e8-340bd47a1e03: {"code":"PGRST205","details":null,"hint":null,"message":"Could not find the table 'public.sbom_dependency_edges' in the schema cache"}
```

# Test source

```ts
  388 |   async cleanup(): Promise<void> {
  389 |     for (const id of this.organizationIds) {
  390 |       if (this.m3OrganizationIds.has(id)) {
  391 |         await removeStoragePrefix("sbom-originals", `${id}/`);
  392 |       }
  393 |       const importIds = await runScopedImportIds(id);
  394 |       // Keep this explicit rather than relying on the organization cascade:
  395 |       // relationship/finding rows deliberately use restrictive composite FKs
  396 |       // while they are authoritative. Every request is narrowed to the unique
  397 |       // run-scoped organization, so seeded and concurrent E2E organizations
  398 |       // are never selected.
  399 |       await removeImportStorageObjects(PRODUCT_IMPORT_BUCKET, id, importIds);
  400 |       if (this.m2V2OrganizationIds.has(id)) {
  401 |         await removeStoragePrefix(SECURITY_UPDATE_ARTIFACT_BUCKET, `${id}/`);
  402 |         // These pre-date M2 V2 and are mutable service-role cleanup ledgers,
  403 |         // rather than compliance history. Clear only this generated tenant's
  404 |         // rows before its exact organization cascade; the M2 records retain
  405 |         // their no-DELETE grant and are removed by the cascade itself.
  406 |         for (const importId of importIds) {
  407 |           for (const [table, scope] of [
  408 |             [
  409 |               "product_import_rows",
  410 |               `import_id=eq.${encodeURIComponent(importId)}`,
  411 |             ],
  412 |             [
  413 |               "product_import_jobs",
  414 |               `id=eq.${encodeURIComponent(importId)}&organization_id=eq.${encodeURIComponent(id)}`,
  415 |             ],
  416 |           ] as const) {
  417 |             const deletion = await supabase(`/rest/v1/${table}?${scope}`, {
  418 |               method: "DELETE",
  419 |             });
  420 |             if (!deletion.ok) {
  421 |               throw new Error(
  422 |                 `Could not clean scoped ${table} fixture ${importId}: ${JSON.stringify(await responseBody(deletion))}`,
  423 |               );
  424 |             }
  425 |           }
  426 |         }
  427 |         const assignments = await supabase(
  428 |           `/rest/v1/product_legal_entity_assignments?organization_id=eq.${encodeURIComponent(id)}`,
  429 |           { method: "DELETE" },
  430 |         );
  431 |         if (!assignments.ok) {
  432 |           throw new Error(
  433 |             `Could not clean scoped legal-entity assignments for ${id}: ${JSON.stringify(await responseBody(assignments))}`,
  434 |           );
  435 |         }
  436 |         const legalProfiles = await supabase(
  437 |           `/rest/v1/organization_legal_profiles?organization_id=eq.${encodeURIComponent(id)}`,
  438 |           { method: "DELETE" },
  439 |         );
  440 |         if (!legalProfiles.ok) {
  441 |           throw new Error(
  442 |             `Could not clean scoped legal profile for ${id}: ${JSON.stringify(await responseBody(legalProfiles))}`,
  443 |           );
  444 |         }
  445 |         // M2 V2 rows deliberately expose no direct DELETE grant: their
  446 |         // immutable history can only disappear as part of the established
  447 |         // exact tenant cascade. The generated organization is the narrowest
  448 |         // possible cleanup boundary and is verified below.
  449 |         const organizationDeletion = await supabase(
  450 |           `/rest/v1/organizations?id=eq.${encodeURIComponent(id)}`,
  451 |           { method: "DELETE" },
  452 |         );
  453 |         if (!organizationDeletion.ok) {
  454 |           throw new Error(
  455 |             `Could not clean M2 V2 organization fixture ${id}: ${JSON.stringify(await responseBody(organizationDeletion))}`,
  456 |           );
  457 |         }
  458 |         for (const table of [
  459 |           "product_substantial_modification_releases",
  460 |           "product_substantial_modification_assessments",
  461 |           "product_security_update_artifacts",
  462 |           "products",
  463 |           "organizations",
  464 |           ...(this.m3OrganizationIds.has(id)
  465 |             ? [
  466 |                 "sbom_sources",
  467 |                 "sbom_raw_objects",
  468 |                 "sbom_documents",
  469 |                 "sbom_components",
  470 |                 "sbom_dependency_edges",
  471 |                 "sbom_quality_reports",
  472 |               ]
  473 |             : []),
  474 |         ]) {
  475 |           const scope =
  476 |             table === "organizations"
  477 |               ? `id=eq.${encodeURIComponent(id)}`
  478 |               : `organization_id=eq.${encodeURIComponent(id)}`;
  479 |           const selectColumn =
  480 |             table === "product_substantial_modification_releases"
  481 |               ? "assessment_id"
  482 |               : "id";
  483 |           const assertion = await supabase(
  484 |             `/rest/v1/${table}?select=${selectColumn}&${scope}`,
  485 |           );
  486 |           const rows = await responseBody(assertion);
  487 |           if (!assertion.ok || !Array.isArray(rows) || rows.length !== 0) {
> 488 |             throw new Error(
      |                   ^ Error: Scoped M2 V2 cleanup assertion failed for sbom_dependency_edges / a3ef361c-220b-408c-a4e8-340bd47a1e03: {"code":"PGRST205","details":null,"hint":null,"message":"Could not find the table 'public.sbom_dependency_edges' in the schema cache"}
  489 |               `Scoped M2 V2 cleanup assertion failed for ${table} / ${id}: ${JSON.stringify(rows)}`,
  490 |             );
  491 |           }
  492 |         }
  493 |         continue;
  494 |       }
  495 |       const controlLookup = await supabase(
  496 |         `/rest/v1/framework_controls?select=id&organization_id=eq.${encodeURIComponent(id)}&limit=1`,
  497 |       );
  498 |       const controlRows = await responseBody(controlLookup);
  499 |       if (!controlLookup.ok || !Array.isArray(controlRows)) {
  500 |         throw new Error(
  501 |           `Could not resolve scoped control fixtures for ${id}: ${JSON.stringify(controlRows)}`,
  502 |         );
  503 |       }
  504 |       const hasFrameworkControls = controlRows.length > 0;
  505 |       for (const importId of importIds) {
  506 |         for (const [table, scope] of [
  507 |           [
  508 |             "product_import_rows",
  509 |             `import_id=eq.${encodeURIComponent(importId)}`,
  510 |           ],
  511 |           [
  512 |             "product_import_jobs",
  513 |             `id=eq.${encodeURIComponent(importId)}&organization_id=eq.${encodeURIComponent(id)}`,
  514 |           ],
  515 |         ] as const) {
  516 |           const deletion = await supabase(`/rest/v1/${table}?${scope}`, {
  517 |             method: "DELETE",
  518 |           });
  519 |           if (!deletion.ok) {
  520 |             throw new Error(
  521 |               `Could not clean scoped ${table} fixture ${importId}: ${JSON.stringify(await responseBody(deletion))}`,
  522 |             );
  523 |           }
  524 |           const assertion = await supabase(
  525 |             `/rest/v1/${table}?select=id&${scope}`,
  526 |           );
  527 |           const rows = await responseBody(assertion);
  528 |           if (!assertion.ok || !Array.isArray(rows) || rows.length !== 0) {
  529 |             throw new Error(
  530 |               `Scoped cleanup assertion failed for ${table} / ${importId}: ${JSON.stringify(rows)}`,
  531 |             );
  532 |           }
  533 |         }
  534 |       }
  535 |       for (const table of [
  536 |         // This profile retains creation/update actors and does not cascade
  537 |         // through organization deletion. Remove only the exact test tenant's
  538 |         // row before its generated owner is deleted below.
  539 |         "organization_legal_profiles",
  540 |         "finding_product_impact_overrides",
  541 |         "finding_impact_associations",
  542 |         "finding_propagation_jobs",
  543 |         "finding_propagation_sources",
  544 |         "product_relationships",
  545 |         "software_baseline_release_memberships",
  546 |         "product_lifecycle_dependency_facts",
  547 |         "software_baselines",
  548 |         "product_release_create_idempotencies",
  549 |         "product_create_idempotencies",
  550 |         "product_legal_entity_assignments",
  551 |         "product_releases",
  552 |         // M10 mapping-product rows are immutable while this organization
  553 |         // exists. Its exact organization cascade removes both records.
  554 |         ...(hasFrameworkControls ? [] : ["products"]),
  555 |       ]) {
  556 |         const dependentResponse = await supabase(
  557 |           `/rest/v1/${table}?organization_id=eq.${encodeURIComponent(id)}`,
  558 |           { method: "DELETE" },
  559 |         );
  560 |         if (!dependentResponse.ok) {
  561 |           throw new Error(
  562 |             `Could not clean ${table} fixture rows for ${id}: ${JSON.stringify(await responseBody(dependentResponse))}`,
  563 |           );
  564 |         }
  565 |       }
  566 |       // The durable outbox is intentionally not writable through the public
  567 |       // service-role REST surface. Its release and organization foreign keys
  568 |       // cascade during the scoped product/organization cleanup above, which
  569 |       // preserves the same dependency order without broadening its grants.
  570 |       const response = await supabase(
  571 |         `/rest/v1/organizations?id=eq.${encodeURIComponent(id)}`,
  572 |         { method: "DELETE" },
  573 |       );
  574 |       if (!response.ok) {
  575 |         throw new Error(
  576 |           `Could not clean organization fixture ${id}: ${JSON.stringify(await responseBody(response))}`,
  577 |         );
  578 |       }
  579 |       for (const table of [
  580 |         "finding_propagation_sources",
  581 |         "finding_propagation_jobs",
  582 |         "finding_impact_associations",
  583 |         "finding_product_impact_overrides",
  584 |         "software_baselines",
  585 |         "product_relationships",
  586 |         "products",
  587 |         "framework_controls",
  588 |         "framework_control_revisions",
```