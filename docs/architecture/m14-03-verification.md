# M14-03 verification evidence

Evidence date: 2026-10-09. Development baseline: `milestone-1` at `86afce5238f4704ee8ac237d41ba3b98429a6440`. This document records observed results and remaining verification limits; it is not a conformity certificate or a zero-defect claim.

## Scope and traceability

The [coverage matrix](/Users/abjmac003/Documents/GitHub/CRA/docs/architecture/m14-03-export-coverage-matrix.md) identifies production sources, native query schemas, context, approved columns, permissions, scopes and rendered controls. The live shared-contract/source-policy comparison passes for **120 registered production list sources**. This is registry coverage; it does not mean 120 independent browser journeys were executed.

The implementation follows the [feature design](/Users/abjmac003/Documents/GitHub/CRA/docs/architecture/m14-03-feature-design.md). Cross-application contracts are [feature-first Zod schemas](/Users/abjmac003/Documents/GitHub/CRA/packages/contracts/src/exports/schemas/index.ts), with trusted wire types derived in [exports/types](/Users/abjmac003/Documents/GitHub/CRA/packages/contracts/src/exports/types/index.ts). Views use the [gateway](/Users/abjmac003/Documents/GitHub/CRA/apps/web/app/_features/exports/exports.api.ts); controllers delegate through application ports and Supabase adapters. Member routes remain under `/api/v1`; scoped portal routes reuse their existing session namespaces.

| Requirement                                                                                       | Implementation and exercised evidence                                                                                                                                                                                                                                                                                                                                                                                                | Verification boundary                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1 / FR-AN-006: filtered list coverage, native filters/order, explicit scope and approved fields | `export-bindings.spec.ts`; `m14_03-registry-policy-parity.mjs`; `m14_03_operational_static_parity.mjs`; source-owned domain/nested/history SQL fixtures; populated `m14_03-sbom-source-parity.test.sql` for all 20 SBOM/vulnerability sources. Default `all_filtered`; page/selection only when the registry allows them.                                                                                                            | The registry and rendered bindings are checked for every registered source. Browser journeys are representative rather than one per source.                                                                                  |
| AC2: reproducible capture and fresh delivery authorization                                        | `m14_03-export-persistence.test.sql` checks mutation after capture, immutable rows, idempotency mismatch, capture publication, stale worker fencing, hidden columns, field withdrawal, tenant substitution, session revocation and one-time grants. Portal SQL fixtures check scoped identity and expiry. Application/download tests reauthorize after storage acquisition.                                                          | These are real local SQL transactions plus mocked policy/transport tests and real owner delivery. They are not production IAM certification.                                                                                 |
| AC3: CSV/XLSX fidelity and explicit limits                                                        | `export-renderer.spec.ts` exercises Unicode, quoting, formula-like content, typed booleans/dates, precision and cell overflow. Independent Python CSV/openpyxl parses real downloaded owner artifacts and synthetic SQL-to-wire numeric artifacts. Parts have bounded rows/bytes; overlong XLSX cells require CSV instead of truncation.                                                                                             | Independent parsing used openpyxl 3.1.5, not desktop Excel/Numbers/LibreOffice.                                                                                                                                              |
| AC4: bounded resumable jobs, private files and durable access evidence                            | Worker/storage tests cover partial checkpoints, restart without recapture, byte/hash corruption, failed upload, revocation, cancellation, timeout classification and stale leases. SQL fixtures verify service-only grants, private bucket, non-forced RLS, durable audit publication and delivery records. A million-row job rejects before row reads or upload. Repeated verification creates no unused delivery streams.          | Synthetic rendering/capture measurements below do not establish production API percentiles or long-duration tenant fairness.                                                                                                 |
| AC5 / FR-AN-007 and FR-AN-009: documentation-readiness report and provenance                      | Canonical [M7 readiness schema](/Users/abjmac003/Documents/GitHub/CRA/packages/contracts/src/technical-files/schemas/technical-file-readiness.schema.ts), readiness renderer and domain SQL tests. Real browser readiness download contains PDF plus JSON, 8 canonical sections, zero gaps in the exercised seed fixture and 2 source-version entries. Independent PDF text/JSON parsing confirms the documentation-only disclaimer. | The exercised ready fixture does not demonstrate every possible missing/stale/expired-evidence combination in a browser. Unit/SQL cases cover degradation and restricted evidence; no approval or certification is produced. |
| AC6: edge cases and independent verification                                                      | Focused schema/policy/UI tests; real local rollback SQL fixtures; engine browser journeys; independent CSV/XLSX/PDF parsing; isolated benchmark scripts.                                                                                                                                                                                                                                                                             | Full current/previous branded-browser and production-load matrices remain unverified. See explicit limits below.                                                                                                             |

## Observed checks

The following focused runs passed. Counts overlap and must not be added together as unique tests.

- Source-policy/contract parity: 120 production sources. Permission parity: 8 scenarios over every contract permission key. Static catalogue and permission projections match their canonical sources.
- Populated native source parity: all 20 SBOM/vulnerability sources passed against the applied local database. Fixtures exercise native ordering/approved fields, component search, dependency parent, quality severity, diff change/search, supplier state, vulnerability search/include flags, feed filtering and forged-tenant denial. The separate history fixture verifies 115 rows across native cursor pages. Each transaction ends in `ROLLBACK`.
- Renderer/worker/gateway-related API regression run: 13 suites, 118 tests passed. Source projection, bootstrap and feed-policy modules have 100% statement/function/line coverage. Worker branch coverage was 81.90%; repository branches 90%; renderer branches 90.62%; readiness branches 91.66%. Every new module in that run exceeded 80% for all four metrics.
- Storage stream-close regression run: 7 suites, 62 tests passed. Storage adapter coverage: 98.52% statements, 100% branches, 92.30% functions and 100% lines. Repeated verification creates zero delivery read streams; delivery cleanup waits for close before deleting its private spool and is idempotent.
- Focused export UI run: 5 files, 28 tests passed; combined coverage 97.84% statements/lines, 93.10% branches and 100% functions. Each included export UI module exceeded 80% across the four metrics.
- API `tsc --noEmit` and focused typed ESLint passed after the test-boundary and stream-close fixes. The full `pnpm verify` rerun is a separate release gate and must be recorded from its final exit status, rather than inferred from these focused runs.

The local project is CRA at `http://127.0.0.1:54321`. New workflows use the private `filtered-exports` bucket, tenant-qualified jobs/rows, non-forced RLS and explicit service-role RPC grants. The additive numeric/retry amendment was exercised through the live `m14_03_export_scalar(jsonb)` helper; local generated types and final migration-ledger parity are checked by the deployment owner.

Final focused API auth/export/audit regression: 81 suites / 846 tests passed. Every collected new or changed module met at least 80% across statements, branches, functions and lines; member-controller branch coverage was 80%, portal-controller 84.44%, application policies 100%, source-context adapter 93.10%, member/portal repositories 85.71%/94.73% and audit-use-cases 97.50%. Counts overlap the individual runs above. The sanitized [module coverage summary](/Users/abjmac003/Documents/GitHub/CRA/artifacts/m14-03/api-coverage-summary.json) records the 18 collected modules.

Additional authorization checks: 22 auth suites / 305 tests passed after distinguishing native GoTrue `AuthSessionMissingError` from provider outages. The affected query has 100% coverage; adapter/facade branch coverage is 94.64%/90%. Actual isolated local-session revocation now yields strict 401/403/404 denial for existing downloads, status and manifests while an unrelated sentinel session remains valid. Missing trend export pins are rejected as invalid requests; native dashboard GET queries retain optional pins. Audit source-vector changes return stale conflicts before page/export reads, so existing signed pins cannot silently widen. Minimal `export_job` audit visibility exposes only opaque structural metadata under current audit-read permission; forged tenants and permission loss are denied. The independent SIEM action catalogue is unchanged.

## Real browser and artifact checks

Playwright uses isolated contexts against the real development stack with mocks disabled. Tests never clear unrelated browser/site data. The registry journey blocks external HTTP(S) egress and still signs in, captures and downloads filtered CSV/XLSX.

Observed engine results:

| Journey                                                                       | Engine                   | Observed result                                                     |
| ----------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------- |
| Filtered registry CSV/XLSX, empty scope, captured as-of and mobile screenshot | Chromium                 | Passed; recorded real-stack run 8.5 seconds total                   |
| Same filtered registry journey                                                | Firefox                  | Passed; individual test 8.1 seconds                                 |
| Same filtered registry journey                                                | WebKit                   | Passed; individual test 9.8 seconds                                 |
| Registry retry/idempotency journey                                            | Chromium                 | Passed; recorded run 7.6 seconds total                              |
| Canonical per-product readiness PDF/JSON without a regulatory decision        | Chromium                 | Passed; recorded run 9.7 seconds total                              |
| Nonempty owner exports using Playwright MCP                                   | Real development browser | CSV and XLSX downloaded with 18 rows; PDF/JSON readiness downloaded |

Installed headless engine versions were independently read as Chromium **151.0.7922.34**, Firefox **153.0** and WebKit **26.5**. Playwright engine versions are not proof of branded Chrome, Edge or Safari versions. No claim is made that both current and previous major branded browsers were tested.

Screenshots and downloaded evidence:

- [Signed trend export, Playwright MCP](/Users/abjmac003/Documents/GitHub/CRA/artifacts/m14-03/owner-trends-viewport.png) and [CSV](/Users/abjmac003/Documents/GitHub/CRA/artifacts/m14-03/owner-trends.csv) / [manifest](/Users/abjmac003/Documents/GitHub/CRA/artifacts/m14-03/owner-trends-manifest.json)
- [Frozen audit export, Playwright MCP](/Users/abjmac003/Documents/GitHub/CRA/artifacts/m14-03/owner-audit-export.png)
- [Owner product export ready](/Users/abjmac003/Documents/GitHub/CRA/artifacts/m14-03/owner-products-ready.png)
- [Owner readiness report ready](/Users/abjmac003/Documents/GitHub/CRA/artifacts/m14-03/owner-readiness-ready.png)
- [Filtered empty export](/Users/abjmac003/Documents/GitHub/CRA/artifacts/m14-03/owner-filtered-csv.png)
- [Real owner CSV](/Users/abjmac003/Documents/GitHub/CRA/artifacts/m14-03/owner-products.csv) and [XLSX](/Users/abjmac003/Documents/GitHub/CRA/artifacts/m14-03/owner-products.xlsx)
- [Readiness PDF](/Users/abjmac003/Documents/GitHub/CRA/artifacts/m14-03/readiness.pdf) and [JSON manifest](/Users/abjmac003/Documents/GitHub/CRA/artifacts/m14-03/readiness.json)
- [Independent Chromium readiness screenshot](/Users/abjmac003/Documents/GitHub/CRA/apps/web/test-results/m14-readiness/m14-03-filtered-exports-ow-8befc-ating-a-regulatory-decision-chromium/readiness-ready.png)

Independent Python CSV/openpyxl checks confirm the two real product artifacts each contain 18 rows, matching headers and all values, with no formula cells. `pdftotext` extracts the readiness PDF and confirms both “Documentation readiness only” and “certified conformity” wording; the JSON sets `documentationReadinessOnly: true` and includes 2 source-version entries.

Signed trends passed Chromium, Firefox and WebKit. The Chromium parser verified all 16 approved columns and 216 canonical bucket values across 18 rows, including nonzero source activity, exact native revision/as-of and manifest hash/bytes. A separate Playwright MCP owner export delivered 60 authorized activity/coverage buckets. Background refetch disables only creation and preserves already-generated jobs; current permission loss still removes metadata. The actual audit explorer exported 1,969 authorized rows through its native signed high-water snapshot, including 1,261 chain events bounded at sequence 1,376 and 708 legacy events. These journeys do not replace every possible source filter combination.

Auditor portal Chromium verification used only a new test-owned one-hour grant against an existing ready M7 snapshot. CSV and XLSX each contained three permitted artifacts; independent readers verified all 15 native metadata values per file, manifest hash/bytes and zero XLSX formulas. Existing evidence, approvals, snapshots and grants were preserved. [Auditor screenshot](/Users/abjmac003/Documents/GitHub/CRA/apps/web/test-results/m14-auditor-portal/m14-03-filtered-exports-au-2f30e-ted-immutable-artifact-list-chromium/auditor-xlsx.png).

## Numeric and date fidelity

Database metadata confirms that the approved CI binding `version` originates from `ci_provider_release_bindings.version bigint`. Product/release versions, technical-file snapshot versions, evidence version numbers and feed counters inspected here are `integer`; finding confidence is `numeric`. A text column label alone does not protect a bigint that has already been rounded by JSON parsing.

The document-findings export's `confidence` is the native scalar score in the range 0–1. The native RPC supplies `findings.confidence`; [the repository](/Users/abjmac003/Documents/GitHub/CRA/apps/api/src/vulnerabilities/infrastructure/supabase-vulnerability-matching.repository.ts:580) wraps that score with level, explanation and table version for the canonical screen contract. [The screen](/Users/abjmac003/Documents/GitHub/CRA/apps/web/app/_features/vulnerabilities/vulnerability-matching-results.tsx:110) displays the rounded percentage. The approved export preserves the exact source score; it does not expose the full confidence object or additional hidden fields.

The additive capture normalization converts top-level fractional JSON numbers and integers outside ±9,007,199,254,740,991 to exact text **before** snapshot hashing, storage and RPC JSON serialization. Safe integers stay numeric. Nested canonical readiness payloads retain M7 contracts and scoring.

A live PostgreSQL helper response was passed through JavaScript `JSON.parse`, the actual renderer and independent openpyxl/Python CSV readers:

| SQL value                 | Frozen wire value | Observed XLSX type/value   |
| ------------------------- | ----------------- | -------------------------- |
| `9007199254740993`        | Exact string      | Text, exact digits         |
| `0.123456789012345678901` | Exact string      | Text, exact decimal digits |
| `42`                      | Number            | Numeric cell, 42           |
| `true`                    | Boolean           | Boolean cell               |
| `2026-10-09`              | Date-only string  | Date cell at UTC midnight  |

The synthetic [XLSX](/Users/abjmac003/Documents/GitHub/CRA/artifacts/m14-03/numeric-fidelity.xlsx) and [CSV](/Users/abjmac003/Documents/GitHub/CRA/artifacts/m14-03/numeric-fidelity.csv) preserve these values. This independent check exercises the live scalar helper and real serialization path; it is not a second production-scale job benchmark.

## Bounded measurements

[Renderer benchmark harness](/Users/abjmac003/Documents/GitHub/CRA/apps/api/scripts/m14-03-renderer-benchmark.cjs) uses an async frozen-row generator, isolated temporary files, 25,000-row parts and process RSS samples every 10 ms. The recorded Node v22.23.1 run measured rendering only, including its runtime overhead:

| Frozen rows | Format | Duration | Total file bytes | Sampled peak process RSS |
| ----------- | ------ | -------- | ---------------- | ------------------------ |
| 10,000      | CSV    | 72 ms    | 723,256          | 169 MiB                  |
| 10,000      | XLSX   | 239 ms   | 272,020          | 169 MiB                  |
| 100,000     | CSV    | 315 ms   | 7,429,583        | 127 MiB                  |
| 100,000     | XLSX   | 1,078 ms | 2,702,438        | 141 MiB                  |

These are individual microbenchmark samples, not p95/p99 measurements. RSS includes the Node/ts-node process and is not an incremental per-row memory calculation. Files are streamed in bounded parts; sampled RSS can vary with garbage collection and runtime warmup.

[Source benchmark harness](/Users/abjmac003/Documents/GitHub/CRA/apps/infrastructure/scripts/m14-03-source-benchmark.sql) creates 1 million **temporary synthetic** rows in a transaction, with 90% belonging to the selected tenant. It never changes existing source data:

| Source upper bound | Frozen selected rows  | Bounded insertion duration | Payload bytes | Limit result                       |
| ------------------ | --------------------- | -------------------------- | ------------- | ---------------------------------- |
| 10,000             | 9,000                 | 10 ms                      | 781,002       | Within cap                         |
| 100,000            | 90,000                | 92 ms                      | 7,990,002     | Within cap                         |
| 1,000,000          | 100,001 sentinel rows | 100 ms                     | 8,900,093     | Explicitly exceeds 100,000-row cap |

The transaction rolls back. This validates a bounded snapshot/projection shape and the limit sentinel; it does not measure every native source, storage upload, authentication, audit contention or the full API. The worker's million-row guard separately verifies no row read or upload occurs for an oversized frozen job.

## Native transport and capture checks

Authenticated HTTP sampling on the 18-product local seed used concurrency 4 and 24 samples per endpoint. Products measured p95 64.46 ms / p99 67.59 ms; export status measured p95 145.27 ms / p99 149.8 ms. All 48 reads succeeded. This small fixture is not a realistic production-scale percentile result. The benchmark mistakenly used the global CRA sign-out endpoint once, revoking existing owner sessions; later revocation checks use only native GoTrue `scope=local` in an isolated context.

The actual capture RPC, through installed PostgREST 14.15, cancelled with SQLSTATE `57014` at 30.016 seconds while an isolated fixture row was locked. Its job version/state and zero frozen rows remained unchanged. The installed `db-hoisted-tx-settings` includes `statement_timeout`; the original 8-second lock timeout also cancelled with `55P03`. The extended lock timeout used to isolate the 30-second test was limited to the scratch database and restored afterward.

The first native clone run measured 10,000 rows at 403.3 ms and 100,000 at 3,851.8 ms, but the million-source phase exhausted shared Docker memory while a CLI shadow-database diff was also running. PostgreSQL recovered and all uncommitted fixture work rolled back. A later exclusive run revealed a separate registry authorization defect: textual UUID comparison caused repeated scans during frozen-job status reads. The owned benchmark was cancelled at 133 seconds, with rollback confirmed. These failed runs are retained as observations rather than described as successful scalability checks.

After the bounded registry preflight and typed UUID authorization correction, the final exclusive native RPC run passed capture/limit checks in 54.834 seconds after eliminating the redundant registry existence pass. Synthetic source rows were loaded in typed 10,000-row batches into an isolated clone, all amendments were transaction-local, `work_mem` was 16 MiB and a 3.2 GiB guard could cancel only the owned benchmark connection. The database container allocation was 3.826 GiB. Twenty-four sequential authenticated-by-principal SQL status reads were measured per scale, with frozen captures present for the 10k/100k cases:

| Native source rows | Captured rows | Capture/limit duration       | Frozen payload bytes | Status SQL p95                | Status SQL p99                |
| ------------------ | ------------- | ---------------------------- | -------------------- | ----------------------------- | ----------------------------- |
| 10,000             | 10,000        | 454.534 ms                   | 1,318,894            | 16.694 ms                     | 23.506 ms                     |
| 100,000            | 100,000       | 4,004.408 ms                 | 13,288,895           | 330.952 ms                    | 476.531 ms                    |
| 1,000,000          | 0             | 693.444 ms, SQLSTATE `54000` | 0                    | 0.759 ms, failed-job metadata | 1.169 ms, failed-job metadata |

Docker was sampled 25 times: peak usage 644.8 MiB, peak CPU 158.48%, no OOM and no memory-guard cancellation. The entire transaction rolled back: the clone retained its original 11 products, zero snapshot rows and its pre-existing operational fixture, with zero owned benchmark connections. The million-source gate rejects explicitly without partial capture or truncation. The prior indexed duplicate-pass profile measured 100k status p95 486.052 ms and failed the 400 ms target. The single-pass correction preserves job/session/field authorization, product existence, textual source identity and fresh membership; the final native SQL p95 330.952 ms and p99 476.531 ms meet the stated read thresholds. The [prior profile](/Users/abjmac003/Documents/GitHub/CRA/artifacts/m14-03/native-capture-before-single-pass.json) is retained for comparison. These are SQL targets before HTTP/authentication overhead; they do not establish full API percentiles. This measures the actual native registry capture/status functions, not every source, HTTP/auth latency, rendering/storage or sustained multi-tenant fairness. Sanitized [metrics](/Users/abjmac003/Documents/GitHub/CRA/artifacts/m14-03/native-capture-benchmark.json) and [phase log](/Users/abjmac003/Documents/GitHub/CRA/artifacts/m14-03/native-capture-benchmark.log) preserve the evidence without fixture values or credentials.

The real scoped supplier portal browser journey passed CSV, XLSX and fresh manifest downloads. Independent CSV/openpyxl readers confirmed the one authorized checklist row, Unicode Ω, identical headers, no formulas and matching file hashes. Member manifest download through Playwright MCP also passed for all 18 authorized products, with request/source digests and no private object paths. Manifest access produces a synchronous durable `exports.manifest_downloaded` event.

## Final Supabase cross-check

Supabase MCP confirmed `http://127.0.0.1:54321` is the selected CRA local stack: 286 public tables, exactly two new export tables, non-forced RLS, no browser table/RPC execution grants, zero unpinned export functions, and private `filtered-exports` storage capped at 64 MiB. Service-role UPDATE/DELETE on frozen rows and DELETE on jobs are denied. The two tables have six foreign keys, 13 indexes and an immutable-row trigger. At the final observed checkpoint, all 206 export audit events carried sequence, content hash and canonical content. Relevant PostgreSQL logs included expected RED-test failures and CLI/schema-cache connection terminations; these were not represented as successful application requests.

Resume verification exposed a local Storage API compatibility failure: cached Storage 1.67.20 expected an unqualified object-name conflict target while the retained schema already supported native versioning. A review agent introduced a global compatibility index; that unpublished experiment was retired before publication and corrected through CLI migration `20261012054548`. The final schema retains all native indexes and objects, with no global compatibility restriction. Cached compatible runtime 1.77.0 uses the same volume and freezes migrations at the existing `drop-bucketid-objname-index` schema version. RED metadata/versioning assertions failed with the experiment; GREEN persistence and two-version rollback fixtures passed after correction. The source migration pair is harmless on a clean native install. Final six real Chromium journeys passed without the experimental index, including supplier/auditor exports and revoked-session denial.

The full infrastructure gate exposed a stale M13-04 predicate dependency fingerprint after registering safe `export_job` audit visibility. The unchanged legacy `m13-04-audit-range.test.sql` failed its static fingerprint parity check. The additive [range compatibility migration](/Users/abjmac003/Documents/GitHub/CRA/apps/infrastructure/supabase/migrations/20261009132508_m14_03_audit_range_scope_compatibility.sql) explicitly reviews the old/new function-definition hashes and emits existing durable MVCC scope receipts, preserving private grants/search paths and the source dependency registry. The same unchanged legacy fixture then passed in a rollback transaction. The new `m14_03-audit-range-scope-compatibility.test.sql` checks an earlier authorization snapshot fails closed with no new verification authority, fresh authorization proceeds, and dataset/frozen-range metadata stays unchanged. Old authorization metadata is modeled in the rollback fixture; real M13 source/permission concurrency behavior remains governed by the existing infrastructure suite. No regulatory approval or certificate is produced.

## Operational commands

From the repository root:

```sh
pnpm verify
pnpm --filter infrastructure run test
node apps/infrastructure/tests/m14_03-registry-policy-parity.mjs
node apps/infrastructure/tests/m14_03-permission-parity.mjs
node apps/infrastructure/tests/m14_03_operational_static_parity.mjs
pnpm --filter api exec jest export-worker export-renderer readiness-renderer --runInBand
pnpm --filter web exec vitest run app/_features/exports
pnpm --filter web exec playwright test e2e/m14-03-filtered-exports.spec.ts --project chromium
node --expose-gc apps/api/scripts/m14-03-renderer-benchmark.cjs
```

Real-stack browser commands require the API, real web transport, Supabase and export worker to be running. Source SQL fixtures are rollback-only and run through the infrastructure harness. Migrations/types follow the approved additive CLI runbook; no reset, destructive cleanup, restore or live upgrade is part of verification.

## Explicit limitations and retained invariants

- **Full release gate:** `pnpm verify` passed on resume, with Turbo cache use recorded. The complete infrastructure suite was also run directly without Turbo caching; final post-correction exits are recorded below.
- **Production performance:** native registry 10k/100k captures and 1m over-limit rejection passed; the final single-pass 100k frozen-status SQL p95/p99 were 330.952/476.531 ms after a measured 486.052 ms p95 regression was corrected. Full realistic native-source 10k/100k/1m API benchmarks, p95 <400 ms / p99 <1,000 ms and sustained multi-tenant fairness are not established by the synthetic measurements. The pre-existing [M14-02 performance gap](/Users/abjmac003/Documents/GitHub/CRA/docs/superpowers/plans/2026-10-09-m14-02-performance-gap.md) remains a baseline risk.
- **Browser/accessibility:** representative Chromium/Firefox/WebKit journeys, labels, keyboard controls and responsive screenshots were checked. Current/previous branded Chrome/Edge/Firefox/Safari and a complete WCAG 2.2 AA audit were not independently certified.
- **Retention/archival:** 24-hour availability revokes delivery but does not authorize deletion. The [retention boundary](/Users/abjmac003/Documents/GitHub/CRA/docs/architecture/m14-03-retention-boundary.md) preserves the unavailable generic cleanup adapter, M13 archival gate, legal-hold protections, immutable rows and restrictive dependencies. Expired private artifacts/rows remain retained; storage growth needs a separately approved archival workflow.
- **Supabase tooling:** identity/schema/SQL checks use the selected local CRA stack. An earlier advisor refresh returned HTTP 502. The later successful security advisor returned 254 notices, zero errors and five warnings for existing helper RPCs; new export tables have expected INFO notices for RLS without browser policies. The final performance advisor returned 873 notices (865 INFO, eight existing WARN). The missing requester index was corrected additively; new-feature INFO notices include unused indexes and snapshot-row bloat after rollback fixtures. Baseline advisories are preserved and are not represented as feature regressions.
- **Regulatory authority:** exports do not approve audits, establish certified conformity, create M7 snapshots/declarations, widen evidence access, change deadlines, or override source-domain regulatory decisions.

## Resume verification — 12 October 2026

Implementation and browser-test source remained unchanged during this verification. After restoring the existing local runtime, all **12 fresh real-stack browser journeys passed, with no skips**:

| Engine                 | Journeys                                                                                                                   | Result                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Chromium 151.0.7922.34 | Filtered registry CSV/XLSX, canonical readiness PDF/JSON, signed trends, auditor CSV/XLSX                                  | 4 passed in 24.4 seconds                           |
| Chromium 151.0.7922.34 | Supplier CSV/XLSX and manifest; isolated `scope=local` revocation, one-time delivery replay, cross-session manifest denial | 2 passed in 13.1 seconds                           |
| Firefox 153.0          | Filtered registry, readiness, signed trends                                                                                | 3 passed; combined cross-engine run below          |
| WebKit 26.5            | Filtered registry, readiness, signed trends                                                                                | 3 passed; combined Firefox/WebKit run 48.2 seconds |

Each journey used isolated browser state. Supplier and auditor verification created only new test-owned invitations/grants through canonical APIs; existing source data, approvals, snapshots, sessions and unrelated browser/site data were preserved. The revocation journey used only its own native GoTrue local session and confirmed another isolated owner session stayed valid. External HTTP(S) egress was blocked in the representative member and portal journeys. These engine versions do not establish current/previous branded-browser coverage or complete WCAG certification.

Independent Python CSV, bundled openpyxl and `pdftotext` readers verified 11 downloaded artifact files: three empty XLSX files with matching CSV headers, one Unicode supplier row and three auditor rows with complete CSV/XLSX parity and zero formula cells, all three signed trend CSVs with 18 rows and 216 exact canonical bucket values each, and all three readiness PDFs with extractable documentation-only/conformity wording plus canonical JSON provenance. Auditor metadata additionally matched all 18 permitted native source values. The signed trends preserved their displayed dataset revision/as-of and manifest hashes. [Independent reader results](/Users/abjmac003/Documents/GitHub/CRA/artifacts/m14-03/resume-2026-10-12-independent-readers.json) record these checks without credentials.

Twenty fresh successful screenshots and downloaded files are retained under [the resumed test evidence directory](/Users/abjmac003/Documents/GitHub/CRA/apps/web/test-results/m14-resume-2026-10-12). Representative screenshots:

- [Filtered mobile export](/Users/abjmac003/Documents/GitHub/CRA/apps/web/test-results/m14-resume-2026-10-12/runtime-restored-chromium/m14-03-filtered-exports-ow-c05f1-rmats-with-a-captured-as-of-chromium/filtered-mobile.png)
- [Readiness report](/Users/abjmac003/Documents/GitHub/CRA/apps/web/test-results/m14-resume-2026-10-12/runtime-restored-chromium/m14-03-filtered-exports-ow-8befc-ating-a-regulatory-decision-chromium/readiness-ready.png)
- [Signed trend export](/Users/abjmac003/Documents/GitHub/CRA/apps/web/test-results/m14-resume-2026-10-12/runtime-restored-chromium/m14-03-filtered-exports-tr-ae1e4-dataset-and-source-versions-chromium/pinned-trends-ready.png)
- [Supplier export](/Users/abjmac003/Documents/GitHub/CRA/apps/web/test-results/m14-resume-2026-10-12/private-chromium/m14-03-filtered-exports-su-090db-st-through-private-delivery-chromium/supplier-xlsx.png)
- [Revoked isolated session](/Users/abjmac003/Documents/GitHub/CRA/apps/web/test-results/m14-resume-2026-10-12/private-chromium/m14-03-filtered-exports-on-17e9b-oked-isolated-owner-session-chromium/revoked-export.png)

Fresh release checks also passed: `pnpm verify` exited 0; the complete uncached infrastructure SQL suite exited 0; the safe live API regression sample passed three suites/nine tests. Fresh CLI diff reported 33 existing named-constraint drops and no new public M14 schema drift; storage was excluded from that comparison. No diff was applied.

The first resumed registry journey failed because the restarted local storage runtime returned `storage_unavailable` after capture. Its failure screenshot remains in the initial `chromium` subdirectory. After runtime restoration, a separate Playwright MCP retry delivered an 18-row XLSX and manifest while preserving the original captured `snapshotAsOf`; the 12 journeys above then passed. Storage runtime restoration and an observed external storage unique-index migration have distinct provenance: the latter remains under review and is not represented here as an implementation change or a proved consequence of the runtime restoration.

A baseline supplier request gap was reproduced separately in a rollback-only native RPC transaction: omitting contract-optional request `instructions` becomes an empty string in `m9_02_insert_revision_before_m906`, violating `supplier_evidence_request_revisions_instructions_check` and causing HTTP 503. No request committed from that failing attempt. The export fixture supplied explicit instructions and then passed end to end. This M9 contract/database inconsistency remains documented; no unrelated production fix was introduced during M14 verification.

### Final native-storage correction

After retiring the compatibility experiment, all six distinct Chromium journeys passed again with zero skips. A previously redeemed supplier invitation was replaced by a fresh test-owned fixture; that initial fixture failure is retained. Independent [final readers](/Users/abjmac003/Documents/GitHub/CRA/artifacts/m14-03/final-native-storage-independent-readers.json) checked CSV/XLSX values, exact trend revisions/as-of, PDF/JSON readiness provenance and permitted portal artifacts. Independent read-only review found no issue in the retired marker, narrowly guarded corrective migration or native-versioning fixture. Existing objects, buckets and native indexes were preserved.

Final post-correction `pnpm verify` exited 0. The complete database suite then passed directly and serially (159 rollback fixture files, exit 0); one overlapping duplicate test run had produced a fixture deadlock and was retained as failed evidence rather than counted as a pass. The serial rerun had no assertion failures. Supabase MCP confirmed 28 feature migration versions, native versioned/current object indexes present, experimental index absent, storage migration version still 72, and no missing export audit-chain records. [Final gate summary](/Users/abjmac003/Documents/GitHub/CRA/artifacts/m14-03/resume-2026-10-12/release-verification.json).
