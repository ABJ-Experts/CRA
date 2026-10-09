# M10-01 feature design: versioned CRA framework packs

## Scope and preserved contracts

- **Outcome:** load a reviewed, immutable English CRA Annex I Parts I and II pack; let an organization explicitly select a version; expose a bounded requirement tree.
- **Included:** source provenance, stable reference keys, atomic deployment import, scoped selection, transactional audit, authorized catalog and tree reads, and an operational workspace.
- **Excluded:** legal advice, remote content fetching, organization upload, custom framework editing, automatic crosswalks, M10-02/03 assessments, and later M10 milestones.
- **Preserved:** `/api/v1`, HttpOnly access/refresh cookies, ES256/JWKS verification, the eight frozen auth actions, permission merge order, mock API namespace, menu contract, M7 unresolved manual references and snapshots, and M8 immutable evidence and empty framework links. No existing assessment changes when a selection changes.

## Concrete problem and direct design

M7's `technical_file_risk_revision_requirements` stores manually entered Annex I display references with unresolved status. M8's framework-control links are intentionally empty. Display headings can change across editions, so neither text nor heading can be the future mapping key. A direct organization-level JSON blob would duplicate legal text, permit silent edits, and make same-version content conflicts difficult to detect. M10-01 instead stores a global immutable version and requirement rows plus a single organization selection. Its `{packKey, versionKey, requirementKey}` contract is available to later M7/M8 work without changing either existing flow now.

## Selected patterns and dependency direction

| Pattern | Present trigger and participants | Boundary and removal trigger |
| --- | --- | --- |
| Adapter with inward port | Supabase/PostgREST and its RPC error shapes differ from the framework use case contract. The API application owns a repository port; the Supabase adapter implements it. | Controller → use case/port ← adapter → Supabase. Remove the port if application policy and provider mapping disappear. |
| Feature facade | Catalog, tree, and selection are one framework capability for the controller and the typed web gateway. | The facade contains no provider query or tenant policy. Split it if the methods acquire unrelated lifecycles. |
| Bounded tree traversal | Annex I has parent-child nodes and ordered presentation, with explicit maximum depth and page size. | Flat rows carry stable parent keys; the web renders them as a tree. Remove traversal logic if content becomes flat. |
| Transactional command | Selection must be idempotent, revision checked, and audited atomically. A scoped database function owns the write transaction. | No global command bus or asynchronous audit is introduced. Remove the function only if a replacement preserves one atomic boundary. |

Rejected: per-organization copies of requirements, an import-run table, a generic event bus, mutable remote legal content, an editor state machine, and a second framework store. None is needed for the present requirements; each would add extra synchronization or authority paths.

## Data and tenant boundaries

- The Nest auth guard verifies the session. Controller permission metadata requires `can_view_frameworks` for reads and both `can_view_frameworks` and `can_manage_frameworks` for selection. Organization identity comes from the verified request context, never from a browser-supplied organization ID.
- Global pack versions and requirements are immutable. Tenant-specific selection reads filter by organization ID. The selection RPC receives the verified organization and actor IDs, checks current membership/authorization, compares `expectedRevision`, and writes selection plus `audit_logs` in one transaction. Every retry carries the same idempotency key.
- A selection holds one version per `(organizationId, packKey)`, enabled state, revision, and actor. Disabling changes presentation only. Old versions, requirements, mappings, and audit records remain.
- The migration is additive: deploy schema, reviewed pack, function corrections and tenant export registration in timestamp order; regenerate both SQL type copies through the CLI, then deploy API and web. Existing binaries ignore the new tables. Rollback is forward-only: restore prior application binaries or issue a corrective migration. Never delete historical pack rows or reset the database.

## API and browser contracts

`@repo/contracts/frameworks` owns the schema-versioned import payload, stable requirement reference, catalog, tree parameters/query/response, and selection parameters/body/response. Trusted types derive with `z.output`. Nest parses path, query, body, and successful response through the shared schemas. The browser gateway supplies `inputSchema` for outgoing mutation bodies and `schema` for every incoming success body. Unknown schema versions, malformed hierarchy, and malicious markup fail before import. Requirement text is rendered as inert text.

The read API paginates requirements with a bounded limit and stable order. Historical versions remain addressable by explicit keys. Cursor validation rejects malformed offsets. HTTP conflict is distinct from forbidden, validation, and unavailable states; the workspace retains the pending choice after a failed selection.

## Frontend rendering and failure modes

The `/frameworks` page is a functional React view behind the existing middleware, menu, and permission conventions. A focused `.ts` gateway owns injected transport; React components own only view state. The view uses existing semantic tokens, shared UI subpaths, visible focus, keyboard-operable controls, textual status, source attribution, locale dates, and safe plain-text requirement rendering.

| Failure | Required behavior |
| --- | --- |
| Invalid or altered import | Reject the entire transaction; no selectable partial pack. |
| Duplicate import | Identical digest returns the existing version; changed content with the same keys fails. |
| Concurrent or repeated selection | Revision conflict or idempotent replay; never a partial selection without audit. |
| Missing membership or permission | Deny before querying tenant state or mutating it. |
| Network/provider outage | Report unavailable, allow retry, retain a pending choice; never infer sign-out or compliance. |
| JWKS/session expiry | Existing auth refresh and revocation paths apply; do not replay a state-changing request automatically. |
| Untrusted legal text | Persist reviewed exact text, render as inert text, never execute markup. |

## Verification and observability

The first tests cover invalid pack trees and selection policy before implementation. Contract tests cover duplicate IDs/orders, parent existence, cycles, depth/size/schema bounds, and stable keys despite renamed display text. SQL integration covers import rollback/idempotency/conflict, immutable rows, selection concurrency, audit durability, grants and RLS. API and browser tests cover permission, tenant switching, validation, errors, pagination, and disabled presentation. Run focused coverage (at least 80% for new/materially changed modules), database lint/drift, live stack tests, `pnpm verify`, and an owner browser journey with screenshots. Distinguish invalid input, denied access, and provider failure in returned errors and logs without exposing tokens or legal/user data.

## Source reconciliation

The payload in `20260924055237_m10_01_cra_annex_i_oj_2024.sql` was compared node by node with the English [Official Journal PDF](https://op.europa.eu/o/opportal-service/download-handler?format=PDF&identifier=21b7d4eb-a6e2-11ef-85f0-01aa75ed71a1&language=en&productionSystem=cellar), Annex I pp. 68–69, after normalizing PDF line wraps to spaces. The reviewed PDF SHA-256 is `e3ecaabddf6e321fa04097d15dfcccc7309d0fe5896240ab7625a27d74ab1b0a`. The 25 node texts and hierarchy matched; generated human-readable identifiers and headings are presentation labels, while `text` preserves the published wording. The [EU legal notice](https://european-union.europa.eu/legal-notice_en) and [EUR-Lex reuse conditions](https://eur-lex.europa.eu/content/help/data-reuse/reuse-contents-eurlex-details.html?locale=en) were checked. No exception appeared on the reviewed Annex pages; this record is not a legal opinion.

## Review checklist

- [x] Direct organization JSON design considered.
- [x] Present triggers and contract boundaries documented.
- [x] No global request, user, tenant, or session state in the design.
- [x] Controller/page thinness and layer direction verified in final diff and architecture gate.
- [x] Shared request and successful response parsing verified in focused tests.
- [x] Transactional audit, idempotency, and concurrency verified against local PostgreSQL.
- [ ] Focused coverage, compatibility, live stack, and browser gates recorded; see the verification record for remaining baseline and coverage results.
