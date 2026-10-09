-- Bridge M8 quarantine and integrity outboxes into optional unified delivery.
-- Existing source rows remain authoritative until SMTP provider acceptance is
-- committed with the notification dispatch in the same database transaction.

create or replace function public.m12_03_evidence_scan_dispatch_source_valid(
  p_organization_id uuid,p_dispatch_id uuid
) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(
    select 1 from public.notification_dispatches d
    join public.evidence_document_notification_outbox n
      on n.organization_id=d.organization_id and n.id=d.source_id and n.event_type=d.source_type
      and n.status in ('queued','leased') and n.owner_user_id=d.original_recipient_user_id
    join public.evidence_document_versions v on v.organization_id=n.organization_id and v.id=n.version_id
      and v.owner_user_id=n.owner_user_id
    join public.organization_settings settings on settings.organization_id=d.organization_id
      and settings.notification_delivery_mode='unified'
    where d.organization_id=p_organization_id and d.id=p_dispatch_id
      and d.source_type in ('evidence_quarantined','evidence_integrity_failure')
      and d.effective_recipient_user_id=n.owner_user_id
      and ((n.event_type='evidence_quarantined' and v.processing_state='quarantined')
        or (n.event_type='evidence_integrity_failure' and v.processing_state='failed' and v.failure_code='integrity_mismatch'))
      and public.m8_evidence_actor_active(p_organization_id,n.owner_user_id)
      and public.m5_triage_actor_has_permission(p_organization_id,n.owner_user_id,'can_view_evidence')
      and public.m9_supplier_actor_can(p_organization_id,n.owner_user_id,'can_view_products')
      and exists(
        select 1 from public.evidence_document_version_products vp
        join public.products p on p.organization_id=vp.organization_id and p.id=vp.product_id and p.archived_at is null
        where vp.organization_id=p_organization_id and vp.version_id=v.id
      )
  )
$$;

create or replace function public.m12_03_dispatch_source_valid(
  p_organization_id uuid,p_dispatch_id uuid
) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce((
    select case
      when d.source_type='evidence_validity' then public.m12_03_evidence_dispatch_source_valid(p_organization_id,p_dispatch_id)
      when d.source_type in ('evidence_quarantined','evidence_integrity_failure') then public.m12_03_evidence_scan_dispatch_source_valid(p_organization_id,p_dispatch_id)
      else false
    end
    from public.notification_dispatches d
    where d.organization_id=p_organization_id and d.id=p_dispatch_id
  ),false)
$$;

create or replace function public.m12_03_mark_dispatch_sources_provider_accepted(
  p_organization_id uuid,p_dispatch_ids uuid[]
) returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare changed integer;
begin
  update public.evidence_document_notification_outbox n
  set status='sent',sent_at=clock_timestamp(),lease_owner=null,lease_expires_at=null,last_error=null
  from public.notification_dispatches d
  where d.organization_id=p_organization_id and d.id=any(p_dispatch_ids)
    and ((d.source_type='evidence_validity' and n.event_type='evidence_validity_expiring')
      or (d.source_type in ('evidence_quarantined','evidence_integrity_failure') and n.event_type=d.source_type))
    and n.organization_id=d.organization_id and n.id=d.source_id and n.status in ('queued','leased');
  get diagnostics changed=row_count;
  return changed;
end $$;

create or replace function public.bridge_evidence_scan_notification_dispatches_atomic(
  p_organization_id uuid,p_limit integer default 100
) returns table(outcome text,created integer) language plpgsql security definer set search_path=public,pg_temp as $$
declare n public.evidence_document_notification_outbox%rowtype; v public.evidence_document_versions%rowtype;
  product_id uuid; mode text; dispatch_status text; error_code text; dispatch_id uuid;
  source_ok boolean; recipient_ok boolean; created_count integer:=0; delivery_mode text;
begin
  if p_organization_id is null or p_limit not between 1 and 1000 then
    return query select 'invalid_request'::text,0; return;
  end if;
  select s.notification_delivery_mode into delivery_mode from public.organization_settings s
  where s.organization_id=p_organization_id for share;
  if delivery_mode is distinct from 'unified' then
    return query select 'legacy'::text,0; return;
  end if;
  for n in
    select x.* from public.evidence_document_notification_outbox x
    where x.organization_id=p_organization_id
      and x.event_type in ('evidence_quarantined','evidence_integrity_failure')
      and (x.status='queued' or (x.status='leased' and x.lease_expires_at<=clock_timestamp()))
      and x.next_attempt_at<=clock_timestamp()
      and not exists(select 1 from public.notification_dispatches d
        where d.organization_id=p_organization_id and d.source_type=x.event_type and d.source_id=x.id and d.original_recipient_user_id=x.owner_user_id)
    order by x.next_attempt_at,x.created_at,x.id
    limit p_limit for update of x skip locked
  loop
    select * into v from public.evidence_document_versions x where x.organization_id=p_organization_id and x.id=n.version_id;
    product_id:=null;
    if v.id is not null then
      select vp.product_id into product_id from public.evidence_document_version_products vp
      join public.products p on p.organization_id=vp.organization_id and p.id=vp.product_id and p.archived_at is null
      where vp.organization_id=p_organization_id and vp.version_id=v.id order by vp.product_id limit 1;
    end if;
    source_ok:=product_id is not null and v.owner_user_id=n.owner_user_id and (
      (n.event_type='evidence_quarantined' and v.processing_state='quarantined')
      or (n.event_type='evidence_integrity_failure' and v.processing_state='failed' and v.failure_code='integrity_mismatch')
    );
    recipient_ok:=public.m8_evidence_actor_active(p_organization_id,n.owner_user_id)
      and public.m5_triage_actor_has_permission(p_organization_id,n.owner_user_id,'can_view_evidence')
      and public.m9_supplier_actor_can(p_organization_id,n.owner_user_id,'can_view_products');
    select coalesce(p.modes->>'evidence','immediate') into mode from public.notification_preferences p
      where p.organization_id=p_organization_id and p.user_id=n.owner_user_id;
    mode:=coalesce(mode,'immediate');
    error_code:=case when not recipient_ok then 'recipient_unavailable'
      when not source_ok then 'source_unavailable'
      when mode='off' then 'preference_suppressed' else null end;
    dispatch_status:=case when error_code is not null then 'cancelled'
      when mode in ('daily','weekly') then 'digest_pending' else 'queued' end;
    dispatch_id:=null;
    insert into public.notification_dispatches(
      organization_id,category,source_type,source_id,source_subtype,source_link,safe_title,
      original_recipient_user_id,effective_recipient_user_id,status,next_attempt_at,safe_error_code
    ) values(
      p_organization_id,'evidence',n.event_type,n.id,n.event_type,
      case when product_id is null then null else '/products/'||product_id::text||'/evidence' end,
      case when source_ok and recipient_ok then left(v.title,500) else null end,
      n.owner_user_id,n.owner_user_id,
      dispatch_status,n.next_attempt_at,error_code
    ) on conflict(organization_id,source_type,source_id,original_recipient_user_id) do nothing
    returning id into dispatch_id;
    if dispatch_id is not null then
      created_count:=created_count+1;
      insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
      values(p_organization_id,'notification.dispatch_bridged','notification_dispatch',dispatch_id::text,
        jsonb_build_object('sourceType',n.event_type,'sourceId',n.id,'status',dispatch_status));
      if dispatch_status='cancelled' then
        update public.evidence_document_notification_outbox
        set status=case when error_code='source_unavailable' then 'obsolete'
          when error_code='recipient_unavailable' then 'recipient_unavailable' else 'sent' end,
          sent_at=case when error_code='source_unavailable' then null else clock_timestamp() end,
          lease_owner=null,lease_expires_at=null,last_error=error_code
        where organization_id=p_organization_id and id=n.id;
      end if;
    end if;
  end loop;
  return query select 'bridged'::text,created_count;
end $$;

-- The legacy scan worker remains active for organizations still in legacy
-- mode. Its payload retains the event type so integrity never appears as
-- quarantine; unified organizations are exclusively owned by the bridge.
create or replace function public.claim_evidence_document_notification_atomic(
  p_organization_id uuid,p_worker_id uuid,p_lease_seconds integer
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare n public.evidence_document_notification_outbox%rowtype; recipient_email text; delivery_mode text;
begin
  if p_organization_id is null or p_worker_id is null or p_lease_seconds not between 30 and 900 then return null; end if;
  select s.notification_delivery_mode into delivery_mode from public.organization_settings s
  where s.organization_id=p_organization_id for share;
  if delivery_mode='unified' then return null; end if;
  select * into n from public.evidence_document_notification_outbox x
  where x.organization_id=p_organization_id and x.event_type in ('evidence_quarantined','evidence_integrity_failure')
    and x.status in ('queued','leased') and x.next_attempt_at<=clock_timestamp()
    and (x.status='queued' or x.lease_expires_at<=clock_timestamp())
  order by x.created_at,x.id for update skip locked limit 1;
  if not found then return null; end if;
  select u.email into recipient_email from public.users u join public.organization_members m
    on m.user_id=u.id and m.organization_id=p_organization_id
  where u.id=n.owner_user_id and u.is_active limit 1;
  if recipient_email is null then
    update public.evidence_document_notification_outbox set status='recipient_unavailable',sent_at=clock_timestamp(),
      last_error='recipient_unavailable',lease_owner=null,lease_expires_at=null
    where organization_id=p_organization_id and id=n.id;
    return null;
  end if;
  update public.evidence_document_notification_outbox
  set status='leased',lease_owner=p_worker_id,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),attempt_count=attempt_count+1
  where organization_id=p_organization_id and id=n.id returning * into n;
  return jsonb_build_object('outboxId',n.id,'email',recipient_email,'eventType',n.event_type);
end $$;

-- Reuse the reviewed validity source/preference/quiet-hour preparation path.
alter function public.prepare_notification_dispatch_atomic(uuid,uuid,uuid,integer)
  rename to m12_03_prepare_evidence_validity_base;

create function public.prepare_notification_dispatch_atomic(
  p_organization_id uuid,p_dispatch_id uuid,p_worker_id uuid,p_expected_version integer
) returns table(outcome text,delivery jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.notification_dispatches%rowtype; recipient_email text;
  preference public.notification_preferences%rowtype; mode text; local_now timestamp; delivery_mode text;
begin
  select * into d from public.notification_dispatches where organization_id=p_organization_id and id=p_dispatch_id for update;
  if not found then return query select 'not_found',null::jsonb; return; end if;
  if d.status<>'leased' or d.lease_owner is distinct from p_worker_id or d.version<>p_expected_version
    or d.lease_expires_at<=clock_timestamp() then
    return query select 'conflict',null::jsonb; return;
  end if;
  select s.notification_delivery_mode into delivery_mode from public.organization_settings s
  where s.organization_id=p_organization_id for share;
  if delivery_mode is distinct from 'unified' then
    update public.notification_dispatches set status='cancelled',lease_owner=null,lease_expires_at=null,
      safe_error_code='delivery_mode_changed',version=version+1
    where organization_id=p_organization_id and id=p_dispatch_id;
    return query select 'cancelled',null::jsonb; return;
  end if;
  if d.source_type='evidence_validity' then
    if not public.m12_03_evidence_dispatch_source_valid(p_organization_id,p_dispatch_id) then
      update public.notification_dispatches set status='cancelled',lease_owner=null,lease_expires_at=null,safe_error_code='source_unavailable',version=version+1
      where organization_id=p_organization_id and id=p_dispatch_id;
      return query select 'cancelled',null::jsonb; return;
    end if;
    return query select * from public.m12_03_prepare_evidence_validity_base(
      p_organization_id,p_dispatch_id,p_worker_id,p_expected_version); return;
  end if;
  if d.source_type in ('evidence_quarantined','evidence_integrity_failure') then
    select u.email into recipient_email from public.organization_members m
      join public.users u on u.id=m.user_id and u.is_active
      where m.organization_id=p_organization_id and m.user_id=d.effective_recipient_user_id;
    if recipient_email is null then
      update public.notification_dispatches set status='cancelled',lease_owner=null,lease_expires_at=null,
        safe_error_code='recipient_unavailable',version=version+1
      where organization_id=p_organization_id and id=p_dispatch_id;
      update public.evidence_document_notification_outbox set status='recipient_unavailable',sent_at=clock_timestamp(),
        lease_owner=null,lease_expires_at=null,last_error='recipient_unavailable'
      where organization_id=p_organization_id and id=d.source_id and status in ('queued','leased');
      return query select 'cancelled',null::jsonb; return;
    end if;
    if not public.m12_03_evidence_scan_dispatch_source_valid(p_organization_id,p_dispatch_id) then
      update public.notification_dispatches set status='cancelled',lease_owner=null,lease_expires_at=null,
        safe_error_code='source_unavailable',version=version+1
      where organization_id=p_organization_id and id=p_dispatch_id;
      update public.evidence_document_notification_outbox set status='obsolete',lease_owner=null,
        lease_expires_at=null,last_error='source_unavailable'
      where organization_id=p_organization_id and id=d.source_id and status in ('queued','leased');
      return query select 'cancelled',null::jsonb; return;
    end if;
    select * into preference from public.notification_preferences p
      where p.organization_id=p_organization_id and p.user_id=d.effective_recipient_user_id;
    mode:=coalesce(preference.modes->>'evidence','immediate');
    if mode<>'immediate' then
      update public.notification_dispatches set status=case when mode in ('daily','weekly') then 'digest_pending' else 'cancelled' end,
        lease_owner=null,lease_expires_at=null,safe_error_code=case when mode='off' then 'preference_suppressed' else null end,version=version+1
      where organization_id=p_organization_id and id=p_dispatch_id;
      if mode='off' then
        update public.evidence_document_notification_outbox set status='sent',sent_at=clock_timestamp(),lease_owner=null,lease_expires_at=null,last_error='preference_suppressed'
        where organization_id=p_organization_id and id=d.source_id and status in ('queued','leased');
      end if;
      return query select 'cancelled',null::jsonb; return;
    end if;
    if preference.id is not null and preference.quiet_start is not null then
      local_now:=clock_timestamp() at time zone preference.timezone;
      if public.m12_03_local_time_in_quiet(local_now::time,preference.quiet_start,preference.quiet_end) then
        update public.notification_dispatches set status='retrying',lease_owner=null,lease_expires_at=null,
          safe_error_code='quiet_hours_deferred',next_attempt_at=clock_timestamp()+interval '1 hour',version=version+1
        where organization_id=p_organization_id and id=p_dispatch_id;
        return query select 'cancelled',null::jsonb; return;
      end if;
    end if;
    return query select 'ready',jsonb_build_object(
      'deliveryRef',d.id,'idempotencyKey','notification-dispatch:'||d.id::text,
      'recipient',jsonb_build_object('userId',d.effective_recipient_user_id,'email',recipient_email),
      'payload',jsonb_build_object('kind',d.source_type)
    );
    return;
  end if;
  return query select 'invalid_request',null::jsonb;
end $$;

create or replace function public.complete_notification_dispatch_atomic(
  p_organization_id uuid,p_dispatch_id uuid,p_worker_id uuid,p_expected_version integer,
  p_outcome text,p_message_id_hash text default null,p_error_code text default null
) returns table(outcome text) language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.notification_dispatches%rowtype;
begin
  if p_outcome not in ('provider_accepted','delivered','failed','exhausted','cancelled') then return query select 'invalid_request'; return; end if;
  select * into d from public.notification_dispatches where organization_id=p_organization_id and id=p_dispatch_id for update;
  if not found then return query select 'not_found'; return; end if;
  if d.status in ('provider_accepted','delivered') then return query select 'replayed'; return; end if;
  if d.status<>'leased' or d.lease_owner is distinct from p_worker_id or d.version<>p_expected_version then return query select 'conflict'; return; end if;
  update public.notification_dispatches
  set status=p_outcome,lease_owner=null,lease_expires_at=null,provider_message_id=p_message_id_hash,
    safe_error_code=case when p_outcome in ('failed','exhausted','cancelled') then coalesce(nullif(btrim(p_error_code),''),'provider_unavailable') else null end,
    version=version+1
  where organization_id=p_organization_id and id=p_dispatch_id;
  if p_outcome in ('provider_accepted','delivered') then
    perform public.m12_03_mark_dispatch_sources_provider_accepted(p_organization_id,array[p_dispatch_id]);
  end if;
  insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
  values(p_organization_id,'notification.dispatch_'||p_outcome,'notification_dispatch',p_dispatch_id::text,
    jsonb_build_object('sourceType',d.source_type,'sourceId',d.source_id,'attempt',d.attempt_count));
  return query select 'completed';
end $$;

do $$
declare signature text;
begin
  foreach signature in array array[
    'm12_03_evidence_scan_dispatch_source_valid(uuid,uuid)',
    'm12_03_dispatch_source_valid(uuid,uuid)',
    'm12_03_mark_dispatch_sources_provider_accepted(uuid,uuid[])',
    'bridge_evidence_scan_notification_dispatches_atomic(uuid,integer)',
    'claim_evidence_document_notification_atomic(uuid,uuid,integer)',
    'm12_03_prepare_evidence_validity_base(uuid,uuid,uuid,integer)',
    'prepare_notification_dispatch_atomic(uuid,uuid,uuid,integer)',
    'complete_notification_dispatch_atomic(uuid,uuid,uuid,integer,text,text,text)'
  ] loop
    execute 'alter function public.'||signature||' owner to postgres';
  end loop;
end $$;

revoke all on function
  public.m12_03_evidence_scan_dispatch_source_valid(uuid,uuid),
  public.m12_03_dispatch_source_valid(uuid,uuid),
  public.m12_03_mark_dispatch_sources_provider_accepted(uuid,uuid[]),
  public.bridge_evidence_scan_notification_dispatches_atomic(uuid,integer),
  public.claim_evidence_document_notification_atomic(uuid,uuid,integer),
  public.m12_03_prepare_evidence_validity_base(uuid,uuid,uuid,integer),
  public.prepare_notification_dispatch_atomic(uuid,uuid,uuid,integer),
  public.complete_notification_dispatch_atomic(uuid,uuid,uuid,integer,text,text,text)
from public,anon,authenticated;

grant execute on function
  public.m12_03_evidence_scan_dispatch_source_valid(uuid,uuid),
  public.m12_03_dispatch_source_valid(uuid,uuid),
  public.m12_03_mark_dispatch_sources_provider_accepted(uuid,uuid[]),
  public.bridge_evidence_scan_notification_dispatches_atomic(uuid,integer),
  public.claim_evidence_document_notification_atomic(uuid,uuid,integer),
  public.m12_03_prepare_evidence_validity_base(uuid,uuid,uuid,integer),
  public.prepare_notification_dispatch_atomic(uuid,uuid,uuid,integer),
  public.complete_notification_dispatch_atomic(uuid,uuid,uuid,integer,text,text,text)
to service_role;

notify pgrst,'reload schema';
