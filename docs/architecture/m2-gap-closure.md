# M2 Gap Closure Design

## Scope and preserved contracts

M2 closure covers product registry ownership, UTC lifecycle/support entry, support period release scoping, connector constraint hardening, relationship refresh reliability, session-registration race repair, and FR-PROD-004 provisional product classification. It preserves mutation wire contracts, retained histories, `/api/v1`, auth cookie paths, ES256/JWKS verification, permission merge order, product retention/alerts, and existing evidence stores.

The original owner/UTC/support/connector closure reused existing tables. FR-PROD-004 required exactly one additive immutable history table, `product_classification_runs`, because prior answers and policy provenance cannot be safely stored on the mutable `products` row. No additional classification draft, rule, projection, evidence, or directory tables were added.

## Concrete problem

At baseline, product create/edit required a raw `responsibleOwnerId`, release lifecycle forms required typed UTC timestamps, support period reads accepted `releaseId` but ignored it, and three connector constraints existed as not valid locally. Later M2 review found two additional product-flow gaps: concurrent session registration could surface as auth failures, and product relationships could show stale graph state after mutation refresh. FR-PROD-004 had no questionnaire, provisional result, rationale, rerun history, or exportable immutable record.

## Selected patterns

- Functional React calls existing product gateways and transports.
- Feature-first product contracts in `@repo/contracts` define parsed request and response schemas, with trusted types derived from `z.output`.
- Thin Nest controllers parse path/query/body input and successful responses before serialization.
- Application use cases own permission checks and workflow policy.
- Supabase adapters implement inward ports and scope service-role queries by verified organization and product IDs.
- SQL RPCs own state-changing concurrency, idempotency, durable audit facts, and rollback.

No bus, generic repository framework, second relationship/mapping engine, external AI/model call, customer-authored legal engine, or network dependency was added.

## Data and tenant boundaries

Identity and organization scope come only from verified sessions. Owner queries filter `organization_members.organization_id` and active users; selected owner lookups are tied to a verified tenant product. Product/release/support reads validate release membership in the requested tenant/product. Relationship and classification writes recheck permissions inside the scoped operation.

The classification save command locks the scoped product, checks `can_edit_products`, validates product version and expected classification revision, derives the result from human declarations, inserts `product_classification_runs`, and writes the audit fact in one transaction. Exact idempotent retries replay; changed-payload retries conflict. Failed audit or validation leaves no partial run. History reads use a permission-checked RPC; direct `service_role` table SELECT was revoked in the final authorization migration.

`product_classification_runs` is registered in both the SQL tenant export source catalogue and the TypeScript export source registry under `product_registry`. Final verify caught the TypeScript omission after SQL already registered and locked the table; the fix added the existing table to the existing source, not a new source. The snapshot materializer lock remains extended through the migration's named `v_new_lock` literal for `public.product_classification_runs`, which the architecture test parses.

## API boundary contracts

Owner, support, product retry, relationship, session, and classification paths parse all consumed parameters and successful JSON payloads. Unknown scope keys and malformed questionnaire payloads fail validation. Existing create/update/support mutation schemas remain compatible. Classification responses label results as provisional engineering output and never expose or accept a legal-review status.

## Frontend logic and rendering

The product workspace keeps functional components and existing query boundaries. Owner selector, UTC lifecycle/support inputs, retry-preserving create forms, relationship refresh states, and the classification panel use accessible labels, textual statuses, visible errors, and scoped query keys. Recoverable validation, offline, conflict, and retry states preserve unsaved input. Classification is lazy within the product workbench and shows source-linked human declarations, rationale, live provisional result, immutable history, and saved skipped answers.

## Failure modes

Directory outages show retry and never grant permission. Foreign or inactive owners cannot be newly assigned. Invalid calendar input fails before UTC normalization. Wrong release/product or tenant fails closed. Simultaneous product edits, relationship changes, classification reruns, stale revision, or changed idempotency payloads return recoverable conflicts. Local provider/JWKS/database outages produce unavailable states, not partial saves or authorization grants. Core M2 workflows do not require AI, outbound network access, or production Supabase.

## Verification and evidence

- Final SQL/RLS/integration suite passed 72 files with exit 0 in `/tmp/cra-m2-final-sql.log`.
- Focused export registry and worker regression passed 12 tests after the final export registry gap was fixed in `/tmp/cra-m2-final-export-worker-tests.log`.
- Final serial `pnpm verify` completed through tests and builds in `/tmp/cra-m2-final-verify-serial.log`: API tests show 283 suites and 2430 tests passed; build shows 4 successful tasks.
- DB lint exited 0 with existing warnings only.
- `supabase db diff --schema public --use-migra` found no M2 schema drift. Sanitized evidence is in [final-schema-diff.json](evidence/m2/final-schema-diff.json).
- CLI database types were regenerated in both copies.
- Coverage summaries are in `docs/architecture/evidence/m2/classification-{api,history-adapter,web,contracts}-coverage-summary.json`. All new classification modules are above 80%. The changed relationship path has 17/17 covered statements. The focused legacy whole-file relationship coverage is 23.67% lines, 25.88% functions and 92.1% branches, so this is not a claim that whole-file legacy query paths have 80% coverage.
- Product registry, connectors, relationships, classification, auth, and MCP checks were exercised against the local CRA stack only. Production databases were not used. The final machine-readable closure summary is `docs/architecture/evidence/m2/verification-results.json`.

## Browser and MCP closure

Repository Playwright product-registry journeys passed in Chromium and Firefox; WebKit covered the keyboard/typeahead path. Relationship browser checks passed after the session and Kong/DNS fixes. Classification WebKit passed. Generated screenshots were removed.

Playwright MCP was run through a fresh pinned local `@playwright/mcp@0.0.82` browser because the earlier registered transport was closed. It verified owner classification history/rerun and viewer readonly access without global sign-out or site-data removal. Evidence is in [mcp-final/verification.json](evidence/m2/mcp-final/verification.json) and related screenshots. The final auth Chromium retry passed after aligning the runtime app origin with the running web port; the earlier failure is recorded as an environment origin mismatch, not an auth source change.

## Migration order and rollback

1. `20260928053758_m2_validate_connector_hardening_constraints.sql`
2. `20260928053905_m2_enforce_connector_idempotency_pair.sql`
3. `20260928070350_session_registration_single_arbiter.sql`
4. `20260928070538_m2_product_classification_commands.sql`
5. `20260928071542_m2_classification_foreign_key_indexes.sql`
6. `20260928072541_m2_classification_history_authorization.sql`

The accidental local `20260928070205` migration was repaired as a no-op/reverted history entry and is not part of the deployment sequence. Rollback may hide classification UI/API, but must retain validated connector constraints, session repair, immutable classification runs, durable audit facts, RLS/RPC grants, product/release/support histories, and export source registration needed to read retained records.

## BRD requirement inventory

| BRD requirement                       | Closure evidence                                                                               | Disposition                                                 |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| FR-PROD-001 Registry                  | Owner selector, scoped owner directory, product retry, latest classification badge             | Engineering closed                                          |
| FR-PROD-002 Releases                  | Release routes and retry-preserving create flow regression                                     | Engineering closed                                          |
| FR-PROD-003 Variants                  | Relationship graph and browser freshness regression                                            | Engineering closed                                          |
| FR-PROD-004 Classification            | Source-linked human declaration workflow, provisional result, immutable history, export, audit | Engineering closed; qualified legal review remains pre-live |
| FR-PROD-005 Market availability       | Existing release-market lifecycle routes retained                                              | Regression covered                                          |
| FR-PROD-006 Lifecycle                 | UTC lifecycle/support inputs and validation                                                    | Engineering closed                                          |
| FR-PROD-007 Substantial modifications | Existing compliance routes retained                                                            | Regression covered                                          |
| FR-PROD-008 Hierarchy                 | Relationship graph and finding propagation retained with refresh fix                           | Engineering closed                                          |
| FR-PROD-009 Support periods           | Release-scoped support filtering and product fallback                                          | Engineering closed                                          |
| FR-PROD-010 Alerts                    | Existing worker/preferences retained; product-level cache alignment preserved                  | Regression covered                                          |
| FR-PROD-011 CSV import                | Import worker regression and idempotency boundaries retained                                   | Regression covered                                          |
| FR-PROD-012 PLM/ALM                   | Connector constraints validated and idempotency pair enforced                                  | Engineering closed                                          |
| FR-PROD-013 Retention                 | Existing support retention routes and M1 authority retained                                    | Regression covered                                          |
| FR-PROD-014 Updates                   | Existing security update artifact flow retained                                                | Regression covered                                          |

## Residual limits

Qualified legal approval for live regulatory use is still a release gate. The workflow records source-linked human declarations and provisional engineering output; it does not certify conformity or statutory CRA obligations. Current/previous browser support and WCAG certification are not claimed. Performance checks are bounded diagnostics: latest 100 products p95 0.779 ms and p99 1.452 ms, history 15 rows p95 0.533 ms and p99 1.051 ms, local HTTP read p95 157 ms and p99 162 ms. They are not production load certification. All M2 changes remain uncommitted on `milestone-1`; the user owns commit and push.
