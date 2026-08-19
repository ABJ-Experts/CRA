# M2 V2 Completion — Gap-Fill Plan (post-analysis, committed code preserved)

**Goal:** Keep your committed implementation, fill the verified gaps with the smallest root-cause fixes, prove the task goal is met end to end. No commits or pushes unless you ask (per your instruction).

## Step 1 — Revert my exploration edits
Restore `seed.sql` and the m2-v2 SQL test to committed versions; delete my untracked `20260818100000_m2_v2_finalize_rpc_surface.sql`. Working tree = your commit exactly.

## Step 2 — Root-cause fix: seed default legal entity
Re-apply ONLY the seed insert (satisfying the `completion_check` constraint: legal name, address, country, contact name/email, `is_default`, created by owner). `db:reset`, then verify the **committed** m2-v2 and m2-v1 SQL suites pass unmodified. Pinpoint and fix the runner-order `ALTER TABLE product_releases` failure if it persists.

## Step 3 — RPC surface cleanup + metrics (one small migration)
New migration `20260818...`: drop the 4 orphaned `*_atomic_base` functions; add read-only `product_compliance_metrics_snapshot(org)` (backlog, flagged, quarantine, hash_mismatch, unavailable, missing, expiring-30d, blocked). Wire `observe` in `products.module.ts` to a structured-log observer; add `snapshotMetrics` to the worker adapter; emit gauges per worker cycle. Update module/adapter specs; 3-4 SQL assertions.

## Step 4 — Acceptance-criteria UI completion (one file + spec)
In `product-compliance-sections.tsx`: render issuedCandidate/supportCandidate/winningRule/ruleVersion/nonReductionApplied; signature metadata; artifact-type selector; SubtleCrypto sha256+size on file select (manual override kept); external `distributionReference` display; state-aware buttons; simple pagination; real release labels in reassess; editable issuedAt.

## Step 5 — Small API fixes
Required `ProductComplianceService` DI in controller (drop `?`/`!`); `.env.example` entries for the 2 env vars + new byte gate; `PRODUCT_COMPLIANCE_MAX_SYNC_INSPECT_BYTES` gate in `finalizeArtifact` (above 64 MiB leave integrity pending for the worker inspect event); import-order lint nit; truthful metrics section in the architecture doc.

## Step 6 — Edge-case SQL tests (in the m2-v2 suite, rolled back)
Issued-at outside support period (blocked publish/recalc codes); finalize with absent storage object (integrity unavailable); replacement same version + different sha (allowed, history retained); duplicate active modification_id (unique conflict path); bucket limit + object_key regex.

## Step 7 — Gates
`pnpm lint && pnpm check-types && pnpm test:architecture && pnpm test && pnpm build` then `pnpm --filter infrastructure run test` and `test:concurrency`.

## Step 8 — Live end-to-end verification
API + web on the real stack; `api test:e2e`; `auth-flow.e2e.sh`; `worker --once` smoke; `web test:e2e` (includes m2-v2 spec). Browser walkthrough via chrome-devtools MCP in an ISOLATED context (your other site data untouched) as owner@cra.test: assessment create→review(override)→reassess; artifact reserve→upload→finalize→review→publish; availability explanation + hash display; withdraw blocked without replacement. Screenshots to `apps/web/e2e-results/m2-v2/`. Read-only psql cross-check: state machine values, audit facts per action, outbox drained, RLS spot-checks, `db diff` clean.

## Step 9 — Final review + completion matrix
ponytail + gpt-taste pass over the full diff; deliver requirement→evidence completion matrix with the "goal completed?" verdict and remaining deferred items (artifact-bytes export adapter stays deferred per your earlier decision).

**Rollback:** Steps 2-6 are independent working-tree changes; any can be reverted individually. DB reverts via `db:reset`. Nothing is committed without your say-so.