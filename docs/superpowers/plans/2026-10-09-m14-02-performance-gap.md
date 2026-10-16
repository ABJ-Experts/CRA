# M14-02 performance gap Implementation Plan

> **For agentic workers:** Use task-by-task execution with independent review. Steps use checkbox syntax for tracking. The user has authorized planning and execution in this session.

**Goal:** Remove the measured organization query timeout and meet authenticated read p95 <400ms / p99 <1000ms without changing historical values or authorization.

**Architecture:** Keep the existing dashboard gateway, contracts, controller, use case and Supabase port. Optimize the source projection directly: reduce nullable legacy reopening facts once into calendar bucket counts, retain indexed typed bucket counts, and use an exact previous-state partial index with bounded unique predecessor lookups instead of repeated JSON heap reads. If measured costs remain above target, consolidate repeated latest-finding reads inside the same authorized, PostgreSQL-snapshot-bound request; never cache permission-shaped aggregates or rewrite immutable facts.

**Tech Stack:** Existing PostgreSQL 17, Supabase CLI, NestJS, shared Zod, pnpm, React and Playwright.

**Spec:** `docs/architecture/m14-02-reproducible-trends.md`; accepted M14-02 plan and metric policy.

## Global constraints

- Preserve `/api/v1`, auth cookies, ES256/JWKS, zero session epoch skew, permissions and source-authoritative decisions.
- Authorize before aggregation; preserve tenant/product filters, sequence bounds and `pg_visible_in_snapshot` on every contributing stream.
- No data reset/deletion, new aggregate table, immutable history rewrite, historical ledger repair, or changes to unrelated services/browser data.
- Add reviewed migrations through the Supabase CLI. Regenerate both type copies through `db:types`.
- Preserve missing-history versus zero, terminal cohorts, negative exclusions, actual baseline dates, correction/reversal eligibility and exact chart/source/CSV parity.
- All measured requests include cold reads and errors; retain existing authentication and rate limits.

## Review focus

- Legacy missing `superseded` fields must keep the same false-by-default predicate.
- Daily/weekly/monthly and DST boundary clipping must retain the same bucket keys and partial flags.
- Late commits, corrections and duplicate deliveries must not enter an earlier pin.
- Organization scope must not infer hidden records or enable product-required duration/readiness metrics.
- Deep history and many distinct findings have different query costs; both must pass, with bounded memory and capture overhead reported.

### Task 1: Bound legacy reopening reduction

**Files:** New CLI migration under `apps/infrastructure/supabase/migrations/`; regression SQL under `apps/infrastructure/tests/`; update the existing architecture design.

**Interfaces:** Preserve `public.get_dashboard_trends(uuid,uuid,jsonb,jsonb) RETURNS jsonb` and `public.get_dashboard_trend_sources(uuid,uuid,jsonb,jsonb) RETURNS jsonb` without public changes.

- [x] Extend SQL characterization for typed/legacy reopenings, absent superseded metadata, corrections, baseline clipping and pinned visibility; observe current benchmark timeout as the performance failure.
- [x] Prototype one-pass reopening bucket reduction and an exact `(organization_id,sequence)` previous-closed-state partial index inside a rollback-only clone transaction.
- [x] Apply the bounded unique predecessor lookup to both chart and source legacy streams before shipping its index; reject any source-page regression.
- [x] Compare identical pinned series and source pages before/after; run reopening, baseline, visibility and full trends SQL tests.
- [x] Accept only a measured improvement; create an additive CLI migration, retain exact anchor checks and pinned function settings/grants.

### Task 2: Remove remaining repeated projection work

**Files:** Same owning SQL projection, a separate additive migration if needed, focused SQL tests.

**Interfaces:** Existing metric policy, response schema and dataset epoch remain stable when series are byte-identical. Organization-only parent identity enumeration requires the validated composite FK proof; product-scoped identities remain source-history-owned. No parent timestamps, state or current product membership enter metric calculation.

- [ ] Measure remaining organization and selected-product plans after Task 1, including latest identity/payload reads and coverage counts.
- [ ] Test organization parent identity equivalence with SQL-valid rootless histories, protected parent deletion/tenant changes, future pinned facts and product relocation; reject root-only enumeration.
- [ ] If needed, write tests for shared latest-event reduction across activity/triage/remediation with authorization withheld, negative/unresolved durations and correction pins.
- [ ] Consolidate only proven repeated source reads; materialize narrow projected values rather than full history. Retain fallback for genuine legacy data.
- [ ] Repeat exact parity and concurrency tests before applying the reviewed migration to local development and the owned benchmark clone.

### Task 3: Acceptance and compatibility evidence

**Files:** `apps/infrastructure/tests/m14-02-trends-http-benchmark.mjs`, guard tests if changed; existing M14 runbook and evidence directory.

- [ ] Preserve existing fixture/database/runtime isolation. Authenticate through the real local owner flow; never bypass guards or throttles.
- [ ] Run 200 authenticated chart samples at 10k, 100k and 1m; include selected product, wide cohorts and organization scope. Run pinned sources and CSV parity, concurrent mixed-tenant reads and actual source capture overhead.
- [ ] Exhaust bounded activity/SBOM source pages on the 10k control and compare totals to pinned chart sourceCount; validate every CSV field. Large histories stay bounded; document enumeration limits.
- [ ] Report p95/p99, failures, cold reads, memory, sample sizes and limitations. Passing median or warmed subsets cannot close the gap.
- [ ] Regenerate types, run DB lint/diff diagnostics and applicable live-stack/concurrency tests, then `pnpm verify`.
- [ ] Independent read-only correctness/security review; address material findings.
- [ ] Use Playwright MCP in owned isolated contexts for desktop/mobile, accessible tables, source/CSV and degraded behavior; cross-check values with local Supabase MCP.
- [ ] Update requirement-to-test mapping, measured acceptance status and rollout/rollback guidance. Stop only owned benchmark runtimes, retaining all facts and unrelated state.

No commit, push, deployment, database reset or historical migration repair is part of this continuation.
