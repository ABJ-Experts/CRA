# M15-02 Offline Usage Metering Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement the independent tasks with scoped ownership and review. Steps use checkboxes.

**Goal:** Make the three existing licence gauges understandable, exportable and reconcilable without external connectivity.

**Architecture:** Functional Organization Licence UI calls a focused gateway and shared Zod contracts. Thin Nest routes invoke application policy/ports and tenant-scoped Supabase RPCs. A single source-maintained meter row per tenant accelerates display reads; existing source records/reservations remain hard-limit authority.

**Tech Stack:** Installed TypeScript, Zod, React/Next, Nest, Supabase/PostgreSQL 17, PostgREST 14, Jest/Vitest/Playwright; no new dependencies.

**Spec:** `docs/architecture/m15-02-offline-usage-metering.md`, approved conversation plan and BRD FR-ADM-004 pp36-37/screens54-56/ADR-012 p14/lifecycle64/verification65.

## Global Constraints

- Original checkout, milestone-1 baseline 5281e6b; no new branch, reset, retained-data deletion, commit or push.
- Preserve /api/v1, narrow refresh cookie, ES256/JWKS, frozen auth-actions, zero epoch skew, permission merge, source approvals, menu/mock namespace and non-forced RLS.
- Three existing signed limits only; protected storage is exempt. No billing, cumulative allowances, automatic telemetry or speculative history charts.
- Use existing can_view_licensing for usage/export and can_manage_licensing for reconciliation; hard org overrides and current identity remain authoritative.
- CLI-created additive migrations and CLI-generated type copies only. Preserve historical migration-ledger drift.
- Every consumed input and successful JSON output is shared-schema parsed; trusted types derive from z.output.
- RED/GREEN first; >=80% statements, branches, functions and lines for new/materially changed modules; independent review and real-stack verification.

## Review Focus

1. A stale or corrupted display meter must never permit excess source growth.
2. Case-variant invitations, active-member matching and expiry must not double charge seats.
3. Uncertain uploads stay charged; missing sizes/ownership are unavailable, never zero.
4. Licence replacement and source changes cannot produce a mixed-version export; replay remains actor/tenant/request bound.
5. Protective ledger append, existing admitted finalization and authenticated evidence export remain available under expiry or meter degradation.

## Task 1: Definitions, contracts and pure diagnostics

Files: shared `licensing/schemas/usage.schemas.ts`, `licensing/types/usage.types.ts`, index exports, colocated schema specs; API `licensing/domain/usage-diagnostics.ts` and spec.

Interfaces: LicenseUsageSnapshot, LicenseUsageOperationInput, LicenseUsageExportResponse and LicenseUsageReconciliationResponse. Counter IDs are seats/products/storage/protected_storage. Components are activeMembers/reservedInvitations/products/storageBytes/storageReservedBytes/protectedStorageBytes. Limits have finite/unlimited/unverified/exempt variants; only protected storage is exempt. States normal/near_limit/at_limit/over_limit/unavailable.

- [ ] Write and observe failing schemas/diagnostics tests: exact definitions, safe integers/null unavailable, 80%/equality/excess/zero cap, invalid/unlimited limits, no calendar reset, storage component sums, privacy bounds.
- [ ] Implement schemas/types and immutable diagnostics; timestamps output UTC, current-state period/reset rules, observation/reconciliation/version provenance.
- [ ] Run focused contracts/domain suites and four-metric coverage; preserve legacy licence schemas and claim schema version1.

## Task 2: Meter authority and bounded reconciliation

Files: CLI-created M15-02 migration(s), `apps/infrastructure/tests/m15-02-*.test.sql`, relevant SQL concurrency harness.

Interfaces: m15_02_read_usage(org,actor,expected_license_version), m15_02_usage_receipt(org,actor,operation,idempotency_key,request_digest), m15_02_export_usage(org,actor,expected_license_version,expected_meter_version,idempotency_key,request_digest,snapshot), m15_02_reconcile_usage(org,actor,expected_license_version,expected_meter_version,idempotency_key,request_digest).

- [ ] Write and observe failing real SQL tests before implementation: projection transitions, authorization, quota bypass, receipt conflict/replay, audit rollback, concurrent repair/growth, expired invitations and ambiguous storage.
- [ ] Create organization_usage_meters, one typed row per tenant, non-forced RLS/browser access denied, source/meter versions, independent availability/reasons, next invitation expiry and reconciliation metadata.
- [ ] Maintain source contributions transactionally for members/global user active/email changes/invitations/products/ledger and source-owned generated storage. Use existing tenant locks, sorted multi-tenant order and consistent ledger lock order. Do not block safety operations because display state is unavailable.
- [ ] Keep m15_01_usage and source quota authorities authoritative; migrate presentation state reads to primary-key projection reads, maintaining frozen wire shapes. Invitation expiry refresh runs only when its stored checkpoint is due and uses tenant indexes.
- [ ] Implement explicit reconciliation under try-lock and function-level three-second timeout, at most100 reservation candidates/request, canonical source rebuild and idempotent unambiguous ledger backfill. Unknown/ambiguous data remain charged/unavailable. No data or object deletion.
- [ ] Commit corrections and M13 audit together; actor/tenant/request digest replay precedes optimistic version checks but always rechecks current permission. Safe export/reconcile receipts use M13, no history/job table.
- [ ] Validate migration rollback-only first, root applies only new CLI migration(s) to matching local stack, generate both types with db:types. Verify actual PostgREST timeout and RLS/grants/search paths.

## Task 3: Application and HTTP integration

Files: focused usage application policy/port, Supabase adapter, thin LicensingUsageController and specs. Root owns module/register wiring.

Interfaces: GET /api/v1/licensing/usage; POST /api/v1/licensing/usage/export; POST /api/v1/licensing/usage/reconcile. POST bodies contain expectedLicenseVersion, expectedMeterVersion, idempotencyKey. No browser tenant ID, raw snapshot or artifact input.

- [ ] Write and observe failing app/adapter/controller tests for identity/scope/version races, missing trust/binding, unknown limits, failure mapping, safe replay and output parsing.
- [ ] Build coherent usage snapshots from fresh locally verified licence context and tenant projection. Unconfigured/unverified licence context cannot become an unlimited grant. Recheck licence/meter versions on export commit.
- [ ] Export immutable snapshot/audit receipt; reconciliation returns safe immutable repair receipt and UI refreshes current usage separately. DB/audit outage yields bounded errors, not fabricated counters.
- [ ] Register routes as protected diagnostics/maintenance behind normal auth/RBAC; update M15 operation and M13 durable audit registers, permission coverage and module seams.
- [ ] Run focused API coverage and independent correctness/security review.

## Task 4: Gateway and operational UI

Files: LicensingGateway/query hooks and specs, functional organization usage section and specs, local JSON/CSV serializer.

- [ ] Write and observe failing transport/component tests for schema boundaries, privacy, locale/exact-byte display, states, conflicting/busy repair, export/replay and tenant/revocation cache isolation.
- [ ] Add accessible Licence capacity table with components, definitions, observation/reconciliation provenance, verified-limit interpretation and independent unavailable statuses.
- [ ] Add JSON/CSV downloads from audited immutable snapshot; use existing CSV escaping patterns. Add permissioned explicit reconciliation with same-request retry identity; no POST auto-replay after refresh.
- [ ] Preserve licence/other drafts, clear only tenant-scoped transient state, retain incumbent Poppins/tokens/cn/shared UI and no new decorative/motion dependency.
- [ ] Verify keyboard/focus/status announcements/non-colour states/reduced motion/mobile overflow and bounded desktop/mobile Impeccable inspection.

## Task 5: Completion evidence and rollout

- [ ] Run pnpm verify, focused >=80% coverage, live SQL/API/auth/concurrency/storage authorization and M1-M12/navigation regression gates.
- [ ] Playwright MCP with verified development owner: normal/near/at/over/unavailable, JSON/CSV, successful/replayed/conflicting repair, restricted/revoked identity, tenant switch and expiry/evidence export. Cross-check matching Supabase rows/audit/grants; preserve unrelated browser origins and retained data. Exercise Chromium/Firefox/WebKit and record actual coverage/screenshots.
- [ ] Block external process egress for core journeys and offline restart/renewal compatibility. Dynamic test signing keys remain ignored/private, never shipped.
- [ ] Isolated realistic-scale fixtures:10k members,10k products,100k accounting rows,10k licence audit events;200 measured samples per read endpoint with small-tenant overlap and unchanged throttling. Target p95<400ms/p99<1000ms. Explain plans must show hot reads using projections/indexes rather than full source scans.
- [ ] Publish requirement/test mapping, contract links, screenshots, actual load/offline/browser measurements and backfill/reconcile/rollback runbook.

Rollout: destination/catalog -> install source maintenance -> idempotent backfill/reconcile -> readiness -> compatible API/web deployment. Rollback retains meters/ledger/audit and may return presentation reads to authoritative aggregation; never remove M15-01 enforcement. Existing missing-byte recovery and legacy decorator-coverage qualifications remain explicit separate risks.
