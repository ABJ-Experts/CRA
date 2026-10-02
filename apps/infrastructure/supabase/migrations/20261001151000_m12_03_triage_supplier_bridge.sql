-- M12-03 immediate internal handoff for M5 triage and M9 owner escalation.
-- External supplier reminders and all other legacy notifications remain owned
-- by their source workers. Non-immediate modes are consumed by digest work.
alter table public.notification_dispatches
  drop constraint if exists notification_dispatches_source_type_check,
  add constraint notification_dispatches_source_type_check
    check (source_type in ('evidence_validity','evidence_quarantined','evidence_integrity_failure',
      'finding_triage_alert','supplier_owner_escalation'));

-- A mode switch is a transaction boundary. Even an expired lease is ambiguous
-- after SMTP may have accepted a message, so operations must reconcile it first.
create function public.m12_03_notification_mode_has_active_leases(p_organization_id uuid)
returns boolean language sql security definer set search_path=public,pg_temp as $$
  select p_organization_id is null
    or exists(select 1 from public.vulnerability_triage_alert_events e
      where e.organization_id=p_organization_id and e.state='leased')
    or exists(select 1 from public.evidence_document_notification_outbox n
      where n.organization_id=p_organization_id and n.status='leased'
        and n.event_type in ('evidence_validity_expiring','evidence_quarantined','evidence_integrity_failure'))
    or exists(select 1 from public.supplier_evidence_reminder_deliveries d
      where d.organization_id=p_organization_id and d.state='leased'
        and d.recipient_kind='owner' and d.event_kind='owner_escalation')
    or exists(select 1 from public.notification_dispatches d
      where d.organization_id=p_organization_id and d.status='leased')
    or exists(select 1 from public.notification_digest_batches b
      where b.organization_id=p_organization_id and b.status='leased')
$$;

create function public.m12_03_notification_mode_has_unsafe_rollback(
  p_organization_id uuid,p_allow_unattempted_queue boolean
)
returns boolean language sql security definer set search_path=public,pg_temp as $$
  select exists(
    select 1 from public.notification_dispatches d
    where d.organization_id=p_organization_id
      and (d.status='digest_pending'
        or (d.status='cancelled' and d.safe_error_code='preference_suppressed')
        or (d.status='queued' and (not p_allow_unattempted_queue or d.attempt_count>0))
        or d.status='retrying'
        or (d.attempt_count>0 and d.status in ('failed','exhausted')))
      and case d.source_type
        when 'finding_triage_alert' then exists(select 1 from public.vulnerability_triage_alert_events e
          where e.organization_id=d.organization_id and e.id=d.source_id
            and e.state in ('queued','retrying','leased'))
        when 'supplier_owner_escalation' then exists(select 1 from public.supplier_evidence_reminder_deliveries source
          where source.organization_id=d.organization_id and source.id=d.source_id
            and source.state in ('queued','leased'))
        else exists(select 1 from public.evidence_document_notification_outbox n
          where n.organization_id=d.organization_id and n.id=d.source_id
            and n.status in ('queued','leased'))
      end
  )
$$;

create function public.m12_03_guard_notification_mode_switch()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.notification_delivery_mode is distinct from old.notification_delivery_mode
    and public.m12_03_notification_mode_has_active_leases(new.organization_id) then
    raise exception 'notification_mode_switch_active_lease' using errcode='23514';
  end if;
  if old.notification_delivery_mode='unified' and new.notification_delivery_mode='legacy'
    and public.m12_03_notification_mode_has_unsafe_rollback(new.organization_id,false) then
    raise exception 'notification_mode_switch_unsafe_rollback' using errcode='23514';
  end if;
  return new;
end $$;

create trigger guard_notification_mode_switch
  before update of notification_delivery_mode on public.organization_settings
  for each row execute function public.m12_03_guard_notification_mode_switch();

create function public.set_notification_delivery_mode_atomic(
  p_organization_id uuid,p_mode text
) returns table(outcome text,previous_mode text,current_mode text)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_previous text;
begin
  if p_organization_id is null or p_mode not in ('legacy','unified') then
    return query select 'invalid_request'::text,null::text,null::text; return;
  end if;
  select s.notification_delivery_mode into v_previous
  from public.organization_settings s where s.organization_id=p_organization_id for update;
  if not found then return query select 'not_found'::text,null::text,null::text; return; end if;
  if v_previous=p_mode then return query select 'unchanged'::text,v_previous,v_previous; return; end if;
  if public.m12_03_notification_mode_has_active_leases(p_organization_id) then
    return query select 'active_lease'::text,v_previous,v_previous; return;
  end if;
  if v_previous='unified' and p_mode='legacy'
    and public.m12_03_notification_mode_has_unsafe_rollback(p_organization_id,true) then
    return query select 'unsafe_rollback'::text,v_previous,v_previous; return;
  end if;
  if v_previous='unified' and p_mode='legacy' then
    with released as (
      update public.notification_dispatches d
      set status='cancelled',safe_error_code='mode_rollback',version=d.version+1
      where d.organization_id=p_organization_id and d.status='queued' and d.attempt_count=0
      returning d.id,d.source_type,d.source_id
    ) insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
    select p_organization_id,'notification.dispatch_released_to_legacy','notification_dispatch',id::text,
      jsonb_build_object('sourceType',source_type,'sourceId',source_id) from released;
  elsif v_previous='legacy' and p_mode='unified' then
    with resumed as (
      update public.notification_dispatches d
      set status='queued',safe_error_code=null,version=d.version+1
      where d.organization_id=p_organization_id and d.status='cancelled'
        and d.safe_error_code='mode_rollback' and d.attempt_count=0
        and public.m12_03_dispatch_source_valid(p_organization_id,d.id)
      returning d.id,d.source_type,d.source_id
    ) insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
    select p_organization_id,'notification.dispatch_resumed_from_legacy','notification_dispatch',id::text,
      jsonb_build_object('sourceType',source_type,'sourceId',source_id) from resumed;
  end if;
  update public.organization_settings set notification_delivery_mode=p_mode where organization_id=p_organization_id;
  insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
  values(p_organization_id,'notification.delivery_mode_changed','organization_settings',p_organization_id::text,
    jsonb_build_object('previousMode',v_previous,'currentMode',p_mode));
  return query select 'updated'::text,v_previous,p_mode;
end $$;

create function public.bridge_vulnerability_triage_notification_dispatches_atomic(
  p_organization_id uuid,p_limit integer default 100
) returns table(outcome text,created integer)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_created integer;
begin
  if p_organization_id is null or p_limit not between 1 and 1000 then
    return query select 'invalid_request'::text,0; return;
  end if;
  perform 1 from public.organization_settings where organization_id=p_organization_id for share;
  if not exists(select 1 from public.organization_settings s where s.organization_id=p_organization_id
    and s.notification_delivery_mode='unified') then
    return query select 'legacy'::text,0; return;
  end if;
  perform public.m5_triage_materialize_due_work(p_organization_id);
  with inserted as (insert into public.notification_dispatches(
    organization_id,category,source_type,source_id,source_subtype,source_link,safe_title,
    original_recipient_user_id,effective_recipient_user_id,status,next_attempt_at,safe_error_code
  )
  select e.organization_id,'finding_triage','finding_triage_alert',e.id,e.event_kind,
    '/findings?findingId='||e.finding_id::text,left(f.canonical_advisory_id,500),
    (detail.result #>> '{recipient,userId}')::uuid,(detail.result #>> '{recipient,userId}')::uuid,
    case coalesce(pref.modes->>'finding_triage','immediate')
      when 'immediate' then 'queued' when 'off' then 'cancelled' else 'digest_pending' end,
    e.due_at,case when pref.modes->>'finding_triage'='off' then 'preference_suppressed' else null end
  from public.vulnerability_triage_alert_events e
  join public.vulnerability_findings f on f.organization_id=e.organization_id and f.id=e.finding_id and f.status='active'
  join public.product_releases r on r.organization_id=f.organization_id and r.id=f.release_id
  join public.products p on p.organization_id=r.organization_id and p.id=r.product_id and p.archived_at is null
  cross join lateral public.get_vulnerability_triage_alert_details(e.organization_id,e.id) detail
  left join public.notification_preferences pref on pref.organization_id=e.organization_id
    and pref.user_id=(detail.result #>> '{recipient,userId}')::uuid
  where e.organization_id=p_organization_id and e.due_at<=clock_timestamp()
    and (e.state in ('queued','retrying') or (e.state='leased' and e.lease_expires_at<=clock_timestamp()))
    and detail.outcome='found'
    and public.m1201_source_can(p_organization_id,(detail.result #>> '{recipient,userId}')::uuid,'finding_triage',true)
    and not exists(select 1 from public.notification_dispatches existing
      where existing.organization_id=e.organization_id and existing.source_type='finding_triage_alert'
        and existing.source_id=e.id
        and existing.original_recipient_user_id=(detail.result #>> '{recipient,userId}')::uuid)
  order by e.due_at,e.id limit p_limit
  on conflict(organization_id,source_type,source_id,original_recipient_user_id) do nothing
  returning id,organization_id,source_type,source_id,status)
  insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
  select organization_id,'notification.dispatch_created','notification_dispatch',id::text,
    jsonb_build_object('sourceType',source_type,'sourceId',source_id,'status',status) from inserted;
  get diagnostics v_created=row_count;
  with terminal as (
    select e.id,detail.outcome
    from public.vulnerability_triage_alert_events e
    cross join lateral public.get_vulnerability_triage_alert_details(e.organization_id,e.id) detail
    where e.organization_id=p_organization_id and e.due_at<=clock_timestamp()
      and (e.state in ('queued','retrying') or (e.state='leased' and e.lease_expires_at<=clock_timestamp()))
      and detail.outcome in ('recipient_unavailable','skipped_deleted','skipped_superseded')
    order by e.due_at,e.id limit p_limit for update of e skip locked
  ), changed as (
    update public.vulnerability_triage_alert_events e
    set state=terminal.outcome,lease_owner=null,lease_expires_at=null,
      error_code=terminal.outcome,error_message=null
    from terminal where e.organization_id=p_organization_id and e.id=terminal.id
    returning e.id,e.state
  ) insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
  select p_organization_id,'notification.source_unavailable','vulnerability_triage_alert_event',id::text,
    jsonb_build_object('reason',state) from changed;
  return query select 'bridged'::text,v_created;
end $$;

create function public.bridge_supplier_owner_notification_dispatches_atomic(
  p_organization_id uuid,p_limit integer default 100
) returns table(outcome text,created integer)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_created integer;
begin
  if p_organization_id is null or p_limit not between 1 and 1000 then
    return query select 'invalid_request'::text,0; return;
  end if;
  perform 1 from public.organization_settings where organization_id=p_organization_id for share;
  if not exists(select 1 from public.organization_settings s where s.organization_id=p_organization_id
    and s.notification_delivery_mode='unified') then
    return query select 'legacy'::text,0; return;
  end if;
  with inserted as (insert into public.notification_dispatches(
    organization_id,category,source_type,source_id,source_subtype,source_link,safe_title,
    original_recipient_user_id,effective_recipient_user_id,status,next_attempt_at,safe_error_code
  )
  select d.organization_id,'supplier_owner','supplier_owner_escalation',d.id,d.event_kind,
    case when u.is_active and public.m9_04_can_view(p_organization_id,d.owner_user_id)
      then '/suppliers/'||q.supplier_id::text||'?requestId='||q.id::text else null end,
    case when u.is_active and public.m9_04_can_view(p_organization_id,d.owner_user_id)
      then left(r.portal_title,500) else null end,
    d.owner_user_id,d.owner_user_id,
    case when not u.is_active or not public.m9_04_can_view(p_organization_id,d.owner_user_id)
      then 'cancelled'
      else case coalesce(pref.modes->>'supplier_owner','immediate')
        when 'immediate' then 'queued' when 'off' then 'cancelled' else 'digest_pending' end end,
    d.next_attempt_at,case when not u.is_active or not public.m9_04_can_view(p_organization_id,d.owner_user_id)
      then 'recipient_unavailable'
      when pref.modes->>'supplier_owner'='off' then 'preference_suppressed' else null end
  from public.supplier_evidence_reminder_deliveries d
  join public.supplier_evidence_requests q on q.organization_id=d.organization_id and q.id=d.request_id
    and q.current_revision_id=d.revision_id and q.state='open'
  join public.supplier_evidence_request_revisions r on r.organization_id=d.organization_id and r.id=d.revision_id
    and r.due_at=d.due_at_snapshot
  join public.products p on p.organization_id=q.organization_id and p.id=q.product_id and p.archived_at is null
  join public.supplier_organizations supplier on supplier.organization_id=q.organization_id and supplier.id=q.supplier_id
    and supplier.archived_at is null
  join public.organization_members m on m.organization_id=d.organization_id and m.user_id=d.owner_user_id
  join public.users u on u.id=m.user_id
  left join public.notification_preferences pref on pref.organization_id=d.organization_id and pref.user_id=d.owner_user_id
  where d.organization_id=p_organization_id and d.event_kind='owner_escalation' and d.recipient_kind='owner'
    and d.next_attempt_at<=clock_timestamp()
    and (d.state='queued' or (d.state='leased' and d.lease_expires_at<=clock_timestamp()))
    and public.m9_04_request_has_outstanding_required(p_organization_id,d.revision_id)
    and q.internal_owner_user_id=d.owner_user_id
    and not exists(select 1 from public.notification_dispatches existing
      where existing.organization_id=d.organization_id and existing.source_type='supplier_owner_escalation'
        and existing.source_id=d.id)
  order by d.next_attempt_at,d.id limit p_limit
  on conflict(organization_id,source_type,source_id,original_recipient_user_id) do nothing
  returning id,organization_id,source_type,source_id,status)
  insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
  select organization_id,'notification.dispatch_created','notification_dispatch',id::text,
    jsonb_build_object('sourceType',source_type,'sourceId',source_id,'status',status) from inserted;
  get diagnostics v_created=row_count;
  return query select 'bridged'::text,v_created;
end $$;

-- Preserve the reviewed source workers and every legacy branch. Unified-mode
-- claims are held at the source boundary; a rollout first drains old leases.
alter function public.claim_vulnerability_triage_alert(uuid,text,integer)
  rename to m12_03_claim_vulnerability_triage_alert_legacy;
create function public.claim_vulnerability_triage_alert(
  p_organization_id uuid,p_worker_id text,p_lease_seconds integer default 120
) returns table(outcome text,alert_event jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform 1 from public.organization_settings where organization_id=p_organization_id for share;
  if exists(select 1 from public.organization_settings s where s.organization_id=p_organization_id
    and s.notification_delivery_mode='unified') then
    return query select 'none_due'::text,null::jsonb; return;
  end if;
  return query select * from public.m12_03_claim_vulnerability_triage_alert_legacy(
    p_organization_id,p_worker_id,p_lease_seconds);
end $$;

create or replace function public.claim_supplier_evidence_reminder_delivery_atomic(
  p_organization_id uuid,p_worker_id uuid,p_lease_seconds integer
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.supplier_evidence_reminder_deliveries%rowtype;
  q public.supplier_evidence_requests%rowtype;
  r public.supplier_evidence_request_revisions%rowtype;
begin
  if p_organization_id is null or p_worker_id is null or p_lease_seconds not between 30 and 900 then return null; end if;
  perform 1 from public.organization_settings where organization_id=p_organization_id for share;
  select * into d from public.supplier_evidence_reminder_deliveries x
  where x.organization_id=p_organization_id and x.state in ('queued','leased')
    and x.next_attempt_at<=clock_timestamp() and (x.state='queued' or x.lease_expires_at<=clock_timestamp())
    and (x.recipient_kind='supplier' or not exists(select 1 from public.organization_settings s
      where s.organization_id=p_organization_id and s.notification_delivery_mode='unified'))
  order by x.scheduled_for,x.created_at,x.id for update skip locked limit 1;
  if not found then return null; end if;
  select * into q from public.supplier_evidence_requests where organization_id=p_organization_id and id=d.request_id for share;
  select * into r from public.supplier_evidence_request_revisions where organization_id=p_organization_id and id=d.revision_id for share;
  if not found or q.state<>'open' or not public.m9_04_request_has_outstanding_required(p_organization_id,d.revision_id)
    or q.current_revision_id<>d.revision_id or r.due_at<>d.due_at_snapshot
    or (d.offset_hours<0 and clock_timestamp()>=d.due_at_snapshot)
    or (d.recipient_kind='supplier' and exists(select 1 from public.supplier_evidence_reminder_deliveries sent_delivery
      where sent_delivery.organization_id=p_organization_id and sent_delivery.revision_id=d.revision_id
        and sent_delivery.recipient_kind='supplier' and sent_delivery.state='sent' and sent_delivery.id<>d.id
        and sent_delivery.sent_at>clock_timestamp()-interval '24 hours')) then
    update public.supplier_evidence_reminder_deliveries set state='obsolete',lease_owner=null,lease_expires_at=null,
      last_error='reminder no longer applicable',version=version+1,updated_at=clock_timestamp()
    where organization_id=p_organization_id and id=d.id;
    return jsonb_build_object('outcome','obsolete','deliveryId',d.id);
  end if;
  update public.supplier_evidence_reminder_deliveries
  set state='leased',lease_owner=p_worker_id,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),
    attempt_count=attempt_count+1,last_error=null,version=version+1,updated_at=clock_timestamp()
  where organization_id=p_organization_id and id=d.id;
  return jsonb_build_object('outcome','claimed','deliveryId',d.id,'eventKind',d.event_kind);
end $$;

-- The queue adapter already consumes this cursor shape. Discovery is tenant
-- ordered and bounded, and source bridges run before each tenant's claim.
create or replace function public.list_due_notification_dispatch_organizations_atomic(
  p_after_organization_id uuid default null,p_limit integer default 1000
) returns table(organization_id uuid)
language sql stable security definer set search_path=public,pg_temp as $$
  select source_org.organization_id from (
    select d.organization_id from public.notification_dispatches d
      join public.organization_settings s on s.organization_id=d.organization_id
        and s.notification_delivery_mode='unified'
      where d.status in ('queued','retrying') and d.next_attempt_at<=clock_timestamp()
    union
    select e.organization_id from public.vulnerability_triage_alert_events e
      join public.organization_settings s on s.organization_id=e.organization_id and s.notification_delivery_mode='unified'
      join public.vulnerability_findings f on f.organization_id=e.organization_id and f.id=e.finding_id and f.status='active'
      join public.product_releases r on r.organization_id=f.organization_id and r.id=f.release_id
      join public.products p on p.organization_id=r.organization_id and p.id=r.product_id and p.archived_at is null
      cross join lateral public.get_vulnerability_triage_alert_details(e.organization_id,e.id) detail
      where e.due_at<=clock_timestamp() and (e.state in ('queued','retrying') or (e.state='leased' and e.lease_expires_at<=clock_timestamp()))
        and detail.outcome='found'
        and public.m1201_source_can(e.organization_id,(detail.result #>> '{recipient,userId}')::uuid,'finding_triage',true)
        and not exists(select 1 from public.notification_dispatches d where d.organization_id=e.organization_id
          and d.source_type='finding_triage_alert' and d.source_id=e.id
          and d.original_recipient_user_id=(detail.result #>> '{recipient,userId}')::uuid)
    union
    select s.organization_id from public.vulnerability_finding_triage_states s
      join public.organization_settings o on o.organization_id=s.organization_id and o.notification_delivery_mode='unified'
      where s.sla_target_minutes is not null and s.sla_paused_at is null and s.sla_breached_at is null
        and s.sla_elapsed_seconds+greatest(0,extract(epoch from clock_timestamp()-greatest(s.sla_started_at,s.updated_at))::bigint)
          >=s.sla_target_minutes::bigint*60
    union
    select s.organization_id from public.vulnerability_finding_suppressions s
      join public.organization_settings o on o.organization_id=s.organization_id and o.notification_delivery_mode='unified'
      where s.is_current and s.expires_at<=clock_timestamp()
    union
    select n.organization_id from public.evidence_document_notification_outbox n
      join public.organization_settings s on s.organization_id=n.organization_id and s.notification_delivery_mode='unified'
      where n.event_type in ('evidence_validity_expiring','evidence_quarantined','evidence_integrity_failure')
        and n.next_attempt_at<=clock_timestamp()
        and (n.status='queued' or (n.status='leased' and n.lease_expires_at<=clock_timestamp()))
        and not exists(select 1 from public.notification_dispatches d where d.organization_id=n.organization_id
          and d.source_id=n.id and d.source_type=case when n.event_type='evidence_validity_expiring'
            then 'evidence_validity' else n.event_type end)
    union
    select d.organization_id from public.supplier_evidence_reminder_deliveries d
      join public.organization_settings s on s.organization_id=d.organization_id and s.notification_delivery_mode='unified'
      join public.supplier_evidence_requests q on q.organization_id=d.organization_id and q.id=d.request_id
        and q.current_revision_id=d.revision_id and q.state='open' and q.internal_owner_user_id=d.owner_user_id
      join public.supplier_evidence_request_revisions r on r.organization_id=d.organization_id and r.id=d.revision_id
        and r.due_at=d.due_at_snapshot
      join public.products p on p.organization_id=q.organization_id and p.id=q.product_id and p.archived_at is null
      join public.supplier_organizations supplier on supplier.organization_id=q.organization_id and supplier.id=q.supplier_id
        and supplier.archived_at is null
      where d.event_kind='owner_escalation' and d.recipient_kind='owner' and d.next_attempt_at<=clock_timestamp()
        and (d.state='queued' or (d.state='leased' and d.lease_expires_at<=clock_timestamp()))
        and public.m9_04_request_has_outstanding_required(d.organization_id,d.revision_id)
        and not exists(select 1 from public.notification_dispatches x where x.organization_id=d.organization_id
          and x.source_type='supplier_owner_escalation' and x.source_id=d.id)
  ) source_org
  where p_limit between 1 and 1000 and (p_after_organization_id is null or source_org.organization_id>p_after_organization_id)
  order by source_org.organization_id limit p_limit
$$;

-- Optional digests and immediate dispatch use the same current-source gate.
-- Unknown source types are never admitted to an operator-facing digest.
create function public.m12_03_triage_dispatch_source_valid(
  p_organization_id uuid,p_dispatch_id uuid
) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(
    select 1 from public.notification_dispatches d
    join public.vulnerability_triage_alert_events e on e.organization_id=d.organization_id and e.id=d.source_id
      and (e.state in ('queued','retrying') or (e.state='leased' and e.lease_expires_at<=clock_timestamp()))
    join public.vulnerability_findings f on f.organization_id=e.organization_id and f.id=e.finding_id and f.status='active'
    join public.product_releases r on r.organization_id=f.organization_id and r.id=f.release_id
    join public.products p on p.organization_id=r.organization_id and p.id=r.product_id and p.archived_at is null
    join public.organization_members m on m.organization_id=d.organization_id and m.user_id=d.effective_recipient_user_id
    join public.users u on u.id=m.user_id and u.is_active
    cross join lateral public.get_vulnerability_triage_alert_details(e.organization_id,e.id) detail
    where d.organization_id=p_organization_id and d.id=p_dispatch_id
      and d.source_type='finding_triage_alert' and e.event_kind=d.source_subtype
      and detail.outcome='found' and detail.result #>> '{recipient,userId}'=d.effective_recipient_user_id::text
      and public.m1201_source_can(p_organization_id,d.effective_recipient_user_id,'finding_triage',true)
  )
$$;

create function public.m12_03_supplier_owner_dispatch_source_valid(
  p_organization_id uuid,p_dispatch_id uuid
) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(
    select 1 from public.notification_dispatches d
    join public.supplier_evidence_reminder_deliveries source on source.organization_id=d.organization_id
      and source.id=d.source_id and (source.state='queued' or (source.state='leased' and source.lease_expires_at<=clock_timestamp())) and source.event_kind='owner_escalation'
      and source.recipient_kind='owner'
    join public.supplier_evidence_requests q on q.organization_id=source.organization_id and q.id=source.request_id
      and q.state='open' and q.current_revision_id=source.revision_id
      and q.internal_owner_user_id=d.effective_recipient_user_id
    join public.supplier_evidence_request_revisions r on r.organization_id=q.organization_id and r.id=source.revision_id
      and r.due_at=source.due_at_snapshot
    join public.products p on p.organization_id=q.organization_id and p.id=q.product_id and p.archived_at is null
    join public.supplier_organizations supplier on supplier.organization_id=q.organization_id and supplier.id=q.supplier_id
      and supplier.archived_at is null
    join public.organization_members m on m.organization_id=d.organization_id and m.user_id=d.effective_recipient_user_id
    join public.users u on u.id=m.user_id and u.is_active
    where d.organization_id=p_organization_id and d.id=p_dispatch_id and d.source_type='supplier_owner_escalation'
      and d.original_recipient_user_id=source.owner_user_id and d.source_subtype=source.event_kind
      and public.m9_04_request_has_outstanding_required(p_organization_id,source.revision_id)
      and public.m9_04_can_view(p_organization_id,d.effective_recipient_user_id)
  )
$$;

create or replace function public.m12_03_dispatch_source_valid(
  p_organization_id uuid,p_dispatch_id uuid
) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce((
    select case d.source_type
      when 'evidence_validity' then public.m12_03_evidence_dispatch_source_valid(p_organization_id,p_dispatch_id)
      when 'evidence_quarantined' then public.m12_03_evidence_scan_dispatch_source_valid(p_organization_id,p_dispatch_id)
      when 'evidence_integrity_failure' then public.m12_03_evidence_scan_dispatch_source_valid(p_organization_id,p_dispatch_id)
      when 'finding_triage_alert' then public.m12_03_triage_dispatch_source_valid(p_organization_id,p_dispatch_id)
      when 'supplier_owner_escalation' then public.m12_03_supplier_owner_dispatch_source_valid(p_organization_id,p_dispatch_id)
      else false end
    from public.notification_dispatches d where d.organization_id=p_organization_id and d.id=p_dispatch_id
  ),false)
$$;

create or replace function public.m12_03_mark_dispatch_sources_provider_accepted(
  p_organization_id uuid,p_dispatch_ids uuid[]
) returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare changed integer:=0; count_changed integer;
begin
  update public.evidence_document_notification_outbox n
  set status='sent',sent_at=clock_timestamp(),lease_owner=null,lease_expires_at=null,last_error=null
  from public.notification_dispatches d
  where d.organization_id=p_organization_id and d.id=any(p_dispatch_ids)
    and (d.source_type='evidence_validity' or d.source_type in ('evidence_quarantined','evidence_integrity_failure'))
    and (d.source_type='evidence_validity' or n.event_type=d.source_type)
    and n.organization_id=d.organization_id and n.id=d.source_id and n.status in ('queued','leased');
  get diagnostics count_changed=row_count; changed:=changed+count_changed;
  update public.vulnerability_triage_alert_events e
  set state='delivered',delivered_at=clock_timestamp(),lease_owner=null,lease_expires_at=null,
      error_code=null,error_message=null
  from public.notification_dispatches d
  where d.organization_id=p_organization_id and d.id=any(p_dispatch_ids) and d.source_type='finding_triage_alert'
    and e.organization_id=d.organization_id and e.id=d.source_id
    and (e.state in ('queued','retrying') or (e.state='leased' and e.lease_expires_at<=clock_timestamp()));
  get diagnostics count_changed=row_count; changed:=changed+count_changed;
  update public.supplier_evidence_reminder_deliveries source
  set state='sent',sent_at=clock_timestamp(),lease_owner=null,lease_expires_at=null,
      last_error=null,version=source.version+1,updated_at=clock_timestamp()
  from public.notification_dispatches d
  where d.organization_id=p_organization_id and d.id=any(p_dispatch_ids) and d.source_type='supplier_owner_escalation'
    and source.organization_id=d.organization_id and source.id=d.source_id
    and (source.state='queued' or (source.state='leased' and source.lease_expires_at<=clock_timestamp()));
  get diagnostics count_changed=row_count; changed:=changed+count_changed;
  return changed;
end $$;

-- The earlier M8 prepare implementation remains the reviewed source adapter.
alter function public.prepare_notification_dispatch_atomic(uuid,uuid,uuid,integer)
  rename to m12_03_prepare_evidence_dispatch_base;
create function public.prepare_notification_dispatch_atomic(
  p_organization_id uuid,p_dispatch_id uuid,p_worker_id uuid,p_expected_version integer
) returns table(outcome text,delivery jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.notification_dispatches%rowtype; recipient_email text; alert jsonb;
  portal_title text; due_at timestamptz; pref public.notification_preferences%rowtype;
  current_mode text; local_now timestamp; quiet_until timestamptz;
begin
  select * into d from public.notification_dispatches
  where organization_id=p_organization_id and id=p_dispatch_id for update;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  if d.source_type in ('evidence_validity','evidence_quarantined','evidence_integrity_failure') then
    return query select * from public.m12_03_prepare_evidence_dispatch_base(
      p_organization_id,p_dispatch_id,p_worker_id,p_expected_version); return;
  end if;
  if d.status<>'leased' or d.lease_owner is distinct from p_worker_id or d.version<>p_expected_version
    or d.lease_expires_at<=clock_timestamp() then
    return query select 'conflict'::text,null::jsonb; return;
  end if;
  if d.source_type not in ('finding_triage_alert','supplier_owner_escalation') then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  select * into pref from public.notification_preferences
  where organization_id=p_organization_id and user_id=d.effective_recipient_user_id;
  current_mode:=coalesce(pref.modes->>d.category,'immediate');
  if current_mode='off' then
    update public.notification_dispatches set status='cancelled',lease_owner=null,lease_expires_at=null,
      safe_error_code='preference_suppressed',version=version+1
    where organization_id=p_organization_id and id=p_dispatch_id;
    insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
    values(p_organization_id,'notification.dispatch_cancelled','notification_dispatch',p_dispatch_id::text,
      jsonb_build_object('sourceType',d.source_type,'sourceId',d.source_id,'reason','preference_suppressed'));
    return query select 'cancelled'::text,null::jsonb; return;
  elsif current_mode in ('daily','weekly') then
    update public.notification_dispatches set status='digest_pending',lease_owner=null,lease_expires_at=null,
      safe_error_code=null,version=version+1
    where organization_id=p_organization_id and id=p_dispatch_id;
    return query select 'cancelled'::text,null::jsonb; return;
  end if;
  if pref.id is not null then
    local_now:=clock_timestamp() at time zone pref.timezone;
    if public.m12_03_local_time_in_quiet(local_now::time,pref.quiet_start,pref.quiet_end) then
      quiet_until:=((local_now::date+pref.quiet_end+
        case when pref.quiet_start>pref.quiet_end and local_now::time>=pref.quiet_start
          then interval '1 day' else interval '0 day' end) at time zone pref.timezone);
      update public.notification_dispatches set status='retrying',lease_owner=null,lease_expires_at=null,
        next_attempt_at=greatest(quiet_until,clock_timestamp()+interval '1 minute'),
        safe_error_code='quiet_hours_deferred',version=version+1
      where organization_id=p_organization_id and id=p_dispatch_id;
      return query select 'cancelled'::text,null::jsonb; return;
    end if;
  end if;
  if not public.m12_03_dispatch_source_valid(p_organization_id,p_dispatch_id) then
    update public.notification_dispatches set status='cancelled',lease_owner=null,lease_expires_at=null,
      safe_error_code='source_unavailable',version=version+1
    where organization_id=p_organization_id and id=p_dispatch_id;
    insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
    values(p_organization_id,'notification.dispatch_cancelled','notification_dispatch',p_dispatch_id::text,
      jsonb_build_object('sourceType',d.source_type,'sourceId',d.source_id,'reason','source_unavailable'));
    return query select 'cancelled'::text,null::jsonb; return;
  end if;
  select u.email into recipient_email from public.organization_members m
  join public.users u on u.id=m.user_id and u.is_active
  where m.organization_id=p_organization_id and m.user_id=d.effective_recipient_user_id;
  if recipient_email is null then
    update public.notification_dispatches set status='cancelled',lease_owner=null,lease_expires_at=null,
      safe_error_code='recipient_unavailable',version=version+1
    where organization_id=p_organization_id and id=p_dispatch_id;
    insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
    values(p_organization_id,'notification.dispatch_cancelled','notification_dispatch',p_dispatch_id::text,
      jsonb_build_object('sourceType',d.source_type,'sourceId',d.source_id,'reason','recipient_unavailable'));
    return query select 'cancelled'::text,null::jsonb; return;
  end if;
  if d.source_type='finding_triage_alert' then
    select detail.result->'alert' into alert
    from public.get_vulnerability_triage_alert_details(p_organization_id,d.source_id) detail
    where detail.outcome='found';
    return query select 'ready'::text,jsonb_build_object(
      'deliveryRef',d.id,'idempotencyKey','notification-dispatch:'||d.id::text,
      'recipient',jsonb_build_object('userId',d.effective_recipient_user_id,'email',recipient_email),
      'payload',jsonb_build_object('kind','finding_triage','advisoryId',alert->>'advisoryId',
        'severity',alert->>'severity','alertKind',d.source_subtype));
    return;
  end if;
  select r.portal_title,r.due_at into portal_title,due_at
  from public.supplier_evidence_reminder_deliveries source
  join public.supplier_evidence_request_revisions r on r.organization_id=source.organization_id and r.id=source.revision_id
  where source.organization_id=p_organization_id and source.id=d.source_id;
  return query select 'ready'::text,jsonb_build_object(
    'deliveryRef',d.id,'idempotencyKey','notification-dispatch:'||d.id::text,
    'recipient',jsonb_build_object('userId',d.effective_recipient_user_id,'email',recipient_email),
    'payload',jsonb_build_object('kind','supplier_owner','portalTitle',portal_title,
      'dueAt',to_char(due_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')));
end $$;

-- Existing retry grants and idempotency remain in the base implementation;
-- this guard prevents stale M5/M9 source records from being requeued.
alter function public.retry_notification_dispatch_atomic(uuid,uuid,text,integer,uuid)
  rename to m12_03_retry_notification_dispatch_base;
create function public.retry_notification_dispatch_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_delivery_ref text,p_expected_version integer,p_idempotency_key uuid
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare dispatch_id uuid; d public.notification_dispatches%rowtype;
begin
  begin dispatch_id:=p_delivery_ref::uuid; exception when invalid_text_representation then
    return query select 'invalid_request'::text,null::jsonb; return; end;
  select * into d from public.notification_dispatches where organization_id=p_organization_id and id=dispatch_id;
  if found and d.source_type in ('finding_triage_alert','supplier_owner_escalation')
    and (not public.m12_03_dispatch_source_valid(p_organization_id,dispatch_id)
      or (d.source_type='finding_triage_alert' and not public.m5_triage_actor_can_edit_findings(p_organization_id,p_actor_user_id))
      or (d.source_type='supplier_owner_escalation' and not public.m9_04_can_view(p_organization_id,p_actor_user_id))) then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  return query select * from public.m12_03_retry_notification_dispatch_base(
    p_organization_id,p_actor_user_id,p_delivery_ref,p_expected_version,p_idempotency_key);
end $$;

do $$
declare signature text;
begin
  foreach signature in array array[
    'm12_03_notification_mode_has_active_leases(uuid)',
    'm12_03_notification_mode_has_unsafe_rollback(uuid,boolean)',
    'm12_03_guard_notification_mode_switch()',
    'set_notification_delivery_mode_atomic(uuid,text)',
    'bridge_vulnerability_triage_notification_dispatches_atomic(uuid,integer)',
    'bridge_supplier_owner_notification_dispatches_atomic(uuid,integer)',
    'm12_03_triage_dispatch_source_valid(uuid,uuid)',
    'm12_03_supplier_owner_dispatch_source_valid(uuid,uuid)',
    'm12_03_prepare_evidence_dispatch_base(uuid,uuid,uuid,integer)',
    'm12_03_retry_notification_dispatch_base(uuid,uuid,text,integer,uuid)',
    'm12_03_claim_vulnerability_triage_alert_legacy(uuid,text,integer)',
    'claim_supplier_evidence_reminder_delivery_atomic(uuid,uuid,integer)'
  ] loop
    execute format('alter function public.%s owner to postgres',signature);
    execute format('revoke all on function public.%s from public,anon,authenticated',signature);
    execute format('grant execute on function public.%s to service_role',signature);
  end loop;
end $$;

revoke all on function public.claim_vulnerability_triage_alert(uuid,text,integer),
  public.claim_supplier_evidence_reminder_delivery_atomic(uuid,uuid,integer),
  public.list_due_notification_dispatch_organizations_atomic(uuid,integer),
  public.prepare_notification_dispatch_atomic(uuid,uuid,uuid,integer),
  public.complete_notification_dispatch_atomic(uuid,uuid,uuid,integer,text,text,text),
  public.retry_notification_dispatch_atomic(uuid,uuid,text,integer,uuid)
from public,anon,authenticated;
grant execute on function public.claim_vulnerability_triage_alert(uuid,text,integer),
  public.claim_supplier_evidence_reminder_delivery_atomic(uuid,uuid,integer),
  public.list_due_notification_dispatch_organizations_atomic(uuid,integer),
  public.prepare_notification_dispatch_atomic(uuid,uuid,uuid,integer),
  public.complete_notification_dispatch_atomic(uuid,uuid,uuid,integer,text,text,text),
  public.retry_notification_dispatch_atomic(uuid,uuid,text,integer,uuid)
to service_role;
