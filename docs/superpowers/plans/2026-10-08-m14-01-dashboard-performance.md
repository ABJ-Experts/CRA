# M14-01 remaining performance and availability work

Goal: finish the live dashboard's large-tenant read acceptance without changing source decisions, authorization or retained evidence.

Baseline: uncommitted M14 implementation on `milestone-1`, HEAD `97999948e3ee0dadb6ec480aa367baf7600d72c0`. Functional, coverage, full verification and live checks passed. The shipped million-finding SQL overview measured p95 842.30 ms / p99 1562.52 ms; authenticated HTTP measured 514.30 / 1261.79 ms and a subsequent run returned an unexplained 503. Neither run establishes performance acceptance.

## Constraints

Keep exact M2–M7 source predicates, tenant membership/module permissions, strict parsing, current API/auth/demo contracts and pure read behavior. No new tables, columns, persistence, server cache, dependencies, approximate counts or global PostgreSQL tuning. Tests and load fixtures use only the guarded disposable `cra_m14_benchmark` database. Preserve unrelated applications, site storage, historical migration ledger and original source evidence. Existing authorization is sufficient to continue this approved task; no commit or push is requested.

## Task 1: Diagnose and characterize

- Database worker owns M14 SQL, SQL tests and benchmark fixtures; reviewer independently examines query plans and source call graph.
- Reproduce custom/generic/cold plans with the index maintained during fixture inserts. Test diverse vulnerability/evaluation inputs, not only one repeated observation tuple.
- HTTP worker owns safe provider diagnostics and an isolated authenticated benchmark harness. Record every success/failure latency and safe failure category; never record source bodies, credentials or tokens.
- Distinguish provider timeout, transport failure, envelope validation and response validation. Do not increase timeouts or omit failed requests to pass a latency gate.

## Task 2: Implement the smallest measured correction

- Write failing correctness/diagnostic tests before implementation.
- Evaluate separate tenant-wide/product-specific query shapes to remove optional-filter plan ambiguity while keeping one shared source policy.
- Consider parallel execution only after checking the entire helper call graph for read purity and PostgreSQL safety; never blindly mark functions safe.
- Retain only a candidate that improves measured behavior and preserves assessment undo, renewed review, suppression, severity provenance, foreign-product omission and count/drilldown parity.
- The separate unassessed/assessed streams passed expanded parity but worsened the maintained million-row measurement, so correctness alone does not justify retaining them. An overview-only release-join elimination may be tested only after proving the immediate, validated composite organization/release foreign key, rejecting a forged composite insert under normal enforcement, and retaining the product-specific release join. This relies on the enforced schema and makes no claim about privileged corruption that bypasses constraints.
- The richer diagnostic run measured approximately nine-second overviews at both 10k and 100k findings with 1,000 source graphs. If profiling confirms repeated full-intelligence projection, extract one private source-owned CVSS-row helper shared by the full M4 reader and the dashboard's bounded batch projection. Preserve exact active/current source selection, nested/direct candidate union, regex/casts, version/timestamp ordering and existing full-reader output. Do not silently fix source normalization or introduce a dashboard decision engine. Require pre/post full-reader parity and scalar/batch severity tests before integration.
- Measure a feature-local coherent permission-context RPC replacing only dashboard-owned duplicate version/role/override round trips. Use current active membership and authoritative revision in one MVCC snapshot, parse provider inputs, and reuse the unchanged shared resolver. Preserve global session guards, source-facade current authorization and cursor fingerprints. Require failing provider/policy/concurrency tests and measured HTTP benefit before selection.
- Independently review source-policy, grants, RLS, parsing and failure changes before integrating. CLI migrations/types only; no historical ledger repair.
- Evaluate read-local materialized effective-assessment and active-suppression projections for the overview, preserving the previously validated product query. Validate with nonzero policy data, not only empty assessment tables: optional default-zero bounded fixture counts create pending assessments and active suppressions on exact owned synthetic finding IDs. Expected open/severity/suppression counts are derived from fixture arithmetic; cleanup explicitly removes owned dependent rows before findings even when replica loading bypasses cascades.

## Task 3: Verify integration and acceptance

- Run focused SQL/API tests and all coverage metrics at least 80% on materially changed modules.
- Measure 10k/100k/1m findings, diverse observations, cold/planned repetitions and overlapping tenants. Record response size, memory and all HTTP outcomes. Target p95 <400 ms / p99 <1000 ms; report any miss honestly.
- Recheck local CRA project identity and migration/function/type alignment through Supabase MCP; report unavailable advisor/log checks.
- Run `pnpm verify`, applicable `pnpm test:live`, and CRA-only Playwright owner/restricted dashboard/posture/refresh/drilldown checks under the existing outbound-egress restriction. Keep screenshots outside the repository.
- Update architecture, requirement mapping, measured evidence and deployment/rollback runbook. Rollback remains code disablement with additive schema and durable evidence retained.

## Coordination and review

SQL and HTTP tasks share only the disposable benchmark database and projection interface; schedule load runs sequentially. The root agent owns documentation/integration. Independent review follows each implementation slice and the final diff. Completed functional tasks are not reimplemented. Persist progress in this plan's ledger; unresolved performance remains explicitly open until measurements support completion.
