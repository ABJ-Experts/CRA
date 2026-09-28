# M2 Product Classification

## Scope and preserved contracts

- User outcome: complete a guided CRA classification questionnaire, see a live provisional result, save answers and rationale, and rerun it without replacing previous runs.
- In scope: source-linked human declarations, deterministic branching, policy version/hash, immutable history, latest list/detail projection, tenant export, transactionally durable audit, concurrency, idempotency, and rollback readability.
- Out of scope: automatic semantic/legal classification, counsel approval, conformity certification, AI, external model calls, changing reporting clocks, or rewriting historical M7 snapshots.
- Preserve existing product/release mutation shapes, permissions, session verification/revocation, API prefix, cookie paths, menu/mock contracts, retained history and evidence stores.

The BRD permits an engineering implementation but requires qualified review before live regulatory use. The product labels every classification as provisional and does not claim qualified legal approval.

## Concrete problem

Products had mutable `productType` metadata but no saved questionnaire answers, rationale, provisional classification result, policy provenance, or rerunnable history. Audit logs alone are not a usable immutable read model for FR-PROD-004.

## Why one table was necessary

A classification string on `products` would lose previous answers and rule provenance. A JSON history array on the row would require rewriting all history and would not support bounded pagination. Substantial-modification assessments have a different meaning and fixed schema. One immutable `product_classification_runs` table is the minimal durable model; no draft/rule/projection/product-column table was added.

## Selected patterns

- Existing product gateway, thin parsed controller, inward application use case, and scoped Supabase adapter.
- Pure questionnaire policy over human-declared scope and category matches.
- Versioned policy metadata with source references, effective date, policy hash, and saved skipped branches.
- SQL RPC for atomic save, idempotency replay, conflict detection, immutable run insert, and durable audit fact.
- Permission-checked RPC for history so direct table reads are not the service boundary.

## Data and tenant boundaries

Identity and organization derive from the verified session. Reads require product visibility; writes require product edit permission. Every query filters organization and exact product identifiers. Bulk latest reads are bounded and fail closed for foreign or missing products. The save command locks the scoped product, checks archive state, verifies product version and expected classification revision, derives and validates the server result, inserts the run, and writes the audit fact in one transaction.

RLS is enabled and not forced. Grants are explicit. `service_role` direct SELECT on `product_classification_runs` is revoked by the final authorization migration; access is through permission-checked RPCs. The table is included in the tenant export source catalogue and TypeScript export registry under `product_registry`, and the snapshot materializer lock is extended to include it.

## API and contract boundaries

Product contracts define policy, branch answers, save command, run/history, bounded latest query, and success responses with trusted `z.output` types. The scope answer is `in_scope`, `out_of_scope`, or `undetermined`. Category answers are `yes`, `no`, or `undetermined`; skipped branches are saved explicitly and hidden stale answers are rejected. The server derives the provisional result and ignores any client attempt to supply a legal-review status.

Path, query, body, outgoing web payloads, and successful incoming responses are parsed. Existing product wire contracts remain unchanged.

## Frontend behavior

The existing product workbench contains a lazy functional classification panel. It uses labelled controls, textual provisional status, source links, live result, rationale, conflict recovery, manual retry, and paginated immutable history. Unsaved answers survive validation, offline, and conflict states. A conflict requires refresh before explicit retry; no POST is auto-replayed after session refresh.

## Failure modes

Foreign product/org, revoked permission, archived product, malformed policy, stale product version, stale classification revision, simultaneous rerun, changed idempotency payload, and audit failure all fail closed without partial history. Unknown category matches stay visible as unknown and are not coerced. Malicious text is rendered as text and bounded. Core classification needs no AI, no model, and no outbound network request.

## Verification

- Schema/policy/contract, API/application/adapter/controller, web gateway/component, SQL/RLS/history, export registry, worker, browser, and MCP coverage were added.
- Final SQL/RLS/integration suite passed 72 files with exit 0 in `/tmp/cra-m2-final-sql.log`.
- API classification suite passed 60 tests. SQL classification base passed 49 assertions and history authorization passed 15 assertions.
- Coverage summaries: API 100% lines/functions, 99.15% statements, 93.93% branches; history adapter 100% lines/statements/functions, 95.91% branches; web 98.68% lines/statements, 100% functions, 89.93% branches; contracts 100% all reported categories. All new classification modules exceed 80%.
- Export registry/worker regression passed 12 tests after adding `product_classification_runs` to the TypeScript export registry.
- Classification WebKit passed with eight screenshots under `docs/architecture/evidence/m2/classification-webkit/`.
- Playwright MCP verified owner history/rerun and viewer readonly access with evidence under `docs/architecture/evidence/m2/mcp-final/`.
- Local Supabase MCP evidence confirms the local `cra` stack, migration presence, one new table, non-forced RLS, and RPC-only service-role history access. Final closure metadata is in `docs/architecture/evidence/m2/verification-results.json`.

## Rollback

Keep the additive table and saved runs. Application rollback may hide UI/API but must not delete saved runs, remove audit facts, weaken RLS/RPC grants, remove export registration, or rewrite product/release/support histories. A failed save rolls back both the run and audit fact. Production database access was not used.

## Sources

- Supplied BRD v2.0: FR-PROD-004, classification screen and pre-live regulatory review warning.
- Regulation (EU) 2024/2847, Article 2, Articles 7/8 and Annexes III/IV: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R2847
- Implementing Regulation (EU) 2025/2392, category technical descriptions: https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX:32025R2392

The workflow records human declarations against these sources. Engineering metadata is not qualified legal approval and does not certify conformity.
