# M14-05 verification evidence

Baseline: `906cb4f`. The feature remains uncommitted; no push or commit was performed. Implementation and functional verification passed. The million-membership performance acceptance criterion remains unmet.

## Acceptance mapping

| Requirement | Evidence |
| --- | --- |
| Stable identity/version and distinct products | Contract specs, 17 read-only PackageURL parity cases, SQL repeated-path/version/qualifier/exclusion fixtures, and a live comparison of two products versus four memberships. |
| Actionable comparison, concentration and drilldown | Functional tables, gateway/query/component tests, and owner journeys from portfolio through an exact component and affected releases to product posture. |
| Marketed/archive scope; reuse is not exploitability | SQL archived-product and withdrawn-release exclusion tests, explicit UI scope and caveat, and preserved M2 rules. |
| Authorization before joins | Source-access policy and org-first facade; SQL forged-tenant, override and revoked-actor cases; API scope/session/filter assertions; browser denial erasure. |
| Missing coverage and stale intelligence | Independent coverage, matching and freshness sections; exclusion counters and null denominators; provider-outage retention tests; restricted sections reject data payloads. |
| High cardinality and concurrency | Isolated 10k/100k/1m membership datasets across 1,000 products, exact tenant-qualified lineage, bounded pages and revision-change rejection. All requests succeeded; the 1m latency gate failed. |

## Focused verification

- Contracts: 13 focused tests; 100% coverage for branches, functions, lines and statements. The dashboard contract regression run passed 54 tests.
- API: 30 focused tests; 96.89% statements, 93.82% branches, 100% functions and 98.62% lines. The dashboard/public-route/permission-coverage regression run passed 180 tests.
- Web: 22 focused tests; 98.50% statements/lines, 97.50% branches and 100% functions. Every new module exceeds 80%. Six existing DashboardContent regressions passed.
- SQL: 12 pgTAP checks, 36 named transactional portfolio assertions and eight decimal source checks. Existing CVSS parity distinguishes the explicit decimal correction. Fixtures complete through the real atomic RPC and roll back; the final [identity boundary regression log](../evidence/m14-05/identity-boundaries-sql.log) includes the two added characterization checks after the repository gate.
- Identity: 17 read-only representation cases passed against the installed PackageURL parser; [parity log](../evidence/m14-05/identity-parity.log).
- Live API: 30 tests across nine suites passed against the local stack, including contracts, security, sessions, refresh and organization switching; [API log](../evidence/m14-05/api-live.log).
- Authentication: 33 shell checks passed; [auth log](../evidence/m14-05/auth-flow.log).
- DB lint completed without an error-level failure; preexisting warnings remain.

## Browser and Supabase evidence

Playwright MCP signed in the verified seeded owner on the owned CRA origin, opened Portfolio from Dashboard, inspected exact-version concentration and followed Alpha's existing product-posture route. Screenshots: [desktop](../evidence/m14-05/portfolio-desktop.png), [mobile](../evidence/m14-05/portfolio-mobile.png) and [product posture](../evidence/m14-05/product-posture.png).

The final browser suite passed nine journeys across Chromium 151.0.7922.34, Firefox 153 and WebKit 26.5. Owner drilldown, transient-outage evidence retention, authorization-denial erasure and viewer readiness restrictions passed in all three engines. Playwright MCP used Chrome 155. See the [browser log](../evidence/m14-05/browser-final.log). Tests blocked egress outside the local origin. These results do not establish native Edge/Safari or previous-major coverage.

Read-only Supabase MCP confirmed the local project and fixture: two distinct products and two releases with four component memberships for the exact 1.0.0 PURL. The displayed distinct product count matches; the second version remains separate. No secrets or unnecessary user data were queried or displayed.

The final [Supabase cross-check](../evidence/m14-05/supabase-final.json) confirmed 289 public tables, 202 recorded migrations (latest `20261012120412`), six private portfolio helpers and the service-role-only facade. All pin `search_path`; representative source tables retain enabled, non-forced RLS. The three synthetic browser products remain retained with source and audit evidence because existing lifecycle guards block archival while their releases remain active. See the runbook for their exact IDs. Benchmark-only processes and private credentials were removed; the isolated benchmark database and development servers remain available.

An initial browser assertion referenced an obsolete dashboard/products route; it was corrected to the existing `/products/:id/posture` route. A WebKit sign-in probe exposed test interaction before hydration; the test now waits for retained controlled-form values. Production authentication was unchanged.

## Repository and load gates

The final `pnpm verify` passed 7,559 unit tests: API 4,920; web 1,635; contracts 868; UI 98; agent 24; design 9; docs 5. It also passed 141 architecture tests, 168 serial infrastructure SQL files, lint, type checks, dependency checks and builds. See the [complete final log](../evidence/m14-05/pnpm-verify-final.log). The existing Next.js middleware deprecation warning remains.

An earlier run encountered the M14-04 simulated audit-snapshot fixture during concurrent clone writes. Its isolated rerun passed without code or test changes. The final repository gate serialized database fixture work and passed.

Quiet authenticated reads used the real Nest application, authentication/permission guards and an isolated clone adapter. Each primary request ran concurrently with a distinct small-tenant product request every fourth sample. All 720 primary and 180 secondary requests returned HTTP 200; pages remained bounded to 20 rows. The retained clone contains exact 10k/100k/1m memberships across 1,000 products per scale, with 10-product/100-membership secondary tenants. No reset or unrelated-data deletion occurred. [Fixture metadata](../evidence/m14-05/benchmark-fixture-metadata.json) and [function-definition alignment](../evidence/m14-05/benchmark-definition-alignment.json) identify the evidence baseline; all seven portfolio SQL definitions match the live primary database.

| Memberships | Endpoint | Samples | p95 ms | p99 ms | Maximum response bytes | p95 <400 / p99 <1000 |
| --- | --- | --- | --- | --- | --- | --- |
| 10,000 | products | 20 | 223.83 | 305.54 | 16,629 | Met in this probe |
| 10,000 | concentration | 20 | 206.43 | 228.25 | 10,396 | Met in this probe |
| 10,000 | concentration/detail | 20 | 192.29 | 195.19 | 13,097 | Met in this probe |
| 100,000 | products | 20 | 260.47 | 378.85 | 16,631 | Met in this probe |
| 100,000 | concentration | 20 | 323.27 | 326.01 | 19,718 | Met in this probe |
| 100,000 | concentration/detail | 20 | 325.60 | 325.77 | 13,100 | Met in this probe |
| 1,000,000 | products | 200 | 1170.93 | 1615.80 | 16,632 | **Missed** |
| 1,000,000 | concentration | 200 | 2123.93 | 2187.80 | 19,738 | **Missed** |
| 1,000,000 | concentration/detail | 200 | 2229.49 | 2314.08 | 13,104 | **Missed** |

The 10k and 100k probes have only 20 samples per endpoint, so their observed threshold passes have limited tail confidence. The 1m gate used 200 samples for each endpoint and **missed both latency targets on all three endpoints**. Functional correctness and bounded responses passed; the performance acceptance criterion remains unmet at this scale. The concurrently served small tenant had 150 samples during the 1m gate, p95 135.46 ms and p99 235.68 ms, with an 8,888-byte maximum response; this supports limited tenant-interference evidence, not a general fairness guarantee.

The benchmark API's operating-system RSS, sampled every second, peaked at 306,315,264 bytes (292.13 MiB) for 10k, 306,331,648 bytes (292.14 MiB) for 100k and 297,746,432 bytes (283.95 MiB) for 1m. This includes the full Nest application; it does not measure PostgreSQL peak memory, transient RSS between samples or production capacity. Harness memory is recorded separately. Raw timings: [10k](../evidence/m14-05/http-benchmark-10000.jsonl), [100k](../evidence/m14-05/http-benchmark-100000.jsonl) and [1m](../evidence/m14-05/http-benchmark-1000000.jsonl).

Two-sample read-only SQL diagnostics and EXPLAIN/BUFFERS were measured separately after HTTP timing: [10k](../evidence/m14-05/sql-read-benchmark-10000.log), [100k](../evidence/m14-05/sql-read-benchmark-100000.log) and [1m](../evidence/m14-05/sql-read-benchmark-1000000.log). These diagnostics do not replace authenticated API percentiles. Initial two-sample probes are not reported as passes: repeated full-scope work prompted bounded page enrichment, compact supersession keys and sparse finding joins while retaining exact totals.

Independent review confirmed that NULL/empty package identities are normalized by `nullif` in `raw_components` before distinct grouping; no production defect or migration was required. Both additional rollback regression assertions passed after quiet benchmarking. The stable UI review found no findings, and the final acceptance review found no new high or critical issues. Functional verification is complete; the ticket is not declared fully accepted because the 1m latency requirement remains unmet.

## Residual limits

The historical migration ledger and CHECK-constraint diff remain baseline concerns. Automated semantics, keyboard and responsive checks do not constitute WCAG or legal certification. The 1m authenticated read gate misses the required latency targets; PostgreSQL peak memory and broader concurrent load remain unmeasured. Portfolio exports/scheduling, granular ACLs and CPE/hash concentration remain outside scope.
