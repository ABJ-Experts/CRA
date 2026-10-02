-- M12-03: source-owned critical deliveries share the existing admin operations.
-- SMTP acceptance remains provider_accepted, never proof of inbox delivery.

alter table public.product_regulatory_outbox_events
  add column if not exists original_recipient_user_id uuid references public.users(id) on delete restrict,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists updated_at timestamptz not null default clock_timestamp();
alter table public.product_regulatory_outbox_events
  drop constraint if exists product_regulatory_outbox_events_delivery_state_check,
  add constraint product_regulatory_outbox_events_delivery_state_check
    check (delivery_state in ('pending','queued','scheduled','leased','delivered','provider_accepted',
      'retrying','dead_letter','obsolete','recipient_unavailable'));

create index product_support_alert_operations_idx
  on public.product_regulatory_outbox_events(organization_id,occurred_at desc,id desc)
  where event_type='support_period.alert';
create index reporting_deadline_delivery_operations_idx
  on public.reporting_deadline_alert_deliveries(organization_id,created_at desc,id desc);
create index notification_dispatch_operations_idx
  on public.notification_dispatches(organization_id,created_at desc,id desc);

drop trigger if exists set_product_regulatory_outbox_event_updated_at on public.product_regulatory_outbox_events;
create trigger set_product_regulatory_outbox_event_updated_at
  before update on public.product_regulatory_outbox_events
  for each row execute function public.set_updated_at();

create function public.m12_03_track_product_support_alert_attempt()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.event_type='support_period.alert' and new.delivery_state='leased'
    and (old.delivery_state<>'leased' or old.checkpoint_version<>new.checkpoint_version) then
    new.last_attempt_at:=clock_timestamp();
  end if;
  return new;
end $$;
create trigger track_product_support_alert_attempt
  before update on public.product_regulatory_outbox_events
  for each row execute function public.m12_03_track_product_support_alert_attempt();

create or replace function public.get_product_support_alert_product_owner_recipient(
  p_organization_id uuid,p_product_id uuid
) returns table(user_id uuid,email text)
language sql stable security definer set search_path=public,pg_temp as $$
  select u.id,u.email from public.products p
  join public.organization_members m on m.organization_id=p.organization_id and m.user_id=p.responsible_owner_id
  join public.users u on u.id=m.user_id and u.is_active
  where p.organization_id=p_organization_id and p.id=p_product_id and p.archived_at is null
    and public.m12_03_user_can_receive_critical(p_organization_id,u.id,p_product_id,'support_period')
  limit 1
$$;

create or replace function public.get_product_support_alert_owner_or_admin_recipient(
  p_organization_id uuid
) returns table(user_id uuid,email text)
language sql stable security definer set search_path=public,pg_temp as $$
  select u.id,u.email from public.organization_members m
  join public.users u on u.id=m.user_id and u.is_active
  where m.organization_id=p_organization_id and m.role in ('owner','admin')
    and public.m12_03_actor_has_effective_permission(p_organization_id,u.id,'can_view_products')
  order by case m.role when 'owner' then 0 else 1 end,u.id limit 1
$$;

create or replace function public.claim_product_support_alert_atomic(
  p_organization_id uuid,p_lease_owner uuid,p_lease_seconds integer
) returns table(outcome text,delivery_id uuid,lease_owner uuid,checkpoint_version integer,event jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare alert_row public.product_regulatory_outbox_events%rowtype;
  product_row public.products%rowtype; period_row public.product_support_periods%rowtype;
begin
  if p_organization_id is null or p_lease_owner is null or p_lease_seconds not between 1 and 3600 then
    return query select 'invalid_state'::text,null::uuid,null::uuid,null::integer,null::jsonb; return;
  end if;
  -- SMTP may have accepted an expired lease. Require operator review before another send.
  with expired as (
    select id from public.product_regulatory_outbox_events
    where organization_id=p_organization_id and event_type='support_period.alert'
      and delivery_state='leased' and lease_expires_at<=clock_timestamp()
    order by lease_expires_at,id limit 1000 for update skip locked
  ), changed as (
    update public.product_regulatory_outbox_events e
    set delivery_state='dead_letter',missed=true,lease_owner=null,lease_expires_at=null,
      last_error_code='delivery_uncertain',last_delivery_error=null
    from expired where e.organization_id=p_organization_id and e.id=expired.id
    returning e.id,e.product_id
  )
  insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
  select p_organization_id,'product.support_alert_delivery_uncertain','product_regulatory_outbox_event',
    changed.id::text,jsonb_build_object('productId',changed.product_id,'safeErrorCode','delivery_uncertain')
  from changed;

  select * into alert_row from public.product_regulatory_outbox_events e
  where e.organization_id=p_organization_id and e.event_type='support_period.alert'
    and e.delivery_state in ('scheduled','retrying','recipient_unavailable')
    and e.due_at<=clock_timestamp()
  order by e.due_at,e.id for update skip locked limit 1;
  if not found then
    return query select 'none_available'::text,null::uuid,null::uuid,null::integer,null::jsonb; return;
  end if;
  update public.product_regulatory_outbox_events e
  set delivery_state='leased',lease_owner=p_lease_owner,
    lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),
    checkpoint_version=e.checkpoint_version+1,delivery_attempts=e.delivery_attempts+1,
    last_delivery_error=null,last_error_code=null
  where e.organization_id=p_organization_id and e.id=alert_row.id returning * into alert_row;
  select * into product_row from public.products where organization_id=p_organization_id and id=alert_row.product_id;
  select * into period_row from public.product_support_periods where organization_id=p_organization_id and id=alert_row.support_period_id;
  return query select 'claimed'::text,alert_row.id,alert_row.lease_owner,alert_row.checkpoint_version,
    jsonb_build_object('organizationId',p_organization_id,'productId',alert_row.product_id,
      'releaseId',alert_row.release_id,'eventType','support_period.alert','eventKey',alert_row.event_key,
      'supportPeriodId',alert_row.support_period_id,'supportPeriodRevision',alert_row.support_period_revision,
      'thresholdDays',alert_row.alert_threshold_days,'supportEndsAt',public.m2_utc_z(period_row.support_ends_at),
      'dueAt',public.m2_utc_z(alert_row.due_at),
      'deliveryState',case when alert_row.missed then 'missed_catch_up' else 'current' end,
      'productName',product_row.name);
end $$;

create or replace function public.complete_product_support_alert_delivery_atomic(
  p_organization_id uuid,p_delivery_id uuid,p_lease_owner uuid,
  p_expected_checkpoint_version integer,p_recipient_user_id uuid
) returns table(outcome text)
language plpgsql security definer set search_path=public,pg_temp as $$
declare alert_row public.product_regulatory_outbox_events%rowtype;
begin
  update public.product_regulatory_outbox_events
  set delivery_state='provider_accepted',delivered_at=clock_timestamp(),
    delivered_to_user_id=p_recipient_user_id,lease_owner=null,lease_expires_at=null,
    last_delivery_error=null,last_error_code=null
  where organization_id=p_organization_id and id=p_delivery_id and event_type='support_period.alert'
    and delivery_state='leased' and lease_owner=p_lease_owner
    and checkpoint_version=p_expected_checkpoint_version returning * into alert_row;
  if not found then return query select 'conflict'::text; return; end if;
  insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
  values(p_organization_id,'product.support_alert_provider_accepted','product_regulatory_outbox_event',
    alert_row.id::text,jsonb_build_object('attempts',alert_row.delivery_attempts,
      'checkpointVersion',alert_row.checkpoint_version));
  return query select 'completed'::text;
end $$;

create or replace view public.product_retention_alert_operations
with (security_invoker=true) as
  select p.organization_id,p.id as product_id,p.retention_status,
    count(e.id) filter (where e.event_type='support_period.alert' and e.delivery_state='dead_letter') as dead_letter_count,
    count(e.id) filter (where e.event_type='support_period.alert' and e.delivery_state in ('retrying','recipient_unavailable')) as retrying_count,
    count(e.id) filter (where e.event_type='support_period.alert' and e.delivery_state in ('delivered','provider_accepted') and e.missed) as missed_delivery_count,
    max(clock_timestamp()-e.due_at) filter (where e.event_type='support_period.alert' and e.delivery_state in ('scheduled','retrying','recipient_unavailable')) as current_alert_lag
  from public.products p left join public.product_regulatory_outbox_events e
    on e.organization_id=p.organization_id and e.product_id=p.id
  group by p.organization_id,p.id,p.retention_status;

create function public.pin_product_support_alert_original_recipient_atomic(
  p_organization_id uuid,p_delivery_id uuid,p_lease_owner uuid,
  p_expected_checkpoint_version integer,p_original_user_id uuid
) returns table(outcome text)
language plpgsql security definer set search_path=public,pg_temp as $$
declare alert_row public.product_regulatory_outbox_events%rowtype;
begin
  if p_organization_id is null or p_delivery_id is null or p_lease_owner is null
    or p_expected_checkpoint_version is null or p_expected_checkpoint_version<1 or p_original_user_id is null then
    return query select 'invalid'::text; return;
  end if;
  select * into alert_row from public.product_regulatory_outbox_events e
  where e.organization_id=p_organization_id and e.id=p_delivery_id and e.event_type='support_period.alert'
    and e.delivery_state='leased' and e.lease_owner=p_lease_owner
    and e.checkpoint_version=p_expected_checkpoint_version
  for update;
  if not found then return query select 'conflict'::text; return; end if;
  if not public.m12_03_user_can_receive_critical(p_organization_id,p_original_user_id,alert_row.product_id,'support_period') then
    return query select 'invalid'::text; return;
  end if;
  if not exists (
    select 1 from public.products p where p.organization_id=p_organization_id and p.id=alert_row.product_id
      and (p.responsible_owner_id=p_original_user_id
        or (not public.m12_03_user_can_receive_critical(p_organization_id,p.responsible_owner_id,p.id,'support_period')
          and exists(select 1 from public.organization_members m where m.organization_id=p_organization_id
            and m.user_id=p_original_user_id and m.role in ('owner','admin'))))
  ) then return query select 'invalid'::text; return; end if;
  if alert_row.original_recipient_user_id is not null and alert_row.original_recipient_user_id<>p_original_user_id then
    return query select 'conflict'::text; return;
  end if;
  update public.product_regulatory_outbox_events
  set original_recipient_user_id=p_original_user_id
  where organization_id=p_organization_id and id=p_delivery_id and original_recipient_user_id is null;
  return query select 'pinned'::text;
end $$;

create function public.m12_03_critical_delivery_row_json(p_category text,p_organization_id uuid,p_delivery_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare output jsonb;
begin
  if p_category='support_period' then
    select jsonb_build_object(
      'deliveryRef','m2_'||e.id::text,'category','support_period',
      'status',case e.delivery_state
        when 'pending' then 'queued' when 'scheduled' then 'queued'
        when 'leased' then 'attempted' when 'retrying' then
          case when e.last_error_code is null then 'queued' else 'failed' end
        when 'recipient_unavailable' then 'failed' when 'dead_letter' then 'exhausted'
        when 'delivered' then 'provider_accepted' when 'provider_accepted' then 'provider_accepted'
        else 'cancelled' end,
      'sourceType','support_period','sourceId',e.id,
      'originalRecipientUserId',coalesce(e.original_recipient_user_id,p.responsible_owner_id,e.delivered_to_user_id),
      'effectiveRecipientUserId',case when e.delivery_state in ('delivered','provider_accepted')
        then e.delivered_to_user_id else null end,
      'attemptCount',e.delivery_attempts,
      'lastAttemptAt',case when e.last_attempt_at is null then null else public.m2_utc_z(e.last_attempt_at) end,
      'nextAttemptAt',case when e.delivery_state in ('scheduled','retrying','recipient_unavailable','leased') then public.m2_utc_z(e.due_at) else null end,
      'safeErrorCode',case when e.last_error_code ~ '^[a-z][a-z0-9_]{0,63}$' then e.last_error_code else null end,
      'createdAt',public.m2_utc_z(e.occurred_at),'updatedAt',public.m2_utc_z(e.updated_at),
      'version',greatest(e.checkpoint_version,1)) into output
    from public.product_regulatory_outbox_events e
    join public.products p on p.organization_id=e.organization_id and p.id=e.product_id
    where e.organization_id=p_organization_id and e.id=p_delivery_id and e.event_type='support_period.alert';
  elsif p_category='reporting_deadline' then
    select jsonb_build_object(
      'deliveryRef','m6_'||d.id::text,'category','reporting_deadline',
      'status',case d.delivery_state
        when 'queued' then 'queued' when 'leased' then 'attempted'
        when 'retrying' then 'failed' when 'dead_letter' then 'exhausted'
        when 'delivered' then 'provider_accepted' else d.delivery_state end,
      'sourceType','reporting_deadline','sourceId',d.alert_id,
      'originalRecipientUserId',d.original_recipient_user_id,
      'effectiveRecipientUserId',case when d.delivery_state in ('provider_accepted','delivered')
        then coalesce(d.prepared_recipient_user_id,d.recipient_user_id) else d.prepared_recipient_user_id end,
      'attemptCount',d.delivery_attempts,
      'lastAttemptAt',case when d.last_attempt_at is null then null else public.m2_utc_z(d.last_attempt_at) end,
      'nextAttemptAt',case when d.delivery_state in ('queued','retrying','leased') then public.m2_utc_z(d.due_at) else null end,
      'safeErrorCode',case when d.last_error_code ~ '^[a-z][a-z0-9_]{0,63}$' then d.last_error_code else null end,
      'createdAt',public.m2_utc_z(d.created_at),'updatedAt',public.m2_utc_z(d.updated_at),
      'version',d.checkpoint_version) into output
    from public.reporting_deadline_alert_deliveries d
    where d.organization_id=p_organization_id and d.id=p_delivery_id;
  end if;
  return output;
end $$;

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

alter function public.retry_notification_dispatch_atomic(uuid,uuid,text,integer,uuid)
  rename to m12_03_retry_notification_dispatch_optional;

create function public.retry_notification_dispatch_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_delivery_ref text,p_expected_version integer,p_idempotency_key uuid
) returns table(outcome text,result jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare source_kind text; delivery_id uuid; prior public.audit_logs%rowtype; digest text; response jsonb;
  m2 public.product_regulatory_outbox_events%rowtype; m6 public.reporting_deadline_alert_deliveries%rowtype;
  resolved record; original_user_id uuid;
begin
  if p_delivery_ref !~ '^m[26]_' then
    return query select * from public.m12_03_retry_notification_dispatch_optional(
      p_organization_id,p_actor_user_id,p_delivery_ref,p_expected_version,p_idempotency_key);
    return;
  end if;
  if p_organization_id is null or p_actor_user_id is null or p_expected_version is null or p_expected_version<1
    or p_idempotency_key is null or char_length(p_delivery_ref)>512 or p_delivery_ref !~ '^[A-Za-z0-9_-]+$'
    or not public.m12_03_actor_has_effective_permission(p_organization_id,p_actor_user_id,'can_edit_organization') then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  begin
    source_kind:=split_part(p_delivery_ref,'_',1);
    delivery_id:=substring(p_delivery_ref from 4)::uuid;
  exception when others then
    return query select 'invalid_request'::text,null::jsonb; return;
  end;
  digest:=encode(extensions.digest(jsonb_build_object('deliveryRef',p_delivery_ref,'expectedVersion',p_expected_version)::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(concat_ws('|',p_organization_id,p_actor_user_id,p_idempotency_key),0));
  select * into prior from public.audit_logs a
  where a.organization_id=p_organization_id and a.user_id=p_actor_user_id
    and a.action='notification.critical_delivery_retry_requested'
    and a.changes->>'idempotencyKey'=p_idempotency_key::text limit 1;
  if found then
    if prior.changes->>'payloadDigest'<>digest then return query select 'idempotency_conflict'::text,null::jsonb; return; end if;
    return query select 'replayed'::text,prior.changes->'result'; return;
  end if;
  if source_kind='m2' then
    select * into m2 from public.product_regulatory_outbox_events e
    where e.organization_id=p_organization_id and e.id=delivery_id and e.event_type='support_period.alert' for update;
    if not found then return query select 'not_found'::text,null::jsonb; return; end if;
    if greatest(m2.checkpoint_version,1)<>p_expected_version then return query select 'conflict'::text,null::jsonb; return; end if;
    if m2.delivery_state<>'dead_letter' then return query select 'invalid_state'::text,null::jsonb; return; end if;
    if not public.m12_03_actor_has_effective_permission(p_organization_id,p_actor_user_id,'can_view_products')
      or not exists(select 1 from public.products p join public.product_support_periods s
        on s.organization_id=p.organization_id and s.product_id=p.id and s.id=m2.support_period_id
        where p.organization_id=p_organization_id and p.id=m2.product_id and p.archived_at is null
          and s.superseded_at is null and s.scope_revision=m2.support_period_revision) then
      return query select 'forbidden'::text,null::jsonb; return;
    end if;
    -- An explicit, versioned admin retry reconciles ownership changes. The
    -- previous accountable user stays in the audit fact below.
    select user_id into original_user_id from public.get_product_support_alert_product_owner_recipient(
      p_organization_id,m2.product_id);
    if original_user_id is null then
      select user_id into original_user_id from public.get_product_support_alert_owner_or_admin_recipient(
        p_organization_id);
    end if;
    if original_user_id is null then return query select 'invalid_state'::text,null::jsonb; return; end if;
    select * into resolved from public.resolve_critical_notification_recipient(
      p_organization_id,original_user_id,m2.product_id,'support_period');
    if resolved.outcome<>'resolved' then return query select 'invalid_state'::text,null::jsonb; return; end if;
    update public.product_regulatory_outbox_events
    set delivery_state='retrying',due_at=clock_timestamp(),last_error_code=null,last_delivery_error=null,
      original_recipient_user_id=original_user_id,
      checkpoint_version=greatest(checkpoint_version,1)+1
    where organization_id=p_organization_id and id=delivery_id;
    response:=jsonb_build_object('delivery',public.m12_03_critical_delivery_row_json('support_period',p_organization_id,delivery_id));
  else
    select * into m6 from public.reporting_deadline_alert_deliveries d
    where d.organization_id=p_organization_id and d.id=delivery_id for update;
    if not found then return query select 'not_found'::text,null::jsonb; return; end if;
    if m6.checkpoint_version<>p_expected_version then return query select 'conflict'::text,null::jsonb; return; end if;
    if m6.delivery_state<>'dead_letter' then return query select 'invalid_state'::text,null::jsonb; return; end if;
    if not public.m12_03_actor_has_effective_permission(p_organization_id,p_actor_user_id,'can_view_findings')
      or not exists(select 1 from public.reporting_deadline_alerts a
        join public.reporting_obligation_stages s on s.organization_id=a.organization_id and s.id=a.stage_id
        join public.reporting_obligations o on o.organization_id=a.organization_id and o.id=a.obligation_id
        where a.organization_id=p_organization_id and a.id=m6.alert_id and o.status='active'
          and s.state in ('running','overdue') and s.deadline_revision=a.deadline_revision) then
      return query select 'forbidden'::text,null::jsonb; return;
    end if;
    select * into resolved from public.resolve_critical_notification_recipient(
      p_organization_id,m6.original_recipient_user_id,null,'reporting_deadline');
    if resolved.outcome<>'resolved' then return query select 'invalid_state'::text,null::jsonb; return; end if;
    update public.reporting_deadline_alert_deliveries
    set delivery_state='queued',prepared_recipient_user_id=null,
      due_at=clock_timestamp(),last_error_code=null,checkpoint_version=checkpoint_version+1
    where organization_id=p_organization_id and id=delivery_id;
    response:=jsonb_build_object('delivery',public.m12_03_critical_delivery_row_json('reporting_deadline',p_organization_id,delivery_id));
  end if;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
  values(p_organization_id,p_actor_user_id,'notification.critical_delivery_retry_requested',
    'notification_delivery',delivery_id::text,
    jsonb_build_object('idempotencyKey',p_idempotency_key,'payloadDigest',digest,'result',response,
      'source',source_kind,'previousOriginalRecipientUserId',case when source_kind='m2'
        then m2.original_recipient_user_id else m6.original_recipient_user_id end));
  return query select 'queued'::text,response;
end $$;

alter function public.pin_product_support_alert_original_recipient_atomic(uuid,uuid,uuid,integer,uuid) owner to postgres;
alter function public.m12_03_track_product_support_alert_attempt() owner to postgres;
alter function public.get_product_support_alert_product_owner_recipient(uuid,uuid) owner to postgres;
alter function public.get_product_support_alert_owner_or_admin_recipient(uuid) owner to postgres;
alter function public.claim_product_support_alert_atomic(uuid,uuid,integer) owner to postgres;
alter function public.complete_product_support_alert_delivery_atomic(uuid,uuid,uuid,integer,uuid) owner to postgres;
alter function public.m12_03_critical_delivery_row_json(text,uuid,uuid) owner to postgres;
alter function public.list_notification_dispatches_atomic(uuid,uuid,text,text,uuid,text,integer) owner to postgres;
alter function public.m12_03_retry_notification_dispatch_optional(uuid,uuid,text,integer,uuid) owner to postgres;
alter function public.retry_notification_dispatch_atomic(uuid,uuid,text,integer,uuid) owner to postgres;
revoke all on function
  public.pin_product_support_alert_original_recipient_atomic(uuid,uuid,uuid,integer,uuid),
  public.m12_03_track_product_support_alert_attempt(),
  public.get_product_support_alert_product_owner_recipient(uuid,uuid),
  public.get_product_support_alert_owner_or_admin_recipient(uuid),
  public.claim_product_support_alert_atomic(uuid,uuid,integer),
  public.complete_product_support_alert_delivery_atomic(uuid,uuid,uuid,integer,uuid),
  public.m12_03_critical_delivery_row_json(text,uuid,uuid),
  public.list_notification_dispatches_atomic(uuid,uuid,text,text,uuid,text,integer),
  public.m12_03_retry_notification_dispatch_optional(uuid,uuid,text,integer,uuid),
  public.retry_notification_dispatch_atomic(uuid,uuid,text,integer,uuid)
from public,anon,authenticated;
grant execute on function
  public.pin_product_support_alert_original_recipient_atomic(uuid,uuid,uuid,integer,uuid),
  public.get_product_support_alert_product_owner_recipient(uuid,uuid),
  public.get_product_support_alert_owner_or_admin_recipient(uuid),
  public.claim_product_support_alert_atomic(uuid,uuid,integer),
  public.complete_product_support_alert_delivery_atomic(uuid,uuid,uuid,integer,uuid),
  public.m12_03_critical_delivery_row_json(text,uuid,uuid),
  public.list_notification_dispatches_atomic(uuid,uuid,text,text,uuid,text,integer),
  public.m12_03_retry_notification_dispatch_optional(uuid,uuid,text,integer,uuid),
  public.retry_notification_dispatch_atomic(uuid,uuid,text,integer,uuid)
to service_role;

notify pgrst,'reload schema';
