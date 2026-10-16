# M9-02 — Scoped supplier evidence portal

## Scope and preserved contracts

- User outcome: an authorized internal operator can issue a reviewable,
  product-scoped evidence checklist to one supplier contact; the recipient can
  upload only requested evidence through a revocable, expiring portal session.
- In scope: immutable disclosure revisions, 7-day invitations, 30-minute
  sessions, private M8 evidence intake, scanned-state receipts, and internal
  request issue/reissue/revoke/close controls.
- Out of scope: reminders, supplier membership, automatic acceptance, review
  decisions, AI extraction, portal search, public sharing, and M3 supplier-SBOM
  contract changes.
- Preserved: `/api/v1`, session/cookie paths, M3 opaque supplier-SBOM portal,
  M8 immutable versions/retention/scan controls, current permission merge
  order, and direct service-role table denial.

## Concrete problem and selected design

M3's `sbom_supplier_requests` can authorize a single component-scoped SBOM
source only. It has neither an approved disclosure snapshot nor evidence item
checklists, independent due dates, recipient contacts, or M8 evidence records.
Adding nullable general-evidence columns would create a polymorphic public
boundary whose response and storage rules could accidentally disclose product
or SBOM context.

- **Feature facade and repository adapter:** `SupplierEvidenceUseCases` owns
  the internal/public workflow; an inward-owned Supabase repository calls
  organization-first transactional RPCs. The trigger is the existing
  provider/tenant boundary and not a generic repository framework.
- **Immutable revision snapshot:** every portal grant pins one request revision
  and its ordered items. The trigger is a real requirement to preserve the
  content an issued recipient saw after an owner changes dates or instructions.
- **Database transaction plus scan-state trigger:** request/grant/submission
  mutations and audit facts commit together; an M8 evidence-state update moves
  a linked submission to pending-review or safe rejection. The trigger is the
  security requirement that an unscanned object cannot become accepted.

Rejected: a generic workflow bus, shared polymorphic invitation table, generic
portal authentication provider, in-process audit observer, and reuse of the
M3 SBOM tables. Each would obscure the disclosure and storage boundary without
an existing second implementation requiring it.

## Data, tenant, and API boundaries

- Internal calls receive verified organization/actor identity. Every
  service-role query accepts `organization_id` first and filters it explicitly.
  Public calls derive organization, supplier, product, revision, and item scope
  only from a SHA-256-hashed invitation/session bearer.
- A request requires an active M9 supplier/contact with an email, active
  product, active internal owner, and one or more ordered items. Product names,
  findings, supplier metadata, and organization data are absent from the public
  projection unless explicitly represented in the immutable disclosure text.
- The raw invite is delivered once, stored only as a hash, and never placed in
  a server-visible URL. `/supplier-evidence#<token>` exchanges it and replaces
  the fragment; the resulting session stays only in tab session storage.
- A new external M8 reservation/finalization path creates a private evidence
  document/version with the request's product. Its internal owner is a
  workflow custodian, while `supplier_evidence_submissions` is the truthful
  external-source record. M8 scan, retention, holds, and lifecycle remain the
  authority.

## Failure behavior

| Condition | Stable outcome |
| --- | --- |
| Expired, revoked, guessed, or sibling bearer | Generic unavailable portal state; no scope disclosure. |
| Changed form after preview | Issue/revision rejects the stale fingerprint; draft remains in the browser. |
| Contact update | Existing grant remains pinned; explicit reissue creates a new grant and revokes active old ones. |
| Close/revoke during upload | Reservation/finalization rechecks locked state and returns conflict; bytes stay private. |
| Missing, type-mismatched, hash-mismatched, or scanner-unavailable object | M8 marks the version failed/pending; no acceptance is created. |
| Quarantined/failed scan | Supplier sees a bounded safe rejection reason, never engine internals or internal notes. |
| Email failure | Grant/audit state remains durable; operator explicitly revokes/reissues rather than replaying a bearer. |

## Tests, rollout, and rollback

Write contract and policy failures first, then application/controller/repository
tests, live PostgreSQL RLS/grant/transaction tests, and local browser flows.
Cover cross-tenant identifiers, product permission denial, disclosure redaction,
idempotency mismatch/replay, revision pinning, expiry/revoke races, direct
storage failure, scan quarantine, and retention linkage. New or changed modules
require at least 80% coverage.

Deploy the additive migration and CLI-generated types before API, then web.
Rollback disables only M9-02 routes/components; it retains all requests,
revisions, grants, submissions, evidence, and audit records. No rollback path
deletes storage or alters M3.

## Review checklist

- [x] The direct M3-table extension was considered and rejected for concrete
      disclosure and storage incompatibility.
- [x] Selected patterns have present-tense triggers and bounded contracts.
- [x] No portal request trusts caller organization, product, or supplier scope.
- [x] Controllers/pages remain free of direct Supabase calls and domain policy.
- [x] Cross-application bodies, parameters, and successful responses are Zod
      parsed and trusted types derive from `z.output`.
- [x] Critical mutations and audit facts share database transactions.
- [x] Additive deploy, rollback, local-live verification, and no-production
      data rules are recorded.
