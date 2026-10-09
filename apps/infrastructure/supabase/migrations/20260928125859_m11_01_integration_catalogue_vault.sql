-- M11-01 expand: versioned vault envelopes and feature-owned durable commands.
-- Credentials and keys are never parameters of these RPCs: encryption is local
-- to the server. Legacy PGP remains readable until the guarded retirement step.

alter table public.connectors
  add column connection_revision integer not null default 1 check (connection_revision > 0),
  add column credential_revision integer not null default 0 check (credential_revision >= 0),
  add column last_test_connection_revision integer,
  add column scope_assessment jsonb not null default '{"status":"unknown","policyVersion":"unverified","grantedScopes":[],"missingScopes":[],"excessScopes":[]}'::jsonb,
  add column disabled_at timestamptz,
  add column disabled_by uuid references public.users(id) on delete restrict;

alter table public.connector_secrets
  add column encryption_scheme text not null default 'legacy_pgp' check (encryption_scheme in ('legacy_pgp','aes_256_gcm_v1')),
  add column key_id text,
  add column nonce bytea,
  add column auth_tag bytea,
  add column credential_revision integer not null default 1 check (credential_revision > 0),
  add column revoked_at timestamptz,
  add column revoked_by uuid references public.users(id) on delete restrict,
  add constraint connector_secrets_envelope_check check (
    (encryption_scheme='legacy_pgp' and key_id is null and nonce is null and auth_tag is null)
    or (encryption_scheme='aes_256_gcm_v1' and key_id is not null and nonce is not null and auth_tag is not null and key_id ~ '^[A-Za-z0-9_.-]{1,80}$'
      and octet_length(nonce)=12 and octet_length(auth_tag)=16 and octet_length(ciphertext) between 1 and 80000)),
  add constraint connector_secrets_revocation_pair_check check ((revoked_at is null)=(revoked_by is null)),
  add constraint connector_secrets_connector_identity_key unique (organization_id,connector_id,id);

-- Strengthen the old org-only reference: a secret cannot belong to a different
-- connector even within the same organization.
alter table public.connectors drop constraint connectors_secret_ref_fkey;
alter table public.connectors add constraint connectors_secret_ref_fkey
  foreign key (organization_id,id,secret_ref) references public.connector_secrets(organization_id,connector_id,id)
  on delete no action deferrable initially deferred;
update public.connectors set credential_revision=1 where secret_ref is not null;

create table public.connector_commands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connector_id uuid not null,
  actor_user_id uuid not null references public.users(id) on delete restrict,
  operation text not null check (operation in ('configure','replace_secret','revoke_secret','disconnect','reconnect','test_connection')),
  idempotency_key uuid not null,
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  request_digest_key_id text not null check (request_digest_key_id ~ '^[A-Za-z0-9_.-]{1,80}$'),
  state text not null check (state in ('running','completed','interrupted')),
  expected_version integer not null check (expected_version>0),
  connection_revision integer not null check (connection_revision>0),
  credential_revision integer not null check (credential_revision>=0),
  permission_version bigint not null check (permission_version>0),
  deadline_at timestamptz not null,
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result)='object' and octet_length(result::text)<=20000),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (organization_id,actor_user_id,idempotency_key),
  foreign key (organization_id,connector_id) references public.connectors(organization_id,id) on delete cascade,
  check ((state='running')=(completed_at is null))
);
create unique index connector_commands_one_active_test on public.connector_commands(organization_id,connector_id)
 where operation='test_connection' and state='running';
create index connector_commands_connector_history on public.connector_commands(organization_id,connector_id,created_at desc,id desc);
create index connector_commands_actor_idx on public.connector_commands(actor_user_id);
create index connector_commands_deadline_idx on public.connector_commands(deadline_at) where state='running';
alter table public.connector_commands enable row level security;
revoke all on public.connector_commands from public,anon,authenticated,service_role;
grant select on public.connector_commands to service_role;

-- Existing RBAC resolver authorizes the operation; this locks the identity and
-- the version it resolved. This is a fence, not a duplicate permission resolver.
create function public.m11_lock_connector_authorization(
 p_organization_id uuid,p_actor_user_id uuid,p_permission_version bigint,p_owner_only boolean default false
) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_epoch bigint;
begin
 perform 1 from public.organizations where id=p_organization_id and is_active for share;
 if not found then return false; end if;
 perform 1 from public.users where id=p_actor_user_id and is_active for share;
 if not found then return false; end if;
 select role into v_role from public.organization_members
 where organization_id=p_organization_id and user_id=p_actor_user_id for share;
 if not found or (p_owner_only and v_role<>'owner') then return false; end if;
 select version into v_epoch from public.organization_permissions_version where organization_id=p_organization_id for share;
 return p_permission_version is not null and v_epoch is not null and v_epoch=p_permission_version;
end $$;

create function public.m11_connector_command_json(p_command public.connector_commands)
returns jsonb language sql stable set search_path=public,pg_temp as $$
 select jsonb_build_object('id',p_command.id,'operation',p_command.operation,'state',p_command.state,
 'connectionRevision',p_command.connection_revision,'credentialRevision',p_command.credential_revision,
 'permissionVersion',p_command.permission_version,'requestDigestKeyId',p_command.request_digest_key_id,
 'deadlineAt',p_command.deadline_at,'result',p_command.result)
$$;

create function public.m11_valid_connector_scope_assessment(p_scope jsonb)
returns boolean language plpgsql immutable set search_path=public,pg_temp as $$
declare v_names jsonb; v_name jsonb;
begin
 if jsonb_typeof(p_scope) is distinct from 'object' then return false; end if;
 if p_scope->>'status' is null or p_scope->>'status' not in ('unknown','not_applicable','compliant','missing','excess')
 or char_length(p_scope->>'policyVersion') is null or char_length(p_scope->>'policyVersion') not between 1 and 100
 or octet_length(p_scope::text)>16000 or exists(select 1 from jsonb_object_keys(p_scope) k where k not in ('status','policyVersion','grantedScopes','missingScopes','excessScopes')) then return false; end if;
 foreach v_names in array array[p_scope->'grantedScopes',p_scope->'missingScopes',p_scope->'excessScopes'] loop
  if jsonb_typeof(v_names) is distinct from 'array' then return false; end if;
  if jsonb_array_length(v_names)>100 then return false; end if;
  for v_name in select value from jsonb_array_elements(v_names) loop
   if jsonb_typeof(v_name)<>'string' or (v_name#>>'{}') !~ '^[A-Za-z0-9_.:/-]{1,128}$' then return false; end if;
  end loop;
 end loop;
 if p_scope->>'status' in ('unknown','not_applicable') and
  (jsonb_array_length(p_scope->'grantedScopes')+jsonb_array_length(p_scope->'missingScopes')+jsonb_array_length(p_scope->'excessScopes'))>0 then return false; end if;
 return true;
end $$;

alter table public.connectors add constraint connectors_scope_assessment_check check(public.m11_valid_connector_scope_assessment(scope_assessment));
alter table public.connectors add constraint connectors_last_test_revision_check check(last_test_connection_revision is null or last_test_connection_revision>0);
alter table public.connectors add constraint connectors_disabled_actor_check check((disabled_at is null)=(disabled_by is null));

create function public.m11_execute_connector_command_atomic(
 p_organization_id uuid,p_connector_id uuid,p_actor_user_id uuid,p_operation text,p_expected_version integer,
 p_idempotency_key uuid,p_request_digest text,p_request_digest_key_id text,p_permission_version bigint,p_payload jsonb
) returns table(outcome text,connector jsonb,command jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_connector public.connectors%rowtype; v_command public.connector_commands%rowtype; v_secret_id uuid; v_validated_scope jsonb; v_payload jsonb:=coalesce(p_payload,'{}'::jsonb);
begin
 if not public.m11_lock_connector_authorization(p_organization_id,p_actor_user_id,p_permission_version,p_operation in ('replace_secret','revoke_secret')) then
  return query select 'forbidden'::text,null::jsonb,null::jsonb; return;
 end if;
 if p_operation is null or p_operation not in ('configure','replace_secret','revoke_secret','disconnect','reconnect')
 or p_idempotency_key is null or p_expected_version is null or p_expected_version<1
 or p_request_digest is null or p_request_digest !~ '^[a-f0-9]{64}$'
 or p_request_digest_key_id is null or p_request_digest_key_id !~ '^[A-Za-z0-9_.-]{1,80}$'
 or jsonb_typeof(v_payload)<>'object' or octet_length(v_payload::text)>120000 then
  return query select 'invalid_request'::text,null::jsonb,null::jsonb; return;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_actor_user_id::text||':'||p_idempotency_key::text,11));
 select * into v_connector from public.connectors where organization_id=p_organization_id and id=p_connector_id and archived_at is null for update;
 if not found then return query select 'not_found'::text,null::jsonb,null::jsonb; return; end if;
 select * into v_command from public.connector_commands where organization_id=p_organization_id and actor_user_id=p_actor_user_id and idempotency_key=p_idempotency_key;
 if found then
  if v_command.connector_id<>p_connector_id or v_command.operation<>p_operation or v_command.request_digest<>p_request_digest
    or v_command.request_digest_key_id<>p_request_digest_key_id then
   return query select 'idempotency_conflict'::text,null::jsonb,null::jsonb; return;
  end if;
  return query select 'replayed'::text,public.m2_v2_connector_json(v_connector),public.m11_connector_command_json(v_command); return;
 end if;
 if v_connector.version<>p_expected_version then return query select 'conflict'::text,public.m2_v2_connector_json(v_connector),null::jsonb; return; end if;
 if p_operation='replace_secret' then
  if v_payload->>'format' is distinct from 'aes-256-gcm-v1' or v_payload->>'keyId' is null
    or v_payload->>'keyId' !~ '^[A-Za-z0-9_.-]{1,80}$'
    or (v_payload->>'credentialRevision')::integer is distinct from v_connector.credential_revision+1
    or exists(select 1 from jsonb_object_keys(v_payload) k where k not in ('secretId','credentialRevision','format','keyId','ciphertext','nonce','authTag')) then
   return query select 'invalid_request'::text,null::jsonb,null::jsonb; return;
  end if;
  v_secret_id:=(v_payload->>'secretId')::uuid;
  if v_secret_id is null or v_payload->>'ciphertext' is null or v_payload->>'nonce' is null or v_payload->>'authTag' is null
    or octet_length(decode(v_payload->>'nonce','base64'))<>12 or octet_length(decode(v_payload->>'authTag','base64'))<>16
    or octet_length(decode(v_payload->>'ciphertext','base64')) not between 1 and 80000 then
   return query select 'invalid_request'::text,null::jsonb,null::jsonb; return;
  end if;
  update public.connector_secrets set revoked_at=now(),revoked_by=p_actor_user_id where organization_id=p_organization_id and connector_id=p_connector_id and id=v_connector.secret_ref and revoked_at is null;
  insert into public.connector_secrets(id,organization_id,connector_id,ciphertext,encryption_scheme,key_id,nonce,auth_tag,credential_revision,rotated_by)
  values(v_secret_id,p_organization_id,p_connector_id,decode(v_payload->>'ciphertext','base64'),'aes_256_gcm_v1',v_payload->>'keyId',
   decode(v_payload->>'nonce','base64'),decode(v_payload->>'authTag','base64'),v_connector.credential_revision+1,p_actor_user_id);
  update public.connectors set secret_ref=v_secret_id,credential_revision=credential_revision+1 where organization_id=p_organization_id and id=p_connector_id;
 elsif p_operation='configure' then
  if v_payload->>'displayName' is null or char_length(btrim(v_payload->>'displayName')) not between 1 and 200
   or v_payload->>'mappingVersion' is null or char_length(btrim(v_payload->>'mappingVersion')) not between 1 and 100
   or v_payload->>'commitPolicy' is null or v_payload->>'commitPolicy' not in ('manual','auto')
   or not public.m11_valid_connector_config(p_organization_id,v_payload->'connectionConfig')
   or exists(select 1 from jsonb_object_keys(v_payload) k where k not in ('displayName','mappingVersion','commitPolicy','connectionConfig')) then
    return query select 'invalid_request'::text,null::jsonb,null::jsonb; return;
  end if;
  update public.connectors set display_name=btrim(v_payload->>'displayName'),mapping_version=btrim(v_payload->>'mappingVersion'),
    commit_policy=v_payload->>'commitPolicy',connection_config=v_payload->'connectionConfig' where organization_id=p_organization_id and id=p_connector_id;
 elsif p_operation='revoke_secret' then
  if exists(select 1 from jsonb_object_keys(v_payload) k where k<>'reason') or (v_payload ? 'reason' and char_length(v_payload->>'reason') not between 1 and 500) then return query select 'invalid_request'::text,null::jsonb,null::jsonb; return; end if;
  update public.connector_secrets set revoked_at=now(),revoked_by=p_actor_user_id where organization_id=p_organization_id and connector_id=p_connector_id and id=v_connector.secret_ref and revoked_at is null;
  update public.connectors set secret_ref=null,credential_revision=credential_revision+1,enabled=false,disabled_at=now(),disabled_by=p_actor_user_id where organization_id=p_organization_id and id=p_connector_id;
 elsif p_operation='disconnect' then
  if exists(select 1 from jsonb_object_keys(v_payload) k where k<>'reason') or (v_payload ? 'reason' and char_length(v_payload->>'reason') not between 1 and 500) then return query select 'invalid_request'::text,null::jsonb,null::jsonb; return; end if;
  update public.connectors set enabled=false,disabled_at=now(),disabled_by=p_actor_user_id where organization_id=p_organization_id and id=p_connector_id;
 else
  if v_payload<>'{}'::jsonb or v_connector.secret_ref is null or v_connector.last_test_outcome is distinct from 'success'
   or v_connector.last_test_connection_revision is distinct from v_connector.connection_revision or v_connector.scope_assessment->>'status'='missing'
   or not exists(select 1 from public.connector_secrets where organization_id=p_organization_id and connector_id=p_connector_id and id=v_connector.secret_ref and revoked_at is null) then
   return query select 'invalid_state'::text,null::jsonb,null::jsonb; return; end if;
  v_validated_scope:=v_connector.scope_assessment;
  update public.connectors set enabled=true,disabled_at=null,disabled_by=null where organization_id=p_organization_id and id=p_connector_id;
 end if;
 -- Every explicit security command invalidates old tests and outstanding plans.
 update public.connectors set version=version+1,connection_revision=greatest(connection_revision,v_connector.connection_revision+1),updated_by=p_actor_user_id,
 scope_assessment='{"status":"unknown","policyVersion":"unverified","grantedScopes":[],"missingScopes":[],"excessScopes":[]}'::jsonb
 where organization_id=p_organization_id and id=p_connector_id returning * into v_connector;
 if p_operation='reconnect' then
  update public.connectors set last_test_connection_revision=connection_revision,scope_assessment=v_validated_scope
  where organization_id=p_organization_id and id=p_connector_id returning * into v_connector;
 end if;
 update public.connector_commands set state='interrupted',completed_at=now(),result='{"outcome":"interrupted"}'::jsonb
 where organization_id=p_organization_id and connector_id=p_connector_id and state='running';
 update public.sync_runs set status='canceled',canceled_at=now(),cancellation_reason='Connection configuration changed.',lease_owner=null,lease_expires_at=null
 where organization_id=p_organization_id and connector_id=p_connector_id and status in ('queued','waiting_for_review','retrying');
 insert into public.connector_commands(organization_id,connector_id,actor_user_id,operation,idempotency_key,request_digest,request_digest_key_id,state,
 expected_version,connection_revision,credential_revision,permission_version,deadline_at,completed_at,result)
 values(p_organization_id,p_connector_id,p_actor_user_id,p_operation,p_idempotency_key,p_request_digest,p_request_digest_key_id,'completed',p_expected_version,
 v_connector.connection_revision,v_connector.credential_revision,p_permission_version,now(),now(),jsonb_build_object('version',v_connector.version)) returning * into v_command;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
 values(p_organization_id,p_actor_user_id,'connector.'||p_operation,'connector',p_connector_id::text,
 jsonb_build_object('commandId',v_command.id,'version',v_connector.version,'connectionRevision',v_connector.connection_revision));
 return query select 'updated'::text,public.m2_v2_connector_json(v_connector),public.m11_connector_command_json(v_command);
exception when invalid_text_representation or numeric_value_out_of_range or check_violation or invalid_parameter_value then
 return query select 'invalid_request'::text,null::jsonb,null::jsonb;
end $$;

create function public.m11_begin_connector_test_atomic(
 p_organization_id uuid,p_connector_id uuid,p_actor_user_id uuid,p_expected_version integer,p_idempotency_key uuid,
 p_request_digest text,p_request_digest_key_id text,p_permission_version bigint
) returns table(outcome text,connector jsonb,command jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_connector public.connectors%rowtype; v_command public.connector_commands%rowtype;
begin
 if not public.m11_lock_connector_authorization(p_organization_id,p_actor_user_id,p_permission_version) then
  return query select 'forbidden'::text,null::jsonb,null::jsonb; return;
 end if;
 if p_expected_version is null or p_expected_version<1 or p_idempotency_key is null
 or p_request_digest is null or p_request_digest !~ '^[a-f0-9]{64}$'
 or p_request_digest_key_id is null or p_request_digest_key_id !~ '^[A-Za-z0-9_.-]{1,80}$' then
  return query select 'invalid_request'::text,null::jsonb,null::jsonb; return;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_actor_user_id::text||':'||p_idempotency_key::text,11));
 select * into v_connector from public.connectors where organization_id=p_organization_id and id=p_connector_id and archived_at is null for update;
 if not found then return query select 'not_found'::text,null::jsonb,null::jsonb; return; end if;
 with expired as (
  update public.connector_commands set state='interrupted',completed_at=now(),result='{"outcome":"interrupted"}'::jsonb
  where organization_id=p_organization_id and connector_id=p_connector_id and state='running' and deadline_at<=clock_timestamp()
  returning id,actor_user_id
 ) insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
 select p_organization_id,actor_user_id,'connector.test_interrupted','connector',p_connector_id::text,jsonb_build_object('commandId',id) from expired;
 select * into v_command from public.connector_commands where organization_id=p_organization_id and actor_user_id=p_actor_user_id and idempotency_key=p_idempotency_key;
 if found then
  if v_command.connector_id<>p_connector_id or v_command.operation<>'test_connection' or v_command.request_digest<>p_request_digest
   or v_command.request_digest_key_id<>p_request_digest_key_id then
   return query select 'idempotency_conflict'::text,null::jsonb,null::jsonb; return;
  end if;
  return query select case v_command.state when 'running' then 'in_progress' when 'interrupted' then 'interrupted' else 'replayed' end,
   public.m2_v2_connector_json(v_connector),public.m11_connector_command_json(v_command); return;
 end if;
 if v_connector.version<>p_expected_version then return query select 'conflict'::text,public.m2_v2_connector_json(v_connector),null::jsonb; return; end if;
 if exists(select 1 from public.connector_commands where organization_id=p_organization_id and connector_id=p_connector_id and state='running') then
  return query select 'in_progress'::text,null::jsonb,null::jsonb; return;
 end if;
 insert into public.connector_commands(organization_id,connector_id,actor_user_id,operation,idempotency_key,request_digest,request_digest_key_id,state,
 expected_version,connection_revision,credential_revision,permission_version,deadline_at)
 values(p_organization_id,p_connector_id,p_actor_user_id,'test_connection',p_idempotency_key,p_request_digest,p_request_digest_key_id,'running',
 p_expected_version,v_connector.connection_revision,v_connector.credential_revision,p_permission_version,clock_timestamp()+interval '30 seconds') returning * into v_command;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
 values(p_organization_id,p_actor_user_id,'connector.test_started','connector',p_connector_id::text,jsonb_build_object('commandId',v_command.id));
 return query select 'started'::text,public.m2_v2_connector_json(v_connector),public.m11_connector_command_json(v_command);
end $$;

create function public.m11_finalize_connector_test_atomic(
 p_organization_id uuid,p_command_id uuid,p_actor_user_id uuid,p_permission_version bigint,
 p_connection_revision integer,p_credential_revision integer,p_result jsonb
) returns table(outcome text,connector jsonb,command jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_connector public.connectors%rowtype; v_command public.connector_commands%rowtype; v_authorized boolean;
begin
 v_authorized:=public.m11_lock_connector_authorization(p_organization_id,p_actor_user_id,p_permission_version);
 select * into v_command from public.connector_commands where organization_id=p_organization_id and id=p_command_id and actor_user_id=p_actor_user_id and operation='test_connection';
 if not found then return query select 'not_found'::text,null::jsonb,null::jsonb; return; end if;
 select * into v_connector from public.connectors where organization_id=p_organization_id and id=v_command.connector_id and archived_at is null for update;
 if not found then return query select 'not_found'::text,null::jsonb,null::jsonb; return; end if;
 select * into v_command from public.connector_commands where organization_id=p_organization_id and id=p_command_id for update;
 if v_authorized and v_command.state<>'running' then
  return query select case when v_command.state='completed' then 'replayed' else 'interrupted' end,
   public.m2_v2_connector_json(v_connector),public.m11_connector_command_json(v_command); return;
 end if;
 if not v_authorized or v_command.permission_version<>p_permission_version or v_command.deadline_at<=clock_timestamp()
 or v_command.connection_revision is distinct from p_connection_revision
 or v_command.credential_revision is distinct from p_credential_revision
 or v_connector.connection_revision<>v_command.connection_revision or v_connector.credential_revision<>v_command.credential_revision then
  if v_command.state='running' then
   update public.connector_commands set state='interrupted',completed_at=now(),result='{"outcome":"interrupted"}'::jsonb
   where organization_id=p_organization_id and id=p_command_id returning * into v_command;
   insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
   values(p_organization_id,p_actor_user_id,'connector.test_interrupted','connector',v_connector.id::text,jsonb_build_object('commandId',p_command_id));
  end if;
  return query select case when not v_authorized then 'forbidden' else 'interrupted' end,null::jsonb,null::jsonb; return;
 end if;
 if v_command.state<>'running' then
  return query select case when v_command.state='completed' then 'replayed' else 'interrupted' end,
   public.m2_v2_connector_json(v_connector),public.m11_connector_command_json(v_command); return;
 end if;
 if jsonb_typeof(p_result) is distinct from 'object' or p_result->>'outcome' is null or p_result->>'outcome' not in ('success','failure')
 or exists(select 1 from jsonb_object_keys(p_result) k where k not in ('outcome','errorCode','latencyMs','scope'))
 or (p_result->>'latencyMs')::integer is null or (p_result->>'latencyMs')::integer not between 0 and 120000
 or not public.m11_valid_connector_scope_assessment(p_result->'scope')
 or (p_result->>'outcome'='success' and (p_result->>'errorCode' is not null or p_result->'scope'->>'status'='missing'))
 or (p_result->>'outcome'='failure' and (p_result->>'errorCode' is null or p_result->>'errorCode' not in (
 'auth_failed','unreachable','rate_limited','malformed_response','unsupported_capability','payload_too_large','unknown',
 'missing_scope','unsupported_version','vault_unavailable','interrupted','timeout'))) then
  return query select 'invalid_request'::text,null::jsonb,null::jsonb; return;
 end if;
 update public.connectors set last_tested_at=now(),last_test_outcome=p_result->>'outcome',last_test_error_code=p_result->>'errorCode',
 last_test_connection_revision=connection_revision,scope_assessment=p_result->'scope'
 where organization_id=p_organization_id and id=v_command.connector_id returning * into v_connector;
 update public.connector_commands set state='completed',completed_at=now(),result=p_result where organization_id=p_organization_id and id=p_command_id returning * into v_command;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
 values(p_organization_id,p_actor_user_id,'connector.tested','connector',v_connector.id::text,
 jsonb_build_object('commandId',p_command_id,'outcome',p_result->>'outcome','errorCode',p_result->>'errorCode','latencyMs',(p_result->>'latencyMs')::integer));
 return query select 'tested'::text,public.m2_v2_connector_json(v_connector),public.m11_connector_command_json(v_command);
exception when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value then
 return query select 'invalid_request'::text,null::jsonb,null::jsonb;
end $$;

-- Maintenance uses ciphertext-only batches, scoped by organization. Active
-- credentials are retained until successfully rewrapped and recovery is tested.
create function public.m11_list_connector_secret_envelopes(p_organization_id uuid,p_after_id uuid,p_limit integer)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(row_record.payload order by row_record.id),'[]'::jsonb) from (
 select s.id,jsonb_build_object('secretId',s.id,'connectorId',s.connector_id,'credentialRevision',s.credential_revision,
 'keyId',s.key_id,'ciphertext',replace(encode(s.ciphertext,'base64'),chr(10),''),'nonce',encode(s.nonce,'base64'),'authTag',encode(s.auth_tag,'base64'),
 'format',case when s.encryption_scheme='legacy_pgp' then 'legacy-pgp' else 'aes-256-gcm-v1' end,'revokedAt',s.revoked_at) payload
 from public.connector_secrets s join public.connectors c on c.organization_id=s.organization_id and c.id=s.connector_id and c.secret_ref=s.id
 where s.organization_id=p_organization_id and s.revoked_at is null and (p_after_id is null or s.id>p_after_id)
 order by s.id limit greatest(1,least(coalesce(p_limit,100),100))
 ) row_record
$$;

create function public.m11_rewrap_connector_secret_atomic(
 p_organization_id uuid,p_connector_id uuid,p_secret_id uuid,p_expected_key_id text,p_expected_ciphertext text,p_payload jsonb
) returns table(outcome text)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_secret public.connector_secrets%rowtype;
begin
 -- Same lock order as replacement: connector, then credential.
 perform 1 from public.connectors where organization_id=p_organization_id and id=p_connector_id and secret_ref=p_secret_id for update;
 if not found then return query select 'not_found'::text; return; end if;
 select * into v_secret from public.connector_secrets where organization_id=p_organization_id and connector_id=p_connector_id and id=p_secret_id and revoked_at is null for update;
 if not found then return query select 'not_found'::text; return; end if;
 if v_secret.key_id is distinct from p_expected_key_id or v_secret.ciphertext is distinct from decode(p_expected_ciphertext,'base64') then
  return query select 'conflict'::text; return;
 end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('keyId','ciphertext','nonce','authTag'))
 or p_payload->>'keyId' is null or p_payload->>'keyId' !~ '^[A-Za-z0-9_.-]{1,80}$'
 or p_payload->>'nonce' is null or p_payload->>'authTag' is null or p_payload->>'ciphertext' is null
 or octet_length(decode(p_payload->>'nonce','base64'))<>12 or octet_length(decode(p_payload->>'authTag','base64'))<>16
 or octet_length(decode(p_payload->>'ciphertext','base64')) not between 1 and 80000 then
  return query select 'invalid_request'::text; return;
 end if;
 update public.connector_secrets set encryption_scheme='aes_256_gcm_v1',key_id=p_payload->>'keyId',ciphertext=decode(p_payload->>'ciphertext','base64'),
 nonce=decode(p_payload->>'nonce','base64'),auth_tag=decode(p_payload->>'authTag','base64'),rotated_at=now()
 where organization_id=p_organization_id and connector_id=p_connector_id and id=p_secret_id;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
 values(p_organization_id,null,'connector.key_rewrapped','connector',p_connector_id::text,jsonb_build_object('keyId',p_payload->>'keyId','credentialRevision',v_secret.credential_revision,'actorKind','system_key_rotation'));
 return query select 'updated'::text;
exception when invalid_text_representation or numeric_value_out_of_range or check_violation or invalid_parameter_value then
 return query select 'invalid_request'::text;
end $$;

-- Explicit, guarded contract step. Never retire while a configured credential
-- still relies on legacy PGP; operators invoke only after recovery verification.
create function public.m11_retire_legacy_connector_secret_rpc()
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if exists(select 1 from public.connectors c join public.connector_secrets s on s.organization_id=c.organization_id and s.id=c.secret_ref
 where s.revoked_at is null and s.encryption_scheme='legacy_pgp') then return false; end if;
 revoke execute on function public.resolve_connector_secret(uuid,uuid,text) from service_role;
 revoke execute on function public.set_connector_secret_atomic(uuid,uuid,uuid,text,text) from service_role;
 return true;
end $$;

-- Bridge old writers without allowing configuration changes to preserve health.
create function public.m11_connector_security_revision_trigger()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.secret_ref is distinct from old.secret_ref and new.credential_revision=old.credential_revision then
  new.credential_revision:=old.credential_revision+1;
 end if;
 if (new.secret_ref is distinct from old.secret_ref or new.connection_config is distinct from old.connection_config
   or new.mapping_version is distinct from old.mapping_version or new.commit_policy is distinct from old.commit_policy
   or new.enabled is distinct from old.enabled or new.archived_at is distinct from old.archived_at)
   and new.connection_revision=old.connection_revision then
  new.connection_revision:=old.connection_revision+1;
 end if;
 if new.connection_revision<>old.connection_revision then
  new.last_test_connection_revision:=null;
  new.scope_assessment:='{"status":"unknown","policyVersion":"unverified","grantedScopes":[],"missingScopes":[],"excessScopes":[]}'::jsonb;
 end if;
 return new;
end $$;
create trigger m11_connector_security_revision before update on public.connectors
 for each row execute function public.m11_connector_security_revision_trigger();

alter table public.sync_runs
 add column connection_revision integer not null default 1 check (connection_revision>0),
 add column credential_revision integer not null default 0 check (credential_revision>=0),
 add column permission_version bigint;
update public.sync_runs r set connection_revision=c.connection_revision,credential_revision=c.credential_revision,
 permission_version=(select version from public.organization_permissions_version where organization_id=r.organization_id)
 from public.connectors c where c.organization_id=r.organization_id and c.id=r.connector_id;
alter table public.sync_runs drop constraint sync_run_commit_identity_check;
alter table public.sync_runs add constraint sync_run_commit_identity_check check (
 (commit_idempotency_key is null)=(commit_request_digest is null)
 and (commit_idempotency_key is null or commit_actor_user_id is not null));

create function public.m11_capture_sync_run_basis()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 select connection_revision,credential_revision into new.connection_revision,new.credential_revision
 from public.connectors where organization_id=new.organization_id and id=new.connector_id for share;
 select version into new.permission_version from public.organization_permissions_version where organization_id=new.organization_id for share;
 return new;
end $$;
create trigger m11_capture_sync_run_basis before insert on public.sync_runs
 for each row execute function public.m11_capture_sync_run_basis();

create function public.m11_assert_sync_run_fence(p_organization_id uuid,p_sync_run_id uuid,p_actor_user_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_run public.sync_runs%rowtype; v_connector public.connectors%rowtype; v_actor uuid;
begin
 select * into v_run from public.sync_runs where organization_id=p_organization_id and id=p_sync_run_id;
 if not found then return false; end if;
 v_actor:=case when v_run.work_kind='commit' then coalesce(v_run.commit_actor_user_id,v_run.actor_user_id) else v_run.actor_user_id end;
 if v_actor is null or (p_actor_user_id is not null and p_actor_user_id<>v_actor)
  or not public.m11_lock_connector_authorization(p_organization_id,v_actor,v_run.permission_version) then return false; end if;
 select * into v_connector from public.connectors where organization_id=p_organization_id and id=v_run.connector_id for share;
 return found and v_connector.enabled and v_connector.archived_at is null
 and v_connector.connection_revision=v_run.connection_revision and v_connector.credential_revision=v_run.credential_revision
 and v_connector.scope_assessment->>'status'<>'missing'
 and public.m11_valid_connector_config(p_organization_id,v_connector.connection_config)
 and not exists(select 1 from public.connector_secrets where organization_id=p_organization_id and connector_id=v_connector.id and id=v_connector.secret_ref
   and encryption_scheme='aes_256_gcm_v1' and (v_connector.last_test_outcome is distinct from 'success' or v_connector.last_test_connection_revision is distinct from v_connector.connection_revision))
 and not exists(select 1 from public.connector_secrets where organization_id=p_organization_id and connector_id=v_connector.id and id=v_connector.secret_ref and revoked_at is not null);
end $$;

-- Claim locks connector before run, matching command lock order. Tenant fairness
-- remains at the worker's existing organization rotation boundary.
create or replace function public.claim_sync_run(p_organization_id uuid,p_worker_id text,p_lease_seconds integer)
returns table(outcome text,run jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_run public.sync_runs%rowtype; v_connector_id uuid;
begin
 if p_organization_id is null or char_length(btrim(coalesce(p_worker_id,''))) not between 1 and 100 or p_lease_seconds not between 10 and 300 then
  return query select 'invalid_request'::text,null::jsonb; return;
 end if;
 select r.connector_id into v_connector_id from public.sync_runs r join public.sync_connector_cursors c
 on c.organization_id=r.organization_id and c.connector_id=r.connector_id
 where r.organization_id=p_organization_id and r.status in ('queued','retrying') and r.next_attempt_at<=now()
 and r.expires_at>now() and (r.lease_expires_at is null or r.lease_expires_at<=now()) and c.circuit_state<>'open'
 order by r.next_attempt_at,r.created_at,r.id limit 1;
 if not found then return query select 'not_found'::text,null::jsonb; return; end if;
 perform 1 from public.connectors where organization_id=p_organization_id and id=v_connector_id for update skip locked;
 if not found then return query select 'not_found'::text,null::jsonb; return; end if;
 select * into v_run from public.sync_runs where organization_id=p_organization_id and connector_id=v_connector_id
 and status in ('queued','retrying') and next_attempt_at<=now() and expires_at>now()
 and (lease_expires_at is null or lease_expires_at<=now()) for update skip locked;
 if not found then return query select 'not_found'::text,null::jsonb; return; end if;
 if not public.m11_assert_sync_run_fence(p_organization_id,v_run.id,null) then
  update public.sync_runs set status='canceled',canceled_at=now(),cancellation_reason='Connection or authorization changed.',
  error_code='authorization_changed',lease_owner=null,lease_expires_at=null where organization_id=p_organization_id and id=v_run.id;
  return query select 'invalid_state'::text,null::jsonb; return;
 end if;
 update public.sync_runs set status='running',lease_owner=btrim(p_worker_id),lease_expires_at=now()+make_interval(secs=>p_lease_seconds),error_code=null
 where organization_id=p_organization_id and id=v_run.id returning * into v_run;
 return query select 'claimed'::text,public.m2_v2_sync_run_json(v_run)||jsonb_build_object(
 'actorId',v_run.actor_user_id,'commitActorId',v_run.commit_actor_user_id,'connectionRevision',v_run.connection_revision,
 'credentialRevision',v_run.credential_revision,'permissionVersion',v_run.permission_version);
end $$;

-- Add pre-mutation fences to the existing fully implemented plan/commit RPCs.
-- Patching named anchors preserves later M2 fixes without duplicating engines.
do $$
declare v_definition text; v_oid regprocedure; v_anchor text; v_fence text;
begin
 v_anchor:='  if not found then return query select ''not_found''::text, null::jsonb; return; end if;';
 foreach v_oid in array array[
 'public.save_sync_run_plan_atomic(uuid,uuid,text,text,text,jsonb,jsonb)'::regprocedure,
 'public.commit_sync_run_atomic(uuid,uuid,uuid,text,uuid,uuid)'::regprocedure] loop
  select pg_get_functiondef(v_oid) into v_definition;
  if position(v_anchor in v_definition)=0 then raise exception 'M11 sync fence anchor missing %',v_oid; end if;
  v_fence:=v_anchor||E'\n  if not public.m11_assert_sync_run_fence(p_organization_id,p_sync_run_id,'||
   case when v_oid::text like '%commit_sync_run%' then 'p_actor_user_id' else 'null' end||E') then\n    return query select ''invalid_state''::text,null::jsonb; return;\n  end if;';
  -- Replace the first occurrence only: later target lookups are unaffected.
  v_definition:=overlay(v_definition placing v_fence from position(v_anchor in v_definition) for char_length(v_anchor));
  if v_oid::text like '%commit_sync_run%' then
   v_definition:=replace(v_definition,'coalesce(p_actor_user_id, public.resolve_connector_sync_worker_actor(p_organization_id))','p_actor_user_id');
  end if;
  execute v_definition;
 end loop;
 select pg_get_functiondef('public.request_sync_run_commit_atomic(uuid,uuid,uuid,integer)'::regprocedure) into v_definition;
 v_anchor:='update public.sync_runs set status = ''queued'', work_kind = ''commit'', next_attempt_at = now()';
 if position(v_anchor in v_definition)=0 then raise exception 'M11 approval fence anchor missing'; end if;
 v_definition:=replace(v_definition,v_anchor,
 'update public.sync_runs set status = ''queued'', work_kind = ''commit'', next_attempt_at = now(), commit_actor_user_id = p_actor_user_id, permission_version = (select version from public.organization_permissions_version where organization_id = p_organization_id)');
 execute v_definition;
end $$;

create function public.m11_create_connector_atomic(
 p_organization_id uuid,p_actor_user_id uuid,p_permission_version bigint,p_idempotency_key uuid,
 p_connector_type text,p_display_name text,p_adapter_version text,p_mapping_version text,p_connection_config jsonb,p_commit_policy text
) returns table(outcome text,connector jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.m11_lock_connector_authorization(p_organization_id,p_actor_user_id,p_permission_version) then
  return query select 'forbidden'::text,null::jsonb; return;
 end if;
 if not public.m11_valid_connector_config(p_organization_id,p_connection_config) then
  return query select 'invalid_request'::text,null::jsonb; return;
 end if;
 return query select * from public.create_connector_atomic(p_organization_id,p_actor_user_id,p_idempotency_key,p_connector_type,p_display_name,p_adapter_version,p_mapping_version,p_connection_config,p_commit_policy);
end $$;

-- Command/envelope records are intentionally excluded from portable tenant
-- exports, as the existing export registry already excludes connector_secrets.
-- Safe connector and run projections retain their existing export ownership.
do $$
declare v_function regprocedure;
begin
 for v_function in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like 'm11\_%' escape '\' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',v_function);
  execute format('grant execute on function %s to service_role',v_function);
 end loop;
end $$;

create function public.m11_valid_connector_config(p_organization_id uuid,p_config jsonb)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_binding jsonb;
begin
 if jsonb_typeof(p_config) is distinct from 'object' then return false; end if;
 if exists(select 1 from jsonb_object_keys(p_config) k where k not in ('baseUrl','tenantOrSiteId','scopeFilter','defaultOwnerBinding')) then return false; end if;
 v_binding:=p_config->'defaultOwnerBinding';
 if v_binding is null then return true; end if;
 if jsonb_typeof(v_binding)<>'object' or exists(select 1 from jsonb_object_keys(v_binding) k where k not in ('responsibleOwnerId','legalEntityId'))
 or v_binding->>'responsibleOwnerId' is null or v_binding->>'legalEntityId' is null then return false; end if;
 return public.m2_active_member(p_organization_id,(v_binding->>'responsibleOwnerId')::uuid)
 and exists(select 1 from public.organization_legal_entities where organization_id=p_organization_id and id=(v_binding->>'legalEntityId')::uuid and deleted_at is null and status='active');
exception when invalid_text_representation then return false;
end $$;

create function public.m11_connector_connection_summaries(p_organization_id uuid,p_connector_ids uuid[])
returns table(connector_id uuid,connection_revision integer,credential_revision integer,last_test_connection_revision integer,
 scope_assessment jsonb,last_sync_at timestamptz,active_sync_status text,credential_revoked boolean)
language sql stable security definer set search_path=public,pg_temp as $$
 select c.id,c.connection_revision,c.credential_revision,c.last_test_connection_revision,c.scope_assessment,
 completed.last_sync_at,active.status,(s.revoked_at is not null)
 from public.connectors c left join public.connector_secrets s on s.organization_id=c.organization_id and s.connector_id=c.id and s.id=c.secret_ref
 left join lateral(select r.committed_at last_sync_at from public.sync_runs r
 where r.organization_id=p_organization_id and r.connector_id=c.id and r.status='completed' order by r.committed_at desc limit 1) completed on true
 left join lateral(select r.status from public.sync_runs r where r.organization_id=p_organization_id and r.connector_id=c.id
 and r.status in ('queued','running','retrying','waiting_for_review') limit 1) active on true
 where c.organization_id=p_organization_id and c.id=any(p_connector_ids) and cardinality(p_connector_ids)<=100
$$;
revoke all on function public.m11_valid_connector_config(uuid,jsonb),public.m11_connector_connection_summaries(uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.m11_valid_connector_config(uuid,jsonb),public.m11_connector_connection_summaries(uuid,uuid[]) to service_role;

create function public.m11_request_sync_run_commit_atomic(p_organization_id uuid,p_sync_run_id uuid,p_actor_user_id uuid,p_permission_version bigint,p_expected_row_count integer)
returns table(outcome text,run jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.m11_lock_connector_authorization(p_organization_id,p_actor_user_id,p_permission_version) then
  return query select 'forbidden'::text,null::jsonb; return;
 end if;
 return query select * from public.request_sync_run_commit_atomic(p_organization_id,p_sync_run_id,p_actor_user_id,p_expected_row_count);
end $$;
revoke all on function public.m11_request_sync_run_commit_atomic(uuid,uuid,uuid,bigint,integer) from public,anon,authenticated,service_role;
grant execute on function public.m11_request_sync_run_commit_atomic(uuid,uuid,uuid,bigint,integer) to service_role;

create function public.m11_begin_sync_run_atomic(p_organization_id uuid,p_connector_id uuid,p_actor_user_id uuid,p_permission_version bigint,
 p_reconciliation_kind text,p_idempotency_key uuid,p_correlation_id uuid)
returns table(outcome text,run jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.m11_lock_connector_authorization(p_organization_id,p_actor_user_id,p_permission_version) then
  return query select 'forbidden'::text,null::jsonb; return;
 end if;
 return query select * from public.begin_sync_run_atomic(p_organization_id,p_connector_id,p_actor_user_id,p_reconciliation_kind,p_idempotency_key,p_correlation_id);
end $$;
revoke all on function public.m11_begin_sync_run_atomic(uuid,uuid,uuid,bigint,text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.m11_begin_sync_run_atomic(uuid,uuid,uuid,bigint,text,uuid,uuid) to service_role;

create index sync_runs_completed_sync_idx on public.sync_runs(organization_id,connector_id,committed_at desc) where status='completed';
create index connectors_disabled_by_idx on public.connectors(disabled_by) where disabled_by is not null;
create index connector_secrets_revoked_by_idx on public.connector_secrets(revoked_by) where revoked_by is not null;
