-- Close validation and canonical-submission gaps discovered during the M6-03 review.
-- This is deliberately an additive repair migration: earlier migrations may already
-- have been applied to a developer's local database.

create or replace function public.m6_reporting_draft_payload_valid(
  p_content jsonb,
  p_provenance jsonb,
  p_member_states jsonb,
  p_obligation_type text,
  p_stage_kind text
) returns boolean
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v_def jsonb;
  v_value jsonb;
  v_key text;
begin
  if jsonb_typeof(p_content) <> 'object'
    or jsonb_typeof(p_provenance) <> 'object'
    or jsonb_typeof(p_member_states) <> 'array'
    or jsonb_array_length(p_member_states) > 27
    or exists (select 1 from jsonb_array_elements(p_member_states) state
      where jsonb_typeof(state) <> 'string'
        or trim(both '"' from state::text) !~ '^[A-Z]{2}$')
    or (select count(*) <> count(distinct trim(both '"' from state::text))
      from jsonb_array_elements(p_member_states) state) then
    return false;
  end if;

  for v_key, v_value in select key, value from jsonb_each(p_content) loop
    select definition into v_def
    from jsonb_array_elements(public.m6_reporting_stage_field_definitions(p_obligation_type, p_stage_kind)) definition
    where definition->>'key' = v_key and definition->>'type' <> 'member_states';
    if v_def is null or not p_provenance ? v_key then return false; end if;
    if jsonb_typeof(v_value) = 'null' then continue; end if;
    if v_def->>'type' = 'boolean' and jsonb_typeof(v_value) <> 'boolean' then return false; end if;
    if v_def->>'type' = 'short_text' and (jsonb_typeof(v_value) <> 'string' or char_length(v_value #>> '{}') > 4000) then return false; end if;
    if v_def->>'type' = 'long_text' and (jsonb_typeof(v_value) <> 'string' or char_length(v_value #>> '{}') > 20000) then return false; end if;
  end loop;

  if exists (
    select 1 from jsonb_each(p_provenance) field
    where (field.key in ('_memberStates', '_template') and jsonb_typeof(field.value) <> 'object')
      or (field.key not in ('_memberStates', '_template') and (not p_content ? field.key or jsonb_typeof(field.value) <> 'object'
        or coalesce(field.value->>'origin','') not in ('human','platform','ai_accepted')))
  ) then return false; end if;
  return true;
end $$;

-- Market availability is a default only. An empty release scope is a valid
-- incomplete draft, which a member can correct before submission.
create or replace function public.create_reporting_stage_draft_atomic(p_organization_id uuid,p_actor_user_id uuid,p_obligation_id uuid,p_stage_id uuid,p_release_id uuid,p_idempotency_key uuid,p_correlation_id uuid default null)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.reporting_stage_drafts%rowtype; v_content jsonb:='{}'; v_provenance jsonb:='{}'; v_states jsonb; v_previous uuid; v_digest text; v_existing record; v_result jsonb;
begin
 if p_organization_id is null or p_actor_user_id is null or p_idempotency_key is null or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_edit_findings') then return query select 'not_found',null::jsonb; return; end if;
 v_digest:=encode(extensions.digest(jsonb_build_object('obligationId',p_obligation_id,'stageId',p_stage_id,'releaseId',p_release_id)::text,'sha256'),'hex');
 select * into v_existing from public.m6_reporting_draft_command_result(p_organization_id,p_actor_user_id,p_idempotency_key,'create_stage_draft',v_digest); if found then return query select v_existing.outcome,v_existing.result; return; end if;
 select coalesce(jsonb_agg(a.country_code order by a.country_code),'[]'::jsonb) into v_states from public.product_release_market_availability a where a.organization_id=p_organization_id and a.release_id=p_release_id and a.unavailable_at is null;
 if not exists(select 1 from public.reporting_obligation_stages s join public.reporting_obligations o on o.organization_id=s.organization_id and o.id=s.obligation_id join public.product_releases r on r.organization_id=p_organization_id and r.id=p_release_id where s.organization_id=p_organization_id and s.id=p_stage_id and s.obligation_id=p_obligation_id and o.status='active') then return query select 'not_found',null::jsonb; return; end if;
 select sub.id,sub.content,sub.field_provenance into v_previous,v_content,v_provenance from public.reporting_stage_submissions sub join public.reporting_obligation_stages prev on prev.organization_id=sub.organization_id and prev.id=sub.stage_id where sub.organization_id=p_organization_id and sub.obligation_id=p_obligation_id and (case prev.stage_kind when 'early_warning' then 1 when 'notification' then 2 else 3 end) < (select case stage_kind when 'early_warning' then 1 when 'notification' then 2 else 3 end from public.reporting_obligation_stages where organization_id=p_organization_id and id=p_stage_id) order by sub.submitted_at desc limit 1;
 insert into public.reporting_stage_drafts(organization_id,obligation_id,stage_id,release_id,content,field_provenance,member_states,prepopulated_from_submission_id,created_by_user_id) values(p_organization_id,p_obligation_id,p_stage_id,p_release_id,coalesce(v_content,'{}'),coalesce(v_provenance,'{}'),v_states,v_previous,p_actor_user_id) on conflict(organization_id,stage_id) do nothing returning * into d;
 if not found then select * into d from public.reporting_stage_drafts where organization_id=p_organization_id and stage_id=p_stage_id; v_result:=jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d.id)); perform public.m6_reporting_draft_command_store(p_organization_id,p_actor_user_id,p_idempotency_key,'create_stage_draft',v_digest,v_result); return query select 'found',v_result; return; end if;
 insert into public.reporting_stage_draft_revisions(organization_id,draft_id,revision,content,field_provenance,member_states,changed_by_user_id) values(p_organization_id,d.id,1,d.content,d.field_provenance,d.member_states,p_actor_user_id);
 insert into public.reporting_obligation_events(organization_id,obligation_id,event_kind,stage_kind,actor_user_id,actor_display_name,new_value,correlation_id) values(p_organization_id,p_obligation_id,'draft_created',(select stage_kind from public.reporting_obligation_stages where id=p_stage_id),p_actor_user_id,public.m6_actor_display_name(p_actor_user_id),jsonb_build_object('draftId',d.id),p_correlation_id);
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'reporting.stage_draft_created','reporting_stage_draft',d.id::text,jsonb_build_object('idempotencyKey',p_idempotency_key));
 v_result:=jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d.id)); perform public.m6_reporting_draft_command_store(p_organization_id,p_actor_user_id,p_idempotency_key,'create_stage_draft',v_digest,v_result); return query select 'created',v_result;
end $$;

create or replace function public.save_reporting_stage_draft_atomic(p_organization_id uuid,p_actor_user_id uuid,p_draft_id uuid,p_expected_version integer,p_lock_token uuid,p_content jsonb,p_field_provenance jsonb,p_member_states jsonb,p_idempotency_key uuid,p_correlation_id uuid default null)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.reporting_stage_drafts%rowtype; v_digest text; v_existing record; v_result jsonb; v_provenance jsonb; v_states jsonb; v_type text; v_stage text; v_recorded_at text:=public.m6_utc_second_z(clock_timestamp()); begin
 if p_idempotency_key is null or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_edit_findings') or jsonb_typeof(p_content)<>'object' or jsonb_typeof(p_field_provenance)<>'object' or jsonb_typeof(p_member_states)<>'array' or exists(select 1 from jsonb_each(p_content) field where not p_field_provenance ? field.key) or exists(select 1 from jsonb_each(p_field_provenance) field where not p_content ? field.key or jsonb_typeof(field.value)<>'object' or coalesce(field.value->>'origin','') not in ('human','platform','ai_accepted') or (field.value->>'origin'='ai_accepted' and coalesce(field.value->'acceptedBy'->>'userId','')<>p_actor_user_id::text)) or exists(select 1 from jsonb_array_elements(p_member_states) state where jsonb_typeof(state)<>'object' or coalesce(state->>'countryCode','') !~ '^[A-Z]{2}$' or jsonb_typeof(state->'provenance')<>'object' or coalesce(state->'provenance'->>'origin','') not in ('human','platform','ai_accepted') or (state->'provenance'->>'origin'='ai_accepted' and coalesce(state->'provenance'->'acceptedBy'->>'userId','')<>p_actor_user_id::text)) then return query select 'invalid_request',null::jsonb;return; end if;
 v_digest:=encode(extensions.digest(jsonb_build_object('draftId',p_draft_id,'expectedVersion',p_expected_version,'lockToken',p_lock_token,'content',p_content,'fieldProvenance',p_field_provenance,'memberStates',p_member_states)::text,'sha256'),'hex'); select * into v_existing from public.m6_reporting_draft_command_result(p_organization_id,p_actor_user_id,p_idempotency_key,'save_stage_draft',v_digest); if found then return query select v_existing.outcome,v_existing.result; return; end if;
 select * into d from public.reporting_stage_drafts where organization_id=p_organization_id and id=p_draft_id for update; if not found then return query select 'not_found',null::jsonb;return;end if;
 if exists(select 1 from public.reporting_stage_submissions where organization_id=p_organization_id and stage_id=d.stage_id) then return query select 'invalid_state',jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d.id));return;end if;
 if d.lock_expires_at is null or d.lock_expires_at<=clock_timestamp() or d.locked_by_user_id<>p_actor_user_id or d.lock_token<>p_lock_token then return query select 'locked',jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d.id));return;end if;
 if d.version<>p_expected_version then return query select 'conflict',jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d.id));return;end if;
 select o.obligation_type,s.stage_kind into v_type,v_stage from public.reporting_obligations o join public.reporting_obligation_stages s on s.organization_id=o.organization_id and s.obligation_id=o.id where o.organization_id=p_organization_id and o.id=d.obligation_id and s.id=d.stage_id;
 select coalesce(jsonb_object_agg(field.key,case when field.value->>'origin'='ai_accepted' then jsonb_build_object('origin','ai_accepted','acceptedBy',jsonb_build_object('userId',p_actor_user_id,'displayName',public.m6_actor_display_name(p_actor_user_id)),'acceptedAt',v_recorded_at,'suggestionReference',field.value->>'suggestionReference') else jsonb_build_object('origin','human','actor',jsonb_build_object('userId',p_actor_user_id,'displayName',public.m6_actor_display_name(p_actor_user_id)),'recordedAt',v_recorded_at) end),'{}'::jsonb) into v_provenance from jsonb_each(p_field_provenance) field;
 select coalesce(jsonb_agg(country order by country),'[]'::jsonb) into v_states from (select distinct state->>'countryCode' country from jsonb_array_elements(p_member_states) state) states;
 if not public.m6_reporting_draft_payload_valid(p_content,v_provenance,v_states,v_type,v_stage) then return query select 'invalid_request',null::jsonb;return;end if;
 v_provenance:=v_provenance || jsonb_build_object('_memberStates',coalesce((select jsonb_object_agg(state->>'countryCode',case when state->'provenance'->>'origin'='ai_accepted' then jsonb_build_object('origin','ai_accepted','acceptedBy',jsonb_build_object('userId',p_actor_user_id,'displayName',public.m6_actor_display_name(p_actor_user_id)),'acceptedAt',v_recorded_at,'suggestionReference',state->'provenance'->>'suggestionReference') else jsonb_build_object('origin','human','actor',jsonb_build_object('userId',p_actor_user_id,'displayName',public.m6_actor_display_name(p_actor_user_id)),'recordedAt',v_recorded_at) end) from jsonb_array_elements(p_member_states) state),'{}'::jsonb));
 update public.reporting_stage_drafts set content=p_content,field_provenance=v_provenance,member_states=v_states,version=version+1 where organization_id=p_organization_id and id=p_draft_id returning * into d;
 insert into public.reporting_stage_draft_revisions(organization_id,draft_id,revision,content,field_provenance,member_states,changed_by_user_id) values(p_organization_id,d.id,d.version,d.content,d.field_provenance,d.member_states,p_actor_user_id);
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'reporting.stage_draft_saved','reporting_stage_draft',d.id::text,jsonb_build_object('idempotencyKey',p_idempotency_key)); v_result:=jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d.id)); perform public.m6_reporting_draft_command_store(p_organization_id,p_actor_user_id,p_idempotency_key,'save_stage_draft',v_digest,v_result); return query select 'updated',v_result;
end $$;

create or replace function public.submit_reporting_stage_draft_atomic(p_organization_id uuid,p_actor_user_id uuid,p_draft_id uuid,p_expected_version integer,p_lock_token uuid,p_submission_reference text,p_idempotency_key uuid,p_correlation_id uuid default null)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.reporting_stage_drafts%rowtype; v_stage public.reporting_obligation_stages%rowtype; v_obligation public.reporting_obligations%rowtype; v_submission uuid; v_digest text; v_existing record; v_result jsonb; v_now timestamptz:=date_trunc('second',clock_timestamp()); begin
 if p_idempotency_key is null or char_length(btrim(coalesce(p_submission_reference,''))) not between 1 and 1000 or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_edit_findings') then return query select 'invalid_request',null::jsonb;return;end if;
 v_digest:=encode(extensions.digest(jsonb_build_object('draftId',p_draft_id,'expectedVersion',p_expected_version,'lockToken',p_lock_token,'submissionReference',btrim(p_submission_reference))::text,'sha256'),'hex'); select * into v_existing from public.m6_reporting_draft_command_result(p_organization_id,p_actor_user_id,p_idempotency_key,'submit_stage_draft',v_digest); if found then return query select v_existing.outcome,v_existing.result; return; end if;
 select * into d from public.reporting_stage_drafts where organization_id=p_organization_id and id=p_draft_id for update; if not found then return query select 'not_found',null::jsonb;return;end if;
 select * into v_obligation from public.reporting_obligations where organization_id=p_organization_id and id=d.obligation_id for update; select * into v_stage from public.reporting_obligation_stages where organization_id=p_organization_id and id=d.stage_id for update;
 if not found or v_obligation.status <> 'active' or exists(select 1 from public.reporting_stage_submissions where organization_id=p_organization_id and stage_id=d.stage_id) then return query select 'invalid_state',jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d.id));return;end if;
 if d.lock_expires_at is null or d.lock_expires_at<=clock_timestamp() or d.locked_by_user_id<>p_actor_user_id or d.lock_token<>p_lock_token then return query select 'locked',jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d.id));return;end if;
 if d.version<>p_expected_version then return query select 'conflict',jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d.id));return;end if;
 if not public.m6_reporting_draft_payload_valid(d.content,d.field_provenance,d.member_states,v_obligation.obligation_type,v_stage.stage_kind) or not public.m6_reporting_draft_complete(d.content,public.m6_reporting_stage_field_definitions(v_obligation.obligation_type,v_stage.stage_kind),d.member_states) then return query select 'invalid_request',jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d.id));return;end if;
 if coalesce((d.field_provenance->'_template'->>'reviewRequired')::boolean,false) then return query select 'invalid_state',jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d.id));return;end if;
 insert into public.reporting_stage_submissions(organization_id,obligation_id,stage_id,draft_id,draft_revision,release_id,content,field_provenance,member_states,submission_reference,submitted_by_user_id,submitted_at) values(p_organization_id,d.obligation_id,d.stage_id,d.id,d.version,d.release_id,d.content,d.field_provenance,d.member_states,btrim(p_submission_reference),p_actor_user_id,v_now) returning id into v_submission;
 update public.reporting_obligation_stages set submitted_at=v_now,submission_reference=btrim(p_submission_reference),state='submitted',overdue_at=case when overdue_at is not null then overdue_at when due_at is not null and v_now>due_at then due_at else null end,version=version+1,updated_at=v_now where organization_id=p_organization_id and id=v_stage.id;
 update public.reporting_obligations set version=version+1,updated_at=v_now where organization_id=p_organization_id and id=d.obligation_id returning * into v_obligation;
 update public.reporting_stage_drafts set locked_by_user_id=null,lock_token=null,lock_expires_at=null where organization_id=p_organization_id and id=d.id;
 insert into public.reporting_obligation_events(organization_id,obligation_id,event_kind,stage_kind,anchor_kind,occurred_at,actor_user_id,actor_display_name,new_value,correlation_id) values(p_organization_id,d.obligation_id,'stage_submitted',v_stage.stage_kind,case when v_stage.stage_kind='notification' and v_obligation.obligation_type='severe_incident' then 'notification_submitted' else null end,v_now,p_actor_user_id,public.m6_actor_display_name(p_actor_user_id),jsonb_build_object('submittedAt',public.m6_utc_second_z(v_now),'submissionReference',btrim(p_submission_reference),'anchoredAt',public.m6_utc_second_z(v_now),'basis',null),p_correlation_id);
 perform public.m6_refresh_reporting_obligation_stages(p_organization_id,d.obligation_id,v_now);
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'reporting.stage_draft_submitted','reporting_stage_submission',v_submission::text,jsonb_build_object('draftId',d.id,'idempotencyKey',p_idempotency_key,'stage',v_stage.stage_kind));
 v_result:=jsonb_build_object('submission',public.m6_reporting_submission_json(p_organization_id,v_submission)); perform public.m6_reporting_draft_command_store(p_organization_id,p_actor_user_id,p_idempotency_key,'submit_stage_draft',v_digest,v_result); return query select 'updated',v_result;
end $$;

alter function public.m6_reporting_draft_payload_valid(jsonb,jsonb,jsonb,text,text) owner to postgres;
alter function public.create_reporting_stage_draft_atomic(uuid,uuid,uuid,uuid,uuid,uuid,uuid) owner to postgres;
alter function public.save_reporting_stage_draft_atomic(uuid,uuid,uuid,integer,uuid,jsonb,jsonb,jsonb,uuid,uuid) owner to postgres;
alter function public.submit_reporting_stage_draft_atomic(uuid,uuid,uuid,integer,uuid,text,uuid,uuid) owner to postgres;
revoke all on function public.m6_reporting_draft_payload_valid(jsonb,jsonb,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.m6_reporting_draft_payload_valid(jsonb,jsonb,jsonb,text,text),public.create_reporting_stage_draft_atomic(uuid,uuid,uuid,uuid,uuid,uuid,uuid),public.save_reporting_stage_draft_atomic(uuid,uuid,uuid,integer,uuid,jsonb,jsonb,jsonb,uuid,uuid),public.submit_reporting_stage_draft_atomic(uuid,uuid,uuid,integer,uuid,text,uuid,uuid) to service_role;
