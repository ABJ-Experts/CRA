-- M6-07: isolated synthetic reporting rehearsals.  A rehearsal remains in the
-- reporting workflow, but its classification is inherited by every immutable
-- reporting artifact and is excluded before monitoring can materialize alerts.

alter table public.reporting_obligations
  add column if not exists is_rehearsal boolean not null default false,
  add column if not exists rehearsal_replay_of_id uuid;

alter table public.reporting_obligations
  add constraint reporting_obligations_rehearsal_shape_check
  check (
    (not is_rehearsal and rehearsal_replay_of_id is null)
    or (is_rehearsal and source_finding_id is null)
  ) not valid;
alter table public.reporting_obligations
  validate constraint reporting_obligations_rehearsal_shape_check;
alter table public.reporting_obligations
  add constraint reporting_obligations_rehearsal_replay_fkey
  foreign key (organization_id, rehearsal_replay_of_id)
  references public.reporting_obligations(organization_id, id) on delete restrict;

alter table public.reporting_obligation_events
  add column if not exists is_rehearsal boolean not null default false;
alter table public.reporting_stage_packages
  add column if not exists is_rehearsal boolean not null default false;
alter table public.reporting_stage_submissions
  add column if not exists is_rehearsal boolean not null default false;
alter table public.reporting_stage_submission_acknowledgements
  add column if not exists is_rehearsal boolean not null default false;
alter table public.reporting_obligation_evidence_packs
  add column if not exists is_rehearsal boolean not null default false;

create or replace function public.m6_reporting_rehearsal_inheritance()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_is_rehearsal boolean;
begin
  if tg_table_name = 'reporting_obligations' then
    if new.rehearsal_replay_of_id is not null and not exists (
      select 1 from public.reporting_obligations parent
      where parent.organization_id = new.organization_id
        and parent.id = new.rehearsal_replay_of_id
        and parent.is_rehearsal
    ) then
      raise exception 'rehearsal replay parent must be a rehearsal in the same organization';
    end if;
    return new;
  elsif tg_table_name = 'reporting_stage_submission_acknowledgements' then
    select s.is_rehearsal into v_is_rehearsal from public.reporting_stage_submissions s
      where s.organization_id = new.organization_id and s.id = new.submission_id;
  else
    select o.is_rehearsal into v_is_rehearsal from public.reporting_obligations o
      where o.organization_id = new.organization_id and o.id = new.obligation_id;
  end if;
  if v_is_rehearsal is null then
    raise exception 'reporting artifact parent not found in organization';
  end if;
  if new.is_rehearsal is distinct from false and new.is_rehearsal is distinct from v_is_rehearsal then
    raise exception 'reporting artifact rehearsal classification is inherited';
  end if;
  new.is_rehearsal := v_is_rehearsal;
  return new;
end $$;

drop trigger if exists m6_reporting_obligation_rehearsal_inheritance on public.reporting_obligations;
create trigger m6_reporting_obligation_rehearsal_inheritance before insert or update of rehearsal_replay_of_id
  on public.reporting_obligations for each row execute function public.m6_reporting_rehearsal_inheritance();
drop trigger if exists m6_reporting_event_rehearsal_inheritance on public.reporting_obligation_events;
create trigger m6_reporting_event_rehearsal_inheritance before insert on public.reporting_obligation_events
  for each row execute function public.m6_reporting_rehearsal_inheritance();
drop trigger if exists m6_reporting_package_rehearsal_inheritance on public.reporting_stage_packages;
create trigger m6_reporting_package_rehearsal_inheritance before insert on public.reporting_stage_packages
  for each row execute function public.m6_reporting_rehearsal_inheritance();
drop trigger if exists m6_reporting_submission_rehearsal_inheritance on public.reporting_stage_submissions;
create trigger m6_reporting_submission_rehearsal_inheritance before insert on public.reporting_stage_submissions
  for each row execute function public.m6_reporting_rehearsal_inheritance();
drop trigger if exists m6_reporting_acknowledgement_rehearsal_inheritance on public.reporting_stage_submission_acknowledgements;
create trigger m6_reporting_acknowledgement_rehearsal_inheritance before insert on public.reporting_stage_submission_acknowledgements
  for each row execute function public.m6_reporting_rehearsal_inheritance();
drop trigger if exists m6_reporting_evidence_pack_rehearsal_inheritance on public.reporting_obligation_evidence_packs;
create trigger m6_reporting_evidence_pack_rehearsal_inheritance before insert on public.reporting_obligation_evidence_packs
  for each row execute function public.m6_reporting_rehearsal_inheritance();

alter table public.reporting_obligation_events drop constraint if exists reporting_obligation_events_event_kind_check;
alter table public.reporting_obligation_events add constraint reporting_obligation_events_event_kind_check check (event_kind in (
  'created','anchor_corrected','stage_submitted','stage_overdue','cancelled','draft_created','draft_saved',
  'stage_approved','approval_invalidated','package_reserved','package_available','package_failed',
  'deadline_threshold_crossed','deadline_breached','filing_reauthenticated','filing_recorded',
  'acknowledgement_recorded','rehearsal_replayed'
));

alter table public.vulnerability_triage_commands drop constraint if exists vulnerability_triage_commands_operation_check;
alter table public.vulnerability_triage_commands add constraint vulnerability_triage_commands_operation_check check (operation in (
  'assign','suppress','set_sla_policy','record_remediation_anchor','create_vex_export_snapshot',
  'configure_vex_publication_target','queue_vex_publication','retry_vex_publication','withdraw_vex_publication',
  'note_create','note_update','note_delete','create_reporting_obligation','correct_reporting_anchor',
  'record_reporting_submission','cancel_reporting_obligation','create_reporting_rehearsal','replay_reporting_rehearsal'
));

create or replace function public.m6_reporting_obligation_json(p_organization_id uuid, p_obligation_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', o.id, 'organizationId', o.organization_id, 'type', o.obligation_type, 'status', o.status,
    'isRehearsal', o.is_rehearsal, 'rehearsalReplayOfId', o.rehearsal_replay_of_id,
    'source', case when o.source_finding_id is null then jsonb_build_object('kind', 'manual') else jsonb_build_object('kind', 'finding', 'findingId', o.source_finding_id) end,
    'ruleSet', jsonb_build_object('id',o.rule_set_id,'version',o.rule_set_version,'jurisdiction','EU-CRA','effectiveFrom',o.rule_snapshot->>'effectiveFrom','effectiveTo',o.rule_snapshot->'effectiveTo'),
    'awarenessAt',public.m6_utc_second_z(o.awareness_at),'awarenessBasis',o.awareness_basis,
    'createdBy',jsonb_build_object('userId',o.created_by_user_id,'displayName',o.created_by_display_name),
    'createdAt',public.m6_utc_second_z(o.created_at),'updatedAt',public.m6_utc_second_z(o.updated_at),'version',o.version,
    'cancelledAt',case when o.cancelled_at is null then null else public.m6_utc_second_z(o.cancelled_at) end,'cancellationReason',o.cancellation_reason,
    'stages',coalesce((select jsonb_agg(public.m6_reporting_stage_json(p_organization_id,s.id) order by case s.stage_kind when 'early_warning' then 1 when 'notification' then 2 else 3 end) from public.reporting_obligation_stages s where s.organization_id=p_organization_id and s.obligation_id=o.id),'[]'::jsonb),
    'anchors',coalesce((select jsonb_agg(jsonb_build_object('kind',e.anchor_kind,'anchoredAt',coalesce(e.new_value->>'anchoredAt',e.new_value->>'submittedAt'),'basis',e.new_value->>'basis','reason',e.reason,'recordedBy',jsonb_build_object('userId',e.actor_user_id,'displayName',e.actor_display_name),'recordedAt',public.m6_utc_second_z(e.occurred_at)) order by e.occurred_at,e.id) from public.reporting_obligation_events e where e.organization_id=p_organization_id and e.obligation_id=o.id and e.anchor_kind is not null and e.actor_user_id is not null),'[]'::jsonb)
  ) from public.reporting_obligations o where o.organization_id=p_organization_id and o.id=p_obligation_id
$$;

create or replace function public.create_reporting_rehearsal_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_obligation_type text, p_awareness_at timestamptz,
  p_awareness_basis text, p_idempotency_key uuid, p_correlation_id uuid default null
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_rule public.reporting_rule_sets%rowtype; v_obligation public.reporting_obligations%rowtype;
  v_stage jsonb; v_existing record; v_digest text; v_actor_name text; v_rule_snapshot jsonb;
  v_now timestamptz := date_trunc('second',clock_timestamp());
begin
  if p_organization_id is null or p_actor_user_id is null or p_obligation_type not in ('actively_exploited_vulnerability','severe_incident')
    or p_awareness_at is null or char_length(btrim(coalesce(p_awareness_basis,''))) not between 1 and 4000 or p_idempotency_key is null
    or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_submit_reporting') then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_actor_user_id::text||':'||p_idempotency_key::text,0));
  v_digest := public.m6_command_digest(jsonb_build_object('type',p_obligation_type,'awarenessAt',date_trunc('second',p_awareness_at),'awarenessBasis',btrim(p_awareness_basis),'isRehearsal',true));
  select * into v_existing from public.m5_triage_command_result(p_organization_id,p_actor_user_id,p_idempotency_key,'create_reporting_rehearsal',v_digest);
  if found then return query select v_existing.outcome,v_existing.result; return; end if;
  select * into v_rule from public.reporting_rule_sets r where r.jurisdiction='EU-CRA' and r.effective_from<=v_now and (r.effective_to is null or r.effective_to>v_now) order by r.effective_from desc,r.version desc limit 1;
  if not found then return query select 'unavailable'::text,null::jsonb; return; end if;
  v_rule_snapshot := jsonb_build_object('id',v_rule.id,'version',v_rule.version,'jurisdiction',v_rule.jurisdiction,'effectiveFrom',public.m6_utc_second_z(v_rule.effective_from),'effectiveTo',case when v_rule.effective_to is null then null else public.m6_utc_second_z(v_rule.effective_to) end,'rules',v_rule.rules);
  v_actor_name := public.m6_actor_display_name(p_actor_user_id);
  insert into public.reporting_obligations(organization_id,obligation_type,is_rehearsal,awareness_at,awareness_basis,rule_set_id,rule_set_version,rule_snapshot,created_by_user_id,created_by_display_name,created_at,updated_at)
  values(p_organization_id,p_obligation_type,true,date_trunc('second',p_awareness_at),btrim(p_awareness_basis),v_rule.id,v_rule.version,v_rule_snapshot,p_actor_user_id,v_actor_name,v_now,v_now) returning * into v_obligation;
  insert into public.reporting_obligation_events(organization_id,obligation_id,event_kind,anchor_kind,occurred_at,actor_user_id,actor_display_name,new_value,correlation_id)
  values(p_organization_id,v_obligation.id,'created','awareness',v_now,p_actor_user_id,v_actor_name,jsonb_build_object('anchoredAt',public.m6_utc_second_z(p_awareness_at),'basis',btrim(p_awareness_basis),'isRehearsal',true),p_correlation_id);
  for v_stage in select * from jsonb_array_elements(v_rule.rules->p_obligation_type) loop
    insert into public.reporting_obligation_stages(organization_id,obligation_id,stage_kind,anchor_kind,duration,state)
    values(p_organization_id,v_obligation.id,v_stage->>'stage',v_stage->>'anchor',v_stage->>'duration','pending_anchor');
  end loop;
  perform public.m6_refresh_reporting_obligation_stages(p_organization_id,v_obligation.id,v_now);
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
  values(p_organization_id,p_actor_user_id,'reporting.rehearsal_created','reporting_obligation',v_obligation.id::text,jsonb_build_object('isRehearsal',true,'type',p_obligation_type,'idempotencyKey',p_idempotency_key));
  insert into public.vulnerability_triage_commands(organization_id,actor_user_id,idempotency_key,operation,request_digest,result)
  values(p_organization_id,p_actor_user_id,p_idempotency_key,'create_reporting_rehearsal',v_digest,jsonb_build_object('obligation',public.m6_reporting_obligation_json(p_organization_id,v_obligation.id)));
  return query select 'created'::text,jsonb_build_object('obligation',public.m6_reporting_obligation_json(p_organization_id,v_obligation.id));
end $$;

create or replace function public.replay_reporting_rehearsal_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_rehearsal_id uuid,p_replay_reason text,p_expected_version integer,
  p_idempotency_key uuid,p_correlation_id uuid default null
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_source public.reporting_obligations%rowtype; v_replay public.reporting_obligations%rowtype;
  v_stage jsonb; v_existing record; v_digest text; v_actor_name text; v_now timestamptz:=date_trunc('second',clock_timestamp());
begin
  if p_idempotency_key is null or p_expected_version<1 or char_length(btrim(coalesce(p_replay_reason,''))) not between 1 and 4000
    or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_submit_reporting') then return query select 'forbidden'::text,null::jsonb; return; end if;
  v_digest:=public.m6_command_digest(jsonb_build_object('rehearsalId',p_rehearsal_id,'reason',btrim(p_replay_reason),'expectedVersion',p_expected_version));
  select * into v_existing from public.m5_triage_command_result(p_organization_id,p_actor_user_id,p_idempotency_key,'replay_reporting_rehearsal',v_digest);
  if found then return query select v_existing.outcome,v_existing.result; return; end if;
  select * into v_source from public.reporting_obligations where organization_id=p_organization_id and id=p_rehearsal_id for update;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  if not v_source.is_rehearsal or v_source.status<>'active' or v_source.version<>p_expected_version then return query select 'conflict'::text,null::jsonb; return; end if;
  v_actor_name:=public.m6_actor_display_name(p_actor_user_id);
  update public.reporting_obligations set status='cancelled',cancelled_at=v_now,cancelled_by_user_id=p_actor_user_id,cancellation_reason=btrim(p_replay_reason),version=version+1,updated_at=v_now where organization_id=p_organization_id and id=v_source.id;
  insert into public.reporting_obligation_events(organization_id,obligation_id,event_kind,occurred_at,actor_user_id,actor_display_name,reason,new_value,correlation_id)
  values(p_organization_id,v_source.id,'rehearsal_replayed',v_now,p_actor_user_id,v_actor_name,btrim(p_replay_reason),jsonb_build_object('isRehearsal',true),p_correlation_id);
  insert into public.reporting_obligation_events(organization_id,obligation_id,event_kind,occurred_at,actor_user_id,actor_display_name,reason,new_value,correlation_id)
  values(p_organization_id,v_source.id,'cancelled',v_now,p_actor_user_id,v_actor_name,btrim(p_replay_reason),jsonb_build_object('isRehearsal',true),p_correlation_id);
  insert into public.reporting_obligations(organization_id,obligation_type,is_rehearsal,rehearsal_replay_of_id,awareness_at,awareness_basis,rule_set_id,rule_set_version,rule_snapshot,created_by_user_id,created_by_display_name,created_at,updated_at)
  values(p_organization_id,v_source.obligation_type,true,v_source.id,v_source.awareness_at,v_source.awareness_basis,v_source.rule_set_id,v_source.rule_set_version,v_source.rule_snapshot,p_actor_user_id,v_actor_name,v_now,v_now) returning * into v_replay;
  insert into public.reporting_obligation_events(organization_id,obligation_id,event_kind,anchor_kind,occurred_at,actor_user_id,actor_display_name,new_value,correlation_id)
  values(p_organization_id,v_replay.id,'created','awareness',v_now,p_actor_user_id,v_actor_name,jsonb_build_object('anchoredAt',public.m6_utc_second_z(v_replay.awareness_at),'basis',v_replay.awareness_basis,'isRehearsal',true,'replayOfId',v_source.id),p_correlation_id);
  for v_stage in select * from jsonb_array_elements(v_replay.rule_snapshot->'rules'->v_replay.obligation_type) loop
    insert into public.reporting_obligation_stages(organization_id,obligation_id,stage_kind,anchor_kind,duration,state)
    values(p_organization_id,v_replay.id,v_stage->>'stage',v_stage->>'anchor',v_stage->>'duration','pending_anchor');
  end loop;
  perform public.m6_refresh_reporting_obligation_stages(p_organization_id,v_replay.id,v_now);
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
  values(p_organization_id,p_actor_user_id,'reporting.rehearsal_replayed','reporting_obligation',v_replay.id::text,jsonb_build_object('isRehearsal',true,'replayOfId',v_source.id,'idempotencyKey',p_idempotency_key));
  insert into public.vulnerability_triage_commands(organization_id,actor_user_id,idempotency_key,operation,request_digest,result)
  values(p_organization_id,p_actor_user_id,p_idempotency_key,'replay_reporting_rehearsal',v_digest,jsonb_build_object('obligation',public.m6_reporting_obligation_json(p_organization_id,v_replay.id)));
  return query select 'created'::text,jsonb_build_object('obligation',public.m6_reporting_obligation_json(p_organization_id,v_replay.id));
end $$;

-- Appended scope keeps existing seven-argument callers source-compatible and
-- makes real reporting the default even when a caller omits scope entirely.
create or replace function public.list_reporting_obligations(
  p_organization_id uuid,p_actor_user_id uuid,p_cursor text,p_limit integer default 50,p_type text default null,
  p_status text default null,p_finding_id uuid default null,p_scope text default 'real'
) returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_after_updated timestamptz; v_after_id uuid; v_rows jsonb; v_cursor text;
begin
  if p_cursor is not null then begin select split_part(convert_from(decode(translate(p_cursor,'-_','+/')||repeat('=',(4-length(p_cursor)%4)%4),'base64'),'utf8'),'|',1)::timestamptz,split_part(convert_from(decode(translate(p_cursor,'-_','+/')||repeat('=',(4-length(p_cursor)%4)%4),'base64'),'utf8'),'|',2)::uuid into v_after_updated,v_after_id; exception when others then return query select 'invalid_request'::text,null::jsonb; return; end; end if;
  if p_limit not between 1 and 100 or p_scope not in ('real','rehearsal') or (p_type is not null and p_type not in ('actively_exploited_vulnerability','severe_incident')) or (p_status is not null and p_status not in ('active','completed','cancelled')) or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_findings') then return query select 'not_found'::text,null::jsonb; return; end if;
  select coalesce(jsonb_agg(public.m6_reporting_obligation_json(p_organization_id,rows.id)-'anchors' order by rows.updated_at desc,rows.id desc),'[]'::jsonb),max(translate(trim(trailing '=' from encode(convert_to(rows.updated_at::text||'|'||rows.id::text,'utf8'),'base64')),'+/','-_')) into v_rows,v_cursor from (select o.id,o.updated_at from public.reporting_obligations o where o.organization_id=p_organization_id and o.is_rehearsal=(p_scope='rehearsal') and (p_type is null or o.obligation_type=p_type) and (p_status is null or o.status=p_status) and (p_finding_id is null or o.source_finding_id=p_finding_id) and (p_cursor is null or (o.updated_at,o.id)<(v_after_updated,v_after_id)) order by o.updated_at desc,o.id desc limit p_limit) rows;
  return query select 'found'::text,jsonb_build_object('obligations',v_rows,'nextCursor',case when jsonb_array_length(v_rows)=p_limit then v_cursor else null end);
end $$;

create or replace function public.get_reporting_deadline_summary(p_organization_id uuid,p_actor_user_id uuid)
returns table(outcome text,summary jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_now timestamptz:=date_trunc('second',clock_timestamp());
begin
 if p_organization_id is null or p_actor_user_id is null or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_findings') then return query select 'not_found'::text,null::jsonb; return; end if;
 return query select 'found'::text,jsonb_build_object('serverNow',public.m6_utc_second_z(v_now),'overdueCount',(select count(*) from public.reporting_obligation_stages s join public.reporting_obligations o on o.organization_id=s.organization_id and o.id=s.obligation_id where s.organization_id=p_organization_id and not o.is_rehearsal and o.status='active' and (s.state='overdue' or (s.state='running' and s.due_at<=v_now))),'nextDeadline',(select jsonb_build_object('obligationId',s.obligation_id,'stage',s.stage_kind,'dueAt',public.m6_utc_second_z(s.due_at),'elapsedPercent',public.m6_reporting_stage_elapsed_percent(p_organization_id,s.id,v_now),'reportingHref','/reporting?obligationId='||s.obligation_id::text) from public.reporting_obligation_stages s join public.reporting_obligations o on o.organization_id=s.organization_id and o.id=s.obligation_id where s.organization_id=p_organization_id and not o.is_rehearsal and o.status='active' and s.state in ('running','overdue') and s.due_at is not null order by s.due_at,s.id limit 1));
end $$;

-- Guard every automatic monitoring boundary before it can create a production
-- alert, delivery or counted breach for a synthetic obligation.
do $$
declare v_definition text;
begin
  select pg_get_functiondef('public.m6_materialize_reporting_deadline_alerts(uuid,uuid,timestamp with time zone)'::regprocedure) into v_definition;
  v_definition := replace(v_definition, 'begin' || chr(10), 'begin' || chr(10) || ' if exists(select 1 from public.reporting_obligation_stages s join public.reporting_obligations o on o.organization_id=s.organization_id and o.id=s.obligation_id where s.organization_id=p_organization_id and s.id=p_stage_id and o.is_rehearsal) then return 0; end if;' || chr(10));
  execute v_definition;
  select pg_get_functiondef('public.record_reporting_stage_filing_atomic(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamp with time zone,text,text,text,text,bigint,text,text,uuid,uuid)'::regprocedure) into v_definition;
  v_definition := replace(v_definition, 'or o.status<>''active'' or', 'or o.status<>''active'' or o.is_rehearsal or');
  execute v_definition;
  select pg_get_functiondef('public.record_reporting_stage_filing_atomic(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamp with time zone,text,text,text,text,bigint,text,text,uuid,uuid)'::regprocedure) into v_definition;
  v_definition := replace(v_definition, 'FUNCTION public.record_reporting_stage_filing_atomic', 'FUNCTION public.record_reporting_stage_rehearsal_filing_atomic');
  v_definition := replace(v_definition, 'or o.is_rehearsal or', 'or not o.is_rehearsal or');
  v_definition := replace(v_definition, 'btrim(p_reference)', '''SYNTHETIC / REHEARSAL - NOT A LEGAL FILING''');
  v_definition := replace(v_definition, ',p_basis,''reporting-evidence''', ',''synthetic_rehearsal'',''reporting-evidence''');
  v_definition := replace(v_definition, '''basis'',p_basis', '''basis'',''synthetic_rehearsal''');
  execute v_definition;
end $$;

-- The existing evidence API reads artifact rows directly; expose their durable
-- classification rather than requiring every caller to infer it from a parent.
do $$
declare v_definition text;
begin
  select pg_get_functiondef('public.get_reporting_stage_evidence_api(uuid,uuid,uuid)'::regprocedure) into v_definition;
  v_definition := replace(v_definition, $needle$'stage',v_stage.stage_kind,$needle$, $replacement$'stage',v_stage.stage_kind,'isRehearsal',(select is_rehearsal from public.reporting_obligations where organization_id=p_organization_id and id=v_stage.obligation_id),$replacement$);
  v_definition := replace(v_definition, $needle$'stageId',p.stage_id,'approvalId'$needle$, $replacement$'stageId',p.stage_id,'isRehearsal',p.is_rehearsal,'approvalId'$replacement$);
  v_definition := replace(v_definition, $needle$'stage',v_stage.stage_kind,'packageId'$needle$, $replacement$'stage',v_stage.stage_kind,'isRehearsal',s.is_rehearsal,'packageId'$replacement$);
  v_definition := replace(v_definition, $needle$'id',s.id,'fileName'$needle$, $replacement$'id',s.id,'isRehearsal',s.is_rehearsal,'fileName'$replacement$);
  execute v_definition;
  select pg_get_functiondef('public.get_reporting_obligation_evidence_pack_api(uuid,uuid,uuid,uuid)'::regprocedure) into v_definition;
  v_definition := replace(v_definition, $needle$'state',p.state,'objectPath'$needle$, $replacement$'state',p.state,'isRehearsal',p.is_rehearsal,'objectPath'$replacement$);
  execute v_definition;
end $$;

alter function public.m6_reporting_rehearsal_inheritance() owner to postgres;
alter function public.create_reporting_rehearsal_atomic(uuid,uuid,text,timestamptz,text,uuid,uuid) owner to postgres;
alter function public.replay_reporting_rehearsal_atomic(uuid,uuid,uuid,text,integer,uuid,uuid) owner to postgres;
alter function public.record_reporting_stage_rehearsal_filing_atomic(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text,text,text,text,bigint,text,text,uuid,uuid) owner to postgres;
alter function public.list_reporting_obligations(uuid,uuid,text,integer,text,text,uuid,text) owner to postgres;
alter function public.get_reporting_deadline_summary(uuid,uuid) owner to postgres;
revoke all on function public.m6_reporting_rehearsal_inheritance(),public.create_reporting_rehearsal_atomic(uuid,uuid,text,timestamptz,text,uuid,uuid),public.replay_reporting_rehearsal_atomic(uuid,uuid,uuid,text,integer,uuid,uuid),public.record_reporting_stage_rehearsal_filing_atomic(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text,text,text,text,bigint,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_reporting_rehearsal_atomic(uuid,uuid,text,timestamptz,text,uuid,uuid),public.replay_reporting_rehearsal_atomic(uuid,uuid,uuid,text,integer,uuid,uuid),public.record_reporting_stage_rehearsal_filing_atomic(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text,text,text,text,bigint,text,text,uuid,uuid) to service_role;
