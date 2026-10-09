# M2 Gap Closure Implementation Plan

> Local CRA stack only. No production database access, reset, commits, pushes, or M3 work.

**Goal:** Close verified M2 product registry, lifecycle, support, connector, relationship, session, and provisional classification gaps while preserving retained history and existing contracts.

**Architecture:** Functional React -> product gateway/transport -> feature-first Zod contracts -> permission-gated Nest controllers -> application policies/ports -> explicitly tenant-scoped Supabase adapters and SQL RPCs.

**Tech stack:** pnpm, Next.js, NestJS, Zod, PostgreSQL/Supabase, Vitest, Jest, Playwright, Playwright MCP local browser.

**Spec:** BRD FR-PROD-001 through FR-PROD-014, with FR-PROD-004 implemented as source-linked provisional human declarations. Qualified legal review remains a pre-live release gate.

## Global constraints

Use only the local CRA stack. Do not touch production. Do not reset data, remove unrelated site data, commit, or push. Preserve `/api/v1`, ES256/JWKS sessions, cookie paths, permission merge order, immutable histories, retained evidence, M1 export boundaries, and existing product/support/connector wire contracts.

## Tasks

- [x] Owner directory: add focused contracts, application port, scoped Supabase adapter, static owner-options route, accessible selector, retry/error states, readonly current-owner label, and tenant-partitioned query keys.
- [x] UTC lifecycle entry: add pure UTC conversion tests and reuse the helper in release and support forms while preserving seconds/milliseconds and calendar validation.
- [x] Support release scope: parse optional `releaseId`, validate scoped release membership, filter matching release and product-wide periods, and keep omission backward compatible.
- [x] Database validation: validate existing connector constraints after zero-violation checks; enforce connector idempotency pair; add no connector tables or data rewrites.
- [x] Retry idempotency: preserve product/release create idempotency keys across explicit retries of the same parsed draft and rotate on changed content or completed operation.
- [x] Session race: remove the redundant session registration conflict path while retaining the primary identity boundary and foreign-user protection.
- [x] Relationship refresh: ensure relationship mutations report committed state and final graph reads verify fresh state after the local Kong/DNS repair.
- [x] FR-PROD-004 classification: add exactly one immutable `product_classification_runs` table, source-linked provisional policy, atomic save/audit/idempotency RPC, parsed API, web panel, history, latest summaries, export, and RLS/history authorization.
- [x] Export closure: register `product_classification_runs` in SQL and TypeScript product export sources, extend the snapshot lock with `v_new_lock`, and pass the architecture/worker regression.
- [x] Verification and evidence: record commands, coverage, SQL/RLS, DB lint/diff/types, browser screenshots, MCP verification, migration order, rollback notes, and residual release gates.

## Current verification status

- Final SQL/RLS/integration: passed 72 files, exit 0, `/tmp/cra-m2-final-sql.log`.
- Export registry and worker regression: passed 12 tests, `/tmp/cra-m2-final-export-worker-tests.log`.
- Final serial `pnpm verify`: completed tests and builds in `/tmp/cra-m2-final-verify-serial.log`; API tests show 283 suites and 2430 tests passed and build shows 4 successful tasks.
- DB lint: exit 0 with existing warnings only.
- DB diff: `supabase db diff --schema public --use-migra` found no M2 drift; sanitized evidence at `docs/architecture/evidence/m2/final-schema-diff.json`.
- Browser: product registry, relationship, classification WebKit, auth Chromium retry, and Playwright MCP local checks completed with recorded evidence. The final auth pass used runtime `APP_URL=3002` to match the running web server after an earlier origin mismatch.

## Coverage and limits

All new M2 modules exceed 80% coverage. Classification coverage: API 100% lines/functions, 99.15% statements, 93.93% branches; history adapter 100% lines/statements/functions, 95.91% branches; web 98.68% lines/statements, 100% functions, 89.93% branches; contracts 100% all reported categories. The changed relationship path has 17/17 covered statements. The focused legacy whole-file relationship coverage is 23.67% lines, 25.88% functions and 92.1% branches, so this does not claim whole-file legacy query files are above 80%.

M2 engineering closure does not certify legal approval, CRA conformity, WCAG compliance, current/previous browser support, production load, or optional vendor connector coverage. Qualified legal review for live regulatory use remains a release gate.
