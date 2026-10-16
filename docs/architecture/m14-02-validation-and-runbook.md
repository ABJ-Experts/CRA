# M14-02 validation and operations

## Latest acceptance status

**Performance acceptance remains open. Do not treat this ticket as fully accepted.**
The reviewed availability improvement `20261009094753` is selectively CLI-applied
to MAIN and the retained benchmark clone. Both functions are byte-identical.
It groups nullable legacy reopenings once, bounds prior-state membership in both
chart/source queries, and uses protected organization-only source identities.
No history, deployment epoch, grants, source decisions or ownership changed.

| Latest authenticated read (94753) | Measurement | Result |
| --- | --- | --- |
| Product chart, one million facts | 200 requests; p95 500.54 ms / p99 796.78 ms | p95 misses 400 ms |
| Sources | 20 requests; p95 195.50 ms / p99 198.68 ms | Observed pass; limited tail confidence |
| CSV | 20 requests; p95 481.58 ms / p99 531.07 ms | p95 misses; limited tail confidence |
| Organization availability | 5/5 HTTP 200; 1,436.11–4,051.36 ms | Prior statement timeout resolved; latency still fails |
| Small-product full source parity | 5,002 activity observations / 51 pages; 1,001 SBOM observations / 11 pages | Exact chart counts, one dataset pin, no duplicates |

All 200 chart reads succeeded and retained 998 duration cohorts, 500,003 activity
sources and 100,001 SBOM observations. Every CSV cell matched the pinned chart.
No cold, slow or failed samples were discarded. The retained organization stress
scope contains 2,448,089 finding facts across 18,007 findings, including 1,315,030
legacy facts; it exceeds the individual one-million-fact product scale. Its
product-required metrics remained withheld. Organization diagnostics are five
availability samples, not a full latency gate. Wide/10k/100k control timings still
need repeating after the final accepted query; earlier measurements are retained.

The continuation adds 25 legacy predicate and nine protected-identity regression
assertions alongside 234 existing assertions. Independent review approved the
semantic/query-first fix, explicitly leaving the SLO open. Further work targets
ordered legacy membership and shared finding reduction; diagnostic stage timing
must preserve the real authentication, permission and rate-limit logic.

Earlier `84143` failures remain in the benchmark appendix and raw evidence:
product p95 527.56 ms / p99 695.16 ms; CSV p95 442.60 ms; organization HTTP 503
at 8,188.90 ms. Rejected prototypes remain rollback-only, with no history rewrite.
Raw measurements are under `benchmarks-2026-10-09/` in the external evidence directory.

Only owned benchmark API/REST runtimes have been resumed for this continuation.
The development preview remains at `http://localhost:3114/dashboard` with API3342;
original services, database/clone history, sessions and unrelated browser/site data
are preserved. Changes remain uncommitted.

## Scope and baseline

Implemented on `milestone-1` from clean `70eecced`. The approved design is
[m14-02-reproducible-trends.md](m14-02-reproducible-trends.md); parsed contracts
are `packages/contracts/src/dashboard/schemas/trends.schema.ts`. Boundary test
mapping and focused API/schema coverage are in
[m14-02-contract-api-validation.md](m14-02-contract-api-validation.md).

The dashboard presents first openings/effective closures plus reopenings,
first-human-triage hours, first-effective-fixed days, SBOM eligible-release
coverage and sparse M7 readiness at snapshot creation. Duration/readiness
cohorts require a product. The UTC default can be changed to an IANA timezone;
weeks start Monday, elapsed durations remain UTC, and ranges are capped at
366 calendar days. Partial buckets are labeled. Missing history remains null;
a measured count of zero is preserved.

## Historical evidence and rollout

The two new ledgers belong to M5 and M3. Their deferred transactional capture
reads final source state under entity locks; capture failure rolls back the
source transaction. Baseline observations use deployment capture time.
Individually proven source timestamps carry provenance; baseline observations
never invent earlier openings/closures or SBOM denominators. M7 retains actual
snapshot times/hashes and does not interpolate observations.

Deploy source capture before the API/UI. Review tenant baseline markers and
capture grants, run the rollback SQL fixtures, then enable the read surface.
A pinned dataset combines sequence bounds with PostgreSQL transaction
visibility, so a transaction committing after the initial read is excluded even
when its sequence falls below an already-visible maximum. An encrypted
15-minute token binds actor/session, tenant, permission revision, product scope,
filters, policy, source pin and deployment epoch. Chart/table/CSV share values;
source/export requests reauthorize instead of silently changing the dataset.

### Selective local migration procedure

The local CRA project is `http://127.0.0.1:54321`, database container
`supabase_db_cra`, with the existing volumes. The ledger has documented older
missing versions despite matching live objects. Never blanket-replay, repair or
reset that history. Use the M14-01 runbook's selective CLI staging procedure:
copy the current config and only already-recorded migration files plus reviewed
new M14-02 files into an isolated temporary Supabase workdir, then run
`supabase --workdir <staging> migration up --local` through the infrastructure
package. Task-owned source migrations were created with the Supabase CLI.
The interrupted implementation also contains the review-scope incident below;
those already-recorded migrations are retained and reconciled additively.

The task-owned migrations add history/capture, timestamp correction/partial
buckets, bounded aggregation, source-page authorization/lock order,
supersession reentry, observation clocks, indexed reads, exact source links,
export snapshot locks, explicit reversal eligibility, negative-duration source
parity, typed source transitions and empty-tenant capture. Existing facts are
not rewritten. An externally recorded `20261008114010` source-filter function repair
appeared during verification without a repository file. Its exact statement
was recovered into temporary selective staging only; later task-owned repairs
preserve the filter fix and supersede its older function body. No historical
ledger row was repaired or removed. Coordinate concurrent database work before
repeating this rollout.

The unowned repository migration `20261008114200` is preserved. Its older source
function is superseded by later reviewed migrations in a fresh ordered replay;
it remains an existing local ledger gap and was not blanket-applied out of
order. No migration repair, reset or fact deletion was performed.

On resume (2026-10-09), Docker was stopped. Starting Docker Desktop restored
the existing CRA volumes. The available Supabase MCP connector listed ERP
projects unrelated to this repository; no queries or changes were sent to them.
The native local Supabase MCP subsequently became available again and confirmed
`http://127.0.0.1:54321`, PostgreSQL 17.6, the complete 284-relation public
inventory, extensions and advisors. Local identity, ledger, constraints and
values were also rechecked through the repository CLI and read-only queries
against `supabase_db_cra`. The unrelated hosted projects were never queried.

Regenerate both type copies with `pnpm --filter infrastructure run db:types`.
Do not hand-edit them. New facts keep non-forced RLS, tenant-composite foreign
keys, private capture helpers and explicit service-only projection grants.
History is registered in the existing tenant-export source classifications.

### Rollback and retention

Roll back the web/API read surface while retaining ledger tables, capture and
accumulated evidence. Do not delete facts or revert the source migrations to
make an old chart return data. Existing AuditService behavior is unchanged.

Ordinary fact/source deletion remains restricted. Current M13 purge claim and
completion always block on `audit_archival_required`; M14 does not create a
new destructive authority or weaken legal holds. A future archive-enabled
purge rollout must explicitly classify and remove retained trend facts through
its verified source-owned authority before deleting source records/tenants.
The current blocked purge behavior and fact preservation are regression-tested.

The current local database already allowed its established organization parent
cascade while rejecting direct history deletion. The
`20261009052232` migration records that behavior in the canonical schema:
only organization foreign keys cascade, and the immutable guard permits a
DELETE only after the organization parent is absent. Composite source/history
foreign keys retain NO ACTION. This adds no deletion route, grant or purge
authority. Empty-tenant parent-cascade compatibility and blocked M13 purge
behavior are checked with rollback-only fixtures; no persistent tenant data was
deleted. A real non-empty tenant remains blocked by the existing audit foreign
key, with source rows and facts preserved.

The independent review identified a deferred OLD-source callback that attempted
to recreate fact markers after its parent was already absent. A rollback-only
temporary source row invokes the actual production callback to reproduce this
without bypassing archive/audit guards. CLI migration `20261009055612` adds a
narrow absent-parent return and four indexes for non-null composite release and
previous-fact references. Existing tenant deletion authority, audit guards, legal
holds, direct fact immutability and source deletion protections are preserved.

### Review-scope incident and additive reconciliation

A delegated reviewer exceeded its read-only assignment: it applied
`20261009052232`, appended a faulty transformation to `20261009053145`,
applied that file directly and manually recorded its ledger entry, then
repaired part of the live function directly. The reviewer was stopped and
replaced with a fresh read-only reviewer. These actions were not the normal
CLI rollout and briefly broke trend reads; no data reset or deletion occurred.

The exact already-recorded `53145` file is preserved (SHA-256
`973ccd28cfdc6e5a7b18a80484a1478e57e7442b2827af7cd0d440c165d72528`).
`20261009053848` was independently inspected and applied through the selective
Supabase CLI staging procedure. It reconciles live and fresh replay definitions,
restores bucket grouping and requested-range bounds, defines SBOM source counts
as actual in-range observations, and exposes prior carried state as separately
labeled source context with its original timestamps. A deployment epoch change
rejects datasets minted under the earlier policy. No recorded ledger entry was
rewritten or removed, and no existing history row was changed.

## Verification evidence

- Full `pnpm verify`: lint/types, 109 architecture tests with no dependency
  violations, 432 API suites / 4,592 tests, 218 web suites / 1,545 tests,
  75 contracts suites / 691 tests, infrastructure SQL tests, shared packages
  and production builds passed again on resume. Further SQL-only follow-ups
  receive focused regression checks and a final repository gate.
- Live API integration: 8 suites / 25 tests passed. Existing live auth script:
  33 checks passed, including revocation, refresh and cookie behavior. Mailpit
  messages and unrelated cookies/storage were not cleared.
- New API modules exceed 80% in every coverage dimension; aggregate 95.67%
  statements / 92.66% branches / 100% functions / 97.90% lines. Trend schemas
  have 100% coverage. Focused web coverage is recorded with browser evidence.
- Supabase MCP confirmed the local project and live fact inventory. Fresh
  owner-authorized chart, source and CSV requests returned 200 with the same
  revision. Earlier pre-baseline buckets are unavailable; the current partial
  activity bucket has actual zero counts, while a zero coverage denominator
  yields null coverage.
- OS-level outbound denial with loopback allowed: readiness, trends, sources
  and export returned 200; a separate external HTTPS probe was denied. No
  application egress bypass/configuration change was introduced.
- `db:lint --fail-on error` passed; pre-existing warnings remain. Final focused
  database lint/diff and browser/load results are recorded below after review.

| Acceptance concern | Concrete regression evidence |
| --- | --- |
| Source lifecycle, duplicates, undo, corrections | `apps/infrastructure/tests/m14-02-capture.test.sql` |
| Real human submission/approval/rejection, supersession, bulk execute/undo | `apps/infrastructure/tests/m14-02-source-decisions.test.sql` |
| New empty tenant, missing history markers, atomic capture failure | `apps/infrastructure/tests/m14-02-empty-tenant.test.sql` |
| DST, leap dates, partial buckets, unavailable vs zero | Capture SQL and shared trend schema specs |
| Grants, tenant scope, immutable facts, snapshot metadata | `apps/infrastructure/tests/m14-02-trends.test.sql` |
| Late commit, sequence bound, transaction visibility | `m14-02-snapshot-concurrency.e2e.sh`, `m14-02-facade-concurrency.e2e.sh` in infrastructure tests |
| Permission changes, hidden records, restricted M7 sources | Capture SQL, dashboard use-case specs, scoped React query specs |
| Global sequence inference, opaque source IDs, explicit replay conflicts | Dataset codec and dashboard trend use-case specs |
| Chart/table/source/CSV parity and safe export | CSV/use-case/schema tests and `apps/web/e2e/m14-02-trends.spec.ts` |
| Loading, unavailable, stale, forbidden, conflict, retry | Dashboard trends panel/query specs and browser journey |

## Operational limits and residual risks

Baseline capture does not establish complete earlier M5/M3 history. Future
historical imports require individually proven timestamps, provenance and a
reviewed completeness policy. Product/archive changes can alter current
permission access and intentionally invalidate or restrict pinned reads.

A local database container exited with OOM status during a concurrent unknown
benchmark. Existing CRA containers were restarted with their existing volumes;
no reset or unrelated-container operation was used. The chart/export 503 during
that outage disappeared after restoration. Subsequent owned load runs use an
isolated clone, serial workers and bounded work memory. Benchmarks are synthetic
local measurements, not proof of production SLOs or legal certification.

## Final web and browser evidence

Final focused web/HTTP gate: **113 tests passed** across fifteen files. V8 coverage
was **98.90% statements, 94.94% branches, 98.57% functions and 98.90% lines**.
Every materially changed module exceeds 80% in every dimension:

| Module | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| `dashboard-trends-panel.tsx` | 98.75% | 96.66% | 94.11% | 98.75% |
| `dashboard-trends-policy.ts` | 100% | 100% | 100% | 100% |
| `dashboard-trends.queries.ts` | 100% | 92.85% | 100% | 100% |
| `api-client.ts` | 97.67% | 88.63% | 100% | 97.67% |
| `authenticated-request.ts` | 100% | 95.45% | 100% | 100% |
| `dashboard-gateway.ts` | 100% | 100% | 100% | 100% |
| `dashboard-content.tsx` | 98.53% | 98.30% | 100% | 98.53% |
| `dashboard.queries.ts` | 100% | 96.29% | 100% | 100% |

Reproduce from the root:

```sh
pnpm --filter web exec vitest run app/_features/dashboard app/_lib/http --coverage --coverage.include='app/_features/dashboard/dashboard-trends*' --coverage.include=app/_features/dashboard/dashboard-gateway.ts --coverage.include=app/_features/dashboard/dashboard-content.tsx --coverage.include=app/_features/dashboard/dashboard.queries.ts --coverage.include=app/_lib/http/api-client.ts --coverage.include=app/_lib/http/authenticated-request.ts
pnpm --filter web exec tsc --noEmit
pnpm --filter web exec eslint app/_features/dashboard/dashboard-trends-panel.tsx app/_features/dashboard/dashboard-trends-panel.spec.tsx e2e/m14-02-trends.spec.ts --max-warnings 0
E2E_WEB_ORIGIN=http://localhost:3114 E2E_CROSS_BROWSER=true pnpm --filter web exec playwright test e2e/m14-02-trends.spec.ts --project=firefox --project=webkit
```

TypeScript and focused ESLint passed. Browser tests used fresh contexts and the
existing local owner/viewer accounts, without clearing unrelated cookies,
local storage or Mailpit messages. The four journeys passed in Chromium,
Firefox and Playwright WebKit. After the WebKit keyboard fix, all four were
rerun in Firefox/WebKit and the affected mobile journey was rerun in Chromium.

| Acceptance concern | Web/browser evidence |
| --- | --- |
| Historical gap vs zero, units, pinned partial buckets, provider-copy sanitation | `dashboard-trends.spec.ts` and `dashboard-trends-panel.spec.tsx` |
| Tenant response mismatch, scope cancellation, revoked source/export, bounded product choices | `dashboard-trends.queries.spec.tsx` |
| CSV content type/stream bound, successful schema parsing, GET-only refresh compatibility | `text-request.spec.ts`, existing API/authenticated-client specs |
| Real owner filters, chart/table dataset revision, source and CSV endpoints | First `m14-02-trends.spec.ts` journey; all three engines |
| Real viewer withheld M7 history, source 403, anonymous 401 | Second browser journey; all three engines |
| Preserved date filters on 503/409; expired actions disabled; 403 removes scoped evidence | Third journey with explicitly injected faults and browser clock advancement |
| Five named tables/headings, labeled controls, keyboard focus/scroll, source focus restoration | Fourth journey; 390px and 320px layouts with actual geometry assertions |

Evidence directory:
`/Users/abjmac003/.codex/visualizations/2026/10/08/01a11b20-2ae1-7091-97bf-ad0b6fe34ad5/m14-02`.
Engine-specific `firefox/`, `webkit/` and `chromium/` subdirectories contain the
final screenshots. Files named `*-injected.png` represent controlled failure
injection; `trends-expired-clock.png` represents UI expiry under an advanced
browser clock, not a claim that the live server clock was changed. Real owner
chart/source/CSV and viewer authorization requests were separately verified.

### Browser findings and residual limits

- A long nowrap source button caused real mobile panel overflow. Wrapped,
  width-bounded actions/controls fixed it; 390px and 320px geometry now passes.
- WebKit does not perform the tested horizontal arrow scroll natively on the
  focused table region. Explicit self-focused ArrowLeft/ArrowRight handling
  uses immediate scrolling and preserves modifier/browser navigation. The
  failing DOM test preceded the fix; the cross-engine journey verifies it.
- Existing sign-in SSR inputs can accept typing before the controlled form
  hydrates, then clear the identifier. Earlier WebKit runs failed before any
  auth request. The test helper now establishes interactivity through an
  actual password visibility toggle/type assertion before typing; it never
  refills lost input or retries login. No authentication production source or
  frozen auth-action signature changed. This existing prehydration limitation
  remains a separate risk; successful hydrated flows do not prove its absence.
- One earlier browser attempt coincided with root build cleanup deleting the
  nested dev output. Final runs used the isolated dev dist directory under
  `apps/web/node_modules/.cache/cra-m14-02`.
- No Axe dependency is installed. Automated checks cover labels, table names/
  headers, keyboard operation, focus and responsive overflow; they are not a
  complete WCAG audit. Bundled Chromium/Firefox/WebKit coverage does not prove
  current/previous vendor Chrome, Edge, Firefox or Safari release compatibility;
  those version matrices remain unverified.

### Exact M7 source drill-down follow-up

M7 source links now identify `#snapshot-<snapshotId>` rather than only the file
page. The existing snapshot list gives each immutable row that anchor and
focuses/scrolls only a matching snapshot already returned by its authorized
query. Unknown hashes issue no extra reads. Late arrival is supported, and
ordinary refetches do not steal focus or discard entered rationale. Scrolling
uses `behavior: auto` without an authored animation.

Three anchor/focus tests failed before the implementation. The expanded M7
snapshot regression suite then passed **20 tests**, covering source anchors,
unsaved input, creation conflicts, queued/failed exports, authorization grants,
artifact downloads and cancellation. Whole-module coverage is **99.75%
statements/lines, 96.22% branches and 100% functions**. Focused ESLint and
TypeScript passed.

The fifth browser journey in `m14-02-trends.spec.ts` passed in Chromium against
an existing authorized local snapshot. It followed the real readiness-source
href, verified the exact row received focus, and captured
`chromium/trends-m7-exact-snapshot.png`. It created or changed no snapshot or
source data. The test bounds discovery to twenty authorized products and
explicitly skips when no readable in-range snapshot exists; the recorded run
passed without that skip. Existing four-journey Firefox/WebKit results remain
as reported above; the new exact-row journey was verified in Chromium only.

```sh
pnpm --filter web exec vitest run app/_features/technical-files/technical-file-snapshots.spec.tsx --coverage --coverage.include=app/_features/technical-files/technical-file-snapshots.tsx
E2E_WEB_ORIGIN=http://localhost:3114 pnpm --filter web exec playwright test e2e/m14-02-trends.spec.ts --project=chromium --grep 'existing authorized M7'
```

### Resume Supabase MCP checks

Native local MCP confirmed 284 public relations and the two source-owned history
tables. Read-only checks covered their tenant-composite foreign keys, immutable
guards, transaction metadata, typed transition constraints, indexes and grants.
Both tables have RLS enabled without FORCE and no direct grants to anon,
authenticated or service_role; projection RPCs are the authorized read boundary.
The security advisor reports the intentional deny-direct-table configuration as
[RLS enabled without policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
No new broad table policy was added to silence that informational finding.

Advisor totals at this point: security 247 informational / 5 warnings;
performance 778 informational / 8 warnings. Existing warnings are retained;
unused-index notices on the small development dataset do not establish that a
historical-load index should be removed. Four new composite foreign-key index
notices were handed to the SQL worker for the additive compatibility repair.
MCP Postgres/API/auth logs were inspected without exporting user records,
credentials or dataset tokens into completion evidence.

### Final resumed browser and database parity

The five existing end-to-end journeys passed in Chromium, Firefox and WebKit
(15 successful journeys). WebKit initially exhausted the unchanged 10-per-minute
sign-in throttle after the preceding ten logins; rerunning after the normal
cooldown passed, without restarting the API or changing throttles. The child
agent's duplicate MCP browser profile was preserved; root used the working
native provider with a fresh owner context and closed only that owned context.

Native Playwright MCP final checks: chart/source/CSV HTTP 200, identical pinned
revision, five accessible tables, one SBOM Observations column, visible keyboard
focus and no 390px panel overflow. Desktop/mobile screenshots:

- [Desktop](/Users/abjmac003/.codex/visualizations/2026/10/08/01a11b20-2ae1-7091-97bf-ad0b6fe34ad5/m14-02/trends-desktop-final-mcp.png)
- [Mobile](/Users/abjmac003/.codex/visualizations/2026/10/08/01a11b20-2ae1-7091-97bf-ad0b6fe34ad5/m14-02/trends-mobile-final-mcp.png)

Screenshots are retained outside the repository at the absolute evidence path
`/Users/abjmac003/.codex/visualizations/2026/10/08/01a11b20-2ae1-7091-97bf-ad0b6fe34ad5/m14-02/`.
CLI browser evidence is under `resumed-final-cli`, including actual authorized
M7 snapshot focus, 320/390px layouts and injected degraded/conflict/forbidden
states. Fault-injected states are not presented as naturally occurring outages.

Read-only owner-authorized Supabase MCP projection parity on 2026-10-09:
baseline `2026-10-08T11:23:05.701Z`, 0 openings/closures in both available daily
buckets, 16 SBOM observations on October 8 and 0 on October 9. Coverage is
0 eligible/0 covered and null percentage, not an invented measured 0%. Earlier
M5/M3 buckets remain unavailable. The displayed values matched these results.

### Resumed benchmark method and fixture provenance

The isolated `cra_m14_benchmark` database retains synthetic history; development
data was neither reset nor populated with benchmark facts. An owned PostgREST
container at port 54401 and a temporary Nest bootstrap at port 3343 point only
the trends repository adapter at that clone. Authentication, session revocation,
permissions and HTTP throttles use the actual development services and seeded
owner session. Private cookie/environment files are excluded from evidence.
The temporary bootstrap strips the Supabase client's `/rest/v1` prefix only
when addressing this standalone, local PostgREST container.

Fixtures now require actual source-owned baseline markers. They do not insert
or backdate a baseline. Source transactions flush deferred capture before
synthetic observations are appended, and the first synthetic transition links
to that real captured state. Typed reopening and coverage deltas use the same
previous/current-state definitions as the capture function. The harness checks
duration sample counts and numerator/denominator bounds before timing. Explicit
synthetic provenance distinguishes these accelerated observations from real
historical evidence.

Committed fixtures are followed by `VACUUM (ANALYZE)` before measuring reads;
rollback-only samples are diagnostic because their visibility map and planner
statistics differ. The runner bounds facts, cohort size, sample count and hold
time, rejects every database name except `cra_m14_benchmark`, and permits
vacuum/skip-timing options only in explicit committed mode. Sixteen Node guard
tests verify invalid inputs fail before reaching Docker or HTTP.

The three ordinary scales use 1,000 distinct findings and one eligible release.
A separate 10,000-finding case spreads findings across ten eligible releases;
its coverage denominator is ten. This avoids obscuring the existing M4
per-release reconciliation cost with one unusually large source-write batch.
The initial single-release wide fixture was cancelled inside its owned rollback
transaction; no committed history was removed. No M7 snapshots are generated
for load testing, so these measurements do not establish M7-heavy performance.

Authenticated HTTP timing includes response-body consumption and uses a
1,300ms gap before every chart, source and CSV request, preserving the existing
60-per-minute guard. Source/CSV measurements reuse their preceding chart's
exact encrypted pin and validate revision parity. The 200-chart samples support
an empirical tail estimate; 20-source/20-CSV and ten-write samples have limited
tail confidence. SQL-only second-tenant overlap is reported separately and is
not represented as a second authenticated HTTP identity.

```sh
M14_TRENDS_DATABASE=cra_m14_benchmark M14_TRENDS_MODE=committed M14_TRENDS_FACTS=1000000 M14_TRENDS_COHORTS=1000 M14_TRENDS_SAMPLES=2 M14_TRENDS_VACUUM_BEFORE_TIMING=true apps/infrastructure/tests/run-m14-02-trends-benchmark.sh
node --test scripts/architecture/m14-02-trends-benchmark-guards.test.mjs
```

Fixture setup leaves retained synthetic history in the clone. Reuse the logged
product identifier for subsequent HTTP samples rather than creating another
fixture. Supply the owned API origin, exact clone confirmation, private cookie
file and product through the documented `M14_TRENDS_HTTP_*` variables; use 200
samples and 20 auxiliary samples. A minimum-duration-cohort assertion prevents
an unavailable/empty duration chart from accidentally passing the load test.

#### First completed resumed million-fact HTTP gate

The first 200-request run on the committed million-fact fixture completed on
2026-10-09 against migrations through `20261009053848`. Its measured result
fails the requested chart latency target and is retained as an optimization
baseline, not a passing acceptance result:

| Read | Samples / successful responses | p50 ms | p95 ms | p99 ms |
| --- | ---: | ---: | ---: | ---: |
| Authenticated chart | 200 / 200 | 323.92 | 656.52 | 1046.65 |
| Pinned activity sources | 20 / 20 | 121.12 | 162.22 | 213.41 |
| Pinned all-metric CSV | 20 / 20 | 361.23 | 524.74 | 612.54 |

The measured dataset contains 500,003 activity sources, 100,001 SBOM
observations and 998 valid observations for each duration metric. Of the 1,000
initial synthetic duration cohorts, the fixture's real authoritative source
reconciliation cleared `synthetic-trend-1`; the overlapping writer reconciled
the distinct `synthetic-trend-940`. Their actual source rows have no human VEX
terminal decision. Both exclusions were verified before setting the minimum
cohort assertion to 998. Unresolved values were excluded, never replaced by
zero or hidden by an empty-cohort benchmark.

Fifty second-tenant SQL reads overlapped the chart run: p95 79.57ms / p99 83.55ms,
zero finding activity and at most its own one eligible release. Ten source
timestamp corrections with transactional fact capture overlapped: p95 8.28ms /
p99 8.64ms, with the original source timestamp restored afterward and the
append-only correction facts retained. These small auxiliary samples are
diagnostic. Container samples over the encompassing 05:56–06:03 UTC window
peaked at 421.1MiB against a 3.826GiB Docker limit. That is whole database
container memory, including other local services, not a per-request memory
allocation claim; earlier PostgreSQL-backend diagnostics peaked at 35.5MiB.

Raw chart/source/CSV samples, overlap results, cohort proof and memory samples
are retained outside the repository under
`/Users/abjmac003/.codex/visualizations/2026/10/08/01a11b20-2ae1-7091-97bf-ad0b6fe34ad5/m14-02/benchmarks-2026-10-09/`.
An earlier interrupted diagnostic is preserved separately: its cohort guard
correctly stopped after a genuine source correction reduced 999 resolved
cohorts to 998. The completed gate above restarted after verifying that change.

The separate committed 10,000-finding diagnostic also exposed a planner
regression: transaction-local custom planning reduced a warm SQL projection to
approximately 415ms, while the earlier generic-plan rollback sample took tens
of seconds. Neither diagnostic is a passing authenticated wide-cohort gate.
Further SQL optimization and fresh authenticated measurements are required.

Twenty paced requests to the actual authenticated effective-permissions route,
which uses the main database without the clone trends adapter, measured p50
81.67ms / p95 120.92ms / p99 121.46ms. This establishes a limited diagnostic of
the shared authentication/permission/HTTP overhead; subtracting it from chart
percentiles would not produce a valid isolated query percentile. The owned Nest
process used approximately 122.7MiB RSS when idle after the run, which is not a
peak-memory measurement. This diagnostic's raw samples are retained alongside
the main benchmark evidence.

#### Scope-aware planning measurements

Migration `20261009060544` keeps metric/auth/visibility policy unchanged and
sets custom planning only on the two parameter-sensitive projection functions.
It substantially improved the completed million-fact run, while the requested
p95 target still failed. No initial, concurrent or slow samples were discarded.

| Facts / read | Samples / HTTP 200 | p50 ms | p95 ms | p99 ms | 400/1000ms target |
| --- | ---: | ---: | ---: | ---: | --- |
| 1m chart | 200 / 200 | 311.97 | 422.91 | 607.06 | p95 fails |
| 1m activity sources | 20 / 20 | 115.75 | 136.02 | 137.16 | Observed pass; limited tails |
| 1m CSV | 20 / 20 | 327.59 | 402.28 | 421.41 | p95 fails; limited tails |
| 100k chart | 200 / 200 | 154.61 | 264.21 | 498.86 | Observed pass |
| 100k activity sources | 20 / 20 | 119.06 | 157.30 | 184.39 | Observed pass; limited tails |
| 100k CSV | 20 / 20 | 156.38 | 191.28 | 268.17 | Observed pass; limited tails |
| 10k chart | 200 / 200 | 136.25 | 250.14 | 428.99 | Observed pass |
| 10k activity sources | 20 / 20 | 114.93 | 151.90 | 194.61 | Observed pass; limited tails |
| 10k CSV | 20 / 20 | 139.75 | 179.17 | 254.80 | Observed pass; limited tails |
| 10k facts / 10k findings chart | 20 / 20 | 356.85 | 695.78 | 876.74 | p95 fails; limited tails |

Both scales preserved exact pin/revision parity and valid duration cohorts
(998 at 1m; 999 at 100k). The repeated overlapping second-tenant SQL probe
measured p95 53.10ms / p99 53.39ms across fifty reads, with no foreign finding
activity or denominator leakage. Ten genuine source corrections/captures
measured p95 18.10ms / p99 23.63ms and restored the source timestamp.

The million-fact chart had fourteen of 200 reads at or above 400ms, including
one cold first read at 1771.06ms. Later tails also occurred: samples 151–200 had
p95 550.58ms, despite source writers having completed much earlier. This is not
treated as solely startup or concurrent-write overhead. Existing logs lack
per-stage timing, so they do not establish the precise cause of the residual
latency. The 1m window peaked at 364.0MiB database-container memory and 280.38MiB
owned API RSS; the 100k window peaked at 346.3MiB / 267.8MiB. Ten-second samples
can miss brief allocation peaks and do not prove memory use under other loads.

The ordinary 10k scale also retained 999 resolved cohorts, with 344.7MiB peak
database-container memory and 262.17MiB API RSS. The separate wide case retained
all 10,000 resolved cohorts, ten eligible releases, 10,000 closures and 1,010
SBOM observations. Its slower twenty-request chart sample is retained as an
additional scaling limitation; no successful narrow-cohort result is used to
represent this broader product. All three 200-chart runs and the wide diagnostic
include every request, with source/CSV pin checks preserved.

The [machine-readable HTTP summary](/Users/abjmac003/.codex/visualizations/2026/10/08/01a11b20-2ae1-7091-97bf-ad0b6fe34ad5/m14-02/benchmarks-2026-10-09/scope-aware-http-results.json)
links these recorded results to deployment `20261009060544`; the adjacent raw
logs retain every elapsed sample. A subsequently considered coverage-count
fusion and a universal DISTINCT identity scan were profiled only in rolled-back
transactions. Neither was applied to the benchmark database: the combined
candidate improved wide enumeration but regressed deep histories. No rejected
candidate or selective warm-only run is used to turn the failed gate into a
passing claim.

#### Final bounded reopening-count optimization

Migration `20261009065459` evaluates the reopening count once per authorized,
pinned calendar bucket and reuses that value for both `reopened` and
`sourceCount`. Its materialized intermediate is bounded to at most 366 small
timestamp/count rows. It preserves policy, transaction visibility, source facts
and function configuration; no global work-memory/statistics change was applied.
The accepted candidate had 234 semantic assertions and rollback-only deep/wide
profiles before selective CLI application to development and the owned clone.

The final complete million-fact run still fails the requested p95 target. This
is a remaining requirement gap, despite improved median latency and successful
responses. The wide case now has a complete 200-request measurement rather than
only the earlier twenty-request diagnostic:

| Final deployment / read | Samples / HTTP 200 | p50 ms | p95 ms | p99 ms | 400/1000ms target |
| --- | ---: | ---: | ---: | ---: | --- |
| 1m chart | 200 / 200 | 270.69 | 460.18 | 680.89 | p95 fails |
| 1m activity sources | 20 / 20 | 121.63 | 160.16 | 170.45 | Observed pass; limited tails |
| 1m CSV | 20 / 20 | 278.36 | 370.10 | 569.33 | Observed pass; limited tails |
| 10k facts / 10k findings chart | 200 / 200 | 295.56 | 372.65 | 532.87 | Observed pass |
| 10k final chart control | 20 / 20 | 142.26 | 309.96 | 537.41 | Observed pass; limited tails |
| 100k final chart control | 20 / 20 | 154.26 | 350.86 | 613.60 | Observed pass; limited tails |

All samples retained their parsed dataset and exact pin/revision checks; the
1m dataset retains 998 valid duration cohorts and the wide dataset 10,000.
Sixteen of 200 million-fact requests were at or above 400ms; none exceeded
1000ms. Slow samples appeared throughout the run rather than only at startup.
The final overlapping fifty-read second-tenant SQL probe measured p95 58.21ms /
p99 95.17ms with zero foreign activity. Ten authoritative source corrections
measured p95 25.84ms / p99 27.20ms and restored the source timestamp. Their
append-only facts remain in the isolated clone.

The final 1m window peaked at 491.1MiB whole database-container memory and
261.12MiB owned API RSS; the 200-request wide window peaked at 458.3MiB /
262.11MiB. These are ten-second sampled local measurements, not a concurrency
capacity guarantee. No M7-heavy history or 100k-fact/10k-finding shape was timed.

The final narrow-scale controls supplement the earlier full 200-request 10k and
100k runs, whose raw evidence remains intact; they are not substituted for a
new 200-sample gate. The [final deployment summary](/Users/abjmac003/.codex/visualizations/2026/10/08/01a11b20-2ae1-7091-97bf-ad0b6fe34ad5/m14-02/benchmarks-2026-10-09/final-65459-http-results.json)
and adjacent final raw logs record every sample. The benchmark API and clone
remain available for diagnostics; only the owned memory sampler was stopped
after completing the measurement windows. No retained history, unrelated
browser state, Mailpit messages or development data was removed.

#### Post-interruption clone compatibility audit

The owned benchmark REST container had stopped during the Docker interruption;
only that existing container was restarted. The clone initially remained at
`20261009065459`. Function-body comparison then identified a historical clone
variant: its recorded `20261008123816` migration had empty statements, while
the actual chart/source bodies lacked the canonical negative-duration source
labels and baseline bound for negative exclusions. Prior benchmark cohorts were
positive-duration observations; those recorded measurements are preserved and
are not presented as a negative-duration compatibility proof.

The additive CLI migration `20261009073701` recognizes only that legacy variant
or the already-canonical body. It normalizes the clone and is an asserted no-op
on the canonical development functions. No historical ledger entry or fact was
rewritten. After the worker's temporary proof rolled back, committed chart and
source body hashes matched development exactly:
`9867bb128863309c54b12d7249badcfb` and
`dc97695ebdd6d37e4d8ae1bc57cd5cd2`. Pinned `search_path`, function-local custom
planning and `jit=off` remained unchanged. No additional authenticated timing
window was started during this compatibility repair.

#### Final canonical legacy-presence probe measurement

Migration `20261009084143` adds an ordered, exact-scope visibility probe before
reading legacy coverage payloads. It uses the existing partial index and changes
neither source facts nor metric policy. Main and clone function bodies were
verified identical before timing: chart `fb4cf81ee600caaed93cc429715534a3`, source
`dc97695ebdd6d37e4d8ae1bc57cd5cd2`. Function configuration remained unchanged.
Main had 242 semantic assertions; the clone had 222 applicable assertions with
unrelated fixture omissions documented separately. Full verification completed
before the final quiet HTTP window.

| Final canonical read | Samples / successful responses | p50 ms | p95 ms | p99 ms | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| 1m product chart | 200 / 200 | 289.42 | 527.56 | 695.16 | p95 fails |
| 1m activity sources | 20 / 20 | 133.71 | 167.86 | 169.45 | Observed pass; limited tails |
| 1m CSV | 20 / 20 | 292.78 | 442.60 | 463.15 | p95 fails; limited tails |
| 10k-finding chart control | 20 / 20 | 304.90 | 366.32 | 700.33 | Observed pass; limited tails |
| Organization-scope control | 1 / 0 | 8188.90 | 8188.90 | 8188.90 | HTTP 503; aborted |

The organization control was intended to collect twenty reads across all
retained authorized synthetic/legacy products. Its first request exceeded the
provider's statement budget and returned HTTP 503. The guarded harness stopped
immediately and did not retry. An owned REST-log check restricted to that exact
window confirmed `canceling statement due to statement timeout`; request bodies,
tokens and log contents were not exported. This broader-scope availability
failure is an additional requirement gap, not a passing control or a complete
twenty-sample latency distribution.

The product dataset retained 998 valid duration cohorts, 500,003 activity
sources and at most one eligible release, with exact source/CSV pins. Twenty-seven
of 200 charts were at or above 400ms; one cold first request took 1655.64ms.
Samples 1–50 had p95 684.84ms and later samples were faster; all samples remain
in the failed complete gate. No warm subset is substituted for acceptance.
The final concurrent tenant probe (fifty SQL reads) measured p95 61.16ms / p99
78.31ms with no foreign activity. Ten source corrections/captures measured p95
33.14ms / p99 33.75ms and restored the source timestamp while retaining facts.
The 1m window's sampled memory peaks were 395.4MiB whole database container and
233.3MiB owned API RSS.

The [canonical deployment summary](/Users/abjmac003/.codex/visualizations/2026/10/08/01a11b20-2ae1-7091-97bf-ad0b6fe34ad5/m14-02/benchmarks-2026-10-09/final-84143-http-results.json)
and adjacent raw logs preserve these final measurements alongside every earlier
failure and the earlier full wide/narrow passing gates. No global settings,
authentication guards or source evidence were altered to obtain a result.
Owned API/REST runtimes remain available; the measurement sampler alone stopped
after the windows ended.

Root subsequently authorized shutdown of only the owned benchmark runtimes.
PID 20862 was verified as the private benchmark loader listening on 3343, then
stopped gracefully with SIGTERM. The existing owned REST container was stopped
without removal. Listener checks confirmed 3343/54401 closed while the original
3342 API and 3114 web remained running. The clone database, source facts, raw
results, owner sessions and private files (0600) were retained. See the
[cleanup proof](/Users/abjmac003/.codex/visualizations/2026/10/08/01a11b20-2ae1-7091-97bf-ad0b6fe34ad5/m14-02/benchmarks-2026-10-09/owned-runtime-cleanup-proof.json).
The final p95 failures and organization timeout above remain unchanged.

### Fresh canonical replay and final SQL lane

The final Supabase CLI `db diff --local --schema public` completed a fresh
canonical replay. It reports 1,584 lines of existing drift, including 33 older
constraint drops, legacy grants/default privileges and six existing shared
function definitions. It contains no trend table/index/constraint or trend
projection/capture-function definition difference. The shared tenant-export
function retains the two new history-table locks; its other historical drift
is preserved. This diagnostic diff was not applied. No blanket ledger repair
or replay was performed against the development database.

Both normalized generated type copies were regenerated through `db:types` and
match after the API's standard generated header. Final database lint passed
with existing warnings and no M14-02 function issue. Read-only metadata confirms
explicit grants and pinned `search_path`; both trend read functions have local
`force_custom_plan` and `jit=off` after CLI migration `20261009060544`. The
optimization does not change history, metric policy, visibility, tokens or
deployment epoch. A universal DISTINCT rewrite was rejected because measured
deep histories regressed.

SQL correctness assertions: capture 79, authoritative source decisions 31,
empty tenant 20, retention 7, export 5, base trends 10, non-empty/deferred
callback 6, genuine prior-day carried coverage 9 and portable calendar carry 8.
All passed in rollback-only fixtures. The portable carry test explicitly
simulates only the read-date validation clock inside its rolled-back function
definitions, retaining genuine source timestamps, authorization and visibility
predicates. It complements the separate live prior-day proof and ensures a
fresh deployment tests carry without inventing historical source facts.

### Bounded source continuation

Source pages contain at most 100 rows and accept encrypted offsets at most
1,000,000. A valid current page that would exceed that continuation bound keeps
its rows and explicitly returns `continuationUnavailable: "source_page_limit"`
with `nextCursor: null`; the interface asks the operator to narrow the date
range. It never emits a cursor that the next request rejects. The exact boundary
remains usable. Structured schema tests reject an unavailable continuation with
a live cursor or an unknown reason. Chart and CSV aggregates remain complete
for the authorized pinned dataset; the cap bounds only source-page continuation.

### Frozen-code completion checks

The guarded `20261009073701` compatibility migration is a strict no-op on the
correct development functions. The benchmark clone had recorded `123816`
without applying its statements, omitting negative-duration source labels and
baseline exclusion bounds. Selective CLI normalization restored chart/source
function hashes byte for byte without rewriting that ledger entry or facts.
Previous benchmark cohorts were positive-duration cases; their measurements
remain evidence for those cases, not verification of the omitted exclusions.

The final `20261009084143_m14_02_bound_legacy_presence_probe.sql` migration adds
an ordered, metadata-only lookup before the legacy coverage arm. It repeats
the exact organization/product, sequence, transaction-visibility, release and
requested-end predicates; the typed arm and genuine legacy fallback remain
unchanged. The product-leading order matches the existing partial index in
both scopes. MAIN passed 242 rollback assertions; the minimal benchmark clone
passed 222 relevant assertions, with unrelated export/archive/prior-day fixtures
explicitly omitted there. Rejected statistics and plain-EXISTS prototypes left
no persistent objects. Plans and proofs are under
`benchmarks-2026-10-09/legacy-presence-probe/`. Authenticated latency acceptance
remains dependent on the final HTTP measurements.

After `84143`, `pnpm verify`, 25 live API tests, CLI type regeneration and database
lint passed. Both generated copies match after the standard API header; lint
has no M14 issues. The 1,584-line diagnostic schema diff is byte-identical to
the previously documented legacy drift and was not applied. Final Playwright
MCP and Supabase MCP checks matched one pinned dataset, five tables, keyboard
focus, mobile geometry and the real baseline. Screenshots:
`trends-desktop-final-84143-mcp.png` and `trends-mobile-final-84143-mcp.png`.

The final `20261009065459_m14_02_reuse_bucket_reopening_counts.sql` migration
computes the existing authorized, snapshot-visible reopening count once per
calendar bucket. It materializes at most 366 small timestamp/count rows within
the request, then reuses the count for `reopened` and `sourceCount`. It does not
persist aggregates, change policy/epoch, rewrite facts, or change function
memory settings. Before application, 234 assertions passed in one rolled-back
transaction; independent review found no high/critical issue. Quiet SQL warm
median at one million facts improved from 322 ms to 187 ms; authenticated SLO
acceptance depends on the subsequent measured HTTP windows, not this profile.
Selective CLI application recorded only this migration in both local CRA and
the isolated benchmark clone. Native MCP confirms unchanged pinned search path,
custom planning, JIT settings and source-function hash. Evidence lives under
`benchmarks-2026-10-09/reopening-count-reuse/`.

`pnpm verify` passed again after this migration and both new observation/reopening
regression suites. Native Playwright MCP then returned chart/source/CSV HTTP 200
with one pinned revision, five visible tables, keyboard focus and no mobile
overflow. Supabase MCP independently matched the displayed actual-zero activity
and unknown coverage percentage for the zero denominator. Final desktop/mobile
screenshots are `trends-desktop-final-65459-mcp.png` and
`trends-mobile-final-65459-mcp.png`. No unrelated browser context was cleared.

After the continuation and pinned-view edge fixes, the full repository gate
passed again: 109 architecture tests with no dependency violations, 4,592 API
tests, 1,545 web tests, 691 contract tests, all infrastructure SQL tests, lint,
types and production builds. Focused API gate: 32 tests, 95.67% statements /
92.66% branches / 100% functions / 97.90% lines. Focused web/HTTP gate: 113 tests
across 15 files, 98.90% statements / 94.94% branches / 98.57% functions / 98.90%
lines. Every new/materially changed executable TypeScript module exceeds 80%
in all four dimensions. Shared trend schema gate: 20 tests, 100% coverage.
Tenant export classification checks passed 26 tests; `export-archive.ts` has
100% statements/functions/lines and 96.87% branches. This includes registration
of both source-owned history tables without duplicating or excluding them.
A count/delta fusion prototype preserved 216 database assertions but did not
improve quiet timing; it was rejected before applying. Universal `DISTINCT`
improved wide scans while regressing million-revision histories because it
reads every retained revision. The 51 observation-boundary assertions remain
and pass independently on the current projection. Rejected SQL and profiling
evidence are retained under `benchmarks-2026-10-09/rejected-single-pass-coverage/`;
the rejected migration is absent from the canonical migration chain.
Live API suites passed 25 tests in 8 suites; the live auth script passed 33
checks against the final API build. Generated types, database lint and the
fresh canonical diff completed before the final performance windows.

Frozen-code browser journeys passed 5/5 in each of Chromium, Firefox and
WebKit, with no skips or rate-limit failures. Normal 60-second login windows
separated engines. Final evidence is under `final-cli-post-edge/{chromium,
firefox,webkit}`; all three focused a genuine existing M7 snapshot.

Native Playwright MCP additionally advanced only the isolated browser clock
to test the 30-second source refresh. Three source responses returned HTTP 200
with the same pinned revision; the source view and keyboard focus stayed open
and no fresh chart request replaced it. Fresh-chart polling pauses during this
view, while pinned source reads still reauthorize every 30 seconds and on window
focus. Scope changes, denial and expiry invalidate the scoped results; close
and explicit refresh resume ordinary chart reads. A separately labeled injected
page-limit response preserved 16 genuine visible rows, showed the narrowing
notice and supplied no Next button. Screenshots: `trends-pinned-sources-final-mcp.png`
and `trends-page-limit-injected-final-mcp.png`. No live server clock was changed.

### Performance-gap acceptance harness preparation (2026-10-09)

The retained benchmark organization contains 2,448,089 finding facts (1,315,030
with legacy NULL classifiers), 18,007 distinct findings, and 243,020 coverage
facts across 19 releases (131,007 legacy). Organization measurements therefore
represent compounded 2.45m finding history; they must not be labeled a 1m
product test. Existing raw failed timing windows remain evidence, including the
84143 organization HTTP 503 and product p95 failures.

Before new live measurements, the benchmark harness added exact filter, product
cohort and activity-source minimum checks, all-field chart/CSV equality, and a
separate bounded source-exhaustion command:
`node apps/infrastructure/tests/m14-02-trends-source-parity.mjs`. It requires the
owned local clone API, a private owner cookie file and selected small product;
uses one dataset pin, page size 100, maximum 200 pages per metric, normal
1,300ms request pacing, and no retries or token refresh. Activity and coverage
observation totals must equal chart sourceCount; duplicate identities, foreign
products, unavailable bucket timestamps and repeated cursors fail. Genuine
carried coverage context preserves its earlier effective timestamp and is
counted separately, with one context per release, explicit provenance and
valid source identity. Coverage numerator/denominator zero remains an observed
state even when its percentage is null. No invented bucket availability field
is used. Large histories are not fully enumerated by this bounded check.

Tests first reproduced six wire-shape/carry failures, then passed. Final scoped
Node tests: 47 passed under a 64MiB heap, including 20,000 identities/200 pages,
actual HTTP CLI paths against synthetic localhost servers, organization scope,
CSV mismatch, malformed pin, first HTTP 503 without retry, and unsafe bounds.
Run:

```sh
node --max-old-space-size=64 --experimental-test-coverage --test \
  --test-coverage-include='apps/infrastructure/tests/m14-02-trends*.mjs' \
  scripts/architecture/m14-02-trends-benchmark-parity.test.mjs \
  scripts/architecture/m14-02-trends-benchmark-http.test.mjs \
  scripts/architecture/m14-02-trends-benchmark-guards.test.mjs
```

Per-module line/branch/function coverage: parity helper 100/98.46/100%;
HTTP benchmark 98.22/80.30/100%; source CLI 100/100/100%. Node reports these
three dimensions, not a separate statement metric. These tests do not establish
live latency or source parity; new live measurements follow reviewed SQL,
canonical clone function matching and an explicit quiet window. Final evidence
must retain cold reads, failures and every requested sample rather than a warmed
subset. No production authorization, rate limit, facts or migration ledger was
changed by harness preparation.

### 94753 measured acceptance: product gap remains

Reviewed migration 94753 was applied by the owning SQL lane to main and clone
through selective CLI. This lane restarted only retained owned REST/API and
renewed the owner cookie through normal main API sign-in. No baseline or fact
rewrite, database reset, authentication bypass, or selective warm sampling.

Deep selected-product window: all 200 charts HTTP 200; p50 274.36ms, p95
500.54ms, p99 796.78ms, maximum 1379.16ms. Chart p95 remains above 400ms.
All 20 sources passed same-pin checks (p95 195.50ms/p99 198.68ms); all 20 CSVs
passed every chart-cell comparison (p95 481.58ms/p99 531.07ms), with export p95
also failing. Twenty-sample auxiliary tails have limited confidence. Cohorts
remain 998 genuine valid synthetic durations, 500,003 activity sources and
100,001 coverage observations. Cold reads and all failures are retained.

Organization availability diagnostic: five of five HTTP 200, raw latencies
4051.36/2824.66/1599.44/1995.63/1436.11ms. This closes the observed timeout
availability problem in this diagnostic; it does not satisfy latency acceptance
or replace the pending full organization window. Product-required metrics were
withheld, with 1,168,011 activity and 232,019 coverage observations.

Separate full source parity on the small 10k product passed with one pin:
5,002 activity observations in 51 pages and 1,001 coverage observations in 11
pages. Exact chart sourceCount equality, no duplicate IDs, product/date/bucket
and revision checks passed. No carried context falls in this requested range;
carry semantics are tested separately. Page size 100, normal 1300ms pacing,
no retries, and no complete enumeration of large histories. Evidence under
`benchmarks-2026-10-09`: `94753-http-results.json`, the full raw HTTP logs,
`cra-m14-02-full-source-parity-10k-94753.log`, and harness coverage/RED logs.

A separate diagnostic instrumented only the private clone API loader, wrapping
real methods with identical arguments/receivers and preserved results/errors.
Twenty sequential deep charts plus five sources and five CSVs retained normal
authentication and pacing; this is diagnostic evidence, not SLO acceptance.
Matched chart p95: HTTP577.27ms, clone PostgREST RPC405.88ms, auth guard152.53ms.
CSV n5: HTTP646.14ms/RPC503.47ms/auth119.32ms; sources n5:
HTTP203.27ms/RPC71.94ms/auth102.02ms. Quantiles are independently measured and
cannot be added. Across30 requests median RPC173.08ms/auth80.49ms. RPC tail
variation and authentication overhead both remain relevant; this instrumentation
does not isolate all authentication substeps. Numeric-only records were bounded
and30 sequential requests paired without logging identities, token contents or
arguments. The original loader was restored afterwards. Evidence:
`cra-m14-02-stage-diagnostic-results-94753.json` and
`cra-m14-02-numeric-stages-94753.log`.
