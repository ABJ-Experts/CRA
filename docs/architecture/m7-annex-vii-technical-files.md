# M7 Annex VII technical-file workspace

## Scope and preserved contracts

- User outcome: authorised quality and regulatory users can maintain a
  product-specific Annex VII working file with source-linked sections.
- In scope: the Annex VII V1 template, section narrative, verified internal
  source references, manual bibliographic references, source staleness, and
  the product-scoped workspace.
- Out of scope: M8 evidence attachments, snapshots, exports, declarations,
  AI analysis, and legal-completeness certification. M7-02 owns the
  structured cybersecurity risk register described below.
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

## M7-02 cybersecurity risk register

Each active technical file has one register pinned to `cra_5x5_v1`. Likelihood
and impact are mandatory 1--5 assessments with their own rationales; their
product derives Low (1--4), Medium (5--9), High (10--16), or Critical
(17--25). This is an assessment method, not a compliance score. Each update
creates an immutable revision, preserving the original assessment, mitigations,
residual assessment, actor, rationale, and exact linked-record revisions.

Affected assets are completed-SBOM components reached through an active
release of the same product. Annex I Part I mappings retain manually entered
identifier, edition, and source metadata because M10 has not supplied an
authoritative framework pack; they are visibly unresolved until that authority
exists. Evidence references pin the referenced identifier/version and remain a
compatibility boundary for M7-03/M8 rather than becoming an attachment store.
Changed, archived, missing, or withdrawn linked records make the current risk
review-required without rewriting prior revisions.

Editors may create, revise, and archive records. Residual-risk acceptance is
an explicit owner/admin action with a rationale and its own immutable event;
it is never inferred from a low residual level. Risk deletion is archival only,
so M7-04 snapshots can retain a stable risk/revision reference.

## M7-03 evidence linkage, staleness, and readiness

M7-03 extends the existing section-source relationship rather than creating a
second document store. A link pins an authoritative record revision or
fingerprint, has its own optimistic version, and can be reused by multiple
technical-file sections without copying its source. Existing product, release,
support-period, SBOM, finding, manual-reference, and risk-register evidence
are valid V1 inputs. M8 remains the future authority for attachment document
versions; its reverse-link consumer reads the M7 projection and does not
change M7 readiness semantics.

Applicable sections require their narrative and an allowed, valid pinned
source: general description requires product evidence; support-period basis
requires support-period evidence; vulnerability handling requires a finding or
risk-register source; release SBOM requires SBOM evidence; other sections may
use their allowed source/manual reference. Not-applicable sections are excluded.
The state precedence is stale, then empty, partial, and complete; stale always
wins over otherwise complete documentation. Overall readiness is documentation
readiness only, never legal or compliance certification.

Material changes compare the linked revision/fingerprint, not timestamps:
product/release/support lifecycle and versions, completed SBOM hash/state,
finding/risk revisions, and later M8 document validity/version/quarantine all
make a link stale. A database-side recalculation is synchronous, idempotent,
and recoverable. Before M10 supplies authoritative standards editions, an
editor records an explicit, audited manual-reference material-change signal;
there is no invented standards registry.

Opening a workspace never clears staleness. A technical-file editor records an
append-only retain/update decision with rationale and the reviewed-against
version. Update substitutes only the current authoritative version; retain
keeps the pinned version with its review baseline. Link mutations, stale
reviews, change signals, and recalculations write their audit evidence in the
same transaction. The reverse-link projection is tenant-scoped and returns
relationship metadata only, preventing M8-04 from gaining document access.

## Selected and rejected patterns

- A feature-local application port and Supabase adapter are selected because
  this is a persistent, tenant-scoped workflow with atomic audit requirements.
- Versioned rows and optimistic versions are selected for concurrent editing;
  they are the existing product/reporting consistency mechanism.
- A generic evidence engine, workflow engine, event bus, new role system, or
  duplicate SBOM store is rejected. M8 owns documents and M3 owns SBOM bytes.
- Revision-owned risk link rows are selected over JSON arrays because current
  asset/evidence state must be tenant-scoped and independently verifiable.

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

Risk commands use a dedicated tenant/user/idempotency ledger with an operation
and payload digest. Replays return their original result only for an exact
match; key reuse is a controlled conflict. The same transaction persists the
risk revision, link rows, command result, and audit record.

## API and frontend boundaries

`@repo/contracts/technical-files` owns strict params, body, and response
schemas. Controllers parse inputs and declare responses; web transport supplies
both `inputSchema` and response `schema`. The workspace is a product subroute,
using functional rendering and existing semantic tokens. It provides explicit
empty, stale, conflict, offline, forbidden, and attachment-unavailable states.

`@repo/contracts/risk-registers` owns the M7-02 request, response, and method
schemas. The register appears inside the existing technical-file workspace,
not in global navigation. The interface remains a compact, keyboard-operable
operational register with explicit incomplete, assessed, review-required,
unresolved, withdrawn, archived, and conflict labels.

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
