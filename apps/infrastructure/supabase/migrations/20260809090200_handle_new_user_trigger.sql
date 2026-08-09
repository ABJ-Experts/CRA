-- =============================================================================
-- handle_new_user() + on_auth_user_created — the bridge from auth to profile.
-- =============================================================================
-- Without this trigger every sign-up produces a perfectly valid JWT and a
-- profile that does not exist, so the API guard rejects the brand-new user with
-- 401 "User profile not found". That failure looks like a broken login, not a
-- missing row, which is why it is worth this much comment.
--
-- This is the HARDENED body. The naive version fixes none of the three defects
-- below, and all three bite CRA specifically:
--
--   1. Reading only first_name/last_name/avatar_url from raw_user_meta_data.
--      Password sign-up sets exactly those keys, but OIDC providers use the
--      STANDARD claims given_name / family_name / name / picture — so every
--      OAuth user lands with NULL names. CRA ships social buttons, so this
--      would surface the moment a provider is enabled.
--
--   2. A plain INSERT can violate the unique index on lower(email). The trigger
--      runs INSIDE the auth.users INSERT transaction, so that error rolls the
--      whole sign-up back and GoTrue reports the opaque
--      "Database error saving new user". This is not hypothetical: the
--      invitation flow pre-creates a profile row keyed by email, so any invited
--      user completing sign-up hits it.
--
--   3. SECURITY DEFINER without a pinned search_path — a privilege-escalation
--      vector, flagged by Supabase's own advisor.
--
-- The ON CONFLICT branch is written to be conservative in both directions:
-- it never detaches a profile that already has a live auth identity, and it
-- only fills fields that are blank rather than clobbering data the user has
-- since edited.
-- =============================================================================

create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_meta     jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_first    text;
  v_last     text;
  v_avatar   text;
  v_username text;
  v_full     text;
begin
  -- Password-signup keys first, then the OIDC standard claims.
  v_first    := nullif(btrim(coalesce(v_meta ->> 'first_name', v_meta ->> 'given_name')),  '');
  v_last     := nullif(btrim(coalesce(v_meta ->> 'last_name',  v_meta ->> 'family_name')), '');
  v_avatar   := nullif(btrim(coalesce(v_meta ->> 'avatar_url', v_meta ->> 'picture')),     '');
  v_full     := nullif(btrim(coalesce(v_meta ->> 'full_name',  v_meta ->> 'name')),        '');
  v_username := nullif(btrim(coalesce(v_meta ->> 'username',   v_meta ->> 'preferred_username')), '');

  -- Providers that supply only a single display name (GitHub's `name`): split
  -- once on the first space so first/last are still populated.
  if v_first is null and v_full is not null then
    v_first := nullif(btrim(split_part(v_full, ' ', 1)), '');

    if v_last is null and position(' ' in v_full) > 0 then
      v_last := nullif(btrim(substring(v_full from position(' ' in v_full) + 1)), '');
    end if;
  end if;

  insert into public.users (auth_user_id, email, username, first_name, last_name, avatar_url)
  values (new.id, lower(btrim(new.email)), v_username, v_first, v_last, v_avatar)
  on conflict (lower(email)) do update
    set
      -- Never detach a profile that is already attached to a live auth user.
      auth_user_id = coalesce(public.users.auth_user_id, excluded.auth_user_id),
      -- Fill blanks only; never clobber something the user has edited.
      username     = coalesce(public.users.username,   excluded.username),
      first_name   = coalesce(public.users.first_name, excluded.first_name),
      last_name    = coalesce(public.users.last_name,  excluded.last_name),
      avatar_url   = coalesce(public.users.avatar_url, excluded.avatar_url),
      updated_at   = now();

  return new;
exception
  when unique_violation then
    -- Reachable only via the username index (email is handled above). A
    -- colliding username must never cost the user their sign-up, so retry
    -- without one and let them choose later.
    insert into public.users (auth_user_id, email, first_name, last_name, avatar_url)
    values (new.id, lower(btrim(new.email)), v_first, v_last, v_avatar)
    on conflict (lower(email)) do update
      set auth_user_id = coalesce(public.users.auth_user_id, excluded.auth_user_id),
          updated_at   = now();
    return new;
end;
$$;

alter function public.handle_new_user() owner to postgres;
revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Keep the profile email in step with the auth email.
--
-- GoTrue owns email changes (double_confirm_changes = true in config.toml), and
-- without this the profile keeps the old address forever — so the user signs in
-- with the new one and every lookup by profile email misses.
-- ---------------------------------------------------------------------------
create or replace function public.handle_user_email_change()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if new.email is distinct from old.email and new.email is not null then
    update public.users
       set email      = lower(btrim(new.email)),
           updated_at = now()
     where auth_user_id = new.id;
  end if;
  return new;
end;
$$;

alter function public.handle_user_email_change() owner to postgres;
revoke all on function public.handle_user_email_change() from public, anon, authenticated;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();
