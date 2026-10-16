# M1 complete tenant export

## Final completion: 28 September 2026

The identified M1 tenant-export gap is closed and ready for the user's commit and push on `milestone-1`, based on `59b23b3`. No commit, push, production migration, or M2 implementation was performed. Independent final review found no unresolved critical, high, or medium findings in the changed adapter, worker, migrations, contracts, UI, and browser test surface.

| Final gate                                  | Result                                                                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm verify`                               | Passed: lint, types, architecture, full unit/SQL tests, and builds                                                                                      |
| Fresh API build                             | Passed; entry modules present. The broad gate replayed an old cached `ENOTEMPTY` build log, so the API was rebuilt directly to verify its actual output |
| Focused export tests                        | 75 passed; all three materially changed worker modules exceed 80% in all four coverage metrics                                                          |
| API live-stack `test:e2e`                   | 4/4 passed                                                                                                                                              |
| Chromium complete export                    | 1/1 passed, 7.3 seconds; downloaded bytes and SHA-256 verified                                                                                          |
| Firefox/WebKit settings and complete export | 4/4 passed, 23.6 seconds total                                                                                                                          |
| Playwright MCP seeded-owner inspection      | Sign-in, organization settings, selected export panel, desktop and mobile screenshots passed                                                            |
| Local Supabase lint                         | Passed with existing warnings outside M1                                                                                                                |
| Local migration replay/diff                 | No M1 drift; four unrelated existing function differences listed below                                                                                  |
| CLI database types                          | Both copies regenerated from local CRA                                                                                                                  |
| Test cleanup                                | Zero M1 export test organizations and scoped `e2e-` objects; exact fixture left by the September 25 timeout removed                                     |

The connected hosted Supabase MCP projects are unrelated ERP projects. All database implementation and cross-checking used the local `cra` stack. Testing screenshots were removed from the repository; unrelated site data was preserved.

## Scope and preserved contracts

FR-ORG-006 requires a documented, machine-readable export of tenant records and retained artifacts. This increment completes the existing owner-only export workflow. It preserves `/api/v1`, export request/status/download response shapes, immutable source snapshots, lease and idempotency behavior, the private `tenant-exports` bucket, and the 50 MiB archive limit. It does not add import or restore, change deletion policy, or export usable credentials.

## Concrete problem and direct solution

At the start of this change, `TenantLifecycleWorker` called an artifact snapshot port whose production adapter always returned `unavailable`. The SQL export catalogue covered 122 table mappings; durable evidence, reporting, supplier, technical-file, and vulnerability facts were absent. The ZIP writer included only NDJSON parts. Reuse the existing SQL snapshot and artifact ledger: register portable rows, freeze the private-object inventory at materialization, copy bytes into the export namespace, verify hashes, and add provenance to the archive manifest. No new table or message bus is needed.

## Why not simpler?

Copying whatever storage currently lists at archive time could omit objects deleted between record materialization and the copy. It could also include newer objects than the frozen database rows. The snapshot-owned inventory is the smallest durable point-in-time boundary that lets the worker fail closed on missing or unsafe paths. Reading live tables directly from the worker would also bypass the existing snapshot, lease, and audit contract.

## Selected and rejected patterns

The existing **port and adapter** boundary has a present-tense trigger: object storage may fail independently of SQL, while the worker requires frozen, verified bytes. `TenantLifecycleWorker` owns the inward `artifactSnapshot` contract; `SupabaseTenantExportArtifactSnapshotAdapter` implements it and is assembled in `OrganizationsModule`. The dependency direction remains worker policy to inward port to Supabase adapter. The contract test covers exact inventory reads, org scoping, replay, and corrupt copies. If artifact storage and SQL ever become one atomic provider, this port could be collapsed.

The existing **transactional snapshot and ledger** pattern is retained for rows and source-object identity. SQL materialization freezes both in one transaction; completion checks ledger count and bidirectional inventory membership. A second export store, event bus, generic exporter framework, and browser-side Supabase access would add state or authority without solving a current requirement, so none is introduced.

## Data, authority, and consistency

- The existing verified owner permission starts an export. All worker reads take the organization ID from the leased job; no browser path or bucket name chooses a tenant.
- SQL materialization freezes registered record rows and each storage object's ID, version, update time, size, and path in one transaction. The worker copies objects under the exact organization prefix from private, server-owned buckets only. It checks storage identity before and after download; missing or changed bytes fail the job safely and never produce a verified download. The timestamp comparison normalizes equivalent SQL and Storage ISO formats.
- The existing artifact snapshot table records each copy's exact hash, size, content type, frozen source identity, original bucket/path, and export-scoped path. Retries verify ledger entries and do not reuse corrupt bytes. Completion compares both directions of the frozen inventory and ledger by object ID, version, update time, bucket, and path, then checks the manifest file count against record parts and artifact snapshots.
- The export is a point-in-time disclosure archive, not a restore image. Credential values, session identifiers, token verifiers, secret references, and active authorization material are redacted or omitted with explicit documentation. No archive is a way to reactivate grants or jobs.
- The current single-object bucket ceiling is 50 MiB; the configured archive default is 47,000,000 bytes to leave ZIP overhead. Oversize jobs fail with `export_size_limit`; a segmented-download contract requires separate product work and is not silently implied by this increment.

The claim, materialization, part checkpoint, artifact ledger, completion, and download audit RPCs are scoped by `organization_id` and the leased job. Materialization and completion are transactionally audited. A duplicate request reuses the existing idempotency record; a stale lease or checkpoint cannot complete an export. Migrations `20260925160500` through `20260925161200` are additive, except for replacing export RPC bodies and registering new sources. The Supabase CLI generated both database type copies. Apply migrations before deploying the worker. The older worker fails closed rather than issuing a partial download.

The local CRA catalogue now has 48 enabled sources and 167 table mappings. Another 45 table names are explicitly excluded for token/credential material, idempotency ledgers, active worker or destructive workflow state, derived projections, global catalogue data, or recursive export-copy metadata. The exclusion names and reasons are executable registry data in `export-archive.ts`; new tenant tables fail the architecture coverage test until classified.

## API and UI boundaries

The current organization export contracts, parsed Nest routes, gateway, and functional React panel remain the entry points. A verified job displays the existing file count/hash and offers a short-lived, owner-authorized download. No direct Supabase access is added to the controller or UI.

The existing `@repo/contracts/organizations` request, latest-status, and download schemas remain the wire contract. Nest parses inputs and successful responses; the web gateway parses outgoing and incoming payloads. The download schema now permits HTTP only for a loopback host; the API adapter additionally requires a matching configured local Supabase origin in a non-production environment. Production signed URLs still require HTTPS. The organization workbench keeps all tab drafts mounted but hides inactive panels, so only the selected section is visible and keyboard navigation remains intact.

Functional React components remain the rendering surface. The worker and the Supabase adapter are plain TypeScript classes with injected storage/SQL dependencies. Manifest/path validation and source registration stay immutable functions. No new UI state class or global provider was needed.

## Failure modes and tests

Missing objects, bad hashes or sizes, unsafe paths, duplicate keys, stale leases, worker restarts, tenant substitution, and corrupt readback fail closed. Provider outages retry under the lease; permanent validation failures mark the job failed. SQL completion verifies the inventory and writes its audit fact in the same transaction. The signed download is returned only after the scoped download audit succeeds. SMTP and JWKS are not on the export worker path; an invalid session or missing owner permission is rejected before an export request.

| Requirement or boundary                           | Executable evidence                                                                                        |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| FR-ORG-006 record coverage and exclusions         | `export-source-registry.architecture.spec.ts`, `export-archive.spec.ts`, local source catalogue SQL checks |
| Frozen artifact identity, bytes, hash, retry      | `supabase-tenant-export-artifact-snapshot.adapter.spec.ts`, `tenant-lifecycle-worker.spec.ts`              |
| Tenant/RLS/grant and durable failure              | `m1-tenant-administration.test.sql`                                                                        |
| Parsed owner download and loopback-only local URL | `tenant-administration-adapters.spec.ts`, `organizations.spec.ts`                                          |
| UI, signed download, ZIP manifest, copied bytes   | `tenant-administration.spec.ts` browser journey and desktop/mobile screenshots                             |
| Existing auth, navigation, architecture, build    | `pnpm verify`, API live-stack tests                                                                        |

Final verification used only the local CRA Supabase stack and local development API/web servers. The M1 SQL integration passed, including RLS, service-role grants, frozen artifact identity, durable verification failure, tenant isolation, and export catalogue coverage. `pnpm verify` exited successfully. The adapter's 28 tests passed; coverage is 89.01% statements, 83.7% branches, 95.45% functions, and 92.63% lines. Worker coverage is 90.9%, 84.09%, 100%, and 94.44%; archive coverage is 100%, 96.87%, 100%, and 100% respectively. Chromium, Firefox, and WebKit each completed a 48-part, one-artifact archive and checked the downloaded bytes and SHA-256. No production database or unrelated ERP MCP project was used.

`pnpm --filter infrastructure exec supabase db diff --local` replayed all migrations into a shadow database and completed successfully. No M1 drift was reported. Four unrelated existing function differences remain: `m7_declaration_json`, `m8_evidence_validity_status`, `retry_evidence_text_extraction_atomic`, and `retry_supplier_evidence_reminder_delivery_atomic`. Database lint passed with existing warnings outside M1. The configured 47,000,000-byte archive limit remains an operational ceiling. A warmed local Playwright MCP smoke run on September 25 made 50 authenticated latest-export reads in batches of five: all returned 200, with p95 261 ms and p99 301 ms. This sample does not establish realistic production-load performance.

The repository Playwright runner performed the complete interactive export journey with an isolated owner account. Playwright MCP was available during finalization and performed seeded-owner sign-in, organization navigation, settings dialog and export-tab interaction, and desktop/mobile screenshots. The seeded owner's existing organization content was not edited. Fresh evidence is retained under `docs/architecture/evidence/m1/`.

For the browser regression, start the local CRA Supabase/Mailpit stack, build the API worker, run the API on `localhost:3333`, and run the mocks-disabled web app on `localhost:3002`. From the repository root, the successful targeted command was:

```sh
node --env-file=.env.local --env-file=apps/api/.env -e 'const {spawnSync}=require("node:child_process"); process.env.E2E_WEB_ORIGIN="http://localhost:3002"; process.env.E2E_API_ORIGIN="http://localhost:3333"; const r=spawnSync("pnpm",["--filter","web","exec","playwright","test","--config","playwright.config.ts","e2e/tenant-administration.spec.ts","--grep","downloads a completed tenant export","--project","chromium","--output","../../docs/architecture/evidence/m1"],{stdio:"inherit",env:process.env}); process.exit(r.status??1)'
```

For Firefox and WebKit, set `process.env.E2E_CROSS_BROWSER="true"`, remove the `--grep` arguments, pass both projects with `--workers 1`, and use `../../docs/architecture/evidence/m1/browser` as the output directory. Separate output directories preserve existing tracked test evidence. The test removes only its exact run-scoped organization, account, and objects.

Screenshots:

- Completed Chromium export: browser journey verified; generated screenshots removed.
- Completed Firefox/WebKit exports: corresponding browser directories under `docs/architecture/evidence/m1/browser/`
- Seeded-owner Playwright MCP: browser journey verified; generated screenshots removed.

Focused coverage command:

```sh
pnpm --filter api exec jest 'supabase-tenant-export-artifact-snapshot.adapter|tenant-lifecycle-worker|export-archive' --runInBand --coverage --collectCoverageFrom='organizations/tenant-administration/worker/{supabase-tenant-export-artifact-snapshot.adapter,tenant-lifecycle-worker,export-archive}.ts'
```

## Deploy and rollback

Apply additive local-tested migration before worker/API deployment. A prior worker still fails closed at the unavailable adapter; rolling back application code leaves new ledger rows and private copies inert. Do not delete immutable exports or audit facts during rollback.

No backfill is required. Existing completed archives retain their recorded hashes and download authorization. A running snapshot created before frozen storage identity was introduced fails closed if its inventory cannot satisfy the new worker checks; request a new export rather than rewrite its snapshot. Retention of snapshots, copies, and audit facts continues through the existing tenant-retention policy.

## Review checklist

- [x] Direct solution and alternatives are documented.
- [x] Existing port and snapshot contracts have concrete tests.
- [x] No global request, tenant, session, or provider state was added.
- [x] Controllers and React pages retain their existing boundaries.
- [x] Wire schemas and parsed response boundaries remain feature-first.
- [x] Security-critical completion and audit share a SQL transaction.
- [x] Local SQL, browser, architecture, and build gates are documented.
- [x] Focused new-adapter coverage exceeds 80% in every Jest metric.
- [x] Independent final review has no unresolved critical, high, or medium findings.
