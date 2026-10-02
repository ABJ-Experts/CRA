-- CRA-M6-02: durable, PostgreSQL-authoritative reporting deadline monitoring.
-- The database owns logical threshold crossings and delivery state; workers are
-- recoverable transport only.

alter table public.reporting_obligation_stages
  add column if not exists deadline_revision integer not null default 1;
alter table public.reporting_obligation_stages
  drop constraint if exists reporting_obligation_stages_deadline_revision_check,
  add constraint reporting_obligation_stages_deadline_revision_check check (deadline_revision > 0);

alter table public.reporting_obligation_events
  drop constraint if exists reporting_obligation_events_event_kind_check,
  add constraint reporting_obligation_events_event_kind_check check (event_kind in (
    'created', 'anchor_corrected', 'stage_submitted', 'stage_overdue', 'cancelled',
    'deadline_threshold_crossed', 'deadline_breached'
  ));

create table public.reporting_deadline_alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  obligation_id uuid not null,
  stage_id uuid not null,
  deadline_revision integer not null check (deadline_revision > 0),
  threshold_percent integer not null check (threshold_percent in (50, 75, 90, 100)),
  idempotency_key text not null,
  threshold_crossed_at timestamptz not null,
  due_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id),
  unique (idempotency_key),
  unique (stage_id, deadline_revision, threshold_percent),
  foreign key (organization_id, obligation_id)
    references public.reporting_obligations(organization_id, id) on delete cascade,
  foreign key (organization_id, stage_id)
    references public.reporting_obligation_stages(organization_id, id) on delete cascade
);
create index reporting_deadline_alerts_stage_idx
  on public.reporting_deadline_alerts(organization_id, stage_id, created_at);

create table public.reporting_deadline_alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  alert_id uuid not null,
  recipient_user_id uuid not null references public.users(id) on delete restrict,
  channel text not null check (channel = 'email'),
  delivery_state text not null default 'queued'
    check (delivery_state in ('queued', 'leased', 'retrying', 'delivered', 'cancelled', 'dead_letter')),
  delivery_attempts integer not null default 0 check (delivery_attempts >= 0),
  due_at timestamptz not null default clock_timestamp(),
  last_attempt_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  checkpoint_version integer not null default 1 check (checkpoint_version > 0),
  last_error_code text,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id),
  unique (alert_id, recipient_user_id, channel),
  foreign key (organization_id, alert_id)
    references public.reporting_deadline_alerts(organization_id, id) on delete cascade,
  check ((delivery_state = 'leased') = (lease_owner is not null and lease_expires_at is not null)),
  check ((delivery_state = 'delivered') = (delivered_at is not null)),
  check ((delivery_state = 'cancelled') = (cancelled_at is not null))
);
create index reporting_deadline_alert_deliveries_due_idx
  on public.reporting_deadline_alert_deliveries(organization_id, due_at, id)
  where delivery_state in ('queued', 'retrying', 'leased');
drop trigger if exists set_reporting_deadline_alert_deliveries_updated_at on public.reporting_deadline_alert_deliveries;
create trigger set_reporting_deadline_alert_deliveries_updated_at
  before update on public.reporting_deadline_alert_deliveries
  for each row execute function public.set_updated_at();

create table public.reporting_deadline_monitor_health (
  singleton boolean primary key default true check (singleton),
  last_evaluated_at timestamptz,
  last_database_now timestamptz,
  last_clock_skew_milliseconds integer,
  critical_at timestamptz,
  updated_at timestamptz not null default clock_timestamp()
);
insert into public.reporting_deadline_monitor_health(singleton) values (true) on conflict (singleton) do nothing;

alter table public.reporting_deadline_alerts enable row level security;
alter table public.reporting_deadline_alert_deliveries enable row level security;
alter table public.reporting_deadline_monitor_health enable row level security;
revoke all on table public.reporting_deadline_alerts, public.reporting_deadline_alert_deliveries,
  public.reporting_deadline_monitor_health from public, anon, authenticated;
grant all on table public.reporting_deadline_alerts, public.reporting_deadline_alert_deliveries,
  public.reporting_deadline_monitor_health to service_role;

-- Stage refresh does not create a breach merely because a command ran after
-- the deadline. The reconciler below owns the threshold/event transaction.
create or replace function public.m6_refresh_reporting_obligation_stages(
  p_organization_id uuid, p_obligation_id uuid, p_now timestamptz default clock_timestamp()
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_obligation public.reporting_obligations%rowtype; v_stage public.reporting_obligation_stages%rowtype;
  v_anchor timestamptz; v_due timestamptz;
begin
  select * into v_obligation from public.reporting_obligations where organization_id=p_organization_id and id=p_obligation_id for update;
  if not found then return; end if;
  for v_stage in select * from public.reporting_obligation_stages where organization_id=p_organization_id and obligation_id=p_obligation_id for update loop
    if v_obligation.status='cancelled' and v_stage.submitted_at is null then
      update public.reporting_obligation_stages set state='not_required',updated_at=date_trunc('second',p_now),version=version+1 where organization_id=p_organization_id and id=v_stage.id;
    elsif v_stage.submitted_at is not null then
      update public.reporting_obligation_stages set state='submitted',overdue_at=case when overdue_at is null and due_at is not null and submitted_at>due_at then due_at else overdue_at end,updated_at=date_trunc('second',p_now) where organization_id=p_organization_id and id=v_stage.id;
    else
      v_anchor:=public.m6_anchor_at(v_obligation,v_stage.anchor_kind);
      v_due:=case when v_anchor is null then null else public.m6_due_at(v_anchor,v_stage.duration) end;
      update public.reporting_obligation_stages set due_at=date_trunc('second',v_due),
        state=case when v_due is null then 'pending_anchor' when overdue_at is not null then 'overdue' else 'running' end,
        overdue_at=case when v_due is null then null else overdue_at end,
        deadline_revision=case when v_stage.due_at is null then deadline_revision when v_stage.due_at is distinct from date_trunc('second',v_due) then deadline_revision+1 else deadline_revision end,
        updated_at=date_trunc('second',p_now)
      where organization_id=p_organization_id and id=v_stage.id;
    end if;
  end loop;
end $$;

create or replace function public.m6_reporting_stage_json(p_organization_id uuid,p_stage_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
 select jsonb_build_object('id',s.id,'kind',s.stage_kind,'anchor',s.anchor_kind,'duration',s.duration,'state',s.state,
  'dueAt',case when s.due_at is null then null else public.m6_utc_second_z(s.due_at) end,
  'submittedAt',case when s.submitted_at is null then null else public.m6_utc_second_z(s.submitted_at) end,
  'overdueAt',case when s.overdue_at is null then null else public.m6_utc_second_z(s.overdue_at) end,
  'version',s.version,'deadlineRevision',s.deadline_revision,
  -- The following alignment migration replaces this placeholder after the
  -- elapsed helper is created. Keeping this definition self-contained lets a
  -- fresh database apply the migration in dependency order.
  'elapsedPercent',null::integer,
  'breachedAt',(select public.m6_utc_second_z(a.threshold_crossed_at) from public.reporting_deadline_alerts a where a.organization_id=s.organization_id and a.stage_id=s.id and a.deadline_revision=s.deadline_revision and a.threshold_percent=100 limit 1))
 from public.reporting_obligation_stages s where s.organization_id=p_organization_id and s.id=p_stage_id
$$;

create or replace function public.m6_reporting_stage_elapsed_percent(p_organization_id uuid,p_stage_id uuid,p_database_now timestamptz)
returns integer language sql stable security definer set search_path = public, pg_temp as $$
 select case when s.due_at is null or public.m6_anchor_at(o,s.anchor_kind) is null then null
  when s.due_at<=public.m6_anchor_at(o,s.anchor_kind) then 100
  else greatest(0,least(100,floor(100*extract(epoch from p_database_now-public.m6_anchor_at(o,s.anchor_kind))/extract(epoch from s.due_at-public.m6_anchor_at(o,s.anchor_kind)))::integer)) end
 from public.reporting_obligation_stages s join public.reporting_obligations o on o.organization_id=s.organization_id and o.id=s.obligation_id
 where s.organization_id=p_organization_id and s.id=p_stage_id
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
   where m.organization_id=p_organization_id and m.role in ('owner','admin') and 'email'=any(settings.notification_channel_ids)
    and public.m5_triage_actor_has_permission(p_organization_id,m.user_id,'can_view_findings')
   on conflict(alert_id,recipient_user_id,channel) do nothing;
  v_created:=v_created+1;
 end loop;
 if v_elapsed>=100 and v_stage.state='running' then update public.reporting_obligation_stages set state='overdue',overdue_at=coalesce(overdue_at,due_at),version=version+1,updated_at=date_trunc('second',p_database_now) where organization_id=p_organization_id and id=v_stage.id; end if;
 return v_created;
end $$;

create or replace function public.get_reporting_deadline_monitor_now()
returns table(database_now timestamptz) language sql stable security definer set search_path = public, pg_temp as $$ select date_trunc('second',clock_timestamp()) $$;

create or replace function public.reconcile_reporting_deadline_monitoring_atomic(p_database_now timestamptz default null,p_limit integer default 1000)
returns table(outcome text,evaluated integer,emitted integer,database_now timestamptz) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_now timestamptz:=date_trunc('second',coalesce(p_database_now,clock_timestamp())); v_stage record; v_evaluated integer:=0; v_emitted integer:=0;
begin
 if p_limit not between 1 and 10000 then return query select 'invalid_request'::text,0,0,v_now; return; end if;
 for v_stage in select s.organization_id,s.id from public.reporting_obligation_stages s join public.reporting_obligations o on o.organization_id=s.organization_id and o.id=s.obligation_id where o.status<>'cancelled' and s.due_at is not null and s.state in ('running','overdue','submitted') order by s.due_at,s.id limit p_limit for update of s skip locked loop
  v_evaluated:=v_evaluated+1; v_emitted:=v_emitted+public.m6_materialize_reporting_deadline_alerts(v_stage.organization_id,v_stage.id,v_now);
 end loop;
 update public.reporting_deadline_alert_deliveries d set delivery_state='cancelled',cancelled_at=v_now,lease_owner=null,lease_expires_at=null
 from public.reporting_deadline_alerts a join public.reporting_obligations o on o.organization_id=a.organization_id and o.id=a.obligation_id join public.reporting_obligation_stages s on s.organization_id=a.organization_id and s.id=a.stage_id
 where d.organization_id=a.organization_id and d.alert_id=a.id and d.delivery_state in ('queued','retrying','leased') and (o.status='cancelled' or s.state in ('submitted','not_required'));
 update public.reporting_deadline_monitor_health set last_evaluated_at=v_now,last_database_now=v_now,updated_at=v_now where singleton;
 return query select 'reconciled'::text,v_evaluated,v_emitted,v_now;
end $$;

create or replace function public.list_due_reporting_deadline_alert_organizations(p_limit integer default 1000)
returns table(organization_id uuid) language sql stable security definer set search_path = public, pg_temp as $$
 select distinct d.organization_id from public.reporting_deadline_alert_deliveries d where p_limit between 1 and 10000 and d.due_at<=clock_timestamp() and (d.delivery_state in ('queued','retrying') or (d.delivery_state='leased' and d.lease_expires_at<=clock_timestamp())) order by d.organization_id limit p_limit
$$;

create or replace function public.claim_reporting_deadline_alert_delivery_atomic(p_organization_id uuid,p_worker_id text,p_lease_seconds integer default 120)
returns table(outcome text,delivery jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_delivery public.reporting_deadline_alert_deliveries%rowtype;
begin
 if p_organization_id is null or char_length(btrim(coalesce(p_worker_id,''))) not between 1 and 200 or p_lease_seconds not between 15 and 900 then return query select 'invalid_request'::text,null::jsonb; return; end if;
 select * into v_delivery from public.reporting_deadline_alert_deliveries d where d.organization_id=p_organization_id and d.due_at<=clock_timestamp() and (d.delivery_state in ('queued','retrying') or (d.delivery_state='leased' and d.lease_expires_at<=clock_timestamp())) order by d.due_at,d.id for update skip locked limit 1;
 if not found then return query select 'none_available'::text,null::jsonb; return; end if;
 update public.reporting_deadline_alert_deliveries set delivery_state='leased',delivery_attempts=delivery_attempts+1,last_attempt_at=clock_timestamp(),lease_owner=btrim(p_worker_id),lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),checkpoint_version=checkpoint_version+1,last_error_code=null where organization_id=p_organization_id and id=v_delivery.id returning * into v_delivery;
 return query select 'claimed'::text,jsonb_build_object('id',v_delivery.id,'organizationId',p_organization_id,'checkpointVersion',v_delivery.checkpoint_version,'alertId',v_delivery.alert_id,'recipientUserId',v_delivery.recipient_user_id,'channel',v_delivery.channel);
end $$;

create or replace function public.get_reporting_deadline_alert_delivery_details(p_organization_id uuid,p_delivery_id uuid,p_worker_id text,p_expected_checkpoint_version integer)
returns table(outcome text,details jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_delivery public.reporting_deadline_alert_deliveries%rowtype; v_alert public.reporting_deadline_alerts%rowtype; v_stage public.reporting_obligation_stages%rowtype; v_obligation public.reporting_obligations%rowtype; v_email_enabled boolean;
begin
 select * into v_delivery from public.reporting_deadline_alert_deliveries d where d.organization_id=p_organization_id and d.id=p_delivery_id for update;
 if not found then return query select 'not_found'::text,null::jsonb; return; end if;
 if v_delivery.delivery_state<>'leased' or v_delivery.lease_owner is distinct from btrim(p_worker_id) or v_delivery.checkpoint_version<>p_expected_checkpoint_version then return query select 'conflict'::text,null::jsonb; return; end if;
 select * into v_alert from public.reporting_deadline_alerts a where a.organization_id=p_organization_id and a.id=v_delivery.alert_id;
 select * into v_stage from public.reporting_obligation_stages s where s.organization_id=p_organization_id and s.id=v_alert.stage_id;
 select * into v_obligation from public.reporting_obligations o where o.organization_id=p_organization_id and o.id=v_alert.obligation_id;
 select 'email'=any(settings.notification_channel_ids) into v_email_enabled from public.organization_settings settings where settings.organization_id=p_organization_id;
 if not found or v_alert.id is null or v_stage.id is null or v_obligation.id is null or v_obligation.status='cancelled' or v_stage.state in ('submitted','not_required') or not coalesce(v_email_enabled,false) or not exists(select 1 from public.organization_members m join public.users u on u.id=m.user_id and u.is_active where m.organization_id=p_organization_id and m.user_id=v_delivery.recipient_user_id and m.role in ('owner','admin') and public.m5_triage_actor_has_permission(p_organization_id,m.user_id,'can_view_findings')) then
  update public.reporting_deadline_alert_deliveries set delivery_state='cancelled',cancelled_at=clock_timestamp(),lease_owner=null,lease_expires_at=null where organization_id=p_organization_id and id=v_delivery.id;
  return query select 'cancelled'::text,null::jsonb; return;
 end if;
 return query select 'found'::text,jsonb_build_object('deliveryId',v_delivery.id,'recipient',jsonb_build_object('userId',v_delivery.recipient_user_id,'email',(select u.email from public.users u where u.id=v_delivery.recipient_user_id)),'obligationId',v_obligation.id,'stageKind',v_stage.stage_kind,'thresholdPercent',v_alert.threshold_percent,'dueAt',public.m6_utc_second_z(v_alert.due_at),'idempotencyKey',v_alert.idempotency_key);
end $$;

create or replace function public.complete_reporting_deadline_alert_delivery_atomic(p_organization_id uuid,p_delivery_id uuid,p_worker_id text,p_expected_checkpoint_version integer)
returns table(outcome text) language plpgsql security definer set search_path = public, pg_temp as $$
begin update public.reporting_deadline_alert_deliveries set delivery_state='delivered',delivered_at=clock_timestamp(),lease_owner=null,lease_expires_at=null,last_error_code=null where organization_id=p_organization_id and id=p_delivery_id and delivery_state='leased' and lease_owner=btrim(p_worker_id) and checkpoint_version=p_expected_checkpoint_version; if found then return query select 'completed'::text; else return query select 'conflict'::text; end if; end $$;

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

create or replace function public.observe_reporting_deadline_monitor_clock_skew_atomic(p_observed_at timestamptz,p_clock_skew_milliseconds integer)
returns table(outcome text,critical boolean) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_now timestamptz:=date_trunc('second',coalesce(p_observed_at,clock_timestamp()));
begin
 if p_clock_skew_milliseconds is null or p_clock_skew_milliseconds<0 or p_clock_skew_milliseconds>86400000 then return query select 'invalid_request'::text,null::boolean; return; end if;
 update public.reporting_deadline_monitor_health set last_clock_skew_milliseconds=p_clock_skew_milliseconds,critical_at=case when p_clock_skew_milliseconds>=1000 then v_now else null end,updated_at=v_now where singleton;
 return query select 'observed'::text,p_clock_skew_milliseconds>=1000;
end $$;

create or replace function public.get_reporting_deadline_monitor_health()
returns table(outcome text,health jsonb) language sql stable security definer set search_path = public, pg_temp as $$
 select 'found'::text,jsonb_build_object('lastEvaluatedAt',case when h.last_evaluated_at is null then null else public.m6_utc_second_z(h.last_evaluated_at) end,'lastDatabaseNow',case when h.last_database_now is null then null else public.m6_utc_second_z(h.last_database_now) end,'lastClockSkewMilliseconds',h.last_clock_skew_milliseconds,'critical',h.critical_at is not null,'criticalAt',case when h.critical_at is null then null else public.m6_utc_second_z(h.critical_at) end) from public.reporting_deadline_monitor_health h where h.singleton
$$;

create or replace function public.get_reporting_deadline_summary(p_organization_id uuid,p_actor_user_id uuid)
returns table(outcome text,summary jsonb) language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_now timestamptz:=date_trunc('second',clock_timestamp());
begin
 if p_organization_id is null or p_actor_user_id is null or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_findings') then return query select 'not_found'::text,null::jsonb; return; end if;
 return query select 'found'::text,jsonb_build_object('serverNow',public.m6_utc_second_z(v_now),'activeStageCount',(select count(*) from public.reporting_obligation_stages s join public.reporting_obligations o on o.organization_id=s.organization_id and o.id=s.obligation_id where s.organization_id=p_organization_id and o.status='active' and s.state in ('running','overdue')),'overdueStageCount',(select count(*) from public.reporting_obligation_stages s join public.reporting_obligations o on o.organization_id=s.organization_id and o.id=s.obligation_id where s.organization_id=p_organization_id and o.status='active' and (s.state='overdue' or (s.state='running' and s.due_at<=v_now))),'next',(select jsonb_build_object('obligationId',s.obligation_id,'stageKind',s.stage_kind,'dueAt',public.m6_utc_second_z(s.due_at),'elapsedPercent',public.m6_reporting_stage_elapsed_percent(p_organization_id,s.id,v_now),'deadlineRevision',s.deadline_revision) from public.reporting_obligation_stages s join public.reporting_obligations o on o.organization_id=s.organization_id and o.id=s.obligation_id where s.organization_id=p_organization_id and o.status='active' and s.state in ('running','overdue') and s.due_at is not null order by s.due_at,s.id limit 1));
end $$;

insert into public.organization_export_source_tables(source_id,table_name,tenant_key_column,record_order_column,table_sort) values
 ('reporting_obligations','reporting_deadline_alerts','organization_id','id',4),
 ('reporting_obligations','reporting_deadline_alert_deliveries','organization_id','id',5)
on conflict(source_id,table_name) do update set tenant_key_column=excluded.tenant_key_column,record_order_column=excluded.record_order_column,table_sort=excluded.table_sort;

do $$
declare v_definition text; v_old_lock text:='public.vulnerability_finding_note_mentions, public.reporting_obligations, public.reporting_obligation_stages, public.reporting_obligation_events'||chr(10)||'  in share mode'; v_new_lock text:='public.vulnerability_finding_note_mentions, public.reporting_obligations, public.reporting_obligation_stages, public.reporting_obligation_events, public.reporting_deadline_alerts, public.reporting_deadline_alert_deliveries'||chr(10)||'  in share mode';
begin
 select pg_get_functiondef(to_regprocedure('public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)')) into v_definition;
 if position(v_new_lock in v_definition)>0 then return; end if;
 if position(v_old_lock in v_definition)=0 then raise exception 'M6-02 export lock anchor is missing'; end if;
 execute replace(v_definition,v_old_lock,v_new_lock);
end $$;

do $$
declare v_signature text;
begin
 foreach v_signature in array array['m6_refresh_reporting_obligation_stages(uuid,uuid,timestamp with time zone)','m6_reporting_stage_json(uuid,uuid)','m6_reporting_stage_elapsed_percent(uuid,uuid,timestamp with time zone)','m6_materialize_reporting_deadline_alerts(uuid,uuid,timestamp with time zone)','get_reporting_deadline_monitor_now()','reconcile_reporting_deadline_monitoring_atomic(timestamp with time zone,integer)','list_due_reporting_deadline_alert_organizations(integer)','claim_reporting_deadline_alert_delivery_atomic(uuid,text,integer)','get_reporting_deadline_alert_delivery_details(uuid,uuid,text,integer)','complete_reporting_deadline_alert_delivery_atomic(uuid,uuid,text,integer)','fail_reporting_deadline_alert_delivery_atomic(uuid,uuid,text,integer,text,boolean)','observe_reporting_deadline_monitor_clock_skew_atomic(timestamp with time zone,integer)','get_reporting_deadline_monitor_health()','get_reporting_deadline_summary(uuid,uuid)'] loop execute 'alter function public.'||v_signature||' owner to postgres'; end loop;
end $$;

revoke all on function public.m6_refresh_reporting_obligation_stages(uuid,uuid,timestamptz),public.m6_reporting_stage_json(uuid,uuid),public.m6_reporting_stage_elapsed_percent(uuid,uuid,timestamptz),public.m6_materialize_reporting_deadline_alerts(uuid,uuid,timestamptz),public.get_reporting_deadline_monitor_now(),public.reconcile_reporting_deadline_monitoring_atomic(timestamptz,integer),public.list_due_reporting_deadline_alert_organizations(integer),public.claim_reporting_deadline_alert_delivery_atomic(uuid,text,integer),public.get_reporting_deadline_alert_delivery_details(uuid,uuid,text,integer),public.complete_reporting_deadline_alert_delivery_atomic(uuid,uuid,text,integer),public.fail_reporting_deadline_alert_delivery_atomic(uuid,uuid,text,integer,text,boolean),public.observe_reporting_deadline_monitor_clock_skew_atomic(timestamptz,integer),public.get_reporting_deadline_monitor_health(),public.get_reporting_deadline_summary(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_reporting_deadline_monitor_now(),public.reconcile_reporting_deadline_monitoring_atomic(timestamptz,integer),public.list_due_reporting_deadline_alert_organizations(integer),public.claim_reporting_deadline_alert_delivery_atomic(uuid,text,integer),public.get_reporting_deadline_alert_delivery_details(uuid,uuid,text,integer),public.complete_reporting_deadline_alert_delivery_atomic(uuid,uuid,text,integer),public.fail_reporting_deadline_alert_delivery_atomic(uuid,uuid,text,integer,text,boolean),public.observe_reporting_deadline_monitor_clock_skew_atomic(timestamptz,integer),public.get_reporting_deadline_monitor_health(),public.get_reporting_deadline_summary(uuid,uuid) to service_role;
