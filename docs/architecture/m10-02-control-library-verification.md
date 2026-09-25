# M10-02 verification record

## Scope and contracts

This release adds an organization control library, immutable control revisions, exact evidence-version links, version-pinned requirement mappings, explicit product applicability, and product-specific coverage. A mapped requirement means an active control mapping applies to that product; implementation status and evidence availability are separate observations. None is a legal-compliance verdict.

- Framework wire contracts: `packages/contracts/src/frameworks/schemas/control.schema.ts`, with `z.output` exports under `packages/contracts/src/frameworks/types`.
- M8 reverse-link contract: `packages/contracts/src/evidence/schemas/evidence.schema.ts`.
- API boundary: `apps/api/src/frameworks/controls.controller.ts` → `application/control-use-cases.ts` → `infrastructure/supabase-control.repository.ts`.
- SQL: `apps/infrastructure/supabase/migrations/20260924070000_m10_02_control_library.sql` and the ordered follow-up migrations sharing the `20260924` prefix.
- Web boundary: `apps/web/app/_features/frameworks/controls.api.ts` → `control-library-panel.tsx` and `control-detail-panel.tsx`.

## Requirement-to-test trace

| Requirement                                                                   | Evidence                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authorized owner and lifecycle; visible owner gap                             | `apps/infrastructure/tests/m10-02-control-library.test.sql`; `apps/api/src/frameworks/application/control-use-cases.spec.ts`; `apps/web/app/_features/frameworks/control-library-panel.spec.tsx`          |
| Exact, reusable evidence versions; product and tenant scope                   | `apps/infrastructure/tests/m10-02-control-library.test.sql`; `apps/infrastructure/tests/m10-02-evidence-reuse.test.sql`; `apps/api/src/evidence/infrastructure/supabase-evidence.repository.spec.ts`      |
| Version-pinned many-to-many mappings and explicit product applicability       | `apps/infrastructure/tests/m10-02-control-library.test.sql`; `packages/contracts/src/frameworks/schemas/control.schema.spec.ts`; `apps/web/e2e/m10-control-library.spec.ts`                               |
| Optimistic concurrency, idempotency, archive history, and transactional audit | `apps/infrastructure/tests/m10-02-control-library.test.sql`; `apps/api/src/frameworks/controls.controller.spec.ts`; `apps/web/e2e/m10-control-library.spec.ts`                                            |
| Bounded coverage and M8 reverse projection                                    | `apps/api/src/frameworks/infrastructure/supabase-control.repository.spec.ts`; `apps/infrastructure/tests/m10-02-evidence-reuse.test.sql`; `apps/web/app/_features/evidence/evidence-reuse-panel.spec.tsx` |
| Schema parsing, hostile text, and tenant isolation                            | `packages/contracts/src/frameworks/schemas/control.schema.spec.ts`; both M10 SQL suites; controller/repository specs                                                                                      |

## Reproducible checks

From the repository root, with the local Supabase `cra` stack running:

```sh
pnpm --filter infrastructure run test
pnpm --filter infrastructure run db:lint
pnpm --filter infrastructure exec supabase db diff
pnpm --filter api run test -- --runInBand frameworks
pnpm --filter contracts run test
pnpm --filter web run test -- control
pnpm verify
pnpm build
```

The browser journey runs only against the local CRA dev server, with a unique test organization and product. It verifies control creation and editing, explicit product mapping, coverage, stale revision conflict, organization isolation, and archive. Use `E2E_WEB_ORIGIN=http://localhost:3002` when another site owns port 3000. The repository Playwright runner is the available browser test tool; a dedicated Playwright MCP was not exposed in this session. Set `E2E_CROSS_BROWSER=true` to run Chromium, Firefox, and WebKit. The helper deletes only its tracked test organization; local read-only SQL confirmed no M10 controls, mappings, links, mapping products, or test organizations remain after the run.

## Migration and rollback

Apply the ordered M10-02 migrations after the M10-01 framework pack and M8 evidence-version schema. Regenerate database types with `pnpm --filter infrastructure run db:types`, which updates both generated copies. The database changes are additive. To roll application behavior back, deploy the prior API/web binaries while retaining the new tables and their history; do not drop control rows or reset data. Restore a later binary before editing existing controls again.

## Results and residual risks

- Local Supabase `cra`: all ordered M10-02 migrations applied without reset. The full infrastructure SQL suite passed, including 62 control-library and 31 M8 reverse-link rollback-only assertions. `supabase db lint --fail-on error` passed with older warnings. `supabase db diff` exited successfully; its residual diff concerns older functions and contains no M10 control schema difference.
- Shared contract tests: 10 focused M10 checks passed. The final focused API run passed 70 tests, including framework and M8 repository cases; the final full API suite passed 2,213 tests and failed one existing tenant export registry architecture assertion. Web: 745/745 tests passed. `pnpm build` passed.
- Local browser journey: Chromium, Firefox, and WebKit all passed. The screenshots are [mapped desktop](evidence/m10-02/controls-mapped-desktop.png) and [archived mobile](evidence/m10-02/controls-archived-mobile.png). The site on port 3000 was unrelated, so the CRA web app ran on 3002; that other site was left alone.
- Bounded local read probes: each made 48 successful responses, 12 each for catalog, tree, control list, and selected-product coverage. In the final isolated run, p95 values were 110.6, 112.0, 114.7, and 118.7 ms respectively; p99 equaled p95 with this sample size. A concurrent browser/dev-server run produced p95 values of 424.6, 432.0, 425.0, and 447.2 ms, above the 400 ms target. These are paced local probes, not realistic production load claims; the concurrent result and limited sample count remain performance risks.
- New API module coverage reached 90% statements, 95% lines, 96% functions, and 75.8% branches in aggregate. The repository adapter alone reached 82.96% branches. The aggregate branch target remains unmet, substantially because Nest decorator emission creates instrumented branches. New web modules individually exceed 80% on all four coverage measures.
- The browser journey did not create a clean evidence version: the storage upload and scan worker would require a separate scoped fixture with byte cleanup. Exact evidence link and M8 reverse-projection behavior were verified in real local PostgreSQL and API tests, but a browser evidence-link journey remains open. Automated WCAG analysis and prior-browser-version testing were not available; role-based Playwright locators, keyboard-oriented controls, and mobile screenshots provide limited accessibility evidence.
- Independent review found and prompted two repairs. The M8 reverse projection now gates framework-control links on product-view permission as well as evidence and framework permissions; its real SQL test failed before the forward migration and passed after. Control detail and coverage now mark linked evidence unavailable when a deletion intent is queued, claimed, failed, or completed; cancelled intents remain eligible. Neither repair changes historical links.
- `pnpm verify` passed lint, type checks, architecture checks, and infrastructure tests, then failed one pre-existing tenant export gate because 57 older M1–M9 tables lack source registry entries. The five durable M10 control tables were registered. This older gap is not hidden or excluded by the M10 change. Historical M7 manual references remain unresolved by design.
