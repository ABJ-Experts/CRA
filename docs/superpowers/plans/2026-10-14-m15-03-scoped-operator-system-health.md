# M15-03: Scoped operator administration and customer system health implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement task by task, with independently owned parallel work as authorized by the user. Preserve all existing work and do not commit, push, create branches, or access production.

**Goal:** Provide authorized tenant health and a separate private, read-only operator metadata registry without granting tenant-content authority.

**Architecture:** Functional React invokes focused gateways with feature-first Zod contracts. Thin Nest controllers invoke application ports; Supabase adapters enforce live source scope. A separate mTLS composition root serves static operator assets and fixed metadata APIs using a least-privilege database credential.

**Tech Stack:** Installed React/Next.js, NestJS, Zod, Supabase/PostgREST, Node TLS and existing M13 audit authority.

**Spec:** `docs/architecture/m15-03-scoped-operator-system-health.md`, approved conversation plan and FR-ADM-001/006.

## Global constraints

- Work only in `milestone-1`; baseline HEAD `4b5f677`. Preserve pre-existing contract drafts, data, browser origins and worktrees.
- Local Supabase only: confirmed URL `http://127.0.0.1:54321`, PostgreSQL 17.6 and 292 public tables before implementation. Never contact production.
- Preserve `/api/v1`, ES256/JWKS, narrow refresh cookie, zero epoch skew, frozen auth actions, permission merge order, source approvals, retention, legal holds, menu/mock namespaces and evidence export.
- Never let health, operator scope or licence metadata authorize tenant content or regulatory decisions.
- Keep public health bodies compatible. Every new JSON input/success boundary is parsed using shared schemas and `z.output` types.
- No new third-party dependency, generic health/history/metering framework, backup producer, impersonation or registry UI mutations.
- CLI-created additive migrations, non-forced RLS, pinned search paths, explicit RPC grants; regenerate both database type copies through `db:types`.
- Observe RED before implementation; require >=80% statements, branches, functions and lines for new/materially changed modules. Report genuine instrumentation limits.

## Review focus

- A valid operator database token with a forged owner subject/session must still be rejected by tenant authentication.
- Removing a certificate grant must revoke access on a reused TLS connection; forwarded certificate/role headers never authorize.
- A System health grant does not reveal source metrics outside live tenant/product/domain permissions.
- Retained successful observations must not become fresh on a failed poll or out-of-order publication.
- Expiry, unknown health, audit/storage failures and absent backup authority must not stop protected evidence access or protective processing.

### Task 1: Contracts and diagnostics

**Files:** `packages/contracts/src/system/{schemas,types}`, `packages/contracts/src/operator/{schemas,types}`, contract exports, permissions and corresponding tests.

**Interfaces:** Customer response includes tenant identity, per-source timestamps, nullable/withheld observations, five health states, bounded queue counts, licence/usage links, version and distinct unknown backup/restore assurance. Operator responses contain only approved metadata and keyset pagination. `can_view_system_health` defaults owner/admin and preserves hard overrides.

- [x] Inspect and preserve existing contract drafts; write failing cases for redaction, null/unknown, capped counts, permission defaults and strict schema compatibility.
- [x] Run focused Vitest tests and record the intended RED result.
- [x] Implement/complete schemas, `z.output` types and pure diagnostic mappings. Queue counts capped at 10,000 use an explicit exact/at_least relation; human review/uncertain work is distinct from runnable backlog.
- [x] Run GREEN and focused coverage, build contracts, then independently review the contract boundary.

### Task 2: Database/source authority

**Files:** CLI-created M15-03 migrations, `apps/infrastructure/tests/m15-03*`, generated types, source adapters.

**Interfaces:** Tenant health RPCs require verified organization/actor first and source permissions. One `operator_registry_observations` table holds latest normalized instance/tenant metadata, revision/digest and source/attempt/success timestamps. Operator read role has only fixed metadata/audited-read RPCs; collector/service-role publication has separately granted write authority.

- [x] Write failing SQL/PostgREST tests for tenant/product isolation, source permission revocation, PUBLIC/inherited grants, observation ordering/replay and audit failure rollback.
- [x] Confirm local destination before each migration; inspect existing source enums/indexes. Create migration with the CLI and add only needed tenant-active indexes.
- [x] Implement read/publication/audited-read RPCs with pinned search paths and non-forced RLS. Remote identifiers do not FK to unrelated local organizations. Audited reads commit M13 security-scope receipts before disclosure; raw artifacts/content never appear.
- [x] Apply only new migrations locally without reset or historical replay; run real tests, database lint/advisors and `db:types`.

### Task 3: Customer API and source probes

**Files:** `apps/api/src/system-health`, bounded public health probes, application composition and operation registers/tests.

**Interfaces:** `GET /api/v1/system/health` requires `can_view_system_health`, receives tenant from live session, and is a protected security diagnostic. Application source ports accept cancellation; sources degrade independently. Per-probe budget 250ms, concurrency four, overall collection budget 900ms after authorization.

- [x] Characterize public liveness/readiness response semantics and write failing cancellation, partial failure, source withholding, unknown backup/version and expiry-export regression tests.
- [x] Implement ports/adapters/use case/controller. Use existing licence verification/usage/M6/feed authorities. Feed source timestamps/thresholds remain authoritative; M6 detailed heartbeat stale after 120 seconds does not rewrite deadline or public-ready authority.
- [x] Register routes/workers/audit effects and enforce architecture coverage. Source/storage probes never create/delete a probe object; accounting is not a physical-integrity claim. Empty queues do not grant worker-health status.
- [x] Run focused API/contract/coverage/live authorization tests and independent review.

### Task 4: Private operator ingress and fleet collector

**Files:** `apps/api/src/operator`, `operator-main.ts`, bounded collector entry point/tests, API package scripts, security architecture checks.

**Interfaces:** Private GET `/api/v1/operator/session`, `/instances`, `/instances/:instanceId`, `/instances/:instanceId/tenants`, `/instance-metadata`. Default page 50/max100. Exact verified TLS fingerprint maps to a stable principal UUID and explicit instance/tenant metadata scopes; no default grants. Scoped cursors bind configuration revision. Stable instance ID is required for operator enablement.

- [x] Write failing certificate/header/tenant-escalation/credential-confusion, keepalive revocation, scope/cursor, wrong binding, timeout and stale observation tests.
- [x] Implement opt-in private listener, TLS>=1.2/rejectUnauthorized=true, raw socket auth, fresh mounted grant validation and explicit CA restart. Serve static operator assets on the same TLS origin. Tenant routes are absent; operator routes are absent from the tenant listener.
- [x] Use a mounted backend-only narrow PostgREST credential, no service-role import/content client in ingress. Explicitly reject that role in tenant auth before profile access.
- [x] Implement configured private pull collector, no redirects/public fallback, expected instance binding, bounded 256KiB pages, concurrency four/30-second cadence, fair nonoverlapping cycles. Retain last observations on failure; no call-home. Unknown backup/restore until M15-05.
- [x] Run real TLS/PostgREST denial/audit tests, offline/restart tests, coverage and independent security review.

### Task 5: Customer and operator UI

**Files:** `apps/web/app/_features/system-health`, Organization integration, independent `/organization/health`, `apps/operator` static Next export and focused gateways/components/tests.

**Interfaces:** Tenant gateway uses established authenticated transport and parsed shared schemas. Operator gateway uses only same-origin mTLS GET transport, no CRA session refresh/cookies/JWT. UI queries are identity/tenant/permission-version scoped. Static operator assets contain no credentials or source data at build time.

- [x] Write failing gateway/component tests for loading, forbidden, partial/unknown/stale, retry, tenant switching, revocation and unrelated draft preservation.
- [x] Implement operational accessible tables, explicit units/count qualifiers/timestamps and existing licence/usage links. No new sidebar category or decorative redesign; preserve Poppins/tokens/cn/shared UI and statutory countdown prominence.
- [x] Add full-page independent customer route and Organization entry. Operator list/detail is read-only, with version/licence actions limited to existing authorized tenant/deployment workflows.
- [x] Run focused tests/coverage, desktop/mobile batched inspection and bounded Impeccable review.

### Task 6: Full verification, evidence and runbooks

- [x] Run `pnpm verify` and applicable local SQL/PostgREST/auth/navigation/M1-M12 regressions.
- [x] Use local owner through Playwright MCP; cross-check observations/grants/M13 receipts with matching Supabase MCP. Use task-owned operator test certificates and isolated browser contexts. Never clear other origins/site data.
- [x] Exercise Chromium, Firefox and WebKit, keyboard/accessibility, offline core operation and expiry preserving reads/evidence export. Record actual coverage, not native Safari/current-previous claims.
- [x] Benchmark 200 measured samples per read endpoint with realistic isolated 10,000-tenant registry/100,000-queue-row fixtures and concurrent small-tenant traffic, unchanged rate limits; targets p95<400ms/p99<1000ms. Verify indexed/cached reads, no ordinary full-source scan/fleet fan-out. Remove only task-owned disposable resources.
- [x] Provide screenshots, requirement-to-test mapping, actual measurements, source thresholds and operator trust/scope/revocation/backfill/rollback runbooks. Retain evidence/cache on rollback; disable only new collector/listener and preserve M15-01/02 enforcement.

## Execution record

Completed on milestone-1. Existing contract drafts were preserved and independently reviewed. Final implementation/verification evidence, qualifications, screenshots and runbooks are in docs/architecture/m15-03-verification.md and m15-03-runbook.md. No production changes, commit, push or new branch. Task-only fixture volumes are retained; test services stopped.
