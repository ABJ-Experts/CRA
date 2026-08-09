-- =============================================================================
-- public.auth_mfa_recovery_codes
-- =============================================================================
-- The table lands now; the service that writes it arrives with the MFA phase.
--
-- It exists ahead of its module because `apps/web/app/(auth)/two-factor/page.tsx`
-- already ships a recovery-code mode (any code of 8+ characters is accepted by
-- the current stub), and Supabase Auth has no recovery-code concept of its own —
-- GoTrue offers TOTP factors and nothing else. So recovery codes are ours to
-- store, and they are stored HASHED and SINGLE-USE.
-- =============================================================================

create table if not exists public.auth_mfa_recovery_codes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  code_hash   text not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now(),

  constraint auth_mfa_recovery_codes_hash_len check (length(code_hash) = 64)
);

-- Same code may not be issued twice to one user; different users may coincide.
create unique index if not exists auth_mfa_recovery_codes_user_code_key
  on public.auth_mfa_recovery_codes (user_id, code_hash);

create index if not exists idx_mfa_recovery_unused
  on public.auth_mfa_recovery_codes (user_id)
  where consumed_at is null;

alter table public.auth_mfa_recovery_codes enable row level security;

grant all on table public.auth_mfa_recovery_codes to service_role;
revoke all on table public.auth_mfa_recovery_codes from public, anon, authenticated;
