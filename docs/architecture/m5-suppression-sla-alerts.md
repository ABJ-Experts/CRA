# M5 expiring suppression and internal triage SLA alerts

## Scope and preserved contracts

- **User outcome:** a permitted organization editor can assign a finding and
  apply a reasoned, finite suppression; an organization owner can configure a
  severity-specific internal triage target. Expiry returns the finding to the
  actionable queue, and one durable notification is attempted without changing
  the finding's risk or regulatory obligations.
- **In scope:** current assignee, append-only suppression revisions, internal
  SLA policy and timing projection, durable expiry/breach alert work, delivery
  outcomes, queue/detail filters, and the focused findings UI.
- **Out of scope:** M6 legal timers, regulatory deadline modification,
  `not_affected` semantics, suppression cancellation, arbitrary business-hour
  calendars, and a generic notification/event framework.
- **Preserved:** `/api/v1`, M4 queue cursor/filter semantics, M5 VEX history
  and approval state, M5 bulk assessment operations, auth cookie paths,
  JWKS/session revocation, RBAC resolution order, menu configuration, and MSW
  API passthrough.

## Concrete problem and direct solution

A `suppressed_until` column on `vulnerability_findings` is insufficient. It
would lose prior reasons/extensions, cannot atomically record an expiry alert,
and conflates durable operational state with feed-owned risk facts. A
best-effort timer would similarly lose work across a process restart or produce
duplicates when a retry races another worker.

The selected direct composition adds focused tenant-scoped operational tables
and database RPCs. An expiry/SL A breach transaction makes the finding
actionable or records the breach before creating one keyed notification event.
The existing lease/retry/dead-letter delivery shape processes that row. This is
the smallest design that satisfies durable recovery, once-logical events, and
audit evidence; it is not a cross-feature workflow framework.

## Selected patterns

- **Facade plus persistence adapter:** functional React components call the
  typed triage gateway; a thin Nest controller calls a focused use case and
  inward-owned repository port; the Supabase adapter invokes org-first RPCs.
  The adapter exists because PostgREST/RPC shapes and errors differ from the
  application contract. Remove it only if Supabase ceases to be the boundary.
- **Transactional command record:** each assignment, suppression, and SLA
  policy mutation carries idempotency and expected version. The RPC locks the
  operational state, validates actor/tenant/finding, updates state and
  append-only audit evidence in one transaction. This is required now because
  a browser must not replay mutations after refresh and an expiry extension can
  race a due worker.
- **Feature-local leased outbox:** one notification row per stable event key is
  claimed, delivered, and completed/failed under a lease. This is required now
  because SMTP can fail after the authoritative state changes. It is removed if
  the feature no longer has asynchronous delivery; no observer, mediator, or
  global event bus is introduced.

## Rejected patterns

- Columns directly on `vulnerability_findings`: cannot retain immutable
  suppression revisions or isolate matcher-owned facts from operational state.
- In-memory timer/cron state: cannot survive restart, provide an audit trail,
  or deduplicate retrying workers.
- M2 propagation jobs and M4 review/KEV notification tables: their target and
  lifecycle semantics differ; reuse would couple independent policies.
- Generic command/event bus: there is one durable alert consumer today, so a
  feature-local table and port are clearer and smaller.

## Data and tenant boundaries

The authenticated request supplies verified actor and active organization.
Every service-role operation takes `organization_id` first, checks active
membership, and filters finding, operational state, assignee, policy,
suppression revision, event, user, and audit data by it. Assignment and
suppression require `can_edit_findings`; policy configuration requires
`can_edit_organization` and owner-level routing from existing permission
machinery. At delivery, a revoked/inactive assignee is ignored and eligible
owner/admin recipients are resolved afresh.

Suppression and SLA policies are additive, tenant-scoped data with FKs to
`public.users`; RLS is enabled but not forced. Security-definer functions pin
their `search_path`, revoke `PUBLIC`, and explicitly grant only intended
service roles. Policy target edits are prospective: accumulated elapsed SLA
time is retained, severity changes choose the new target without a clock reset,
and reassignment never resets time. Suppression pauses a non-breached clock;
an already breached finding remains visibly breached while suppressed.

The expiry transaction ends suppression and inserts one notification event
before any provider call. Missing/deleted or superseded targets are terminal
`skipped_deleted` or `skipped_superseded` event evidence. Failed delivery only
changes retry/dead-letter status; it never restores suppression. Deploy in
expand order: migration/types, API worker, then web. Rollback web/API first and
retains revisions, timing snapshots, audit evidence, and alert events.

## API boundary contracts

Feature contracts remain under `@repo/contracts/vulnerabilities`. All request
and response values use strict Zod schemas with trusted `z.output` types.
`expiresAt` accepts only a future UTC `Z` instant; persisted output timestamps
also use UTC strings, while browsers choose local display. `expectedVersion`
and UUID idempotency keys are mandatory for mutations.

- `PATCH /api/v1/findings/:findingId/assignee` parses finding params and
  `assignVulnerabilityTriageFindingInputSchema` and returns
  `vulnerabilityTriageOperationalMutationResponseSchema`.
- `POST /api/v1/findings/:findingId/suppression` parses the same params and
  `suppressVulnerabilityTriageFindingInputSchema`; it creates/extends a
  revision only and cannot cancel VEX or regulatory work.
- `GET|PUT /api/v1/findings/triage-sla-policies` parse respectively the strict
  empty query or `updateVulnerabilityTriageSlaPolicyInputSchema` and return
  policy response schemas.
- Queue/detail responses add the strict `operational` projection. It is
  independent of VEX fields and exposes assignee, suppression,
  `not_configured|tracking|paused|breached` internal SLA state, and latest safe
  delivery result. Queue filters add suppression, SLA, and delivery states
  without changing saved-view filters.

Nest parses path/body/query input and every JSON success response. The browser
gateway supplies both the outgoing `inputSchema` and incoming `schema`; only
GET refreshes may retry, while mutations require an explicit user retry with
the same idempotency key.

## Failure modes, tests, and observability

- Invalid/past/non-UTC expiry, missing reason, duplicate filters, invalid SLA
  target, stale version, duplicate/mismatched idempotency key, forbidden actor,
  invalid assignee, cross-tenant ID, archived/deleted finding, and inactive
  membership fail closed with stable validation/conflict/forbidden outcomes.
- Suppression extension versus expiry locks one operational row. Exactly one
  logical expiry or breach event persists; the losing caller receives a stale
  conflict or replay result.
- SMTP/network failure retries with bounded errors and dead-letters; no
  recipient becomes `recipient_unavailable`; superseded/deleted targets become
  terminal skipped evidence. Errors distinguish validation from provider
  outage without logging recipient data or secrets.
- Start with failing contract tests for strict parsing and state combinations;
  add pure SLA timing tests, RPC/RLS/transaction/concurrency tests, adapter and
  worker failure-injection tests, web gateway/form/filter tests, and local
  Playwright accessibility journeys. Live tests cover cookies, mail, RLS,
  transactions, and lease retries. New/materially changed modules target 80%+
  coverage.

## Review checklist

- [x] Direct columns and an in-memory timer were considered and rejected for
  concrete durability/history failures.
- [x] No request, tenant, actor, session, or timing state is global.
- [x] Controllers/pages remain free of Supabase calls and policy decisions.
- [x] Wire schemas and `z.output` types remain feature-owned and strict.
- [x] Authoritative expiry/breach state and audit evidence commit together.
- [x] Deploy and rollback remain additive and compatible with the previous API.
