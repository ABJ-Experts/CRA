# M2 V1 variants, hierarchy, and finding propagation

## Scope and preserved contracts

- User outcome: authorized members can record versioned shared-software
  baselines and embedded-product relationships, inspect their history, and let
  the finding owner resolve the products that may be affected without cloning
  assessment work.
- In scope: baseline identity/revision/membership history, release-aware
  variant links, an embedded-component graph, bounded dependency reads,
  deterministic mutation previews, graph-change events, and a published
  resolver port.
- Out of scope: SBOM ingestion, finding creation, analyst triage, applicability
  decisions, reporting, evidence storage, and a graph database. Finding-impact
  persistence and product-specific exceptions are owned by the companion
  `m2-v1-finding-impact-propagation.md` feature; this product module still does
  not read or persist those records.
- The existing `/api/v1/products` prefix, strict product/release response
  schemas, archive semantics, auth cookies, permission merge order, and
  dashboard mock namespace are unchanged.

## Concrete problem

M2 has authoritative tenant-scoped products/releases and audit-backed
service-role RPCs, but has no way to say that releases use the same software
baseline or that one product is embedded in another. Adding mutable foreign
keys to `products` would overwrite prior applicability. Letting a browser walk
an unbounded graph would be non-authoritative, would not prevent concurrent
cycles, and would fail at the requested tenant size.

## Why not simpler?

The direct approach is a nullable baseline ID on a release and a recursive
query in each caller. It cannot retain baseline/relation history, model
release-specific component scope, make a deterministic concurrent cycle
decision, or notify a future finding owner after a relationship changes.

The selected implementation is the smallest durable extension: three history
tables, an indexed active adjacency relation, a dedicated graph-version column
on the existing organization-settings row, and the existing application/RPC
boundary. It does not add a closure table because the graph is bounded at 64
levels and relationship writes are expected to be far less frequent than
reads. It does not add a graph database because tenant-scoped indexed
PostgreSQL relations already satisfy the known traversal and audit
requirements.

## Selected patterns

- **Versioned decision records.** `software_baselines` stores a stable
  `baseline_id` and its immutable revision rows together; memberships retain
  release applicability; `product_relationships` discriminates variant and
  embedded records. A relation ends rather than being deleted. Database
  constraints and optimistic versions make the current relation unambiguous.
- **Indexed adjacency graph.** Active `embedded` rows in
  `product_relationships` are the authoritative parent-to-child graph.
  Recursive CTE reads start from indexed active edges,
  carry the visited product IDs, return a canonical path, and stop at 64
  levels. This supports 500 products/5,000 releases without storing a
  redundant closure projection.
- **Tenant-local graph version.** A mutation locks the existing
  `organization_settings` row, checks the dedicated
  `product_relationship_graph_version` and candidate reachability, then bumps
  it together with audit and outbox facts. `ponytail:` this is a tenant-local
  write serialization point; replace it only if measured relationship-write
  contention needs independently sharded graph versions.
- **Facade and adapter.** Functional UI -> typed product gateway -> thin Nest
  controller -> product use cases/inward ports -> Supabase RPC adapter. The
  graph resolver is an exported inward-owned port; no other module reads M2
  tables directly.
- **Transactional outbox with bounded inverse fan-out.** Every graph-changing
  write appends a uniquely keyed re-evaluation event to existing
  `product_regulatory_outbox_events` in the same transaction. Its durable
  continuation cursor advances only after a finding-owned source page commits.
  The event describes one strict `product`, `release`, or `baseline` scope;
  product-wide embedded links and manual re-evaluation therefore remain
  representable instead of becoming an ambiguous empty scope. No
  process-local observer is authoritative.

## Rejected patterns

- A mutable baseline field, generic product notes, or browser graph state lose
  history and cannot prevent cycles.
- A closure table/materialized reachability view duplicates data and makes
  every write expensive before there is measured depth/fan-out pressure.
- A generic evidence-sharing model would incorrectly force hardware/config
  differences to share compliance facts.
- Direct product access from finding/SBOM modules and direct finding/SBOM
  access from M2 violate module ownership and would place a five-million-row
  finding dataset in the product export/lock path.
- Separate baseline-identity, baseline-revision, variant, component-link,
  graph-version, command-idempotency, source-fan-out, and outbox tables add
  avoidable storage and export surface. The current requirements fit three
  history tables, `organization_settings`, and the existing regulatory outbox.
- A new notification/event-bus/provider stack duplicates the existing durable
  database-outbox mechanism.

## Data and tenant boundaries

- The global auth guard verifies the session; the selected organization is not
  trusted by the browser. Every service-role RPC takes organization ID first,
  rechecks active membership, and filters every product, release, baseline,
  relation, graph, and recursive step by that organization.
- Composite organization foreign keys ensure a product, release, baseline, or
  intermediate graph node from another tenant can never be linked or traversed.
  Foreign/missing identifiers return the established safe `not_found` outcome.
- New public tables have RLS enabled and no browser-role grants. All privileged
  functions pin `search_path`, revoke `PUBLIC` execute, and grant only
  `service_role`.
- A successful mutation atomically locks graph state where needed, checks its
  optimistic version/cycles/depth, ends or creates history, writes audit
  before/after/reason/correlation facts, and appends a unique outbox event.
  Active duplicate constraints make repeated creates safe; ending/archive
  commands use the row version. Failure rolls back every effect.
- The three low-volume M2 history tables are registered in tenant export
  snapshots. Findings and their high-volume impacts remain in their own future
  export source.

## API boundary contracts

- Contracts live under `@repo/contracts/products` with strict schemas and
  `z.output` types for baseline records/revisions/memberships, variants,
  component links, graph previews/reads, propagation candidates, and event
  state.
- Current product/release response shapes stay strict and unchanged. New
  versioned endpoints provide relationship data rather than appending fields to
  the existing product JSON.
- Nest parses every path/query/body before use and parses every successful RPC
  response before serialization. The browser central gateway parses both the
  outgoing body and returned success payload.
- Reads require `can_view_products`; mutations and previews require
  `can_edit_products`. The finding owner has no implied override permission.

## Finding propagation boundary

`ProductRelationshipResolverPort` accepts a verified organization, opaque
source product with an optional release or baseline revision, graph version,
`asOf`, and keyset cursor. It returns only candidate product/release IDs,
canonical relationship path IDs, graph version, and evaluation time. It never
asserts vulnerability applicability. A matching product-owned event port
describes its scope and checkpoints its opaque continuation cursor; it does not
expose product tables to findings.

The finding/SBOM owner combines these candidates with its own component and
configuration evidence, owns analyst assessment and explicit product override,
and stores the many finding-impact associations. It saves source finding, path,
graph/rule versions, idempotency/progress/retry/dead-letter state in its own
durable worker. M2 emits a graph-change event when any relevant relation
changes. A removed M2 link remains historical; the finding owner explicitly
supersedes/closes any former impact after re-evaluation.

## Failure modes

| Failure                                                                         | Handling                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Invalid/equal effective dates, blank reason/source/provenance, invalid quantity | Zod and database constraint reject before partial persistence.                                                                                                                                                                                                     |
| Self link, direct/indirect cycle, or candidate depth over 64                    | Locked deterministic graph validation returns `cycle_detected` or `depth_exceeded`, records a safe rejection audit fact, and persists nothing.                                                                                                                     |
| Concurrent graph mutation/stale version                                         | The locked organization-settings graph version and expected version return `conflict`; the UI reloads graph state.                                                                                                                                                 |
| Cross-tenant direct or recursive identifier                                     | Organization composite FK/RPC predicate returns indistinguishable `not_found`.                                                                                                                                                                                     |
| Duplicate command/retry                                                         | The caller key and canonical payload digest are stored on the relevant history record (not a fourth command table), so the original outcome is replayed and a divergent retry fails closed. Active-equivalence constraints separately reject an unkeyed duplicate. |
| Baseline/product/release archive with an active membership or relationship      | `blocked`; history is preserved.                                                                                                                                                                                                                                   |
| Outbox consumer unavailable/restarted                                           | Durable event keeps leased/retry/dead-letter state; the relationship write remains auditable and no finding work is silently claimed complete.                                                                                                                     |
| Finding not applicable to a variant configuration                               | M2 returns a candidate only; the finding owner makes and audits the non-applicability decision.                                                                                                                                                                    |

## Tests, observability, and rollout

- Start with strict-contract and pure graph policy tests for ordering, depth,
  canonical path, cycle rejection, release scope, and tenant-safe cursor
  validation. Add generated acyclic graph/property coverage where it exercises
  behavior beyond focused examples.
- SQL tests cover RLS/grants/search path, indexes, active duplicate prevention,
  rollback, direct/two-node/three-node/deep cycle rejection, concurrent graph
  writes, historical reads, and archive blockers. An opt-in, rollback-only
  local fixture creates 500 products, 5,000 releases, and 5 million opaque
  finding sources to assert indexed plans for source pages, claims, summaries,
  and bounded traversal. It never commits fixture data.
- API/web/browser tests cover parsing, permissions, tenant 404s, baseline
  history, preview/create/end, stale graph reload, empty/forbidden/unavailable
  states, and organization switching. Live browser testing creates uniquely
  named local records only and preserves all unrelated data.
- Operational views expose traversal latency, candidate fan-out, cycle/depth
  rejection, event lag, stale re-evaluation, retries, and dead letters without
  finding content, SBOM material, credentials, or session data.
- Deploy in order: additive migration (including lifecycle-fact consolidation)
  and export registration, generated types, API/ports/workers, then UI. The
  worker can resume from an event cursor after a restart; an operator retries a
  safe dead letter after correcting the dependency, or emits a newer graph
  event. Roll back callers/workers only; retain history and repair database
  facts with a forward migration.

## Review checklist

- [x] A direct mutable-field solution was considered and rejected for concrete
      history/cycle/durability failures.
- [x] Every selected pattern has a present trigger, boundary, and test plan.
- [x] Request, user, organization, and session state are never global.
- [x] Controllers/pages contain no provider query or graph decision.
- [x] Boundary inputs and successful outputs are schema-validated.
- [x] Security-critical graph/audit/outbox facts share a database transaction.
- [x] M2 does not read or persist finding/SBOM/triage records.
- [x] Additive rollout, export compatibility, and forward-only rollback are
      defined.
