-- M12-03 optional digest scheduling for unified notification delivery.
-- Adds digest-safe scheduling primitives and repairs the M8 validity bridge so
-- every preference mode reaches a terminal or scheduled state in unified mode.

alter table public.notification_dispatches
  drop constraint if exists notification_dispatches_source_type_check,
  add constraint notification_dispatches_source_type_check
    check (source_type ~ '^[a-z][a-z0-9_]*$' and char_length(source_type) <= 64),
  drop constraint if exists notification_dispatches_status_check,
  add constraint notification_dispatches_status_check
    check (status in ('queued','leased','provider_accepted','delivered','retrying','failed','exhausted','cancelled','suppressed','digest_pending'));

alter table public.notification_digest_batches
  add column if not exists batch_index integer not null default 1 check (batch_index > 0),
  add column if not exists attempt_count integer not null default 0 check (attempt_count >= 0),
  add column if not exists next_attempt_at timestamptz not null default clock_timestamp(),
  add column if not exists last_attempt_at timestamptz,
  add column if not exists lease_owner uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists version integer not null default 1 check (version > 0),
  add column if not exists preference_version integer not null default 1 check (preference_version > 0),
  add column if not exists safe_error_code text check (safe_error_code is null or safe_error_code ~ '^[a-z0-9_]{1,64}$'),
  add column if not exists provider_message_id text check (provider_message_id is null or (char_length(provider_message_id) between 1 and 500 and provider_message_id !~ '[[:cntrl:]]')),
  add column if not exists updated_at timestamptz not null default clock_timestamp(),
  drop constraint if exists notification_digest_batches_status_check,
  add constraint notification_digest_batches_status_check
    check (status in ('queued','leased','retrying','provider_accepted','delivered','failed','exhausted','cancelled')),
  drop constraint if exists notification_digest_batches_lease_check,
  add constraint notification_digest_batches_lease_check
    check ((status='leased') = (lease_owner is not null and lease_expires_at is not null));

create unique index if not exists notification_digest_batches_window_unique
  on public.notification_digest_batches(organization_id,user_id,category,window_start,window_end,batch_index);
create index if not exists notification_digest_batches_due_idx
  on public.notification_digest_batches(organization_id,status,next_attempt_at,id)
  where status in ('queued','retrying','leased');
create index if not exists notification_dispatches_digest_due_idx
  on public.notification_dispatches(organization_id,next_attempt_at,id)
  where status='digest_pending';

drop trigger if exists set_notification_digest_batches_updated_at on public.notification_digest_batches;
create trigger set_notification_digest_batches_updated_at
  before update on public.notification_digest_batches
  for each row execute function public.set_updated_at();

create or replace function public.resolve_critical_notification_recipient(
  p_organization_id uuid,p_original_user_id uuid,p_product_id uuid,p_category text
) returns table(outcome text,recipient jsonb) language plpgsql stable security definer set search_path=public,pg_temp as $$
declare alternate_user_id uuid; effective_user_id uuid; effective_email text;
begin
  if p_organization_id is null or p_category not in ('support_period','reporting_deadline') then
    return query select 'unresolved',null::jsonb; return;
  end if;
  if p_original_user_id is not null and public.m12_03_user_can_receive_critical(p_organization_id,p_original_user_id,p_product_id,p_category)
    and exists(select 1 from public.organization_members m where m.organization_id=p_organization_id
      and m.user_id=p_original_user_id and m.role in ('owner','admin')) then
    select p.critical_alternate_user_id into alternate_user_id
    from public.notification_preferences p
    where p.organization_id=p_organization_id and p.user_id=p_original_user_id;
    if alternate_user_id is not null and public.m12_03_user_can_receive_critical(p_organization_id,alternate_user_id,p_product_id,p_category)
      and exists(select 1 from public.organization_members m where m.organization_id=p_organization_id
        and m.user_id=alternate_user_id and m.role in ('owner','admin')) then
      effective_user_id:=alternate_user_id;
    else
      effective_user_id:=p_original_user_id;
    end if;
  else
    select m.user_id into effective_user_id
    from public.organization_members m
    join public.users u on u.id=m.user_id and u.is_active
    where m.organization_id=p_organization_id and m.role in ('owner','admin')
      and public.m12_03_user_can_receive_critical(p_organization_id,m.user_id,p_product_id,p_category)
    order by case m.role when 'owner' then 0 else 1 end,m.user_id
    limit 1;
  end if;
  if effective_user_id is null then return query select 'unresolved',null::jsonb; return; end if;
  select u.email into effective_email from public.users u where u.id=effective_user_id and u.is_active;
  if effective_email is null then return query select 'unresolved',null::jsonb; return; end if;
  return query select 'resolved',jsonb_build_object('userId',effective_user_id,'email',effective_email);
end $$;

create or replace function public.m12_03_local_time_in_quiet(
  p_local_time time,p_quiet_start time,p_quiet_end time
) returns boolean language sql immutable set search_path=public,pg_temp as $$
  select case
    when p_quiet_start is null or p_quiet_end is null then false
    when p_quiet_start < p_quiet_end then p_local_time >= p_quiet_start and p_local_time < p_quiet_end
    else p_local_time >= p_quiet_start or p_local_time < p_quiet_end
  end
$$;

create or replace function public.m12_03_first_local_occurrence(p_local_due timestamp,p_timezone text)
returns timestamptz language plpgsql stable set search_path=public,pg_temp as $$
declare later timestamptz; earlier timestamptz; prior_offset interval;
begin
  later:=p_local_due at time zone p_timezone;
  prior_offset:=((later-interval '1 day') at time zone p_timezone)
    - ((later-interval '1 day') at time zone 'UTC');
  earlier:=(p_local_due at time zone 'UTC')-prior_offset;
  if earlier<later and (earlier at time zone p_timezone)=p_local_due then return earlier; end if;
  return later;
end $$;

create or replace function public.m12_03_digest_window(
  p_mode text,p_timezone text,p_local_time time,p_weekly_day integer,p_now timestamptz
) returns table(is_due boolean,window_start timestamptz,window_end timestamptz,due_local timestamp)
language plpgsql stable set search_path=public,pg_temp as $$
declare local_now timestamp; local_due timestamp; due_utc timestamptz; is_scheduled_day boolean;
begin
  if p_mode not in ('daily','weekly') or p_timezone is null or p_local_time is null or p_now is null then
    return query select false,null::timestamptz,null::timestamptz,null::timestamp; return;
  end if;
  local_now := p_now at time zone p_timezone;
  local_due := date_trunc('day',local_now) + p_local_time;
  if p_mode='daily' then
    due_utc:=public.m12_03_first_local_occurrence(local_due,p_timezone);
    is_scheduled_day:=p_now>=due_utc;
    if not is_scheduled_day then local_due:=local_due-interval '1 day'; end if;
    return query select is_scheduled_day,
      public.m12_03_first_local_occurrence(local_due-interval '1 day',p_timezone),
      public.m12_03_first_local_occurrence(local_due,p_timezone),local_due;
    return;
  end if;
  local_due:=local_due-((extract(isodow from local_now)::integer-p_weekly_day+7)%7)*interval '1 day';
  due_utc:=public.m12_03_first_local_occurrence(local_due,p_timezone);
  is_scheduled_day:=extract(isodow from local_now)::integer=p_weekly_day and p_now>=due_utc;
  if p_now<due_utc then local_due:=local_due-interval '7 days'; end if;
  return query select is_scheduled_day,
    public.m12_03_first_local_occurrence(local_due-interval '7 days',p_timezone),
    public.m12_03_first_local_occurrence(local_due,p_timezone),local_due;
end $$;

create or replace function public.m12_03_evidence_dispatch_source_valid(
  p_organization_id uuid,p_dispatch_id uuid
) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(
    select 1 from public.notification_dispatches d
    join public.evidence_document_notification_outbox n on n.organization_id=d.organization_id and n.id=d.source_id and n.status in ('queued','leased')
    join public.evidence_document_versions v on v.organization_id=n.organization_id and v.id=n.version_id and v.processing_state='clean'
    join public.evidence_documents doc on doc.organization_id=v.organization_id and doc.id=v.document_id and doc.current_version_id=v.id
    join public.evidence_document_version_products vp on vp.organization_id=v.organization_id and vp.version_id=v.id
    join public.products p on p.organization_id=vp.organization_id and p.id=vp.product_id and p.archived_at is null
    join public.organization_members m on m.organization_id=d.organization_id and m.user_id=d.effective_recipient_user_id
    join public.users u on u.id=m.user_id and u.is_active
    where d.organization_id=p_organization_id and d.id=p_dispatch_id and d.source_type='evidence_validity'
      and public.m8_evidence_actor_active(p_organization_id,d.effective_recipient_user_id)
      and public.m5_triage_actor_has_permission(p_organization_id,d.effective_recipient_user_id,'can_view_evidence')
      and public.m9_supplier_actor_can(p_organization_id,d.effective_recipient_user_id,'can_view_products')
  )
$$;


create or replace function public.m12_03_dispatch_source_valid(
  p_organization_id uuid,p_dispatch_id uuid
) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce((
    select case
      when d.source_type='evidence_validity' then public.m12_03_evidence_dispatch_source_valid(p_organization_id,p_dispatch_id)
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
    and d.source_type='evidence_validity'
    and d.status in ('provider_accepted','delivered')
    and n.organization_id=d.organization_id and n.id=d.source_id and n.status in ('queued','leased');
  get diagnostics changed=row_count;
  return changed;
end $$;

create or replace function public.bridge_evidence_validity_notification_dispatches_atomic(
  p_organization_id uuid,p_limit integer default 100
) returns table(outcome text,created integer) language plpgsql security definer set search_path=public,pg_temp as $$
declare created_count integer; delivery_mode text;
begin
  if p_organization_id is null or p_limit not between 1 and 1000 then return query select 'invalid_request',0; return; end if;
  select notification_delivery_mode into delivery_mode from public.organization_settings
  where organization_id=p_organization_id for share;
  if delivery_mode is distinct from 'unified' then
    return query select 'legacy',0; return;
  end if;
  with candidate as (
    select n.id,n.organization_id,n.event_type,n.owner_user_id,n.next_attempt_at,n.created_at,v.title,
      coalesce(pref.modes->>'evidence','immediate') mode,
      case when first_product.product_id is null then null else '/products/'||first_product.product_id::text||'/evidence' end source_link
    from public.evidence_document_notification_outbox n
    join public.evidence_document_versions v on v.organization_id=n.organization_id and v.id=n.version_id and v.processing_state='clean'
    cross join lateral (
      select vp.product_id from public.evidence_document_version_products vp
      join public.products p on p.organization_id=vp.organization_id and p.id=vp.product_id and p.archived_at is null
      where vp.organization_id=n.organization_id and vp.version_id=n.version_id
      order by vp.product_id limit 1
    ) first_product
    join public.organization_members m on m.organization_id=n.organization_id and m.user_id=n.owner_user_id
    join public.users u on u.id=m.user_id and u.is_active
    left join public.notification_preferences pref on pref.organization_id=n.organization_id and pref.user_id=n.owner_user_id
    where n.organization_id=p_organization_id and n.event_type='evidence_validity_expiring'
      and n.status in ('queued','leased') and n.next_attempt_at<=clock_timestamp()
      and public.m8_evidence_actor_active(p_organization_id,n.owner_user_id)
      and public.m5_triage_actor_has_permission(p_organization_id,n.owner_user_id,'can_view_evidence')
      and public.m9_supplier_actor_can(p_organization_id,n.owner_user_id,'can_view_products')
    order by n.next_attempt_at,n.created_at,n.id
    limit p_limit
  ), inserted as (
    insert into public.notification_dispatches(
      organization_id,category,source_type,source_id,source_subtype,source_link,safe_title,
      original_recipient_user_id,effective_recipient_user_id,status,next_attempt_at,safe_error_code
    )
    select organization_id,'evidence','evidence_validity',id,event_type,source_link,left(title,500),owner_user_id,owner_user_id,
      case when mode='immediate' then 'queued' when mode in ('daily','weekly') then 'digest_pending' else 'cancelled' end,
      next_attempt_at,
      case when mode='off' then 'preference_suppressed' else null end
    from candidate
    on conflict(organization_id,source_type,source_id,original_recipient_user_id) do nothing
    returning source_id,status
  ), terminal as (
    update public.evidence_document_notification_outbox n
    set status='sent',sent_at=clock_timestamp(),lease_owner=null,lease_expires_at=null,last_error=null
    from inserted i
    where i.status='cancelled' and n.organization_id=p_organization_id and n.id=i.source_id
    returning n.id
  )
  select (select count(*) from inserted)::integer into created_count;
  return query select 'bridged',coalesce(created_count,0);
end $$;

create or replace function public.schedule_notification_digest_batches_atomic(
  p_organization_id uuid,p_now timestamptz default clock_timestamp(),p_limit integer default 1000
) returns table(outcome text,created integer,cancelled integer,deferred integer) language plpgsql security definer set search_path=public,pg_temp as $$
declare created_count integer; cancelled_count integer; deferred_count integer;
begin
  if p_organization_id is null or p_now is null or p_limit not between 1 and 10000 then
    return query select 'invalid_request',0,0,0; return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('notification-digest:'||p_organization_id::text,0));
  if not exists(select 1 from public.organization_settings where organization_id=p_organization_id and notification_delivery_mode='unified') then
    return query select 'legacy',0,0,0; return;
  end if;

  with invalid as (
    select d.id,coalesce(pref.modes->>d.category,'immediate') mode,
      case
        when d.effective_recipient_user_id is null or not exists(select 1 from public.organization_members m join public.users u on u.id=m.user_id and u.is_active where m.organization_id=d.organization_id and m.user_id=d.effective_recipient_user_id) then 'recipient_unavailable'
        when coalesce(pref.modes->>d.category,'immediate') not in ('daily','weekly') then 'preference_changed'
        when not public.m12_03_dispatch_source_valid(d.organization_id,d.id) then 'source_unavailable'
        else null
      end code
    from public.notification_dispatches d
    left join public.notification_preferences pref on pref.organization_id=d.organization_id and pref.user_id=d.effective_recipient_user_id
    where d.organization_id=p_organization_id and d.status='digest_pending'
  ), changed as (
    update public.notification_dispatches d
    set status=case when invalid.mode='immediate' and invalid.code='preference_changed' then 'queued' else 'cancelled' end,
      safe_error_code=case when invalid.mode='immediate' and invalid.code='preference_changed' then null
        when invalid.mode='off' and invalid.code='preference_changed' then 'preference_suppressed' else invalid.code end,
      next_attempt_at=case when invalid.mode='immediate' and invalid.code='preference_changed' then clock_timestamp() else d.next_attempt_at end,
      version=version+1
    from invalid where invalid.id=d.id and invalid.code is not null
    returning d.id
  ) select count(*)::integer into cancelled_count from changed;
  update public.evidence_document_notification_outbox n
  set status=case d.safe_error_code when 'preference_suppressed' then 'sent'
      when 'recipient_unavailable' then 'recipient_unavailable' else 'obsolete' end,
    sent_at=case when d.safe_error_code in ('preference_suppressed','recipient_unavailable') then clock_timestamp() else n.sent_at end,
    lease_owner=null,lease_expires_at=null,last_error=d.safe_error_code
  from public.notification_dispatches d
  where d.organization_id=p_organization_id and d.status='cancelled'
    and d.safe_error_code in ('preference_suppressed','recipient_unavailable','source_unavailable')
    and d.source_type like 'evidence_%' and n.organization_id=d.organization_id and n.id=d.source_id
    and n.status in ('queued','leased');

  with quiet_candidates as (
    select d.id,public.m12_03_first_local_occurrence(
      date_trunc('day',p_now at time zone pref.timezone)+pref.quiet_end
        + case when date_trunc('day',p_now at time zone pref.timezone)+pref.quiet_end
          <= p_now at time zone pref.timezone then interval '1 day' else interval '0 day' end,
      pref.timezone) next_attempt
    from public.notification_dispatches d
    join public.notification_preferences pref on pref.organization_id=d.organization_id and pref.user_id=d.effective_recipient_user_id
    cross join lateral public.m12_03_digest_window(pref.modes->>d.category,pref.timezone,pref.digest_local_time,pref.weekly_day,p_now) w
    where d.organization_id=p_organization_id and d.status='digest_pending'
      and (w.is_due or d.safe_error_code='quiet_hours_deferred')
      and public.m12_03_local_time_in_quiet((p_now at time zone pref.timezone)::time,pref.quiet_start,pref.quiet_end)
      and not exists(select 1 from public.notification_digest_batches existing
        where existing.organization_id=d.organization_id and existing.status<>'cancelled' and d.id=any(existing.dispatch_ids))
  ), changed as (
    update public.notification_dispatches d
    set safe_error_code='quiet_hours_deferred',next_attempt_at=q.next_attempt,version=version+1
    from quiet_candidates q where q.id=d.id and d.safe_error_code is distinct from 'quiet_hours_deferred'
    returning d.id
  ) select count(*)::integer into deferred_count from changed;

  with eligible as (
    select d.id,d.organization_id,d.category,d.effective_recipient_user_id user_id,pref.version preference_version,w.window_start,w.window_end,
      row_number() over(partition by d.organization_id,d.effective_recipient_user_id,d.category,w.window_start,w.window_end order by d.created_at,d.id) rn
    from public.notification_dispatches d
    join public.notification_preferences pref on pref.organization_id=d.organization_id and pref.user_id=d.effective_recipient_user_id
    cross join lateral public.m12_03_digest_window(pref.modes->>d.category,pref.timezone,pref.digest_local_time,pref.weekly_day,p_now) w
    where d.organization_id=p_organization_id and d.status='digest_pending'
      and (pref.modes->>d.category) in ('daily','weekly')
      and (w.is_due or d.safe_error_code='quiet_hours_deferred')
      and not public.m12_03_local_time_in_quiet((p_now at time zone pref.timezone)::time,pref.quiet_start,pref.quiet_end)
      and (d.safe_error_code is distinct from 'quiet_hours_deferred' or d.next_attempt_at<=p_now)
      and public.m12_03_dispatch_source_valid(d.organization_id,d.id)
      and not exists (
        select 1 from public.notification_digest_batches existing
        where existing.organization_id=d.organization_id and existing.status<>'cancelled' and d.id=any(existing.dispatch_ids)
      )
    order by d.created_at,d.id
    limit p_limit
  ), numbered as (
    select eligible.*,(((rn-1)/100)+1)::integer chunk_index from eligible
  ), grouped as (
    select organization_id,user_id,category,window_start,window_end,preference_version,
      (chunk_index+coalesce((
        select max(existing.batch_index) from public.notification_digest_batches existing
        where existing.organization_id=numbered.organization_id and existing.user_id=numbered.user_id
          and existing.category=numbered.category and existing.window_start=numbered.window_start
          and existing.window_end=numbered.window_end
      ),0))::integer batch_index,array_agg(id order by rn) dispatch_ids
    from numbered group by organization_id,user_id,category,window_start,window_end,preference_version,chunk_index
  ), inserted as (
    insert into public.notification_digest_batches(organization_id,user_id,category,window_start,window_end,preference_version,batch_index,dispatch_ids,next_attempt_at)
    select organization_id,user_id,category,window_start,window_end,preference_version,batch_index,dispatch_ids,clock_timestamp() from grouped
    on conflict(organization_id,user_id,category,window_start,window_end,batch_index) do nothing
    returning id
  ) select count(*)::integer into created_count from inserted;

  update public.notification_dispatches d set safe_error_code=null,version=version+1
  where d.organization_id=p_organization_id and d.status='digest_pending' and d.safe_error_code='quiet_hours_deferred'
    and exists(select 1 from public.notification_digest_batches b
      where b.organization_id=d.organization_id and b.status<>'cancelled' and d.id=any(b.dispatch_ids));

  return query select 'scheduled',coalesce(created_count,0),coalesce(cancelled_count,0),coalesce(deferred_count,0);
end $$;

create or replace function public.list_due_notification_digest_organizations_atomic(
  p_after_organization_id uuid default null,p_limit integer default 1000
) returns table(organization_id uuid) language sql stable security definer set search_path=public,pg_temp as $$
  select due.organization_id from (
    select b.organization_id from public.notification_digest_batches b
    join public.organization_settings s on s.organization_id=b.organization_id and s.notification_delivery_mode='unified'
    where b.next_attempt_at<=clock_timestamp() and b.status in ('queued','retrying')
    union
    select d.organization_id from public.notification_dispatches d
    join public.organization_settings s on s.organization_id=d.organization_id and s.notification_delivery_mode='unified'
    where d.status='digest_pending' and d.next_attempt_at<=clock_timestamp()
      and not exists(select 1 from public.notification_digest_batches b
        where b.organization_id=d.organization_id and b.status<>'cancelled' and d.id=any(b.dispatch_ids))
  ) due
  where p_limit between 1 and 10000
    and (p_after_organization_id is null or due.organization_id > p_after_organization_id)
  order by due.organization_id limit p_limit
$$;

create or replace function public.claim_notification_digest_batch_atomic(
  p_organization_id uuid,p_worker_id uuid,p_lease_seconds integer
) returns table(outcome text,batch jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.notification_digest_batches%rowtype; delivery_mode text;
begin
  if p_organization_id is null or p_worker_id is null or p_lease_seconds not between 30 and 900 then return query select 'invalid_request',null::jsonb; return; end if;
  select notification_delivery_mode into delivery_mode from public.organization_settings
  where organization_id=p_organization_id for share;
  if delivery_mode is distinct from 'unified' then return query select 'none_available',null::jsonb; return; end if;
  select * into b from public.notification_digest_batches x
  where x.organization_id=p_organization_id and x.next_attempt_at<=clock_timestamp() and x.status in ('queued','retrying')
  order by x.next_attempt_at,x.created_at,x.id for update skip locked limit 1;
  if not found then return query select 'none_available',null::jsonb; return; end if;
  update public.notification_digest_batches
  set status='leased',lease_owner=p_worker_id,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),attempt_count=attempt_count+1,last_attempt_at=clock_timestamp(),version=version+1,safe_error_code=null
  where organization_id=p_organization_id and id=b.id returning * into b;
  return query select 'claimed',jsonb_build_object('batchId',b.id,'leaseOwner',b.lease_owner,'checkpointVersion',b.version);
end $$;

create or replace function public.prepare_notification_digest_batch_atomic(
  p_organization_id uuid,p_batch_id uuid,p_worker_id uuid,p_expected_version integer
) returns table(outcome text,delivery jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.notification_digest_batches%rowtype; preference_record public.notification_preferences%rowtype;
  recipient_email text; item_count integer; valid_count integer; items jsonb;
  delivery_mode text; local_now timestamp; quiet_end_local timestamp;
begin
  select s.notification_delivery_mode into delivery_mode from public.organization_settings s
  where s.organization_id=p_organization_id for share;
  select * into b from public.notification_digest_batches where organization_id=p_organization_id and id=p_batch_id for update;
  if not found then return query select 'not_found',null::jsonb; return; end if;
  if b.status<>'leased' or b.lease_owner is distinct from p_worker_id or b.version<>p_expected_version then return query select 'conflict',null::jsonb; return; end if;
  if delivery_mode is distinct from 'unified' then
    update public.notification_digest_batches set status='cancelled',lease_owner=null,lease_expires_at=null,
      safe_error_code='delivery_mode_changed',version=version+1 where organization_id=p_organization_id and id=p_batch_id;
    update public.notification_dispatches set status='cancelled',safe_error_code='delivery_mode_changed',version=version+1
      where organization_id=p_organization_id and id=any(b.dispatch_ids) and status='digest_pending';
    return query select 'cancelled',null::jsonb; return;
  end if;
  select * into preference_record from public.notification_preferences
  where organization_id=p_organization_id and user_id=b.user_id;
  if preference_record.version is distinct from b.preference_version then
    update public.notification_dispatches d
    set status=case when coalesce(preference_record.modes->>d.category,'immediate')='immediate' then 'queued'
        when coalesce(preference_record.modes->>d.category,'immediate')='off' then 'cancelled' else 'digest_pending' end,
      safe_error_code=case when coalesce(preference_record.modes->>d.category,'immediate')='off' then 'preference_suppressed' else null end,
      next_attempt_at=case when coalesce(preference_record.modes->>d.category,'immediate')='immediate' then clock_timestamp() else d.next_attempt_at end,
      version=version+1
    where d.organization_id=p_organization_id and d.id=any(b.dispatch_ids) and d.status='digest_pending';
    update public.evidence_document_notification_outbox n
    set status='sent',sent_at=clock_timestamp(),lease_owner=null,lease_expires_at=null,last_error='preference_suppressed'
    from public.notification_dispatches d
    where d.organization_id=p_organization_id and d.id=any(b.dispatch_ids) and d.status='cancelled'
      and d.safe_error_code='preference_suppressed' and d.source_type like 'evidence_%'
      and n.organization_id=d.organization_id and n.id=d.source_id and n.status in ('queued','leased');
    update public.notification_digest_batches set status='cancelled',lease_owner=null,lease_expires_at=null,
      safe_error_code='preference_changed',version=version+1 where organization_id=p_organization_id and id=p_batch_id;
    return query select 'cancelled',null::jsonb; return;
  end if;
  local_now:=clock_timestamp() at time zone preference_record.timezone;
  if public.m12_03_local_time_in_quiet(local_now::time,preference_record.quiet_start,preference_record.quiet_end) then
    quiet_end_local:=date_trunc('day',local_now)+preference_record.quiet_end;
    if quiet_end_local<=local_now then quiet_end_local:=quiet_end_local+interval '1 day'; end if;
    update public.notification_digest_batches set status='retrying',lease_owner=null,lease_expires_at=null,
      next_attempt_at=public.m12_03_first_local_occurrence(quiet_end_local,preference_record.timezone),
      safe_error_code='quiet_hours_deferred',version=version+1
    where organization_id=p_organization_id and id=p_batch_id;
    return query select 'deferred',null::jsonb; return;
  end if;
  item_count:=cardinality(b.dispatch_ids);
  if item_count is null or item_count not between 1 and 100 then
    update public.notification_digest_batches set status='cancelled',lease_owner=null,lease_expires_at=null,safe_error_code='invalid_batch_size',version=version+1 where organization_id=p_organization_id and id=p_batch_id;
    return query select 'cancelled',null::jsonb; return;
  end if;
  select u.email into recipient_email from public.organization_members m join public.users u on u.id=m.user_id and u.is_active where m.organization_id=p_organization_id and m.user_id=b.user_id;
  if recipient_email is null then
    update public.notification_digest_batches set status='cancelled',lease_owner=null,lease_expires_at=null,safe_error_code='recipient_unavailable',version=version+1 where organization_id=p_organization_id and id=p_batch_id;
    update public.notification_dispatches set status='cancelled',safe_error_code='recipient_unavailable',version=version+1 where organization_id=p_organization_id and id=any(b.dispatch_ids) and status='digest_pending';
    return query select 'cancelled',null::jsonb; return;
  end if;
  with valid as (
    select d.*, v.validity_ends_on
    from public.notification_dispatches d
    join public.notification_preferences pref on pref.organization_id=d.organization_id and pref.user_id=d.effective_recipient_user_id
    left join public.evidence_document_notification_outbox n on n.organization_id=d.organization_id and n.id=d.source_id and d.source_type like 'evidence_%'
    left join public.evidence_document_versions v on v.organization_id=n.organization_id and v.id=n.version_id
    where d.organization_id=p_organization_id and d.id=any(b.dispatch_ids) and d.status='digest_pending'
      and (pref.modes->>d.category) in ('daily','weekly')
      and public.m12_03_dispatch_source_valid(d.organization_id,d.id)
  ), invalid as (
    update public.notification_dispatches d
    set status='cancelled',safe_error_code='source_unavailable',version=version+1
    where d.organization_id=p_organization_id and d.id=any(b.dispatch_ids) and d.status='digest_pending'
      and not exists(select 1 from valid where valid.id=d.id)
    returning d.id
  )
  select count(*)::integer,
    jsonb_agg(jsonb_build_object(
      'title',coalesce(nullif(btrim(valid.safe_title),''),'Notification reminder'),
      'href',case when coalesce(valid.source_link,'') like '/%' then valid.source_link else '/notifications' end,
      'date',coalesce(valid.validity_ends_on::text,(valid.created_at::date)::text),
      'category',valid.category
    ) order by valid.created_at,valid.id)
  into valid_count,items
  from valid;
  update public.evidence_document_notification_outbox n
  set status='obsolete',lease_owner=null,lease_expires_at=null,last_error='source_unavailable'
  from public.notification_dispatches d
  where d.organization_id=p_organization_id and d.id=any(b.dispatch_ids)
    and d.status='cancelled' and d.source_type like 'evidence_%'
    and n.organization_id=d.organization_id and n.id=d.source_id and n.status in ('queued','leased');
  if coalesce(valid_count,0)=0 then
    update public.notification_digest_batches set status='cancelled',lease_owner=null,lease_expires_at=null,safe_error_code='source_unavailable',version=version+1 where organization_id=p_organization_id and id=p_batch_id;
    return query select 'cancelled',null::jsonb; return;
  end if;
  return query select 'ready',jsonb_build_object(
    'deliveryRef',b.id,
    'idempotencyKey','notification-digest:'||b.id::text,
    'recipient',jsonb_build_object('userId',b.user_id,'email',recipient_email),
    'payload',jsonb_build_object('kind','digest','items',coalesce(items,'[]'::jsonb))
  );
end $$;

create or replace function public.complete_notification_digest_batch_atomic(
  p_organization_id uuid,p_batch_id uuid,p_worker_id uuid,p_expected_version integer,p_outcome text,p_message_id_hash text default null,p_error_code text default null
) returns table(outcome text) language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.notification_digest_batches%rowtype; next_status text;
begin
  if p_outcome not in ('provider_accepted','delivered','failed','exhausted','cancelled') then return query select 'invalid_request'; return; end if;
  select * into b from public.notification_digest_batches where organization_id=p_organization_id and id=p_batch_id for update;
  if not found then return query select 'not_found'; return; end if;
  if b.status in ('provider_accepted','delivered') then return query select 'replayed'; return; end if;
  if b.status<>'leased' or b.lease_owner is distinct from p_worker_id or b.version<>p_expected_version then return query select 'conflict'; return; end if;
  next_status:=p_outcome;
  update public.notification_digest_batches set status=next_status,lease_owner=null,lease_expires_at=null,provider_message_id=p_message_id_hash,
    safe_error_code=case when next_status in ('failed','exhausted','cancelled') then coalesce(nullif(btrim(p_error_code),''),'provider_unavailable') else null end,version=version+1
  where organization_id=p_organization_id and id=p_batch_id;
  if next_status in ('provider_accepted','delivered') then
    update public.notification_dispatches set status=next_status,version=version+1,safe_error_code=null where organization_id=p_organization_id and id=any(b.dispatch_ids) and status='digest_pending';
    perform public.m12_03_mark_dispatch_sources_provider_accepted(p_organization_id,b.dispatch_ids);
  elsif next_status in ('failed','exhausted','cancelled') then
    update public.notification_dispatches set status=next_status,safe_error_code=coalesce(nullif(btrim(p_error_code),''),'provider_unavailable'),version=version+1 where organization_id=p_organization_id and id=any(b.dispatch_ids) and status='digest_pending';
  end if;
  insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
  values(p_organization_id,'notification.digest_'||next_status,'notification_digest_batch',p_batch_id::text,jsonb_build_object('itemCount',cardinality(b.dispatch_ids),'attempt',b.attempt_count));
  return query select 'completed';
end $$;

create or replace function public.fail_notification_digest_batch_atomic(
  p_organization_id uuid,p_batch_id uuid,p_worker_id uuid,p_expected_version integer,p_error_code text,p_retryable boolean
) returns table(outcome text) language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.notification_digest_batches%rowtype; next_status text;
begin
  select * into b from public.notification_digest_batches where organization_id=p_organization_id and id=p_batch_id and status='leased' and lease_owner=p_worker_id and version=p_expected_version for update;
  if not found then return query select 'conflict'; return; end if;
  next_status:=case when not p_retryable or b.attempt_count>=12 then 'exhausted' else 'retrying' end;
  update public.notification_digest_batches set status=next_status,lease_owner=null,lease_expires_at=null,safe_error_code=coalesce(nullif(btrim(p_error_code),''),'provider_unavailable'),
    next_attempt_at=case when next_status='exhausted' then next_attempt_at else clock_timestamp()+make_interval(secs=>least(3600,greatest(30,30*power(2,least(b.attempt_count,7))::integer))) end,version=version+1
  where organization_id=p_organization_id and id=p_batch_id;
  if next_status='exhausted' then
    update public.notification_dispatches set status='exhausted',safe_error_code=coalesce(nullif(btrim(p_error_code),''),'provider_unavailable'),version=version+1 where organization_id=p_organization_id and id=any(b.dispatch_ids) and status='digest_pending';
  end if;
  return query select case when next_status='exhausted' then 'exhausted' else 'retry_scheduled' end;
end $$;

do $$
declare v_signature text;
begin
  foreach v_signature in array array[
    'resolve_critical_notification_recipient(uuid,uuid,uuid,text)',
    'm12_03_local_time_in_quiet(time without time zone,time without time zone,time without time zone)',
    'm12_03_first_local_occurrence(timestamp without time zone,text)',
    'm12_03_digest_window(text,text,time without time zone,integer,timestamp with time zone)',
    'm12_03_evidence_dispatch_source_valid(uuid,uuid)',
    'm12_03_dispatch_source_valid(uuid,uuid)',
    'm12_03_mark_dispatch_sources_provider_accepted(uuid,uuid[])',
    'bridge_evidence_validity_notification_dispatches_atomic(uuid,integer)',
    'schedule_notification_digest_batches_atomic(uuid,timestamp with time zone,integer)',
    'list_due_notification_digest_organizations_atomic(uuid,integer)',
    'claim_notification_digest_batch_atomic(uuid,uuid,integer)',
    'prepare_notification_digest_batch_atomic(uuid,uuid,uuid,integer)',
    'complete_notification_digest_batch_atomic(uuid,uuid,uuid,integer,text,text,text)',
    'fail_notification_digest_batch_atomic(uuid,uuid,uuid,integer,text,boolean)'
  ] loop
    execute 'alter function public.'||v_signature||' owner to postgres';
  end loop;
end $$;

revoke all on function
  public.resolve_critical_notification_recipient(uuid,uuid,uuid,text),
  public.m12_03_local_time_in_quiet(time,time,time),
  public.m12_03_first_local_occurrence(timestamp,text),
  public.m12_03_digest_window(text,text,time,integer,timestamptz),
  public.m12_03_evidence_dispatch_source_valid(uuid,uuid),
  public.m12_03_dispatch_source_valid(uuid,uuid),
  public.m12_03_mark_dispatch_sources_provider_accepted(uuid,uuid[]),
  public.bridge_evidence_validity_notification_dispatches_atomic(uuid,integer),
  public.schedule_notification_digest_batches_atomic(uuid,timestamptz,integer),
  public.list_due_notification_digest_organizations_atomic(uuid,integer),
  public.claim_notification_digest_batch_atomic(uuid,uuid,integer),
  public.prepare_notification_digest_batch_atomic(uuid,uuid,uuid,integer),
  public.complete_notification_digest_batch_atomic(uuid,uuid,uuid,integer,text,text,text),
  public.fail_notification_digest_batch_atomic(uuid,uuid,uuid,integer,text,boolean)
from public,anon,authenticated;

grant execute on function
  public.resolve_critical_notification_recipient(uuid,uuid,uuid,text),
  public.bridge_evidence_validity_notification_dispatches_atomic(uuid,integer),
  public.schedule_notification_digest_batches_atomic(uuid,timestamptz,integer),
  public.list_due_notification_digest_organizations_atomic(uuid,integer),
  public.claim_notification_digest_batch_atomic(uuid,uuid,integer),
  public.prepare_notification_digest_batch_atomic(uuid,uuid,uuid,integer),
  public.complete_notification_digest_batch_atomic(uuid,uuid,uuid,integer,text,text,text),
  public.fail_notification_digest_batch_atomic(uuid,uuid,uuid,integer,text,boolean)
to service_role;

notify pgrst,'reload schema';

-- Preserve accountable recipient provenance for critical M6 routing. The
-- effective recipient remains recipient_user_id so the existing unique alert
-- recipient constraint dedupes alternate routes; original_recipient_user_id is
-- used for fresh send-time route revalidation.
alter table public.reporting_deadline_alert_deliveries
  add column if not exists original_recipient_user_id uuid;
alter table public.reporting_deadline_alert_deliveries
  add column if not exists prepared_recipient_user_id uuid references public.users(id) on delete restrict;
update public.reporting_deadline_alert_deliveries
set original_recipient_user_id=recipient_user_id
where original_recipient_user_id is null;
alter table public.reporting_deadline_alert_deliveries
  alter column original_recipient_user_id set not null;
do $$
begin
  if not exists(select 1 from pg_constraint where conname='reporting_deadline_alert_deliveries_original_recipient_fkey') then
    alter table public.reporting_deadline_alert_deliveries
      add constraint reporting_deadline_alert_deliveries_original_recipient_fkey
      foreign key(original_recipient_user_id) references public.users(id) on delete restrict;
  end if;
end $$;

create unique index if not exists reporting_deadline_alert_prepared_recipient_unique
  on public.reporting_deadline_alert_deliveries(organization_id,alert_id,prepared_recipient_user_id,channel)
  where prepared_recipient_user_id is not null and delivery_state<>'cancelled';

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
  insert into public.reporting_deadline_alert_deliveries(organization_id,alert_id,recipient_user_id,original_recipient_user_id,channel,due_at)
   select p_organization_id,v_alert_id,(route.recipient->>'userId')::uuid,m.user_id,'email',date_trunc('second',p_database_now)
   from public.organization_members m
   join public.users u on u.id=m.user_id and u.is_active
   cross join lateral public.resolve_critical_notification_recipient(p_organization_id,m.user_id,null,'reporting_deadline') route
   where m.organization_id=p_organization_id and m.role in ('owner','admin')
    and public.m5_triage_actor_has_permission(p_organization_id,m.user_id,'can_view_findings')
    and route.outcome='resolved'
   order by case m.role when 'owner' then 0 else 1 end,m.user_id
   on conflict(alert_id,recipient_user_id,channel) do nothing;
  if not exists(select 1 from public.reporting_deadline_alert_deliveries d
    where d.organization_id=p_organization_id and d.alert_id=v_alert_id) then
    insert into public.reporting_deadline_alert_deliveries(
      organization_id,alert_id,recipient_user_id,original_recipient_user_id,
      channel,due_at,delivery_state,last_error_code
    ) values(
      p_organization_id,v_alert_id,v_obligation.created_by_user_id,v_obligation.created_by_user_id,
      'email',date_trunc('second',p_database_now),'dead_letter','recipient_unavailable'
    );
  end if;
  v_created:=v_created+1;
 end loop;
 if v_elapsed>=100 and v_stage.state='running' then update public.reporting_obligation_stages set state='overdue',overdue_at=coalesce(overdue_at,due_at),version=version+1,updated_at=date_trunc('second',p_database_now) where organization_id=p_organization_id and id=v_stage.id; end if;
 return v_created;
end $$;

create or replace function public.get_reporting_deadline_alert_delivery_details(
  p_organization_id uuid,
  p_delivery_id uuid,
  p_worker_id text,
  p_expected_checkpoint_version integer
) returns table(outcome text,details jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_delivery public.reporting_deadline_alert_deliveries%rowtype;
  v_alert public.reporting_deadline_alerts%rowtype;
  v_stage public.reporting_obligation_stages%rowtype;
  v_obligation public.reporting_obligations%rowtype;
  v_route record;
  v_prepared_user_id uuid;
  v_email text;
begin
  select * into v_delivery from public.reporting_deadline_alert_deliveries d
  where d.organization_id=p_organization_id and d.id=p_delivery_id for update;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  if v_delivery.delivery_state<>'leased' or v_delivery.lease_owner is distinct from btrim(p_worker_id)
     or v_delivery.checkpoint_version<>p_expected_checkpoint_version then
    return query select 'conflict'::text,null::jsonb; return;
  end if;
  select * into v_alert from public.reporting_deadline_alerts a where a.organization_id=p_organization_id and a.id=v_delivery.alert_id;
  if v_alert.id is not null then
    perform 1 from public.reporting_deadline_alerts a
    where a.organization_id=p_organization_id and a.id=v_alert.id for update;
  end if;
  select * into v_stage from public.reporting_obligation_stages s where s.organization_id=p_organization_id and s.id=v_alert.stage_id;
  select * into v_obligation from public.reporting_obligations o where o.organization_id=p_organization_id and o.id=v_alert.obligation_id;
  if v_delivery.prepared_recipient_user_id is null then
    select * into v_route from public.resolve_critical_notification_recipient(p_organization_id,v_delivery.original_recipient_user_id,null,'reporting_deadline');
    v_prepared_user_id:=(v_route.recipient->>'userId')::uuid;
  else
    v_prepared_user_id:=v_delivery.prepared_recipient_user_id;
  end if;
  select u.email into v_email from public.users u
  where u.id=v_prepared_user_id and u.is_active
    and public.m12_03_user_can_receive_critical(p_organization_id,u.id,null,'reporting_deadline');
  if not found or v_alert.id is null or v_stage.id is null or v_obligation.id is null
     or v_obligation.status='cancelled' or v_stage.state in ('submitted','not_required')
     or v_email is null then
    update public.reporting_deadline_alert_deliveries
    set delivery_state='cancelled',cancelled_at=clock_timestamp(),lease_owner=null,lease_expires_at=null
    where organization_id=p_organization_id and id=v_delivery.id;
    return query select 'cancelled'::text,null::jsonb; return;
  end if;
  if v_delivery.prepared_recipient_user_id is null then
    if exists(select 1 from public.reporting_deadline_alert_deliveries other
      where other.organization_id=p_organization_id and other.alert_id=v_alert.id
        and other.id<>v_delivery.id and other.channel=v_delivery.channel
        and other.prepared_recipient_user_id=v_prepared_user_id and other.delivery_state<>'cancelled') then
      update public.reporting_deadline_alert_deliveries
      set delivery_state='cancelled',cancelled_at=clock_timestamp(),lease_owner=null,lease_expires_at=null
      where organization_id=p_organization_id and id=v_delivery.id;
      return query select 'cancelled'::text,null::jsonb; return;
    end if;
    update public.reporting_deadline_alert_deliveries set prepared_recipient_user_id=v_prepared_user_id
    where organization_id=p_organization_id and id=v_delivery.id;
  end if;
  return query select 'found'::text,jsonb_build_object(
    'deliveryId',v_delivery.id,
    'recipient',jsonb_build_object('userId',v_prepared_user_id,'email',v_email),
    'obligationId',v_obligation.id,
    'stageKind',v_stage.stage_kind,
    'thresholdPercent',v_alert.threshold_percent,
    'dueAt',public.m6_utc_second_z(v_alert.due_at),
    'idempotencyKey',v_alert.idempotency_key
  );
end $$;

create or replace function public.claim_reporting_deadline_alert_delivery_atomic(
  p_organization_id uuid,p_worker_id text,p_lease_seconds integer default 120
) returns table(outcome text,delivery jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare claimed public.reporting_deadline_alert_deliveries%rowtype;
begin
  if p_organization_id is null or char_length(btrim(coalesce(p_worker_id,''))) not between 1 and 200
    or p_lease_seconds not between 15 and 900 then
    return query select 'invalid_request',null::jsonb; return;
  end if;
  with expired as (
    select d.id from public.reporting_deadline_alert_deliveries d
    where d.organization_id=p_organization_id and d.delivery_state='leased'
      and d.lease_expires_at<=clock_timestamp()
    order by d.lease_expires_at,d.id limit 100 for update skip locked
  ), quarantined as (
    update public.reporting_deadline_alert_deliveries d
    set delivery_state='dead_letter',lease_owner=null,lease_expires_at=null,
      last_error_code='delivery_uncertain',checkpoint_version=checkpoint_version+1
    from expired where d.organization_id=p_organization_id and d.id=expired.id
    returning d.id,d.alert_id,d.delivery_attempts
  )
  insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
  select p_organization_id,'reporting.deadline_delivery_uncertain','reporting_deadline_alert_delivery',
    quarantined.id::text,jsonb_build_object('alertId',quarantined.alert_id,'attempt',quarantined.delivery_attempts)
  from quarantined;
  select * into claimed from public.reporting_deadline_alert_deliveries d
  where d.organization_id=p_organization_id and d.due_at<=clock_timestamp()
    and d.delivery_state in ('queued','retrying')
  order by d.due_at,d.id for update skip locked limit 1;
  if not found then return query select 'none_available',null::jsonb; return; end if;
  update public.reporting_deadline_alert_deliveries
  set delivery_state='leased',delivery_attempts=delivery_attempts+1,last_attempt_at=clock_timestamp(),
    lease_owner=btrim(p_worker_id),lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),
    checkpoint_version=checkpoint_version+1,last_error_code=null
  where organization_id=p_organization_id and id=claimed.id returning * into claimed;
  return query select 'claimed',jsonb_build_object('id',claimed.id,'organizationId',p_organization_id,
    'checkpointVersion',claimed.checkpoint_version,'alertId',claimed.alert_id,
    'recipientUserId',claimed.recipient_user_id,'channel',claimed.channel);
end $$;

create or replace function public.fail_reporting_deadline_alert_delivery_atomic(
  p_organization_id uuid,p_delivery_id uuid,p_worker_id text,p_expected_checkpoint_version integer,
  p_code text,p_retryable boolean
) returns table(outcome text) language plpgsql security definer set search_path=public,pg_temp as $$
declare delivery public.reporting_deadline_alert_deliveries%rowtype; next_state text;
begin
  select * into delivery from public.reporting_deadline_alert_deliveries d
  where d.organization_id=p_organization_id and d.id=p_delivery_id and d.delivery_state='leased'
    and d.lease_owner=btrim(p_worker_id) and d.checkpoint_version=p_expected_checkpoint_version for update;
  if not found then return query select 'conflict'; return; end if;
  next_state:=case when not p_retryable or delivery.delivery_attempts>=12 then 'dead_letter' else 'retrying' end;
  update public.reporting_deadline_alert_deliveries
  set delivery_state=next_state,lease_owner=null,lease_expires_at=null,prepared_recipient_user_id=null,
    last_error_code=left(coalesce(nullif(btrim(p_code),''),'provider_unavailable'),100),
    due_at=case when next_state='dead_letter' then due_at else clock_timestamp()+make_interval(
      secs=>least(3600,greatest(30,30*power(2,least(delivery.delivery_attempts,7))::integer))) end
  where organization_id=p_organization_id and id=p_delivery_id;
  return query select case when next_state='dead_letter' then 'dead_letter' else 'retry_scheduled' end;
end $$;

create or replace function public.reconcile_notification_ambiguous_leases_atomic(
  p_now timestamptz default clock_timestamp(),p_limit integer default 1000
) returns table(outcome text,dispatches integer,digests integer) language plpgsql security definer set search_path=public,pg_temp as $$
declare dispatch_count integer; digest_count integer;
begin
  if p_now is null or p_limit not between 1 and 10000 then return query select 'invalid_request',0,0; return; end if;
  with due as (
    select id from public.notification_dispatches where status='leased' and lease_expires_at<=p_now order by lease_expires_at,id limit p_limit for update skip locked
  ), changed as (
    update public.notification_dispatches d set status='exhausted',lease_owner=null,lease_expires_at=null,safe_error_code='lease_expired_ambiguous',version=version+1
    from due where due.id=d.id returning d.id
  ) select count(*)::integer into dispatch_count from changed;
  with due as (
    select id from public.notification_digest_batches where status='leased' and lease_expires_at<=p_now order by lease_expires_at,id limit p_limit for update skip locked
  ), changed as (
    update public.notification_digest_batches b set status='exhausted',lease_owner=null,lease_expires_at=null,safe_error_code='lease_expired_ambiguous',version=version+1
    from due where due.id=b.id returning b.id
  ) select count(*)::integer into digest_count from changed;
  return query select 'reconciled',coalesce(dispatch_count,0),coalesce(digest_count,0);
end $$;

do $$
declare v_signature text;
begin
  foreach v_signature in array array[
    'm6_materialize_reporting_deadline_alerts(uuid,uuid,timestamp with time zone)',
    'get_reporting_deadline_alert_delivery_details(uuid,uuid,text,integer)',
    'reconcile_notification_ambiguous_leases_atomic(timestamp with time zone,integer)'
  ] loop
    execute 'alter function public.'||v_signature||' owner to postgres';
  end loop;
end $$;

revoke all on function
  public.m6_materialize_reporting_deadline_alerts(uuid,uuid,timestamptz),
  public.get_reporting_deadline_alert_delivery_details(uuid,uuid,text,integer),
  public.reconcile_notification_ambiguous_leases_atomic(timestamptz,integer)
from public,anon,authenticated;

grant execute on function
  public.m6_materialize_reporting_deadline_alerts(uuid,uuid,timestamptz),
  public.get_reporting_deadline_alert_delivery_details(uuid,uuid,text,integer),
  public.reconcile_notification_ambiguous_leases_atomic(timestamptz,integer)
to service_role;
