# M15-01 deployment, renewal and recovery

This additive rollout grants no authority to reset data, replay historical migrations, delete evidence, change source approvals or remove enforcement. Use existing backup authorities; licensing does not implement backups.

## Preconditions and destination

1. Confirm repository, target environment, Supabase URL/reference and migration ledger before mutations. Development uses `project_id=cra`, API 54321/DB 54322; independently identify production. Exclude unrelated connected projects.
2. Record catalog/RLS/grants/indexes/storage versions and authoritative source references/sizes without exporting user payloads/secrets. Existing historical ledger mismatch is not repaired here.
3. Verify the authorized backup/recovery path. Inventory API/workers, direct signed upload endpoints and their actual token TTLs. Retain the last enforcement-compatible build.
4. Obtain external issuer-signed tenant licences bound to the organization/stable instance UUID, accepted schema/header and increasing sequence. The application ships no issuer signer/private key.

## Additive migrations and accounting

Create future migrations through `pnpm --filter infrastructure run db:new <name>`. Preview exact selected migrations against the confirmed destination before CLI application. Do not substitute `db:reset` or historical replay. Inspection/type commands for the matched local stack:

```sh
pnpm --filter infrastructure exec supabase db push --local --dry-run
pnpm --filter infrastructure run db:types
pnpm --filter infrastructure run db:lint
```

Dry run does not apply migrations. If it proposes historical replay, stop that deployment path and resolve selected migration application through the established repository process; do not repair the ledger for this ticket. Generate both type copies only through `db:types`.

Only two public tables are new. Keep RLS enabled/non-forced, browser privileges absent, search paths pinned and required service RPC grants explicit. M13/private immutable `licence-artifacts` remain history authority.

Backfill is idempotent by authoritative source/object identity, joining source references/storage metadata rather than trusting path text. Distinguish uploaded reporting receipts from generated packages. Compare completed customer/reserved/protected bytes separately. Missing size or unknown ownership is unavailable accounting: never substitute zero/delete objects. Resolve the source/metadata through normal maintenance, then verify `m15_01_storage_accounting_ready` per tenant.

## Stable instance and public trust

Configure API/every worker consistently:

```text
LICENSING_INSTANCE_ID=<stable deployment UUID>
LICENSING_TRUST_FILE=<mounted public trust JSON>
LICENSING_POLICY_REVISION=<monotonically increasing integer>
LICENSING_LOCAL_FEATURES_JSON={}
API_PUBLIC_ORIGIN=<externally reachable HTTPS API origin>
```

`apps/api/.env.example` documents one issuer and Ed25519 public JWKs with distinct `kid`. Only public material is accepted. Never package private/test signing keys, JWS artifacts or credentials. Preserve the instance UUID across restart/recovery; generating a replacement invalidates existing binding.

Trust loads locally. Malformed configured trust blocks readiness. Persisted tenant states require instance/trust configuration. An empty installation may start maintenance without them but receives no customer capability/trial. Startup publishes verification/denial for state tenants in bounded pages before listening.

Flags disable signed grants only. Increase revision on trust/binding/local restriction change; equal revision with different digest or decreasing revision conflicts. Drain/restart APIs/workers consistently so old processes cannot publish stale policy.

## Provision, deploy and drain

1. Apply reviewed additive schema and verify accounting.
2. Configure stable instance/public trust and compatible API/workers.
3. Provision every existing tenant via authorized activation. Verify binding/grants/limits/version/audit/policy; no automatic trial/permanent bypass.
4. Stop direct signed-URL issuance and drain its actual TTL before strict ingress enforcement claims. Existing URLs cannot become API-bounded retroactively.
5. Deploy consistent API/worker enforcement, then web; verify route/RPC/worker classification and source transaction guards.
6. Check growth/denial/renewal/isolation/paused-resume, genuine existing M6 continuation and authenticated manual export. Protective ledger/audit appends must continue.

Grace starts inclusively at expiry and lasts thirty days of entitled writes. Ordinary writes stop at expiry plus thirty days. Caps include active seats/live invitation reservations, nonarchived products and customer bytes/reservations. Downgrade preserves data/reads/export. A verified expired licence preserves existing authorized reads; missing/invalid/clock-untrusted status does not grant every customer read. Protected operations still require normal authorization.

## Offline renewal and trust rotation

Obtain renewal out of band. Organization → Licence accepts file/paste, server verification is authoritative. Supply current optimistic version/request-specific idempotency UUID; identical retries retain that input/key, changed input conflicts. Refresh after conflict and deliberately submit a new request. Do not auto-replay POST on auth refresh.

Activation commits replacement/M13 append together. Invalid replacement preserves current authority, recording safe digest/reason separately. Sequence must increase; never edit sequence/version to force renewal. History must not expose raw artifacts.

For rotation, mount explicit old/new public keys, increase revision and restart the fleet. Provision replacements before retiring old keys where possible. Removing a key intentionally invalidates its remaining artifacts. Repeat startup/policy tests; never introduce an application signing key as recovery.

## Time and clock recovery

Authority combines persisted high-water, wall time and process monotonic elapsed time. Backward discrepancy over five minutes enters clock-untrusted mode without rewinding time/M6 deadlines. Normally authorized maintenance/renewal/evidence remain; ordinary writes stop.

Investigate/correct host and DB clocks through the controlled operational process. Restart with the same instance/trust and nondecreasing revision. Both verifier/database clocks must catch up to preserved high-water before automatic recovery and its durable event. Confirm policy/audit; do not clear flags/edit high-water by hand.

A forward jump may cause premature expiry/high-water beyond real time. Restored old DB/storage snapshots may lose time/sequence/receipt evidence. There is no hardware-grade rollback resistance. Obtain explicit architecture/operator recovery review, preserve evidence and retain write protection until authority is consistent; a new licence alone does not fix untrusted time.

## Queues and ambiguous uploads

Paused work releases leases without consuming attempts. Claims skip ineligible tenants; resume checks fresh licence/authorization/capacity before new side effects. Already-admitted bounded steps finish/reconcile only original authority. Protective workers/manual exports continue; scheduled generation remains separately gated.

Private staging bounds/hashes/inspects bytes and validates source identity before publication. `m15_01_reconcile_abandoned_reservations` releases only expired bounded reservations proven to have no object. Uploading/uncertain outcomes stay charged until exact metadata/hash reconciliation. A network failure does not prove absence; do not remove retained evidence to resolve overage.

Receipt retries require normal M6 approval/session proof and exact source/content. Completed receipt reuse avoids a second upload after filing failure. Pre-cutoff real obligations have narrow protective accounting; rehearsals/elective inputs remain customer writes. Licensing cannot create human approval/proof.

## Missing retained export sources

An export must include every required retained source with its verified identity/version. Explicit missing-object/404/`ENOENT` failures are recorded internally as `artifact_source_missing` and stop automatic transient retries; provider outages remain retryable. The existing public unavailable response remains unchanged. Do not skip entries, fabricate empty bytes, delete metadata or reset attempts to conceal an incomplete archive.

Locate an authoritative backup/original through the existing recovery authority. Validate tenant, source object/version, size and digest against retained references before an authorized restore. This ticket does not authorize a live backup restore. After restored bytes and source identity are verified, request a new normally authorized export and verify its full manifest/archive. Preserve previous jobs, snapshots, diagnostics and audit evidence. A successful healthy-tenant export does not prove recovery of a different tenant's missing files.

## Rollback

No destructive down migration. Retain tables/artifact archive/M13/reservations/sequence/version/revision/time. Never reset tenants or purge evidence to remove expiry/quota protection.

Roll back API/workers only to a schema- and enforcement-compatible build. A pre-M15 ungated build is unsafe. Drain customer claims/URL issuance; retain bounded work for reconciliation. If no compatible build exists, isolate customer-write execution and run only a reviewed maintenance-compatible path preserving renewal/authenticated manual exports/protective processing. No environment bypass.

Presentation rollback keeps server enforcement and clear renewal/block reasons. Trust rollback is an explicit validated public set at a new revision, never a decreased revision/changed binding. Recheck denial/protected flows. Backup restore needs separate authority and clock/sequence reconciliation; this ticket authorizes no live restore.

## Verification commands and records

```sh
pnpm --filter @repo/contracts run test
pnpm --filter api run test -- licensing --runInBand
pnpm --filter web run test -- licensing
pnpm --filter infrastructure run test
pnpm test:architecture
E2E_WEB_ORIGIN=http://localhost:3004 E2E_CROSS_BROWSER=true pnpm --filter web exec playwright test e2e/m15-licensing-read.spec.ts --reporter=line
pnpm verify
API=http://localhost:3336/api/v1 bash apps/api/test/auth-flow.e2e.sh
```

The shell API origin is this local verification instance, not production. Inspect all four coverage metrics and real SQL/concurrency/API/browser suites. Avoid browser/worker polling during snapshot-sensitive legacy SQL. Capture actual browser versions/safe screenshots; preserve other origins/unrelated fixtures.

Record destination/migration/type digests, grants/RLS/search paths, readiness, trust revision, activation receipts, legacy URL drain, results and residual risks. [Verification](m15-01-verification.md) distinguishes observed evidence from pending checks; do not promote pending checks into pass claims.

## Local Storage recovery follow-up (2026-10-13)

This follow-up is authorized only for the local CRA development stack. Production is excluded. The user subsequently instructed us to leave historical files with no recoverable bytes alone. No source bytes, metadata, prior export jobs, migrations or application contracts were deleted or replaced.

The verified MCP endpoint is `http://127.0.0.1:54321`, with local PostgreSQL in `supabase_db_cra`. Storage container `supabase_storage_cra` stopped with exit 255 at the same time as the Docker interruption, without OOM or an application error. It was restarted in place with the same Storage API v1.77.0 image, configuration and `supabase_storage_cra` volume mounted at `/mnt`; `/storage/v1/status` returned 200. Restart policy is now `unless-stopped`, preventing a repeat automatic-start gap while respecting explicit manual stops. Do not run a reset or recreate the volume. The existing runtime's schema compatibility freeze remains unchanged. To reverse only the restart-policy change, use `docker update --restart no supabase_storage_cra`; this does not stop the running service or remove data.

Read-only reinventory confirmed 351 storage object records with the identical before/after full-row digest at restart. The original frozen 229-source export still has 101 missing physical sources: four evidence documents, 23 SBOM originals, five technical-file declarations and 69 technical-file snapshot artifacts. Thirty prior copies and 98 other readable sources do not replace those missing originals; zero exact verified copies were found for the missing set. Metadata and previous jobs remain intact. No partial archive, invented empty bytes, attempt reset or silent omission was used.

A fresh normally authorized browser export from an already-existing healthy local tenant completed 49/49 parts through the scoped existing `TenantLifecycleWorker.processExport`. Only that tenant's sole newly queued job was processed; no purge, cleanup or unrelated queued export was invoked. Supabase MCP confirmed the new ZIP SHA-256 `b528e2264b3066b5e5f0ae67977a37d16ebfe5c9b887ce932aa63fb8f62741dc` and manifest SHA-256 `d9c3693fe5b0694aedf785d86323c0e928e0a11f21f3315f6a34257aa215965a`. Playwright MCP downloaded the ZIP through the normal UI and confirmed both hashes, 50 ZIP entries (49 files plus manifest), every manifest file present and zero hash/size mismatches. Cross-tenant download attempts returned 404 in both directions; the owner was restored to the original CRA organization afterward. Healthy-tenant success does not claim recovery of the original missing-byte export.

Focused existing artifact-snapshot/worker regression tests passed: two suites, 56 cases, including explicit missing-source fail-closed behavior and retryable provider outages. No new application abstraction, table, migration, signing key or changed authentication/authorization policy was required.

Screenshots: [completed desktop export](m15-02-evidence/storage-export-completed-desktop.png) and [mobile capture](m15-02-evidence/storage-export-completed-mobile.png). The mobile capture shows an existing export-panel horizontal clipping issue; this operational follow-up did not change frontend code or certify the mobile journey. Download assertions were performed with the MCP desktop browser, not a new full three-engine run.

Final matching Supabase MCP checks confirmed the pre-existing 351 storage records retained full-row digest `83d3136d746a46032b2356b4b29eb15c`, all 33 customer admission records remain and Storage now holds 401 objects after adding the new export's 50 generated objects. Prior missing-source jobs retained their queued states and attempt counts (one and four); no retries, purges, destructive restore or data reset were performed. The protected export completed for a tenant with no activated licence, preserving authenticated evidence export. Local Storage and API readiness both returned 200. Existing application tests for the missing-source/provider-outage distinction remained green. Full repository verification was already green immediately before this operational-only follow-up; application code, contracts and migrations were not changed here.

The user declined further missing-byte recovery. Those 101 sources remain unresolved and the original tenant's archive must remain unavailable until authentic originals are supplied through a separately authorized recovery process. Healthy export success does not remove that limitation. Production was neither queried nor modified.
