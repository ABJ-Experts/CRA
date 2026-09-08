# M5 remediation anchors and reintroduced components

## Scope and preserved contracts

- **User outcome:** a permitted editor records the human/business fact that a
  corrective or mitigating measure became available, can correct that fact
  without losing its history, and can see when a previously fixed component is
  found again in a later, evidenced release lineage.
- **In scope:** immutable remediation-anchor revisions; availability provenance;
  durable M6-facing outbox events; an idempotent reintroduction marker; and
  additive queue/detail/form projections.
- **Out of scope:** report creation/submission, regulatory clock calculation,
  a replacement SBOM matcher, automatic VEX changes, invented dates, and a
  generic event bus.
- **Preserved:** `/api/v1`, VEX and assessment history, M4 feed/re-evaluation
  behavior, M5 triage filters/cursors, cookies and JWKS, permission merge
  order, session revocation, menu contracts, and mock passthrough.

## Concrete problem and direct solution

`vulnerability_findings` is matcher-owned, release-scoped evidence. Adding a
mutable fix version, availability date, and correction reason directly to it
would overwrite the fact M6 must later use and would not retain the correction
chain. Inferring availability from a ticket, advisory, deployment, or release
lifecycle is not a human/business assertion and would start a legal clock on
an unsupported date.

The direct solution is a tenant-scoped, append-only remediation-anchor ledger
plus a narrowly extended existing regulatory outbox. One transaction locks the
finding and current revision, writes the replacement/current markers, audit
fact, idempotency response, and event. A later component can be marked
reintroduced only when a completed SBOM diff proves the directed release
lineage and the normalized identity, exact version, and advisory agree. This
is the smallest durable design; it does not introduce a workflow framework.

## Selected patterns

- **Persistence adapter and feature facade:** React calls the typed triage
  gateway; the thin Nest controller delegates to an inward-owned use case/port;
  its Supabase adapter invokes org-first RPCs and parses their JSON. This exists
  because PostgREST shapes/errors are not application contracts.
- **Immutable revision ledger:** remediation availability is evidence that can
  be corrected but not overwritten. One current anchor per finding and a
  supersession chain preserve prior assertions. Remove it only if history and
  corrections are no longer required.
- **Transactional command/outbox record:** expected version and idempotency
  prevent duplicate anchor events; the existing regulatory outbox is extended
  because M6 is its actual downstream consumer. This is not a generic bus.
- **Directed lineage check:** completed M3 SBOM diff records provide the
  existing release-to-baseline relationship. No lexicographic release-version
  comparison or new SBOM matching implementation is added.

## Rejected patterns

- Remediation columns on `vulnerability_findings` lose correction history and
  conflate human remediation facts with matcher-owned risk evidence.
- An in-memory event or fire-and-forget `AuditService.log` can lose the M6
  anchor or leave audit and state inconsistent.
- A new generic outbox/event bus adds a second delivery abstraction while
  `product_regulatory_outbox_events` already has the required M6 consumer.
- Treating every newer textual release version as lineage would be incorrect
  for non-semver products and aliases.

## Data and tenant boundaries

The verified request supplies actor and selected organization. Every
service-role RPC takes `organization_id` first, filters finding, release,
product, anchor, assessment, lineage, audit, and outbox rows by it, and checks
active membership. Anchor reads require `can_view_findings`; create/correct
requires `can_edit_findings` in both Nest and SQL.

Corrective anchors require a nonblank fix version; mitigation-only anchors may
not supply one. All require a bounded mitigation description. An availability
assertion, when recorded, requires human-asserted provenance basis and a
past-or-present UTC timestamp; planned anchors retain all availability fields
as null. A replacement requires a correction reason. An archived release rejects its first anchor but permits a
reasoned correction to an existing one. `fixed` is applied only when the
current assessment is effective (approved or approval-not-required); recording
an anchor never changes VEX.

The mutation transaction locks the finding/current anchor and triage state,
validates actor/tenant/archive/version/idempotency, inserts anchor and audit
evidence, and inserts exactly one keyed outbox event. Reintroduction locks the
later finding and writes its marker plus one keyed event/audit in the matching
transaction. RLS is enabled, never forced; functions pin `public, pg_temp`,
default execution is revoked, and service-role grants are explicit. Foreign
keys use `public.users` and tenant composite references. Deploy expand-only:
migration, CLI-generated types, API, then web; rollback application code first
while preserving revisions/events for M6.

## API and presentation boundaries

Contracts remain under `@repo/contracts/vulnerabilities` as strict schemas and
`z.output` types. Nest parses path/body/query input and uses `@ZodResponse` on
success. The browser gateway validates outgoing input and returned JSON. The
new remediation route lives beneath `/api/v1/findings/:findingId`; GET refresh
retry remains GET-only, while writes use the supplied idempotency key.

Functional finding components extend the existing detail/grid rather than add
a dashboard. They show text plus semantic colour for fix planned, fix
available, fix applied, reintroduced, and lineage unavailable. Forms preserve
entered values on validation, conflict, offline, and retryable failures, and
use existing semantic tokens, `cn()`, shared UI subpaths, focus behavior, and
reduced-motion behavior.

## Failure modes, tests, and rollback

Missing/non-UTC/future availability, invalid corrective/mitigation shapes,
missing correction reason, stale version, idempotency mismatch, revoked actor,
cross-tenant IDs, deleted/superseded findings, and a first archived-release
anchor fail closed. Missing SBOM lineage or unresolved aliases is displayed as
not evaluated, never guessed. An archived baseline remains readable history;
an archived target returns an explicit skipped outcome and is rendered as not
evaluated; it emits no reintroduction event. Feed retries and concurrent workers are deduplicated by row locks,
marker, and outbox key.

Start with failing schema/policy tests, then SQL RLS/transaction/concurrency
tests, adapter/controller tests, web form/gateway/filter tests, and a local
Playwright journey with unique tagged records. Run the architecture, database,
coverage, and verify gates. Do not use the global live suite when it clears
shared Mailpit data; use a scoped non-destructive local check and document that
residual coverage boundary.

## Review checklist

- [x] Direct columns and inferred dates were considered and rejected.
- [x] No request, tenant, actor, session, or remediation state is global.
- [x] Controllers/pages remain free of Supabase queries and policy decisions.
- [x] Anchor state, audit evidence, and M6 event commit atomically.
- [x] Contracts are strict and browser/server boundaries parse both directions.
- [x] Migration is additive and prior API versions ignore the new data safely.
