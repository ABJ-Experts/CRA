# M15-04 deployment and operations

## Release boundary

Deploy the matching contracts, API, standalone worker and web release together. No new runtime dependency or support-service connection is required. The established `COOKIE_SIGNING_SECRET` remains the signing root; the module derives a purpose-specific diagnostic key without changing the existing configuration minimum. Existing M13 best-effort logging callers retain their behavior.

Apply these CLI-created additive migrations in timestamp order:

1. `20261014090758_m15_04_support_diagnostics.sql`: one RPC-only job table, private bucket, durable consent/workflow, retention, protected metering and metadata-only tenant-export integration.
2. `20261014092336_m15_04_creator_lookup_index.sql`: creator foreign-key lookup index.
3. `20261014092914_m15_04_version_fences.sql`: reject null/nonpositive optimistic versions independently of HTTP schemas.
4. `20261014093244_m15_04_contextual_audit_receipts.sql`: bind diagnostic audit digests to their immutable source; preserve generic audit redaction.
5. `20261014094139_m15_04_source_visibility_guards.sql`: reviewed M13 predicate fingerprint rollout and visible-row-first log limits.
6. `20261014094604_m15_04_storage_delete_authority.sql`: enforce cleanup authority inside Storage's metadata/physical deletion transaction and serialize protective writers.
7. `20261014094906_m15_04_cleanup_blocker_codes.sql`: closed authority blocker codes compatible with shared response schemas.
8. `20261014095139_m15_04_consent_replay_fence.sql`: exact command replay remains idempotent; a consumed preview cannot create another job.
9. `20261014100055_m15_04_lint_clarity.sql`: declare timestamp-validation stability and time-sensitive cleanup volatility correctly; explicit JSONB initializers.
10. `20261014101818_m15_04_terminal_state_clarity.sql`: clear earlier retry failures on successful publication and prevent cancellation from rewriting reviewed cleanup.

On a normally reconciled deployment, inspect `supabase migration list` and the CLI migration dry run before applying. Abort if unrelated historical migrations would be replayed. Do not reset the database, reconstruct historical ledgers, or repair unrelated migrations for this ticket. The inspected development database already has historical ledger drift; local verification applied only these exact files, transactionally, without rewriting that history. The installed CLI's `db query --file` rejected multi-statement prepared execution, so the local fallback used `docker exec -i supabase_db_cra psql -v ON_ERROR_STOP=1` with an explicit transaction.

Run `pnpm --filter infrastructure run db:types` after applying; it generates both checked-in copies. Run SQL tests and `pnpm verify` before switching traffic. No data backfill is needed: older tenants have no diagnostic jobs. Permission defaults add `can_export_system_health` for owners/admins; explicit organization overrides retain final authority. A custom grant cannot bypass the administrator base-role check.

## Worker and limits

After `pnpm --filter api build`, start `pnpm --filter api worker:support-diagnostics` in the same validated environment as the API. `--once` can be passed to the built standalone entry point for an operational cycle. Run one or more worker processes; database claims fence concurrent workers and limit active jobs to one per tenant. There is no source collection without a committed consent job.

Each attempt has a 60-second deadline and lease, ten-second heartbeats, and at most three infrastructure attempts. Reads are bounded to 5,000 structured events; the stored ZIP is limited to 10 MiB. There are no arbitrary path, source SQL, archive-name or environment-dump inputs. Temporary directories/files use 0700/0600 permissions and exclusive/no-follow opens. Stale temporary work is reconciled only within the generated diagnostic namespace, with ownership, mode and age checks.

Observe fixed failure codes, job state/stage/version, lease expiry and attempt counts. Do not log preview tokens, grant cookies, bundle contents, environment values or source exceptions. A source outage can produce a fixed omission; an authorization failure blocks publication. An entirely unavailable selection fails. Infrastructure retries retain inaccessible redacted attempt references for accounting and reviewed cleanup.

## Availability, grants and cleanup

Ready artifacts are available for 24 hours to their consenting administrator while both original consent authority and current access authority remain valid. Permission changes, revoked sessions, deactivated identity/tenant, withdrawal or expiry deny inspection and new download authorization. The download grant lasts at most 60 seconds, is bound to the current session and job version, and is consumed once. Its HttpOnly cookie is restricted to the exact attachment path. Downloads reauthorize before/after verification and during chunk delivery.

Availability expiry is independent of retention. Do not delete directly from Storage or the job table. Use the creator's cleanup review and explicit cleanup request. Unknown retention authority, applicable holds, protected export work, active grants or availability block cleanup. The worker rechecks the reviewed fingerprint before physical deletion and retains consent/audit/hash tombstones. Diagnostic cleanup does not enable generic deletion of other exports or evidence. Exact retained bytes, including expired and unpublished attempts, remain protected generated storage until physically removed.

## Rollback and compatibility

Disable the diagnostics UI entry, routes and standalone worker by reverting the application release. Retain all ten additive migrations, immutable job receipts, durable audit and private objects. Do not drop the table/bucket, delete audit events, weaken RLS or bypass retention. Normal authentication, refresh cookies, public-route coverage, organization switching, source approvals and existing exports remain governed by their established policies.

The original development Storage mismatch was repaired in a separately authorized follow-up. Its database already had versioned-object migration 72, while a substitute Storage 1.67.20 container issued incompatible `ON CONFLICT(name,bucket_id)` uploads. The existing compatible `supabase_storage_cra` 1.77.0 container was restarted on its unchanged database, credentials, network and `supabase_storage_cra:/mnt` volume; the incompatible `supabase_storage_cra_cli_m15` container remains stopped. The compatible container pins `DB_MIGRATIONS_FREEZE_AT=drop-bucketid-objname-index`. No database schema rollback or forward migration was needed. Both the original stack and the earlier isolated stack have now passed diagnostic generation/download tests. See [repair and preservation evidence](m15-04-storage-repair.md). Existing missing historical objects and historical migration-ledger drift remain separate operational risks.

## Storage deletion compatibility gate

The physical deletion fence depends on verified Storage transaction ordering: metadata DELETE triggers run before backend removal, and the same database transaction remains open until backend deletion succeeds. This ordering was inspected in cached Storage 1.77.0 and the existing 1.67.20 executable image artifacts; see [transaction evidence](evidence/m15-04/storage-delete-transaction.md). Re-verify this contract for any Storage runtime change before enabling cleanup. The feature-specific BEFORE DELETE trigger rechecks current lease, ownership, policy and review fingerprint under the same organization transaction lock used by protection writers. An earlier hold or retention increase blocks deletion; a later writer waits until the already-authorized deletion transaction finishes. Failed physical removal rolls back metadata and metering. Other Storage buckets retain their existing access/deletion behavior.

Run the separate, rollback-only two-connection race test explicitly:

```sh
node apps/infrastructure/tests/m15-04-cleanup-races.test.mjs
```

This test simulates the backend deletion interval while the actual database guard holds its transaction lock. The isolated live Storage test separately verifies that the real HTTP adapter invokes the guard. Neither test resets or deletes original tenant data.
