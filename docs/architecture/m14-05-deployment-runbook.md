# M14-05 deployment and verification runbook

## Baseline and additive deployment

Implementation began on clean `milestone-1` at `906cb4f` (also remote head). Local project is `cra`, API `http://127.0.0.1:54321`, PostgreSQL17.6,289public tables. The baseline ledger contained196versions versus637repository migration files. Portfolio creates functions only; no table, source backfill, scheduler, cache, storage object or export/report source.

Create migrations using the installed Supabase CLI. Inspect the exact destination/reference/environment and ledger before applying. Local verification uses a private CLI staging directory containing no-op representations of precisely recorded versions and only this feature's new migrations. A CLI dry run must list only M14-05 feature migrations; then CLI push applies them. No existing ledger entry is changed and no historical migration is replayed against development. Clone-only prototype alignment versions belong exclusively to the disposable benchmark database and are not production migrations.

After additive functions, run `pnpm --filter infrastructure run db:types` (writes both generated copies), deploy compatible API and then web. Functions pin search paths. Private helpers deny PUBLIC/anon/authenticated/service_role; only `get_portfolio_projection` is explicitly callable by service_role. Application and RPC both check current tenant/source permissions. Existing non-forced RLS and browser table grants remain unchanged.

`supabase db diff --schema public` completed during verification and reported historical CHECK-constraint removals across existing domains. It reported no portfolio function delta at that point. This is not a zero-drift claim: retain the output and review the historical baseline separately. Never apply the generated constraint-removal diff, reset data or repair the ledger as part of this ticket.

## Compatibility rulings

Current member product access is organization-wide module RBAC, not responsible-owner assignment. Legal entities are flat tenant records; composition relationships do not grant access. Tests prove tenant/source denial, not an invented per-product ACL.

Default marketed scope excludes archived products/releases, development and withdrawn releases. The existing M2 invariant allows release archival only after withdrawal; such archived releases remain excluded even when archive scope is selected. The current `archive_product_atomic` guard also blocks product archival while any nonarchived release exists. No fixture operation bypasses either guard or withdraws a marketed release merely to clean up test data. Legacy archived products can still be represented by the read scope without granting permission to create that state.

The source-owned CVSS decimal repair corrects a double-escaped decimal regex in `m4_03_cvss_rows`. Valid decimal scores formerly disappeared into unknown severity; new live source consumers now receive numeric scores under the existing preference order (4.0,3.1,3.0,2.0). The compatibility fixture explicitly distinguishes this correction for decimal cases8/15 while retaining exact parity for the remaining cases. Retained assessments, policy revisions, approvals, historical trend facts, export/report captures and audit evidence are not rewritten. Future source consumers can see corrected severity; that is an explicit rollout change, not an assertion that every future policy input is identical. No migration approves, submits or changes a regulatory decision.

Live continuation is revision-bound, not a historical snapshot. Changes to scoped entity/product/release/source/finding/intelligence/readiness evidence return409 and require refresh. Tokens are15-minute session/permission/filter-bound opaque encrypted references with fixed-size SHA256identity digests. LargePURLs do not enlarge the bearer token. References confer no database or storage authority.

## Local verification operations

The current owned CRA verification servers are web `3003` and API `3335`, with mocks disabled and the existing local Supabase stack. The earlier CRA `3002`/`3334` processes stopped externally during the interruption; they are not claimed to remain running. Confirm process working directories and origins before browsing. Do not navigate to or clear data from an unrelated application.

Sourceful browser fixtures are uniquely identified products and marketed releases in the seeded owner organization `00000000-0000-4000-8000-0000000000ca`. Components were inserted into new normalizing documents and completed using the existing atomic finalization RPC without disabling guards. Repeated paths, exact versions, missing identities, conflicts and missing inventory are synthetic.

| Retained synthetic product | Product ID |
| --- | --- |
| Alpha | `30f7e380-b606-4f5d-98f2-e117655da1ee` |
| Beta | `41694e83-3cbb-405c-a0ff-09cfbba01292` |
| Missing | `98a181c1-fed5-444e-bb4c-9b1b3f19b23c` |

These three products and their SBOM/audit evidence are retained; fixture cleanup is not claimed complete. `archive_product_atomic` refuses products with nonarchived releases, and release archival requires withdrawal. Do not withdraw, delete evidence or bypass lifecycle guards for test cleanup. Archive an exact fixture product only if it later becomes legitimately eligible through the normal domain lifecycle. Preserve completed source evidence, audit facts and raw-object references. SQL policy tests roll back their own transactions and do not alter unrelated users or business records.

Load fixtures use separate database `cra_m14_05_benchmark`. Replica mode is restricted to this synthetic clone; source CHECKs/uniqueness remain enabled and explicit lineage/cardinality/lifecycle/permission bootstraps are verified. Retained benchmark organizations are unique per scale. The temporary benchmark API uses normal Nest authentication/guards/contracts; only its service-role database client points to the clone. GoTrue/JWKS remain the real local stack. Private credentials/cookies/env files are0600 and never included in evidence. Do not run primary SQL suites concurrently with clone fixture writes: PostgreSQL XIDs are cluster-wide and an existing M14-04 simulated-snapshot test is sensitive to concurrent allocation.

Commands from repository root:

```sh
pnpm --filter contracts exec vitest run src/dashboard/schemas/portfolio.schema.spec.ts src/dashboard/schemas/portfolio-error.schema.spec.ts
pnpm --filter api exec jest portfolio --runInBand --coverage
pnpm --filter web exec vitest run app/_features/dashboard/portfolio
node apps/infrastructure/tests/m14-05-identity-parity.mjs
pnpm --filter infrastructure run test
pnpm --filter api exec jest --config test/jest-e2e.json portfolio.e2e-spec --runInBand
E2E_WEB_ORIGIN=http://localhost:3003 E2E_PORTFOLIO_FIXTURE=true E2E_CROSS_BROWSER=true pnpm --filter web exec playwright test e2e/m14-portfolio.spec.ts
pnpm verify
```

The clone-only benchmark runner rejects the primary database and rolls back by default. Explicit committed mode retains synthetic evidence for authenticated measurements. Run final measurements without builds or fixture writes competing for CPU/I/O. Report warm/cold samples, actual sample counts, raw timings, p95/p99, response size and API RSS independently of harness RSS. Wrapper EXPLAIN alone does not show inner SQL; nested auto_explain established the measured spool/sort bottlenecks. Do not label two-sample probes an SLO pass.

## Rollback

Disable/remove Portfolio action/page/routes and deploy previous compatible API/UI. Retain additive RPCs/source corrections and all source/audit evidence. No destructive down migration, data deletion, historical ledger repair or automatic cleanup. A rollback of the decimal correction requires explicit source-policy review because silently restoring unknown decimal severity changes source inputs again.

## Completion evidence

See [verification evidence](m14-05-verification.md) for the acceptance mapping, final test/load outcomes, screenshots and residual limitations. No legal certification, universal browser certification or zero-bug claim is made.
