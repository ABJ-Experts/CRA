# api

NestJS application serving the project API.

## Commands

Run from the repo root, or from this directory. **This repo uses pnpm** — its
`devEngines.packageManager` is set with `onFail: "error"`, so npm and yarn are
rejected rather than silently producing a second lockfile.

```bash
pnpm --filter api run dev      # watch mode, http://localhost:3333
pnpm --filter api run build    # compiles to dist/
pnpm --filter api run start    # runs the compiled build
pnpm --filter api run test     # unit tests
pnpm --filter api run test:e2e # end-to-end tests
```

## Port

Listens on `3333` by default (`3000` is `apps/web`, `3001` is `apps/docs`).
Override with the `PORT` environment variable, which is declared in
`turbo.json` so it participates in the task hash.

## Database

Local Postgres and the rest of the Supabase stack are managed from
`apps/infrastructure` — see that package's README. Docker must be running.
