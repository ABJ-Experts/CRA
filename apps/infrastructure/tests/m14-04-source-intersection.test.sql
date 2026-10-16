-- Rollback-only source authority/intersection regression.
begin;
set local statement_timeout='30s';
create function pg_temp.check(p_name text,p_ok boolean) returns void language plpgsql as $$ begin
 if not coalesce(p_ok,false) then raise exception 'check failed: %',p_name; end if;
end $$;
select pg_temp.check('scheduled source intersection exists',to_regprocedure('public.m14_04_source_rows(uuid,uuid,uuid,text,jsonb,jsonb)') is not null);
select pg_temp.check('scheduled source helper is service only',not has_function_privilege('authenticated','public.m14_04_source_rows(uuid,uuid,uuid,text,jsonb,jsonb)','execute') and has_function_privilege('service_role','public.m14_04_source_rows(uuid,uuid,uuid,text,jsonb,jsonb)','execute'));
do $$ declare o uuid:=gen_random_uuid();u uuid;r uuid;begin
 select id into strict u from public.users where is_active and email_verified_at is not null limit 1;
 select id into strict r from public.users where is_active and email_verified_at is not null and id<>u limit 1;
 insert into public.organizations(id,name,slug) values(o,'Scheduled source fixture','m14-source-'||o);
 insert into public.organization_members(organization_id,user_id,role) values(o,u,'owner'),(o,r,'member');
 perform pg_temp.check('verified owner export authority',public.m14_04_source_actor_access(o,u,'products.registry','{}'));
 perform pg_temp.check('recipient export authority',public.m14_04_source_actor_access(o,r,'products.registry','{}'));
 perform pg_temp.check('cross tenant denied',not public.m14_04_source_actor_access(gen_random_uuid(),u,'products.registry','{}'));
 perform pg_temp.check('portal source denied',not public.m14_04_source_actor_access(o,u,'supplier_evidence.portal_items','{}'));
 perform pg_temp.check('owner-only source denied to member',not public.m14_04_source_actor_access(o,r,'sboms.ci_credentials','{}'));
 perform pg_temp.check('empty canonical intersection',not exists(select 1 from public.m14_04_source_rows(o,u,r,'products.registry','{}','{}')));
 insert into public.base_role_permission_overrides(organization_id,base_role,permissions) values(o,'member','{"can_export_products":false}');
 begin perform public.m14_04_source_rows(o,u,r,'products.registry','{}','{}');raise exception 'revoked recipient accepted';exception when insufficient_privilege then null;end;
 begin perform public.m14_04_source_rows(o,r,u,'products.registry','{}','{}');raise exception 'revoked owner accepted';exception when insufficient_privilege then null;end;
end $$;
rollback;
