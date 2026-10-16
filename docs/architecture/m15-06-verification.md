# M15-06 implementation and verification evidence

Implemented on `milestone-1`, starting at `618f26c9bf870298f1fcb39248af44351c69cec7`.
Changes remain uncommitted. Production execution is disabled by default and no
production release path has been qualified. No application table, column,
foreign key, migration, generated database type or dependency was added.

The implementation follows functional operator UI → gateway/transport → shared
Zod contracts → private Nest controller → application ports/policy → independent
host supervisor/native adapters → existing backup/audit/Supabase authorities.
Normal tenant ingress receives no upgrade authority or deployment credentials.

## Requirement-to-test mapping

| Acceptance                                                          | Implemented boundary and evidence                                                                                                                                                             | Verification scope                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Signed media, digests, trust, version paths and hostile archives | `packages/contracts/src/upgrades/schemas/index.ts`; `MountedUpgradeMediaVerifier`; `admitDockerSaveArchive`; `loadVerifiedUpgradeImages`; source/target receipts in `NativeUpgradeInspection` | Schema, wrong/revoked trust, tampering, traversal/link/special/duplicate/truncated archives, compression disguised as `.tar`, layer/config/platform/inventory substitution, byte/entry/deadline/cancellation and actual Docker-filesystem capacity tests. No malicious Docker load executed. |
| 2. Preflight and explicit initiation                                | `preflightUpgrade`; `NativeUpgradeInspection`; `UpgradeSupervisor`; `UpgradesWorkbench`                                                                                                       | Source schema/full ledger, fixed runtime, exact signed source images, unsupported paths, disk/memory/inodes, held verified backup/historical keys/licence, grant and review freshness; acknowledgement before apply.                                                                         |
| 3. Restart/idempotency/drain/effects                                | `UpgradeHostJournal`; `NativeFlock`; `UpgradeExecutionJournal`; `UpgradeExecutionEngine`; `MaintenanceGate`                                                                                   | Torn publication, SIGKILL stale socket, lost lock and owned descendant cancellation, durable command receipts, duplicate initiation, migration commit-before-ack, restart during rollback, positive drain, uncertain disconnects, bootstrap and nonce-prune fencing.                         |
| 4. Compatible image-only rollback                                   | Engine and `NativeLinuxDeploymentHost`                                                                                                                                                        | Exact authenticated previous images, signed target schema/full ledger proof, failed candidate readiness, retained schema/data, interrupted rollback, post-exposure prohibition and safety closure after grant revocation.                                                                    |
| 5. Integrity and outage target                                      | Semantic candidate/worker checks; existing M15-05 checkpoint verifier; reference harness                                                                                                      | Healthy API semantics and completed current-image worker cycles are tested. Native N/N−1/N−2 data/object/audit/candidate-write compatibility and the 30-minute benchmark remain unrun on the separate Linux reference host.                                                                  |
| 6. Air gap and private UI                                           | Fixed Compose/inventory/recipes; mounted media; private routes/gateway/workbench; strict redacted result                                                                                      | Real mTLS browser journeys for verification/preflight/explicit apply/success/rolled-back/blocked states, report download, desktop/mobile layout, keyboard focus and locale dates. Native egress denial requires external qualification.                                                      |
| 7. Failure/security/regression matrix                               | Colocated API/operator/contracts tests; source-evidenced architecture operation registers                                                                                                     | Invalid input/response, forged instance scope, missing authority, stale/conflicting versions, missing backup/key, incompatible runtime/schema, concurrent work, partial failures and revoked grants. Full customer auth/menu/session policy tests remain in the repository suites.           |

Native application tests: `apps/api/src/upgrades/**/*.spec.ts`. Operator tests:
`apps/operator/app/upgrades-{gateway,workbench}.spec.*`. Contract tests:
`packages/contracts/src/upgrades/upgrades.spec.ts`. Release harness tests:
`tools/upgrades/*.test.mjs`. SQL test:
`apps/infrastructure/tests/m15-06-upgrade-audit.test.sql`.

Additional regressions verify authenticated installed-state projection across
sequential upgrades and rollback with retained expanded schema; committed SQL
hashes become the next baseline. Missing signed SQL is published atomically only
after complete inventory validation. Post-import checks bind the exact run,
manifest and approved fingerprint, verify actual loaded images and remaining
capacity, and reject unrelated freshness changes.
Concurrent worker lanes cannot mask a hung, failed or missing configured lane;
health observations reset with generation/image changes. Managed agent ingress
performs an initial real nonce-pruning cycle. Successful or exposed rollback
commands return 409 before journal mutation, including crash-stale saved state;
the UI requires an explicitly recorded absence of exposure before offering rollback.

## Browser evidence

[Recorded assertions](evidence/m15-06/browser-journeys.json),
[desktop preflight](evidence/m15-06/operator-preflight-desktop.png),
[desktop success](evidence/m15-06/operator-success-desktop.png),
[desktop rollback](evidence/m15-06/operator-rolled-back-desktop.png),
[mobile rollback](evidence/m15-06/operator-rolled-back-mobile.png),
[mobile blocked checks](evidence/m15-06/operator-blocked-mobile.png), and
[exported allowlisted report](evidence/m15-06/simulated-upgrade-result.json).

Playwright MCP used at most two task tabs and reused them. No unrelated browser
or site data was cleared. Customer verification used the seeded owner on the
development server: sign-in, dashboard, product navigation and successful session
refresh. Cookie metadata confirmed HttpOnly access at `/` and refresh at
`/api/v1/auth/refresh`; values were never emitted. A customer request to private
upgrade routes returned 404; an ungranted test mTLS certificate returned 401.

The operator browser fixture uses the real static UI, mTLS listener/controllers,
shared contracts, signed media verifier, durable host journal and supervisor.
Docker/migration/backup/resource effects are explicitly simulated injectable
ports. Its labelled success/rollback reports and image IDs are fixture evidence,
not real artifact compatibility qualification. Desktop/mobile checks found no
horizontal page overflow. Keyboard focus and labels were exercised; a full
WCAG audit and previous/current multi-browser matrix were not run.

The [bounded metadata sample](evidence/m15-06/private-metadata-load.json) made 50
successful real mTLS/controller/journal reads with concurrency 5: p95 47.86 ms,
p99 48.80 ms. The existing 120/minute certificate limit also returned 429 when
exceeded. This sample does not establish performance for a large retained journal,
a production workload or the Linux reference deployment.

## Database alignment and source preservation

[Catalog and ledger evidence](evidence/m15-06/database-alignment.json) identifies
local `supabase_db_cra`, PostgreSQL 17.6: 296 public tables, 4,572 columns, 1,311
indexes, 47 RLS policies, 1,764 public functions and 432 user triggers. No forced
RLS was introduced. Live metadata shows 236 migration ledger entries versus 687
local migration files: 452 local versions are absent from the ledger and live
version `20261008114010` has no corresponding local file. This is confirmed
history difference, not proof that every corresponding schema effect is absent.
No history repair or schema alteration was attempted.

Supabase MCP project discovery has no matching CRA project; its local endpoint
was unavailable. Unrelated connected cloud projects were not queried. Local
catalog checks were read-only. New SQL assertions ran in the separate
network-disabled `cra_m15_06_sql_20261015b` container, using the same PostgreSQL
image, a schema copy, repository synthetic seeds and necessary global export
catalog/function-owner metadata. No customer data was copied. Nine assertions
pass, including idempotent append/replay/conflict, immutable redacted payload,
service-only grants and compatibility with the existing organization-only audit
chain boundary. Instance evidence is authenticated by the independent host
journal; no global chain/RLS migration was introduced.

The initial root test command unexpectedly included the repository's live SQL
runner; its suites use BEGIN/ROLLBACK, and it stopped at an unchanged M12 supplier
notification assertion. Subsequent SQL/root verification explicitly selects the
disposable container through `CRA_SQL_TEST_CONTAINER`. Turbo now forwards this
selector and never caches SQL tests. The M12 failure was traced to test ordering: its time-relative supplier reminder
could follow an older seeded reminder. The follow-up strengthens the exact claimed
delivery-ID assertion and schedules its fixture before existing reminders, without
changing their state or production SQL. The stronger assertion failed before the
fix and passed afterward. All 204 SQL files now pass on the isolated fixture.
The clone setup also reconstructs existing migration initialization and role
settings omitted by a schema-only copy. The original source stack was not reset,
upgraded, restored or deleted. Production was not accessed. Existing source
missing-object/backup-capacity blockers remain.

## Verification results

Final command results and coverage totals are recorded in the accompanying
`evidence/m15-06/verification-results.json`. All new/materially changed TypeScript
runtime modules meet 80% statement/branch/function/line coverage. Node's release
harness coverage reports line/branch/function metrics; each production harness
module exceeds 80% on those metrics. No coverage exclusion substitutes for native
qualification.

The follow-up full root gate is **green**:
`CRA_SQL_TEST_CONTAINER=cra_m15_06_sql_20261015b pnpm verify` exited 0, including
lint, type checking, architecture checks, all SQL/unit suites and the workspace
build. This supersedes the earlier M12-blocked root run.

Final independent suites passed: API 610 suites / 6,399 tests; web 249 files /
1,761 tests; contracts 93 files / 1,050 tests; operator 68 tests; release and
fixture checks 33 tests. The focused upgrade runtime run passed 392 tests with
94.09% statements, 89.46% branches, 94.80% functions and 95.55% lines; every
collected runtime file meets 80% on all four metrics. Operator coverage is
99.63% statements/lines, 94.86% branches and 100% functions. Architecture passed
160 checks with no dependency violations; all six workspace build tasks passed.
These counts describe local verification, not native release qualification.

## M12 follow-up E2E verification

A separate synthetic Supabase/Auth/REST/Storage/Mailpit stack, API on 3342 and web
on 3112 passed all 9 API E2E suites (30 tests) and the live authentication script
(33 checks, zero failures). Its authority and licence fixtures are independent;
no original development accounts, objects or preferences were modified.

Existing browser tabs were reused, with at most two task tabs and no site-data
clearing. Playwright MCP exercised sign-in and account navigation before its
transport disconnected. Chrome DevTools MCP continued on an existing blank tab:
validation, failed-save draft preservation, absence of automatic mutation replay,
explicit retry, persisted preferences, session refresh, tenant denial of private
operator routes and product navigation passed. Desktop and mobile captures are
[desktop](evidence/m15-06/m12-followup-preferences-desktop.png) and
[mobile](evidence/m15-06/m12-followup-preferences-mobile.png). The full web CLI
E2E suite and full browser matrix were not run; these focused journeys do not
establish native upgrade qualification.

## Additional browser verification

[Sequential browser follow-up](evidence/m15-06/browser-followup.json) records fresh
success, compatible rollback, blocked resources, stale approvals, concurrent
initiation, malformed-response recovery, media-change invalidation, result export,
post-exposure rollback rejection and terminal history after reload. All journeys
reused one existing Chrome tab. Playwright MCP remained disconnected. A loopback
certificate bridge connected the browser to the real task-only private listener;
separate direct HTTPS checks rejected missing/ungranted certificates, forged
instance scope, missing/cross-site origin and unbounded history. This bridge does
not qualify browser client-certificate provisioning.

Customer regressions exercised notification administration, health provenance and
mobile layout, licence/usage navigation, JSON/CSV exports, reconciliation replay
and conflicts, trend tables/filter/export consistency, audit search/detail and
viewer denial. Only the separate synthetic stack received task-owned audit/export
receipts and sessions. Production and original development data were untouched;
no site data was cleared and no new browser tabs were opened. The additional
upgrade API run passed 373 tests in 31 suites; operator tests passed 68 and
release/browser fixture checks passed 22.

Captures: [rollback desktop](evidence/m15-06/browser-followup-rollback-desktop.png)
and [rollback mobile](evidence/m15-06/browser-followup-rollback-mobile.png).
The complete Playwright CLI suite, browser-version matrix and native deployment
qualification remain unrun. Existing suites create new contexts/pages and some
launch global workers; this follow-up adapts selected scenarios to the requested
reuse constraint and does not claim execution of those entire suites.

## Rollout and remaining qualification

Follow [installation/recovery runbook](m15-06-upgrade-runbook.md) and
[feature design](m15-06-preflighted-upgrades.md). The fixed control image requires
digest-pinned PostgreSQL 17 tools and the reviewed Supabase CLI binary. No actual
container image build/import, live upgrade, source restore or destructive recovery
was performed for this ticket.

Independent reviews found and verified fixes for journal/socket/lock crash edges,
source-image substitution, maintenance interpretation, first selection, failed
worker cycles, revoked-grant safety closure, nonce pruning and preflighted bounded
image import, sequential installed-state projection, signed SQL publication and
post-import resource accounting. No proven HIGH finding remains in those scoped reviews; this is not
a guarantee that the system has no defects.

Real production paths remain blocked until authentic artifacts pass all native
reference scenarios with documented host resources, migration/ledger atomicity,
object/audit/licence/retention and previous-image compatibility, provider effect
safety, zero egress and measured upgrade/rollback duration. Unsupported SQL and
archive formats fail closed with an actionable supported-release procedure.
Journal authentication does not provide hardware-backed whole-host rollback
protection. Retain independent authority checkpoints and evidence.
