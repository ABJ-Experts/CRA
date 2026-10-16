-- M14-04 opt-in read scope. Legacy cursor scope and output remain unchanged.
alter table public.notification_feed_reads
  drop constraint notification_feed_reads_ref_check;
alter table public.notification_feed_reads
  add constraint notification_feed_reads_ref_check check (
    ref ~ '^m(2|5|6|8|9|14)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_(event|failure)$'
  );

-- The M12 discovery loop scans organizations before claiming individual rows.
-- Keep its unified-mode sources and add only due report notices in legacy mode.
alter function public.list_due_notification_dispatch_organizations_atomic(uuid,integer)
  rename to m14_04_list_due_notification_organizations_base;
create function public.list_due_notification_dispatch_organizations_atomic(
  p_after_organization_id uuid default null,p_limit integer default 1000
) returns table(organization_id uuid)
language sql stable security definer set search_path=pg_catalog,public as $$
  select due.organization_id from (
    select base.organization_id
    from public.m14_04_list_due_notification_organizations_base(
      p_after_organization_id,p_limit) base
    union
    select d.organization_id
    from public.notification_dispatches d
    join public.organization_settings settings
      on settings.organization_id=d.organization_id
      and settings.notification_delivery_mode='legacy'
    where d.source_type='report_run_recipient'
      and d.status in ('queued','retrying')
      and d.next_attempt_at<=clock_timestamp()
      and (p_after_organization_id is null or d.organization_id>p_after_organization_id)
  ) due
  where p_limit between 1 and 1000
  order by due.organization_id limit p_limit
$$;
revoke all on function public.list_due_notification_dispatch_organizations_atomic(uuid,integer)
  from public,anon,authenticated;
grant execute on function public.list_due_notification_dispatch_organizations_atomic(uuid,integer)
  to service_role;

create function public.m14_04_feed_rows(
  p_organization_id uuid,p_actor_user_id uuid
) returns table(ref text,category text,severity text,occurred_at timestamptz,
  source_created_at timestamptz,title text,summary text,source_state text,
  notice_kind text,url text,fingerprint text)
language sql stable security definer set search_path=pg_catalog,public as $$
  select * from public.m1204_feed_rows(p_organization_id,p_actor_user_id)
  union all
  select 'm14_'||q.id::text||'_event','scheduled_report','info',
    greatest(q.created_at,j.updated_at),q.created_at,
    'Scheduled report ready','Your scheduled report is ready to view.',
    case when public.m14_04_authorize_recipient(p_organization_id,p_actor_user_id,r.id,q.id)
      then 'available' else 'unavailable' end,
    'event',case when public.m14_04_authorize_recipient(p_organization_id,p_actor_user_id,r.id,q.id)
      then '/dashboard/reports/runs/'||r.id::text else null end,
    encode(extensions.digest(q.id::text||':event:'||public.m14_04_digest(q.manifest),'sha256'),'hex')
  from public.report_run_recipients q
  join public.report_runs r on r.organization_id=q.organization_id and r.id=q.run_id
  join public.export_jobs j on j.organization_id=q.organization_id and j.id=q.export_job_id
  join public.organization_settings settings on settings.organization_id=q.organization_id
  where q.organization_id=p_organization_id and q.user_id=p_actor_user_id
    and r.kind='scheduled' and q.generation_state='ready' and q.manifest is not null
    and greatest(q.created_at,j.updated_at)>=settings.notification_feed_started_at
    and greatest(q.created_at,j.updated_at)>=statement_timestamp()-interval '180 days'
    and public.m14_04_authorize_history(p_organization_id,q.id)
  union all
  select 'm14_'||q.id::text||'_failure','scheduled_report','warning',
    coalesce(dispatch.last_attempt_at,dispatch.updated_at),dispatch.created_at,
    'Scheduled report email needs attention','Open your report in CRA.',
    case when public.m14_04_authorize_recipient(p_organization_id,p_actor_user_id,r.id,q.id)
      then 'available' else 'unavailable' end,
    'failure',case when public.m14_04_authorize_recipient(p_organization_id,p_actor_user_id,r.id,q.id)
      then '/dashboard/reports/runs/'||r.id::text else null end,
    encode(extensions.digest(q.id::text||':failure:'||dispatch.version::text||':'||
      coalesce(dispatch.safe_error_code,''),'sha256'),'hex')
  from public.report_run_recipients q
  join public.report_runs r on r.organization_id=q.organization_id and r.id=q.run_id
  join public.notification_dispatches dispatch on dispatch.organization_id=q.organization_id
    and dispatch.source_type='report_run_recipient' and dispatch.source_id=q.id
  join public.organization_settings settings on settings.organization_id=q.organization_id
  where q.organization_id=p_organization_id and q.user_id=p_actor_user_id
    and r.kind='scheduled' and q.generation_state='ready' and q.manifest is not null
    and dispatch.status in ('failed','exhausted')
    and coalesce(dispatch.last_attempt_at,dispatch.updated_at)>=settings.notification_feed_started_at
    and coalesce(dispatch.last_attempt_at,dispatch.updated_at)>=statement_timestamp()-interval '180 days'
    and public.m14_04_authorize_history(p_organization_id,q.id)
$$;

create or replace function public.list_notification_dispatches_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_status text default null,p_category text default null,p_recipient_user_id uuid default null,
  p_cursor text default null,p_limit integer default 50
) returns table(outcome text,result jsonb)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare scope_hash text; cursor_json jsonb; cursor_at timestamptz; cursor_kind text; cursor_id uuid;
  page_rows jsonb; next_cursor text; selected_count integer; last_at timestamptz; last_kind text; last_id uuid;
begin
  if p_organization_id is null or p_actor_user_id is null or p_limit not between 1 and 100
    or (p_status is not null and p_status not in ('queued','attempted','provider_accepted','delivered','failed','exhausted','cancelled'))
    or (p_category is not null and p_category not in ('finding_triage','evidence','supplier_owner','support_period','reporting_deadline'))
    or (p_cursor is not null and (char_length(p_cursor)>512 or p_cursor !~ '^[A-Za-z0-9_-]+$'))
    or not public.m12_03_actor_has_effective_permission(p_organization_id,p_actor_user_id,'can_view_audit') then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  scope_hash:=encode(extensions.digest(jsonb_build_object('org',p_organization_id,'actor',p_actor_user_id,
    'status',p_status,'category',p_category,'recipient',p_recipient_user_id)::text,'sha256'),'hex');
  if p_cursor is not null then
    begin
      cursor_json:=convert_from(decode(translate(p_cursor,'-_','+/')||repeat('=',(4-char_length(p_cursor)%4)%4),'base64'),'utf8')::jsonb;
      if jsonb_typeof(cursor_json)<>'object' or cursor_json->>'scope' is distinct from scope_hash
        or cursor_json->>'kind' not in ('optional','m2','m6') then
        return query select 'invalid_request'::text,null::jsonb; return;
      end if;
      cursor_at:=(cursor_json->>'at')::timestamptz;
      cursor_kind:=cursor_json->>'kind';
      cursor_id:=(cursor_json->>'id')::uuid;
      if cursor_at is null or cursor_id is null then
        return query select 'invalid_request'::text,null::jsonb; return;
      end if;
    exception when others then
      return query select 'invalid_request'::text,null::jsonb; return;
    end;
  end if;
  with candidates as (
    select d.created_at as at,'optional'::text as kind,d.id
    from public.notification_dispatches d
    where d.organization_id=p_organization_id and (p_category is null or d.category=p_category)
      and (p_status is null or case when d.status in ('leased','retrying') then 'attempted'
        when d.status='suppressed' then 'cancelled' when d.status='digest_pending' then 'queued'
        else d.status end=p_status)
      and d.source_type<>'report_run_recipient'
      and (p_recipient_user_id is null or p_recipient_user_id in (d.original_recipient_user_id,d.effective_recipient_user_id))
      and (cursor_at is null or (d.created_at,'optional'::text,d.id)<(cursor_at,cursor_kind,cursor_id))
    union all
    select e.occurred_at,'m2',e.id
    from public.product_regulatory_outbox_events e
    join public.products p on p.organization_id=e.organization_id and p.id=e.product_id
    where e.organization_id=p_organization_id and e.event_type='support_period.alert'
      and (p_category is null or p_category='support_period')
      and (p_status is null or case e.delivery_state
        when 'pending' then 'queued' when 'scheduled' then 'queued'
        when 'leased' then 'attempted' when 'retrying' then
          case when e.last_error_code is null then 'queued' else 'failed' end
        when 'recipient_unavailable' then 'failed' when 'dead_letter' then 'exhausted'
        when 'delivered' then 'provider_accepted' when 'provider_accepted' then 'provider_accepted'
        else 'cancelled' end=p_status)
      and coalesce(e.original_recipient_user_id,p.responsible_owner_id,e.delivered_to_user_id) is not null
      and (p_recipient_user_id is null or p_recipient_user_id in
        (e.original_recipient_user_id,p.responsible_owner_id,e.delivered_to_user_id))
      and (cursor_at is null or (e.occurred_at,'m2'::text,e.id)<(cursor_at,cursor_kind,cursor_id))
    union all
    select d.created_at,'m6',d.id
    from public.reporting_deadline_alert_deliveries d
    where d.organization_id=p_organization_id
      and (p_category is null or p_category='reporting_deadline')
      and (p_status is null or case d.delivery_state
        when 'queued' then 'queued' when 'leased' then 'attempted'
        when 'retrying' then 'failed' when 'dead_letter' then 'exhausted'
        when 'delivered' then 'provider_accepted' else d.delivery_state end=p_status)
      and (p_recipient_user_id is null or p_recipient_user_id in
        (d.original_recipient_user_id,d.prepared_recipient_user_id)
        or (d.delivery_state in ('provider_accepted','delivered') and p_recipient_user_id=d.recipient_user_id))
      and (cursor_at is null or (d.created_at,'m6'::text,d.id)<(cursor_at,cursor_kind,cursor_id))
  ), filtered as (
    select * from candidates
    order by at desc,kind desc,id desc limit p_limit+1
  ), page as (
    select * from filtered order by at desc,kind desc,id desc limit p_limit
  ), page_json as (
    select page.*,
      case page.kind
        when 'optional' then (
          select case when d.status='digest_pending' then
            jsonb_set(public.m12_03_dispatch_row_json(d),'{status}','"queued"'::jsonb)
            else public.m12_03_dispatch_row_json(d) end
          from public.notification_dispatches d
          where d.organization_id=p_organization_id and d.id=page.id)
        when 'm2' then public.m12_03_critical_delivery_row_json('support_period',p_organization_id,page.id)
        else public.m12_03_critical_delivery_row_json('reporting_deadline',p_organization_id,page.id)
      end as item
    from page
  )
  select coalesce(jsonb_agg(page_json.item order by page_json.at desc,page_json.kind desc,page_json.id desc),'[]'::jsonb),
    (select count(*) from filtered),
    (select at from page order by at,kind,id limit 1),
    (select kind from page order by at,kind,id limit 1),
    (select id from page order by at,kind,id limit 1)
  into page_rows,selected_count,last_at,last_kind,last_id from page_json;
  if selected_count>p_limit then
    next_cursor:=translate(rtrim(replace(replace(encode(convert_to(jsonb_build_object(
      'at',last_at,'kind',last_kind,'id',last_id,'scope',scope_hash)::text,'utf8'),'base64'),chr(10),''),chr(13),''),'='),'+/','-_');
  end if;
  return query select 'found'::text,jsonb_build_object('rows',page_rows,'nextCursor',next_cursor);
end $$;



create or replace function public.m14_04_list_notification_dispatches_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_status text default null,p_category text default null,p_recipient_user_id uuid default null,
  p_cursor text default null,p_limit integer default 50,
  p_include_scheduled_reports boolean default false
) returns table(outcome text,result jsonb)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare scope_hash text; cursor_json jsonb; cursor_at timestamptz; cursor_kind text; cursor_id uuid;
  page_rows jsonb; next_cursor text; selected_count integer; last_at timestamptz; last_kind text; last_id uuid;
begin
  if p_organization_id is null or p_actor_user_id is null or p_limit not between 1 and 100
    or (p_status is not null and p_status not in ('queued','attempted','provider_accepted','delivered','failed','exhausted','cancelled'))
    or (p_category is not null and p_category not in ('finding_triage','evidence','supplier_owner','support_period','reporting_deadline','scheduled_report'))
    or (p_category='scheduled_report' and not p_include_scheduled_reports)
    or (p_cursor is not null and (char_length(p_cursor)>512 or p_cursor !~ '^[A-Za-z0-9_-]+$'))
    or not public.m12_03_actor_has_effective_permission(p_organization_id,p_actor_user_id,'can_view_audit') then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  scope_hash:=encode(extensions.digest(jsonb_build_object('org',p_organization_id,'actor',p_actor_user_id,
    'status',p_status,'category',p_category,'recipient',p_recipient_user_id,'includeScheduledReports',p_include_scheduled_reports)::text,'sha256'),'hex');
  if p_cursor is not null then
    begin
      cursor_json:=convert_from(decode(translate(p_cursor,'-_','+/')||repeat('=',(4-char_length(p_cursor)%4)%4),'base64'),'utf8')::jsonb;
      if jsonb_typeof(cursor_json)<>'object' or cursor_json->>'scope' is distinct from scope_hash
        or cursor_json->>'kind' not in ('optional','m2','m6') then
        return query select 'invalid_request'::text,null::jsonb; return;
      end if;
      cursor_at:=(cursor_json->>'at')::timestamptz;
      cursor_kind:=cursor_json->>'kind';
      cursor_id:=(cursor_json->>'id')::uuid;
      if cursor_at is null or cursor_id is null then
        return query select 'invalid_request'::text,null::jsonb; return;
      end if;
    exception when others then
      return query select 'invalid_request'::text,null::jsonb; return;
    end;
  end if;
  with candidates as (
    select d.created_at as at,'optional'::text as kind,d.id
    from public.notification_dispatches d
    where d.organization_id=p_organization_id and (p_category is null or d.category=p_category)
      and (p_status is null or case when d.status in ('leased','retrying') then 'attempted'
        when d.status='suppressed' then 'cancelled' when d.status='digest_pending' then 'queued'
        else d.status end=p_status)
      and (p_include_scheduled_reports or d.source_type<>'report_run_recipient')
      and (p_recipient_user_id is null or p_recipient_user_id in (d.original_recipient_user_id,d.effective_recipient_user_id))
      and (cursor_at is null or (d.created_at,'optional'::text,d.id)<(cursor_at,cursor_kind,cursor_id))
    union all
    select e.occurred_at,'m2',e.id
    from public.product_regulatory_outbox_events e
    join public.products p on p.organization_id=e.organization_id and p.id=e.product_id
    where e.organization_id=p_organization_id and e.event_type='support_period.alert'
      and (p_category is null or p_category='support_period')
      and (p_status is null or case e.delivery_state
        when 'pending' then 'queued' when 'scheduled' then 'queued'
        when 'leased' then 'attempted' when 'retrying' then
          case when e.last_error_code is null then 'queued' else 'failed' end
        when 'recipient_unavailable' then 'failed' when 'dead_letter' then 'exhausted'
        when 'delivered' then 'provider_accepted' when 'provider_accepted' then 'provider_accepted'
        else 'cancelled' end=p_status)
      and coalesce(e.original_recipient_user_id,p.responsible_owner_id,e.delivered_to_user_id) is not null
      and (p_recipient_user_id is null or p_recipient_user_id in
        (e.original_recipient_user_id,p.responsible_owner_id,e.delivered_to_user_id))
      and (cursor_at is null or (e.occurred_at,'m2'::text,e.id)<(cursor_at,cursor_kind,cursor_id))
    union all
    select d.created_at,'m6',d.id
    from public.reporting_deadline_alert_deliveries d
    where d.organization_id=p_organization_id
      and (p_category is null or p_category='reporting_deadline')
      and (p_status is null or case d.delivery_state
        when 'queued' then 'queued' when 'leased' then 'attempted'
        when 'retrying' then 'failed' when 'dead_letter' then 'exhausted'
        when 'delivered' then 'provider_accepted' else d.delivery_state end=p_status)
      and (p_recipient_user_id is null or p_recipient_user_id in
        (d.original_recipient_user_id,d.prepared_recipient_user_id)
        or (d.delivery_state in ('provider_accepted','delivered') and p_recipient_user_id=d.recipient_user_id))
      and (cursor_at is null or (d.created_at,'m6'::text,d.id)<(cursor_at,cursor_kind,cursor_id))
  ), filtered as (
    select * from candidates
    order by at desc,kind desc,id desc limit p_limit+1
  ), page as (
    select * from filtered order by at desc,kind desc,id desc limit p_limit
  ), page_json as (
    select page.*,
      case page.kind
        when 'optional' then (
          select case when d.status='digest_pending' then
            jsonb_set(public.m12_03_dispatch_row_json(d),'{status}','"queued"'::jsonb)
            else public.m12_03_dispatch_row_json(d) end
          from public.notification_dispatches d
          where d.organization_id=p_organization_id and d.id=page.id)
        when 'm2' then public.m12_03_critical_delivery_row_json('support_period',p_organization_id,page.id)
        else public.m12_03_critical_delivery_row_json('reporting_deadline',p_organization_id,page.id)
      end as item
    from page
  )
  select coalesce(jsonb_agg(page_json.item order by page_json.at desc,page_json.kind desc,page_json.id desc),'[]'::jsonb),
    (select count(*) from filtered),
    (select at from page order by at,kind,id limit 1),
    (select kind from page order by at,kind,id limit 1),
    (select id from page order by at,kind,id limit 1)
  into page_rows,selected_count,last_at,last_kind,last_id from page_json;
  if selected_count>p_limit then
    next_cursor:=translate(rtrim(replace(replace(encode(convert_to(jsonb_build_object(
      'at',last_at,'kind',last_kind,'id',last_id,'scope',scope_hash)::text,'utf8'),'base64'),chr(10),''),chr(13),''),'='),'+/','-_');
  end if;
  return query select 'found'::text,jsonb_build_object('rows',page_rows,'nextCursor',next_cursor);
end $$;

create function public.m14_04_list_notification_feed_atomic(
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
    or (p_category is not null and p_category not in ('finding_triage','evidence','supplier_owner','support_period','reporting_deadline','scheduled_report'))
    or (p_severity is not null and p_severity not in ('info','warning','high','critical'))
    or p_read is null or p_read not in ('all','read','unread')
    or (p_cursor is not null and (char_length(p_cursor)>512 or p_cursor !~ '^[A-Za-z0-9_-]+$')) then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  v_scope:=encode(extensions.digest(jsonb_build_object('org',p_organization_id,'actor',p_actor_user_id,
    'category',p_category,'severity',p_severity,'read',p_read,'includeScheduledReports',true)::text,'sha256'),'hex');
  if p_cursor is not null then
    begin
      v_cursor:=convert_from(decode(translate(p_cursor,'-_','+/')||repeat('=',(4-char_length(p_cursor)%4)%4),'base64'),'utf8')::jsonb;
      if jsonb_typeof(v_cursor)<>'object' or v_cursor->>'scope' is distinct from v_scope then
        return query select 'invalid_request'::text,null::jsonb; return;
      end if;
      v_snapshot:=(v_cursor->>'snapshot')::timestamptz;
      v_at:=(v_cursor->>'at')::timestamptz;
      v_ref:=v_cursor->>'ref';
      if v_snapshot is null or v_at is null or v_ref !~ '^m(2|5|6|8|9|14)_[0-9a-f-]{36}_(event|failure)$'
        or v_snapshot>statement_timestamp()+interval '1 second' then
        return query select 'invalid_request'::text,null::jsonb; return;
      end if;
    exception when others then
      return query select 'invalid_request'::text,null::jsonb; return;
    end;
  end if;
  with candidates as (
    select f.*,(r.fingerprint=f.fingerprint) as is_read
    from public.m14_04_feed_rows(p_organization_id,p_actor_user_id) f
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

create or replace function public.resolve_notification_feed_destination_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_ref text
) returns table(outcome text,result jsonb)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_row record;
begin
  if not public.m1201_active_member(p_organization_id,p_actor_user_id) then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  if p_ref is null or p_ref !~ '^m(2|5|6|8|9|14)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_(event|failure)$' then
    return query select 'not_found'::text,null::jsonb; return;
  end if;
  select f.* into v_row from public.m14_04_feed_rows(p_organization_id,p_actor_user_id) f
  where f.ref=p_ref;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  return query select 'found'::text,jsonb_build_object(
    'state',v_row.source_state,'url',case when v_row.source_state='available' then v_row.url else null end);
end $$;

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
      or coalesce(x->>'ref','') !~ '^m(2|5|6|8|9|14)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_(event|failure)$'
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
    select f.* into v_row from public.m14_04_feed_rows(p_organization_id,p_actor_user_id) f
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

create function public.m14_04_count_notification_feed_unread_atomic(
  p_organization_id uuid,p_actor_user_id uuid
) returns table(outcome text,result jsonb)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_count integer;
begin
  if not public.m1201_active_member(p_organization_id,p_actor_user_id) then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  select count(*)::integer into v_count
  from public.m14_04_feed_rows(p_organization_id,p_actor_user_id) f
  left join public.notification_feed_reads reads
    on reads.organization_id=p_organization_id and reads.user_id=p_actor_user_id
      and reads.ref=f.ref
  where reads.fingerprint is distinct from f.fingerprint;
  return query select 'found'::text,jsonb_build_object('count',v_count);
end $$;

do $$ declare sig text; begin
  foreach sig in array array[
    'm14_04_feed_rows(uuid,uuid)',
    'm14_04_list_notification_dispatches_atomic(uuid,uuid,text,text,uuid,text,integer,boolean)',
    'm14_04_list_notification_feed_atomic(uuid,uuid,text,text,text,text,integer)',
    'm14_04_count_notification_feed_unread_atomic(uuid,uuid)'
  ] loop
    execute format('revoke all on function public.%s from public,anon,authenticated',sig);
    execute format('grant execute on function public.%s to service_role',sig);
  end loop;
end $$;
