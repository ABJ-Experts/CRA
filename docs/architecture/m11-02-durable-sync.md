# M11-02 durable connector sync, mappings and replay

## Scope and preserved contracts

Users can inspect durable run/record/attempt history, validate source-to-target
field assignments and preview authorized replay of a blocked batch. V1 BRD
FR-INT-004/005/006. Reuse reference conformance and M2 product/release identity,
authority, hierarchy and transactional commit rules. No real vendor integration,
script transforms, upstream disappearance deletion, new orchestration engine or
automatic purge. Preserve legacy strict response projections, `/api/v1`, ES256/
JWKS, narrow refresh cookie, frozen auth actions, permission merge, menu and MSW.

## Concrete problem and why not simpler

`planExternalRecord` and authority preview currently collapse omitted values to
null. `claim_sync_run` excludes expired running leases; `fail_sync_run_atomic`
overwrites run-level retry state and retries all categories. The old empty-body
retry reactivates a failed parent without preview or concurrency metadata.
`save_sync_run_plan_atomic` counts conflicts as records and commit ignores rejected
items. A UI-only guard, another generic queue, or a last-error column cannot
provide atomic cursor safety, immutable replay evidence or crash recovery.

## Selected and rejected patterns

- Adapter: existing ConnectorPort/capability discovery and inward repository,
  vault, egress and authorization ports. Concrete trigger is provider schemas/
  failures differing from trusted contracts. Shared runtime conformance tests
  cover every registered adapter; remove new mapping seam if schemas no longer
  differ. Direction: presentation -> application/policy <- infrastructure.
- Focused facade/use cases: mapping/replay coordinate identity, schema, previews,
  idempotency and transactions; controllers cannot make these decisions. Shared
  command tests pin current authorization and safe conflicts. Remove coordinator
  if this becomes one synchronous operation.
- Durable commands/state: reuse connector_commands for operator dedupe/audit;
  lease generations/attempt rows distinguish interruption from terminal failure.
  Actual crash and duplicate worker tests justify persistence. No command/event
  bus, class hierarchy, new scheduler or independent dead-letter store.
- Immutable snapshots: current connector map plus bounded run schema/authority
  snapshot and plan-item approved fields support original/current replay without
  a mapping catalogue table. Remove snapshots only when replay is removed.

## Data, tenant and transaction boundaries

Verified RequestUser supplies organization/actor identity. Every service-role
query is org-first and filtered; composite tenant foreign keys guard references.
Existing recorded actor/approver and current product actions/permission epoch,
connection and credential revisions fence provider work and atomic mutations.
Source snapshots exclude raw payloads and sensitive fields. History uses the
existing connector_sync_record retention authority; unknown protection fails
closed, active lineages/holds/cursor references remain protected. No automatic
deletion. Attempt metadata joins the existing export/purge registry; replay
source snapshots and vault/command security material remain nonportable.

Mapping replacement and replay share the durable command, optimistic version,
fingerprint and audit transaction. Matching retries recheck authorization before
returning the recorded safe result. Replay creates a child dry run and never
reactivates a terminal parent. Whole-batch product/release changes, applied markers,
completion and cursor advance commit together. Poison records block the cursor.
Current lease generation and unexpired lease are required for worker transitions.

## API boundary contracts

Feature-first `@repo/contracts/connectors` schemas and separate z.output types
define discovery, field map preview/save, history/detail/attempts/record outcomes
and replay preview/request. Thin Nest routes parse body/query/params and use
ZodResponse; ConnectorsApi supplies inputSchema and response schema. Keep old
strict read projections; empty retry becomes actionable preview-required error.
Legacy unknown snapshots/timestamps are never fabricated.

## Frontend rendering and logic

Functional mapping/history/dead-letter components reuse ConnectorsApi and scoped
React Query keys. The gateway owns injected transport; pure mapping/retry policies
are immutable functions. Existing module/query composition is the test seam.
Preserve non-secret drafts, organization boundaries and late-callback guards.
Use semantic tokens/cn/shared UI, locale dates, non-colour status, keyboard focus,
compact mobile tables/forms and reduced motion. No new fonts/graphs/animation.

## Failures, tests and observability

Missing/null/type/schema changes are reviewable errors; never null overwrite.
Time-out/outage/rate-limit/transient SQL failures retry with bounded exponential
equal jitter, respecting Retry-After; auth/scope/invalid/stale authority fail safely.
Recovery closes expired attempts before new generation claims. Late completion,
tenant substitution, revoked access, changed mapping/ownership/configuration,
cursor drift and disconnect cannot commit. Provider errors use fixed safe codes,
not upstream or SQL text. No credential/provider body logs or audit values.

Test RED first, then contracts/policies/use cases/worker/UI; rollback-only live SQL,
two-session races, API/auth, browser owner/role/tenant and canary checks. Require
at least 80% statements, branches, functions and lines, `pnpm verify`, relevant
M1–M10/navigation regressions and bounded read load. Record actual browser
versions, screenshots and limitations.

## Cutover, rollback and review

CLI additive migration and generated types in both existing locations. Pause
workers during cutover. New leases require generation; legacy active plans need
fresh review. Retain completed history and all key/replay recovery material.
Rollback targets compatible API/worker with additive schema retained; do not
restart unfenced old worker, reset data or rewrite migration history.

Review checks: direct solution considered; patterns have present triggers/tests;
no global tenant/request state; thin controllers/pages; inward dependency;
runtime input/output parsing; functional JSX; transactional security/audit;
focused >=80% coverage; compatibility/live/rollback gates. Completion observations
and unchecked residual risks belong in m11-02-verification.md after verification.
