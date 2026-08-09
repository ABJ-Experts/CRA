# infrastructure

Local Supabase stack and (later) Terraform for this monorepo.

## Requirements

Docker must be running — the whole Supabase stack is containers. Every script
that needs it runs a `preflight` check first and fails with a clear message
rather than a Docker socket error.

## Commands

Run from the repo root:

```bash
pnpm --filter infrastructure run db:start    # boot the stack
pnpm --filter infrastructure run db:status   # show URLs and keys
pnpm --filter infrastructure run db:stop     # shut down (keeps data)
```

Migrations — always via the CLI, never by editing the database directly:

```bash
pnpm --filter infrastructure run db:new add_users   # new migration file
pnpm --filter infrastructure run db:reset           # re-apply all + seed
pnpm --filter infrastructure run db:diff  my_change # capture live changes
pnpm --filter infrastructure run db:push            # apply to the linked remote
pnpm --filter infrastructure run db:types           # regenerate TS types
```

## Local ports

| Service     | Port  |
| ----------- | ----- |
| API gateway | 54321 |
| Postgres    | 54322 |
| Studio      | 54323 |
| Mailpit     | 54324 |
| Pooler      | 54329 |
| Analytics   | 54327 |

App ports for reference: web `3000`, docs `3001`, api `3333`.

## Stale MFA recovery operations

MFA recovery uses a five-minute database lease so a retry cannot race an active
provider cleanup, while a request interrupted by a process crash can eventually
resume. Operators can find expired or otherwise stalled operations with:

```sql
select id, user_id, status, attempts, last_error, updated_at, lease_expires_at
from public.mfa_recovery_operations
where status <> 'completed'
  and updated_at < now() - interval '5 minutes'
order by updated_at;
```

`last_error` contains bounded internal error codes, never provider response
bodies or recovery credentials. There is intentionally no background retry
worker yet; ownership, retry limits, and alerting must be defined first.

## Not wired into Turborepo — on purpose

There is no `turbo.json` here and no `dev`/`build`/`lint` scripts, so
`turbo run <task>` skips this package entirely.

That is deliberate. Every command is stateful and side-effectful: `db:reset`
destroys and re-seeds the database, `db:push` mutates a remote, and
`db:types`/`db:diff` read live container state Turborepo cannot hash. A cache
"hit" on any of them would be a silent no-op — at best stale types, at worst
a migration that looks applied and isn't. Invoke them explicitly instead.

## Committed vs ignored

Commit `config.toml`, `supabase/.gitignore`, `migrations/*.sql`, `seed.sql`
and the generated `supabase/types/database.types.ts` — committing the types
lets `api` and `web` typecheck in CI without Docker.

Never commit `.temp/`, `.branches/`, or any `.env` file. `config.toml` is
committed, so provider secrets there must use `env(VAR_NAME)` indirection —
never a literal value.

## Terraform

See `terraform/README.md`. Nothing there yet.
