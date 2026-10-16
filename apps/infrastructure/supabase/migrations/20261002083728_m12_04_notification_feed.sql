-- M12-04: source-owned outboxes are the durable event ledger. This table stores
-- only per-recipient read state, so email cutover cannot change feed identity.
alter table public.organization_settings
  add column notification_feed_started_at timestamptz not null default clock_timestamp();

create table public.notification_feed_reads (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  ref text not null check (ref ~ '^m(2|5|6|8|9)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_(event|failure)$'),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  event_occurred_at timestamptz not null,
  read_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  primary key (organization_id,user_id,ref)
);
create index notification_feed_reads_retention_idx
  on public.notification_feed_reads(organization_id,event_occurred_at,ref);
alter table public.notification_feed_reads enable row level security;
revoke all on public.notification_feed_reads from public,anon,authenticated;
grant select,insert,update,delete on public.notification_feed_reads to service_role;

create index if not exists m1204_support_feed_due_idx
  on public.product_regulatory_outbox_events(organization_id,due_at desc,id desc)
  where event_type='support_period.alert';
create index if not exists m1204_triage_feed_due_idx
  on public.vulnerability_triage_alert_events(organization_id,due_at desc,id desc);
create index if not exists m1204_deadline_feed_due_idx
  on public.reporting_deadline_alerts(organization_id,threshold_crossed_at desc,id desc);
create index if not exists m1204_evidence_feed_created_idx
  on public.evidence_document_notification_outbox(organization_id,created_at desc,id desc);
create index if not exists m1204_supplier_feed_scheduled_idx
  on public.supplier_evidence_reminder_deliveries(organization_id,scheduled_for desc,id desc)
  where event_kind='owner_escalation';

-- One bounded read model; no copied content, dispatch queue, or backfill. Each
-- branch scopes organization and recipient before exposing source metadata.
create function public.m1204_feed_rows(p_organization_id uuid,p_actor_user_id uuid)
returns table(ref text,category text,severity text,occurred_at timestamptz,source_created_at timestamptz,
  title text,summary text,source_state text,notice_kind text,url text,fingerprint text)
language sql stable security definer set search_path=public,pg_temp as $$
 with active_scope as (
   select s.notification_feed_started_at as started_at
   from public.organization_settings s
   where s.organization_id=p_organization_id
     and public.m1201_active_member(p_organization_id,p_actor_user_id)
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
     case public.m5_triage_finding_severity(p_organization_id,e.finding_id)
       when 'critical' then 'critical' when 'high' then 'high'
       when 'medium' then 'warning' else 'info' end,
     e.due_at,e.created_at,left(f.canonical_advisory_id,500),
     case e.event_kind when 'internal_sla_breached' then 'Finding triage SLA breached'
       else 'Finding suppression expired' end,
     case when f.status='active' and p.archived_at is null and r.archived_at is null
       then 'available' else 'unavailable' end,
     case when f.status='active' and p.archived_at is null and r.archived_at is null
       then '/findings?findingId='||f.id::text else null end,
     e.last_attempt_at,
     e.attempts::text||':'||coalesce(e.error_code,''),
     e.state in ('dead_letter','recipient_unavailable'),
     e.state='recipient_unavailable',false,
     (details.result #>> '{recipient,userId}')::uuid,null::uuid,null::uuid
   from public.vulnerability_triage_alert_events e
   join public.vulnerability_findings f on f.organization_id=e.organization_id and f.id=e.finding_id
   join public.product_releases r on r.organization_id=f.organization_id and r.id=f.release_id
   join public.products p on p.organization_id=r.organization_id and p.id=r.product_id
   left join lateral public.get_vulnerability_triage_alert_details(e.organization_id,e.id) details on true
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
     n.created_at,n.attempt_count::text||':'||coalesce(n.last_error,''),
     n.status='recipient_unavailable',n.status='recipient_unavailable',false,
     n.owner_user_id,null::uuid,null::uuid
   from public.evidence_document_notification_outbox n
   join public.evidence_document_versions v on v.organization_id=n.organization_id and v.id=n.version_id
   join public.evidence_documents d on d.organization_id=v.organization_id and d.id=v.document_id
   left join lateral (
     select product.id,product.archived_at from public.evidence_document_version_products vp
     join public.products product on product.organization_id=vp.organization_id and product.id=vp.product_id
     where vp.organization_id=v.organization_id and vp.version_id=v.id
     order by (product.archived_at is null) desc,product.id limit 1
   ) p on true
   where n.organization_id=p_organization_id and n.status<>'obsolete'
     and public.m1201_source_can(p_organization_id,p_actor_user_id,'evidence_expiry',false)
   union all
   select 'm9',n.id,'supplier_owner','warning',n.scheduled_for,n.created_at,
     'Supplier evidence request'::text,'Supplier evidence owner escalation'::text,
     case when q.state='open' and p.archived_at is null and supplier.archived_at is null
       then 'available' else 'unavailable' end,
     case when q.state='open' and p.archived_at is null and supplier.archived_at is null
       then '/suppliers/'||q.supplier_id::text||'?requestId='||q.id::text else null end,
     n.updated_at,n.version::text||':'||n.attempt_count::text,
     n.state in ('failed','recipient_unavailable'),n.state='recipient_unavailable',false,
     n.owner_user_id,null::uuid,null::uuid
   from public.supplier_evidence_reminder_deliveries n
   join public.supplier_evidence_requests q on q.organization_id=n.organization_id and q.id=n.request_id
   join public.products p on p.organization_id=q.organization_id and p.id=q.product_id
   join public.supplier_organizations supplier on supplier.organization_id=q.organization_id and supplier.id=q.supplier_id
   where n.organization_id=p_organization_id and n.event_kind='owner_escalation' and n.state<>'obsolete'
     and public.m1201_source_can(p_organization_id,p_actor_user_id,'supplier_request',false)
 ), visible as (
   select e.*,v.notice_kind,v.notice_at
   from source_events e cross join lateral (values
     ('event'::text,e.occurred_at),('failure'::text,e.failure_at)
   ) v(notice_kind,notice_at)
   cross join active_scope a
   where e.occurred_at>=a.started_at and e.occurred_at>=statement_timestamp()-interval '180 days'
     and e.occurred_at<=statement_timestamp()
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

create function public.list_notification_feed_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_category text default null,
  p_severity text default null,p_read text default 'all',p_cursor text default null,
  p_limit integer default 25
) returns table(outcome text,result jsonb)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
  v_scope text; v_cursor jsonb; v_snapshot timestamptz := statement_timestamp();
  v_at timestamptz; v_ref text; v_rows jsonb; v_count integer;
  v_last_at timestamptz; v_last_ref text; v_next text;
begin
  if not public.m1201_active_member(p_organization_id,p_actor_user_id) then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  if p_limit is null or p_limit not between 1 and 50
    or (p_category is not null and p_category not in ('finding_triage','evidence','supplier_owner','support_period','reporting_deadline'))
    or (p_severity is not null and p_severity not in ('info','warning','high','critical'))
    or p_read is null or p_read not in ('all','read','unread')
    or (p_cursor is not null and (char_length(p_cursor)>512 or p_cursor !~ '^[A-Za-z0-9_-]+$')) then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  v_scope:=encode(extensions.digest(jsonb_build_object('org',p_organization_id,'actor',p_actor_user_id,
    'category',p_category,'severity',p_severity,'read',p_read)::text,'sha256'),'hex');
  if p_cursor is not null then
    begin
      v_cursor:=convert_from(decode(translate(p_cursor,'-_','+/')||repeat('=',(4-char_length(p_cursor)%4)%4),'base64'),'utf8')::jsonb;
      if jsonb_typeof(v_cursor)<>'object' or v_cursor->>'scope' is distinct from v_scope then
        return query select 'invalid_request'::text,null::jsonb; return;
      end if;
      v_snapshot:=(v_cursor->>'snapshot')::timestamptz;
      v_at:=(v_cursor->>'at')::timestamptz;
      v_ref:=v_cursor->>'ref';
      if v_snapshot is null or v_at is null or v_ref !~ '^m(2|5|6|8|9)_[0-9a-f-]{36}_(event|failure)$'
        or v_snapshot>statement_timestamp()+interval '1 second' then
        return query select 'invalid_request'::text,null::jsonb; return;
      end if;
    exception when others then
      return query select 'invalid_request'::text,null::jsonb; return;
    end;
  end if;
  with candidates as (
    select f.*,(r.fingerprint=f.fingerprint) as is_read
    from public.m1204_feed_rows(p_organization_id,p_actor_user_id) f
    left join public.notification_feed_reads r
      on r.organization_id=p_organization_id and r.user_id=p_actor_user_id and r.ref=f.ref
    where (p_category is null or f.category=p_category)
      and (p_severity is null or f.severity=p_severity)
      and (p_read='all' or (p_read='read')=coalesce(r.fingerprint=f.fingerprint,false))
      and f.occurred_at<=v_snapshot and f.source_created_at<=v_snapshot
      and (v_at is null or (f.occurred_at,f.ref)<(v_at,v_ref))
  ), limited as (
    select * from candidates order by occurred_at desc,ref desc limit p_limit+1
  ), page as (
    select * from limited order by occurred_at desc,ref desc limit p_limit
  )
  select coalesce((select jsonb_agg(jsonb_build_object(
      'ref',p.ref,'category',p.category,'severity',p.severity,
      'occurredAt',to_char(p.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'title',p.title,'summary',p.summary,'read',coalesce(p.is_read,false),
      'fingerprint',p.fingerprint,'sourceState',p.source_state,'noticeKind',p.notice_kind
    ) order by p.occurred_at desc,p.ref desc) from page p),'[]'::jsonb),
    (select count(*)::integer from limited),
    (select p.occurred_at from page p order by p.occurred_at,p.ref limit 1),
    (select p.ref from page p order by p.occurred_at,p.ref limit 1)
  into v_rows,v_count,v_last_at,v_last_ref;
  if v_count>p_limit then
    v_next:=translate(rtrim(replace(replace(encode(convert_to(jsonb_build_object(
      'scope',v_scope,'snapshot',v_snapshot,'at',v_last_at,'ref',v_last_ref)::text,'utf8'),'base64'),E'\n',''), '=','')),'+/','-_');
  end if;
  return query select 'found'::text,jsonb_build_object('items',v_rows,'nextCursor',v_next);
end $$;

create function public.count_notification_feed_unread_atomic(
  p_organization_id uuid,p_actor_user_id uuid
) returns table(outcome text,result jsonb)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_count integer;
begin
  if not public.m1201_active_member(p_organization_id,p_actor_user_id) then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  select count(*)::integer into v_count
  from public.m1204_feed_rows(p_organization_id,p_actor_user_id) f
  left join public.notification_feed_reads r
    on r.organization_id=p_organization_id and r.user_id=p_actor_user_id and r.ref=f.ref
  where r.fingerprint is distinct from f.fingerprint;
  return query select 'found'::text,jsonb_build_object('count',v_count);
end $$;

create function public.resolve_notification_feed_destination_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_ref text
) returns table(outcome text,result jsonb)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_row record;
begin
  if not public.m1201_active_member(p_organization_id,p_actor_user_id) then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  if p_ref is null or p_ref !~ '^m(2|5|6|8|9)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_(event|failure)$' then
    return query select 'not_found'::text,null::jsonb; return;
  end if;
  select f.* into v_row from public.m1204_feed_rows(p_organization_id,p_actor_user_id) f
  where f.ref=p_ref;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  return query select 'found'::text,jsonb_build_object(
    'state',v_row.source_state,'url',case when v_row.source_state='available' then v_row.url else null end);
end $$;

create function public.mark_notification_feed_read_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_items jsonb,p_idempotency_key uuid
) returns table(outcome text,result jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_item jsonb; v_ref text; v_fingerprint text; v_row record;
  v_digest text; v_prior jsonb; v_result jsonb := '[]'::jsonb;
  v_validated jsonb := '[]'::jsonb; v_read_at timestamptz;
begin
  if not public.m1201_active_member(p_organization_id,p_actor_user_id) then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  if p_idempotency_key is null or p_items is null or jsonb_typeof(p_items)<>'array'
    or jsonb_array_length(p_items) not between 1 and 50
    or exists(select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x)<>'object'
      or x->>'ref' !~ '^m(2|5|6|8|9)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_(event|failure)$'
      or x->>'expectedFingerprint' !~ '^[0-9a-f]{64}$')
    or exists(select 1 from jsonb_array_elements(p_items) x group by x->>'ref' having count(*)>1) then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  v_digest:=encode(extensions.digest(p_items::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text||':'||p_actor_user_id::text||':'||p_idempotency_key::text,0));
  select a.changes into v_prior from public.audit_logs a
  where a.organization_id=p_organization_id and a.user_id=p_actor_user_id
    and a.action='notification.feed_mark_read' and a.entity_type='notification_feed'
    and a.entity_id=p_idempotency_key::text
  order by a.created_at desc,a.id desc limit 1;
  if v_prior is not null and v_prior->>'requestDigest' is distinct from v_digest then
    return query select 'conflict'::text,null::jsonb; return;
  end if;
  -- Validate the entire explicit selection before any write. Revoked IDs are
  -- indistinguishable from forged or cross-tenant IDs.
  for v_item in select x from jsonb_array_elements(p_items) x loop
    v_ref:=v_item->>'ref'; v_fingerprint:=v_item->>'expectedFingerprint';
    select f.* into v_row from public.m1204_feed_rows(p_organization_id,p_actor_user_id) f
    where f.ref=v_ref;
    if not found then return query select 'not_found'::text,null::jsonb; return; end if;
    if v_prior is null and v_row.fingerprint<>v_fingerprint then
      return query select 'conflict'::text,null::jsonb; return;
    end if;
    v_validated:=v_validated||jsonb_build_array(jsonb_build_object(
      'ref',v_ref,'fingerprint',v_row.fingerprint,'occurredAt',v_row.occurred_at));
  end loop;
  if v_prior is not null then
    return query select 'replayed'::text,jsonb_set(v_prior->'result','{replayed}','true'::jsonb); return;
  end if;
  for v_item in select x from jsonb_array_elements(v_validated) x loop
    v_ref:=v_item->>'ref';
    insert into public.notification_feed_reads(organization_id,user_id,ref,fingerprint,event_occurred_at)
    values(p_organization_id,p_actor_user_id,v_ref,v_item->>'fingerprint',
      (v_item->>'occurredAt')::timestamptz)
    on conflict(organization_id,user_id,ref) do update
      set fingerprint=excluded.fingerprint,event_occurred_at=excluded.event_occurred_at,
        read_at=case when notification_feed_reads.fingerprint=excluded.fingerprint
          then notification_feed_reads.read_at else excluded.read_at end
    returning read_at into v_read_at;
    v_result:=v_result||jsonb_build_array(jsonb_build_object('ref',v_ref,
      'fingerprint',v_item->>'fingerprint',
      'readAt',to_char(v_read_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
  end loop;
  v_result:=jsonb_build_object('items',v_result,'replayed',false);
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
  values(p_organization_id,p_actor_user_id,'notification.feed_mark_read','notification_feed',
    p_idempotency_key::text,jsonb_build_object('requestDigest',v_digest,'result',v_result));
  return query select 'updated'::text,v_result;
end $$;

create function public.list_notification_feed_cleanup_organizations_atomic(p_limit integer)
returns table(organization_id uuid)
language sql stable security definer set search_path=public,pg_temp as $$
  select r.organization_id from public.notification_feed_reads r
  where p_limit between 1 and 100 and r.event_occurred_at<clock_timestamp()-interval '180 days'
  group by r.organization_id order by min(r.event_occurred_at),r.organization_id limit p_limit
$$;

create function public.cleanup_notification_feed_reads_atomic(p_organization_id uuid,p_limit integer)
returns table(deleted_count integer)
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_organization_id is null or p_limit is null or p_limit not between 1 and 100 then
    return query select 0; return;
  end if;
  with expired as (
    select r.organization_id,r.user_id,r.ref from public.notification_feed_reads r
    where r.organization_id=p_organization_id
      and r.event_occurred_at<clock_timestamp()-interval '180 days'
    order by r.event_occurred_at,r.ref limit p_limit for update skip locked
  ), deleted as (
    delete from public.notification_feed_reads r using expired e
    where r.organization_id=e.organization_id and r.user_id=e.user_id and r.ref=e.ref
    returning r.ref
  ) select count(*)::integer into deleted_count from deleted;
  return next;
end $$;

insert into public.organization_export_source_tables(
  source_id,table_name,tenant_key_column,record_order_column,table_sort
) values ('notification_delivery','notification_feed_reads','organization_id','created_at',3)
on conflict (source_id,table_name) do nothing;

-- The existing export snapshot materializer locks every registered source.
do $$
declare v_definition text; v_anchor text := E'\n  in share mode;'; v_lock_section text;
begin
  select pg_get_functiondef(to_regprocedure(
    'public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)'))
  into v_definition;
  if v_definition is null or position(v_anchor in v_definition)=0 then
    raise exception 'M12-04 export lock anchor is missing';
  end if;
  v_lock_section:=split_part(split_part(v_definition,'lock table',2),'in share mode;',1);
  if position('public.notification_feed_reads' in v_lock_section)=0 then
    execute replace(v_definition,v_anchor,', public.notification_feed_reads'||v_anchor);
  end if;
end $$;

alter function public.m1204_feed_rows(uuid,uuid) owner to postgres;
alter function public.list_notification_feed_atomic(uuid,uuid,text,text,text,text,integer) owner to postgres;
alter function public.count_notification_feed_unread_atomic(uuid,uuid) owner to postgres;
alter function public.resolve_notification_feed_destination_atomic(uuid,uuid,text) owner to postgres;
alter function public.mark_notification_feed_read_atomic(uuid,uuid,jsonb,uuid) owner to postgres;
alter function public.list_notification_feed_cleanup_organizations_atomic(integer) owner to postgres;
alter function public.cleanup_notification_feed_reads_atomic(uuid,integer) owner to postgres;

revoke all on function
  public.m1204_feed_rows(uuid,uuid),
  public.list_notification_feed_atomic(uuid,uuid,text,text,text,text,integer),
  public.count_notification_feed_unread_atomic(uuid,uuid),
  public.resolve_notification_feed_destination_atomic(uuid,uuid,text),
  public.mark_notification_feed_read_atomic(uuid,uuid,jsonb,uuid),
  public.list_notification_feed_cleanup_organizations_atomic(integer),
  public.cleanup_notification_feed_reads_atomic(uuid,integer)
from public,anon,authenticated;
grant execute on function
  public.m1204_feed_rows(uuid,uuid),
  public.list_notification_feed_atomic(uuid,uuid,text,text,text,text,integer),
  public.count_notification_feed_unread_atomic(uuid,uuid),
  public.resolve_notification_feed_destination_atomic(uuid,uuid,text),
  public.mark_notification_feed_read_atomic(uuid,uuid,jsonb,uuid),
  public.list_notification_feed_cleanup_organizations_atomic(integer),
  public.cleanup_notification_feed_reads_atomic(uuid,integer)
to service_role;
