# M15-02 offline usage metering feature design

## Scope and preserved contracts

Expose transparent current-state seats/products/customer-byte gauges and exempt protected-byte information, auditable JSON/CSV export and explicit administrator reconciliation. Preserve signed schema1/limits, API/cookies/auth-actions, source quotas/permissions/approvals, retention/legal holds, M6 clocks, immutable snapshots, delivery contracts and navigation. No cumulative billing periods/history charts/new telemetry/data deletion.

## Concrete problem and why not simpler

M15-01's m15_01_usage repeats source aggregates, folds invitation reservations into displayed activeMembers and supplies one global availability flag. It has no definitions, timestamped counter export or administrator repair. A UI-only formatter cannot address hot read costs, transactional projection consistency or durable repair evidence.

One organization_usage_meters row is justified: licence-state rows require signed artifacts/version>0, while organizations carries profile timestamp, audit/search scope-change and export locking. Meter columns there would change independent lifecycle/export behavior. No generic event bus, metering framework, history store, job table or external telemetry is introduced.

## Selected and rejected patterns

Use existing gateway/adapter and inward-owned ports at web/HTTP/Supabase boundaries, immutable counter diagnostic functions, and source-transaction projections for repeat read cost. Each has shared schema/port and failure tests. Remove the projection if source-scale reads cease to justify it; keep source quota authority. Reject generic observers/event redelivery for quota correctness, new worker/job abstractions for explicit bounded repair, and callbacks from pages/controllers to Supabase.

## Data and tenant boundaries

Verified current membership supplies org/actor; RPCs receive org first and recheck can_view_licensing/can_manage_licensing as appropriate. Licensing permission explicitly permits organization-wide aggregate capacity, not product names/evidence/identities or foreign tenants. Browser roles cannot access meter/ledger tables. Source effects retain original authorization and tenant/product scope.

Projections commit with source changes under consistent tenant locks, including sorted global-user tenants. Existing authoritative counts/reservations still enforce capacity; missing/corrupt display caches cannot grant growth. Protected processing/finalization/audit/export never become conditional on display readiness. Source/public uploads keep verified source identity and exact bounded authority.

Gauge definitions match M15-01: active membership/useris_active plus distinct lower-email live pending reservations; products archived_atISNULL; nonprotected completed+reserved/uploading/uncertain bytes; protected inputs/generated artifacts separately deduplicated. No calendar reset; archive is not storage deletion. Numeric/ownership/size uncertainty is unavailable, never zero. Next invitation-expiry checkpoint refresh is indexed and tenant-local.

Explicit reconciliation is a tenant try-lock, three-second RPC, <=100 reservation proofs/releases, canonical source rebuild/backfill and durable M13 audit transaction. Failure rolls back; unresolved charge remains. Idempotency binds tenant/actor/request digest, with current permission rechecked on replay. No source object deletion or regulatory decision occurs.

## API boundary contracts

Feature-first licensing schemas/types define usage snapshot, diagnostic variants and POST optimistic/idempotency inputs. GETusage/view and POSTexport/view are protected diagnostics; POSTreconcile/manage is maintenance. Parse strict body/query and every JSON success. Snapshots pair locally verified licence version with meter version; final transaction detects concurrent replacement/change. Unknown trust/binding gives unverified limits, not unlimited authority.

Exports contain only fixed definitions, timestamps, period/reset rules, aggregate components, limit/status reasons and version provenance. The audited immutable receipt permits exact export replay; JSON/CSV render from it locally. No member/product/object contents, raw JWS, keys or tokens enter exports/audit.

## Frontend logic and rendering

Functional usage section extends OrganizationLicence, focused LicensingGateway owns injected transport, hooks scope by tenant/user/permissions, and pure serializer/diagnostics remain immutable. Preserve drafts across validation/network/conflict; tenant/revocation clears only scoped caches/transients. Poppins, semantic tokens, cn(), shared UI, accessible table/labels/focus/status, local dates and reduced motion remain authoritative; no marketing layout or motion dependency.

## Failure modes and verification

Tests first for finite/unlimited/unverified/zero limits, thresholds/period boundaries, duplicate source effects, invitations/activation/email/expiry, archive/restore, exact storage/uncertain/protected treatment, corrupt meters, audit rollback/timeout/conflict/replay, concurrent capacity, revoked/foreign identity and stale response/cache isolation. New/materially changed modules target all four coverage metrics>=80%; report instrumentation limits honestly. Real SQL/API/browser/egress/load checks precede completion; no zero-bug/legal/untested-browser claims.

## Rollout and rollback

CLI additive migration/source hooks then idempotent backfill/readiness, compatible API and web. Preserve historical migration drift and generated type workflow. Rollback keeps meter/admission/M13 evidence and may revert presentation to authoritative aggregates, never disables source quotas or resets data. Previously missing physical bytes need separate authoritative recovery, not metering fabrication.

## Review checklist

- [x] Direct solution, justified projection and existing boundaries selected.
- [x] Authenticated scope, non-forced RLS/grants, source authority and durable evidence specified.
- [x] Feature schemas/z.output/functional UI/injected gateway and immutable diagnostics specified.
- [x] Compatibility, failure modes, rollout and rollback specified.
- [x] RED/GREEN, coverage, independent review and full real-stack verification complete. See [verification record](m15-02-verification.md) for actual coverage, browser/load evidence and residual limitations.
