# M9-06 verification record

## Scope and existing M3 behavior

M3 already owns supplier requests/invitations/sessions, private SBOM upload, size and format checks, ingestion jobs, normalization, explicit reviewer decisions, supersession, and immutable source/component provenance. M9-06 adds only the explicit checklist-to-request link, a single M9 portal grant bridge, safe portal status, exact requested-component gate for linked submissions, and a duplicate-source provenance repair. Direct M3 routes and their wire responses are unchanged.

Changed wire contracts: [supplier-evidence schemas](../../packages/contracts/src/supplier-evidence/schemas/supplier-evidence.schema.ts) and [parsed wire types](../../packages/contracts/src/supplier-evidence/types/supplier-evidence.type.ts). The [thin portal controller](../../apps/api/src/supplier-evidence/supplier-evidence-sbom.controller.ts) and [web transport](../../apps/web/app/_features/supplier-evidence/supplier-evidence.api.ts) consume those schemas.

The design and alternatives are recorded in [m9-06-supplier-sbom-portal.md](./m9-06-supplier-sbom-portal.md). The implementation plan is [2026-09-23-m9-06-supplier-sbom-portal.md](../superpowers/plans/2026-09-23-m9-06-supplier-sbom-portal.md).

## Requirement-to-test traceability

| Requirement | Implementation boundary | Evidence |
| --- | --- | --- |
| Assigned component and release come from M3, not supplier input | Additive bridge migration; scoped eligible-request lookup; M9 checklist contract | `m9-06-supplier-sbom-bridge.test.sql`, `m9-06-supplier-sbom-flow.test.sql`, contract and API policy tests |
| One M9 link, revocation and revision binding | Linked M3 invitation/session RPCs; M9 portal upload use case | Bridge and flow SQL tests; `supplier-evidence-sbom.use-cases.spec.ts`; browser revoke journey |
| Existing parser, storage, and explicit M3 review | Delegation to `SupplierSbomService`; no new parser | API controller/use-case tests; browser invalid/corrected upload and owner review |
| No automatic baseline or findings disclosure | Safe portal projection; M3 reviewer gate; exact component check | Contract strictness tests; SQL flow and alias-composite tests; browser privacy assertions |
| Duplicate bytes retain supplier-specific provenance | Source alias completion and composite input from explicitly accepted alias | `m9-06-supplier-sbom-alias-composite.test.sql` (two suppliers, equal hash, distinct source/submission IDs, accepted composite component provenance) |
| Concurrent, replayed, stale, or revoked operations fail closed | Transactional row locks, optimistic revision and idempotency keys | Bridge/flow SQL tests; adapter/use-case/controller tests; browser revoked-link journey |
| Accessible and recoverable portal | Code-split SBOM panel and existing M9 transport | Portal component/API tests; desktop/mobile Playwright journey and screenshots |

All test paths above are under `apps/infrastructure/tests`, `apps/api/src/supplier-evidence`, `packages/contracts/src/supplier-evidence`, `apps/web/app/_features/supplier-evidence`, or `apps/web/e2e` respectively.

## Local verification

The CRA Supabase MCP connection was not available: the connected projects were unrelated ERP projects. Database inspection, migration application, and verification used only the running **local CRA Supabase stack**. No production database was accessed, reset, or modified. SQL tests use rollback transactions or local test fixtures; the alias-composite test leaves no rows behind.

- Three focused M9-06 SQL tests passed against local Postgres, including 21 bridge assertions, linked lifecycle flow, and two-supplier alias/composite provenance. Database lint exited successfully with existing warnings. CLI-generated types were updated in both infrastructure and API copies.
- Focused contracts, API, web component, and architecture tests passed. New API controller/use-case/adapter focused coverage was 96.77% statements, 92% branches, 97.46% lines, and 94.73% functions.
- `pnpm check-types`, `pnpm build`, and `pnpm test:architecture` passed. The full web unit suite passed after the final revoked-link change (`123` files, `699` tests). The focused API supplier-evidence tests passed (`4` suites, `26` tests), as did API typecheck. The controller regression tests passed after a RED/GREEN cycle for asynchronously rejected portal and internal list calls.
- `pnpm verify` stops on 99 lint errors in unchanged reporting/technical-file modules. The full API suite has two unrelated reporting/tenant-export failures. The full infrastructure suite stops on an unrelated existing M2 tenant-cascade fixture foreign-key failure. Those areas were not changed for M9-06.
- The live browser journey passed against CRA web `localhost:3100`, API `localhost:3334`, and local Supabase (`1 passed`, Chromium, 15.3 seconds). It covered owner issue, supplier privacy and keyboard upload, invalid file, corrected upload, processing, explicit M3 review, mobile layout, and revocation. Post-revocation GET returned 404 and the UI explained that a new invitation is required. The repository Playwright runner was used because no Playwright MCP tool was exposed in this session. Its four desktop/validation/mobile/revoked screenshots are under `apps/web/test-results/m9-06-local/`.
- The M9-06 journey also passed in local Firefox and WebKit. The browser test now asserts keyboard Tab order through the upload inputs, clear size/baseline guidance, and a live status region in addition to the existing responsive and privacy checks. Clean Chromium and WebKit screenshots are isolated under `apps/web/test-results/m9-06-local/`; a later repeat Firefox run hit the expected five-per-15-minute session throttle and overwrote its earlier passing screenshots. The passing Firefox result remains recorded, but its screenshots are not cited as clean evidence.
- A bounded local owner-authenticated read probe on `GET /api/v1/supplier-evidence-requests?limit=25` completed 40/40 requests at concurrency 4: p50 52.7 ms, p95 108.5 ms, p99 114.9 ms. A separate 200-request burst produced expected 429 rate limiting after the allowed requests, so its rejected responses were not counted as read latency. These local numbers are a smoke check, not a realistic deployment load claim.

The successful browser run was cross-checked in local Postgres: the first supplier source remained `validation_failed` with no normalized document; the corrected source's job and document completed, and the M3 reviewer explicitly accepted it. Audit rows recorded M9 create/issue/delivery/revocation and M3 reserve/queue/accept. Component provenance linked the accepted source to the matching normalized package reference. The later invitation revocation also revoked the linked M3 grant.

The final browser rerun's local M9 request `9bd73c18-2059-4836-8307-d217b47173c0` links its SBOM checklist item to one M3 request. Its two M3 submissions are `validation_failed` and `accepted`, each with a distinct verified source. Both the M9 invitation and linked M3 invitation are `revoked`, and the request create/issue facts are present in `audit_logs`. This query was read-only and touched no other project's database.

## Reproduce without deleting data

From the repository root, with the existing local Supabase stack running:

```sh
pnpm --filter contracts test
pnpm --filter api run test -- supplier-evidence-sbom
pnpm --filter web run test -- supplier-evidence
pnpm check-types
pnpm build
pnpm test:architecture
pnpm --filter infrastructure run db:lint
```

Run the three `apps/infrastructure/tests/m9-06-*.test.sql` files against local CRA Postgres with `psql -v ON_ERROR_STOP=1 -f <file>`; do not use `db:reset`. Start the CRA API and web on dedicated local ports and run `apps/web/e2e/m9-06-supplier-sbom-portal.spec.ts` with `--output=test-results/m9-06-local` so other screenshot artifacts remain intact.

## Release and rollback

Deploy the additive migration and CLI-generated types first, then API/worker, then web. No existing evidence, source, snapshot, or audit row is backfilled or rewritten. To roll back application behavior, disable the M9 SBOM selector/panel and the two new portal routes, then deploy the prior API/web. Keep the additive columns, links, immutable submissions, reviewer decisions, provenance, and audit records; repair database defects with forward migrations rather than deletion.

## Residual risks and gates

The bounded local probe is not a realistic-load p95/p99 benchmark. Current-browser Chromium, Firefox, and WebKit journeys pass, but prior browser versions and full WCAG 2.2 AA certification were not completed; no automated axe/pa11y dependency is installed. The separate baseline `pnpm verify` failures prevent an all-green repository claim. Playwright MCP-specific evidence is pending until that tool is available; repository Playwright screenshots and database cross-checks provide the local evidence. No claim of guaranteed zero bugs or automatic legal compliance is made.
