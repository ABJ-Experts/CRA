-- M11-04: CI provider release bindings and SBOM build gate correlation.
-- CI callers authenticate with the existing SBOM CI credential. Provider
-- repository/build identity is bound server-side to one tenant release before
-- the existing immutable M3 SBOM intake path is used.

alter table public.connectors drop constraint connectors_connector_type_check;
alter table public.connectors add constraint connectors_connector_type_check
  check (connector_type in ('reference_conformance', 'github_actions', 'gitlab_ci', 'azure_devops'));

-- Existing hub commands call this validator for both create and configure.
-- Provider records carry identity only; credentials stay in connector_secrets.
create or replace function public.m11_valid_connector_config(p_organization_id uuid,p_config jsonb)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_binding jsonb; v_host text;
begin
  if jsonb_typeof(p_config) is distinct from 'object' then return false; end if;
  if p_config ? 'providerHost' then
    if octet_length(p_config::text)>4000 then return false; end if;
    v_host:=p_config->>'providerHost';
    if v_host is null or v_host<>lower(v_host) or char_length(v_host) not between 3 and 253
      or v_host !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' then return false; end if;
    if p_config ? 'appId' then
      return v_host='github.com' and p_config->>'appId' ~ '^[0-9]{1,20}$'
        and p_config->>'installationId' ~ '^[0-9]{1,20}$'
        and not exists(select 1 from jsonb_object_keys(p_config) k where k not in ('providerHost','appId','installationId'));
    end if;
    if p_config ? 'serviceConnectionId' then
      return v_host='dev.azure.com' and p_config->>'organization' ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,63}$'
        and p_config->>'projectId' ~ '^[A-Fa-f0-9-]{36}$'
        and p_config->>'serviceConnectionId' ~ '^[A-Fa-f0-9-]{36}$'
        and not exists(select 1 from jsonb_object_keys(p_config) k where k not in ('providerHost','organization','projectId','serviceConnectionId'));
    end if;
    return p_config->>'projectId' ~ '^[0-9]{1,20}$'
      and not exists(select 1 from jsonb_object_keys(p_config) k where k not in ('providerHost','projectId'));
  end if;
  if exists(select 1 from jsonb_object_keys(p_config) k where k not in ('baseUrl','tenantOrSiteId','scopeFilter','defaultOwnerBinding')) then return false; end if;
  v_binding:=p_config->'defaultOwnerBinding';
  if v_binding is null then return true; end if;
  if jsonb_typeof(v_binding)<>'object' or exists(select 1 from jsonb_object_keys(v_binding) k where k not in ('responsibleOwnerId','legalEntityId'))
    or v_binding->>'responsibleOwnerId' is null or v_binding->>'legalEntityId' is null then return false; end if;
  return public.m2_active_member(p_organization_id,(v_binding->>'responsibleOwnerId')::uuid)
    and exists(select 1 from public.organization_legal_entities where organization_id=p_organization_id
      and id=(v_binding->>'legalEntityId')::uuid and deleted_at is null and status='active');
exception when invalid_text_representation then return false;
end $$;

create or replace function public.create_connector_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_idempotency_key uuid,
  p_connector_type text, p_display_name text, p_adapter_version text, p_mapping_version text,
  p_connection_config jsonb, p_commit_policy text
) returns table(outcome text, connector jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_connector public.connectors%rowtype;
  v_replay public.connectors%rowtype;
  v_request_digest text;
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  if p_idempotency_key is null
    or char_length(btrim(coalesce(p_display_name, ''))) not between 1 and 200
    or coalesce(p_connector_type, '') not in ('reference_conformance','github_actions','gitlab_ci','azure_devops')
    or coalesce(p_adapter_version, '') !~ '^[0-9]+\.[0-9]+\.[0-9]+$'
    or char_length(btrim(coalesce(p_mapping_version, ''))) not between 1 and 100
    or coalesce(p_commit_policy, '') not in ('manual','auto')
    or not public.m11_valid_connector_config(p_organization_id,coalesce(p_connection_config,'{}'::jsonb))
    or (p_connector_type='reference_conformance' and coalesce(p_connection_config,'{}'::jsonb) ? 'providerHost')
    or (p_connector_type='github_actions' and not (p_connection_config ? 'appId' and p_connection_config ? 'installationId'))
    or (p_connector_type='gitlab_ci' and (not (p_connection_config ? 'projectId') or p_connection_config ? 'appId' or p_connection_config ? 'serviceConnectionId'))
    or (p_connector_type='azure_devops' and not (p_connection_config ? 'serviceConnectionId' and p_connection_config ? 'organization'))
    or coalesce(p_connection_config,'{}'::jsonb)::text
      ~* '"[^"]*(password|secret|token|api[_-]?key|private[_-]?key)[^"]*"\s*:' then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;

  v_request_digest := encode(extensions.digest(jsonb_build_object(
    'connectorType',p_connector_type,'displayName',btrim(p_display_name),
    'adapterVersion',p_adapter_version,'mappingVersion',btrim(p_mapping_version),
    'connectionConfig',coalesce(p_connection_config,'{}'::jsonb),
    'commitPolicy',p_commit_policy
  )::text,'sha256'),'hex');

  select * into v_replay from public.connectors
  where organization_id=p_organization_id and created_by=p_actor_user_id
    and create_idempotency_key=p_idempotency_key for update;
  if found then
    if v_replay.create_request_digest=v_request_digest then
      return query select 'replayed'::text,public.m2_v2_connector_json(v_replay); return;
    end if;
    return query select 'idempotency_mismatch'::text,null::jsonb; return;
  end if;
  insert into public.connectors(
    organization_id, connector_type, display_name, adapter_version, mapping_version,
    connection_config, commit_policy, create_idempotency_key, create_request_digest,
    created_by, updated_by
  ) values (
    p_organization_id, p_connector_type, btrim(p_display_name), p_adapter_version, btrim(p_mapping_version),
    coalesce(p_connection_config, '{}'::jsonb), p_commit_policy, p_idempotency_key, v_request_digest,
    p_actor_user_id, p_actor_user_id
  ) on conflict (organization_id, created_by, create_idempotency_key)
    where create_idempotency_key is not null do nothing
  returning * into v_connector;
  if not found then
    select * into v_replay from public.connectors
    where organization_id=p_organization_id and created_by=p_actor_user_id
      and create_idempotency_key=p_idempotency_key for update;
    if found and v_replay.create_request_digest=v_request_digest then
      return query select 'replayed'::text,public.m2_v2_connector_json(v_replay); return;
    end if;
    return query select 'idempotency_mismatch'::text,null::jsonb; return;
  end if;
  insert into public.sync_connector_cursors(organization_id, connector_id) values (p_organization_id, v_connector.id);
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'connector.created', 'connector', v_connector.id::text,
    jsonb_build_object('connectorType', p_connector_type, 'displayName', v_connector.display_name,
      'requestDigest',v_request_digest));
  return query select 'created'::text, public.m2_v2_connector_json(v_connector);
end;
$$;

create or replace function public.m11_create_connector_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_permission_version bigint,p_idempotency_key uuid,
  p_connector_type text,p_display_name text,p_adapter_version text,p_mapping_version text,
  p_connection_config jsonb,p_commit_policy text
) returns table(outcome text,connector jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.m11_lock_connector_authorization(p_organization_id,p_actor_user_id,p_permission_version,
    p_connector_type in ('github_actions','gitlab_ci','azure_devops')) then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  if not public.m11_valid_connector_config(p_organization_id,p_connection_config) then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  return query select * from public.create_connector_atomic(p_organization_id,p_actor_user_id,p_idempotency_key,
    p_connector_type,p_display_name,p_adapter_version,p_mapping_version,p_connection_config,p_commit_policy);
end $$;

-- Product/release synchronization is a separate contract. CI connectors may
-- supply build metadata only; they must never enter the reference sync worker.
create or replace function public.m11_begin_sync_run_atomic(
  p_organization_id uuid,p_connector_id uuid,p_actor_user_id uuid,p_permission_version bigint,
  p_reconciliation_kind text,p_idempotency_key uuid,p_correlation_id uuid
) returns table(outcome text,run jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.m11_lock_connector_authorization(p_organization_id,p_actor_user_id,p_permission_version) then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  perform 1 from public.connectors where organization_id=p_organization_id and id=p_connector_id
    and connector_type='reference_conformance' for update;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  if exists(select 1 from public.sync_runs r where r.organization_id=p_organization_id and r.connector_id=p_connector_id
      and r.status='failed' and not public.m1102_run_recovered(p_organization_id,r.id))
    and not exists(select 1 from public.sync_runs where organization_id=p_organization_id
      and actor_user_id=p_actor_user_id and trigger_idempotency_key=p_idempotency_key) then
    return query select 'blocked_by_dead_letter'::text,null::jsonb; return;
  end if;
  return query select * from public.begin_sync_run_atomic(p_organization_id,p_connector_id,p_actor_user_id,
    p_reconciliation_kind,p_idempotency_key,p_correlation_id);
end $$;

create table public.ci_provider_release_bindings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connector_id uuid not null,
  product_id uuid not null,
  release_id uuid not null,
  credential_id uuid not null,
  provider text not null check (provider in ('github_actions','gitlab_ci','azure_devops')),
  provider_host text not null check (
    char_length(provider_host) between 3 and 253
    and provider_host = lower(provider_host)
    and provider_host ~ '^(?!localhost$)(?![0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
  ),
  repository_owner text not null check (char_length(btrim(repository_owner)) between 1 and 120),
  repository_name text not null check (char_length(btrim(repository_name)) between 1 and 160),
  repository_id text not null check (char_length(btrim(repository_id)) between 1 and 160),
  provider_installation_id text check (provider_installation_id is null or char_length(btrim(provider_installation_id)) between 1 and 160),
  project_key text check (project_key is null or char_length(btrim(project_key)) between 1 and 200),
  pipeline_definition_id text check (pipeline_definition_id is null or char_length(btrim(pipeline_definition_id)) between 1 and 200),
  allowed_ref text not null check (char_length(allowed_ref) between 1 and 500 and allowed_ref ~ '^refs/(heads|tags)/[^[:cntrl:]]+$'),
  status text not null default 'active' check (status in ('active','revoked')),
  version bigint not null default 1 check (version > 0),
  connection_revision integer not null check (connection_revision > 0),
  credential_revision integer not null check (credential_revision > 0),
  created_by uuid not null references public.users(id) on delete restrict,
  revoked_by uuid references public.users(id) on delete restrict,
  revoked_reason text check (revoked_reason is null or char_length(btrim(revoked_reason)) between 1 and 500),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((revoked_at is null) = (revoked_by is null) and (revoked_at is null) = (revoked_reason is null)),
  check ((provider = 'github_actions' and provider_installation_id is not null) or (provider <> 'github_actions' and provider_installation_id is null)),
  foreign key (organization_id, product_id) references public.products(organization_id, id) on delete restrict,
  foreign key (organization_id, product_id, release_id) references public.product_releases(organization_id, product_id, id) on delete restrict,
  foreign key (organization_id, credential_id) references public.sbom_ci_credentials(organization_id, id) on delete restrict,
  foreign key (organization_id, connector_id) references public.connectors(organization_id, id) on delete restrict,
  unique (organization_id, id)
);
create index ci_provider_release_bindings_org_status_idx on public.ci_provider_release_bindings(organization_id, status, updated_at desc, id desc);
create index ci_provider_release_bindings_repo_idx on public.ci_provider_release_bindings(organization_id, provider, provider_host, repository_id, status);
create unique index ci_provider_release_bindings_active_scope_idx on public.ci_provider_release_bindings(
  organization_id, provider, provider_host, repository_id, allowed_ref,
  coalesce(project_key, ''), coalesce(pipeline_definition_id, '')
) where status = 'active';
alter table public.ci_provider_release_bindings enable row level security;
revoke all on public.ci_provider_release_bindings from public, anon, authenticated, service_role;
grant select on public.ci_provider_release_bindings to service_role;

-- An active binding must be explicitly revoked before provider identity is
-- changed. Cosmetic connector metadata may still be edited in place.
create function public.m1104_fence_ci_connector_identity()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.connector_type not in ('github_actions','gitlab_ci','azure_devops') then return new; end if;
  if not public.m11_valid_connector_config(new.organization_id,new.connection_config) then
    raise exception 'invalid_ci_connector_config' using errcode='23514';
  end if;
  if (new.connector_type='github_actions' and not (new.connection_config ? 'appId' and new.connection_config ? 'installationId'))
    or (new.connector_type='gitlab_ci' and (new.connection_config ? 'appId' or new.connection_config ? 'serviceConnectionId'))
    or (new.connector_type='azure_devops' and not (new.connection_config ? 'serviceConnectionId' and new.connection_config ? 'organization')) then
    raise exception 'ci_connector_type_config_mismatch' using errcode='23514';
  end if;
  if new.connection_config is distinct from old.connection_config and exists(
    select 1 from public.ci_provider_release_bindings b where b.organization_id=new.organization_id
      and b.connector_id=new.id and b.status='active') then
    raise exception 'active_ci_binding_identity' using errcode='23514';
  end if;
  return new;
end $$;
create trigger m1104_fence_ci_connector_identity before update on public.connectors
  for each row execute function public.m1104_fence_ci_connector_identity();
revoke all on function public.m1104_fence_ci_connector_identity() from public,anon,authenticated,service_role;

create table public.ci_build_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  binding_id uuid not null,
  credential_id uuid not null,
  source_id uuid not null,
  ingest_job_id uuid,
  provider text not null check (provider in ('github_actions','gitlab_ci','azure_devops')),
  provider_host text not null,
  repository_owner text not null,
  repository_name text not null,
  repository_id text not null,
  provider_installation_id text,
  project_key text,
  pipeline_definition_id text,
  run_id text not null check (char_length(btrim(run_id)) between 1 and 200),
  run_attempt text check (run_attempt is null or char_length(btrim(run_attempt)) between 1 and 80),
  provider_job_id text check (provider_job_id is null or char_length(btrim(provider_job_id)) between 1 and 200),
  ref text not null check (char_length(btrim(ref)) between 1 and 500),
  commit_sha text not null check (commit_sha ~ '^[a-f0-9]{40}$'),
  event_name text not null check (event_name in ('push','pull_request','merge_request','pipeline','build','release','manual')),
  idempotency_key uuid not null,
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (organization_id, binding_id) references public.ci_provider_release_bindings(organization_id, id) on delete restrict,
  foreign key (organization_id, credential_id) references public.sbom_ci_credentials(organization_id, id) on delete restrict,
  foreign key (organization_id, source_id) references public.sbom_sources(organization_id, id) on delete restrict,
  foreign key (organization_id, ingest_job_id) references public.sbom_ingest_jobs(organization_id, id) on delete restrict,
  unique (organization_id, id),
  unique (organization_id, source_id),
  unique (organization_id, credential_id, idempotency_key)
);
create unique index ci_build_runs_provider_attempt_idx on public.ci_build_runs(
  organization_id, provider, provider_host, repository_id, run_id,
  coalesce(run_attempt, '')
);
create index ci_build_runs_gate_lookup_idx on public.ci_build_runs(organization_id, credential_id, provider, run_id, created_at desc, id desc);
create index ci_build_runs_binding_idx on public.ci_build_runs(organization_id, binding_id, created_at desc, id desc);
alter table public.ci_build_runs enable row level security;
revoke all on public.ci_build_runs from public, anon, authenticated, service_role;
grant select on public.ci_build_runs to service_role;

-- Inbound delivery identity is distinct from M11-03 outbound deliveries.
-- Only a digest and provider IDs are retained; signed raw payloads are not.
create table public.ci_provider_webhook_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  binding_id uuid not null,
  provider text not null check (provider in ('github_actions','gitlab_ci')),
  provider_host text not null,
  delivery_id text not null check (char_length(btrim(delivery_id)) between 1 and 200),
  body_sha256 text not null check (body_sha256 ~ '^[a-f0-9]{64}$'),
  run_id text not null check (char_length(btrim(run_id)) between 1 and 200),
  run_attempt text check (run_attempt is null or char_length(btrim(run_attempt)) between 1 and 80),
  received_at timestamptz not null default now(),
  foreign key (organization_id,binding_id) references public.ci_provider_release_bindings(organization_id,id) on delete restrict,
  unique (provider,provider_host,delivery_id)
);
create index ci_provider_webhook_events_binding_time_idx on public.ci_provider_webhook_events(organization_id,binding_id,received_at desc,id desc);
alter table public.ci_provider_webhook_events enable row level security;
revoke all on public.ci_provider_webhook_events from public,anon,authenticated,service_role;
grant select on public.ci_provider_webhook_events to service_role;

-- connector_commands is bound to connector lifecycle operations, actor-scoped
-- revision/permission fences, credential digests, and running deadlines.
-- Binding commands have a separate immutable result and release scope; using
-- that ledger would broaden its operation/state contract for unrelated writes.
create table public.ci_provider_release_binding_commands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid not null references public.users(id) on delete restrict,
  binding_id uuid,
  operation text not null check (operation in ('upsert','revoke')),
  idempotency_key uuid not null,
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object' and octet_length(result::text) <= 20000),
  created_at timestamptz not null default now(),
  unique (organization_id, actor_user_id, idempotency_key),
  foreign key (organization_id, binding_id) references public.ci_provider_release_bindings(organization_id, id) on delete restrict
);
alter table public.ci_provider_release_binding_commands enable row level security;
revoke all on public.ci_provider_release_binding_commands from public, anon, authenticated, service_role;
grant select on public.ci_provider_release_binding_commands to service_role;

create trigger ci_provider_release_bindings_updated_at
  before update on public.ci_provider_release_bindings
  for each row execute function public.set_updated_at();
create trigger ci_build_runs_updated_at
  before update on public.ci_build_runs
  for each row execute function public.set_updated_at();

create function public.ci_provider_release_binding_json(p_organization_id uuid, p_binding_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', b.id,
    'organizationId', b.organization_id,
    'connectorId', b.connector_id,
    'productId', b.product_id,
    'releaseId', b.release_id,
    'credentialId', b.credential_id,
    'provider', b.provider,
    'providerHost', b.provider_host,
    'repositoryOwner', b.repository_owner,
    'repositoryName', b.repository_name,
    'repositoryId', b.repository_id,
    'providerInstallationId', b.provider_installation_id,
    'projectKey', b.project_key,
    'pipelineDefinitionId', b.pipeline_definition_id,
    'allowedRef', b.allowed_ref,
    'status', b.status,
    'version', b.version,
    'connectionRevision', b.connection_revision,
    'credentialRevision', b.credential_revision,
    'createdAt', to_jsonb(b.created_at),
    'updatedAt', to_jsonb(b.updated_at)
  )
  from public.ci_provider_release_bindings b
  where b.organization_id = p_organization_id and b.id = p_binding_id
$$;

create function public.upsert_ci_provider_release_binding_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_connector_id uuid,
  p_expected_connection_revision integer,
  p_expected_credential_revision integer,
  p_product_id uuid,
  p_release_id uuid,
  p_credential_id uuid,
  p_provider text,
  p_provider_host text,
  p_repository_owner text,
  p_repository_name text,
  p_repository_id text,
  p_provider_installation_id text,
  p_project_key text,
  p_pipeline_definition_id text,
  p_allowed_ref text,
  p_expected_binding_id uuid,
  p_expected_version bigint,
  p_idempotency_key uuid,
  p_request_digest text
) returns table(outcome text, binding jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_command public.ci_provider_release_binding_commands%rowtype; v_binding public.ci_provider_release_bindings%rowtype;
  v_connector public.connectors%rowtype; v_binding_id uuid;
begin
  if p_organization_id is null or p_actor_user_id is null or p_connector_id is null or p_product_id is null or p_release_id is null or p_credential_id is null
    or p_expected_connection_revision is null or p_expected_connection_revision < 1
    or p_expected_credential_revision is null or p_expected_credential_revision < 1
    or p_idempotency_key is null or p_request_digest !~ '^[a-f0-9]{64}$'
    or p_provider not in ('github_actions','gitlab_ci','azure_devops')
    or p_provider_host is null or p_provider_host <> lower(p_provider_host)
    or p_provider_host !~ '^(?!localhost$)(?![0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
    or char_length(btrim(coalesce(p_repository_owner,''))) not between 1 and 120
    or char_length(btrim(coalesce(p_repository_name,''))) not between 1 and 160
    or char_length(btrim(coalesce(p_repository_id,''))) not between 1 and 160
    or (p_provider = 'github_actions' and char_length(btrim(coalesce(p_provider_installation_id,''))) not between 1 and 160)
    or (p_provider <> 'github_actions' and p_provider_installation_id is not null)
    or (p_project_key is not null and char_length(btrim(p_project_key)) not between 1 and 200)
    or (p_pipeline_definition_id is not null and char_length(btrim(p_pipeline_definition_id)) not between 1 and 200)
    or p_allowed_ref !~ '^refs/(heads|tags)/[^[:cntrl:]]+$' or char_length(p_allowed_ref) not between 1 and 500
    or (p_expected_binding_id is null and p_expected_version is not null)
    or (p_expected_binding_id is not null and p_expected_version is null)
    or not public.m11_lock_connector_authorization(p_organization_id, p_actor_user_id,
      (select version from public.organization_permissions_version where organization_id=p_organization_id), true)
    or not exists (select 1 from public.product_releases r where r.organization_id = p_organization_id and r.product_id = p_product_id and r.id = p_release_id)
    or not exists (select 1 from public.sbom_ci_credentials c where c.organization_id = p_organization_id and c.id = p_credential_id and c.status = 'active') then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  select * into v_connector from public.connectors c where c.organization_id = p_organization_id
    and c.id = p_connector_id and c.connector_type = p_provider and c.enabled and c.archived_at is null
    and c.secret_ref is not null and c.credential_revision > 0
    and exists(select 1 from public.connector_secrets s where s.organization_id=p_organization_id
      and s.connector_id=c.id and s.id=c.secret_ref and s.revoked_at is null)
    and c.connection_config->>'providerHost' = p_provider_host
    and (p_provider <> 'github_actions' or c.connection_config->>'installationId' = p_provider_installation_id)
    and (p_provider <> 'gitlab_ci' or c.connection_config->>'projectId' = p_repository_id)
    and (p_provider <> 'azure_devops' or c.connection_config->>'projectId' = p_project_key)
    for share;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  if v_connector.connection_revision <> p_expected_connection_revision
    or v_connector.credential_revision <> p_expected_credential_revision then
    return query select 'conflict'::text,null::jsonb; return;
  end if;

  select * into v_command from public.ci_provider_release_binding_commands c
  where c.organization_id = p_organization_id and c.actor_user_id = p_actor_user_id and c.idempotency_key = p_idempotency_key;
  if found then
    if v_command.request_digest = p_request_digest then
      return query select 'replayed'::text, v_command.result->'binding'; return;
    end if;
    return query select 'idempotency_mismatch'::text, null::jsonb; return;
  end if;

  if p_expected_binding_id is not null then
    select * into v_binding from public.ci_provider_release_bindings b
    where b.organization_id = p_organization_id and b.id = p_expected_binding_id and b.status = 'active' for update;
    if not found then return query select 'not_found'::text, null::jsonb; return; end if;
    if v_binding.version <> p_expected_version
      or v_binding.connector_id <> p_connector_id or v_binding.product_id <> p_product_id
      or v_binding.release_id <> p_release_id or v_binding.credential_id <> p_credential_id
      or v_binding.provider <> p_provider or v_binding.provider_host <> p_provider_host
      or v_binding.repository_id <> p_repository_id
      or v_binding.provider_installation_id is distinct from p_provider_installation_id
      or v_binding.project_key is distinct from p_project_key
      or v_binding.pipeline_definition_id is distinct from p_pipeline_definition_id
      or v_binding.allowed_ref is distinct from p_allowed_ref then
      return query select 'conflict'::text, null::jsonb; return;
    end if;
    update public.ci_provider_release_bindings set
      repository_owner = btrim(p_repository_owner),
      repository_name = btrim(p_repository_name),
      connection_revision = v_connector.connection_revision,
      credential_revision = v_connector.credential_revision,
      version = version + 1
    where organization_id = p_organization_id and id = p_expected_binding_id
    returning id into v_binding_id;
  else
    insert into public.ci_provider_release_bindings(
      organization_id, connector_id, product_id, release_id, credential_id, provider, provider_host,
      repository_owner, repository_name, repository_id, provider_installation_id,
      project_key, pipeline_definition_id, allowed_ref, connection_revision, credential_revision, created_by
    ) values (
      p_organization_id, p_connector_id, p_product_id, p_release_id, p_credential_id, p_provider, p_provider_host,
      btrim(p_repository_owner), btrim(p_repository_name), btrim(p_repository_id), nullif(btrim(coalesce(p_provider_installation_id, '')), ''),
      nullif(btrim(coalesce(p_project_key, '')), ''), nullif(btrim(coalesce(p_pipeline_definition_id, '')), ''),
      p_allowed_ref,
      v_connector.connection_revision,v_connector.credential_revision,p_actor_user_id
    ) returning id into v_binding_id;
  end if;

  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'ci_provider_release_binding.upserted', 'ci_provider_release_binding', v_binding_id::text,
    jsonb_build_object('provider', p_provider, 'providerHost', p_provider_host, 'repositoryId', p_repository_id, 'releaseId', p_release_id));
  insert into public.ci_provider_release_binding_commands(organization_id, actor_user_id, binding_id, operation, idempotency_key, request_digest, result)
  values (p_organization_id, p_actor_user_id, v_binding_id, 'upsert', p_idempotency_key, p_request_digest,
    jsonb_build_object('binding', public.ci_provider_release_binding_json(p_organization_id, v_binding_id)));
  return query select 'upserted'::text, public.ci_provider_release_binding_json(p_organization_id, v_binding_id);
exception when unique_violation then
  return query select 'conflict'::text, null::jsonb;
end;
$$;

create function public.revoke_ci_provider_release_binding_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_binding_id uuid,
  p_expected_version bigint,
  p_idempotency_key uuid,
  p_request_digest text,
  p_reason text
) returns table(outcome text, binding jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_command public.ci_provider_release_binding_commands%rowtype; v_binding public.ci_provider_release_bindings%rowtype;
begin
  if p_organization_id is null or p_actor_user_id is null or p_binding_id is null or p_idempotency_key is null
    or p_request_digest !~ '^[a-f0-9]{64}$' or char_length(btrim(coalesce(p_reason,''))) not between 1 and 500
    or p_expected_version is null or p_expected_version < 1
    or not public.m11_lock_connector_authorization(p_organization_id, p_actor_user_id,
      (select version from public.organization_permissions_version where organization_id=p_organization_id), true) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;

  select * into v_command from public.ci_provider_release_binding_commands c
  where c.organization_id = p_organization_id and c.actor_user_id = p_actor_user_id and c.idempotency_key = p_idempotency_key;
  if found then
    if v_command.request_digest = p_request_digest then
      return query select 'replayed'::text, v_command.result->'binding'; return;
    end if;
    return query select 'idempotency_mismatch'::text, null::jsonb; return;
  end if;

  select * into v_binding from public.ci_provider_release_bindings b
  where b.organization_id = p_organization_id and b.id = p_binding_id for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_binding.status = 'revoked' or v_binding.version <> p_expected_version then
    return query select 'conflict'::text, public.ci_provider_release_binding_json(p_organization_id, p_binding_id); return;
  end if;

  update public.ci_provider_release_bindings set status = 'revoked', version = version + 1,
    revoked_at = now(), revoked_by = p_actor_user_id, revoked_reason = btrim(p_reason)
  where organization_id = p_organization_id and id = p_binding_id;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'ci_provider_release_binding.revoked', 'ci_provider_release_binding', p_binding_id::text,
    jsonb_build_object('reason', btrim(p_reason)));
  insert into public.ci_provider_release_binding_commands(organization_id, actor_user_id, binding_id, operation, idempotency_key, request_digest, result)
  values (p_organization_id, p_actor_user_id, p_binding_id, 'revoke', p_idempotency_key, p_request_digest,
    jsonb_build_object('binding', public.ci_provider_release_binding_json(p_organization_id, p_binding_id)));
  return query select 'revoked'::text, public.ci_provider_release_binding_json(p_organization_id, p_binding_id);
end;
$$;

revoke all on function public.ci_provider_release_binding_json(uuid, uuid) from public, anon, authenticated;
revoke all on function public.upsert_ci_provider_release_binding_atomic(uuid, uuid, uuid, integer, integer, uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, uuid, bigint, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.revoke_ci_provider_release_binding_atomic(uuid, uuid, uuid, bigint, uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.ci_provider_release_binding_json(uuid, uuid),
  public.upsert_ci_provider_release_binding_atomic(uuid, uuid, uuid, integer, integer, uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, uuid, bigint, uuid, text),
  public.revoke_ci_provider_release_binding_atomic(uuid, uuid, uuid, bigint, uuid, text, text)
  to service_role;

-- Calling M3 from a wrapper keeps reservation, build identity and audit in one
-- transaction. A failed correlation cannot leave an active orphan baseline.
create function public.reserve_ci_build_sbom_atomic(
  p_organization_id uuid, p_credential_id uuid, p_binding_id uuid,
  p_run_id text, p_run_attempt text, p_provider_job_id text, p_ref text,
  p_commit_sha text, p_event_name text, p_repository_owner text,
  p_repository_name text, p_repository_id text, p_provider_installation_id text,
  p_project_key text, p_pipeline_definition_id text, p_source_id uuid,
  p_idempotency_key uuid, p_request_digest text, p_build_digest text,
  p_original_filename text, p_declared_media_type text, p_declared_byte_size bigint,
  p_declared_sha256 text, p_staging_storage_key text, p_upload_expires_at timestamptz,
  p_correlation_id uuid, p_declared_format text, p_declared_spec_version text,
  p_supersedes_source_id uuid
) returns table(outcome text, source jsonb, build_run_id uuid)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_binding public.ci_provider_release_bindings%rowtype;
  v_run public.ci_build_runs%rowtype; v_reservation record;
begin
  if p_organization_id is null or p_credential_id is null or p_binding_id is null
    or p_source_id is null or p_idempotency_key is null or p_correlation_id is null
    or p_build_digest !~ '^[a-f0-9]{64}$'
    or char_length(btrim(coalesce(p_run_id,''))) not between 1 and 200
    or (p_run_attempt is not null and char_length(btrim(p_run_attempt)) not between 1 and 80)
    or (p_provider_job_id is not null and char_length(btrim(p_provider_job_id)) not between 1 and 200)
    or char_length(btrim(coalesce(p_ref,''))) not between 1 and 500
    or p_commit_sha !~ '^[a-f0-9]{40}$'
    or p_event_name not in ('push','pull_request','merge_request','pipeline','build','release','manual') then
    return query select 'invalid_request'::text,null::jsonb,null::uuid; return;
  end if;
  select * into v_binding from public.ci_provider_release_bindings b
  where b.organization_id=p_organization_id and b.id=p_binding_id and b.credential_id=p_credential_id
    and b.status='active' for share;
  if not found or v_binding.allowed_ref is distinct from p_ref
    or v_binding.repository_id is distinct from p_repository_id
    or v_binding.provider_installation_id is distinct from p_provider_installation_id
    or v_binding.project_key is distinct from p_project_key
    or v_binding.pipeline_definition_id is distinct from p_pipeline_definition_id
    or not exists(select 1 from public.sbom_ci_credentials c where c.organization_id=p_organization_id
      and c.id=p_credential_id and c.status='active')
    or not exists(select 1 from public.connectors c where c.organization_id=p_organization_id
      and c.id=v_binding.connector_id and c.connector_type=v_binding.provider
      and c.enabled and c.archived_at is null and c.connection_config->>'providerHost'=v_binding.provider_host
      and c.connection_revision=v_binding.connection_revision and c.credential_revision=v_binding.credential_revision
      and c.secret_ref is not null and exists(select 1 from public.connector_secrets s
        where s.organization_id=p_organization_id and s.connector_id=c.id and s.id=c.secret_ref and s.revoked_at is null)
      and (v_binding.provider<>'github_actions' or c.connection_config->>'installationId'=v_binding.provider_installation_id)
      and (v_binding.provider<>'gitlab_ci' or c.connection_config->>'projectId'=v_binding.repository_id)
      and (v_binding.provider<>'azure_devops' or c.connection_config->>'projectId'=v_binding.project_key)) then
    return query select 'not_found'::text,null::jsonb,null::uuid; return;
  end if;
  select * into v_run from public.ci_build_runs r where r.organization_id=p_organization_id
    and r.provider=v_binding.provider and r.provider_host=v_binding.provider_host
    and r.repository_id=v_binding.repository_id and r.run_id=p_run_id
    and r.run_attempt is not distinct from p_run_attempt for update;
  if found then
    if v_run.binding_id=p_binding_id and v_run.credential_id=p_credential_id
      and v_run.idempotency_key=p_idempotency_key and v_run.request_digest=p_build_digest then
      return query select 'replayed'::text,public.sbom_source_json(p_organization_id,v_run.source_id),v_run.id; return;
    end if;
    return query select 'conflict'::text,null::jsonb,null::uuid; return;
  end if;
  select * into v_reservation from public.reserve_sbom_source_atomic(
    p_organization_id,v_binding.product_id,v_binding.release_id,null,p_credential_id,
    p_source_id,'ci_upload',p_idempotency_key,p_request_digest,p_original_filename,
    p_declared_media_type,p_declared_byte_size,p_declared_sha256,p_staging_storage_key,
    p_upload_expires_at,p_correlation_id,p_declared_format,p_declared_spec_version,p_supersedes_source_id);
  if v_reservation.outcome not in ('created','replayed') then
    return query select v_reservation.outcome,v_reservation.source,null::uuid; return;
  end if;
  if not exists(select 1 from public.sbom_sources s where s.organization_id=p_organization_id
    and s.id=(v_reservation.source->>'id')::uuid and s.actor_credential_id=p_credential_id
    and s.product_id=v_binding.product_id and s.release_id=v_binding.release_id and s.source_kind='ci_upload') then
    return query select 'conflict'::text,null::jsonb,null::uuid; return;
  end if;
  insert into public.ci_build_runs(
    organization_id,binding_id,credential_id,source_id,provider,provider_host,
    repository_owner,repository_name,repository_id,provider_installation_id,
    project_key,pipeline_definition_id,run_id,run_attempt,provider_job_id,ref,
    commit_sha,event_name,idempotency_key,request_digest
  ) values (
    p_organization_id,p_binding_id,p_credential_id,(v_reservation.source->>'id')::uuid,
    v_binding.provider,v_binding.provider_host,p_repository_owner,p_repository_name,
    v_binding.repository_id,v_binding.provider_installation_id,v_binding.project_key,
    v_binding.pipeline_definition_id,p_run_id,p_run_attempt,p_provider_job_id,p_ref,
    p_commit_sha,p_event_name,p_idempotency_key,p_build_digest
  ) returning * into v_run;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
  values(p_organization_id,null,'ci_build.sbom_reserved','ci_build_run',v_run.id::text,
    jsonb_build_object('bindingId',p_binding_id,'sourceId',v_run.source_id,'runId',p_run_id,
      'runAttempt',p_run_attempt,'correlationId',p_correlation_id));
  return query select case when v_reservation.outcome='created' then 'created' else 'replayed' end,
    v_reservation.source,v_run.id;
exception when unique_violation then
  return query select 'conflict'::text,null::jsonb,null::uuid;
end $$;

create function public.finalize_ci_build_sbom_atomic(
  p_organization_id uuid,p_credential_id uuid,p_binding_id uuid,p_run_id text,
  p_run_attempt text,p_source_id uuid,p_actual_sha256 text,p_actual_byte_size bigint,
  p_actual_media_type text,p_idempotency_key uuid,p_correlation_id uuid
) returns table(outcome text,source jsonb,job jsonb,build_run_id uuid)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_run public.ci_build_runs%rowtype; v_binding public.ci_provider_release_bindings%rowtype; v_completion record;
begin
  if p_organization_id is null or p_credential_id is null or p_binding_id is null
    or p_source_id is null or p_idempotency_key is null or p_correlation_id is null then
    return query select 'invalid_request'::text,null::jsonb,null::jsonb,null::uuid; return;
  end if;
  select * into v_binding from public.ci_provider_release_bindings b
  where b.organization_id=p_organization_id and b.id=p_binding_id and b.credential_id=p_credential_id
    and b.status='active' for share;
  if not found or not exists(select 1 from public.sbom_ci_credentials c where c.organization_id=p_organization_id
      and c.id=p_credential_id and c.status='active')
    or not exists(select 1 from public.connectors c where c.organization_id=p_organization_id
      and c.id=v_binding.connector_id and c.connector_type=v_binding.provider
      and c.enabled and c.archived_at is null and c.connection_config->>'providerHost'=v_binding.provider_host
      and c.connection_revision=v_binding.connection_revision and c.credential_revision=v_binding.credential_revision
      and c.secret_ref is not null and exists(select 1 from public.connector_secrets s
        where s.organization_id=p_organization_id and s.connector_id=c.id and s.id=c.secret_ref and s.revoked_at is null)
      and (v_binding.provider<>'github_actions' or c.connection_config->>'installationId'=v_binding.provider_installation_id)
      and (v_binding.provider<>'gitlab_ci' or c.connection_config->>'projectId'=v_binding.repository_id)
      and (v_binding.provider<>'azure_devops' or c.connection_config->>'projectId'=v_binding.project_key)) then
    return query select 'not_found'::text,null::jsonb,null::jsonb,null::uuid; return;
  end if;
  select * into v_run from public.ci_build_runs r where r.organization_id=p_organization_id
    and r.binding_id=p_binding_id and r.credential_id=p_credential_id
    and r.run_id=p_run_id and r.run_attempt is not distinct from p_run_attempt
    and r.source_id=p_source_id and r.idempotency_key=p_idempotency_key for update;
  if not found then return query select 'not_found'::text,null::jsonb,null::jsonb,null::uuid; return; end if;
  select * into v_completion from public.finalize_sbom_source_deduplicated_atomic(p_organization_id,p_source_id,null,
    p_credential_id,p_actual_sha256,p_actual_byte_size,p_actual_media_type,p_idempotency_key,p_correlation_id);
  if v_completion.outcome in ('queued','deduplicated','replayed') and v_completion.job is not null then
    update public.ci_build_runs set ingest_job_id=(v_completion.job->>'id')::uuid,completed_at=coalesce(completed_at,now())
      where organization_id=p_organization_id and id=v_run.id;
  end if;
  return query select v_completion.outcome,v_completion.source,v_completion.job,v_run.id;
end $$;

revoke all on function public.reserve_ci_build_sbom_atomic(uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,text,uuid,uuid,text,text,text,text,bigint,text,text,timestamptz,uuid,text,text,uuid),
  public.finalize_ci_build_sbom_atomic(uuid,uuid,uuid,text,text,uuid,text,bigint,text,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.reserve_ci_build_sbom_atomic(uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,text,uuid,uuid,text,text,text,text,bigint,text,text,timestamptz,uuid,text,text,uuid),
  public.finalize_ci_build_sbom_atomic(uuid,uuid,uuid,text,text,uuid,text,bigint,text,uuid,uuid)
  to service_role;

create function public.record_ci_provider_webhook_event_atomic(
  p_organization_id uuid,p_binding_id uuid,p_provider text,p_delivery_id text,
  p_body_sha256 text,p_run_id text,p_run_attempt text
) returns table(outcome text,event_id uuid)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_binding public.ci_provider_release_bindings%rowtype;
  v_event public.ci_provider_webhook_events%rowtype;
begin
  if p_organization_id is null or p_binding_id is null
    or p_provider not in ('github_actions','gitlab_ci')
    or char_length(btrim(coalesce(p_delivery_id,''))) not between 1 and 200
    or p_body_sha256 !~ '^[a-f0-9]{64}$'
    or char_length(btrim(coalesce(p_run_id,''))) not between 1 and 200
    or (p_run_attempt is not null and char_length(btrim(p_run_attempt)) not between 1 and 80) then
    return query select 'invalid_request'::text,null::uuid; return;
  end if;
  select * into v_binding from public.ci_provider_release_bindings b
  where b.organization_id=p_organization_id and b.id=p_binding_id and b.provider=p_provider
    and b.status='active' for share;
  if not found or not exists(select 1 from public.connectors c where c.organization_id=p_organization_id
    and c.id=v_binding.connector_id and c.enabled and c.archived_at is null
    and c.connector_type=p_provider and c.connection_revision=v_binding.connection_revision
    and c.credential_revision=v_binding.credential_revision) then
    return query select 'not_found'::text,null::uuid; return;
  end if;
  select * into v_event from public.ci_provider_webhook_events e
  where e.provider=p_provider and e.provider_host=v_binding.provider_host and e.delivery_id=p_delivery_id
  for update;
  if found then
    if v_event.organization_id=p_organization_id and v_event.binding_id=p_binding_id
      and v_event.body_sha256=p_body_sha256 and v_event.run_id=p_run_id
      and v_event.run_attempt is not distinct from p_run_attempt then
      return query select 'replayed'::text,v_event.id; return;
    end if;
    return query select 'conflict'::text,null::uuid; return;
  end if;
  insert into public.ci_provider_webhook_events(organization_id,binding_id,provider,provider_host,
    delivery_id,body_sha256,run_id,run_attempt)
  values(p_organization_id,p_binding_id,p_provider,v_binding.provider_host,p_delivery_id,p_body_sha256,
    p_run_id,p_run_attempt) returning * into v_event;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
  values(p_organization_id,null,'ci_provider.webhook_received','ci_provider_webhook_event',v_event.id::text,
    jsonb_build_object('bindingId',p_binding_id,'provider',p_provider,'runId',p_run_id));
  return query select 'recorded'::text,v_event.id;
exception when unique_violation then
  return query select 'conflict'::text,null::uuid;
end $$;
revoke all on function public.record_ci_provider_webhook_event_atomic(uuid,uuid,text,text,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.record_ci_provider_webhook_event_atomic(uuid,uuid,text,text,text,text,text)
  to service_role;

-- M11-04 connector command compatibility overrides. The original command
-- lifecycle and idempotency are preserved; only CI authorization/identity
-- guards and reconnect behavior differ.
create or replace function public.m11_execute_connector_command_atomic(
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
 if v_connector.connector_type<>'reference_conformance' and p_operation in ('configure','disconnect','reconnect')
  and not public.m11_lock_connector_authorization(p_organization_id,p_actor_user_id,p_permission_version,true) then
  return query select 'forbidden'::text,null::jsonb,null::jsonb; return; end if;
 select * into v_command from public.connector_commands where organization_id=p_organization_id and actor_user_id=p_actor_user_id and idempotency_key=p_idempotency_key;
 if found then
  if v_command.connector_id<>p_connector_id or v_command.operation<>p_operation or v_command.request_digest<>p_request_digest
    or v_command.request_digest_key_id<>p_request_digest_key_id then
   return query select 'idempotency_conflict'::text,null::jsonb,null::jsonb; return;
  end if;
  return query select 'replayed'::text,coalesce(v_command.result->'connector',public.m2_v2_connector_json(v_connector)),public.m11_connector_command_json(v_command); return;
 end if;
 if p_operation='configure' and v_connector.connector_type<>'reference_conformance'
  and v_payload->'connectionConfig' is distinct from v_connector.connection_config
  and exists(select 1 from public.ci_provider_release_bindings b where b.organization_id=p_organization_id
    and b.connector_id=p_connector_id and b.status='active') then
  return query select 'conflict'::text,public.m2_v2_connector_json(v_connector),null::jsonb; return; end if;
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
   or (v_connector.connector_type='reference_conformance' and v_payload->'connectionConfig' ? 'providerHost')
   or (v_connector.connector_type='github_actions' and not (v_payload->'connectionConfig' ? 'appId' and v_payload->'connectionConfig' ? 'installationId'))
   or (v_connector.connector_type='gitlab_ci' and (not (v_payload->'connectionConfig' ? 'projectId') or v_payload->'connectionConfig' ? 'appId' or v_payload->'connectionConfig' ? 'serviceConnectionId'))
   or (v_connector.connector_type='azure_devops' and not (v_payload->'connectionConfig' ? 'serviceConnectionId' and v_payload->'connectionConfig' ? 'organization'))
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
  if v_payload<>'{}'::jsonb or v_connector.secret_ref is null
   or (v_connector.connector_type='reference_conformance' and (v_connector.last_test_outcome is distinct from 'success'
     or v_connector.last_test_connection_revision is distinct from v_connector.connection_revision))
   or v_connector.scope_assessment->>'status'='missing'
   or not exists(select 1 from public.connector_secrets where organization_id=p_organization_id and connector_id=p_connector_id and id=v_connector.secret_ref and revoked_at is null) then
   return query select 'invalid_state'::text,null::jsonb,null::jsonb; return; end if;
  v_validated_scope:=v_connector.scope_assessment;
  update public.connectors set enabled=true,disabled_at=null,disabled_by=null where organization_id=p_organization_id and id=p_connector_id;
 end if;
 -- Every explicit security command invalidates old tests and outstanding plans.
 update public.connectors set version=version+1,connection_revision=greatest(connection_revision,v_connector.connection_revision+1),updated_by=p_actor_user_id,
 scope_assessment='{"status":"unknown","policyVersion":"unverified","grantedScopes":[],"missingScopes":[],"excessScopes":[]}'::jsonb
 where organization_id=p_organization_id and id=p_connector_id returning * into v_connector;
 if p_operation='reconnect' and v_connector.connector_type='reference_conformance' then
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
 v_connector.connection_revision,v_connector.credential_revision,p_permission_version,now(),now(),jsonb_build_object('version',v_connector.version,'connector',public.m2_v2_connector_json(v_connector))) returning * into v_command;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
 values(p_organization_id,p_actor_user_id,'connector.'||p_operation,'connector',p_connector_id::text,
 jsonb_build_object('commandId',v_command.id,'version',v_connector.version,'connectionRevision',v_connector.connection_revision));
 return query select 'updated'::text,coalesce(v_command.result->'connector',public.m2_v2_connector_json(v_connector)),public.m11_connector_command_json(v_command);
exception when invalid_text_representation or numeric_value_out_of_range or check_violation or invalid_parameter_value then
 return query select 'invalid_request'::text,null::jsonb,null::jsonb;
end $$;

create or replace function public.m11_begin_connector_test_atomic(
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
 if v_connector.connector_type<>'reference_conformance' then
  return query select 'invalid_state'::text,null::jsonb,null::jsonb; return; end if;
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
   coalesce(v_command.result->'connector',public.m2_v2_connector_json(v_connector)),public.m11_connector_command_json(v_command); return;
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
 return query select 'started'::text,coalesce(v_command.result->'connector',public.m2_v2_connector_json(v_connector)),public.m11_connector_command_json(v_command);
end $$;
