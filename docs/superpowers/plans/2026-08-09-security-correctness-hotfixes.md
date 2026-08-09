# Security Correctness Hotfixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three verified authorization/session gaps before any architecture refactor, with focused regression tests and no route, response-shape, or refresh-token-path changes.

**Architecture:** Make authorization data uncertainty return 503 instead of broadening permissions, route lock-screen password checks through the durable per-account lockout, and add a non-authoritative root-path session marker so middleware can reach the narrowly scoped refresh cookie after the access cookie expires. Each fix is independent and must be committed separately.

**Tech Stack:** NestJS 11, Next.js 16 middleware, TypeScript 5.9.2, Jest 30, Vitest 3, Supabase/PostgreSQL, Express cookies.

## Global Constraints

- Use Node 20+ and pnpm only.
- Preserve `/api/v1`, all route paths, status codes, and response bodies.
- Preserve the frozen eight web auth action signatures.
- Never widen `cra_rt` beyond `/api/v1/auth/refresh`.
- `cra_at` remains HttpOnly at `/` with a one-hour maximum age.
- UI cookies and the new marker are routing hints only; API token/refresh verification remains authoritative.
- Authorization uncertainty must deny or return 503; it must never restore revoked permissions.
- Durable account lockout and endpoint throttling are complementary and both remain enabled.
- Write failing tests first and run the live auth/RLS suites before completion.

---

### Task 1: Fail Closed When Permission Data Is Unavailable

**Files:**

- Create: `apps/api/src/permissions/permissions.service.spec.ts`
- Modify: `apps/api/src/permissions/permissions.service.ts:1-245`

**Interfaces:**

- Consumes: existing `PermissionsService.resolve(orgId, userId, baseRole)`.
- Produces: unchanged success return type; any database-read failure throws `ServiceUnavailableException` with code `permissions_unavailable` and never caches a partial result.

- [ ] **Step 1: Write the query-chain test helper and failing override test**

```ts
import { ServiceUnavailableException } from "@nestjs/common";

import { PermissionsService } from "./permissions.service";

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

function chain(result: QueryResult) {
  const query = {
    select: jest.fn(),
    eq: jest.fn(),
    maybeSingle: jest.fn(),
    then: undefined as unknown,
  } as Record<string, jest.Mock> & PromiseLike<QueryResult>;
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue(result);
  query.then = ((resolve: (value: QueryResult) => unknown) =>
    Promise.resolve(result).then(resolve)) as never;
  return query;
}

describe("PermissionsService failure posture", () => {
  it("does not restore base grants when overrides cannot be read", async () => {
    const results: Record<string, QueryResult> = {
      organization_permissions_version: { data: { version: 7 }, error: null },
      user_role_assignments: { data: [], error: null },
      base_role_permission_overrides: {
        data: null,
        error: { message: "database unavailable" },
      },
      menu_permissions: { data: [], error: null },
    };
    const supabase = {
      admin: () => ({
        from: (table: string) => chain(results[table]!),
      }),
    };
    const service = new PermissionsService(supabase as never);

    await expect(
      service.resolve("org-1", "user-1", "member"),
    ).rejects.toMatchObject({
      response: {
        code: "permissions_unavailable",
      },
    });
  });

  it("treats a missing organization permission version as corruption", async () => {
    const supabase = {
      admin: () => ({
        from: () => chain({ data: null, error: null }),
      }),
    };
    const service = new PermissionsService(supabase as never);

    await expect(
      service.resolve("org-1", "user-1", "member"),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
```

- [ ] **Step 2: Add table-driven tests for every authoritative read**

Add this factory and table-driven assertion below the first test:

```ts
function serviceWithFailure(failedTable: string): {
  service: PermissionsService;
  from: jest.Mock;
} {
  const healthy: Record<string, QueryResult> = {
    organization_permissions_version: { data: { version: 7 }, error: null },
    user_role_assignments: { data: [], error: null },
    base_role_permission_overrides: { data: [], error: null },
    menu_permissions: { data: [], error: null },
  };
  const results = {
    ...healthy,
    [failedTable]: { data: null, error: { message: "boom" } },
  } satisfies Record<string, QueryResult>;
  const from = jest.fn((table: string) => chain(results[table]!));
  return {
    service: new PermissionsService({ admin: () => ({ from }) } as never),
    from,
  };
}

it.each([
  "organization_permissions_version",
  "user_role_assignments",
  "base_role_permission_overrides",
  "menu_permissions",
])("returns 503 when %s is unreadable", async (failedTable) => {
  const { service, from } = serviceWithFailure(failedTable);

  await expect(
    service.resolve("org-1", "user-1", "member"),
  ).rejects.toBeInstanceOf(ServiceUnavailableException);
  await expect(
    service.resolve("org-1", "user-1", "member"),
  ).rejects.toBeInstanceOf(ServiceUnavailableException);

  expect(
    from.mock.calls.filter(([table]) => table === failedTable),
  ).toHaveLength(2);
});
```

The second rejection and the two reads prove that no partial result was served from cache after the first failure.

- [ ] **Step 3: Run the focused test to verify it fails**

Run: `pnpm --filter api run test -- permissions.service`

Expected: FAIL because `baseRoleOverrides()` currently returns `{}` and the other reads degrade to partial data.

- [ ] **Step 4: Implement one explicit failure mapping**

Import `ServiceUnavailableException` and add:

```ts
private unavailable(source: string, message: string): ServiceUnavailableException {
  this.logger.error(`${source} failed: ${message}`);
  return new ServiceUnavailableException({
    message: "Permissions are temporarily unavailable. Please try again.",
    code: "permissions_unavailable",
  });
}
```

Replace every data-read error fallback with a throw. The version row itself is mandatory, so absence is also unavailable:

```ts
if (error || !data) {
  throw this.unavailable(
    "Permission version lookup",
    error?.message ?? "version row missing",
  );
}
return data.version;
```

Use the error-only form in `assignedRoles`, `baseRoleOverrides`, and `menuRules`; an empty assignment/menu array and a missing override row are legitimate empty states. Do not catch the exception in `resolve`; `Promise.all` must reject, and the cache write must remain after all reads and permission resolution succeed.

- [ ] **Step 5: Verify success, outage, and cache paths**

Run: `pnpm --filter api run test -- permissions.service permission-coverage && pnpm --filter contracts run test -- permissions`

Expected: PASS. Success behavior and permission merge ordering remain unchanged.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/permissions/permissions.service.ts apps/api/src/permissions/permissions.service.spec.ts
git commit -m "fix: fail closed on permission read errors"
```

### Task 2: Apply Durable Lockout to Lock-Screen Reauthentication

**Files:**

- Create: `apps/api/src/auth/auth.service.lockout.spec.ts`
- Modify: `apps/api/src/auth/auth.service.ts:170-228,553-562,626-662`
- Modify: `apps/api/test/auth-flow.e2e.sh:134-190`

**Interfaces:**

- Consumes: `AuthService.verifyPassword(email: string, password: string): Promise<boolean>`.
- Produces: the same signature; it may throw the existing `TooManyRequestsException` when the account is durably locked.

- [ ] **Step 1: Write failing unit tests for locked, failed, and successful unlocks**

```ts
import { TooManyRequestsException } from "../common/exceptions/too-many-requests.exception";
import { AuthService } from "./auth.service";

describe("AuthService.verifyPassword lockout", () => {
  afterEach(() => jest.useRealTimers());

  function createService(input: {
    lockedUntil: string | null;
    signInResult: {
      data: { session: object | null };
      error: { message: string } | null;
    };
  }) {
    const signInWithPassword = jest.fn().mockResolvedValue(input.signInResult);
    const rpc = jest.fn(async (name: string) => {
      if (name === "is_login_locked") {
        return { data: input.lockedUntil, error: null };
      }
      return { data: null, error: null };
    });
    const service = new AuthService(
      {
        admin: () => ({ rpc }),
        anon: () => ({ auth: { signInWithPassword } }),
      } as never,
      {
        getOrThrow: (key: string) => (key === "LOGIN_MAX_ATTEMPTS" ? 5 : 15),
      } as never,
      {} as never,
    );
    return { service, rpc, signInWithPassword };
  }

  it("does not call GoTrue for an account that is already locked", async () => {
    const { service, signInWithPassword } = createService({
      lockedUntil: "2099-01-01T00:00:00.000Z",
      signInResult: { data: { session: null }, error: null },
    });

    await expect(
      service.verifyPassword("USER@CRA.TEST", "wrong"),
    ).rejects.toBeInstanceOf(TooManyRequestsException);
    expect(signInWithPassword).not.toHaveBeenCalled();
  });
});
```

Add the failed and successful unlock tests inside the same `describe` block:

```ts
it("records a failed lock-screen password attempt", async () => {
  jest.useFakeTimers();
  const { service, rpc } = createService({
    lockedUntil: null,
    signInResult: {
      data: { session: null },
      error: { message: "invalid credentials" },
    },
  });

  const pending = service.verifyPassword("USER@CRA.TEST", "wrong");
  await jest.advanceTimersByTimeAsync(300);

  await expect(pending).resolves.toBe(false);
  expect(rpc).toHaveBeenCalledWith("record_login_failure", {
    p_email: "user@cra.test",
    p_max_attempts: 5,
    p_window: "15 minutes",
    p_lock_duration: "15 minutes",
  });
  expect(rpc).not.toHaveBeenCalledWith(
    "clear_login_attempts",
    expect.anything(),
  );
});

it("clears prior failures after a successful lock-screen password", async () => {
  jest.useFakeTimers();
  const { service, rpc } = createService({
    lockedUntil: null,
    signInResult: { data: { session: {} }, error: null },
  });

  const pending = service.verifyPassword("USER@CRA.TEST", "password");
  await jest.advanceTimersByTimeAsync(300);

  await expect(pending).resolves.toBe(true);
  expect(rpc).toHaveBeenCalledWith("clear_login_attempts", {
    p_email: "user@cra.test",
  });
  expect(rpc).not.toHaveBeenCalledWith(
    "record_login_failure",
    expect.anything(),
  );
});
```

- [ ] **Step 2: Run the unit tests to verify they fail**

Run: `pnpm --filter api run test -- auth.service.lockout`

Expected: the locked-account test calls GoTrue and the RPC call assertions fail.

- [ ] **Step 3: Route `verifyPassword` through existing lockout primitives**

```ts
async verifyPassword(emailInput: string, password: string): Promise<boolean> {
  const email = normalizeEmail(emailInput);
  const lockedUntil = await this.lockedUntil(email);
  if (lockedUntil) {
    throw new TooManyRequestsException({
      message: "Too many attempts. Please try again later.",
      code: "account_locked",
    });
  }

  const { data, error } = await withMinimumDuration(
    300,
    this.supabase.anon().auth.signInWithPassword({ email, password }),
  );
  if (error || !data.session) {
    await this.recordFailure(email);
    return false;
  }

  await this.clearFailures(email);
  return true;
}
```

Do not change `AuthController.unlock`; the thrown 429 and existing false -> 401 mapping are already correct.

- [ ] **Step 4: Extend the live auth flow**

In `apps/api/test/auth-flow.e2e.sh`, after obtaining an authenticated cookie jar, add five wrong `/api/v1/auth/unlock` requests and assert:

```sh
unlock_status="$(curl -sS -o /tmp/cra-unlock.json -w '%{http_code}' \
  -b "$cookie_jar" -H 'content-type: application/json' \
  -d '{"password":"definitely-wrong"}' \
  "$api_origin/api/v1/auth/unlock")"
test "$unlock_status" = "429"
```

Use the script's existing task-specific temp paths and cleanup trap rather than hard-coding `/tmp` if it already provides them. Assert the body code is `account_locked` and that correct credentials remain locked until the database lock expires or the test clears attempts explicitly.

- [ ] **Step 5: Run unit and live tests**

Run: `pnpm --filter api run test -- auth.service.lockout cookies.util`

Run with the built API and local Supabase running: `pnpm --filter api run test:e2e`

Expected: both PASS; sign-in enumeration timing and existing lockout behavior remain intact.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/auth/auth.service.ts apps/api/src/auth/auth.service.lockout.spec.ts apps/api/test/auth-flow.e2e.sh
git commit -m "fix: enforce lockout during unlock"
```

### Task 3: Preserve Refresh Reachability After Access-Cookie Expiry

**Files:**

- Modify: `apps/api/src/auth/cookies.util.ts:30-144`
- Modify: `apps/api/src/auth/cookies.util.spec.ts:47-184`
- Modify: `apps/web/middleware.ts:37-203`
- Modify: `apps/web/middleware.spec.ts:1-18`

**Interfaces:**

- Produces: `SESSION_MARKER_COOKIE = "cra_session"`, an HttpOnly, SameSite routing marker at `/` with no bearer or refresh credential.
- Produces: `shouldAttemptRefresh(isProtected: boolean, state: TokenState, hasSessionMarker: boolean): boolean`.
- Preserves: `REFRESH_COOKIE_PATH` exactly.

- [ ] **Step 1: Write failing cookie contract tests**

```ts
it("sets a root-path routing marker for the lifetime of the refresh session", () => {
  const persistent = fakeResponse();
  setSessionCookies(
    persistent as never,
    { access_token: "a", refresh_token: "r" },
    cfg,
    { rememberMe: true },
  );
  const marker = persistent.set.find((c) => c.name === SESSION_MARKER_COOKIE);
  expect(marker?.options).toMatchObject({
    httpOnly: true,
    path: "/",
    maxAge: cfg.refreshMaxAge * 1000,
  });
  expect(marker?.value).not.toContain("r");

  const sessionOnly = fakeResponse();
  setSessionCookies(
    sessionOnly as never,
    { access_token: "a", refresh_token: "r" },
    cfg,
  );
  expect(
    sessionOnly.set.find((c) => c.name === SESSION_MARKER_COOKIE)?.options,
  ).not.toHaveProperty("maxAge");
});
```

Extend the clear-cookie test:

```ts
expect(byName[SESSION_MARKER_COOKIE]).toBe("/");
```

- [ ] **Step 2: Write failing pure middleware decision tests**

```ts
import { createRefreshTarget, shouldAttemptRefresh } from "./middleware";

describe("refresh routing", () => {
  it("refreshes an expired token", () => {
    expect(shouldAttemptRefresh(true, "expired", false)).toBe(true);
  });

  it("refreshes an absent access cookie when a refresh session marker exists", () => {
    expect(shouldAttemptRefresh(true, "absent", true)).toBe(true);
  });

  it("sends a genuinely signed-out user to sign-in", () => {
    expect(shouldAttemptRefresh(true, "absent", false)).toBe(false);
  });

  it("never refreshes an invalid bearer", () => {
    expect(shouldAttemptRefresh(true, "invalid", true)).toBe(false);
  });
});
```

- [ ] **Step 3: Run focused tests to verify they fail**

Run: `pnpm --filter api run test -- cookies.util && pnpm --filter web run test -- middleware`

Expected: FAIL because the marker and decision function do not exist.

- [ ] **Step 4: Set and clear a non-authoritative session marker**

In `cookies.util.ts`:

```ts
export const SESSION_MARKER_COOKIE = "cra_session";
```

Inside `setSessionCookies`, after setting the refresh cookie:

```ts
res.cookie(SESSION_MARKER_COOKIE, sign("1", cfg.signingSecret), {
  ...base(cfg),
  path: "/",
  ...(opts.rememberMe ? { maxAge: cfg.refreshMaxAge * 1000 } : {}),
});
```

Inside `clearSessionCookies`:

```ts
res.clearCookie(SESSION_MARKER_COOKIE, { ...base(cfg), path: "/" });
```

The middleware intentionally checks presence only. A forged marker can cause at most one redirect to the refresh endpoint; it cannot authenticate because the actual `cra_rt` remains HttpOnly, path-scoped, and verified by Supabase. The refresh endpoint already clears all session cookies on failure.

- [ ] **Step 5: Use the pure decision in middleware**

```ts
const SESSION_MARKER_COOKIE = "cra_session";

export function shouldAttemptRefresh(
  isProtected: boolean,
  state: TokenState,
  hasSessionMarker: boolean,
): boolean {
  return (
    isProtected &&
    (state === "expired" || (state === "absent" && hasSessionMarker))
  );
}
```

Replace the first two protected-route branches with:

```ts
const hasSessionMarker = request.cookies.has(SESSION_MARKER_COOKIE);
if (shouldAttemptRefresh(isProtected, state, hasSessionMarker)) {
  return NextResponse.redirect(createRefreshTarget(request));
}

if (isProtected && state === "absent") {
  const url = request.nextUrl.clone();
  url.pathname = "/sign-in";
  url.search = "";
  url.searchParams.set("returnUrl", `${pathname}${search}`);
  return NextResponse.redirect(url);
}
```

Do not allow the marker to alter the `invalid` branch, auth/MFA state, authorization, or any API request.

- [ ] **Step 6: Verify cookie paths and routing**

Run: `pnpm --filter api run test -- cookies.util && pnpm --filter web run test -- middleware auth-actions`

Expected: PASS. Specifically assert `REFRESH_COOKIE_PATH === "/api/v1/auth/refresh"` and `cra_rt` is never present at `/`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/auth/cookies.util.ts apps/api/src/auth/cookies.util.spec.ts apps/web/middleware.ts apps/web/middleware.spec.ts
git commit -m "fix: preserve refresh session routing"
```

### Task 4: Run the Regression and Security Gate

**Files:**

- No source files unless a failing test identifies a regression.

**Interfaces:**

- Consumes: all three hotfix commits.
- Produces: recorded green verification before architecture refactoring starts.

- [ ] **Step 1: Run focused security tests**

Run:

```sh
pnpm --filter api run test -- permissions.service permission-coverage public-routes auth.service.lockout cookies.util supabase-auth.guard
pnpm --filter web run test -- middleware auth-actions menu-nav-parity handlers
pnpm --filter contracts run test -- permissions menu
```

Expected: PASS.

- [ ] **Step 2: Run the live database and auth tests**

Run:

```sh
pnpm --filter infrastructure run db:lint
pnpm --filter infrastructure run test
pnpm --filter api run test:e2e
```

Expected: PASS with every RLS/schema invariant and auth-flow assertion.

- [ ] **Step 3: Run repository verification**

Run: `pnpm lint && pnpm check-types && pnpm test && pnpm build`

Expected: PASS. The Next.js middleware deprecation warning may remain; it is pre-existing and is not a reason to mix a middleware-to-proxy migration into these fixes.

- [ ] **Step 4: Review the final diff**

Run: `git diff --check && git diff --stat && git status --short`

Verify:

- no new secret values;
- no widened refresh-cookie path;
- no changed routes, auth-action signatures, response shapes, or permission merge order;
- no authorization data error returns a permissive fallback;
- no test-only bypass exists in production code.

No additional commit is needed if the worktree is clean after the three focused commits.
