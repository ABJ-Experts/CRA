# M14-02 reproducible finding and coverage trends

## Scope and preserved contracts

Provide FR-AN-004 and FR-AN-009 finding activity, first-human-triage hours,
effective-fixed remediation days, SBOM release coverage, and sparse M7 snapshot
readiness. Preserve M14-01 routes/countdown, source decisions, auth/session
cookies/JWKS, permission merge order, mock namespaces, menu, retention and holds.
No predictive scores, M10 history, XLSX, scheduler or dashboard aggregate cache.

## Concrete problem and why not simpler?

Finding closed_at is cleared on reinstatement; current coverage is recomputed
from mutable release/SBOM state. Reading current rows cannot prove old buckets.
M7 already has immutable snapshot payloads, so a third readiness table is not
needed. Two source-owned append-only fact ledgers preserve future observations.

## Selected and rejected patterns

Reuse dashboard presentation -> use case/port -> Supabase adapter, with shared
feature-first Zod schemas/types. Ports exist because Supabase is an actual
dependency; remove separate adapter only if that dependency disappears. Reuse
the plain gateway transport class and functional chart components. Immutable
fact reduction and encrypted dataset tokens solve actual correction/replay and
authorization boundaries. Reject event buses, generic analytics stores,
permission-shaped persisted reports and write-blocking snapshot locks.

## Data and tenant boundaries

Verified request identity supplies organization/user/session; never accept a
client tenant ID. Authorize product and source visibility before aggregation,
again on sources/export. Every adapter takes orgId first and every SQL source
join scopes organization_id. Source facts capture final transaction state,
deduplicate repeats, and append correction/reversal references. First detection
to first human submission is triage; first valid effective fixed is remediation.
Suppression never closes, not_affected never remediates, supersession exits cohort.
Duration cohorts are terminal-event buckets, once per finding/product. Invalid
negative/missing pairs are excluded with counts; unresolved is never zero.

Each inserted immutable fact stores top-level pg_current_xact_id(); pin one
pg_current_snapshot() and sequence bounds for every dataset read. Replay uses
pg_visible_in_snapshot plus sequence bounds, never xmin or timestamps alone.
Bound/encrypt tokens for 15 minutes with identity, permission revision, product
scope, filters, policy and deployment epoch. Reauthorize current permissions.
Public source row IDs use a separately keyed HMAC bound to the authorized
dataset and metric; internal global sequences never leave the API. Revision or
pin changes in a validated replay require explicit refresh, while malformed
provider responses remain unavailable errors. Projection policy rollout changes
invalidate old dataset epochs without rewriting source capture markers.
Baseline captures current state now, never invented earlier transitions. Old
incomplete periods are unavailable; M7 retains actual snapshot timestamps/hash.
New organizations install their two source markers atomically on creation,
including empty tenants. Missing markers are initialized at rollout time with
current-state observations; existing markers and earlier unavailable periods
are preserved. Marker capture failure rolls back organization creation.
No interpolation of M7. SBOM carry-forward begins only after complete capture.
UTC default, explicit IANA timezone, Monday weeks, daily/weekly/monthly buckets,
366-day bound; elapsed durations remain UTC. All-product duration/readiness is
unavailable until a product is selected. Each series retains its denominator.

### Measured source fact read optimization

Eligible 100k/1m histories exceeded the read latency target: reducing repeated
cohort scans alone still visited unrelated product revisions and repeatedly
loaded previous JSON payloads. Add product-leading covering indexes and nullable
source observation metadata: `is_reopening` on finding facts and
`eligible_delta`/`covered_delta` on coverage facts. Capture computes each value
from the locked previous source observation and final authoritative state in
the same transaction. These values classify individual source transitions;
they are neither dashboard aggregates nor permission-shaped cached results.
Existing immutable facts remain untouched. Null metadata follows the original
payload-based read path, including snapshot visibility and tenant/source gates.
Benchmark fixtures derive the same transition metadata from adjacent states;
tests cover both paths and their parity before accepting performance results.

### Organization and deep-history performance continuation

The 2026-10-09 authenticated benchmark exposed an organization-scope statement
timeout and selected-product p95 above 400ms. Nested plans show legacy nullable
reopening classification repeatedly joining previous JSON payloads for every
calendar bucket. Reduce these observations once into narrow calendar bucket
counts and use an exact tenant/sequence partial index for previous closed,
non-superseded state membership. Missing superseded metadata keeps its original
false default. Immutable old facts remain unchanged; every read retains the
same authorization, effective-time, sequence and transaction-visibility bounds.

If latest-finding reads still dominate, consolidate their narrow event values
within the same request rather than repeat payload retrieval for each metric.
PostgreSQL work memory/spill controls remain unchanged. This is a direct query
optimization within the existing adapter, not a persistent workflow or cache.
Organization-only identity enumeration may use `vulnerability_findings.id`
scoped by organization: the validated, non-deferrable composite history FK
`(organization_id,finding_id)` protects that exact source identity while any
fact remains. It reads no current metric value, release or product membership.
A new parent without a visible pinned fact contributes nothing; tenant deletion
still fails current authorization. Keep product-scoped identity discovery in
the history ledger because current product membership is not historical scope.
Reject root-only fact enumeration: manually imported, SQL-valid chains can lack
a root for that finding. Tests must preserve those cohorts and protected parent
identity, late commits, and chart/source parity. Accept only exact pinned chart/source/CSV parity
and authenticated deep/wide/organization measurements, including cold requests.
Rollback restores the prior read definition while retaining source history;
indexes can remain safely until removed in a separately reviewed migration.

## API boundary contracts

Dashboard schemas/types own trends, sources and CSV query/data contracts.
GET /api/v1/dashboard/trends, /trends/sources, /trends/export use parsed queries;
JSON uses ZodResponse, CSV NonJsonResponse after structured dataset parsing.
Gateway parses outgoing filters and incoming schemas; no new mutation retries.
Strict unknown-key rejection, bounded paging, null versus actual zero, explicit
restricted/unavailable/stale states. CSV shares pinned values and escapes cells.

## Frontend logic and rendering

Dashboard-local functional trends cards reuse @repo/ui/chart, shared controls,
semantic tokens and cn(). Existing DashboardGateway owns injected transport;
pure policies format chart/table/CSV values. Query composition owns scoped
cache cancellation. Countdown remains first; each chart has a visible table,
source/drilldown, units, filters and provenance. Reduced motion/focus/labels and
filter preservation are required. No cinematic/marketing design changes.

## Failure modes and observability

Capture failure rolls back the source transaction. Duplicate writes deduplicate;
late corrections append; concurrent commits outside the pinned snapshot stay
excluded. Expired/changed permission tokens conflict and require refresh. Foreign
records remain indistinguishable; provider/schema failures are sanitized and
unavailable, not zero. Abort canceled reads. Retain degraded display only while
identity remains authorized; disable stale export. Log classifications only.

## Tests and rollout

Observe failing policy/schema, capture and gateway tests before production code.
Cover reopen, approval/bulk undo, suppression, corrections/dedup, missing/negative
durations, DST/leap, partial buckets, transaction visibility/subtransactions,
tenant/product inference and permission changes, snapshot source gates and
chart/table/CSV parity. Focused coverage >=80% across all four dimensions.
Then verify full repository, DB lint/RLS/live auth/core flows, isolated owner
Playwright MCP desktop/mobile screenshots, 10k/100k/1m realistic benchmarks
(API p95<400ms, p99<1000ms), concurrency and egress-blocked operation.

Use CLI-created additive migrations, generated types, explicit grants, pinned
search_path and non-forced RLS. Register export/retention/hold classification.
Apply capture before read deployment and validate baseline. Existing local
ledger gaps follow M14-01 runbook; never reset or blanket replay migrations.
Rollback disables read UI/API but retains facts/capture and source authority.
No data deletion, cloud upgrade or unrelated browser/mail state cleanup.
Completion evidence records test mapping, coverage, screenshots, measurements,
baseline/rollback instructions and residual risks without zero-defect claims.

## Review checklist

- [x] Direct solution and nearby patterns considered.
- [x] Tenant identity is request-scoped; controllers/pages stay provider-free.
- [x] Shared parsed contracts, functional JSX and durable facts are specified.
- [x] Compatibility, coverage, concurrency and live-stack gates listed.
- [ ] Capture completeness, tests, performance and independent review verified.
