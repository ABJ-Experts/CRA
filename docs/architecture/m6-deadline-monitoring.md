# M6 deadline monitoring and escalation

## Scope and preserved contracts

- **User outcome:** reporting deadlines are evaluated from PostgreSQL time, their 50%, 75%, 90%, and breach crossings are durably recorded, and authorised operators receive a compact countdown and safe email escalation.
- **In scope:** reporting-obligation stage monitoring, durable email outbox, worker recovery, health/skew observation, and reporting/header countdown projections.
- **Out of scope:** a new timer platform, Redis dependency, browser authority, in-app inbox, automatic submissions, or legal decisions.
- **Preserved:** `/api/v1`, reporting-obligation mutations and command ledger, ES256/JWKS authentication, cookie paths, permission merge order, M5/M6 history, RLS, and the existing compact Reporting UI.

## Concrete problem and selected design

M6-01 stores stages and computes deadlines, but `tick_reporting_obligation_stages_atomic` only marks a late stage overdue. It has no exactly-once threshold ledger, retryable delivery state, safe recipient recheck, or server-time UI projection. A browser interval or delayed queue alone cannot recover a worker restart or a transport outage.

The selected design is a feature-local **durable outbox** plus a **stateless worker**. PostgreSQL owns schedule evaluation, event/audit creation, leases, retry state, and database time; the worker only reconciles, claims, asks for a current safe delivery projection, and calls SMTP. This reuses the current product-retention and vulnerability-triage worker patterns.

- **Facade:** reporting controller/use case exposes only the authorised monitoring summary.
- **Adapter:** the Supabase queue adapter and mail adapter translate provider-specific shapes behind reporting-owned ports.
- **Command record:** threshold emissions and deliveries are immutable rows with a unique `(stage, deadline revision, threshold)` identity; no generic command bus is introduced.
- **Removal trigger:** if reporting obligations are removed, their monitor tables, worker, and summary route can be removed together after retention approval.

## Data and tenant boundaries

Every tenant-owned row carries `organization_id`; FK lookups and all service-role RPCs lead with it. Stage evaluation locks current rows and writes threshold event, audit fact, and queued deliveries in one transaction. Human commands retain the existing idempotency ledger. Worker actions are system actions, never impersonate a human, and write metadata-only audit facts.

Each schedule-changing correction increments only the affected stage deadline revision. Thresholds crossed under that revision are emitted in ascending order once. Cancellation changes pending/retrying deliveries to cancelled; a prior breach event remains evidence after late submission. Before delivery, the queue projection rechecks active account, active membership, `can_view_findings`, active owner/admin role, email channel, organisation, obligation, and stage state.

The migration is additive, generated through the Supabase CLI, enables non-forced RLS, grants only `service_role`, pins every security-definer function to `public, pg_temp`, and extends export/purge registration for the operational records. Generated database types are regenerated only after local migration success.

## API and frontend boundaries

Strict `@repo/contracts/reporting` schemas define server-time countdown/stage projections and the summary response; trusted types derive from `z.output`. Nest parses the query and serializes only parsed success responses. The web gateway parses response schemas and uses no browser Supabase client.

React renders a presentational countdown from the last server-time snapshot and due timestamp, refreshing the server projection every 30 seconds. Pending-anchor stages display no invented due date. The compact global-header indicator and reporting table are gated only after session loading and `can_view_findings`; server-side permission remains authoritative.

## Failure modes and observability

- SMTP/provider failure: release/retry with stable delivery idempotency; finally dead-letter, while manual reporting stays available.
- Worker/transport outage: PostgreSQL schedule/outbox persists; startup and periodic reconciliation materialize missed thresholds once.
- Cancellation/revocation race: delivery details returns cancelled/not-found and no email is sent.
- Duplicate tick/concurrent worker: row leases and unique threshold identities suppress duplicates.
- Clock skew at or above one second: persist critical monitor health, log critical context without tenant data, and make monitor readiness fail; deadline evaluation continues with database time.

## Tests and rollout

Tests cover strict schemas, UTC/DST/month timing, recovery at 80%, duplicate ticks, correction/cancellation/submission races, RLS/grants, audit/outbox atomicity, recipient revocation, retry/dead-letter, clock skew, UI accessibility, tenant switching, and local browser E2E. Deploy migration/types first, worker/API second, then web. Roll back code/configuration before any separately approved retention migration; retain operational facts and deliveries.
