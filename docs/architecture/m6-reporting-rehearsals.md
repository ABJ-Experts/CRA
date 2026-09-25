# M6 isolated reporting rehearsals

## Scope and preserved contracts

- User outcome: authorised responders can rehearse the full reporting lifecycle
  without creating a legal reporting record, alert, metric, or recipient action.
- In scope: explicitly classified rehearsal obligations, linked fresh replays,
  real-only reporting defaults, and durable synthetic markings on evidence.
- Out of scope: an ENISA transport, a simulator framework, clock manipulation,
  copying rehearsal content into real reporting, or a new role system.
- Preserved: `/api/v1`, reporting drafts and approvals, manual real filing,
  session/JWKS boundaries, immutable evidence, tenant isolation, and existing
  permission merge order.

## Concrete problem and direct solution

The reporting workflow is intentionally production-shaped: a reporting stage
can create deadline alerts, a signed package, and a receipt-backed external
filing. A UI-only rehearsal filter would therefore leave the deadline worker
and crafted normal filing requests able to treat synthetic rows as real.

The direct feature-local solution is a boolean classification on the existing
reporting obligation. It is propagated by the reporting-owned SQL commands to
the immutable evidence records they create. A replay creates a new rehearsal
obligation linked to the prior synthetic obligation, rather than resetting or
copying its drafts, approvals, packages, or receipts.

## Selected and rejected patterns

- A focused feature facade remains the existing reporting use-case/repository
  boundary. The concrete trigger is the shared reporting lifecycle already
  owning all state transitions and evidence.
- Immutable command records and existing stage lifecycle functions are reused
  because replay and filing must be auditable and retry-safe.
- A separate simulator platform, generic workflow engine, provider abstraction,
  event bus, and new role are rejected: none has a second real consumer.

## Data and tenant boundaries

Every rehearsal command is organization-first and validates the actor,
membership, `can_submit_reporting`, target rehearsal classification, and
same-tenant replay parent in one SQL transaction. A rehearsal has no finding
source. Existing real-filing RPCs reject rehearsal obligations; the dedicated
synthetic filing path persists an explicit synthetic classification and never
selects a recipient or calls a provider.

The deadline reconciler, alert materializer, delivery discovery, and summary
filter rehearsals in SQL. This means no browser state, failed UI filter, or
crafted request can create a production breach alert, email delivery, or header
count from synthetic data.

## API and frontend boundaries

Reporting contracts own strict rehearsal create/replay inputs, mode metadata,
and the explicit real/rehearsal list scope. Controllers parse all parameters
and bodies before delegating to the reporting use case. Web requests parse both
directions through the existing reporting gateway.

The reporting screen defaults to real obligations and has an explicit rehearsal
scope. Rehearsal screens, packages, and evidence display `SYNTHETIC /
REHEARSAL — NOT A LEGAL FILING`; starting a real obligation always uses the
existing blank human-awareness form.

## Failure modes and rollback

Cross-tenant parents, real source findings, stale replay versions, revoked
permission, forged real filing routes, duplicate replays, and malformed
evidence fail closed. Storage failure produces no completed package or filing.
Deploy the additive migration and generated types before API and web; roll back
API/web before the migration. Historical real reporting remains classified as
real and readable throughout.
