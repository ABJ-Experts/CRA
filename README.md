# CRA

Turborepo monorepo. Package manager is **pnpm** — `devEngines.packageManager`
is set with `onFail: "error"`, so npm and yarn are rejected rather than
silently producing a second lockfile.

## What's inside

### Apps

| App | Stack | Port | Purpose |
| --- | --- | --- | --- |
| `web` | Next.js 16 | 3000 | Main web application |
| `docs` | Docusaurus 3 | 3001 | Documentation, and API docs in future |
| `api` | NestJS 11 | 3333 | Backend API |
| `infrastructure` | Supabase CLI | — | Local Postgres, migrations, future Terraform |

`infrastructure` is intentionally not wired into Turborepo — its commands are
stateful (they start containers and mutate databases) and must never be
cached. See `apps/infrastructure/README.md`.

### Packages

- `@repo/design-system` — Tailwind v4 design tokens (colours, typography,
  gradients, semantic theming). CSS only, zero runtime. Consumed by `web`,
  `docs` and `@repo/ui`.
- `@repo/ui` — shared React components
- `@repo/eslint-config` — flat ESLint configs (`base`, `next-js`, `node`,
  `react-internal`)
- `@repo/typescript-config` — shared `tsconfig` bases (`base`, `nextjs`,
  `nestjs`, `react-library`)

Everything is TypeScript, pinned to 5.9.2 across the repo.

The single typeface is **Poppins**, loaded via `next/font` in `web` and
`@fontsource/poppins` in `docs`.

## Getting started

```sh
pnpm install
pnpm dev            # runs web, docs and api together
```

Individual apps:

```sh
pnpm exec turbo dev --filter=web
pnpm exec turbo dev --filter=docs
pnpm exec turbo dev --filter=api
```

## Common commands

```sh
pnpm build          # build every app
pnpm lint           # lint every package
pnpm check-types    # typecheck every package
pnpm format         # prettier across the repo
```

## Commit-message hook

Enable the versioned hook once in each clone:

```sh
git config core.hooksPath .githooks
```

It runs only when creating a commit. Keep the subject to 72 characters or
fewer; standard trailers such as `Signed-off-by:` are allowed. The hook rejects
em dashes and AI attribution, provider, model, or tool names. Do not bypass it
with `--no-verify`.

## Local database

Requires Docker to be running.

```sh
pnpm --filter infrastructure run db:start   # boot Supabase
pnpm --filter infrastructure run db:status  # URLs and keys
pnpm --filter infrastructure run db:new     # create a migration
pnpm --filter infrastructure run db:reset   # re-apply migrations + seed
```

## Remote caching

Turborepo can share build caches across machines via
[Vercel Remote Cache](https://turborepo.dev/docs/core-concepts/remote-caching):

```sh
pnpm exec turbo login
pnpm exec turbo link
```

## Useful links

- [Tasks](https://turborepo.dev/docs/crafting-your-repository/running-tasks)
- [Caching](https://turborepo.dev/docs/crafting-your-repository/caching)
- [Filtering](https://turborepo.dev/docs/crafting-your-repository/running-tasks#using-filters)
- [Configuration](https://turborepo.dev/docs/reference/configuration)
