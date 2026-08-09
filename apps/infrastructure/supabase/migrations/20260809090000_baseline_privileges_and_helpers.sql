-- =============================================================================
-- Baseline: narrow default privileges, and the one shared trigger function.
-- =============================================================================
-- Runs before any table exists so that nothing we create later is ever exposed
-- by accident.
--
-- `config.toml` already leaves `auto_expose_new_tables` commented out, so new
-- tables are not auto-granted to anon/authenticated by Supabase. This migration
-- closes the remaining hole: privileges inherited via the PUBLIC pseudo-role.
--
-- WHY `PUBLIC` IS NAMED FIRST EVERYWHERE
--   `REVOKE ... FROM anon` is a silent no-op when the privilege is actually held
--   via PUBLIC — the statement succeeds, the grant survives, and a later audit
--   reports the table as locked down when it is not. This is the single most
--   repeated mistake in the reference project, so PUBLIC is revoked explicitly
--   in every statement below.
--
-- ACCESS MODEL
--   apps/api talks to Postgres through the Supabase service_role client, which
--   bypasses RLS. The real authorization boundary is therefore the
--   `.eq('organization_id', ...)` on every query, enforced by the repository
--   layer in the API. RLS here is defence-in-depth against someone reaching
--   PostgREST on :54321 with the anon key.
--
--   Consequently NOTHING is granted to anon or authenticated. Policies are still
--   written (see the rls_policies migration) with explicit `TO authenticated`
--   clauses, so that the day a browser-side Supabase client is introduced the
--   policies are already correct rather than being retrofitted under pressure.
--   Until then a wrong policy cannot leak anything, because the table privilege
--   it would rely on does not exist.
-- =============================================================================

-- pgcrypto lives in the `extensions` schema on Supabase. We hash tokens in the
-- API (Node's crypto), not in SQL, but `gen_random_bytes` is useful in seeds.
create extension if not exists pgcrypto with schema extensions;

-- --------------------------------------------------------------------------
-- Existing objects
-- --------------------------------------------------------------------------
revoke all on all tables    in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- Future objects. Default privileges are recorded per creating role, and every
-- migration in this project runs as `postgres`, so that is the role to pin.
-- --------------------------------------------------------------------------
alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- set_updated_at(): one copy, attached to every table carrying `updated_at`.
--
-- The reference ships four byte-identical copies of this and still forgot to
-- attach any of them to its users table, so `updated_at` there silently lies
-- unless application code remembers to set it. `migration-lint.spec.ts` asserts
-- every table with the column also has the trigger.
--
-- `search_path` is pinned on every function in this project. An unpinned
-- SECURITY DEFINER function is a genuine privilege-escalation vector (Supabase
-- advisor: function_search_path_mutable), and pinning the INVOKER ones too
-- keeps the rule mechanical rather than a judgement call per function.
-- --------------------------------------------------------------------------
create or replace function public.set_updated_at()
  returns trigger
  language plpgsql
  set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

alter function public.set_updated_at() owner to postgres;
revoke all on function public.set_updated_at() from public, anon, authenticated;
