# CRA Sentinel migration — architecture walkthrough and review

Written from the code as it stands in the working tree, verified against a running
local stack (Supabase + Redis + API + worker). Nothing here is derived from the
ADR/BRD documents the code cites — those are not in this repo (see finding 7).

---

## Part 1 — Architecture walkthrough

### What this is

An EU **Cyber Resilience Act** compliance platform merged into the Turborepo
template. You register products, upload SBOMs, get vulnerability findings matched
against advisory feeds, triage them, and the system tracks the CRA reporting
obligations that result — with an audit ledger and evidence store behind it.

### Shape

```
apps/web        Next.js 16    :3000   demo/template screens (MSW) — NOT yet on the real API
apps/docs       Docusaurus    :3001   stock tutorial content
apps/api        NestJS        :3333   the product API  ─┐
  worker.main.ts (no HTTP)            BullMQ consumer  ─┴─ same module graph
apps/infrastructure                   Supabase CLI, 11 SQL migrations
packages/sbom-core                    SBOM parsing/normalisation (4,342 lines)
packages/schemas                      shared contracts + PERMISSIONS + MFA_REQUIRED_PERMISSIONS
packages/api-client                   OpenAPI-generated typed client (committed, drift-checked)
```

### The 16 API modules

| Module | Owns |
| --- | --- |
| `common` | AuthMiddleware, PermissionGuard, ProblemDetailsFilter, ALS tenant context, zod pipe, `@ApiContract` |
| `db` | pg pool, Drizzle schema, `withTenant`, the SEC-014 boot assertion |
| `identity` | JWT verification, principal resolution, permission checks |
| `org` | organisations, onboarding |
| `product` | products and lifecycle transitions |
| `sbom` | releases, SBOM ingest |
| `vuln` | advisory feeds, matching, re-evaluation (largest: 3,130 lines) |
| `triage` | findings, transitions, VEX, false-positive marking |
| `workflow` | CRA obligations, stages, the obligation clock and tick |
| `evidence` | evidence records against obligations |
| `audit` | append-only audit ledger |
| `storage` | object storage (s3 / in-memory) |
| `jobs` | BullMQ queue, catalogue, handlers, per-tenant concurrency |
| `analytics` | dashboard aggregates |
| `integration`, `ai` | stubs (2 files, 5 lines each) |

Cross-module imports must go through each module's `index.ts` barrel. This is
enforced by a **second** ESLint pass (`apps/api/eslint.boundaries.mjs`) rather than
extra rules on the first, because the shared base config loads
`eslint-plugin-only-warn`, which would downgrade the boundary error to a warning
and stop it failing the build.

### Request lifecycle

```
request
  → AuthMiddleware          verify JWT → identity; X-Organisation-Id → principal
                            then runWithContext(ALS) for the rest of the request
  → PermissionGuard         global APP_GUARD; @Public / @RequireAuth / @RequirePermission
                            + MFA aal2 gate
  → Controller              zod-validated body via ZodValidationPipe
  → Service                 withTenant(...) sets the RLS session context
  → Postgres                as cras_app, RLS ENABLED + FORCED
  ⇢ ProblemDetailsFilter    APP_FILTER, RFC 9457 on every error path
```

Two deliberate choices worth knowing:

- **The active organisation comes from the `X-Organisation-Id` header, never a URL
  segment or body** — those are attacker-controlled.
- **Cross-tenant reads 404, not 403.** A 403 would confirm the row exists. The RLS
  policy simply makes the row invisible, and the controller turns "no row" into 404.

### Tenancy model

Three layers, each of which would be sufficient on its own to be *claimed* and
insufficient on its own to be *true*:

1. Every tenant table carries `organisation_id` with RLS **ENABLED and FORCED**.
2. The app connects as **`cras_app`** — a restricted role, not the superuser.
   `cras_feed` (advisory mirror writes) and `cras_scheduler` (obligation ticks) are
   separate least-privilege roles.
3. `assertRlsBootSafety()` (`apps/api/src/db/sec014.ts`) refuses to start if the role
   is superuser/BYPASSRLS, if any `organisation_id` table lacks FORCED RLS, or if a
   context-free read returns rows.

**I verified layer 3 actually fires**: pointing `DATABASE_URL` at the `postgres`
superuser makes the API exit 1 with
`SEC-014 FAILURE: app DB role "postgres" has superuser=false bypassrls=true`.

### Authorisation

`PERMISSIONS` and `MFA_REQUIRED_PERMISSIONS` live in `@repo/schemas` so the API and
the web app cannot drift. `vex:approve` and `report:submit` require **aal2** — which
is why the migration turned on `[auth.mfa.totp] enroll_enabled/verify_enabled` in
`config.toml`. With enrolment off those two permissions would be permanently
unusable rather than merely gated.

### Data model, by migration

| Migration | Adds |
| --- | --- |
| `step1_tenancy_rls` | `organisation`, `user_account`, `org_member`, `product`, `role`, `role_permission`; `cras_app`; RLS foundation |
| `step2_audit_ledger` | append-only audit ledger |
| `step3_roles_seed` | role/permission seed data |
| `step4_user_self_read` | a user may read their own memberships pre-org-context |
| `step5_sbom` | releases, components, SBOM tables |
| `step6_findings` | `advisory`, `advisory_affected`, `advisory_cpe` (read-only to `cras_app`), `finding` |
| `step8_obligations` | CRA obligations and stages |
| `step8b_tick_evidence` | obligation ticks + evidence |
| `step9_feed_mirror` | advisory mirror + `cras_feed` role |
| `step9b_scheduler_role` | `cras_scheduler`, scoped to a `for select` policy |
| `step10_match_feedback` | match feedback for tuning |

### Worker and queue

`worker.main.ts` boots the **same module graph** via `createApplicationContext` — no
HTTP listener at all, so the worker tier has no inbound public surface. It runs the
same SEC-014 assertion, because a worker on a BYPASSRLS role would process every
tenant's jobs against every tenant's data and nothing would fail loudly.

Queue design (`jobs/`): 5 attempts with exponential backoff from 5s, a **stable
`jobId`** so BullMQ drops duplicate enqueues (with handlers *also* individually
idempotent, since queue dedup is best-effort), per-tenant concurrency caps so one
large tenant cannot starve others, and `removeOnFail: false` so failures are
retained rather than vanishing. SIGTERM/SIGINT drain in-flight jobs before exit.

---

## Part 2 — Review findings

Ranked. Everything below was confirmed against the code or the running stack.

### 1. `STORAGE_DRIVER` defaults to the unsafe driver — and the code contradicts its own comment · HIGH

`apps/api/src/storage/storage.module.ts:22-28`

The comment directly above the line argues for fail-closed:

> *"Explicit rather than inferred. Silently falling back to an in-process store
> because an endpoint was missing is how a deployment discovers six months later
> that its evidence was never persisted."*

The next line is `const driver = process.env.STORAGE_DRIVER ?? 'memory';` — which is
precisely the silent fallback the comment warns against.

`InMemoryStorageProvider` is **per-process**. The API and the worker are separate
processes, so evidence written by an upload request is invisible to the worker that
must read it, and nothing survives a restart. `.env.example` states this explicitly.

**Your `.env.local` currently sets `STORAGE_DRIVER=memory`**, so this is live, not
hypothetical. Unit tests pass because they run in one process.

*Fix:* drop the `?? 'memory'` default and require an explicit value, or default to
`s3`. Set `STORAGE_DRIVER=s3` locally.

### 2. Undecorated routes are default-*allow* on permissions · MEDIUM (latent)

`apps/api/src/common/permission.guard.ts:52-58`, `identity/auth.service.ts`

`hasRequiredPermissions(granted, [])` is `[].every(...)` → **`true`**. A controller
method with no `@RequirePermission` still passes the permission check; it only needs
a valid JWT and any org membership.

Every domain route today *is* decorated — I checked all 7 controllers — so this is
latent, not an active hole. But the failure mode of forgetting a decorator is
"quietly readable by any authenticated member of any tenant", which is the wrong
direction for a system whose entire design is otherwise fail-closed.

*Fix:* treat "no permission metadata and not `@Public`/`@RequireAuth`" as a denial.

### 3. `GET /` is permanently 401, and there is no health endpoint · MEDIUM

`apps/api/src/app.controller.ts:10`

The leftover scaffold route has no decorator, and `AppController` is not in
`AuthMiddleware`'s `forRoutes(...)` list — so `req.identity` is never populated and
the global guard rejects it. Confirmed live: `GET http://127.0.0.1:3333/` → `401`.

The route is unreachable by construction. More importantly, a system with a worker,
a database and Redis has **no readiness/liveness endpoint** for a load balancer or
orchestrator to probe.

*Fix:* delete the scaffold controller and add a real `@Public` health check that
reports DB and Redis reachability.

### 4. `correlationId` is missing on errors outside the middleware's route list · LOW

`apps/api/src/common/problem-details.filter.ts:43`

The filter reads `correlationId` from the ALS context, which only exists for the
controllers explicitly listed in `AppModule.configure()`. Any error raised outside
that list returns Problem Details with **no** `correlationId` — confirmed:
`GET /nope` returns `{"type":"about:blank","title":"NotFound","status":404,...}`
with no correlation field, so those failures cannot be tied to a server log line.

### 5. `apps/web` was not migrated · RESOLVED (plumbing) / PARTIAL (screens)

Was: zero dependency on `@repo/api-client` or `@repo/schemas`, `(auth)` screens as
UI-only shells, and none of the `/api/cras/*` + `/api/auth/*` + httpOnly cookie
architecture `.env.example` assumed.

**Now built and verified end to end** (see "Web migration" below). Still stubbed:
`resetPassword`, `verifyCode`, `verifyTwoFactor`, `unlock`, `resendCode` — these
need GoTrue's OTP and MFA-challenge endpoints, which is materially more work than
the password grant and was not in the proving slice.

## Web migration — what was built

| File | Role |
| --- | --- |
| `apps/web/lib/session.ts` | the httpOnly `cra_session` cookie, and the only definition of its shape |
| `apps/web/lib/gotrue.ts` | server-side GoTrue handshake (password grant, signup, refresh, recover, logout) |
| `apps/web/app/api/auth/[action]/route.ts` | `sign-in` · `sign-up` · `sign-out` · `reset` · `refresh` · `organisation` |
| `apps/web/app/api/cras/[...path]/route.ts` | browser → API proxy, attaches bearer + `X-Organisation-Id` |
| `apps/web/app/app/products/page.tsx` | the proving vertical slice, real rows, no mocks |
| `(auth)/_components/auth-actions.ts` | rewired from stubs to `/api/auth/*` |

Two decisions worth recording:

- **The active organisation lives in the session, not in a browser-sent header.**
  `apps/api` resolves the principal from `X-Organisation-Id`, so letting the browser
  set it freely would let any member assert any tenant. The proxy overwrites it from
  the cookie and deletes any caller-supplied value.
- **The proxy refreshes an expired token *before* the call, not by retrying on 401.**
  A retry would have to replay the request body, and a stream can only be read once.

### Verified end to end

```
sign-up → GoTrue → httpOnly cookie (HttpOnly confirmed in the jar)
  → POST /api/cras/organisations           → 201 {"id":"019fc7b7-…"}
  → POST /api/auth/organisation            → session carries the org
  → POST /api/cras/products                → 201 Robotic Arm R1
  → GET  /api/cras/products                → 200 [the row], RLS-scoped
  → GET  /app/products                     → 200
```

Negative paths also confirmed: no session → `401 application/problem+json`
`{"detail":"No session"}`; bad credentials → HTTP **200** with `{"ok":false}` (a form
result, not a transport failure); `/app/products` unauthenticated → `307 → /sign-in`.

Worth noting what the intermediate errors proved: `GET /products` with a valid
session but no org returned *"No active organisation context"* rather than
*"Authentication required"* — meaning the JWT was verified all the way through the
chain. And `POST /organisations` came back as a zod field error, which is the
request reaching the controller and the validation pipe doing its job.

### 6. `.env.example` describes routes that do not exist · LOW

It says the mock backend gates `/demo/**`, but the demo screens live at
`/dashboard/**` and `/showcase`, and (per your decision) are staying there.

### 7. Every design-doc citation is dangling · LOW (info)

The code cites ADR-001/002/005/013, SEC-014/015, BRD §4.4/§6.2/§6.3/§14/§14.1/§19.1/§23,
and FR-IAM-002, FR-TEN-001/002/003/006, FR-JOB-002/003/004/006, FR-MATCH-003,
FR-API-001/002, FR-OBS-001. **No such documents exist in this repo** — `apps/docs` is
still the stock Docusaurus tutorial. The comments are unusually good, so this is a
real loss: the *why* is referenced but unavailable.

### 8. `drizzle.config.ts` references a turbo task that does not exist · LOW

`apps/api/drizzle.config.ts:8` says *"DATABASE_URL is declared in turbo.json's
db:migrate env"*. There is no `db:migrate` task in `turbo.json`. I added `DATABASE_URL`
to `globalEnv`, but the task itself still does not exist.

---

## Already fixed in this pass

- `apps/api/src/main.ts` — port fallback `3001 → 3333`. 3001 is Docusaurus, so an
  unset `PORT` silently collided with the docs app.
- `turbo.json` — added the 27 missing `globalEnv` vars (every task previously ran
  with `DATABASE_URL`, `REDIS_URL`, `STORAGE_*`, `SUPABASE_*` stripped), a `test`
  task, and `dist/**` + `build/**` to `build.outputs`.

## Verified working

| | |
| --- | --- |
| API boot | `SEC-014 RLS boot assertion passed` on `:3333` |
| Worker | `{"level":"info","message":"worker ready","queue":"cra-sentinel"}` |
| Negative RLS test | superuser `DATABASE_URL` → refuses to boot, exit 1 |
| Error contract | `application/problem+json`, RFC 9457, no stack leak |
| `pnpm check-types` | 7/7 packages |
| `pnpm lint` | 0 errors (7 pre-existing `any` warnings) |
| Tests | api 178 · sbom-core 206 · api-client drift 1 = **385 passing** |
| RLS suites | genuinely assert cross-tenant isolation, not vacuous |
