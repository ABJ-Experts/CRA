-- Cover foreign-key checks and retention joins independently of tenant-prefixed
-- listing indexes. Full indexes also support NULL-safe operational diagnostics.
create index report_definitions_owner_fk_idx on public.report_definitions(owner_user_id);
create index report_definitions_preview_fk_idx on public.report_definitions(organization_id,preview_run_id);
create index report_run_recipients_export_fk_idx on public.report_run_recipients(organization_id,export_job_id);
create index report_run_recipients_user_fk_idx on public.report_run_recipients(user_id);
create index report_runs_owner_fk_idx on public.report_runs(owner_user_id);

-- Eligibility is an immutable point-in-time preview diagnostic, never a grant.
-- Actual generation/delivery and activation continue to check fresh authority.
alter table public.report_runs add column recipient_eligibility jsonb not null default '[]'
 check(jsonb_typeof(recipient_eligibility)='array' and jsonb_array_length(recipient_eligibility)<=20);

create or replace function public.m14_04_freeze_run() returns trigger language plpgsql set search_path=pg_catalog,public as $$ begin
 if tg_op='DELETE' or (new.id,new.created_at,new.organization_id,new.definition_id,new.definition_version,new.owner_user_id,new.kind,new.config,new.config_digest,new.schema_version,new.source_schema_digest,new.scheduled_for,new.occurrence_key,new.recipient_eligibility)
 is distinct from (old.id,old.created_at,old.organization_id,old.definition_id,old.definition_version,old.owner_user_id,old.kind,old.config,old.config_digest,old.schema_version,old.source_schema_digest,old.scheduled_for,old.occurrence_key,old.recipient_eligibility)
 then raise exception 'report_snapshot_immutable' using errcode='55000';end if;return new;end $$;

create or replace function public.m14_04_get_run(p_organization_id uuid,p_actor_user_id uuid,p_run_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.report_runs;items jsonb;begin
 select * into r from public.report_runs where organization_id=p_organization_id and id=p_run_id;
 if not found or not public.m14_04_member(p_organization_id,p_actor_user_id) or (r.owner_user_id<>p_actor_user_id and not exists(select 1 from public.report_run_recipients where organization_id=p_organization_id and run_id=p_run_id and user_id=p_actor_user_id)) then raise exception 'report_access_denied' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'userId',q.user_id,'generationState',q.generation_state,'emailState',q.email_state,'safeErrorCode',q.safe_error_code,'expiresAt',q.expires_at,
 'artifacts',case when q.user_id=p_actor_user_id and q.generation_state='ready' and public.m14_04_authorize_recipient(p_organization_id,p_actor_user_id,p_run_id,q.id) then coalesce(public.m14_03_job_json(j)->'artifacts','[]') else '[]'::jsonb end) order by q.id),'[]') into items
 from public.report_run_recipients q left join public.export_jobs j on j.organization_id=q.organization_id and j.id=q.export_job_id where q.organization_id=p_organization_id and q.run_id=p_run_id and (r.owner_user_id=p_actor_user_id or q.user_id=p_actor_user_id);
 return jsonb_build_object('run',public.m14_04_run_json(r),'recipients',items,'recipientEligibility',case when r.owner_user_id=p_actor_user_id and r.kind='preview' then r.recipient_eligibility else '[]'::jsonb end);end $$;

create or replace function public.m14_04_preview(p_organization_id uuid,p_actor_user_id uuid,p_definition_id uuid,p_input jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.report_definitions;r public.report_runs;k uuid:=(p_input->>'idempotencyKey')::uuid;dig text:=public.m14_04_digest(p_input||jsonb_build_object('operation','preview'));response jsonb;eligibility jsonb;begin
 d:=public.m14_04_owned(p_organization_id,p_actor_user_id,p_definition_id);
 if d.commands ? k::text then if d.commands->k::text->>'digest'<>dig then raise exception 'report_idempotency_conflict' using errcode='P0001';end if;return d.commands->k::text->'response';end if;
 if (select count(*) from jsonb_object_keys(d.commands))>=1000 then raise exception 'report_command_limit' using errcode='22023';end if;
 if (d.version is distinct from (p_input->>'expectedVersion')::integer) or d.state='archived' or k is null then raise exception 'report_version_conflict' using errcode='P0001';end if;
 -- Validate the frozen structure and current owner first. Selected recipient
 -- membership/source failures are diagnostics, not owner-preview authority.
 perform public.m14_04_validate_config(p_organization_id,p_actor_user_id,jsonb_set(d.config,'{recipientUserIds}',jsonb_build_array(p_actor_user_id)));
 select jsonb_agg(jsonb_build_object('userId',selected.user_id,'state',case when selected.code is null then 'eligible' else 'ineligible' end,'safeErrorCode',selected.code) order by selected.ordinality)
 into eligibility from (
  select recipient.value::uuid user_id,recipient.ordinality,
   case when not public.m14_04_member(p_organization_id,recipient.value::uuid) then 'membership_ineligible'
    when not public.m14_04_source_access(p_organization_id,recipient.value::uuid,d.config) then 'source_access_denied' else null end code
  from jsonb_array_elements_text(d.config->'recipientUserIds') with ordinality recipient(value,ordinality)
 ) selected;
 if exists(select 1 from public.report_runs where organization_id=p_organization_id and definition_id=p_definition_id and state in ('scheduled','running')) then raise exception 'report_run_in_progress' using errcode='P0001';end if;
 insert into public.report_runs(organization_id,definition_id,definition_version,owner_user_id,kind,config,config_digest,schema_version,source_schema_digest,scheduled_for,occurrence_key,recipient_eligibility) values(p_organization_id,d.id,d.definition_version,d.owner_user_id,'preview',d.config,d.config_digest,d.schema_version,d.source_schema_digest,clock_timestamp(),'preview:'||k,eligibility) returning * into r;
 insert into public.report_run_recipients(organization_id,run_id,user_id,email_state) values(p_organization_id,r.id,p_actor_user_id,'off');
 update public.report_definitions set preview_run_id=r.id,version=version+1,updated_at=clock_timestamp() where organization_id=p_organization_id and id=d.id;
 perform public.m14_04_audit(p_organization_id,p_actor_user_id,r.id,'preview_requested',k,jsonb_build_object('recipientEligibility',eligibility));
 response:=public.m14_04_get_run(p_organization_id,p_actor_user_id,r.id);
 update public.report_definitions set commands=commands||jsonb_build_object(k::text,jsonb_build_object('digest',dig,'response',response)) where organization_id=p_organization_id and id=d.id;return response;end $$;

-- CREATE OR REPLACE retains existing service-only function ACLs.
