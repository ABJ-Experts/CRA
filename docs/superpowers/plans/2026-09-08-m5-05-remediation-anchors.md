# M5-05 Remediation Anchors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record tenant-safe, evidence-backed remediation anchors and durably surface a fixed component that returns in a later SBOM-diff lineage.

**Architecture:** Keep the existing finding-triage vertical slice: React presentation calls a focused gateway, shared Zod contracts define the wire boundary, a thin Nest controller delegates to a use case/port, and an org-first Supabase adapter invokes atomic RPCs. An append-only anchor ledger and the existing regulatory outbox make correction and M6 consumption durable; the existing M4 lineage/matching seam performs reintroduction detection.

**Tech Stack:** Next.js 16/React 19, NestJS 11, Zod 4, PostgreSQL/Supabase, Vitest, Jest, Playwright.

**Spec:** `docs/architecture/m5-remediation-anchors-reintroduction.md`

## Global Constraints

- Use only additive CLI-generated migrations, public-user foreign keys, non-forced RLS, pinned `SECURITY DEFINER` paths, and explicit service-role grants.
- Persist availability in UTC only; it is a human/business assertion, never inferred from VEX, tickets, advisories, or deployment.
- Do not alter VEX evidence or status, auth/session behavior, menu contracts, or existing worker semantics.
- All mutations include explicit idempotency and optimistic-version boundaries; GET alone is refresh-retryable.
- Use only a separate local web port for browser verification, create uniquely tagged test data, and never reset or clear shared data.

---

### Task 1: Contract and policy boundary

**Files:**
- Create: `packages/contracts/src/vulnerabilities/schemas/vulnerability-remediation.schema.ts`
- Create: `packages/contracts/src/vulnerabilities/schemas/vulnerability-remediation.schema.spec.ts`
- Create: `packages/contracts/src/vulnerabilities/types/vulnerability-remediation.type.ts`
- Modify: vulnerability contract barrels and triage schemas/types.

**Produces:** strict record/correct/history/operational/outbox schemas used identically by API and web.

- [ ] Write failing contract cases for unexpected keys, timestamp policy, corrective-versus-mitigation, correction reasons, and applied projection.
- [ ] Implement the smallest strict Zod schemas and derived `z.output` types.
- [ ] Run `pnpm --filter @repo/contracts test -- vulnerability-remediation.schema` and `pnpm --filter @repo/contracts build`.

### Task 2: Durable storage and atomic procedures

**Files:**
- Create: `apps/infrastructure/supabase/migrations/20260908093813_m5_remediation_anchors_reintroduction.sql`
- Modify: infrastructure SQL integration coverage and generated database types after migration application.

**Produces:** append-only anchor revisions, tenant-scoped event linkage, efficient reintroduction marker, atomic org-first record/correct/projection/reintroduction RPCs.

- [ ] Write SQL assertions for tenant isolation, immutable history, archive policy, lineage absence, retry dedupe, grants, and atomic audit/outbox persistence.
- [ ] Implement database constraints, RLS/grants, lock-based idempotency, outbox event keys, and exact schema-shaped JSON output.
- [ ] Apply only this additive migration, regenerate types through the CLI, and run database lint and focused SQL tests.

### Task 3: API policy and adapter

**Files:**
- Modify: `apps/api/src/findings/triage/application/vulnerability-triage.port.ts`
- Modify: `apps/api/src/findings/triage/application/vulnerability-triage-use-cases.ts`
- Modify: `apps/api/src/findings/triage/infrastructure/supabase-vulnerability-triage.repository.ts`
- Modify: `apps/api/src/findings/triage/vulnerability-triage.controller.ts`
- Test: colocated controller/repository Jest specifications.

**Consumes:** Task 1 contracts and Task 2 RPCs. **Produces:** parsed, permission-gated `/api/v1/findings/:findingId/remediation` operations.

- [ ] Write failing parsed-boundary, denial, conflict, malformed-RPC, and idempotency tests.
- [ ] Add the narrow port/use case/controller/repository calls without DTO duplication or direct controller Supabase access.
- [ ] Run focused API Jest tests and type checking.

### Task 4: Findings operational UI

**Files:**
- Modify: `apps/web/app/_features/findings/triage.api.ts`
- Modify: `apps/web/app/_features/findings/triage.queries.ts`
- Modify: `apps/web/app/_features/findings/triage.keys.ts`
- Modify: existing finding grid/detail controls and colocated tests.

**Consumes:** Task 1/3 contracts and API. **Produces:** accessible status labels, filters, remediation form/correction/history, and mutation invalidation.

- [ ] Write failing gateway, form-state, labels, filter, and invalidation tests.
- [ ] Implement the smallest Operate-mode controls using existing semantic tokens, `cn()`, and shared UI subpaths.
- [ ] Run focused web tests and the Impeccable detector.

### Task 5: Review and safe verification

**Files:** all changed M5-05 files; no production data modifications beyond uniquely tagged local test scope.

- [ ] Independently review persistence/API and web work for tenant, schema, transaction, accessibility, and regression defects.
- [ ] Run focused suites, database lint/types, architecture tests, type check, lint, and `pnpm verify` when environment permits.
- [ ] Verify migration metadata with read-only Supabase MCP queries.
- [ ] Run a local-only browser journey on a non-3000 port; capture validation, available, applied, reintroduced, desktop, and mobile screenshots.
- [ ] Do not run global `test:live` if it clears shared Mailpit; record the scoped non-destructive alternative and residual gap.
