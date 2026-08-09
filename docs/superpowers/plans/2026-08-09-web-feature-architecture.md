# Web Feature Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Next.js app one typed HTTP adapter and feature-owned query/mutation facades while preserving the current pages, frozen auth actions, mock-first local development, controlled tables, and fail-open navigation behavior.

**Architecture:** React pages/components depend on feature APIs and pure state derivation, not `fetch`. A single HTTP adapter owns same-origin credentials, safe JSON/error parsing, response validation, cancellation, and single-flight refresh for safe reads only; TanStack Query remains the Observer/cache implementation, and feature hooks act as local mediators without introducing a global event bus.

**Tech Stack:** Next.js 16 App Router, React 19, TanStack Query 5, Zod 4, MSW 2, Vitest 3, React Testing Library, TypeScript 5.9.2.

## Global Constraints

- Complete the security hotfix, architecture foundation, and shared-contract task from the API plan first.
- Use Node 20+ and pnpm only.
- Preserve all eight `auth-actions.ts` signatures exactly.
- Preserve `/api/v1`, same-origin cookies, middleware/JWKS behavior, and the refresh marker contract.
- Keep `handlers[0]` as `/api/v1/*` passthrough and keep the four dashboard mocks outside that prefix.
- Preserve the MSW readiness gate before any query executes.
- Preserve fail-open menu rendering during loading/error; API authorization remains authoritative.
- Never automatically replay POST, PATCH, PUT, or DELETE after refresh.
- Use shared Zod contracts for real API responses and feature-local schemas for demo-only mock resources.
- Keep `@repo/ui` presentation-only and import it through subpaths.
- Use semantic classes composed with `cn()`.
- Write tests first and reach at least 80% coverage for every new/refactored module.

---

## File Structure

```text
apps/web/app/
  _lib/http/
    api-client.ts               # only application fetch implementation
    authenticated-request.ts    # safe-read refresh proxy
  _features/
    session/                    # session APIs, query keys, pure state
    account/                    # profile mutation adapter
    members/                    # member query/mutation adapter
    roles/                      # roles and override adapter
    invitations/               # accept/create/revoke adapter
    security/                   # MFA adapter
  architecture/
    fetch-boundaries.spec.ts    # prevents fetch from spreading again
```

Do not create generic repositories in the browser. Feature APIs are thin adapters around HTTP and schemas; TanStack Query owns remote state.

### Task 1: Build One Typed HTTP Adapter

**Files:**

- Create: `apps/web/app/_lib/http/api-client.ts`
- Create: `apps/web/app/_lib/http/api-client.spec.ts`
- Create: `apps/web/app/_lib/http/authenticated-request.ts`
- Create: `apps/web/app/_lib/http/authenticated-request.spec.ts`
- Modify: `apps/web/app/(auth)/_components/auth-actions.ts:1-166`
- Modify: `apps/web/app/(auth)/_components/auth-actions.spec.ts:1-95`

**Interfaces:**

- Produces: `requestJson<T>(options: RequestJsonOptions<T>): Promise<T>`.
- Produces: `authenticatedRequestJson<T>(options): Promise<T>`, which retries one failed GET after one shared refresh request.
- Preserves: `AuthResult` and all exported auth-action signatures.

- [ ] **Step 1: Write failing response/error parsing tests**

```ts
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

import { ApiClientError, requestJson } from "./api-client";

const successSchema = z.object({ ok: z.literal(true) });

describe("requestJson", () => {
  it("validates a successful response", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(
      requestJson({ path: "/api/v1/test", schema: successSchema, fetcher }),
    ).resolves.toEqual({ ok: true });
  });

  it("rejects invalid success payloads", async () => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ ok: "yes" }), { status: 200 }),
    );
    await expect(
      requestJson({ path: "/api/v1/test", schema: successSchema, fetcher }),
    ).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("maps an API error body without treating HTML as JSON", async () => {
    const jsonFailure = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            statusCode: 403,
            message: "Forbidden",
            code: "forbidden",
          }),
          {
            status: 403,
          },
        ),
    );
    await expect(
      requestJson({
        path: "/api/v1/test",
        schema: successSchema,
        fetcher: jsonFailure,
      }),
    ).rejects.toMatchObject({
      kind: "api",
      status: 403,
      code: "forbidden",
      message: "Forbidden",
    });

    const htmlFailure = vi.fn(
      async () => new Response("<html>proxy failure</html>", { status: 502 }),
    );
    await expect(
      requestJson({
        path: "/api/v1/test",
        schema: successSchema,
        fetcher: htmlFailure,
      }),
    ).rejects.toBeInstanceOf(ApiClientError);
  });
});
```

Add tests for 204 success with `z.void()`, empty error body, network rejection, AbortError preservation, field errors, credentials/cache defaults, body serialization, custom signal, and a path that does not begin with `/`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web run test -- api-client`

Expected: FAIL because the HTTP adapter does not exist.

- [ ] **Step 3: Implement strict path and response handling**

```ts
import { apiErrorSchema } from "@repo/contracts/http";
import type { z } from "zod";

export class ApiClientError extends Error {
  constructor(
    readonly kind: "api" | "network" | "invalid_response",
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly fieldErrors?: Readonly<Record<string, string>>,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export interface RequestJsonOptions<T> {
  readonly path: `/${string}`;
  readonly schema: z.ZodType<T>;
  readonly method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  readonly body?: unknown;
  readonly signal?: AbortSignal;
  readonly fetcher?: typeof fetch;
}

export async function requestJson<T>({
  path,
  schema,
  method = "GET",
  body,
  signal,
  fetcher = fetch,
}: RequestJsonOptions<T>): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal,
      headers:
        body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    throw new ApiClientError("network", "We could not reach the server.");
  }

  const text = await response.text();
  let payload: unknown;
  try {
    payload = text === "" ? undefined : JSON.parse(text);
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(payload);
    throw new ApiClientError(
      "api",
      parsed.success
        ? parsed.data.message
        : "Something went wrong. Please try again.",
      response.status,
      parsed.success ? parsed.data.code : undefined,
      parsed.success ? parsed.data.fieldErrors : undefined,
    );
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_response",
      "The server returned an unexpected response.",
      response.status,
    );
  }
  return parsed.data;
}
```

If `z.void()` does not accept `undefined` under the installed Zod version, use `z.undefined()` and pin that behavior with the 204 test.

- [ ] **Step 4: Write the failing single-flight safe-read tests**

```ts
it("shares one refresh across concurrent GET requests and retries each once", async () => {
  let getCalls = 0;
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path === "/api/v1/auth/refresh") {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    getCalls += 1;
    return getCalls <= 2
      ? new Response(JSON.stringify({ statusCode: 401, message: "Expired" }), {
          status: 401,
        })
      : new Response(JSON.stringify({ ok: true }), { status: 200 });
  });

  await expect(
    Promise.all([
      authenticatedRequestJson({
        path: "/api/v1/a",
        schema: z.object({ ok: z.literal(true) }),
        fetcher,
      }),
      authenticatedRequestJson({
        path: "/api/v1/b",
        schema: z.object({ ok: z.literal(true) }),
        fetcher,
      }),
    ]),
  ).resolves.toEqual([{ ok: true }, { ok: true }]);
  expect(
    fetcher.mock.calls.filter(([input]) =>
      String(input).endsWith("/api/v1/auth/refresh"),
    ),
  ).toHaveLength(1);
  expect(getCalls).toBe(4);
});

it.each(["POST", "PATCH", "PUT", "DELETE"] as const)(
  "never replays %s after a 401",
  async (method) => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ statusCode: 401, message: "Expired" }), {
          status: 401,
        }),
    );

    await expect(
      authenticatedRequestJson({
        path: "/api/v1/mutation",
        method,
        body: { value: 1 },
        schema: z.object({ ok: z.literal(true) }),
        fetcher,
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);
```

- [ ] **Step 5: Implement a single-flight refresh proxy for GET only**

```ts
let refreshInFlight: Promise<void> | null = null;

async function refresh(fetcher: typeof fetch): Promise<void> {
  refreshInFlight ??= requestJson({
    path: "/api/v1/auth/refresh",
    method: "POST",
    schema: z.object({ ok: z.literal(true) }),
    fetcher,
  })
    .then(() => undefined)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}
```

`authenticatedRequestJson` calls `requestJson`; on an `ApiClientError` with status 401 and method GET, it awaits `refresh` and retries the GET once. It never retries an AbortError, 403, 429, 5xx, invalid response, or mutation. Export a test-only reset function only if Vitest module isolation cannot clear the in-flight value; do not expose it from a public barrel.

- [ ] **Step 6: Preserve auth actions as a facade**

Replace only the private `post` implementation. Map `ApiClientError` into the existing `AuthResult`:

```ts
async function post(path: string, body?: unknown): Promise<AuthResult> {
  try {
    const data = await requestJson({
      path: `/api/v1${path}`,
      method: "POST",
      body,
      schema: z
        .object({
          next: z
            .enum(["dashboard", "two-factor", "verify", "sign-in"])
            .optional(),
        })
        .passthrough(),
    });
    return { ok: true, next: data.next };
  } catch (error) {
    return error instanceof ApiClientError
      ? {
          ok: false,
          message: error.message,
          ...(error.fieldErrors
            ? { fieldErrors: { ...error.fieldErrors } }
            : {}),
        }
      : { ok: false, message: "Something went wrong. Please try again." };
  }
}
```

The eight exported functions and `lockedSession` remain untouched; the existing compile-time signature tests must pass.

- [ ] **Step 7: Verify and commit**

Run:

```sh
pnpm --filter web run test -- api-client authenticated-request auth-actions middleware
pnpm --filter web run lint
pnpm --filter web run check-types
```

Expected: PASS.

```bash
git add apps/web/app/_lib/http apps/web/app/'(auth)'/_components/auth-actions.ts apps/web/app/'(auth)'/_components/auth-actions.spec.ts
git commit -m "refactor: centralize browser HTTP access"
```

### Task 2: Turn Session State into a Tested Feature Facade

**Files:**

- Create: `apps/web/app/_features/session/session.api.ts`
- Create: `apps/web/app/_features/session/session.keys.ts`
- Create: `apps/web/app/_features/session/session-state.ts`
- Create: `apps/web/app/_features/session/session-state.spec.ts`
- Create: `apps/web/app/_features/session/session.queries.ts`
- Create: `apps/web/app/_features/session/session.queries.spec.tsx`
- Modify: `apps/web/app/_providers/session-provider.tsx:1-176`
- Modify: `apps/web/vitest.config.ts:1-8`
- Modify: `apps/web/package.json:30-42`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Produces: `sessionApi`, frozen query keys, `deriveSessionState`, and session query option factories.
- Preserves: `SessionProvider`, `useSession`, `useHasPermission`, `useCanViewMenu`, and `Can` public interfaces.

- [ ] **Step 1: Add test dependencies with pnpm**

Run: `pnpm --filter web add -D @testing-library/react @testing-library/user-event jsdom @vitest/coverage-v8`

Expected: only `apps/web/package.json` and `pnpm-lock.yaml` dependency changes.

- [ ] **Step 2: Write failing pure state tests**

```ts
describe("deriveSessionState", () => {
  it("keeps menu unknown while loading or failed", () => {
    expect(
      deriveSessionState({
        enabled: true,
        session: null,
        permissions: null,
        menu: null,
        loading: true,
        error: false,
      }),
    ).toMatchObject({ menu: null, isLoading: true });
    expect(
      deriveSessionState({
        enabled: true,
        session: null,
        permissions: null,
        menu: null,
        loading: false,
        error: true,
      }),
    ).toMatchObject({ menu: null, isError: true });
  });

  it("does not collapse an explicitly empty known menu into unknown", () => {
    expect(
      deriveSessionState({
        enabled: true,
        session: null,
        permissions: { role: "viewer", permissions: {} },
        menu: [],
        loading: false,
        error: false,
      }).menu,
    ).toEqual([]);
  });

  it("disables all remote loading/error state while mocks are enabled", () => {
    expect(
      deriveSessionState({
        enabled: false,
        session: null,
        permissions: null,
        menu: null,
        loading: true,
        error: true,
      }),
    ).toMatchObject({ isLoading: false, isError: false, menu: null });
  });
});
```

- [ ] **Step 3: Implement typed APIs, keys, and pure derivation**

Use these stable keys:

```ts
export const sessionKeys = Object.freeze({
  all: ["session"] as const,
  identity: ["session", "identity"] as const,
  permissions: ["session", "permissions"] as const,
  menu: ["session", "permissions", "menu"] as const,
});
```

`sessionApi` validates `/auth/session`, `/permissions/effective`, and `/permissions/menu` with shared schemas. `deriveSessionState` returns new immutable values and preserves the distinction between `null` (unknown) and `[]` (known empty).

- [ ] **Step 4: Write query/provider behavior tests**

Using a fresh `QueryClient` per test, assert:

- no query runs before `useMocksReady()` is true;
- mocks-on mode issues zero session requests;
- all three live requests start without serial dependency;
- failure in one query sets `isError` but leaves `menu === null`;
- an empty server menu remains empty;
- `useCanViewMenu` uses the shared contract while unknown and the server set when known;
- cache/query clients are not shared across server renders.

Mark the component test file with `// @vitest-environment jsdom` and add a cleanup hook.

- [ ] **Step 5: Refactor the existing provider into a facade**

`SessionProvider` calls the query option factories, passes results into `deriveSessionState`, and retains the same context/hooks/components. Remove its local `getJson`, duplicate query keys, and response shapes. Do not change loading, retry, or stale-time semantics unless a characterization test is updated first with an explicit product decision.

- [ ] **Step 6: Verify and commit**

Run:

```sh
pnpm --filter web run test -- session
pnpm --filter web run check-types
pnpm --filter web run lint
```

Expected: PASS with at least 80% feature coverage.

```bash
git add apps/web/app/_features/session apps/web/app/_providers/session-provider.tsx apps/web/vitest.config.ts apps/web/package.json pnpm-lock.yaml
git commit -m "refactor: isolate session queries"
```

### Task 3: Move Page Requests Behind Feature APIs

**Files:**

- Create: `apps/web/app/_features/account/account.api.ts`
- Create: `apps/web/app/_features/account/account.api.spec.ts`
- Create: `apps/web/app/_features/members/members.api.ts`
- Create: `apps/web/app/_features/members/members.api.spec.ts`
- Create: `apps/web/app/_features/roles/roles.api.ts`
- Create: `apps/web/app/_features/roles/roles.api.spec.ts`
- Create: `apps/web/app/_features/invitations/invitations.api.ts`
- Create: `apps/web/app/_features/invitations/invitations.api.spec.ts`
- Create: `apps/web/app/_features/security/security.api.ts`
- Create: `apps/web/app/_features/security/security.api.spec.ts`
- Modify: `apps/web/app/dashboard/account/page.tsx:49-63`
- Create: `apps/web/app/dashboard/account/page.spec.tsx`
- Modify: `apps/web/app/dashboard/management/page.tsx:68-79`
- Create: `apps/web/app/dashboard/management/page.spec.tsx`
- Modify: `apps/web/app/dashboard/permissions/page.tsx:51-87`
- Create: `apps/web/app/dashboard/permissions/page.spec.tsx`
- Modify: `apps/web/app/dashboard/roles/page.tsx:46-62`
- Create: `apps/web/app/dashboard/roles/page.spec.tsx`
- Modify: `apps/web/app/dashboard/security/page.tsx:37-105`
- Create: `apps/web/app/dashboard/security/page.spec.tsx`
- Modify: `apps/web/app/(auth)/accept-invitation/page.tsx:54-72`
- Create: `apps/web/app/(auth)/accept-invitation/page.spec.tsx`
- Create: `apps/web/app/architecture/fetch-boundaries.spec.ts`

**Interfaces:**

- Produces: feature-specific functions with shared request/response schemas and stable query keys.
- Preserves: current page render, loading, error, and mutation behavior.

- [ ] **Step 1: Pin every feature request in adapter tests**

The exact API surface is:

```ts
accountApi.updateProfile(input, signal?)
membersApi.changeRole(userId, role, signal?)
rolesApi.list(signal?)
rolesApi.getOverrides(signal?)
rolesApi.setOverride(baseRole, permissions, signal?)
invitationsApi.accept(token, signal?)
securityApi.listFactors(signal?)
securityApi.enroll(signal?)
securityApi.confirmEnrollment(factorId, code, signal?)
```

For each function, test method, exact `/api/v1` path, JSON body, response schema, error propagation, and AbortSignal. Mutation tests assert a 401 is not retried.

- [ ] **Step 2: Run adapter tests to verify they fail**

Run: `pnpm --filter web run test -- account.api members.api roles.api invitations.api security.api`

Expected: FAIL because feature APIs do not exist.

- [ ] **Step 3: Implement feature APIs with the central client**

Representative implementation:

```ts
export const invitationsApi = Object.freeze({
  accept(token: string, signal?: AbortSignal) {
    return requestJson({
      path: "/api/v1/invitations/accept",
      method: "POST",
      body: { token },
      signal,
      schema: acceptInvitationResponseSchema,
    });
  },
});
```

Use `authenticatedRequestJson` only for GETs. Use `requestJson` for every mutation so no action is replayed after a 401. Use shared schemas from `@repo/contracts` and keep UI-only form state out of these modules.

- [ ] **Step 4: Migrate one page per commit-ready test cycle**

For each page:

1. add/adjust its behavior test;
2. replace only its inline `fetch` with the feature function;
3. run its focused test, type check, and lint;
4. preserve its visible copy/loading/error flow;
5. inspect the diff before moving to the next page.

Do not redesign the pages or introduce a global mediator while changing their transport seam.

- [ ] **Step 5: Add a mechanical fetch-boundary test**

Use the TypeScript parser so comments and strings do not create false positives:

```ts
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import ts from "typescript";
import { expect, it } from "vitest";

const ALLOWED = new Set(["app/_lib/http/api-client.ts"]);

function hasDirectFetch(fileName: string, source: string): boolean {
  const root = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  let found = false;
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "fetch"
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(root);
  return found;
}

it("keeps direct fetch calls inside the central transport", async () => {
  const appRoot = join(process.cwd(), "app");
  const entries = (await readdir(appRoot, { recursive: true })).filter(
    (entry) => /\.tsx?$/.test(entry) && !/\.(?:spec|test)\.tsx?$/.test(entry),
  );
  const violations = (
    await Promise.all(
      entries.map(async (entry) => {
        const relative = `app/${entry.replaceAll("\\", "/")}`;
        const source = await readFile(join(appRoot, entry), "utf8");
        return hasDirectFetch(relative, source) && !ALLOWED.has(relative)
          ? [relative]
          : [];
      }),
    )
  ).flat();

  expect(violations).toEqual([]);
});
```

This prevents direct transport calls from returning to pages/providers after the migration.

- [ ] **Step 6: Verify and commit**

Run:

```sh
pnpm --filter web run test
pnpm --filter web run lint
pnpm --filter web run check-types
pnpm --filter web run build
```

Expected: PASS.

```bash
git add apps/web/app/_features apps/web/app/architecture/fetch-boundaries.spec.ts apps/web/app/dashboard apps/web/app/'(auth)'/accept-invitation
git commit -m "refactor: isolate web feature APIs"
```

### Task 4: Unify Paged Contracts and Validate Mock Table Data

**Files:**

- Create: `apps/web/mocks/data/table-schemas.ts`
- Create: `apps/web/mocks/data/table-schemas.spec.ts`
- Modify: `apps/web/mocks/handlers.ts:1-168`
- Modify: `apps/web/app/dashboard/_lib/use-table-query.ts:1-119`
- Create: `apps/web/app/dashboard/_lib/use-table-query.spec.tsx`
- Modify: `apps/web/app/dashboard/tables/_components/table-page.tsx:13-91`
- Modify: `apps/web/app/dashboard/tables/basic/page.tsx`
- Modify: `apps/web/app/dashboard/tables/bordered/page.tsx`
- Modify: `apps/web/app/dashboard/tables/splitted/page.tsx`
- Modify: `apps/web/app/dashboard/tables/striped/page.tsx`

**Interfaces:**

- Consumes: `Paged<T>` from `@repo/contracts/pagination`.
- Produces: `pagedSchema(rowSchema)`, validated mock/table responses, and a required row schema per `TablePage`.

- [ ] **Step 1: Write failing schema and hook behavior tests**

Test every committed mock row against its schema. Test `pagedSchema` rejects negative totals, page zero, pageCount zero, pageSize over 100, and malformed rows. Hook tests cover page reset on search/sort/page-size, keep-previous-data behavior, abort propagation, endpoint/query-key composition, failure display, and server-clamped page reconciliation.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web run test -- table-schemas use-table-query`

Expected: FAIL because schemas/tests do not exist and `Paged<T>` is duplicated.

- [ ] **Step 3: Use the shared schema factory and implement row schemas**

```ts
import { pagedSchema } from "@repo/contracts/pagination";
import { z } from "zod";
```

Define strict Product, Order, Customer, and Coin schemas from the exact fields and enums in `mocks/data/tables.ts`; infer their types from schemas instead of maintaining separate interfaces. Use the imported `pagedSchema` in tests and response parsing.

- [ ] **Step 4: Use the shared pagination type everywhere**

Remove local `Paged<T>` declarations from `handlers.ts` and `use-table-query.ts`. Import `Paged` from `@repo/contracts/pagination`. Add `rowSchema` to `UseTableQueryOptions<T>` and parse the response through `pagedSchema(rowSchema)` using the central safe-read client.

Update `TablePageProps<T>` to require `rowSchema: z.ZodType<T>`, and pass the matching schema from all four pages. Preserve endpoints and UI variants.

- [ ] **Step 5: Reconcile a server-clamped page**

When a response returns `data.page !== requested page`, update page state only if different and do not create a refetch loop. Add a test where page 6 is filtered to one page and assert the final state is page 1 with one follow-up render at most.

- [ ] **Step 6: Verify mock/API parity and commit**

Run:

```sh
pnpm --filter contracts run test -- pagination
pnpm --filter web run test -- table handlers
pnpm --filter web run lint
pnpm --filter web run check-types
pnpm --filter web run build
```

Expected: PASS; `handlers[0]` remains passthrough and all four mock endpoints remain present.

```bash
git add apps/web/mocks apps/web/app/dashboard
git commit -m "refactor: validate paged table data"
```

### Task 5: Make Middleware Routing a Pure Tested State Decision

**Files:**

- Create: `apps/web/app/_features/session/route-session-state.ts`
- Create: `apps/web/app/_features/session/route-session-state.spec.ts`
- Modify: `apps/web/middleware.ts:25-255`
- Modify: `apps/web/middleware.spec.ts:1-18`

**Interfaces:**

- Produces: `decideRoute(input): RouteDecision`, a pure state/strategy function.
- Preserves: middleware token verification, refresh target, protected/auth page lists, pending/MFA routing, and production mocks override.

- [ ] **Step 1: Write the full transition table before extraction**

Cover the Cartesian cases that matter:

```ts
it.each([
  [
    {
      protected: true,
      token: "valid",
      marker: false,
      pending: false,
      mfa: false,
    },
    { kind: "next" },
  ],
  [
    {
      protected: true,
      token: "expired",
      marker: false,
      pending: false,
      mfa: false,
    },
    { kind: "refresh" },
  ],
  [
    {
      protected: true,
      token: "absent",
      marker: true,
      pending: false,
      mfa: false,
    },
    { kind: "refresh" },
  ],
  [
    {
      protected: true,
      token: "absent",
      marker: false,
      pending: false,
      mfa: false,
    },
    { kind: "sign_in" },
  ],
  [
    {
      protected: true,
      token: "invalid",
      marker: true,
      pending: false,
      mfa: false,
    },
    { kind: "clear_and_sign_in" },
  ],
  [
    {
      protected: true,
      token: "valid",
      marker: true,
      pending: true,
      mfa: false,
    },
    { kind: "verify_email" },
  ],
  [
    {
      protected: true,
      token: "valid",
      marker: true,
      pending: false,
      mfa: true,
    },
    { kind: "verify_mfa" },
  ],
] as const)("decides route state", (input, expected) => {
  expect(
    decideRoute({ ...input, authPage: false, flowException: false }),
  ).toEqual(expected);
});
```

Add auth-page, flow-exception, query-string preservation, open-redirect rejection, mocks-on development, production mocks override, JWKS outage fallback, and absent-secret HS256 cases.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web run test -- route-session-state middleware`

Expected: FAIL because `decideRoute` does not exist.

- [ ] **Step 3: Implement a discriminated decision union**

```ts
export type RouteDecision =
  | Readonly<{ kind: "next" }>
  | Readonly<{ kind: "refresh" }>
  | Readonly<{ kind: "sign_in" }>
  | Readonly<{ kind: "clear_and_sign_in" }>
  | Readonly<{ kind: "verify_email" }>
  | Readonly<{ kind: "verify_mfa" }>
  | Readonly<{ kind: "dashboard" }>;
```

`decideRoute` contains only precedence rules and no Next.js objects. Middleware still owns token inspection, cookie reads, URL construction, cookie deletion, and `NextResponse` creation. This is State/Strategy applied to a real transition problem, not a class hierarchy.

- [ ] **Step 4: Replace conditionals one branch at a time**

After each decision variant is wired, run `middleware` and `route-session-state` tests. Preserve the existing precedence: refresh/sign-in/invalid token, then pending email, then MFA, then authenticated auth-page redirect.

- [ ] **Step 5: Verify and commit**

Run:

```sh
pnpm --filter web run test -- route-session-state middleware auth-actions session
pnpm --filter web run lint
pnpm --filter web run check-types
pnpm --filter web run build
```

Expected: PASS.

```bash
git add apps/web/app/_features/session/route-session-state.ts apps/web/app/_features/session/route-session-state.spec.ts apps/web/middleware.ts apps/web/middleware.spec.ts
git commit -m "refactor: isolate session route decisions"
```
