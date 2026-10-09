begin;
create or replace function pg_temp.check(p_name text,p_ok boolean) returns void language plpgsql as $$ begin
 if not coalesce(p_ok,false) then raise exception 'check failed: %',p_name; end if;
end $$;
select pg_temp.check('permission cache cannot be supplied by application role',not has_function_privilege('service_role','public.m13_03_event_visible_cached(uuid,uuid,public.audit_logs,jsonb)','EXECUTE'));
select pg_temp.check('permission snapshot private',not has_function_privilege('service_role','public.m13_03_permission_snapshot(uuid,uuid)','EXECUTE'));
do $$ declare v_org uuid:='00000000-0000-4000-8000-0000000000ca'; v_actor uuid; v_cache jsonb; v_filters jsonb:='{"from":"2026-01-01T00:00:00Z","to":"2026-10-08T00:00:00Z"}'; v_digest text; v_snapshot jsonb; v_page jsonb; v_unknown public.audit_logs; begin
 select user_id into v_actor from public.organization_members where organization_id=v_org and role='owner' limit 1;
 v_cache:=public.m13_03_permission_snapshot(v_org,v_actor);
 perform pg_temp.check('verified permission cache is boolean',jsonb_typeof(v_cache->'can_view_audit')='boolean' and v_cache->'can_view_audit'='true'::jsonb);
 v_unknown:=jsonb_populate_record(null::public.audit_logs,jsonb_build_object('organization_id',v_org,'entity_type','unknown_source'));
 perform pg_temp.check('cached policy still denies unknown source',not public.m13_03_event_visible_cached(v_org,v_actor,v_unknown,v_cache));
 v_digest:=encode(extensions.digest(convert_to(public.m13_02_canonical_json(v_filters),'UTF8'),'sha256'),'hex');
 v_snapshot:=public.m13_03_create_snapshot(v_org,v_actor,gen_random_uuid(),v_digest,repeat('a',64));
 perform public.m13_03_record_access(v_org,v_actor,gen_random_uuid(),'audit.search.page',(v_snapshot->>'receiptId')::uuid,repeat('b',64));
 v_page:=public.m13_03_read_page(v_org,v_actor,(v_snapshot->>'receiptId')::uuid,v_digest,repeat('a',64),v_filters,array['organization','audit_search'],null,null,null,10);
 perform pg_temp.check('optimized page remains bounded',jsonb_array_length(v_page)<=10);
 perform pg_temp.check('optimized page only requested scopes',not exists(select 1 from jsonb_array_elements(v_page) row where row->'event'->>'resourceType' not in ('organization','audit_search')));
 perform pg_temp.check('optimized page excludes own receipt',not exists(select 1 from jsonb_array_elements(v_page) row where row->'event'->>'id'=v_snapshot->>'receiptId'));
end $$;
rollback;
