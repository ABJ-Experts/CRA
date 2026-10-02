# M9-04 — Supplier reminders, escalation, and response metrics

## Scope and preserved contracts

- User outcome: authorized internal users can configure a bounded supplier
  reminder cadence, see reliable delivery health, retry terminal delivery
  failures, and act on tenant-scoped response metrics and overdue requests.
- In scope: durable reminder and owner-escalation delivery, replacement portal
  invitations, cadence configuration, metrics, and an internal operational
  panel.
- Out of scope: M6 legal timers, automatic sanctions, public routes, an
  analytics platform, historical backfill, and automatic technical-file work.
- Preserved: M9-02/03 opaque supplier portal and invitation/session behavior,
  `/api/v1`, cookies/JWKS, M8 immutable version processing/retention, M7
  source snapshots, permission merge order, existing evidence request wires,
  and all request/review mutations.

## Concrete problem and selected design

M9-03 makes invitation delivery durable, but it has no lifecycle for a
deadline-driven follow-up. A timer in the API process would lose work on
restart, race parallel workers, and send reminders for a closed or revised
request. Calculating aggregate metrics in the browser would both expose data
and disagree with the database clock.

- **One additive delivery ledger plus a focused worker:** each logical
  revision/offset/recipient event has one durable row. The worker reconciles
  current request state into that ledger, leases work, and completes or fails
  it transactionally. The concrete trigger is restart catch-up, retry, and
  duplicate-worker safety.
- **Replacement invitation preparation:** a supplier reminder generates a new
  opaque bearer in memory; only its hash reaches the prepare RPC. The RPC
  revokes the prior invitation while locking the current revision. The trigger
  is the existing non-recoverable portal credential design.
- **Database metric projections:** metrics and overdue pages are org-first RPC
  reads using the database clock and current revision. The trigger is
  consistent tenant/product filtering and one definition for all consumers.

## Why not simpler?

Sending a setTimeout from request creation cannot survive restart, cancel
obsolete work, or coordinate two process instances. Reusing the M8 validity
outbox would conflate different retention/disclosure semantics. A generic
scheduler, event bus, or analytics store adds shared hidden state without a
second concrete producer/consumer. This feature instead extends the already
demonstrated evidence-worker and invitation patterns.

## Data and tenant boundaries

- The controller obtains actor and active organization from verified identity.
  Every service-role RPC takes organization ID first and applies it to every
  request, revision, invitation, delivery, metrics, and overdue query.
- Supplier delivery receives only a portal title, supplier-safe instructions,
  due date, and replacement fragment link. It never receives product, finding,
  organization, review, or internal-note context. Owner escalation remains an
  internal recipient.
- The reconciliation/claim/prepare/complete/fail transactions lock the
  current revision and due-date snapshot. Closed, completed, revoked,
  recipient-inactive, superseded, and stale events cannot be sent.
- The ledger uniqueness key and version/lease checks make duplicate workers,
  retry, and manual retry stable. Supplier deliveries are additionally bounded
  to one per revision per 24 hours; overdue remains eligible while missed
  pre-due events are superseded.
- Settings constrain offsets to at most three distinct non-zero bounded hours;
  defaults are `[-168, -24, 24]`. Due-date/settings changes reconcile future
  work without a burst.
- The migration is additive and RLS is enabled but not forced. Direct table
  access and `PUBLIC` function access are revoked; only intended service-role
  wrappers are granted. Database audit facts share mutation transactions.

## API and UI boundary contracts

- Runtime schemas and parsed `z.output` types live feature-first under
  `@repo/contracts/supplier-evidence` for settings, delivery retry, metrics,
  and overdue pages. All controller params/query/body, RPC results, successful
  API responses, web request bodies, and web responses are parsed.
- Existing supplier-evidence port/use-case/adapter layering owns policy and
  Supabase. Controllers and React components remain thin and never query
  Supabase directly.
- The code-split internal panel provides conflict-safe settings input, a
  compact metrics summary, and an overdue table/retry action. It retains
  unsaved values through validation, network, and conflict errors. Dates use
  organization timezone with UTC fallback; status is text-labelled and not
  colour-only.

## Metric definitions

- Window is `[from, to)`; the UI defaults to the prior 30 days.
- Response denominator is current/request-revision invitations successfully
  delivered in the window. Numerator is a revision with at least one M8
  finalized supplier evidence version. An empty denominator is unavailable,
  never `0%`.
- Accepted-completion is reported separately: every required revision item has
  an M9-03 accepted review.
- Average turnaround is delivery timestamp to the first finalized M8 version
  for the same revision. Outstanding is an open current revision with at least
  one required item lacking accepted evidence; overdue is outstanding with
  `due_at < database now()`.
- Re-request revisions are distinct cycles; cancelled, revoked, and
  undelivered revisions are excluded.

## Failure modes, tests, and observability

| Condition                        | Stable result                                                                |
| -------------------------------- | ---------------------------------------------------------------------------- |
| Worker restart or paused process | Reconciliation catches up from database state.                               |
| Parallel workers/expired lease   | Uniqueness and lease/version checks allow one logical event.                 |
| Deadline revision or completion  | Obsolete events are cancelled/superseded before send.                        |
| Mail provider failure/bounce     | Ledger records bounded retry or terminal failure; manual retry is available. |
| Recipient/owner is revoked       | Delivery fails closed without disclosing request material.                   |
| Tenant/product substitution      | Org-first RPC rejects it before returning or changing data.                  |

Start with contract/policy/adapter/controller/worker/component and SQL failure
tests. Cover settings conflict, deadline revisions, restart, duplicate
workers, lease expiry, retry/backoff, recipient change, owner fallback,
tenant/product denial, response-window boundaries, zero/unavailable metrics,
re-request lineage, M7/M8 non-mutation, accessibility, and local Playwright
owner flow. Logs carry stable IDs and state, never raw bearers or email body.

## Rollback and review checklist

Deploy migration and CLI-generated types before API worker/routes, then web.
Rollback disables worker/routes/panel while retaining additive ledger and audit
history; it does not revoke M9 invitations, mutate M7 sources, or rewrite M8
versions. The known local-only migration-registry `noop` drift is not changed.

- [x] A direct timer was considered and rejected for demonstrated durability risks.
- [x] No generic scheduler, event bus, or analytics store is introduced.
- [x] Tenant, lease, idempotency, recipient, and invitation boundaries are explicit.
- [x] Every new wire boundary is schema-validated and parses successful results.
- [x] Security-critical state and audit effects are transactionally durable.
- [x] Compatibility, local live-stack, and accessibility validation are required.
