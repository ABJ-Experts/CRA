# Repository Guidelines

## Workspace and Commands

This pnpm/Turborepo monorepo contains `apps/web` (Next.js 16), `apps/api` (NestJS 11), `apps/docs` (Docusaurus), and `apps/infrastructure` (Supabase). `packages/` holds shared code; the built `@repo/contracts` is the RBAC/schema source of truth.

Use Node 20+ and pnpm only—npm and Yarn are rejected. Run from the repository root:

```sh
pnpm dev                    # web (3000), docs (3001), API (3333)
pnpm build                  # build all Turbo-managed packages
pnpm lint && pnpm check-types
pnpm test                   # unit tests
pnpm format                 # Prettier; use double quotes throughout
```

Lint warnings fail builds. `infrastructure` bypasses Turborepo because its commands mutate containers; use `db:start`, `db:reset`, `db:lint`, `db:types`, and `test` through `pnpm --filter infrastructure run`. `db:reset` discards local data. `db:types` regenerates types **and copies them into `apps/api`**—never hand-edit either copy.

Local ports: API 54321, DB 54322, Studio 54323, Mailpit UI 54324, Mailpit **SMTP 54325**. The SMTP port only exists because `smtp_port` is uncommented in `config.toml`; without it every outbound email fails while the request still succeeds.

## Architecture and Security Contracts

`pnpm dev` is mocks-on, with no API and no database. A real backend needs `NEXT_PUBLIC_ENABLE_MOCKS=false` plus `SUPABASE_JWT_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_API_ORIGIN`. Seeded accounts are `owner|admin|member|viewer@cra.test` / `Password123`.

Keep API traffic under `/api/v1`. `next.config.js` proxies that prefix only, and `apps/web/mocks/handlers.ts` keeps its `passthrough()` first in the array—MSW matches in order, and the dashboard mocks already own `/api/products|orders|customers|coins`. `REFRESH_COOKIE_PATH` derives from the same prefix; if they drift, sessions die silently an hour after sign-in.

The API owns HttpOnly sessions: `cra_at` lasts one hour at `/`; `cra_rt` lasts seven days at `/api/v1/auth/refresh`. That narrow path is the CSRF control—do not widen it. Supabase tokens are **ES256, not HS256**; preserve algorithm-aware/JWKS verification in both the API and `middleware.ts`, since an HS256-only verifier rejects every valid session with no error anywhere.

Authentication is deny-by-default: the global `SupabaseAuthGuard` permits only allowlisted `@Public()` routes. Authenticated routes need `@RequirePermissions`, `@RequireRole`, or `@SelfScoped("reason")`. Two specs enforce this and fail in **both** directions so allowlists cannot rot: `auth/public-routes.spec.ts` and `permissions/permission-coverage.spec.ts`.

`service_role` bypasses RLS, so service methods take `orgId` **first** and scope every query; RLS is defence in depth, not the boundary. Permissions resolve as base-role defaults → custom roles (additive only) → implications → org overrides (hard merge, last word). A custom role's `base_role` is a label, not a grant. Changing that order reopens a privilege-escalation hole; `permissions.spec.ts` pins it.

The UI **fails open**—it shows anything not explicitly gated while loading or on error. Hiding is not a security control, and failing closed empties the sidebar on a transient blip.

## Database, Style, and Testing

Create migrations through the Supabase CLI and confirm no drift with `pnpm --filter infrastructure exec supabase db diff`. Pin every function's `search_path`, point foreign keys at `public.users.id` (never `auth.users.id`—GoTrue's admin API wants the other one and returns "User not found" while reporting success), enable but never force RLS, and grant RPC access explicitly after revoking `PUBLIC`—revoking from `PUBLIC` also strips `service_role`. Emails are `text` with a `lower(email)` unique index, never `citext`. Keep `SESSION_EPOCH_SKEW_SECONDS` at 0; any positive value is a window in which a revoked token still works. Seeding `auth.users` directly requires `confirmation_token` and its siblings as empty strings, not NULL.

Write readable, immutable, typed TypeScript: `PascalCase` components, `camelCase` functions, `useX` hooks, and colocated `*.spec.ts(x)` tests. Validate inputs with the shared Zod schemas in `@repo/contracts`—the server must never be laxer than the frozen screens. Use semantic tokens such as `bg-canvas` and `text-subhead-regular`, never raw Tailwind colours or `text-sm`, and import shared UI from `@repo/ui/button` subpaths rather than the root barrel. Always compose classes through `cn()`, which registers the custom font-size and gradient namespaces with tailwind-merge; without it `text-h3` is treated as a colour and silently dropped.

Web and contracts use Vitest; the API uses Jest. Run focused tests before `pnpm test`—for example `pnpm --filter api run test -- cookies.util` or `pnpm --filter web run test -- menu-nav-parity`. API end-to-end and RLS tests need Supabase running; `apps/api/test/auth-flow.e2e.sh` also needs a built API and is run from the repository root. Prefer testing against the live stack for anything touching cookies, triggers, or mail: the failures that matter there are invisible to a mocked suite.

Do not alter the eight frozen `auth-actions.ts` signatures—three carry no identity by design, which is why the pending user comes from a signed cookie—and do not let `nav-config.tsx` drift from the shared menu contract.

## Commits and Pull Requests

Use short, imperative subjects (for example, `Add dashboard navigation`) and focused commits. Enable the committed hook once per clone with `git config core.hooksPath .githooks`; this checkout is already configured. It runs only during commits, blocks em dashes and AI attribution/tool/provider terms, limits subjects to 72 characters, and permits standard trailers. Never use `--no-verify` to bypass it. PRs must describe the change and validation, link issues, include screenshots for visible changes, and call out migrations, generated types, or configuration steps.

## Design Pattern Architecture

Patterns solve demonstrated problems; they are not a quota. Before a feature
introduces a new abstraction, provider, state machine, cross-feature dependency,
or persistent workflow, complete `docs/architecture/feature-design-template.md`
and use the selection matrix in
`docs/architecture/pattern-selection-matrix.md`.

- Dependency direction inside a layered feature is presentation -> application -> domain; adapters implement inward-owned ports.
- Controllers and pages stay thin. No direct Supabase access from controllers, React pages, or shared UI.
- Every service-role operation is self-scoped from verified identity or takes `orgId` as its first argument and applies the organization filter.
- Prefer immutable functions and composition. A new class hierarchy, global singleton, command bus, event bus, abstract factory, template base class, memento store, or visitor requires a concrete trigger and ADR.
- Security-critical effects are synchronous or transactionally durable. Browser state is never an authorization source.
- Write the failing test first and maintain at least 80% coverage for every new or materially refactored module.
- Preserve the API, cookies, auth-action signatures, permission merge order, mock namespace, and menu behavior documented above.
- Every cross-application API contract lives feature-first in `@repo/contracts`: runtime schemas under `<feature>/schemas/` and parsed wire types under `<feature>/types/`. Derive trusted request and response types with `z.output<typeof schema>`; use `z.input` only for values that have not been parsed yet. Do not duplicate DTO shapes in controllers or web API files.
- Parse every consumed body, query, and path parameter before application logic, and parse every successful JSON response before serialization. Web callers provide both `inputSchema` for outgoing bodies and `schema` for incoming responses.
- Keep React/Next rendering components functional. Put stateful, injected transport, gateway, adapter, or workflow logic in focused plain TypeScript classes in `.ts` files when a real lifecycle or dependency boundary exists. Keep pure policies as immutable functions; React class components are reserved for error boundaries or a documented third-party lifecycle constraint.
- Follow the execution checklist in `docs/ai/coding-rules.md` before considering a feature complete.
