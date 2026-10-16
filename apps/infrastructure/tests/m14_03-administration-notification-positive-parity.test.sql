-- Populated administration and personal notification projections.
-- Fresh tenant fixtures and every source mutation are rolled back.
begin;
set local statement_timeout='30s';
create function pg_temp.assert_export_parity(p_org uuid,p_actor uuid,p_source text,p_filters jsonb,p_context jsonb,p_native jsonb)
returns void language plpgsql as $$
declare actual jsonb;expected jsonb;
begin
 if p_native is null or jsonb_typeof(p_native)<>'array' or jsonb_array_length(p_native)=0 then raise exception 'positive native fixture missing: %',p_source;end if;
 select jsonb_agg((select jsonb_object_agg(k.value,r.value#>string_to_array(k.value,'.')) from jsonb_array_elements_text(public.m14_03_source_policy(p_source)->'columns') k) order by r.ordinality)
 into expected from jsonb_array_elements(p_native) with ordinality r;
 select jsonb_agg(e.row_values order by e.ordinality) into actual from public.m14_03_source_rows(p_org,p_actor,p_source,p_filters,p_context) with ordinality e;
 if actual is distinct from expected then raise exception 'native row/filter/order/column parity failed: %',p_source;end if;
end $$;
do $$ declare o uuid:=gen_random_uuid();u uuid;u1 uuid;u2 uuid;role_id uuid:=gen_random_uuid();entity uuid:=gen_random_uuid();r record;native jsonb;blocked jsonb;source text;begin
 select id into strict u from public.users where email='owner@cra.test';
 insert into public.organizations(id,name,slug)values(o,'M14 administration fixture','m14-admin-'||o);
 insert into public.organization_members(organization_id,user_id,role)values(o,u,'owner');
 insert into public.users(email,first_name,last_name,username)values('m14-admin-one-'||o||'@example.test','M14needle','Ω One','m14-one-'||o) returning id into u1;
 insert into public.users(email,first_name,last_name,username)values('m14-admin-two-'||o||'@example.test','M14needle','Ω Two','m14-two-'||o) returning id into u2;
 insert into public.organization_members(organization_id,user_id,role,created_at)values(o,u1,'member',clock_timestamp()-interval '2 hours'),(o,u2,'viewer',clock_timestamp()-interval '1 hour');
 select jsonb_agg(jsonb_build_object('id',x.users->'id','firstName',x.users->'first_name','lastName',x.users->'last_name','email',x.users->'email','role',x.role,'isActive',x.users->'is_active','joinedAt',x.created_at)order by x.created_at desc,x.id) into native from public.m14_03_member_list_rows(o,'M14needle') x;
 perform pg_temp.assert_export_parity(o,u,'users.members','{"q":"M14needle","order":"desc"}','{}',native);
 if jsonb_array_length(native)<>2 then raise exception 'member excluded-row search failed';end if;
 insert into public.custom_roles(id,organization_id,name,base_role,permissions,created_at)values(role_id,o,'Visible Ω role','member','{"can_view_products":true}',clock_timestamp()-interval '1 hour');
 insert into public.custom_roles(organization_id,name,is_deleted,deleted_at,deleted_by)values(o,'Excluded deleted role',true,clock_timestamp(),u);
 select jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'baseRole',x.base_role,'isActive',x.is_active,'memberCount',x.user_role_assignments#>'{0,count}')order by x.created_at,x.id) into native from public.m14_03_role_list_rows(o)x;
 perform pg_temp.assert_export_parity(o,u,'roles.custom_roles','{}','{}',native);
 if jsonb_array_length(native)<>1 then raise exception 'deleted role exported';end if;
 insert into public.invitations(organization_id,invited_by,email,role,token_hash,expires_at,created_at)values(o,u,'m14-invite-live-'||o||'@example.test','member',repeat('a',64),clock_timestamp()+interval '1 day',clock_timestamp()),(o,u,'m14-invite-expired-'||o||'@example.test','viewer',repeat('b',64),clock_timestamp()-interval '1 day',clock_timestamp()-interval '1 hour');
 select jsonb_agg(jsonb_build_object('id',x.id,'email',x.email,'role',x.role,'status',x.status,'expiresAt',x.expires_at)order by x.created_at desc,x.id) into native from public.m14_03_invitation_list_rows(o)x;
 perform pg_temp.assert_export_parity(o,u,'invitations.pending','{}','{}',native);
 if native#>>'{1,status}'<>'expired' or exists(select 1 from public.invitations where organization_id=o and status<>'pending') then raise exception 'read-only expired invitation semantics changed lifecycle';end if;
 insert into public.organization_legal_entities(id,organization_id,identifier,display_name,completion_status,status,created_by,updated_by)values(entity,o,'m14-entity','Visible Ω entity','needs_completion','inactive',u,u);
 select * into r from public.get_organization_legal_entities(o,u);
 -- Native DTO naming is checked against the real source response below.
 native:=r.legal_entities;
 perform pg_temp.assert_export_parity(o,u,'organization.legal_entities','{}','{}',native);
 select * into r from public.get_organization_retention_policies(o);
 perform pg_temp.assert_export_parity(o,u,'organization.retention_policies','{}','{}',r.policies);
 insert into public.organization_export_jobs(organization_id,actor_user_id,request_digest,status)values(o,u,repeat('d',64),'queued');
 select jsonb_agg(jsonb_build_object('id',x.id,'status',x.status,'completedParts',x.completed_parts,'totalParts',x.total_parts,'attemptCount',x.attempt_count,'safeErrorCode',x.safe_error_code,'verifiedAt',x.verified_at,'createdAt',x.created_at,'updatedAt',x.updated_at)order by x.created_at desc,x.id) into native from public.organization_export_jobs x where x.organization_id=o;
 perform pg_temp.assert_export_parity(o,u,'organization.tenant_exports','{}','{}',native);
 update public.organization_settings set configured=true,version=1,timezone='Etc/UTC',working_days=array['monday'],notification_channel_ids=array['in_app'],maximum_session_age_minutes=60,ai_provider_id='test_ai',data_residency_id='local',holidays=array['2026-12-25'::date,'2027-01-01'::date] where organization_id=o;
 select jsonb_agg(jsonb_build_object('date',d::text)order by n) into native from public.organization_settings s cross join lateral unnest(s.holidays)with ordinality x(d,n)where s.organization_id=o;
 perform pg_temp.assert_export_parity(o,u,'organization.holidays','{}','{}',native);
 update public.organization_lifecycles set purge_block_reasons=jsonb_build_array(jsonb_build_object('kind','legal_hold','recordId',entity,'requiredRetentionDays',90),jsonb_build_object('kind','unavailable','code','dependency_unavailable','internalDiagnostics','Never export')) where organization_id=o;
 native:=public.m1_organization_lifecycle_json(o)->'blockers';
 perform pg_temp.assert_export_parity(o,u,'organization.lifecycle_blockers','{}','{}',native);
 insert into public.organization_onboarding_stages(organization_id,stage,stage_order,status)values(o,'organization_details',1,'pending'),(o,'first_product',2,'pending') on conflict(organization_id,stage)do nothing;
 select jsonb_agg(jsonb_build_object('stage',x.stage,'status',x.status,'blockReason',x.block_reason,'completedAt',x.completed_at,'completedBy',x.completed_by,'updatedAt',x.updated_at)order by x.stage_order) into native from public.organization_onboarding_stages x where x.organization_id=o;
 perform pg_temp.assert_export_parity(o,u,'onboarding.progress','{}','{}',native);
 foreach source in array array['users.members','roles.custom_roles','invitations.pending','organization.legal_entities','organization.retention_policies','organization.tenant_exports','organization.holidays','organization.lifecycle_blockers','onboarding.progress'] loop
 begin perform public.m14_03_source_rows(gen_random_uuid(),u,source,'{}','{}');raise exception 'forged administration tenant allowed: %',source;exception when insufficient_privilege then null;end;
 if exists(select 1 from public.m14_03_source_rows(o,u,source,'{}','{}') exported where exported.row_values ?| array['token_hash','permissions','internalDiagnostics','artifact_object_path'])then raise exception 'private administration field exported';end if;
 end loop;
 raise notice 'M14 nine nonempty administration sources native projection/filter/order and tenant denial';
end $$;
do $$ declare o uuid:='00000000-0000-4000-8000-0000000000ca';u uuid;viewer uuid;f uuid;e1 uuid:=gen_random_uuid();e2 uuid:=gen_random_uuid();w timestamptz:=date_bin(interval '2 minutes',clock_timestamp()-interval '4 minutes','2000-01-01'::timestamptz);r record;native jsonb;begin
 select id into strict u from public.users where email='owner@cra.test';select id into strict viewer from public.users where email='viewer@cra.test';
 select id into strict f from public.vulnerability_findings where organization_id=o and status='active' order by id limit 1;
 update public.organization_settings set notification_burst_enabled=true,notification_burst_started_at=w-interval '1 minute',notification_feed_started_at=w-interval '1 minute' where organization_id=o;
 insert into public.vulnerability_triage_alert_events(id,organization_id,finding_id,event_kind,event_key,state,due_at,created_at)values(e1,o,f,'internal_sla_breached','m14-feed:'||e1,'queued',w+interval '10 seconds',w+interval '10 seconds'),(e2,o,f,'internal_sla_breached','m14-feed:'||e2,'queued',w+interval '11 seconds',w+interval '11 seconds');
 select * into r from public.list_notification_feed_atomic(o,u,'finding_triage',null,'all',null,50);
 if r.result->>'nextCursor' is not null then raise exception 'fixture requires full native feed page';end if;
 perform pg_temp.assert_export_parity(o,u,'notifications.feed','{"category":"finding_triage","read":"all"}','{}',r.result->'items');
 select * into r from public.m12_06_list_filtered_feed_atomic(o,u,'finding_sla_breached',w,null,null,50);
 perform pg_temp.assert_export_parity(o,u,'notifications.feed_preview_items','{}',jsonb_build_object('eventClass','finding_sla_breached','windowStartsAt',w),r.result->'items');
 if jsonb_array_length(r.result->'items')<>2 then raise exception 'filtered preview does not contain exact two window events';end if;
 begin if exists(select 1 from public.m14_03_source_rows(o,viewer,'notifications.feed_preview_items','{}',jsonb_build_object('eventClass','finding_sla_breached','windowStartsAt',w)))then raise exception 'other principal inherited owner private events';end if;exception when insufficient_privilege then null;end;
 begin perform public.m14_03_source_rows(gen_random_uuid(),u,'notifications.feed','{}','{}');raise exception 'forged notification tenant allowed';exception when insufficient_privilege then null;end;
 raise notice 'M14 personal feed and exact-window preview native ordered approved projection parity';
end $$;
rollback;
