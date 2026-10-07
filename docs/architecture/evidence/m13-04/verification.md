# M13-04 verification record

Baseline: `milestone-1` at `cbcb296ea95b8a5d54e12718faf7654348b1f0e2`. Changes remain uncommitted. This record separates executed evidence from remaining deployment validation.

## Delivered behavior and requirements

Four `/api/v1/audit/chain-verifications` routes create/replay, read, cancel and resume an authorized frozen range. A bounded worker records progress and precise structural breaks; source authorization precedes evidence/progress disclosure. Every logical access and workflow effect has a durable, explicitly unchained security receipt. Existing M13-02 CLI and M13-03 selected-event verification/export contracts remain separate.

| Requirement | Concrete test evidence | Executed result |
| --- | --- | --- |
| FR-AUD-011 canonical content, hashes, continuity and anchors | [kernel specs](/Users/abjmac003/Documents/GitHub/CRA/apps/api/src/audit/range/audit-range-kernel.spec.ts), [shared hashing specs](/Users/abjmac003/Documents/GitHub/CRA/apps/api/src/audit/audit-chain-row-verification.spec.ts), existing CLI characterization | Exact UTF-8 bytes and large numbers; all break categories; original requested range, frozen partial boundary and verified prefix tested. Existing 23 CLI characterizations retained. |
| Precise bounded diagnostics without false completeness | [range contracts](/Users/abjmac003/Documents/GitHub/CRA/packages/contracts/src/audit/schemas/audit-range-verification.schema.spec.ts), kernel/worker specs | At most 100 breaks/samples; compressed gaps; cap ends incomplete; consistency requires completed full requested inspection and matching supplied checkpoint. Authenticity/complete-ledger assertions are rejected. |
| Current tenant/source authorization and hidden results | Use-case/repository/denial specs; [live workflow SQL](/Users/abjmac003/Documents/GitHub/CRA/apps/infrastructure/tests/m13-04-audit-range.test.sql), [HTTP integration](/Users/abjmac003/Documents/GitHub/CRA/apps/api/test/audit-range.e2e-spec.ts) | Organization/requester binding, denied access, replay disclosure reauthorization, stale-source resume, hidden counts/boundaries/checkpoint comparisons and failure-before-disclosure tested. |
| Corruption, missing/truncated rows and durable independent auditing | [disposable tamper fixture](/Users/abjmac003/Documents/GitHub/CRA/apps/infrastructure/tests/m13-04-audit-range-tamper.fixture.sql), [checkpoint fixture](/Users/abjmac003/Documents/GitHub/CRA/apps/infrastructure/tests/m13-04-checkpoint-revalidation.fixture.sql) | Canonical/hash tampering, interior missing row, truncated tail, absent head, checkpoint/predecessor mutation and security receipts exercised only on synthetic disposable databases. Tamper fixtures are excluded from normal `*.test.sql` discovery and guarded by database name. |
| Snapshot invalidation, replay, cancellation, restart and transactional failure | [real two-connection runner](/Users/abjmac003/Documents/GitHub/CRA/apps/infrastructure/tests/m13-04-audit-range-concurrency.e2e.sh), workflow SQL and worker specs | Sixteen concurrency assertions passed: late committed source changes, top-level/subtransaction IDs, rollback, old/new tenant moves, cancellation and lease fencing, restart, and concurrent same-UUID reads producing one immutable receipt. Receipt failure rolls back critical effects. Real RPC limit cases reject 251 rows, one-byte authorization/page batches, and a next batch beyond one million events without partial progress/version/lease effects; byte/event failures persist safe security receipts. |
| Empty, legacy, unsupported versions, unavailable checkpoints and restored datasets | Kernel/schema specs and disposable fixtures | Distinct non-green classifications, trusted boundary checks, operator epoch rotation/replay, database identity invalidation and resumed anchor checks tested. No retained audit history was repaired or deleted. |
| UI, accessibility behaviors and compatibility | [web unit specs](/Users/abjmac003/Documents/GitHub/CRA/apps/web/app/_features/audit/audit-range-panel.spec.tsx), [browser journey](/Users/abjmac003/Documents/GitHub/CRA/apps/web/e2e/m13-audit-range.spec.ts) | Owner/restricted access, checkpoint match, keyboard focus/submit, cancel/resume, actual worker completion, GET refresh `401 → 200 → 200`, organization switching and draft/error states exercised. |

The initial implementation slices observed RED before GREEN; subsequent reviews added regression tests for false consistency, hidden checkpoint comparisons, PostgreSQL version limits, stale source resume and lease/anchor failures. The supplemental disposable characterization fixtures were authored after database implementation and are not claimed as pre-implementation RED evidence.

## Executed verification and coverage

- Final `pnpm verify` exited successfully after all corrections (`/tmp/cra-m13-04-verify-complete.log`): lint, types, architecture/dependency gates, unit suites and production builds. API **407 suites/4,326 tests**, web **196 files/1,375 tests**, contracts **72 files/645 tests**; no dependency violations across **2,060 modules/6,101 dependencies**.
- Full `pnpm test:live` exited successfully: 121 infrastructure SQL files, API six suites/18 tests, and auth shell 33 passed/zero failed (`/tmp/cra-m13-04-test-live-complete.log`): final repeat includes the new real database limit assertions.
- Independent focused API review: nine suites/97 tests passed. Final independent review found no unresolved high/critical findings in the inspected database/API/kernel/UI flows; all final repository and live gates were rerun after corrections.
- Contracts: 17 focused tests; 100% statements/functions/lines, 97.91% branches. Public optimistic versions are bounded to PostgreSQL integer maximum `2,147,483,647`.
- Web: 26 tests across five files; 100% statements/functions/lines, 97.41% aggregate branches. Each reported module exceeds 80% all metrics; query hook branches 92.85%, panel branches 97.10%, other UI modules 100%.
- API adapter/presentation/application: 41 focused tests; 100% statements/functions/lines, 96.92% aggregate branches. Per-module report includes controller branches 92.85% and all modules above 80% all metrics.
- Worker/entrypoint plus retained CLI characterization: 43 focused tests, including 23 existing CLI cases. Worker 100% statements/functions/lines and 95.12% branches; worker entrypoint 100% all metrics.
- Range kernel: 19 focused tests; 100% statements/functions/lines, 99.11% branches. Shared hashing helper coverage is 100% all metrics.
- Compatibility correction in M13-03 export generation: closed writers, backpressure I/O errors and early upload readers now settle/close cleanly rather than race or hang. Deterministic RED cases preceded the fix; 28 worker/archive tests across two suites passed. Materially changed export-worker coverage: 96.71% statements, 93.61% branches, 92.30% functions and 97.94% lines (`/tmp/cra-m13-04-export-worker-regression.log`).
- Real database limit/atomicity assertions passed inside retained-stack `BEGIN/ROLLBACK` fixture transactions (`/tmp/cra-m13-04-sql-limits-final.log`); only fresh synthetic fixture rows were affected.
- An independent reviewer checked the final limit handling and adaptive polling changes without finding a blocker.

Final repository and live-stack completion gates are green. The earlier final-repeat export failure exposed a genuine writer/read-stream lifecycle race; it was fixed with the deterministic compatibility regressions recorded above and the complete gates were rerun. No prior cached success was substituted for that rerun.

The rebuilt CRA API is running on port 3333 with the existing web origin `http://localhost:3100`; the dedicated range worker is running. Readiness checks observed the expected unauthenticated session rejection (401) and protected audit-page redirect (307). Other development origins and site storage were untouched.

## Browser evidence

Installed Playwright journeys passed on Chromium `151.0.7922.34`, Firefox `153.0`, and WebKit `26.5`, against **only `http://localhost:3100`**. They used isolated contexts and the seeded owner/restricted accounts. External browser requests were zero; unrelated sites' storage was preserved. WebKit keyboard navigation used its platform `Alt+Tab` convention. These engine checks do not establish a current/previous-major Chrome/Edge/Firefox/Safari compatibility matrix or WCAG certification.

| Evidence | Screenshot |
| --- | --- |
| Actual consistent range | Chromium panel (generated artifact removed during repository cleanup), Firefox panel (generated artifact removed during repository cleanup), WebKit panel (generated artifact removed during repository cleanup) |
| Cancellation | Chromium cancelled (generated artifact removed during repository cleanup) |
| Restricted access | Firefox denied (generated artifact removed during repository cleanup) |
| Tenant switching | WebKit organization switch (generated artifact removed during repository cleanup) |
| Integrity presentation, **injected response fixture** | Chromium integrity fixture (generated artifact removed during repository cleanup) |

Sanitized per-engine results are [Chromium](/Users/abjmac003/Documents/GitHub/CRA/docs/architecture/evidence/m13-04/screenshots/range-journey-chromium.json), [Firefox](/Users/abjmac003/Documents/GitHub/CRA/docs/architecture/evidence/m13-04/screenshots/range-journey-firefox.json), and [WebKit](/Users/abjmac003/Documents/GitHub/CRA/docs/architecture/evidence/m13-04/screenshots/range-journey-webkit.json). The integrity screenshot is a labelled UI fixture, not a claim that development audit records were corrupted. Real corruption checks ran only in disposable SQL fixtures.

Playwright MCP returned `Transport closed`; browser execution used the installed Playwright runner. This is not an MCP success claim.

## Supabase identity, alignment and limitations

Local CRA was confirmed through configuration and the local Supabase MCP project URL/metadata at `127.0.0.1:54321`. Available cloud projects were unrelated and untouched. [MCP results](/Users/abjmac003/Documents/GitHub/CRA/docs/architecture/evidence/m13-04/supabase-mcp-check.json) show successful local project/SQL metadata calls; security/performance advisors and PostgreSQL logs returned HTTP 502. Read-only catalog checks and database tests supplied the remaining local evidence.

After five additive migrations: PostgreSQL **17.6**, **279 public tables**, all with RLS, **zero FORCE RLS**, and **109 migration-ledger entries**. Exactly one persistent feature table was added, `audit_verification_jobs`; organization epoch/context fields are operator-owned and excluded from public/portable tenant projections. Generated types were refreshed through the existing CLI command into both copies. [Function alignment](/Users/abjmac003/Documents/GitHub/CRA/docs/architecture/evidence/m13-04/database-function-alignment.json) compares 26 live functions with local migration definitions and reports zero mismatches.

The historical **440 missing ledger entries** remain unchanged: the ledger moved from 104/544 to 109/549 local migrations. No blanket replay, ledger repair, database reset, live restore, chain re-hashing or retained evidence deletion occurred. Cloud deployment/schema alignment and MCP advisors/logs remain unverified.

## Actual bounded performance and egress evidence

[Range load results](/Users/abjmac003/Documents/GitHub/CRA/docs/architecture/evidence/m13-04/benchmarks/range-load.json) measure the actual PostgreSQL RPCs and Node worker/kernel through a persistent Docker `psql` connection on synthetic `m13_test_04_range_v2`. Authorization and cryptographic verification are included; PostgREST/HTTP transport is excluded. An old transaction remained open during the checks.

| Events | Completion | Elapsed | Throughput | Peak Node RSS | Status polling p95 / p99 |
| ---: | --- | ---: | ---: | ---: | ---: |
| 10,000 | consistent | 6.799 s | 1,471/s | 104.1 MiB | 57.03 / 57.03 ms |
| 100,000 | consistent | 58.977 s | 1,696/s | 103.0 MiB | 22.88 / 50.91 ms |
| 1,000,000 | consistent | 235.959 s | 4,238/s | 100.9 MiB | 3.38 / 6.30 ms |

Peak RSS is the driver/worker process, not database/container memory. These measurements do not establish production network capacity or concurrent million-row tenant throughput.

[Authenticated HTTP status measurements](/Users/abjmac003/Documents/GitHub/CRA/docs/architecture/evidence/m13-04/benchmarks/http-status.json) use Nest → PostgREST → retained local CRA: 50 sequential samples after five warmups, p95 **57.64 ms**, p99 **120.37 ms**, within the existing rate limit. This path meets the requested read targets in the measured local scenario; it is separate from the million-row disposable load and does not establish a simultaneous realistic mixed-tenant HTTP p95/p99.

[Two-tenant scheduler results](/Users/abjmac003/Documents/GitHub/CRA/docs/architecture/evidence/m13-04/benchmarks/tenant-fairness.json) show alternating batch claims, both tenants completing, cancellation **2.05 ms**, and a fenced stale worker. This is a sequential scheduler exercise, not sustained concurrent tenant load.

Actual process-scoped macOS outbound-egress blocking permitted required CRA loopback services and ran all three HTTP workflow integration tests successfully (`/tmp/cra-m13-04-egress-final.log`). Browser route blocking also observed zero external requests. Neither result claims a deployment-wide firewall audit or whole-host isolation.

## Deployment, restore and rollback runbook

1. Confirm the intended CRA environment, database identity, current migration ledger and application versions. Take existing backup/checkpoint precautions; do not reset or replay historic missing migrations.
2. Apply **only these five reviewed additive migrations in order**, using the repository's CLI-compatible migration workflow. Existing retained deployments with historical ledger gaps require narrowly scoped additive application; never use a blanket migration replay to resolve them.
   - `20261007090257_m13_04_audit_range_verification.sql`: single job table, markers, private RPCs, source invalidation and security receipts.
   - `20261007092500_m13_04_checkpoint_revalidation.sql`: bounded checkpoint/source revalidation and precise resume diagnostics.
   - `20261007093222_m13_04_operation_conflict_replay.sql`: deterministic business conflicts and concurrent receipt replay serialization.
   - `20261007093757_m13_04_resume_anchor_guards.sql`: frozen predecessor/cursor protection and stale-source resume.
   - `20261007094302_m13_04_private_dataset_export_projection.sql`: exclude deployment-local markers from portable tenant exports.
3. Run `pnpm --filter infrastructure run db:types`; both generated copies must agree. Run DB lint, SQL/RLS/transaction tests and function alignment. No data backfill is required; prior canonical bytes are preserved.
4. Deploy API, then `pnpm --filter api run worker:audit-range-verification` (use `-- --once` for one bounded cycle), then web. Keep M13-03 export workers and contracts intact. Limits: one million events; 250 rows/16 MiB per batch; two global slots/one tenant; 120-second leases; three recovery attempts; two pending per requester/ten per tenant.
5. For a separately authorized actual restore: pause writes/workers, drain transactions, restore through the approved operational procedure, then call `m13_04_rotate_dataset_marker(orgId, operationUuid, expectedEpoch, 'restored')` through the originating PostgreSQL operator identity before reopening. Preserve the prior checkpoint offline. API/service-role callers cannot rotate the marker. An unmarked identical restore cannot be identified by hashing alone.
6. Rollback disables the new panel/routes/worker and retains additive schema, jobs, markers and durable receipts. Resume existing M13-03 behavior. Do not purge jobs/evidence, change audit records, repair chains, delete source data or reset storage.

## Residual limits

Hash and link checks establish consistency of the inspected bytes against the captured/supplied boundaries. They do not prove authenticity, completeness of an entire ledger, resistance to total privileged rewriting, external notarization, legal certification or absence of all bugs. Unknown/deleted/hidden source evidence deliberately produces scope-unavailable rather than a partial green result.

Production-scale concurrent mixed-tenant HTTP load, combined database/container memory, current/previous-major named-browser coverage, exhaustive WCAG 2.2 AA evaluation, cloud alignment, and MCP advisors/logs remain deployment validation. No automatic repair, external checkpoint service or new generic job framework was introduced.
