-- M6-03: tenant-scoped collaborative reporting drafts. Drafts and submissions
-- are deliberately separate from deadline metadata so submitted content remains immutable.

create table public.reporting_stage_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  obligation_id uuid not null,
  stage_id uuid not null,
  release_id uuid not null,
  content jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
  field_provenance jsonb not null default '{}'::jsonb check (jsonb_typeof(field_provenance) = 'object'),
  member_states jsonb not null default '[]'::jsonb check (jsonb_typeof(member_states) = 'array'),
  prepopulated_from_submission_id uuid,
  version integer not null default 1 check (version > 0),
  locked_by_user_id uuid references public.users(id) on delete restrict,
  lock_token uuid,
  lock_expires_at timestamptz,
  created_by_user_id uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id),
  unique (organization_id, stage_id),
  foreign key (organization_id, obligation_id) references public.reporting_obligations(organization_id, id) on delete cascade,
  foreign key (organization_id, stage_id) references public.reporting_obligation_stages(organization_id, id) on delete cascade,
  foreign key (organization_id, release_id) references public.product_releases(organization_id, id) on delete restrict,
  check ((locked_by_user_id is null) = (lock_token is null)),
  check ((locked_by_user_id is null) = (lock_expires_at is null))
);

create table public.reporting_stage_draft_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  draft_id uuid not null,
  revision integer not null check (revision > 0),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  field_provenance jsonb not null check (jsonb_typeof(field_provenance) = 'object'),
  member_states jsonb not null check (jsonb_typeof(member_states) = 'array'),
  changed_by_user_id uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id), unique (organization_id, draft_id, revision),
  foreign key (organization_id, draft_id) references public.reporting_stage_drafts(organization_id, id) on delete cascade
);

create table public.reporting_stage_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  obligation_id uuid not null,
  stage_id uuid not null,
  draft_id uuid not null,
  draft_revision integer not null check (draft_revision > 0),
  release_id uuid not null,
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  field_provenance jsonb not null check (jsonb_typeof(field_provenance) = 'object'),
  member_states jsonb not null check (jsonb_typeof(member_states) = 'array'),
  submission_reference text not null check (char_length(btrim(submission_reference)) between 1 and 1000),
  submitted_by_user_id uuid not null references public.users(id) on delete restrict,
  submitted_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id), unique (organization_id, stage_id),
  foreign key (organization_id, obligation_id) references public.reporting_obligations(organization_id, id) on delete cascade,
  foreign key (organization_id, stage_id) references public.reporting_obligation_stages(organization_id, id) on delete restrict,
  foreign key (organization_id, draft_id) references public.reporting_stage_drafts(organization_id, id) on delete restrict,
  foreign key (organization_id, release_id) references public.product_releases(organization_id, id) on delete restrict
);

create table public.reporting_family_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  description text check (description is null or char_length(btrim(description)) between 1 and 2000),
  obligation_type text not null check (obligation_type in ('actively_exploited_vulnerability', 'severe_incident')),
  stage_kind text not null check (stage_kind in ('early_warning', 'notification', 'final_report')),
  current_version integer not null default 1 check (current_version > 0),
  archived_at timestamptz,
  created_by_user_id uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id)
);

create table public.reporting_family_template_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  template_id uuid not null,
  version integer not null check (version > 0),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  created_by_user_id uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id), unique (organization_id, template_id, version),
  foreign key (organization_id, template_id) references public.reporting_family_templates(organization_id, id) on delete cascade
);

-- Mutations are not automatically replayed by the browser. This narrow ledger
-- makes explicit user retries safe without coupling drafts to another feature's commands.
create table public.reporting_stage_draft_commands (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid not null references public.users(id) on delete restrict, idempotency_key uuid not null,
  operation text not null, request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'), result jsonb not null check (jsonb_typeof(result)='object'),
  created_at timestamptz not null default clock_timestamp(), unique(organization_id,actor_user_id,idempotency_key)
);

create index reporting_stage_drafts_org_obligation_idx on public.reporting_stage_drafts(organization_id, obligation_id);
create index reporting_stage_draft_revisions_draft_idx on public.reporting_stage_draft_revisions(organization_id, draft_id, revision desc);
create index reporting_family_templates_org_kind_idx on public.reporting_family_templates(organization_id, obligation_type, stage_kind) where archived_at is null;
create trigger set_reporting_stage_drafts_updated_at before update on public.reporting_stage_drafts for each row execute function public.set_updated_at();
create trigger set_reporting_family_templates_updated_at before update on public.reporting_family_templates for each row execute function public.set_updated_at();

alter table public.reporting_stage_drafts enable row level security;
alter table public.reporting_stage_draft_revisions enable row level security;
alter table public.reporting_stage_submissions enable row level security;
alter table public.reporting_family_templates enable row level security;
alter table public.reporting_family_template_versions enable row level security;
alter table public.reporting_stage_draft_commands enable row level security;
revoke all on table public.reporting_stage_drafts, public.reporting_stage_draft_revisions, public.reporting_stage_submissions, public.reporting_family_templates, public.reporting_family_template_versions, public.reporting_stage_draft_commands from public, anon, authenticated;
grant all on table public.reporting_stage_drafts, public.reporting_stage_draft_revisions, public.reporting_stage_submissions, public.reporting_family_templates, public.reporting_family_template_versions, public.reporting_stage_draft_commands to service_role;

create or replace function public.m6_reporting_draft_command_result(p_organization_id uuid,p_actor_user_id uuid,p_idempotency_key uuid,p_operation text,p_digest text)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.reporting_stage_draft_commands%rowtype;
begin
 -- Serializes an absent command too: a row lock alone cannot protect the first retry.
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_actor_user_id::text || ':' || p_idempotency_key::text, 0));
 select * into c from public.reporting_stage_draft_commands where organization_id=p_organization_id and actor_user_id=p_actor_user_id and idempotency_key=p_idempotency_key for update;
 if found then
  if c.operation=p_operation and c.request_digest=p_digest then return query select 'idempotent',c.result;
  else return query select 'conflict',null::jsonb; end if;
 end if;
end $$;

create or replace function public.m6_reporting_draft_command_store(p_organization_id uuid,p_actor_user_id uuid,p_idempotency_key uuid,p_operation text,p_digest text,p_result jsonb)
returns void language sql security definer set search_path=public,pg_temp as $$
 insert into public.reporting_stage_draft_commands(organization_id,actor_user_id,idempotency_key,operation,request_digest,result)
 values(p_organization_id,p_actor_user_id,p_idempotency_key,p_operation,p_digest,p_result)
$$;

-- The required content specification is deliberately versioned in this migration,
-- rather than inferred from mutable drafts or browser state. New specifications are
-- introduced by a later migration; existing drafts keep their snapshots.
create or replace function public.m6_reporting_stage_field_definitions(p_obligation_type text,p_stage_kind text)
returns jsonb language sql immutable set search_path = public, pg_temp as $$
 select case p_stage_kind
  when 'early_warning' then jsonb_build_array(
   jsonb_build_object('key','summary','label','Initial summary','description','What happened and why this report is required.','type','long_text','required',true,'requiredWhen',null,'templateEligible',true),
   jsonb_build_object('key','impact','label','Known impact','description','Known or reasonably suspected impact.','type','long_text','required',true,'requiredWhen',null,'templateEligible',true),
   jsonb_build_object('key','member_states','label','Affected Member States','description','Release-scoped market availability, corrected where necessary.','type','member_states','required',true,'requiredWhen',null,'templateEligible',false))
  when 'notification' then jsonb_build_array(
   jsonb_build_object('key','summary','label','Notification summary','description','Current description of the event.','type','long_text','required',true,'requiredWhen',null,'templateEligible',true),
   jsonb_build_object('key','impact','label','Impact assessment','description','Impact, scope and affected parties.','type','long_text','required',true,'requiredWhen',null,'templateEligible',true),
   jsonb_build_object('key','mitigation','label','Mitigation','description','Containment or mitigation completed or planned.','type','long_text','required',true,'requiredWhen',null,'templateEligible',true),
   jsonb_build_object('key','member_states','label','Affected Member States','description','Release-scoped market availability, corrected where necessary.','type','member_states','required',true,'requiredWhen',null,'templateEligible',false))
  when 'final_report' then jsonb_build_array(
   jsonb_build_object('key','summary','label','Final summary','description','Final account of the reportable event.','type','long_text','required',true,'requiredWhen',null,'templateEligible',true),
   jsonb_build_object('key','impact','label','Final impact','description','Confirmed impact and scope.','type','long_text','required',true,'requiredWhen',null,'templateEligible',true),
   jsonb_build_object('key','root_cause','label','Root cause','description','Confirmed root cause or investigation conclusion.','type','long_text','required',true,'requiredWhen',null,'templateEligible',true),
   jsonb_build_object('key','corrective_actions','label','Corrective actions','description','Corrective and preventive actions.','type','long_text','required',true,'requiredWhen',null,'templateEligible',true),
   jsonb_build_object('key','member_states','label','Affected Member States','description','Release-scoped market availability, corrected where necessary.','type','member_states','required',true,'requiredWhen',null,'templateEligible',false))
  else '[]'::jsonb end
$$;

create or replace function public.m6_reporting_draft_fields(p_content jsonb,p_provenance jsonb,p_definitions jsonb,p_updated_at timestamptz)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object(
  'value',jsonb_build_object('key',definition->>'key','type',definition->>'type','value',p_content->(definition->>'key')),
  'provenance',coalesce(p_provenance->(definition->>'key'),jsonb_build_object('origin','platform','source','draft initialization','recordedAt',public.m6_utc_second_z(p_updated_at))),
  'updatedAt',public.m6_utc_second_z(p_updated_at)) order by definition->>'key'),'[]'::jsonb)
 from jsonb_array_elements(p_definitions) definition
 where definition->>'type' <> 'member_states'
$$;

create or replace function public.m6_reporting_draft_complete(p_content jsonb,p_definitions jsonb,p_member_states jsonb)
returns boolean language sql immutable set search_path = public, pg_temp as $$
 select jsonb_typeof(p_content)='object' and jsonb_typeof(p_member_states)='array'
  and not exists (
   select 1 from jsonb_array_elements(p_definitions) definition
   where (definition->>'required')::boolean
    and ((definition->>'type'='member_states' and jsonb_array_length(p_member_states)=0)
      or (definition->>'type' in ('short_text','long_text') and coalesce(nullif(btrim(p_content->>(definition->>'key')),''),'')='')
      or (definition->>'type'='boolean' and jsonb_typeof(p_content->(definition->>'key')) <> 'boolean'))
  )
$$;

create or replace function public.m6_reporting_draft_json(p_organization_id uuid, p_draft_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
 select jsonb_build_object('id',d.id,'organizationId',d.organization_id,'obligationId',d.obligation_id,'stageId',d.stage_id,'releaseId',d.release_id,
  'stage',s.stage_kind,'fieldDefinitions',public.m6_reporting_stage_field_definitions(o.obligation_type,s.stage_kind),
  'fields',public.m6_reporting_draft_fields(d.content,d.field_provenance,public.m6_reporting_stage_field_definitions(o.obligation_type,s.stage_kind),d.updated_at),
  'memberStates',coalesce((select jsonb_agg(jsonb_build_object('countryCode',country,'provenance',coalesce(d.field_provenance->'_memberStates'->country,jsonb_build_object('origin','platform','source','release market availability','recordedAt',public.m6_utc_second_z(d.updated_at)))) order by country) from jsonb_array_elements_text(d.member_states) country),'[]'::jsonb),'revision',d.version,
  'completeness',case when public.m6_reporting_draft_complete(d.content,public.m6_reporting_stage_field_definitions(o.obligation_type,s.stage_kind),d.member_states) then 'valid' else 'incomplete' end,
  'status',case when exists(select 1 from public.reporting_stage_submissions s where s.organization_id=d.organization_id and s.stage_id=d.stage_id) then 'submitted' when d.lock_expires_at > clock_timestamp() then 'locked' else 'editable' end,
  'requiresTemplateReview',coalesce((d.field_provenance->'_template'->>'reviewRequired')::boolean,false),
  'prepopulatedFromSubmissionId',d.prepopulated_from_submission_id,'lock',case when not exists(select 1 from public.reporting_stage_submissions submitted where submitted.organization_id=d.organization_id and submitted.stage_id=d.stage_id) and d.lock_expires_at > clock_timestamp() then jsonb_build_object('heldBy',jsonb_build_object('userId',d.locked_by_user_id,'displayName',public.m6_actor_display_name(d.locked_by_user_id)),'expiresAt',public.m6_utc_second_z(d.lock_expires_at)) else null end,
  'createdBy',jsonb_build_object('userId',d.created_by_user_id,'displayName',public.m6_actor_display_name(d.created_by_user_id)),'createdAt',public.m6_utc_second_z(d.created_at),'updatedAt',public.m6_utc_second_z(d.updated_at))
 from public.reporting_stage_drafts d join public.reporting_obligations o on o.organization_id=d.organization_id and o.id=d.obligation_id join public.reporting_obligation_stages s on s.organization_id=d.organization_id and s.id=d.stage_id where d.organization_id=p_organization_id and d.id=p_draft_id
$$;

create or replace function public.m6_reporting_family_template_json(p_organization_id uuid,p_template_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
 select jsonb_build_object(
  'id',t.id,'organizationId',t.organization_id,'obligationType',t.obligation_type,'stage',t.stage_kind,'name',t.name,'description',null,
  'currentVersion',jsonb_build_object('id',v.id,'version',v.version,'fields',v.content->'fields','createdBy',jsonb_build_object('userId',v.created_by_user_id,'displayName',public.m6_actor_display_name(v.created_by_user_id)),'createdAt',public.m6_utc_second_z(v.created_at)),
  'createdBy',jsonb_build_object('userId',t.created_by_user_id,'displayName',public.m6_actor_display_name(t.created_by_user_id)),'createdAt',public.m6_utc_second_z(t.created_at),'archivedAt',case when t.archived_at is null then null else public.m6_utc_second_z(t.archived_at) end)
 from public.reporting_family_templates t join public.reporting_family_template_versions v on v.organization_id=t.organization_id and v.template_id=t.id and v.version=t.current_version
 where t.organization_id=p_organization_id and t.id=p_template_id
$$;

create or replace function public.m6_reporting_submission_json(p_organization_id uuid,p_submission_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
 select jsonb_build_object('id',submission.id,'organizationId',submission.organization_id,'draftId',submission.draft_id,'obligationId',submission.obligation_id,'stageId',submission.stage_id,'releaseId',submission.release_id,'stage',stage.stage_kind,'draftRevision',submission.draft_revision,
  'fields',public.m6_reporting_draft_fields(submission.content,submission.field_provenance,public.m6_reporting_stage_field_definitions(obligation.obligation_type,stage.stage_kind),submission.submitted_at),
  'memberStates',coalesce((select jsonb_agg(jsonb_build_object('countryCode',country,'provenance',coalesce(submission.field_provenance->'_memberStates'->country,jsonb_build_object('origin','platform','source','release market availability','recordedAt',public.m6_utc_second_z(submission.submitted_at)))) order by country) from jsonb_array_elements_text(submission.member_states) country),'[]'::jsonb),
  'submittedBy',jsonb_build_object('userId',submission.submitted_by_user_id,'displayName',public.m6_actor_display_name(submission.submitted_by_user_id)),'submittedAt',public.m6_utc_second_z(submission.submitted_at),'submissionReference',submission.submission_reference)
 from public.reporting_stage_submissions submission join public.reporting_obligations obligation on obligation.organization_id=submission.organization_id and obligation.id=submission.obligation_id join public.reporting_obligation_stages stage on stage.organization_id=submission.organization_id and stage.id=submission.stage_id
 where submission.organization_id=p_organization_id and submission.id=p_submission_id
$$;

create or replace function public.m6_reporting_draft_valid(p_content jsonb, p_provenance jsonb, p_member_states jsonb)
returns boolean language sql immutable set search_path = public, pg_temp as $$
 select jsonb_typeof(p_content)='object' and jsonb_typeof(p_provenance)='object' and jsonb_typeof(p_member_states)='array'
  and not exists (select 1 from jsonb_each(p_content) f where not p_provenance ? f.key)
  and not exists (select 1 from jsonb_each(p_provenance) f where f.key <> '_memberStates' and (jsonb_typeof(f.value) <> 'object' or coalesce(f.value->>'origin','') not in ('human','platform','ai_accepted')))
  and not exists (select 1 from jsonb_array_elements(p_member_states) state where jsonb_typeof(state) <> 'string' or trim(both '"' from state::text) !~ '^[A-Z]{2}$')
$$;

create or replace function public.m6_reporting_template_content_valid(p_content jsonb, p_obligation_type text, p_stage_kind text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
 select jsonb_typeof(p_content)='object'
  and jsonb_typeof(p_content->'fields')='array'
  and jsonb_array_length(p_content->'fields') <= 100
  and (select count(*)=count(distinct field->'value'->>'key') from jsonb_array_elements(p_content->'fields') field)
  and not exists (
   select 1
   from jsonb_array_elements(p_content->'fields') field
   where field->'value'->>'type'='member_states'
    or not exists (
      select 1
      from jsonb_array_elements(public.m6_reporting_stage_field_definitions(p_obligation_type,p_stage_kind)) definition
      where definition->>'key'=field->'value'->>'key'
       and definition->>'type'=field->'value'->>'type'
       and (definition->>'templateEligible')::boolean
    )
  )
$$;

create or replace function public.create_reporting_stage_draft_atomic(p_organization_id uuid,p_actor_user_id uuid,p_obligation_id uuid,p_stage_id uuid,p_release_id uuid,p_idempotency_key uuid,p_correlation_id uuid default null)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.reporting_stage_drafts%rowtype; v_content jsonb:='{}'; v_provenance jsonb:='{}'; v_states jsonb; v_previous uuid; v_digest text; v_existing record; v_result jsonb;
begin
 if p_organization_id is null or p_actor_user_id is null or p_idempotency_key is null or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_edit_findings') then return query select 'not_found',null::jsonb; return; end if;
 v_digest:=encode(extensions.digest(jsonb_build_object('obligationId',p_obligation_id,'stageId',p_stage_id,'releaseId',p_release_id)::text,'sha256'),'hex');
 select * into v_existing from public.m6_reporting_draft_command_result(p_organization_id,p_actor_user_id,p_idempotency_key,'create_stage_draft',v_digest);
 if found then return query select v_existing.outcome,v_existing.result; return; end if;
 select jsonb_agg(a.country_code order by a.country_code) into v_states from public.product_release_market_availability a where a.organization_id=p_organization_id and a.release_id=p_release_id and a.unavailable_at is null;
 if not exists(select 1 from public.reporting_obligation_stages s join public.reporting_obligations o on o.organization_id=s.organization_id and o.id=s.obligation_id join public.product_releases r on r.organization_id=p_organization_id and r.id=p_release_id where s.organization_id=p_organization_id and s.id=p_stage_id and s.obligation_id=p_obligation_id and o.status='active') then return query select 'not_found',null::jsonb; return; end if;
 select sub.id,sub.content,sub.field_provenance into v_previous,v_content,v_provenance from public.reporting_stage_submissions sub join public.reporting_obligation_stages prev on prev.organization_id=sub.organization_id and prev.id=sub.stage_id where sub.organization_id=p_organization_id and sub.obligation_id=p_obligation_id and (case prev.stage_kind when 'early_warning' then 1 when 'notification' then 2 else 3 end) < (select case stage_kind when 'early_warning' then 1 when 'notification' then 2 else 3 end from public.reporting_obligation_stages where organization_id=p_organization_id and id=p_stage_id) order by sub.submitted_at desc limit 1;
 insert into public.reporting_stage_drafts(organization_id,obligation_id,stage_id,release_id,content,field_provenance,member_states,prepopulated_from_submission_id,created_by_user_id) values(p_organization_id,p_obligation_id,p_stage_id,p_release_id,coalesce(v_content,'{}'),coalesce(v_provenance,'{}'),coalesce(v_states,'[]'),v_previous,p_actor_user_id) on conflict(organization_id,stage_id) do nothing returning * into d;
 if not found then
  select * into d from public.reporting_stage_drafts where organization_id=p_organization_id and stage_id=p_stage_id;
  v_result:=jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d.id));
  perform public.m6_reporting_draft_command_store(p_organization_id,p_actor_user_id,p_idempotency_key,'create_stage_draft',v_digest,v_result);
  return query select 'found',v_result; return;
 end if;
 insert into public.reporting_stage_draft_revisions(organization_id,draft_id,revision,content,field_provenance,member_states,changed_by_user_id) values(p_organization_id,d.id,1,d.content,d.field_provenance,d.member_states,p_actor_user_id);
 insert into public.reporting_obligation_events(organization_id,obligation_id,event_kind,stage_kind,actor_user_id,actor_display_name,new_value,correlation_id) values(p_organization_id,p_obligation_id,'draft_created', (select stage_kind from public.reporting_obligation_stages where id=p_stage_id),p_actor_user_id,public.m6_actor_display_name(p_actor_user_id),jsonb_build_object('draftId',d.id),p_correlation_id);
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'reporting.stage_draft_created','reporting_stage_draft',d.id::text,jsonb_build_object('idempotencyKey',p_idempotency_key));
 v_result:=jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d.id));
 perform public.m6_reporting_draft_command_store(p_organization_id,p_actor_user_id,p_idempotency_key,'create_stage_draft',v_digest,v_result);
 return query select 'created',v_result;
end $$;

create or replace function public.get_reporting_stage_draft(p_organization_id uuid,p_actor_user_id uuid,p_stage_id uuid)
returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path = public, pg_temp as $$
declare d uuid; begin if not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_findings') then return query select 'not_found',null::jsonb; return; end if; select id into d from public.reporting_stage_drafts where organization_id=p_organization_id and stage_id=p_stage_id; if d is null then return query select 'not_found',null::jsonb; else return query select 'found',jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d)); end if; end $$;

create or replace function public.acquire_reporting_stage_draft_lock_atomic(p_organization_id uuid,p_actor_user_id uuid,p_draft_id uuid,p_expected_version integer,p_idempotency_key uuid,p_correlation_id uuid default null)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.reporting_stage_drafts%rowtype; v_token uuid:=gen_random_uuid(); v_digest text; v_existing record; v_result jsonb; begin
 if p_idempotency_key is null or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_edit_findings') then return query select 'not_found',null::jsonb;return;end if;
 v_digest:=encode(extensions.digest(jsonb_build_object('draftId',p_draft_id,'expectedVersion',p_expected_version)::text,'sha256'),'hex');
 select * into v_existing from public.m6_reporting_draft_command_result(p_organization_id,p_actor_user_id,p_idempotency_key,'acquire_stage_draft_lock',v_digest);
 if found then return query select v_existing.outcome,v_existing.result; return; end if;
 select * into d from public.reporting_stage_drafts where organization_id=p_organization_id and id=p_draft_id for update; if not found then return query select 'not_found',null::jsonb;return;end if;
 if exists(select 1 from public.reporting_stage_submissions where organization_id=p_organization_id and stage_id=d.stage_id) then return query select 'invalid_state',jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d.id));return;end if;
 if d.version<>p_expected_version then return query select 'conflict',jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d.id));return;end if;
 if d.lock_expires_at>clock_timestamp() and d.locked_by_user_id<>p_actor_user_id then return query select 'locked',jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d.id));return;end if;
 update public.reporting_stage_drafts set locked_by_user_id=p_actor_user_id,lock_token=v_token,lock_expires_at=date_trunc('second',clock_timestamp()+interval '10 minutes') where organization_id=p_organization_id and id=p_draft_id;
 v_result:=jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,p_draft_id),'lockToken',v_token);
 perform public.m6_reporting_draft_command_store(p_organization_id,p_actor_user_id,p_idempotency_key,'acquire_stage_draft_lock',v_digest,v_result);
 return query select 'updated',v_result; end $$;

create or replace function public.save_reporting_stage_draft_atomic(p_organization_id uuid,p_actor_user_id uuid,p_draft_id uuid,p_expected_version integer,p_lock_token uuid,p_content jsonb,p_field_provenance jsonb,p_member_states jsonb,p_idempotency_key uuid,p_correlation_id uuid default null)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.reporting_stage_drafts%rowtype; v_digest text; v_existing record; v_result jsonb; v_provenance jsonb; v_states jsonb; v_recorded_at text:=public.m6_utc_second_z(clock_timestamp()); begin
 if p_idempotency_key is null or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_edit_findings')
    or jsonb_typeof(p_content)<>'object' or jsonb_typeof(p_field_provenance)<>'object' or jsonb_typeof(p_member_states)<>'array'
    or exists(select 1 from jsonb_each(p_content) field where not p_field_provenance ? field.key)
    or exists(select 1 from jsonb_each(p_field_provenance) field where not p_content ? field.key or jsonb_typeof(field.value)<>'object'
      or coalesce(field.value->>'origin','') not in ('human','platform','ai_accepted')
      or (field.value->>'origin'='ai_accepted' and coalesce(field.value->'acceptedBy'->>'userId','')<>p_actor_user_id::text))
    or exists(select 1 from jsonb_array_elements(p_member_states) state where jsonb_typeof(state)<>'object' or coalesce(state->>'countryCode','') !~ '^[A-Z]{2}$'
      or jsonb_typeof(state->'provenance')<>'object' or coalesce(state->'provenance'->>'origin','') not in ('human','platform','ai_accepted')
      or (state->'provenance'->>'origin'='ai_accepted' and coalesce(state->'provenance'->'acceptedBy'->>'userId','')<>p_actor_user_id::text)) then
  return query select 'invalid_request',null::jsonb;return;
 end if;
 v_digest:=encode(extensions.digest(jsonb_build_object('draftId',p_draft_id,'expectedVersion',p_expected_version,'lockToken',p_lock_token,'content',p_content,'fieldProvenance',p_field_provenance,'memberStates',p_member_states)::text,'sha256'),'hex');
 select * into v_existing from public.m6_reporting_draft_command_result(p_organization_id,p_actor_user_id,p_idempotency_key,'save_stage_draft',v_digest);
 if found then return query select v_existing.outcome,v_existing.result; return; end if;
 -- The browser can describe an AI acceptance but cannot choose the accepting identity or timestamp.
 select coalesce(jsonb_object_agg(field.key,case when field.value->>'origin'='ai_accepted' then jsonb_build_object('origin','ai_accepted','acceptedBy',jsonb_build_object('userId',p_actor_user_id,'displayName',public.m6_actor_display_name(p_actor_user_id)),'acceptedAt',v_recorded_at,'suggestionReference',field.value->>'suggestionReference') else jsonb_build_object('origin','human','actor',jsonb_build_object('userId',p_actor_user_id,'displayName',public.m6_actor_display_name(p_actor_user_id)),'recordedAt',v_recorded_at) end),'{}'::jsonb) into v_provenance from jsonb_each(p_field_provenance) field;
 select coalesce(jsonb_agg(country order by country),'[]'::jsonb) into v_states from (select distinct state->>'countryCode' country from jsonb_array_elements(p_member_states) state) states;
 if jsonb_array_length(v_states) > 27 then return query select 'invalid_request',null::jsonb;return;end if;
 v_provenance:=v_provenance || jsonb_build_object('_memberStates',coalesce((select jsonb_object_agg(state->>'countryCode',case when state->'provenance'->>'origin'='ai_accepted' then jsonb_build_object('origin','ai_accepted','acceptedBy',jsonb_build_object('userId',p_actor_user_id,'displayName',public.m6_actor_display_name(p_actor_user_id)),'acceptedAt',v_recorded_at,'suggestionReference',state->'provenance'->>'suggestionReference') else jsonb_build_object('origin','human','actor',jsonb_build_object('userId',p_actor_user_id,'displayName',public.m6_actor_display_name(p_actor_user_id)),'recordedAt',v_recorded_at) end) from jsonb_array_elements(p_member_states) state),'{}'::jsonb));
 if not public.m6_reporting_draft_valid(p_content,v_provenance,v_states) then return query select 'invalid_request',null::jsonb;return;end if;
 select * into d from public.reporting_stage_drafts where organization_id=p_organization_id and id=p_draft_id for update; if not found then return query select 'not_found',null::jsonb;return;end if;
 if exists(select 1 from public.reporting_stage_submissions where organization_id=p_organization_id and stage_id=d.stage_id) then return query select 'invalid_state',jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d.id));return;end if;
 if d.lock_expires_at is null or d.lock_expires_at<=clock_timestamp() or d.locked_by_user_id<>p_actor_user_id or d.lock_token<>p_lock_token then return query select 'locked',jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d.id));return;end if;
 if d.version<>p_expected_version then return query select 'conflict',jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d.id));return;end if;
 update public.reporting_stage_drafts set content=p_content,field_provenance=v_provenance,member_states=v_states,version=version+1 where organization_id=p_organization_id and id=p_draft_id returning * into d;
 insert into public.reporting_stage_draft_revisions(organization_id,draft_id,revision,content,field_provenance,member_states,changed_by_user_id) values(p_organization_id,d.id,d.version,d.content,d.field_provenance,d.member_states,p_actor_user_id);
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'reporting.stage_draft_saved','reporting_stage_draft',d.id::text,jsonb_build_object('idempotencyKey',p_idempotency_key));
 v_result:=jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d.id));
 perform public.m6_reporting_draft_command_store(p_organization_id,p_actor_user_id,p_idempotency_key,'save_stage_draft',v_digest,v_result);
 return query select 'updated',v_result; end $$;

-- The existing metadata-only submission RPC remains compatible. New callers use this
-- transactional content snapshot before recording the external filing reference.
create or replace function public.submit_reporting_stage_draft_atomic(p_organization_id uuid,p_actor_user_id uuid,p_draft_id uuid,p_expected_version integer,p_lock_token uuid,p_submission_reference text,p_idempotency_key uuid,p_correlation_id uuid default null)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.reporting_stage_drafts%rowtype; v_submission uuid; v_digest text; v_existing record; v_result jsonb; begin
 if p_idempotency_key is null or char_length(btrim(coalesce(p_submission_reference,''))) not between 1 and 1000 or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_edit_findings') then return query select 'invalid_request',null::jsonb;return;end if;
 v_digest:=encode(extensions.digest(jsonb_build_object('draftId',p_draft_id,'expectedVersion',p_expected_version,'lockToken',p_lock_token,'submissionReference',btrim(p_submission_reference))::text,'sha256'),'hex');
 select * into v_existing from public.m6_reporting_draft_command_result(p_organization_id,p_actor_user_id,p_idempotency_key,'submit_stage_draft',v_digest);
 if found then return query select v_existing.outcome,v_existing.result; return; end if;
 select * into d from public.reporting_stage_drafts where organization_id=p_organization_id and id=p_draft_id for update; if not found then return query select 'not_found',null::jsonb;return;end if;
 if exists(select 1 from public.reporting_stage_submissions where organization_id=p_organization_id and stage_id=d.stage_id) then return query select 'invalid_state',jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d.id));return;end if;
 if d.lock_expires_at is null or d.lock_expires_at<=clock_timestamp() or d.locked_by_user_id<>p_actor_user_id or d.lock_token<>p_lock_token then return query select 'locked',jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d.id));return;end if;
 if d.version<>p_expected_version then return query select 'conflict',jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d.id));return;end if;
 if not public.m6_reporting_draft_valid(d.content,d.field_provenance,d.member_states)
    or not public.m6_reporting_draft_complete(d.content,public.m6_reporting_stage_field_definitions((select obligation_type from public.reporting_obligations where organization_id=p_organization_id and id=d.obligation_id),(select stage_kind from public.reporting_obligation_stages where organization_id=p_organization_id and id=d.stage_id)),d.member_states) then return query select 'invalid_request',jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d.id));return;end if;
 if coalesce((d.field_provenance->'_template'->>'reviewRequired')::boolean,false) then return query select 'invalid_state',jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d.id));return;end if;
 insert into public.reporting_stage_submissions(organization_id,obligation_id,stage_id,draft_id,draft_revision,release_id,content,field_provenance,member_states,submission_reference,submitted_by_user_id) values(p_organization_id,d.obligation_id,d.stage_id,d.id,d.version,d.release_id,d.content,d.field_provenance,d.member_states,btrim(p_submission_reference),p_actor_user_id) returning id into v_submission;
 update public.reporting_stage_drafts set locked_by_user_id=null,lock_token=null,lock_expires_at=null where organization_id=p_organization_id and id=d.id;
 insert into public.reporting_obligation_events(organization_id,obligation_id,event_kind,stage_kind,actor_user_id,actor_display_name,new_value,correlation_id) values(p_organization_id,d.obligation_id,'draft_submitted',(select stage_kind from public.reporting_obligation_stages where id=d.stage_id),p_actor_user_id,public.m6_actor_display_name(p_actor_user_id),jsonb_build_object('submissionId',v_submission,'draftId',d.id),p_correlation_id);
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'reporting.stage_draft_submitted','reporting_stage_submission',v_submission::text,jsonb_build_object('draftId',d.id,'idempotencyKey',p_idempotency_key));
 v_result:=jsonb_build_object('submission',public.m6_reporting_submission_json(p_organization_id,v_submission));
 perform public.m6_reporting_draft_command_store(p_organization_id,p_actor_user_id,p_idempotency_key,'submit_stage_draft',v_digest,v_result);
 return query select 'updated',v_result; end $$;

create or replace function public.create_reporting_family_template_atomic(p_organization_id uuid,p_actor_user_id uuid,p_name text,p_obligation_type text,p_stage_kind text,p_description text,p_content jsonb,p_idempotency_key uuid,p_correlation_id uuid default null)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.reporting_family_templates%rowtype; v_digest text; v_existing record; v_result jsonb; begin
 if p_idempotency_key is null or char_length(btrim(coalesce(p_name,''))) not between 1 and 200 or char_length(btrim(coalesce(p_description,''))) > 2000 or p_obligation_type not in ('actively_exploited_vulnerability','severe_incident') or p_stage_kind not in ('early_warning','notification','final_report') or not public.m6_reporting_template_content_valid(p_content,p_obligation_type,p_stage_kind) or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_edit_organization') then return query select 'invalid_request',null::jsonb;return;end if;
 v_digest:=encode(extensions.digest(jsonb_build_object('name',btrim(p_name),'obligationType',p_obligation_type,'stageKind',p_stage_kind,'description',nullif(btrim(coalesce(p_description,'')),''),'content',p_content)::text,'sha256'),'hex');
 select * into v_existing from public.m6_reporting_draft_command_result(p_organization_id,p_actor_user_id,p_idempotency_key,'create_family_template',v_digest);
 if found then return query select v_existing.outcome,v_existing.result; return; end if;
 insert into public.reporting_family_templates(organization_id,name,description,obligation_type,stage_kind,created_by_user_id) values(p_organization_id,btrim(p_name),nullif(btrim(coalesce(p_description,'')),''),p_obligation_type,p_stage_kind,p_actor_user_id) returning * into t;
 insert into public.reporting_family_template_versions(organization_id,template_id,version,content,created_by_user_id) values(p_organization_id,t.id,1,p_content,p_actor_user_id);
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'reporting.family_template_created','reporting_family_template',t.id::text,jsonb_build_object('idempotencyKey',p_idempotency_key));
 v_result:=jsonb_build_object('template',public.m6_reporting_family_template_json(p_organization_id,t.id));
 perform public.m6_reporting_draft_command_store(p_organization_id,p_actor_user_id,p_idempotency_key,'create_family_template',v_digest,v_result);
 return query select 'created',v_result; end $$;

create or replace function public.apply_reporting_family_template_atomic(p_organization_id uuid,p_actor_user_id uuid,p_draft_id uuid,p_template_version_id uuid,p_expected_draft_version integer,p_lock_token uuid,p_idempotency_key uuid,p_correlation_id uuid default null)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.reporting_stage_drafts%rowtype; t public.reporting_family_templates%rowtype; v jsonb; v_content jsonb; v_provenance jsonb; v_template_id uuid; v_template_version integer; v_digest text; v_existing record; v_result jsonb; begin
 if p_idempotency_key is null or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_edit_findings') then return query select 'not_found',null::jsonb;return;end if;
 v_digest:=encode(extensions.digest(jsonb_build_object('draftId',p_draft_id,'templateVersionId',p_template_version_id,'expectedDraftVersion',p_expected_draft_version,'lockToken',p_lock_token)::text,'sha256'),'hex');
 select * into v_existing from public.m6_reporting_draft_command_result(p_organization_id,p_actor_user_id,p_idempotency_key,'apply_family_template',v_digest);
 if found then return query select v_existing.outcome,v_existing.result; return; end if;
 select * into d from public.reporting_stage_drafts where organization_id=p_organization_id and id=p_draft_id for update; if not found then return query select 'not_found',null::jsonb;return;end if;
 if exists(select 1 from public.reporting_stage_submissions where organization_id=p_organization_id and stage_id=d.stage_id) then return query select 'invalid_state',jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d.id));return;end if;
 select v.template_id,v.version,v.content into v_template_id,v_template_version,v from public.reporting_family_template_versions v join public.reporting_family_templates t0 on t0.organization_id=v.organization_id and t0.id=v.template_id and t0.archived_at is null where v.organization_id=p_organization_id and v.id=p_template_version_id; if not found then return query select 'not_found',null::jsonb;return;end if;
 select * into t from public.reporting_family_templates where organization_id=p_organization_id and id=v_template_id and archived_at is null; if not found or t.obligation_type<>(select obligation_type from public.reporting_obligations where organization_id=p_organization_id and id=d.obligation_id) or t.stage_kind<>(select stage_kind from public.reporting_obligation_stages where organization_id=p_organization_id and id=d.stage_id) then return query select 'not_found',null::jsonb;return;end if;
 if d.lock_expires_at is null or d.lock_expires_at<=clock_timestamp() or d.locked_by_user_id<>p_actor_user_id or d.lock_token<>p_lock_token then return query select 'locked',jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d.id));return;end if;
 if d.version<>p_expected_draft_version then return query select 'conflict',jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d.id));return;end if;
 if v is null then return query select 'not_found',null::jsonb;return;end if;
 -- Templates deliberately contain only reusable fields; release/member-state data stays on the draft.
 if not public.m6_reporting_template_content_valid(v,t.obligation_type,t.stage_kind) then return query select 'invalid_request',null::jsonb;return;end if;
 select coalesce(jsonb_object_agg(field->'value'->>'key',field->'value'->'value'),'{}'::jsonb),coalesce(jsonb_object_agg(field->'value'->>'key',jsonb_build_object('origin','platform','source','family template '||t.name||' v'||v_template_version,'recordedAt',public.m6_utc_second_z(clock_timestamp()))),'{}'::jsonb) into v_content,v_provenance from jsonb_array_elements(v->'fields') field;
 update public.reporting_stage_drafts set content=d.content || v_content,field_provenance=d.field_provenance || v_provenance || jsonb_build_object('_template',jsonb_build_object('origin','platform','templateId',v_template_id,'templateVersionId',p_template_version_id,'reviewRequired',true)),version=version+1 where organization_id=p_organization_id and id=p_draft_id returning * into d;
 insert into public.reporting_stage_draft_revisions(organization_id,draft_id,revision,content,field_provenance,member_states,changed_by_user_id) values(p_organization_id,d.id,d.version,d.content,d.field_provenance,d.member_states,p_actor_user_id);
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'reporting.family_template_applied','reporting_stage_draft',d.id::text,jsonb_build_object('templateId',v_template_id,'templateVersionId',p_template_version_id,'idempotencyKey',p_idempotency_key));
 v_result:=jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d.id));
 perform public.m6_reporting_draft_command_store(p_organization_id,p_actor_user_id,p_idempotency_key,'apply_family_template',v_digest,v_result);
 return query select 'updated',v_result; end $$;

create or replace function public.list_reporting_family_templates(p_organization_id uuid,p_actor_user_id uuid,p_obligation_type text default null,p_stage_kind text default null)
returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path = public, pg_temp as $$ begin
 if not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_edit_organization') then return query select 'not_found',null::jsonb;return;end if;
 return query select 'found',jsonb_build_object('templates',coalesce((select jsonb_agg(public.m6_reporting_family_template_json(p_organization_id,t.id) order by t.updated_at desc,t.id) from public.reporting_family_templates t where t.organization_id=p_organization_id and t.archived_at is null and (p_obligation_type is null or t.obligation_type=p_obligation_type) and (p_stage_kind is null or t.stage_kind=p_stage_kind)),'[]'::jsonb)); end $$;

create or replace function public.update_reporting_family_template_atomic(p_organization_id uuid,p_actor_user_id uuid,p_template_id uuid,p_expected_version integer,p_content jsonb,p_idempotency_key uuid,p_correlation_id uuid default null)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$ declare t public.reporting_family_templates%rowtype; v_digest text; v_existing record; v_result jsonb; begin
 if p_idempotency_key is null or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_edit_organization') then return query select 'invalid_request',null::jsonb;return;end if;
 v_digest:=encode(extensions.digest(jsonb_build_object('templateId',p_template_id,'expectedVersion',p_expected_version,'content',p_content)::text,'sha256'),'hex');
 select * into v_existing from public.m6_reporting_draft_command_result(p_organization_id,p_actor_user_id,p_idempotency_key,'update_family_template',v_digest);
 if found then return query select v_existing.outcome,v_existing.result; return; end if;
 select * into t from public.reporting_family_templates where organization_id=p_organization_id and id=p_template_id and archived_at is null for update; if not found then return query select 'not_found',null::jsonb;return;end if;
 if not public.m6_reporting_template_content_valid(p_content,t.obligation_type,t.stage_kind) then return query select 'invalid_request',null::jsonb;return;end if;
 if t.current_version<>p_expected_version then return query select 'conflict',jsonb_build_object('templateId',t.id,'version',t.current_version);return;end if;
 update public.reporting_family_templates set current_version=current_version+1 where organization_id=p_organization_id and id=p_template_id returning * into t;
 insert into public.reporting_family_template_versions(organization_id,template_id,version,content,created_by_user_id) values(p_organization_id,t.id,t.current_version,p_content,p_actor_user_id);
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'reporting.family_template_version_created','reporting_family_template',t.id::text,jsonb_build_object('version',t.current_version,'idempotencyKey',p_idempotency_key));
 v_result:=jsonb_build_object('template',public.m6_reporting_family_template_json(p_organization_id,t.id));
 perform public.m6_reporting_draft_command_store(p_organization_id,p_actor_user_id,p_idempotency_key,'update_family_template',v_digest,v_result);
 return query select 'updated',v_result; end $$;

alter table public.reporting_obligation_events drop constraint if exists reporting_obligation_events_event_kind_check;
alter table public.reporting_obligation_events add constraint reporting_obligation_events_event_kind_check check (event_kind in ('created','anchor_corrected','stage_submitted','stage_overdue','cancelled','deadline_threshold_crossed','deadline_breached','draft_created','draft_submitted'));

insert into public.organization_export_source_tables(source_id,table_name,tenant_key_column,record_order_column,table_sort) values
 ('reporting_obligations','reporting_stage_drafts','organization_id','id',6),('reporting_obligations','reporting_stage_draft_revisions','organization_id','id',7),('reporting_obligations','reporting_stage_submissions','organization_id','id',8),('reporting_obligations','reporting_family_templates','organization_id','id',9),('reporting_obligations','reporting_family_template_versions','organization_id','id',10)
on conflict(source_id,table_name) do update set tenant_key_column=excluded.tenant_key_column,record_order_column=excluded.record_order_column,table_sort=excluded.table_sort;

alter function public.m6_reporting_draft_json(uuid,uuid) owner to postgres;
alter function public.m6_reporting_draft_valid(jsonb,jsonb,jsonb) owner to postgres;
alter function public.m6_reporting_template_content_valid(jsonb,text,text) owner to postgres;
alter function public.m6_reporting_stage_field_definitions(text,text) owner to postgres;
alter function public.m6_reporting_draft_fields(jsonb,jsonb,jsonb,timestamptz) owner to postgres;
alter function public.m6_reporting_draft_complete(jsonb,jsonb,jsonb) owner to postgres;
alter function public.m6_reporting_family_template_json(uuid,uuid) owner to postgres;
alter function public.m6_reporting_submission_json(uuid,uuid) owner to postgres;
alter function public.m6_reporting_draft_command_result(uuid,uuid,uuid,text,text) owner to postgres;
alter function public.m6_reporting_draft_command_store(uuid,uuid,uuid,text,text,jsonb) owner to postgres;
alter function public.create_reporting_stage_draft_atomic(uuid,uuid,uuid,uuid,uuid,uuid,uuid) owner to postgres;
alter function public.get_reporting_stage_draft(uuid,uuid,uuid) owner to postgres;
alter function public.acquire_reporting_stage_draft_lock_atomic(uuid,uuid,uuid,integer,uuid,uuid) owner to postgres;
alter function public.save_reporting_stage_draft_atomic(uuid,uuid,uuid,integer,uuid,jsonb,jsonb,jsonb,uuid,uuid) owner to postgres;
alter function public.submit_reporting_stage_draft_atomic(uuid,uuid,uuid,integer,uuid,text,uuid,uuid) owner to postgres;
alter function public.create_reporting_family_template_atomic(uuid,uuid,text,text,text,text,jsonb,uuid,uuid) owner to postgres;
alter function public.apply_reporting_family_template_atomic(uuid,uuid,uuid,uuid,integer,uuid,uuid,uuid) owner to postgres;
alter function public.list_reporting_family_templates(uuid,uuid,text,text) owner to postgres;
alter function public.update_reporting_family_template_atomic(uuid,uuid,uuid,integer,jsonb,uuid,uuid) owner to postgres;
revoke all on function public.m6_reporting_draft_json(uuid,uuid),public.m6_reporting_draft_valid(jsonb,jsonb,jsonb),public.m6_reporting_template_content_valid(jsonb,text,text),public.m6_reporting_stage_field_definitions(text,text),public.m6_reporting_draft_fields(jsonb,jsonb,jsonb,timestamptz),public.m6_reporting_draft_complete(jsonb,jsonb,jsonb),public.m6_reporting_family_template_json(uuid,uuid),public.m6_reporting_submission_json(uuid,uuid),public.create_reporting_stage_draft_atomic(uuid,uuid,uuid,uuid,uuid,uuid,uuid),public.get_reporting_stage_draft(uuid,uuid,uuid),public.acquire_reporting_stage_draft_lock_atomic(uuid,uuid,uuid,integer,uuid,uuid),public.save_reporting_stage_draft_atomic(uuid,uuid,uuid,integer,uuid,jsonb,jsonb,jsonb,uuid,uuid),public.submit_reporting_stage_draft_atomic(uuid,uuid,uuid,integer,uuid,text,uuid,uuid) from public,anon,authenticated;
revoke all on function public.m6_reporting_draft_command_result(uuid,uuid,uuid,text,text),public.m6_reporting_draft_command_store(uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.create_reporting_family_template_atomic(uuid,uuid,text,text,text,text,jsonb,uuid,uuid),public.apply_reporting_family_template_atomic(uuid,uuid,uuid,uuid,integer,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.list_reporting_family_templates(uuid,uuid,text,text),public.update_reporting_family_template_atomic(uuid,uuid,uuid,integer,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_reporting_stage_draft_atomic(uuid,uuid,uuid,uuid,uuid,uuid,uuid),public.get_reporting_stage_draft(uuid,uuid,uuid),public.acquire_reporting_stage_draft_lock_atomic(uuid,uuid,uuid,integer,uuid,uuid),public.save_reporting_stage_draft_atomic(uuid,uuid,uuid,integer,uuid,jsonb,jsonb,jsonb,uuid,uuid),public.submit_reporting_stage_draft_atomic(uuid,uuid,uuid,integer,uuid,text,uuid,uuid),public.create_reporting_family_template_atomic(uuid,uuid,text,text,text,text,jsonb,uuid,uuid),public.apply_reporting_family_template_atomic(uuid,uuid,uuid,uuid,integer,uuid,uuid,uuid),public.list_reporting_family_templates(uuid,uuid,text,text),public.update_reporting_family_template_atomic(uuid,uuid,uuid,integer,jsonb,uuid,uuid) to service_role;
