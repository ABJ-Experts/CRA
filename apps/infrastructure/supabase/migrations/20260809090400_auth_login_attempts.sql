-- =============================================================================
-- public.auth_login_attempts — durable per-account lockout.
-- =============================================================================
-- The auth endpoints are throttled per-IP in memory, which an attacker evades
-- by rotating IPs to brute-force one account's password or 6-digit OTP. This
-- table gives a per-EMAIL lockout that survives a restart and is shared across
-- instances, which in-memory throttling cannot be.
--
-- service_role only: RLS is enabled with NO policy at all, so even if anon or
-- authenticated were somehow granted table privileges they could not read a row
-- and probe which addresses are registered.
--
-- ADDITION over the reference: `first_failed_at` and a SLIDING WINDOW. The
-- reference only ever increments `failed_count` and resets it on success, so a
-- user who mistypes their password once a month for five months is locked out
-- on the fifth attempt. Counting only failures inside the window fixes that
-- without weakening the burst protection that actually matters.
-- =============================================================================

create table if not exists public.auth_login_attempts (
  -- Lowercased email. Not a FK: we must be able to rate-limit attempts against
  -- addresses that do not exist, or the table itself becomes a user-enumeration
  -- oracle (a lockout would prove the account is real).
  email           text        primary key,
  failed_count    integer     not null default 0,
  first_failed_at timestamptz,
  locked_until    timestamptz,
  updated_at      timestamptz not null default now(),

  constraint auth_login_attempts_email_lower check (email = lower(email)),
  constraint auth_login_attempts_count_sane  check (failed_count >= 0)
);

create index if not exists idx_login_attempts_locked_until
  on public.auth_login_attempts (locked_until)
  where locked_until is not null;

-- The functions below also set updated_at explicitly, but the trigger keeps the
-- rule uniform across every table in the schema so `migration-lint` can assert
-- it unconditionally rather than carrying a list of exceptions.
drop trigger if exists set_login_attempts_updated_at on public.auth_login_attempts;
create trigger set_login_attempts_updated_at
  before update on public.auth_login_attempts
  for each row execute function public.set_updated_at();

alter table public.auth_login_attempts enable row level security;

grant all on table public.auth_login_attempts to service_role;
revoke all on table public.auth_login_attempts from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- record_login_failure(): count a failure and lock once the threshold is hit.
--
-- Returns the lock expiry when the account is now locked, else null. Written as
-- a single atomic upsert so two concurrent failed attempts cannot both read
-- `failed_count = 4` and each write 5.
-- ---------------------------------------------------------------------------
create or replace function public.record_login_failure(
  p_email          text,
  p_max_attempts   integer  default 5,
  p_window         interval default interval '15 minutes',
  p_lock_duration  interval default interval '15 minutes'
)
  returns timestamptz
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_email        text := lower(btrim(p_email));
  v_count        integer;
  v_locked_until timestamptz;
begin
  insert into public.auth_login_attempts (email, failed_count, first_failed_at, updated_at)
  values (v_email, 1, now(), now())
  on conflict (email) do update
    set
      -- Restart the count when the previous window has elapsed.
      failed_count = case
        when public.auth_login_attempts.first_failed_at is null
          or public.auth_login_attempts.first_failed_at < now() - p_window
        then 1
        else public.auth_login_attempts.failed_count + 1
      end,
      first_failed_at = case
        when public.auth_login_attempts.first_failed_at is null
          or public.auth_login_attempts.first_failed_at < now() - p_window
        then now()
        else public.auth_login_attempts.first_failed_at
      end,
      updated_at = now()
  returning failed_count into v_count;

  if v_count >= p_max_attempts then
    v_locked_until := now() + p_lock_duration;

    update public.auth_login_attempts
       set locked_until = v_locked_until,
           updated_at   = now()
     where email = v_email;
  end if;

  return v_locked_until;
end;
$$;

alter function public.record_login_failure(text, integer, interval, interval) owner to postgres;
revoke all on function public.record_login_failure(text, integer, interval, interval)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- is_login_locked(): the read the sign-in path makes before touching GoTrue.
-- ---------------------------------------------------------------------------
create or replace function public.is_login_locked(p_email text)
  returns timestamptz
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select locked_until
    from public.auth_login_attempts
   where email = lower(btrim(p_email))
     and locked_until is not null
     and locked_until > now();
$$;

alter function public.is_login_locked(text) owner to postgres;
revoke all on function public.is_login_locked(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- clear_login_attempts(): on every successful authentication.
-- ---------------------------------------------------------------------------
create or replace function public.clear_login_attempts(p_email text)
  returns void
  language sql
  security definer
  set search_path = public, pg_temp
as $$
  delete from public.auth_login_attempts where email = lower(btrim(p_email));
$$;

alter function public.clear_login_attempts(text) owner to postgres;
revoke all on function public.clear_login_attempts(text) from public, anon, authenticated;
