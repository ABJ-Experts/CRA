# M15-04: consented support diagnostics

## Scope and preserved contracts

FR-ADM-007 (BRD pp36–37, screen56, ADR-012 p14, lifecycle64, verification65): a customer administrator explicitly consents to a local, redacted logs/configuration/metrics bundle, inspects it and downloads it. Structured diagnostics only; no raw log files, environment dump, tenant evidence, support transmission, operator content access or new dependency. Current owner/admin plus `can_export_system_health`; contents and downloads belong only to the consenting administrator. Availability is24hours; physical retention is independent.

Preserve `/api/v1`, narrow refresh cookie, algorithm-aware JWT/JWKS, zero epoch skew, frozen auth actions, permission merge order, source approval/retention/deadline authority, menu/mock namespaces, existing public health and all data. No automatic POST replay. Existing `AuditService.log` remains best-effort; new critical events use transactional M13 evidence.

## Concrete problem

M15-03 composes bounded source-owned health observations but has no consent record, artifact workflow or portable disclosure. M13 durable audit and M8/M14 private delivery already solve audit/authorization/integrity boundaries. The live local inventory has293 public tables and2 views; generic exports are frozen list/readiness formats and audit exports are CSV/JSON event disclosures. Neither owns support-consent semantics.

## Why not simpler?

A synchronous response cannot survive interrupted generation, cancellation, audit failure or retries. Extending `export_jobs` would broaden source/format/state contracts and unrelated workers; using evidence documents would introduce normal library visibility and retention semantics inconsistent with creator-only diagnostics. One feature job row holds consent, state, lease, grant, artifact and cleanup metadata; no preview/grant/consent/log tables are needed.

## Selected patterns

- Application use case with repository, source and private-storage ports: current external dependencies vary independently. Presentation -> application -> domain; adapters implement inward-owned interfaces. Unit/adapter/SQL tests share identity, scope, safe-error and cancellation expectations. Remove a port if its actual boundary disappears.
- Durable leased workflow: explicit consent precedes any collection; one active tenant job,60s lease/attempt,10s heartbeat,3 infrastructure attempts, optimistic publication fence. Needed for crashes/cancel/retry; no general job framework.
- Closed projection: construct safe objects from fixed fields/enums, never scrub arbitrary text and hope. Test nested/encoded/stack/URL/credential canaries in public checked-in fixtures.
- Private verified artifact delivery: temporary0700 directory/0600 files, exclusive/no-follow opens, SHA256/size verification, exact-path60s HttpOnly one-use grant, current authorization before/after spool and during streaming.

## Rejected patterns

No generic diagnostic plugins, process-log tailer, configurable SQL/file paths, new event bus, background telemetry collector, remote support portal, automatic transmission or replacement storage framework. Reuse the stored ZIP implementation via a narrowly shared utility and preserve old imports.

## Data and tenant boundaries

Verified identity/session supplies organization and actor. Service-role operations accept organization first and explicitly filter every read/write/aggregate. Source permissions and record visibility remain authoritative. The single new `support_diagnostic_jobs` table has non-forced RLS and browser access denied. RPCs have pinned search paths and explicit grants.

Consent/job creation/audit are one transaction. Store immutable consent actor/time/selection, preview/disclosure/request digests and authority snapshot. Bind idempotency to organization/creator/key; changed payload conflicts. Worker transitions require current lease/version/authority. Upload and hash verification precede audited publication; cancel or lost lease wins over publication. Source outage becomes a safe omission; lost identity/permission stops disclosure.

24hour expiry revokes access, not retention. Use export-artifact policies and applicable holds; unknown authority blocks deletion. Reviewed diagnostic-only cleanup uses a durable intent/lease, rechecks protection, and preserves consent/audit/hash tombstones. Do not enable generic cleanup for other sources. Track retained diagnostic bytes as protected generated storage even after access expiry. Tenant export includes disclosure metadata/manifest/hash/retention only, never creator-bound content via another administrator.

## API boundary contracts

Feature-first `support-diagnostics/schemas` and `/types`; trusted types are `z.output`. All JSON bodies/queries/paths and responses are parsed. All routes under `/api/v1/system/diagnostics`: POST preview; POST/GET bundles; GET bundle detail/content; POST cancel/download-grants/cleanup-review/cleanup; GET exact grant download stream. Controller guards require admin and export-health permission. Browser central transport supplies inputSchema/schema; no direct DB calls from UI/controllers.

Preview is static disclosure fields, examples and bounded size estimate; no source reads/artifacts. A10minute purpose-separated token binds selection, actor/org/session, disclosure revision and authority; consent reauthorizes. Historical range defaults24h, max7days, UTC, no future end. Config/metrics show capture timestamps rather than claiming historical values.

## Frontend logic and rendering

Functional support diagnostics panel adjacent to System Health, focused injected gateway, scope-aware state, existing Poppins/semantic tokens/cn/shared UI subpaths. No marketing layout/font/GSAP/remote imagery. Selection -> disclosure -> unchecked consent -> progress/cancel -> redacted inspection -> explicit download. Failures/conflicts/expired/retained/empty/forbidden are explicit. Clear visible data on authority change; preserve scoped form drafts. Keyboard/focus/status labels/reduced motion and mobile stacking are required.

## Failure modes

No collection before consent; bad/expired/altered token fails. Duplicate request returns same job, changed digest409. Invalid/withheld source never becomes raw provider output. All selected sources failing is terminal. Maximum5000 events,10MiB ZIP,64MiB working budget. Generated archive names are fixed; no path inputs. Abrupt restart can only reclaim a fenced lease; publication requires current state. Failed verification/audit never returns bytes. Grant replay, wrong session, revoked identity/permission, withdrawal and expiry deny. Storage deletion failure leaves inaccessible retryable cleanup; holds/unknown projections retain bytes. Partial output explicitly lists safe omissions.

## Tests and observability

Observe RED before production code;>=80% statements/branches/functions/lines on new/materially changed modules. Schemas/policies/redaction corpus; fake clock/deadline/cancellation/restart/lease tests; real SQL/RLS/audit rollback/concurrency/storage authorization; forged tenant/restricted product/revoked identity; corrupted/missing object; grants replay; legal hold/retention/export-protection/cleanup races; exact-byte metering. Run focused suites, pnpm verify and applicable live suites without resetting existing data. Use isolated task fixtures for destructive cases.

Playwright MCP seeded-owner real journey, desktop/mobile screenshots, keyboard and accessible names, no unrelated origins/site-data/tab clearing. Run Chromium/Firefox/WebKit tests, record actual browser versions/native coverage limits. Metadata load fixture10000 jobs with concurrent small tenant requests p95<400ms,p99<1000ms. Egress-blocked generation permits only configured local dependencies. Logs expose safe codes/stages, never inputs/tokens/content. No zero-bug certification claim.

## Rollback

CLI-created additive migrations only, both type copies through existing generator. Expand schema -> matching contracts/API/worker/web. No reset, historical replay, destructive restore or ledger repair. Rollback disables new UI/routes/worker and retains rows, receipts, hashes and private objects. Existing feature/module behavior continues.

## Review checklist

- [x] Direct solution and existing workflow reuse evaluated.
- [x] Current boundaries, immutable policies, lifecycle and removal triggers documented.
- [x] No request/user/organization state in global singleton.
- [x] Source queries excluded from controllers/pages.
- [x] Shared input/output schemas and functional rendering required.
- [x] Transactional audit/idempotency/publication and retention fences specified.
- [x] Focused coverage, live verification, independent review and rollout evidence completed; see [verification](m15-04-verification.md) for results and residual limits.
