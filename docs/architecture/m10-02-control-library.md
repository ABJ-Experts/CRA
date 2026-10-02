# M10-02 feature design: control library and version-pinned mappings

## Scope and preserved contracts

- **Outcome:** organization controls with owners, implementation status, exact evidence-version links, and many-to-many mappings to immutable M10-01 requirement versions, with coverage for an explicitly selected product.
- **Included:** control lifecycle, product applicability, transactional commands and audit, reverse M8 evidence projection, authorized API, and operational web UI.
- **Excluded:** legal compliance decisions, AI mappings, M10-03 gap assessments, custom framework editing, and rewriting M7 risk revisions.
- **Preserved:** `/api/v1`, sessions and cookies, ES256/JWKS, frozen auth actions, permission merge order, M7 snapshots and unresolved references, M8 immutable evidence versions, menu/mock contracts, and existing technical-file source ownership.

## Concrete problem and direct design

M10-01 provides stable `{packKey, versionKey, requirementKey}` references but no organization controls. M8 explicitly returns an empty `frameworkControls` reuse array. M7 still stores manual unresolved text. Controls need independent revisions, evidence version pins, and product-scoped mappings so a framework edition change or a newly created product cannot silently change coverage. A mutable control row alone cannot preserve what a historical mapping described; the direct design adds immutable control revisions and narrowly scoped link rows rather than a generic framework engine.

## Selected patterns

| Pattern | Present trigger and participants | Dependency direction and removal trigger |
| --- | --- | --- |
| Adapter with inward port | Supabase RPC result and failure shapes differ from application policy; a control repository adapter translates them. | Controller → use cases/port ← Supabase adapter. Remove the port if the application/provider boundary disappears. |
| Transactional command | Revision checks, idempotent retries, state changes, and audit must succeed or fail together. A scoped SQL function owns the transaction. | Application policy → repository RPC → tables and `audit_logs`. Remove only if a replacement retains the atomic boundary. |
| Immutable revision | Mapping must pin the control wording/status revision from which it was made. | Current control head points to append-only revisions. Remove only if historical revision references are no longer required. |
| Permission-filtered projection | M8 reverse links must reveal only controls visible for the requested product and evidence version. | M8 read consumes control link data; M10 remains the writer. Remove when no reverse consumer exists. |

Rejected: per-framework copies of controls, duplicated evidence objects, a global event bus, dynamic “all products” applicability, and a second M7 mapping store. They would either drift from authoritative data or broaden coverage without review.

## Data and tenant boundaries

- Nest derives actor and organization from the verified session. Callers may name a product only within that organization; the server verifies product, framework, control, evidence version, and permission joins again in SQL because `service_role` bypasses RLS.
- Every mapping product is explicit. A new product is unmapped until reviewed. A control can map to several requirements; a requirement can have several controls. A parent node never inherits a child's mapping.
- An evidence link refers to the exact evidence document version and product. Creation requires a clean version applicable to that product. Expiry, quarantine, holds, archival, or deletion review change availability, not provenance.
- Control archive and link ending preserve historical rows. Owner deactivation leaves the recorded owner and produces a visible gap. Existing M7 revisions are not inferred from or migrated to M10 keys.
- Mutations compare expected revisions, deduplicate by actor/idempotency key and request digest, and write `audit_logs` in the same PostgreSQL transaction. Functions pin `search_path`, revoke `PUBLIC`, grant only service role, and use non-forced RLS with explicit indexes and composite foreign keys.
- Migration order is additive schema/functions → M8 reverse projection → generated types → API/web. The previous binaries continue to see an empty M8 projection until the coordinated contract/API release. Roll back code forward-only; never drop mapped history or reset local data.

## API boundary contracts

- `@repo/contracts/frameworks` owns bounded list/detail/coverage schemas and parsed `z.output` types, reusing the existing stable reference schema. M8 owns the reverse reuse response shape. Every consumed body/query/path and successful JSON response is parsed by Nest; the web gateway provides outgoing `inputSchema` and incoming `schema`.
- `can_view_frameworks` gates control and coverage reads; `can_manage_frameworks` gates writes. Product and evidence details require their existing view permissions. M8 reverse links require both evidence and framework view authorization and are restricted to the requested exact version/product.
- Mappings may be created only against the organization's enabled selected pack version; previously pinned versions remain readable by explicit version key. Duplicate mapping requests are no-ops only for identical content. Changed content with a reused idempotency key is a conflict.
- Invalid input, stale revision, forbidden tenant/product/evidence, missing entity, and provider outage retain distinct response codes. A failed mutation never causes browser auto-replay after refresh.

## Frontend logic and rendering

- Functional React components render the control table/detail, mapping picker, and product-specific coverage inside the existing framework workspace and design system. A typed gateway owns transport. Heavy control detail may be split behind a route-level lazy boundary.
- The view separates implementation status, evidence availability, and mapped/unmapped coverage. It never displays a legal compliance verdict. It renders requirement/evidence text inertly, uses visible focus and textual statuses, and preserves unsaved edits across conflicts, validation errors, and offline retries.
- A disabled framework hides current-workspace mapping actions; authorized historical detail remains accessible by explicit version. Empty, loading, forbidden, expired, and organization-switching states clear stale tenant data without discarding a recoverable local draft.

## Failure modes and tests

- Start with failing contract/policy/SQL/API/component tests. Exercise duplicate commands, mismatched payload digests, concurrent revision writes, interrupted transaction, wrong organization/product, deactivated owner, stale evidence, malicious text, revoked grants, archive/history, renamed labels under a new version, and worker restart.
- Run local Postgres grants/RLS/storage integration, focused API and web tests, browser owner journeys, accessibility and cross-browser checks, database lint/drift, and `pnpm verify`. New/materially changed modules must reach at least 80% branch/function/line/statement coverage. Bounded coverage reads target p95 below 400 ms and p99 below 1000 ms at realistic load.
- Logs distinguish validation, authorization, conflict, and infrastructure failure without tokens or document bytes. Completion evidence lives in a separate verification record with screenshots and reproducible commands.

## Review checklist

- [x] Direct solution and rejected broader stores considered.
- [x] Present triggers, participants, dependency direction, and removal triggers recorded.
- [x] No global actor, organization, product, or session state.
- [x] Shared schemas and successful-response parsing identified for every route.
- [x] Transactional audit, scoped service role, and forward-only rollback defined.
- [ ] Failing tests, 80% coverage, live-stack gates, browser evidence, and independent review recorded after implementation.
