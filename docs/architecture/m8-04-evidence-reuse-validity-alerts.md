# M8-04 evidence reuse, validity and expiry alerts

## Scope and preserved contracts

- **User outcome:** an authorized user can distinguish validity from retention,
  find where an evidence version is reused, and receive one durable expiry
  alert for each configured threshold. This covers FR-EVD-007 and FR-EVD-008.
- **In scope:** version validity states and filtering, organization-managed
  interval settings, M7 reverse-link projection, an honest empty M10 control
  projection, and leased expiry notification delivery.
- **Out of scope:** technical-file link writes, a framework/control library,
  compliance scoring, legal-deadline logic, evidence deletion, or a second
  link/outbox system.
- **Preserved:** immutable evidence versions and their validity dates,
  retention/legal-hold calculation, M7 source writes, M8 intake/OCR/search,
  `/api/v1`, authentication/cookie contracts, permission merge order, and the
  existing Evidence Control Room upload/viewer layout.

## Concrete problem

Validity is version-specific but the existing Evidence Library exposes only a
date and an organization-wide technical-file source can reference that version
at a particular observed revision. A synchronous UI calculation cannot deliver
alerts after a browser closes, cannot deduplicate threshold changes, and cannot
recover from an SMTP or process failure. Counting all source rows also leaks
that a restricted technical-file section exists.

## Why not simpler?

The direct alternative is to filter validity dates in React and send an email
when the evidence page opens. It has no durable catch-up/retry behaviour,
silently misses unattended tenants, and exposes links before technical-file
authorization. A mutable “expiry notified” field on an immutable evidence
version cannot represent four thresholds or a changed configuration. The
existing evidence notification outbox already supplies durable delivery, so a
new table or generic scheduling framework would add duplicate state.

## Selected patterns

- **Version-derived validity policy and filtered projection.** The present
  trigger is one immutable start/end date requiring consistent calculated
  states in API, SQL, and UI. A pure policy classifies `missing`,
  `open_ended`, `not_yet_valid`, `current`, `expiring_soon`, and `expired` from
  stored dates and the largest configured threshold. Remove it only if validity
  stops being a version property.
- **Existing durable evidence outbox with threshold idempotency.** A threshold
  field and partial unique indexes represent one delivery per
  organization/version/event/threshold. Reconciliation uses database time,
  obsolete-unsent marking, and an owner/membership/permission recheck at claim
  time. Participants are the validity worker, Supabase RPCs, and the dedicated
  expiry mail adapter. Remove the extension if the platform provides an
  equivalent durable, tenant-scoped scheduler.
- **Read-only M7 reverse-link projection.** M8 reads M7 source records by
  evidence `record_id` and `observed_revision`, resolves that exact immutable
  version, and reports stale/review status. It never updates M7 links. M10 has
  no producer in V1, so the shared contract returns `frameworkControls: []`.

Dependency direction is functional React -> typed evidence gateway -> thin
Nest controller -> evidence validity/reuse use case and port -> Supabase or
mail adapter. Controllers and pages contain no provider calls or link-ranking
policy.

## Rejected patterns

- **A separate reuse table:** duplicates M7 source truth and permits silent
  retargeting of historical links.
- **A generic event bus/scheduler:** the only demonstrated lifecycle is expiry
  delivery, which is already covered by the evidence outbox lease protocol.
- **M10 placeholder data:** fabricated controls would be a compliance claim and
  would make an unavailable integration indistinguishable from real mappings.
- **Client-side authorization/post-filtering:** counts and target names would
  already have leaked before filtering.

## Data and tenant boundaries

- Identity is the verified authenticated user and active organization supplied
  by the existing Nest request context; no browser organization value is
  trusted.
- Every service-role RPC accepts `organization_id` first. It filters document,
  version, product, outbox, settings, M7 source and technical-file product rows
  by that organization and checks active membership plus the existing
  custom-role/override-aware permission function before selection. Reuse counts
  apply technical-file visibility before aggregation.
- Interval update, configuration audit, reconciliation, stale-unsent marking,
  and outbox creation commit in their respective database transactions. An
  update uses the settings version for optimistic concurrency. Claim/complete
  updates require the matching lease worker and recheck the active authorized
  owner before sending.
- The migration adds columns/indexes/functions only: settings retains its row;
  the existing evidence notification outbox gains a threshold/event shape.
  Generated types come from the Supabase CLI. Deploy migration/types, then
  API/web, then the non-root validity worker. Rollback stops that worker and
  removes new routes/UI; old code ignores additive records and no evidence or
  M7 source is deleted.

## API boundary contracts

- `@repo/contracts/evidence` owns validity query/status, list response,
  expiry-interval GET/PATCH, and version reuse schemas/types. Filters have
  finite enums; interval thresholds are 1–3650 days, unique, 1–12 long; PATCH
  requires the expected settings version.
- Successful controller responses are parsed with those schemas and trusted
  types derive from `z.output`. Product/document/version parameters and every
  query/body are parsed before use.
- New routes are product/version reuse `GET`, organization expiry intervals
  `GET`, and interval update `PATCH`; reads require `can_view_evidence`, while
  updates require `can_manage_organization`. The browser validates mutation
  inputs and every response. A mutation is user-retried after a refresh rather
  than automatically replayed.
- Unknown/invalid filters and cursors fail with a stable validation error;
  defaults preserve the prior unfiltered list. M10’s empty array is an explicit
  typed compatibility response, not an absent field.

## Frontend logic and rendering

- Functional Evidence Library components render validity filter controls,
  non-colour state labels, localized dates, a linkage count control, and an
  accessible panel/table of authorized M7 targets. The existing page heading,
  upload, viewer, semantic tokens, `cn()` styling and responsive layout remain
  intact.
- Focused evidence gateway/query hooks own transport, loading and recoverable
  error state. They retain typed filters during offline/forbidden/conflict
  failures. No React class is introduced.
- Pure immutable policy text labels make missing validity read “Validity not
  supplied” and open-ended validity read “Open-ended validity — no expiry alert
  is scheduled.” Linked/extracted content remains React text, never HTML.

## Failure modes

- Invalid dates, filters, interval bounds, duplicate thresholds, and stale
  expected versions fail closed with stable validation/conflict responses.
- Missing/open-ended dates schedule no alert; expired evidence remains retained
  and historically viewable under existing policy, never deletion-authorizing.
- Worker restarts, duplicate reconciliation, lease expiry, and concurrent
  interval changes are idempotent through database time, locks, partial unique
  indexes, lease ownership and obsolete-unsent state.
- SMTP/network/provider failures are recorded and retried with backoff. A
  deactivated, revoked, or unauthorized owner becomes a durable
  recipient-unavailable outcome; no recipient is substituted.
- M7/M10 absence, OCR/ClamAV downtime, archived products, quarantined or
  integrity-failed evidence return only honest permitted state/projections and
  do not stop schedule reconciliation. JWT/session errors deny access; no
  target, count, snippet, or product metadata is post-filtered.

## Tests and observability

The first characterization tests assert that validity is not retention, that
missing/open-ended dates do not imply expiry, and that an unauthorized
technical-file link is neither counted nor returned. Contract tests cover
status/filter and interval parsing; unit/API tests cover version conflicts and
schema boundaries; SQL tests cover tenant/revocation, archived/stale/replaced
links, dedupe, leases, retries, catch-up and inactive owners; UI tests cover
keyboard/focus, table/panel/filter/error states and safe text rendering; and
live Playwright checks create uniquely named fixtures without reset/delete.
Worker logs record organization/job/outbox identifiers and safe result codes,
not evidence content, addresses, secrets, or arbitrary provider payloads.

## Rollback

This is expand/deploy/contract sequencing. Stop `worker:evidence-validity-alerts`
first, then roll back the API/web release. The additive migration and derived
outbox rows remain; earlier releases do not query them. No destructive database
rollback, evidence rewrite, M7 write change, or retention-policy change is
required.

## Review checklist

- [x] The direct browser-triggered solution was considered and rejected for a demonstrated durable-delivery gap.
- [x] Existing M7 links, organization settings, and evidence outbox remain the sources of truth.
- [x] Every selected persistent workflow has tenant-scoped idempotency and a contract test.
- [x] Controllers/pages contain no provider query or authorization decision.
- [x] Boundary request/query/response values use feature-first Zod schemas and `z.output` types.
- [x] Validity is distinct from retention and cannot authorize deletion.
- [x] M10 has an explicit honest empty projection until its real producer exists.
- [x] Deployment, rollback, failure states and focused/live test gates are recorded.
