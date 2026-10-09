# M3 SBOM lineage, deduplication, and deterministic diffs

## Scope and preserved contracts

- **User outcome:** an authorized user can retain every immutable SBOM source
  event, follow its release-local lineage, and inspect a reproducible component
  difference from its direct predecessor.
- **In scope:** strict non-branching source lineage, byte-exact content reuse,
  durable component-diff reports, and a typed M4 finding-delta boundary.
- **Out of scope:** mutation or deletion of historical evidence, VEX decisions,
  vulnerability matching, and an ecosystem-version comparator implementation.
- **Preserved:** M3 intake/validation/normalization, M3-04 quality reports,
  raw evidence immutability, `/api/v1`, existing sessions, RBAC, and the
  document/component/tree read contracts.

## Concrete problem and selected boundaries

M3-03 intentionally deduplicates the normalized graph after a source-specific
ingest job starts. That is not sufficient for identical uploads: repeated bytes
must create source/actor history without parsing, normalizing, or matching
again. A source event can also be an alias of a canonical lineage version, so
using `supersedes_source_id` alone cannot both retain aliases and enforce a
single successor.

- **Source finalization boundary:** the organization-first finalization RPC
  locks content and release scope, records each source event, and either starts
  exactly one canonical ingest job or attaches the event to the existing graph.
  A `deduplicated_from_source_id` alias is not traversed as a lineage edge.
- **Durable diff lifecycle:** `sbom_diff_reports` is the job/report authority
  and `sbom_diff_component_changes` is the immutable paginated projection. A
  separate generic queue would add no second consumer.
- **Comparator boundary:** M3 owns no version semantics. An inward M4 version
  comparator port supplies identity/version ordering when installed. Until
  then, non-exact candidate transitions are explicitly unresolved and the
  finding integration is unavailable; plain string ordering is forbidden.

## Data and tenant boundaries

- Authenticated API guards provide organization and actor identity. Every
  service-role method/RPC takes `organization_id` first and filters it before
  any source, document, component, report, or change identifier.
- `supersedes_source_id` remains immutable and same-release constrained. A
  unique non-alias successor relation and release advisory lock prevent head
  races; aliases retain their own source and actor audit facts.
- Canonical document reuse remains tenant-wide by immutable SHA-256 plus
  normalizer version. Diff scope is always source + release so an organization
  cannot compare content mapped to an unrelated release.
- Component package identities are stored, versionless projections of an
  already canonical PURL; projection is batch-bounded/idempotent and does not
  re-read raw evidence or normalize version strings during a query scan.
- New tables use composite tenant foreign keys, RLS member policies, no browser
  grants, audit timestamps, export registration, and security-definer RPCs
  pinned to `public, pg_temp`.

## API, worker, and UI

- Feature-owned Zod schemas live under `@repo/contracts/sboms`; Nest parses
  paths, bodies, queries, and successful outputs. The browser uses `SbomsApi`
  only, with parsed request/response schemas.
- A comparison defaults to the target source's direct non-alias predecessor.
  An explicit source must be in the same tenant/release lineage or resolve as
  not found. Only completed graphs are comparable; missing/incomplete or
  unavailable baselines produce an explicit state, not a false empty diff.
- A claimed report streams stable component-identity batches, persists each
  checkpoint idempotently, and finalizes atomically. Failures preserve the
  report for retry. Exact canonical PURLs are unchanged, one-sided identities
  are added/removed, and ambiguous groups are unresolved with evidence.
- The product surface extends the Evidence Control Room: concise status panels,
  URL-safe filters, cursor pagination, keyboard operation, focus visibility,
  text equivalents for status, and reduced-motion-safe state changes.

## Failure modes, operations, and rollback

- Duplicate/replayed upload, job contention, lost lease, malformed RPC result,
  statement timeout, and unavailable M4 integration either produce a stable
  response or retain recoverable durable state; no source bytes or credentials
  are logged.
- Deploy additively: database migration and types, API/worker, then UI. The
  former API continues to serve existing source/document reads; rollback
  disables new readers/workers and repairs forward without changing immutable
  evidence, source lineage, or completed graphs.
- Characterize M3 behavior first; cover concurrency, RLS, cursors, ambiguous
  identities, restart/retry, and local owner-browser flow. New modules require
  at least 80% focused coverage before full workspace gates.

## Review checklist

- [x] Direct page-side comparison was rejected: it cannot be durable, bounded,
      tenant-safe, or restartable.
- [x] M4 semantics are an explicit port rather than a lexical fallback.
- [x] Existing source evidence and graph records remain immutable.
- [x] Controllers/pages have no provider queries or domain comparison policy.
