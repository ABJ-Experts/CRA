# M8-05 evidence retention, reviewed deletion, and legal holds

## Scope and preserved contracts

- **User outcome:** an authorized evidence manager can understand why an
  evidence document is protected, request a reviewed deletion only when it is
  eligible, and place or release a documented legal hold. A hold applies to
  the logical document and therefore to every immutable version and derivative.
- **In scope:** product-retention inheritance, durable protection projections,
  document-scoped holds, reviewed deletion intents, private-object cleanup,
  access revocation, retryable cleanup, and compact Evidence Library states.
- **Out of scope:** automatic purge, retention shortening, legal advice,
  rewriting retained originals for pseudonymisation, bulk/tenant purge, M10
  framework integration, and a separate identity-erasure workflow.
- **Preserved:** M2 owns date arithmetic and its retention result; M3 SBOM
  storage and M8 immutable version/upload/download contracts remain unchanged.
  `/api/v1`, ES256/JWKS verification, narrow refresh-cookie path, frozen auth
  actions, permission merge order, menu configuration, existing evidence
  access grants, and M7 version-pinned source semantics remain unchanged.

## Concrete problem and direct solution

An evidence document has a logical identity, while each version has immutable
product applicability and private bytes. Product retention can change after a
version is uploaded, a document can have several linked products with different
periods, and M7 may retain a particular historical version. A boolean
`deleted_at`, a UI-only confirmation, or a mutable version row cannot represent
those facts, compose multiple holds, survive a worker restart, or make storage
deletion safe against a newly placed hold.

The direct solution is one document-level block check before deleting its
current object. It fails because it misses older versions, M7 references,
incomplete product data, replacement races, and object/database partial
failures. M8-05 instead adds a narrow retention/deletion policy backed by
transactional Supabase RPCs. It consumes
`ProductRetentionProjectionPort`; it does not copy M2's calendar logic or
interpret a `null`/incomplete result as permission.

## Selected and rejected patterns

- **Facade with focused use cases.** The concrete trigger is a small group of
  read, hold, deletion-intent, and cleanup commands which share tenant scope,
  projection reconciliation, idempotency, and durable audit facts. The evidence
  controller calls a focused retention/deletion facade; it does not coordinate
  products, storage, and audit itself. Remove the facade if the surface reduces
  to one synchronous operation.
- **Adapter and inward-owned ports.** The application owns a retention/deletion
  repository port and consumes `ProductRetentionProjectionPort`; the Supabase
  repository/RPC adapter and private evidence storage adapter implement the
  boundaries. This exists because product projection, transactional records,
  and object deletion have different failure and lifecycle semantics. Remove a
  port only if that authority becomes transactionally owned by the feature.
- **Persisted state plus durable command records.** Deletion has meaningful
  `active`, `queued`, `claimed`, `cleanup_failed`, and `deleted` states, while
  exact replay and worker restart are required. The document lifecycle, intent,
  cleanup attempt, expected current version, review fingerprint, lease, and
  idempotency digest are stored and transition atomically. This is a focused
  state policy, not a generic workflow engine or command bus.
- **Immutable protection merge policy.** A pure policy merges port outputs into
  a durable per-version protection snapshot: any incomplete/unavailable source
  blocks deletion, legal hold composes by OR, and the greatest known protection
  date is never reduced by unlink, source correction, owner removal, metadata
  expiry, or product archival. It contains no date arithmetic; M2 owns that.
  Remove the policy only if evidence no longer inherits product protection.

Rejected: a new role/custom-role model duplicates existing permission machinery;
a generic event bus makes hold and deletion ordering eventual; a client state
machine cannot secure transitions; direct controller/page Supabase calls bypass
the feature boundary; and a physical `DELETE` of document/version rows destroys
the audit and reference evidence needed to prove why cleanup happened.

This record applies the existing [pattern selection matrix](pattern-selection-matrix.md)
and [ADR-0001](adrs/ADR-0001-pattern-selection.md): only Facade, Adapter,
State, and focused Command records have present-tense triggers.

## Data, tenant, and transaction boundaries

- Keep `evidence_documents` as the logical identity and
  `evidence_document_versions` immutable. Add a document lifecycle field and
  additive, service-only/RLS-enabled rows for per-version retention protection,
  document legal holds, deletion intents, and object cleanup attempts. Every
  foreign key remains organization-scoped and restricts removal; every new
  function pins `search_path`, revokes `PUBLIC`, and grants only `service_role`.
- Protection rows record the associated version, linked product projection
  identity/status, maximum known `retentionUntil` and
  `retentionProtectionUntil`, hold state, reconciliation time, and a safe
  unavailable/incomplete reason. They preserve the strongest previously known
  floor. An additive backfill creates protection rows only; it does not queue
  or delete evidence.
- Reconciliation evaluates **all** original version-product links, including
  archived products, through `ProductRetentionProjectionPort`. A product
  retention update marks affected snapshots stale without reducing their stored
  protection. A review, confirmation, claim, and final cleanup check reconcile
  stale state before deciding; unresolved projection state is `blocked_unknown`.
  This prevents source correction/unlink/last-link attacks from creating an
  eligible document.
- A legal hold row belongs to the document, has required placement reason,
  placement actor/time, and optional release reason/actor/time. More than one
  active hold composes; releasing one never clears another hold or statutory
  protection. Placement after an intent is allowed only before cleanup claim:
  the same lock cancels/blocks the intent and writes its audit row. Once cleanup
  is claimed, hold placement returns a stable conflict and audit fact rather
  than pretending that a concurrent physical delete was prevented.
- Every service-role command receives `organization_id` first and verifies
  active actor membership and existing `can_view_evidence` or
  `can_manage_evidence` permission inside its query. Product, document,
  version, hold, intent, M7 source, access-grant, and storage-key selection are
  constrained to that organization. Cross-tenant identifiers return the
  established safe not-found/forbidden outcome.
- Review and intent creation lock the document, current and historical
  versions, protection rows, holds, product links, M7 technical-file/snapshot/
  declaration references, and access grants. The intent carries the reviewed
  current-version ID and a deterministic review fingerprint; changed state is a
  conflict, never a silent replay. The same transaction revokes grants,
  persists the lifecycle/intent, and inserts an `audit_logs` row. Existing
  fire-and-forget `AuditService.log` remains untouched but is not authoritative
  for these effects.
- The cleanup worker claims one durable intent by lease, rechecks protection and
  references in an atomic RPC, then removes only recorded private object keys.
  A missing object is a completed idempotent deletion. An object failure leaves
  the document inaccessible, records a safe retryable failure, and never
  restores a grant or public access. A final completion RPC records each object
  outcome and terminal state with audit evidence. No cleanup path deletes
  retained bytes or invokes M1 tenant lifecycle purge as a bypass.

## API and frontend boundaries

- `@repo/contracts/evidence/{schemas,types}` owns strict params, query, body,
  and success schemas for protection review, deletion confirmation/result,
  hold list/place/release, and cleanup status. Trusted types are
  `z.output<typeof schema>`; inputs are parsed before use. Unknown fields,
  blank reasons, malformed UUIDs, stale review fingerprints, and altered
  idempotency-key replays fail closed.
- Routes remain under `/api/v1`: a `can_view_evidence` protection review and
  `can_manage_evidence` deletion/hold mutations. Controllers use the existing
  Zod parameter/body/query pipes and successful response parsing. The evidence
  gateway sends `inputSchema` and response `schema` for every call; its mutation
  requests are explicitly user retried and are never replayed by refresh logic.
- Blockers name a controlling product/obligation/date only after the server has
  checked that the caller may see it. An otherwise valid hidden reference is
  represented as a generic protected-reference blocker. Extracted/OCR content
  and original document content are untrusted display text and never become
  explanation HTML.
- Functional Evidence Library components use existing compact table/panel
  patterns, semantic tokens, `cn()`, shared UI subpath imports, keyboard focus,
  screen-reader status, and non-colour state labels. They show protected,
  hold, eligible-for-review, queued/claimed, retryable failure, and deleted
  states. A required reason plus explicit confirmation enables deletion only
  after an eligible server review. Hold forms require placement/release reasons.
  Recoverable validation, conflict, offline, forbidden, and retry responses
  preserve entered form data; browser state never authorizes an action.
- Retained originals are not rewritten when an owner/user is pseudonymised.
  Review responses flag an identity/legal-review requirement and, where a
  policy later permits it, a separately created redacted derivative. They never
  claim that pseudonymising a user row erased a name or signature embedded in
  the original evidence bytes.

## Failure modes, tests, and observability

| Failure or edge case                                                                                      | Required result                                                                                                             |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Missing, null, stale, malformed, or incomplete M2 projection                                              | Fail closed as protected/unknown; retain the greatest stored protection.                                                    |
| Several products, leap-day support calculation, extension, archived product, unlink, or last link removal | Use M2 projection per original link and merge its output; never recalculate dates locally or shorten historical protection. |
| Active hold, multiple holds, or release of one hold                                                       | Block deletion until every hold is released; a release never overrides statutory retention.                                 |
| Historical version, derivative, technical-file/snapshot/declaration reference                             | Block the whole document and retain the immutable referenced version.                                                       |
| Stale confirmation, replacement, concurrent link/projection/hold change                                   | Lock and compare fingerprint/current version; return stable conflict or blocked result without losing form data.            |
| Duplicate command, worker restart, missing object, storage/DB partial failure                             | Idempotent replay/lease protocol; record safe attempt outcome; retry only inaccessible, unprotected objects.                |
| Revoked membership/permission, cross-tenant ID, hidden reference                                          | Deny before selecting names/counts/keys; return generic safe outcome.                                                       |

Start with failing characterization tests for M2 projection semantics,
immutable M8 versions/access grants, M7 version-pinned source links, and
permission coverage. Add strict Zod contract tests, merge-policy tests, API/
repository tests, and live Supabase SQL tests for RLS, grants, pinned search
paths, constraints, audit atomicity, idempotency, backfill, rollback safety,
and concurrent hold/deletion ordering. Browser tests cover manager versus
viewer, named versus hidden blockers, multi-product maxima, old-version and
snapshot blocks, confirmation retry, hold composition, accessibility, and
offline/conflict form preservation. Run focused tests, `pnpm verify`, relevant
live/RLS suites, API auth tests, and the browser accessibility flow against
uniquely named local fixtures only.

Operational logs and metrics record safe operation/state/lease/retry/failure
categories and audit correlation IDs, never reasons beyond authorized audit
storage, raw document content, OCR text, object keys, signed URLs, tokens, or
unnecessary user data.

## Deployment and rollback

Use expand/deploy/contract sequencing: deploy the additive migration and
CLI-generated types first, then API/worker, then the web controls. The prior
application ignores the new fields/tables, while the additive backfill creates
only protection facts. Do not enable automatic cleanup as part of migration.

To halt a release, stop new routes and cleanup-worker claims, leaving document
records, hold/audit/intent history, and private bytes retained and inaccessible
where a deletion was already queued. Rollback never deletes evidence, audit,
hold, or protection records and never reopens access grants. Correct a policy
or schema defect through a later additive migration/reconciliation; it must not
shorten an established protection date.

## Review checklist

- [x] A direct document delete was rejected for concrete historical-reference,
      concurrency, and partial-side-effect gaps.
- [x] Selected patterns have current triggers, contracts, and removal triggers.
- [x] M2 remains the sole retention-date calculation authority.
- [x] Controllers/pages do not query Supabase or decide tenancy/authorization.
- [x] Critical lifecycle, grant revocation, intent, and audit facts are
      transactionally durable.
- [x] Every input and successful response has a shared Zod parsing boundary.
- [x] Hold and deletion use existing evidence-management permissions.
- [x] Migration/backfill and rollback are additive and cannot mass-delete data.
- [ ] Focused coverage, live-stack/RLS checks, and browser evidence are
      completed with the implementation.
