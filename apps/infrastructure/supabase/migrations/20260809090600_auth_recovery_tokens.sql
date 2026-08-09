-- =============================================================================
-- public.auth_recovery_tokens — password reset.
-- =============================================================================
-- `/reset-password` receives an opaque token in the URL and posts
-- `resetPassword({ token, password })`. The raw token exists only in that URL
-- and in the email; the database stores sha256(token) so that read access here
-- is not equivalent to being able to take over every pending account.
--
-- The reference stores the RAW token, which means anyone with a database dump
-- (or a SELECT via a mis-scoped policy) holds a working credential for every
-- outstanding reset.
-- =============================================================================

create table if not exists public.auth_recovery_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users (id) on delete cascade,

  -- sha256 hex of randomBytes(32).toString('hex'). Unique so a (vanishingly
  -- unlikely) collision is a constraint error rather than a cross-account
  -- password reset.
  token_hash   text not null,

  consumed_at  timestamptz,
  expires_at   timestamptz not null,
  requested_ip inet,
  created_at   timestamptz not null default now(),

  constraint auth_recovery_tokens_hash_len check (length(token_hash) = 64)
);

create unique index if not exists auth_recovery_tokens_hash_key
  on public.auth_recovery_tokens (token_hash);

create index if not exists idx_recovery_tokens_live
  on public.auth_recovery_tokens (user_id)
  where consumed_at is null;

alter table public.auth_recovery_tokens enable row level security;

grant all on table public.auth_recovery_tokens to service_role;
revoke all on table public.auth_recovery_tokens from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Changing a password invalidates every session.
--
-- Bumping the epoch is what makes "I was compromised, I changed my password"
-- actually eject the attacker's live access token, rather than leaving it valid
-- for up to jwt_expiry. The API pairs this with a GoTrue global sign-out, which
-- revokes the refresh tokens; neither half is sufficient alone.
-- ---------------------------------------------------------------------------
create or replace function public.bump_session_epoch(p_user_id uuid)
  returns void
  language sql
  security definer
  set search_path = public, pg_temp
as $$
  update public.users
     set session_epoch_at = now(),
         updated_at       = now()
   where id = p_user_id;
$$;

alter function public.bump_session_epoch(uuid) owner to postgres;
revoke all on function public.bump_session_epoch(uuid) from public, anon, authenticated;
