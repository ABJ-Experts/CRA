# M15-04 Support Diagnostics Implementation Plan

> **For agentic workers:** Implement task-by-task with subagent-driven development and independent final review. Track checkbox completion here.

**Goal:** Explicitly consent to, generate, inspect and privately download redacted on-prem capable diagnostics.

**Architecture:** Functional React and focused gateway use shared feature-first Zod contracts. Thin Nest controllers call application ports implemented by tenant-scoped Supabase/source/storage adapters and a leased worker. Exactly one job table and private bucket.

**Tech Stack:** Existing pnpm, Next16/React, Nest11, Zod, Supabase/Postgres17, Node crypto/streams/files, installed ZIP parsing, Jest/Vitest/Playwright.

**Spec:** `docs/architecture/m15-04-support-diagnostics.md` and user-approved conversation plan.

## Global constraints

Creator-only authorized owner/admin; structured logs/configuration/metrics only; zero preconsent collection; availability24h distinct retention; no support transmission or new dependency. Preserve auth/cookies/permissions/menu/mock/source authorities and all existing data. 60second attempt/lease,10second heartbeat,3 attempts,5000 log rows,10MiB ZIP,64MiB memory,1active tenant. Preview10min; download grant60s. Range max7days/default24h; history default25/max100; content page max100.

## Review focus

- Revocation or organization switch between preview/consent/collection/publication/download must deny stale disclosure.
- Cancellation after upload and worker lease takeover cannot publish.
- Malicious nested/encoded/stack/URL/config values cannot enter artifacts, UI or audit.
- Expiry must not delete retained/held artifacts or hide their accounting.
- Cleanup, tenant export and holds must preserve creator scope and immutable evidence.

## Tasks

- [x] 1. Contracts and permission: write RED schema/default/admin role tests; implement strict schemas/types/package exports and can_export_system_health; run focused Vitest/coverage.
- [x] 2. SQL: RED rollback fixture tests; CLI migration adds one table/private bucket and scoped transactional M13 RPCs for consent/jobs/leases/log projection/grants/cleanup. Add metadata-only tenant export and protected accounting integration. Apply only reviewed new local migration; regenerate types via CLI; verify real constraints/grants/RLS/audit atomicity.
- [x] 3. API: RED usecase/controller/repository/token tests; implement static preview, live consent authorization, typed routes and private access. Parse all inputs/results; preserve legacy AuditService.log and no mutation replay.
- [x] 4. Generation: RED adversarial redaction/source/archive/storage/worker tests; closed safe projections; deterministic ZIP; cancellable bounded/fenced leased generation; verified storage/inspection/delivery and scoped reconciliation. Review all failure/lease/cancel/revocation cases.
- [x] 5. UI: RED gateway/component tests; health entry and history, range/category/disclosure/consent/progress/cancel/inspect/download/cleanup, scoped draft and conflict/error states. Keep incumbent visual world and accessibility.
- [x] 6. Integration: wire module, worker scripts, operation/audit/licensing registers, metering/export protections; focused then full verify/live regression tests, SQL lint, scoped coverage>=80% all metrics.
- [x] 7. Evidence: independent security/code review; Playwright MCP owner desktop/mobile and engines, Supabase audit/hash/access/accounting cross-check, realistic load and egress-blocked generation; publish test mapping/screenshots/runbook/residuals. Preserve unrelated data and site state.

No commits, pushes, resets, global cleanup, live upgrades or destructive restores are implicit in this implementation.
