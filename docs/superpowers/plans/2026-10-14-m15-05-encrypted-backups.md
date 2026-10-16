# M15-05 Encrypted Backups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax for tracking. The user has approved execution; do not commit or push.

**Goal:** Configure encrypted whole-deployment backups and verify certified recovery points in clean isolated targets.

**Architecture:** Functional React and parsed gateways call thin controllers and feature application policies. Inward ports separate durable SQL lifecycle, native capture, encrypted repository and isolated verification, with explicit private operator authority.

**Tech Stack:** Existing TypeScript, Zod, NestJS, React, PostgreSQL 17.6, Supabase, Docker and GPG; no new dependency.

**Spec:** `docs/architecture/m15-05-encrypted-backups.md` and the approved M15-05 task in this session.

## Global constraints

- Exactly two feature-owned tables, enabled non-forced RLS and explicit RPC grants.
- Preserve existing data, metadata-only operator authority, schema-v1 health and all authentication contracts.
- Maximum write pause 120 seconds, enforced independently and by PostgreSQL transaction deadline.
- Certified cuts every 30 minutes, daily base, verification first and every 30 days, retention 30 days subject to holds.
- Separate mounted keys and off-host repository; AES-256 OCB; no ordinary persistent plaintext staging.
- Scheduling disabled until configuration and a complete recovery drill validate.
- No production reset/cutover, arbitrary timestamp recovery, archive access UI or unrelated cleanup.

## Review focus

- Old mTLS grants and tenant owners must confer no backup execution actions.
- Missing historical object bytes must yield incomplete evidence, never a healthy certificate.
- Expired fences, cancellation and stale workers must never publish certified recovery points.
- Restored source credentials and outbound delivery must remain quarantined even when historical integrity succeeds.
- Cleanup must preserve the last recoverable dependency chain and fail closed on unknown protection authority.

### Task 1: Contracts and compatibility

**Files:** `packages/contracts/src/backups/**`, `packages/contracts/package.json`, system health schema exports.
**Produces:** Strict feature schemas/types for policy, runs, requests, verification checks and scoped assurance; opt-in health v2 while v1 stays unchanged.

- [x] Write failing strict-boundary and v1 characterization tests, observe RED.
- [x] Implement schemas/types and exports; run contracts tests and coverage to GREEN.

### Task 2: Durable persistence

**Files:** CLI-created `apps/infrastructure/supabase/migrations/*m15_05*`, `apps/infrastructure/tests/m15-05*`.
**Produces:** Two-table SQL lifecycle, narrow control role/RPCs, transactional M13 receipts, leases, idempotency, version checks, bounded customer projection.

- [x] Write failing SQL isolation/audit/transition/cleanup tests and observe RED.
- [x] Implement additive migration and run real database tests without resets.
- [x] Regenerate database types through the existing infrastructure command.

### Task 3: Native capture and encrypted repository

**Files:** `apps/api/src/backups/application/backup-execution.port.ts`, `apps/api/src/backups/infrastructure/{capture,repository}/**`.
**Produces:** Typed capture port, mounted alias validation, native PG17.6 base/WAL capture, AES-256 OCB parts/journal, bounded write fence and exact object verification.

- [x] Write failing path/key/WAL/cancellation/fence/partial-publication tests and observe RED.
- [x] Implement bounded native adapters with safe failures and run focused coverage.

### Task 4: Isolated restore verification

**Files:** `apps/api/src/backups/infrastructure/restore/**`.
**Consumes:** Certified manifest/repository and execution port from Task 3.
**Produces:** Fresh egress-denied target provisioning, authenticated restore, historical integrity checks and quarantined target-only application probes.

- [x] Write failing corrupt ciphertext/target reuse/egress/credential/audit tests and observe RED.
- [x] Implement runner; run disposable real restoration and focused coverage.

### Task 5: Application, authorization and worker

**Files:** `apps/api/src/backups/{application,domain,infrastructure}/**`, controllers/module/worker entry; existing operator grants/listener and health integration.
**Consumes:** Tasks 1–4; control repository RPCs and native execution ports.

- [x] Characterize legacy grants/health/licensing and write new policy/API/worker failure tests; observe RED.
- [x] Implement fresh action grants, private JSON/origin checks, idempotent application facade, fair worker scheduling, retention review and scoped assurance.
- [x] Run focused/API/architecture/security reviews; resolve findings.

### Task 6: Operational interfaces

**Files:** `apps/operator/app/backups*`, operator console composition; `apps/web/app/_features/system-health/**` backup assurance integration.
**Consumes:** Task 1 schemas and Task 5 routes.

- [x] Write failing gateways and state/rendering/keyboard tests; observe RED.
- [x] Implement scoped drafts, validation/run/verify/cancel/cleanup controls and independent capture/restore assurance.
- [x] Run focused web/operator checks and design review, preserving incumbent styling.

### Task 7: End-to-end evidence and rollout

**Files:** `apps/api/test/m15-05*`, architecture evidence/runbooks and requirement mapping.

- [x] Run real SQL/RLS/audit/storage authorization and failure suites.
- [x] Use Playwright MCP for owner/private operator journeys, desktop/mobile screenshots and keyboard checks; run three installed engines and report versions/limits.
- [x] Measure scoped 10,000-run metadata reads with concurrent traffic.
- [x] Measure complete isolated recovery with at least 1 GiB database and 1 GiB objects, including provisioning/decryption/replay/application checks and blocked egress.
- [x] Run all focused coverage and `pnpm verify`; record actual failures and limitations without unverified claims.
- [x] Publish requirement mapping, contract references, key escrow/rotation, deployment/rollback and separately authorized production restore runbooks.

## Execution evidence

Baseline: clean `milestone-1` at `8268d9858556003e28b599d7d91610a264a7d3a5`. Planning inspected all 352 non-system table relations and matching original local `cra` Supabase. Existing original Storage repair and missing historical object bytes are preserved. Implementation, focused RED/GREEN tests, additive SQL deployment, browser execution and final `pnpm verify` completed on 15 October 2026. See `docs/architecture/evidence/m15-05/verification.md` for observed results and deployment limitations. The original database has no backup policy or run; only the complete disposable source is used for capture/restoration.
