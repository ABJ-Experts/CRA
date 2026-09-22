# M9-03 — Attributable supplier-evidence review

## Scope and preserved contracts

- User outcome: an authorized internal reviewer can accept, reject, or
  re-request supplier evidence while preserving the exact supplied version,
  decision history, and supplier-safe communication.
- In scope: per-submission review decisions, follow-up-only revisions,
  attributable review history, durable invitation-delivery state, and internal
  review read projections.
- Out of scope: automatic technical-file linking/completeness, automatic
  acceptance/retries, a new approval platform, or deletion of rejected
  evidence.
- Preserved: M9-02 portal routes and opaque session grants; `/api/v1`;
  cookies/JWKS; M8 immutable versions, retention and quarantine; M7
  version-pinned sources/snapshots; existing request lifecycle states and
  supplier-safe portal projection.

## Concrete problem and selected design

M9-02 records an immutable supplier submission only until M8 scan completion.
Its `rejected` state represents scanner rejection, so adding reviewer fields to
that state would conflate unsafe content with a business decision and would
lose reviewer attribution. A direct overwrite of a submission would also make
an accepted evidence link silently follow a later upload.

- **Immutable review record plus small current projection:** a
  `supplier_evidence_submission_reviews` row records each final review against
  a locked submission/version/hash. The submission stores only the current
  review state/version for efficient reads and compare-and-swap. The trigger is
  the present requirement for immutable attribution and replay results.
- **Immutable follow-up revision:** re-request creates a new M9-02 revision
  containing only rejected/missing required follow-up items, each linked to its
  source item. The trigger is preservation of what the supplier previously saw
  while accepted items remain final.
- **Feature facade and org-first RPC adapter:** application use cases call
  transactional Supabase RPCs through the existing supplier-evidence port. The
  trigger is service-role access and the requirement that decision plus audit
  commit together.

Rejected: extending M3 SBOM review records, a generic workflow/event bus,
automatic M7 link creation, a generic notification store, and a raw-token
email retry queue. They either cross an incompatible disclosure boundary,
duplicate M8/M7 authority, or require retaining a portal bearer.

## Data and tenant boundaries

- Internal identity is supplied only by the verified Nest request user. Every
  mutation receives organization ID first and rechecks active membership,
  product scope, `can_view_*`, and `can_review_evidence` inside its RPC.
- The public portal receives only existing opaque invitation/session bearers;
  no new public endpoint or caller-supplied organization/product identifier is
  introduced.
- Review locks the request, submission, evidence version, and current review
  revision. Acceptance requires request `open`, exact expected hashes/IDs, and
  M8 `clean` processing state. Quarantine, failed scan, stale version, revoked
  access, product mismatch, and closed/revoked requests fail closed.
- Same idempotency key and payload returns the saved decision; a different
  payload or stale expected version returns conflict and requires reload.
  Audit rows, review history, submission projection, and revision creation are
  transactionally durable. Delivery updates are separately durable and never
  change a review outcome.
- Delivery starts `pending`, becomes `delivered` or `failed`, and retry issues
  a replacement invitation while revoking the undelivered grant. Raw bearers
  remain hash-only and are never persisted for resend.
- The migration is additive. CLI-generated types follow it before API/web
  deployment. Rollback disables new routes/components while retaining review
  history, evidence, retention protections, and snapshots.

## API boundary contracts

- Contracts live in `@repo/contracts/supplier-evidence/schemas` with parsed
  output types in its `types` folder. Review input includes expected request and
  submission versions, evidence version ID/hash, decision, idempotency key,
  required supplier-visible reason for reject/re-request, and optional
  internal note.
- Internal review reads return distinct scan/review/item/aggregate states,
  immutable evidence provenance, reviewer attribution, and explicit M7 reuse
  eligibility. They never create an M7 source.
- Nest parses body, parameter, and query schemas and declares Zod success
  responses. The browser gateway supplies both outgoing input schemas and
  incoming response schemas. Existing M9-02 response fields remain compatible;
  new review fields are additive.

## Frontend logic and rendering

- Functional review components live beside the current supplier evidence
  request panel. The existing API gateway and TanStack Query lifecycle own
  transport/invalidation; no React component accesses Supabase.
- The code-split reviewer panel shows file metadata, version/hash, scan state,
  checklist, history, confirmation, and accessible text-labelled states.
  Rejection reason and internal notes remain separate, and unsaved form text is
  retained on validation, conflict, and network errors.
- The supplier portal remains session-scoped and receives only the new due
  date/follow-up checklist and supplier-safe rejection text. No internal notes,
  review controls, or hidden tenant data cross that boundary.

## Failure modes, tests, and observability

| Condition | Stable result |
| --- | --- |
| Duplicate review | Saved decision is replayed only for the same payload. |
| Concurrent/conflicting review | Compare-and-swap conflict; UI retains input and reloads. |
| Version becomes quarantined | Acceptance fails closed; historic review is not rewritten. |
| Reviewer loses access | RPC fails authorization before mutation. |
| Notification fails | Review/revision remains durable and invitation displays failed delivery. |
| Replacement upload | Existing review/M7 snapshots retain original version anchors. |

Write characterization failures first, then contracts, permission policy,
controller/use-case/adapter, SQL transaction/RLS/grant, component, and browser
tests. Cover tenant and product substitution, stale hashes, scan failure,
partial reject, closed/withdrawn requests, duplicate/retry/concurrency,
re-request lineage, delivery failure, M7 non-repointing, and accessibility.
Run focused coverage, database lint/types/tests, architecture gates, `pnpm
verify`, real API/auth flows, and Playwright against the local seeded owner
without resetting existing data.

## Review checklist

- [x] The direct submission-overwrite approach was considered and rejected.
- [x] Review history, revision, and RPC patterns have present-tense triggers.
- [x] No portal request trusts caller organization, supplier, or product scope.
- [x] Controllers/pages remain free of provider queries and domain decisions.
- [x] Security-critical review/audit effects share a durable transaction.
- [x] Contracts parse both directions and keep new wire fields additive.
- [x] Rollback preserves supplier evidence, review history, retention, and M7 snapshots.
