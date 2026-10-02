-- Surface unified optional dispatch failures from their source-owned event.
create or replace function public.m1204_feed_rows(p_organization_id uuid,p_actor_user_id uuid)
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
   left join public.notification_dispatches dispatch
     on dispatch.organization_id=e.organization_id and dispatch.source_type='finding_triage_alert'
       and dispatch.source_id=e.id and dispatch.original_recipient_user_id=context.recipient_id
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


-- Invalid items and stale replays may never acknowledge a changed event.
create or replace function public.mark_notification_feed_read_atomic(
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
      or coalesce(x->>'ref','') !~ '^m(2|5|6|8|9)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_(event|failure)$'
      or coalesce(x->>'expectedFingerprint','') !~ '^[0-9a-f]{64}$')
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
    if v_row.fingerprint<>v_fingerprint then
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

