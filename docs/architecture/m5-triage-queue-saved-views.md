# M5 triage queue, finding detail, and saved views

## Scope and preserved contracts

- **User outcome:** an authorized tenant user can triage the existing finding
  ledger at scale, inspect its current evidence, and reuse an organization
  shared filter view without changing a finding.
- **In scope:** tenant-wide keyset reads, finding detail, saved views and each
  user's default view.
- **Out of scope:** assignment, VEX/assessment mutation, bulk triage, AI,
  matching changes, manual-finding read support and product ACLs.
- **Preserved:** `/api/v1`, M4 document-scoped routes and offset behavior,
  cookies/JWKS/session revocation, permission merge order, menu fail-open UX,
  and the existing Evidence Control Room design language.

## Concrete problem and direct solution

M4 only exposes document-scoped offset pages. Its response is insufficient for
the BRD's tenant-wide queue and can skip or repeat rows when the underlying
finding ledger changes. Fetching all rows in the browser would violate the
100,000-finding responsiveness requirement. A single tenant-scoped database
query with an explicit sort whitelist, a `(sort value, finding id)` cursor and
database filters is the direct, smallest solution.

Shared views cannot be represented by `user_table_preferences`: that table is
private, layout-specific, and cannot atomically record a shared configuration
change. M5 therefore adds only a view ledger, a per-user default preference,
and narrowly scoped atomic RPC mutations.

## Selected patterns

- **Adapter — present external boundary:** `SupabaseFindingTriageRepository`
  implements an inward port and translates trusted RPC JSON to the contracts.
  Dependency direction is React -> feature gateway -> HTTP -> controller ->
  use case/port -> adapter -> Supabase. The contract test rejects malformed
  RPC output. Remove it only if Supabase is no longer the persistence boundary.
- **Facade — present caller simplification:** one triage use-case facade owns
  queue, detail and saved-view coordination; it does not become a service
  locator. Its ports use `organizationId` first.
- **Command record — required mutation safety:** saved-view writes carry a
  UUID idempotency key and expected version. The database deduplicates a key
  per organization, actor, operation and payload, and writes the audit fact in
  the same transaction. There is no command bus or event framework.
- **Virtualized presentation — measured rendering need:** the queue keeps a
  bounded row window and roving keyboard focus. It is a feature-local component
  based on the existing dependency-tree implementation, not a generic grid.

Rejected: a generic query DSL, global state/event bus, repository hierarchy,
browser Supabase client, offset pagination, a new assignment state machine,
and an M5 approval workflow. None has a present requirement.

## Data, tenant, API, and failure boundaries

The authenticated Nest request supplies verified user and organization identity.
Every service-role RPC accepts organization then actor and filters every finding,
product, release, view, preference and relation by organization. Active related
findings are limited to the same vulnerability identity and organization;
current authorization is organization-wide, not a product ACL.

The queue maps only existing facts: human assessment is `unassessed`,
`affected`, or `not_affected`; “Assessed by” is `human_assessed_by`; matcher and
re-evaluation state remain distinct. Missing EPSS, KEV, or reachability is
explicitly unknown, never zero or false. Syntactically invalid filters fail
Zod validation. Deleted/archived same-tenant references return a safe filter
issue with no rows; foreign-tenant references are indistinguishably unavailable
and never relax filtering.

Saved-view RPCs validate membership and tenant ownership, lock the target view
for optimistic version checks, deduplicate retries, and persist audit evidence
before returning. A conflict is stable and recoverable; the web transport never
automatically retries a mutation. Database/provider failures fail closed with a
safe 5xx error; GET refresh behavior remains unchanged.

## API and frontend contracts

Runtime schemas and `z.output` types live under the vulnerability triage
contract feature. Nest parses every path/query/body and validates every JSON
success response. The web gateway parses outgoing inputs and returned JSON at
the central transport. React rendering remains functional; its injected
gateway/query hooks are the test seam and no page performs a provider call.

The queue exposes explicit loading, loading-more, no-findings, all-triaged,
filtered-empty, offline, forbidden, validation, conflict and retry states. It
uses semantic tokens, visible focus, labels and non-colour status text. Heavy
detail/filter content is code split.

## Tests, deployment, and rollback

Characterize M4 routes first; add contract/unit tests for cursor ordering,
filter semantics, unknown values, defaults, idempotency and conflicts. Live
tests prove tenant isolation, revoked membership, grant/RLS boundaries,
transaction rollback, deleted references, related rows and 100k-page stability.
Browser tests cover owner sign-in, queue/filter/detail/saved-view states,
keyboard focus and a second user's unchanged default. A local isolated benchmark
records queue paint, filter latency and API percentiles.

Deploy in expand order: migration and generated types, API, then web. The
previous API remains compatible with the additive schema. Roll back web/API
first; retain saved-view/audit data and remove schema only in a separately
approved contract migration after it is unused.

## Review checklist

- [x] Direct keyset/RPC solution selected before abstractions.
- [x] Tenant, parsing, idempotency, audit, and compatibility boundaries are explicit.
- [x] Pages/controllers contain no direct provider access.
- [x] M5 mutations are transactionally durable and testable.
- [x] Rollout and rollback preserve previous M4 behavior.
