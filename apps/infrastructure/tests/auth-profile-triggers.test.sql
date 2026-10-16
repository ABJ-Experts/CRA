-- Synthetic auth/profile fixtures are rolled back; existing accounts are untouched.
begin;
do $$
declare
  v_auth uuid := gen_random_uuid();
  v_invited uuid := gen_random_uuid();
  v_profile uuid := gen_random_uuid();
  v_email text := 'trigger-' || v_auth::text || '@cra.test';
  v_invited_email text := 'invited-' || v_invited::text || '@cra.test';
begin
  if not exists (
    select 1 from pg_trigger where tgrelid = 'auth.users'::regclass
      and tgname = 'on_auth_user_created' and tgenabled = 'O'
      and tgfoid = 'public.handle_new_user()'::regprocedure
      and tgtype = 5
  ) then raise exception 'Auth signup profile trigger is missing or disabled'; end if;
  if not exists (
    select 1 from pg_trigger where tgrelid = 'auth.users'::regclass
      and tgname = 'on_auth_user_email_changed' and tgenabled = 'O'
      and tgfoid = 'public.handle_user_email_change()'::regprocedure
      and tgtype = 17
  ) then raise exception 'Auth email profile trigger is missing or disabled'; end if;
  if exists (
    select 1 from pg_proc where oid in ('public.handle_new_user()'::regprocedure,
      'public.handle_user_email_change()'::regprocedure)
      and (not prosecdef or pg_get_userbyid(proowner) <> 'postgres'
        or not coalesce(proconfig @> array['search_path=public, pg_temp'], false)
        or has_function_privilege('anon', oid, 'EXECUTE')
        or has_function_privilege('authenticated', oid, 'EXECUTE')
        or has_function_privilege('service_role', oid, 'EXECUTE'))
  ) then raise exception 'Auth profile functions have unsafe execution boundaries'; end if;

  insert into auth.users (id, email, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  values (v_auth, v_email, '{"given_name":"Fixture","family_name":"Person"}', '', '', '', '');
  if not exists (select 1 from public.users where auth_user_id = v_auth
    and email = v_email and first_name = 'Fixture' and last_name = 'Person') then
    raise exception 'Signup did not create the expected OIDC profile'; end if;
  raise notice 'ok   signup creates a profile with OIDC names';

  update auth.users set email = 'changed-' || v_email where id = v_auth;
  if not exists (select 1 from public.users where auth_user_id = v_auth
    and email = 'changed-' || v_email) then
    raise exception 'Auth email change did not synchronize the profile'; end if;
  raise notice 'ok   auth email changes synchronize the profile';

  insert into public.users (id, email, first_name)
  values (v_profile, v_invited_email, 'Preserved');
  insert into auth.users (id, email, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  values (v_invited, v_invited_email, '{"first_name":"Replacement","last_name":"Fixture"}', '', '', '', '');
  if not exists (select 1 from public.users where id = v_profile
    and auth_user_id = v_invited and first_name = 'Preserved' and last_name = 'Fixture') then
    raise exception 'Invited profile was not linked conservatively'; end if;
  raise notice 'ok   signup links invited profiles without overwriting names';
end $$;
rollback;
