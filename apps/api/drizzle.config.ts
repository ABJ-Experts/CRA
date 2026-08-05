import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    // DATABASE_URL is declared in turbo.json's db:migrate env; the fallback is
    // the Supabase-local direct connection (port 54322).
    url:
      process.env.DATABASE_URL ??
      'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  },
  strict: true,
  verbose: true,
});
