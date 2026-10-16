-- Read existing source-owned audit contracts; every fixture is rolled back.
begin;
set local statement_timeout='60s';
create function pg_temp.assert_export_audit(p_condition boolean,p_label text) returns void language plpgsql as $$
begin if not coalesce(p_condition,false) then raise exception 'export audit assertion: %',p_label;end if;end $$;
do $$
declare org uuid:=gen_random_uuid();actor uuid;job public.export_jobs;event public.audit_logs;
filters jsonb;filter_digest text;receipt jsonb;old_page jsonb;new_page jsonb;scope_digest text:=repeat('a',64);
begin
 select id into strict actor from public.users where email='owner@cra.test';
 insert into public.organizations(id,name,slug) values(org,'M14 audit rollback','m14-audit-'||org);
 insert into public.organization_members(organization_id,user_id,role) values(org,actor,'owner');
 job:=jsonb_populate_record(null::public.export_jobs,jsonb_build_object('id',gen_random_uuid(),'organization_id',org,'requester_id',actor,'subject_kind','member','idempotency_key',gen_random_uuid(),'state','queued','version',1));
 perform public.m14_03_audit(job,'manifest_downloaded',gen_random_uuid());
 set constraints all immediate;
 select * into strict event from public.audit_logs where organization_id=org and entity_type='export_job' and entity_id=job.id::text;
 perform pg_temp.assert_export_audit(public.m13_03_event_visible(org,actor,event),'safe own organization event visible');
 perform pg_temp.assert_export_audit(not public.m13_03_event_visible(gen_random_uuid(),actor,event),'forged tenant denied');
 perform pg_temp.assert_export_audit(event.after_redacted=jsonb_build_object('requestId',job.idempotency_key,'state','queued','version',1),'exact structural metadata only');
 perform pg_temp.assert_export_audit(not event.after_redacted ?| array['source','filters','context','rowCount','objectPath','productId','fileName','sessionId'],'no restricted fields or counts');
 filters:=jsonb_build_object('from',(clock_timestamp()-interval '1 day')::text,'to',(clock_timestamp()+interval '1 day')::text);
 filter_digest:=encode(extensions.digest(convert_to(public.m13_02_canonical_json(filters),'UTF8'),'sha256'),'hex');
 receipt:=public.m13_03_create_snapshot(org,actor,gen_random_uuid(),filter_digest,scope_digest);
 old_page:=public.m13_03_read_page(org,actor,(receipt->>'receiptId')::uuid,filter_digest,scope_digest,filters,array['audit_search'],null,null,null,100);
 perform pg_temp.assert_export_audit(not exists(select 1 from jsonb_array_elements(old_page)e where e->'event'->>'resourceType'='export_job'),'older explicit vector never expands');
 new_page:=public.m13_03_read_page(org,actor,(receipt->>'receiptId')::uuid,filter_digest,scope_digest,filters,array['export_job'],null,null,null,100);
 perform pg_temp.assert_export_audit(jsonb_array_length(new_page)=1 and new_page#>>'{0,event,resourceId}'=job.id::text,'fresh export job source reaches native page');
 insert into public.base_role_permission_overrides(organization_id,base_role,permissions) values(org,'owner','{"can_view_audit":false}');
 perform pg_temp.assert_export_audit(not public.m13_03_event_visible(org,actor,event),'current permission loss denies existing durable event');
 perform pg_temp.assert_export_audit(not has_function_privilege('service_role','public.m13_03_event_visible_cached(uuid,uuid,public.audit_logs,jsonb)','EXECUTE'),'private permission snapshot helper stays private');
end $$;
rollback;
