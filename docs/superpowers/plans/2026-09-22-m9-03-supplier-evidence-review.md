# M9-03 Supplier Evidence Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven development or execute each task with an independent review.

**Goal:** Add attributable accept, reject, and follow-up-only re-request review for submitted supplier evidence.

**Architecture:** Existing supplier-evidence use cases remain the facade. Shared Zod contracts feed thin Nest routes and org-first Supabase RPCs; immutable review rows preserve decisions while M8 owns scan/retention and M7 remains an explicit consumer.

**Tech Stack:** TypeScript, Zod, NestJS, Next.js, TanStack Query, PostgreSQL/Supabase, Vitest, Jest, Playwright.

**Spec:** `docs/architecture/m9-03-supplier-evidence-review.md`

## Global Constraints

- Preserve M9-02 public routes, opaque supplier sessions, `/api/v1`, cookies, JWKS, M8 versions, and M7 snapshots.
- Use `can_review_evidence`, never upload permission, for internal review.
- Keep all service-role queries organization-first and transactionally audit review writes.
- Do not automatically link accepted evidence to technical files or persist raw invitation tokens.
- Use only CLI-generated database types and do not reset existing data.

## Review Focus

- A clean version becomes quarantined between render and decision: acceptance must fail closed.
- A duplicate command returns its original result; mismatched payload returns a conflict.
- A reviewer from another tenant or without product scope cannot read or mutate a submission.
- Re-request retains earlier decision/version/hash and requires only unresolved follow-up items.
- Failed delivery leaves a durable failed state and replacement invitation path without exposing a raw bearer.

### Task 1: Contracts and authorization

**Files:** `packages/contracts/src/supplier-evidence/**`, `packages/contracts/src/permissions.ts`, related specs.

- [ ] Add failing schemas/specs for review input, immutable review result, item/aggregate projection, and supplier-safe/internal text separation.
- [ ] Add `review` to evidence permissions, ensuring member upload remains insufficient.
- [ ] Export trusted `z.output` types and run focused contracts tests.

### Task 2: Atomic persistence

**Files:** new M9-03 migration, generated types, infrastructure SQL tests.

- [ ] Add failing SQL cases for stale hashes, quarantine, tenant/product denial, idempotency, follow-up lineage, delivery failure, and grants.
- [ ] Add immutable review rows, current review projection, invitation delivery fields, required indexes, and follow-up item lineage.
- [ ] Implement org-first review/re-request/delivery/read RPCs; lock mutable rows and write durable audit facts in the same transaction.
- [ ] Revoke helper RPC execution from public roles, grant wrappers only to `service_role`, then lint/test the migration and generate types through the CLI.

### Task 3: API facade

**Files:** `apps/api/src/supplier-evidence/**`, related Jest specs.

- [ ] Add failing controller/use-case/repository tests for parsing, permissions, conflicts, and response schemas.
- [ ] Add internal review, re-request, and delivery-status operations under the existing supplier-evidence controller namespace.
- [ ] Keep controllers thin, map stable outcomes to safe HTTP errors, and parse all RPC JSON against shared output schemas.
- [ ] Run focused API tests and type checks.

### Task 4: Review experience

**Files:** `apps/web/app/_features/supplier-evidence/**`, supplier-detail wiring, web tests.

- [ ] Add failing gateway/component tests for reviewed metadata, required rejection reason, retained form input, and conflict reload behavior.
- [ ] Add code-split reviewer panel and query mutations using existing authenticated transport and semantic UI tokens.
- [ ] Surface follow-up due dates/reasons only to the supplier portal; never show internal notes or tenant context.
- [ ] Run web tests, design detector, and browser accessibility checks.

### Task 5: End-to-end verification

- [ ] Build contracts/types, run focused and full verification gates.
- [ ] Run live stack API/database tests without reset, then Playwright owner review journeys and capture screenshots.
- [ ] Query the local CRA Supabase target read-only to confirm scoped review provenance and report the pre-existing no-op migration registry drift separately.
