# M5-04 Expiring Suppression and Internal SLA Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver tenant-safe, finite finding suppression and configurable internal severity SLA alerts while preserving VEX and regulatory facts.

**Architecture:** Use the existing triage request path with feature-owned strict contracts, org-first atomic Supabase RPCs, and one leased durable alert worker. Queue/detail receive one additive operational projection; no generic event bus or new role model is introduced.

**Tech Stack:** Next.js/React, NestJS, Zod, PostgreSQL/Supabase, Vitest/Jest, Playwright.

**Spec:** BRD FR-TRI-009 and FR-TRI-014, p30; `docs/architecture/m5-suppression-sla-alerts.md`.

## Global Constraints

- Preserve `/api/v1`, narrow refresh-cookie path, JWKS verification, frozen auth-action signatures, RBAC merge order, and existing menu/MSW behavior.
- Every mutation is versioned and idempotent; POST/PATCH/PUT are never refresh-replayed automatically.
- Use additive CLI-generated migrations, `public.users` FKs, pinned function search paths, explicit grants, and enabled non-forced RLS.
- Store UTC instants; render in local time only. Suppression changes no VEX/risk/regulatory state.
- Do not reset database data or introduce a generic workflow framework.

---

### Task 1: Contract and architecture boundary

**Files:**
- Modify: `packages/contracts/src/vulnerabilities/schemas/vulnerability-triage.schema.ts`
- Modify: `packages/contracts/src/vulnerabilities/types/vulnerability-triage.type.ts`
- Test: `packages/contracts/src/vulnerabilities/schemas/vulnerability-triage.schema.spec.ts`
- Create: `docs/architecture/m5-suppression-sla-alerts.md`

**Interfaces:**
- Produces strict assignment, suppression, SLA-policy, operational queue/detail, and filter schemas with `z.output` types.
- Consumes existing triage, VEX, UTC timestamp, and organization idempotency contracts.

- [ ] **Step 1: Write failing contract tests**

```ts
expect(suppressVulnerabilityTriageFindingInputSchema.safeParse({
  reason: "Awaiting vendor maintenance.",
  expiresAt: "2020-01-01T00:00:00.000Z",
  expectedVersion: 0,
  idempotencyKey,
}).success).toBe(false);
```

- [ ] **Step 2: Run the focused test and observe failure**

Run: `pnpm --filter @repo/contracts test -- vulnerability-triage.schema.spec.ts`

Expected: the new schema export is absent or rejects the intended projection.

- [ ] **Step 3: Implement the strict contracts**

```ts
export const suppressVulnerabilityTriageFindingInputSchema = z.object({
  reason: requiredText(2_000),
  expiresAt: utcZDateTimeSchema.refine((value) => Date.parse(value) > Date.now()),
  expectedVersion: z.number().int().nonnegative(),
  idempotencyKey: idempotencyKeySchema,
}).strict();
```

- [ ] **Step 4: Run contracts, types, and lint**

Run: `pnpm --filter @repo/contracts test && pnpm --filter @repo/contracts check-types && pnpm --filter @repo/contracts lint`

Expected: all pass with no lint warnings.

### Task 2: Durable persistence and RPCs

**Files:**
- Create: one CLI-generated migration under `apps/infrastructure/supabase/migrations/`
- Modify: generated database types only via `pnpm --filter infrastructure run db:types`
- Test: feature-local infrastructure SQL integration tests

**Interfaces:**
- Consumes Task 1 mutation/projection schemas.
- Produces org-first assignment/suppression/SLA policy RPCs and due-event lease RPCs.

- [ ] **Step 1: Write live failing isolation/concurrency tests**

```ts
expect(await suppressAsOtherOrganization(findingId)).toEqual({ code: "unavailable" });
expect(await raceExtensionAndExpiry(findingId)).toHaveLength(1);
```

- [ ] **Step 2: Run against local Supabase and observe failure**

Run: `pnpm --filter infrastructure test -- triage-suppression-sla`

Expected: missing table/function or failed invariant assertion.

- [ ] **Step 3: Create additive tables/functions**

Implement append-only suppression revisions, one operational state per finding,
five policies per org, keyed notification events, indexes, RLS, grants, and
pinned-search-path RPCs. Each mutation locks state and commits audit evidence
with its authoritative change.

- [ ] **Step 4: Run database checks**

Run: `pnpm --filter infrastructure run db:lint && pnpm --filter infrastructure test -- triage-suppression-sla`

Expected: lint and tenant/RLS/concurrency tests pass.

### Task 3: API, worker, and web flow

**Files:**
- Modify: focused API triage controller/use case/port/adapter and module bootstrap
- Modify: existing web Findings gateway, queue/detail, and owner policy surface
- Test: colocated API Jest and web Vitest specs

**Interfaces:**
- Consumes Task 1 schemas and Task 2 RPCs.
- Produces `PATCH findings/:id/assignee`, `POST findings/:id/suppression`, and `GET|PUT findings/triage-sla-policies` under `/api/v1`.

- [ ] **Step 1: Write failing API/web tests**

```ts
await expect(api.suppress(findingId, pastExpiry)).rejects.toMatchObject({ status: 400 });
expect(screen.getByText("Internal SLA breached")).toBeVisible();
```

- [ ] **Step 2: Run focused tests and observe failure**

Run: `pnpm --filter api test -- triage && pnpm --filter web test -- triage`

Expected: missing endpoint/worker/UI behavior.

- [ ] **Step 3: Implement minimal adapters and UI**

Parse all inputs/success outputs, resolve recipients at delivery time, surface
retry/dead-letter status, and preserve form values for validation/conflict/offline
errors. Use semantic tokens, text-plus-colour states, keyboard focus, and no
new dashboard/navigation surface.

- [ ] **Step 4: Run focused API/web tests**

Run: `pnpm --filter api test -- triage && pnpm --filter web test -- triage`

Expected: all added and existing focused tests pass.

### Task 4: Live verification and rollout readiness

**Files:**
- Test: Playwright journeys and screenshots only; no production/hosted data changes

**Interfaces:**
- Consumes local API/web/Supabase stack and seeded local owner credentials from environment configuration.

- [ ] **Step 1: Create uniquely tagged local test data through the app/API**

Use a timestamped `m5-04-e2e-*` identifier. Do not use `db:reset` or delete existing records.

- [ ] **Step 2: Execute the browser journey**

Verify owner policy configuration, editor assignment, reason/expiry validation,
suppressed filter, extension conflict, expired restoration, SLA breach, and
delivery failure labeling. Capture desktop and mobile screenshots.

- [ ] **Step 3: Run final gates**

Run: `pnpm verify` and applicable `pnpm test:live` after focused/live database,
API, web, accessibility, and Playwright checks.

Expected: commands pass; report any unavailable external dependency, exact
failure output, residual risk, and expand-first rollback order.
