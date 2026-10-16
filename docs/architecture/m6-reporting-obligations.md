# M6 reporting obligations and deadline anchors

## Scope and preserved contracts

- User outcome: an authorized reporting operator creates or links a CRA reporting obligation, sees frozen stage deadlines, corrects anchors with durable audit, and cancels an obligation without losing history.
- In scope: actively exploited vulnerability and severe incident obligations; awareness, remediation availability, and notification-submitted anchors; effective-dated rule snapshots; stage state/due-at recomputation; cancellation; durable high-severity audit; finding-origin linkage; compact workspace UI.
- Out of scope: legal determination, ENISA submission transport, report drafting, notification worker, external collaboration, AI-authored content, Redis/browser clock deadline authority, or replacement audit logging.
- Preserved: `/api/v1`, refresh-cookie path, ES256/JWKS auth, frozen auth-actions, permission merge order, session revocation, menu/mock contracts, M4 KEV intent handoff, M5 remediation anchor outbox, VEX/assessment/evidence separations, and existing `AuditService.log()` callers.

## Concrete problem

The BRD says the database is the deadline authority and requires three different anchors: awareness for 24h and 72h stages, remediation availability for a vulnerability final report, and actual notification submission for a severe incident final report. A direct countdown-only UI or delayed job cannot preserve correctness after restart, retroactive correction, rule amendments, cancellation, or concurrent submissions.

The direct implementation is a small reporting-obligation feature: rule-set rows, obligation rows, immutable anchor/event rows, and one current stage row per required stage. SQL RPCs take `organization_id` first, validate the verified actor, freeze the rule snapshot at creation, recompute dependent stages in the same transaction as anchor changes, and write audit facts durably.

## Why not simpler?

Columns on `vulnerability_findings` cannot represent severe incidents, manual obligations without a finding, effective-dated rules, multiple stages, or cancellation history. A generic workflow engine, event bus, or submission framework would add ceremony beyond M6-01. A feature-local state machine plus RPC transactions is enough for the current stages and leaves later report drafting/submission to M6 follow-up tasks.

## Selected patterns

- Pattern and trigger: feature facade plus Supabase adapter. PostgREST/RPC output and provider errors differ from the application contract.
- Participants: React reporting components, web reporting gateway, `@repo/contracts/reporting`, Nest reporting controller, reporting use cases/port, Supabase repository.
- Dependency direction: presentation -> application -> domain contracts/ports; infrastructure implements inward-owned ports.
- Contract: strict Zod request/response schemas and parsed `z.output` types at web and API boundaries.
- Removal trigger: if reporting obligations stop crossing process/database boundaries.

- Pattern and trigger: persistent State. Obligation stages have more than three meaningful states and transitions can race.
- Participants: SQL transition helpers and pure TypeScript deadline policy tests.
- Dependency direction: UI renders server state; database owns authoritative stage state.
- Contract: `pending_anchor`, `running`, `submitted`, `overdue`, `not_required`.
- Removal trigger: if obligations collapse to a single immutable timestamp.

- Pattern and trigger: Command record. Mutations require idempotency, actor identity, expected version, retry safety, and audit.
- Participants: reporting command ledger rows and mutation RPCs.
- Dependency direction: application submits immutable commands; SQL returns stable outcomes.
- Contract: same idempotency key and digest replays the same result; changed payload returns conflict.
- Removal trigger: if every reporting mutation becomes read-only or non-retryable.

## Rejected patterns

- Generic event bus: no notification/submission fanout in M6-01, and audit/deadline correctness must be synchronous.
- Redis/delayed-job deadline authority: rejected by BRD section 11 because database state must survive queue loss.
- Browser clock timers: useful for display only, never authoritative for due-at or breach.
- New base role: reporting permissions must use existing custom-role and permission machinery.
- Weekend/holiday calendars: explicitly out for regulatory deadlines; internal SLA remains separate.

## Data and tenant boundaries

- Verified source of identity: API `RequestUser.id` and `RequestUser.organizationId`, set by the existing auth guard and selected organization session.
- Service-role queries: every RPC takes `p_organization_id` first and filters obligations, stages, rules, findings, products, releases, remediation anchors, users, command rows, and audit rows by that organization.
- Transaction boundary: create obligation, anchor correction, submission anchor, tick, and cancellation each update stages, immutable events/history, idempotency result, and audit facts in one database transaction.
- Idempotency and concurrency: expected version is required for updates; duplicate anchors with the same key replay; different payload with the same key conflicts; row locks serialize cancellation/submission/correction.
- Migration and rollback: expand-only migration and regenerated types first, API second, web last. Roll back API/web first while retaining obligations, stages, rules, audit, and event history.

## API boundary contracts

- Contract folder: `packages/contracts/src/reporting/schemas` and `packages/contracts/src/reporting/types`.
- Request/query/params: obligation list, obligation detail params, create, correct anchor, record submission anchor, cancel, and tick/read schemas.
- Success responses: parse every successful payload with response schemas; trusted types derive from `z.output`.
- Nest boundary: controller parses body/query/path with existing Zod pipes and declares `@ZodResponse`.
- Browser boundary: reporting gateway validates outgoing `inputSchema` and incoming `schema`; mutations are not silently replayed after refresh.
- Unknown keys: strict rejection. Timestamps are UTC `Z` strings at second precision; UI displays local offset.

## Frontend logic and rendering

- Functional components only, added as an operational reporting panel/page in the existing workspace shell.
- Plain `.ts` gateway and React Query hooks own transport and cache invalidation.
- Pure policies format durations/stage labels and never authorize actions.
- UI states: loading, empty, forbidden, validation, conflict, offline/save failure, pending anchor, overdue, cancellation, and retry with preserved input.

## Failure modes

- Cross-tenant finding, archived/deleted release, revoked actor, missing permission, malformed UUID, stale version, idempotency mismatch, duplicate active obligation, unknown rule, and invalid transition fail closed with stable outcomes.
- Awareness moved backwards recomputes deadlines and may mark overdue immediately; audit records old/new/reason.
- Cancellation while running moves active/pending stages to `not_required` and keeps submitted/overdue facts.
- Late submission records the submission but does not erase `overdue_at`.
- Calendar month arithmetic clamps end-of-month dates explicitly.
- DST display shifts are presentation-only; UTC elapsed time remains exact.

## Tests and observability

- First failing tests: contract tests for strict schemas and deadline examples, SQL integration for rule freeze/recompute/cancellation/audit, API adapter/controller tests for org-first RPCs and outcomes, and web tests for form states and stage display.
- Live-stack checks: local Supabase SQL tests, focused API tests, web component/gateway tests, Playwright browser flow against local dev only, and accessibility screenshots.
- Observability: audit actions distinguish create, anchor corrected, submitted, breached, and cancelled without storing report content in notification payloads.

## Rollback

Deploy expand-only. Previous code ignores the additive tables. If rollback is needed, disable/remove UI and API routes first. Data remains retained until a separately approved retention migration because obligations and audit facts are compliance evidence.

## Review checklist

- [x] The direct solution was considered first.
- [x] Every selected pattern has a present-tense trigger and a contract test target.
- [x] No request, user, tenant, or session state is global.
- [x] Controllers/pages contain no provider query or domain decision.
- [x] Domain/application layers do not import frameworks or concrete adapters.
- [x] Boundary input and external responses are schema-validated.
- [x] Wire schemas and parsed `z.output` types live in feature folders.
- [x] Every JSON route and browser request parses both applicable directions.
- [x] JSX is functional; logic classes have real dependency boundaries.
- [x] Security-critical effects are transactionally durable.
- [x] Focused coverage and live-stack gates are listed.
- [x] Compatibility and rollback ordering are listed.
