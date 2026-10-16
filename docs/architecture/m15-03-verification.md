# M15-03 verification evidence

Baseline: `milestone-1` at `4b5f6770417d8e8d408e2691f9679e7fc499c997`. All feature changes remain uncommitted on that branch. Existing contract drafts were preserved. No production connection, reset, retained-file deletion or historical ledger repair was performed.

## Requirement and test mapping

| Requirement                               | Concrete boundary and verification                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Separate operator authentication/exposure | `operator-main.ts`, `operator/operator-listener.ts`, `operator-security.ts`: opt-in private mTLS composition, raw authorized socket, fresh fingerprint grants, private route graph absent from `AppModule`; real TLS denies missing cert, forged forwarded headers, tenant JWT and revoked cert on keepalive.                                                         |
| Narrow registry metadata scope            | `operator/application/operator-registry.ts`, `domain/operator-grants.ts`, fixed `m15_03_operator_read`: instance/tenant tuple scopes, scoped cursors and strict successful schemas; no generic table query or evidence/impersonation endpoint. Real reader table/RPC denials and wrong-role tenant guard tests.                                                       |
| Public health compatibility               | Existing `health/health.controller.spec.ts` plus configured API E2E: original liveness/readiness bodies stay minimal; internal versions/queues appear only authenticated.                                                                                                                                                                                             |
| Tenant/source permissions                 | `system-health/infrastructure/supabase-health-source.adapter.ts`, all ten source RPC projections, `m15-03-source-queues.test.sql` and real `m15-03-source-projection-postgrest.test.mjs`: foreign scope denies; authorized health without source grant gives withheld/null, not zero. Explicit revoked authority returns full403; provider outages remain partial200. |
| Independent bounded probes                | `application/bounded-probe.spec.ts`, adapter cancellation tests, actual PostgREST lock/57014 test: real signal cancellation,250ms per source/four concurrent/900ms detail budget.                                                                                                                                                                                     |
| Honest health/provenance                  | Shared `system/schemas/system-health.schema.ts`, `operator/schemas`, pure health policies and eleven SQL migrations: source/measurement/receipt/attempt/success differ; stale M6/feed thresholds, null unknowns, strict future/order/digest checks; queue zero never implies worker liveness.                                                                         |
| Offline/unreachable instance              | Collector and transport tests: private configured HTTPS only, reject redirect/public target/malformed/overrun, retain last-success timestamps, first-ever failure has null observation/version/licence. Fair cycle budget and explicit target cadence prevent unlimited fan-out.                                                                                      |
| Backup assurance                          | Schema and SQL regressions reject fabricated healthy backup/provenance. Execution and verified restore are separately unknown until M15-05 supplies authority.                                                                                                                                                                                                        |
| Durable disclosure                        | Real PostgREST audit-fault injection scoped to a task operator returns no metadata and no partial receipt; subsequent healthy read commits M13 security-scope receipt. Diagnostic publication is latest-observation persistence, not an audit or regulatory decision.                                                                                                 |
| Expiry/export compatibility               | Isolated signed expired licence: actual product reads, normal CSV export worker rendering/private storage publication, parsed immutable manifest/session-bound grant/download and SHA-256 pass Chromium/Firefox/WebKit. Health/diagnostics do not authorize customer writes.                                                                                          |
| Operational accessible UI                 | Customer independent page/Organization tab and separate static operator app; parsed focused gateways, tenant/permission scoped cancellation; desktop/mobile keyboard/reduced motion/no-overflow. Real native-fetch receiver failure and overlapping licence labels observed RED, fixed and browser GREEN.                                                             |

## Executed checks

- Shared contracts:105 focused tests and970 full contract tests; all new schema coverage metrics >=80% (system/operator schema100%).
- Customer API:165 focused tests; all materially changed modules >=80% statements/branches/functions/lines. Authorization-race independent review approved after fix.
- Operator API:13 suites/69 focused tests;97.41% statements/94.91% branches/98.95% functions/97.42% lines, every new production module >=80% all four. Callable bootstraps are tested; executable require.main guards are not instrumented.
- Customer/operator UI:80 initial focused/regression tests; operator gateway follow-up17 tests with100% gateway/table coverage and aggregate99%+ across four metrics.
- Matching original local Supabase MCP: PostgreSQL17.6,293 public tables, eleven task migrations registered; one narrow latest-observation table. RLS enabled/non-forced, anon/authenticated/reader table SELECT denied, reader has no public/auth/storage table privileges. Fixed audited RPC only; PUBLIC new-function execution denied.28 operator-read receipts were present at the recorded cross-check (later tests append more).
- Live SQL:189 suites passed against original local stack, all rollback-scoped fixture changes retained no customer mutation. Focused first-unreachable/cycle-source-time regressions also passed after the last two migrations.
- Configured API integration:9 suites/30 tests passed. Initial unconfigured attempt correctly failed licensing startup; rerun used the original stable instance/public trust/policy revision, without bypass.
- Browser:15 original/isolated/operator cases passed in Chromium151.0.7922.34, Firefox153 and WebKit26.5. Additional operator layout checks cover actual painted text rectangles on desktop/mobile. WebKit private mTLS uses Playwright's isolated `local.playwright` loopback alias after physical127.0.0.1 server-chain verification; no hosts file or OS trust change. These are Playwright engines, not native Safari or current/previous released Chrome/Edge certification.
- Playwright MCP separately verified the actual original owner session, customer health and desktop/mobile screenshots; private certificate-only operator context showed measured instance metadata, no cookies and no page overflow. Other tabs/origins/site data were preserved.

## Screenshots

Customer [desktop](m15-03-evidence/customer-health-desktop.png), [mobile](m15-03-evidence/customer-health-mobile.png). Operator [desktop](m15-03-evidence/operator-registry-desktop.png), [mobile](m15-03-evidence/operator-registry-mobile.png). Final operator images are replaced only after the overlap regression passes and fresh visual review approves.

## Remaining measurement record

`pnpm verify` passed: zero-warning lint, types,148 architecture test cases plus docs/dependency checks,8298 unit tests and all production builds. Load, egress/restart and final security review results are populated below when the actual runs finish. Interrupted benchmark attempts are not successful runs. Every measured HTTP attempt, including safe503 and partial200 observations, is retained; unavailable source values remain null with explicit reasons. No server rate limit or probe timeout is raised to make a benchmark pass.

## Residual baseline qualifications

`supabase db diff` completed against its temporary shadow and reported existing historical check-constraint drift. No resulting destructive SQL was applied; task migrations remain additive. DB lint exits0 with historical warnings and no new M15-03 issues. The previously identified101 retained sources without physical bytes remain unresolved as instructed; health/accounting cannot reconstruct them. Backup/verified-restore assurance intentionally remains unknown. No zero-bug, legal certification or native-browser-version claim is made.

See [deployment/trust/recovery/rollback runbook](m15-03-runbook.md) and [feature design](m15-03-scoped-operator-system-health.md).

Final scoped visual review approved after the operator label overlap fix: Chromium/WebKit desktop and Firefox390px mobile captures plus actual painted-text rectangle assertions. All six labels are distinct. The operator static native-fetch receiver bug is fixed through a default `globalThis.fetch` wrapper; same-origin TLS credentials are allowed without importing tenant authentication. Matching assets/CSP hashes are deployed by restarting only the task-owned listener.

Supabase advisors flag the registry as RLS-enabled without policies ([linter explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)); that is intentional deny-by-default browser access, confirmed with explicit grant denials. Newly installed source indexes are reported as unused on the original local workload ([index advisory](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)); isolated realistic source plans use bounded index/index-only reads. These INFO observations do not justify deleting required boundaries or indexes.

## Final controlled load

The matching disposable local stack held10,000 registry tenants and100,000 source-queue rows. Each of six real Nest endpoints had200 measured attempts (1,200 total), four concurrent private operator reads plus two concurrent large/small-tenant customer reads, with2.2-second round pacing and unchanged120/min operator and60/min customer limits. All1,200 returnedHTTP200 and parsed scoped schemas; no retry, transport, throttle or semantic failures.

| Endpoint                   | p95 ms | p99 ms |
| -------------------------- | -----: | -----: |
| Operator instances         |  99.18 | 224.32 |
| Operator instance detail   | 146.62 | 299.26 |
| Operator tenants           | 168.46 | 347.92 |
| Operator instance metadata | 177.97 | 360.62 |
| Large tenant health        | 285.90 | 521.13 |
| Small tenant health        | 286.46 | 518.63 |

All meet the400/1,000ms targets. The large source queue was available199/200 times; its one bounded-timeout result carried null counts and an explicit unavailable reason. The small queue was available200/200. A1.46-second maximum host-contention outlier remains in the statistics. The complete [measured results](m15-03-evidence/load-results.json) retain every attempt. Query plans show bounded index/index-only access (large queue4.3ms, small0.05ms, registry0.27ms), rather than full-source scans on ordinary presentation reads.

Earlier failed runs remain separately retained in the task ledger: CPU-saturated concurrentCI (targets failed), expired disposable reader credential, overlapping orphan load processes and residual throttle counters. The final run used fresh task-only processes, a renewed identical narrow role, and an exclusive measurement lease. No production policy, limit, timeout or source permission was relaxed. CPU saturation can still degrade probes; these local results do not certify deployment capacity under arbitrary contention.

Independent final operator review/tests passed13 suites/73 tests,97.59% statements/95.00% branches/98.95% functions/97.61% lines. All19 instrumented production modules exceed80% in each metric. Three negative ordering characterization cases cover revision rollback, timestamp rollback and contradictory equal-revision time. The monotonic continuation correction is independently reviewed against rolling per-entity SQL semantics; it preserves tail progress without a false whole-sweep snapshot claim.

## Offline, restart, final gates and review

All six offline UI journeys passed: customer and private mTLS operator UI in Chromium151.0.7922.34, Firefox153 and WebKit26.5. Each browser explicitly blocked a non-local test fetch. Task-only API3340 and operator3446 also ran under non-loopback TCP/DNS denial. This is process/browser isolation; no host firewall, OS trust store, Docker-wide network or unrelated origin was changed. [Offline results](m15-03-evidence/egress-blocked-core-results.json) and [restart proof](m15-03-evidence/offline-restart-results.json) preserve exact scope.

Both backend processes restarted with egress denied. The signed expired licence was locally reverified as `expired_read_only`, authenticated health remained200, evidence-export preservation remained true, and backup assurance remained unknown. All10,001 registry rows retained the same metadata/source timestamp/digest checksum. Clone authentication regression passed33/33, including narrow refresh cookies, revocation, unlock/reset and lockout; Mailpit messages were preserved.

The final `pnpm verify` rerun after the monotonic-pagination correction passed lint, types,148 architecture cases/docs/dependency checks,8298 unit tests and all production builds. API514 suites/5447 tests; web245 files/1728 tests; contracts87 files/970 tests. Live local SQL189 suites and configured API integration30/30 passed. No open findings remain in independent backend/security, collector-fix or bounded customer/operator UI reviews. The collector correction's author's RED/14-test GREEN is recorded separately from the independent73-test/coverage validation; no missing historical evidence is inferred.

Screenshots: [offline WebKit customer](m15-03-evidence/offline-webkit-health.png), [offline WebKit operator](m15-03-evidence/offline-webkit-operator.png), plus desktop/mobile images above. There are21 total browser journeys across normal/expiry/offline/private scenarios, with the additional painted-label regression reruns retained. Native TLS proof has6 passes and2 explicitly fixture-dependent skips; unit/SQL fixtures cover cursor/collision edges omitted from the single-instance native smoke.

Supabase MCP remained fixed to original local127.0.0.1:54321. Clone55321 checks used guarded localCLI/SQL/PostgREST/API access, not a production connector or an invented MCP project selection. Final catalog still reports PostgreSQL17.6/293 public tables, enabled/non-forced registry RLS and zero reader table grants. Both CLI-generated type bodies agree; the API copy has only its generated lint/header prefix.

All changes remain uncommitted on `milestone-1`. Existing worktrees and data remain intact. Disposable task test services are stopped after evidence capture; fixture volumes are retained for reproducibility. Previously missing101 original physical sources remain untouched as requested. See the runbook for additive migration/observer/trust deployment and rollback preserving evidence and M15-01/02 enforcement.
