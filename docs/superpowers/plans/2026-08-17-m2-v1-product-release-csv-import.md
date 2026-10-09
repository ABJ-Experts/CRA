# M2 V1 product/release CSV import implementation plan

**Goal:** Deliver a tenant-safe, mandatory-dry-run CSV import for products and
releases without adding a second product writer or an unnecessary queue/table.

**Spec:** `docs/architecture/m2-v1-product-release-csv-import.md` and
`docs/product-release-import-csv-format-v1.md`.

## Decisions

- One strict mixed CSV format: `m2-product-release-import-v1`; 10 MiB, 10,000
  physical data rows (including blank rows), 1,000 synchronous threshold, 24-hour snapshot expiry,
  seven-day object/report cleanup, five-minute private report link.
- Use two tables—`product_import_jobs` as both snapshot and job state, and
  `product_import_rows` for paged plans/results—and the private `product-imports`
  bucket.
  Do not add a fan-out/job/report/idempotency/audit table.
- Commit is all-or-nothing. It must call the existing atomic product/release
  workflows under one transaction; CSV/controller code never inserts products
  or releases. V1 excludes every destructive/lifecycle action.

## Ordered implementation

1. Write failing contracts and pure parser tests for BOM/CRLF/quoted newline,
   strict headers, malformed/hostile input, content hashing, release-before-
   product planning, duplicate identities, owner/entity isolation, stale
   snapshots, and formula-safe report output. Add a maintained streaming parser
   dependency only if native dependencies cannot safely meet RFC-4180 and
   bounded-memory requirements.
2. Roll forward the import migration to the agreed limits and add missing
   durable lifecycle fields (stage/status, lease owner/until, checkpoint,
   attempts/next attempt/dead-letter timestamps). Keep the two-table model,
   RLS/service-only ACL, search-path hardening, composite organization keys,
   indexes, exact object-path constraints, and private bucket. Regenerate types
   only through `db:types`.
3. Implement product import ports, immutable parser/planner/executor, tenant
   owner/entity/product/release lookup, storage adapter, repository row upsert,
   atomic commit coordinator, audits, cancellation/expiry/cleanup, safe report
   writer, and fair bounded worker. Parse every database/API/wire boundary with
   shared Zod contracts; add no direct Supabase calls to controllers.
4. Add `/api/v1/products/imports` template/upload/list/detail/rows/commit/
   cancel/report endpoints with existing product permission enforcement. Add
   mocked and real gateway support, React Query polling, and an accessible
   import panel in the product registry. Keep the established operational UI
   and localization-ready message keys.
5. Add SQL/RPC/RLS/grant/index tests, Jest unit/API/worker restart tests,
   Vitest contract/UI tests, Playwright browser flow, and rollback-only scale
   fixture plus `EXPLAIN` assertions for job claiming, paging, summaries, and
   tenant lookups.

## Completion gate

Run focused tests, infrastructure SQL tests, `db:lint`, migration list/diff,
`db:types`, architecture tests, root lint/type/test/build, coverage gates, and
the local real-stack Playwright journey on port 3006. Use only a run-scoped
fixture and prove its scoped cleanup; retain screenshots and never remove other
development data.
