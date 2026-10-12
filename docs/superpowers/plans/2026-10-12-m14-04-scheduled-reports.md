# M14-04: Permission-safe scheduled reports Implementation Plan

> **For agentic workers:** Use subagent-driven development task-by-task. Observe failing tests before implementation, review each task and review the integrated change.

**Goal:** Schedule supported reports, generate recipient-specific artifacts under current authorization, and deliver authenticated links with durable history.

**Architecture:** A bounded scheduling workflow around the existing M14-03 export engine. Source-owned projections, M12 delivery and M13 transactional audit remain authoritative. Interactive exports remain session-bound.

**Tech Stack:** Existing Next.js, NestJS, shared Zod contracts, PostgreSQL/Supabase, SMTP and Playwright; no additional dependency.

**Spec:** `docs/architecture/m14-04-scheduled-reports.md` and the approved M14-04 task in this chat; BRD FR-AN-005/009, pages 36, 54–56, 64–65 and ADR-012.

## Global constraints

- Baseline: clean `milestone-1` at `59093a2`; implementation branch `codex/m14-04-scheduled-reports`. Existing sibling worktrees remain untouched.
- Preserve `/api/v1`, HttpOnly access/refresh cookie paths, ES256/JWKS, auth-action signatures, zero epoch skew, permission merge order, public-route/permission gates, menu and mock namespaces.
- Functional React → gateway/transport → feature-first Zod → thin Nest controller → application/port → Supabase adapter. No fake background user sessions.
- Bound definitions to 100 active per organization, recipients to 20, scheduled export admission to two per organization and execution to one. Manual exports retain their quotas and priority.
- Three new tables only: definitions, runs and run recipients. Reuse existing exports and notification dispatches.
- Same-organization active verified members, per-recipient artifacts, authorization intersection with owner. No external recipients, public sharing, attachments, chat, scripts or regulatory actions.
- Daily/weekly/monthly; skip DST gaps, first fold occurrence, clamp month-end; latest missed occurrence only within 24 hours. Rolling ranges: previous 7/30/90 complete local days.
- Owner access loss pauses; recipient access loss skips/revokes permanently. No automatic transfer/rerouting.
- Never reset/delete existing data or replay/repair historical migrations. Local ledger mismatch requires feature-only staged CLI application.

## Review focus

- Owner/recipient authorization changes during capture, rendering, SMTP and streaming must fail closed without exposing counts.
- Concurrent scheduler/activation/edit/replay must retain stable occurrence/dispatch identity and immutable captured inputs.
- SMTP timeout after possible acceptance must preserve uncertainty and forbid blind resend.
- DST gaps/folds, half-hour offsets, month-end and restart catch-up must never duplicate or storm.
- Audit/trend tokens and current schema changes must not bypass source-owned capture or revive old grants.

## Task 1: Contracts and policy

- [ ] Write failing schema/policy tests for all member source definitions plus readiness, arbitrary fields/tokens, recurrence, rolling dates and bounded inputs.
- [ ] Implement reports schemas/types/exports, explicit source schema version, pure local recurrence helpers and source normalization.
- [ ] Run focused tests and 80% branch/function/line/statement coverage; review.

## Task 2: Transactional workflow

- [ ] Write failing rollback-only SQL tests for tables, grants, forged tenant IDs, membership, preview/activation, versions, occurrence deduplication, edits, leases and revocation.
- [ ] Create additive CLI migrations for `report_definitions`, `report_runs`, `report_run_recipients`, scheduled export references and independent email preferences.
- [ ] Implement org-first ReportsUseCases/ReportsPort, thin parsed controller, Supabase adapter and composition root.
- [ ] Preview creates owner-only artifact without delivery; activation requires matching successful preview <24h old and fresh eligibility. Editing invalidates activation readiness.
- [ ] Current configuration is mutable/versioned; each preview/occurrence snapshot is immutable. One active run per definition; latest missed slot only, bounded coalescing metadata.
- [ ] Run SQL, contract/application/controller tests and coverage; review.

## Task 3: Background generation

- [ ] Write failure tests for owner/recipient scope intersection, fresh audit/trend contexts, duplicate admission, manual priority, stale workers and provenance checkpoint.
- [ ] Add source-owned background capture entry points without changing interactive token/session methods.
- [ ] Use existing ExportWorker/renderer/storage with scheduled claim adapter, incremental admission and source-specific authorization checks.
- [ ] Generate/checksum a companion scheduled manifest after export ready. Include definition/version, occurrence, resolved-filter digest, actual capture as-of and permission provenance. No notice/grant before durable publication.
- [ ] Run worker/source/storage compatibility tests and coverage; review.

## Task 4: Delivery and downloads

- [ ] Write failing tests for off/quiet hours, pre-send failure, possible acceptance, restart, missing provenance, wrong identity/session, expiry and double redemption.
- [ ] Reuse one M12 dispatch per recipient. Preserve uncertainty codes and block automatic/generic/manual uncertain retry. Minimal fixed copy and protected report link only.
- [ ] Add opt-in scheduled feed/delivery/unread inclusion with cursor scope; default legacy responses exclude new sources. Independent email preference immediate/off; existing modes JSON unchanged.
- [ ] Single-use HttpOnly recipient/session grants last 300s. Reauthorize after storage acquisition and during streaming. Artifact availability remains 24h; expiry never authorizes deletion.
- [ ] Safe replay resumes only known-safe failed work in the frozen occurrence; cannot change recipient/config, overwrite captures or regenerate expired artifacts.
- [ ] Run delivery/download/M12 regression tests and coverage; review.

## Task 5: UI and integrated verification

- [ ] Write functional component/gateway tests for draft preservation, preview/activation, history, skips, uncertainty, forbidden/conflict/schema changes and expired links.
- [ ] Add `/dashboard/reports` and recipient run pages, dashboard action and scheduling controls beside existing member exports. Preserve shell/menu and semantic tokens, focus, keyboard, locale dates and reduced motion.
- [ ] Run focused tests then `pnpm verify`, infrastructure SQL/RLS/concurrency, API and browser regressions.
- [ ] Use Playwright MCP with real local owner login for preview→activation→occurrence→inbox/email→download and denial/replay. Capture desktop/mobile screenshots; cross-check Supabase metadata/state read-only.
- [ ] Measure p95 <400ms/p99 <1000ms read targets at realistic load and tenant-fair bounded background work. Verify egress-blocked inbox.
- [ ] Produce requirement/test evidence, migration/backfill/rollback runbook and residual limitations. No zero-bug/legal-certification claim.

## Deployment and rollback

Apply additive feature migrations only after validating the local ledger baseline. Regenerate both types through the CLI. Deploy compatible API/workers before enabling the UI. Rollback disables scheduling/delivery while retaining definitions, runs, artifacts and audit history. No destructive down migration or automatic cleanup. SMTP has no exactly-once guarantee; uncertain sends remain terminal. Retained artifacts consume storage.
