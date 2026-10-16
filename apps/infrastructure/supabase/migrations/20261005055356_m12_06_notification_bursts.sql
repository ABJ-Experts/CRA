-- M12-06. Short optional-email bursts use the existing dispatch and batch
-- ledgers. The source outboxes remain the event/audit record.
alter table public.organization_settings
  add column notification_burst_enabled boolean not null default false,
  add column notification_burst_version integer not null default 1
    check (notification_burst_version > 0),
  add column notification_burst_started_at timestamptz,
  add column notification_burst_updated_at timestamptz not null default clock_timestamp();

alter table public.notification_dispatches
  add column event_class text not null default 'legacy_event',
  add column semantic_revision text not null default '1'
    check (char_length(semantic_revision) between 1 and 120
      and semantic_revision !~ '[[:cntrl:]]'),
  drop constraint notification_dispatches_status_check,
  add constraint notification_dispatches_status_check
    check (status in ('queued','leased','provider_accepted','delivered','retrying',
      'failed','exhausted','cancelled','suppressed','digest_pending','burst_pending'));

alter table public.notification_digest_batches
  add column batch_kind text not null default 'digest'
    check (batch_kind in ('digest','burst')),
  add column event_class text,
  add column prepared_dispatch_ids uuid[] not null default '{}'::uuid[]
    check (cardinality(prepared_dispatch_ids) between 0 and 100
      and prepared_dispatch_ids <@ dispatch_ids),
  add constraint notification_digest_batches_burst_event_class_check
    check ((batch_kind='digest' and event_class is null)
      or (batch_kind='burst' and event_class is not null));

create index notification_dispatches_burst_due_idx
  on public.notification_dispatches(organization_id,event_class,
    effective_recipient_user_id,created_at,id)
  where status='burst_pending';
create index notification_digest_batches_burst_due_idx
  on public.notification_digest_batches(organization_id,next_attempt_at,id)
  where batch_kind='burst' and status in ('queued','retrying','leased');

-- Keep M12-03's narrower (org, source type, source event ID, recipient)
-- uniqueness and bridge ON CONFLICT targets. Eligible sources are immutable
-- event rows: M5 alert events (including reopened SLA cycles), M8 outbox
-- events (document version + threshold), and M9 reminder deliveries (request
-- revision + due snapshot) each create a new UUID for a changed event.
-- semantic_revision records the source's semantic generation but never
-- authorizes a second dispatch for the same source event and recipient.
create unique index notification_dispatches_semantic_retry_idx
  on public.notification_dispatches(organization_id,original_recipient_user_id,
    event_class,source_type,source_id,semantic_revision);

create function public.m12_06_dispatch_event_class(
  p_source_type text,p_source_subtype text
) returns text language sql immutable set search_path=public,pg_temp as $$
  select case
    when p_source_type='finding_triage_alert' and p_source_subtype='internal_sla_breached'
      then 'finding_sla_breached'
    when p_source_type='finding_triage_alert' and p_source_subtype='suppression_expired'
      then 'finding_suppression_expired'
    when p_source_type='evidence_validity' then 'evidence_validity_expiring'
    when p_source_type='supplier_owner_escalation' then 'supplier_owner_escalation'
    else 'critical_or_legacy_event'
  end
$$;

update public.notification_dispatches
set event_class=public.m12_06_dispatch_event_class(source_type,source_subtype)
where event_class='legacy_event';

create function public.m12_06_source_created_at(
  p_organization_id uuid,p_source_type text,p_source_id uuid
) returns timestamptz language sql stable security definer
set search_path=public,pg_temp as $$
  select case p_source_type
    when 'finding_triage_alert' then (
      select e.created_at from public.vulnerability_triage_alert_events e
      where e.organization_id=p_organization_id and e.id=p_source_id)
    when 'evidence_validity' then (
      select e.created_at from public.evidence_document_notification_outbox e
      where e.organization_id=p_organization_id and e.id=p_source_id)
    when 'supplier_owner_escalation' then (
      select e.created_at from public.supplier_evidence_reminder_deliveries e
      where e.organization_id=p_organization_id and e.id=p_source_id)
    else null::timestamptz end
$$;

create function public.m12_06_classify_dispatch()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_enabled boolean; v_started timestamptz; v_severity text;
begin
  new.event_class:=public.m12_06_dispatch_event_class(new.source_type,new.source_subtype);
  if new.semantic_revision is null then new.semantic_revision:='1'; end if;
  if new.status<>'queued' or new.event_class not in
    ('finding_sla_breached','finding_suppression_expired',
      'evidence_validity_expiring','supplier_owner_escalation') then
    return new;
  end if;
  select s.notification_burst_enabled,s.notification_burst_started_at
    into v_enabled,v_started
  from public.organization_settings s
  where s.organization_id=new.organization_id
    and s.notification_delivery_mode='unified';
  if not coalesce(v_enabled,false) or v_started is null
    or new.created_at<v_started
    or coalesce(public.m12_06_source_created_at(
      new.organization_id,new.source_type,new.source_id)<v_started,true)
    then return new; end if;
  if new.source_type='finding_triage_alert' then
    select case public.m5_triage_finding_severity(new.organization_id,e.finding_id)
      when 'critical' then 'critical' when 'high' then 'high'
      when 'medium' then 'warning' else 'info' end into v_severity
    from public.vulnerability_triage_alert_events e
    where e.organization_id=new.organization_id and e.id=new.source_id;
    if v_severity not in ('info','warning') then return new; end if;
  end if;
  new.status:='burst_pending';
  return new;
end $$;

create function public.m12_06_burst_dispatch_eligible(
  p_organization_id uuid,p_dispatch_id uuid
) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce((
    select s.notification_burst_enabled
      and s.notification_delivery_mode='unified'
      and s.notification_burst_started_at is not null
      and d.created_at>=s.notification_burst_started_at
      and public.m12_06_source_created_at(
        d.organization_id,d.source_type,d.source_id)
        >=s.notification_burst_started_at
      and d.event_class in ('finding_sla_breached','finding_suppression_expired',
        'evidence_validity_expiring','supplier_owner_escalation')
      and coalesce(pref.modes->>d.category,'immediate')='immediate'
      and exists(select 1 from public.organization_members m
        join public.users u on u.id=m.user_id and u.is_active
        where m.organization_id=d.organization_id
          and m.user_id=d.effective_recipient_user_id)
    from public.notification_dispatches d
    join public.organization_settings s on s.organization_id=d.organization_id
    left join public.notification_preferences pref on
      pref.organization_id=d.organization_id
      and pref.user_id=d.effective_recipient_user_id
    where d.organization_id=p_organization_id and d.id=p_dispatch_id
  ),false)
$$;

-- The scheduler only groups identities. Every attempted delivery uses this
-- full current source, permission and severity check twice: preparation and
-- immediately before SMTP.
create function public.m12_06_burst_dispatch_delivery_valid(
  p_organization_id uuid,p_dispatch_id uuid
) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.m12_06_burst_dispatch_eligible(p_organization_id,p_dispatch_id)
    and public.m12_03_dispatch_source_valid(p_organization_id,p_dispatch_id)
    and not exists(select 1 from public.notification_dispatches d
      join public.vulnerability_triage_alert_events e
        on e.organization_id=d.organization_id and e.id=d.source_id
      where d.organization_id=p_organization_id and d.id=p_dispatch_id
        and d.source_type='finding_triage_alert'
        and public.m5_triage_finding_severity(d.organization_id,e.finding_id)
          in ('critical','high'))
$$;

create function public.schedule_notification_burst_batches_atomic(
  p_organization_id uuid,p_now timestamptz default clock_timestamp(),
  p_limit integer default 1000
) returns table(outcome text,created integer,reclassified integer,released integer)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_created integer:=0; v_reclassified integer:=0; v_released integer:=0;
  v_enabled boolean; v_mode text;
begin
  if p_organization_id is null or p_now is null
    or p_limit is null or p_limit not between 1 and 10000 then
    return query select 'invalid_request'::text,0,0,0; return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'notification-burst:'||p_organization_id::text,0));
  select s.notification_burst_enabled,s.notification_delivery_mode
    into v_enabled,v_mode from public.organization_settings s
  where s.organization_id=p_organization_id for share;
  if not found or not v_enabled or v_mode<>'unified' then
    return query select 'disabled'::text,0,0,0; return;
  end if;

  -- Reclassify before grouping. This is a database transaction with the audit
  -- fact, so a worker restart cannot silently lose a source event.
  with cheap_invalid as (
    select d.id,d.organization_id,d.category,d.effective_recipient_user_id,
      coalesce(pref.modes->>d.category,'immediate') mode
    from public.notification_dispatches d
    left join public.notification_preferences pref
      on pref.organization_id=d.organization_id
        and pref.user_id=d.effective_recipient_user_id
    where d.organization_id=p_organization_id and d.status='burst_pending'
      and not public.m12_06_burst_dispatch_eligible(d.organization_id,d.id)
      and not exists(select 1 from public.notification_digest_batches b
        where b.organization_id=d.organization_id and b.batch_kind='burst'
          and b.status='leased' and d.id=any(b.dispatch_ids))
  ), invalid as (
    select c.*,
      public.m12_03_dispatch_source_valid(c.organization_id,c.id) source_valid
    from cheap_invalid c
  ), changed as (
    update public.notification_dispatches d
    set status=case
        when not i.source_valid then 'cancelled'
        when i.mode='off' then 'cancelled'
        when i.mode in ('daily','weekly') then 'digest_pending'
        else 'queued' end,
      safe_error_code=case
        when not i.source_valid then 'source_unavailable'
        when i.mode='off' then 'preference_suppressed' else null end,
      next_attempt_at=case
        when i.mode='immediate'
          then p_now else d.next_attempt_at end,
      version=d.version+1
    from invalid i where d.organization_id=p_organization_id and d.id=i.id
    returning d.id,d.status,d.safe_error_code
  ), audited as (
    insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
    select p_organization_id,'notification.burst_reclassified',
      'notification_dispatch',c.id::text,
      jsonb_build_object('status',c.status,'reason',c.safe_error_code)
    from changed c returning id
  ) select count(*)::integer into v_reclassified from audited;

  -- Fixed two-minute ingestion windows. At capacity, send immediately; a
  -- partial remainder waits until its window ends. Singletons return to the
  -- direct worker without changing their source identity.
  with due as (
    select d.id,d.organization_id,d.category,d.event_class,
      d.effective_recipient_user_id user_id,
      coalesce(pref.version,1) preference_version,
      date_bin(interval '2 minutes',d.created_at,
        '2000-01-01 00:00:00+00'::timestamptz) window_start,
      d.created_at
    from public.notification_dispatches d
    left join public.notification_preferences pref
      on pref.organization_id=d.organization_id
      and pref.user_id=d.effective_recipient_user_id
    where d.organization_id=p_organization_id and d.status='burst_pending'
      and public.m12_06_burst_dispatch_eligible(d.organization_id,d.id)
      and not exists(select 1 from public.notification_digest_batches b
        where b.organization_id=d.organization_id and b.batch_kind='burst'
          and b.status<>'cancelled' and d.id=any(b.dispatch_ids))
    order by d.created_at,d.id limit p_limit
  ), numbered as (
    select due.*,
      row_number() over(partition by organization_id,user_id,category,
        event_class,window_start order by created_at,id) rn
    from due
  ), chunks as (
    select organization_id,user_id,category,event_class,window_start,
      window_start+interval '2 minutes' window_end,preference_version,
      ((rn-1)/100)::integer chunk_index,id,rn
    from numbered
  ), grouped as (
    select organization_id,user_id,category,event_class,window_start,
      window_end,preference_version,chunk_index,
      array_agg(id order by rn) dispatch_ids,count(*)::integer item_count
    from chunks
    group by organization_id,user_id,category,event_class,window_start,
      window_end,preference_version,chunk_index
  ), ready as (
    select g.*,row_number() over(
      partition by g.organization_id,g.user_id,g.category,
        g.window_start,g.window_end
      order by g.event_class,g.chunk_index) batch_ordinal
    from grouped g
    where g.item_count>=2 and (g.item_count=100 or g.window_end<=p_now)
  ), inserted as (
    insert into public.notification_digest_batches(
      organization_id,user_id,category,event_class,batch_kind,window_start,
      window_end,preference_version,batch_index,dispatch_ids,next_attempt_at)
    select organization_id,user_id,category,event_class,'burst',window_start,
      window_end,preference_version,
      (g.batch_ordinal+coalesce((select max(b.batch_index)
        from public.notification_digest_batches b
        where b.organization_id=g.organization_id and b.user_id=g.user_id
          and b.category=g.category and b.window_start=g.window_start
          and b.window_end=g.window_end),0))::integer,
      dispatch_ids,p_now
    from ready g
    on conflict(organization_id,user_id,category,window_start,window_end,batch_index)
      do nothing
    returning id,dispatch_ids
  ), audited as (
    insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
    select p_organization_id,'notification.burst_scheduled',
      'notification_digest_batch',i.id::text,
      jsonb_build_object('itemCount',cardinality(i.dispatch_ids))
    from inserted i returning id
  ) select count(*)::integer into v_created from audited;

  with due as (
    select d.id,d.category,d.event_class,d.effective_recipient_user_id user_id,
      date_bin(interval '2 minutes',d.created_at,
        '2000-01-01 00:00:00+00'::timestamptz) window_start
    from public.notification_dispatches d
    where d.organization_id=p_organization_id and d.status='burst_pending'
      and date_bin(interval '2 minutes',d.created_at,
        '2000-01-01 00:00:00+00'::timestamptz)+interval '2 minutes'<=p_now
      and not exists(select 1 from public.notification_digest_batches b
        where b.organization_id=d.organization_id and b.batch_kind='burst'
          and b.status<>'cancelled' and d.id=any(b.dispatch_ids))
  ), singleton as (
    select id from due x where
      (select count(*) from due y where y.category=x.category
        and y.event_class=x.event_class and y.user_id=x.user_id
        and y.window_start=x.window_start)=1
  ), changed as (
    update public.notification_dispatches d
    set status='queued',next_attempt_at=p_now,version=d.version+1
    from singleton s where d.organization_id=p_organization_id and d.id=s.id
    returning d.id
  ), audited as (
    insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
    select p_organization_id,'notification.burst_singleton_released',
      'notification_dispatch',c.id::text,'{}'::jsonb
    from changed c returning id
  ) select count(*)::integer into v_released from audited;
  return query select 'scheduled'::text,v_created,v_reclassified,v_released;
end $$;

create function public.list_due_notification_burst_organizations_atomic(
  p_after_organization_id uuid default null,p_limit integer default 1000
) returns table(organization_id uuid)
language sql stable security definer set search_path=public,pg_temp as $$
  select due.organization_id from (
    select b.organization_id from public.notification_digest_batches b
    join public.organization_settings s on s.organization_id=b.organization_id
      and s.notification_burst_enabled and s.notification_delivery_mode='unified'
    where b.batch_kind='burst' and b.status in ('queued','retrying')
      and b.next_attempt_at<=clock_timestamp()
    union
    select d.organization_id from public.notification_dispatches d
    join public.organization_settings s on s.organization_id=d.organization_id
      and s.notification_burst_enabled and s.notification_delivery_mode='unified'
    where d.status='burst_pending'
      and date_bin(interval '2 minutes',d.created_at,
        '2000-01-01 00:00:00+00'::timestamptz)+interval '2 minutes'
        <=clock_timestamp()
    union
    select d.organization_id from public.notification_dispatches d
    join public.organization_settings s on s.organization_id=d.organization_id
      and s.notification_burst_enabled and s.notification_delivery_mode='unified'
    where d.status='burst_pending'
    group by d.organization_id,d.effective_recipient_user_id,d.event_class,
      date_bin(interval '2 minutes',d.created_at,
        '2000-01-01 00:00:00+00'::timestamptz)
    having count(*)>=100
  ) due
  where p_limit between 1 and 10000
    and (p_after_organization_id is null or due.organization_id>p_after_organization_id)
  order by due.organization_id limit p_limit
$$;

create trigger classify_notification_dispatch_burst
  before insert on public.notification_dispatches
  for each row execute function public.m12_06_classify_dispatch();

create function public.m12_06_burst_policy_json(p_organization_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object('policy',jsonb_build_object(
    'organizationId',s.organization_id,'enabled',s.notification_burst_enabled,
    'version',s.notification_burst_version,
    'enabledAt',case when not s.notification_burst_enabled
      or s.notification_burst_started_at is null then null
      else to_char(s.notification_burst_started_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'updatedAt',to_char(s.notification_burst_updated_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'windowSeconds',120,'maxEmailMembers',100))
  from public.organization_settings s where s.organization_id=p_organization_id
$$;

create function public.get_notification_burst_policy_atomic(
  p_organization_id uuid,p_actor_user_id uuid
) returns table(outcome text,result jsonb)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not coalesce(public.m1201_active_member(
      p_organization_id,p_actor_user_id),false)
    or not coalesce(public.m5_triage_actor_has_permission(
      p_organization_id,p_actor_user_id,'can_edit_organization'),false) then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  return query select 'found'::text,public.m12_06_burst_policy_json(p_organization_id);
end $$;

create function public.update_notification_burst_policy_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_expected_version integer,
  p_enabled boolean,p_idempotency_key uuid
) returns table(outcome text,result jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_settings public.organization_settings%rowtype;
  v_prior public.audit_logs%rowtype; v_digest text; v_result jsonb;
begin
  if not coalesce(public.m1201_active_member(
      p_organization_id,p_actor_user_id),false)
    or not coalesce(public.m5_triage_actor_has_permission(
      p_organization_id,p_actor_user_id,'can_edit_organization'),false) then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  if p_expected_version is null or p_expected_version<1
    or p_enabled is null or p_idempotency_key is null then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  v_digest:=encode(extensions.digest(jsonb_build_object(
    'expectedVersion',p_expected_version,'enabled',p_enabled)::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws('|',p_organization_id,p_actor_user_id,p_idempotency_key),0));
  select * into v_prior from public.audit_logs a
  where a.organization_id=p_organization_id and a.user_id=p_actor_user_id
    and a.action='notification.burst_policy_updated'
    and a.changes->>'idempotencyKey'=p_idempotency_key::text
  order by a.created_at desc,a.id desc limit 1;
  if found then
    if v_prior.changes->>'payloadDigest'<>v_digest then
      return query select 'idempotency_conflict'::text,null::jsonb; return;
    end if;
    return query select 'replayed'::text,v_prior.changes->'result'; return;
  end if;
  select * into v_settings from public.organization_settings s
  where s.organization_id=p_organization_id for update;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  if v_settings.notification_burst_version<>p_expected_version then
    return query select 'conflict'::text,
      public.m12_06_burst_policy_json(p_organization_id); return;
  end if;
  if p_enabled and v_settings.notification_delivery_mode<>'unified' then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  update public.organization_settings s set
    notification_burst_enabled=p_enabled,
    notification_burst_started_at=case
      when p_enabled and not v_settings.notification_burst_enabled then clock_timestamp()
      else s.notification_burst_started_at end,
    notification_burst_updated_at=clock_timestamp(),
    notification_burst_version=s.notification_burst_version+1
  where s.organization_id=p_organization_id;
  if not p_enabled then
    update public.notification_digest_batches b
    set status='cancelled',safe_error_code='burst_disabled',version=b.version+1
    where b.organization_id=p_organization_id and b.batch_kind='burst'
      and b.status in ('queued','retrying');
    with current_policy as (
      select d.id,coalesce(pref.modes->>d.category,'immediate') mode,
        public.m12_03_dispatch_source_valid(d.organization_id,d.id) source_valid
      from public.notification_dispatches d
      left join public.notification_preferences pref
        on pref.organization_id=d.organization_id
          and pref.user_id=d.effective_recipient_user_id
      where d.organization_id=p_organization_id and d.status='burst_pending'
        and d.attempt_count=0
        and not exists(select 1 from public.notification_digest_batches b
          where b.organization_id=d.organization_id and b.batch_kind='burst'
            and b.status='leased' and d.id=any(b.dispatch_ids))
    ), changed as (
      update public.notification_dispatches d
      set status=case when not c.source_valid or c.mode='off' then 'cancelled'
          when c.mode in ('daily','weekly') then 'digest_pending'
          else 'queued' end,
        next_attempt_at=case when c.mode='immediate' then clock_timestamp()
          else d.next_attempt_at end,
        safe_error_code=case when not c.source_valid then 'source_unavailable'
          when c.mode='off' then 'preference_suppressed' else null end,
        version=d.version+1
      from current_policy c where d.organization_id=p_organization_id and d.id=c.id
      returning d.id,d.status,d.safe_error_code
    )
    insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
    select p_organization_id,p_actor_user_id,'notification.burst_reclassified',
      'notification_dispatch',c.id::text,
      jsonb_build_object('status',c.status,'reason',c.safe_error_code)
    from changed c;
  end if;
  v_result:=public.m12_06_burst_policy_json(p_organization_id);
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
  values(p_organization_id,p_actor_user_id,'notification.burst_policy_updated',
    'organization_settings',p_organization_id::text,
    jsonb_build_object('idempotencyKey',p_idempotency_key,
      'payloadDigest',v_digest,'result',v_result));
  return query select 'updated'::text,v_result;
end $$;

create function public.claim_notification_burst_batch_atomic(
  p_organization_id uuid,p_worker_id uuid,p_lease_seconds integer
) returns table(outcome text,batch jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_batch public.notification_digest_batches%rowtype;
begin
  if p_organization_id is null or p_worker_id is null
    or p_lease_seconds not between 30 and 900 then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  if not exists(select 1 from public.organization_settings s
    where s.organization_id=p_organization_id
      and s.notification_burst_enabled and s.notification_delivery_mode='unified') then
    return query select 'none_available'::text,null::jsonb; return;
  end if;
  select * into v_batch from public.notification_digest_batches b
  where b.organization_id=p_organization_id and b.batch_kind='burst'
    and b.status in ('queued','retrying') and b.next_attempt_at<=clock_timestamp()
  order by b.next_attempt_at,b.created_at,b.id for update skip locked limit 1;
  if not found then return query select 'none_available'::text,null::jsonb; return; end if;
  update public.notification_digest_batches b
  set status='leased',lease_owner=p_worker_id,
    lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),
    attempt_count=b.attempt_count+1,last_attempt_at=clock_timestamp(),
    version=b.version+1,safe_error_code=null
  where b.organization_id=p_organization_id and b.id=v_batch.id
  returning * into v_batch;
  return query select 'claimed'::text,jsonb_build_object(
    'batchId',v_batch.id,'leaseOwner',v_batch.lease_owner,
    'checkpointVersion',v_batch.version);
end $$;

create function public.prepare_notification_burst_batch_atomic(
  p_organization_id uuid,p_batch_id uuid,p_worker_id uuid,
  p_expected_version integer
) returns table(outcome text,delivery jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_batch public.notification_digest_batches%rowtype;
  v_pref public.notification_preferences%rowtype; v_email text;
  v_ids uuid[]; v_items jsonb; v_count integer; v_local timestamp;
  v_quiet_end timestamp;
begin
  select * into v_batch from public.notification_digest_batches b
  where b.organization_id=p_organization_id and b.id=p_batch_id
    and b.batch_kind='burst' for update;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  if v_batch.status<>'leased' or v_batch.lease_owner is distinct from p_worker_id
    or v_batch.version<>p_expected_version then
    return query select 'conflict'::text,null::jsonb; return;
  end if;
  if not exists(select 1 from public.organization_settings s
    where s.organization_id=p_organization_id
      and s.notification_burst_enabled and s.notification_delivery_mode='unified') then
    update public.notification_digest_batches b
    set status='cancelled',lease_owner=null,lease_expires_at=null,
      safe_error_code='burst_disabled',version=b.version+1
    where b.organization_id=p_organization_id and b.id=p_batch_id;
    with current_policy as (
      select d.id,coalesce(pref.modes->>d.category,'immediate') mode,
        public.m12_03_dispatch_source_valid(d.organization_id,d.id) source_valid
      from public.notification_dispatches d
      left join public.notification_preferences pref
        on pref.organization_id=d.organization_id
          and pref.user_id=d.effective_recipient_user_id
      where d.organization_id=p_organization_id and d.id=any(v_batch.dispatch_ids)
        and d.status='burst_pending'
    ), changed as (
      update public.notification_dispatches d
      set status=case when not c.source_valid or c.mode='off' then 'cancelled'
          when c.mode in ('daily','weekly') then 'digest_pending'
          else 'queued' end,
        next_attempt_at=case when c.mode='immediate' then clock_timestamp()
          else d.next_attempt_at end,
        safe_error_code=case when not c.source_valid then 'source_unavailable'
          when c.mode='off' then 'preference_suppressed' else null end,
        version=d.version+1
      from current_policy c where d.organization_id=p_organization_id and d.id=c.id
      returning d.id,d.status,d.safe_error_code
    )
    insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
    select p_organization_id,'notification.burst_reclassified',
      'notification_dispatch',c.id::text,
      jsonb_build_object('status',c.status,'reason',c.safe_error_code)
    from changed c;
    return query select 'cancelled'::text,null::jsonb; return;
  end if;
  select * into v_pref from public.notification_preferences p
  where p.organization_id=p_organization_id and p.user_id=v_batch.user_id;
  select u.email into v_email from public.organization_members m
  join public.users u on u.id=m.user_id and u.is_active
  where m.organization_id=p_organization_id and m.user_id=v_batch.user_id;
  if v_email is null then
    update public.notification_dispatches d
    set status='cancelled',safe_error_code='recipient_unavailable',
      version=d.version+1
    where d.organization_id=p_organization_id and d.id=any(v_batch.dispatch_ids)
      and d.status='burst_pending';
    update public.notification_digest_batches b
    set status='cancelled',lease_owner=null,lease_expires_at=null,
      safe_error_code='recipient_unavailable',version=b.version+1
    where b.organization_id=p_organization_id and b.id=p_batch_id;
    return query select 'cancelled'::text,null::jsonb; return;
  end if;
  if v_pref.id is not null and v_pref.quiet_start is not null then
    v_local:=clock_timestamp() at time zone v_pref.timezone;
    if public.m12_03_local_time_in_quiet(v_local::time,
      v_pref.quiet_start,v_pref.quiet_end) then
      v_quiet_end:=date_trunc('day',v_local)+v_pref.quiet_end;
      if v_quiet_end<=v_local then v_quiet_end:=v_quiet_end+interval '1 day'; end if;
      update public.notification_digest_batches b
      set status='retrying',lease_owner=null,lease_expires_at=null,
        next_attempt_at=public.m12_03_first_local_occurrence(
          v_quiet_end,v_pref.timezone),
        safe_error_code='quiet_hours_deferred',version=b.version+1
      where b.organization_id=p_organization_id and b.id=p_batch_id;
      return query select 'deferred'::text,null::jsonb; return;
    end if;
  end if;
  -- Recompute current source, recipient, permission, preference and severity.
  -- No stale content is returned from the stored batch row.
  with invalid as (
    select d.id,d.category,
      case
        when not public.m12_03_dispatch_source_valid(d.organization_id,d.id)
          then 'cancelled'
        when coalesce(v_pref.modes->>d.category,'immediate')='off'
          then 'cancelled'
        when coalesce(v_pref.modes->>d.category,'immediate') in ('daily','weekly')
          then 'digest_pending'
        else 'queued' end as next_status,
      case when not public.m12_03_dispatch_source_valid(d.organization_id,d.id)
        then 'source_unavailable'
        when coalesce(v_pref.modes->>d.category,'immediate')='off'
        then 'preference_suppressed' else null end as reason
    from public.notification_dispatches d
    where d.organization_id=p_organization_id and d.id=any(v_batch.dispatch_ids)
      and d.status='burst_pending'
      and not public.m12_06_burst_dispatch_delivery_valid(d.organization_id,d.id)
  ), changed as (
    update public.notification_dispatches d
    set status=i.next_status,safe_error_code=i.reason,
      next_attempt_at=case when i.next_status='queued'
        then clock_timestamp() else d.next_attempt_at end,
      version=d.version+1
    from invalid i where d.organization_id=p_organization_id and d.id=i.id
    returning d.id,d.status,d.safe_error_code
  )
  insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
  select p_organization_id,'notification.burst_reclassified',
    'notification_dispatch',c.id::text,
    jsonb_build_object('status',c.status,'reason',c.safe_error_code)
  from changed c;
  select array_agg(d.id order by d.created_at,d.id),
    count(*)::integer into v_ids,v_count
  from public.notification_dispatches d
  where d.organization_id=p_organization_id and d.id=any(v_batch.dispatch_ids)
    and d.status='burst_pending'
    and public.m12_06_burst_dispatch_delivery_valid(d.organization_id,d.id);
  if v_count<2 then
    update public.notification_dispatches d
    set status='queued',next_attempt_at=clock_timestamp(),version=d.version+1
    where d.organization_id=p_organization_id and d.id=any(coalesce(v_ids,'{}'::uuid[]))
      and d.status='burst_pending';
    update public.notification_digest_batches b
    set status='cancelled',lease_owner=null,lease_expires_at=null,
      safe_error_code='batch_below_minimum',version=b.version+1,
      prepared_dispatch_ids='{}'::uuid[]
    where b.organization_id=p_organization_id and b.id=p_batch_id;
    insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
    values(p_organization_id,'notification.burst_cancelled',
      'notification_digest_batch',p_batch_id::text,
      jsonb_build_object('remainingCount',v_count));
    return query select 'cancelled'::text,null::jsonb; return;
  end if;
  update public.notification_digest_batches b
  set prepared_dispatch_ids=v_ids
  where b.organization_id=p_organization_id and b.id=p_batch_id;
  select jsonb_agg(jsonb_build_object(
    'title',coalesce(nullif(btrim(x.safe_title),''),'Notification'),
    'href',case when x.source_link like '/%' and x.source_link not like '//%'
      then x.source_link else '/notifications' end,
    'date',x.created_at::date::text,'category',x.category)
    order by x.created_at,x.id)
  into v_items from (
    select d.* from public.notification_dispatches d
    where d.organization_id=p_organization_id and d.id=any(v_ids)
    order by d.created_at,d.id limit 5
  ) x;
  return query select 'ready'::text,jsonb_build_object(
    'deliveryRef',v_batch.id,
    'idempotencyKey','notification-burst:'||v_batch.id::text,
    'recipient',jsonb_build_object('userId',v_batch.user_id,'email',v_email),
    'payload',jsonb_build_object('kind','burst','items',v_items,
      'count',v_count,'href','/notifications?batchId='||v_batch.id::text));
end $$;

create function public.revalidate_notification_burst_batch_atomic(
  p_organization_id uuid,p_batch_id uuid,p_worker_id uuid,
  p_expected_version integer
) returns table(outcome text,delivery jsonb)
language sql security definer set search_path=public,pg_temp as $$
  select * from public.prepare_notification_burst_batch_atomic(
    p_organization_id,p_batch_id,p_worker_id,p_expected_version)
$$;

create function public.complete_notification_burst_batch_atomic(
  p_organization_id uuid,p_batch_id uuid,p_worker_id uuid,
  p_expected_version integer,p_outcome text,
  p_message_id_hash text default null,p_error_code text default null
) returns table(outcome text)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_batch public.notification_digest_batches%rowtype;
begin
  if p_outcome not in ('provider_accepted','delivered','failed',
    'exhausted','cancelled') then
    return query select 'invalid_request'::text; return;
  end if;
  select * into v_batch from public.notification_digest_batches b
  where b.organization_id=p_organization_id and b.id=p_batch_id
    and b.batch_kind='burst' for update;
  if not found then return query select 'not_found'::text; return; end if;
  if v_batch.status in ('provider_accepted','delivered') then
    return query select 'replayed'::text; return;
  end if;
  if v_batch.status<>'leased' or v_batch.lease_owner is distinct from p_worker_id
    or v_batch.version<>p_expected_version
    or cardinality(v_batch.prepared_dispatch_ids)<2 then
    return query select 'conflict'::text; return;
  end if;
  update public.notification_digest_batches b
  set status=p_outcome,lease_owner=null,lease_expires_at=null,
    provider_message_id=p_message_id_hash,
    safe_error_code=case when p_outcome in ('failed','exhausted','cancelled')
      then coalesce(nullif(btrim(p_error_code),''),'provider_unavailable') else null end,
    version=b.version+1
  where b.organization_id=p_organization_id and b.id=p_batch_id;
  update public.notification_dispatches d
  set status=p_outcome,safe_error_code=case
      when p_outcome in ('failed','exhausted','cancelled')
        then coalesce(nullif(btrim(p_error_code),''),'provider_unavailable')
      else null end,version=d.version+1
  where d.organization_id=p_organization_id
    and d.id=any(v_batch.prepared_dispatch_ids)
    and d.status='burst_pending';
  if p_outcome in ('provider_accepted','delivered') then
    perform public.m12_03_mark_dispatch_sources_provider_accepted(
      p_organization_id,v_batch.prepared_dispatch_ids);
  end if;
  insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
  values(p_organization_id,'notification.burst_'||p_outcome,
    'notification_digest_batch',p_batch_id::text,
    jsonb_build_object('preparedCount',
      cardinality(v_batch.prepared_dispatch_ids),'attempt',v_batch.attempt_count));
  return query select 'completed'::text;
end $$;

create function public.fail_notification_burst_batch_atomic(
  p_organization_id uuid,p_batch_id uuid,p_worker_id uuid,
  p_expected_version integer,p_error_code text,p_retryable boolean
) returns table(outcome text)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_batch public.notification_digest_batches%rowtype; v_status text;
begin
  select * into v_batch from public.notification_digest_batches b
  where b.organization_id=p_organization_id and b.id=p_batch_id
    and b.batch_kind='burst' and b.status='leased'
    and b.lease_owner=p_worker_id and b.version=p_expected_version for update;
  if not found then return query select 'conflict'::text; return; end if;
  v_status:=case when not coalesce(p_retryable,false)
    or v_batch.attempt_count>=12 then 'exhausted' else 'retrying' end;
  update public.notification_digest_batches b
  set status=v_status,lease_owner=null,lease_expires_at=null,
    safe_error_code=coalesce(nullif(btrim(p_error_code),''),'provider_unavailable'),
    next_attempt_at=case when v_status='exhausted' then b.next_attempt_at
      else clock_timestamp()+make_interval(secs=>least(3600,
        greatest(30,30*power(2,least(v_batch.attempt_count,7))::integer))) end,
    version=b.version+1
  where b.organization_id=p_organization_id and b.id=p_batch_id;
  if v_status='exhausted' then
    update public.notification_dispatches d
    set status='exhausted',safe_error_code=
      coalesce(nullif(btrim(p_error_code),''),'provider_unavailable'),
      version=d.version+1
    where d.organization_id=p_organization_id
      and d.id=any(v_batch.prepared_dispatch_ids)
      and d.status='burst_pending';
    if cardinality(v_batch.prepared_dispatch_ids)=0 then
      -- No delivery envelope existed, so no provider acceptance is possible.
      -- Exhausting preparation must release the unattempted source events.
      with candidates as (
        select d.id,coalesce(pref.modes->>d.category,'immediate') mode,
          public.m12_03_dispatch_source_valid(d.organization_id,d.id) source_valid
        from public.notification_dispatches d
        left join public.notification_preferences pref
          on pref.organization_id=d.organization_id
            and pref.user_id=d.effective_recipient_user_id
        where d.organization_id=p_organization_id
          and d.id=any(v_batch.dispatch_ids) and d.status='burst_pending'
      ), changed as (
        update public.notification_dispatches d
        set status=case
            when not c.source_valid or c.mode='off' then 'cancelled'
            when c.mode in ('daily','weekly') then 'digest_pending'
            else 'queued' end,
          safe_error_code=case
            when not c.source_valid then 'source_unavailable'
            when c.mode='off' then 'preference_suppressed'
            else null end,
          next_attempt_at=case when c.mode='immediate'
            then clock_timestamp() else d.next_attempt_at end,
          version=d.version+1
        from candidates c where d.organization_id=p_organization_id and d.id=c.id
        returning d.id,d.status,d.safe_error_code
      )
      insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
      select p_organization_id,'notification.burst_unprepared_reclassified',
        'notification_dispatch',c.id::text,
        jsonb_build_object('status',c.status,'reason',c.safe_error_code)
      from changed c;
    end if;
  end if;
  insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
  values(p_organization_id,'notification.burst_'||v_status,
    'notification_digest_batch',p_batch_id::text,
    jsonb_build_object('preparedCount',
      cardinality(v_batch.prepared_dispatch_ids),'attempt',v_batch.attempt_count));
  return query select case when v_status='exhausted'
    then 'exhausted' else 'retry_scheduled' end;
end $$;

create function public.m12_06_feed_event_class(p_ref text,p_summary text)
returns text language sql immutable set search_path=public,pg_temp as $$
  select case
    when p_ref like 'm5_%' and p_summary='Finding triage SLA breached'
      then 'finding_sla_breached'
    when p_ref like 'm5_%' and p_summary='Finding suppression expired'
      then 'finding_suppression_expired'
    when p_ref like 'm8_%' and p_summary='Evidence validity expiring'
      then 'evidence_validity_expiring'
    when p_ref like 'm9_%' and p_summary='Supplier evidence owner escalation'
      then 'supplier_owner_escalation'
    else null end
$$;

-- Shared read projection with the M12-04 default feed's row contract.
-- A parameterized M5 dispatch lookup avoids an org-wide nested-loop scan
-- when many distinct source events share a two-minute window.
create function public.m12_06_feed_rows(p_organization_id uuid,p_actor_user_id uuid)
returns table(ref text,category text,severity text,occurred_at timestamptz,source_created_at timestamptz,
  title text,summary text,source_state text,notice_kind text,url text,fingerprint text)
language sql stable security definer set search_path=public,pg_temp as $$
 with active_scope as (
   select s.notification_feed_started_at as started_at
   from public.organization_settings s
   where s.organization_id=p_organization_id
     and public.m1201_active_member(p_organization_id,p_actor_user_id)
 ), m5_context as materialized (
   select f.id finding_id,
     case public.m5_triage_finding_severity(p_organization_id,f.id)
       when 'critical' then 'critical' when 'high' then 'high'
       when 'medium' then 'warning' else 'info' end severity,
     case when f.status='superseded' then null::uuid else coalesce(
       (select s.assignee_user_id from public.vulnerability_finding_triage_states s
         join public.users u on u.id=s.assignee_user_id and u.is_active
         where s.organization_id=p_organization_id and s.finding_id=f.id
           and public.m5_triage_actor_can_edit_findings(p_organization_id,s.assignee_user_id)
         limit 1),
       (select m.user_id from public.organization_members m
         join public.users u on u.id=m.user_id and u.is_active
         where m.organization_id=p_organization_id and m.role in ('owner','admin')
           and public.m5_triage_actor_can_edit_findings(p_organization_id,m.user_id)
         order by case m.role when 'owner' then 0 else 1 end,m.user_id limit 1)
     ) end recipient_id
   from (select distinct e.finding_id from public.vulnerability_triage_alert_events e
     cross join active_scope a
     where e.organization_id=p_organization_id and e.due_at>=a.started_at
       and (e.due_at>=statement_timestamp()-interval '180 days'
         or (e.state in ('dead_letter','recipient_unavailable')
           and e.last_attempt_at>=statement_timestamp()-interval '180 days'))
       and e.state not in ('skipped_superseded','skipped_deleted')) ids
   join public.vulnerability_findings f on f.organization_id=p_organization_id and f.id=ids.finding_id
 ), source_events as (
   select 'm2'::text kind,e.id source_id,'support_period'::text category,
     case when e.alert_threshold_days=0 then 'critical' else 'high' end::text severity,
     e.due_at occurred_at,e.occurred_at source_created_at,left(p.name,500) source_title,
     'Support period deadline'::text source_summary,
     case when p.archived_at is null and r.archived_at is null and e.obsolete_at is null
       then 'available' else 'unavailable' end::text source_state,
     case when p.archived_at is null and r.archived_at is null and e.obsolete_at is null
       then '/products/'||p.id::text else null end::text url,
     coalesce(e.last_attempt_at,e.updated_at) failure_at,
     e.checkpoint_version::text||':'||coalesce(e.last_error_code,'') failure_generation,
     e.delivery_state in ('dead_letter','recipient_unavailable') failure,
     e.last_error_code='recipient_unavailable' no_recipient,
     true critical,
     e.original_recipient_user_id recipient_id,
     coalesce((critical_route.recipient->>'userId')::uuid,e.delivered_to_user_id) alternate_id,
     p.responsible_owner_id fallback_id
   from public.product_regulatory_outbox_events e
   join public.products p on p.organization_id=e.organization_id and p.id=e.product_id
   join public.product_releases r on r.organization_id=e.organization_id and r.id=e.release_id
   left join lateral public.resolve_critical_notification_recipient(
     e.organization_id,coalesce(e.original_recipient_user_id,p.responsible_owner_id),p.id,'support_period') critical_route on true
   where e.organization_id=p_organization_id and e.event_type='support_period.alert'
     and e.delivery_state<>'obsolete'
     and public.m12_03_actor_has_effective_permission(p_organization_id,p_actor_user_id,'can_view_products')
   union all
   select 'm5',e.id,'finding_triage',
     context.severity,
     e.due_at,e.created_at,left(f.canonical_advisory_id,500),
     case e.event_kind when 'internal_sla_breached' then 'Finding triage SLA breached'
       else 'Finding suppression expired' end,
     case when f.status='active' and p.archived_at is null and r.archived_at is null
       then 'available' else 'unavailable' end,
     case when f.status='active' and p.archived_at is null and r.archived_at is null
       then '/findings?findingId='||f.id::text else null end,
     coalesce(case when dispatch.status in ('failed','exhausted')
       then coalesce(dispatch.last_attempt_at,dispatch.updated_at) end,e.last_attempt_at),
     case when dispatch.status in ('failed','exhausted')
       then dispatch.version::text||':'||dispatch.attempt_count::text||':'||coalesce(dispatch.safe_error_code,'')
       else e.attempts::text||':'||coalesce(e.error_code,'') end,
     e.state in ('dead_letter','recipient_unavailable') or dispatch.status in ('failed','exhausted'),
     e.state='recipient_unavailable',false,
     context.recipient_id,dispatch.effective_recipient_user_id,null::uuid
   from public.vulnerability_triage_alert_events e
   join public.vulnerability_findings f on f.organization_id=e.organization_id and f.id=e.finding_id
   join public.product_releases r on r.organization_id=f.organization_id and r.id=f.release_id
   join public.products p on p.organization_id=r.organization_id and p.id=r.product_id
   join m5_context context on context.finding_id=e.finding_id
   left join lateral (
     select d.* from public.notification_dispatches d
     where d.organization_id=e.organization_id
       and d.source_type='finding_triage_alert' and d.source_id=e.id
       and d.original_recipient_user_id=context.recipient_id
     limit 1
   ) dispatch on true
   where e.organization_id=p_organization_id and e.state not in ('skipped_superseded','skipped_deleted')
     and public.m1201_source_can(p_organization_id,p_actor_user_id,'finding_triage',false)
   union all
   select 'm6',d.id,'reporting_deadline',
     case when a.threshold_percent=100 then 'critical' else 'high' end,
     a.threshold_crossed_at,d.created_at,left(replace(s.stage_kind,'_',' ')||' deadline',500),
     case when a.threshold_percent=100 then 'Reporting deadline breached'
       else 'Reporting deadline threshold crossed' end,
     case when o.status<>'cancelled' and s.state<>'not_required'
       and (o.source_finding_id is null or f.id is not null)
       and (p.id is null or (p.archived_at is null and r.archived_at is null))
       then 'available' else 'unavailable' end,
     case when o.status<>'cancelled' and s.state<>'not_required'
       and (o.source_finding_id is null or f.id is not null)
       and (p.id is null or (p.archived_at is null and r.archived_at is null))
       then '/reporting?obligationId='||o.id::text||'&stageId='||s.id::text else null end,
     d.last_attempt_at,
     d.checkpoint_version::text||':'||coalesce(d.last_error_code,''),
     d.delivery_state='dead_letter',d.last_error_code='recipient_unavailable',true,
     d.original_recipient_user_id,
     coalesce((critical_route.recipient->>'userId')::uuid,d.prepared_recipient_user_id),d.recipient_user_id
   from public.reporting_deadline_alert_deliveries d
   join public.reporting_deadline_alerts a on a.organization_id=d.organization_id and a.id=d.alert_id
   join public.reporting_obligation_stages s on s.organization_id=a.organization_id and s.id=a.stage_id
   join public.reporting_obligations o on o.organization_id=s.organization_id and o.id=s.obligation_id
   left join public.vulnerability_findings f on f.organization_id=o.organization_id and f.id=o.source_finding_id
   left join public.product_releases r on r.organization_id=f.organization_id and r.id=f.release_id
   left join public.products p on p.organization_id=r.organization_id and p.id=r.product_id
   left join lateral public.resolve_critical_notification_recipient(
     d.organization_id,d.original_recipient_user_id,null,'reporting_deadline') critical_route on true
   where d.organization_id=p_organization_id and d.delivery_state<>'cancelled' and not o.is_rehearsal
     and public.m1201_source_can(p_organization_id,p_actor_user_id,'report_approval',false)
   union all
   select 'm8',n.id,'evidence',
     case when n.event_type in ('evidence_quarantined','evidence_integrity_failure') then 'high'
       else 'warning' end,
     n.created_at,n.created_at,left(v.title,500),
     case n.event_type when 'evidence_quarantined' then 'Evidence quarantined'
       when 'evidence_integrity_failure' then 'Evidence integrity check failed'
       else 'Evidence validity expiring' end,
     case when d.lifecycle_state='active' and v.processing_state<>'deleted'
       and p.id is not null and p.archived_at is null then 'available' else 'unavailable' end,
     case when d.lifecycle_state='active' and v.processing_state<>'deleted'
       and p.id is not null and p.archived_at is null then '/products/'||p.id::text||'/evidence?documentId='||d.id::text||'&versionId='||v.id::text else null end,
     case when dispatch.status in ('failed','exhausted')
       then coalesce(dispatch.last_attempt_at,dispatch.updated_at) else n.created_at end,
     case when dispatch.status in ('failed','exhausted')
       then dispatch.version::text||':'||dispatch.attempt_count::text||':'||coalesce(dispatch.safe_error_code,'')
       else n.attempt_count::text||':'||coalesce(n.last_error,'') end,
     n.status='recipient_unavailable' or dispatch.status in ('failed','exhausted'),
     n.status='recipient_unavailable',false,
     n.owner_user_id,dispatch.effective_recipient_user_id,null::uuid
   from public.evidence_document_notification_outbox n
   join public.evidence_document_versions v on v.organization_id=n.organization_id and v.id=n.version_id
   join public.evidence_documents d on d.organization_id=v.organization_id and d.id=v.document_id
   left join lateral (
     select product.id,product.archived_at from public.evidence_document_version_products vp
     join public.products product on product.organization_id=vp.organization_id and product.id=vp.product_id
     where vp.organization_id=v.organization_id and vp.version_id=v.id
     order by (product.archived_at is null) desc,product.id limit 1
   ) p on true
   left join public.notification_dispatches dispatch
     on dispatch.organization_id=n.organization_id and dispatch.source_id=n.id
       and dispatch.original_recipient_user_id=n.owner_user_id
       and dispatch.source_type=case n.event_type
         when 'evidence_validity_expiring' then 'evidence_validity' else n.event_type end
   where n.organization_id=p_organization_id and n.status<>'obsolete'
     and public.m1201_source_can(p_organization_id,p_actor_user_id,'evidence_expiry',false)
   union all
   select 'm9',n.id,'supplier_owner','warning',n.scheduled_for,n.created_at,
     'Supplier evidence request'::text,'Supplier evidence owner escalation'::text,
     case when q.state='open' and p.archived_at is null and supplier.archived_at is null
       then 'available' else 'unavailable' end,
     case when q.state='open' and p.archived_at is null and supplier.archived_at is null
       then '/suppliers/'||q.supplier_id::text||'?requestId='||q.id::text else null end,
     case when dispatch.status in ('failed','exhausted')
       then coalesce(dispatch.last_attempt_at,dispatch.updated_at) else n.updated_at end,
     case when dispatch.status in ('failed','exhausted')
       then dispatch.version::text||':'||dispatch.attempt_count::text||':'||coalesce(dispatch.safe_error_code,'')
       else n.version::text||':'||n.attempt_count::text end,
     n.state in ('failed','recipient_unavailable') or dispatch.status in ('failed','exhausted'),
     n.state='recipient_unavailable',false,
     n.owner_user_id,dispatch.effective_recipient_user_id,null::uuid
   from public.supplier_evidence_reminder_deliveries n
   join public.supplier_evidence_requests q on q.organization_id=n.organization_id and q.id=n.request_id
   join public.products p on p.organization_id=q.organization_id and p.id=q.product_id
   join public.supplier_organizations supplier on supplier.organization_id=q.organization_id and supplier.id=q.supplier_id
   left join public.notification_dispatches dispatch
     on dispatch.organization_id=n.organization_id and dispatch.source_type='supplier_owner_escalation'
       and dispatch.source_id=n.id and dispatch.original_recipient_user_id=n.owner_user_id
   where n.organization_id=p_organization_id and n.event_kind='owner_escalation' and n.state<>'obsolete'
     and public.m1201_source_can(p_organization_id,p_actor_user_id,'supplier_request',false)
 ), visible as (
   select e.*,v.notice_kind,v.notice_at
   from source_events e cross join lateral (values
     ('event'::text,e.occurred_at),('failure'::text,e.failure_at)
   ) v(notice_kind,notice_at)
   cross join active_scope a
   where e.occurred_at>=a.started_at and v.notice_at>=statement_timestamp()-interval '180 days'
     and v.notice_at<=statement_timestamp()
     and (v.notice_kind='event' or (e.failure and v.notice_at is not null))
     and (e.recipient_id=p_actor_user_id or e.alternate_id=p_actor_user_id
       or (e.recipient_id is null and e.fallback_id=p_actor_user_id)
       or (v.notice_kind='failure' and e.critical and e.no_recipient
         and public.m12_03_actor_has_effective_permission(p_organization_id,p_actor_user_id,'can_view_audit')))
 )
 select e.kind||'_'||e.source_id::text||'_'||e.notice_kind,e.category,e.severity,
   e.notice_at,e.source_created_at,
   case when e.source_state='available' then coalesce(nullif(e.source_title,''),'Notification')
     else 'Source unavailable' end,
   case when e.notice_kind='failure' then 'Notification delivery needs attention'
     when e.source_state='available' then e.source_summary else 'The source record is unavailable' end,
   e.source_state,e.notice_kind,e.url,
   encode(extensions.digest(concat_ws('|',e.kind,e.source_id::text,e.notice_kind,
     case when e.notice_kind='failure' then e.failure_generation else e.occurred_at::text end),'sha256'),'hex')
 from visible e
$$;

-- M12-04 keeps the same public RPC, wire shape and visibility rules. Its
-- original projection was characterized against this scoped copy before
-- replacing the slow M5 dispatch join; all existing feed readers benefit.
create or replace function public.m1204_feed_rows(
  p_organization_id uuid,p_actor_user_id uuid
) returns table(ref text,category text,severity text,occurred_at timestamptz,
  source_created_at timestamptz,title text,summary text,source_state text,
  notice_kind text,url text,fingerprint text)
language sql stable security definer set search_path=public,pg_temp as $$
  select * from public.m12_06_feed_rows(p_organization_id,p_actor_user_id)
$$;

create function public.list_notification_feed_grouped_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_category text default null,
  p_severity text default null,p_read text default 'all',
  p_cursor text default null,p_limit integer default 25
) returns table(outcome text,result jsonb)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_scope text; v_cursor jsonb; v_snapshot timestamptz:=statement_timestamp();
  v_at timestamptz; v_ref text; v_rows jsonb; v_count integer;
  v_last_at timestamptz; v_last_ref text; v_next text;
  v_enabled boolean; v_started timestamptz; v_version integer;
begin
  if not coalesce(public.m1201_active_member(
    p_organization_id,p_actor_user_id),false) then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  if p_limit is null or p_limit not between 1 and 50
    or (p_category is not null and p_category not in
      ('finding_triage','evidence','supplier_owner','support_period','reporting_deadline'))
    or (p_severity is not null and p_severity not in
      ('info','warning','high','critical'))
    or p_read is null or p_read not in ('all','read','unread')
    or (p_cursor is not null and
      (char_length(p_cursor)>512 or p_cursor !~ '^[A-Za-z0-9_-]+$')) then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  select s.notification_burst_enabled,s.notification_burst_started_at,
    s.notification_burst_version into v_enabled,v_started,v_version
  from public.organization_settings s where s.organization_id=p_organization_id;
  v_scope:=encode(extensions.digest(jsonb_build_object(
    'view','grouped','org',p_organization_id,'actor',p_actor_user_id,
    'category',p_category,'severity',p_severity,'read',p_read,
    'policyVersion',v_version)::text,'sha256'),'hex');
  if p_cursor is not null then
    begin
      v_cursor:=convert_from(decode(translate(p_cursor,'-_','+/')
        ||repeat('=',(4-char_length(p_cursor)%4)%4),'base64'),'utf8')::jsonb;
      if jsonb_typeof(v_cursor)<>'object'
        or v_cursor->>'scope' is distinct from v_scope then
        return query select 'invalid_request'::text,null::jsonb; return;
      end if;
      v_snapshot:=(v_cursor->>'snapshot')::timestamptz;
      v_at:=(v_cursor->>'at')::timestamptz;
      v_ref:=v_cursor->>'ref';
      if v_snapshot is null or v_at is null or v_ref is null
        or char_length(v_ref)>200 or v_snapshot>statement_timestamp()+interval '1 second' then
        return query select 'invalid_request'::text,null::jsonb; return;
      end if;
    exception when others then
      return query select 'invalid_request'::text,null::jsonb; return;
    end;
  end if;
  with base as (
    select f.*,
      coalesce(r.fingerprint=f.fingerprint,false) is_read,
      case when coalesce(v_enabled,false)
        and v_started is not null
        and f.source_created_at>=v_started
        and f.notice_kind='event' and f.severity in ('info','warning')
        then public.m12_06_feed_event_class(f.ref,f.summary)
        else null end event_class,
      date_bin(interval '2 minutes',f.source_created_at,
        '2000-01-01 00:00:00+00'::timestamptz) window_start
    from public.m12_06_feed_rows(p_organization_id,p_actor_user_id) f
    left join public.notification_feed_reads r
      on r.organization_id=p_organization_id and r.user_id=p_actor_user_id
        and r.ref=f.ref
    where (p_category is null or f.category=p_category)
      and (p_severity is null or f.severity=p_severity)
      and f.occurred_at<=v_snapshot and f.source_created_at<=v_snapshot
  ), grouped as (
    select b.event_class,b.category,
      case when bool_or(b.severity='warning') then 'warning'
        else 'info' end severity,b.window_start,
      b.window_start+interval '2 minutes' window_end,
      count(*)::integer visible_count,
      count(*) filter(where not b.is_read)::integer unread_count,
      max(b.occurred_at) occurred_at
    from base b where b.event_class is not null
    group by b.event_class,b.category,b.window_start
  ), mixed as (
    select b.occurred_at,b.ref sort_ref,
      jsonb_build_object(
        'ref',b.ref,'category',b.category,'severity',b.severity,
        'occurredAt',to_char(b.occurred_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'title',b.title,'summary',b.summary,'read',b.is_read,
        'fingerprint',b.fingerprint,'sourceState',b.source_state,
        'noticeKind',b.notice_kind) item,
      b.is_read,not b.is_read has_unread
    from base b left join grouped g
      on g.event_class=b.event_class and g.category=b.category
        and g.window_start=b.window_start
    where b.event_class is null or g.visible_count<2
      or g.window_end>v_snapshot
    union all
    select g.occurred_at,
      'burst_'||g.event_class||'_'||extract(epoch from g.window_start)::bigint::text
        ||'_'||g.severity,
      jsonb_build_object(
        'kind','batch','eventClass',g.event_class,
        'category',g.category,'severity',g.severity,
        'occurredAt',to_char(g.occurred_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'windowStartsAt',to_char(g.window_start at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'windowEndsAt',to_char(g.window_end at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'title',g.visible_count::text||' notifications',
        'summary','Open the filtered inbox to review these notifications',
        'visibleCount',g.visible_count,'unreadCount',g.unread_count,
        'previewItems',preview.items,
        'previewCount',jsonb_array_length(preview.items),
        'previewTruncated',g.visible_count>jsonb_array_length(preview.items),
        'url','/notifications?eventClass='||g.event_class
          ||'&windowStart='||to_char(g.window_start at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
      g.unread_count=0,g.unread_count>0
    from grouped g
    cross join lateral (
      select coalesce(jsonb_agg(jsonb_build_object(
        'ref',p.ref,'title',p.title)
        order by p.occurred_at desc,p.ref desc),'[]'::jsonb) items
      from (
        select b.ref,b.title,b.occurred_at from base b
        where b.event_class=g.event_class and b.category=g.category
          and b.window_start=g.window_start
        order by b.occurred_at desc,b.ref desc limit 5
      ) p
    ) preview
    where g.visible_count>=2 and g.window_end<=v_snapshot
  ), limited as (
    select * from mixed m where
      (p_read='all' or (p_read='read' and m.is_read)
        or (p_read='unread' and m.has_unread))
      and (v_at is null or (m.occurred_at,m.sort_ref)<(v_at,v_ref))
    order by m.occurred_at desc,m.sort_ref desc limit p_limit+1
  ), page as (
    select * from limited order by occurred_at desc,sort_ref desc limit p_limit
  )
  select coalesce((select jsonb_agg(p.item order by p.occurred_at desc,
    p.sort_ref desc) from page p),'[]'::jsonb),
    (select count(*)::integer from limited),
    (select p.occurred_at from page p order by p.occurred_at,p.sort_ref limit 1),
    (select p.sort_ref from page p order by p.occurred_at,p.sort_ref limit 1)
  into v_rows,v_count,v_last_at,v_last_ref;
  if v_count>p_limit then
    v_next:=translate(rtrim(replace(replace(encode(convert_to(
      jsonb_build_object('scope',v_scope,'snapshot',v_snapshot,
        'at',v_last_at,'ref',v_last_ref)::text,'utf8'),
      'base64'),E'\n',''),'=','')),'+/','-_');
  end if;
  return query select 'found'::text,
    jsonb_build_object('items',v_rows,'nextCursor',v_next);
end $$;

create function public.m12_06_list_filtered_feed_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_event_class text,
  p_window_start timestamptz,p_batch_id uuid,p_cursor text,p_limit integer
) returns table(outcome text,result jsonb)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_scope text; v_cursor jsonb; v_snapshot timestamptz:=statement_timestamp();
  v_at timestamptz; v_ref text; v_rows jsonb; v_count integer;
  v_last_at timestamptz; v_last_ref text; v_next text;
  v_burst_enabled boolean; v_burst_started_at timestamptz;
begin
  if not coalesce(public.m1201_active_member(
    p_organization_id,p_actor_user_id),false) then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  if p_limit is null or p_limit not between 1 and 50
    or (p_cursor is not null and
      (char_length(p_cursor)>512 or p_cursor !~ '^[A-Za-z0-9_-]+$'))
    or ((p_batch_id is null)=(p_event_class is null))
    or (p_batch_id is null and
      (p_event_class not in ('finding_sla_breached',
        'finding_suppression_expired','evidence_validity_expiring',
        'supplier_owner_escalation')
        or p_window_start is null
        or p_window_start<>date_bin(interval '2 minutes',p_window_start,
          '2000-01-01 00:00:00+00'::timestamptz)))
    or (p_batch_id is not null and p_window_start is not null) then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  if p_batch_id is not null and not exists(
    select 1 from public.notification_digest_batches b
    where b.organization_id=p_organization_id and b.id=p_batch_id
      and b.batch_kind='burst' and b.user_id=p_actor_user_id) then
    return query select 'not_found'::text,null::jsonb; return;
  end if;
  if p_batch_id is null then
    select s.notification_burst_enabled,s.notification_burst_started_at
      into v_burst_enabled,v_burst_started_at
    from public.organization_settings s where s.organization_id=p_organization_id;
    if not coalesce(v_burst_enabled,false) or v_burst_started_at is null
      or p_window_start+interval '2 minutes'<=v_burst_started_at then
      return query select 'found'::text,
        jsonb_build_object('items','[]'::jsonb,'nextCursor',null); return;
    end if;
  end if;
  v_scope:=encode(extensions.digest(jsonb_build_object(
    'view','filtered','org',p_organization_id,'actor',p_actor_user_id,
    'eventClass',p_event_class,'windowStart',p_window_start,
    'batchId',p_batch_id)::text,'sha256'),'hex');
  if p_cursor is not null then
    begin
      v_cursor:=convert_from(decode(translate(p_cursor,'-_','+/')
        ||repeat('=',(4-char_length(p_cursor)%4)%4),'base64'),'utf8')::jsonb;
      if jsonb_typeof(v_cursor)<>'object'
        or v_cursor->>'scope' is distinct from v_scope then
        return query select 'invalid_request'::text,null::jsonb; return;
      end if;
      v_snapshot:=(v_cursor->>'snapshot')::timestamptz;
      v_at:=(v_cursor->>'at')::timestamptz;
      v_ref:=v_cursor->>'ref';
      if v_snapshot is null or v_at is null or v_ref is null
        or v_ref !~ '^m(2|5|6|8|9)_[0-9a-f-]{36}_(event|failure)$'
        or v_snapshot>statement_timestamp()+interval '1 second' then
        return query select 'invalid_request'::text,null::jsonb; return;
      end if;
    exception when others then
      return query select 'invalid_request'::text,null::jsonb; return;
    end;
  end if;
  with candidates as (
    select f.*,coalesce(r.fingerprint=f.fingerprint,false) is_read
    from public.m12_06_feed_rows(p_organization_id,p_actor_user_id) f
    left join public.notification_feed_reads r
      on r.organization_id=p_organization_id and r.user_id=p_actor_user_id
        and r.ref=f.ref
    where f.notice_kind='event'
      and (p_batch_id is not null or f.severity in ('info','warning'))
      and (p_batch_id is not null or f.source_created_at>=v_burst_started_at)
      and f.occurred_at<=v_snapshot and f.source_created_at<=v_snapshot
      and (
        (p_batch_id is null
          and public.m12_06_feed_event_class(f.ref,f.summary)=p_event_class
          and f.source_created_at>=(select s.notification_burst_started_at
            from public.organization_settings s
            where s.organization_id=p_organization_id)
          and date_bin(interval '2 minutes',f.source_created_at,
            '2000-01-01 00:00:00+00'::timestamptz)=p_window_start)
        or (p_batch_id is not null and exists(
          select 1 from public.notification_digest_batches b
          join public.notification_dispatches d
            on d.organization_id=b.organization_id
              and d.id=any(b.prepared_dispatch_ids)
          where b.organization_id=p_organization_id and b.id=p_batch_id
            and b.batch_kind='burst' and b.user_id=p_actor_user_id
            and f.ref=case d.source_type
              when 'finding_triage_alert' then 'm5_'||d.source_id::text||'_event'
              when 'evidence_validity' then 'm8_'||d.source_id::text||'_event'
              when 'supplier_owner_escalation' then 'm9_'||d.source_id::text||'_event'
              else null end))
      )
      and (v_at is null or (f.occurred_at,f.ref)<(v_at,v_ref))
  ), limited as (
    select * from candidates order by occurred_at desc,ref desc limit p_limit+1
  ), page as (
    select * from limited order by occurred_at desc,ref desc limit p_limit
  )
  select coalesce((select jsonb_agg(jsonb_build_object(
    'ref',p.ref,'category',p.category,'severity',p.severity,
    'occurredAt',to_char(p.occurred_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'title',p.title,'summary',p.summary,'read',p.is_read,
    'fingerprint',p.fingerprint,'sourceState',p.source_state,
    'noticeKind',p.notice_kind)
    order by p.occurred_at desc,p.ref desc) from page p),'[]'::jsonb),
    (select count(*)::integer from limited),
    (select p.occurred_at from page p order by p.occurred_at,p.ref limit 1),
    (select p.ref from page p order by p.occurred_at,p.ref limit 1)
  into v_rows,v_count,v_last_at,v_last_ref;
  if v_count>p_limit then
    v_next:=translate(rtrim(replace(replace(encode(convert_to(
      jsonb_build_object('scope',v_scope,'snapshot',v_snapshot,
        'at',v_last_at,'ref',v_last_ref)::text,'utf8'),
      'base64'),E'\n',''),'=','')),'+/','-_');
  end if;
  return query select 'found'::text,
    jsonb_build_object('items',v_rows,'nextCursor',v_next);
end $$;

create function public.list_notification_feed_cohort_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_event_class text,
  p_window_start timestamptz,p_cursor text default null,p_limit integer default 25
) returns table(outcome text,result jsonb)
language sql stable security definer set search_path=public,pg_temp as $$
  select * from public.m12_06_list_filtered_feed_atomic(
    p_organization_id,p_actor_user_id,p_event_class,p_window_start,
    null::uuid,p_cursor,p_limit)
$$;

create function public.list_notification_feed_batch_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_batch_id uuid,
  p_cursor text default null,p_limit integer default 25
) returns table(outcome text,result jsonb)
language sql stable security definer set search_path=public,pg_temp as $$
  select * from public.m12_06_list_filtered_feed_atomic(
    p_organization_id,p_actor_user_id,null::text,null::timestamptz,
    p_batch_id,p_cursor,p_limit)
$$;

create function public.list_notification_burst_batches_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_cursor text default null,
  p_limit integer default 25
) returns table(outcome text,result jsonb)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_cursor jsonb; v_at timestamptz; v_id uuid;
  v_rows jsonb; v_count integer; v_last_at timestamptz;
  v_last_id uuid; v_next text;
begin
  if p_organization_id is null or p_actor_user_id is null
    or not coalesce(public.m12_03_actor_has_effective_permission(
      p_organization_id,p_actor_user_id,'can_view_audit'),false) then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  if p_limit is null or p_limit not between 1 and 100
    or (p_cursor is not null and
      (char_length(p_cursor)>512 or p_cursor !~ '^[A-Za-z0-9_-]+$')) then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  if p_cursor is not null then
    begin
      v_cursor:=convert_from(decode(translate(p_cursor,'-_','+/')
        ||repeat('=',(4-char_length(p_cursor)%4)%4),'base64'),'utf8')::jsonb;
      if v_cursor->>'org' is distinct from p_organization_id::text then
        return query select 'invalid_request'::text,null::jsonb; return;
      end if;
      v_at:=(v_cursor->>'at')::timestamptz;
      v_id:=(v_cursor->>'id')::uuid;
      if v_at is null or v_id is null then
        return query select 'invalid_request'::text,null::jsonb; return;
      end if;
    exception when others then
      return query select 'invalid_request'::text,null::jsonb; return;
    end;
  end if;
  with limited as (
    select b.* from public.notification_digest_batches b
    where b.organization_id=p_organization_id and b.batch_kind='burst'
      and (v_at is null or (b.created_at,b.id)<(v_at,v_id))
    order by b.created_at desc,b.id desc limit p_limit+1
  ), page as (
    select * from limited order by created_at desc,id desc limit p_limit
  )
  select coalesce((select jsonb_agg(jsonb_build_object(
    'batchId',p.id,'category',p.category,'eventClass',p.event_class,
    'status',case when p.status in ('leased','retrying') then 'attempted'
      else p.status end,
    'windowStartsAt',to_char(p.window_start at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'windowEndsAt',to_char(p.window_end at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'memberCount',cardinality(p.dispatch_ids),
    'preparedCount',cardinality(p.prepared_dispatch_ids),
    'attemptCount',p.attempt_count,
    'lastAttemptAt',case when p.last_attempt_at is null then null
      else to_char(p.last_attempt_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'nextAttemptAt',case when p.status not in ('queued','retrying') then null
      else to_char(p.next_attempt_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'safeErrorCode',p.safe_error_code,
    'createdAt',to_char(p.created_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    order by p.created_at desc,p.id desc) from page p),'[]'::jsonb),
    (select count(*)::integer from limited),
    (select p.created_at from page p order by p.created_at,p.id limit 1),
    (select p.id from page p order by p.created_at,p.id limit 1)
  into v_rows,v_count,v_last_at,v_last_id;
  if v_count>p_limit then
    v_next:=translate(rtrim(replace(replace(encode(convert_to(
      jsonb_build_object('org',p_organization_id,'at',v_last_at,
        'id',v_last_id)::text,'utf8'),
      'base64'),E'\n',''),'=','')),'+/','-_');
  end if;
  return query select 'found'::text,
    jsonb_build_object('rows',v_rows,'nextCursor',v_next);
end $$;

-- The shared lease reconciler marks an expired attempted batch exhausted.
-- Mirror that uncertain outcome onto exactly the persisted prepared members.
create function public.m12_06_reconcile_burst_members()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.batch_kind='burst' and old.status='leased'
    and new.status='exhausted'
    and new.safe_error_code='lease_expired_ambiguous' then
    update public.notification_dispatches d
    set status='exhausted',safe_error_code='lease_expired_ambiguous',
      version=d.version+1
    where d.organization_id=new.organization_id
      and d.id=any(new.prepared_dispatch_ids) and d.status='burst_pending';
    insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
    values(new.organization_id,'notification.burst_uncertain',
      'notification_digest_batch',new.id::text,
      jsonb_build_object('preparedCount',
        cardinality(new.prepared_dispatch_ids),'attempt',new.attempt_count));
  end if;
  return new;
end $$;

create trigger reconcile_notification_burst_members
  after update of status on public.notification_digest_batches
  for each row execute function public.m12_06_reconcile_burst_members();

create function public.m12_06_guard_delivery_mode()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if old.notification_delivery_mode='unified'
    and new.notification_delivery_mode='legacy'
    and (old.notification_burst_enabled
      or exists(select 1 from public.notification_dispatches d
        where d.organization_id=old.organization_id and d.status='burst_pending')
      or exists(select 1 from public.notification_digest_batches b
        where b.organization_id=old.organization_id and b.batch_kind='burst'
          and b.status in ('queued','retrying','leased'))) then
    raise check_violation using message='burst_mode_switch_unsafe_rollback';
  end if;
  return new;
end $$;

create trigger guard_burst_delivery_mode
  before update of notification_delivery_mode on public.organization_settings
  for each row execute function public.m12_06_guard_delivery_mode();

-- Keep the existing digest worker from claiming a burst row. All other
-- digest RPC signatures and results stay unchanged.
create or replace function public.claim_notification_digest_batch_atomic(
  p_organization_id uuid,p_worker_id uuid,p_lease_seconds integer
) returns table(outcome text,batch jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.notification_digest_batches%rowtype; delivery_mode text;
begin
  if p_organization_id is null or p_worker_id is null
    or p_lease_seconds not between 30 and 900 then
    return query select 'invalid_request',null::jsonb; return;
  end if;
  select notification_delivery_mode into delivery_mode
  from public.organization_settings where organization_id=p_organization_id for share;
  if delivery_mode is distinct from 'unified' then
    return query select 'none_available',null::jsonb; return;
  end if;
  select * into b from public.notification_digest_batches x
  where x.organization_id=p_organization_id and x.batch_kind='digest'
    and x.next_attempt_at<=clock_timestamp()
    and x.status in ('queued','retrying')
  order by x.next_attempt_at,x.created_at,x.id for update skip locked limit 1;
  if not found then return query select 'none_available',null::jsonb; return; end if;
  update public.notification_digest_batches
  set status='leased',lease_owner=p_worker_id,
    lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),
    attempt_count=attempt_count+1,last_attempt_at=clock_timestamp(),
    version=version+1,safe_error_code=null
  where organization_id=p_organization_id and id=b.id returning * into b;
  return query select 'claimed',jsonb_build_object(
    'batchId',b.id,'leaseOwner',b.lease_owner,'checkpointVersion',b.version);
end $$;

-- The legacy reconciler assumes every leased batch might have reached SMTP.
-- A burst with no prepared members has not produced a delivery envelope and
-- can safely release its members. Prepared bursts remain uncertain.
create or replace function public.reconcile_notification_ambiguous_leases_atomic(
  p_now timestamptz default clock_timestamp(),p_limit integer default 1000
) returns table(outcome text,dispatches integer,digests integer)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_direct integer:=0; v_children integer:=0; v_batches integer:=0;
  v_batch public.notification_digest_batches%rowtype; v_changed integer;
begin
  if p_now is null or p_limit not between 1 and 10000 then
    return query select 'invalid_request'::text,0,0; return;
  end if;
  with due as (
    select d.id from public.notification_dispatches d
    where d.status='leased' and d.lease_expires_at<=p_now
    order by d.lease_expires_at,d.id limit p_limit for update skip locked
  ), changed as (
    update public.notification_dispatches d
    set status='exhausted',lease_owner=null,lease_expires_at=null,
      safe_error_code='lease_expired_ambiguous',version=d.version+1
    from due where due.id=d.id
    returning d.organization_id,d.id,d.source_type,d.attempt_count
  ), recorded as (
    insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
    select organization_id,'notification.dispatch_lease_ambiguous',
      'notification_dispatch',id::text,
      jsonb_build_object('sourceType',source_type,'attempt',attempt_count)
    from changed returning id
  ) select count(*)::integer into v_direct from recorded;

  for v_batch in
    select b.* from public.notification_digest_batches b
    where b.status='leased' and b.lease_expires_at<=p_now
    order by b.lease_expires_at,b.id
    limit least(p_limit,100) for update skip locked
  loop
    if v_batch.batch_kind='burst'
      and cardinality(v_batch.prepared_dispatch_ids)=0 then
      update public.notification_digest_batches b
      set status='cancelled',lease_owner=null,lease_expires_at=null,
        safe_error_code='lease_expired_before_prepare',version=b.version+1
      where b.organization_id=v_batch.organization_id and b.id=v_batch.id;
      -- Enabled immediate members remain burst_pending and are safely
      -- rescheduled. Disabled or changed preferences are classified now.
      with candidates as (
        select d.id,coalesce(pref.modes->>d.category,'immediate') mode,
          public.m12_03_dispatch_source_valid(d.organization_id,d.id) source_valid,
          coalesce(s.notification_burst_enabled,false) and
            s.notification_delivery_mode='unified' burst_enabled
        from public.notification_dispatches d
        join public.organization_settings s on s.organization_id=d.organization_id
        left join public.notification_preferences pref
          on pref.organization_id=d.organization_id
            and pref.user_id=d.effective_recipient_user_id
        where d.organization_id=v_batch.organization_id
          and d.id=any(v_batch.dispatch_ids) and d.status='burst_pending'
      ), changed as (
        update public.notification_dispatches d
        set status=case
            when not c.source_valid or c.mode='off' then 'cancelled'
            when c.mode in ('daily','weekly') then 'digest_pending'
            when c.burst_enabled then 'burst_pending'
            else 'queued' end,
          safe_error_code=case
            when not c.source_valid then 'source_unavailable'
            when c.mode='off' then 'preference_suppressed'
            else null end,
          next_attempt_at=case when c.mode='immediate'
            then p_now else d.next_attempt_at end,
          version=d.version+1
        from candidates c where d.organization_id=v_batch.organization_id
          and d.id=c.id and (not c.burst_enabled
            or c.mode<>'immediate' or not c.source_valid)
        returning d.id,d.status,d.safe_error_code
      ), facts as (
        insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
        select v_batch.organization_id,'notification.burst_reclassified',
          'notification_dispatch',id::text,
          jsonb_build_object('status',status,'reason',safe_error_code)
        from changed returning id
      ) select count(*)::integer into v_changed from facts;
      v_children:=v_children+v_changed;
      insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
      values(v_batch.organization_id,'notification.burst_released_before_prepare',
        'notification_digest_batch',v_batch.id::text,
        jsonb_build_object('memberCount',cardinality(v_batch.dispatch_ids),
          'attempt',v_batch.attempt_count));
    else
      update public.notification_digest_batches b
      set status='exhausted',lease_owner=null,lease_expires_at=null,
        safe_error_code='lease_expired_ambiguous',version=b.version+1
      where b.organization_id=v_batch.organization_id and b.id=v_batch.id;
      -- The burst trigger above atomically marks only prepared members
      -- exhausted; ordinary digest children retain their prior behavior.
      if v_batch.batch_kind='digest' then
        with changed as (
          update public.notification_dispatches d
          set status='exhausted',safe_error_code='lease_expired_ambiguous',
            version=d.version+1
          where d.organization_id=v_batch.organization_id
            and d.id=any(v_batch.dispatch_ids)
            and d.status in ('digest_pending','queued','retrying')
          returning d.id,d.source_type,d.attempt_count
        ), facts as (
          insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
          select v_batch.organization_id,'notification.dispatch_lease_ambiguous',
            'notification_dispatch',id::text,
            jsonb_build_object('sourceType',source_type,'attempt',attempt_count)
          from changed returning id
        ) select count(*)::integer into v_changed from facts;
        v_children:=v_children+v_changed;
      else
        v_children:=v_children+cardinality(v_batch.prepared_dispatch_ids);
      end if;
      insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
      values(v_batch.organization_id,'notification.digest_lease_ambiguous',
        'notification_digest_batch',v_batch.id::text,
        jsonb_build_object('itemCount',cardinality(v_batch.dispatch_ids),
          'attempt',v_batch.attempt_count));
    end if;
    v_batches:=v_batches+1;
  end loop;
  return query select 'reconciled'::text,v_direct+v_children,v_batches;
end $$;

-- Updated-at only for burst policy changes; ordinary settings edits do not
-- change an independently versioned notification policy.
do $$
declare v_signature text;
begin
  foreach v_signature in array array[
    'm12_06_dispatch_event_class(text,text)',
    'm12_06_source_created_at(uuid,text,uuid)',
    'm12_06_classify_dispatch()',
    'm12_06_burst_dispatch_eligible(uuid,uuid)',
    'm12_06_burst_dispatch_delivery_valid(uuid,uuid)',
    'm12_06_burst_policy_json(uuid)',
    'get_notification_burst_policy_atomic(uuid,uuid)',
    'update_notification_burst_policy_atomic(uuid,uuid,integer,boolean,uuid)',
    'schedule_notification_burst_batches_atomic(uuid,timestamp with time zone,integer)',
    'list_due_notification_burst_organizations_atomic(uuid,integer)',
    'claim_notification_burst_batch_atomic(uuid,uuid,integer)',
    'prepare_notification_burst_batch_atomic(uuid,uuid,uuid,integer)',
    'revalidate_notification_burst_batch_atomic(uuid,uuid,uuid,integer)',
    'complete_notification_burst_batch_atomic(uuid,uuid,uuid,integer,text,text,text)',
    'fail_notification_burst_batch_atomic(uuid,uuid,uuid,integer,text,boolean)',
    'm12_06_feed_event_class(text,text)',
    'm12_06_feed_rows(uuid,uuid)',
    'm1204_feed_rows(uuid,uuid)',
    'list_notification_feed_grouped_atomic(uuid,uuid,text,text,text,text,integer)',
    'm12_06_list_filtered_feed_atomic(uuid,uuid,text,timestamp with time zone,uuid,text,integer)',
    'list_notification_feed_cohort_atomic(uuid,uuid,text,timestamp with time zone,text,integer)',
    'list_notification_feed_batch_atomic(uuid,uuid,uuid,text,integer)',
    'list_notification_burst_batches_atomic(uuid,uuid,text,integer)',
    'm12_06_reconcile_burst_members()',
    'm12_06_guard_delivery_mode()'
  ] loop
    execute format('alter function public.%s owner to postgres',v_signature);
    execute format('revoke all on function public.%s from public,anon,authenticated',v_signature);
    execute format('grant execute on function public.%s to service_role',v_signature);
  end loop;
  alter function public.reconcile_notification_ambiguous_leases_atomic(
    timestamptz,integer) owner to postgres;
  revoke all on function public.reconcile_notification_ambiguous_leases_atomic(
    timestamptz,integer) from public,anon,authenticated;
  grant execute on function public.reconcile_notification_ambiguous_leases_atomic(
    timestamptz,integer) to service_role;
end $$;
