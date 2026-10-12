-- Preview diagnostics never create recipient artifacts or notification authority.
begin;
set local statement_timeout='30s';
create or replace function pg_temp.check(p_name text,p_ok boolean) returns void language plpgsql as $$begin if not coalesce(p_ok,false) then raise exception 'check failed: %',p_name;end if;end$$;
do $$
declare org uuid:=gen_random_uuid();owner_id uuid:=gen_random_uuid();denied uuid:=gen_random_uuid();removed uuid:=gen_random_uuid();definition uuid;preview_id uuid;config jsonb;response jsonb;eligibility jsonb;request jsonb;
begin
 insert into public.users(id,email,first_name,is_active,email_verified_at)
 select id,'m14-preview-'||id||'@example.test','Preview fixture',true,clock_timestamp() from unnest(array[owner_id,denied,removed]) id;
 insert into public.organizations(id,name,slug) values(org,'Preview eligibility rollback fixture','m14-preview-'||org);
 insert into public.organization_members(organization_id,user_id,role) values(org,owner_id,'owner'),(org,denied,'member'),(org,removed,'member');
 config:=jsonb_build_object('title','Preview eligibility','report',jsonb_build_object('kind','list','source','products.registry','format','csv','filters','{}'::jsonb,'context','{}'::jsonb),'schedule',jsonb_build_object('frequency','daily','timezone','UTC','localTime','09:00'),'dateWindow',jsonb_build_object('kind','fixed'),'recipientUserIds',jsonb_build_array(owner_id,denied,removed),'emailEnabled',true);
 response:=public.m14_04_create_definition(org,owner_id,jsonb_build_object('config',config,'idempotencyKey',gen_random_uuid()),repeat('a',64));
 definition:=(response->'data'->>'id')::uuid;
 insert into public.base_role_permission_overrides(organization_id,base_role,permissions) values(org,'member','{"can_export_products":false}');
 delete from public.organization_members where organization_id=org and user_id=removed;
 request:=jsonb_build_object('expectedVersion',1,'idempotencyKey',gen_random_uuid());
 response:=public.m14_04_preview(org,owner_id,definition,request);
 preview_id:=(response->'run'->>'id')::uuid;eligibility:=response->'recipientEligibility';
 perform pg_temp.check('selected recipients have precise eligibility',eligibility=jsonb_build_array(
 jsonb_build_object('userId',owner_id,'state','eligible','safeErrorCode',null),
 jsonb_build_object('userId',denied,'state','ineligible','safeErrorCode','source_access_denied'),
 jsonb_build_object('userId',removed,'state','ineligible','safeErrorCode','membership_ineligible')));
 perform pg_temp.check('preview request idempotence includes eligibility',public.m14_04_preview(org,owner_id,definition,request)=response);
 perform pg_temp.check('preview generation remains owner only',(select count(*)=1 and bool_and(user_id=owner_id and email_state='off' and export_job_id is null) from public.report_run_recipients where organization_id=org and run_id=preview_id));
 perform pg_temp.check('preview sends no notification or export',(select count(*)=0 from public.notification_dispatches where organization_id=org) and (select count(*)=0 from public.export_jobs where organization_id=org));
 begin perform public.m14_04_get_run(org,denied,preview_id);raise exception 'nonowner preview disclosed';exception when insufficient_privilege then null;end;
 begin update public.report_runs set recipient_eligibility='[]' where organization_id=org and id=preview_id;raise exception 'eligibility snapshot changed';exception when object_not_in_prerequisite_state then null;end;
 delete from public.base_role_permission_overrides where organization_id=org and base_role='member';
 perform pg_temp.check('eligibility remains frozen after permission change',public.m14_04_get_run(org,owner_id,preview_id)->'recipientEligibility'=eligibility);
 update public.report_runs set state='succeeded',finished_at=clock_timestamp() where organization_id=org and id=preview_id;
 begin perform public.m14_04_mutate_definition(org,owner_id,definition,'activate',jsonb_build_object('expectedVersion',2,'idempotencyKey',gen_random_uuid(),'previewRunId',preview_id));raise exception 'activation ignored missing membership';exception when insufficient_privilege then null;end;
 insert into public.organization_members(organization_id,user_id,role) values(org,removed,'member');
 insert into public.base_role_permission_overrides(organization_id,base_role,permissions) values(org,'member','{"can_export_products":false}');
 begin perform public.m14_04_mutate_definition(org,owner_id,definition,'activate',jsonb_build_object('expectedVersion',2,'idempotencyKey',gen_random_uuid(),'previewRunId',preview_id));raise exception 'activation ignored source denial';exception when insufficient_privilege then null;end;
end $$;
rollback;
