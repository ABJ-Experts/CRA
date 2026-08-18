# M2 V2 Substantial Modifications + Security Update Artifacts — Completion Plan

**Goal:** Ship the previously-attempted M2 V2 feature (FR-PROD-007/014) by restoring the complete prior work from `stash@{0}`, repairing its identified defects, closing test/UI gaps, and verifying end-to-end against the live stack — without breaking any existing functionality.

**Strategy:** The stash (24 tracked files + 47 untracked files, incl. 18 migrations, ~35 atomic RPCs, full API module, worker, contracts, web sections, 5,000+ lines of specs) is ~90% complete and high-discipline. We restore it, then fix a bounded defect list found by three parallel audits — we do NOT rewrite. User decisions: reset DB freely; keep the 18-migration history + add one cleanup migration; defer artifact-bytes export adapter; use chrome-devtools MCP (isolated context) for the browser walkthrough since no Playwright MCP exists.

## Global constraints

- pnpm only; lint runs `--max-warnings 0`; double quotes; semantic tokens/`cn()`; `@repo/ui` subpath imports.
- Never edit either `database.types.ts` copy by hand — `db:types` regenerates both.
- All SQL functions pin `search_path`; FKs to `public.users`; enable-never-force RLS; REVOKE PUBLIC then grant service_role.
- No Supabase MCP in this session: use Supabase CLI + read-only `docker exec psql` for all DB cross-checks.
- Commits: imperative ≤72 chars, no em dashes, no AI/tool/provider terms (`.githooks/commit-msg`).
- Preserve: 8 frozen auth-action signatures, cookie contract, permission merge order, MSW namespace, menu parity, `/api/v1` prefix.

---

## Task 0 — Restore the stash and establish baseline

1. `git stash pop` (working tree is clean at `ea06f79`; expect 24 modified + 47 new files, no conflicts).
2. `pnpm --filter @repo/contracts run build` (API imports `dist/`).
3. Baseline record: `pnpm --filter api run check-types`, `pnpm --filter web run check-types`, focused suites (`pnpm --filter api run test -- product-compliance`, `--filter web run test -- product-compliance`, `--filter @repo/contracts run test`). Capture failures; they seed the fix list.
4. WIP commit: `Restore M2 V2 substantial modification and artifact work`.

## Task 1 — Database reconciliation (check first, then reset)

1. Ensure Docker up; `pnpm --filter infrastructure run db:start`.
2. **Inspect existing state first** (user asked): `supabase migration list` + read-only psql: does `product_substantial_modification_assessments`, `product_substantial_modification_releases`, `product_security_update_artifacts`, bucket `security-update-artifacts` already exist? Report findings.
3. `pnpm --filter infrastructure run db:reset` (user-approved) — deterministic re-apply of all migrations + seed.
4. `pnpm --filter infrastructure exec supabase db diff` → must report no drift.

## Task 2 — Migration cleanup + metrics snapshot RPC (one new migration)

Create `apps/infrastructure/supabase/migrations/20260818<time>_m2_v2_finalize_rpc_surface.sql` (timestamp > 20260817162713), containing:
1. `drop function if exists` for the 4 orphaned SECURITY DEFINER `*_base` RPCs left by the abandoned 160634 rename (`reserve_/review_/finalize_/publish_product_security_update_artifact_atomic_base`), plus any other audit-flagged residue.
2. New `product_compliance_metrics_snapshot(p_organization_id uuid)` (SECURITY DEFINER, pinned search_path, revoke-PUBLIC + grant service_role, audit-free read-only): returns counts — assessments `submitted_for_review` (backlog), active assessments with determination in (`substantial`,`potentially_substantial`) (flagged), artifacts by integrity (`corrupt`,`hash_mismatch`,`unavailable`), published artifacts with `availability_until` within 30 days (expiring), `upload_status='missing'`, cleanup-blocked count.
3. Update `apps/infrastructure/tests/m2-v2-substantial-modifications-security-update-artifacts.test.sql`: assert the 4 `*_base` functions no longer exist; snapshot RPC returns expected counts against the rolled-back fixture.

Then `pnpm --filter infrastructure run db:reset` + `db:types` (regenerates both type copies) + `db diff` no-drift.

## Task 3 — API robustness fixes (restored code)

All in restored files:
1. **Required DI**: `products.controller.ts` — make `ProductComplianceService` a required constructor param (drop `compliance?`/`this.compliance!`); update `products.controller.spec.ts`.
2. **Metrics wiring**: in `products.module.ts` factory pass `observe` for `ProductComplianceWorker` — a small structured-log observer emitting the 10 `ProductComplianceMeasurement` kinds (repo precedent: no worker wires observe today; we wire only this one, failure events + per-cycle gauge snapshot via the new RPC from Task 2 through the worker adapter, added as `snapshotMetrics(orgId)` on `SupabaseProductComplianceWorkerAdapter`). Spec updates in `products.module.spec.ts` + worker adapter spec.
3. **Sync inspect size gate**: `finalizeArtifact` in `product-compliance-use-cases.ts` — new env `PRODUCT_COMPLIANCE_MAX_SYNC_INSPECT_BYTES` (`int` default 67108864); above the gate, skip in-process `storage.inspect`, leave integrity `pending`, and rely on the already-enqueued outbox `inspect` work (verify the worker `inspect` path calls `finalize_..._worker_atomic`; adjust if not). `.env.example` gets all three new env vars (`PRODUCT_COMPLIANCE_LEASE_SECONDS`, `PRODUCT_SECURITY_UPDATE_EXTERNAL_REFERENCE_ALLOWED_HOSTS`, the new byte gate) — the stash missed `.env.example` entirely. Extend `env.validation.spec.ts`.
4. Lint fix: import order in `products.api.ts`.
5. Update `docs/architecture/m2-v2-substantial-modifications-and-security-update-artifacts.md`: truthful metrics section, env reference, export-registry note, deferred-bytes-adapter note.

Focused verification: `pnpm --filter api run test -- product-compliance && pnpm --filter api run check-types`.

## Task 4 — Web UX completion (acceptance-criteria items)

All in `apps/web/app/(workspace)/products/product-compliance-sections.tsx` + spec:
1. **Availability explanation** (required by acceptance criteria): render `issuedCandidate`, `supportCandidate`, `availabilityWinningRule`, rule version, `nonReductionApplied` — not just the final date.
2. **Signature metadata display** next to sha256.
3. **Artifact type selector** (software_update | firmware_update | security_advisory) replacing the hardcode.
4. **Auto-hash on file select** via `crypto.subtle.digest("SHA-256")` + real byte size (manual entry stays as override).
5. External artifacts: show `distributionReference` URI; state-aware buttons (withdraw only when published, finalize only when reserved/uploaded, publish only when cleared) driven by `publicationStatus`/`reviewStatus`/`uploadStatus`.
6. Simple pagination for both lists (page state, next/prev, page-size 15, existing query schemas).
7. Reassess dropdown: real release labels from release query data; `issuedAt` as an editable datetime input.
Verify: `pnpm --filter web run test -- product-compliance && pnpm --filter web run check-types`. Apply `gpt-taste`/`impeccable` for the visual/interaction pass; `ponytail` review at the end.

## Task 5 — Close SQL edge-case gaps

Extend the m2-v2 SQL suite (fixtures roll back): issued_at outside support period → publish/recalc blocked with exact outcome code; finalize with absent storage object → integrity `unavailable`; replacement with different sha256 same version → allowed, old row `replaced`, history retained (documents intended behavior); duplicate active assessment for same `modification_id` → unique-index conflict outcome; bucket `file_size_limit=2147483647` + object_key regex (2-segment and legacy 3-segment). Run: `pnpm --filter infrastructure run test`.

## Task 6 — Full gate matrix (must be green before browser work)

1. `pnpm lint && pnpm check-types` (all workspaces).
2. `pnpm test:architecture` (verify-invariants, dependency-cruiser, docs).
3. `pnpm test` (all unit; 80% coverage gate via `pnpm coverage`).
4. `pnpm build`.
5. `pnpm --filter infrastructure run test` + `test:concurrency`.
6. `pnpm verify` (the aggregate gate).
Commit fixes per area as they land.

## Task 7 — Live end-to-end verification

1. Start API + web against real stack (`local-supabase-env.sh` env; `NEXT_PUBLIC_ENABLE_MOCKS=false`, origins 3333/3000).
2. `pnpm --filter api run test:e2e` + `bash apps/api/test/auth-flow.e2e.sh` (no regressions).
3. Worker smoke: `node apps/api/dist/product-compliance-worker.js --once` (idempotent exit 0).
4. `pnpm --filter web run test:e2e` with `E2E_RUN_ID` (includes new `m2-v2-compliance.spec.ts`: owner happy path + cross-tenant 404; run-scoped accounts clean up after themselves).
5. **Browser walkthrough (chrome-devtools MCP, isolated context — never touches your other site data)**: sign in `owner@cra.test` / `Password123` on `localhost:3000`; on a dedicated product: create assessment → submit → review (incl. override-reason path) → reassess; reserve artifact → upload → finalize → review → publish; verify availability candidates/winning-rule display, sha256/signature display; attempt withdraw (blocked without replacement); screenshots saved to `apps/web/e2e-results/m2-v2/` at every step. No cross-origin data clearing.
6. **Supabase cross-check (read-only psql)**: artifact row state machine values, `audit_logs` facts for every action (create/review/reserve/finalize/publish/download), outbox events drained, RLS spot-check (`relforcerowsecurity=false`, no policies), `db diff` still clean.

## Task 8 — Final review + commits

`ponytail` audit of the full diff; fix findings; then logical commits (restore / migrations+metrics / api fixes / web ux / tests). Report: what changed, gate results, screenshots, DB evidence, known deferred items.

## Deferred (explicit follow-ups, out of scope here)

- Artifact-bytes tenant-export snapshot adapter (redesign `UnavailableTenantExportArtifactSnapshotAdapter` port) — user-approved deferral.
- Repo-wide `observe` wiring for retention/import workers; `isObjectNotFound` string-matching hardening in the storage adapter.

## Rollback

Everything up to final commits is recoverable: DB via `db:reset`; code via git (restore commit is first, fixes layered on top; any broken fix reverts independently).