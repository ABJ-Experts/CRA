# M14-01: Live CRA Dashboard and Product Posture Implementation Plan

> **For agentic workers:** Use independently owned contracts, source projections, API and UI slices, followed by independent review. Each slice follows failing tests → implementation → coverage.

**Goal:** Provide an authorized operational dashboard and product posture view using existing source decisions, with regulatory countdowns as the primary focus.

**Architecture:** Functional React → injected `DashboardGateway` → authenticated transport → shared Zod contracts → thin Nest controller → application use cases/port → Supabase adapter. Private read-only RPCs compose projections owned by M2–M7.

**Tech stack:** Existing Next.js, React, NestJS, Zod, Supabase/PostgreSQL, shared UI/chart primitives, Vitest, Jest and Playwright. No new dependencies.

**Spec:** User-approved M14-01 plan, FR-AN-001/002/003/009, supplied requirements and `/Users/abjmac003/Downloads/CRA-Sentinel-Technical-BRD-v2.0-ABJ-Experts.pdf`.

## 1. Verified baseline and locked decisions

- Clean `milestone-1` at `97999948e3ee0dadb6ec480aa367baf7600d72c0`, matching the remote. M13-05 is committed.
- `/dashboard` currently renders commerce statistics and `/api/orders` demo data.
- Local Supabase MCP confirms CRA at `http://127.0.0.1:54321`, PostgreSQL 17.6, 282 public tables and 131 migration-ledger entries.
- Relevant source tables have non-forced RLS and no browser SELECT grants; inspected RPCs have pinned search paths and service-role-only execution.
- Historical ledger discrepancies remain: 440 local migrations absent from the ledger. Do not replay or repair them.
- Table-list, advisor and PostgreSQL-log MCP calls returned HTTP 502. Read-only catalog queries supplied table, column, constraint, index, trigger, grant and extension evidence.
- Baseline verification passed: 1,406 web tests and three focused reporting/readiness use-case tests.

**User-selected policies:**

- Make `/dashboard` the live CRA dashboard; preserve commerce at `/dashboard/ecommerce` and retain other demo routes.
- Add a dedicated `/products/:productId/posture` view.
- Preserve current active-membership, tenant and module-permission access. `responsible_owner_id` is not an ACL; introduce no product-access system.
- SBOM coverage describes accessible, non-archived releases currently on the market.
- Findings readers may see minimal feed freshness; feed configuration and operational details remain admin-only.
- Open findings exclude effective approved or approval-exempt `fixed`/`not_affected` assessments. Pending/rejected assessments and renewed review remain open. Suppressed findings remain open and are identified separately.

**Persistence:** No new tables, columns, jobs, materialized views or server cache. Add only source-owned read functions and necessary measured indexes through CLI migrations.

## 2. Contracts, APIs and authorization

Add schemas/types under `@repo/contracts/dashboard`, with trusted types derived from `z.output`.

| Public GET route | Purpose |
| --- | --- |
| `/api/v1/dashboard/overview` | Dashboard summaries and initial bounded lists |
| `/api/v1/dashboard/products/:productId/posture` | Combined authorized product posture |
| `/api/v1/dashboard/obligations` | Active stages or product obligation history |
| `/api/v1/dashboard/readiness` | Bounded product readiness rows |
| `/api/v1/dashboard/ingestion` | Bounded ingestion-status rows |

Queries accept only documented filters, optional `productId`, cursor and limit. Default page size is 20; maximum is 100. Overview embeds at most ten rows per list.

`DashboardUseCases` exposes `overview`, `posture`, `obligations`, `readiness` and `ingestion`; an inward-owned `DashboardReadPort` supplies their parsed projections. Every repository method takes organization ID first and verified actor context separately.

All consumed path/query inputs, provider envelopes and successful JSON responses are parsed. The gateway uses the existing authenticated transport; GET refresh behavior remains unchanged.

Responses include verified organization scope, database `serverNow`, generation time and per-source observation/update timestamps. Sections distinguish `available`, `empty`, `restricted`, `not_initialized`, `stale` and `unavailable`. Restricted/unavailable sections contain no counts, identifiers or fabricated zero values. Old record timestamps alone do not imply a stale source.

Use authenticated opaque cursors following the existing token pattern, with a dashboard-specific cryptographic context. Bind cursors to organization, actor, session, permission version, endpoint, filters and keyset position; expire after 15 minutes. Reauthorize every page. Pagination is a live view, not an immutable snapshot.

- Overview/page routes require `can_view_dashboards`; posture also requires `can_view_products`.
- Product-linked sections require product access plus their source permission.
- Findings and reporting retain existing `can_view_findings` semantics; do not substitute `can_view_reporting`.
- SBOM sections require `can_view_sboms`; readiness requires `can_view_technical_files`.
- Feed freshness requires findings access and exposes only safe status/timestamps.
- Apply scope before joins, counts, limits and drilldowns. Unauthorized/foreign product posture returns indistinguishable not-found. No organization ID supplied by the browser becomes authoritative.

## 3. Source projections and operational UI

Implement one private dashboard RPC facade backed by source-owned helpers. Use a coherent database read snapshot and isolate individual source failures. Database connection failure returns sanitized 503; one failed module does not erase healthy sections.

Do not call source read functions that materialize work or mutate state. The triage queue invokes due-work materialization; dashboard aggregation must use a pure findings projection.

- **M2 products:** authorized product counts, latest classification and effective support periods. Reuse `m2_active_support_period` release-specific → product fallback; show missing, not-started, active and ended support explicitly.
- **M4/M5 findings:** pure unresolved-open predicate shared by summary and drilldown. Require active, unclosed, unsuperseded findings; resolve effective assessments through existing M5 logic, including bulk undo and renewed review. Reuse existing severity provenance/mapping, including `unknown`. Suppression never cancels a regulatory obligation.
- **M6 reporting:** read stored `due_at`, stage state, elapsed progress and breach history. Exclude rehearsals from operational totals. Active real obligations on archived products remain visible.
- **M3 SBOM:** eligible releases are non-archived, with placement recorded, excluding development/withdrawn lifecycle. Include end-of-support releases still on the market. Validate verified source, completed valid document, exact tenant/release association and deduplicated canonical lineage. Count each release once. Failed/pending uploads are not coverage; a pending replacement does not discard a still-valid completed predecessor. Coverage is not a quality score.
- **M7 readiness:** bounded per-product section progress and prioritized gap links, derived from existing readiness logic. No invented tenant-wide compliance score. Authorize linked source dependencies before disclosure; withhold readiness rather than remove hidden inputs and produce a misleading score. Return no source titles/IDs or evidence counts through the summary. Progress means complete applicable sections divided by applicable sections. Missing files, unavailable/stale evidence and zero applicable sections never become a green 100%.
- **M4 feeds:** existing freshness semantics projected to safe status and timestamps, without provider configuration, raw failures or sync history.

The dominant first content region shows the countdown and highest-priority actionable stage. Order overdue stages first, then running stages by `due_at`, then pending-anchor items. Pending anchors have no invented deadline; cancelled/submitted/not-required stages do not run countdowns. Preserve breach history after late submission.

Display countdowns from database time plus monotonic elapsed browser time. Refresh every 30 seconds while visible and on focus/reconnect; browser expiry never writes or establishes a breach. On refresh failure label retained authorized data stale and show the last successful refresh.

Below the countdown show severity bars with numeric labels and an accessible table, obligation list, readiness rows with specific gap actions, SBOM numerator/denominator, and ingestion table. Use semantic tokens, `cn()`, shared UI subpaths and restrained layouts. Preserve onboarding and drafts; keep components outside the large product workbench. M14 routes use actual session identity or neutral copy and suppress the independently fetched header countdown. Demo headers remain compatible.

- Add an optional findings `openOnly` filter, default false; apply its shared predicate before pagination.
- Parse product/severity/open-filter deep links into existing triage controls.
- Obligation links identify obligation and stage.
- Add a validated technical-file section deep link that opens the named gap without discarding dirty work.
- Preserve demo routes, existing redirects, menu keys and `/api` demo namespaces.
- Mock-enabled CRA routes show live-backend-required state; never fall back to commerce numbers.

## 4. Implementation tasks and verification

### Task 1 — Contracts and characterization

- [x] Write failing schemas/tests for section states, forbidden-data suppression, coverage fractions, null deadlines, pagination and strict query parsing.
- [x] Characterize demo routes, onboarding, source permissions and transport refresh.
- [x] Implement shared contracts/types and additive drilldown inputs.
- [x] Run focused tests and obtain at least 80% across all coverage metrics.

### Task 2 — Database and source projections

- [x] Write failing SQL tests for tenant/permission isolation, resolved findings, assessment undo, suppression, SBOM lineage, readiness restrictions and countdown edge cases.
- [x] CLI-create additive read-function migrations with pinned search paths and explicit private grants.
- [x] Prove reads do not change source state, audit evidence or work queues.
- [x] Verify source failures separately, cursor scope changes and concurrent source updates.
- [x] Run lint/infrastructure tests and regenerate both type copies through the existing command.

### Task 3 — API and gateway

- [x] Write failing policy, provider-parsing, controller and gateway tests.
- [x] Implement five GET routes and bounded composition.
- [x] Reject scope changes/malformed provider results before disclosure; log safe source failure classifications only.
- [x] Verify aggregate omission, session revocation, foreign IDs and GET refresh.
- [x] Run coverage and independent security review.

### Task 4 — Dashboard and product posture

- [x] Write failing component/hook tests for hierarchy, source states, server-clock resynchronization and navigation.
- [x] Move commerce; build dashboard and dedicated posture.
- [x] Key query state by tenant, user, permissions and filters; cancel old requests on organization change and never reuse another tenant's data.
- [x] Clear evidence on authorization failure; retain same-scope data only with stale labeling on transient failure.
- [x] Verify keyboard, focus, reduced motion, announcements, responsive tables and draft preservation.
- [x] Run coverage and independent code/UI review.

### Completion evidence

- [x] Empty/no-products/missing-file/zero-coverage/partial-outage tests.
- [x] Running/overdue/pending/cancelled/late/rehearsal/archived-product obligation tests.
- [x] Severity thresholds/unknown, effective resolved/pending/rejected/undone assessments, suppression.
- [x] Deduplicated/superseded SBOMs, invalid documents, interrupted ingestion.
- [x] Restricted/custom permissions, forged tenant/product IDs, revoked membership, organization switching.
- [x] Drilldown parity, stale/corrupt cursors, concurrent changes.
- [x] `pnpm verify`, applicable `pnpm test:live`, architecture gates, 80% all metrics per module.
- [x] Playwright MCP only against CRA development with owner/restricted accounts; preserve other sites' cookies/storage. Capture screenshots outside the repository.
- [x] Disposable 100/1,000/10,000-product and 10k/100k/1m-finding benchmarks; mixed-tenant reads, response size, memory and p95/p99 against 400/1,000 ms. Record misses honestly.
- [x] Actual egress-blocked verification allowing required local services.

## 5. Deployment and residual boundaries

Deploy additive functions/types, API, then web. No backfill. Rollback disables new API/UI and restores the demo entry through code; retain functions and all source evidence. Completion records requirement-to-test links, results, screenshot locations, deployment/rollback and unavailable MCP checks.

Preserve `/api/v1`, cookies/JWKS, auth-actions, zero session skew, permission merge order, menu/MSW and M1–M13 flows. No new decision engines, ledger repair, resets, evidence deletion, certification or zero-bug claims.
