# M10-05 tenant-owned custom frameworks

## Scope and preserved contracts

- Users with `can_manage_frameworks` create/import, edit, publish, archive, and restore customer-defined packs. Published versions are immutable and explicitly labelled non-official.
- No marketplace, scripts, legal timers, proprietary content, or alternate mapping/coverage engine.
- Existing `/api/v1` routes, session cookies, global CRA packs, M10-04 reviewed upgrades, M7 snapshots, assessments, evidence versions, and supplier contracts remain compatible.

## Concrete problem and direct solution

M10-01 stores immutable global versions and requirements; M10-02/03 map exact requirement versions to controls and calculate coverage; M10-04 upgrades selected versions by reviewed decisions. None can hold an editable, tenant-owned draft. Add one tenant-owned draft head and ownership columns on the existing pack/version and requirement tables. Publish into those tables so all downstream behavior is shared.

## Selected and rejected patterns

- Existing feature repository port: Nest use cases depend on a focused repository interface; the Supabase adapter implements it. This is required by the present service-role boundary and is removable only if the backend data boundary is removed.
- Existing versioned immutable records: publication inserts a new exact version while draft edits use CAS. This is required by pinned mappings and snapshots. Replacing old records or adding a parallel customer framework engine would break those invariants.
- Existing M10-04 review flow: selecting a newer version with active mappings requires explicit decisions. No new migration state machine, command bus, event bus, or evidence store is needed.

## Data and tenant boundaries

- The global auth guard verifies session and organization membership; permissions require `can_manage_frameworks` for writes and `can_view_frameworks` for reads.
- Every service-role read filters custom content by its owner organization. SQL commands verify actor membership and effective permission, lock the scoped draft/selection, compare expected revision, and commit content plus audit atomically.
- Idempotency keys return the original result for the same operation and digest; reused keys with different input conflict. Failed publication leaves the old draft and selected version usable.
- Additive migration precedes API deployment. Generated database types are CLI output. Rollback removes the new API/UI while retaining additive columns and tenant content; never delete published history or lower retention floors.
- Tenant export includes custom drafts and exact published content, with snapshot locks. Portable JSON export omits tenant IDs, mapping/evidence rows, and executable material; importing creates a new private draft and key.

## API boundaries and frontend

- Schemas and `z.output` types live under `@repo/contracts/frameworks/{schemas,types}`. Controllers parse body, query, and path with Zod and declare `@ZodResponse`. Portable export returns parsed JSON, which the browser downloads locally. The web gateway supplies `inputSchema` for bodies and `schema` for successful responses.
- Functional `/frameworks` UI lazy-loads the editor. A focused API gateway owns transport; immutable policies shape labels and local draft state. The UI preserves unsaved text on validation, offline, and conflict errors.
- Published content is labelled Customer-defined. New versions never auto-change selections or imply CRA obligations. Archive stops new work but keeps a selected version readable and usable; restore is explicit.

## Failure modes, tests, and observability

- Invalid text/hierarchy/size returns exact Zod field errors without writes. A scoped SQL dry run also invokes the same publication validator; a mismatch returns a content-level error. Denied scope or permission fails closed. Concurrent edits/publishes return a stable conflict and require refresh. Duplicate network retries replay the same result. Audit failure rolls back the content transaction.
- Characterization and failing tests precede implementation: contract validation; SQL owner and permission boundaries, RLS/grants, idempotency and rollback; API error mapping; gateway parsing; UI recovery; Playwright create/import/publish/upgrade/archive/restore and organization switching.
- Logs distinguish validation, denial, conflict, and provider outage without file contents or credentials. The completion gate is focused coverage >=80%, local DB tests, DB lint/diff, `pnpm verify`, and live browser screenshots.

## Review checklist

- [x] Direct extension of existing pack/version tables considered first.
- [x] No global request or tenant state; no direct Supabase in React or controllers.
- [x] Shared Zod inputs and parsed responses; transactionally durable audit.
- [x] Existing M10 mapping, coverage, and upgrade contracts reused.
- [x] Focused tests, live-stack gates, independent review, and coverage completed as recorded below.

## Requirement-to-test trace

| Requirement | Primary evidence |
| --- | --- |
| Tenant-owned namespace, official-key reservation, permission and archive guards | `apps/infrastructure/tests/m10-05-custom-packs.test.sql`, `apps/api/src/frameworks/custom-frameworks.controller.spec.ts` |
| Shared hierarchy, count, depth and malicious-text validation; no partial publication | `packages/contracts/src/frameworks/schemas/custom-framework.schema.spec.ts`, `apps/infrastructure/tests/m10-05-custom-packs.test.sql` |
| Immutable v1/v2, retry, CAS and audit rollback | `apps/infrastructure/tests/m10-05-custom-packs.test.sql`, `apps/api/src/frameworks/infrastructure/supabase-custom-framework.repository.spec.ts` |
| Owner-scoped catalog, selection and mapping; old version retained | `apps/api/src/frameworks/infrastructure/supabase-framework.repository.spec.ts`, `apps/infrastructure/tests/m10-05-custom-packs.test.sql`, `apps/web/e2e/m10-custom-frameworks.spec.ts` |
| Portable export/import without tenant identity or mappings | `apps/api/src/frameworks/application/custom-framework-use-cases.spec.ts`, `apps/infrastructure/tests/m10-05-custom-packs.test.sql`, `apps/web/e2e/m10-custom-frameworks.spec.ts` |
| Draft and published UI, recovery and keyboard-visible statuses | `apps/web/app/_features/frameworks/custom-frameworks-panel.spec.tsx`, `apps/web/e2e/m10-custom-frameworks.spec.ts` |

## Migration, verification, and limits

Apply `20260925160000_m10_05_customer_packs.sql`, `20260925160100_m10_05_archive_upgrade_guard.sql`, `20260925160200_m10_05_custom_validation_rpc.sql`, `20260925160300_m10_05_custom_validation_paths.sql`, then `20260925160400_m10_05_custom_validation_field_paths.sql`. All were applied to the local `cra` Supabase stack without a reset. Both database type copies are CLI generated. Deployment rollback disables the new API/UI routes while retaining published customer versions and additive schema; a database down migration would delete retained records and is intentionally not provided.

The local SQL suite includes 57 focused M10-05 assertions, including tenant separation, RLS/grants, cross-tenant portable import, archive guards, field-level dry-run diagnostics, and audit-failure rollback. The full infrastructure SQL suite passes. Final focused API V8 coverage for the new controller, use case, and repository was 99.62% statements/lines, 80.5% branches, and 100% functions across the three modules; decorator-generated branches leave the controller alone at 65.95% branch coverage. Final focused web V8 coverage for the new panel, gateway, and query modules was 94.31% statements/lines, 84.87% branches, and 98.46% functions; 24/24 focused web tests passed. `pnpm verify` passed after review fixes: API 275 suites/2306 tests, web 134 files/798 tests, and all lint, type, architecture, and build tasks. The new browser journey passed in Chromium, Firefox, and WebKit with a 390-pixel mobile overflow assertion; a final Chromium rerun after validation and pagination fixes, plus existing framework-pack/control-library journeys, passed against the live API and coverage worker. Final desktop and mobile captures are in [screenshots/m10-05](screenshots/m10-05/). These full journeys used the repository Playwright runner. The run-scoped organizations were cleaned up, and the one early test-created pack in the seeded owner organization was archived with its immutable published history retained.

The project-local Playwright MCP launch was subsequently corrected to use pnpm. A direct MCP `initialize` and `tools/list` exchange returned 25 tools. Its browser tools opened the local development server, followed the unauthenticated redirect, signed in with the seeded owner, loaded `/frameworks`, and opened the custom-framework editor. The MCP smoke screenshot is [screenshots/m10-05/mcp-smoke.png](screenshots/m10-05/mcp-smoke.png). This smoke check did not repeat the full create/publish/upgrade journey.

`supabase db diff` reports four unrelated local function differences (`m7_declaration_json`, `m8_evidence_validity_status`, `retry_evidence_text_extraction_atomic`, and `retry_supplier_evidence_reminder_delivery_atomic`); no M10-05 object appears in the diff. The first three were present before the M10-05 work; the fourth was observed in the final diff and its origin is unconfirmed. The 60-request local catalog read probe returned 200 throughout with p95 119 ms and p99 127 ms at concurrency five. This small fixture does not establish the target under realistic production load. The connected Supabase MCP projects were unrelated ERP projects, so only the local CRA stack was changed and inspected.
