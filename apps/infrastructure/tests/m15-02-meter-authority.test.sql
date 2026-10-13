-- Rollback-only: no issuer fixture is required for usage before activation.
begin;
set local statement_timeout='30s';
create function pg_temp.check(label text,ok boolean) returns void language plpgsql as $$begin if not coalesce(ok,false) then raise exception 'M15-02 check: %',label;end if;end $$;
do $$
declare o uuid := '00000000-0000-4000-8000-0000000000ca'; a uuid; r jsonb; source jsonb;
begin
 select id into a from public.users where email='owner@cra.test';
 r:=public.m15_02_read_usage(o,a,null);
 perform pg_temp.check('usage reads without requiring a licence artifact',r->>'outcome' in ('ready','unavailable'));
 source:=public.m15_01_usage(o);
 perform pg_temp.check('seat components preserve authoritative definitions',r->'components'->'activeMembers'=source->'activeMembers' and r->'components'->'reservedInvitations'=source->'reservedInvitations');
 perform pg_temp.check('foreign actor denied',public.m15_02_read_usage(o,gen_random_uuid(),null)->>'outcome'='forbidden');
 perform pg_temp.check('meter is private',not has_table_privilege('authenticated','public.organization_usage_meters','select') and not has_table_privilege('anon','public.organization_usage_meters','select'));
 perform pg_temp.check('RLS is enabled and not forced',(select relrowsecurity and not relforcerowsecurity from pg_class where oid='public.organization_usage_meters'::regclass));
end $$;
rollback;
