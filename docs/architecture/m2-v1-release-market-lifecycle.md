# M2 V1 release market availability and lifecycle

## Scope and preserved contracts

- User outcome: an authorized organization member can record where a release is
  available in the EU, move it through a legally meaningful release lifecycle,
  and see an auditable history of those facts.
- In scope: release-owned lifecycle state, Member State reference data,
  availability projection and history, placed-on-market date correction,
  lifecycle timeline, durable retention signalling, audit facts, and their
  tenant-safe API, database, and dashboard boundaries.
- Out of scope: product classification under FR-PROD-004, automated retention
  calculation or deletion, legal advice, non-EU markets, SBOM ingestion,
  vulnerability findings, and reporting. FR-PROD-004 remains deferred because
  the BRD has no counsel-approved classification decision table; this feature
  must not infer one from a release, market, or browser input.
- Existing `/api/v1/products` routes remain under that prefix; the generic
  `/api/products` dashboard mock, cookie paths, frozen auth-action signatures,
  product/release identity, archive semantics, permissions, and existing
  tenant-not-found behaviour remain unchanged. Release create/update payloads
  no longer directly change lifecycle: a created release starts in
  `development`, and transitions use their dedicated command.

## Concrete problem

The current release registry stores the legacy `draft`, `released`, and
`retired` value on `product_releases`, and the generic update path decides
whether a requested lifecycle change is allowed. It has no authoritative
release-level placed-on-market date, no Member State availability facts, and no
immutable audited transition history. Consequently, it cannot demonstrate that a
placement occurred only after availability was recorded, distinguish a date
correction from a lifecycle transition, or supply a durable signal to the
retention authority without coupling M2 to retention calculations.

The BRD evidence captured for this V1 scope requires market availability and
release lifecycle to be authoritative at the release level. It also includes
FR-PROD-004, but that requirement has no approved decision table, so the
classification decision is explicitly deferred rather than silently encoded.

## BRD traceability

| Source                                     | Requirement or decision                                                                        | V1 treatment                                                                                                                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-PROD-005                                | Record release-level Member State availability.                                                | Source-backed: availability is owned by the release, with an active projection and immutable audit history.                                                                              |
| FR-PROD-006                                | Record release lifecycle fields and transitions.                                               | Source-backed: lifecycle authority, placed-on-market evidence, audit-backed transition history, and audited corrections are release-level facts.                                         |
| BRD page 7, Article 14(2)(a)               | Make Member States aware early when a release is placed on the market.                         | Source-backed: placement requires recorded Member State availability and produces durable audit/retention evidence.                                                                      |
| BRD core tables, approximately pages 22–24 | Retain release lifecycle and placement evidence in the product/release record.                 | Source-backed: release state, `placedOnMarketAt`, availability facts, and timeline are persisted rather than inferred from UI state.                                                     |
| FR-RPT-012                                 | Incident state is a separate reporting concern.                                                | Source-backed boundary: M2 lifecycle does not represent, calculate, or transition incident state.                                                                                        |
| FR-PROD-004                                | Classify products/releases.                                                                    | Deferred: the BRD supplies no counsel-approved deterministic decision table. M2 records neither an inferred classification nor a placeholder strategy until that source decision exists. |
| Agreed local V1 policy                     | Restrict placement availability to versioned EU-27 Member State reference data.                | Local policy, not asserted as BRD wording; enforce it as the placement prerequisite.                                                                                                     |
| Agreed local V1 policy                     | Permit withdrawal from every non-withdrawn lifecycle state and prohibit all other regressions. | Local policy, not asserted as BRD wording; keep the exact transition matrix exhaustive and tested.                                                                                       |
| Agreed local V1 policy                     | Emit durable retention signals without calculating retention.                                  | Local ownership boundary: M1 remains the retention authority; M2 commits the signal transactionally with regulatory facts.                                                               |

The source-backed requirements establish what must be recorded and kept
separate. The agreed local policies make the V1 implementation deterministic
where the BRD does not prescribe an executable decision table or transition
matrix; they must be changed only through an explicit approved decision.

## Why not simpler?

The direct implementation would add a `market` array and date fields to the
existing generic release update endpoint. It cannot make the placement
precondition atomic with an availability write, preserve whether a later
change was an availability/date correction or a transition, prevent a generic
editor from bypassing lifecycle authority, or make a reliable audit/retention
fact durable with the change. A small release-owned state policy and atomic
commands are therefore required by the present compliance workflow, not for
future-proofing.

## Selected patterns

- **State** — the release lifecycle is persisted because allowed actions differ
  across five meaningful states and must remain correct under concurrent
  commands. The authoritative states and only permitted edges are:

  | From               | Permitted target                |
  | ------------------ | ------------------------------- |
  | `development`      | `placed_on_market`, `withdrawn` |
  | `placed_on_market` | `in_support`, `withdrawn`       |
  | `in_support`       | `end_of_support`, `withdrawn`   |
  | `end_of_support`   | `withdrawn`                     |
  | `withdrawn`        | none                            |

  There is no regression and no transition from `withdrawn`. The
  `development` to `placed_on_market` transition requires a strict UTC-Z
  `placedOnMarketAt` timestamp and at least one active EU-27 Member State
  availability record in the same atomic operation. Once recorded,
  `placedOnMarketAt` cannot be cleared; a correction is a separately audited
  command rather than a generic update.

- **Adapter** — the product regulatory repository adapter implements
  application-owned read and command ports because Supabase RPC result shapes,
  locks, and provider failures are infrastructure concerns.
- **Command records** — transition, availability add/remove/correct, and
  placed-on-market correction commands carry the expected aggregate version,
  actor, and parsed data. This makes optimistic concurrency, audit, and retry
  behaviour explicit without a command bus.
- **Transactional outbox** — each authoritative lifecycle/availability/date
  write stores its audit fact and a durable retention signal in the same
  transaction. The signal is an input for the retention owner; M2 does not
  calculate a retention period or perform retention work.

Dependency direction is functional web presentation -> typed product gateway
-> Nest controller/facade -> regulatory use case and inward-owned port ->
Supabase adapter/RPC. The lifecycle policy is a pure immutable function in the
application/domain layer. Remove the adapter only if Supabase is no longer an
external boundary; remove the state policy only if the lifecycle collapses to a
single stable state. Remove the outbox only if the retention owner shares the
same transactionally owned store and no cross-boundary delivery remains.

## Rejected patterns

- A generic CRUD lifecycle field is rejected because it bypasses distinct
  placement preconditions and destroys transition intent.
- A browser state machine is rejected because browser state is neither durable
  nor an authorization source.
- An event bus is rejected because audit and retention signals are
  security-critical and must be transactionally durable, not best-effort
  in-process events.
- A classification strategy/factory is rejected: FR-PROD-004 has no
  counsel-approved decision table or current implementations to select among.
- Direct retention-policy queries/calculation are rejected because M1 owns
  retention authority; M2 emits only the durable regulatory fact.

## Data and tenant boundaries

- The global auth guard verifies the access token, active session, and selected
  membership. The signed organization cookie is a scope hint only; it never
  grants organization access.
- Every service-role RPC takes `orgId` first, verifies the active actor
  membership, and filters every release, product, Member State availability,
  audit, and outbox query by that organization. Cross-tenant targets
  return the existing safe not-found outcome.
- An atomic command locks the release and compares its aggregate version before
  applying a transition, availability operation, or date correction. It writes
  the projection, version increment, audit fact, and retention outbox
  signal together; any failure rolls all of them back.
- Create commands use parsed idempotency keys. Regulatory commands use their
  aggregate version plus a server-generated correlation identifier: concurrent
  or retried commands therefore return the stable stale-version result rather
  than overwrite a committed fact. Durable outbox event keys are idempotent for
  consumers. Availability identity is release plus versioned Member State
  reference identity, with a current active projection and immutable
  correction/removal audit history.
- The migration is expand/deploy/contract. It first stops if any legacy
  `released` or `retired` release exists; only legacy `draft` data is mapped to
  `development`. This deliberate stop prevents inventing legally significant
  historical placement/support facts. Add versioned EU-27 Member State seed
  data before accepting availability commands. Existing application versions
  can run against the additive objects; do not remove legacy state support
  until all callers and generated types have been retired.

## API boundary contracts

- Contracts live feature-first in `@repo/contracts/products/{schemas,types}`:
  strict Member State reference, availability read/add/remove/correct,
  lifecycle transition, placed-on-market correction, lifecycle timeline,
  expanded release response, and typed domain-error schemas. Trusted types are
  `z.output<typeof schema>`.
- Controllers parse body, query, and path input before use and declare strict
  successful JSON response schemas. Repository output is parsed before
  serialization. The lifecycle field is absent from generic create/update
  input; creation yields `development`.
- Product gateways pair each outgoing command with its `inputSchema` and parse
  every response with its `schema`. Unknown fields, unsupported/inactive
  Member States, non-UTC-Z timestamps, missing expected versions, and invalid
  state edges fail closed with stable validation/domain errors. Provider
  unavailability and malformed provider output remain distinct safe 5xx
  outcomes (malformed provider data is 502).

## Frontend logic and rendering

- Functional product-detail components render the release state/timeline,
  current availability, pre-placement warning, and dedicated transition,
  availability, and date-correction controls. They preserve values and provide
  loading, retry, forbidden, blocked, stale-reload, and accessible error/status
  feedback.
- A focused plain TypeScript product gateway owns injected authenticated
  transport and request/response schema pairing; React Query hooks own cache
  keys and invalidation. These are the only stateful lifecycle boundaries.
- The lifecycle policy, EU27 placement prerequisite check, and display mapping
  remain immutable pure functions. Browser state never supplies organization
  scope, authorizes a command, or makes a lifecycle decision.

## Failure modes

| Failure                                                    | Handling                                                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Invalid state edge or transition from `withdrawn`          | Fail closed with a stable invalid-transition error; no write.                                                                  |
| Placement lacks active EU27 availability or UTC-Z date     | Fail closed before commit; no lifecycle, audit, or signal write.                                                               |
| Attempt to clear placed-on-market date                     | Fail closed; only a parsed, audited correction is allowed.                                                                     |
| Unknown/inactive/non-EU27 Member State                     | Fail closed with validation/domain error; no availability change.                                                              |
| Duplicate/replayed command                                 | Same idempotency key and payload returns prior result; changed payload conflicts.                                              |
| Stale concurrent command                                   | Version conflict returns current safe state/reload guidance; no lost update.                                                   |
| Archive before `withdrawn` or with active dependency facts | Existing blocker fails closed.                                                                                                 |
| Permission, session, or tenant mismatch                    | Guard/RPC reject before mutation; cross-tenant access stays not found.                                                         |
| Database/audit/outbox failure                              | Atomic rollback; no partial projection, history, audit, or retention signal.                                                   |
| Retention consumer outage                                  | Signal remains durable for later delivery; M2 does not calculate or delete data.                                               |
| Supabase/network/JWKS/SMTP failure                         | No automatic mutation retry; return a safe retryable infrastructure error without secrets. SMTP is not a lifecycle dependency. |
| Cancellation after commit                                  | Idempotency/readback resolves the final committed result; no compensating state regression.                                    |

## Tests and observability

- First characterize the legacy release route/response, archive guard, tenant
  not-found result, permissions, cookie path, and generic dashboard mock so
  the V1 replacement does not drift preserved contracts.
- Add failing contract and pure-policy tests for every row of the transition
  matrix, every prohibited edge, no transition from `withdrawn`, strict UTC-Z
  timestamps, creation as `development`, absence of lifecycle in generic
  create/update, EU27-only reference acceptance, and the placement prerequisite.
- Add repository/controller/API tests for parsed boundaries, permission and
  tenant isolation, error mapping, date correction/no-clear rule, availability
  add/remove/correct history, timeline order, idempotency, stale-version
  conflict, archive blockers, malformed-provider 502, and atomic rollback.
- Add live SQL/RLS/grant/index/export-registration tests for migration stop on
  legacy `released`/`retired` data, draft-only mapping, versioned EU-27 seeds,
  locks/concurrency, projection/history consistency, audit/outbox durability,
  and no partial effects. Regenerate Supabase types only after migration
  approval.
- Add web/component and real-stack E2E coverage for owner success, forbidden
  role, blocked placement, correction, stale reload, accessible feedback, and
  successful/blocked local flows using unique records without reset/deletion.
  Run focused coverage at 80% or higher, database lint/diff/types, contract,
  API, web, architecture, root lint/typecheck/test/build, and security review.
- Audit facts record organization, release, actor, command, before/after state
  or corrected field, and correlation/idempotency identity without secrets.
  Metrics/logs distinguish validation/invalid-transition/blocked/conflict from
  provider failures; they never include tokens, cookies, or raw sensitive data.

## Rollback

Deploy additive schema, EU-27 reference data, and RPCs before API and web
callers. If a deploy is rolled back, disable the V1 callers and leave new
history, audit, and retention signals intact; previous code continues against
the compatible expanded schema. Do not delete legal/regulatory history or
invent a reverse lifecycle transition. If the migration stop detects legacy
`released`/`retired` data, halt before alteration, investigate/migrate that
data under an explicit approved plan, then rerun; it is not safe to map it
automatically. A later contract migration may remove legacy objects only after
all compatible callers and generated types are gone.

## Review checklist

- [x] The direct solution was considered first.
- [x] Every selected pattern has a present-tense trigger and a contract test.
- [x] No request, user, tenant, or session state is global.
- [x] Controllers/pages contain no provider query or domain decision.
- [x] Domain/application layers do not import frameworks or concrete adapters.
- [x] Boundary input and external responses are schema-validated.
- [x] Wire schemas and parsed `z.output` types live in separate feature folders.
- [x] Every JSON route and browser request parses both applicable directions.
- [x] JSX is functional; logic classes have a real dependency/lifecycle trigger.
- [x] Security-critical effects are synchronous or transactionally durable.
- [ ] Focused coverage for new/materially changed modules is at least 80%.
- [ ] Compatibility, live-stack, and full repository gates are complete.
