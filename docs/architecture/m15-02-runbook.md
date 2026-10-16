# M15-02 deployment, reconciliation and presentation rollback

M15-02 adds current usage diagnostics, audited JSON/CSV export and explicit
administrator reconciliation. It does not add a billing allowance, calendar
reset, licence grant or data recovery authority. The signed M15-01 limits and
source admission functions remain the quota authority. In particular,
`m15_01_usage` remains unchanged; a missing, stale or corrupted display meter
cannot authorize additional source growth.

Read this alongside [M15-01 deployment and recovery](m15-01-runbook.md) and the
[M15-02 feature design](m15-02-offline-usage-metering.md). Existing missing-object
recovery, stable instance identity, trust rotation and clock recovery retain
those procedures.

## Destination and deployment order

1. Identify the checkout, target database/Supabase reference and migration
   ledger before any mutation. Local CRA uses `project_id=cra`, Supabase API
   54321 and database 54322. These values do not identify a production target.
   Record the reviewed migration files and destination; exclude other connected
   projects and preserve retained data.
2. Inspect the selected additive migration plan. Do not repair the historical
   ledger, replay historical migrations, run `db:reset` or delete source records
   as part of this rollout. If a dry run proposes historical replay, stop that
   application path and use the repository's established selected-migration
   deployment process.
3. Apply the reviewed migrations in timestamp order, with each file in a
   transaction:
   - [20261013102917_m15_02_usage_meter_authority.sql](../../apps/infrastructure/supabase/migrations/20261013102917_m15_02_usage_meter_authority.sql)
   - [20261013103250_m15_02_usage_operations.sql](../../apps/infrastructure/supabase/migrations/20261013103250_m15_02_usage_operations.sql)
   - [20261013111628_m15_02_meter_tenant_lifecycle_compatibility.sql](../../apps/infrastructure/supabase/migrations/20261013111628_m15_02_meter_tenant_lifecycle_compatibility.sql)
4. The first migration creates the destination, installs source maintenance,
   rebuilds all existing organizations in sorted order under the incumbent
   tenant locks, and only then redirects the frozen M15-01 presentation reads.
   Commit that sequence atomically. Existing API processes see the old envelope
   before commit and the initialized projection afterward. Do not omit the
   initial backfill during a real deployment. The third migration makes only
   the projection's tenant foreign key cascade and prevents late source
   maintenance from rebuilding a projection after its parent has been removed.
   It does not alter retention/audit gates or grant deletion permission.
5. Generate both database type copies using the existing command, verify the
   catalog and readiness, then deploy the compatible API and web. The API must
   have the M15-02 RPCs before the new usage UI or endpoints are enabled. Preserve
   consistent M15-01 instance/trust/policy configuration across APIs and workers.

From the repository root, the established local inspection/type commands are:

```sh
pnpm --filter infrastructure exec supabase db push --local --dry-run
pnpm --filter infrastructure run db:types
pnpm --filter infrastructure run db:lint
```

The first two applied files remain immutable. Their reviewed SHA-256 digests are:

```text
20261013102917_m15_02_usage_meter_authority.sql
4b8ef087fd88d4cd8aa4264c86cb551c035f5cb94ad5d5e5ae750e87145ba2aa
20261013103250_m15_02_usage_operations.sql
62e18e9be98cb14361e3e48ac41d10efdf490ea704d8e653900b161d762ddc50
```

Apply the lifecycle correction as the third additive migration; do not edit or
replay those installed files.

The dry run does not apply migrations. `db:types` generates the infrastructure
copy and copies the normalized result into `apps/api`; do not edit either copy
by hand. Use the target's established migration runner for application, rather
than converting this local example into a production deployment command.

## Stored scope and gauge definitions

The only new table is `organization_usage_meters`, with one primary-key row per
organization. It is separate from the tenant profile and signed licence state.
A tenant can have a meter before activation; creating a meter never fabricates a
JWS, unlimited grant or verification proof. No separate usage history, receipt
or job table is introduced. M13 audit events hold immutable operation receipts.

| Gauge             | Components and source definition                                                                                                                                                                                                          | Limit                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Seats             | Active organization memberships whose global user is active, plus distinct lower-email pending invitations that have not expired. An active member's email is not reserved twice.                                                         | Signed `activeMembers` |
| Products          | Products whose `archived_at` is null. Archiving changes this count without deleting stored bytes.                                                                                                                                         | Signed `products`      |
| Customer storage  | Completed nonprotected admission `observed_bytes`, plus nonprotected `reserved_bytes` in reserved, uploading or uncertain state.                                                                                                          | Signed `storageBytes`  |
| Protected storage | Protected input admission bytes plus source-owned generated artifacts, deduplicated by bucket/path and against admission rows. Generated artifacts require retained source ownership; a tenant-looking object path alone is insufficient. | Exempt, informational  |

All four values are current gauges. Their period is `current_state`, their reset
rule is `source_changes_only`, and `nextResetAt` is null. There is no monthly or
licence-renewal reset. Bytes are exact integers; storage uncertainty is never
represented as zero.

Products and admissions maintain typed contribution deltas. Membership, active
user/email and relevant invitation changes refresh tenant seats. Unrelated
product metadata, member role, upload token/hash and export checkpoint updates
do not recount gauges. Generated source reference changes and object size
changes maintain protected contributions. Multi-tenant effects lock affected
organizations in sorted order; upload reconciliation takes the tenant lock
before the admission row.

`meter_version` and `source_version` describe projection maintenance, not billing
history or signed issuance. `reconciled_at` records the initial rebuild or last
explicit rebuild. Source changes preserve that reconciliation timestamp.
Invitation expiry stores `next_invitation_expiry`; reads refresh tenant seats
only when that checkpoint is due, using the tenant expiry/email indexes.

## Existing tenant lifecycle compatibility

An already authorized tenant deletion removes the disposable meter through its
`ON DELETE CASCADE` foreign key. Cascade source hooks must not resurrect it:
`m15_02_rebuild_meter` takes the incumbent lock, then returns if the parent no
longer exists. Normal unknown-tenant usage RPCs still deny access. The migration
changes no deletion privilege, retention gate, archival check or audit policy.

This compatibility fix is limited to the display projection. Existing M15-01
licence-state and storage-admission tenant foreign keys retain their `NO ACTION`
behavior and can independently block a parent deletion when those authoritative
records remain. The fix does not implement generic tenant purge, licence archive
lifecycle, source-ledger cleanup or a way around M13 archival protection. Use the
existing authorized lifecycle/recovery process and preserve those blockers as
separate evidence. The regression deletes only newly created rollback fixtures.

## Availability and retained bytes

Availability/reasons are independent for seats, products, customer storage and
protected storage. The M15-02 read RPC returns null components for an unavailable
group, while preserving the other groups. Missing meters return unavailable
with meter version 0; they never appear as a ready zero-valued installation.
Expected numeric inconsistency marks the affected diagnostic unavailable and
keeps protective source completion possible.

Initial or explicit rebuild uses authoritative memberships, invitations,
products, admission rows and source-owned physical objects. Missing sizes,
unsafe integer totals or ambiguous customer ownership remain unavailable.
Already admitted uploading/uncertain bytes stay charged. A missing physical
source is not recreated by reconciliation, and an unknown object is not deleted
or silently excluded to make a gauge look healthy.

The frozen `m15_01_get_state`/`m15_01_get_worker_state` envelopes keep their numeric
wire shape. They use genuine cached numbers and mark legacy accounting
availability false when any group is unavailable. Only a missing/null cached
component uses the original authoritative aggregation as a degraded fallback.
When the entire meter row is absent, legacy readiness also uses genuine
`m15_01_storage_accounting_ready`; an existing unavailable row stays false.
Normal initialized reads use the primary-key projection. This presentation
compatibility does not change admission checks.

Resolve metadata/ownership defects through the existing authorized source
maintenance or recovery process, then explicitly reconcile. Restoring retained
bytes requires separate recovery authority and verification of tenant, object,
version, size and digest. This feature does not authorize a backup restore.

## Access and signed interpretation

RLS is enabled and not forced on `organization_usage_meters`. `PUBLIC`, `anon`
and `authenticated` have no table access; `service_role` has SELECT only. All
M15-02 functions pin `search_path` to `pg_catalog, public`. Browser roles cannot
execute them. Only these RPCs are granted to `service_role`:

- `m15_02_read_usage`
- `m15_02_usage_receipt`
- `m15_02_export_usage`
- `m15_02_reconcile_usage`

The rebuild/delta/source helpers remain internal. Do not grant browser or
service-role mutation access to the table to repair a display value. Routine
administrator repair goes through the authenticated API and durable M13 audit.

The API derives organization and actor from verified identity, accepts no
browser tenant ID or raw export snapshot, and requires `can_view_licensing` for
usage/export and `can_manage_licensing` for reconciliation. Each RPC rechecks
current organization permission, including on replay. HTTP routes remain under
`/api/v1/licensing/usage`; existing authentication, override merge order and
cookie paths remain unchanged.

A verified exported interpretation requires a fresh runtime proof bound to the
current licence version/artifact digest and stored policy revision. Its limits
and validity dates match the signed stored claims; finite/unlimited meanings
cannot be supplied by a browser or inferred from missing trust. State is derived
at the common trusted observation time: active before expiry, grace until
expiry plus thirty days, then expired read only. Effective capabilities match
the proof, or are empty after expiry plus grace. Observation may follow the
persisted trusted clock floor rather than a temporarily earlier DB wall clock.
Export bounds the observation within five seconds of the greatest DB wall time,
persisted high-water time and verification check time, and requires policy
classification at both that floor and the observation to agree. Crossing expiry
or the grace boundary returns a version-style conflict; refresh and resubmit.

Unverified/unconfigured interpretations have three unverified limits, no
effective capabilities and no active/grace/expired grant claim. When a licence
head exists, their policy revision matches that head. A missing head has null
projection policy revision and exported revision 0, a no-authority sentinel. The database validates safe snapshot structure,
policy, versions, availability and exact aggregate components before appending
an export receipt. It does not perform cryptographic JWS verification itself.

## Export and reconciliation operations

GET usage returns licence/meter versions, observation/reconciliation timestamps,
fixed definitions, aggregate components and independent diagnostics. For either
POST, retain `expectedLicenseVersion`, `expectedMeterVersion` and a new
request-specific `idempotencyKey`. The server computes the request digest.

Export locks the tenant, verifies versions and snapshot coherence, and commits
`licensing.usage_exported` plus the immutable snapshot in M13. JSON and CSV are
rendered locally from that receipt; they contain no member/product/object
contents, raw licence artifact or signing material.

Reconciliation is explicit, tenant scoped and synchronous:

1. Recheck `can_manage_licensing` and look for an existing actor/tenant/operation/
   key/digest-bound receipt.
2. Try the incumbent tenant advisory lock. Contention returns `busy`; it does
   not wait for another tenant repair to complete.
3. Compare the current licence and meter versions. A mismatch returns
   `conflict` before corrections.
4. Inspect at most 100 existing reserved/uploading/uncertain admissions, ordered
   by expiry/id, with row locks. Exact object size/hash/operation matches may
   complete an admission. Only an expired reservation that never started and
   has no object may be released. Uploading/uncertain absence is not release
   proof.
5. Backfill at most 100 additional existing physical customer objects with a
   unique authoritative owner and safe size, idempotently. No missing file or
   historical source is recreated. The two candidate bounds are independent;
   `repaired` can include both completion and backfill work, while `checked`
   counts the existing admission candidates and `released` never exceeds 100.
6. Rebuild the tenant projection and commit corrections together with the
   `licensing.usage_reconciled` receipt. The function-level timeout is three
   seconds. Timeout, DB failure or audit append failure rolls back corrections
   and receipt together.

The response contains `auditEventId`, `meterVersion`, `checked`, `repaired`,
`released`, `unresolved`, `completedAt` and `replayed`. `unresolved` counts
remaining uploading/uncertain admissions, plus an indicator when storage or
protected storage is still unavailable; it is not an object-level defect
inventory. Refresh usage separately after repair.

Identical retries replay the stored immutable receipt before optimistic version
checks, with current permission rechecked. Changed actor/digest or changed
request semantics conflict; expired permission forbids replay. A lost response
is retried with the same key and versions. On `busy`, retry that same request
when contention ends. On `conflict`, refresh and deliberately submit a new
request/key. Never automatically replay a POST after authentication refresh.
A three-second failure is not evidence that an uncertain upload is absent.

## Verification and evidence

Run the focused SQL suites against the confirmed local stack without concurrent
browser/worker polling during snapshot-sensitive tests. Each SQL file uses a
transaction and rolls back its fixtures/catalog changes:

| Requirement                                                                                        | SQL evidence                                                                                             |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Private non-forced RLS, tenant permission, pre-activation-safe read                                | [m15-02-meter-authority.test.sql](../../apps/infrastructure/tests/m15-02-meter-authority.test.sql)       |
| Immutable export/repair replay, digest conflict, retained uncertain/protected bytes, revoked actor | [m15-02-operations.test.sql](../../apps/infrastructure/tests/m15-02-operations.test.sql)                 |
| Trusted observation, expiry/grace race conflicts and legitimate forward floor                      | [m15-02-export-clock.test.sql](../../apps/infrastructure/tests/m15-02-export-clock.test.sql)             |
| Missing licence revision 0 and missing-meter legacy compatibility                                  | [m15-02-missing-meter.test.sql](../../apps/infrastructure/tests/m15-02-missing-meter.test.sql)           |
| Signed limit/proof/state/capability tampering rejected; valid proof export accepted                | [m15-02-export-validation.test.sql](../../apps/infrastructure/tests/m15-02-export-validation.test.sql)   |
| Correction and audit failure atomicity                                                             | [m15-02-audit-atomicity.test.sql](../../apps/infrastructure/tests/m15-02-audit-atomicity.test.sql)       |
| Case variants, active-email matching, due expiry and unchanged hot reads                           | [m15-02-seat-expiry.test.sql](../../apps/infrastructure/tests/m15-02-seat-expiry.test.sql)               |
| No-op source changes, exact deltas, unavailable overflow and preserved source quota authority      | [m15-02-source-transitions.test.sql](../../apps/infrastructure/tests/m15-02-source-transitions.test.sql) |
| Source ownership, generated/ledger deduplication, tenant ownership move and physical size delta    | [m15-02-generated-storage.test.sql](../../apps/infrastructure/tests/m15-02-generated-storage.test.sql)   |
| Two-session try-lock/busy result                                                                   | [m15-02-usage-concurrency.e2e.sh](../../apps/infrastructure/tests/m15-02-usage-concurrency.e2e.sh)       |

After local migration application, run the normal concurrency harness:

```sh
bash apps/infrastructure/tests/m15-02-usage-concurrency.e2e.sh
```

Its optional `M15_02_VALIDATE_CANDIDATE=1` mode is only for pre-application
rollback validation. It compiles candidate DDL and omits the initial backfill so
that the candidate transaction does not already own the tenant lock being
contended. This exception belongs to the test harness, never deployment.

Record actual migration/type digests, catalog/grant/RLS checks, gauge readiness,
API authorization and replay results, PostgREST timeout behavior, source growth
concurrency, browser downloads, offline and load results in the feature's
verification record. The runbook itself is not a claim that those gates passed.
Use the full repository verification gate before declaring rollout complete.

## Rollback

Retain the meter, admissions, signed licence state, immutable receipts and M13
chain. There is no destructive down migration. Do not reset versions, decrement
issuance/policy revision, repair the historical migration ledger or delete bytes
as a presentation rollback.

Roll API/web back only to an M15-01 enforcement-compatible build. Keep source
quota guards, aligned tenant/admission lock order, existing protective
completion, renewal and authenticated evidence export available. Do not remove
source admission checks or deploy an ungated pre-M15 build.

If the projection presentation itself must be withdrawn, prepare a reviewed
CLI-created additive migration that changes only the two presentation wrappers:

- Replace their `m15_02_legacy_usage(p_organization_id)` call with the unchanged
  `m15_01_usage(p_organization_id)` aggregation.
- Return genuine source accounting readiness through
  `m15_01_storage_accounting_ready(p_organization_id)` rather than claiming that
  an unavailable projection is ready.
- Preserve each wrapper's authorization, state/history envelope and public
  signature. Retain all M15-01 hard-limit functions and all accumulated meter/
  admission/audit rows. Source aggregation may be slower; measure the rollback
  read path and keep diagnostics availability explicit.

Disable or roll back the new usage UI/API together if their compatible snapshot
path is unavailable. Keeping the additive schema and source maintenance allows
later repair/redeployment without destroying evidence. Recheck quota denial,
renewal, retained reads, protective completion and authenticated evidence export
on the chosen compatible build.

## Final timestamp migration provenance

Apply `20261013123855_m15_02_meter_timestamp_maintenance.sql` after the three authority/operation/lifecycle migrations. It explicitly installs the standard `set_updated_at` trigger on the new projection, accepts the identical existing trigger and stops on a conflicting catalog definition. The frozen first authority migration is preserved; no historical ledger entries are repaired. The rollout was checked through a selected CLI dry run/apply and both type copies regenerated through `db:types`. This fourth migration was a no-op on the verified local catalog and changes no quota functions or row data.

Run `bash apps/infrastructure/tests/m15-02-meter-timestamp.e2e.sh` for rollback-only creation/replay/conflict validation, and `bash apps/infrastructure/tests/m15-02-usage-concurrency.e2e.sh` for two-session repair contention. Neither commits fixture data.
