# M13-02 completion evidence and operations

Recorded 2026-10-06 against `milestone-1` at `1933cfb` plus this uncommitted
implementation. Local CRA only: Supabase `http://127.0.0.1:54321`, PostgreSQL
17.6, container `supabase_db_cra`. No cloud project, development reset,
production restore, commit or push was performed.

## Delivered boundaries

Existing `audit_logs` is the event store. The only added table is
`audit_chain_heads`. A deferred private finalizer protects accepted tenant
inserts, including existing legacy-format writers. Organization-less security
events remain append-only without a global chain. `AuditService.log()` remains
best-effort; `recordV2()` remains durable and idempotent. Neither API signatures
nor source-owned authorization decisions were changed.

The three migrations are `20261006081752`, `20261006081818`, and
`20261006084112`. The last corrects canonical helper volatility declarations;
it does not change serialization or hashes. Types were generated through
`pnpm --filter infrastructure run db:types`, updating both copies.

## Canonical v1 and activation

Canonical bytes are UTF-8 JSON, without Unicode normalization. Object keys
are ordered by UTF-8 bytes; arrays retain order. JSON escaping follows the
PostgreSQL JSON scalar serializer. Explicit nulls are retained. JSONB numeric
values use exact decimal arithmetic, expanded exponent notation and removed
insignificant trailing zeroes; negative zero becomes zero. Do not parse and
reserialize canonical content through JavaScript numbers. Finite UTC event
timestamps have exactly six fractional digits. Sequence is a decimal string.

The fixed envelope contains `action`, `actor_email`, `actor_id`, `actor_type`,
`after_redacted`, `before_redacted`, `chain_sequence`, `chain_version`,
`changes`, `correlation_id`, `created_at`, `entity_id`, `entity_type`,
`event_key`, `event_scope`, `id`, `ip_address`, `organization_id`, `outcome`,
`reason`, `redaction_version`, `schema_version`, `user_agent`, and `user_id`.
Future fields require a new canonical version. Finalization runs after existing
redaction/provenance triggers. Genesis is 32 zero bytes (64 hexadecimal zeroes).
Hash is SHA-256 of binary previous hash followed by canonical UTF-8 bytes.

Golden fixtures live in `apps/infrastructure/tests/m13-02-audit-chain.test.sql`.
The full-envelope genesis fixture hashes to
`f010556bd4f771dd0e9fa71956a6283f6c814e695d65fff2f44f05ed9010fb2f`.
The fixture covers explicit nulls, decomposed Unicode, decimals and microseconds.

Legacy rows were not backfilled. Before activation the 1,035 retained rows had
digest `c2720baeb7e8490295941706b76766b98d33942656876681858fa3e798552cd0`;
after activation the same legacy row projection had the identical digest.
`artifacts/m13-02/legacy-baseline.txt` records it. Tenant activation timestamps
and frozen legacy counts distinguish historical evidence from chained evidence.
New organization-less rows also have null chain fields, so current null-field
counts must not be presented as activation inventory.

## Requirement-to-test mapping

| Requirement | Evidence |
| --- | --- |
| FR-AUD-002 append-only; actual grants and indirect mutation paths | `m13-02-audit-chain.test.sql`: UPDATE/DELETE/TRUNCATE, forged metadata, private helper ACLs, actor deletion, organization RESTRICT |
| FR-AUD-003 chain and deterministic canonical content | Same SQL suite: golden bytes/hash, decimals/Unicode/timestamps, replay/conflict, subtransaction rollback, multi-row inserts, forced constraints, corrupted head |
| Concurrent tenants and mixed-tenant ordering | `m13-02-audit-chain-concurrency.e2e.sh`: 120 events/12 writers, contiguous chain, independent tenant progress and opposite insert order |
| FR-AUD-010 longest retention, uncertainty and legal hold | `m13-audit-retention-lifecycle.test.sql`: 20 assertions covering extensions, reductions, incomplete sources, holds, claim/completion blocking and preserved tenant data |
| Exports preserve chain evidence | `worker/export-archive.spec.ts`, existing infrastructure export tests and retention migration projection |
| Bounded verifier, parsing, malformed/corrupted data and exit status | Audit chain schema specs; verifier, CLI, adapter and composition-root Jest specs |
| Restored evidence remains meaningful | `m13-02-backup-restore.e2e.sh`: identical canonical-byte digest, regenerated canonical/hash checks, links, sequences and snapshot heads; owners and ACLs preserved |
| Existing auth, tenant and permission behavior | Live API 4 suites/10 tests; auth-flow 33 checks; Playwright owner/viewer journeys; full `pnpm verify` |

Final `pnpm verify` passed: lint, types, architecture gates, unit tests, complete
infrastructure SQL suite and production builds. See
`artifacts/m13-02/verify-complete.log`. Focused audit regression: 78 tests in 14
suites. New verifier/composition modules: 98.41% statements, 96.66% branches,
100% functions and 99.16% lines; pure verifier 100%. Composition root alone
94.73% statements/87.5% branches. Shared audit schemas: 7 passing tests.
SQL lint passed its error gate; existing warnings and unused arguments in the
now-blocked purge function remain recorded in `db-lint-final.log`.
Independent read-only review found no unresolved high/critical issues.

## Browser and live database evidence

Playwright MCP used only CRA development origin `http://localhost:3100` with
seeded owner/viewer accounts. The other site on port 3000 was untouched.
Owner sign-in/sign-out, unchanged branding draft save, organization switch and
switch-back passed. Forged organization switch returned 404. Viewer settings
mutation returned 403. The unchanged draft save intentionally created a draft
version and audit event; it did not publish branding or create an organization.

Screenshots in `artifacts/m13-02/`: `owner-branding.png`,
`owner-org-switch.png`, `viewer-forbidden.png`, `archival-blocker-fixture.png`.
The archival screenshot uses an explicitly intercepted lifecycle response to
exercise presentation, without suspending or purging a real tenant. Actual
claim/completion blocking is exercised by transactional SQL tests. The viewer
screenshot shows the existing organization page; the denial was asserted on
the API response. Production build temporarily disturbed Next dev generated
files; restarting only our port-3100 server restored UI sign-out/sign-in.
Existing demo dashboard `/api/orders` requests return 404 with mocks off;
this work does not implement that demo backend.

Final local Supabase MCP cross-check: four chained events across two tenants,
zero canonical/hash mismatches; both heads matched their retained tails.
Service role cannot UPDATE, DELETE or TRUNCATE audit rows or UPDATE heads.
Zero public tables use forced RLS. Both tenant operator verifications returned
`verified`, `fullChain: true`; checkpoints are in `owner-chain-checkpoint.json`
and `switched-org-chain-checkpoint.json`. Retention remains explicitly unknown
until source reconciliation; that is conservative and never permits purge.

## Measured performance and limits

`artifacts/m13-02/load.json` records disposable-database measurements, using
12 writers and 20 events per transaction, 2,400 events per scenario. Same-tenant
insert+commit p95/p99: 127.264/142.596 ms. Independent-tenant p95/p99:
42.341/74.601 ms. All sequences and hashes verified. A 1,000-event verification
page was 2,154,099 bytes; 20 samples had p95 336.303 ms and p99/max 2,762.497 ms,
including one outlier while the full verification workload shared the machine.
The RPC caps pages at 1,000 events and 16 MiB. These are PostgreSQL client
timings, not production API SLO or process-memory evidence.

Fifty sequential authenticated development-proxy organization reads all returned
200: p50 80 ms, p95 113 ms, p99 142 ms. These are local smoke measurements;
realistic production concurrent API latency and peak memory remain unmeasured.
No claim of universal p99 compliance, zero bugs or legal certification is made.

## Rollout and migration history

The original stack had 97 recorded migrations against 537 local files. The
missing 440 are pre-existing; do not reset or repair history for this ticket.
After three new migrations the corresponding totals are 100 and 540.

For an equivalent local rollout:

1. Confirm project URL/container and branch. Pause relevant application writers
   during activation. Inventory legacy rows, grants, constraints and head state.
2. Create migration files with the existing CLI. Review only additive ledger
   changes and ledger-local guards; never introduce global FORCE RLS.
3. If existing local history is discrepant, build a temporary Supabase workdir
   containing the existing config, exactly the locally available applied files
   named in live history, and these new migration files. Confirm a CLI dry-run
   lists only the new migrations. Do not use `--include-all`, reset or repair.
4. Apply through the existing Supabase CLI, regenerate types, verify unchanged
   historical row digest, privileges, activation records, and a canary chain.
   Resume writers only after successful verification.

Execution deviation: a review agent unexpectedly applied the first two approved
migrations and a canary directly to the confirmed local stack. It was stopped;
the resulting schema and data were verified. The third migration was applied
through CLI using the scoped temporary workdir above. No old migration history
was repaired. CLI-created source files are the reviewable rollout artifacts.

## Operator, retention and archival runbook

Build contracts/API first. Supply `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` through the existing secret environment; never put
credentials in command arguments, reports or checkpoints. Run:

```sh
pnpm --filter api run verify:audit-chain --organization <uuid> --page-size 250 --max-events 100000
```

Optional `--from` and `--to` are decimal strings. The verifier captures a fixed
upper sequence and validates range/predecessor. Failure or exhausted budget
exits nonzero; partial-range success has `fullChain: false`. Reports contain
checkpoint metadata, never event bodies. A database snapshot/head mismatch,
gap, unsupported version or altered retained/canonical bytes requires incident
review, not a head rewrite. Preserve the original evidence and external anchor.

Invoke service-role RPC `m13_02_refresh_audit_retention_atomic(org_uuid)` as an
explicit reconciliation transaction when source projections are fresh. This
reads M1/M2/M8 authorities outside the append critical section, then only
extends dates/durations. Missing/stale (>24 hours)/incomplete sources yield
unknown, retain known protection and retain holds conservatively. Only complete
source-domain state can release a hold. No scheduler or implicit reconciliation
was introduced; repeat operationally after source changes. No retention state
allows physical purge in this delivery.

Future archival requires approval from the evidence/hold authorities and
security operations, complete source reconciliation, full-chain verification,
an independently custodied checkpoint (organization, version, activation,
sequence, hash and capture time), immutable canonical evidence/activation/head
export, and an isolated restore proving the same bytes and links. Define a
reviewed signed chain-start/checkpoint continuation before deleting any prefix.
No archival deletion or application purge path exists here.

For restore verification, run the harness only with a fresh explicit
`M13_TEST_DATABASE=m13_test_<unique_suffix>`. It refuses an existing/non-test
database. It streams the dump without retaining user-data dumps and restores
owners/ACLs via local deployment administrator into that new database only.
Then run concurrency/load checks there. Remove only that named test database
after review; never restore over development or remove live audit rows.

After any protected event exists, rollback must preserve audit rows, chain
columns, heads, grants/guards and RESTRICT. Keep lifecycle purge blocked.
Recover via a reviewed forward migration; do not disable guards or recanonicalize
old evidence. A full database administrator can rewrite an entire chain unless
an independently trusted external checkpoint survives. Chaining demonstrates
tampering against an anchor, not the semantic truth of privileged submissions.

All eleven confirmed task-owned disposable restore/debug databases were removed
after evidence capture. Development audit rows and unrelated site data were
preserved. See `artifacts/m13-02/verification-summary.json`.
