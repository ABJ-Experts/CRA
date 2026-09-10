# M6 Stage Drafts and Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver tenant-safe collaborative reporting-stage drafts with immutable submitted snapshots, field provenance, release Member States, and reusable family templates.

**Architecture:** Extend the existing reporting feature vertically: feature-first Zod contracts, thin reporting controller, existing use-case/port/repository path, and PostgreSQL-authoritative transactional RPCs. Reuse release market availability and reporting command/audit patterns; avoid a generic editor or lock framework.

**Tech Stack:** TypeScript, Zod 4, Next 16/React Query, Nest 11, Supabase PostgreSQL RPCs, Vitest/Jest/pgTAP-style SQL tests, Playwright.

**Spec:** `docs/architecture/m6-stage-drafts-templates.md`

## Global Constraints

- Use local Supabase project `cra` only; never use production.
- Preserve `/api/v1`, cookie/JWKS/session/RBAC/menu/mock contracts and existing reporting routes.
- All new wire types are `z.output` from `@repo/contracts/reporting`; parse request and response boundaries.
- Every service-role operation is organisation-first and transactionally writes critical evidence.
- No automatic mutation retry; all draft/template commands use idempotency and expected versions.

---

### Task 1: Define contracts and failing tests

**Files:** modify `packages/contracts/src/reporting/schemas/reporting-obligations.schema.ts`, types/index exports and specs.

- [ ] Add strict schemas for field definitions/content/provenance, draft detail, lock state, conflict payload, submission snapshot, template/version, and all draft/template commands.
- [ ] Add tests for conditional required fields, AI acceptance identity, immutable timestamp exclusion, strict unknown-key rejection, and response invariants.
- [ ] Run `pnpm --filter contracts test -- reporting-obligations`.

### Task 2: Add durable database workflow

**Files:** create one timestamped migration; modify reporting SQL tests and export registration only where required.

- [ ] Add reporting-owned draft/revision/submission/family-template/template-version records, FKs, RLS, indexes, grants, and export source registration.
- [ ] Add org-first `security definer` RPCs for get/create/save/lock/submit drafts and template CRUD/apply; each uses transaction, actor/membership validation, idempotency, revision conflict and durable audit/timeline evidence.
- [ ] Prove cross-tenant IDs, stale saves, lock expiry, revoked user, immutable submission, prior-stage prepopulation and template version isolation in local SQL tests.

### Task 3: Implement API and repository path

**Files:** reporting port/use cases/repository/controller/module plus focused Jest tests.

- [ ] Add contract-parsed repository methods and stable conflict/locked/invalid-state mapping.
- [ ] Add thin authorised routes with Zod pipes and `@ZodResponse`; keep existing reporting endpoints compatible.
- [ ] Run focused API tests and type checking.

### Task 4: Implement operational editor and templates

**Files:** reporting API/query/key modules and focused functional React components/tests.

- [ ] Add an obligation-stage editor with accessible required inputs, Member State corrections, provenance labels, validation panel, explicit lock/reload/diff and preserved offline input.
- [ ] Add separately gated template management/application review; applying content never silently submits it.
- [ ] Use semantic tokens/shared components and retain compact reporting layout; run component tests and Impeccable detector.

### Task 5: Verify integrated behaviour

**Files:** API E2E/live SQL tests and `apps/web/e2e` reporting journey.

- [ ] Start only the local stack without resetting existing data; use seeded owner credentials already configured locally.
- [ ] Run schema/type generation, focused tests, architecture gate, appropriate live tests, browser journey and accessibility assertions.
- [ ] Capture local desktop/mobile screenshots using Playwright; record actual results and residual risks in the final handoff.
