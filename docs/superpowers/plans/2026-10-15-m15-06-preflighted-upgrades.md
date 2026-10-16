# M15-06 Preflighted Upgrades Implementation Plan

> **For agentic workers:** Use subagent-driven-development with explicit ownership,
> independent review and TDD. Preserve concurrent work. No commits/pushes or live
> upgrades, source restores, resets or data deletion are authorized by this plan.

**Goal:** Deliver signed offline Linux Compose application upgrades with truthful
preflight, durable restart reconciliation and compatible-image rollback.

**Architecture:** Extend the private operator realm with feature-owned contracts
and a host supervisor outside the application release. Use an authenticated host
journal and existing durable audit/backup boundaries, without new source tables.

**Tech Stack:** Existing TypeScript, Nest, functional React, Zod, Node crypto/fs,
Docker Compose and pinned Supabase CLI. Reuse installed dependencies.

**Spec:** `docs/architecture/m15-06-preflighted-upgrades.md`, approved conversation
plan and original BRD FR-ADM-008/010, ADR-011/012/014.

## Global constraints

- Baseline `milestone-1` at `618f26c`; preserve unrelated work and original data.
- Linux Compose, mounted media, fixed Supabase runtimes, image-only rollback.
- No new source tables/columns/FKs; use explicit grants/search paths if RPC added.
- Private mTLS instance scopes; no tenant-cookie deployment authority.
- Preserve API/auth/RBAC/menu/mock/licensing/retention/source-approval contracts.
- No network fallback, arbitrary hooks/Compose/paths, destructive recovery or
  automatic rollback after exposure is possible.
- Full reference qualification runs separately; do not overload local Docker.

## Review focus

1. Candidate bootstrap can write before listening: previous images must still work.
2. Migration commit may precede lost acknowledgement: reconcile ledger, do not repeat.
3. Inbox/archive/image substitution after verification: execute staged exact bytes.
4. A process exit/expired lease does not prove external-effect drain.
5. Exposure intent must precede worker activation and survive supervisor restart.

## Task 1: Release packaging and process lifecycle

- [x] RED: tests enumerate fixed service/worker inventory, no pull/build/hooks,
      instance volume ownership, maintenance restart and drain refusal.
- [x] GREEN: reproducible image recipes, fixed Compose profiles, reviewed service
      inventory, bounded shared maintenance lifecycle and entrypoint coverage gate.
- [x] Verify focused tests and static release policy before integration review.

## Task 2: Shared contracts and signed media

- [x] RED: strict manifest/wire schema, signature/trust/expiry, digest/inventory,
      path/archive limits and image/platform substitution cases.
- [x] GREEN: feature-first schemas/types/exports; bounded no-follow private staging,
      purpose-separated Ed25519 verification and local signing/packaging tooling.
- [x] Verify contracts and verifier coverage; review hostile-media boundaries.

## Task 3: Journal, preflight and supervisor

- [x] RED: intent/result crash points, sequence floor, optimistic/idempotent
      conflicts, corrupt authority, backup/key/capacity/runtime/ledger failures.
- [x] GREEN: authenticated durable host journal, instance lock, focused ports,
      Linux adapter, independently pinned supervisor and private local control.
- [x] Add backup repository holds under existing cleanup/publication authority.
- [x] Verify restart reconciliation and preflight fingerprint freshness.

## Task 4: Upgrade and rollback execution

- [x] RED: incomplete drain, interrupted migrations, commit-before-ack, candidate
      startup writes, degraded HTTP200, rollback failure and post-exposure crash.
- [x] GREEN: staged -> preflight -> explicit initiation -> drain -> verified
      checkpoint -> exact CLI migrations -> candidate -> semantic checks -> exposure
      intent -> activate workers/traffic -> post-activation checks -> success.
- [x] Revert only recorded compatible previous images before exposure; retain
      schema/data/queues/audit/licensing and leave unknown outcomes in maintenance.
- [x] Project exact externally journaled audit facts idempotently, without a
      global AuditService behavior/signature change.

## Task 5: Private operator workbench

- [x] RED: grants/scope, input/output parsing, stale reviews, duplicates, late
      responses, reload recovery, forbidden/degraded/conflict/export states.
- [x] GREEN: focused gateway + functional workbench alongside backups; mounted
      inbox selection/checklist/approval/progress/history/redacted JSON result.
- [x] Update narrow private-controller gates and coverage inclusion.
- [x] Verify keyboard/focus, desktop/mobile and semantic style mechanically.

## Task 6: End-to-end qualification and evidence

- [x] Run focused >=80% coverage, architecture/type/lint checks and `pnpm verify`.
- [ ] Exercise disposable database/RLS/storage and egress-blocked lifecycle tests.
- [x] Use Playwright MCP for private operator test-certificate and seeded-owner
      customer regressions; capture screenshots without clearing other site data.
- [x] Add N/N-1/N-2 real-artifact qualification harness and separately provisioned
      reference-runner workflow measuring <30min paths and p95/p99 metadata reads.
- [x] Publish requirement/test matrix, contracts, runbook and residual limitations;
      do not mark unrun external-reference/production paths as qualified.

Implementation checks above refer to source, unit/integration tests and the
explicitly simulated-native browser fixture. They do not qualify a real release.
Current command results, the existing M12 SQL gate failure and unrun native
database/storage/fault/egress/performance qualification are recorded in
`docs/architecture/m15-06-verification.md`. Authentic artifact builds and separate
Linux reference execution remain required before production enablement.
