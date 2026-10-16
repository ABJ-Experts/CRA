-- Scope the scheduler's policy checks to one tenant and scan its pending
-- dispatches once per phase. The original per-dispatch RPC is retained for
-- delivery-time revalidation and external compatibility.
create or replace function public.m1206_burst_candidates(p_organization_id uuid)
returns table(id uuid,organization_id uuid,category text,event_class text,
  user_id uuid,preference_version integer,mode text,created_at timestamptz,
  eligible boolean)
language sql stable security definer set search_path=public,pg_temp as $$
  select d.id,d.organization_id,d.category,d.event_class,
    d.effective_recipient_user_id,coalesce(pref.version,1),
    coalesce(pref.modes->>d.category,'immediate'),d.created_at,
    coalesce(s.notification_burst_enabled
      and s.notification_delivery_mode='unified'
      and s.notification_burst_started_at is not null
      and d.created_at>=s.notification_burst_started_at
      and coalesce(triage.created_at,evidence.created_at,supplier.created_at)
        >=s.notification_burst_started_at
      and d.event_class in ('finding_sla_breached','finding_suppression_expired',
        'evidence_validity_expiring','supplier_owner_escalation')
      and coalesce(pref.modes->>d.category,'immediate')='immediate'
      and coalesce(u.is_active,false),false)
  from public.notification_dispatches d
  join public.organization_settings s on s.organization_id=d.organization_id
  left join public.notification_preferences pref
    on pref.organization_id=d.organization_id
      and pref.user_id=d.effective_recipient_user_id
  left join public.vulnerability_triage_alert_events triage
    on d.source_type='finding_triage_alert'
      and triage.organization_id=d.organization_id and triage.id=d.source_id
  left join public.evidence_document_notification_outbox evidence
    on d.source_type='evidence_validity'
      and evidence.organization_id=d.organization_id and evidence.id=d.source_id
  left join public.supplier_evidence_reminder_deliveries supplier
    on d.source_type='supplier_owner_escalation'
      and supplier.organization_id=d.organization_id and supplier.id=d.source_id
  left join public.organization_members member
    on member.organization_id=d.organization_id
      and member.user_id=d.effective_recipient_user_id
  left join public.users u on u.id=member.user_id
  where d.organization_id=p_organization_id and d.status='burst_pending'
$$;

revoke all on function public.m1206_burst_candidates(uuid)
  from public,anon,authenticated;
grant execute on function public.m1206_burst_candidates(uuid) to service_role;

create or replace function public.schedule_notification_burst_batches_atomic(
  p_organization_id uuid,p_now timestamptz default clock_timestamp(),
  p_limit integer default 1000
) returns table(outcome text,created integer,reclassified integer,released integer)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_created integer:=0; v_reclassified integer:=0; v_released integer:=0;
  v_enabled boolean; v_mode text;
  v_critical_released integer:=0; v_singleton_released integer:=0;
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

  -- A finding may escalate after its dispatch entered an open window.
  -- Release only members not frozen in a live batch; an existing batch's
  -- prepare/revalidate path owns its members and will split a changed severity.
  -- The direct worker rechecks the current source, recipient and preference.
  with finding_ids as materialized (
    select distinct e.finding_id
    from public.notification_dispatches d
    join public.vulnerability_triage_alert_events e
      on e.organization_id=d.organization_id and e.id=d.source_id
    where d.organization_id=p_organization_id and d.status='burst_pending'
      and d.source_type='finding_triage_alert'
      and not exists(select 1 from public.notification_digest_batches b
        where b.organization_id=d.organization_id and b.batch_kind='burst'
          and (b.status<>'cancelled'
            or d.id=any(b.prepared_dispatch_ids))
          and d.id=any(b.dispatch_ids))
  ), urgent_findings as materialized (
    select finding_id from finding_ids f
    where public.m5_triage_finding_severity(
      p_organization_id,f.finding_id) in ('high','critical')
  ), changed as (
    update public.notification_dispatches d
    set status='queued',next_attempt_at=p_now,version=d.version+1
    from public.vulnerability_triage_alert_events e
    join urgent_findings urgent on urgent.finding_id=e.finding_id
    where d.organization_id=p_organization_id and d.status='burst_pending'
      and d.source_type='finding_triage_alert'
      and e.organization_id=d.organization_id and e.id=d.source_id
      and not exists(select 1 from public.notification_digest_batches b
        where b.organization_id=d.organization_id and b.batch_kind='burst'
          and (b.status<>'cancelled'
            or d.id=any(b.prepared_dispatch_ids))
          and d.id=any(b.dispatch_ids))
    returning d.id
  ), audited as (
    insert into public.audit_logs(
      organization_id,action,entity_type,entity_id,changes)
    select p_organization_id,'notification.burst_critical_released',
      'notification_dispatch',c.id::text,
      jsonb_build_object('reason','current_high_or_critical_severity')
    from changed c returning id
  ) select count(*)::integer into v_critical_released from audited;

  -- Reclassify before grouping. This is a database transaction with the audit
  -- fact, so a worker restart cannot silently lose a source event.
  with cheap_invalid as (
    select c.id,c.organization_id,c.category,c.user_id
      as effective_recipient_user_id,c.mode
    from public.m1206_burst_candidates(p_organization_id) c
    where not c.eligible
      and not exists(select 1 from public.notification_digest_batches b
        where b.organization_id=c.organization_id and b.batch_kind='burst'
          and b.status='leased' and c.id=any(b.dispatch_ids))
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
    select c.id,c.organization_id,c.category,c.event_class,c.user_id,
      c.preference_version,
      date_bin(interval '2 minutes',c.created_at,
        '2000-01-01 00:00:00+00'::timestamptz) window_start,
      c.created_at
    from public.m1206_burst_candidates(p_organization_id) c
    where c.eligible
      and not exists(select 1 from public.notification_digest_batches b
        where b.organization_id=c.organization_id and b.batch_kind='burst'
          and b.status<>'cancelled' and c.id=any(b.dispatch_ids))
    order by c.created_at,c.id limit p_limit
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
  ) select count(*)::integer into v_singleton_released from audited;
  v_released:=v_critical_released+v_singleton_released;
  return query select 'scheduled'::text,v_created,v_reclassified,v_released;
end $$;

-- Validate one frozen batch as a set. Expensive M5 severity and recipient
-- resolution run once per finding; the M8/M9 adapters keep their existing
-- current-source checks. The caller consumes these results only in its
-- transaction and still checks again immediately before provider delivery.
create or replace function public.m1206_burst_batch_validation(
  p_organization_id uuid,p_dispatch_ids uuid[]
) returns table(dispatch_id uuid,source_valid boolean,valid boolean,mode text)
language sql stable security definer set search_path=public,pg_temp as $$
  with members as materialized (
    select d.id,d.organization_id,d.category,d.source_type,d.source_id,
      d.source_subtype,d.event_class,d.created_at,
      d.effective_recipient_user_id,
      coalesce(pref.modes->>d.category,'immediate') as mode,
      s.notification_burst_enabled,s.notification_delivery_mode,
      s.notification_burst_started_at,
      triage.id as triage_id,triage.finding_id,triage.event_kind,
      triage.state as triage_state,triage.lease_expires_at as triage_lease_end,
      coalesce(triage.created_at,evidence.created_at,supplier.created_at)
        as source_created_at,
      coalesce(u.is_active,false) as active_member
    from public.notification_dispatches d
    join public.organization_settings s on s.organization_id=d.organization_id
    left join public.notification_preferences pref
      on pref.organization_id=d.organization_id
        and pref.user_id=d.effective_recipient_user_id
    left join public.vulnerability_triage_alert_events triage
      on d.source_type='finding_triage_alert'
        and triage.organization_id=d.organization_id
        and triage.id=d.source_id
    left join public.evidence_document_notification_outbox evidence
      on d.source_type='evidence_validity'
        and evidence.organization_id=d.organization_id
        and evidence.id=d.source_id
    left join public.supplier_evidence_reminder_deliveries supplier
      on d.source_type='supplier_owner_escalation'
        and supplier.organization_id=d.organization_id
        and supplier.id=d.source_id
    left join public.organization_members member
      on member.organization_id=d.organization_id
        and member.user_id=d.effective_recipient_user_id
    left join public.users u on u.id=member.user_id
    where d.organization_id=p_organization_id and d.id=any(p_dispatch_ids)
      and d.status='burst_pending'
  ), finding_ids as materialized (
    select distinct finding_id from members
    where source_type='finding_triage_alert' and finding_id is not null
  ), finding_gate as materialized (
    select ids.finding_id,f.status as finding_status,
      p.archived_at as product_archived_at,p.id is not null as product_exists,
      r.id is not null as release_exists,
      public.m5_triage_finding_severity(p_organization_id,ids.finding_id)
        as severity,
      recipient.id as recipient_user_id
    from finding_ids ids
    left join public.vulnerability_findings f
      on f.organization_id=p_organization_id and f.id=ids.finding_id
    left join public.product_releases r
      on r.organization_id=f.organization_id and r.id=f.release_id
    left join public.products p
      on p.organization_id=r.organization_id and p.id=r.product_id
    left join lateral (
      select possible.id from (
        select u.id,0 as priority
        from public.vulnerability_finding_triage_states state
        join public.users u on u.id=state.assignee_user_id and u.is_active
        where state.organization_id=p_organization_id
          and state.finding_id=ids.finding_id
          and public.m5_triage_actor_can_edit_findings(
            p_organization_id,state.assignee_user_id)
        union all
        select u.id,case member.role when 'owner' then 1 else 2 end
        from public.organization_members member
        join public.users u on u.id=member.user_id and u.is_active
        where member.organization_id=p_organization_id
          and member.role in ('owner','admin')
          and public.m5_triage_actor_can_edit_findings(
            p_organization_id,member.user_id)
      ) possible order by possible.priority,possible.id limit 1
    ) recipient on true
  ), recipient_ids as materialized (
    select distinct effective_recipient_user_id from members
    where source_type='finding_triage_alert'
  ), recipient_gate as materialized (
    select r.effective_recipient_user_id,
      public.m1201_source_can(p_organization_id,
        r.effective_recipient_user_id,'finding_triage',true) as can_edit
    from recipient_ids r
  ), checked as materialized (
    select m.*,
      case when m.source_type='finding_triage_alert' then
        coalesce(m.triage_id is not null
          and (m.triage_state in ('queued','retrying')
            or (m.triage_state='leased'
              and m.triage_lease_end<=clock_timestamp()))
          and m.event_kind=m.source_subtype
          and f.finding_status='active' and f.release_exists
          and f.product_exists and f.product_archived_at is null
          and m.active_member
          and f.recipient_user_id=m.effective_recipient_user_id
          and r.can_edit,false)
      else public.m12_03_dispatch_source_valid(p_organization_id,m.id)
      end as source_valid,
      f.severity
    from members m
    left join finding_gate f on f.finding_id=m.finding_id
    left join recipient_gate r
      on r.effective_recipient_user_id=m.effective_recipient_user_id
  )
  select c.id,c.source_valid,
    coalesce(c.notification_burst_enabled
      and c.notification_delivery_mode='unified'
      and c.notification_burst_started_at is not null
      and c.created_at>=c.notification_burst_started_at
      and c.source_created_at>=c.notification_burst_started_at
      and c.event_class in ('finding_sla_breached',
        'finding_suppression_expired','evidence_validity_expiring',
        'supplier_owner_escalation')
      and c.mode='immediate' and c.active_member and c.source_valid
      and (c.source_type<>'finding_triage_alert'
        or coalesce(c.severity not in ('critical','high'),true)),false),
    c.mode
  from checked c
$$;

revoke all on function public.m1206_burst_batch_validation(uuid,uuid[])
  from public,anon,authenticated;
grant execute on function public.m1206_burst_batch_validation(uuid,uuid[])
  to service_role;

create or replace function public.prepare_notification_burst_batch_atomic(
  p_organization_id uuid,p_batch_id uuid,p_worker_id uuid,
  p_expected_version integer
) returns table(outcome text,delivery jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_batch public.notification_digest_batches%rowtype;
  v_pref public.notification_preferences%rowtype; v_email text;
  v_ids uuid[]; v_items jsonb; v_count integer; v_local timestamp;
  v_quiet_end timestamp; v_checks jsonb;
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
  -- Resolve a frozen batch once, then consume the same scoped validation
  -- result for reclassification and the exact prepared membership.
  select coalesce(jsonb_agg(to_jsonb(checked)),'[]'::jsonb)
    into v_checks
  from public.m1206_burst_batch_validation(
    p_organization_id,v_batch.dispatch_ids) checked;
  with invalid as (
    select c.dispatch_id as id,
      case when not c.source_valid or c.mode='off' then 'cancelled'
        when c.mode in ('daily','weekly') then 'digest_pending'
        else 'queued' end as next_status,
      case when not c.source_valid then 'source_unavailable'
        when c.mode='off' then 'preference_suppressed'
        else null end as reason
    from jsonb_to_recordset(v_checks) as c(
      dispatch_id uuid,source_valid boolean,valid boolean,mode text)
    where not c.valid
  ), changed as (
    update public.notification_dispatches d
    set status=i.next_status,safe_error_code=i.reason,
      next_attempt_at=case when i.next_status='queued'
        then clock_timestamp() else d.next_attempt_at end,
      version=d.version+1
    from invalid i where d.organization_id=p_organization_id and d.id=i.id
      and d.status='burst_pending'
    returning d.id,d.status,d.safe_error_code
  )
  insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
  select p_organization_id,'notification.burst_reclassified',
    'notification_dispatch',c.id::text,
    jsonb_build_object('status',c.status,'reason',c.safe_error_code)
  from changed c;
  select array_agg(d.id order by d.created_at,d.id),count(*)::integer
    into v_ids,v_count
  from jsonb_to_recordset(v_checks) as c(
    dispatch_id uuid,source_valid boolean,valid boolean,mode text)
  join public.notification_dispatches d
    on d.organization_id=p_organization_id and d.id=c.dispatch_id
  where c.valid and d.status='burst_pending';
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

create or replace function public.list_due_notification_burst_organizations_atomic(
  p_after_organization_id uuid default null,p_limit integer default 1000
) returns table(organization_id uuid)
language sql stable security definer set search_path=public,pg_temp as $$
  with finding_ids as materialized (
    select distinct d.organization_id,e.finding_id
    from public.notification_dispatches d
    join public.vulnerability_triage_alert_events e
      on e.organization_id=d.organization_id and e.id=d.source_id
    join public.organization_settings s
      on s.organization_id=d.organization_id
      and s.notification_burst_enabled
      and s.notification_delivery_mode='unified'
    where d.status='burst_pending'
      and d.source_type='finding_triage_alert'
      and not exists(select 1 from public.notification_digest_batches b
        where b.organization_id=d.organization_id and b.batch_kind='burst'
          and (b.status<>'cancelled'
            or d.id=any(b.prepared_dispatch_ids))
          and d.id=any(b.dispatch_ids))
  ), urgent_organizations as materialized (
    select distinct f.organization_id from finding_ids f
    where public.m5_triage_finding_severity(
      f.organization_id,f.finding_id) in ('high','critical')
  )
  select due.organization_id from (
    select organization_id from urgent_organizations
    union
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
