# M2 Final Closure Plan

Baseline remained `milestone-1` with earlier M2 changes preserved. Work used the local CRA stack only; no production database access, resets, commits, pushes, or M3 work.

## Verified gaps addressed

1. Concurrent session registration could produce a redundant unique-index conflict and fail the auth guard. The fix keeps the primary identity boundary, removes the redundant conflict path, and prevents a different member from replacing a session identity.
2. FR-PROD-004 lacked a questionnaire and immutable history. The implementation adds source-linked human declarations, provisional engineering classification, rationale, immutable reruns, export, and durable audit. It does not invent legal approval.
3. Relationship mutations could appear stale during local-stack refresh failures. The final browser run verifies committed relationship state and fresh graph reads after the session and Kong/DNS repairs.
4. Final verification caught a tenant export gap: SQL registered and locked `product_classification_runs`, but the TypeScript export source registry omitted it. The fix adds the table to the existing `product_registry` source and keeps the SQL lock addition as named `v_new_lock` for the architecture parser.

## Execution status

- [x] Session regression, migration, parallel SQL/concurrency tests, and foreign-user/session safety.
- [x] Relationship browser journey with full graph/history/scope assertions and screenshots after local Kong/DNS repair.
- [x] Classification feature design before persistent workflow changes.
- [x] Classification schema/policy TDD and shared parsed types; no AI or external request dependency.
- [x] One immutable run table, atomic scoped save/audit/idempotency/concurrency, existing M1 export integration, SQL/RLS failure tests, and CLI types.
- [x] Thin parsed API routes and scoped adapter with bounded history and latest summaries.
- [x] Lazy functional questionnaire/list/detail integration with provisional states, rationale/history, unsaved/conflict/retry accessibility tests.
- [x] Independent review, focused coverage above 80%, local stack tests, DB lint/diff/type alignment, export registry regression, and serial `pnpm verify` evidence.
- [x] Playwright runner and MCP owner/denied/conflict/rerun journeys, screenshots, and reproducible completion report.

## Evidence summary

- SQL/RLS/integration: `/tmp/cra-m2-final-sql.log`, 72 files passed.
- Export registry/worker: `/tmp/cra-m2-final-export-worker-tests.log`, 12 tests passed.
- Final verify: `/tmp/cra-m2-final-verify-serial.log`, exit 0; lint, type checks, 58 architecture checks, all tests and build passed. Counts: contracts 533, API 2430 in 283 suites, web 866 in 144 files, UI 98, docs 5, design system 9; build 4 tasks successful.
- Auth browser: final Chromium retry passed after runtime origin alignment to the running web server; earlier failure is documented as environment origin mismatch.
- WebKit classification: eight screenshots under `docs/architecture/evidence/m2/classification-webkit/`.
- MCP: owner history/rerun and viewer readonly evidence under `docs/architecture/evidence/m2/mcp-final/`.
- Supabase local identity: `docs/architecture/evidence/m2/local-supabase-mcp-verification.json`.
- Final machine-readable report: `docs/architecture/evidence/m2/verification-results.json`.
- Diff: `docs/architecture/evidence/m2/final-schema-diff.json`; unrelated function body differences are `public.retry_supplier_evidence_reminder_delivery_atomic(uuid, uuid, uuid, uuid)`, `public.m7_declaration_json(uuid, uuid, boolean)`, `public.m8_evidence_validity_status(date, date, integer[])`, and `public.retry_evidence_text_extraction_atomic(uuid, uuid, uuid, uuid, uuid)`.

## Performance notes

Bounded local measurements from the final report: latest 100 products p95 0.779 ms and p99 1.452 ms, history 15 rows p95 0.533 ms and p99 1.051 ms, and local HTTP read 50 requests at concurrency 4 p95 157 ms and p99 162 ms. These are regression diagnostics, not production SLO proof.

## Migration order

1. `20260928053758_m2_validate_connector_hardening_constraints.sql`
2. `20260928053905_m2_enforce_connector_idempotency_pair.sql`
3. `20260928070350_session_registration_single_arbiter.sql`
4. `20260928070538_m2_product_classification_commands.sql`
5. `20260928071542_m2_classification_foreign_key_indexes.sql`
6. `20260928072541_m2_classification_history_authorization.sql`

The accidental `20260928070205` local migration was repaired as a no-op/reverted history entry and is not part of the deployment sequence.

## Closure meaning

M2 is engineering-closed for the implemented BRD workflows. Every classification result remains explicitly provisional under the engineering policy. Qualified pre-live legal review remains required before regulatory reliance. This closure does not claim production legal approval, CRA conformity certification, WCAG certification, current/previous browser certification, or full production-load performance.
