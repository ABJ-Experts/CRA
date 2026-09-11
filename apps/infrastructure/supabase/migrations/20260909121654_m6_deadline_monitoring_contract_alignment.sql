-- Align the already-applied local M6-02 migration with the typed worker and
-- UI contract without changing historical deadline facts or delivery records.

alter table public.reporting_deadline_alerts add column if not exists idempotency_key text;
update public.reporting_deadline_alerts
set idempotency_key = concat('reporting-deadline:', stage_id::text, ':', deadline_revision::text, ':', threshold_percent::text)
where idempotency_key is null;
alter table public.reporting_deadline_alerts alter column idempotency_key set not null;
alter table public.reporting_deadline_alerts
  drop constraint if exists reporting_deadline_alerts_idempotency_key_key,
  add constraint reporting_deadline_alerts_idempotency_key_key unique (idempotency_key);

create or replace function public.m6_reporting_stage_json(p_organization_id uuid,p_stage_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
 select jsonb_build_object('id',s.id,'kind',s.stage_kind,'anchor',s.anchor_kind,'duration',s.duration,'state',s.state,
  'dueAt',case when s.due_at is null then null else public.m6_utc_second_z(s.due_at) end,
  'submittedAt',case when s.submitted_at is null then null else public.m6_utc_second_z(s.submitted_at) end,
  'overdueAt',case when s.overdue_at is null then null else public.m6_utc_second_z(s.overdue_at) end,
  'version',s.version,'deadlineRevision',s.deadline_revision,
  'elapsedPercent',public.m6_reporting_stage_elapsed_percent(s.organization_id,s.id,date_trunc('second',clock_timestamp())),
  'breachedAt',(select public.m6_utc_second_z(a.threshold_crossed_at) from public.reporting_deadline_alerts a where a.organization_id=s.organization_id and a.stage_id=s.id and a.deadline_revision=s.deadline_revision and a.threshold_percent=100 limit 1))
 from public.reporting_obligation_stages s where s.organization_id=p_organization_id and s.id=p_stage_id
$$;

create or replace function public.m6_materialize_reporting_deadline_alerts(p_organization_id uuid,p_stage_id uuid,p_database_now timestamptz)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_stage public.reporting_obligation_stages%rowtype; v_obligation public.reporting_obligations%rowtype;
  v_threshold integer; v_elapsed integer; v_alert_id uuid; v_created integer:=0;
begin
 select s.* into v_stage from public.reporting_obligation_stages s where s.organization_id=p_organization_id and s.id=p_stage_id for update;
 if not found or v_stage.due_at is null then return 0; end if;
 select o.* into v_obligation from public.reporting_obligations o where o.organization_id=p_organization_id and o.id=v_stage.obligation_id;
 if not found or v_obligation.status='cancelled' then return 0; end if;
 v_elapsed:=public.m6_reporting_stage_elapsed_percent(p_organization_id,p_stage_id,p_database_now);
 if v_elapsed is null then return 0; end if;
 for v_threshold in select unnest(array[50,75,90,100]) loop
  if v_elapsed<v_threshold then continue; end if;
  v_alert_id:=null;
  insert into public.reporting_deadline_alerts(organization_id,obligation_id,stage_id,deadline_revision,threshold_percent,idempotency_key,threshold_crossed_at,due_at)
   values(p_organization_id,v_stage.obligation_id,v_stage.id,v_stage.deadline_revision,v_threshold,concat('reporting-deadline:',v_stage.id::text,':',v_stage.deadline_revision::text,':',v_threshold::text),date_trunc('second',p_database_now),v_stage.due_at)
   on conflict(stage_id,deadline_revision,threshold_percent) do nothing returning id into v_alert_id;
  if v_alert_id is null then continue; end if;
  insert into public.reporting_obligation_events(organization_id,obligation_id,event_kind,stage_kind,occurred_at,new_value)
   values(p_organization_id,v_stage.obligation_id,case when v_threshold=100 then 'deadline_breached' else 'deadline_threshold_crossed' end,v_stage.stage_kind,date_trunc('second',p_database_now),jsonb_build_object('thresholdPercent',v_threshold,'deadlineRevision',v_stage.deadline_revision,'dueAt',public.m6_utc_second_z(v_stage.due_at),'elapsedPercent',v_elapsed));
  insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
   values(p_organization_id,case when v_threshold=100 then 'reporting.deadline_breached.high' else 'reporting.deadline_threshold_crossed' end,'reporting_obligation',v_stage.obligation_id::text,jsonb_build_object('stage',v_stage.stage_kind,'thresholdPercent',v_threshold,'deadlineRevision',v_stage.deadline_revision,'dueAt',public.m6_utc_second_z(v_stage.due_at),'severity',case when v_threshold=100 then 'high' else 'warning' end));
  insert into public.reporting_deadline_alert_deliveries(organization_id,alert_id,recipient_user_id,channel,due_at)
   select p_organization_id,v_alert_id,m.user_id,'email',date_trunc('second',p_database_now)
   from public.organization_members m join public.users u on u.id=m.user_id and u.is_active join public.organization_settings settings on settings.organization_id=m.organization_id
   where m.organization_id=p_organization_id and m.role in ('owner','admin') and 'email'=any(settings.notification_channel_ids) and public.m5_triage_actor_has_permission(p_organization_id,m.user_id,'can_view_findings')
   on conflict(alert_id,recipient_user_id,channel) do nothing;
  v_created:=v_created+1;
 end loop;
 if v_elapsed>=100 and v_stage.state='running' then update public.reporting_obligation_stages set state='overdue',overdue_at=coalesce(overdue_at,due_at),version=version+1,updated_at=date_trunc('second',p_database_now) where organization_id=p_organization_id and id=v_stage.id; end if;
 return v_created;
end $$;

drop function public.get_reporting_deadline_monitor_now();
create function public.get_reporting_deadline_monitor_now()
returns table(database_now timestamptz) language sql stable security definer set search_path = public, pg_temp as $$ select date_trunc('second',clock_timestamp()) $$;

drop function if exists public.fail_reporting_deadline_alert_delivery_atomic(uuid,uuid,text,integer,text,boolean);
create function public.fail_reporting_deadline_alert_delivery_atomic(p_organization_id uuid,p_delivery_id uuid,p_worker_id text,p_expected_checkpoint_version integer,p_code text,p_retryable boolean)
returns table(outcome text) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_delivery public.reporting_deadline_alert_deliveries%rowtype; v_state text;
begin
 select * into v_delivery from public.reporting_deadline_alert_deliveries d where d.organization_id=p_organization_id and d.id=p_delivery_id and d.delivery_state='leased' and d.lease_owner=btrim(p_worker_id) and d.checkpoint_version=p_expected_checkpoint_version for update;
 if not found then return query select 'conflict'::text; return; end if;
 v_state:=case when not p_retryable or v_delivery.delivery_attempts>=12 then 'dead_letter' else 'retrying' end;
 update public.reporting_deadline_alert_deliveries set delivery_state=v_state,lease_owner=null,lease_expires_at=null,last_error_code=left(coalesce(nullif(btrim(p_code),''),'provider_unavailable'),100),due_at=case when v_state='dead_letter' then due_at else clock_timestamp()+make_interval(secs=>least(3600,greatest(30,30*power(2,least(v_delivery.delivery_attempts,7))::integer))) end where organization_id=p_organization_id and id=p_delivery_id;
 return query select case when v_state='dead_letter' then 'dead_letter' else 'retry_scheduled' end;
end $$;

create or replace function public.get_reporting_deadline_summary(p_organization_id uuid,p_actor_user_id uuid)
returns table(outcome text,summary jsonb) language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_now timestamptz:=date_trunc('second',clock_timestamp());
begin
 if p_organization_id is null or p_actor_user_id is null or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_findings') then return query select 'not_found'::text,null::jsonb; return; end if;
 return query select 'found'::text,jsonb_build_object('serverNow',public.m6_utc_second_z(v_now),'overdueCount',(select count(*) from public.reporting_obligation_stages s join public.reporting_obligations o on o.organization_id=s.organization_id and o.id=s.obligation_id where s.organization_id=p_organization_id and o.status='active' and (s.state='overdue' or (s.state='running' and s.due_at<=v_now))),'nextDeadline',(select jsonb_build_object('obligationId',s.obligation_id,'stage',s.stage_kind,'dueAt',public.m6_utc_second_z(s.due_at),'elapsedPercent',public.m6_reporting_stage_elapsed_percent(p_organization_id,s.id,v_now),'reportingHref','/reporting?obligationId='||s.obligation_id::text) from public.reporting_obligation_stages s join public.reporting_obligations o on o.organization_id=s.organization_id and o.id=s.obligation_id where s.organization_id=p_organization_id and o.status='active' and s.state in ('running','overdue') and s.due_at is not null order by s.due_at,s.id limit 1));
end $$;

alter function public.m6_reporting_stage_json(uuid,uuid) owner to postgres;
alter function public.m6_materialize_reporting_deadline_alerts(uuid,uuid,timestamptz) owner to postgres;
alter function public.get_reporting_deadline_monitor_now() owner to postgres;
alter function public.fail_reporting_deadline_alert_delivery_atomic(uuid,uuid,text,integer,text,boolean) owner to postgres;
alter function public.get_reporting_deadline_summary(uuid,uuid) owner to postgres;
revoke all on function public.m6_reporting_stage_json(uuid,uuid),public.m6_materialize_reporting_deadline_alerts(uuid,uuid,timestamptz),public.get_reporting_deadline_monitor_now(),public.fail_reporting_deadline_alert_delivery_atomic(uuid,uuid,text,integer,text,boolean),public.get_reporting_deadline_summary(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_reporting_deadline_monitor_now(),public.fail_reporting_deadline_alert_delivery_atomic(uuid,uuid,text,integer,text,boolean),public.get_reporting_deadline_summary(uuid,uuid) to service_role;
