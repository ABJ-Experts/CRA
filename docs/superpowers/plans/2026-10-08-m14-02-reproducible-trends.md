# M14-02 implementation plan

Goal: implement reproducible FR-AN-004/FR-AN-009 trends under current authorization.
Architecture: functional dashboard -> gateway/transport -> shared Zod contracts
-> thin Nest routes -> application ports -> private Supabase projections.
Technology: installed React/Next, Nest, Zod, TanStack Query, ECharts and PostgreSQL17.
Specification: `docs/architecture/m14-02-reproducible-trends.md` records the approved
metric policy and feature-design decisions. No new dependencies or generic cache.

Global constraints: preserve source regulatory authority, auth/API/cookies/menu,
current user work and data. CLI migrations/types, non-forced RLS, explicit grants,
org-first reads, no invented history or zero for missing observations. All new
and materially changed modules require >=80% statements/branches/functions/lines.

## Tasks

1. RED: schema and policy tests for bounded date/timezone, metric denominators,
   zero/null, missing cohorts and snapshot source metadata. Implement contracts.
2. RED: source history, rollback, duplicate, late-commit visibility and correction
   tests. Add two source-owned ledgers and M7 visibility metadata with baseline.
3. RED: API identity/source permission, token tampering/expiry/revocation and
   provider failure tests. Implement trends/sources/export use cases, inward
   ports, adapter, encrypted dataset codec and parsed routes.
4. RED: gateway transport, scoped cache invalidation and chart/table tests.
   Implement operational cards, UTC/IANA filters, product cohort selection,
   accessible tables, source paging and exact authorized CSV download.
5. Register portable history in tenant exports and retention classifications;
   preserve holds and existing source-operation audit authority.
6. Apply only new reviewed additive local migration after identity guards; retain
   historical ledger discrepancies. Regenerate types with infrastructure db:types.
7. Run focused tests and coverage; pnpm verify, applicable live tests and db:lint.
   Run isolated concurrent-write and 10k/100k/1m benchmarks, owner/restricted
   browser journeys and Playwright MCP screenshots without unrelated cleanup.
8. Independent review of source capture, authorization, reproducibility, UI and
   compatibility. Fix high findings and repeat affected checks. Record actual
   evidence, runbook/rollback and residual limitations.

Review focus: final-state capture (not transient assessment rows), complete M3
denominator/numerator capture, immutable corrections, current snapshot source
authorization, PostgreSQL visibility pins, stale permission-bound CSV, truthful
history baseline, bounded source queries and source-write performance.
