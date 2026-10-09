# M6-01 Reporting Obligations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build tenant-safe reporting obligations with frozen deadline rules, stage anchors, correction, cancellation, and a compact local UI.

**Architecture:** Add a reporting vertical slice that follows functional React presentation -> typed web gateway -> `@repo/contracts/reporting` Zod schemas -> thin Nest controller -> use case/port -> Supabase adapter/RPCs. The database owns authoritative deadlines, state transitions, idempotency, and durable audit facts.

**Tech Stack:** pnpm, TypeScript, Zod, React Query, Next.js workspace UI, NestJS, Supabase/Postgres PL/pgSQL, Vitest, Jest, Playwright.

**Spec:** `docs/architecture/m6-reporting-obligations.md`; BRD pages 30-31 and 40-42 from `/Users/abjmac003/Downloads/CRA-Sentinel-Technical-BRD-v2.0-ABJ-Experts.pdf`.

## Global Constraints

- Use Node 20+ and pnpm only.
- Preserve `/api/v1`, refresh-cookie path, ES256/JWKS, frozen auth-actions, permission merge order, session revocation, menu contracts, and mock passthrough.
- No direct Supabase calls from React pages or controllers.
- Every service-role query takes `organization_id` first and applies explicit tenant filters.
- Parse body/query/path inputs and successful responses; derive trusted types with `z.output`.
- Database deadlines use UTC second precision and ignore weekends/holidays.
- Mutations require explicit idempotency and expected version; non-GET requests are not silently replayed after refresh.
- Migration is additive, CLI-generated, RLS enabled/non-forced, function search path pinned, default function access revoked, explicit grants, and `public.users` foreign keys.
- No generic buses, new frameworks, rich countdown spectacle, legal submission transport, AI summaries, or replacement audit system.

---

### Task 1: Contracts And Deadline Policy

**Files:**

- Create: `packages/contracts/src/reporting/schemas/reporting-obligations.schema.ts`
- Create: `packages/contracts/src/reporting/schemas/reporting-obligations.schema.spec.ts`
- Create: `packages/contracts/src/reporting/schemas/index.ts`
- Create: `packages/contracts/src/reporting/types/reporting-obligations.type.ts`
- Create: `packages/contracts/src/reporting/types/index.ts`
- Create: `packages/contracts/src/reporting/index.ts`
- Create: `packages/contracts/src/reporting.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**

- Produces: `createReportingObligationInputSchema`, `correctReportingObligationAnchorInputSchema`, `recordReportingObligationStageSubmissionInputSchema`, `cancelReportingObligationInputSchema`, `reportingObligationListResponseSchema`, `reportingObligationDetailResponseSchema`, and matching `z.output` types.

- [ ] Write failing schema tests for strict unknown-key rejection, UUID validation, 1-4000 char basis/reason limits, required awareness basis, type-specific final stages, UTC strings, second precision, and example dates.
- [ ] Run `pnpm --filter @repo/contracts test -- reporting-obligations.schema` and confirm the tests fail because schemas do not exist.
- [ ] Implement strict Zod schemas with enums for obligation type, anchor kind, stage kind, stage state, source kind, and stable outcome payloads.
- [ ] Run `pnpm --filter @repo/contracts test -- reporting-obligations.schema` and `pnpm --filter @repo/contracts build`.

### Task 2: Additive Supabase Migration And SQL Tests

**Files:**

- Create: Supabase CLI migration `m6_reporting_obligations`
- Create: `apps/infrastructure/tests/m6-reporting-obligations.test.sql`
- Modify: generated DB types with `pnpm --filter infrastructure run db:types`

**Interfaces:**

- Consumes: Task 1 wire names and BRD stage semantics.
- Produces: RPCs `list_reporting_obligations`, `get_reporting_obligation`, `create_reporting_obligation_atomic`, `correct_reporting_obligation_anchor_atomic`, `record_reporting_obligation_stage_submission_atomic`, `cancel_reporting_obligation_atomic`, and `tick_reporting_obligation_stages_atomic`.

- [ ] Use `pnpm --filter infrastructure run db:new m6_reporting_obligations`.
- [ ] Write failing SQL tests for RLS/grants, rule freeze, UTC examples, Jan31 month clamp, leap-year 72h, DST UTC behavior, pending final anchor, awareness correction, breach preservation, idempotency conflict, duplicate finding linkage, cancellation, and export/purge registration.
- [ ] Run `pnpm --filter infrastructure test -- m6-reporting-obligations` or the narrow SQL runner available in `apps/infrastructure/tests/run-sql-tests.sh`; confirm failure.
- [ ] Implement tables: `reporting_rule_sets`, `reporting_obligations`, `reporting_obligation_stages`, `reporting_obligation_events`, and feature-local command rows or an existing command ledger extension if one fits without coupling.
- [ ] Implement SQL helpers for stage generation, UTC second truncation, interval/month arithmetic, stage recompute, overdue preservation, and durable audit rows.
- [ ] Add organization export/purge source registration as operational reporting records.
- [ ] Run `pnpm --filter infrastructure run db:lint`, `pnpm --filter infrastructure run db:types`, and focused SQL tests.

### Task 3: API Use Case, Port, Repository, And Routes

**Files:**

- Create: `apps/api/src/reporting/application/reporting-obligation.port.ts`
- Create: `apps/api/src/reporting/application/reporting-obligation-use-cases.ts`
- Create: `apps/api/src/reporting/infrastructure/supabase-reporting-obligation.repository.ts`
- Create: `apps/api/src/reporting/reporting-obligations.controller.ts`
- Create: `apps/api/src/reporting/reporting.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/vulnerabilities/infrastructure/unavailable-reporting-obligation.adapter.ts`
- Modify: `apps/api/src/vulnerabilities/vulnerabilities.module.ts`
- Add focused `*.spec.ts` files for each new API unit.

**Interfaces:**

- Consumes: Task 1 schemas and Task 2 RPC names/outcomes.
- Produces: `/api/v1/reporting/obligations` list/create/detail/anchor/submission/cancel routes and an implementation of the M4 `ReportingObligationPort`.

- [ ] Write failing Jest tests for controller validation, required permissions, org-first RPC arguments, cross-tenant/null results, idempotency replay/conflict, stale version conflict, forbidden actor, malformed RPC output, and M4 KEV open/link behavior.
- [ ] Run focused API tests and confirm expected failures.
- [ ] Implement use-case pass-through with stable error classes only where outcome mapping needs it.
- [ ] Implement Supabase adapter parsing every RPC response with `@repo/contracts/reporting` schemas.
- [ ] Add thin controller routes using existing Zod pipes and `@ZodResponse`.
- [ ] Replace the unavailable M4 reporting adapter with a reporting adapter that creates or links an obligation from an eligible KEV alert without asserting awareness automatically unless supplied by the human-facing create route.
- [ ] Run focused API tests and `pnpm --filter api run check-types`.

### Task 4: Web Gateway, Hooks, And Operational UI

**Files:**

- Create: `apps/web/app/_features/reporting/reporting.api.ts`
- Create: `apps/web/app/_features/reporting/reporting.queries.ts`
- Create: `apps/web/app/_features/reporting/reporting.keys.ts`
- Create: `apps/web/app/_features/reporting/reporting-obligations-panel.tsx`
- Create: `apps/web/app/_features/reporting/*.spec.tsx`
- Modify: an existing workspace route or findings detail action to surface the reporting workflow.

**Interfaces:**

- Consumes: Task 1 API contracts and Task 3 routes.
- Produces: accessible obligation list/detail/create/correct/cancel/submission-anchor workflows.

- [ ] Read `apps/web/node_modules/next/dist/docs` for the exact Next.js route/client behavior used by the touched files.
- [ ] Read `impeccable/reference/craft-floor.md` before editing UI and keep Operate mode constraints.
- [ ] Write failing web tests for empty/loading/forbidden/network states, stage display, pending anchor, overdue label, conflict retry, draft preservation, tenant switch, keyboard access, and local offset display.
- [ ] Implement feature API with `inputSchema` and response `schema` on every call.
- [ ] Implement React Query hooks and cache invalidation per organization/finding.
- [ ] Add compact forms and tables using semantic tokens, shared UI subpath imports, `cn()`, visible focus, and non-color status cues.
- [ ] Run focused web tests and the Impeccable detector once on changed UI files.

### Task 5: Verification And Evidence

**Files:**

- Add Playwright screenshots under the existing `apps/web/test-results` convention.
- Update this plan checklist as work completes if useful; do not commit unless asked.

**Interfaces:**

- Consumes: all prior tasks.
- Produces: reproducible command results, screenshots, residual risk notes, and rollback notes.

- [ ] Start local Supabase/API/web services without resetting user data.
- [ ] Run focused contracts, SQL, API, and web tests.
- [ ] Run `pnpm verify`.
- [ ] Run Playwright E2E against local dev only with seeded owner credentials and disposable organization data; capture desktop/mobile screenshots and accessibility results.
- [ ] Use Supabase MCP read-only to cross-check created local rows, rule snapshots, stage states, audit facts, and no unintended sensitive data exposure.
- [ ] Report exact commands, pass/fail results, changed paths, screenshots, unresolved decisions, and rollback plan.

## Self-Review

- Spec coverage: FR-RPT-001 through FR-RPT-008, FR-RPT-024, and FR-SLA-001/002/003/004/007/008 map to Tasks 1-5. FR-RPT-009 through FR-RPT-023 remain deliberately out of this M6-01 scope except where submission anchors are needed for deadlines.
- Placeholder scan: no placeholder implementation step is left; every task names files, interfaces, tests, and commands.
- Type consistency: reporting obligation names are reserved for the new `@repo/contracts/reporting` package and matching API/web feature folders.
