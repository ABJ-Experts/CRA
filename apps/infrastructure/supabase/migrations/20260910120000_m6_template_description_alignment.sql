alter table public.reporting_family_templates add column if not exists description text check (description is null or char_length(btrim(description)) between 1 and 2000);

create or replace function public.m6_reporting_family_template_json(p_organization_id uuid,p_template_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
 select jsonb_build_object('id',t.id,'organizationId',t.organization_id,'obligationType',t.obligation_type,'stage',t.stage_kind,'name',t.name,'description',t.description,
  'currentVersion',jsonb_build_object('id',v.id,'version',v.version,'fields',v.content->'fields','createdBy',jsonb_build_object('userId',v.created_by_user_id,'displayName',public.m6_actor_display_name(v.created_by_user_id)),'createdAt',public.m6_utc_second_z(v.created_at)),
  'createdBy',jsonb_build_object('userId',t.created_by_user_id,'displayName',public.m6_actor_display_name(t.created_by_user_id)),'createdAt',public.m6_utc_second_z(t.created_at),'archivedAt',case when t.archived_at is null then null else public.m6_utc_second_z(t.archived_at) end)
 from public.reporting_family_templates t join public.reporting_family_template_versions v on v.organization_id=t.organization_id and v.template_id=t.id and v.version=t.current_version
 where t.organization_id=p_organization_id and t.id=p_template_id
$$;

drop function if exists public.create_reporting_family_template_atomic(uuid,uuid,text,text,text,jsonb,uuid,uuid);
create or replace function public.create_reporting_family_template_atomic(p_organization_id uuid,p_actor_user_id uuid,p_name text,p_obligation_type text,p_stage_kind text,p_description text,p_content jsonb,p_idempotency_key uuid,p_correlation_id uuid default null)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.reporting_family_templates%rowtype; v_digest text; v_existing record; v_result jsonb; begin
 if p_idempotency_key is null or char_length(btrim(coalesce(p_name,''))) not between 1 and 200 or char_length(btrim(coalesce(p_description,''))) > 2000 or p_obligation_type not in ('actively_exploited_vulnerability','severe_incident') or p_stage_kind not in ('early_warning','notification','final_report') or jsonb_typeof(p_content)<>'object' or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_edit_organization') then return query select 'invalid_request',null::jsonb;return;end if;
 v_digest:=encode(extensions.digest(jsonb_build_object('name',btrim(p_name),'obligationType',p_obligation_type,'stageKind',p_stage_kind,'description',nullif(btrim(coalesce(p_description,'')),''),'content',p_content)::text,'sha256'),'hex');
 select * into v_existing from public.m6_reporting_draft_command_result(p_organization_id,p_actor_user_id,p_idempotency_key,'create_family_template',v_digest);
 if found then return query select v_existing.outcome,v_existing.result; return; end if;
 insert into public.reporting_family_templates(organization_id,name,description,obligation_type,stage_kind,created_by_user_id) values(p_organization_id,btrim(p_name),nullif(btrim(coalesce(p_description,'')),''),p_obligation_type,p_stage_kind,p_actor_user_id) returning * into t;
 insert into public.reporting_family_template_versions(organization_id,template_id,version,content,created_by_user_id) values(p_organization_id,t.id,1,p_content,p_actor_user_id);
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'reporting.family_template_created','reporting_family_template',t.id::text,jsonb_build_object('idempotencyKey',p_idempotency_key));
 v_result:=jsonb_build_object('template',public.m6_reporting_family_template_json(p_organization_id,t.id));
 perform public.m6_reporting_draft_command_store(p_organization_id,p_actor_user_id,p_idempotency_key,'create_family_template',v_digest,v_result);
 return query select 'created',v_result; end $$;

alter function public.m6_reporting_family_template_json(uuid,uuid) owner to postgres;
alter function public.create_reporting_family_template_atomic(uuid,uuid,text,text,text,text,jsonb,uuid,uuid) owner to postgres;
revoke all on function public.m6_reporting_family_template_json(uuid,uuid),public.create_reporting_family_template_atomic(uuid,uuid,text,text,text,text,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_reporting_family_template_atomic(uuid,uuid,text,text,text,text,jsonb,uuid,uuid) to service_role;
