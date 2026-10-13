# M15-01 database authority and rollout

The migration adds exactly two public tables: `organization_license_states` and
`organization_storage_admissions`. Non-forced RLS is enabled; browser roles have
no privileges; service callers use explicit SECURITY DEFINER RPCs. The current
raw JWS is retained with its deterministic private `licence-artifacts` object
reference; M13 immutable events retain safe hashes, version and rejection reason.
No trust-key, billing, activation-history or metering table is introduced.

## Destination verification

Before any application, confirm `project_id=cra`, local API54321/DB54322 and
matching migration ledger. This execution inspected 289 public base tables,
latest version20261012120412, three organizations and228 storage metadata rows.
Twenty-nine customer evidence/SBOM objects had authoritative source references
and sizes. Existing source tables enable but do not force RLS. No user identity,
licence material, credentials or object bytes were printed.

Apply only CLI-created M15 migrations after source/API compatibility inspection.
Do not reset, replay historical migrations or repair the existing ledger. Apply
in a transaction and record the new migration through the CLI-compatible ledger.
Generate both database type copies with `pnpm --filter infrastructure db:types`.

## Transactions and time

Activation serializes on the tenant licensing lock, verifies current member and
manage permission, locks state and compares optimistic version plus increasing
issuer sequence. The deterministic private object must already exist. Replacement
and M13 event append commit together; rejection records safe audit provenance
and never replaces the valid state. Audit failure aborts the source transaction.
Idempotency binds actor/tenant/request digest; altered retries conflict.

Runtime verification proof binds activation version/digest, explicit policy
revision, effective capability subset and trust/config digest, expiring after
60 seconds. Source transactions fail closed without a fresh proof. Decrease of
policy revision or altered digest at the same revision conflicts.

Persisted high-water checkpoints never decrease. More than five minutes behind
high-water enters clock-untrusted protection. Catch-up does not rewind high-water; the clock flag clears only when both
actual database and verifier wall clocks catch up, with a durable recovery event. Restoring old database/storage
snapshots or a sufficiently forward manipulated clock remains outside perfect
rollback resistance. No network time or call-home is required.

## Quotas and uploads

All growth helpers use the same tenant transaction lock. Active-seat accounting
includes distinct live invitation reservations not already active members.
Accepting an invitation transfers its reservation. Global user reactivation
checks every affected tenant in UUID order. Initial empty-organization owner
membership establishes licence-activation authority but grants no product write.
Products are admitted by the actual products insertion/unarchive trigger, so
CSV and connector source RPCs cannot bypass concurrent growth accounting.

The ledger accounts completed object bytes plus reserved/uploading/uncertain
bytes. Expired/ambiguous reservations stay charged until reconciliation proves
what happened. Data is never removed to satisfy a downgrade. Existing object
backfill uses exact source references and storage metadata, including evidence,
SBOM, branding, import source and security-update objects. Generated exports and
protective evidence are excluded. Unknown object ownership or missing size
blocks readiness rather than assuming zero.

Supplier evidence, supplier SBOM and CI admissions resolve live source identities
through their tenant-qualified source rows, exact object key and declared size.
Existing supplier object paths are random; path text does not establish ownership.
Members require verified current membership and tenant-qualified paths. Upload
claim is single-use and revalidates live identity; validation and completion
recheck revocation. Original bounded admitted bytes can finalize after licence
expiry. A reserved URL can be reissued for identical source metadata, rotating
its token; uploading/completed authority cannot be replaced by another PUT.

## Rollback and checks

Retain tables, immutable audit and private artifacts on executable rollback.
Never reset time/issuer sequence or deploy an ungated old build as an implicit
licensing bypass. Provision signed tenant licences and complete accounting before
activating enforcement. Drain legacy direct signed URLs using their actual TTL.

Rollback-only SQL: `docker exec -i supabase_db_cra psql -U postgres -d postgres
-X -v ON_ERROR_STOP=1 < apps/infrastructure/tests/m15-01-licensing.test.sql`.
Source/worker operation classification owns additional nongrowth enforcement;
these tables are not a replacement for existing authorization or human approval.
