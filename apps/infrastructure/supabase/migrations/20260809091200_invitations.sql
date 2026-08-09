-- =============================================================================
-- public.invitations — invite a person into an organization.
-- =============================================================================
-- The flow with the most edge cases in the whole system. The ones encoded here
-- as constraints rather than left to service code:
--
--   * only one live invitation per (organization, email)  -> partial unique index
--   * the token in the database is not a usable credential -> token_hash only
--   * an accepted invitation records when, and cannot also be declined
--   * expiry is mandatory, never open-ended
--
-- Service-layer behaviours that pair with this table (ported from the reference,
-- which handles them well):
--   * inviting an address that already has an account  -> 409, "sign in to accept"
--   * inviting an existing member                      -> 400
--   * re-accepting an already accepted invitation      -> idempotent success,
--                                                         NOT an error
--   * resend from a different organization             -> 403
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'invitation_status') then
    create type public.invitation_status as enum
      ('pending', 'accepted', 'expired', 'revoked', 'declined');
  end if;
end
$$;

create table if not exists public.invitations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,

  -- Who sent it. SET NULL rather than CASCADE: an invitation is a fact about
  -- the organization, and deleting the sender must not erase the audit trail of
  -- who joined and how.
  invited_by       uuid references public.users (id) on delete set null,

  email            text not null,
  role             text not null default 'member',
  custom_role_id   uuid references public.custom_roles (id) on delete set null,
  first_name       text,
  last_name        text,

  -- sha256 hex of randomBytes(32).toString('hex'). The raw token exists only in
  -- the emailed URL. The reference stores it in plaintext, which makes any
  -- database read equivalent to holding a working invitation for every pending
  -- invite in the system.
  token_hash       text not null,

  status           public.invitation_status not null default 'pending',

  expires_at       timestamptz not null,
  accepted_at      timestamptz,
  declined_at      timestamptz,
  revoked_at       timestamptz,
  created_at       timestamptz not null default now(),

  constraint invitations_role_check
    check (role in ('owner', 'admin', 'member', 'viewer')),
  constraint invitations_email_lower
    check (email = lower(email)),
  constraint invitations_token_hash_len
    check (length(token_hash) = 64),
  constraint invitations_status_timestamps check (
    (status = 'accepted' and accepted_at is not null) or
    (status = 'declined' and declined_at is not null) or
    (status = 'revoked'  and revoked_at  is not null) or
    (status in ('pending', 'expired'))
  )
);

create unique index if not exists invitations_token_hash_key
  on public.invitations (token_hash);

-- Only one OUTSTANDING invitation per address per organization. Partial, so the
-- same person can be re-invited after declining or after the first one expires.
create unique index if not exists invitations_one_pending_per_email
  on public.invitations (organization_id, email)
  where status = 'pending';

create index if not exists idx_invitations_org    on public.invitations (organization_id);
create index if not exists idx_invitations_email  on public.invitations (email) where status = 'pending';
create index if not exists idx_invitations_expiry on public.invitations (expires_at) where status = 'pending';

alter table public.invitations enable row level security;
grant all on table public.invitations to service_role;
revoke all on table public.invitations from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- expire_stale_invitations(): flip pending rows whose time has passed.
--
-- The accept path checks expiry inline too — this exists so the admin list
-- shows honest statuses without every read having to reason about `now()`.
-- ---------------------------------------------------------------------------
create or replace function public.expire_stale_invitations()
  returns integer
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  update public.invitations
     set status = 'expired'
   where status = 'pending'
     and expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

alter function public.expire_stale_invitations() owner to postgres;
revoke all on function public.expire_stale_invitations() from public, anon, authenticated;
