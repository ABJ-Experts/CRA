# M10-01 verification and release record

## Requirement-to-test traceability

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| Reviewed immutable source and provenance | `20260924055237_m10_01_cra_annex_i_oj_2024.sql`, `framework_pack_versions`, `framework_requirements` | Official Journal Annex I, pp. 68–69; source review and content digest recorded below. |
| Unique stable keys and bounded hierarchy | `frameworkPackImportSchema`, `m10_import_framework_pack` | Contract validation tests; SQL import tests for duplicates, missing parent, cycles, depth, size, schema version, and rollback. |
| Atomic and idempotent import | `m10_import_framework_pack` plus `audit_logs` | SQL repeat/conflict/interrupted-import tests. |
| Explicit organization selection and history preservation | `organization_framework_selections`, `m10_select_framework_version` | SQL revision, replay, tenant denial, immutable-row, and audit tests; browser selection/disable/conflict journey. |
| Authorized bounded catalog/tree | `FrameworksController`, `FrameworkUseCases`, `SupabaseFrameworkRepository` | API controller/adapter tests, route coverage gates, live browser tree read. |
| Validated browser boundary and accessible workspace | `@repo/contracts/frameworks`, `frameworks.api.ts`, `frameworks-workspace.tsx` | Gateway/component tests, navigation parity, Playwright screenshots and keyboard journey. |

## Source review and redistribution

- Authentic source: Regulation (EU) 2024/2847, English Official Journal, 20 November 2024, CELEX `32024R2847`, ELI `http://data.europa.eu/eli/reg/2024/2847/oj`, Annex I pp. 68–69.
- Stored nodes: 25: two Part roots, two Part I numbered paragraphs, thirteen Part I point (2) letters, and eight Part II numbered paragraphs. Heading and display identifiers are presentation metadata; `requirementKey` is the stable identity.
- Legal text is attributed to the European Union and normalized only for PDF line wraps. The [EU legal notice](https://european-union.europa.eu/legal-notice_en) and [EUR-Lex reuse terms](https://eur-lex.europa.eu/content/help/data-reuse/reuse-contents-eurlex-details.html?locale=en) govern reuse; no document-specific exception was found during this review.
- Official Publications Office PDF SHA-256: `e3ecaabddf6e321fa04097d15dfcccc7309d0fe5896240ab7625a27d74ab1b0a`.
- Independent comparison result: local pdftotext review found 25 stored nodes matching Annex I Parts I and II after PDF line-wrap normalization; no node mismatch recorded in this run.
- Local imported SHA-256 digest: `1a28baf6e6837b214223f9db5dbd88b20a5eecb87134877c406eab871fabd619`. It covers the canonical JSON import payload, including provenance metadata. Array order is normalized by tree position before hashing.
- The EU/EUR-Lex reuse notices permit reuse subject to attribution and copyright conditions. This is a source and reuse review for the shipped content, not an independent legal opinion. The official PDF has no document-specific exception visible on the reviewed Annex pages.

## Reproducible validation

Run from the repository root. The SQL suite requires the already-running local `cra` Supabase stack; do not run `db:reset` on an existing stack.

```sh
pnpm --filter @repo/contracts test
pnpm --filter api exec jest frameworks --runInBand
pnpm --filter web exec vitest run app/_features/frameworks
pnpm --filter infrastructure run test
pnpm --filter infrastructure run db:lint
pnpm --filter infrastructure exec supabase db diff
pnpm verify
pnpm --filter web exec playwright test e2e/m10-framework-packs.spec.ts --config playwright.config.ts
E2E_CROSS_BROWSER=true pnpm --filter web exec playwright test e2e/m10-framework-packs.spec.ts --config playwright.config.ts
node scripts/framework-read-load.mjs
```

The cross-browser run uses the same local owner credentials, API origin, and web origin as the Chromium journey. The read-load probe requires `E2E_OWNER_EMAIL` and `E2E_OWNER_PASSWORD` in its environment and is restricted to a local API. Its default 12 bursts of eight reads over about two minutes stay below the local per-IP rate limit; it validates the shared Zod response schemas and checks the p95/p99 thresholds.

Results: contracts **490/490**, web **722/722**, focused framework API **30/30**, focused M10 SQL **44/44**, architecture **58/58**, type checks, and the owner Playwright journey **3/3** across Chromium, Firefox, and WebKit passed locally. Focused coverage exceeds 80% for contracts (99.06% statements, 95.45% branches, 100% functions), API (96.94%, 84.53%, 94.73%), and web (97.69%, 88.55%, 96.77%). The M10 SQL test runs inside a rollback transaction. Database lint exits successfully with 24 existing warnings and no M10 warning; database diff contains only three earlier function definitions and no M10 object. The local Supabase performance advisor has no M10 finding after indexing the selection actor foreign key. Its three informational `rls_enabled_no_policy` findings on the new tables reflect intentional service-only access. The Playwright journey created and removed only its uniquely named organization; a post-run database count found zero remaining `M10 Framework E2E` organizations. Browser MCP inspection confirmed source attribution, the ordered 25-node tree, read-only historical preview, and keyboard-reachable tree items.

A local API smoke measurement of 40 sequential successful requests per endpoint returned catalog p95 **59.8 ms** / p99 **68.4 ms** and 25-node tree p95 **57.7 ms** / p99 **58.0 ms**. A second read-only probe ran 48 mixed catalog/tree requests with 16 concurrent workers against the initial 25-node pack: catalog 24/24 HTTP 200, p95 **177.2 ms** / p99 **178.7 ms**; tree 24/24 HTTP 200, p95 **188.3 ms** / p99 **191.4 ms**. A longer contract-validated probe ran 12 bursts of eight requests at 10-second intervals (96 reads over 110.1 seconds, 48 per endpoint): catalog 48/48 HTTP 200, p95 **199.2 ms** / p99 **207.5 ms**; tree 48/48 HTTP 200, p95 **200.0 ms** / p99 **212.5 ms**. Each response passed the shared Zod schema and the local p95<400 ms / p99<1000 ms thresholds. This bounded local workload does not establish performance under a production multi-tenant workload. A desktop Lighthouse snapshot of `/frameworks` scored **97 accessibility**; its two failed audits were existing shell navigation contrast and logo accessible-name mismatches. This does not establish WCAG 2.2 AA conformance.

Root `pnpm verify` now passes lint, type checks, architecture checks, and the infrastructure SQL suite; it stops at one pre-existing tenant-export registry architecture test in the API suite. API tests pass **2,173/2,174**; the failing gate correctly identifies **57 M6–M9 tenant tables** without reviewed export coverage. The missing tables include durable facts and sensitive invitation, grant, idempotency, and worker state. Registering them without explicit projections, snapshot locks, redaction, and restore semantics would expose data or make incomplete exports appear complete, so the gate remains intact. The earlier reporting fixture and API lint failures were fixed, as were stale SQL fixtures and missing timestamp triggers. The SQL runner now treats pgTAP `not ok` and plan mismatches as failures; the strict full infrastructure suite passes with zero hidden assertion failures. One existing local release with an empty legal-entity snapshot was repaired using its matching product snapshot in a guarded migration. A database check found exactly one matching audit row and no M10 browser fixture organizations. A reachable M6 direct-submit path now maps its `approval_required` outcome to the existing HTTP 409 invalid-state response, with regression tests. `pnpm build` passes separately. The repository Playwright runner and browser MCP supplied browser evidence because a dedicated Playwright MCP was not exposed.

Screenshots: [selected tree](evidence/m10-01/m10-framework-tree.png) and [disabled historical preview](evidence/m10-01/m10-framework-disabled.png). The browser test uses `M10_SCREENSHOT_DIR` to retain them outside Playwright's temporary output directory.

## Deployment and rollback

1. Confirm the target project is CRA before deployment. Apply the additive migrations in timestamp order: `20260924054840` schema/import/RPC, `20260924055237` reviewed pack, `20260924060628` reserved no-op marker, `20260924060912` canonical import and permission repair, `20260924061258` guarded pre-release provenance correction, `20260924061503` tenant export registration, `20260924062312` selection actor foreign-key index, and `20260924063524` selection timestamp trigger. Separate additive migrations `20260924063654` and `20260924064859` restore the repository timestamp invariant on 17 older M6–M9 tables and make the declaration timestamp trigger run before its immutability guard. `20260924065430` performs a guarded, audited backfill of one locally malformed release snapshot from its matching versioned product snapshot; it is a no-op where that exact release does not exist or is already valid. The no-op marker preserves local append-only migration history. On a fresh deployment, the provenance correction sees the final digest and does nothing.
2. Generate types with `pnpm --filter infrastructure run db:types` (updates infrastructure and API copies), then deploy the API and web against the new contracts.
3. Existing M7/M8 records require no backfill. No default organization selection is inserted. Organization administrators explicitly choose and enable a version.
4. Reverting application binaries is compatible with the additive schema. The one-time pre-release provenance correction is guarded by exact old/new digests and audits the change; it is not a general mutation path. If a future pack has a content defect, publish a corrected new version through a forward migration and adjust affected organization selections with their normal audited revision flow. Do not mutate or delete released versions or historical references.

## Residual limits

- M10-01 exposes requirement identity and text; it does not determine applicability, assess controls, generate legal advice, or convert M7/M8 mappings.
- Pagination and source text were tested against the initial 25-node edition; future larger packs must meet the same importer bounds and performance gate.
- Performance under production multi-tenant load, full WCAG 2.2 AA evaluation, Edge, and previous browser releases remain unverified. The read API is bounded and indexed, but its production p95/p99 targets remain unverified. Root verification remains blocked solely by the export-registry architecture gap described above.
