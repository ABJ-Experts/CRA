# M10-03 feature design: evidence-aware coverage and framework gaps

## Scope and preserved contracts

- **Outcome:** a product and framework-version-specific requirement tree that explains evidence-backed coverage and actionable gaps without claiming conformity.
- **Included:** approved non-applicability, explicit denominator, evidence availability, invalidation and recalculation, bounded reads, and an operational gap view.
- **Excluded:** AI analysis, certification, inferred parent coverage, M7 mapping resolution, a general rules engine, and edits to immutable M8 evidence versions or M7 snapshots.
- **Preserved:** `/api/v1`, verified-session identity, ES256/JWKS and cookie paths, frozen auth actions, permission merge order, M10-01 version keys, M10-02 controls and links, M8 reverse links, menu/mock contracts, and existing coverage-route callers.

## Concrete problem and direct design

The M10-02 coverage repository returns per-requirement mappings and a single `evidencePresent` boolean. That cannot distinguish an absent mapping from an unimplemented control, a quarantined or expired version, an approved exclusion, or a recalculation in progress. A direct read-time join would show the latest rows but could not durably track invalidation and worker failure as required here. The direct extension is one applicability record and a narrow, product/version-scoped materialization of the derived result. Existing controls, evidence links, and legal text remain authoritative.

## Selected patterns

| Pattern                    | Present trigger and participants                                                                                          | Dependency direction and removal trigger                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adapter with inward port   | Supabase status, validity, and RPC errors need translation into the coverage contract.                                    | Controller → application use case/port ← Supabase adapter. Remove if the provider boundary disappears.                                                                                  |
| Transactional command      | Applicability changes need expected revision, idempotency, and audit in one commit.                                       | Application → scoped SQL RPC → applicability and `audit_logs`. Remove only if another atomic boundary replaces it.                                                                      |
| Durable derived projection | M8/control source changes and date boundaries can invalidate previously green results; recalculation may fail or restart. | Source tables → scoped invalidation → leased worker → coverage rows; reads check freshness. Remove if bounded synchronous calculation can satisfy the same status and latency contract. |

Rejected: a parallel mapping store, duplicate evidence files, a generic event bus, client-calculated totals, and legal-rule evaluation. Each would either drift from existing ownership or expand the feature beyond the observed need.

## Data and tenant boundaries

- Nest derives actor and organization from the verified session. Product, pack, version, requirement, control, and evidence joins are scoped to that organization even under `service_role`; SQL functions recheck membership and permissions.
- A requirement is evidence-backed when at least one active product-applicable mapped control is implemented and has a clean, active, currently valid evidence version for that product with no open deletion intent. Other mapped controls remain visible with their own gaps. Parent status is never inferred from a child.
- Only numbered legal clauses enter the denominator; the two structural Part headings remain visible in the tree. Approved non-applicability is scoped to product and exact pack/version/requirement, requires a reason, and is counted separately from applicable requirements.
- Invalidation is transactionally durable and idempotent per scope. A worker lease is recoverable after restart. A queued, leased, failed, generation-mismatched, or date-expired result is never presented as current coverage.
- Historical framework references and M7 snapshots are not rewritten. The migration is additive, uses pinned `search_path`, explicit grants, non-forced RLS, indexed composite scope keys, and CLI-generated types. Rollback is forward-only: deploy the previous API while retaining the new tables and audit history.

## API boundary contracts

- `@repo/contracts/frameworks` owns coverage path/query/response and applicability mutation schemas and `z.output` types. Nest pipes parse every path, query, and body; `@ZodResponse` parses successful JSON. Web gateway parses outgoing mutation bodies with `inputSchema` and incoming responses with `schema`.
- Coverage remains `GET /api/v1/frameworks/:packKey/versions/:versionKey/coverage?productId=…`, with an additive summary, calculation state, row gap codes, evidence availability, and remediation metadata. Pagination bounds stay in force. Applicability writes use a distinct scoped route, expected revision, and idempotency key.
- Coverage requires framework, product, and evidence view permissions. Insufficient access returns forbidden with no partial count or hidden product inference. Write access requires framework management and the existing product boundary. Invalid input, conflict, missing scope, and infrastructure outage remain distinct.

## Frontend logic and rendering

- Functional React renders a code-split product/framework/version coverage view in the existing workspace. Its typed gateway owns transport; no page or shared UI queries Supabase. Pure presentation policies remain functions.
- Show denominator and exclusions explicitly, and label evidence-backed coverage without a compliance claim. Requirement and user text render inertly. Gap rows link to the existing control mapping, status, and evidence actions. Loading, empty, forbidden, offline, stale, failed, version-update, and retry states use text labels and visible focus; local drafts survive recoverable errors.

## Failure modes, tests, and observability

- Begin with failing contract, policy, SQL, API, and component tests. Cover mixed controls, shared evidence, scan/validity/deletion changes, expiry boundary, unlinking, product archival, removed membership, cross-tenant IDs, approval revision races, duplicate commands, worker restart, summary/detail consistency, large trees, and organization switching.
- Run focused coverage (at least 80% branch/function/line/statement for new or materially changed modules), real local Postgres/RLS/storage tests, database lint/drift, relevant M1–M10 regressions, browser critical journeys and accessibility, bounded-read latency, and `pnpm verify`. Keep a separate verification record with commands and screenshots.
- Log scope identifiers and stable failure codes, never tokens, document contents, or hidden counts. Monitoring distinguishes invalid input, forbidden, worker retry, and projection freshness failure.

## Review checklist

- [x] Direct solution and rejected broader stores considered.
- [x] Present triggers, participants, dependency direction, and removal triggers recorded.
- [x] No global actor, tenant, product, or session state.
- [x] Shared runtime schemas and response parsing identified.
- [x] Transactional audit, scoped service role, and forward-only rollback defined.
- [x] Failing tests, focused coverage, live-stack gates, browser evidence, and independent review recorded in the M10-03 verification record; the pre-existing repository-wide export registry gate remains listed there.
