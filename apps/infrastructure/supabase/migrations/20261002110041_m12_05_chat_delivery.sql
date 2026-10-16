-- M12-05: tenant-scoped chat destinations and durable delivery state.
-- These are separate from the product sync connector and signed outbound webhook models.

create table public.notification_chat_channels (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mode text not null check (mode in ('slack_webhook','slack_bot','teams_workflow_webhook','teams_bot_proactive')),
  display_name text not null check (display_name=btrim(display_name) and char_length(display_name) between 1 and 120 and display_name !~ '[@<>[:cntrl:]]'),
  event_classes text[] not null check (cardinality(event_classes) between 1 and 3),
  product_ids uuid[] not null default '{}'::uuid[] check (cardinality(product_ids) <= 100),
  include_organization_wide boolean not null default false,
  target_metadata jsonb not null check (jsonb_typeof(target_metadata)='object' and octet_length(target_metadata::text)<=8000),
  credential_envelope jsonb not null check (
    credential_envelope->>'format'='aes-256-gcm-v1'
    and credential_envelope->>'keyId' ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
    and char_length(coalesce(credential_envelope->>'ciphertext','')) between 1 and 106672
    and char_length(coalesce(credential_envelope->>'nonce',''))=16
    and char_length(coalesce(credential_envelope->>'authTag',''))=24),
  credential_revision integer not null default 1 check (credential_revision>0),
  version integer not null default 1 check (version>0),
  enabled boolean not null default false,
  safe_error_code text check (safe_error_code is null or safe_error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  verified_at timestamptz,
  verified_version integer,
  active_from timestamptz,
  last_claimed_at timestamptz,
  test_id uuid,
  test_code_hash text check (test_code_hash is null or test_code_hash ~ '^[a-f0-9]{64}$'),
  test_expires_at timestamptz,
  test_accepted_at timestamptz,
  test_attempt_count integer not null default 0 check (test_attempt_count between 0 and 5),
  last_command_key uuid,
  last_command_digest text check (last_command_digest is null or last_command_digest ~ '^[a-f0-9]{64}$'),
  last_command_actor uuid references public.users(id) on delete set null,
  created_by_user_id uuid not null references public.users(id) on delete restrict,
  updated_by_user_id uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id,id),
  check ((test_id is null)=(test_code_hash is null)),
  check ((test_id is null)=(test_expires_at is null)),
  check (test_accepted_at is null or test_id is not null),
  check (not enabled or (verified_at is not null and verified_version=version and active_from is not null))
);

create table public.notification_chat_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel_id uuid not null,
  event_class text not null check (event_class in ('high_severity_alert','countdown_warning','approval_prompt')),
  source_kind text not null check (source_kind in ('m2_support','m5_triage','m5_approval','m6_deadline','m6_approval','m8_evidence','m9_owner')),
  source_id uuid not null,
  source_revision text not null check (char_length(source_revision) between 1 and 100 and source_revision !~ '[[:cntrl:]]'),
  source_product_id uuid,
  severity text not null check (severity in ('high','critical')),
  effective_at timestamptz not null,
  status text not null default 'queued' check (status in ('queued','attempted','provider_accepted','failed','exhausted','cancelled','uncertain')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 6),
  total_attempt_count integer not null default 0 check (total_attempt_count>=0),
  manual_retry_count integer not null default 0 check (manual_retry_count between 0 and 3),
  next_attempt_at timestamptz not null,
  attempted_at timestamptz,
  lease_owner uuid,
  lease_expires_at timestamptz,
  route_version integer not null check (route_version>0),
  safe_error_code text check (safe_error_code is null or safe_error_code ~ '^[a-z0-9_]{1,64}$'),
  provider_message_id_hash text check (provider_message_id_hash is null or provider_message_id_hash ~ '^[a-f0-9]{64}$'),
  provider_accepted_at timestamptz,
  version integer not null default 1 check (version>0),
  last_retry_key uuid,
  last_retry_actor uuid references public.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id,id),
  unique (organization_id,channel_id,source_kind,source_id,source_revision),
  foreign key (organization_id,channel_id) references public.notification_chat_channels(organization_id,id) on delete cascade,
  check ((status='attempted')=(lease_owner is not null and lease_expires_at is not null)),
  check (attempt_count=0 or attempted_at is not null)
);

create index notification_chat_channels_org_idx on public.notification_chat_channels(organization_id,id);
create index notification_chat_channels_actor_idx on public.notification_chat_channels(updated_by_user_id,organization_id);
create index notification_chat_deliveries_due_idx on public.notification_chat_deliveries(organization_id,next_attempt_at,id)
  where status in ('queued','failed','attempted');
create index notification_chat_deliveries_history_idx on public.notification_chat_deliveries(organization_id,created_at desc,id desc);
create index notification_chat_deliveries_retention_idx on public.notification_chat_deliveries(organization_id,effective_at,id);
create index notification_chat_deliveries_channel_idx on public.notification_chat_deliveries(channel_id,organization_id);

create trigger set_notification_chat_channels_updated_at before update on public.notification_chat_channels
  for each row execute function public.set_updated_at();
create trigger set_notification_chat_deliveries_updated_at before update on public.notification_chat_deliveries
  for each row execute function public.set_updated_at();
alter table public.notification_chat_channels enable row level security;
alter table public.notification_chat_deliveries enable row level security;
revoke all on public.notification_chat_channels,public.notification_chat_deliveries from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.notification_chat_channels,public.notification_chat_deliveries to service_role;

create function public.m12_05_chat_admin(p_organization_id uuid,p_actor_user_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.organization_members m
    join public.users u on u.id=m.user_id and u.is_active
    join public.organizations o on o.id=m.organization_id and o.is_active
    where m.organization_id=p_organization_id and m.user_id=p_actor_user_id and m.role in ('owner','admin'))
    and public.m12_03_actor_has_effective_permission(p_organization_id,p_actor_user_id,'can_edit_organization')
$$;

create function public.m12_05_chat_auditor(p_organization_id uuid,p_actor_user_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.m1201_active_member(p_organization_id,p_actor_user_id)
    and public.m12_03_actor_has_effective_permission(p_organization_id,p_actor_user_id,'can_view_audit')
$$;

create function public.m12_05_chat_configuration_valid(p_organization_id uuid,p_actor_user_id uuid,p_configuration jsonb)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_typeof(p_configuration)='object' and octet_length(p_configuration::text)<=12000
    and p_configuration ?& array['mode','displayName','eventClasses','productIds','targetMetadata','includeOrganizationWide']
    and not exists(select 1 from jsonb_object_keys(p_configuration) k
      where k not in ('mode','displayName','eventClasses','productIds','targetMetadata','includeOrganizationWide'))
    and p_configuration->>'mode' in ('slack_webhook','slack_bot','teams_workflow_webhook','teams_bot_proactive')
    and p_configuration->>'displayName'=btrim(p_configuration->>'displayName')
    and char_length(p_configuration->>'displayName') between 1 and 120
    and (p_configuration->>'displayName') !~ '[@<>[:cntrl:]]'
    and jsonb_typeof(p_configuration->'eventClasses')='array'
    and jsonb_array_length(p_configuration->'eventClasses') between 1 and 3
    and (select count(*)=count(distinct value) and bool_and(value in
      ('high_severity_alert','countdown_warning','approval_prompt'))
      from jsonb_array_elements_text(p_configuration->'eventClasses'))
    and jsonb_typeof(p_configuration->'productIds')='array'
    and jsonb_array_length(p_configuration->'productIds')<=100
    and (select count(*)=count(distinct value) and bool_and(value ~
      '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$')
      from jsonb_array_elements_text(p_configuration->'productIds'))
    and (select count(*)=jsonb_array_length(p_configuration->'productIds')
      from public.products p where p.organization_id=p_organization_id and p.archived_at is null
        and p.id::text in (select value from jsonb_array_elements_text(p_configuration->'productIds')))
    and (p_configuration->>'includeOrganizationWide') in ('true','false')
    and (jsonb_array_length(p_configuration->'productIds')>0 or (p_configuration->>'includeOrganizationWide')='true')
    and jsonb_typeof(p_configuration->'targetMetadata')='object'
    and octet_length((p_configuration->'targetMetadata')::text)<=8000
    and not (p_configuration->'targetMetadata' ?| array['secret','token','credential','webhookUrl','url'])
    and public.m12_03_actor_has_effective_permission(p_organization_id,p_actor_user_id,'can_view_products')
$$;

create function public.m12_05_chat_utc(p_value timestamptz)
returns text language sql stable set search_path=public,pg_temp as $$
  select case when p_value is null then null else
    to_char(p_value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end
$$;

create function public.m12_05_chat_channel_public(p_channel public.notification_chat_channels)
returns jsonb language sql stable set search_path=public,pg_temp as $$
  select jsonb_build_object('id',p_channel.id,'organizationId',p_channel.organization_id,
    'mode',p_channel.mode,'displayName',p_channel.display_name,'eventClasses',p_channel.event_classes,
    'productIds',p_channel.product_ids,'includeOrganizationWide',p_channel.include_organization_wide,
    'version',p_channel.version,'enabled',p_channel.enabled,'safeErrorCode',p_channel.safe_error_code,
    'verified',p_channel.verified_at is not null
      and p_channel.verified_version=p_channel.version,
    'createdAt',public.m12_05_chat_utc(p_channel.created_at),
    'updatedAt',public.m12_05_chat_utc(p_channel.updated_at))
$$;

create function public.m12_05_chat_delivery_public(p_delivery public.notification_chat_deliveries)
returns jsonb language sql stable set search_path=public,pg_temp as $$
  select jsonb_build_object('id',p_delivery.id,
    'channelId',p_delivery.channel_id,'eventClass',p_delivery.event_class,
    'sourceType',p_delivery.source_kind,'sourceId',p_delivery.source_id,'sourceRevision',p_delivery.source_revision,
    'status',p_delivery.status,'attemptCount',p_delivery.attempt_count,
    'lastAttemptAt',public.m12_05_chat_utc(p_delivery.attempted_at),
    'nextAttemptAt',case when p_delivery.status in ('queued','failed') then public.m12_05_chat_utc(p_delivery.next_attempt_at) else null end,
    'safeErrorCode',p_delivery.safe_error_code,'version',p_delivery.version,
    'createdAt',public.m12_05_chat_utc(p_delivery.created_at),
    'updatedAt',public.m12_05_chat_utc(p_delivery.updated_at))
$$;

create function public.m12_05_chat_digest(p_operation text,p_payload jsonb)
returns text language sql immutable set search_path=public,pg_temp as $$
  select encode(extensions.digest(p_operation||':'||p_payload::text,'sha256'),'hex')
$$;

create function public.m12_05_chat_envelope_valid(p_envelope jsonb)
returns boolean language sql immutable set search_path=public,pg_temp as $$
  select jsonb_typeof(p_envelope)='object' and p_envelope ?& array['format','keyId','ciphertext','nonce','authTag']
    and not exists(select 1 from jsonb_object_keys(p_envelope) k where k not in ('format','keyId','ciphertext','nonce','authTag'))
    and p_envelope->>'format'='aes-256-gcm-v1'
    and p_envelope->>'keyId' ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
    and char_length(p_envelope->>'ciphertext') between 1 and 106672
    and char_length(p_envelope->>'nonce')=16 and char_length(p_envelope->>'authTag')=24
$$;

create function public.m12_05_create_chat_channel_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_channel_id uuid,p_configuration jsonb,
  p_credential_envelope jsonb,p_credential_revision integer,p_request_fingerprint text,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_channel public.notification_chat_channels%rowtype; v_digest text;
begin
  if not public.m12_05_chat_admin(p_organization_id,p_actor_user_id) then
    return jsonb_build_object('outcome','forbidden','result',null); end if;
  if p_channel_id is null or p_idempotency_key is null or p_credential_revision<>1
    or p_request_fingerprint !~ '^[a-f0-9]{64}$'
    or not coalesce(public.m12_05_chat_configuration_valid(p_organization_id,p_actor_user_id,p_configuration),false)
    or not coalesce(public.m12_05_chat_envelope_valid(p_credential_envelope),false) then
    return jsonb_build_object('outcome','invalid_request','result',null); end if;
  v_digest:=public.m12_05_chat_digest('create',jsonb_build_object(
    'configuration',p_configuration,'fingerprint',p_request_fingerprint));
  select * into v_channel from public.notification_chat_channels where id=p_channel_id for update;
  if found then
    if v_channel.organization_id<>p_organization_id then return jsonb_build_object('outcome','not_found','result',null); end if;
    return jsonb_build_object('outcome',case when v_channel.last_command_key=p_idempotency_key
      and v_channel.last_command_digest=v_digest and v_channel.last_command_actor=p_actor_user_id
      then 'replayed' else 'conflict' end,'result',jsonb_build_object('channel',public.m12_05_chat_channel_public(v_channel)));
  end if;
  if (select count(*) from public.notification_chat_channels where organization_id=p_organization_id)>=100 then
    return jsonb_build_object('outcome','limit_reached','result',null); end if;
  insert into public.notification_chat_channels(id,organization_id,mode,display_name,event_classes,product_ids,
    include_organization_wide,target_metadata,credential_envelope,credential_revision,created_by_user_id,updated_by_user_id,
    last_command_key,last_command_digest,last_command_actor)
  values(p_channel_id,p_organization_id,p_configuration->>'mode',p_configuration->>'displayName',
    array(select value from jsonb_array_elements_text(p_configuration->'eventClasses')),
    array(select value::uuid from jsonb_array_elements_text(p_configuration->'productIds')),
    (p_configuration->>'includeOrganizationWide')::boolean,p_configuration->'targetMetadata',p_credential_envelope,
    p_credential_revision,
    p_actor_user_id,p_actor_user_id,p_idempotency_key,v_digest,p_actor_user_id)
  returning * into v_channel;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
    values(p_organization_id,p_actor_user_id,'notification.chat_channel_created','notification_chat_channel',
      p_channel_id::text,jsonb_build_object('mode',v_channel.mode,'eventClasses',v_channel.event_classes));
  return jsonb_build_object('outcome','updated','result',jsonb_build_object('channel',public.m12_05_chat_channel_public(v_channel)));
end $$;

create function public.m12_05_update_chat_channel_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_channel_id uuid,p_expected_version integer,
  p_configuration jsonb,p_credential_envelope jsonb,p_credential_revision integer,
  p_request_fingerprint text,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_channel public.notification_chat_channels%rowtype; v_digest text; v_configuration jsonb;
begin
  if not public.m12_05_chat_admin(p_organization_id,p_actor_user_id) then
    return jsonb_build_object('outcome','forbidden','result',null); end if;
  if p_idempotency_key is null or p_expected_version is null or p_expected_version<1
    or p_request_fingerprint !~ '^[a-f0-9]{64}$'
    or (p_credential_envelope is not null and not coalesce(public.m12_05_chat_envelope_valid(p_credential_envelope),false)) then
    return jsonb_build_object('outcome','invalid_request','result',null); end if;
  v_digest:=public.m12_05_chat_digest('update',jsonb_build_object('expectedVersion',p_expected_version,
    'configuration',p_configuration,'fingerprint',p_request_fingerprint));
  select * into v_channel from public.notification_chat_channels
    where organization_id=p_organization_id and id=p_channel_id for update;
  if not found then return jsonb_build_object('outcome','not_found','result',null); end if;
  v_configuration:=jsonb_build_object('mode',v_channel.mode,'targetMetadata',v_channel.target_metadata)||p_configuration;
  if not coalesce(public.m12_05_chat_configuration_valid(p_organization_id,p_actor_user_id,v_configuration),false)
    or (p_credential_envelope is null and p_credential_revision is not null)
    or (p_credential_envelope is not null and p_credential_revision is distinct from p_expected_version+1) then
    return jsonb_build_object('outcome','invalid_request','result',null); end if;
  if v_channel.last_command_key=p_idempotency_key then
    return jsonb_build_object('outcome',case when v_channel.last_command_digest=v_digest
      and v_channel.last_command_actor=p_actor_user_id then 'replayed' else 'idempotency_conflict' end,
      'result',jsonb_build_object('channel',public.m12_05_chat_channel_public(v_channel))); end if;
  if v_channel.version<>p_expected_version then
    return jsonb_build_object('outcome','conflict','result',public.m12_05_chat_channel_public(v_channel)); end if;
  update public.notification_chat_channels set mode=v_configuration->>'mode',display_name=v_configuration->>'displayName',
    event_classes=array(select value from jsonb_array_elements_text(v_configuration->'eventClasses')),
    product_ids=array(select value::uuid from jsonb_array_elements_text(v_configuration->'productIds')),
    include_organization_wide=(v_configuration->>'includeOrganizationWide')::boolean,
    target_metadata=v_configuration->'targetMetadata',
    credential_envelope=coalesce(p_credential_envelope,credential_envelope),
    credential_revision=coalesce(p_credential_revision,credential_revision),
    version=version+1,enabled=false,safe_error_code=null,verified_at=null,verified_version=null,active_from=null,
    test_id=null,test_code_hash=null,test_expires_at=null,test_accepted_at=null,test_attempt_count=0,
    updated_by_user_id=p_actor_user_id,last_command_key=p_idempotency_key,
    last_command_digest=v_digest,last_command_actor=p_actor_user_id
  where organization_id=p_organization_id and id=p_channel_id returning * into v_channel;
  update public.notification_chat_deliveries set status=case when status='attempted' then 'uncertain' else 'cancelled' end,
    safe_error_code='destination_changed',lease_owner=null,lease_expires_at=null,version=version+1
    where organization_id=p_organization_id and channel_id=p_channel_id and status in ('queued','failed','attempted');
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
    values(p_organization_id,p_actor_user_id,'notification.chat_channel_updated','notification_chat_channel',
      p_channel_id::text,jsonb_build_object('version',v_channel.version));
  return jsonb_build_object('outcome','updated','result',jsonb_build_object('channel',public.m12_05_chat_channel_public(v_channel)));
end $$;

create function public.m12_05_begin_chat_channel_test_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_channel_id uuid,p_expected_version integer,
  p_test_code_hash text,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_channel public.notification_chat_channels%rowtype; v_test_id uuid:=gen_random_uuid();
begin
  if not public.m12_05_chat_admin(p_organization_id,p_actor_user_id) then
    return jsonb_build_object('outcome','forbidden','result',null); end if;
  if p_idempotency_key is null or p_test_code_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('outcome','invalid_request','result',null); end if;
  select * into v_channel from public.notification_chat_channels
    where organization_id=p_organization_id and id=p_channel_id for update;
  if not found then return jsonb_build_object('outcome','not_found','result',null); end if;
  if v_channel.version<>p_expected_version or v_channel.enabled then
    return jsonb_build_object('outcome','conflict','result',null); end if;
  if not public.m12_05_chat_configuration_valid(p_organization_id,p_actor_user_id,jsonb_build_object(
      'mode',v_channel.mode,'displayName',v_channel.display_name,'eventClasses',v_channel.event_classes,
      'productIds',v_channel.product_ids,'includeOrganizationWide',v_channel.include_organization_wide,
      'targetMetadata',v_channel.target_metadata)) then
    return jsonb_build_object('outcome','invalid_request','result',null); end if;
  -- A repeated idempotency key has a different freshly generated code in the
  -- API, so do not silently reuse the previous challenge.
  if v_channel.last_command_key=p_idempotency_key then
    return jsonb_build_object('outcome','idempotency_conflict','result',null); end if;
  update public.notification_chat_channels set test_id=v_test_id,test_code_hash=p_test_code_hash,
    test_expires_at=clock_timestamp()+interval '10 minutes',test_accepted_at=null,
    test_attempt_count=0,
    verified_at=null,verified_version=null,updated_by_user_id=p_actor_user_id,
    last_command_key=p_idempotency_key,last_command_digest=public.m12_05_chat_digest('test',
      jsonb_build_object('testId',v_test_id,'codeHash',p_test_code_hash)),last_command_actor=p_actor_user_id
    where organization_id=p_organization_id and id=p_channel_id returning * into v_channel;
  return jsonb_build_object('outcome','found','result',jsonb_build_object(
    'testId',v_channel.test_id,'expiresAt',public.m12_05_chat_utc(v_channel.test_expires_at),
    'mode',v_channel.mode,'displayName',v_channel.display_name,'targetMetadata',v_channel.target_metadata,
    'credentialEnvelope',v_channel.credential_envelope,'credentialRevision',v_channel.credential_revision));
end $$;

create function public.m12_05_complete_chat_channel_test_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_channel_id uuid,p_test_id uuid,
  p_status text,p_safe_error_code text,p_provider_message_id_hash text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_channel public.notification_chat_channels%rowtype;
begin
  if not public.m12_05_chat_admin(p_organization_id,p_actor_user_id) then
    return jsonb_build_object('outcome','forbidden','result',null); end if;
  if p_status not in ('provider_accepted','failed','uncertain')
    or (p_safe_error_code is not null and p_safe_error_code !~ '^[a-z][a-z0-9_]{0,63}$')
    or (p_provider_message_id_hash is not null and p_provider_message_id_hash !~ '^[a-f0-9]{64}$') then
    return jsonb_build_object('outcome','invalid_request','result',null); end if;
  select * into v_channel from public.notification_chat_channels
    where organization_id=p_organization_id and id=p_channel_id for update;
  if not found then return jsonb_build_object('outcome','not_found','result',null); end if;
  if v_channel.test_id is distinct from p_test_id or v_channel.test_expires_at<=clock_timestamp()
    or v_channel.enabled then return jsonb_build_object('outcome','conflict','result',null); end if;
  if p_status='provider_accepted' then
    update public.notification_chat_channels set test_accepted_at=clock_timestamp()
      where organization_id=p_organization_id and id=p_channel_id returning * into v_channel;
    insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
      values(p_organization_id,p_actor_user_id,'notification.chat_test_accepted','notification_chat_channel',
        p_channel_id::text,jsonb_build_object('testId',p_test_id,'providerMessageIdHash',p_provider_message_id_hash));
    return jsonb_build_object('outcome','updated','result',jsonb_build_object(
      'testId',v_channel.test_id,'expiresAt',public.m12_05_chat_utc(v_channel.test_expires_at),
      'status','provider_accepted'));
  end if;
  update public.notification_chat_channels set test_id=null,test_code_hash=null,test_expires_at=null,
    test_accepted_at=null,test_attempt_count=0 where organization_id=p_organization_id and id=p_channel_id;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
    values(p_organization_id,p_actor_user_id,'notification.chat_test_failed','notification_chat_channel',
      p_channel_id::text,jsonb_build_object('status',p_status,'safeErrorCode',p_safe_error_code));
  return jsonb_build_object('outcome','invalid_request','result',null);
end $$;

create function public.m12_05_confirm_chat_channel_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_channel_id uuid,p_expected_version integer,
  p_test_id uuid,p_code_hash text,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_channel public.notification_chat_channels%rowtype; v_digest text;
begin
  if not public.m12_05_chat_admin(p_organization_id,p_actor_user_id) then
    return jsonb_build_object('outcome','forbidden','result',null); end if;
  if p_test_id is null or p_idempotency_key is null or p_code_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('outcome','invalid_request','result',null); end if;
  v_digest:=public.m12_05_chat_digest('confirm',jsonb_build_object('expectedVersion',p_expected_version,
    'testId',p_test_id,'codeHash',p_code_hash));
  select * into v_channel from public.notification_chat_channels
    where organization_id=p_organization_id and id=p_channel_id for update;
  if not found then return jsonb_build_object('outcome','not_found','result',null); end if;
  if v_channel.last_command_key=p_idempotency_key then
    return jsonb_build_object('outcome',case when v_channel.last_command_digest=v_digest
      and v_channel.last_command_actor=p_actor_user_id then 'replayed' else 'idempotency_conflict' end,
      'result',jsonb_build_object('channel',public.m12_05_chat_channel_public(v_channel))); end if;
  if v_channel.version<>p_expected_version or v_channel.enabled then
    return jsonb_build_object('outcome','conflict','result',public.m12_05_chat_channel_public(v_channel)); end if;
  if v_channel.test_id is distinct from p_test_id
    or v_channel.test_accepted_at is null or v_channel.test_expires_at<=clock_timestamp()
    or v_channel.test_attempt_count>=5 then
    return jsonb_build_object('outcome','invalid_request','result',null); end if;
  if v_channel.test_code_hash is distinct from p_code_hash then
    update public.notification_chat_channels set test_attempt_count=test_attempt_count+1,
      test_id=case when test_attempt_count+1>=5 then null else test_id end,
      test_code_hash=case when test_attempt_count+1>=5 then null else test_code_hash end,
      test_expires_at=case when test_attempt_count+1>=5 then null else test_expires_at end,
      test_accepted_at=case when test_attempt_count+1>=5 then null else test_accepted_at end
      where organization_id=p_organization_id and id=p_channel_id;
    return jsonb_build_object('outcome','invalid_request','result',null);
  end if;
  update public.notification_chat_channels set version=version+1,safe_error_code=null,verified_at=clock_timestamp(),
    verified_version=version+1,test_code_hash=null,test_id=null,test_expires_at=null,test_accepted_at=null,
    updated_by_user_id=p_actor_user_id,last_command_key=p_idempotency_key,
    last_command_digest=v_digest,last_command_actor=p_actor_user_id
    where organization_id=p_organization_id and id=p_channel_id returning * into v_channel;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
    values(p_organization_id,p_actor_user_id,'notification.chat_channel_confirmed','notification_chat_channel',
      p_channel_id::text,jsonb_build_object('version',v_channel.version));
  return jsonb_build_object('outcome','updated','result',jsonb_build_object('channel',public.m12_05_chat_channel_public(v_channel)));
end $$;

create function public.m12_05_set_chat_channel_enabled_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_channel_id uuid,p_expected_version integer,
  p_enabled boolean,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_channel public.notification_chat_channels%rowtype; v_digest text;
begin
  if not public.m12_05_chat_admin(p_organization_id,p_actor_user_id) then
    return jsonb_build_object('outcome','forbidden','result',null); end if;
  if p_enabled is null or p_idempotency_key is null then
    return jsonb_build_object('outcome','invalid_request','result',null); end if;
  v_digest:=public.m12_05_chat_digest('enable',jsonb_build_object('expectedVersion',p_expected_version,'enabled',p_enabled));
  select * into v_channel from public.notification_chat_channels
    where organization_id=p_organization_id and id=p_channel_id for update;
  if not found then return jsonb_build_object('outcome','not_found','result',null); end if;
  if v_channel.last_command_key=p_idempotency_key then
    return jsonb_build_object('outcome',case when v_channel.last_command_digest=v_digest
      and v_channel.last_command_actor=p_actor_user_id then 'replayed' else 'idempotency_conflict' end,
      'result',jsonb_build_object('channel',public.m12_05_chat_channel_public(v_channel))); end if;
  if v_channel.version<>p_expected_version or v_channel.enabled=p_enabled then
    return jsonb_build_object('outcome','conflict','result',public.m12_05_chat_channel_public(v_channel)); end if;
  if p_enabled and (v_channel.verified_at is null or v_channel.verified_version<>v_channel.version
    or not public.m12_05_chat_configuration_valid(p_organization_id,p_actor_user_id,jsonb_build_object(
      'mode',v_channel.mode,'displayName',v_channel.display_name,'eventClasses',v_channel.event_classes,
      'productIds',v_channel.product_ids,'includeOrganizationWide',v_channel.include_organization_wide,
      'targetMetadata',v_channel.target_metadata))) then
    return jsonb_build_object('outcome','invalid_state','result',null); end if;
  update public.notification_chat_channels set version=version+1,enabled=p_enabled,safe_error_code=null,
    verified_version=case when verified_at is null then null else version+1 end,
    active_from=case when p_enabled then clock_timestamp() else null end,
    updated_by_user_id=p_actor_user_id,last_command_key=p_idempotency_key,
    last_command_digest=v_digest,last_command_actor=p_actor_user_id
    where organization_id=p_organization_id and id=p_channel_id returning * into v_channel;
  if not p_enabled then
    update public.notification_chat_deliveries set status=case when status='attempted' then 'uncertain' else 'cancelled' end,
      safe_error_code='route_disabled',lease_owner=null,lease_expires_at=null,version=version+1
      where organization_id=p_organization_id and channel_id=p_channel_id and status in ('queued','failed','attempted');
  end if;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
    values(p_organization_id,p_actor_user_id,'notification.chat_channel_state_changed','notification_chat_channel',
      p_channel_id::text,jsonb_build_object('enabled',p_enabled,'version',v_channel.version));
  return jsonb_build_object('outcome','updated',
    'result',jsonb_build_object('channel',public.m12_05_chat_channel_public(v_channel)));
end $$;

create function public.m12_05_list_chat_channels(
  p_organization_id uuid,p_actor_user_id uuid,p_limit integer,p_after_id uuid,p_mode text
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_items jsonb; v_next uuid;
begin
  if not (public.m12_05_chat_admin(p_organization_id,p_actor_user_id)
    or public.m12_05_chat_auditor(p_organization_id,p_actor_user_id)) then
    return jsonb_build_object('outcome','forbidden','channels','[]'::jsonb,'nextCursor',null); end if;
  if p_limit not between 1 and 100 or (p_mode is not null and p_mode not in
    ('slack_webhook','slack_bot','teams_workflow_webhook','teams_bot_proactive')) then
    return jsonb_build_object('outcome','invalid_request','channels','[]'::jsonb,'nextCursor',null); end if;
  with page as (select c.* from public.notification_chat_channels c
    where c.organization_id=p_organization_id and (p_after_id is null or c.id>p_after_id)
      and (p_mode is null or c.mode=p_mode)
    order by c.id limit p_limit+1), visible as (select * from page order by id limit p_limit)
  select coalesce(jsonb_agg(public.m12_05_chat_channel_public(v) order by v.id),'[]'::jsonb),max(v.id)
    into v_items,v_next from visible v;
  return jsonb_build_object('outcome','ok','channels',v_items,
    'nextCursor',case when jsonb_array_length(v_items)=p_limit and exists(
      select 1 from public.notification_chat_channels c where c.organization_id=p_organization_id
        and c.id>v_next and (p_mode is null or c.mode=p_mode)) then v_next else null end);
end $$;

create function public.m12_05_list_chat_deliveries(
  p_organization_id uuid,p_actor_user_id uuid,p_limit integer,p_before_created_at timestamptz,
  p_before_id uuid,p_status text,p_event_class text,p_channel_id uuid
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_items jsonb; v_last public.notification_chat_deliveries%rowtype;
begin
  if not public.m12_05_chat_auditor(p_organization_id,p_actor_user_id) then
    return jsonb_build_object('outcome','forbidden','rows','[]'::jsonb,'nextCursor',null); end if;
  if p_limit not between 1 and 50 or ((p_before_created_at is null)<>(p_before_id is null))
    or (p_status is not null and p_status not in
      ('queued','attempted','provider_accepted','failed','exhausted','cancelled','uncertain'))
    or (p_event_class is not null and p_event_class not in
      ('high_severity_alert','countdown_warning','approval_prompt')) then
    return jsonb_build_object('outcome','invalid_request','rows','[]'::jsonb,'nextCursor',null); end if;
  with page as (select d.* from public.notification_chat_deliveries d
    where d.organization_id=p_organization_id
      and (p_before_id is null or (d.created_at,d.id)<(p_before_created_at,p_before_id))
      and (p_status is null or d.status=p_status)
      and (p_event_class is null or d.event_class=p_event_class)
      and (p_channel_id is null or d.channel_id=p_channel_id)
    order by d.created_at desc,d.id desc limit p_limit), items as (
      select jsonb_agg(public.m12_05_chat_delivery_public(p) order by p.created_at desc,p.id desc) j from page p)
  select coalesce(items.j,'[]'::jsonb) into v_items from items;
  select * into v_last from public.notification_chat_deliveries d
    where d.organization_id=p_organization_id and (p_before_id is null or (d.created_at,d.id)<(p_before_created_at,p_before_id))
      and (p_status is null or d.status=p_status) and (p_event_class is null or d.event_class=p_event_class)
      and (p_channel_id is null or d.channel_id=p_channel_id)
    order by d.created_at desc,d.id desc offset greatest(jsonb_array_length(v_items)-1,0) limit 1;
  return jsonb_build_object('outcome','ok','rows',v_items,
    'nextCursor',case when jsonb_array_length(v_items)=p_limit and exists(
      select 1 from public.notification_chat_deliveries d where d.organization_id=p_organization_id
        and (d.created_at,d.id)<(v_last.created_at,v_last.id)
        and (p_status is null or d.status=p_status) and (p_event_class is null or d.event_class=p_event_class)
        and (p_channel_id is null or d.channel_id=p_channel_id))
      then jsonb_build_object('createdAt',v_last.created_at,'id',v_last.id) else null end);
end $$;

create function public.m12_05_list_chat_channels_atomic(p_organization_id uuid,p_actor_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
  v_result:=public.m12_05_list_chat_channels(p_organization_id,p_actor_user_id,100,null,null);
  if v_result->>'outcome'<>'ok' then
    return jsonb_build_object('outcome',v_result->>'outcome','result',null); end if;
  return jsonb_build_object('channels',v_result->'channels');
end $$;

create function public.m12_05_list_chat_deliveries_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_status text,p_event_class text,
  p_channel_id uuid,p_cursor text,p_limit integer
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_before_at timestamptz; v_before_id uuid; v_raw jsonb; v_result jsonb; v_next text;
begin
  if p_cursor is not null then
    if p_cursor !~ '^[A-Za-z0-9_-]{1,512}$' then
      return jsonb_build_object('outcome','invalid_request','result',null); end if;
    begin
      v_raw:=convert_from(decode(translate(p_cursor,'-_','+/')||repeat('=',(4-length(p_cursor)%4)%4),'base64'),'UTF8')::jsonb;
      v_before_at:=(v_raw->>'createdAt')::timestamptz;
      v_before_id:=(v_raw->>'id')::uuid;
      if v_before_at is null or v_before_id is null then raise invalid_text_representation; end if;
    exception when others then return jsonb_build_object('outcome','invalid_request','result',null);
    end;
  end if;
  v_result:=public.m12_05_list_chat_deliveries(p_organization_id,p_actor_user_id,p_limit,v_before_at,
    v_before_id,p_status,p_event_class,p_channel_id);
  if v_result->>'outcome'<>'ok' then
    return jsonb_build_object('outcome',v_result->>'outcome','result',null); end if;
  if v_result->'nextCursor' is not null and v_result->'nextCursor'<>'null'::jsonb then
    v_next:=rtrim(translate(encode(convert_to((v_result->'nextCursor')::text,'UTF8'),'base64'),'+/','-_'),'=');
  end if;
  return jsonb_build_object('rows',v_result->'rows','nextCursor',v_next);
end $$;

create function public.m12_05_due_chat_organizations(p_limit integer,p_after_org uuid)
returns table(organization_id uuid) language sql stable security definer set search_path=public,pg_temp as $$
  select distinct c.organization_id from public.notification_chat_channels c
  join public.organizations o on o.id=c.organization_id and o.is_active
  where p_limit between 1 and 100 and c.enabled and (p_after_org is null or c.organization_id>p_after_org)
  order by c.organization_id limit p_limit
$$;

-- Resolve each event from its current source record. No provider URL or stored
-- source text is ever trusted to form an application destination.
create function public.m12_05_chat_source_current(
  p_organization_id uuid,p_actor_user_id uuid,p_source_kind text,p_source_id uuid,p_product_ids uuid[]
) returns jsonb language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare v jsonb;
begin
  if p_source_kind='m2_support' then
    select jsonb_build_object('active',e.obsolete_at is null and p.archived_at is null and r.archived_at is null
      and public.m12_03_actor_has_effective_permission(p_organization_id,p_actor_user_id,'can_view_products'),
      'eventClass','countdown_warning','severity',case when e.alert_threshold_days=0 then 'critical' else 'high' end,
      'effectiveAt',coalesce((e.payload->>'supportPeriodEnd')::timestamptz
        -make_interval(days=>e.alert_threshold_days),
        case when e.delivery_attempts=0 then e.due_at end),
      'productId',p.id,'sourceRevision',coalesce(e.support_period_revision,1)::text,
      'appPath','/products/'||p.id::text)
      into v from public.product_regulatory_outbox_events e
      join public.products p on p.organization_id=e.organization_id and p.id=e.product_id
      join public.product_releases r on r.organization_id=e.organization_id and r.id=e.release_id
      where e.organization_id=p_organization_id and e.id=p_source_id and e.event_type='support_period.alert';
  elsif p_source_kind='m5_triage' then
    select jsonb_build_object('active',f.status='active' and p.archived_at is null and r.archived_at is null
      and public.m1201_source_can(p_organization_id,p_actor_user_id,'finding_triage',false)
      and public.m5_triage_finding_severity(p_organization_id,f.id) in ('critical','high'),
      'eventClass','high_severity_alert',
      'severity',case when public.m5_triage_finding_severity(p_organization_id,f.id)='critical' then 'critical' else 'high' end,
      'effectiveAt',e.created_at,'productId',p.id,'sourceRevision','1',
      'appPath','/findings?findingId='||f.id::text)
      into v from public.vulnerability_triage_alert_events e
      join public.vulnerability_findings f on f.organization_id=e.organization_id and f.id=e.finding_id
      join public.product_releases r on r.organization_id=f.organization_id and r.id=f.release_id
      join public.products p on p.organization_id=r.organization_id and p.id=r.product_id
      where e.organization_id=p_organization_id and e.id=p_source_id
        and e.state not in ('skipped_superseded','skipped_deleted');
  elsif p_source_kind='m5_approval' then
    select jsonb_build_object('active',a.is_current and a.approval_state='awaiting_approval' and f.status='active'
      and p.archived_at is null and r.archived_at is null
      and exists(select 1 from public.organization_members m where m.organization_id=p_organization_id
        and public.m1201_eligible_actor(p_organization_id,m.user_id,'finding_approval',a.id)),
      'eventClass','approval_prompt','severity',case when public.m5_triage_finding_severity(p_organization_id,f.id)='critical'
        then 'critical' else 'high' end,'effectiveAt',e.occurred_at,'productId',p.id,'sourceRevision',a.revision::text,
      'appPath','/findings?findingId='||f.id::text||'&assessmentId='||a.id::text)
      into v from public.vulnerability_finding_assessment_history_events e
      join public.vulnerability_finding_assessments a on a.organization_id=e.organization_id and a.id=e.assessment_id
      join public.vulnerability_findings f on f.organization_id=a.organization_id and f.id=a.finding_id
      join public.product_releases r on r.organization_id=f.organization_id and r.id=f.release_id
      join public.products p on p.organization_id=r.organization_id and p.id=r.product_id
      where e.organization_id=p_organization_id and e.id=p_source_id and e.event_type='submitted';
  elsif p_source_kind='m6_deadline' then
    select jsonb_build_object('active',o.status='active' and not o.is_rehearsal
      and s.state not in ('not_required','submitted') and (p.id is null or (p.archived_at is null and r.archived_at is null))
      and public.m1201_source_can(p_organization_id,p_actor_user_id,'report_approval',false),
      'eventClass','countdown_warning','severity',case when a.threshold_percent=100 then 'critical' else 'high' end,
      'effectiveAt',a.threshold_crossed_at,'productId',p.id,'sourceRevision',a.deadline_revision::text,
      'appPath','/reporting?obligationId='||o.id::text||'&stageId='||s.id::text)
      into v from public.reporting_deadline_alerts a
      join public.reporting_obligation_stages s on s.organization_id=a.organization_id and s.id=a.stage_id
      join public.reporting_obligations o on o.organization_id=s.organization_id and o.id=s.obligation_id
      left join public.vulnerability_findings f on f.organization_id=o.organization_id and f.id=o.source_finding_id
      left join public.product_releases r on r.organization_id=f.organization_id and r.id=f.release_id
      left join public.products p on p.organization_id=r.organization_id and p.id=r.product_id
      where a.organization_id=p_organization_id and a.id=p_source_id;
  elsif p_source_kind='m6_approval' then
    select jsonb_build_object('active',o.status='active' and not o.is_rehearsal
      and s.state in ('running','overdue') and d.version::text=(e.new_value->>'draftRevision')
      and p.archived_at is null and r.archived_at is null
      and exists(select 1 from public.organization_members m where m.organization_id=p_organization_id
        and public.m1201_eligible_actor(p_organization_id,m.user_id,'report_approval',s.id)),
      'eventClass','approval_prompt','severity','high','effectiveAt',e.occurred_at,'productId',p.id,
      'sourceRevision',e.new_value->>'draftRevision',
      'appPath','/reporting?obligationId='||o.id::text||'&stageId='||s.id::text)
      into v from public.reporting_obligation_events e
      join public.reporting_obligation_stages s on s.organization_id=e.organization_id
        and s.id::text=e.new_value->>'stageId'
      join public.reporting_obligations o on o.organization_id=s.organization_id and o.id=s.obligation_id
      join public.reporting_stage_drafts d on d.organization_id=s.organization_id and d.stage_id=s.id
      join public.product_releases r on r.organization_id=d.organization_id and r.id=d.release_id
      join public.products p on p.organization_id=r.organization_id and p.id=r.product_id
      where e.organization_id=p_organization_id and e.id=p_source_id and e.event_kind='approval_requested';
  elsif p_source_kind='m8_evidence' then
    select jsonb_build_object('active',d.lifecycle_state='active' and v.processing_state<>'deleted'
      and p.archived_at is null and public.m1201_source_can(p_organization_id,p_actor_user_id,'evidence_expiry',false),
      'eventClass',case when n.event_type='evidence_validity_expiring' then 'countdown_warning' else 'high_severity_alert' end,
      'severity','high','effectiveAt',n.created_at,'productId',p.id,
      'sourceRevision',v.version_number::text||':'||coalesce(n.threshold_days,0)::text,
      'appPath','/products/'||p.id::text||'/evidence?documentId='||d.id::text||'&versionId='||v.id::text)
      into v from public.evidence_document_notification_outbox n
      join public.evidence_document_versions v on v.organization_id=n.organization_id and v.id=n.version_id
      join public.evidence_documents d on d.organization_id=v.organization_id and d.id=v.document_id
      join lateral (select product.id,product.archived_at from public.evidence_document_version_products vp
        join public.products product on product.organization_id=vp.organization_id and product.id=vp.product_id
        where vp.organization_id=v.organization_id and vp.version_id=v.id and product.id=any(p_product_ids)
        order by product.id limit 1) p on true
      where n.organization_id=p_organization_id and n.id=p_source_id and n.status<>'obsolete';
  elsif p_source_kind='m9_owner' then
    select jsonb_build_object('active',q.state='open' and p.archived_at is null and supplier.archived_at is null
      and public.m1201_source_can(p_organization_id,p_actor_user_id,'supplier_request',false),
      'eventClass','countdown_warning','severity','high','effectiveAt',n.scheduled_for,'productId',p.id,
      'sourceRevision',n.revision_id::text,
      'appPath','/suppliers/'||q.supplier_id::text||'?requestId='||q.id::text)
      into v from public.supplier_evidence_reminder_deliveries n
      join public.supplier_evidence_requests q on q.organization_id=n.organization_id and q.id=n.request_id
      join public.products p on p.organization_id=q.organization_id and p.id=q.product_id
      join public.supplier_organizations supplier on supplier.organization_id=q.organization_id and supplier.id=q.supplier_id
      where n.organization_id=p_organization_id and n.id=p_source_id and n.event_kind='owner_escalation'
        and n.state<>'obsolete';
  end if;
  return v;
end $$;

-- Report approval readiness is derived today; capture its transition in the
-- existing reporting event stream in the same transaction as the draft/stage.
alter table public.reporting_obligation_events
  drop constraint reporting_obligation_events_event_kind_check,
  add constraint reporting_obligation_events_event_kind_check check (event_kind in
    ('created','anchor_corrected','stage_submitted','stage_overdue','cancelled',
      'draft_created','draft_saved','stage_approved','approval_invalidated',
      'package_reserved','package_available','package_failed',
      'deadline_threshold_crossed','deadline_breached','filing_reauthenticated',
      'filing_recorded','acknowledgement_recorded','rehearsal_replayed','approval_requested'));
create unique index reporting_approval_requested_revision_idx
  on public.reporting_obligation_events(organization_id,(new_value->>'stageId'),(new_value->>'draftRevision'))
  where event_kind='approval_requested';
create index reporting_chat_approval_event_due_idx
  on public.reporting_obligation_events(organization_id,occurred_at,id)
  where event_kind='approval_requested';
create index triage_chat_event_created_idx
  on public.vulnerability_triage_alert_events(organization_id,created_at,id)
  where state not in ('skipped_superseded','skipped_deleted');
create index assessment_chat_submission_event_idx
  on public.vulnerability_finding_assessment_history_events(organization_id,occurred_at,id)
  where event_type='submitted';
create index evidence_chat_outbox_created_idx
  on public.evidence_document_notification_outbox(organization_id,created_at,id)
  where status<>'obsolete';

create function public.m12_05_emit_report_approval_requested(p_organization_id uuid,p_stage_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row record;
begin
  select d.id draft_id,d.version draft_revision,d.obligation_id,s.stage_kind,o.created_by_user_id,
    rev.changed_by_user_id actor_user_id
    into v_row from public.reporting_stage_drafts d
    join public.reporting_obligation_stages s on s.organization_id=d.organization_id and s.id=d.stage_id
    join public.reporting_obligations o on o.organization_id=s.organization_id and o.id=s.obligation_id
    join public.product_releases r on r.organization_id=d.organization_id and r.id=d.release_id
    join public.products p on p.organization_id=r.organization_id and p.id=r.product_id
    left join lateral (select changed_by_user_id from public.reporting_stage_draft_revisions x
      where x.organization_id=d.organization_id and x.draft_id=d.id
      order by x.revision desc limit 1) rev on true
    where d.organization_id=p_organization_id and d.stage_id=p_stage_id
      and o.status='active' and not o.is_rehearsal and s.state in ('running','overdue')
      and r.archived_at is null and p.archived_at is null
      and public.m6_reporting_draft_complete(d.content,
        public.m6_reporting_stage_field_definitions(o.obligation_type,s.stage_kind),d.member_states)
      and public.m6_reporting_draft_payload_valid(d.content,d.field_provenance,d.member_states,
        o.obligation_type,s.stage_kind)
      and not coalesce((d.field_provenance->'_template'->>'reviewRequired')::boolean,false)
      and not exists(select 1 from public.reporting_stage_approvals a
        where a.organization_id=s.organization_id and a.stage_id=s.id
          and a.draft_id=d.id and a.draft_revision=d.version)
    limit 1;
  if v_row.draft_id is null then return; end if;
  insert into public.reporting_obligation_events(organization_id,obligation_id,event_kind,stage_kind,
    actor_user_id,new_value)
    values(p_organization_id,v_row.obligation_id,'approval_requested',v_row.stage_kind,
      coalesce(v_row.actor_user_id,v_row.created_by_user_id),jsonb_build_object(
        'stageId',p_stage_id,'draftId',v_row.draft_id,'draftRevision',v_row.draft_revision))
    on conflict do nothing;
end $$;

create function public.m12_05_report_approval_revision_trigger()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.m12_05_emit_report_approval_requested(new.organization_id,
    (select d.stage_id from public.reporting_stage_drafts d
      where d.organization_id=new.organization_id and d.id=new.draft_id));
  return new;
end $$;
create trigger report_approval_chat_revision after insert on public.reporting_stage_draft_revisions
  for each row execute function public.m12_05_report_approval_revision_trigger();

create function public.m12_05_report_approval_stage_trigger()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.state is distinct from old.state and new.state in ('running','overdue') then
    perform public.m12_05_emit_report_approval_requested(new.organization_id,new.id);
  end if;
  return new;
end $$;
create trigger report_approval_chat_stage after update of state on public.reporting_obligation_stages
  for each row execute function public.m12_05_report_approval_stage_trigger();

create function public.m12_05_disable_revoked_chat_channels_atomic(p_organization_id uuid)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_channel public.notification_chat_channels%rowtype; v_count integer:=0;
begin
  if p_organization_id is null then return 0; end if;
  for v_channel in select c.* from public.notification_chat_channels c
    where c.organization_id=p_organization_id and c.enabled
      and not public.m12_05_chat_admin(c.organization_id,c.updated_by_user_id)
    order by c.id for update of c loop
    update public.notification_chat_channels set enabled=false,verified_at=null,
      verified_version=null,active_from=null,safe_error_code='route_admin_revoked',
      test_id=null,test_code_hash=null,test_expires_at=null,test_accepted_at=null,
      test_attempt_count=0,version=version+1
      where organization_id=p_organization_id and id=v_channel.id;
    update public.notification_chat_deliveries set
      status=case when status='attempted' then 'uncertain' else 'cancelled' end,
      safe_error_code='route_admin_revoked',lease_owner=null,lease_expires_at=null,
      version=version+1
      where organization_id=p_organization_id and channel_id=v_channel.id
        and status in ('queued','failed','attempted');
    insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
      values(p_organization_id,v_channel.updated_by_user_id,
        'notification.chat_route_admin_revoked','notification_chat_channel',
        v_channel.id::text,jsonb_build_object('version',v_channel.version+1));
    v_count:=v_count+1;
  end loop;
  return v_count;
end $$;

create function public.m12_05_bridge_chat_deliveries_atomic(p_organization_id uuid,p_limit integer)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_channel public.notification_chat_channels%rowtype; v_added integer:=0; v_step integer;
begin
  if p_organization_id is null or p_limit not between 1 and 100 then return 0; end if;
  perform public.m12_05_disable_revoked_chat_channels_atomic(p_organization_id);
  for v_channel in select c.* from public.notification_chat_channels c
    join public.organizations o on o.id=c.organization_id and o.is_active
    where c.organization_id=p_organization_id and c.enabled
      and public.m12_05_chat_admin(c.organization_id,c.updated_by_user_id)
    order by c.id limit 100 loop
    with source_ids as (
      (select 'm2_support'::text kind,e.id source_id,
          coalesce((e.payload->>'supportPeriodEnd')::timestamptz
            -make_interval(days=>e.alert_threshold_days),
            case when e.delivery_attempts=0 then e.due_at end) effective_at
        from public.product_regulatory_outbox_events e
        join public.products p on p.organization_id=e.organization_id and p.id=e.product_id
        join public.product_releases r on r.organization_id=e.organization_id and r.id=e.release_id
        where e.organization_id=p_organization_id and e.event_type='support_period.alert'
          and e.obsolete_at is null and p.archived_at is null and r.archived_at is null
          and p.id=any(v_channel.product_ids)
          and coalesce((e.payload->>'supportPeriodEnd')::timestamptz
            -make_interval(days=>e.alert_threshold_days),
            case when e.delivery_attempts=0 then e.due_at end)
            between v_channel.active_from and clock_timestamp()
          and not exists(select 1 from public.notification_chat_deliveries d where d.organization_id=p_organization_id
            and d.channel_id=v_channel.id and d.source_kind='m2_support' and d.source_id=e.id
            and d.source_revision=coalesce(e.support_period_revision,1)::text)
        order by coalesce((e.payload->>'supportPeriodEnd')::timestamptz
            -make_interval(days=>e.alert_threshold_days),
            case when e.delivery_attempts=0 then e.due_at end),e.id limit p_limit)
      union all
      (select 'm5_triage',e.id,e.created_at from public.vulnerability_triage_alert_events e
        join public.vulnerability_findings f on f.organization_id=e.organization_id and f.id=e.finding_id
        join public.product_releases r on r.organization_id=f.organization_id and r.id=f.release_id
        join public.products p on p.organization_id=r.organization_id and p.id=r.product_id
        where e.organization_id=p_organization_id and e.created_at between v_channel.active_from and clock_timestamp()
          and e.state not in ('skipped_superseded','skipped_deleted') and f.status='active'
          and p.archived_at is null and r.archived_at is null and p.id=any(v_channel.product_ids)
          and public.m5_triage_finding_severity(p_organization_id,f.id) in ('critical','high')
          and not exists(select 1 from public.notification_chat_deliveries d where d.organization_id=p_organization_id
            and d.channel_id=v_channel.id and d.source_kind='m5_triage' and d.source_id=e.id)
        order by e.created_at,e.id limit p_limit)
      union all
      (select 'm5_approval',e.id,e.occurred_at from public.vulnerability_finding_assessment_history_events e
        join public.vulnerability_finding_assessments a on a.organization_id=e.organization_id and a.id=e.assessment_id
        join public.vulnerability_findings f on f.organization_id=a.organization_id and f.id=a.finding_id
        join public.product_releases r on r.organization_id=f.organization_id and r.id=f.release_id
        join public.products p on p.organization_id=r.organization_id and p.id=r.product_id
        where e.organization_id=p_organization_id and e.event_type='submitted'
          and a.is_current and a.approval_state='awaiting_approval' and f.status='active'
          and p.archived_at is null and r.archived_at is null and p.id=any(v_channel.product_ids)
          and exists(select 1 from public.organization_members m where m.organization_id=p_organization_id
            and public.m1201_eligible_actor(p_organization_id,m.user_id,'finding_approval',a.id))
          and e.occurred_at between v_channel.active_from and clock_timestamp()
          and not exists(select 1 from public.notification_chat_deliveries d where d.organization_id=p_organization_id
            and d.channel_id=v_channel.id and d.source_kind='m5_approval' and d.source_id=e.id)
        order by e.occurred_at,e.id limit p_limit)
      union all
      (select 'm6_deadline',a.id,a.threshold_crossed_at from public.reporting_deadline_alerts a
        join public.reporting_obligation_stages s on s.organization_id=a.organization_id and s.id=a.stage_id
        join public.reporting_obligations o on o.organization_id=s.organization_id and o.id=s.obligation_id
        left join public.vulnerability_findings f on f.organization_id=o.organization_id and f.id=o.source_finding_id
        left join public.product_releases r on r.organization_id=f.organization_id and r.id=f.release_id
        left join public.products p on p.organization_id=r.organization_id and p.id=r.product_id
        where a.organization_id=p_organization_id and a.threshold_crossed_at between v_channel.active_from and clock_timestamp()
          and o.status='active' and not o.is_rehearsal and s.state not in ('not_required','submitted')
          and (p.id=any(v_channel.product_ids) and p.archived_at is null and r.archived_at is null
            or p.id is null and v_channel.include_organization_wide)
          and not exists(select 1 from public.notification_chat_deliveries d where d.organization_id=p_organization_id
            and d.channel_id=v_channel.id and d.source_kind='m6_deadline' and d.source_id=a.id)
        order by a.threshold_crossed_at,a.id limit p_limit)
      union all
      (select 'm6_approval',e.id,e.occurred_at from public.reporting_obligation_events e
        join public.reporting_obligation_stages s on s.organization_id=e.organization_id
          and s.id::text=e.new_value->>'stageId'
        join public.reporting_obligations o on o.organization_id=s.organization_id and o.id=s.obligation_id
        join public.reporting_stage_drafts draft on draft.organization_id=s.organization_id and draft.stage_id=s.id
        join public.product_releases r on r.organization_id=draft.organization_id and r.id=draft.release_id
        join public.products p on p.organization_id=r.organization_id and p.id=r.product_id
        where e.organization_id=p_organization_id and e.event_kind='approval_requested'
          and o.status='active' and not o.is_rehearsal and s.state in ('running','overdue')
          and draft.version::text=e.new_value->>'draftRevision'
          and p.archived_at is null and r.archived_at is null and p.id=any(v_channel.product_ids)
          and exists(select 1 from public.organization_members m where m.organization_id=p_organization_id
            and public.m1201_eligible_actor(p_organization_id,m.user_id,'report_approval',s.id))
          and e.occurred_at between v_channel.active_from and clock_timestamp()
          and not exists(select 1 from public.notification_chat_deliveries d where d.organization_id=p_organization_id
            and d.channel_id=v_channel.id and d.source_kind='m6_approval' and d.source_id=e.id)
        order by e.occurred_at,e.id limit p_limit)
      union all
      (select 'm8_evidence',n.id,n.created_at from public.evidence_document_notification_outbox n
        join public.evidence_document_versions v on v.organization_id=n.organization_id and v.id=n.version_id
        join public.evidence_documents doc on doc.organization_id=v.organization_id and doc.id=v.document_id
        where n.organization_id=p_organization_id and n.created_at between v_channel.active_from and clock_timestamp()
          and n.status<>'obsolete' and doc.lifecycle_state='active' and v.processing_state<>'deleted'
          and exists(select 1 from public.evidence_document_version_products vp
            join public.products p on p.organization_id=vp.organization_id and p.id=vp.product_id
            where vp.organization_id=n.organization_id and vp.version_id=n.version_id
              and p.id=any(v_channel.product_ids) and p.archived_at is null)
          and not exists(select 1 from public.notification_chat_deliveries d where d.organization_id=p_organization_id
            and d.channel_id=v_channel.id and d.source_kind='m8_evidence' and d.source_id=n.id)
        order by n.created_at,n.id limit p_limit)
      union all
      (select 'm9_owner',n.id,n.scheduled_for from public.supplier_evidence_reminder_deliveries n
        join public.supplier_evidence_requests q on q.organization_id=n.organization_id and q.id=n.request_id
        join public.products p on p.organization_id=q.organization_id and p.id=q.product_id
        join public.supplier_organizations supplier on supplier.organization_id=q.organization_id and supplier.id=q.supplier_id
        where n.organization_id=p_organization_id and n.event_kind='owner_escalation'
          and n.state<>'obsolete' and q.state='open' and p.archived_at is null
          and supplier.archived_at is null and p.id=any(v_channel.product_ids)
          and n.scheduled_for between v_channel.active_from and clock_timestamp()
          and not exists(select 1 from public.notification_chat_deliveries d where d.organization_id=p_organization_id
            and d.channel_id=v_channel.id and d.source_kind='m9_owner' and d.source_id=n.id)
        order by n.scheduled_for,n.id limit p_limit)
    ), resolved as (
      select s.kind,s.source_id,s.effective_at,
        public.m12_05_chat_source_current(p_organization_id,v_channel.updated_by_user_id,s.kind,s.source_id,
          v_channel.product_ids) source_json from source_ids s
    ), eligible as (
      select r.kind,r.source_id,r.effective_at,r.source_json,
        (r.source_json->>'productId')::uuid source_product_id
      from resolved r where coalesce((r.source_json->>'active')::boolean,false)
        and r.source_json->>'eventClass'=any(v_channel.event_classes)
        and r.source_json->>'sourceRevision' is not null
    ), needed as (
      select e.* from eligible e
      where (e.source_product_id=any(v_channel.product_ids)
        or (e.source_product_id is null and v_channel.include_organization_wide and e.kind='m6_deadline'))
        and not exists(select 1 from public.notification_chat_deliveries d
          where d.organization_id=p_organization_id and d.channel_id=v_channel.id
            and d.source_kind=e.kind and d.source_id=e.source_id
            and d.source_revision=e.source_json->>'sourceRevision')
      order by e.effective_at,e.kind,e.source_id limit greatest(p_limit-v_added,0)
    )
    insert into public.notification_chat_deliveries(organization_id,channel_id,event_class,source_kind,
      source_id,source_revision,source_product_id,severity,effective_at,next_attempt_at,route_version)
    select p_organization_id,v_channel.id,n.source_json->>'eventClass',n.kind,n.source_id,
      n.source_json->>'sourceRevision',n.source_product_id,n.source_json->>'severity',
      n.effective_at,n.effective_at,v_channel.version from needed n
    on conflict (organization_id,channel_id,source_kind,source_id,source_revision) do nothing;
    get diagnostics v_step=row_count;
    v_added:=v_added+v_step;
    exit when v_added>=p_limit;
  end loop;
  return v_added;
end $$;

create function public.m12_05_claim_chat_delivery_atomic(
  p_organization_id uuid,p_lease_owner uuid,p_lease_seconds integer
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_delivery public.notification_chat_deliveries%rowtype;
  v_channel public.notification_chat_channels%rowtype;
begin
  if p_organization_id is null or p_lease_owner is null or p_lease_seconds not between 5 and 120 then
    return jsonb_build_object('outcome','invalid_request','result',null); end if;
  -- Attempted is written before outbound bytes. An expired attempt has an
  -- ambiguous external outcome and must never be claimed automatically.
  update public.notification_chat_deliveries set status='uncertain',safe_error_code='lease_expired',
    lease_owner=null,lease_expires_at=null,version=version+1
    where organization_id=p_organization_id and status='attempted' and lease_expires_at<=clock_timestamp();
  for v_delivery in select d.* from public.notification_chat_deliveries d
    where d.organization_id=p_organization_id and d.status in ('queued','failed')
      and d.next_attempt_at<=clock_timestamp() and d.attempt_count<6
    order by d.next_attempt_at,d.id for update skip locked limit 20 loop
    select * into v_channel from public.notification_chat_channels c
      where c.organization_id=p_organization_id and c.id=v_delivery.channel_id for update skip locked;
    if not found then continue; end if;
    if not v_channel.enabled or v_channel.version<>v_delivery.route_version
      or not public.m12_05_chat_admin(p_organization_id,v_channel.updated_by_user_id) then
      update public.notification_chat_deliveries set status='cancelled',safe_error_code='route_unavailable',
        version=version+1 where organization_id=p_organization_id and id=v_delivery.id;
      continue;
    end if;
    if v_channel.last_claimed_at is not null and v_channel.last_claimed_at>clock_timestamp()-interval '1 second' then
      continue;
    end if;
    update public.notification_chat_channels set last_claimed_at=clock_timestamp()
      where organization_id=p_organization_id and id=v_channel.id;
    update public.notification_chat_deliveries set status='attempted',attempt_count=attempt_count+1,
      total_attempt_count=total_attempt_count+1,
      attempted_at=clock_timestamp(),lease_owner=p_lease_owner,
      lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),
      safe_error_code=null,version=version+1
      where organization_id=p_organization_id and id=v_delivery.id returning * into v_delivery;
    return jsonb_build_object('outcome','claimed','result',jsonb_build_object(
      'deliveryId',v_delivery.id,'checkpointVersion',v_delivery.version));
  end loop;
  return jsonb_build_object('outcome','none_available','result',null);
end $$;

create function public.m12_05_chat_delivery_still_authorized(
  p_organization_id uuid,p_delivery public.notification_chat_deliveries,
  p_channel public.notification_chat_channels
) returns jsonb language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare v_source jsonb; v_product_id uuid;
begin
  if not p_channel.enabled or p_channel.version<>p_delivery.route_version
    or p_channel.active_from is null or p_delivery.effective_at<p_channel.active_from
    or not public.m12_05_chat_admin(p_organization_id,p_channel.updated_by_user_id) then return null; end if;
  v_source:=public.m12_05_chat_source_current(p_organization_id,p_channel.updated_by_user_id,
    p_delivery.source_kind,p_delivery.source_id,p_channel.product_ids);
  if not coalesce((v_source->>'active')::boolean,false) then return null; end if;
  v_product_id:=(v_source->>'productId')::uuid;
  if not (v_product_id=any(p_channel.product_ids)
    or (v_product_id is null and p_channel.include_organization_wide and p_delivery.source_kind='m6_deadline'))
    or v_product_id is distinct from p_delivery.source_product_id
    or v_source->>'sourceRevision' is distinct from p_delivery.source_revision
    or v_source->>'eventClass' is distinct from p_delivery.event_class
    or v_source->>'severity' is distinct from p_delivery.severity
    or v_source->>'appPath' is null then return null; end if;
  return v_source;
end $$;

create function public.m12_05_prepare_chat_delivery_atomic(
  p_organization_id uuid,p_delivery_id uuid,p_lease_owner uuid,p_checkpoint_version integer
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_delivery public.notification_chat_deliveries%rowtype;
  v_channel public.notification_chat_channels%rowtype; v_source jsonb;
begin
  select * into v_delivery from public.notification_chat_deliveries
    where organization_id=p_organization_id and id=p_delivery_id for update;
  if not found then return jsonb_build_object('outcome','not_found','result',null); end if;
  if v_delivery.status<>'attempted' or v_delivery.lease_owner is distinct from p_lease_owner
    or v_delivery.version<>p_checkpoint_version then
    return jsonb_build_object('outcome','conflict','result',null); end if;
  if v_delivery.lease_expires_at<=clock_timestamp() then
    update public.notification_chat_deliveries set status='uncertain',safe_error_code='lease_expired',
      lease_owner=null,lease_expires_at=null,version=version+1
      where organization_id=p_organization_id and id=p_delivery_id;
    return jsonb_build_object('outcome','conflict','result',null);
  end if;
  select * into v_channel from public.notification_chat_channels
    where organization_id=p_organization_id and id=v_delivery.channel_id;
  v_source:=public.m12_05_chat_delivery_still_authorized(p_organization_id,v_delivery,v_channel);
  if v_source is null then
    update public.notification_chat_deliveries set status='cancelled',safe_error_code='authorization_changed',
      lease_owner=null,lease_expires_at=null,version=version+1
      where organization_id=p_organization_id and id=p_delivery_id;
    return jsonb_build_object('outcome','cancelled','result',null);
  end if;
  return jsonb_build_object('outcome','ready','result',jsonb_build_object(
    'channelId',v_channel.id,'mode',v_channel.mode,'targetMetadata',v_channel.target_metadata,
    'credentialEnvelope',v_channel.credential_envelope,'credentialRevision',v_channel.credential_revision,
    'eventClass',v_delivery.event_class,'severity',v_delivery.severity,
    'effectiveAt',public.m12_05_chat_utc(v_delivery.effective_at),'appPath',v_source->>'appPath'));
end $$;

create function public.m12_05_revalidate_chat_delivery_atomic(
  p_organization_id uuid,p_delivery_id uuid,p_lease_owner uuid,p_checkpoint_version integer
) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_delivery public.notification_chat_deliveries%rowtype;
  v_channel public.notification_chat_channels%rowtype;
begin
  select * into v_delivery from public.notification_chat_deliveries
    where organization_id=p_organization_id and id=p_delivery_id for update;
  if not found or v_delivery.status<>'attempted' or v_delivery.lease_owner is distinct from p_lease_owner
    or v_delivery.version<>p_checkpoint_version then return false; end if;
  if v_delivery.lease_expires_at<=clock_timestamp() then
    update public.notification_chat_deliveries set status='uncertain',safe_error_code='lease_expired',
      lease_owner=null,lease_expires_at=null,version=version+1
      where organization_id=p_organization_id and id=p_delivery_id;
    return false;
  end if;
  select * into v_channel from public.notification_chat_channels
    where organization_id=p_organization_id and id=v_delivery.channel_id;
  if public.m12_05_chat_delivery_still_authorized(p_organization_id,v_delivery,v_channel) is null then
    update public.notification_chat_deliveries set status='cancelled',safe_error_code='authorization_changed',
      lease_owner=null,lease_expires_at=null,version=version+1
      where organization_id=p_organization_id and id=p_delivery_id;
    return false;
  end if;
  return true;
end $$;

create function public.m12_05_complete_chat_delivery_atomic(
  p_organization_id uuid,p_delivery_id uuid,p_lease_owner uuid,p_checkpoint_version integer,
  p_status text,p_safe_error_code text,p_provider_message_id_hash text,p_retry_after_seconds integer
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_delivery public.notification_chat_deliveries%rowtype; v_next_status text; v_delay integer;
begin
  if p_status not in ('provider_accepted','failed','exhausted','uncertain','cancelled')
    or (p_safe_error_code is not null and p_safe_error_code !~ '^[a-z][a-z0-9_]{0,63}$')
    or (p_provider_message_id_hash is not null and p_provider_message_id_hash !~ '^[a-f0-9]{64}$')
    or (p_retry_after_seconds is not null and p_retry_after_seconds not between 0 and 900) then
    return jsonb_build_object('outcome','conflict','result',null); end if;
  select * into v_delivery from public.notification_chat_deliveries
    where organization_id=p_organization_id and id=p_delivery_id for update;
  if not found then return jsonb_build_object('outcome','not_found','result',null); end if;
  if v_delivery.status<>'attempted' or v_delivery.lease_owner is distinct from p_lease_owner
    or v_delivery.version<>p_checkpoint_version then
    return jsonb_build_object('outcome','conflict','result',null); end if;
  v_next_status:=case when p_status='failed' and v_delivery.attempt_count>=6 then 'exhausted' else p_status end;
  v_delay:=least(900,greatest(coalesce(p_retry_after_seconds,0),
    least(300,5*power(2,greatest(v_delivery.attempt_count-1,0))::integer)));
  update public.notification_chat_deliveries set status=v_next_status,
    safe_error_code=case when v_next_status='provider_accepted' then null
      else coalesce(p_safe_error_code,'provider_unavailable') end,
    provider_message_id_hash=case when v_next_status='provider_accepted' then p_provider_message_id_hash else null end,
    provider_accepted_at=case when v_next_status='provider_accepted' then clock_timestamp() else null end,
    next_attempt_at=case when v_next_status='failed' then clock_timestamp()+make_interval(secs=>v_delay)
      else next_attempt_at end,
    lease_owner=null,lease_expires_at=null,version=version+1
    where organization_id=p_organization_id and id=p_delivery_id;
  return jsonb_build_object('outcome','completed','result',null);
end $$;

create function public.m12_05_retry_chat_delivery_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_delivery_id uuid,p_expected_version integer,
  p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_delivery public.notification_chat_deliveries%rowtype;
  v_channel public.notification_chat_channels%rowtype;
begin
  if not public.m12_05_chat_admin(p_organization_id,p_actor_user_id) then
    return jsonb_build_object('outcome','forbidden','result',null); end if;
  if p_idempotency_key is null or p_expected_version is null or p_expected_version<1 then
    return jsonb_build_object('outcome','invalid_request','result',null); end if;
  select * into v_delivery from public.notification_chat_deliveries
    where organization_id=p_organization_id and id=p_delivery_id for update;
  if not found then return jsonb_build_object('outcome','not_found','result',null); end if;
  if v_delivery.last_retry_key=p_idempotency_key then
    return jsonb_build_object('outcome',case when v_delivery.last_retry_actor=p_actor_user_id
      then 'replayed' else 'idempotency_conflict' end,
      'result',jsonb_build_object('delivery',public.m12_05_chat_delivery_public(v_delivery))); end if;
  if v_delivery.version<>p_expected_version then
    return jsonb_build_object('outcome','conflict','result',null); end if;
  if v_delivery.status not in ('failed','exhausted','uncertain') or v_delivery.manual_retry_count>=3 then
    return jsonb_build_object('outcome','invalid_state','result',null); end if;
  select * into v_channel from public.notification_chat_channels
    where organization_id=p_organization_id and id=v_delivery.channel_id for update;
  if public.m12_05_chat_delivery_still_authorized(p_organization_id,v_delivery,v_channel) is null then
    return jsonb_build_object('outcome','invalid_state','result',null); end if;
  update public.notification_chat_deliveries set status='queued',attempt_count=0,
    manual_retry_count=manual_retry_count+1,next_attempt_at=clock_timestamp(),safe_error_code=null,
    lease_owner=null,lease_expires_at=null,provider_message_id_hash=null,provider_accepted_at=null,
    version=version+1,last_retry_key=p_idempotency_key,last_retry_actor=p_actor_user_id
    where organization_id=p_organization_id and id=p_delivery_id returning * into v_delivery;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
    values(p_organization_id,p_actor_user_id,'notification.chat_delivery_retried','notification_chat_delivery',
      p_delivery_id::text,jsonb_build_object('version',v_delivery.version,
        'manualRetryCount',v_delivery.manual_retry_count));
  return jsonb_build_object('outcome','updated','result',jsonb_build_object(
    'delivery',public.m12_05_chat_delivery_public(v_delivery)));
end $$;

create function public.m12_05_list_chat_envelopes(
  p_organization_id uuid,p_after_id uuid,p_limit integer
) returns table(channel_id uuid,credential_revision integer,credential_envelope jsonb)
language sql stable security definer set search_path=public,pg_temp as $$
  select c.id,c.credential_revision,c.credential_envelope from public.notification_chat_channels c
  where p_organization_id is not null and p_limit between 1 and 100
    and c.organization_id=p_organization_id and (p_after_id is null or c.id>p_after_id)
  order by c.id limit p_limit
$$;

create function public.m12_05_rewrap_chat_envelope_atomic(
  p_organization_id uuid,p_channel_id uuid,p_expected_credential_revision integer,
  p_expected_envelope jsonb,p_new_envelope jsonb
) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_count integer;
begin
  if p_organization_id is null or p_channel_id is null or p_expected_credential_revision<1
    or not coalesce(public.m12_05_chat_envelope_valid(p_new_envelope),false) then return false; end if;
  update public.notification_chat_channels set credential_envelope=p_new_envelope
    where organization_id=p_organization_id and id=p_channel_id
      and credential_revision=p_expected_credential_revision
      and credential_envelope=p_expected_envelope;
  get diagnostics v_count=row_count;
  return v_count=1;
end $$;

create function public.m12_05_list_chat_cleanup_organizations(p_limit integer)
returns table(organization_id uuid) language sql stable security definer set search_path=public,pg_temp as $$
  select d.organization_id from public.notification_chat_deliveries d
  where p_limit between 1 and 100 and d.effective_at<clock_timestamp()-interval '180 days'
    and d.status not in ('queued','attempted','failed')
  group by d.organization_id order by min(d.effective_at),d.organization_id limit p_limit
$$;

create function public.m12_05_cleanup_chat_deliveries_atomic(p_organization_id uuid,p_limit integer)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_count integer;
begin
  if p_organization_id is null or p_limit not between 1 and 100 then return 0; end if;
  with expired as (
    select d.id from public.notification_chat_deliveries d
    where d.organization_id=p_organization_id and d.effective_at<clock_timestamp()-interval '180 days'
      and d.status not in ('queued','attempted','failed')
    order by d.effective_at,d.id limit p_limit for update skip locked
  ), deleted as (
    delete from public.notification_chat_deliveries d using expired e
    where d.organization_id=p_organization_id and d.id=e.id returning d.id
  ) select count(*)::integer into v_count from deleted;
  return v_count;
end $$;

insert into public.organization_export_source_tables(
  source_id,table_name,tenant_key_column,record_order_column,table_sort
) values
  ('notification_delivery','notification_chat_channels','organization_id','created_at',4),
  ('notification_delivery','notification_chat_deliveries','organization_id','created_at',5)
on conflict (source_id,table_name) do nothing;

do $$
declare v_definition text; v_anchor text:=E'\n  in share mode;'; v_lock_section text;
begin
  select pg_get_functiondef(to_regprocedure(
    'public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)'))
    into v_definition;
  if v_definition is null or position(v_anchor in v_definition)=0 then
    raise exception 'M12-05 export lock anchor missing'; end if;
  v_lock_section:=split_part(split_part(v_definition,'lock table',2),'in share mode;',1);
  if position('public.notification_chat_channels' in v_lock_section)=0 then
    v_definition:=replace(v_definition,v_anchor,', public.notification_chat_channels'||v_anchor);
  end if;
  v_lock_section:=split_part(split_part(v_definition,'lock table',2),'in share mode;',1);
  if position('public.notification_chat_deliveries' in v_lock_section)=0 then
    v_definition:=replace(v_definition,v_anchor,', public.notification_chat_deliveries'||v_anchor);
  end if;
  execute v_definition;
end $$;

do $$
declare v_definition text; v_anchor text:=E'\n  case p_table_name\n';
  v_branch text:=E'\n  if p_table_name = ''notification_chat_channels'' then\n    return v_record - array[''credential_envelope'',''target_metadata'',''test_code_hash'',''last_command_digest'',''last_command_key'',''last_command_actor''];\n  end if;\n  if p_table_name = ''notification_chat_deliveries'' then\n    return v_record - array[''next_attempt_at'',''provider_message_id_hash'',''last_retry_key'',''last_retry_actor''];\n  end if;\n';
begin
  select pg_get_functiondef(to_regprocedure('public.m1_export_business_record_jsonb(text,jsonb)'))
    into v_definition;
  if v_definition is null or position(v_anchor in v_definition)=0 then
    raise exception 'M12-05 export projection anchor missing'; end if;
  if position('notification_chat_channels' in v_definition)=0 then
    execute replace(v_definition,v_anchor,v_branch||v_anchor);
  end if;
end $$;

-- Existing M12-01 approval task eligibility must recognize a newly revised
-- draft; the previous revision's legal approval remains preserved as evidence.
do $$
declare v_definition text;
  v_old text:='not exists(select 1 from public.reporting_stage_approvals a where a.organization_id=s.organization_id and a.stage_id=s.id)';
  v_new text:='not exists(select 1 from public.reporting_stage_approvals a where a.organization_id=s.organization_id and a.stage_id=s.id and a.draft_id=d.id and a.draft_revision=d.version)';
begin
  select pg_get_functiondef(to_regprocedure('public.m1201_source(uuid,uuid,text,uuid)')) into v_definition;
  if v_definition is null or position(v_old in v_definition)=0 then
    raise exception 'M12-05 approval projection anchor missing'; end if;
  execute replace(v_definition,v_old,v_new);
end $$;

-- Every security definer in this migration has an explicit execution audience.
do $$
declare v_signature text;
begin
  foreach v_signature in array array[
    'm12_05_chat_admin(uuid,uuid)',
    'm12_05_chat_auditor(uuid,uuid)',
    'm12_05_chat_configuration_valid(uuid,uuid,jsonb)',
    'm12_05_chat_utc(timestamp with time zone)',
    'm12_05_chat_channel_public(notification_chat_channels)',
    'm12_05_chat_delivery_public(notification_chat_deliveries)',
    'm12_05_chat_digest(text,jsonb)',
    'm12_05_chat_envelope_valid(jsonb)',
    'm12_05_create_chat_channel_atomic(uuid,uuid,uuid,jsonb,jsonb,integer,text,uuid)',
    'm12_05_update_chat_channel_atomic(uuid,uuid,uuid,integer,jsonb,jsonb,integer,text,uuid)',
    'm12_05_begin_chat_channel_test_atomic(uuid,uuid,uuid,integer,text,uuid)',
    'm12_05_complete_chat_channel_test_atomic(uuid,uuid,uuid,uuid,text,text,text)',
    'm12_05_confirm_chat_channel_atomic(uuid,uuid,uuid,integer,uuid,text,uuid)',
    'm12_05_set_chat_channel_enabled_atomic(uuid,uuid,uuid,integer,boolean,uuid)',
    'm12_05_list_chat_channels(uuid,uuid,integer,uuid,text)',
    'm12_05_list_chat_deliveries(uuid,uuid,integer,timestamp with time zone,uuid,text,text,uuid)',
    'm12_05_list_chat_channels_atomic(uuid,uuid)',
    'm12_05_list_chat_deliveries_atomic(uuid,uuid,text,text,uuid,text,integer)',
    'm12_05_due_chat_organizations(integer,uuid)',
    'm12_05_chat_source_current(uuid,uuid,text,uuid,uuid[])',
    'm12_05_emit_report_approval_requested(uuid,uuid)',
    'm12_05_report_approval_revision_trigger()',
    'm12_05_report_approval_stage_trigger()',
    'm12_05_disable_revoked_chat_channels_atomic(uuid)',
    'm12_05_bridge_chat_deliveries_atomic(uuid,integer)',
    'm12_05_claim_chat_delivery_atomic(uuid,uuid,integer)',
    'm12_05_chat_delivery_still_authorized(uuid,notification_chat_deliveries,notification_chat_channels)',
    'm12_05_prepare_chat_delivery_atomic(uuid,uuid,uuid,integer)',
    'm12_05_revalidate_chat_delivery_atomic(uuid,uuid,uuid,integer)',
    'm12_05_complete_chat_delivery_atomic(uuid,uuid,uuid,integer,text,text,text,integer)',
    'm12_05_retry_chat_delivery_atomic(uuid,uuid,uuid,integer,uuid)',
    'm12_05_list_chat_envelopes(uuid,uuid,integer)',
    'm12_05_rewrap_chat_envelope_atomic(uuid,uuid,integer,jsonb,jsonb)',
    'm12_05_list_chat_cleanup_organizations(integer)',
    'm12_05_cleanup_chat_deliveries_atomic(uuid,integer)'
  ] loop
    execute format('alter function public.%s owner to postgres',v_signature);
    execute format('revoke all on function public.%s from public,anon,authenticated',v_signature);
    execute format('grant execute on function public.%s to service_role',v_signature);
  end loop;
end $$;
