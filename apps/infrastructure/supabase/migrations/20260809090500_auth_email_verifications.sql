-- =============================================================================
-- public.auth_email_verifications — the OTP store behind /verify.
-- =============================================================================
-- WHY THIS TABLE EXISTS AT ALL
--   `apps/web/app/(auth)/_components/auth-actions.ts` is frozen, and its
--   signature is `verifyCode({ code })` — no email, no user id. `resendCode()`
--   takes no arguments whatsoever. GoTrue's own OTP verification requires the
--   address, so it simply cannot be driven from those screens.
--
--   So CRA owns email verification: the pending user is resolved from a signed,
--   HttpOnly `cra_pending` cookie set at sign-up, and the code is checked here.
--   This is also why `config.toml` keeps `enable_confirmations = false` — with
--   it on, GoTrue would send its own template and block sign-in, and the frozen
--   /verify screen could not complete the flow.
--
-- Codes are stored HASHED. A 6-digit code has only 10^6 values, so read access
-- to this table must not be equivalent to holding the code.
-- =============================================================================

create table if not exists public.auth_email_verifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,

  -- The address being proven. For 'email_change' this is the CURRENT address
  -- and `new_email` carries the target, so a code cannot be replayed against a
  -- different destination than the one the user was shown.
  email       text not null,
  new_email   text,

  code_hash   text not null,
  purpose     text not null,

  -- Guessing budget for this specific code. Cheap defence against someone
  -- walking 000000-999999 against a known session.
  attempts    integer     not null default 0,
  consumed_at timestamptz,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),

  constraint auth_email_verifications_purpose_check
    check (purpose in ('signup', 'email_change')),
  constraint auth_email_verifications_attempts_sane
    check (attempts >= 0),
  constraint auth_email_verifications_new_email_only_for_change
    check (purpose = 'email_change' or new_email is null)
);

-- At most one live code per user per purpose. Requesting a new one supersedes
-- the old, which is what makes "resend" safe: without this, every resend would
-- leave another valid code alive and multiply the guessing surface.
create unique index if not exists auth_email_verifications_one_live
  on public.auth_email_verifications (user_id, purpose)
  where consumed_at is null;

create index if not exists idx_email_verifications_expires
  on public.auth_email_verifications (expires_at)
  where consumed_at is null;

alter table public.auth_email_verifications enable row level security;

grant all on table public.auth_email_verifications to service_role;
revoke all on table public.auth_email_verifications from public, anon, authenticated;
