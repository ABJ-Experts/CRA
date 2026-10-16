# M14-01 validation and operations

The live dashboard and product posture are implemented. Work resumed on 2026-10-08 from the saved uncommitted diff after an interruption. Final integrated functional, architecture, build, live-stack and browser gates pass after the performance follow-up. The final reviewed candidate passes the measured latency gates at all three synthetic scales; earlier rejected alternatives and misses remain recorded below. Final integrated full/live/browser reruns pass. Results do not certify compliance or absence of bugs.

## Requirement mapping

| Requirement | Implementation and contract | Tests |
| --- | --- | --- |
| FR-AN-001 operational role-aware summary | `packages/contracts/src/dashboard/schemas/dashboard.schema.ts`; `apps/api/src/dashboard/application/dashboard-use-cases.ts`; private `get_dashboard_projection` | Schema suppression/invariants; dashboard API policy/provider/HTTP suites; `apps/infrastructure/tests/m14-live-dashboard.test.sql`; owner/viewer browser journeys |
| FR-AN-002 authoritative countdown | `m6_dashboard_obligations`; `apps/web/app/_features/dashboard/dashboard-clock.ts` and `dashboard-sections.tsx` | Real SQL running, overdue, pending-anchor, cancelled, late-submitted and rehearsal checks; clock and DOM-ordering tests |
| FR-AN-003 product posture | `m2_active_support_period`; M3 coverage, M5 effective open finding predicate and M7 source authorization; dedicated posture route | Foreign-product indistinguishable 404; assessment/undo/VEX, suppression, canonical lineage, valid-with-warnings, replacement, zero applicability and hidden readiness SQL checks; posture and deep-link tests |
| FR-AN-009 tenant isolation | Verified principal, org-first read port, current permissions and dashboard-context encrypted cursor | Scope forgery, permission change, endpoint/actor/session/cursor binding tests; real SQL grants and tenant isolation; browser refresh and organization switch |

## Execution evidence

Baseline: `milestone-1`, `97999948e3ee0dadb6ec480aa367baf7600d72c0`. Changes remain uncommitted for review.

- Local CRA Supabase MCP URL: `http://127.0.0.1:54321`, PostgreSQL 17.6. Final catalog: 282 public base tables and 132 migration entries. Only the new `20261007125808` entry was added. Historical missing local migration entries were not repaired or replayed.
- Earlier original-local integration evidence (before the current clone-only follow-up): no tables, columns, jobs, cache or dependencies were introduced. The measured `vulnerability_findings_dashboard_open_cover_idx` is the only new index: organization/release/observation keys, narrow included fields, and the intrinsic active/unclosed/unsuperseded predicate. Migration: `apps/infrastructure/supabase/migrations/20261007125808_m14_live_dashboard_read_projection.sql`. Both generated type copies were regenerated through `db:types`; their bodies agree (the API copy adds its generated lint header). The preserved database and grouped findings function matched after restart. The resumed candidate extracts the existing M5 observation severity mapping, retains the organization-bound finding wrapper, prefilters intrinsically closed findings and disables JIT only in the findings projection. That earlier MCP/catalog alignment confirmed findings body MD5 `6bdbe380ccbe58f09b6c884a703103db` matches the migration, the covering index is valid/ready, and only `search_path` plus local `jit=off` are configured. No alternative plan-cache setting was shipped.
- MCP confirms the facade is service-role executable, not browser/anonymous executable. Helpers are private; all reviewed functions pin `search_path`. Existing non-forced RLS remains intact.
- Advisors are intermittently available. The resumed performance advisor returned 911 notices (8 WARN, 903 INFO), none naming M14. Security returned existing RLS/grant notices on one attempt, then HTTP 502 on subsequent attempts; PostgreSQL logs and table-list tools also returned HTTP 502. Full advisor clearance and log analysis are not established. Catalog inspection and real SQL tests supplied local schema evidence.
- RED evidence: missing live dashboard on the baseline; missing contract module and readiness invariant; failing policy/provider/clock/DOM-ordering tests; source relationship, effective VEX-before-pagination and feed-sync fixtures before their fixes. GREEN evidence is the final suites below.
- Independent API/UI and source reviews found no unresolved critical/high finding in the reviewed diff. Legacy default triage VEX/approval post-pagination behavior is deliberately preserved; the new `openOnly` path applies effective filters before pagination.

### Commands and coverage before the performance follow-up

| Check | Result |
| --- | --- |
| `pnpm verify` | PASS: lint, types, 72 architecture tests, documentation gate, dependency boundaries, unit/SQL suites and production builds |
| `API=http://localhost:3335/api/v1 pnpm test:live` | PASS: SQL suites, eight API E2E suites / 25 tests, 33 auth-flow checks |
| Focused dashboard contracts | 21 tests; 100% statements, branches, functions and lines |
| Focused dashboard API | 59 tests; 99.02% statements, 96.52% branches, 100% functions and lines; every covered new module exceeds 80% |
| Focused dashboard web | 43 tests; 99.05% statements/lines, 95.83% branches, 100% functions; every covered new module exceeds 80% |
| Full suites | Contracts 671; web 1,498; API 4,520; UI 98; design 9; agent 24; infrastructure SQL tests pass |
| M14 real database suite | Eight pgTAP assertions plus 70 named abort-on-failure checks; transactional rollback verifies read-only source behavior |
| DB lint and types | `db:lint --fail-on error` passes; existing warnings retained; generated copies agree |
| Browser tests | Four live journeys pass in Chromium, Firefox and WebKit against production CRA; owner/viewer, strict input/foreign product, demo compatibility, transient/stale then forbidden, narrow refresh cookie and org switch |

The final full gate initially exposed an existing audit repository fixture expecting an Oct8-expiring export to remain ready after that date. A scoped fixed `Date.now()` with restored spies preserves both future and past-expiry cases; the focused 16-test suite and final full API suite pass without production changes. RED/GREEN evidence is retained outside the repository.

The first combined cross-browser run hit the unchanged sign-in rate limit while live auth tests ran concurrently. WebKit was rerun after the normal limit window and all four journeys passed. No rate-limit setting was relaxed. An existing M11 SQL fixture used wall-clock expiry against a transaction-clock policy and failed under load; only its two expired timestamps now use `now() - interval '1 second'`. All 47 checks pass with a verification-only 1.1-second transaction delay. Production M11 code is unchanged.

### Browser and egress evidence

Yesterday’s `/tmp/cra-m14-01-evidence` reports were temporary and did not survive restart. Fresh evidence is retained outside the repository under `/Users/abjmac003/.codex/visualizations/2026/10/07/01a114cf-1ee2-7103-aa45-4b70426d0445/m14-resume`:

- `mcp-dashboard-desktop.png`, `mcp-dashboard-mobile.png`, `mcp-product-posture.png` from Playwright MCP. Final native MCP rechecks added `mcp-dashboard-final.png`, `mcp-viewer-final.png`, and `mcp-posture-final.png`: owner/posture 200, foreign posture 404, viewer readiness restricted without data, and no browser console errors/warnings.
- `mcp-viewer-dashboard.png` from an isolated restricted-account MCP context; `owner-dashboard-desktop.png`, `owner-dashboard-mobile.png`, `viewer-dashboard.png` from automated browser tests.
- Fresh MCP one-row pagination advanced to distinct products and rejected cross-endpoint cursor use with HTTP 400. Current API cursor unit/HTTP tests pass.
- Viewer readiness is `restricted` with no data in fresh browser journeys; fresh MCP dashboard/posture console had zero errors/warnings. Mobile has no horizontal document overflow. Keyboard navigation reaches the obligation link with visible focus styling.
- Both new API and production web processes run under an OS outbound-egress-denial profile allowing only loopback. DNS and direct-IP outbound probes fail; local sign-in, dashboard, posture, pagination and refresh work. The browser additionally blocks non-CRA origins. This does not change another site's cookies/storage or pre-existing servers.
- Fresh current-tenant production HTTP overview, 20 reads under outbound-egress blocking: p95 67 ms, p99 75 ms. These small local samples are not a production SLO or large-tenant proof. Fresh large-tenant database results are below.

Browser suite: set `M14_EVIDENCE_DIR` and `--output` to the persistent outside-repository evidence directory, then run `pnpm --filter web exec playwright test e2e/m14-dashboard.spec.ts --workers=1`; enable `E2E_CROSS_BROWSER=true` and select browser projects separately to respect the existing sign-in rate limit. Screenshots are disabled inside repository test output. Only the CRA local origin is used.

## Resumed drilldown correction

Independent review and mounted-component tests exposed link-removal/local-edit synchronization gaps. `triage-content.dashboard-link.spec.tsx` now characterizes validated link changes, link removal, unrelated or malformed/duplicate parameters, cursor/bulk-selection clearing, saved-default precedence and preservation of open assessment drafts. Expanded focused regression coverage passes 49 tests across three files with the default 80% thresholds enabled. The entire materially changed triage component now has 95.01% statements/lines, 87.33% branches and 90.62% functions; the dashboard-link parser has 100% across all metrics. Tests cover existing filter roundtrips/clears, loading/denial and sanitized errors/retry, keyboard selection/detail, saved-view success/conflict/failure and draft retention. No production refactor was introduced to increase coverage. Dashboard modules retain the coverage stated above.

Fresh Playwright MCP confirmed mounted product/severity links apply, an unrelated URL change retains manually edited severity, and a subsequent validated severity link applies. The saved default cannot overwrite an explicit dashboard link, while manual saved-view choices remain available. Independent review found no unresolved critical/high issue in the resumed diff.

## Large-tenant measurement

Synthetic benchmarks use only the separate `cra_m14_benchmark` database, a schema-only clone with original owners/grants/functions and synthetic users/source records; no retained CRA data, auth credentials or evidence are copied. Guarded bootstrap/mixed-tenant fixtures and `run-m14-dashboard-benchmark.sh` refuse other database names. Rollback mode removes each scale transactionally. Committed mode makes synthetic rows visible and vacuums only the disposable database before timing; exact generated IDs and run-UUID-bound fallback cleanup remove only owned synthetic rows.

The fixture bypasses write-side reconciliation only while loading disposable rows, restores `session_replication_role=origin` before reads, asserts triggers enabled and validates tenant/release/source relationships and exact row counts. It measures actual authorized read RPCs, not ingest/write throughput. Findings share one synthetic source observation; diverse vulnerabilities, rich readiness graphs and large obligation populations need further production-shaped measurements. Memory is PostgreSQL backend memory-context bytes, not total process RSS.

Initial 20-sample runs:

| Products / findings | Overview p95 / p99 | Other paged reads | Max response / backend context memory |
| --- | --- | --- | --- |
| 100 / 10,000 | 75.43 / 106.47 ms | below 1 ms | 2,947 B / 13.74 MB |
| 1,000 / 100,000 | 13,631 / 15,721 ms | p95 2.05–4.81 ms | 2,964 B / 14.01 MB |

The initial misses are retained as evidence. After the grouped-query correction, a clean one-million-finding run measured 979.32 / 1,128.61 ms. A committed/vacuumed prototype with transaction-wide JIT disabled measured 255.85 / 259.15 ms, but that is not the shipped-candidate acceptance result.

The pre-index candidate with function-local JIT disabled and rollback-only synthetic loads measured 19.12 / 34.49 ms at 10k findings, 62.35 / 63.74 ms at 100k, and 1,542.87 / 1,585.39 ms at one million (20 samples each). The million-row result still misses both latency targets; query-plan/fixture differences remain under investigation. Other paged reads stayed below 1.04 ms p95, with maximum overview response 2,851 B and backend context memory 15.47 MB at one million.

Fresh mixed-tenant reads during the final 100k loop: 50/50 confirmed overlapping samples, second tenant consistently one product / zero findings; p95 22.60 ms, p99 28.12 ms. These measurements are database RPC latency, not large-tenant HTTP latency. The measured partial covering index then produced p95 384.22 / p99 512.44 ms over 100 committed/vacuumed million-row reads, with index-only generic plans and zero heap fetches. First-five p95 was 496.75 ms; subsequent p95 was 354.02 ms. Posture p95/p99 was 6.95/7.59 ms. The subsequent shipped maintained-index and HTTP measurements below do not reproduce that prototype acceptance. Vacuumed index-only results do not establish sustained ingestion/update performance.

### Final shipped measurements and unmet gate

The final maintained index was created before synthetic insertions, with committed/vacuumed data and 100 sequential calls per endpoint. It remained approximately 175 MiB at one million findings; generic plans used index-only scans with zero finding heap fetches, but read about 156 MiB of index buffers against 128 MiB shared buffers. Cold generic-plan transition and variable shared-host load are measured factors; a single definitive cause is not established.

| Products / findings | Overview p95 / p99 | Result |
| --- | --- | --- |
| 100 / 10,000 | 23.22 / 29.82 ms | Within database RPC targets |
| 1,000 / 100,000 | 62.54 / 106.74 ms | Within database RPC targets |
| 10,000 / 1,000,000 | 842.30 / 1,562.52 ms | Both targets missed |

At one million, posture p95/p99 was 12.89/15.90 ms; bounded list p95 was 1.21–1.46 ms. Maximum measured backend context memory was 17,092,224 B and overview JSON 2,850 B. These are not process RSS or rich-data scalability guarantees.

A full HTTP test used the built CRA API and original ES256/JWKS verification, cookies, membership and permission checks. An external test-only adapter endpoint override diverted only `get_dashboard_projection` to disposable PostgREST; auth/session queries stayed on original CRA. No production guard was bypassed. Thirty successful owner reads returned exactly 1,000,001 synthetic open findings: p95 514.30 ms / p99 1,261.79 ms, cold first read 1,566 ms, response 2,905 B. A subsequent batch aborted on a sanitized 503; its partial timing array was not retained. This failure is retained as an acceptance miss, not discarded as a setup success. Initial issuer/path setup failures occurred before valid measurement and did not disclose evidence.

The narrower organization-key index was maintained during inserts and measured about 124 MiB. Its automatic generic plan worsened overview p95/p99 to 2,255.27/3,394.61 ms. A function-local custom-plan experiment measured 783.80/1,116.06 ms and chose the wide sequential scan rather than the candidate index. That candidate and plan override were rejected; original CRA retained only the reviewed index and local JIT setting. No global resource settings, cache, materialized view or source policy changes were made.

An unrelated development server consumed host CPU during later measurements and was preserved. Our owned CRA browser tabs were quieted for timing. The miss remains an unmet gate rather than an assumed success under different hardware. Sustained update/ingestion performance, richer source diversity and repeatable million-row HTTP SLO acceptance remain unverified.

Reproduction: `M14_BENCHMARK_MODE=committed M14_BENCHMARK_SAMPLES=100 bash apps/infrastructure/tests/run-m14-dashboard-benchmark.sh`. The optional HTTP principal/hold mode uses only a neutral synthetic public identity with the seeded verified actor UUID, without copying authentication rows, credentials or retained source content. EXIT/INT/TERM handling cancels only the generated application-name backend and cleans only that run's synthetic rows in `cra_m14_benchmark`; real held-run cancellation removed exactly its owned million findings and 10k releases/products, preserving bootstrap rows. SIGKILL or unavailable Docker/database requires the run-UUID-bound manual recovery procedure. Temporary proxy/API/REST processes were stopped; retained CRA services and unrelated applications remained running.

Detailed logs, raw HTTP timings, SQL profiles and rejected candidates are in the persistent evidence folder, including `database-final-evidence.md`, `shipped-candidate-all-scales-committed.log` and `http-million-initial.json`.

### Follow-up performance work, 2026-10-08

The follow-up plan is `docs/superpowers/plans/2026-10-08-m14-01-dashboard-performance.md`. Current optimization is tested only in the disposable local clone; production/cloud resources remain untouched. Original local CRA has not yet received these follow-up function changes. The remote branch was reconfirmed at the baseline hash.

Richer fixtures now use 1,000 distinct immutable-current vulnerability/CVSS source graphs and four evaluation timestamps, with exact four-severity completeness and bounded scalar product-policy comparisons. Maintained indexes remain present during loading. Validated literal series bounds, a frozen neutral finding template and 50k insertion windows preserve global row/source/time mappings. Aligned/nonaligned smoke runs, default fixtures and real cancellation cleanup pass; Node black-box guard tests run through the existing architecture gate without requiring Docker.

The old richer 10k/100k overview took approximately nine seconds. Five authenticated requests on the smaller rich fixture each reached the existing eight-second database timeout: SQLSTATE `57014`, sanitized API 503. This confirms the current fixture's cause, not the earlier uninstrumented million-row failure. Allowlisted provider/permission/response diagnostics omit raw messages, bodies, codes and identities; throwing observers cannot replace sanitized failures or break partial degradation. Focused dashboard tests: 73 pass, coverage 99.09% statements, 96.75% branches, 100% functions/lines. Independent review approved the diagnostics.

The reviewed candidate separates fixed overview/product statements, filters effective open groups before observation reaggregation, and shares private source-owned CVSS extraction between the full M4 reader and bounded 250-ID dashboard batches. M5 score thresholds remain shared. Frozen full-reader parity covers EPS/CWE, malformed unrelated values, mixed feeds/freshness, fallback versions, withdrawal/current selection and existing unspecified ties. Source numeric normalization is preserved rather than repaired. A confirmed inherited source limitation remains: the frozen M4 regex excludes decimal CVSS 9.9, producing null preferred score/unknown severity rather than numeric conversion. Case8 in `m14-cvss-batch-parity.test.sql` verifies identical old/new behavior; this dashboard optimization does not silently change that source decision. Unknown severity remains visible. Source parity: 4 pgTAP plus 51 named checks; real mixed-policy/scalar parity: 8 pgTAP plus 62 named checks. Source/helper and fixture reviews found no blocker.

| Rich findings | SQL overview p95 / p99 | Paced authenticated HTTP p95 / p99 | HTTP outcomes |
| --- | --- | --- | --- |
| 10,000 | 40.78 / 52.65 ms | 137.30 / 142.53 ms | 100/100 HTTP200, exact10,001 count |
| 100,000 | 59.45 / 65.60 ms | 193.34 / 256.24 ms | 100/100 HTTP200, exact100,001 count |
| 1,000,000 | 423.16 / 459.64 ms | 519.22 / 676.43 ms | 100/100 HTTP200, exact1,000,001 count; p95 still misses400ms target |

Each measured endpoint has 100 samples. At one million, first-five SQL p95 was452.14ms and subsequent p95 362.06ms; posture11.05/14.10ms. HTTP pacing respects the unchanged60/minute guard. A separate initial unpaced10k run produced60 HTTP200/40 HTTP429 and is retained as limiter evidence, not acceptance. API cold restarts are explicitly recorded; SQL had already warmed the database, so these results do not establish cold database/cache performance. All outcomes are persisted individually; sampled API RSS is not a true peak. The million HTTP p95 remains above target; a narrower-index diagnostic, maintained-index remeasurement, mixed-tenant follow-up, original-local integration and final regression gates remain pending.

## Deployment

1. Confirm CRA identity and grants/schema; do not repair the historical migration ledger.
2. Apply only the reviewed additive M14 migration using established deployment tooling. No backfill is required. Its ordinary `CREATE INDEX` blocks finding-table writes while building; schedule a maintenance window and measure build duration/storage on the target deployment before execution.
3. Regenerate both type copies with `pnpm --filter infrastructure run db:types`.
4. Deploy API, then web. When using the isolated validation API, build web with `API_ORIGIN=http://127.0.0.1:3335 NEXT_PUBLIC_ENABLE_MOCKS=false`; Next rewrites are captured during the build.
5. Check owner/restricted accounts, source state suppression, posture, pagination, authoritative countdowns and `/dashboard/ecommerce` compatibility.

## Rollback and boundaries

Disable the new routes/UI and restore the commerce entry through code rollback. Retain additive functions and all source evidence. No reset, ledger repair, purge, automatic backfill or credential rotation is required.

The dashboard consumes source decisions; it does not establish deadlines, submit reports, resolve findings, generate readiness or certify compliance. Pagination is live, not a snapshot. Browser expiry does not create a breach. Definitive authorization failures clear evidence; transient failures retain eligible same-scope data with stale labeling. Readiness is product-specific and withheld when its linked dependencies cannot be authorized.

Latest clone-only candidate preserves exact source policy while eliminating overview observation-time grouping and using a narrower maintained index. With 1,000 source graphs, one million findings, 5,000 pending assessments and 1,000 active suppressions, 100 SQL samples measured p95 279.55 / p99 305.74 ms. The corresponding 100 authenticated HTTP requests all returned 200 and exact counts, but p95 626.53 / p99 838.76 ms still misses the HTTP p95 gate. A subsequent 20-request diagnostic measured 603.93 / 804.48 ms. These are not final acceptance results. Separate same-actor ordinary service-role statements measured p95 235.67 ms over ten diagnostic calls; normalized PostgREST envelope replay had one facade evaluation and no demonstrated JIT cause. Required authentication remains intact.

The benchmark now commits before its hold period, retains exact-run temporary ownership registries and holds no public-source relation locks. Twenty-one architecture guards pass; second-connection lock and scoped cleanup checks passed. Same-held-dataset paired automatic-plan measurements now support retaining the narrow index: 100 calls with it measured p95/p99 334.45/390.81 ms versus 747.12/947.21 ms without it under transaction-local DROP/ROLLBACK. The index was restored, counts matched, and sequential ordering/shared-host variability remain caveats. The reviewed dashboard-only coherent permission-context candidate passed 97 API tests, focused coverage above 80% per module, SQL/RLS tests and concurrent version/permission commit/rollback checks. A same-held rich10k fixture comparison returned all 40 requests correctly: old HTTP p95/p99 162.36/183.57 ms versus candidate125.45/156.26 ms. Candidate requests perform one parsed context RPC and one projection RPC; the global guard still reads the current permission version. Different process warmth prevents a memory improvement claim. The candidate was selected for final measurement; shared permission merge logic and all global guards remain unchanged. Those preliminary measurements preceded the final selected-candidate integration and passing gates recorded below.

Residual validation boundary: final integrated regression/browser reruns pass and measured synthetic large-tenant latency gates pass; the materially changed triage component now meets all coverage thresholds. Additional measurement boundaries are richer synthetic data diversity, production monitoring and intermittently unavailable Supabase advisor/log checks. Current/previous vendor browser versions and a full external WCAG audit are not established by the installed Chromium/Firefox/WebKit test engines.

### Final selected-candidate measurement and local integration

Each scale below has 100 SQL calls and 100 paced authenticated HTTP requests. All 300 HTTP responses returned 200 with exact counts, one permission-context RPC plus one projection RPC, and unchanged original global authorization checks. First samples and slower outcomes remain included. SQL warmed the database before HTTP; these are not cold-database or sustained source-write benchmarks.

| Findings | SQL overview p95 / p99 | HTTP p95 / p99 | Open / suppressed |
| --- | --- | --- | --- |
| 10k | 18.51 / 22.16 ms | 115.23 / 147.59 ms | 10,001 / 20 |
| 100k | 57.05 / 59.34 ms | 380.18 / 549.35 ms | 100,001 / 100 |
| 1m | 245.62 / 319.76 ms | 325.42 / 486.77 ms | 1,000,001 / 1,000 |

The million run includes 1,000 current source graphs and 5,000 pending assessments. Fifty genuinely overlapping second-tenant SQL samples returned one product/zero findings at p95 6.46 / p99 11.83 ms; this is SQL fairness evidence, not mixed-tenant HTTP evidence. All runs preserve maintained indexes; replica mode is limited to synthetic loading and restored before measurements. HTTP response sizes were 2,886–2,922 bytes. Sampled API RSS is recorded in outside raw evidence, not a true process peak or memory improvement claim. The 100k p95 remains close to the 400ms threshold and shared-host/provider/auth variation is retained. Rich readiness/obligation populations, sustained writes and production monitoring remain measurement boundaries.

Reviewed definitions were reapplied only to local `supabase_db_cra` / `postgres`, after project/PG17.6/282-table/132-ledger identity guards. Existing 132 ledger rows remained exactly equal, digest `79ec6cef07eb0fb579b416cf26921be1` before/after. No ledger DML, reset or blanket replay occurred. CLI-created additive migration `20261008094527_m14_dashboard_permission_context.sql` remains pending in this local ledger; this intentional local definition reapplication preserves historical discrepancies. Fresh deployment applies both reviewed additive migration files through normal controlled tooling; do not use this exception to repair historical environments. Both type copies were regenerated with the existing CLI command, and temporary RPC casts were removed.

Local focused SQL gates passed: facade 8 pgTAP plus 71 named checks; CVSS 4 plus 183; findings 8 plus 170; permission context 7 plus 18. Two-connection context commit/rollback and source-revocation checks passed. The CVSS fixture explicitly establishes feed freshness inside rollback rather than assuming retained development state. DB lint passed with existing warnings. Independent source, fixture, API and security reviews found no blocker; dashboard API 97 tests and all module coverage metrics exceed80%.

Production/cloud were untouched. Owned benchmark services3336/3337/3338 were stopped, database/volumes/evidence retained, original CRA and unrelated services preserved. Final full/live/Supabase/browser/egress results are recorded below.

Final Supabase MCP confirms both indexes valid/ready, private service-only facades, private inward helpers, pinned search paths, non-forced source RLS and four migration-body hashes matching the catalog. Security advisor returned250 notices (245INFO/5WARN), none M14. Performance returned794 (786INFO/8WARN), including two local [unused-index INFO notices](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index) for the M14 indexes; separate actual maintained-load plans and paired index-removal measurements justify retention. Existing advisor warnings were not globally repaired or treated as clearance. PostgreSQL logs were available in the final attempt:100 metadata records,99LOG/1ERROR; the error matches the known failed structural M4 test below. Raw messages and identities are excluded from this report.

The first final full verification failed an existing M4 structural test that required score-alias parsing text inside the full reader. Extraction moved that exact expression into its private helper. The corrected gate retains scalarEPSS coverage and accepts the prior inline implementation or verified single-ID delegation to the private/pinned helper. Real GitHub score alias/baseScore precedence and inherited decimal cases were added: CVSS4pgTAP+231namedchecks pass, and clone-only alias-removal/delegation-break mutants fail as expected. Fixture feed state is explicitly established inside rollback. No source behavior or measured implementation changed. The standalone full infrastructure suite and subsequent full verification rerun pass.

### Final integrated gates

`pnpm verify` rerun passed lint/types,93 architecture checks, documentation/dependency gates, full infrastructure/unit suites and production builds. API427 suites/4,558 tests; web214 files/1,498 tests. `API=http://localhost:3335/api/v1 pnpm test:live` passed full SQL,8 API E2E suites/25 tests and33 auth checks. Current dashboard coverage97 tests:99.22% statements,96.25% branches,100% functions/lines; all modules exceed80%. The latest built API runs with explicit local Supabase URL under the loopback-only OS sandbox. An actual external socket returned PermissionError(errno1), DNS was blocked and local health/auth/dashboard/refresh operation succeeded.

Native Playwright MCP tested fresh owned contexts only at CRA3102: owner dashboard/posture200, foreign product404, forged scope400, refresh200 and subsequent dashboard200; viewer readiness/drilldown disclose no hidden values, refresh cookie remains HttpOnly/Lax at `/api/v1/auth/refresh`, page errors0. Screenshots `mcp-final-owner-desktop.png`, `mcp-final-owner-mobile.png`, `mcp-final-product-posture.png`, `mcp-final-viewer.png` are in the outside evidence directory. Context cleanup affected only newly owned contexts. All four final journeys passed in Chromium(9.5s), Firefox(9.1s) and WebKit(10.6s), paced by unchanged sign-in limits. No retry or rate-limit relaxation was used.

The final MCP catalog check after all tests again confirmed282 tables,132 unchanged ledger entries/digest and unchanged matching function bodies. Screenshots/reports/logs remain outside the repository; no new untracked PNG/JPEG/WebP/log artifacts remain inside. Changes are uncommitted on `milestone-1`; no production/cloud resource or other-site storage was changed. Original CRA validation API3335/web3102 remain available; owned benchmark listeners3336/3337/3338 are stopped.

Deployment still requires an operator-reviewed environment and normal additive migration rollout. Local definition reapplication intentionally did not alter historical ledger entries; the new context migration file remains pending in that ledger. No production deployment, evidence repair, source CVSS correction, sustained-write acceptance, cold-database guarantee, external WCAG/vendor-version certification or zero-bug claim is made.
