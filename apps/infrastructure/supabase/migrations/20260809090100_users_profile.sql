-- =============================================================================
-- public.users — the application profile.
-- =============================================================================
-- EVERY foreign key in this schema points at public.users(id), never at
-- auth.users(id). That is the invariant which, if broken, makes every
-- membership and assignment row point at the wrong identity.
--
-- WHY THE ID IS SEPARATE FROM auth_user_id
--   The invitation flow creates a profile row BEFORE any auth.users row exists
--   (the invitee has not accepted yet, so GoTrue knows nothing about them). A
--   nullable auth_user_id is what makes that possible. It also means a user can
--   be re-attached to a new auth identity without rewriting every FK.
--
-- WHY EMAIL IS text AND NOT citext
--   citext's `=` operator lives in the `extensions` schema. Every SECURITY
--   DEFINER function here pins `search_path = public, pg_temp`, so a citext
--   comparison inside one would resolve against a search_path that does not
--   contain its operator and fail at runtime. Instead: plain text plus a unique
--   index on lower(email), with the API normalising through the single
--   `normalizeEmail()` in @repo/contracts. GoTrue already lowercases
--   auth.users.email, so the two tiers agree.
-- =============================================================================

create table if not exists public.users (
  id                uuid primary key default gen_random_uuid(),

  -- Nullable: an invited-but-unaccepted profile has no auth identity yet.
  -- ON DELETE CASCADE so removing the auth identity removes the profile, which
  -- is what makes "delete a user" a single GoTrue admin call.
  auth_user_id      uuid references auth.users (id) on delete cascade,

  email             text not null,
  username          text,
  first_name        text,
  last_name         text,
  avatar_url        text,
  avatar_path       text,

  -- The reference overloads a single `role text` column for job title AND
  -- authorization, which reads as an access-control field and is not one.
  -- Split, so nothing can mistake it for a grant.
  job_title         text,

  language          text        not null default 'en',
  is_active         boolean     not null default true,

  -- Session revocation epoch. The auth guard compares the JWT's `iat` against
  -- this and rejects anything older with code `session_revoked`. Bumped on
  -- password change, sign-out-everywhere, deactivation and role change.
  --
  -- Needed because a signed access token stays cryptographically valid for its
  -- full lifetime (jwt_expiry = 3600s) no matter what happens to the account.
  -- Revoking refresh tokens in GoTrue stops NEW tokens being minted; this stops
  -- the one already in the user's browser.
  --
  -- The guard must allow a few seconds of clock skew when comparing: `iat`
  -- comes from GoTrue's clock and this column from Postgres's, and they drift
  -- inside Docker. Without the allowance, changing your password logs you out
  -- of the session you just authenticated with.
  session_epoch_at  timestamptz not null default now(),

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint users_email_not_blank check (length(btrim(email)) > 0)
);

-- Case-insensitive uniqueness without citext.
create unique index if not exists users_email_lower_key
  on public.users (lower(email));

create unique index if not exists users_username_lower_key
  on public.users (lower(username))
  where username is not null;

-- Postgres never indexes the REFERENCING side of a foreign key. The auth guard
-- resolves a profile by auth_user_id on every single authenticated request, so
-- without this every request is a sequential scan.
--
-- Deliberately NOT unique: making it unique would change insert semantics for
-- the invited-user path, and the trigger already guarantees at most one profile
-- per auth identity via its ON CONFLICT branch.
create index if not exists idx_users_auth_user_id
  on public.users (auth_user_id);

create index if not exists idx_users_is_active
  on public.users (is_active)
  where is_active = false;

drop trigger if exists set_users_updated_at on public.users;
create trigger set_users_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

alter table public.users enable row level security;

-- NOT `force`: forcing RLS applies it to the table owner too, which would break
-- every SECURITY DEFINER helper that reads this table.

grant all on table public.users to service_role;
revoke all on table public.users from public, anon, authenticated;
