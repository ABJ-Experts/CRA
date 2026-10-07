# M13-03 implementation and verification

Development baseline: `milestone-1`, `7d686f18a15f9f0c26408273b406a11d8c7f67cf`.
Implementation remains uncommitted. Existing durable and best-effort audit writer
contracts and M13-02 canonical bytes are preserved. No source data was reset or
deleted, no cloud project was changed, and other sites' browser storage was not
cleared.

## Design and contracts

- [Feature design](../../m13-03-audit-search-export.md)
- [Implementation plan](../../../superpowers/plans/2026-10-07-m13-03-audit-search-export.md)
- [Wire schemas](../../../../packages/contracts/src/audit/schemas/audit-explorer.schema.ts)
- [Trusted types](../../../../packages/contracts/src/audit/types/audit-explorer.type.ts)
- [Application policy](../../../../apps/api/src/audit/application/audit-explorer.use-cases.ts)
- [Source permission registry](../../../../apps/api/src/audit/audit-source-policy.ts)

Functional React uses an injected gateway and the existing authenticated
transport. Controllers parse inputs and outputs and delegate to application
policy. Infrastructure owns RPC and private Storage access. Exactly one new
table, `audit_export_jobs`, holds deployment-local jobs, leases and rotating
grant digests. Snapshots and logical access receipts use existing durable audit
evidence. The tenant export registry explicitly excludes this local workflow.

## Requirement-to-test mapping

| Requirement | Evidence |
| --- | --- |
| FR-AUD-004 durable logical access, replay/conflict, fail closed | `apps/infrastructure/tests/m13-03-audit-explorer.test.sql`; `apps/api/src/audit/audit-explorer.use-cases.spec.ts`; `audit-explorer-denied.filter.spec.ts`; `apps/api/test/audit-explorer.e2e-spec.ts` |
| FR-AUD-005 filters, frozen high-water, concurrent append, stable paging | `apps/infrastructure/tests/m13-03-snapshot-concurrency.e2e.sh`; `m13-03-permission-cache.test.sql`; HTTP boundary suite; `packages/contracts/src/audit/schemas/audit-explorer.schema.spec.ts` |
| FR-AUD-006 typed JSON, hostile CSV, detached manifest, independent verification | `apps/api/src/audit/worker/audit-export-archive.spec.ts`; `audit-export-worker.spec.ts`; included `verify.mjs`; real browser packages under `artifacts/m13-03/` |
| Separate audit/source access, tenant forgery, hard overrides, hidden scope | SQL explorer and permission-cache suites; `audit-source-policy.spec.ts`; HTTP owner/viewer denial tests; revoked source lookup before delivery |
| Private delivery, corruption before bytes, owned temp cleanup | `apps/api/src/audit/infrastructure/audit-export-storage.adapter.spec.ts`; repository real artifact fixture; controller cookie tests; browser download journey |
| Retry, lease/version conflicts, selected-row drift, ambiguous upload/completion | Worker and job-repository suites; rollback-only SQL lifecycle suite |
| Auth/API/menu/architecture compatibility | `pnpm test:live`; public-route and permission coverage gates; menu parity, middleware and transport tests; `pnpm test:architecture` |
| Accessible states and focus restoration | `apps/web/app/_features/audit/audit-explorer.spec.tsx`; gateway/query tests; browser side-panel and Escape focus checks |

Adversarial offline tests rebuild a coherent unsigned manifest after changing
canonical attribution or exported sequences. The verifier must still reject
proof/event mismatches. Ordinary events-file or manifest corruption must fail
before any successful verification report.

## Verified local database and runtime

Identity: `apps/infrastructure/supabase/config.toml` selects `project_id = "cra"`;
local API `http://127.0.0.1:54321`, database port 54322. The local MCP
`get_project_url` confirmed this identity. Available cloud projects did not match
CRA and were not used.

Read-only catalog inspection covered all 277 baseline public tables, 968 foreign
keys, 1,179 indexes, 302 triggers, 1,321 functions, 47 policies, 3,627 grants and
six extensions. Baseline public tables had RLS enabled without FORCE. PostgreSQL
is 17.6. The new jobs table also has non-forced RLS, no browser table grants,
pinned function search paths and explicit service-role RPC grants. The
`audit-exports` bucket is private.

Four additive CLI-created migrations were applied only to confirmed local CRA:

1. `20261007055032_m13_03_audit_explorer_exports.sql` — jobs, RPCs and private bucket.
2. `20261007062233_m13_03_audit_read_permission_cache.sql` — private trusted permission cache and indexed paging lanes.
3. `20261007064923_m13_03_export_job_updated_at.sql` — standard timestamp trigger.
4. `20261007073637_m13_03_snapshot_permission_lock_order.sql` — avoids a demonstrated snapshot/RBAC writer deadlock without changing grants or signatures.

The retained database had 100 ledger entries versus 540 local migrations before
this work. It now has 104 versus 544; the **440 historical ledger discrepancies
remain unchanged**. No blanket migration replay or ledger repair occurred.
Both generated type copies were regenerated through the existing CLI command.
Old audit row fingerprints were unchanged during migration validation.

Local MCP table/advisor/log/type calls were attempted. Metadata calls initially
worked selectively, but later returned HTTP 502; log support was unavailable.
Catalog SQL, database lint, container logs, CLI type generation and live tests
provided local fallback evidence. Cloud advisors and remote deployment alignment
are unverified.

The retained Storage schema was at migration 72, while the CLI-selected
`storage-api:v1.67.20` image only understood 60. Its uploads failed with an index
conflict. The already cached, previously compatible `v1.77.0` runtime was restored
using the same CRA network, environment and volume. No image was downloaded and
no Storage schema/index workaround or new migration was applied. The old stopped
container was retained for recovery. Subsequent private uploads succeeded.
Future CLI starts must retain a compatible runtime; otherwise this drift recurs.

## Measured performance and limits

The rollback-only `m13-03-read-load.e2e.sh` fixture measured 100 samples on 10,000
tenant audit rows: database durable-receipt-plus-page p95 **9.60 ms**, p99
**10.53 ms**, max **11.45 ms**. Average receipt append was 6.90 ms and page read
1.61 ms. This measures database work, not total network/API latency. A cold
stale-statistics run had a 2.4-second outlier; accurate statistics restored the
indexed 50-row scan. Statistics maintenance matters.

A production worker with fake repository I/O and disk storage generated 100,000
events in approximately 1.425 seconds, with peak RSS about 158 MiB and package
size 122,654,062 bytes. This checks file generation bounds; it **excludes real
database and Storage I/O**. It is not a production throughput promise. Real
100,000-row tenant export query/upload load and multi-tenant sustained fairness
benchmarks remain deployment validation work.

A browser burst reached the existing HTTP 429 rate limit; it was not treated as
a successful latency benchmark and throttling was not weakened.

A separate paced 20-request HTTP measurement through the Next proxy, Nest and
Supabase, including durable page receipts, completed without throttling on the
retained small tenant: p50 **85.22 ms**, p95 **219.94 ms**, p99/max **244.89 ms**.
Raw results are in `artifacts/m13-03/http-latency.json`. This small sample is a
development smoke measurement, not the 10,000-row production HTTP load gate.

## Deployment and rollback runbook

1. Confirm target CRA development identity and inspect retained schema/ledger.
   Resolve environment compatibility independently of historical ledger drift.
2. Apply only the four reviewed additive migrations through the normal CLI
   deployment process on an aligned target. Do not replay missing historical
   migrations merely to normalize the ledger. No audit backfill is required;
   pre-activation legacy evidence stays unchained and labeled explicitly.
3. Run `pnpm --filter infrastructure run db:types`; commit both generated copies
   with the reviewed change when authorized. Run `db:lint`, SQL suites and
   architecture gates before deployment.
4. Build API and contracts. Run the worker with
   `pnpm --filter api run worker:audit-export`; use `--once` for controlled local
   validation. Keep worker credentials server-only. Two global slots and one
   active job per tenant are enforced by RPC coordination, not browser state.
5. Deploy API/worker, then web. Verify grants, private Storage, source access,
   hashes, snapshot replay and auth refresh against the target environment.
6. Roll back code by stopping the worker and reverting the explorer route/menu
   deployment. Retain additive schema, jobs, artifacts and durable receipts.
   Do not delete evidence or repair/reset the database as a rollback action.
   Expired grants cannot deliver; queued jobs remain available for a compatible
   worker. Generation leases expire after 120 seconds and allow bounded retries.

## Verification record and residual limitations

Focused contracts, application, worker and UI suites exceeded 80% on statements,
branches, functions and lines. Contracts reached 100%; application approximately
98/88/99/99%; worker module branch coverage ranges from 82.35% to 92.85%; UI reached approximately 97/92/98/97%. Every new/materially changed module met all four 80% thresholds.
`pnpm test:live` passed the full SQL suite, API live tests and 33 authentication
shell checks. Final command results are recorded below.

Hashes establish consistency of supplied bytes. An unsigned manifest and a
filtered set of event proofs do not establish completeness or authenticity
against a malicious party replacing the package and manifest together. A trusted
external checkpoint is required for that stronger claim. Proofs are unavailable
when canonical fields cannot all be disclosed; legacy rows remain unchained.
Download authorization proves authorization before streaming, not receipt of all
bytes by a browser. Unknown or deleted source scope fails closed.

Chromium, Firefox and WebKit passed the real development flow. Current/previous Chrome, Edge, Firefox
and Safari version-matrix certification is not claimed. Browser-only egress
blocking is distinct from a system-wide network-isolation test. No zero-bug or
legal-certification claim is made.

Playwright MCP exercised the real CRA owner and restricted contexts, filters,
empty results, details, verification, queued/ready states and focus restoration.
Its transport subsequently closed. Remaining browser journeys use the installed
Playwright runner and isolated contexts restricted to CRA development URLs.
The runner's output is redirected to an owned temporary directory; existing
tracked test artifacts are preserved.


## Final evidence

The real two-connection snapshot/RBAC regression first reproduced a PostgreSQL
deadlock, then passed after the fourth migration. The snapshot now acquires the
tenant chain advisory lock before reading the committed permission version,
without a conflicting version-row share lock. Current permission checks and
subsequent snapshot invalidation remain mandatory. Both regression transactions
rolled back, and membership/version fingerprints stayed identical.
See `apps/infrastructure/tests/m13-03-snapshot-permission-concurrency.e2e.sh`.

Chromium, Firefox and WebKit exercised owner login, viewer denial, filters,
detail, real verification, GET refresh, both asynchronous formats, private
cookie-grant download and independent included verifier execution. Deliberate
package corruption failed verification. These are installed-engine development
checks, not certification of every current/previous vendor version. Firefox and
WebKit results: two passed in 24.9 seconds; Chromium: one passed.

- [Explorer screenshot](../../../../artifacts/m13-03/m13-audit-search-results.png)
- [Detail screenshot](../../../../artifacts/m13-03/m13-audit-detail-panel.png)
- [CSV ready screenshot](../../../../artifacts/m13-03/m13-audit-csv-ready.png)
- [JSON ready screenshot](../../../../artifacts/m13-03/m13-audit-json-ready.png)
- [Independent API download verification](../../../../artifacts/m13-03/api-proof-results.json)

The independently downloaded CSV and JSON packages each checked one canonical
event proof and artifact hashes. Both explicitly report completeness and
authenticity as unproven. Repeated cross-browser fixtures can also contain
honestly unavailable proofs; the UI and manifest retain that distinction.

Final `pnpm test:live` passed: the 120-file SQL suite, five API live suites
(15 tests), and all 33 authentication shell checks. `db:lint` exited successfully
with only pre-existing warnings. The final catalog confirms 104 migration ledger
entries, non-forced job RLS, and a private export bucket.

The final root run also exposed a test-only React Query teardown leak after all
assertions passed. Explicit hook cleanup, query cancellation, cache clearing
and timer-free test clients now complete before jsdom globals are restored.
The focused 30-test audit UI suite passed after that repair.

Final `pnpm verify` exited 0 after the cleanup repair: lint, types, architecture
gates, 399 API unit suites (4,239 tests), 191 web unit files (1,349 tests),
71 contracts files (628 tests), remaining workspace suites and production builds
passed. `git diff --check` passed. Changes remain uncommitted; no push occurred.
