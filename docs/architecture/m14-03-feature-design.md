# M14-03 feature design

## Scope and preserved contracts

Export every production workspace/portal list with its source filters, ordering, row-access policy and approved fields; render per-product documentation-readiness PDF and JSON. All-filtered is default; page/selection require existing view support. Limits: 100,000 rows, 128 MiB capture, 64 MiB per artifact, 1 GiB total, 512 checkpoints. No automatic approval, retention change, generic designer or tenant-exit replacement. Preserve /api/v1, ES256/JWKS, narrow refresh cookie, zero session epoch skew, frozen auth actions, permission merge order, public-route/permission gates, menus and mocks. No POST replay on refresh.

## Concrete problem

Audit exports already own durable jobs, immutable scope, durable access events and private streamed files. Technical-file snapshots already own canonical immutable readiness. Neither captures mutable filtered values for every production list or writes XLSX. Live CRA has domain-specific export tables; overloading those would change their source contracts. IDs/high-water alone cannot freeze mutable values.

## Why not simpler?

Synchronous CSV buffers exceed bounded memory and cannot survive restarts. Repeated paginated GETs see different snapshots. Browser export trusts browser authority and may leak hidden fields. Existing whole-tenant export table locks are inappropriate for filtered lists. Reuse policies and infrastructure helpers, not domain-specific lifecycle tables.

## Selected patterns

- Adapter: Supabase/storage are external boundaries; repositories implement inward-owned export ports. Contract suites verify tenant-first queries, leases and failures. Remove adapter only if external dependency disappears.
- Strategy through immutable source registry: current source query/access/columns vary across real production families. Every source has a shared query schema and explicit projection. Source conformance proves list/export parity. Replace registry with direct composition if only one source remains.
- Durable state transitions: queued, capturing, audit_pending, rendering, ready, failed, cancelled, expired represent actual long-running capture/output/delivery. Optimistic versions and lease fences stop stale workers. No state-machine framework or event bus.

Dependency direction: functional React → injected gateway → transport/shared schemas → thin controller → application policy/port → adapter → Supabase. No global request/session identity.

## Rejected patterns

No generic report designer, provider hierarchy, command bus, observer-based authorization, global singleton identity, browser-authoritative decision, whole-tenant buffered JSON or speculative cache. Explicit immutable functions and source-owned SQL helpers are smaller and auditable.

## Data and tenant boundaries

Identity comes from verified existing member or scoped portal session. Service-role operations receive organization first and enforce tenant-qualified relationships, actor and source/product scope. Capture inserts frozen approved values in one bounded database snapshot; published rows are immutable. Idempotency key plus canonical request digest rejects conflicting reuse. No row counts before source authorization. Preserve captured values across restart; audit_pending records durable publication work without holding the audit-chain lock during capture. Private staged parts/checkpoints survive host changes. Recheck all access before/during delivery; grants are one-time API delivery grants, never public storage URLs.

Two additive tables: export_jobs owns principals/request/version/lease/capture/audit/checkpoints; export_snapshot_rows owns approved immutable row values/ordinal/source version. Non-forced RLS, tenant-qualified constraints, explicit service-only RPC grants and pinned search_path. Existing export tables unchanged. CLI migration then generated types, contracts/API/worker then UI; feature disable allows old API to run against additive schema. Do not delete rows/artifacts on rollback. Availability is 24h bounded by portal expiry; retention/legal holds govern cleanup separately.

## API boundary contracts

Feature-first @repo/contracts/exports schemas/types derive trusted shapes with z.output. Create discriminated source requests share owning feature filters/context. Jobs list/get/cancel/retry/grants and product readiness creation are under /api/v1; portal variants remain existing scoped controllers. Parse body/query/path through existing Zod helpers and successful JSON through @ZodResponse; downloads declare @NonJsonResponse. Web provides inputSchema/schema. Strict unknown fields; default all_filtered; source transforms preserve existing parsed semantics. Only explicit whitelisted columns may be captured.

## Frontend logic and rendering

Functional source export controls and status panel preserve view/unsaved work. ExportsGateway owns injected transport and polling lifecycle; no database calls in pages. Pure selection/format policies remain functions. Composition root/test seam passes real or fake transport. Semantic tokens/cn/shared UI subpaths, visible focus/labels and non-colour status, locale dates and reduced motion.

## Failure modes

Database/storage/network failures remain failures, not permission grants or sign-out. Revoked user/product/portal scope fails closed. Conflicting idempotency/version returns conflict. Capture limit/timeouts roll back completely; retry before successful capture receives a new as-of. Failed audit publication remains unpublished pending work. Stale leases cannot publish. Partial upload checkpoints resume idempotently; cancellation stops work and access. Unsupported XLSX cell lengths return CSV alternative; never truncate. PDF unsupported glyphs have explicit fallback while JSON preserves source text. Restricted evidence suppresses identifiers/counts and marks degraded documentation readiness.

## Tests and observability

First contract tests observed failing for missing export schema, then source parity/security/schema/format tests. Require ≥80% branch/function/line/statement touched coverage. Database RLS/transaction/storage tests include forged tenant, revoked identity, restricted product, portal expiry, concurrency, duplicate events, crash/restart, failed audit and legal holds. Independently parse CSV/XLSX/PDF. Owner browser E2E isolated to development origin, screenshots, accessibility and compatibility. pnpm verify and live-stack gates; realistic 10k/100k/1m-source timings/memory/fairness. Logs contain job/source/version/stage/error codes, never secrets or unauthorized row data. Retain baseline M14-02 read-performance limitation in completion evidence.

## Rollback

Disable creation and worker, preserve status/read/download compatibility for permitted existing jobs. Additive schema retained; no destructive down migration, reset or artifact deletion. Cleanup respects retention and holds. Deploy permission catalogue/RPC grants together; existing modules and best-effort AuditService signature unchanged.

## Review checklist

Design decisions complete. Execution evidence must establish parsed boundaries, scoped adapters, durable audit, successful live gates/coverage and independent review before completion. No certification or zero-bug claim.
