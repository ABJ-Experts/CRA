# M10-02 Control Library Implementation Plan

> **For agentic workers:** Implement the approved M10-02 plan task by task with failing tests first and independent review. The feature design is [m10-02-control-library.md](../../architecture/m10-02-control-library.md).

**Goal:** Give organizations revisioned controls, exact evidence-version links, and product-scoped mappings to immutable framework requirements.

**Architecture:** Shared feature-first Zod contracts feed thin Nest controllers and application use cases. A Supabase adapter calls explicitly scoped, transactional PostgreSQL functions. Functional React views use a typed gateway; M8 consumes a filtered reverse-link projection.

**Tech Stack:** pnpm, TypeScript, Zod, NestJS, Next.js, Supabase/PostgreSQL, pgTAP, Jest, Vitest, Playwright.

**Spec:** User-approved M10-02 plan and `docs/architecture/m10-02-control-library.md`.

## Global constraints

- Keep `/api/v1`, ES256/JWKS, auth cookie paths, frozen auth actions, permission merge order, M7 snapshots, M8 immutable evidence versions, menu parity, and mock routing.
- Explicit product IDs are the only applicability source. New products are unmapped until reviewed.
- Every mutation carries a durable idempotency key and optimistic revision; change and audit commit together.
- Scope every service-role query by verified organization, actor, and relevant product; no direct Supabase in UI or controllers.
- No database reset, remote ERP project mutation, or deletion of unrelated local data.

## Review focus

1. A mapped control in another organization or product must not appear in coverage or M8 reuse.
2. An evidence link must retain its exact version while availability changes after expiry or deletion review.
3. Duplicate or concurrent commands must not create extra mappings or audit only part of a change.
4. Changing the selected pack version or renaming a display label must not retarget old mappings.
5. An inactive owner or archived control must remain historically visible without implying current coverage.

### Task 1: Database and transaction boundary

**Files:** Add a CLI-named migration under `apps/infrastructure/supabase/migrations/` and focused pgTAP coverage under `apps/infrastructure/tests/`.

**Interface:** Scoped control command RPC accepts organization ID, actor ID, operation, validated payload, expected revision, and idempotency key; bounded read RPCs return control and coverage data.

- [ ] Write pgTAP assertions for schema, foreign keys, grants/RLS, valid and invalid transitions, tenant/product/evidence isolation, replay, stale revision, archive, and atomic audit. Run the focused test and observe failure.
- [ ] Add the minimum control head/revision/link/mapping/product/command tables and indexes. Add functions with pinned `search_path`, explicit grants, and non-forced RLS.
- [ ] Apply only the additive migration to the confirmed local CRA stack. Run the focused SQL suite, `db:lint`, and `supabase db diff`; retain all existing data.

### Task 2: Contracts and API

**Files:** `packages/contracts/src/frameworks/` and `apps/api/src/frameworks/`.

**Interface:** Bounded control list/detail and version/product coverage reads; create/edit/archive, evidence link/end, and mapping create/edit/end commands. All inputs and success responses use shared schemas and `z.output` types.

- [ ] Write failing schema, controller, policy, and adapter tests for malformed identifiers/text, permissions, tenant scope, conflicts, and output parsing.
- [ ] Implement thin routes and application use cases using an inward repository port and Supabase adapter. Preserve error distinctions and do not replay POST automatically.
- [ ] Run focused contracts/API tests, permission coverage gates, type checks, and coverage.

### Task 3: M8 reverse evidence projection

**Files:** `packages/contracts/src/evidence/schemas/evidence.schema.ts`, a later additive SQL migration, and the M8 reuse panel/tests.

**Interface:** `frameworkControls` returns only exact requested evidence version/product links, filtered by framework and evidence permissions, with stable requirement references and no unauthorized product metadata.

- [ ] Write failing contract, SQL, API, and panel tests for allowed links, denied viewer, wrong product/version, and archived/ended links.
- [ ] Replace the empty M8 projection and `z.never()` contract together, then render an accessible reverse-link list.
- [ ] Run focused M8 regressions and live local authorization checks.

### Task 4: Operational workspace

**Files:** `apps/web/app/_features/frameworks/`, its route, and a focused Playwright spec.

**Interface:** Typed gateway validates outgoing bodies and incoming responses; the workspace reads product-scoped coverage and persists only explicit mapping product IDs.

- [ ] Write failing gateway/component tests for create/edit/link/map/archive, stale revision, forbidden, offline, retry, and preserved draft input.
- [ ] Add an accessible control table/detail, requirement-text picker, owner and evidence states, and mapped/unmapped coverage without compliance claims. Use current tokens, `cn()`, shared UI subpaths, and a lazy boundary for heavy detail.
- [ ] Run focused web tests and owner Playwright journeys on the local development server, with screenshots and cross-browser/accessibility checks.

### Task 5: Release evidence

**Files:** `docs/architecture/m10-02-control-library.md`, a verification record, and generated Supabase types in both existing locations.

- [ ] Generate types with `pnpm --filter infrastructure run db:types` and inspect the diff.
- [ ] Run focused live-stack tests, `pnpm verify`, load probe, and relevant M1–M9/auth/navigation regressions. Record any pre-existing failing gate separately.
- [ ] Record requirement-to-test links, migration order, forward-only rollback, screenshots, timings, coverage, and residual risks. Review the full diff for security and compatibility.
