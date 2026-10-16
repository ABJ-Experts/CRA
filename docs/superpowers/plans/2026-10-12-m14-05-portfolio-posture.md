# M14-05: Authorized portfolio posture and component concentration

Status: approved for implementation, baseline `milestone-1` at `906cb4f`.

## Goal and preserved decisions

Implement portfolio comparison and shared-component concentration inside the existing dashboard feature using source-owned projections. No new tables, background workers, dependencies, matcher, granular ACL system, cross-organization portfolio, exports or scheduled-report sources.

Default scope is marketed, nonarchived products/releases, excluding development and withdrawn releases. `includeArchived=true` includes archived products/releases otherwise meeting the marketed rules. Preserve current organization-wide member RBAC: responsible ownership and product relationships are not grants. Rank exact versioned canonical PURLs only; disclose missing, conflicting and non-PURL identity coverage. Reuse M14 source policies without making regulatory decisions.

## Task 1: Contracts and authorization

Write failing strict-schema and policy tests, then add feature-first portfolio schemas/types under contracts/dashboard. GET routes under `/api/v1/dashboard/portfolio`: `products`, `concentration`, `concentration/detail`. Shared filters: legalEntityId/productId optional UUID, includeArchived false, limit default20/max100, opaque cursor. Detail requires opaque componentRef. Reject unknown keys.

Verified identity supplies tenant/actor/session. Require dashboard/products; gate SBOM, findings/intelligence and readiness independently. Build authorized scope before source joins. Foreign entity/product filters return non-disclosing not-found. Recheck identity, permissions and source links each read. Restricted sections contain no data/counts/identifiers. Shared Zod parses query/path, RPC envelopes and successful response; types derive with z.output, controllers use input pipes and ZodResponse, web supplies applicable input and response schemas.

## Task 2: Source projections

Write failing transactional SQL fixtures. Add CLI migration for service-only portfolio RPC and private source helpers; pinned search paths, explicit revoked browser/public grants, enabled non-forced RLS unchanged. No persistent cache/materialization/backfill.

Comparison includes product/entity/archive identity, eligible/covered releases, source-gated finding/severity, existing posture and readiness. No eligible releases means null coverage, not zero exposure.

Inventory starts at canonical SBOM components with verified source, completed ingestion/normalization, validation and exact raw lineage. Deduplicate aliases/documents, exclude sources superseded by eligible completed successors, retain independent chains. Package identity preserves namespace/qualifiers/subpath plus exact version. No semantic equivalence/name matching. Missing version and embedded/component-version conflicts are excluded and disclosed. Any representation-only SQL helper has parity tests against installed PackageURL parser.

Distinct product/identity/version memberships avoid path/release duplication. Rank shared components (>=2 products) by productCount desc, releaseCount desc, identity/version. Join distinct findings through exact tenant/document/component/release occurrence keys; reuse open/suppression/VEX/approval/current preferred CVSS policies, including unknown severity. Reuse is not exploitability. Show missing SBOM, identity exclusions, independently gated matching coverage/feed freshness.

One coherent snapshot per response; set-based queries, no API fan-out/path enumeration. Reuse indexes first; measured query plans justify additions. Encrypted 15-minute cursors/references bind org/actor/session/permissions/endpoint/filters. Continuation binds exact relevant source revision digest, not max timestamp alone. Changed source ->409 portfolio_scope_changed; expired/malformed token ->stable invalid cursor; distinguish denial from outage.

## Task 3: Operational UI

Write failing gateway/query/component tests. Add `/dashboard/portfolio` and protected drilldown, Portfolio action beside Scheduled reports without sidebar changes. Functional React, focused injected gateway, scoped queries, existing dashboard chrome/Poppins/semantic tokens/cn/UI subpaths. Filters, refresh/as-of, product comparison and concentration tables; authorized product/release/finding drilldown links.

Keyboard/focus/labels/table captions/status text/mobile/reduced motion/locale dates. Loading/empty/no shared components/missing/unresolved/stale/restricted/unavailable/conflict states. Preserve filters on retry; erase denied/foreign/prior-org data, cancel in-flight requests. Clearly mark transient same-scope stale data; active page polls every30s. No graph/decorative animation.

## Task 4: Verification and review

Each task: observe intended RED, minimal GREEN, focused tests and >=80% branches/functions/lines/statements, independent review. Parallel implementation owns nonoverlapping files; serialize live SQL/shared-fixture tests.

Tests: name/PURL/version/qualifier/tenant distinctions; missing/conflicting/CPE/hash identities; aliases/chains/supersession; transitive paths; archives and failed/missing SBOM; matching/feed freshness; distinct findings/suppression/VEX/reopening/unknown; forged scope/overrides/revocation; source edits during continuation; expired references/restart/outage/egress blocking. Preserve M1-M12, dashboard/trends, exports/reports/auth/refresh/org switch/navigation.

Isolated benchmarks:10k/100k/1m component memberships,1000 products,tie-heavy ranks,concurrent small tenant. Authenticated API p95<400ms/p99<1000ms, query plans/response size/memory. Focused coverage, SQL/RLS/API/auth/browser regressions then pnpm verify.

Playwright MCP verifies real CRA origin/seeded owner, portfolio -> concentration -> drilldown -> posture, archives/denied/stale/missing/retry/scope change. Desktop/mobile screenshots/accessibility; read-only Supabase cross-check. Isolated contexts/reversible fixtures, never database reset/unrelated site-data removal. Report actual browsers tested.

## Task 5: Rollout and evidence

196 recorded migrations vs637 repository files is preserved baseline. Apply only new CLI feature migrations via documented staging procedure, never replay/repair historical ledger. CLI-generated types then compatible API then UI. Rollback disables new routes/UI, retains source/additive objects; no destructive down migration. Produce acceptance mapping, coverage/load/screenshots/runbook/residual risks. Existing advisor findings are baseline, postgres MCP logs currently unavailable. No bug-free/certification claim.

## Execution ledger

- Planning: root/web instructions, coding rules, design template, BRD and source modules inspected with parallel read-only agents; live schema/index/grant checks completed.
- Implementation: source projections, strict contracts, scoped API and operational UI implemented with focused RED/GREEN tests; CLI migrations/types applied through the feature-only staging procedure.
- Focused gates: contracts/API/web exceed 80% all metrics; final web 22 tests measured98.50% statements/lines,97.50% branches and100% functions. Transactional SQL and17 PackageURL representation parity checks passed.
- Final repository gate: `pnpm verify` passed7,559 unit tests,141 architecture tests and168 SQL files, plus lint/types/dependency/build checks; persistent `docs/evidence/m14-05/pnpm-verify-final.log`.
- Live regressions:30 API tests across nine suites and33 authentication shell checks passed;nine browser journeys passed Chromium151.0.7922.34/Firefox153/WebKit26.5. Playwright MCP used Chrome 155; desktop/mobile screenshots retained in `docs/evidence/m14-05`.
- Load: 10k/100k quiet 20-sample probes met thresholds with limited tail evidence. The final 1m gate returned 600/600 successful large-tenant requests and 150/150 successful concurrent small-tenant requests, but all three large-tenant routes missed the latency targets. Performance acceptance remains unmet; exact percentiles, response sizes and memory evidence are in the verification document.
- Final cross-check: both additional NULL/empty identity rollback assertions passed (36 named SQL assertions total). Read-only Supabase MCP confirmed 289 tables, 202 migration entries, private helpers, the service-only facade and non-forced source RLS. Independent review found no new high/critical issues. Implementation remains uncommitted. No unrelated data was removed; synthetic source/audit fixtures and the isolated benchmark database remain retained under lifecycle guards.
