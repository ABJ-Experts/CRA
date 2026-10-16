# M9-06 — Supplier SBOM portal integration

## Scope and preserved contracts

- User outcome: a supplier can upload an SBOM for one explicitly assigned M3 request from the existing M9 portal; an internal reviewer makes the separate M3 acceptance decision.
- In scope: M9 checklist assignment, one-link scoped grant, safe processing projection, exact requested-component gate, and supplier-deduplication provenance repair.
- Out of scope: a second parser, matcher, storage system, supplier identity provider, automatic baseline replacement, or vulnerability disclosure to suppliers.
- Preserved: `/api/v1`, ES256/JWKS sessions, M3 direct invitation/upload/review routes and wire shapes, M8 evidence versions, M7 snapshots, M9 ordinary evidence items, and existing permission merge order.

## Concrete problem

M3 already stores `sbom_supplier_requests`, invitations, submissions, immutable sources, normalized documents, jobs, and composite provenance. M9's portal only handles evidence-document classes, and its bearer cannot reach an M3 request. A second SBOM upload pipeline would duplicate validation and create a second source of truth. The direct solution adds a nullable item-to-M3-request link and a linked M3 invitation per issued M9 item, then reuses M3 upload and review services.

## Why not simpler?

Directly exposing the existing M3 invitation in M9 disclosure would require a second supplier-facing token and would not bind an upload to the specific M9 checklist item or revocation lifecycle. Reusing M9's evidence upload would bypass M3 format validation, normalization, source lineage, and review. The narrow grant bridge is the minimum change that preserves both existing workflows.

## Selected patterns

- Scoped grant bridge. Trigger: two existing, independently scoped invitation systems need one supplier-facing link. Participants: M9 item/session, linked M3 invitation, activation RPC, and existing M3 use cases. Direction: portal controller → M9 application policy/port → scoped SQL adapter, then M3 application facade. Contract: an exact current item/session authorizes only its linked M3 request. Remove the bridge if the M9 portal no longer carries SBOM items.
- Existing M3 intake. Trigger: M3 already owns byte validation, private storage, jobs, parser, normalization, review, and immutable source lineage. Participants: M9 controller/use case and `SupplierSbomService`. Direction: M9 delegates after grant activation; M3 remains the sole intake authority. Contract: M3 upload/review response shapes remain unchanged. Remove only if M3 intake itself is retired.
- Transactional SQL functions. Trigger: issue, revoke, upload authorization, and audit must survive process failure and concurrent changes. Participants: M9/M3 row locks, scoped functions, audit inserts. Contract: linked grants cannot outlive the current M9 revision or invitation. No new command/event bus is introduced.

## Rejected patterns

A second supplier account system, raw M3 token in an M9 email, client-supplied release/component IDs, a generic workflow bus, and a parallel SBOM evidence table each expand authority or duplicate current behavior.

## Data and tenant boundaries

- Internal identity comes from Nest's verified user and organization. Linking requires M9 request permissions plus `can_review_sboms`; every service-role read is organization-first and product/supplier scoped.
- An SBOM item points to one immutable M3 request. Its supplier, product, release, component reference, and expiry are checked before issue and again at use. A linked M3 invitation points to the exact M9 invitation/item. The browser supplies only the M9 session, assigned item, file metadata, and idempotency key.
- The API derives a per-item M3 bearer using HMAC-SHA256 keyed by the short-lived M9 session; only its hash is persisted. Every M3 reservation/completion rechecks the current M9 grant under lock. Revocation and reissue expire linked M3 sessions synchronously.
- Distinct suppliers submitting equal bytes retain distinct `sbom_sources` and `sbom_supplier_submissions` even when they share a normalized document. Composite inputs may use only explicitly accepted source IDs and preserve the corresponding supplier submission ID.
- Existing retention, legal holds, and immutable evidence remain authoritative. The additive migration has no destructive backfill.
- Service-role SQL is reached only through the organization-scoped internal lookup or a validated opaque portal grant. The internal lookup filters organization, supplier, product, release, and permitted component; item creation/issue lock the M9 request and validate the M3 link. Public activation and M3 reserve/finalize lock and recheck the current M9 invitation/revision. Idempotency keys and optimistic request versions retain the existing M3/M9 concurrency contracts.
- Deploy sequence is additive migration and CLI-generated types, API/worker, then web. The previous API can still operate on legacy evidence and M3 requests after the migration; no data down-migration is planned.

## API boundary contracts

- Feature-first `@repo/contracts/supplier-evidence` schemas add an explicit `sbom` checklist item, eligible-request query/result, parsed portal upload body/path parameters, safe results, and per-item status. Parsed wire types are `z.output` in its `types/` folder. Legacy evidence inputs default to evidence; unsupported fields fail strict parsing.
- Thin Nest controllers use `zodBody`, `zodQuery`, `zodParams`, and `@ZodResponse` for every new JSON route. The public allowlist names only the two new item-scoped upload routes; they require the M9 bearer and are rate limited. Authorization failures disclose no tenant/product data.
- The web gateway supplies both outgoing `inputSchema` and incoming `schema`; the UI never accesses Supabase directly. M3 direct route and response contracts do not change.

## Frontend logic and rendering

- Functional request/review/portal components retain the existing M9 operational layout. The heavy supplier SBOM item is dynamically imported only for an SBOM checklist item.
- The existing API transport and query layer own network lifecycle; no new class or singleton is needed. Pure selection/status decisions remain immutable functions in the feature module. The feature's API factory and rendered component tests are the transport/render test seams.
- One primary action submits the selected file. Component reference, format/size guidance, processing, validation, retry, and revoked-session states use text labels and keyboard-operable controls. The M3 reviewer remains the only acceptance authority.

## Failure modes

- Invalid/expired/revoked/sibling grants and stale revisions fail closed with a generic unavailable item. Removed reviewer permission blocks new internal assignments/review; a supplier bearer never grants reviewer authority. Duplicate init/finalize uses M3 idempotency; concurrent revoke serializes with upload authorization.
- Wrong-component normalization remains an immutable source but fails validation before M3 review. Malformed format/unsupported version uses M3 validation, with supplier-safe guidance. Job restart uses M3 lease/retry; storage, database, and network outages leave a retryable state and do not accept a baseline. Missing JWKS prevents internal authorization; SMTP failure preserves delivery status and does not create a new public auth bypass.
- Browser cancellation or offline transition preserves recoverable selected-file state. The UI does not automatically replay POST after refresh.

## Tests and observability

- Failing characterization tests first pinned the missing portal routes, schema acceptance/rejection, and linked grant behavior. Contract, API policy/adapter/controller, SQL authorization/RLS, worker/dedup/provenance, browser, permission-revocation, and keyboard tests cover the bridge. New/materially changed modules target at least 80% coverage.
- Server errors distinguish invalid request, conflict, denied grant, and infrastructure outage without logging bearer tokens or raw supplier document content. M3 jobs, source/submission state, and M9 audit records provide durable operational evidence. Full verification and screenshots are recorded separately after the live run.

## Rollback

Disable the M9 SBOM selector/panel and two new public routes, then roll back API integration while leaving additive database columns, grants, immutable sources, decisions, and audit facts intact. Existing M3 direct intake and M9 evidence routes continue. Repair any database defect with a forward migration rather than deleting regulatory evidence.

## Review checklist

- [x] Direct reuse was chosen before introducing a new abstraction.
- [x] All public operations have exact item/session scope and no caller product IDs.
- [x] Security-critical transitions and audit use database transactions.
- [x] Cross-application request/response contracts live under the owning feature.
- [x] No tenant, session, or request state is global.
- [x] Controllers and pages have no direct provider query.
- [x] JSON boundaries are schema parsed; rendering components stay functional.
- [x] Focused coverage, live-stack tests, browser screenshots, and full verification are recorded in [M9-06 verification](./m9-06-verification.md), including unrelated baseline failures and release gates.
