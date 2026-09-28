# M2 gap closure results

## Scope and closure state

Baseline: `milestone-1` at `8bad168`. Work stayed on the local CRA stack; no production database was accessed, no reset was run, and no commit or push was made.

M2 is at engineering closure for the implemented gaps: owner selection, retry idempotency, UTC lifecycle/support entry, support scoping, connector constraints, session registration race, relationship refresh, and FR-PROD-004 provisional product classification. Final SQL passed 72 files with exit 0 in `/tmp/cra-m2-final-sql.log`. WebKit classification passed in 33 seconds with eight screenshots. Final scoped auth Chromium passed in 4.8 seconds after runtime origin alignment. Final `TURBO_CONCURRENCY=1 pnpm verify` passed with exit 0 in `/tmp/cra-m2-final-verify-serial.log`.

FR-PROD-004 is implemented as a source-linked human-declaration workflow with engineering-provisional output. It does not assert qualified legal approval, conformity, statutory CRA obligation completion, WCAG certification, current/previous browser support, or production readiness. Qualified legal review remains a pre-live release gate.

## Changes and traceability

| Requirement / observed gap                | Implementation                                                                                                                                                                                 | Verification                                                                                                                                        |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-PROD-001 owner selection               | Permission-gated tenant owner directory, scoped current-owner label, organization-partitioned cache, accessible create/edit selector                                                           | Owner schema/API/adapter/controller/gateway/component tests; browser owner screenshots                                                              |
| FR-PROD-001/002 lost responses            | Product, release and classification retries retain an idempotency key for the same parsed payload and rotate after payload change or success                                                   | Retry unit/component tests; browser manual retry screenshots                                                                                        |
| FR-PROD-004 classification                | One immutable `product_classification_runs` table, source-linked provisional policy, exact branch answers, rationale, history, latest summaries, tenant export, audit and idempotent save RPCs | Contract policy/schema tests; API 60-test focused suite; SQL 49 + 15 history assertions; concurrency script; Playwright/MCP classification evidence |
| FR-PROD-006 UTC lifecycle/support input   | Native UTC inputs preserve seconds/milliseconds and reject invalid calendar values before normalization                                                                                        | UTC unit/component tests; browser placement/correction screenshots                                                                                  |
| FR-PROD-008 relationships                 | Session-registration race fixed; relationship mutations no longer wait on broad refresh completion before reporting committed state; final graph reads verify fresh state                      | Session SQL/concurrency tests; relationship browser run after Kong/DNS fix                                                                          |
| FR-PROD-009 support release scope         | Strict optional release query with tenant/product release verification and product-wide fallback                                                                                               | Contract/application/controller/gateway tests; wrong product/tenant browser checks                                                                  |
| FR-PROD-010/013 retention cache alignment | Retention and alert queries share product-level keys                                                                                                                                           | Query tests and existing support regressions                                                                                                        |
| FR-PROD-012 connector constraints         | Existing checks validated; idempotency digest/check constraints close keyed NULL loopholes while preserving valid historical rows                                                              | `m2-v2-connector-sync.test.sql` 77 assertions; connector browser run                                                                                |

## Verified gates

- TDD red/green evidence exists for product owners, UTC conversion, support filtering, product/release retries, classification schemas/policy/API/adapter/UI, SQL authorization/history, session race and relationship refresh behavior.
- Full SQL passed locally: 72 files, exit 0, `/tmp/cra-m2-final-sql.log`.
- SQL/RLS/integration checks include connector 77 assertions, classification 49 base assertions, classification-history 15 authorization assertions, session registration SQL/concurrency, M1 export integration, classification read-load diagnostic, and classification concurrency script.
- Final `pnpm verify` passed lint, type checks, 58 architecture checks, all tests and build. Counts: contracts 533, API 2430 in 283 suites, web 866 in 144 files, UI 98, docs 5, design system 9.
- API live integration rerun passed 4/4.
- Focused export registry and worker regression passed 12 tests after the final `product_classification_runs` export registry fix.
- Coverage summaries were copied to `docs/architecture/evidence/m2/classification-{api,history-adapter,web,contracts}-coverage-summary.json`.
- API classification modules: 100% lines/functions, 99.15% statements, 93.93% branches. History adapter final: 100% lines/statements/functions, 95.91% branches. Web classification modules: 98.68% lines/statements, 100% functions, 89.93% branches. Contracts classification modules: 100% all reported categories. All new M2 modules exceed 80%. The changed relationship path has 17/17 covered statements. The focused legacy whole-file relationship coverage is 23.67% lines, 25.88% functions and 92.1% branches, so this report does not claim whole-file legacy coverage is 80%.
- CLI `db:types` regenerated both database type copies after the migrations.
- DB lint rerun exited 0 with existing warnings.
- `supabase db diff --schema public --use-migra` completed. No M2 table/index/policy drift was identified. Sanitized evidence is recorded in [final-schema-diff.json](evidence/m2/final-schema-diff.json). Function-body differences in older unrelated functions remained:
  - `public.retry_supplier_evidence_reminder_delivery_atomic(uuid, uuid, uuid, uuid)`
  - `public.m7_declaration_json(uuid, uuid, boolean)`
  - `public.m8_evidence_validity_status(date, date, integer[])`
  - `public.retry_evidence_text_extraction_atomic(uuid, uuid, uuid, uuid, uuid)`
- Local Supabase MCP identity proof confirmed the repository points to local `cra`, seed marker exists, the classification migration is present, `product_classification_runs` is the only new table, RLS is enabled and not forced, direct `service_role` table SELECT is revoked, and service-role access is only through permission-checked RPCs. Evidence: [local-supabase-mcp-verification.json](evidence/m2/local-supabase-mcp-verification.json).
- Final machine-readable closure summary is [verification-results.json](evidence/m2/verification-results.json).

## Browser and MCP evidence

- Product registry owner/UTC/support/retry journey passed in Chromium and Firefox, with WebKit screenshots retained from the keyboard/typeahead path. Final scoped auth Chromium passed after aligning `APP_URL` with the running web origin; the earlier failure was an environment-origin mismatch.
- WebKit classification passed in 33 seconds with eight screenshots under `docs/architecture/evidence/m2/classification-webkit/`.
- CSV import passed with the existing import worker.
- Connector journey passed, including dry run, commit, rate-limit retry and tenant isolation; no vendor-specific production connector or on-premises agent was certified.
- Relationship journey passed after the session race and refresh fixes plus the local Kong old-DNS repair. Evidence: [relationship membership](evidence/m2/relationships-kong-fixed/product-relationships-a-ru-9f1a5-review-and-a-rejected-cycle-chromium/relationship-membership-recorded-desktop.png), [variant](evidence/m2/relationships-kong-fixed/product-relationships-a-ru-9f1a5-review-and-a-rejected-cycle-chromium/relationship-variant-recorded-desktop.png), [component](evidence/m2/relationships-kong-fixed/product-relationships-a-ru-9f1a5-review-and-a-rejected-cycle-chromium/relationship-component-recorded-desktop.png), [fresh graph](evidence/m2/relationships-kong-fixed/product-relationships-a-ru-9f1a5-review-and-a-rejected-cycle-chromium/relationship-fresh-graph-desktop.png), and [cycle rejection](evidence/m2/relationships-kong-fixed/product-relationships-a-ru-9f1a5-review-and-a-rejected-cycle-chromium/relationship-cycle-rejected-desktop.png).
- Playwright MCP used a fresh pinned `@playwright/mcp@0.0.82` isolated local browser because the registered transport was closed. It verified seeded owner classification history/rerun and viewer readonly access without global sign-out or site-data removal. Evidence: [MCP verification](evidence/m2/mcp-final/verification.json), [owner history](evidence/m2/mcp-final/owner-classification-history-desktop.png), [owner rerun](evidence/m2/mcp-final/owner-classification-rerun-desktop.png), and [viewer readonly](evidence/m2/mcp-final/viewer-registry-readonly-desktop.png).

Representative screenshots:

- [Owner creation selector](evidence/m2/cross-browser/product-registry-an-organi-54419-sees-scoped-support-history-chromium/owner-create-mobile.png)
- [Owner detail/edit](evidence/m2/cross-browser/product-registry-an-organi-54419-sees-scoped-support-history-chromium/owner-edit-desktop.png)
- [Product retry](evidence/m2/cross-browser/product-registry-an-organi-54419-sees-scoped-support-history-chromium/product-retry-mobile.png)
- [Release retry](evidence/m2/cross-browser/product-registry-an-organi-54419-sees-scoped-support-history-chromium/release-retry-mobile.png)
- [UTC placement](evidence/m2/cross-browser/product-registry-an-organi-54419-sees-scoped-support-history-chromium/utc-placement-mobile.png)
- [Support scope](evidence/m2/cross-browser/product-registry-an-organi-54419-sees-scoped-support-history-chromium/support-scope-mobile.png)
- [Classification history](evidence/m2/classification-complete/product-classification-cla-79d84-lly-and-reject-stale-writes-chromium/classification-immutable-history-desktop.png)
- [Classification conflict preserved](evidence/m2/classification-complete/product-classification-cla-79d84-lly-and-reject-stale-writes-chromium/classification-conflict-preserved-mobile.png)
- [WebKit classification history](evidence/m2/classification-webkit/product-classification-cla-79d84-lly-and-reject-stale-writes-webkit/classification-immutable-history-desktop.png)

## Reproducible command record

Primary completion evidence can be reproduced with:

```sh
pnpm --filter infrastructure run test
pnpm --filter infrastructure run db:lint
pnpm --filter infrastructure run db:types
pnpm --filter infrastructure exec supabase db diff --local --schema public --use-migra
TURBO_CONCURRENCY=1 pnpm verify
pnpm --filter api exec jest export-source-registry.architecture sbom-validation-worker --runInBand
pnpm --filter api exec jest --config ./test/jest-e2e.json --runInBand
```

Live browser evidence used the repository Playwright specs against the local CRA dev stack and the fresh pinned local Playwright MCP session recorded in [mcp-final/verification.json](evidence/m2/mcp-final/verification.json).

From `apps/web`, with the built API running at port 3333 and its runtime `APP_URL` and `WEB_ORIGIN` set to `http://localhost:3002`:

```sh
E2E_WEB_ORIGIN=http://localhost:3002 E2E_API_ORIGIN=http://localhost:3333 \
  E2E_CROSS_BROWSER=true \
  node --env-file=../../.env.local --env-file=../api/.env \
  node_modules/@playwright/test/cli.js test e2e/product-classification.spec.ts \
  --project=webkit --workers=1
```

Repeat with `--project=chromium` and `--project=firefox`; run the product registry, relationship, import, connector and auth-session specs sequentially against the same local origins. Use at least a 60-second cooldown between account-heavy journeys to respect the existing global rate limit. Import/connector specs require their existing workers. Keep the optional classification read-load probe disabled for normal journeys; run-scoped fixtures remove only their own generated records. The legacy auth shell script was not used because its global Mailpit cleanup would remove unrelated messages.

## Database deployment and rollback

CLI-created local migration order:

1. `20260928053758_m2_validate_connector_hardening_constraints.sql`
2. `20260928053905_m2_enforce_connector_idempotency_pair.sql`
3. `20260928070350_session_registration_single_arbiter.sql`
4. `20260928070538_m2_product_classification_commands.sql`
5. `20260928071542_m2_classification_foreign_key_indexes.sql`
6. `20260928072541_m2_classification_history_authorization.sql`

The accidental empty `20260928070205` local migration was repaired as a no-op/reverted history entry before applying the real classification migrations. It created no table/function and is not part of the deployment sequence.

Rollback: keep validated connector constraints, the session arbiter repair and the additive `product_classification_runs` history. Application rollback may hide classification UI/API, but must not delete saved runs, weaken RLS/RPC grants, remove audit facts, rewrite product/release/support histories, or restore the connector NULL loophole. A failed classification save rolls back both run and audit insert transactionally; old runs remain readable.

## Initial failures, final export fix and limits

- Local Docker VM total memory was 2.844 GiB during the unstable run; analytics was restored healthy in 23 seconds and all 12 local CRA containers ended healthy, including the five optional services. This was treated as a local environment capacity failure, not product behavior.
- Final verify caught a real tenant-export gap: SQL registered and locked `product_classification_runs`, but the TypeScript export source registry omitted it. The fix added the table to the existing `product_registry` source and kept the SQL lock declaration as `v_new_lock`; the focused export registry/worker regression passed 12 tests.
- Local Kong old DNS caused browser/API routing failures until the local gateway/container state was refreshed; the relationship journey passed after that repair.
- Earlier Auth context-deadline failures produced fail-closed 503s. The final scoped auth retry passed after runtime origin alignment.
- WebKit initially stalled on the onboarding country dropdown pointer path; the verified path uses accessible keyboard/typeahead selection. This does not certify the earlier pointer path.
- Browser runs used run-scoped fixtures and exact cleanup. MCP used an isolated profile, did not call global sign-out, did not remove other site data, and left zero exact private classification organizations after cleanup.
- Performance evidence is a bounded local DB/read diagnostic, not production HTTP load proof. Recorded local measurements: latest 100 products p95 0.779 ms and p99 1.452 ms, history 15 rows p95 0.533 ms and p99 1.051 ms, local HTTP read with 50 requests at concurrency 4 p95 157 ms and p99 162 ms. These measurements are meaningful for regression shape and query bounds, but they do not establish the target p95/p99 SLO under realistic production load.
- The reference PLM/ALM connector engine was verified. No optional vendor connector, marketplace integration, or on-premises agent release was certified.

## Handoff state

All changes remain uncommitted on `milestone-1`; the user owns commit/push. No M3 work started. M2 is engineering-closed. Legal approval for live regulatory use remains a separate release gate.
