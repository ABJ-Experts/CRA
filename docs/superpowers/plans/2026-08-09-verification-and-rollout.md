# Verification and Safe Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that the design-pattern migration preserves behavior, reaches the repository's 80% coverage contract, rejects architectural drift, and can be deployed or reverted one independently safe slice at a time.

**Architecture:** Verification is layered: pure unit and contract tests run first, adapter integration tests run against Supabase, browser tests cover critical user journeys, and static architecture checks prevent forbidden dependencies. Coverage includes production TypeScript and TSX, with only generated files and type declarations excluded; the final 80% thresholds are enabled only after the missing tests are written and passing.

**Tech Stack:** pnpm 10.33.4, Turborepo 2.10, Jest 30, Vitest 3.2.4, Testing Library, Playwright, Supabase CLI/PostgreSQL, ESLint, dependency-cruiser, GitHub Actions.

## Global Constraints

- Execute this plan after the hotfix, foundation, infrastructure, API, and web plans.
- Do not weaken, skip, or narrow a test to make the gate pass.
- Exclude only generated Supabase types, declaration files, and framework build output from coverage.
- Keep API and browser compatibility assertions on existing route paths, status codes, bodies, cookie paths, permission ordering, and mock endpoints.
- Treat flaky timing, random sleeps, shared accounts, and order-dependent tests as defects.
- Never run `db:reset` against a shared or production Supabase project; CI must use the local project started in that job.
- A rollout may proceed only when the current slice is independently green and independently revertible.

---

### Task 1: Add Honest Coverage Collection and the Final 80% Gate

**Files:**

- Modify: `apps/api/package.json:11-28`
- Modify: `apps/api/package.json:45-65`
- Modify: `apps/web/package.json:8-39`
- Modify: `apps/web/vitest.config.ts:1-20`
- Modify: `packages/contracts/package.json:25-41`
- Modify: `packages/contracts/vitest.config.ts:1-16`
- Modify: `packages/ui/package.json:1-82`
- Create: `packages/ui/vitest.config.ts`
- Create: `packages/ui/src/test/setup.ts`
- Modify: `packages/design-system/package.json:1-14`
- Create: `packages/design-system/vitest.config.ts`
- Modify: `apps/docs/package.json:1-48`
- Create: `apps/docs/vitest.config.ts`
- Create: `apps/docs/src/test/setup.ts`
- Modify: `package.json:5-15`
- Modify: `turbo.json:17-30`

**Interfaces:**

- Produces: `test:coverage` in API, web, contracts, and UI packages.
- Produces: root `coverage` gate that fails below 80% for statements, branches, functions, or lines.
- Preserves: existing `test` scripts as fast non-coverage runs.

- [ ] **Step 1: Install matching Vitest coverage and DOM test dependencies**

Run:

```sh
pnpm --filter web add -D @vitest/coverage-v8@3.2.4 @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom
pnpm --filter @repo/contracts add -D @vitest/coverage-v8@3.2.4
pnpm --filter @repo/ui add -D vitest@3.2.4 @vitest/coverage-v8@3.2.4 @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom
pnpm --filter @repo/design-system add -D vitest@3.2.4 @vitest/coverage-v8@3.2.4 jsdom
pnpm --filter docs add -D vitest@3.2.4 @vitest/coverage-v8@3.2.4 @testing-library/react @testing-library/jest-dom jsdom
```

Expected: the lockfile records one Vitest major and no npm/Yarn lockfile appears.

- [ ] **Step 2: Configure all Vitest packages with the same threshold contract**

Use this coverage block in each Vitest config, changing only the package-specific `include` paths:

```ts
coverage: {
  provider: "v8",
  reporter: ["text", "json-summary", "lcov"],
  include: ["src/**/*.{ts,tsx}"],
  exclude: ["src/**/*.d.ts", "src/test/**"],
  thresholds: {
    statements: 80,
    branches: 80,
    functions: 80,
    lines: 80,
  },
},
```

For web, include `app/**/*.{ts,tsx}`, `middleware.ts`, and `mocks/**/*.ts`; exclude `.next/**`, generated route types, and test setup only. For docs, include `src/**/*.{ts,tsx}`, `docusaurus.config.ts`, and `sidebars.ts`. For design-system, include `src/**/*.ts`. Do not exclude pages, layouts, components, adapters, or configuration merely because they are difficult to test.

Use `environment: "jsdom"` and `setupFiles: ["./src/test/setup.ts"]` for UI. Its setup is exact:

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 3: Configure Jest to measure all API production code**

Replace the current broad Jest glob with:

```json
"collectCoverageFrom": [
  "**/*.ts",
  "!**/*.spec.ts",
  "!database.types.ts"
],
"coverageThreshold": {
  "global": {
    "branches": 80,
    "functions": 80,
    "lines": 80,
    "statements": 80
  }
}
```

Keep controllers, modules, guards, filters, services, and adapters included. Test Nest composition roots with `Test.createTestingModule`; do not exclude them.

- [ ] **Step 4: Add coverage scripts and Turbo output tracking**

Set package scripts to:

```json
"test:coverage": "vitest run --coverage"
```

Keep API's existing coverage script but make it `"test:cov": "jest --coverage --runInBand"`. Add `"test": "vitest run"` and `"test:coverage": "vitest run --coverage"` to UI, design-system, and docs; add only `test:coverage` beside the existing test scripts in web and contracts. Add the root script:

```json
"coverage": "turbo run test:coverage test:cov"
```

Declare `coverage/**` as task output in `turbo.json`. Give API only `test:cov`; give Vitest packages only `test:coverage`, so Turbo skips missing scripts without shell conditionals.

- [ ] **Step 5: Record the honest starting report before enabling thresholds**

Temporarily omit only the `thresholds` and `coverageThreshold` blocks, run:

```sh
pnpm coverage
```

Record the four percentages for API, web, contracts, UI, design-system, and docs in the implementation PR description. The audited API baseline on 2026-08-09 was 39.08% statements, 33.92% branches, 25.00% functions, and 36.62% lines; any unexplained decrease from that baseline must be investigated.

- [ ] **Step 6: Commit the collection harness without the final thresholds**

```bash
git add package.json pnpm-lock.yaml turbo.json apps/api/package.json apps/web apps/docs packages/contracts packages/ui packages/design-system
git commit -m "test: add repository coverage collection"
```

Do not commit the 80% threshold blocks until Tasks 2 and 3 make them pass.

### Task 2: Raise API, Contract, and Database Coverage Above 80%

**Files:**

- Create: `apps/api/src/auth/auth.service.spec.ts`
- Create: `apps/api/src/auth/mfa/mfa.service.spec.ts`
- Create: `apps/api/src/invitations/invitations.service.spec.ts`
- Create: `apps/api/src/users/users.service.spec.ts`
- Create: `apps/api/src/permissions/custom-roles.service.spec.ts`
- Create: `apps/api/src/permissions/permissions.service.spec.ts`
- Create: `apps/api/src/audit/audit.service.spec.ts`
- Create: `apps/api/src/mail/mail.service.spec.ts`
- Create: `apps/api/src/common/filters/all-exceptions.filter.spec.ts`
- Create: `apps/api/src/auth/permissions.guard.spec.ts`
- Modify: `apps/api/src/common/security/security.module.spec.ts`
- Create: `apps/api/src/test/supabase-query.stub.ts`
- Create: `apps/api/src/test/supabase-query.stub.spec.ts`
- Create: `apps/api/test/architecture.e2e-spec.ts`
- Create: `packages/contracts/src/auth.spec.ts`
- Modify: `packages/contracts/src/menu.spec.ts`
- Modify: `packages/contracts/src/pagination.spec.ts`
- Modify: `packages/contracts/src/permissions.spec.ts`
- Modify: `packages/contracts/src/http.spec.ts`
- Modify: `packages/contracts/src/users.spec.ts`
- Modify: `packages/contracts/src/invitations.spec.ts`
- Modify: `packages/contracts/src/roles.spec.ts`
- Modify: `apps/infrastructure/tests/run.sh`

**Interfaces:**

- Produces: deterministic tests for every public service method, error mapping branch, tenant scope, state transition, and security-critical RPC.
- Preserves: live RLS/schema tests as an independent database boundary, not mocked unit coverage.

- [ ] **Step 1: Build one reusable immutable Supabase query double**

Create a test-only helper under `apps/api/src/test/supabase-query.stub.ts` with this interface:

```ts
export interface RecordedQuery {
  readonly table: string;
  readonly operations: readonly {
    readonly name: string;
    readonly args: readonly unknown[];
  }[];
}

export interface QueryFixture {
  readonly data: unknown;
  readonly error: { readonly message: string; readonly code?: string } | null;
  readonly count?: number | null;
}

export function createSupabaseStub(
  fixtures: Readonly<Record<string, readonly QueryFixture[]>>,
): {
  readonly client: unknown;
  readonly queries: () => readonly RecordedQuery[];
  readonly rpc: jest.Mock;
};
```

Each chained method returns a new query object containing a new operations array; the stub must not mutate shared state. A terminal `then`, `single`, or `maybeSingle` consumes the next fixture for that table and throws an explicit test error when none exists.

- [ ] **Step 2: Cover the exact API behavior matrix**

Write parameterized tests for these cases:

| Surface     | Success cases                                                                   | Failure and edge cases                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Auth        | sign-up, sign-in, refresh, verify email, forgot/reset password, session, unlock | unknown identifier, inactive profile, lockout, expired/reused code, revoked epoch, GoTrue failure, RPC failure, minimum-duration timing |
| MFA         | enroll, challenge, verify, recovery, disable                                    | wrong factor, replay, exhausted recovery code, concurrent claim, expired challenge, compensating-state recovery                         |
| Invitations | create, list, resend, revoke, accept, idempotent accept                         | self invite, existing member/account, duplicate, cross-org access, expired/revoked token, concurrent accept, mail failure               |
| Permissions | base, custom, implication, override, menu, version cache                        | every data-source outage, malformed persisted permission, cache invalidation, cross-org cache key, revocation never served stale        |
| Users       | list, activate/deactivate, role assignment                                      | owner invariant, self-action, last owner, out-of-range page, query error, missing org filter                                            |
| Roles       | list, create, update, delete, override                                          | reserved/system role, unknown permission, assigned role deletion, additive-only custom role, org override last                          |
| Platform    | mail, audit, exception filter, token verification                               | provider error, redaction, unknown exception, ES256/JWKS rotation, algorithm mismatch, unavailable key set                              |

For every service-role method, assert the first public argument is `orgId` and inspect `queries()` for `.eq("organization_id", orgId)`. For every mutation, assert both success and provider-error mappings.

- [ ] **Step 3: Contract-test every adapter against its port**

Use this shared adapter conformance shape in each feature spec:

```ts
interface RepositoryContract<TRepository> {
  readonly name: string;
  readonly create: () => TRepository;
  readonly cases: readonly {
    readonly description: string;
    readonly run: (repository: TRepository) => Promise<void>;
  }[];
}

export function repositoryContract<TRepository>(
  contract: RepositoryContract<TRepository>,
): void {
  describe(contract.name, () => {
    it.each(contract.cases)("$description", async ({ run }) => {
      await run(contract.create());
    });
  });
}
```

Run each port contract once against the Supabase adapter double and once in the live integration lane when the local database supports it. Cover exact RPC argument names and returned outcome enums.

- [ ] **Step 4: Expand contract boundary cases**

Every Zod schema must test one fully valid fixture, every optional/nullable field, every enum member, unknown-key behavior, invalid UUID/email/date, minimum and maximum page sizes, zero totals, and malformed provider data. `safeParse` failures must never be cast back to the desired type.

- [ ] **Step 5: Expand live database invariants**

Add shell/SQL assertions for:

```text
two concurrent invitation accepts -> one membership, both deterministic outcomes
two concurrent OTP consumes -> one accepted, one already_used
two concurrent recovery-code claims -> one accepted, one rejected
last-owner removal or demotion -> rejected
service_role RPC execution -> granted only to required functions
anonymous/authenticated RPC execution -> denied unless explicitly required
all security-definer functions -> pinned search_path
every tenant table -> RLS enabled but not forced
every tenant adapter query -> organization_id predicate exercised
```

Each concurrency case must use two background `psql` sessions synchronized by an advisory-lock test barrier, then query final state. Do not accept a probabilistic loop as a concurrency test.

- [ ] **Step 6: Run API and database gates**

Run:

```sh
pnpm --filter api run test:cov --runInBand
pnpm --filter contracts run test:coverage
pnpm --filter infrastructure run db:lint
pnpm --filter infrastructure run test
```

Expected: each covered package reports at least 80% for statements, branches, functions, and lines; all live invariants pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src apps/api/test packages/contracts/src apps/infrastructure/tests
git commit -m "test: cover API and database boundaries"
```

### Task 3: Raise Web and Shared UI Coverage Above 80%

**Files:**

- Create: `packages/ui/src/components/alert/alert.spec.tsx`
- Create: `packages/ui/src/components/app-shell/top-nav.spec.tsx`
- Create: `packages/ui/src/components/avatar/avatar.spec.tsx`
- Create: `packages/ui/src/components/breadcrumbs/breadcrumbs.spec.tsx`
- Create: `packages/ui/src/components/button/button.spec.tsx`
- Create: `packages/ui/src/components/card/card.spec.tsx`
- Create: `packages/ui/src/components/chart/chart.spec.tsx`
- Create: `packages/ui/src/components/chart/charts.spec.tsx`
- Create: `packages/ui/src/components/chart/chart-palette.spec.ts`
- Create: `packages/ui/src/components/chart/echarts.spec.ts`
- Create: `packages/ui/src/components/checkbox/checkbox.spec.tsx`
- Create: `packages/ui/src/components/chip/chip.spec.tsx`
- Create: `packages/ui/src/components/combobox/combobox.spec.tsx`
- Create: `packages/ui/src/components/data-table/data-table.spec.tsx`
- Create: `packages/ui/src/components/data-table/selection-column.spec.tsx`
- Create: `packages/ui/src/components/date-picker/calendar.spec.tsx`
- Create: `packages/ui/src/components/date-picker/date-picker.spec.tsx`
- Create: `packages/ui/src/components/editor/editor.spec.tsx`
- Create: `packages/ui/src/components/form/form.spec.tsx`
- Create: `packages/ui/src/components/input/input.spec.tsx`
- Create: `packages/ui/src/components/input/password-input.spec.tsx`
- Create: `packages/ui/src/components/input/search-input.spec.tsx`
- Create: `packages/ui/src/components/modal/modal.spec.tsx`
- Create: `packages/ui/src/components/otp-input/otp-input.spec.tsx`
- Create: `packages/ui/src/components/pagination/pagination.spec.tsx`
- Create: `packages/ui/src/components/radio/radio.spec.tsx`
- Create: `packages/ui/src/components/select-users/select-users.spec.tsx`
- Create: `packages/ui/src/components/select/select.spec.tsx`
- Create: `packages/ui/src/components/sort-by/sort-by.spec.tsx`
- Create: `packages/ui/src/components/stat-card/stat-card.spec.tsx`
- Create: `packages/ui/src/components/switch/switch.spec.tsx`
- Create: `packages/ui/src/components/tabs/tabs.spec.tsx`
- Create: `packages/ui/src/components/tag/tag.spec.tsx`
- Create: `packages/ui/src/components/time-picker/time-picker.spec.tsx`
- Create: `packages/ui/src/lib/cn.spec.ts`
- Create: `packages/design-system/src/theme.spec.ts`
- Create: `apps/docs/src/components/HomepageFeatures/index.spec.tsx`
- Create: `apps/docs/src/pages/index.spec.tsx`
- Create: `apps/docs/config.spec.ts`
- Create: `apps/web/app/(auth)/auth-components.spec.tsx`
- Create: `apps/web/app/(auth)/auth-pages.spec.tsx`
- Create: `apps/web/app/_components/sidebar/sidebar.spec.tsx`
- Create: `apps/web/app/_providers/providers.spec.tsx`
- Create: `apps/web/app/_providers/session-provider.spec.tsx`
- Create: `apps/web/app/dashboard/dashboard-pages.spec.tsx`
- Create: `apps/web/app/dashboard/tables/_components/table-components.spec.tsx`
- Create: `apps/web/app/showcase/showcase-pages.spec.tsx`
- Modify: `apps/web/app/(auth)/_components/auth-actions.spec.ts`
- Modify: `apps/web/app/_components/sidebar/menu-nav-parity.spec.ts`
- Modify: `apps/web/middleware.spec.ts`
- Modify: `apps/web/mocks/handlers.spec.ts`
- Modify: `apps/web/app/_lib/http/api-client.spec.ts`
- Modify: `apps/web/app/_lib/http/authenticated-request.spec.ts`
- Modify: `apps/web/app/_features/session/session-state.spec.ts`
- Modify: `apps/web/app/_features/session/session.queries.spec.tsx`
- Modify: `apps/web/app/_features/session/route-session-state.spec.ts`
- Modify: `apps/web/app/_features/account/account.api.spec.ts`
- Modify: `apps/web/app/_features/members/members.api.spec.ts`
- Modify: `apps/web/app/_features/roles/roles.api.spec.ts`
- Modify: `apps/web/app/_features/invitations/invitations.api.spec.ts`
- Modify: `apps/web/app/_features/security/security.api.spec.ts`
- Modify: `apps/web/mocks/data/table-schemas.spec.ts`
- Modify: `apps/web/app/dashboard/_lib/use-table-query.spec.tsx`

**Interfaces:**

- Produces: behavioral component tests, state-machine tests, adapter tests, accessibility checks, and mock/real transport parity.
- Preserves: semantic token usage, `cn()` composition, controlled tables, navigation parity, and fail-open menu visibility.

- [ ] **Step 1: Create deterministic browser-test setup**

Stub `matchMedia`, `ResizeObserver`, `IntersectionObserver`, and `scrollIntoView` in the UI test setup. Reset all mocks and `document.body` after every test. Freeze time only inside date/time tests and restore real timers in `afterEach`.

- [ ] **Step 2: Test shared UI by behavior family**

Use `render`, `screen`, and `userEvent`; never assert private component state. Cover:

| Family     | Components                                                              | Required assertions                                                                                             |
| ---------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Inputs     | input, password, search, checkbox, switch, radio, select, combobox, OTP | label association, keyboard path, disabled/read-only, controlled value, validation attributes, callback payload |
| Overlays   | modal, date picker, time picker, select users                           | focus entry/return, Escape, outside click, confirm/cancel, empty result, keyboard selection                     |
| Navigation | tabs, breadcrumbs, pagination, sort-by, app shell                       | current item, disabled bounds, keyboard activation, exact callback values                                       |
| Display    | alert, avatar, card, chip, tag, stat card                               | accessible name/role, semantic token class, fallback content, variant class merge through `cn()`                |
| Complex    | data table, chart, editor                                               | empty/loading/error, sort/filter/page/selection, chart teardown, editor command/undo/redo, controlled updates   |

Test every exported variant at least once. For CVA variants, assert semantic classes rather than snapshotting the full DOM.

- [ ] **Step 3: Test web feature transitions and adapters**

The session transition table must enumerate:

```text
no marker/no token on protected route -> sign-in
marker/no token on protected route -> refresh
valid token on auth route -> dashboard
expired token/marker -> refresh
expired token/no marker -> sign-in
invalid signature -> clear access cookie and sign-in
pending verification -> verify route
MFA required -> two-factor route
refresh 401 -> clear marker and sign-in
refresh 503 -> keep marker and show retryable state
```

The HTTP adapter tests must cover empty 204 bodies, JSON success, structured JSON failure, non-JSON failure, schema mismatch, timeout abort, caller abort, one concurrent refresh, unsafe request non-retry, and preserved credentials/headers.

Feature facade tests must assert exact existing URLs and methods for account, members, invitations, roles, permissions, security, and tables. `rg` must find no direct feature `fetch` after migration outside the central HTTP adapter, auth server actions, MSW bootstrap, and middleware.

- [ ] **Step 4: Test design-system and documentation behavior**

`theme.spec.ts` covers stored light/dark/system values, unavailable storage, SSR without `document`, attribute application/removal, transition suppression/removal, a document without `defaultView`, and `matchMedia` light/dark resolution. Use fake timers only for the 1 ms cleanup and restore them after each test.

The docs component tests render all homepage feature cards, accessible headings, and internal links. `config.spec.ts` imports the committed Docusaurus config and sidebars, then asserts the production URL/base path, no broken-link ignore policy, the expected docs/blog routes, and that every explicit sidebar document ID resolves to an existing MDX file. The Docusaurus production build remains the authoritative MDX/link integration test.

- [ ] **Step 5: Test mock and real table parity**

Run the same response-schema assertion against all four MSW endpoints and captured API fixtures. Assert `handlers[0]` is the `/api/v1/*` passthrough, row schemas reject malformed mock data, page clamping converges once, selection resets only when intended, and filter/sort/page query keys remain stable.

- [ ] **Step 6: Run web, UI, design-system, and docs gates**

Run:

```sh
pnpm --filter @repo/ui run test:coverage
pnpm --filter web run test:coverage
pnpm --filter @repo/design-system run test:coverage
pnpm --filter docs run test:coverage
pnpm --filter @repo/ui run lint
pnpm --filter web run lint
pnpm --filter @repo/ui run check-types
pnpm --filter web run check-types
pnpm --filter web run build
pnpm --filter docs run check-types
pnpm --filter docs run build
```

Expected: web, UI, design-system, and docs each report at least 80% for statements, branches, functions, and lines; lint, typecheck, and production builds pass.

- [ ] **Step 7: Enable and prove final thresholds**

Restore the threshold blocks from Task 1 in Jest and all Vitest configs. Run `pnpm coverage` twice: once normally and once with Turbo cache disabled via `pnpm turbo run test:coverage test:cov --force`. Both runs must pass.

- [ ] **Step 8: Commit**

```bash
git add apps/api/package.json apps/web apps/docs packages/contracts packages/ui packages/design-system package.json pnpm-lock.yaml turbo.json
git commit -m "test: enforce eighty percent coverage"
```

### Task 4: Add Critical Browser Journeys and Architectural Regression Tests

**Files:**

- Create: `apps/web/e2e/playwright.config.ts`
- Create: `apps/web/e2e/auth-session.spec.ts`
- Create: `apps/web/e2e/invitation.spec.ts`
- Create: `apps/web/e2e/access-control.spec.ts`
- Create: `apps/web/e2e/table-parity.spec.ts`
- Create: `apps/web/e2e/helpers/accounts.ts`
- Modify: `apps/web/package.json:8-39`
- Modify: `.github/workflows/ci.yml`
- Modify: `scripts/architecture/verify-dependencies.mjs`

**Interfaces:**

- Produces: `pnpm --filter web run test:e2e` using isolated seeded users and local Supabase/API/web processes.
- Produces: architecture assertions that guard both dependency direction and externally visible behavior.

- [ ] **Step 1: Install and configure Playwright**

Run:

```sh
pnpm --filter web add -D @playwright/test
pnpm --filter web exec playwright install chromium
```

Configure one Chromium project, trace on first retry, screenshot/video only on failure, `workers: 1` for the shared local database, and explicit `baseURL: "http://127.0.0.1:3000"`. CI starts Supabase, the built API on 3333, and the built web app on 3000 before the tests.

- [ ] **Step 2: Isolate accounts and state**

Derive a unique test suffix from `testInfo.workerIndex` and a cryptographically random run ID passed by CI. Create users through the supported API, store auth state per test, and remove only those run-scoped records through a dedicated local-test cleanup script. Never delete by wildcard email domain or reset the database while another test is running.

- [ ] **Step 3: Implement four exact journeys**

```text
auth-session:
  sign in -> dashboard -> expire only cra_at -> protected navigation refreshes
  -> lock screen -> five wrong passwords -> 429 -> sign out clears all cookies

invitation:
  owner creates invitation -> recipient accepts twice -> both land in organization
  -> exactly one membership -> revoked and expired links cannot join

access-control:
  owner revokes member permission -> next protected API call denied
  -> transient permission-store outage returns 503 -> UI does not claim success
  -> restoring store does not serve a stale grant

table-parity:
  mocks enabled and real API fixture produce the same Paged shape
  -> filter while on late page -> page clamps to 1 -> no request loop
```

Assert response status and machine-readable error code at the network boundary in addition to visible UI.

- [ ] **Step 4: Add architecture and pattern-catalog regression checks**

The verifier must fail when:

```text
an application/domain file imports NestJS, Express, Supabase, jose, or Nodemailer
a web feature calls fetch outside the allowlisted transport files
a service-role public method lacks orgId as its first parameter
a controller route lacks Public or an authorization decorator
the refresh cookie path differs from /api/v1/auth/refresh
token verification becomes HS256-only or ES256/RS256 stop routing through JWKS
SESSION_EPOCH_SKEW_SECONDS differs from 0
the MSW /api/v1 passthrough is not the first handler
nav and menu contracts differ
the pattern catalog no longer has exactly 22 unique GoF entries and one decision per entry
an Accepted, Deferred, or Rejected pattern decision lacks rationale, trigger, and counterexample
```

Static checks supplement runtime tests; they do not replace them.

- [ ] **Step 5: Run the full local live lane**

Run from a disposable local Supabase project:

```sh
pnpm --filter infrastructure run db:start
pnpm --filter infrastructure run db:reset
pnpm --filter infrastructure run db:lint
pnpm --filter infrastructure run test
pnpm --filter api run build
pnpm --filter web run build
pnpm --filter web run test:e2e
```

Expected: all four journeys pass with no test retries required.

- [ ] **Step 6: Commit**

```bash
git add apps/web/e2e apps/web/package.json pnpm-lock.yaml .github/workflows/ci.yml scripts/architecture
git commit -m "test: add critical browser journeys"
```

### Task 5: Roll Out by Compatibility Slice with Explicit Rollback Signals

**Files:**

- Create: `docs/architecture/rollout-runbook.md`
- Modify: `docs/architecture/design-patterns.md`
- Modify: `README.md`

**Interfaces:**

- Produces: one release checklist and rollback decision tree for hotfix, database, API, and web slices.
- Preserves: old controller/service façades until all internal callers have moved and one stable release has passed.

- [ ] **Step 1: Write the release matrix**

Document these independent units:

| Unit                     | Deploy prerequisite             | Positive signal                                 | Rollback signal                       | Rollback action                                  |
| ------------------------ | ------------------------------- | ----------------------------------------------- | ------------------------------------- | ------------------------------------------------ |
| permission outage hotfix | focused unit/live authz green   | revoked grant never reappears                   | elevated 503 after healthy DB         | revert service change only                       |
| lockout hotfix           | unlock unit/E2E green           | wrong unlocks increment durable counter         | valid unlock incorrectly locked       | revert verifyPassword delegation                 |
| session marker           | cookie/middleware/browser green | expired access session refreshes                | redirect loop or marker not cleared   | revert marker code; refresh path unchanged       |
| additive RPC migrations  | schema/RLS/concurrency green    | deterministic outcome enums                     | lock contention or invariant failure  | stop callers; apply forward corrective migration |
| invitation API slice     | façade/adapter/live green       | old payload snapshots unchanged                 | error/status/body drift               | route façade back to legacy internals            |
| remaining API slices     | per-feature 80% and E2E         | org-scoped query and latency stable             | cross-org or authz anomaly            | revert current feature commit                    |
| typed web adapters       | contract/component/E2E green    | schema errors observable, refresh single-flight | retry loop or user-visible regression | restore previous feature API implementation      |

Database rollback is forward-only once a migration has reached a shared environment. Never delete a migration file that may have run.

- [ ] **Step 2: Define measurable release checks**

Before each unit:

```text
all changed-package unit tests pass
changed production files meet 80% in all four metrics
lint and typecheck pass
API and web builds pass
architecture verifier passes
secret scan and dependency audit pass
affected live RLS/RPC/browser journeys pass
git diff contains no generated-type hand edits or cookie-path widening
```

After each unit, inspect structured counts for `permissions_unavailable`, `account_locked`, refresh outcomes, invitation outcome enums, 401/403/429/503 rates, and adapter validation failures. Compare to the pre-release baseline before continuing.

- [ ] **Step 3: Preserve compatibility for one stable release**

Keep existing service class names, controller method signatures, route decorators, and response mappings as façades. Mark a façade removable only when repository search finds no internal caller, wire-contract snapshots are unchanged, and the prior release completed without rollback. Remove façades in separate cleanup commits, never in the migration commit.

- [ ] **Step 4: Run the final repository gate**

Run:

```sh
pnpm verify
pnpm coverage
pnpm test:live
pnpm --filter web run test:e2e
git diff --check
git status --short
```

Expected: all checks pass; status contains only the intended task files.

- [ ] **Step 5: Commit the runbook**

```bash
git add docs/architecture/rollout-runbook.md docs/architecture/design-patterns.md README.md
git commit -m "docs: add architecture rollout runbook"
```

## Completion Criteria

The architecture migration is complete only when all six plans are implemented, every production package is above 80% in statements, branches, functions, and lines, all live and browser journeys pass without retries, the dependency and 22-pattern catalog checks pass, and compatibility façades have either survived one stable release or remain intentionally documented. Passing static pattern checks alone is never evidence that the application is correct.
