-- Bring an already-migrated local deployment to the final M6-03 runtime policy.
create or replace function public.create_reporting_stage_draft_atomic(p_organization_id uuid,p_actor_user_id uuid,p_obligation_id uuid,p_stage_id uuid,p_release_id uuid,p_idempotency_key uuid,p_correlation_id uuid default null)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.reporting_stage_drafts%rowtype; v_content jsonb:='{}'; v_provenance jsonb:='{}'; v_states jsonb; v_previous uuid; v_digest text; v_existing record; v_result jsonb;
begin
 if p_organization_id is null or p_actor_user_id is null or p_idempotency_key is null or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_edit_findings') then return query select 'not_found',null::jsonb; return; end if;
 v_digest:=encode(extensions.digest(jsonb_build_object('obligationId',p_obligation_id,'stageId',p_stage_id,'releaseId',p_release_id)::text,'sha256'),'hex');
 select * into v_existing from public.m6_reporting_draft_command_result(p_organization_id,p_actor_user_id,p_idempotency_key,'create_stage_draft',v_digest);
 if found then return query select v_existing.outcome,v_existing.result; return; end if;
 select jsonb_agg(a.country_code order by a.country_code) into v_states from public.product_release_market_availability a where a.organization_id=p_organization_id and a.release_id=p_release_id and a.unavailable_at is null;
 if coalesce(jsonb_array_length(v_states),0)=0 then return query select 'invalid_request',null::jsonb; return; end if;
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
 if jsonb_array_length(v_states) not between 1 and 27 then return query select 'invalid_request',null::jsonb;return;end if;
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
