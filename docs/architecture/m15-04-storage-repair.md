# Original development Storage repair

## Cause and scoped correction

The original local project is `cra`, confirmed through Supabase MCP at `http://127.0.0.1:54321`. Its Storage schema was already at migration `72:drop-bucketid-objname-index`. That schema uses native object versioning and partial/current-version uniqueness. The substitute Storage 1.67.20 runtime still attempted `ON CONFLICT(name,bucket_id)`, which requires the removed global unique index and failed with PostgreSQL 42P10.

The separately authorized repair restored cached `public.ecr.aws/supabase/storage-api:v1.77.0`, image ID `sha256:3999cfa4f3286f945fa68069fc9b8b6bf3929a6bd53916dcf2e8c209801173c0`. No legacy global uniqueness constraint was reintroduced; no schema rollback, new migration, database reset, ledger repair, volume replacement or stored-object deletion occurred. Startup retained `DB_MIGRATIONS_FREEZE_AT=drop-bucketid-objname-index`, and the Storage migration rows remained identical.

The serving container is `supabase_storage_cra`, with the established project labels, credentials, database URL, `/mnt` volume, network aliases, command and `unless-stopped` restart policy. A status healthcheck was restored. Supabase CLI status now recognizes the service, it is healthy, and exactly one Storage service runs on `supabase_network_cra`. Both prior containers remain preserved as stopped, restart-disabled, network-detached rollback evidence: `supabase_storage_cra_cli_m15` and `supabase_storage_cra_repair_backup_20261014`. Neither can silently resume serving the original network.

The old CRA API process also needed restarting to load the already-verified M15-04 build; its earlier code rejected the newer internal access projection during inspection. The current API remains on 3333. The diagnostics worker uses the API's established licence trust configuration and original Supabase endpoint. A CRA verification web server runs at `http://localhost:3010`; the unrelated application on port 3000 and the isolated stack were preserved. Next development protection requires the configured `localhost` web origin; `127.0.0.1:3010` did not hydrate and was not used for the successful journey. No browser data or unrelated tabs were cleared.

## Data preservation

Before switching Storage, a full custom-format PostgreSQL dump was created and its restore catalog successfully read without restoring it. With the old Storage service stopped, the original volume was mounted read-only to create a tar backup and SHA-256 manifest. Private container configurations, environment evidence and baseline metadata were retained with restrictive permissions under `.superpowers/sdd/m15-04/original-storage-repair/`; do not publish that directory.

The repair-time comparison verified all **401 existing object rows**, **14 buckets** and **298 physical files** were unchanged. The same comparison passed after both nine-test browser runs and the final managed-runtime Playwright MCP journey. The final delta was ten new diagnostic object rows/files from explicitly consented verification work; every pre-existing row and file still matched. Three existing objects from three different buckets were downloaded through the repaired Storage HTTP API; all returned 200 and their SHA-256 values matched the original physical-file manifest. Previously documented missing historical objects were not reconstructed or deleted.

Only new explicitly consented diagnostic artifacts were added by verification. Withdrawal retained their bytes. SQL regression fixtures and transaction-race fixtures rolled back. The [sanitized preservation receipt](evidence/m15-04/original-storage-repair-proof.json) records sizes, counts, hashes and safe statuses, without credentials or original tenant contents.

## Original-stack verification

The seeded owner used Playwright MCP to review the static disclosure, confirm unchecked consent and disabled creation, consent using the keyboard, generate all three categories and inspect all four sections. Job `05760f51-20c8-475d-8cc9-d466061ff956` completed on its first attempt with no failure code. The actual browser attachment contained 9,961 bytes and SHA-256 `59986aa9f75aaf76e9feb4da1e66437ed2ce753076947ab87842c6f18280a2a7`, matching the database and stored object. Grant replay returned 404. A fresh grant followed by withdrawal denied both inspection and download with 404, while the exact object remained retained.

Supabase MCP directly confirmed consent, ready, inspection, grant, download and cancellation receipts; the grant was cleared, private-bucket/RLS protections remained enabled, and the retained object had one expected source owner and exactly 9,961 bytes.

Screenshots:

- [Consent and disclosure](evidence/m15-04/original-storage-consent.png)
- [Ready bundle and actual inspection](evidence/m15-04/original-storage-ready-desktop.png)
- [390px mobile inspection](evidence/m15-04/original-storage-ready-mobile.png)
- [Withdrawn access](evidence/m15-04/original-storage-withdrawn.png)
- [Fresh ready bundle on the final registered service](evidence/m15-04/original-storage-final-ready.png)

The nine task-owned browser tests passed against the original stack in Chromium, Firefox and WebKit. They cover generation/inspection/download/hash, replay denial, withdrawal, responsive/keyboard behavior, invalid tenant input, missing consent, unauthorized access and idempotent cancellation. The second nine-test run also passed (1.2 minutes) against the final CLI-registered serving container; its result is recorded in the sanitized receipt. Automation-engine coverage retains the native-browser/accessibility limits documented in the main verification report.

After final service registration, a fresh explicit seeded-owner consent produced job `a211640e-3af5-4a24-8ae2-720a9f54bc05`. All four inspection sections and the real browser download passed again. Its 9,961-byte ZIP matched SHA-256 `e97570db6087fed1c864709ca0fabe2d9e8fe8adba30706d9574ec31a7f703ec` in downloaded bytes and Supabase metadata. MCP confirmed first-attempt readiness, no failure code, consumed grant and durable receipts. This final job is left ready for local inspection, subject to its normal authorization and 24-hour availability.

Six relevant real SQL suites passed: native Storage versioning, generated storage accounting, diagnostic schema, security/retention, worker retries and source visibility. Both two-connection cleanup race orderings passed, with their fixtures rolled back. No production TypeScript changed in this repair; the earlier successful `pnpm verify` build was reused. Documentation formatting, architecture documentation validation and whitespace checks are run after updating this evidence.

## Safe restart and rollback

The installed CLI surface has no supported per-service Storage image override. A future recreation using its older default can reintroduce this mismatch. Keep the compatible container and original volume. For a local start, explicitly exclude CLI-managed Storage and then start the existing compatible service:

```sh
pnpm --filter infrastructure exec supabase start --exclude storage-api
docker start supabase_storage_cra
docker inspect --format '{{.Config.Image}} {{.State.Health.Status}}' supabase_storage_cra
docker exec supabase_storage_cra wget --no-verbose --tries=1 --spider http://127.0.0.1:5000/status
```

Expected image: `public.ecr.aws/supabase/storage-api:v1.77.0`; expected health: `healthy`. Check that only this Storage service is running on `supabase_network_cra`. Do not start either preserved backup container, or use an unreviewed plain CLI recreation against this versioned schema. If the compatible container has been removed, stop and recreate its reviewed image/configuration from the private configuration backup on the unchanged volume before serving requests. Do not change credentials, guess configuration, reset data or add the old unique index.

A rollback to 1.67.20 alone would restore the known incompatibility. For runtime rollback, retain a schema-compatible Storage image. Restoring a database/volume backup is a separate, explicitly reviewed operation because it would discard verification or subsequent writes; no restore was executed here. Re-verify the metadata-delete-before-physical-delete transaction contract before any future Storage version change, as required by the diagnostics cleanup guard.
