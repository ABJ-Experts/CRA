# M2 V2 substantial modifications and security update artifacts

## Scope and preserved contracts

- **User outcome:** an authorized manufacturer can preserve a reviewed,
  versioned modification assessment and prove that a released security update
  remains retrievable for the controlling CRA Article 13(9) window.
- **In scope:** product/release-scoped assessment history, deterministic human
  review, immutable update-artifact content identity, quarantine clearance,
  publication/replacement/withdrawal, availability calculations, durable audit
  and integration facts, tenant export/retention coverage, workers, and local
  product-detail controls.
- **Out of scope:** classification conclusions, technical-file rendering, a
  generic evidence domain, malware scanning service, customer distribution
  portal, binary signing, and PLM/ALM synchronization. ABJ-14 classification is
  not present; this feature emits a typed follow-up fact rather than pretending
  to make a legal classification decision.
- **Preserved:** `/api/v1` routes and cookies, verified session/organization
  behavior, permission-merge ordering, existing product contracts, mock
  namespace, product archive rules, and the "Evidence Control Room" UI shell.

## Concrete problem

Existing products have versioned release and support-period facts, deterministic
retention, lifecycle dependency facts, a transactional regulatory outbox, and
private Storage precedents. They have no immutable record for a modification
assessment or security-update bytes. Adding columns to `products` would
overwrite prior assessments; treating an import as an artifact would not store
legal availability, release scope, publication state, or a safe replacement
relationship. A browser upload has no durable recovery path after a refresh.

## Why not simpler?

The direct design is a mutable product note and a file upload endpoint. It
cannot preserve reassessment answers, distinguish an unreviewed suggestion from
an authoritative human conclusion, lock concurrent edits, calculate a
non-reducing legal window, authenticate a later download, or recover safely
when upload and metadata persistence are separated. The minimum authoritative
model is therefore one assessment table, its required release join table, and
one artifact table. Existing `audit_logs`, lifecycle facts, export registry,
retention machinery, and regulatory outbox supply all other history and work.

## Selected patterns

- **Append-only versioned decision record.**
  `product_substantial_modification_assessments` stores one revision per row.
  A stable modification identifier and a `supersedes_id` chain preserve every
  answer, rationale, and outcome. The release join is necessary to make
  one-or-many affected releases tenant-safe with real foreign keys.
- **Pure policies.** `m2.v2.substantial-modification.v1` owns the five fixed
  questions and a non-authoritative suggestion. `m2.v2.security-update-
availability.v1` uses UTC calendar-year arithmetic and returns both
  candidates, the winning rule, and an incomplete/blocked explanation. They
  are immutable functions with no framework or provider import.
- **Focused storage adapter.** A product-owned storage port exists because
  upload reservation, signed URLs, private object verification, and attachment
  download have a real provider lifecycle. The adapter is removable if
  artifacts move to a supplied compliance-storage provider.
- **Transactional facts plus existing outbox.** A database RPC locks the
  authoritative rows and writes the state, audit entry, lifecycle fact, and
  outbox event in one transaction. Existing `product_regulatory_outbox_events`
  handles idempotent inspection, recalculation, monitoring, and cleanup.

Dependency direction is functional React section -> typed product gateway ->
thin Nest controller -> product use cases/pure policies -> product repository
and storage ports -> Supabase adapters/RPCs. Controllers and React never query
Supabase or decide legal state.

## Rejected patterns

- A generic evidence, artifact-history, queue, metrics, or workflow table
  duplicates a present owner. Immutable evidence-reference metadata, audit rows,
  outbox rows, and worker measurements meet the current need.
- A process-local timer, browser polling authority, or direct controller-to-
  storage call cannot survive restart or enforce the organization boundary.
- AI may eventually suggest wording, but there is no AI decision endpoint and
  no machine output can set the authoritative determination.
- An external-reference settings UI is rejected: trusted hosts come only from
  validated deployment configuration until a dedicated authority exists.

## Data and tenant boundaries

- The global auth guard verifies the session and active membership. The request
  organization and actor are authoritative; a selected organization in browser
  state is only a hint.
- Every new RPC and storage operation receives `organization_id` first and
  filters the product, release, assessment, artifact, support period,
  replacement, lifecycle fact, and audit row by it. A foreign identifier has
  the same `not_found` result as a missing identifier.
- Assessment revisions are immutable. Reassessment locks the prior row,
  compares the optimistic version, inserts the successor and release rows,
  supersedes the prior fact, and writes audit/follow-up facts atomically.
- Artifacts have one mandatory release scope. Content is tenant-scoped and
  content-addressed; bytes are uploaded with `upsert: false`. Established hash,
  object key, size, and media type are never updated. An artifact record is
  retained permanently; only a worker may later remove a blob after it repeats
  every availability, retention, legal-hold, and reference check.
- `can_approve_products` is the explicit review/publish permission. Owners and
  admins receive it by default. `can_view_products` can list/download safe
  artifacts; existing create/edit product permissions can draft or reserve;
  approval is required for review, clearance, publication, replacement,
  withdrawal, and a high-impact override. Every override has a nonblank reason.
- Migration order is additive: schema/RPC/grants/export registry/bucket, then
  generated types, API/workers, then UI. RLS is enabled but not forced; browser
  roles and `PUBLIC` are revoked and `service_role` is explicitly granted. Each
  security-definer function pins `search_path = public, pg_temp`.

## Lifecycle and failure behavior

1. An editable assessment stores all five answers and submits for review. Its
   policy suggestion is never an authoritative conclusion. A reviewer records
   the authoritative determination. A potentially substantial or substantial
   review writes an active `substantial_modification` follow-up fact. A new
   reassessment supersedes rather than overwrites the old row.
2. Artifact reservation validates product/release, support-period eligibility,
   content metadata and configured size limit, then returns a short-lived
   signed upload URL without storing it. Finalization is idempotent. A worker
   re-downloads the private object within a bounded limit, validates hash and
   magic type, and records an integrity state.
3. No malware provider exists. A hash/type-valid upload remains
   `quarantined_pending_review` and cannot publish until an approver clears it.
   Missing, corrupt, hash-mismatched, unavailable, external-content-changed,
   and provider-unavailable states fail closed and are surfaced to users and
   metrics.
4. Publication computes `max(issued_at + 10 calendar years, support_ends_at)`.
   A missing or out-of-period support fact blocks publication. Support-period
   supersession durably enqueues recalculation; the worker never replaces an
   existing later `availability_until` with an earlier one.
5. Early withdrawal locks the target and approved equivalent replacement,
   requires an equal-or-later published availability window and a reason, then
   writes audit/facts atomically. Download checks authorization and a currently
   retrievable state before it creates a short-lived attachment URL; a later
   withdrawal cannot retroactively revoke an already-issued URL.
6. Approved external references must be HTTPS, credential-free, match a
   deployment host allowlist, remain within a public-network resolver boundary,
   reject unsafe redirects, and are periodically bounded-fetch monitored. Logs
   contain identifiers and hashes, never artifact bytes, signed URLs, or
   assessment narrative.

## API and frontend boundaries

- Runtime schemas and parsed `z.output` types live feature-first in
  `@repo/contracts/products`. Every product controller body, query, and path
  parameter uses those schemas; every successful controller/repository/browser
  response is parsed before use.
- New product routes cover assessment list/detail/create/reassess/review and
  artifact list/detail/reserve/finalize/review/publish/replace/withdraw/
  download. There is deliberately no delete route.
- React Query owns keys and invalidation. Local functional product-detail
  sections render loading, empty, read-only, review-required, flagged,
  quarantine, integrity, availability, replacement, and provider-failure
  states. Existing semantic tokens, labels, roles, alerts, focus behavior, and
  reduced-motion support remain in use.

## Tests and observability

- Begin red with contract and pure-policy tests: all answer combinations,
  human-only authority, override reason, February 29, equality, incomplete
  support, and non-reducing recalculation.
- Cover RPC constraints/RLS/grants/search paths, audit facts, idempotency,
  stale expected versions, tenant 404s, append-only fields, private path shape,
  hash/type failure, stale reservation recovery, replacement/withdrawal race,
  legal-hold cleanup race, export inclusion, and the existing helper's revoked
  `PUBLIC` execute privilege.
- Worker measurements include review backlog, flagged assessments, upload and
  inspection failures, quarantine, hash mismatch, expiring availability,
  missing objects, and blocked cleanup. They expose counts/identifiers, not
  bytes, URLs, or confidential content.
- Browser and live-stack tests use only unique run-scoped records and delete
  only records created by that run. No database reset, existing test-artifact
  deletion, stash mutation, or remote project mutation is part of verification.

## Rollback and recovery

Stop new UI/API commands and workers to halt rollout; the additive schema and
immutable audit/history remain compatible with the previous application. Fix a
schema or policy defect with a forward migration and idempotent recalculation,
never a destructive rollback or shortened window. Restore an object by writing
a new immutable object at a new content key, re-verifying its hash, and auditing
the replacement; never overwrite a retained object. The storage runbook must
use the platform backup/restore process with the BRD's one-hour recovery-point
and four-hour recovery-time targets; local development cannot claim that hosted
backup SLA. Supabase lifecycle deletion is not relied on because it cannot make
the domain retention decision at execution time.

## Review checklist

- [x] The direct mutable-note/upload design was rejected for concrete history,
      authorization, availability, and recovery failures.
- [x] Each introduced pattern has a current trigger and test seam.
- [x] Organization and request identity are never global or browser-authorized.
- [x] Controllers/pages contain no provider access or legal determination.
- [x] Contracts parse all applicable request and successful response boundaries.
- [x] Security-critical state/audit/outbox effects are transactionally durable.
- [x] The rollout is additive, forward-repairable, and compatible with existing
      product/session/permission contracts.
