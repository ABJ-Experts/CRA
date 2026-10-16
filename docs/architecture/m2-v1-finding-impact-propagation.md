# M2 V1 finding-impact propagation

## Scope and preserved contracts

- **User outcome:** an authorized finding owner can register an opaque source
  finding, determine its candidate impact through the published product graph,
  retain historical impact facts, and record a product-specific exception
  without copying an analyst assessment.
- **In scope:** source-finding propagation metadata, impact associations,
  explicit overrides, restartable fan-out jobs, product graph event consumption,
  summary/override API contracts, and a safe product-detail status view.
- **Out of scope:** SBOM ingestion and normalization, vulnerability detection,
  analyst assessment content, evidence bodies, reporting, and any change to
  product graph traversal or triage policy.
- **Preserved:** `/api/v1` transport/cookies, product relationship endpoints and
  schemas, existing product graph and outbox tables, RBAC merge order, the
  dashboard mock namespace, and the finding module never reads product/SBOM
  tables directly.

## Concrete problem

The M2 product module now returns bounded tenant-scoped relationship candidates
through `ProductRelationshipResolverPort`, and graph-changing writes append
durable `product_relationship.graph_changed` events. Those facts alone do not
record which source finding caused an affected product result, cannot resume a
large fan-out after failure, and cannot preserve a product-specific exception.
Putting finding tables or applicability logic into the product repository would
reverse ownership and let a product adapter read high-volume finding state.

## Why not simpler?

The direct implementation is a synchronous controller loop that calls the
product resolver and inserts one affected product row per candidate. It cannot
survive a process restart, deduplicate delivery, safely page a large graph,
supersede a removed edge's prior impact, or retry a graph-version conflict.

The selected implementation adds exactly four finding-owned tables:

1. `finding_propagation_sources` stores opaque source-finding identity and its
   release or baseline scope.
2. `finding_impact_associations` stores many product/release impacts and their
   immutable relationship path, graph/rule versions, and lifecycle.
3. `finding_product_impact_overrides` stores the explicit, audited,
   product-specific exception; it never changes an analyst assessment.
4. `finding_propagation_jobs` stores the durable paged fan-out lifecycle.

No closure table, duplicate graph projection, generic event bus, finding
evidence table, or separate history table is added. `audit_logs` supplies the
append-only audit trail; ended and superseded rows retain historical facts.

Finding writes project compact lifecycle facts through one existing
`product_lifecycle_dependency_facts` table. A typed subject scope distinguishes
`product` association blockers from `baseline` source blockers, with exclusive
foreign-key checks and org-first indexes. It contains no finding narrative,
evidence, or graph path and is rebuildable from the four authoritative finding
tables. The forward migration copies and verifies the former baseline-only
projection before dropping that redundant projection table. Superseded/closed
associations and archived sources deactivate their blockers, preserving
historical records while allowing the documented controlled archive rule. This
avoids a product archive RPC reading a finding-owned table.

## Selected patterns

- **Facade:** `FindingUseCases` is the narrow feature entry point for HTTP and
  worker commands. It prevents controllers/workers from coordinating storage,
  graph resolution, and authorization themselves. It is removable if the
  finding module ceases to have more than one inward caller.
- **Adapter:** `SupabaseFindingRepository` implements the inward finding port,
  while product graph/outbox adapters implement product-published ports. The
  finding adapter receives only candidates and event scopes, never product
  tables. Contract tests pin this separation.
- **Immutable Command:** registration, override, graph-event enqueue, and job
  page commands carry correlation/idempotency identity because they are audited
  or retried. There is no global command bus.
- **State:** propagation jobs have `scheduled`, `leased`, `retrying`,
  `completed`, `dead_letter`, and `obsolete` states. Lease/checkpoint/version
  transitions need deterministic validation; a boolean cannot express them.
- **Transactional outbox consumer:** existing product graph events are claimed
  via a product-owned port. A strict `product`, `release`, or `baseline` scope
  is expanded through an indexed page of at most 100 sources. The product
  event's continuation cursor is checkpointed only after that page commits,
  making a crash replay idempotent through a job key of event plus source.
  Product-wide component changes and manual re-evaluation use `product` scope;
  they are not encoded as an invalid pair of null scope values.

## Rejected patterns

- A graph database or materialized closure would duplicate M2's bounded,
  indexed adjacency implementation without a measured traversal requirement.
- A process-local observer loses graph changes on restart and cannot provide
  retry/dead-letter semantics.
- A finding-to-product mutable flag overwrites historical compliance facts.
- An additional association-history or source-fan-out table duplicates
  `audit_logs` or the existing durable product outbox; versions,
  lifecycle timestamps, and synchronous audit events provide the required
  provenance without another high-volume table.
- Reading product tables from findings or finding tables from M2 bypasses the
  published ownership boundary; lifecycle projections are the explicit
  exception-owned publication mechanism for archive guards.

## Data and tenant boundaries

- A controller derives `organizationId` and `actorId` from the verified request
  identity. The worker receives only organization IDs from an org-first,
  service-role queue port; it never uses a departed user's membership as its
  authority.
- Every table contains `organization_id`; all foreign keys are composite with
  organization identity where the referenced product/release/baseline supports
  it. Every RPC accepts organization ID first and predicates every read/write
  with it. Cross-tenant IDs return `not_found`, not a distinguishable relation
  error.
- New source, override, impact upsert/supersede, job checkpoint, and audit
  facts share one PostgreSQL transaction. Product event acknowledgement occurs
  only after the idempotent source page commits; its cursor then records the
  next source/scope. Replaying an uncheckpointed page cannot create duplicate
  jobs.
- Idempotency keys/digests protect source/override commands. A unique job key
  protects repeated graph events. Impact uniqueness includes source, affected
  scope, canonical path hash, graph version, and rule version. A stale lease or
  checkpoint fails closed; expired work can be reclaimed.
- The migration is additive. RLS is enabled but not forced; browser roles and
  `PUBLIC` are revoked, and only `service_role` is granted table/RPC access.
  Every security-definer function pins `search_path = public, pg_temp`.
  Generated database types are regenerated only after applying locally.

## API boundary contracts

- Runtime schemas and `z.output` wire types live under
  `@repo/contracts/findings`. They cover source registration/status, finding
  impact summary, override create/end, and worker RPC rows.
- `POST /api/v1/finding-propagation-sources` and source-status changes require
  `can_edit_findings`; this is the inward hook for the future finding/SBOM
  owner, not a public analyst UI. Product summaries require `can_view_products`;
  overrides additionally require `can_edit_findings`.
- Nest parses path/query/body with the shared schemas and parses each successful
  result before serialization. The web gateway parses outgoing input and every
  successful response using the same schemas.
- Unknown request keys, invalid dates, invalid UUIDs, ambiguous source scope,
  stale optimistic versions, and malformed cursors fail as stable client
  errors. Existing product relationship response shapes remain unchanged.

## Fan-out and failure behavior

1. A product graph worker claims an existing graph event through a
   product-owned port, first obsoletes it if its graph version is no longer
   current, then asks the product adapter for a sanitized discriminated scope.
   The finding repository enqueues at most 100 matching active sources using
   org-first keyset indexes and the persisted continuation cursor. It
   checkpoints only after durable enqueue; it completes the event only after
   every scope/page finishes.
2. A finding worker claims a single job and calls the product-owned system
   resolver for one bounded page. The database upserts that page's associations
   and advances the cursor atomically. On the final page it supersedes older
   unobserved associations; it never deletes them.
3. A resolver graph-version conflict marks the job `obsolete`; a newer product
   event is the only source of a new graph-version job. Retryable provider/DB
   errors back off with a bounded attempt count; poison work enters
   `dead_letter`. Safe error codes, counts, and identifiers are logged, never
   finding evidence, SBOM contents, or a complete product structure.
4. A source status/release/baseline/rule-version mutation schedules a new job.
   A resolved source closes/supersedes active impact records rather than
   rewriting a prior association. Source mutation and page persistence lock the
   source before the job lease, so a status change cannot race an in-flight
   page back to active.

The M2 graph stays release-aware and maximum depth remains 64. Query work is
tenant-indexed: source selection uses `(organization_id, source_release_id,
status, id)`, `(organization_id, baseline_revision_id, status, id)`, or the
active product-scope equivalent; job claim and job-to-source reads use
org-first partial indexes; product summary and source-impact queries use
org-first indexes. A worker claims a bounded page and yields between pages, so
a 5M-row finding tenant neither requires an unindexed recursive scan nor holds
a tenant transaction across fan-out pages. The scheduler visits due tenant IDs
in deterministic UUID order and takes one graph page/one job claim per tenant
per pass under global stage budgets. Thus one heavy tenant cannot monopolize a
cycle, and no organization scans or locks another tenant's rows.

## Frontend logic and rendering

`FindingImpactStatus` is a functional product-detail section backed by a plain
typed HTTP gateway. It displays safe aggregate data only: empty, loading,
queued/retrying, partial dead-letter, stale graph, conflict/cycle, forbidden,
and an explicit authorized override state. It renders neither evidence nor
SBOM/finding narrative. The existing relationship section remains responsible
for graph editing; no React class, provider, or global finding state is added.

## Tests, observability, and rollout

- Start red with shared-contract parsing and worker/unit scenarios for duplicate
  enqueue, stale checkpoint, page replay, graph conflict, and no duplicate
  impact. Add product port contract tests and a dependency rule prohibiting
  finding infrastructure imports of product infrastructure.
- SQL integration covers tenant 404, composite FKs, RLS/grants/search path,
  active duplicate constraints, direct/indirect cycle candidates supplied by
  M2, overlap/gap handling, archive preservation, idempotent job claim/replay,
  partial page failure, retry/dead-letter, and supersession.
- Add an opt-in rollback-only 500-product/5,000-release/5-million-source
  fixture with `EXPLAIN` checks for indexed source selection, job claims,
  product summaries, and bounded graph pages. It uses synthetic opaque IDs,
  commits no fixture data, and is not a default developer test.
- API/browser tests cover parsed endpoints, permissions, 404 tenant isolation,
  empty/loading/forbidden/stale/in-progress/partial-failure UI, and override
  audit behavior. Existing M2 tests continue unchanged.
- Metrics: resolver/traversal latency, sources selected, page fan-out,
  cycle/depth conflicts, stale/obsolete jobs, retries, and dead letters.

Deploy with the forward-only database migration (copy/verify unified lifecycle
facts, then remove only the redundant projection) and export registry first,
then generated types, API/workers, and UI. `FINDING_PROPAGATION_LEASE_SECONDS`
is validated at startup; an expired lease is safely reclaimable. Recovery is to
retry a dead letter after its dependency is fixed, or issue a newer event when
the graph changed; stale older events/jobs are obsoleted rather than revived.
Roll back callers/workers if required; retain jobs/associations/audit data and
use a forward migration to repair data. The finding records use their own
export source, never `product_registry`, to avoid putting high-volume finding
rows into product registry lock paths.

## Review checklist

- [x] The direct controller-loop solution was considered and rejected for
      restart, paging, deduplication, and historical-fact failures.
- [x] Every selected pattern has a current trigger and a narrow contract.
- [x] Organization/request/session identity is never global.
- [x] Controllers and pages contain no provider queries or graph policy.
- [x] Application code depends on ports; product and finding adapters remain
      independently owned.
- [x] Inputs and successful outputs are parsed by shared Zod contracts.
- [x] Security-critical source, override, queue, association, and audit facts
      are transactionally durable.
- [x] The rollout is additive and compatible with previous API versions.
