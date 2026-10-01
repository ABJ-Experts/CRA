-- M11-06: outbound-only customer-host agent. No existing rows are rewritten.
alter table public.connectors drop constraint connectors_connector_type_check;
alter table public.connectors add constraint connectors_connector_type_check
 check (connector_type in ('reference_conformance','github_actions','gitlab_ci','azure_devops','jira','on_prem_agent'));

create function public.m1106_valid_envelope(p_value jsonb) returns boolean
language plpgsql immutable set search_path=public,pg_temp as $$
begin
 if jsonb_typeof(p_value) is distinct from 'object' then return false; end if;
 return coalesce(p_value->>'format'='aes-256-gcm-v1'
 and p_value->>'keyId' ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
 and p_value->>'ciphertext' ~ '^[A-Za-z0-9+/]+={0,2}$'
 and char_length(p_value->>'ciphertext') between 4 and 26668
 and p_value->>'nonce' ~ '^[A-Za-z0-9+/]{16}$'
 and p_value->>'authTag' ~ '^[A-Za-z0-9+/]{22}==$'
 and not exists(select 1 from jsonb_object_keys(p_value) k where k not in ('format','keyId','ciphertext','nonce','authTag'))
 and octet_length(p_value::text)<=28000,false);
end
$$;

create table public.connector_agents (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 connector_id uuid not null,
 status text not null default 'pending' check(status in ('pending','active','revoked')),
 enrollment_token_hash text not null unique check(enrollment_token_hash ~ '^[a-f0-9]{64}$'),
 enrollment_token_envelope jsonb not null check(public.m1106_valid_envelope(enrollment_token_envelope)),
 enrollment_idempotency_key uuid not null,
 enrollment_expires_at timestamptz not null,
 enrollment_issued_by uuid not null references public.users(id) on delete restrict,
 enrollment_csr_hash text check(enrollment_csr_hash is null or enrollment_csr_hash ~ '^[a-f0-9]{64}$'),
 enrolled_at timestamptz,
 current_cert_serial text check(current_cert_serial is null or current_cert_serial ~ '^[a-fA-F0-9]{1,80}$'),
 current_cert_fingerprint text check(current_cert_fingerprint is null or current_cert_fingerprint ~ '^[a-f0-9]{64}$'),
 current_cert_pem text check(current_cert_pem is null or (char_length(current_cert_pem) between 64 and 16000 and current_cert_pem like '-----BEGIN CERTIFICATE-----%')),
 current_signing_key_id text check(current_signing_key_id is null or current_signing_key_id ~ '^[A-Za-z0-9_.-]{1,80}$'),
 current_signing_key_envelope jsonb check(current_signing_key_envelope is null or public.m1106_valid_envelope(current_signing_key_envelope)),
 current_key_issued_at timestamptz,
 current_expires_at timestamptz,
 previous_cert_serial text check(previous_cert_serial is null or previous_cert_serial ~ '^[a-fA-F0-9]{1,80}$'),
 previous_cert_fingerprint text check(previous_cert_fingerprint is null or previous_cert_fingerprint ~ '^[a-f0-9]{64}$'),
 previous_cert_pem text check(previous_cert_pem is null or (char_length(previous_cert_pem) between 64 and 16000 and previous_cert_pem like '-----BEGIN CERTIFICATE-----%')),
 previous_signing_key_id text check(previous_signing_key_id is null or previous_signing_key_id ~ '^[A-Za-z0-9_.-]{1,80}$'),
 previous_signing_key_envelope jsonb check(previous_signing_key_envelope is null or public.m1106_valid_envelope(previous_signing_key_envelope)),
 previous_key_issued_at timestamptz,
 previous_valid_until timestamptz,
 rotation_idempotency_key uuid,
 rotation_csr_hash text check(rotation_csr_hash is null or rotation_csr_hash ~ '^[a-f0-9]{64}$'),
 revocation_idempotency_key uuid,
 revoked_at timestamptz,
 revoked_by uuid references public.users(id) on delete restrict,
 last_contact_at timestamptz,
 agent_version text check(agent_version is null or char_length(agent_version) between 1 and 100),
 capabilities jsonb not null default '[]'::jsonb check(jsonb_typeof(capabilities)='array' and jsonb_array_length(capabilities)<=2),
 backlog_count bigint not null default 0 check(backlog_count between 0 and 9007199254740991),
 backlog_bytes bigint not null default 0 check(backlog_bytes between 0 and 9007199254740991),
 last_error_code text check(last_error_code is null or last_error_code in ('source_unavailable','source_changed','source_invalid','queue_full','network_unavailable','proxy_failed','tls_failed','clock_skew','credential_expired','unknown')),
 last_sequence bigint not null default 0 check(last_sequence between 0 and 9007199254740991),
 last_source_cursor text check(last_source_cursor is null or char_length(last_source_cursor)<=8000),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 unique(organization_id,connector_id,id),
 unique(organization_id,connector_id,enrollment_idempotency_key),
 foreign key(organization_id,connector_id) references public.connectors(organization_id,id) on delete cascade,
 check((revoked_at is null)=(revoked_by is null)),
 check(status<>'active' or (enrolled_at is not null and enrollment_csr_hash is not null and current_cert_serial is not null and current_cert_fingerprint is not null and current_cert_pem is not null and current_signing_key_id is not null and current_signing_key_envelope is not null and current_key_issued_at is not null and current_expires_at is not null)),
 check((previous_valid_until is null)=(previous_signing_key_envelope is null)
   and (previous_valid_until is null)=(previous_key_issued_at is null))
);
create unique index connector_agents_one_live_per_connector on public.connector_agents(organization_id,connector_id)
 where status in ('pending','active');
create index connector_agents_org_status on public.connector_agents(organization_id,connector_id,status,updated_at desc);
create unique index connector_agents_current_fingerprint on public.connector_agents(current_cert_fingerprint) where current_cert_fingerprint is not null;

create table public.connector_agent_nonces (
 organization_id uuid not null,
 connector_id uuid not null,
 agent_id uuid not null,
 nonce text not null check(nonce ~ '^[A-Za-z0-9_-]{16,120}$'),
 expires_at timestamptz not null,
 consumed_at timestamptz not null default clock_timestamp(),
 primary key(agent_id,nonce),
 foreign key(organization_id,connector_id,agent_id) references public.connector_agents(organization_id,connector_id,id) on delete cascade
);
create index connector_agent_nonces_expiry on public.connector_agent_nonces(expires_at);

create table public.connector_agent_batches (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 connector_id uuid not null,
 agent_id uuid not null,
 batch_id uuid not null,
 sequence bigint not null check(sequence between 1 and 9007199254740991),
 source_id text not null check(source_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$'),
 cursor_from text check(cursor_from is null or char_length(cursor_from)<=8000),
 cursor_to text not null check(char_length(cursor_to) between 1 and 8000),
 content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'),
 records jsonb not null check(jsonb_typeof(records)='array' and jsonb_array_length(records)<=200 and octet_length(records::text)<=4194304),
 record_count integer not null check(record_count between 0 and 200),
 payload_bytes integer not null check(payload_bytes between 2 and 4194304),
 status text not null default 'staged' check(status in ('staged','committed')),
 received_at timestamptz not null default clock_timestamp(),
 unique(organization_id,connector_id,batch_id),
 unique(organization_id,connector_id,sequence),
 foreign key(organization_id,connector_id,agent_id) references public.connector_agents(organization_id,connector_id,id) on delete restrict
);
create index connector_agent_batches_org_recent on public.connector_agent_batches(organization_id,connector_id,received_at desc,id desc);
create index connector_agent_batches_staged on public.connector_agent_batches(organization_id,connector_id) include(payload_bytes) where status='staged';

alter table public.connector_agents enable row level security;
alter table public.connector_agent_nonces enable row level security;
alter table public.connector_agent_batches enable row level security;
revoke all on public.connector_agents,public.connector_agent_nonces,public.connector_agent_batches from public,anon,authenticated,service_role;
grant select on public.connector_agents,public.connector_agent_batches to service_role;
grant select on public.connector_agent_nonces to service_role;

create function public.m1106_agent_live(p_organization_id uuid,p_connector_id uuid,p_agent_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.connector_agents a join public.connectors c
 on c.organization_id=a.organization_id and c.id=a.connector_id
 where a.organization_id=p_organization_id and a.connector_id=p_connector_id and a.id=p_agent_id
 and a.status='active' and a.revoked_at is null and a.current_expires_at>now()
 and c.connector_type='on_prem_agent' and c.enabled and c.archived_at is null)
$$;

create function public.m1106_agent_connection_summaries(p_organization_id uuid,p_connector_ids uuid[])
returns table(connector_id uuid,active_agent boolean,last_contact_at timestamptz)
language sql stable security definer set search_path=public,pg_temp as $$
 select c.id,
  coalesce(a.status='active' and a.revoked_at is null and a.current_expires_at>now()
   and c.enabled and c.archived_at is null,false),
  a.last_contact_at
 from public.connectors c left join public.connector_agents a
  on a.organization_id=c.organization_id and a.connector_id=c.id and a.status in ('pending','active')
 where c.organization_id=p_organization_id and c.connector_type='on_prem_agent'
  and c.id=any(p_connector_ids) and cardinality(p_connector_ids) between 1 and 100
$$;

create function public.m1106_issue_agent_enrollment(
 p_organization_id uuid,p_connector_id uuid,p_actor_user_id uuid,p_permission_version bigint,
 p_idempotency_key uuid,p_token_hash text,p_token_envelope jsonb
) returns table(outcome text,agent jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_connector public.connectors%rowtype; v_agent public.connector_agents%rowtype;
begin
 if not public.m11_lock_connector_authorization(p_organization_id,p_actor_user_id,p_permission_version,true) then
  return query select 'forbidden'::text,null::jsonb; return; end if;
 if p_idempotency_key is null or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or not public.m1106_valid_envelope(p_token_envelope) then
  return query select 'invalid_request'::text,null::jsonb; return; end if;
 select * into v_connector from public.connectors where organization_id=p_organization_id and id=p_connector_id for update;
 if not found or v_connector.connector_type<>'on_prem_agent' or v_connector.archived_at is not null then
  return query select 'not_found'::text,null::jsonb; return; end if;
 select * into v_agent from public.connector_agents
 where organization_id=p_organization_id and connector_id=p_connector_id and enrollment_idempotency_key=p_idempotency_key for update;
 if found then
  return query select 'replayed'::text,to_jsonb(v_agent); return; end if;
 if exists(select 1 from public.connector_agents where organization_id=p_organization_id
  and connector_id=p_connector_id and enrolled_at is not null) then
  return query select 'replacement_requires_new_connector'::text,null::jsonb; return; end if;
 update public.connector_agents set status='revoked',revoked_at=clock_timestamp(),revoked_by=p_actor_user_id,updated_at=clock_timestamp()
 where organization_id=p_organization_id and connector_id=p_connector_id and status='pending' and enrollment_expires_at<=clock_timestamp();
 if exists(select 1 from public.connector_agents where organization_id=p_organization_id and connector_id=p_connector_id and status in ('pending','active')) then
  return query select 'conflict'::text,null::jsonb; return; end if;
 insert into public.connector_agents(id,organization_id,connector_id,enrollment_token_hash,enrollment_token_envelope,
  enrollment_idempotency_key,enrollment_expires_at,enrollment_issued_by)
 values(p_idempotency_key,p_organization_id,p_connector_id,p_token_hash,p_token_envelope,p_idempotency_key,clock_timestamp()+interval '15 minutes',p_actor_user_id)
 returning * into v_agent;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
 values(p_organization_id,p_actor_user_id,'connector_agent.enrollment_issued','connector_agent',v_agent.id::text,
  jsonb_build_object('connectorId',p_connector_id,'expiresAt',v_agent.enrollment_expires_at));
 return query select 'issued'::text,to_jsonb(v_agent);
end $$;

create function public.m1106_redeem_agent_enrollment(
 p_token_hash text,p_csr_hash text,p_cert_serial text,p_cert_fingerprint text,p_cert_pem text,
 p_signing_key_id text,p_signing_key_envelope jsonb
) returns table(outcome text,agent jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_locator public.connector_agents%rowtype; v_agent public.connector_agents%rowtype; v_connector public.connectors%rowtype;
begin
 if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or p_csr_hash is null or p_csr_hash !~ '^[a-f0-9]{64}$'
 or p_cert_serial is null or p_cert_serial !~ '^[a-fA-F0-9]{1,80}$' or p_cert_fingerprint is null or p_cert_fingerprint !~ '^[a-f0-9]{64}$'
 or p_cert_pem is null or char_length(p_cert_pem) not between 64 and 16000 or p_cert_pem not like '-----BEGIN CERTIFICATE-----%'
 or p_signing_key_id is null or p_signing_key_id !~ '^[A-Za-z0-9_.-]{1,80}$' or not public.m1106_valid_envelope(p_signing_key_envelope) then
  return query select 'invalid_request'::text,null::jsonb; return; end if;
 select * into v_locator from public.connector_agents where enrollment_token_hash=p_token_hash;
 if not found then return query select 'invalid_token'::text,null::jsonb; return; end if;
 select * into v_connector from public.connectors where organization_id=v_locator.organization_id and id=v_locator.connector_id for update;
 if not found or v_connector.connector_type<>'on_prem_agent' or v_connector.archived_at is not null then
  return query select 'invalid_state'::text,null::jsonb; return; end if;
 select * into v_agent from public.connector_agents where id=v_locator.id for update;
 if v_agent.enrollment_expires_at<=clock_timestamp() then return query select 'token_expired'::text,null::jsonb; return; end if;
 if v_agent.status='active' then
  if v_agent.enrollment_csr_hash=p_csr_hash then return query select 'replayed'::text,to_jsonb(v_agent); end if;
  return query select 'token_consumed'::text,null::jsonb; return;
 end if;
 if v_agent.status<>'pending' then return query select 'token_consumed'::text,null::jsonb; return; end if;
 update public.connector_agents set status='active',enrollment_csr_hash=p_csr_hash,enrolled_at=clock_timestamp(),
  current_cert_serial=p_cert_serial,current_cert_fingerprint=p_cert_fingerprint,current_cert_pem=p_cert_pem,
  current_signing_key_id=p_signing_key_id,current_signing_key_envelope=p_signing_key_envelope,
  current_key_issued_at=clock_timestamp(),current_expires_at=clock_timestamp()+interval '90 days',updated_at=clock_timestamp()
 where id=v_agent.id returning * into v_agent;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
 values(v_agent.organization_id,null,'connector_agent.enrolled','connector_agent',v_agent.id::text,
  jsonb_build_object('connectorId',v_agent.connector_id,'certFingerprint',p_cert_fingerprint));
 return query select 'enrolled'::text,to_jsonb(v_agent);
end $$;

create function public.m1106_rotate_agent_credential(
 p_organization_id uuid,p_connector_id uuid,p_agent_id uuid,p_idempotency_key uuid,p_csr_hash text,
 p_cert_serial text,p_cert_fingerprint text,p_cert_pem text,p_signing_key_id text,p_signing_key_envelope jsonb
) returns table(outcome text,agent jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_connector public.connectors%rowtype; v_agent public.connector_agents%rowtype;
begin
 if p_idempotency_key is null or p_csr_hash is null or p_csr_hash !~ '^[a-f0-9]{64}$' or p_cert_serial is null or p_cert_serial !~ '^[a-fA-F0-9]{1,80}$'
 or p_cert_fingerprint is null or p_cert_fingerprint !~ '^[a-f0-9]{64}$' or p_cert_pem is null or char_length(p_cert_pem) not between 64 and 16000
 or p_cert_pem not like '-----BEGIN CERTIFICATE-----%' or p_signing_key_id is null or p_signing_key_id !~ '^[A-Za-z0-9_.-]{1,80}$'
 or not public.m1106_valid_envelope(p_signing_key_envelope) then
  return query select 'invalid_request'::text,null::jsonb; return; end if;
 select * into v_connector from public.connectors where organization_id=p_organization_id and id=p_connector_id for update;
 if not found or v_connector.connector_type<>'on_prem_agent' or not v_connector.enabled or v_connector.archived_at is not null then
  return query select 'invalid_state'::text,null::jsonb; return; end if;
 select * into v_agent from public.connector_agents where organization_id=p_organization_id and connector_id=p_connector_id and id=p_agent_id for update;
 if not found or v_agent.status<>'active' or v_agent.revoked_at is not null then
  return query select 'revoked'::text,null::jsonb; return; end if;
 if v_agent.rotation_idempotency_key=p_idempotency_key then
  if v_agent.rotation_csr_hash=p_csr_hash then return query select 'replayed'::text,to_jsonb(v_agent); end if;
  return query select 'idempotency_conflict'::text,null::jsonb; return; end if;
 if v_agent.current_expires_at<=clock_timestamp() then return query select 'key_expired'::text,null::jsonb; return; end if;
 if v_agent.previous_valid_until>clock_timestamp() then return query select 'rotation_in_progress'::text,null::jsonb; return; end if;
 update public.connector_agents set
  previous_cert_serial=current_cert_serial,previous_cert_fingerprint=current_cert_fingerprint,
  previous_cert_pem=current_cert_pem,previous_signing_key_id=current_signing_key_id,
  previous_signing_key_envelope=current_signing_key_envelope,
  previous_key_issued_at=current_key_issued_at,
  previous_valid_until=least(current_expires_at,clock_timestamp()+interval '24 hours'),
  current_cert_serial=p_cert_serial,current_cert_fingerprint=p_cert_fingerprint,current_cert_pem=p_cert_pem,
  current_signing_key_id=p_signing_key_id,current_signing_key_envelope=p_signing_key_envelope,
  current_key_issued_at=clock_timestamp(),current_expires_at=clock_timestamp()+interval '90 days',
  rotation_idempotency_key=p_idempotency_key,rotation_csr_hash=p_csr_hash,updated_at=clock_timestamp()
 where id=v_agent.id returning * into v_agent;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
 values(p_organization_id,null,'connector_agent.key_rotated','connector_agent',p_agent_id::text,
  jsonb_build_object('connectorId',p_connector_id,'certFingerprint',p_cert_fingerprint,'previousValidUntil',v_agent.previous_valid_until));
 return query select 'rotated'::text,to_jsonb(v_agent);
end $$;

create function public.m1106_revoke_agent(
 p_organization_id uuid,p_connector_id uuid,p_agent_id uuid,p_actor_user_id uuid,p_permission_version bigint,p_idempotency_key uuid
) returns table(outcome text,agent jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_connector public.connectors%rowtype; v_agent public.connector_agents%rowtype;
begin
 if not public.m11_lock_connector_authorization(p_organization_id,p_actor_user_id,p_permission_version,true) then
  return query select 'forbidden'::text,null::jsonb; return; end if;
 if p_idempotency_key is null then return query select 'invalid_request'::text,null::jsonb; return; end if;
 select * into v_connector from public.connectors where organization_id=p_organization_id and id=p_connector_id for update;
 if not found or v_connector.connector_type<>'on_prem_agent' then return query select 'not_found'::text,null::jsonb; return; end if;
 select * into v_agent from public.connector_agents where organization_id=p_organization_id and connector_id=p_connector_id and id=p_agent_id for update;
 if not found then return query select 'not_found'::text,null::jsonb; return; end if;
 if v_agent.status='revoked' then
  return query select case when v_agent.revocation_idempotency_key=p_idempotency_key then 'replayed' else 'conflict' end,
   to_jsonb(v_agent); return; end if;
 update public.connector_agents set status='revoked',revoked_at=clock_timestamp(),revoked_by=p_actor_user_id,
  revocation_idempotency_key=p_idempotency_key,updated_at=clock_timestamp() where id=p_agent_id returning * into v_agent;
 update public.connectors set enabled=false,disabled_at=clock_timestamp(),disabled_by=p_actor_user_id,
  credential_revision=credential_revision+1,version=version+1,updated_by=p_actor_user_id where organization_id=p_organization_id and id=p_connector_id;
 update public.sync_runs set status='canceled',canceled_at=clock_timestamp(),cancellation_reason='Agent revoked.',
  lease_owner=null,lease_expires_at=null where organization_id=p_organization_id and connector_id=p_connector_id
  and status in ('queued','waiting_for_review','retrying');
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
 values(p_organization_id,p_actor_user_id,'connector_agent.revoked','connector_agent',p_agent_id::text,
  jsonb_build_object('connectorId',p_connector_id));
 return query select 'revoked'::text,to_jsonb(v_agent);
end $$;

create function public.m1106_consume_agent_nonce(
 p_organization_id uuid,p_connector_id uuid,p_agent_id uuid,p_cert_fingerprint text,
 p_signing_key_id text,p_nonce text,p_expires_at timestamptz
) returns table(outcome text)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_connector public.connectors%rowtype; v_agent public.connector_agents%rowtype; v_inserted integer;
begin
 if p_cert_fingerprint is null or p_cert_fingerprint !~ '^[a-f0-9]{64}$' or p_signing_key_id is null or p_signing_key_id !~ '^[A-Za-z0-9_.-]{1,80}$'
 or p_nonce is null or p_nonce !~ '^[A-Za-z0-9_-]{16,120}$' or p_expires_at is null or p_expires_at<=clock_timestamp()
 or p_expires_at>clock_timestamp()+interval '5 minutes' then
  return query select 'invalid_request'::text; return; end if;
 select * into v_connector from public.connectors where organization_id=p_organization_id and id=p_connector_id for share;
 if not found or v_connector.connector_type<>'on_prem_agent' or not v_connector.enabled or v_connector.archived_at is not null then
  return query select 'invalid_state'::text; return; end if;
 select * into v_agent from public.connector_agents where organization_id=p_organization_id and connector_id=p_connector_id and id=p_agent_id for share;
 if not found or v_agent.status<>'active' or v_agent.revoked_at is not null then
  return query select 'revoked'::text; return; end if;
 if not ((v_agent.current_cert_fingerprint=p_cert_fingerprint and v_agent.current_signing_key_id=p_signing_key_id
   and v_agent.current_expires_at>clock_timestamp() and v_agent.current_key_issued_at>clock_timestamp()-interval '90 days')
  or (v_agent.previous_cert_fingerprint=p_cert_fingerprint and v_agent.previous_signing_key_id=p_signing_key_id
   and v_agent.previous_valid_until>clock_timestamp()
   and v_agent.previous_key_issued_at>clock_timestamp()-interval '90 days')) then
  return query select 'key_expired'::text; return; end if;
 with expired as (select agent_id,nonce from public.connector_agent_nonces
  where agent_id=p_agent_id and expires_at<clock_timestamp()-interval '10 minutes'
  order by expires_at limit 500)
 delete from public.connector_agent_nonces n using expired e where n.agent_id=e.agent_id and n.nonce=e.nonce;
 insert into public.connector_agent_nonces(organization_id,connector_id,agent_id,nonce,expires_at)
 values(p_organization_id,p_connector_id,p_agent_id,p_nonce,p_expires_at)
 on conflict(agent_id,nonce) do nothing;
 get diagnostics v_inserted=row_count;
 return query select case when v_inserted=1 then 'accepted' else 'replay' end;
end $$;

create function public.m1106_stage_agent_batch(
 p_organization_id uuid,p_connector_id uuid,p_agent_id uuid,p_batch_id uuid,p_sequence bigint,
 p_source_id text,p_cursor_from text,p_cursor_to text,p_records jsonb,p_backlog_count bigint,p_backlog_bytes bigint
) returns table(outcome text,accepted_at timestamptz)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_connector public.connectors%rowtype; v_agent public.connector_agents%rowtype;
 v_existing public.connector_agent_batches%rowtype; v_hash text; v_now timestamptz:=clock_timestamp();
 v_staged_count integer; v_staged_bytes bigint; v_payload_bytes integer;
begin
 if p_batch_id is null or p_sequence is null or p_sequence not between 1 and 9007199254740991
 or p_source_id is null or p_source_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$'
 or (p_cursor_from is not null and char_length(p_cursor_from)>8000)
 or p_cursor_to is null or char_length(p_cursor_to) not between 1 and 8000
 or jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records)>200
 or octet_length(p_records::text)>4194304 or p_backlog_count is null or p_backlog_count not between 0 and 9007199254740991
 or p_backlog_bytes is null or p_backlog_bytes not between 0 and 9007199254740991 then
  return query select 'invalid_request'::text,null::timestamptz; return; end if;
 select * into v_connector from public.connectors where organization_id=p_organization_id and id=p_connector_id for update;
 if not found or v_connector.connector_type<>'on_prem_agent' or not v_connector.enabled or v_connector.archived_at is not null then
  return query select 'invalid_state'::text,null::timestamptz; return; end if;
 select * into v_agent from public.connector_agents where organization_id=p_organization_id and connector_id=p_connector_id and id=p_agent_id for update;
 if not found or v_agent.status<>'active' or v_agent.revoked_at is not null or v_agent.current_expires_at<=v_now then
  return query select 'revoked'::text,null::timestamptz; return; end if;
 v_hash:=encode(extensions.digest(p_records::text,'sha256'),'hex');
 select * into v_existing from public.connector_agent_batches
 where organization_id=p_organization_id and connector_id=p_connector_id and batch_id=p_batch_id;
 if found then
  if v_existing.agent_id=p_agent_id and v_existing.sequence=p_sequence and v_existing.source_id=p_source_id
   and v_existing.cursor_from is not distinct from p_cursor_from and v_existing.cursor_to=p_cursor_to
   and v_existing.content_hash=v_hash then
    return query select 'replayed'::text,v_existing.received_at; return; end if;
  return query select 'idempotency_conflict'::text,null::timestamptz; return;
 end if;
 if p_sequence<>v_agent.last_sequence+1 or p_cursor_from is distinct from v_agent.last_source_cursor then
  return query select 'sequence_conflict'::text,null::timestamptz; return; end if;
 if exists(select 1 from public.connector_agent_batches where organization_id=p_organization_id and connector_id=p_connector_id and sequence=p_sequence) then
  return query select 'sequence_conflict'::text,null::timestamptz; return; end if;
 v_payload_bytes:=octet_length(p_records::text);
 select count(*),coalesce(sum(payload_bytes),0) into v_staged_count,v_staged_bytes from public.connector_agent_batches
 where organization_id=p_organization_id and connector_id=p_connector_id and status='staged';
 if v_staged_count>=1000 or v_staged_bytes+v_payload_bytes>1073741824 then
  return query select 'backpressure'::text,null::timestamptz; return; end if;
 insert into public.connector_agent_batches(organization_id,connector_id,agent_id,batch_id,sequence,source_id,cursor_from,cursor_to,
  content_hash,records,record_count,payload_bytes,received_at)
 values(p_organization_id,p_connector_id,p_agent_id,p_batch_id,p_sequence,p_source_id,p_cursor_from,p_cursor_to,
  v_hash,p_records,jsonb_array_length(p_records),v_payload_bytes,v_now);
 update public.connector_agents set last_sequence=p_sequence,last_source_cursor=p_cursor_to,last_contact_at=v_now,
  backlog_count=p_backlog_count,backlog_bytes=p_backlog_bytes,updated_at=v_now where id=p_agent_id;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
 values(p_organization_id,null,'connector_agent.batch_staged','connector_agent',p_agent_id::text,
  jsonb_build_object('connectorId',p_connector_id,'batchId',p_batch_id,'sequence',p_sequence,'recordCount',jsonb_array_length(p_records),'contentHash',v_hash));
 return query select 'accepted'::text,v_now;
end $$;

create function public.m1106_record_agent_health(
 p_organization_id uuid,p_connector_id uuid,p_agent_id uuid,p_agent_version text,p_capabilities jsonb,
 p_backlog_count bigint,p_backlog_bytes bigint,p_safe_error_code text
) returns table(outcome text,accepted_at timestamptz)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_connector public.connectors%rowtype; v_agent public.connector_agents%rowtype; v_now timestamptz:=clock_timestamp();
begin
 if p_agent_version is null or p_agent_version !~ '^[0-9]+\.[0-9]+\.[0-9]+([-+][A-Za-z0-9.-]+)?$' or char_length(p_agent_version)>100
 or jsonb_typeof(p_capabilities) is distinct from 'array' or jsonb_array_length(p_capabilities) not between 1 and 2
 or exists(select 1 from jsonb_array_elements_text(p_capabilities) v where v not in ('canonical_file','https_read'))
 or p_backlog_count is null or p_backlog_count not between 0 and 9007199254740991 or p_backlog_bytes is null or p_backlog_bytes not between 0 and 9007199254740991
 or (p_safe_error_code is not null and p_safe_error_code not in ('source_unavailable','source_changed','source_invalid','queue_full','network_unavailable','proxy_failed','tls_failed','clock_skew','credential_expired','unknown')) then
  return query select 'invalid_request'::text,null::timestamptz; return; end if;
 select * into v_connector from public.connectors where organization_id=p_organization_id and id=p_connector_id for share;
 if not found or v_connector.connector_type<>'on_prem_agent' or not v_connector.enabled or v_connector.archived_at is not null then
  return query select 'invalid_state'::text,null::timestamptz; return; end if;
 select * into v_agent from public.connector_agents where organization_id=p_organization_id and connector_id=p_connector_id and id=p_agent_id for update;
 if not found or v_agent.status<>'active' or v_agent.revoked_at is not null or v_agent.current_expires_at<=v_now then
  return query select 'revoked'::text,null::timestamptz; return; end if;
 update public.connector_agents set last_contact_at=v_now,agent_version=p_agent_version,capabilities=p_capabilities,
  backlog_count=p_backlog_count,backlog_bytes=p_backlog_bytes,last_error_code=p_safe_error_code,updated_at=v_now where id=p_agent_id;
 return query select 'accepted'::text,v_now;
end $$;

-- The existing atomic sync commit updates sync_connector_cursors. This status
-- update runs in that exact transaction; a rolled-back commit leaves batches staged.
create function public.m1106_mark_batches_committed() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_sequence bigint;
begin
 if new.cursor is not distinct from old.cursor or new.cursor !~ '^agent:[1-9][0-9]{0,15}$' then return new; end if;
 if not exists(select 1 from public.connectors where organization_id=new.organization_id and id=new.connector_id and connector_type='on_prem_agent') then return new; end if;
 v_sequence:=substring(new.cursor from 7)::bigint;
 update public.connector_agent_batches set status='committed'
 where organization_id=new.organization_id and connector_id=new.connector_id and sequence<=v_sequence and status='staged';
 return new;
end $$;
create trigger m1106_mark_batches_committed after update of cursor on public.sync_connector_cursors
 for each row execute function public.m1106_mark_batches_committed();

create function public.m1106_prune_agent_nonces(p_limit integer default 10000) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_count integer;
begin
 if p_limit is null or p_limit not between 1 and 10000 then return 0; end if;
 with expired as (select agent_id,nonce from public.connector_agent_nonces
  where expires_at<clock_timestamp()-interval '10 minutes' order by expires_at limit p_limit)
 delete from public.connector_agent_nonces n using expired e where n.agent_id=e.agent_id and n.nonce=e.nonce;
 get diagnostics v_count=row_count;
 return v_count;
end $$;

-- Existing hub writers have hard-coded supported-type checks. Patch only the
-- agent branches and assert each replacement, preserving every older branch.
create function public.m1106_replace_once(p_body text,p_from text,p_to text) returns text
language plpgsql immutable set search_path=public,pg_temp as $$
begin
 if p_body is null or p_from is null or p_from='' or
  (length(p_body)-length(replace(p_body,p_from,'')))/length(p_from)<>1 then
  raise exception 'M11-06 expected exactly one existing function anchor: %',left(p_from,120); end if;
 return replace(p_body,p_from,p_to);
end $$;
do $$
declare v_definition text; v_original text;
begin
 select pg_get_functiondef('public.create_connector_atomic(uuid,uuid,uuid,text,text,text,text,jsonb,text)'::regprocedure) into v_definition;
 v_original:=v_definition;
 v_definition:=public.m1106_replace_once(v_definition,
  'coalesce(p_connector_type, '''') not in (''reference_conformance'',''github_actions'',''gitlab_ci'',''azure_devops'',''jira'')',
  'coalesce(p_connector_type, '''') not in (''reference_conformance'',''github_actions'',''gitlab_ci'',''azure_devops'',''jira'',''on_prem_agent'')');
 v_definition:=public.m1106_replace_once(v_definition,
  'or (p_connector_type=''azure_devops'' and not (p_connection_config ? ''serviceConnectionId'' and p_connection_config ? ''organization''))',
  'or (p_connector_type=''azure_devops'' and not (p_connection_config ? ''serviceConnectionId'' and p_connection_config ? ''organization''))
    or (p_connector_type=''on_prem_agent'' and (coalesce(p_connection_config,''{}''::jsonb)<>''{}''::jsonb or p_commit_policy<>''manual''))');
 if v_definition=v_original or position('on_prem_agent' in v_definition)=0 then raise exception 'M11-06 create connector patch did not apply'; end if;
 execute v_definition;

 select pg_get_functiondef('public.m11_create_connector_atomic(uuid,uuid,bigint,uuid,text,text,text,text,jsonb,text)'::regprocedure) into v_definition;
 v_original:=v_definition;
 v_definition:=public.m1106_replace_once(v_definition,
  'p_connector_type in (''github_actions'',''gitlab_ci'',''azure_devops'',''jira'')',
  'p_connector_type in (''github_actions'',''gitlab_ci'',''azure_devops'',''jira'',''on_prem_agent'')');
 if v_definition=v_original then raise exception 'M11-06 owner creation patch did not apply'; end if;
 execute v_definition;

 select pg_get_functiondef('public.m11_execute_connector_command_atomic(uuid,uuid,uuid,text,integer,uuid,text,text,bigint,jsonb)'::regprocedure) into v_definition;
 v_original:=v_definition;
 v_definition:=public.m1106_replace_once(v_definition,
  'if p_operation=''replace_secret'' then',
  'if p_operation=''replace_secret'' then
  if v_connector.connector_type=''on_prem_agent'' then return query select ''invalid_state''::text,null::jsonb,null::jsonb; return; end if;');
 v_definition:=public.m1106_replace_once(v_definition,
  'elsif p_operation=''revoke_secret'' then',
  'elsif p_operation=''revoke_secret'' then
  if v_connector.connector_type=''on_prem_agent'' then return query select ''invalid_state''::text,null::jsonb,null::jsonb; return; end if;');
 v_definition:=public.m1106_replace_once(v_definition,
  'or (v_connector.connector_type=''azure_devops'' and not (v_payload->''connectionConfig'' ? ''serviceConnectionId'' and v_payload->''connectionConfig'' ? ''organization''))',
  'or (v_connector.connector_type=''azure_devops'' and not (v_payload->''connectionConfig'' ? ''serviceConnectionId'' and v_payload->''connectionConfig'' ? ''organization''))
   or (v_connector.connector_type=''on_prem_agent'' and (v_payload->''connectionConfig''<>''{}''::jsonb or v_payload->>''commitPolicy''<>''manual''))');
 v_definition:=public.m1106_replace_once(v_definition,
  'if v_payload<>''{}''::jsonb or v_connector.secret_ref is null',
  'if v_payload<>''{}''::jsonb or (v_connector.connector_type<>''on_prem_agent'' and v_connector.secret_ref is null)
   or (v_connector.connector_type=''on_prem_agent'' and not exists(select 1 from public.connector_agents a where a.organization_id=p_organization_id and a.connector_id=p_connector_id and a.status=''active'' and a.revoked_at is null and a.current_expires_at>clock_timestamp()))');
 v_definition:=public.m1106_replace_once(v_definition,
  'or not exists(select 1 from public.connector_secrets where organization_id=p_organization_id and connector_id=p_connector_id and id=v_connector.secret_ref and revoked_at is null) then',
  'or (v_connector.connector_type<>''on_prem_agent'' and not exists(select 1 from public.connector_secrets where organization_id=p_organization_id and connector_id=p_connector_id and id=v_connector.secret_ref and revoked_at is null)) then');
 if v_definition=v_original or position('connector_type=''on_prem_agent'' and not exists(select 1 from public.connector_agents' in v_definition)=0 then
  raise exception 'M11-06 reconnect patch did not apply'; end if;
 execute v_definition;

 select pg_get_functiondef('public.m11_assert_sync_run_fence(uuid,uuid,uuid)'::regprocedure) into v_definition;
 v_original:=v_definition;
 v_definition:=public.m1106_replace_once(v_definition,
  'and not exists(select 1 from public.connector_secrets where organization_id=p_organization_id and connector_id=v_connector.id and id=v_connector.secret_ref and revoked_at is not null);',
  'and not exists(select 1 from public.connector_secrets where organization_id=p_organization_id and connector_id=v_connector.id and id=v_connector.secret_ref and revoked_at is not null)
 and (v_connector.connector_type<>''on_prem_agent'' or exists(select 1 from public.connector_agents a where a.organization_id=p_organization_id and a.connector_id=v_connector.id and a.status=''active'' and a.revoked_at is null and a.current_expires_at>clock_timestamp()));');
 if v_definition=v_original then raise exception 'M11-06 sync fence patch did not apply'; end if;
 execute v_definition;
end $$;
drop function public.m1106_replace_once(text,text,text);

create or replace function public.m11_begin_sync_run_atomic(
 p_organization_id uuid,p_connector_id uuid,p_actor_user_id uuid,p_permission_version bigint,
 p_reconciliation_kind text,p_idempotency_key uuid,p_correlation_id uuid
) returns table(outcome text,run jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_type text;
begin
 if not public.m11_lock_connector_authorization(p_organization_id,p_actor_user_id,p_permission_version) then
  return query select 'forbidden'::text,null::jsonb; return; end if;
 select connector_type into v_type from public.connectors
 where organization_id=p_organization_id and id=p_connector_id and enabled and archived_at is null for update;
 if v_type not in ('reference_conformance','on_prem_agent') or v_type is null then
  return query select 'not_found'::text,null::jsonb; return; end if;
 if v_type='on_prem_agent' and not exists(select 1 from public.connector_agents a
  where a.organization_id=p_organization_id and a.connector_id=p_connector_id and a.status='active'
  and a.revoked_at is null and a.current_expires_at>clock_timestamp()) then
  return query select 'invalid_state'::text,null::jsonb; return; end if;
 if exists(select 1 from public.sync_runs r where r.organization_id=p_organization_id and r.connector_id=p_connector_id
  and r.status='failed' and not public.m1102_run_recovered(p_organization_id,r.id))
  and not exists(select 1 from public.sync_runs where organization_id=p_organization_id
   and actor_user_id=p_actor_user_id and trigger_idempotency_key=p_idempotency_key) then
  return query select 'blocked_by_dead_letter'::text,null::jsonb; return; end if;
 return query select * from public.begin_sync_run_atomic(p_organization_id,p_connector_id,p_actor_user_id,
  p_reconciliation_kind,p_idempotency_key,p_correlation_id);
end $$;

revoke all on function public.m1106_valid_envelope(jsonb),public.m1106_agent_live(uuid,uuid,uuid),
 public.m1106_agent_connection_summaries(uuid,uuid[]),
 public.m1106_issue_agent_enrollment(uuid,uuid,uuid,bigint,uuid,text,jsonb),
 public.m1106_redeem_agent_enrollment(text,text,text,text,text,text,jsonb),
 public.m1106_rotate_agent_credential(uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb),
 public.m1106_revoke_agent(uuid,uuid,uuid,uuid,bigint,uuid),
 public.m1106_consume_agent_nonce(uuid,uuid,uuid,text,text,text,timestamptz),
 public.m1106_stage_agent_batch(uuid,uuid,uuid,uuid,bigint,text,text,text,jsonb,bigint,bigint),
 public.m1106_record_agent_health(uuid,uuid,uuid,text,jsonb,bigint,bigint,text),
 public.m1106_mark_batches_committed(),public.m1106_prune_agent_nonces(integer)
 from public,anon,authenticated,service_role;
grant execute on function public.m1106_valid_envelope(jsonb),public.m1106_agent_live(uuid,uuid,uuid),
 public.m1106_agent_connection_summaries(uuid,uuid[]),
 public.m1106_issue_agent_enrollment(uuid,uuid,uuid,bigint,uuid,text,jsonb),
 public.m1106_redeem_agent_enrollment(text,text,text,text,text,text,jsonb),
 public.m1106_rotate_agent_credential(uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb),
 public.m1106_revoke_agent(uuid,uuid,uuid,uuid,bigint,uuid),
 public.m1106_consume_agent_nonce(uuid,uuid,uuid,text,text,text,timestamptz),
 public.m1106_stage_agent_batch(uuid,uuid,uuid,uuid,bigint,text,text,text,jsonb,bigint,bigint),
 public.m1106_record_agent_health(uuid,uuid,uuid,text,jsonb,bigint,bigint,text),
 public.m1106_prune_agent_nonces(integer) to service_role;
