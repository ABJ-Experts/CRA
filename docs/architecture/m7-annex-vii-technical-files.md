# M7 Annex VII technical-file workspace

## Scope and preserved contracts

- User outcome: authorised quality and regulatory users can maintain a
  product-specific Annex VII working file with source-linked sections.
- In scope: the Annex VII V1 template, section narrative, verified internal
  source references, manual bibliographic references, source staleness, and
  the product-scoped workspace.
- Out of scope: M7-02 risk registers, M8 evidence attachments, snapshots,
  exports, declarations, AI analysis, and legal-completeness certification.
- Preserved: `/api/v1`, existing product/support/SBOM/triage records, SBOM
  storage and downloads, session and permission contracts, and M3 immutability.

## Concrete problem and direct solution

Product data, support records, SBOMs, and triage already have separate
authoritative owners. Retyping them into a technical file would silently
diverge, while an attachment library does not yet exist. The direct solution
is one active file per product, materialised from a versioned Annex VII
template, with section-owned narrative and pinned references to those owners.
The existing retention projection is returned alongside the file, so the
support-period basis shows incomplete facts, the strongest retained protection,
and legal-hold state without creating a second authority.

## Selected and rejected patterns

- A feature-local application port and Supabase adapter are selected because
  this is a persistent, tenant-scoped workflow with atomic audit requirements.
- Versioned rows and optimistic versions are selected for concurrent editing;
  they are the existing product/reporting consistency mechanism.
- A generic evidence engine, workflow engine, event bus, new role system, or
  duplicate SBOM store is rejected. M8 owns documents and M3 owns SBOM bytes.

## Data and tenant boundaries

The authenticated guard supplies organisation and actor identity. Each command
is organisation-first and validates the product, section, release, support
period, SBOM, and assessment references in that organisation. A partial unique
index prevents two active files for one product. File creation is idempotent;
section edits and source-link mutations require the current version.
Mutation replays are durably keyed through their transactionally written audit
records and reject a key reused with a different payload.

Every mutation RPC writes the technical-file change and `audit_logs` entry in
one transaction. Links pin observed source versions/revisions; changed,
archived, missing, or inaccessible sources are shown as stale rather than
rewritten. The migration is additive; deploy it before API/web and roll API/web
back before removing no schema, because no destructive schema change exists.

## API and frontend boundaries

`@repo/contracts/technical-files` owns strict params, body, and response
schemas. Controllers parse inputs and declare responses; web transport supplies
both `inputSchema` and response `schema`. The workspace is a product subroute,
using functional rendering and existing semantic tokens. It provides explicit
empty, stale, conflict, offline, forbidden, and attachment-unavailable states.

## Failure modes and rollback

Cross-tenant, revoked, malformed, stale, archived, missing, or forbidden
references fail closed. Provider/database outages return unavailable without
discarding editor state; writes are never automatically replayed. A duplicate
creation returns the existing active file. Reverting API/web leaves the
additive rows unread but does not alter product, support, SBOM, or triage data.

## Tests and observability

Tests cover template identifiers, completeness/staleness policy, internal and
manual references, idempotency, optimistic conflicts, transactionally durable
audits, RLS, permission separation, and the product-to-editor browser journey.
Audit actions identify file/section/link mutations but never store narrative or
source-content bodies.
