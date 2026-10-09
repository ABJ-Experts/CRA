# M10-04 curated crosswalks and reviewed framework upgrades

## Scope and preserved contracts

- **Outcome:** an authorized reviewer can compare immutable pack versions, review each affected control mapping, and atomically select a new version. Curated crosswalks expose possible evidence reuse without creating mappings or compliance claims.
- **Included:** version-specific curated relations, rights-aware pack metadata, bounded diff and impact reads, durable review decisions, optimistic concurrency, idempotent commit, and transactional audit.
- **Excluded:** AI mapping, customer pack authoring, unlicensed standard text, automatic equivalence, duplicate evidence storage, and historical M7 snapshot rewrites.
- **Preserved:** `/api/v1`, API-owned cookies, ES256/JWKS, frozen auth actions, permission merge order, existing same-version selection behavior, M8 evidence versions and retention, M7 snapshots, menu/mock namespace, and product-scoped M10 coverage semantics.

## Concrete problem and direct solution

`framework_requirements` stores immutable exact pack/version keys, but the M10-01 selection endpoint can choose a different version without reviewing M10-02 control mappings. M10-02 mappings remain tied to the old version; M10-03 coverage is computed for exact selected versions and products. The M8 evidence reuse projection only lists direct control mappings. A direct version switch would therefore leave mappings behind with no explicit migration decision. A direct crosswalk join into coverage would mistake a curated relationship for a verified control mapping.

The direct extension keeps existing pack, control, and evidence rows authoritative. One curated relation table records reviewed source/target references. A pack diff is computed from immutable versions. A durable tenant review holds mapping decisions and a single scoped SQL transaction commits the mapping changes, selection, invalidation, idempotency result, and audit fact.

## Selected patterns and rejected alternatives

| Pattern                           | Present trigger and participants                                                                                                       | Boundary and removal trigger                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Inward port with Supabase adapter | SQL RPC outcomes and tenant checks must be translated into framework use-case errors. Controller → use case/port ← adapter → Supabase. | Remove only if the provider boundary disappears.                             |
| Durable review aggregate          | A reviewer may page through many mappings and recover an unfinished review. Review and decision rows are tenant scoped.                | Remove if all mapped controls can safely be reviewed in one bounded request. |
| Transactional command             | A selection, mapping revisions, coverage invalidation, and audit must commit together under concurrent editors.                        | Replace only with another transactionally equivalent boundary.               |

Rejected: copied evidence bytes, inferred text similarity, automatic crosswalk-to-coverage promotion, generic event bus, parallel framework store, mutable pack content, browser-only review state, and a per-standard schema. Each adds a second authority or cannot preserve the required failure behavior.

## Data, rights, and tenant boundaries

- Nest obtains actor and organization from verified session identity. Runtime reads filter tenant rows by organization; product/evidence views also check exact product and evidence scopes. The service-role client never takes tenant identity from a query or request body.
- Pack import remains deployment-only. CRA legal-source metadata remains valid; proprietary imports require precise edition, rights reference, and review owner before selection. No IEC/ISO normative text or production crosswalk rows ship until those records and content approval exist. Test fixtures are local-only.
- Curated relations reference immutable source and target requirement triples. Strength and direction are displayed but do not grant coverage. Retiring a relation preserves its provenance and audit history.
- The review compares selection revision, source/target content hashes, and current control/mapping state. The commit takes the existing organization/pack lock; a stale review returns conflict before writes. Retry with the same idempotency key returns the committed result; reuse with different input fails.
- The commit ends reviewed old mappings and creates only reviewer-selected exact target mappings with their existing product scope. A `leave_gap` decision creates no target mapping. Evidence links remain on their existing control and immutable evidence versions. M7 snapshots and prior assessments are never updated.
- Additive migrations use pinned `search_path`, explicit grants, enabled non-forced RLS, tenant export registration where appropriate, and CLI-generated types. Deploy schema, API, then web; rollback deploys prior API/web binaries while retaining immutable and audit data.

## API boundary and rendering

`@repo/contracts/frameworks/schemas/upgrade.schema.ts` owns path, query, body, and success schemas. Trusted wire types derive with `z.output` in `frameworks/types`. Controllers use Zod pipes and `@ZodResponse`; the web gateway uses `inputSchema` for each body and `schema` for every JSON success. The old selection endpoint permits initial selection and same-version enable toggles, and returns `upgrade_required` for a version switch.

The existing functional `/frameworks` workspace lazy-loads the upgrade panel. It shows source and target edition, curated relation provenance, bounded impact pages, reviewed decisions, and one commit action. It retains recoverable drafts on offline/validation/conflict, but a conflict requires a new preview. Evidence reuse labels cross-framework relationships as advisory and evaluates product applicability and evidence validity independently. Requirement text is inert text; status is never conveyed by color alone.

## Failure modes, tests, and observability

- Invalid pack, markup, absent license/reviewer, unknown requirement, or unsupported relation fails before import; partial content is not selectable.
- Missing membership, permission, product scope, or valid evidence fails closed without hidden counts. JWKS/session handling remains in the existing guards.
- Stale selection, simultaneous control edit, changed review, or duplicate command returns a stable conflict/idempotent result; no partial version switch or auditless mapping write occurs.
- Database/provider outage returns unavailable; browser input survives. A worker restart leaves coverage stale until recalculation, never falsely green. No model or egress is required.
- Tests start red and cover contracts, policy, SQL/RLS, transaction rollback, concurrent writers, controller/adapter parsing, browser journeys, and load. Log stable scope IDs and failure codes, never tokens, proprietary text, or hidden product counts.

## Verification and rollback record

Run focused tests and at least 80% coverage for new/materially changed modules, local SQL/RLS and DB lint, generated-type comparison, `pnpm verify`, auth/organization-switching/M1-M10 regressions, and owner browser journeys with screenshots. Use the repository Playwright runner if MCP is unavailable. Record actual results, prior gate failures, migration order, and residual risks in a separate verification record. Do not reset or remove unrelated local data.

## Review checklist

- [x] Direct solution and narrower schema changes considered.
- [x] Present pattern triggers, dependencies, contract boundaries, and removal triggers recorded.
- [x] No global request, user, tenant, or session state in the design.
- [x] Controllers/pages remain free of provider queries.
- [x] Boundary parsing and transactional security effects specified.
- [x] Focused coverage and live-stack results recorded after implementation in `m10-04-verification.md`.
