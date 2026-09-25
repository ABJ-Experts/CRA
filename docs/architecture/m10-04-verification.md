# M10-04 verification and release record

## Scope and release gate

This implementation uses the local `cra` Supabase stack and test-only framework fixtures. No IEC 62443-4-1, IEC 62443-4-2, or ISO/SAE 21434 normative text or production crosswalk is included. Release of those packs remains blocked until the precise editions, distribution rights for the deployment modes, rights evidence, and named review owner are recorded. The connected Supabase MCP projects were unrelated ERP projects, so local Supabase CLI and SQL were used; no remote project was changed.

## Requirement-to-test trace

| Requirement                                                                        | Evidence                                                                                                             |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Rights and exact editions                                                          | `upgrade.schema.spec.ts`; `m10-04-crosswalk-upgrade.test.sql` rights checks; import metadata checks in the migration |
| Version-specific curated relationships, direction, rationale, provenance, reviewer | Contract tests; crosswalk SQL suite; controller, repository, gateway, and panel tests                                |
| Advisory evidence reuse and independent applicability/validity                     | `m10-04-evidence-crosswalk.test.sql`; evidence reuse panel tests; no coverage-writing crosswalk path                 |
| Added/removed/changed/split/merged diff and impacted mappings                      | `m10-04-upgrade-flow.test.sql`, `m10-04-merged-upgrade.test.sql`; upgrade use-case and panel tests                   |
| Reviewed, atomic, idempotent upgrade with conflict and audit                       | Upgrade SQL suites, repository and use-case tests; selection bypass test                                             |
| Tenant/product isolation and RLS                                                   | New SQL suites plus `rls.test.sql`; controller permission tests and local browser tenant switch                      |
| Local owner browser and responsive state                                           | `apps/web/e2e/m10-framework-packs.spec.ts`, Chromium; screenshots below                                              |

## Commands and results

- `pnpm --filter infrastructure run db:start`: local stack started without reset.
- `supabase migration up --local`: additive M10-04 migration applied. Fresh shadow `supabase db diff` exited zero with no M10-04 differences; it still reports four unrelated existing function differences.
- `pnpm --filter infrastructure run db:types`: both generated type copies refreshed through the CLI.
- `pnpm --filter infrastructure run test`: passed, including 72 new M10-04 SQL assertions, existing M10-01–03, and RLS/schema invariants.
- Focused contracts, API, web, architecture, and export archive tests passed. New API and web module coverage was reported above 80% by their focused runs.
- `pnpm verify`: passed after the follow-up export-registry classification. The full run passed 272 API suites/2,261 API tests, 770 web tests, 498 contract tests, infrastructure SQL/RLS checks, lint, types, architecture checks, and build. Both new M10-04 review tables remain registered.
- `E2E_OWNER_EMAIL=owner@cra.test E2E_OWNER_PASSWORD=… pnpm --filter web exec playwright test --config playwright.config.ts e2e/m10-framework-packs.spec.ts`: 1 Chromium journey passed against local API and Supabase. Its run-scoped organization was cleaned up by the existing helper. No unrelated site data was intentionally removed. The repository Playwright runner was used because Playwright MCP was unavailable.
- `git diff --check`: passed. Prettier check passed for implementation source; CLI-generated database types retain CLI formatting.

## Browser artifacts

- Desktop selected framework: `/tmp/cra-m10-04-screenshots/m10-framework-tree.png`
- Desktop curated crosswalk empty state: `/tmp/cra-m10-04-screenshots/m10-04-crosswalk-empty-desktop.png`
- Mobile curated crosswalk empty state: `/tmp/cra-m10-04-screenshots/m10-04-crosswalk-empty-mobile.png`
- Desktop disabled framework: `/tmp/cra-m10-04-screenshots/m10-framework-disabled.png`

The initial browser command accidentally selected the whole suite and was stopped when missing cleanup configuration caused unrelated failures. The focused command then passed. Playwright cleared its tracked output directory at startup; the pre-existing tracked artifacts were restored from Git immediately. New screenshots were written outside the repository.

## Deployment, rollback, and limitations

Apply the additive migration, deploy the API, then web. No existing selection or mapping is backfilled or silently moved. Existing organizations continue to use their selected versions. To roll back application code, deploy the prior API/web binaries and leave the additive schema and immutable audit/history intact; do not delete the new review data. A committed upgrade is not silently reversed: restoring a prior choice requires a new explicit reviewed upgrade.

The follow-up classified the older M6–M9 tenant tables in `exportSourceExclusions` with table-specific security or portability reasons. It did not add partial evidence metadata to the export catalogue. A regression test confirms the worker never completes an archive if the artifact snapshot authority is unavailable. The production artifact snapshot adapter remains unavailable, so complete tenant exports still fail closed; a separate, reviewed byte-copy and restore contract is required before those domains can be exported. Passing the registry gate does not mean complete tenant export is implemented.

The local browser has no licensed target pack, so the complete decision UI cannot be exercised end to end with production content. SQL and component tests use approved test-only fixtures for that path. No realistic p95/p99 load benchmark or full cross-browser/WCAG audit was completed; these remain release verification items alongside the content-rights gate. No claim of legal compliance or zero defects is made.
