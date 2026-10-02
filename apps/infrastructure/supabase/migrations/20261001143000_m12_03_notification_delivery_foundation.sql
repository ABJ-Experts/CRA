-- M12-03: shared notification preferences plus optional unified dispatch.
-- Critical M2/M6 queues remain source-owned; optional categories can bridge into
-- this dispatch ledger when an organization is explicitly switched to unified.

create or replace function public.m12_03_notification_modes_valid(p_modes jsonb)
returns boolean language sql immutable set search_path=public,pg_temp as $$
  select jsonb_typeof(p_modes)='object'
    and p_modes ?& array['finding_triage','evidence','supplier_owner']
    and not exists (
      select 1 from jsonb_object_keys(p_modes) key
      where key not in ('finding_triage','evidence','supplier_owner')
    )
    and not exists (
      select 1 from jsonb_each_text(p_modes) entry(key,value)
      where value not in ('immediate','daily','weekly','off')
    )
$$;

alter table public.organization_settings
  add column if not exists notification_delivery_mode text not null default 'legacy',
  drop constraint if exists organization_settings_notification_delivery_mode_check,
  add constraint organization_settings_notification_delivery_mode_check
    check (notification_delivery_mode in ('legacy','unified'));

create table if not exists public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  version integer not null default 1 check (version > 0),
  modes jsonb not null default '{"finding_triage":"immediate","evidence":"immediate","supplier_owner":"immediate"}'::jsonb
    check (public.m12_03_notification_modes_valid(modes)),
  timezone text not null default 'Etc/UTC'
    check (timezone = btrim(timezone) and char_length(timezone) between 1 and 100 and timezone !~ '[[:cntrl:]]'),
  digest_local_time time not null default time '09:00',
  weekly_day integer not null default 1 check (weekly_day between 1 and 7),
  quiet_start time,
  quiet_end time,
  critical_alternate_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references public.users(id) on delete set null,
  unique (organization_id,user_id),
  foreign key (organization_id,user_id) references public.organization_members(organization_id,user_id) on delete cascade,
  check ((quiet_start is null) = (quiet_end is null)),
  check (quiet_start is null or quiet_start <> quiet_end),
  check (critical_alternate_user_id is null or critical_alternate_user_id <> user_id)
);

create or replace function public.m12_03_validate_preference_timezone()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=new.timezone) then
    raise check_violation using message='invalid notification timezone';
  end if;
  return new;
end $$;

drop trigger if exists validate_notification_preference_timezone on public.notification_preferences;
create trigger validate_notification_preference_timezone
  before insert or update of timezone on public.notification_preferences
  for each row execute function public.m12_03_validate_preference_timezone();

do $$ begin
  if exists(select 1 from public.notification_preferences p
    where not exists(select 1 from pg_catalog.pg_timezone_names z where z.name=p.timezone)) then
    raise check_violation using message='existing notification timezone is invalid';
  end if;
end $$;

alter table public.notification_preferences
  drop constraint if exists notification_preferences_organization_id_critical_alternat_fkey;
do $$ begin
  if not exists(select 1 from pg_constraint
    where conrelid='public.notification_preferences'::regclass
      and conname='notification_preferences_critical_alternate_user_id_fkey') then
    alter table public.notification_preferences
      add constraint notification_preferences_critical_alternate_user_id_fkey
      foreign key(critical_alternate_user_id) references public.users(id) on delete set null;
  end if;
end $$;

create table if not exists public.notification_dispatches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  category text not null check (category in ('finding_triage','evidence','supplier_owner')),
  source_type text not null check (source_type in ('evidence_validity')),
  source_id uuid not null,
  source_subtype text not null,
  source_link text,
  safe_title text,
  original_recipient_user_id uuid not null references public.users(id) on delete restrict,
  effective_recipient_user_id uuid references public.users(id) on delete restrict,
  status text not null default 'queued'
    check (status in ('queued','leased','provider_accepted','delivered','retrying','failed','exhausted','cancelled','suppressed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default clock_timestamp(),
  last_attempt_at timestamptz,
  lease_owner uuid,
  lease_expires_at timestamptz,
  version integer not null default 1 check (version > 0),
  safe_error_code text check (safe_error_code is null or safe_error_code ~ '^[a-z0-9_]{1,64}$'),
  provider_message_id text check (provider_message_id is null or (char_length(provider_message_id) between 1 and 500 and provider_message_id !~ '[[:cntrl:]]')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id,id),
  unique (organization_id,source_type,source_id,original_recipient_user_id),
  check ((status='leased') = (lease_owner is not null and lease_expires_at is not null))
);

create table if not exists public.notification_digest_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete restrict,
  category text not null check (category in ('finding_triage','evidence','supplier_owner')),
  window_start timestamptz not null,
  window_end timestamptz not null,
  dispatch_ids uuid[] not null check (cardinality(dispatch_ids) between 1 and 100),
  status text not null default 'queued' check (status in ('queued','leased','provider_accepted','delivered','failed','exhausted')),
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id,id),
  check (window_start < window_end)
);

alter table public.notification_dispatches
  drop constraint if exists notification_dispatches_organization_id_original_recipient_fkey,
  drop constraint if exists notification_dispatches_organization_id_effective_recipien_fkey;
alter table public.notification_digest_batches
  drop constraint if exists notification_digest_batches_organization_id_user_id_fkey;

create index if not exists notification_dispatches_due_idx
  on public.notification_dispatches(organization_id,status,next_attempt_at,id)
  where status in ('queued','retrying','leased');
create index if not exists notification_dispatches_recipient_idx
  on public.notification_dispatches(organization_id,effective_recipient_user_id,created_at desc,id desc);

drop trigger if exists set_notification_preferences_updated_at on public.notification_preferences;
create trigger set_notification_preferences_updated_at
  before update on public.notification_preferences
  for each row execute function public.set_updated_at();
drop trigger if exists set_notification_dispatches_updated_at on public.notification_dispatches;
create trigger set_notification_dispatches_updated_at
  before update on public.notification_dispatches
  for each row execute function public.set_updated_at();

alter table public.notification_preferences enable row level security;
alter table public.notification_dispatches enable row level security;
alter table public.notification_digest_batches enable row level security;
revoke all on table public.notification_preferences, public.notification_dispatches, public.notification_digest_batches
  from public, anon, authenticated;
grant select,insert,update,delete on table public.notification_preferences, public.notification_dispatches, public.notification_digest_batches
  to service_role;

create or replace function public.m12_03_actor_can_manage_notification_user(
  p_organization_id uuid,p_actor_user_id uuid,p_user_id uuid
) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select p_organization_id is not null and p_actor_user_id is not null and p_user_id is not null
    and exists (
      select 1 from public.organization_members m join public.users u on u.id=m.user_id and u.is_active
      where m.organization_id=p_organization_id and m.user_id=p_actor_user_id
    )
    and exists (
      select 1 from public.organization_members m join public.users u on u.id=m.user_id and u.is_active
      where m.organization_id=p_organization_id and m.user_id=p_user_id
    )
    and (
      p_actor_user_id=p_user_id
      or public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_edit_organization')
    )
$$;

create or replace function public.m12_03_actor_can_manage_critical_route(
  p_organization_id uuid,p_actor_user_id uuid,p_user_id uuid
) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select p_organization_id is not null and p_actor_user_id is not null and p_user_id is not null
    and exists (
      select 1 from public.organization_members m join public.users u on u.id=m.user_id and u.is_active
      where m.organization_id=p_organization_id and m.user_id=p_actor_user_id and m.role in ('owner','admin')
    )
    and exists (
      select 1 from public.organization_members m join public.users u on u.id=m.user_id and u.is_active
      where m.organization_id=p_organization_id and m.user_id=p_user_id
    )
    and public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_edit_organization')
$$;


create or replace function public.m12_03_actor_has_effective_permission(
  p_organization_id uuid,p_actor_user_id uuid,p_permission_key text
) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  with membership as (
    select member.role from public.organization_members member
    join public.users user_record on user_record.id = member.user_id and user_record.is_active
    join public.organizations organization on organization.id = member.organization_id and organization.is_active
    where member.organization_id = p_organization_id and member.user_id = p_actor_user_id
  ), base_permissions as (
    select role, case p_permission_key
      when 'can_view_audit' then role in ('owner','admin')
      when 'can_view_products' then true
      when 'can_view_evidence' then true
      when 'can_view_findings' then true
      when 'can_edit_organization' then role = 'owner'
      else public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,p_permission_key)
    end as granted
    from membership
  ), custom_permissions as (
    select bool_or((custom_role.permissions ->> p_permission_key)::boolean) as granted
    from membership join public.user_role_assignments assignment
      on assignment.organization_id = p_organization_id and assignment.user_id = p_actor_user_id
    join public.custom_roles custom_role
      on custom_role.organization_id = p_organization_id and custom_role.id = assignment.role_id
    where custom_role.is_active and not custom_role.is_deleted
      and jsonb_typeof(custom_role.permissions -> p_permission_key) = 'boolean'
      and (custom_role.permissions ->> p_permission_key)::boolean
  ), override_permissions as (
    select case when jsonb_typeof(permission_override.permissions -> p_permission_key) = 'boolean'
      then (permission_override.permissions ->> p_permission_key)::boolean end as granted
    from base_permissions base_permission left join public.base_role_permission_overrides permission_override
      on permission_override.organization_id = p_organization_id
      and permission_override.base_role = base_permission.role
  ) select coalesce((select granted from override_permissions where granted is not null limit 1),
    (select coalesce(base_permissions.granted, false) or coalesce(custom_permissions.granted, false)
      from base_permissions cross join custom_permissions), false)
$$;

create or replace function public.m12_03_preferences_json(p_organization_id uuid,p_user_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'preferences', jsonb_build_object(
      'organizationId',p.organization_id,
      'userId',p.user_id,
      'version',p.version,
      'modes',p.modes,
      'schedule',jsonb_build_object(
        'timezone',p.timezone,
        'localTime',to_char(p.digest_local_time,'HH24:MI'),
        'weekday',p.weekly_day,
        'quietHours',case when p.quiet_start is null then null else jsonb_build_object('start',to_char(p.quiet_start,'HH24:MI'),'end',to_char(p.quiet_end,'HH24:MI')) end
      )
    )
  )
  from public.notification_preferences p
  where p.organization_id=p_organization_id and p.user_id=p_user_id
$$;

create or replace function public.m12_03_route_json(p_organization_id uuid,p_user_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'route', jsonb_build_object(
      'organizationId',p.organization_id,
      'userId',p.user_id,
      'alternateUserId',p.critical_alternate_user_id,
      'version',p.version
    )
  )
  from public.notification_preferences p
  where p.organization_id=p_organization_id and p.user_id=p_user_id
$$;

create or replace function public.m12_03_user_can_receive_critical(
  p_organization_id uuid,p_user_id uuid,p_product_id uuid,p_category text
) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select p_organization_id is not null and p_user_id is not null
    and p_category in ('support_period','reporting_deadline')
    and exists (
      select 1 from public.organization_members m join public.users u on u.id=m.user_id and u.is_active
      where m.organization_id=p_organization_id and m.user_id=p_user_id
    )
    and (
      (p_category='reporting_deadline' and public.m5_triage_actor_has_permission(p_organization_id,p_user_id,'can_view_findings'))
      or
      (p_category='support_period'
        and public.m12_03_actor_has_effective_permission(p_organization_id,p_user_id,'can_view_products')
        and (p_product_id is null or exists(select 1 from public.products p where p.organization_id=p_organization_id and p.id=p_product_id and p.archived_at is null)))
    )
$$;

create or replace function public.resolve_critical_notification_recipient(
  p_organization_id uuid,p_original_user_id uuid,p_product_id uuid,p_category text
) returns table(outcome text,recipient jsonb) language plpgsql stable security definer set search_path=public,pg_temp as $$
declare alternate_user_id uuid; effective_user_id uuid; effective_email text;
begin
  if p_organization_id is null or p_category not in ('support_period','reporting_deadline') then
    return query select 'unresolved',null::jsonb; return;
  end if;
  if p_original_user_id is not null
    and public.m12_03_user_can_receive_critical(p_organization_id,p_original_user_id,p_product_id,p_category)
    and exists(select 1 from public.organization_members m where m.organization_id=p_organization_id
      and m.user_id=p_original_user_id and m.role in ('owner','admin')) then
    select p.critical_alternate_user_id into alternate_user_id
    from public.notification_preferences p
    where p.organization_id=p_organization_id and p.user_id=p_original_user_id;
    if alternate_user_id is not null
      and public.m12_03_user_can_receive_critical(p_organization_id,alternate_user_id,p_product_id,p_category)
      and exists(select 1 from public.organization_members m where m.organization_id=p_organization_id
        and m.user_id=alternate_user_id and m.role in ('owner','admin')) then
      effective_user_id:=alternate_user_id;
    else
      effective_user_id:=p_original_user_id;
    end if;
  else
    select m.user_id into effective_user_id from public.organization_members m
    join public.users u on u.id=m.user_id and u.is_active
    where m.organization_id=p_organization_id and m.role in ('owner','admin')
      and public.m12_03_user_can_receive_critical(p_organization_id,m.user_id,p_product_id,p_category)
    order by case m.role when 'owner' then 0 else 1 end,m.user_id limit 1;
  end if;
  if effective_user_id is null then return query select 'unresolved',null::jsonb; return; end if;
  select u.email into effective_email from public.users u where u.id=effective_user_id and u.is_active;
  if effective_email is null then return query select 'unresolved',null::jsonb; return; end if;
  return query select 'resolved',jsonb_build_object('userId',effective_user_id,'email',effective_email);
end $$;

create or replace function public.m12_03_ensure_notification_preference(
  p_organization_id uuid,p_user_id uuid
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into public.notification_preferences(organization_id,user_id,timezone)
  select p_organization_id,p_user_id,coalesce(
    (select s.timezone from public.organization_settings s where s.organization_id=p_organization_id),
    'Etc/UTC'
  )
  on conflict(organization_id,user_id) do nothing;
end $$;

create or replace function public.get_notification_preferences_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_user_id uuid
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.m12_03_actor_can_manage_notification_user(p_organization_id,p_actor_user_id,p_user_id) then
    return query select 'forbidden',null::jsonb; return;
  end if;
  perform public.m12_03_ensure_notification_preference(p_organization_id,p_user_id);
  return query select 'found',public.m12_03_preferences_json(p_organization_id,p_user_id);
end $$;

create or replace function public.update_notification_preferences_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_user_id uuid,p_expected_version integer,
  p_modes jsonb,p_schedule jsonb,p_idempotency_key uuid,p_reason text default null
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare
  pref public.notification_preferences%rowtype;
  prior public.audit_logs%rowtype;
  digest text;
  quiet jsonb;
  new_timezone text;
  new_local_time time;
  new_weekday integer;
  new_quiet_start time;
  new_quiet_end time;
  response jsonb;
begin
  if not public.m12_03_actor_can_manage_notification_user(p_organization_id,p_actor_user_id,p_user_id)
    or p_expected_version is null or p_expected_version < 0 or p_idempotency_key is null
    or not public.m12_03_notification_modes_valid(p_modes) then
    return query select 'forbidden',null::jsonb; return;
  end if;
  if jsonb_typeof(p_schedule)<>'object'
    or not (p_schedule ?& array['timezone','localTime','weekday','quietHours'])
    or exists(select 1 from jsonb_object_keys(p_schedule) key where key not in ('timezone','localTime','weekday','quietHours')) then
    return query select 'invalid_request',null::jsonb; return;
  end if;
  new_timezone:=btrim(p_schedule->>'timezone');
  if new_timezone is null or not exists(select 1 from pg_timezone_names where name=new_timezone) then
    return query select 'invalid_request',null::jsonb; return;
  end if;
  if coalesce(p_schedule->>'localTime','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    return query select 'invalid_request',null::jsonb; return;
  end if;
  new_local_time:=(p_schedule->>'localTime')::time;
  if jsonb_typeof(p_schedule->'weekday')<>'number' or coalesce(p_schedule->>'weekday','') !~ '^[1-7]$' then
    return query select 'invalid_request',null::jsonb; return;
  end if;
  new_weekday:=(p_schedule->>'weekday')::integer;
  if new_weekday not between 1 and 7 then return query select 'invalid_request',null::jsonb; return; end if;
  quiet:=p_schedule->'quietHours';
  if quiet is null or quiet='null'::jsonb then
    new_quiet_start:=null; new_quiet_end:=null;
  elsif jsonb_typeof(quiet)='object' and quiet ?& array['start','end']
    and not exists(select 1 from jsonb_object_keys(quiet) key where key not in ('start','end'))
    and quiet->>'start' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and quiet->>'end' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and quiet->>'start' <> quiet->>'end' then
    new_quiet_start:=(quiet->>'start')::time; new_quiet_end:=(quiet->>'end')::time;
  else
    return query select 'invalid_request',null::jsonb; return;
  end if;
  digest:=encode(extensions.digest(jsonb_build_object('expectedVersion',p_expected_version,'modes',p_modes,'schedule',p_schedule)::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(concat_ws('|',p_organization_id,p_actor_user_id,p_idempotency_key),0));
  select * into prior from public.audit_logs a
  where a.organization_id=p_organization_id and a.user_id=p_actor_user_id
    and a.action='notification.preferences_updated'
    and a.changes->>'idempotencyKey'=p_idempotency_key::text
  limit 1;
  if found then
    if prior.changes->>'payloadDigest'<>digest then return query select 'idempotency_conflict',null::jsonb; return; end if;
    return query select 'replayed',prior.changes->'result'; return;
  end if;
  perform public.m12_03_ensure_notification_preference(p_organization_id,p_user_id);
  select * into pref from public.notification_preferences where organization_id=p_organization_id and user_id=p_user_id for update;
  if pref.version<>p_expected_version then
    return query select 'conflict',public.m12_03_preferences_json(p_organization_id,p_user_id); return;
  end if;
  update public.notification_preferences
    set modes=p_modes,timezone=new_timezone,digest_local_time=new_local_time,weekly_day=new_weekday,
        quiet_start=new_quiet_start,quiet_end=new_quiet_end,version=version+1,updated_by=p_actor_user_id
    where organization_id=p_organization_id and user_id=p_user_id;
  response:=public.m12_03_preferences_json(p_organization_id,p_user_id);
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
  values(p_organization_id,p_actor_user_id,'notification.preferences_updated','notification_preferences',p_user_id::text,
    jsonb_build_object('idempotencyKey',p_idempotency_key,'payloadDigest',digest,'reason',nullif(btrim(coalesce(p_reason,'')),''),'result',response));
  return query select 'updated',response;
end $$;

create or replace function public.get_critical_notification_route_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_user_id uuid
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.m12_03_actor_can_manage_critical_route(p_organization_id,p_actor_user_id,p_user_id) then
    return query select 'forbidden',null::jsonb; return;
  end if;
  perform public.m12_03_ensure_notification_preference(p_organization_id,p_user_id);
  return query select 'found',public.m12_03_route_json(p_organization_id,p_user_id);
end $$;

create or replace function public.update_critical_notification_route_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_user_id uuid,p_expected_version integer,
  p_alternate_user_id uuid,p_idempotency_key uuid
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare pref public.notification_preferences%rowtype; prior public.audit_logs%rowtype; digest text; response jsonb;
begin
  if not public.m12_03_actor_can_manage_critical_route(p_organization_id,p_actor_user_id,p_user_id)
    or p_expected_version is null or p_expected_version<0 or p_idempotency_key is null
    or p_alternate_user_id=p_user_id then
    return query select 'forbidden',null::jsonb; return;
  end if;
  if p_alternate_user_id is not null and not exists(
    select 1 from public.organization_members m join public.users u on u.id=m.user_id and u.is_active
    where m.organization_id=p_organization_id and m.user_id=p_alternate_user_id and m.role in ('owner','admin')
      and public.m5_triage_actor_has_permission(p_organization_id,p_alternate_user_id,'can_view_findings')
      and public.m12_03_actor_has_effective_permission(p_organization_id,p_alternate_user_id,'can_view_products')
  ) then
    return query select 'invalid_request',null::jsonb; return;
  end if;
  digest:=encode(extensions.digest(jsonb_build_object('expectedVersion',p_expected_version,'alternateUserId',p_alternate_user_id)::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(concat_ws('|',p_organization_id,p_actor_user_id,p_idempotency_key),0));
  select * into prior from public.audit_logs a
  where a.organization_id=p_organization_id and a.user_id=p_actor_user_id
    and a.action='notification.critical_route_updated'
    and a.changes->>'idempotencyKey'=p_idempotency_key::text
  limit 1;
  if found then
    if prior.changes->>'payloadDigest'<>digest then return query select 'idempotency_conflict',null::jsonb; return; end if;
    return query select 'replayed',prior.changes->'result'; return;
  end if;
  perform public.m12_03_ensure_notification_preference(p_organization_id,p_user_id);
  select * into pref from public.notification_preferences where organization_id=p_organization_id and user_id=p_user_id for update;
  if pref.version<>p_expected_version then return query select 'conflict',public.m12_03_route_json(p_organization_id,p_user_id); return; end if;
  update public.notification_preferences
  set critical_alternate_user_id=p_alternate_user_id,version=version+1,updated_by=p_actor_user_id
  where organization_id=p_organization_id and user_id=p_user_id;
  response:=public.m12_03_route_json(p_organization_id,p_user_id);
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
  values(p_organization_id,p_actor_user_id,'notification.critical_route_updated','notification_preferences',p_user_id::text,
    jsonb_build_object('idempotencyKey',p_idempotency_key,'payloadDigest',digest,'result',response));
  return query select 'updated',response;
end $$;

alter table public.reporting_deadline_alert_deliveries
  add column if not exists original_recipient_user_id uuid;
update public.reporting_deadline_alert_deliveries
set original_recipient_user_id=recipient_user_id where original_recipient_user_id is null;
alter table public.reporting_deadline_alert_deliveries
  alter column original_recipient_user_id set not null;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='reporting_deadline_alert_deliveries_original_recipient_fkey') then
    alter table public.reporting_deadline_alert_deliveries
      add constraint reporting_deadline_alert_deliveries_original_recipient_fkey
      foreign key(original_recipient_user_id) references public.users(id) on delete restrict;
  end if;
end $$;

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
  v_created:=v_created+1;
 end loop;
 if v_elapsed>=100 and v_stage.state='running' then update public.reporting_obligation_stages set state='overdue',overdue_at=coalesce(overdue_at,due_at),version=version+1,updated_at=date_trunc('second',p_database_now) where organization_id=p_organization_id and id=v_stage.id; end if;
 return v_created;
end $$;

create or replace function public.claim_evidence_validity_notification_atomic(
  p_organization_id uuid,p_worker_id uuid,p_lease_seconds integer
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare n public.evidence_document_notification_outbox%rowtype; v_email text; v_version_info record; v_delivery_mode text;
begin
  if p_organization_id is null or p_worker_id is null or p_lease_seconds not between 30 and 900 then return null; end if;
  select notification_delivery_mode into v_delivery_mode from public.organization_settings
  where organization_id=p_organization_id for share;
  if v_delivery_mode='unified' then
    return null;
  end if;
  select * into n from public.evidence_document_notification_outbox x where x.organization_id=p_organization_id
    and x.event_type='evidence_validity_expiring' and x.status in ('queued','leased') and x.next_attempt_at<=clock_timestamp()
    and (x.status='queued' or x.lease_expires_at<=clock_timestamp()) order by x.next_attempt_at,x.created_at,x.id for update skip locked limit 1;
  if not found then return null; end if;
  select u.email into v_email from public.users u where u.id=n.owner_user_id
    and public.m8_evidence_actor_active(p_organization_id,u.id)
    and public.m5_triage_actor_has_permission(p_organization_id,u.id,'can_view_evidence') limit 1;
  if v_email is null then
    update public.evidence_document_notification_outbox set status='recipient_unavailable',sent_at=clock_timestamp(),last_error='recipient unavailable',lease_owner=null,lease_expires_at=null where organization_id=p_organization_id and id=n.id;
    return jsonb_build_object('outboxId',n.id,'outcome','recipient_unavailable');
  end if;
  select version_record.id,version_record.document_id,version_record.title,version_record.validity_ends_on,coalesce((select jsonb_agg(vp.product_id order by vp.product_id) from public.evidence_document_version_products vp join public.products p on p.organization_id=vp.organization_id and p.id=vp.product_id and p.archived_at is null where vp.organization_id=version_record.organization_id and vp.version_id=version_record.id),'[]'::jsonb) product_ids into v_version_info from public.evidence_document_versions version_record where version_record.organization_id=p_organization_id and version_record.id=n.version_id and version_record.processing_state='clean';
  if not found or jsonb_array_length(v_version_info.product_ids)=0 then
    update public.evidence_document_notification_outbox set status='obsolete',last_error='evidence unavailable',lease_owner=null,lease_expires_at=null where organization_id=p_organization_id and id=n.id;
    return null;
  end if;
  update public.evidence_document_notification_outbox set status='leased',lease_owner=p_worker_id,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),attempt_count=attempt_count+1,last_error=null where organization_id=p_organization_id and id=n.id;
  return jsonb_build_object('outboxId',n.id,'email',v_email,'eventType',n.event_type,'thresholdDays',n.threshold_days,'versionId',v_version_info.id,'documentId',v_version_info.document_id,'title',v_version_info.title,'validUntil',v_version_info.validity_ends_on::text,'productIds',v_version_info.product_ids);
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
begin
  select * into v_delivery from public.reporting_deadline_alert_deliveries d
  where d.organization_id=p_organization_id and d.id=p_delivery_id for update;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  if v_delivery.delivery_state<>'leased' or v_delivery.lease_owner is distinct from btrim(p_worker_id)
     or v_delivery.checkpoint_version<>p_expected_checkpoint_version then
    return query select 'conflict'::text,null::jsonb; return;
  end if;
  select * into v_alert from public.reporting_deadline_alerts a where a.organization_id=p_organization_id and a.id=v_delivery.alert_id;
  select * into v_stage from public.reporting_obligation_stages s where s.organization_id=p_organization_id and s.id=v_alert.stage_id;
  select * into v_obligation from public.reporting_obligations o where o.organization_id=p_organization_id and o.id=v_alert.obligation_id;
  select * into v_route from public.resolve_critical_notification_recipient(p_organization_id,v_delivery.recipient_user_id,null,'reporting_deadline');
  if not found or v_alert.id is null or v_stage.id is null or v_obligation.id is null
     or v_obligation.status='cancelled' or v_stage.state in ('submitted','not_required')
     or v_route.outcome<>'resolved' then
    update public.reporting_deadline_alert_deliveries
    set delivery_state='cancelled',cancelled_at=clock_timestamp(),lease_owner=null,lease_expires_at=null
    where organization_id=p_organization_id and id=v_delivery.id;
    return query select 'cancelled'::text,null::jsonb; return;
  end if;
  return query select 'found'::text,jsonb_build_object(
    'deliveryId',v_delivery.id,
    'recipient',v_route.recipient,
    'obligationId',v_obligation.id,
    'stageKind',v_stage.stage_kind,
    'thresholdPercent',v_alert.threshold_percent,
    'dueAt',public.m6_utc_second_z(v_alert.due_at),
    'idempotencyKey',v_alert.idempotency_key
  );
end $$;

alter table public.reporting_deadline_alert_deliveries
  drop constraint if exists reporting_deadline_alert_deliveries_delivery_state_check,
  add constraint reporting_deadline_alert_deliveries_delivery_state_check
    check (delivery_state in ('queued','leased','retrying','provider_accepted','delivered','cancelled','dead_letter')),
  drop constraint if exists reporting_deadline_alert_deliveries_check1,
  drop constraint if exists reporting_deadline_alert_deliveries_provider_accepted_check,
  add constraint reporting_deadline_alert_deliveries_provider_accepted_check
    check ((delivery_state in ('provider_accepted','delivered')) = (delivered_at is not null)),
  drop constraint if exists reporting_deadline_alert_deliveries_check2,
  drop constraint if exists reporting_deadline_alert_deliveries_cancelled_check,
  add constraint reporting_deadline_alert_deliveries_cancelled_check
    check ((delivery_state = 'cancelled') = (cancelled_at is not null));

create or replace function public.complete_reporting_deadline_alert_delivery_atomic(p_organization_id uuid,p_delivery_id uuid,p_worker_id text,p_expected_checkpoint_version integer)
returns table(outcome text) language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.reporting_deadline_alert_deliveries
  set delivery_state='provider_accepted',delivered_at=clock_timestamp(),lease_owner=null,lease_expires_at=null,last_error_code=null
  where organization_id=p_organization_id and id=p_delivery_id and delivery_state='leased' and lease_owner=btrim(p_worker_id) and checkpoint_version=p_expected_checkpoint_version;
  if found then return query select 'completed'::text; else return query select 'conflict'::text; end if;
end $$;

create or replace function public.bridge_evidence_validity_notification_dispatches_atomic(
  p_organization_id uuid,p_limit integer default 100
) returns table(outcome text,created integer) language plpgsql security definer set search_path=public,pg_temp as $$
declare created_count integer;
begin
  if p_organization_id is null or p_limit not between 1 and 1000 then return query select 'invalid_request',0; return; end if;
  if not exists(select 1 from public.organization_settings where organization_id=p_organization_id and notification_delivery_mode='unified') then
    return query select 'legacy',0; return;
  end if;
  insert into public.notification_dispatches(
    organization_id,category,source_type,source_id,source_subtype,source_link,safe_title,
    original_recipient_user_id,effective_recipient_user_id,next_attempt_at
  )
  select n.organization_id,'evidence','evidence_validity',n.id,n.event_type,
    case when first_product.product_id is null then null else '/products/'||first_product.product_id::text||'/evidence' end,
    left(v.title,500),n.owner_user_id,n.owner_user_id,n.next_attempt_at
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
    and coalesce(pref.modes->>'evidence','immediate')='immediate'
    and public.m8_evidence_actor_active(p_organization_id,n.owner_user_id)
    and public.m5_triage_actor_has_permission(p_organization_id,n.owner_user_id,'can_view_evidence')
  order by n.next_attempt_at,n.created_at,n.id
  limit p_limit
  on conflict(organization_id,source_type,source_id,original_recipient_user_id) do nothing;
  get diagnostics created_count=row_count;
  return query select 'bridged',created_count;
end $$;

create or replace function public.list_due_notification_dispatch_organizations_atomic(
  p_after_organization_id uuid default null,p_limit integer default 1000
) returns table(organization_id uuid) language sql stable security definer set search_path=public,pg_temp as $$
  select distinct d.organization_id from public.notification_dispatches d
  where p_limit between 1 and 10000
    and (p_after_organization_id is null or d.organization_id > p_after_organization_id)
    and d.next_attempt_at<=clock_timestamp()
    and d.status in ('queued','retrying')
  order by d.organization_id limit p_limit
$$;

create or replace function public.m12_03_dispatch_row_json(p_dispatch public.notification_dispatches)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'deliveryRef',p_dispatch.id,
    'category',p_dispatch.category,
    'status',case when p_dispatch.status in ('leased','retrying') then 'attempted' when p_dispatch.status='suppressed' then 'cancelled' else p_dispatch.status end,
    'sourceType',p_dispatch.source_type,
    'sourceId',p_dispatch.source_id,
    'originalRecipientUserId',p_dispatch.original_recipient_user_id,
    'effectiveRecipientUserId',p_dispatch.effective_recipient_user_id,
    'attemptCount',p_dispatch.attempt_count,
    'lastAttemptAt',case when p_dispatch.last_attempt_at is null then null else to_char(p_dispatch.last_attempt_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
    'nextAttemptAt',case when p_dispatch.status in ('queued','retrying','leased') then to_char(p_dispatch.next_attempt_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') else null end,
    'safeErrorCode',p_dispatch.safe_error_code,
    'createdAt',to_char(p_dispatch.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'updatedAt',to_char(p_dispatch.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'version',p_dispatch.version
  )
$$;

create or replace function public.claim_notification_dispatch_atomic(
  p_organization_id uuid,p_worker_id uuid,p_lease_seconds integer
) returns table(outcome text,dispatch jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.notification_dispatches%rowtype; delivery_mode text;
begin
  if p_organization_id is null or p_worker_id is null or p_lease_seconds not between 30 and 900 then return query select 'invalid_request',null::jsonb; return; end if;
  select notification_delivery_mode into delivery_mode from public.organization_settings
  where organization_id=p_organization_id for share;
  if delivery_mode is distinct from 'unified' then return query select 'none_available',null::jsonb; return; end if;
  select * into d from public.notification_dispatches x
  where x.organization_id=p_organization_id and x.next_attempt_at<=clock_timestamp()
    and x.status in ('queued','retrying')
  order by x.next_attempt_at,x.created_at,x.id for update skip locked limit 1;
  if not found then return query select 'none_available',null::jsonb; return; end if;
  update public.notification_dispatches
  set status='leased',lease_owner=p_worker_id,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),
      attempt_count=attempt_count+1,last_attempt_at=clock_timestamp(),version=version+1,safe_error_code=null
  where organization_id=p_organization_id and id=d.id returning * into d;
  return query select 'claimed',jsonb_build_object(
    'dispatchId',d.id,'leaseOwner',d.lease_owner,'checkpointVersion',d.version
  );
end $$;

create or replace function public.prepare_notification_dispatch_atomic(
  p_organization_id uuid,p_dispatch_id uuid,p_worker_id uuid,p_expected_version integer
) returns table(outcome text,delivery jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.notification_dispatches%rowtype; recipient_email text; n public.evidence_document_notification_outbox%rowtype; v public.evidence_document_versions%rowtype; product_id uuid; preference public.notification_preferences%rowtype; local_now timestamp; in_quiet boolean;
begin
  select * into d from public.notification_dispatches where organization_id=p_organization_id and id=p_dispatch_id for update;
  if not found then return query select 'not_found',null::jsonb; return; end if;
  if d.status<>'leased' or d.lease_owner is distinct from p_worker_id or d.version<>p_expected_version then
    return query select 'conflict',null::jsonb; return;
  end if;
  select u.email into recipient_email
  from public.organization_members m join public.users u on u.id=m.user_id and u.is_active
  where m.organization_id=p_organization_id and m.user_id=d.effective_recipient_user_id;
  if recipient_email is null then
    update public.notification_dispatches set status='cancelled',lease_owner=null,lease_expires_at=null,safe_error_code='recipient_unavailable',version=version+1
    where organization_id=p_organization_id and id=p_dispatch_id;
    update public.evidence_document_notification_outbox set status='recipient_unavailable',sent_at=clock_timestamp(),
      lease_owner=null,lease_expires_at=null,last_error='recipient_unavailable'
    where organization_id=p_organization_id and id=d.source_id and d.source_type='evidence_validity' and status in ('queued','leased');
    return query select 'cancelled',null::jsonb; return;
  end if;
  if d.source_type='evidence_validity' then
    select * into n from public.evidence_document_notification_outbox where organization_id=p_organization_id and id=d.source_id for update;
    if not found or n.status not in ('queued','leased') then
      update public.notification_dispatches set status='cancelled',lease_owner=null,lease_expires_at=null,safe_error_code='source_unavailable',version=version+1
      where organization_id=p_organization_id and id=p_dispatch_id;
      return query select 'cancelled',null::jsonb; return;
    end if;
    select * into v from public.evidence_document_versions where organization_id=p_organization_id and id=n.version_id and processing_state='clean';
    if not found or not public.m8_evidence_actor_active(p_organization_id,d.effective_recipient_user_id)
      or not public.m5_triage_actor_has_permission(p_organization_id,d.effective_recipient_user_id,'can_view_evidence')
      or not public.m9_supplier_actor_can(p_organization_id,d.effective_recipient_user_id,'can_view_products')
      or not exists(select 1 from public.evidence_documents doc
        where doc.organization_id=p_organization_id and doc.id=v.document_id and doc.current_version_id=v.id) then
      update public.notification_dispatches set status='cancelled',lease_owner=null,lease_expires_at=null,safe_error_code='source_unavailable',version=version+1
      where organization_id=p_organization_id and id=p_dispatch_id;
      update public.evidence_document_notification_outbox set status='obsolete',lease_owner=null,lease_expires_at=null,last_error='source_unavailable'
      where organization_id=p_organization_id and id=d.source_id and status in ('queued','leased');
      return query select 'cancelled',null::jsonb; return;
    end if;
    select * into preference from public.notification_preferences where organization_id=p_organization_id and user_id=d.effective_recipient_user_id;
    if coalesce(preference.modes->>d.category,'immediate')='off' then
      update public.notification_dispatches set status='cancelled',lease_owner=null,lease_expires_at=null,safe_error_code='preference_suppressed',version=version+1
      where organization_id=p_organization_id and id=p_dispatch_id;
      update public.evidence_document_notification_outbox set status='sent',sent_at=clock_timestamp(),lease_owner=null,lease_expires_at=null,last_error=null
      where organization_id=p_organization_id and id=d.source_id and status in ('queued','leased');
      return query select 'cancelled',null::jsonb; return;
    elsif coalesce(preference.modes->>d.category,'immediate') in ('daily','weekly') then
      update public.notification_dispatches set status='digest_pending',lease_owner=null,lease_expires_at=null,safe_error_code=null,version=version+1
      where organization_id=p_organization_id and id=p_dispatch_id;
      return query select 'cancelled',null::jsonb; return;
    end if;
    if preference.id is not null and preference.quiet_start is not null then
      local_now := clock_timestamp() at time zone preference.timezone;
      in_quiet := case when preference.quiet_start < preference.quiet_end then (local_now::time >= preference.quiet_start and local_now::time < preference.quiet_end) else (local_now::time >= preference.quiet_start or local_now::time < preference.quiet_end) end;
      if in_quiet then
        update public.notification_dispatches set status='retrying',lease_owner=null,lease_expires_at=null,safe_error_code='quiet_hours_deferred',next_attempt_at=clock_timestamp()+interval '1 hour',version=version+1
        where organization_id=p_organization_id and id=p_dispatch_id;
        return query select 'cancelled',null::jsonb; return;
      end if;
    end if;
    select vp.product_id into product_id
    from public.evidence_document_version_products vp
    join public.products p on p.organization_id=vp.organization_id and p.id=vp.product_id and p.archived_at is null
    where vp.organization_id=p_organization_id and vp.version_id=v.id
    order by vp.product_id
    limit 1;
    if product_id is null then
      update public.notification_dispatches set status='cancelled',lease_owner=null,lease_expires_at=null,safe_error_code='source_unavailable',version=version+1
      where organization_id=p_organization_id and id=p_dispatch_id;
      update public.evidence_document_notification_outbox set status='obsolete',lease_owner=null,lease_expires_at=null,last_error='source_unavailable'
      where organization_id=p_organization_id and id=d.source_id and status in ('queued','leased');
      return query select 'cancelled',null::jsonb; return;
    end if;
    return query select 'ready',jsonb_build_object(
      'deliveryRef',d.id,
      'idempotencyKey','notification-dispatch:'||d.id::text,
      'recipient',jsonb_build_object('userId',d.effective_recipient_user_id,'email',recipient_email),
      'payload',jsonb_build_object(
        'kind','evidence_validity',
        'title',d.safe_title,
        'validUntil',v.validity_ends_on::text,
        'thresholdDays',n.threshold_days,
        'productId',product_id
      )
    );
    return;
  end if;
  return query select 'invalid_request',null::jsonb;
end $$;

create or replace function public.complete_notification_dispatch_atomic(
  p_organization_id uuid,p_dispatch_id uuid,p_worker_id uuid,p_expected_version integer,
  p_outcome text,p_message_id_hash text default null,p_error_code text default null
) returns table(outcome text) language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.notification_dispatches%rowtype; next_status text;
begin
  if p_outcome not in ('provider_accepted','delivered','failed','exhausted','cancelled') then return query select 'invalid_request'; return; end if;
  select * into d from public.notification_dispatches where organization_id=p_organization_id and id=p_dispatch_id for update;
  if not found then return query select 'not_found'; return; end if;
  if d.status='provider_accepted' or d.status='delivered' then return query select 'replayed'; return; end if;
  if d.status<>'leased' or d.lease_owner is distinct from p_worker_id or d.version<>p_expected_version then return query select 'conflict'; return; end if;
  next_status:=p_outcome;
  update public.notification_dispatches
  set status=next_status,lease_owner=null,lease_expires_at=null,provider_message_id=p_message_id_hash,
      safe_error_code=case when next_status in ('failed','exhausted','cancelled') then coalesce(nullif(btrim(p_error_code),''),'provider_unavailable') else null end,
      version=version+1
  where organization_id=p_organization_id and id=p_dispatch_id;
  if d.source_type='evidence_validity' and next_status in ('provider_accepted','delivered') then
    update public.evidence_document_notification_outbox
    set status='sent',sent_at=clock_timestamp(),lease_owner=null,lease_expires_at=null,last_error=null
    where organization_id=p_organization_id and id=d.source_id and status in ('queued','leased');
  end if;
  insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
  values(p_organization_id,'notification.dispatch_'||next_status,'notification_dispatch',p_dispatch_id::text,
    jsonb_build_object('sourceType',d.source_type,'sourceId',d.source_id,'attempt',d.attempt_count));
  return query select 'completed';
end $$;

create or replace function public.retry_notification_dispatch_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_delivery_ref text,p_expected_version integer,p_idempotency_key uuid
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.notification_dispatches%rowtype; prior public.audit_logs%rowtype; response jsonb; digest text; dispatch_id uuid;
begin
  if p_organization_id is null or p_actor_user_id is null or p_delivery_ref is null or p_expected_version is null or p_expected_version<1 or p_idempotency_key is null
    or char_length(p_delivery_ref) > 512 or p_delivery_ref !~ '^[A-Za-z0-9_-]+$'
    or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_edit_organization') then
    return query select 'forbidden',null::jsonb; return;
  end if;
  begin
    dispatch_id:=p_delivery_ref::uuid;
  exception when others then
    return query select 'invalid_request',null::jsonb; return;
  end;
  digest:=encode(extensions.digest(jsonb_build_object('deliveryRef',p_delivery_ref,'expectedVersion',p_expected_version)::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(concat_ws('|',p_organization_id,p_actor_user_id,p_idempotency_key),0));
  select * into prior from public.audit_logs a
  where a.organization_id=p_organization_id and a.user_id=p_actor_user_id and a.action='notification.dispatch_retry_requested'
    and a.changes->>'idempotencyKey'=p_idempotency_key::text limit 1;
  if found then
    if prior.changes->>'payloadDigest'<>digest then return query select 'idempotency_conflict',null::jsonb; return; end if;
    return query select 'replayed',prior.changes->'result'; return;
  end if;
  select * into d from public.notification_dispatches where organization_id=p_organization_id and id=dispatch_id for update;
  if not found then return query select 'not_found',null::jsonb; return; end if;
  if d.version<>p_expected_version then return query select 'conflict',public.m12_03_dispatch_row_json(d); return; end if;
  if d.status <> 'exhausted' then return query select 'invalid_state',public.m12_03_dispatch_row_json(d); return; end if;
  if d.source_type='evidence_validity' and (
      not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_evidence')
      or not exists (
        select 1 from public.evidence_document_notification_outbox n
        join public.evidence_document_versions v on v.organization_id=n.organization_id and v.id=n.version_id and v.processing_state='clean'
        join public.evidence_document_version_products vp on vp.organization_id=v.organization_id and vp.version_id=v.id
        join public.products p on p.organization_id=vp.organization_id and p.id=vp.product_id and p.archived_at is null
        where n.organization_id=p_organization_id and n.id=d.source_id and n.status in ('queued','leased')
      )
    ) then
    return query select 'forbidden',null::jsonb; return;
  end if;
  update public.notification_dispatches
  set status='queued',lease_owner=null,lease_expires_at=null,next_attempt_at=clock_timestamp(),safe_error_code=null,version=version+1
  where organization_id=p_organization_id and id=dispatch_id returning * into d;
  response:=jsonb_build_object('delivery',public.m12_03_dispatch_row_json(d));
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
  values(p_organization_id,p_actor_user_id,'notification.dispatch_retry_requested','notification_dispatch',dispatch_id::text,
    jsonb_build_object('idempotencyKey',p_idempotency_key,'payloadDigest',digest,'result',response));
  return query select 'queued',response;
end $$;

create or replace function public.fail_notification_dispatch_atomic(
  p_organization_id uuid,p_dispatch_id uuid,p_worker_id uuid,p_expected_version integer,p_error_code text,p_retryable boolean
) returns table(outcome text) language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.notification_dispatches%rowtype; next_status text;
begin
  select * into d from public.notification_dispatches where organization_id=p_organization_id and id=p_dispatch_id and status='leased' and lease_owner=p_worker_id and version=p_expected_version for update;
  if not found then return query select 'conflict'; return; end if;
  next_status:=case when not p_retryable or d.attempt_count>=12 then 'exhausted' else 'retrying' end;
  update public.notification_dispatches
  set status=next_status,lease_owner=null,lease_expires_at=null,
      safe_error_code=coalesce(nullif(btrim(p_error_code),''),'provider_unavailable'),
      next_attempt_at=case when next_status='exhausted' then next_attempt_at else clock_timestamp()+make_interval(secs=>least(3600,greatest(30,30*power(2,least(d.attempt_count,7))::integer))) end,
      version=version+1
  where organization_id=p_organization_id and id=p_dispatch_id;
  return query select case when next_status='exhausted' then 'exhausted' else 'retry_scheduled' end;
end $$;

create or replace function public.list_notification_dispatches_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_status text default null,p_category text default null,p_recipient_user_id uuid default null,
  p_cursor text default null,p_limit integer default 50
) returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path=public,pg_temp as $$
declare rows jsonb; next_cursor text; cursor_text text; cursor_created_at timestamptz; cursor_id uuid; padding text;
begin
  if p_organization_id is null or p_actor_user_id is null or p_limit not between 1 and 100
    or (p_status is not null and p_status not in ('queued','attempted','provider_accepted','delivered','failed','exhausted','cancelled'))
    or (p_category is not null and p_category not in ('finding_triage','evidence','supplier_owner','support_period','reporting_deadline'))
    or (p_cursor is not null and (char_length(p_cursor) > 512 or p_cursor !~ '^[A-Za-z0-9_-]+$'))
    or not public.m12_03_actor_has_effective_permission(p_organization_id,p_actor_user_id,'can_view_audit') then
    return query select 'forbidden',null::jsonb; return;
  end if;
  if p_cursor is not null then
    begin
      padding := repeat('=', (4 - (char_length(p_cursor) % 4)) % 4);
      cursor_text := convert_from(decode(translate(p_cursor,'-_','+/')||padding,'base64'),'utf8');
      cursor_created_at := split_part(cursor_text,'|',1)::timestamptz;
      cursor_id := split_part(cursor_text,'|',2)::uuid;
    exception when others then
      return query select 'invalid_request',null::jsonb; return;
    end;
  end if;
  with filtered as (
    select d.* from public.notification_dispatches d
    where d.organization_id=p_organization_id
      and (p_status is null or case when d.status in ('leased','retrying') then 'attempted' else d.status end=p_status)
      and (p_category is null or d.category=p_category)
      and (p_recipient_user_id is null or d.effective_recipient_user_id=p_recipient_user_id or d.original_recipient_user_id=p_recipient_user_id)
      and (cursor_created_at is null or (d.created_at,d.id)<(cursor_created_at,cursor_id))
    order by d.created_at desc,d.id desc
    limit p_limit
  )
  select coalesce(jsonb_agg(public.m12_03_dispatch_row_json(filtered) order by filtered.created_at desc,filtered.id desc),'[]'::jsonb),
    case when count(*)=p_limit then translate(rtrim(regexp_replace(encode(convert_to(((select last_row.created_at::text||'|'||last_row.id::text from filtered last_row order by last_row.created_at asc,last_row.id asc limit 1)),'utf8'),'base64'),'\s','','g'),'='),'+/','-_') else null end
  into rows,next_cursor
  from filtered;
  return query select 'found',jsonb_build_object('rows',rows,'nextCursor',next_cursor);
end $$;

insert into public.organization_export_sources(source_id,enabled,sort_order)
values('notification_delivery',true,120)
on conflict(source_id) do update set enabled=excluded.enabled,sort_order=excluded.sort_order;

insert into public.organization_export_source_tables(source_id,table_name,tenant_key_column,record_order_column,table_sort) values
 ('notification_delivery','notification_preferences','organization_id','id',1),
 ('notification_delivery','notification_dispatches','organization_id','id',2)
on conflict(source_id,table_name) do update set tenant_key_column=excluded.tenant_key_column,record_order_column=excluded.record_order_column,table_sort=excluded.table_sort;

do $$
declare v_signature text;
begin
  foreach v_signature in array array[
    'm12_03_notification_modes_valid(jsonb)',
    'm12_03_validate_preference_timezone()',
    'm12_03_actor_can_manage_notification_user(uuid,uuid,uuid)',
    'm12_03_actor_can_manage_critical_route(uuid,uuid,uuid)',
    'm12_03_actor_has_effective_permission(uuid,uuid,text)',
    'm12_03_user_can_receive_critical(uuid,uuid,uuid,text)',
    'resolve_critical_notification_recipient(uuid,uuid,uuid,text)',
    'm12_03_preferences_json(uuid,uuid)',
    'm12_03_route_json(uuid,uuid)',
    'm12_03_ensure_notification_preference(uuid,uuid)',
    'get_notification_preferences_atomic(uuid,uuid,uuid)',
    'update_notification_preferences_atomic(uuid,uuid,uuid,integer,jsonb,jsonb,uuid,text)',
    'get_critical_notification_route_atomic(uuid,uuid,uuid)',
    'update_critical_notification_route_atomic(uuid,uuid,uuid,integer,uuid,uuid)',
    'get_reporting_deadline_alert_delivery_details(uuid,uuid,text,integer)',
    'bridge_evidence_validity_notification_dispatches_atomic(uuid,integer)',
    'list_due_notification_dispatch_organizations_atomic(uuid,integer)',
    'm12_03_dispatch_row_json(public.notification_dispatches)',
    'claim_notification_dispatch_atomic(uuid,uuid,integer)',
    'prepare_notification_dispatch_atomic(uuid,uuid,uuid,integer)',
    'complete_notification_dispatch_atomic(uuid,uuid,uuid,integer,text,text,text)',
    'retry_notification_dispatch_atomic(uuid,uuid,text,integer,uuid)',
    'fail_notification_dispatch_atomic(uuid,uuid,uuid,integer,text,boolean)',
    'list_notification_dispatches_atomic(uuid,uuid,text,text,uuid,text,integer)'
  ] loop
    execute 'alter function public.'||v_signature||' owner to postgres';
  end loop;
end $$;

revoke all on function
  public.m12_03_notification_modes_valid(jsonb),
  public.m12_03_validate_preference_timezone(),
  public.m12_03_actor_can_manage_notification_user(uuid,uuid,uuid),
  public.m12_03_actor_can_manage_critical_route(uuid,uuid,uuid),
  public.m12_03_actor_has_effective_permission(uuid,uuid,text),
  public.m12_03_user_can_receive_critical(uuid,uuid,uuid,text),
  public.resolve_critical_notification_recipient(uuid,uuid,uuid,text),
  public.m12_03_preferences_json(uuid,uuid),
  public.m12_03_route_json(uuid,uuid),
  public.m12_03_ensure_notification_preference(uuid,uuid),
  public.get_notification_preferences_atomic(uuid,uuid,uuid),
  public.update_notification_preferences_atomic(uuid,uuid,uuid,integer,jsonb,jsonb,uuid,text),
  public.get_critical_notification_route_atomic(uuid,uuid,uuid),
  public.update_critical_notification_route_atomic(uuid,uuid,uuid,integer,uuid,uuid),
  public.resolve_critical_notification_recipient(uuid,uuid,uuid,text),
  public.get_reporting_deadline_alert_delivery_details(uuid,uuid,text,integer),
  public.bridge_evidence_validity_notification_dispatches_atomic(uuid,integer),
  public.list_due_notification_dispatch_organizations_atomic(uuid,integer),
  public.m12_03_dispatch_row_json(public.notification_dispatches),
  public.claim_notification_dispatch_atomic(uuid,uuid,integer),
  public.prepare_notification_dispatch_atomic(uuid,uuid,uuid,integer),
  public.complete_notification_dispatch_atomic(uuid,uuid,uuid,integer,text,text,text),
  public.retry_notification_dispatch_atomic(uuid,uuid,text,integer,uuid),
  public.fail_notification_dispatch_atomic(uuid,uuid,uuid,integer,text,boolean),
  public.list_notification_dispatches_atomic(uuid,uuid,text,text,uuid,text,integer)
from public,anon,authenticated;

grant execute on function
  public.get_notification_preferences_atomic(uuid,uuid,uuid),
  public.update_notification_preferences_atomic(uuid,uuid,uuid,integer,jsonb,jsonb,uuid,text),
  public.get_critical_notification_route_atomic(uuid,uuid,uuid),
  public.update_critical_notification_route_atomic(uuid,uuid,uuid,integer,uuid,uuid),
  public.resolve_critical_notification_recipient(uuid,uuid,uuid,text),
  public.get_reporting_deadline_alert_delivery_details(uuid,uuid,text,integer),
  public.bridge_evidence_validity_notification_dispatches_atomic(uuid,integer),
  public.list_due_notification_dispatch_organizations_atomic(uuid,integer),
  public.claim_notification_dispatch_atomic(uuid,uuid,integer),
  public.prepare_notification_dispatch_atomic(uuid,uuid,uuid,integer),
  public.complete_notification_dispatch_atomic(uuid,uuid,uuid,integer,text,text,text),
  public.retry_notification_dispatch_atomic(uuid,uuid,text,integer,uuid),
  public.fail_notification_dispatch_atomic(uuid,uuid,uuid,integer,text,boolean),
  public.list_notification_dispatches_atomic(uuid,uuid,text,text,uuid,text,integer)
to service_role;

notify pgrst,'reload schema';
