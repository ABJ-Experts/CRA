# M11-02 verification and operations

Implemented from clean `milestone-1` at `afe501a62dbb0aca0a6fb22b851be51ab6d20bc2`.
M11-01 remains the catalogue/vault foundation; only `reference_conformance` is
registered. No real vendor connections or external exactly-once guarantee is added.
The approved [plan](../superpowers/plans/2026-09-29-m11-02.md) and
[feature design](m11-02-durable-sync.md) describe the boundaries and decisions.

## BRD acceptance evidence

| Requirement                                       | Implemented boundary                                                                                                                                                           | Runnable evidence                                                                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| FR-INT-004: durable history and reconciled counts | Generation-fenced attempts, timestamps, adapter/map/schema/authority/cursor snapshots, record outcomes; whole-batch commit                                                     | `m11-02-sync-history.test.sql`, `m11-02-atomic-commit.test.sql`, `connector-sync-worker.spec.ts`                                                 |
| FR-INT-005: validated mappings                    | Parsed discovery and target schemas; bounded identity assignments; missing/null distinction; protected ownership preserved                                                     | `connector-field-mapping-policy.spec.ts`, `sync-plan-builder.spec.ts`, `field-authority-policy.spec.ts`, `sync-operations.spec.ts`               |
| FR-INT-006: retry and reviewed replay             | Safe classifications, five retries with capped equal jitter, Retry-After floor/deadline; linked child dry run, preserve/rebase/refetch preview, CAS/idempotency/current access | `connector-worker-failure.spec.ts`, `connector-sync-operations-use-cases.spec.ts`, `m11-02-sync-history.test.sql`, `m11-02-durable-sync.spec.ts` |
| Crash, race and tenant safety                     | Expired lease recovery, late-generation rejection, actor/approver fences, rollback and cursor CAS                                                                              | `m11-02-concurrency.e2e.sh` (32 competing claims), atomic-commit SQL, worker specs                                                               |
| Secrets and operational isolation                 | Fixed error codes, approved business snapshots, runtime canary rejection, no raw provider payload; service-only SQL                                                            | Use-case/worker/repository specs, live SQL grant tests, browser canary/foreign-tenant/viewer assertions                                          |
| Retention and export                              | Existing `connector_sync_record` authority; no automatic cleanup; attempt metadata registered, replay source/schema snapshots excluded                                         | `export-source-registry.architecture.spec.ts`, live sync-history SQL                                                                             |

Test files are under `apps/api/src/connectors`, `packages/contracts/src/connectors`,
`apps/infrastructure/tests` and `apps/web/e2e`. Tests were written and observed
failing before the corresponding fixes. Invalid records are isolated for operator
diagnosis, but the domain batch is withheld atomically; dead-lettering is never
counted as successful application.

## API and schema links

[Shared schemas](../../packages/contracts/src/connectors/schemas/sync-operations.schema.ts),
[parsed types](../../packages/contracts/src/connectors/types/sync-operations.type.ts),
[thin controller](../../apps/api/src/connectors/connectors-sync-operations.controller.ts),
[application coordinator](../../apps/api/src/connectors/application/connector-sync-operations-use-cases.ts),
[repository](../../apps/api/src/connectors/infrastructure/supabase-sync-operations.repository.ts),
[web gateway](../../apps/web/app/_features/connectors/connectors.api.ts).

All routes are under `/api/v1/connectors/:connectorId`:

| Method | Suffix                                                                   | Authorization  |
| ------ | ------------------------------------------------------------------------ | -------------- |
| GET    | `/field-mapping/schema`, `/field-mapping`                                | connector view |
| POST   | `/field-mapping/preview`, `/field-mapping`                               | connector edit |
| GET    | `/sync-history`, `/sync-runs/:syncRunId/history`, `/dead-letter-records` | connector view |
| POST   | `/sync-runs/:syncRunId/replay/preview`, `/sync-runs/:syncRunId/replay`   | connector edit |

Consumed body/query/path inputs and successful responses are parsed on both
sides. Existing strict list/detail projections remain compatible. The old
empty-body retry endpoint returns `409 preview_required`; ordinary sync cannot
bypass unresolved failed batches (`409 blocked_by_dead_letter`). Mutation refresh
never silently replays an action. Mapping and replay commands use the existing
ledger, authorization rechecks, expected versions, HMAC fingerprints and atomic audit.

## Verification observed

Final `pnpm verify` passed: lint, type checks, 58 architecture tests, dependency
gates, 324 API suites / 3,292 tests, 159 web files / 1,078 tests, 60 contract
files / 555 tests, all 82 infrastructure SQL files and production builds. The
existing test pools are bounded to two workers to avoid host starvation during
full-workspace/live-stack testing; test timeouts were not relaxed.

Focused changed-module coverage exceeded 80% statements, branches, functions and
lines: mapping policy 98.75/92.85/100/100; operations use cases
98.05/92.5/100/98.97; operations repository 100/95.83/100/100; worker
93.22/87.43/92.1/95; controller 100/80/100/100. Gateway, query and changed UI suites
also passed the four-metric threshold. Coverage output is generated locally, not
committed as source.

The live SQL suite contains 82 files, including M1–M10 gates and the new transaction
tests. Live auth shell verification passed 33 checks; API live suite passed four
tests. Refresh, revocation, narrow cookies, profile creation and recipient-scoped
mail testing passed. Earlier M3 grants/signup-trigger repairs remain documented
in [M11-01 verification](m11-01-verification.md); they are not new M11-02 work.

Browser journeys passed on Chromium **151.0.7922.34**, Firefox **153.0** and WebKit
**26.5**. An independent Playwright MCP seeded-owner journey passed on Google
Chrome **154.0.8037.58**, with Supabase confirming one completed record, two closed
attempts and zero failed/pending records. Keyboard activation, textual statuses,
reduced motion and mobile document overflow were checked. These installed engines
do not establish the requested current/previous-major matrix, and no automated
WCAG conformance certification is claimed.

Existing browser regressions covered access-control revocation/outage, session
refresh/lockout/logout, organization onboarding, M2 security artifacts and foreign
tenant scope, M8 evidence reads during integration outage, and M11-01 vault controls.
Onboarding exposed a pre-existing missing dashboard `SessionProvider`; reusing the
existing provider repaired the redirect and passed layout, onboarding and auth tests.
Seed-mutating M6 reporting and the globally consuming M3 ingestion-worker script
were not run; their unit/database gates were exercised instead.
The additional M10 custom-framework journey passed. M10 control-library browser
coverage remains unverified: its coverage worker was not running, and exact
fixture cleanup exposed the pre-existing `m10_invalidate_coverage_source`
organization-cascade update of `framework_coverage_scopes` after its product was
removed (`20260924102501_m10_03_permission_and_invalidation.sql`). No global worker
was started and no domain trigger/grant was changed. The exact fixture's coverage
scope was removed before its organization cascade; rollback rehearsal and commit
confirmed cleanup while unrelated control identities remained unchanged.

Browser screenshots were removed after verification.

[Read-load measurements](evidence/m11-02/read-load.json): 1,000 synthetic runs,
3,000 records, 1,000 attempts, 500 dead letters, page size 100, five concurrent
requests, 40 successful requests per endpoint while the installed worker polled
and the full gate ran. History p95/p99 **284/293 ms**, detail **122/123 ms**, dead
letters **107/110 ms**. All are below local targets; small-sample p99 is the maximum,
not a production guarantee. Preliminary 429s confirmed the unchanged rate limit;
the clean measurement respected its budget. Exact synthetic batch cleanup was
verified and unrelated data/mail/site state was preserved.
The independent MCP organization's connector, credential, product, run and attempt
fixtures were also removed through its guarded exact tenant cascade after screenshots;
the owner session was restored to its original CRA organization.

## Database alignment and deployment

MCP was reconfirmed against local `cra`, `http://127.0.0.1:54321`; metadata contains
249 public tables. Reused existing connectors/runs/plan items/command ledger and
added only `sync_run_attempts`. Applied additive CLI-created migrations:

- `20260929083706_m11_02_durable_sync_history.sql`
- `20260929084102_m11_02_source_identity_guard.sql`
- `20260929094729_m11_02_typed_replay_diagnostics.sql`

Both database-type copies were CLI-generated; their generated bodies match
(the API copy retains its documented header). New scoped foreign keys/indexes,
service-only RPC grants, pinned `public,pg_temp` search paths and enabled,
non-forced RLS were checked live. `db:lint --fail-on error` passed with no new
M11-02 warnings. The attempt table's no-browser-policy advisor is intentional:
browser roles have no table grants and the API owns verified organization scope.

A read-only CLI shadow diff exposed existing restored-stack drift: 488 statements,
including 33 constraint drops and nine default-privilege changes. No M11-02
schema drift was identified. This broad diff was **not applied**: the stack's
restored `full_schema` ledger is not interchangeable with a clean migration replay.
Existing unrelated advisor warnings and reporting RPC overgrants remain outside
this ticket. Do not blanket-push, reset, rewrite history or apply that diff.

Cutover: pause connector workers, apply the three additive migrations in order,
regenerate types, deploy compatible API and worker together, run live SQL/auth
and one fixture dry-run/commit, then resume workers. Completed legacy history is
preserved; missing timestamps/snapshots remain unknown. Legacy active plans
without a reliable mapping snapshot fail safely with `legacy_plan_requires_review`;
request fresh preview/refetch and manual review instead of inventing a backfill.

Rollback: retain additive schema, durable command/attempt/source history and vault
recovery keys; deploy a compatible generation-aware API/worker. An old unfenced
worker or pre-GCM vault binary is not a safe rollback target. No data reset or
destructive down migration is provided.

## Operator runbook and reproducible commands

Inspect failed run detail and per-record errors; correct configuration/mapping or
provider access, then review replay. Preserve original mapping and retained approved
source data by default. Explicit rebase or refetch creates a new preview; changed
options, access, ownership, cursor/configuration or versions invalidate old review.
Refetched work always requires a new manual commit, even under automatic policy.
If the provider retry floor exceeds the 24-hour run deadline, use reviewed recovery.
Never remove failed history to bypass the cursor blocker.

On restart, expired attempts close as interrupted and new claims increment the
lease generation. Late workers cannot save plans/failures/commits. Disconnect
invalidates work; a transaction committed before disconnect remains committed.
Keep records, active lineages, holds and cursor references under existing retention
authority. No automatic purge is introduced; unavailable authority blocks cleanup.

```sh
pnpm verify
pnpm --filter infrastructure run test
bash apps/infrastructure/tests/m11-02-concurrency.e2e.sh
pnpm --filter infrastructure run db:lint
pnpm --filter infrastructure run db:types
API=http://localhost:3334/api/v1 bash apps/api/test/auth-flow.e2e.sh
```

Run API live tests with the existing external environment loaded. Run Playwright
with mocks disabled, API/web on the same cookie hostname, seeded owner credentials
and the existing service key injected externally; use an isolated output directory
and one worker. `apps/web/e2e/m11-02-durable-sync.spec.ts` owns and cleans exact
generated tenants/fixtures, preserving unrelated inbox and storage objects. The
opt-in `run-m11-02-read-load.sh` requires explicit organization, connector and batch
UUIDs and cleans only that generated correlation batch.

Passing checks establish the tested flows, not zero bugs, automatic regulatory
compliance or exactly-once external delivery. Production-scale sustained provider
activity, real vendor schemas and a full accessibility/browser support matrix
remain unverified.
