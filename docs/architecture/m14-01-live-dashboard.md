# M14-01 Live Dashboard and Product Posture

## Scope and preserved contracts

Deliver FR-AN-001/002/003/009: live operational summaries and product posture. Keep source-owned regulatory decisions, current tenant/module permission model, onboarding, demo galleries and their mock namespaces. Preserve existing APIs, cookies, auth actions, JWKS, zero session skew, menu keys and all source mutation workflows. Trends, exports, scheduling, portfolio, ACL redesign and certification are out of scope.

## Concrete problem

`apps/web/app/dashboard/page.tsx` contains static commerce totals and `/api/orders`. M2 support/classification, M3 source/document lineage, M4/M5 finding severity/assessments, M6 stages and M7 evidence readiness exist, but their granular APIs cannot provide efficient, source-authorized dashboard aggregates. The triage queue also materializes operational work and is unsuitable for a pure summary read.

## Why not simpler?

Browser fan-out over every product/release/finding is unbounded and cannot enforce count authorization. A new cached projection table introduces invalidation and history that this feature does not need. The direct solution is one bounded read facade calling existing source decisions and source-owned aggregate helpers.

## Selected patterns

- Adapter: Supabase provider results differ from parsed dashboard contracts. `SupabaseDashboardRepository` implements inward-owned `DashboardReadPort`; malformed provider values fail before disclosure. Remove the adapter only when storage becomes an inward-owned implementation.
- Facade/composition: the dashboard coordinates M2–M7 safe read projections without adopting their rules. Presentation → application → domain; infrastructure implements the application port. A shared contract suite checks outcomes and scope. Remove composition only if summaries cease crossing source domains.
- Injected gateway: browser transport/cancellation and runtime parsing form a real external boundary; functional React consumes a focused `.ts` `DashboardGateway`.

## Rejected patterns

No bus, strategy hierarchy, abstract factory, singleton request state, new worker, persistence or server cache. No per-product ACL invented from responsible ownership. No readiness/timer/matching implementation in the dashboard.

## Data and tenant boundaries

Verified authentication supplies actor/session/organization. All private service-role reads take organization first and intersect active membership, current effective permission and same-tenant source relationships before counting/limiting. Source availability is explicit; hidden inputs do not become zero/complete. A coherent database read snapshot supplies server time and generation time. Reads create no effects and need no mutation idempotency. Fifteen-minute authenticated cursors bind principal, permission revision, filters, endpoint and position; pages are live views, not snapshots.

CLI migrations add private read functions and only measured indexes, no tables/columns/backfill. Pin search paths and explicitly grant service role after revoking browser roles. Preserve non-forced RLS. Regenerate both type copies with `db:types`. Historical ledger discrepancies are retained.

## API boundary contracts

`@repo/contracts/dashboard/schemas` owns strict query/path, section, response and cursor schemas; `dashboard/types` derives `z.output` types. Nest uses Zod pipes and `@ZodResponse`. Gateway outgoing query/path parsing and successful response parsing use existing authenticated transport. Source enums reuse owning contracts. Unknown inputs fail validation. Missing versus empty versus restricted versus unavailable/stale are discriminated rather than guessed.

## Frontend logic and rendering

Functional overview, posture, countdown, severity, readiness, coverage and ingestion components use current tokens/shared UI. A gateway owns injected transport; pure formatting and source display policies remain functions. Hooks scope cached browser data by principal/organization/permissions, cancel old requests on switches, clear data on definitive denial and label retained same-scope data stale on outages. Database time plus monotonic elapsed time drives display, never regulatory writes. Existing source edit workbenches and dirty drafts remain untouched except additive validated drilldown selection.

## Failure modes

Invalid query/cursor fails 400; changed permission scope forces a fresh read without old evidence; foreign/unauthorized product is not-found. Database outage returns safe 503; source failure gives unavailable section without fabricated metrics. Provider schema drift fails parsing. Current access is rechecked on each request. Pending anchors and cancelled/submitted stages do not count down. Legacy unknown severity, missing files, zero applicable sections, stale evidence and invalid/deduplicated SBOMs have explicit outcomes. No SMTP/external network is required for core reads.

## Tests and observability

Failing characterization/schema/policy tests first, then provider/route tests, transactional read-only SQL and grants tests, source-state/lineage tests, scope/cursor tests, browser refresh/org-switch/drilldown/keyboard tests and focused coverage ≥80% all metrics. Run architecture/full verification and live stack checks. Measure disposable large tenants and report p95/p99/memory/response size, including misses. Logs contain route/source/safe code and timings, never credentials or source payloads.

### Resumed performance work, 2026-10-08

The million-finding overview missed latency acceptance and one authenticated load batch returned an unexplained sanitized 503. The follow-up plan is `docs/superpowers/plans/2026-10-08-m14-01-dashboard-performance.md`. Investigate fixed tenant-wide/product-specific query shapes and exact observation deduplication without changing source policy or adding persistence. Measure maintained indexes, cached-plan transitions and diverse observations in the disposable database. Add allowlisted failure-phase diagnostics where necessary, retaining public error shaping and excluding raw provider messages, payloads and identities. Do not increase timeouts, omit failed measurements, fan out source RPCs outside the coherent snapshot, or broadly relabel source functions as parallel-safe to obtain a passing result.

The rich diagnostic subsequently measured roughly nine-second overviews at both 10k and 100k findings with 1,000 source graphs. Five authenticated reads on the smaller rich fixture each hit PostgreSQL `57014` cancellation at the existing eight-second timeout and returned sanitized 503. This establishes the current fixture's cause; it cannot retroactively classify the earlier uninstrumented million-row failure.

The direct correction being tested is shared source-owned CVSS candidate extraction: the full M4 reader and dashboard consume the same private candidate helper, while M5 retains its existing score thresholds. The dashboard batches at most 250 already-authorized vulnerability IDs per helper call; no hidden inputs, truncation, stored cache or separate severity authority is introduced. Fixed overview/product statements retain the same source joins and policy. Frozen-original full-reader, candidate-selection and scalar-versus-batch parity tests must precede integration; retain exact normalization and ordering, including existing unspecified equal-ranked ties. Rollback restores the previous function bodies and disables new code, retaining additive schema and source evidence.


### Feature-local coherent permission context

Measured HTTP traces include required authentication work and three dashboard-owned permission-version reads around the existing resolver. A private read-only permission-context RPC is the candidate replacement for that dashboard fan-out: one MVCC statement returns active tenant/user/membership, the authoritative permission revision, tenant-bound custom-role inputs and base-role overrides. The existing shared `resolveEffectivePermissions` remains the only merge authority. No server cache, global guard, permission-version trigger or session behavior changes.

The adapter parses provider identity, current role, positive safe revision and policy input shapes before resolution. Foreign/malformed/inactive contexts fail closed; verified role disagreement requires a fresh authorized request. Cursors continue to bind the resolved permissions and revision. The source facade independently applies current source authorization before any counts, so a later revocation cannot rely solely on this earlier context. Test coherent concurrent commit/rollback, role changes, overrides, custom-role labels and source denial. This candidate is not accepted until reviewed and measured; existing global profile, MFA, JWKS, membership and zero-skew guards remain mandatory.

## Rollback

Deploy schema/types → API → web. Restore the commerce entry and disable new routes if rolling back code. Leave additive functions/indexes and source records intact; previous APIs remain compatible. No data reset, migration ledger repair, evidence deletion or destructive rollback.

## Review checklist

- [x] Direct solution and nearby patterns considered.
- [x] Real adapter/gateway/composition boundaries with contract tests planned.
- [x] No global request/principal/tenant state.
- [x] Controllers/pages contain no provider calls or decisions.
- [x] Layer direction and runtime schemas documented.
- [x] Functional rendering and scoped logic classes.
- [x] Pure reads, additive deployment, no source mutations.
- [x] Focused coverage, live/compatibility gates and independent review completed.
- [x] Measured synthetic large-tenant latency acceptance; results and workload boundaries recorded in the validation runbook.
