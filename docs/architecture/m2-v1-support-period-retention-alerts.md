# M2 V1 support periods, retention, and alerts

## Scope and preserved contracts

- User outcome: permitted members can record an auditable support commitment,
  see the controlling retention date, and receive one durable warning for each
  configured support-end threshold.
- In scope: immutable support-period decisions with product-wide defaults and
  release overrides; deterministic retention projections; alert scheduling and
  delivery through the existing mail service; retained alert/audit history; and
  the product-detail UI.
- Out of scope: a second notification system, evidence-file storage,
  technical-file rendering, automatic lifecycle transitions, tenant deletion,
  legal-hold UI, and generic evidence modelling. Existing owners consume the
  published retention reader/projection ports instead.
- Existing product/release identity, placed-on-market corrections, archive
  semantics, `/api/v1/products` prefix, cookies, permission merge order, and
  mock namespace remain unchanged. `archive` remains a soft archive and is not
  deletion.

## Concrete problem

The registry has release-level `placed_on_market_at` and a transactional
regulatory outbox, but no authoritative support-period history or product
retention projection. An end date stored on the product would overwrite the
reasoning behind a previous decision, would not provide an optimistic-concurrent
command boundary, and could not durably reschedule alerts. A browser timer
would be lost on refresh and cannot prove that a threshold was delivered once.

## Why not simpler?

The direct implementation is two date columns on `products` plus a browser
notification. It cannot preserve superseded decisions, apply a release override,
check a shortening against legal floors, or prevent duplicate delivery after a
worker restart. One immutable decision table and the existing durable outbox are
therefore necessary; no separate alert/evidence/metrics table is introduced.

## Selected patterns

- **Versioned decision record.** `product_support_periods` is required because
  a replacement must leave its predecessor intact. A product-wide active record
  applies unless an active release-specific record exists. Partial unique
  indexes make each scope singular and database authoritative.
- **Pure policy.** `m2.v1.later_of_placement_plus_10y_or_support_end` uses UTC
  calendar fields and clamps a leap-day anniversary to February 28. It owns no
  I/O and returns an explicit incomplete state when facts are absent.
- **Projection/port.** `ProductRetentionReaderPort` and
  `ProductRetentionProjectionPort` expose only the safe calculation/protection
  result to inward consumers. Evidence, deletion, and legal-hold owners do not
  import product database tables.
- **Transactional outbox and leased worker.** Existing
  `product_regulatory_outbox_events` stores due time, lease/retry state and the
  support-period threshold idempotency identity. PostgreSQL is the scheduling
  authority; the stateless worker drains every due alert for an organisation in
  one cycle. The mail boundary receives the stable event key as a deterministic
  provider message identity for retry/restart deduplication.

Dependency direction is functional React rendering -> typed product gateway ->
thin Nest controller/facade -> application use cases and inward ports ->
Supabase adapter/RPC. The pure policy is used by both the application boundary
and mirrored in SQL for the durable projection.

## Rejected patterns

- A generic note or mutable product date is rejected because it loses decision
  history and authorization intent.
- A browser/local-process timer is rejected because it cannot meet restart,
  clock, or durable idempotency requirements.
- A new notification provider, event bus, or metrics table is rejected because
  the existing mail service/outbox and operational views cover the present
  variation without another ownership boundary.

## Data and tenant boundaries

- The verified request user supplies organization scope only after the global
  auth guard validates session and active membership. A selected organization
  cookie remains a hint, not authority.
- Every service-role read/RPC takes `organizationId` first and filters product,
  release, support decision, alert and settings operations by it. SQL verifies
  active membership and maps foreign resources to `not_found`.
- Create/supersede atomically lock product and active scope, compare versions,
  record a request digest keyed by actor and idempotency key, write support
  history/projection/audit, obsolete future alerts, enqueue new alerts, and
  enqueue a retention-recalculation fact. A failed audit/outbox rolls back all
  changes. Same-key identical retries replay the original decision; divergent
  retries fail closed.
- Shortening requires a current preview digest, owner role and
  `can_delete_products`, a reason, legal-floor/legal-hold checks, and safe
  downstream re-evaluation before protection can reduce. Normal edits require
  `can_edit_products`; product ownership alone grants neither exception.
- The migration is additive: table, columns, RPCs/indexes/grants, then types,
  API/worker, then UI. Existing products become `incomplete` without invented
  facts. A caller rollback leaves immutable history and outbox records intact;
  corrections are roll-forward migrations.

## API boundary contracts

- Contracts live in `@repo/contracts/products` and define strict UTC-Z input,
  support history, preview digest, retention explanation, alert intervals and
  alert history schemas. Parsed types are `z.output` types.
- Controller paths parse all parameters and bodies with Zod and use
  `@ZodResponse` for every successful JSON response. The service-role adapter
  parses every RPC result before it reaches the facade.
- Browser calls pair `inputSchema` with outgoing commands and a response schema
  for every response. Unknown fields and blank justifications fail before a
  persistence attempt. Interval input rejects malformed tokens and normalizes
  to distinct descending lead times in the allowed range; the server persists
  the same canonical result.
- Retention reads calculate from the durable facts without mutating the product
  projection. Only audited lifecycle/support decision paths recalculate and
  update the projection.

## Frontend logic and rendering

- `ReleaseRegulatoryControls` remains the single product-detail location. It
  displays current/superseded support decisions, incomplete/current retention,
  legal-hold protection, alert delivery status, forbidden/unavailable states,
  and a shortening preview/reload path; no navigation route is added.
- React Query owns product, support, retention, availability, and timeline cache
  invalidation as one product mutation boundary. Dates use the persisted
  organization timezone for presentation only.
- The retention policy and display transformations are immutable functions;
  browser state never authorizes a command or chooses the controlling date.

## Failure modes

| Failure | Handling |
| --- | --- |
| Blank justification or start not before end | Parsed/constraint failure; no partial write. |
| Missing placement/support input | `incomplete`; protection is preserved and deletion is ineligible. |
| Leap year/timezone boundary | UTC calendar calculation; display timezone has no legal effect. |
| Concurrent supersession or stale preview | Stable `conflict`; UI reloads current data. |
| Legal hold/floor blocks shortening | Stable blocked result with an auditable rejection; no reduced projection. |
| Duplicate/restarted worker | Unique threshold key, database claim lease, and deterministic provider message identity yield one logical alert. |
| Mail/provider outage or no active recipient | Safe retry code/state persists; no send is falsely marked delivered. |
| Clock skew | Database clock schedules delivery; worker records safe skew observation and still processes due work. |
| Cross-tenant/unauthorized request | Guard/RPC return forbidden or indistinguishable not-found; no contents leak. |

## Tests and observability

- Start with policy/contract tests for UTC calendar arithmetic, February 29,
  equality, missing facts, conservative release aggregation, strict schemas,
  and interval normalization.
- Add repository/controller tests for tenant isolation, provider-malformation,
  preview digest, permission/role checks, stale supersession, and floor/hold
  blocks. SQL tests cover constraints, indexes/grants, rollback, alert
  uniqueness/reschedule, leases and final deletion-boundary checks.
- Worker tests cover catch-up, duplicate/restart, provider outage, inactive
  owner fallback, clock skew, and the 30-second reference cycle. Browser/live
  tests exercise states using uniquely named local seed-derived records only.
- Operational views expose incomplete calculations, schedule lag, duplicate
  suppression, retry/dead-letter counts, and clock skew without payloads,
  credentials, session tokens, or evidence content.

## Rollback

Stop API/UI/worker callers first if a release must be halted. The additive
migration and history stay in place; the old API remains compatible with the
expanded tables. Never delete support/audit/alert facts to roll back. Repair
schema or policy errors with a new migration and recompute safely rather than
silently reducing existing protection.

## Review checklist

- [x] The direct solution was considered first.
- [x] Every selected pattern has a present-tense trigger and a contract test.
- [x] No request, user, tenant, or session state is global.
- [x] Controllers/pages contain no provider query or domain decision.
- [x] Domain/application layers do not import frameworks or concrete adapters.
- [x] Boundary input and external responses are schema-validated.
- [x] Wire schemas and parsed `z.output` types live in separate feature folders.
- [x] Every JSON route and browser request parses both applicable directions.
- [x] JSX is functional; any logic class has a real dependency or lifecycle trigger.
- [x] Security-critical effects are synchronous or transactionally durable.
- [x] Focused coverage for new/materially changed modules is at least 80%.
- [x] Compatibility and live-stack gates are listed.
