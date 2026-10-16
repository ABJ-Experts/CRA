# M13-03 audited search and verifiable export

## Scope and preserved contracts

Deliver FR-AUD-004/005/006: audited tenant search, filtered CSV/JSON exports,
redacted details and honest event/artifact verification. Preserve `/api/v1`,
ES256/JWKS, the narrow refresh cookie, zero epoch skew, auth-action signatures,
permission merge order, menu/mock parity, non-forced RLS and all source-owned
regulatory decisions. `AuditService.log()` stays best-effort; `recordV2()` keeps
its existing contract. No operator/global security explorer, external portal,
source deletion, arbitrary SQL, chain backfill or authenticity certification.

## Concrete problem

At `7d686f18a15f9f0c26408273b406a11d8c7f67cf` M13-01/02 supply durable
envelopes and chained evidence but no tenant search/export surface. Every new
organization insert is sequenced by `m13_02_guard_audit_insert` and its deferred
finalizer, including legacy-format callers. Pre-activation unchained rows are
immutable. Service-role access bypasses RLS and must intersect audit and source
permissions before returning rows or counts.

## Why not simpler?

A moving query includes its own read event and concurrent appends. A fixed
high-water chain boundary, durable receipt and authenticated cursor are enough
for interactive snapshots: a new snapshot table would duplicate immutable
receipt state. Synchronous or buffered export cannot bound memory/restarts.
The existing whole-tenant export workflow has different restore semantics.
Add only `audit_export_jobs` for leased generation, immutable filter state,
selected IDs, private artifacts and rotating delivery grants.

## Selected patterns

- Adapter: Supabase RPC/storage and browser HTTP implement inward-owned ports.
  Contract tests pin provider parsing, scoping and safe failures. Remove only
  when the corresponding external boundary disappears.
- Facade: an injected plain TypeScript audit gateway coordinates parsed web
  requests; functional React renders its results. Application entry points
  own snapshot, access and workflow policy rather than controllers/pages.
- Bounded iteration: keyset pages and incremental hash/CSV/JSON/ZIP generation
  operate on a frozen boundary with row/byte caps and no global user state.
- Durable database transitions: read receipts and export state transitions
  append evidence in the same transaction. A lease is operational coordination,
  not an authorization source.

## Rejected patterns

No generic job framework, command/event bus, class hierarchy, singleton tenant
state, extra artifact/grant/session tables or additional dependencies. Existing
source read policies remain authoritative; audit does not invent regulatory
decisions or broaden permissions.

## Data and tenant boundaries

Identity/org/session come from verified `RequestUser`. Every service-role call
is self-scoped or takes organization first. Audit permission is separate from
dashboard visibility; export/delivery requires both audit view and export.
Source feature/product restrictions apply before rows, aggregates and proofs.
Unknown/unresolvable scope is omitted; security/operator scope stays separate.
Current access is rechecked for pages, details, jobs and exact delivery IDs.

Snapshot creation captures the committed head before its own durable receipt.
Request UUID plus actor/criteria/scope digest pins replay; mismatch conflicts.
Chained rows sort by descending decimal sequence; immutable legacy rows follow
by descending created_at/id and are explicitly unverified. Current permission
changes invalidate snapshots. Access metadata has an action-specific validated
projection so existing canonical bytes/projector behavior remain compatible.

The new table uses non-forced RLS, explicit grants, pinned function search_path,
immutable request fields, optimistic transition versions and expiring leases.
Private storage is never exposed through a public or bearer URL. Five-minute
delivery grants retain only a digest and bind requester/session/artifact/version;
an HttpOnly SameSite cookie is scoped to the exact download path. A rotated or
interrupted grant requires another explicit request.

## API boundary contracts

Runtime schemas live under `@repo/contracts/audit/schemas`; trusted wire types
under `audit/types` derive from `z.output`. Parse body/query/path before logic,
successful JSON through `@ZodResponse`, downloads through `@NonJsonResponse`.
The browser supplies inputSchema/schema; provider RPC results are also parsed.
POST is never automatically replayed following refresh.

## Frontend logic and rendering

Functional explorer/table/filter/detail/export components use current semantic
tokens, cn() and shared UI subpaths. A focused gateway owns injected transport;
policies remain immutable functions. `/audit` participates in shared menu and
protected-route parity. Loading/empty/forbidden/stale/conflict/retry states keep
draft filters; organization changes clear tenant-bound results/cursors.

## Failure modes

Invalid date/range/cursor fails validation; wrong tenant/source looks absent.
Durable receipt failure returns no evidence. Replay mismatch conflicts. Changed
access denies snapshot/delivery. Lease expiry permits bounded retry; ambiguous
completion does not publish or destructively compensate an unknown result.
Oversized exports fail explicitly, never truncate. Corrupt canonical/artifact
bytes fail verification before ready/download. Only owned temp files are
cleaned. Logs contain codes/IDs, no payloads, grants or bearer URLs.

## Tests and observability

Write failing contract/policy/SQL/worker/UI tests first. Cover denied scope,
current membership, forged tenant, permission invalidation, replay, rollback,
concurrent and backdated inserts, legacy immutability, CSV formulas, JSON types,
corruption, independent offline checks, restart, expiry and partial providers.
Maintain at least 80% branch/function/line/statement coverage for changed modules.
Run focused suites, architecture gates, pnpm verify and applicable live tests.
Use only confirmed local CRA for Playwright owner/restricted journeys/screenshots.
Record realistic read percentiles, bounded memory and tenant fairness; do not
claim performance, authenticity or bug freedom without evidence.

## Rollback

Expand with additive CLI migrations, generate both type copies, deploy API/worker,
then UI. Stop worker/hide route to roll back code; retain schema/jobs/receipts and
all evidence. Never reset, repair historical ledgers, replay old migrations,
remove unrelated site data or automatically delete source/private artifacts.

## Review checklist

- Direct alternatives, inward dependencies and present boundaries documented.
- No global request/tenant/session state or database calls in pages/controllers.
- Input/output/provider parsing and source authorization covered by tests.
- Durable effects, replay, bounds and partial failures verified on local stack.
- Coverage, compatibility, rollout and evidence gates required before completion.
