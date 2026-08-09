# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

pnpm only — `devEngines.packageManager` has `onFail: "error"`, so npm and yarn are rejected.

```sh
pnpm dev                    # web (3000) + docs (3001) + api (3333)
pnpm build / lint / check-types / test
pnpm format                 # prettier; the repo uses DOUBLE quotes, Nest files included
pnpm exec turbo dev --filter=web
```

`lint` runs with `--max-warnings 0` everywhere, so a warning fails the build.

### Local database (requires Docker)

`infrastructure` is deliberately **outside** Turborepo — its commands mutate containers and must never be cached.

```sh
pnpm --filter infrastructure run db:start    # first run pulls images, several minutes
pnpm --filter infrastructure run db:reset    # re-apply all migrations + seed
pnpm --filter infrastructure run db:new <name>
pnpm --filter infrastructure run db:lint
pnpm --filter infrastructure run db:types    # regenerate types; ALSO copies into apps/api
pnpm --filter infrastructure run test        # RLS + schema invariant suite (35 checks)
pnpm --filter infrastructure exec supabase db diff   # must report no drift
```

Local ports: API 54321 · DB 54322 · Studio 54323 · Mailpit UI 54324 · Mailpit **SMTP 54325**.

### Tests

```sh
pnpm --filter api run test                       # jest unit
pnpm --filter api run test -- cookies.util       # single suite by name pattern
pnpm --filter api run test:e2e                   # needs Supabase running
pnpm --filter @repo/contracts run test           # vitest, pure, no DB
pnpm --filter web run test -- menu-nav-parity
./apps/api/test/auth-flow.e2e.sh                 # 26-check live flow; run from repo root
```

`auth-flow.e2e.sh` needs Supabase **and** a built API running (`node apps/api/dist/main.js`). It exercises the real stack — Postgres, GoTrue, Mailpit — because the bugs that matter here (an unexposed SMTP port, a cookie path that stops the browser sending the refresh token, a trigger that did not fire) are invisible to a mocked suite.

### Running the app against the real backend

`pnpm dev` alone runs **mocks-on**, with no API and no database. To use the real one:

```sh
NEXT_PUBLIC_ENABLE_MOCKS=false \
SUPABASE_JWT_SECRET=<from db:status> \
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
NEXT_PUBLIC_API_ORIGIN=http://localhost:3333 \
pnpm --filter web run dev
```

Seeded accounts: `owner|admin|member|viewer@cra.test` / `Password123`.

## Architecture

Turborepo + pnpm. `apps/`: `web` (Next 16 App Router), `api` (NestJS 11), `docs` (Docusaurus), `infrastructure` (Supabase CLI). `packages/`: `contracts`, `ui`, `design-system`, `eslint-config`, `typescript-config`.

### The backend owns the session

`apps/api` calls Supabase Auth and sets **HttpOnly cookies**; `apps/web/middleware.ts` verifies the JWT **locally** (no network call per navigation) and bounces expired navigations to `GET /api/v1/auth/refresh`, which rotates the pair and 302s back. The browser never sees a token in JS.

Cookies (`apps/api/src/auth/cookies.util.ts` is the wire contract between the two apps):
`cra_at` 1 h Path=`/` · `cra_rt` 7 d Path=`/api/v1/auth/refresh` — **the narrow path is the CSRF control** · `cra_pending` · `cra_mfa` · `cra_org` (HMAC-signed).

**Supabase issues ES256 tokens, not HS256.** Both `TokenVerifierService` and `middleware.ts` resolve the algorithm per token and fall back to JWKS. An HS256-only verifier silently rejects every real session.

### `/api/v1` is load-bearing, not decoration

`apps/web/mocks/handlers.ts` owns `/api/products|orders|customers|coins`. A proxy at `/api/:path*` would collide, and the failure differs between the browser service worker, `msw/node` in `instrumentation.ts`, and a production build. `next.config.js` proxies `/api/v1/*` only, and `handlers.ts` has an explicit `passthrough()` **first in the array** (MSW matches in order).

`REFRESH_COOKIE_PATH` is derived from the prefix — if they drift, sessions die silently one hour after sign-in.

### `packages/contracts` — the shared source of truth

A **built** package (`tsc` → `dist`), unlike `@repo/ui` which ships raw TS. Nest does not transpile a dependency's TypeScript, so importing source fails at runtime after a build reporting zero errors.

Holds the RBAC model used **by both tiers**: 4 base roles, 59 permission keys generated from `PERMISSION_MATRIX`, 31 menu keys, Zod auth schemas, and `Paged<T>`. `apps/web` computes the same answer `apps/api` enforces — a second implementation would drift into a UI offering buttons the server refuses.

Permission resolution order (`resolveEffectivePermissions`), and the order carries the security:
1. base-role defaults → 2. custom roles, **additive only** → 3. implications → 4. org overrides, **hard merge, last word**.

Three deviations from the reference project, each closing a live escalation hole and each pinned by a regression test in `permissions.spec.ts`: custom roles may only add; a custom role's `base_role` is a **label, not a grant**; stale `jsonb` keys are sanitized away.

### Authorization

`SupabaseAuthGuard` is a global `APP_GUARD` — **deny by default**; `@Public()` is the opt-out. `PermissionsGuard` is also global but no-ops without metadata.

Two specs enforce this mechanically and **fail in both directions** so allowlists cannot rot:
- `auth/public-routes.spec.ts` — every `@Public()` route must be on a reasoned allowlist, and every allowlist entry must match a real route.
- `permissions/permission-coverage.spec.ts` — every authenticated route carries `@RequirePermissions`, `@RequireRole`, or `@SelfScoped("reason")`.

**RLS is defence-in-depth, not the boundary.** The API uses `service_role` and bypasses RLS, so a missing `.eq("organization_id", …)` is a cross-tenant leak no policy catches. Every service method therefore takes `orgId` as its **first** argument.

### Database conventions

- `REVOKE … FROM PUBLIC` **first**, then `anon`/`authenticated` — revoking from `anon` alone is a silent no-op when the privilege is held via PUBLIC. This also strips `service_role`, so RPC functions need explicit `GRANT EXECUTE` (see `20260809091700_rpc_grants.sql`).
- Every FK points at `public.users.id`, **never** `auth.users.id`. `RequestUser` carries both as `id` and `authUserId`; GoTrue's admin API wants the latter, everything else the former. Confusing them returns "User not found" while reporting success.
- Every function pins `search_path = public, pg_temp`. RLS uses `SECURITY DEFINER` helpers (`user_is_member_of`, …) to avoid 42P17 recursion. `ENABLE` but never `FORCE` RLS.
- Email is `text` + `UNIQUE INDEX ON (lower(email))`, never `citext` — citext's `=` lives in `extensions`, unreachable from the pinned search_path.
- `session_epoch_at` revokes live tokens (password reset, sign-out-everywhere, deactivation). `SESSION_EPOCH_SKEW_SECONDS` defaults to **0**: any positive value is a window in which a revoked token still works.
- Seeding `auth.users` directly requires `confirmation_token` etc. as **empty strings**, not NULL — GoTrue scans them into a Go `string` and NULL is a 500.

### Frozen contract

`apps/web/app/(auth)/_components/auth-actions.ts` is the seam for ten finished auth screens. Its **8 signatures are frozen**, asserted by a type-level test. Three carry no identity at all — `verifyCode({code})`, `unlock({password})`, `resendCode()` with no arguments — which is why the pending user comes from a signed `cra_pending` cookie and why email verification is ours (`auth_email_verifications`) rather than GoTrue's. Do not "simplify" by passing an email from the client.

Related: `nav-config.tsx` and `@repo/contracts/menu` must stay identical — `menu-nav-parity.spec.ts` checks both directions.

### Failure posture

Sidebar gating **fails open** (shows everything not explicitly gated while loading or on error). Hiding is not a security control; the API and middleware enforce. Failing closed empties the rail on a transient blip and looks broken.

Mail failures never fail the request that triggered them. Audit writes are `void`-called and never throw. But RPC errors **are** checked — an unchecked one hid a completely inert account-lockout for a while.

## Design system

`@repo/design-system` defines every semantic colour once via CSS `light-dark()`, which is why there is almost no `dark:` in the codebase. Use token classes (`bg-canvas`, `text-fg-muted`, `text-subhead-regular`), never raw Tailwind colours or `text-sm`. `cn()` from `@repo/ui/cn` registers the custom font-size and gradient namespaces with tailwind-merge — without it `text-h3` is treated as a colour and silently dropped.

`@repo/ui` exports per-subpath (`@repo/ui/button`), not through the root barrel (which has known gaps).

## Notes

- `apps/docs` content is still the stock Docusaurus tutorial.
- `/dashboard/{messages,email,products,orders,invoices,fleet,routes,calendar,help,files}` intentionally render the `[...slug]` "not designed yet" placeholder.
- OAuth providers are off; `social-buttons.tsx` is presentational, though `handle_new_user` is already OIDC-ready.
- `CRA.pen` (sibling of the repo) is the Pencil design source; most components cite their frame ID in a docblock.

## Commit messages

Run `git config core.hooksPath .githooks` once after cloning to enable the committed `commit-msg` hook. It runs only during commits, requires a short subject (72 characters or fewer), permits standard Git trailers, and rejects em dashes plus AI attribution, provider, model, or tool names. Do not bypass it with `--no-verify`.
