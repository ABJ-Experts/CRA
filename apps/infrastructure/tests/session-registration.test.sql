-- Session registration uses one conflict arbiter; duplicate unique indexes can
-- race independently while concurrent requests register the same verified JWT.
\set ON_ERROR_STOP on
begin;
create function pg_temp.check(label text, valid boolean) returns void
language plpgsql as $$ begin
  if not valid then raise exception 'FAIL %', label; end if;
  raise notice 'ok %', label;
end $$;
select pg_temp.check('the primary key uniquely binds organization and session',
  exists (select 1 from pg_constraint where conrelid = 'public.organization_session_bindings'::regclass
    and contype = 'p' and pg_get_constraintdef(oid) = 'PRIMARY KEY (organization_id, session_id)'));
select pg_temp.check('registration has no redundant secondary uniqueness arbiter',
  not exists (select 1 from pg_constraint where conrelid = 'public.organization_session_bindings'::regclass
    and contype = 'u' and pg_get_constraintdef(oid) = 'UNIQUE (organization_id, user_id, session_id)'));
select pg_temp.check('session lookup index remains available',
  exists (select 1 from pg_indexes where schemaname = 'public'
    and tablename = 'organization_session_bindings' and indexname = 'organization_session_bindings_user_idx'));
select pg_temp.check('registration remains service-role only with pinned search path',
  has_function_privilege('service_role', 'public.register_organization_session_atomic(uuid,uuid,uuid,timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.register_organization_session_atomic(uuid,uuid,uuid,timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.register_organization_session_atomic(uuid,uuid,uuid,timestamptz)', 'EXECUTE')
  and (select prosecdef and proconfig @> array['search_path=public, pg_temp']
    from pg_proc where oid = 'public.register_organization_session_atomic(uuid,uuid,uuid,timestamptz)'::regprocedure));
do $$
declare
  v_session_id uuid := gen_random_uuid();
  v_organization_id uuid := '00000000-0000-4000-8000-0000000000ca';
  owner_id uuid := (select id from public.users where email = 'owner@cra.test');
  other_id uuid := (select id from public.users where email = 'member@cra.test');
  result text;
begin
  select outcome into result from public.register_organization_session_atomic(
    v_organization_id, owner_id, v_session_id, '2026-09-28T00:00:00Z');
  perform pg_temp.check('initial verified member registration succeeds', result = 'registered');
  select outcome into result from public.register_organization_session_atomic(
    v_organization_id, owner_id, v_session_id, '2026-09-28T00:01:00Z');
  perform pg_temp.check('same user refresh preserves existing issued-at update behavior',
    result = 'registered' and exists (select 1 from public.organization_session_bindings b
      where b.organization_id = v_organization_id and b.session_id = v_session_id
      and b.user_id = owner_id and b.issued_at = '2026-09-28T00:01:00Z'));
  select outcome into result from public.register_organization_session_atomic(
    v_organization_id, other_id, v_session_id, '2026-09-28T00:02:00Z');
  perform pg_temp.check('another organization member cannot overwrite session identity', result = 'not_found');
  perform pg_temp.check('rejected substitution preserves identity and issued-at',
    exists (select 1 from public.organization_session_bindings b
      where b.organization_id = v_organization_id and b.session_id = v_session_id
      and b.user_id = owner_id and b.issued_at = '2026-09-28T00:01:00Z'));
  select outcome into result from public.register_organization_session_atomic(
    gen_random_uuid(), owner_id, gen_random_uuid(), now());
  perform pg_temp.check('foreign organization membership is rejected', result = 'not_found');
end $$;
rollback;
