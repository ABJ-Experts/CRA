# M2 V1 product and release CSV import

## Scope and preserved contracts

- **User outcome.** An authorized organization member can upload one versioned
  CSV, receive a complete immutable dry-run report, and explicitly commit the
  exact reviewed snapshot without bypassing the authoritative product and
  release rules.
- **In scope.** CSV parsing, deterministic validation/planning, an immutable
  source object, paged row results, an all-or-nothing commit, report export,
  cancellation, expiry, audit, and a durable worker for imports above the
  synchronous threshold.
- **Out of scope.** XLSX and other spreadsheet formats, arbitrary field
  mapping, SBOM input, archival/deletion, lifecycle/support-period changes,
  legal-entity reassignment, product identity renames, and PLM/ALM sync.
- **Preserved contracts.** `/api/v1`, existing product/release create/update
  contracts and RPCs, product idempotency semantics, auth cookies, permission
  merge order, and mock namespaces remain unchanged. This is an additive
  product-registry workflow, not an alternate product writer.

The canonical format is documented in
[`product-release-import-csv-format-v1.md`](../product-release-import-csv-format-v1.md).

## Concrete problem and smallest design

Interactive creation validates a single product or release with a verified
organization, owner, legal entity, optimistic version, audit fact, and
idempotency record. A browser-only preview, direct bulk insert, or mutable
temporary CSV cannot preserve those guarantees after a user reviews a report,
the process restarts, or records change concurrently.

The smallest durable design is two tables plus one private bucket:

- `product_import_jobs` is the import snapshot and durable job state. It
  stores organization, actor, schema/content hashes, source/report paths,
  aggregate counts, expiry, idempotency, correlation, retry/lease/checkpoint,
  cancellation, and terminal state. It is deliberately not split into an
  import table and a queue table.
- `product_import_rows` is the paged deterministic row plan and final
  result. It stores no foreign-tenant detail and is unique by import and source
  row, so a parsing or worker replay is an upsert rather than another action.
- The private `product-imports` bucket stores only
  `<organizationId>/<importId>/raw.csv` and `report.csv`. The database remains
  the status authority; storage is not a job queue.

A single JSON result field on the import record would make error review and
report generation unbounded. A separate fan-out, report, idempotency, or audit
table would duplicate state already represented by the two tables, existing
product idempotency facts, and `audit_logs`.

## Selected patterns and boundaries

- **Immutable validated snapshot.** The upload is SHA-256 hashed before dry
  run. Commit receives the same hash and re-verifies stored bytes; a changed,
  missing, expired, foreign, or already consumed snapshot fails closed.
- **Parser, planner, executor.** The parser has no database writes and accepts
  only UTF-8 CSV. The planner resolves tenant-local references and creates a
  row plan. The executor rechecks its plan and calls the authoritative product
  creation/update functions inside a single transaction. These focused
  components are necessary because one worker has restart/lease lifecycle;
  they are not a generic import framework.
- **Product-owned atomic coordinator.** The coordinator locks the import,
  checks its current state and snapshots, then calls
  `create_product_atomic`, `update_product_atomic`,
  `create_product_release_atomic`, and `update_product_release_atomic` in
  product rows first and release rows second. Any non-success outcome aborts
  the transaction. Its per-row idempotency key is stable from import and row
  IDs, so retry does not duplicate a product or release.
- **Private storage adapter.** An injected adapter owns tenant-prefixed object
  paths, upload/download/hash verification, signed report links, and scoped
  removal. No controller, page, or browser receives a service-role client.
- **Bounded fair worker.** Jobs over 1,000 records are claimed one due tenant
  at a time with a lease, checkpoint, retry backoff, cancellation check, and
  bounded work page. This prevents one tenant from monopolizing a process.

Rejected alternatives are a browser-only report (not durable), controller SQL
inserts (bypass domain invariants), unrestricted in-memory CSV parsing
(hostile-input risk), public storage/signed source uploads (data exposure),
and a new generic queue/event bus (duplicates durable import state).

## Data, authorization, and compatibility

- The authenticated request establishes actor and active organization; neither
  is read from CSV columns or client-supplied organization IDs. Every
  service-role adapter accepts `organizationId` first and applies it to import,
  row, user, legal-entity, product, release, storage, and cleanup queries.
- Upload, dry run, commit, cancel, and result download are server-authorized.
  Reads require `products:view`; mutations require both `products:create` and
  `products:edit`; reports require `products:export`. A foreign identifier is
  indistinguishable from missing data. Owner resolution returns a generic row
  error and never proves a foreign user's existence.
- Public tables enable RLS, have no browser grants, use composite
  organization foreign keys, and privileged SQL pins
  `search_path = public, pg_temp`; `PUBLIC`, `anon`, and `authenticated`
  execution are revoked and only `service_role` is granted.
- The API validates every route input and success response with feature-first
  `@repo/contracts/products` schemas. The web gateway validates outgoing input
  and response JSON. Existing product/release schemas remain the semantic
  validation source for planned commands.
- All product/release mutation, row finalization, and commit audit fact share
  one transaction. The dry run writes operational/audit facts and row results
  only; it never creates or updates products or releases.

## Limits, lifecycle, and failure handling

| Decision | V1 rule |
| --- | --- |
| Format | `m2-product-release-import-v1`, mixed product/release CSV, comma delimiter |
| Input limits | 10 MiB source, 10,000 physical data records (including blank records), 16 KiB cell; reject compressed input |
| Processing | Up to 1,000 rows may finish synchronously; larger files are durable/resumable |
| Snapshot | 24-hour dry-run expiry; source/report cleanup after seven days |
| Report link | Private, tenant-scoped, five-minute signed URL |
| Commit | All-or-nothing; no partial-success option in V1 |

UTF-8 with optional BOM, CRLF/LF, quoted commas, embedded newlines, escaped
quotes, empty cells, and trailing blank lines are deterministic. Blank records
are counted toward the 10,000 physical-record limit before they are classified
as skipped, so millions of blank lines fail safely. Invalid UTF-8,
NUL bytes, malformed quoting, oversized cells, duplicate or NFKC/case-fold
ambiguous headers, unknown headers, header-only input, and excessive blank
records fail safely. There is no locale-dependent number/date parsing. V1 has
no date or timestamp columns: any such column is unknown and rejected rather
than guessed.

Every result export RFC-4180-quotes cells and prefixes an apostrophe when the
first non-whitespace character is `=`, `+`, `-`, or `@`; it contains source row,
action/result, safe canonical IDs, issue code, and localized message key/text,
not raw input or hidden tenant data. Logs contain import/correlation IDs,
counts, status, latency, retry, and error code only.

| Failure | Behaviour |
| --- | --- |
| Changed/missing object or hash mismatch | Fail closed; mark dry run stale/failed; no product mutation |
| Expired or canceled snapshot | Stable conflict; no commit/replay activation |
| Permission/member/owner/entity changed | Recheck at commit; stable forbidden/not-found or stale outcome |
| Existing product/release changed | Optimistic snapshot mismatch rolls back the whole import |
| Concurrent imports / duplicate delivery / timeout | Job lock plus canonical row keys and product RPC idempotency return one durable outcome |
| Worker/process failure | Lease expires; the next worker resumes a checkpointed stage; bounded attempts end in dead letter |
| CSV validation error | Persist safe per-row result (or file-level failure) and allow safe report download; no product mutation |

## Observability, rollout, and rollback

Metrics measure source byte size, row count, parse/plan/commit duration,
validation/commit failure counts, queue lag, retries, duplicate suppression,
dead letters, and cleanup outcomes. Operations can retry a dead letter only
after correcting the underlying condition, never by changing stored CSV bytes.

Deploy in expand/deploy/contract order: additive migration and private bucket,
generated types, contracts/API/storage/worker, then browser workflow. Existing
applications do not call the new routes, so the migration is backward
compatible. Rollback disables new routes, worker schedules, and UI only; it
never deletes a reviewed snapshot, audit event, committed products/releases, or
applied migration. A database correction is forward-only. Cleanup removes only
expired tenant-prefixed objects and may retain minimal row/audit history for
investigation.

The detailed operational procedure is in
[`m2-v1-product-release-csv-import-runbook.md`](m2-v1-product-release-csv-import-runbook.md).

## Review checklist

- [x] Direct insert/browser-only alternatives were rejected for concrete
      durability, security, and concurrency failures.
- [x] Tenant, hash, idempotency, atomicity, and storage boundaries are defined.
- [x] Required contracts and functional UI boundary are specified.
- [x] Failure, observability, forward-only rollback, and retention rules are defined.
- [ ] Contract, SQL, worker, browser, performance, and live-stack evidence is required before release.
