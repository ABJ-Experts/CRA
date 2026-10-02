
do $$
declare
  v_old_rows bigint := 0;
begin
  if to_regclass('public.vulnerability_remediation_ticket_bindings') is not null
    and not exists (select 1 from information_schema.columns where table_schema='public'
      and table_name='vulnerability_remediation_ticket_bindings' and column_name='site_host') then
    select coalesce((select count(*) from public.vulnerability_remediation_ticket_bindings),0)
      + coalesce((select count(*) from public.vulnerability_remediation_tickets),0)
      + coalesce((select count(*) from public.vulnerability_remediation_ticket_events),0)
      into v_old_rows;
    if v_old_rows > 0 then
      raise exception 'M11-05 draft remediation ticket schema contains % rows and cannot be auto-repaired without owner-supplied stable Jira cloud/site/product mapping', v_old_rows;
    end if;
    drop function if exists public.sync_vulnerability_remediation_ticket_atomic(uuid,uuid,uuid,uuid,integer,uuid,uuid);
    drop function if exists public.ingest_vulnerability_remediation_ticket_event_atomic(uuid,uuid,uuid,text,text,text,text,text,text,timestamp with time zone);
    drop function if exists public.upsert_vulnerability_remediation_ticket_binding_atomic(uuid,uuid,uuid,text,text,text,text,uuid,integer,uuid,uuid);
    drop table if exists public.vulnerability_remediation_ticket_events cascade;
    drop table if exists public.vulnerability_remediation_tickets cascade;
    drop table if exists public.vulnerability_remediation_ticket_bindings cascade;
  end if;
end $$;

-- CRA-M11-05 repair: transform old zero-row Jira remediation ticket draft schema to the canonical contract.
-- This migration is a no-op when the canonical 20260930153000 migration already created the final objects.

alter table public.connectors drop constraint if exists connectors_connector_type_check;
alter table public.connectors add constraint connectors_connector_type_check
  check (connector_type in ('reference_conformance', 'github_actions', 'gitlab_ci', 'azure_devops', 'jira'));

-- Remove unsafe draft RPCs if this branch was tested locally before the
-- verified reserve/finalize/event contract replaced them.
drop function if exists public.sync_vulnerability_remediation_ticket_atomic(uuid,uuid,uuid,uuid,integer,uuid,uuid);
drop function if exists public.ingest_vulnerability_remediation_ticket_event_atomic(uuid,uuid,uuid,text,text,text,text,text,text,timestamp with time zone);
drop function if exists public.upsert_vulnerability_remediation_ticket_binding_atomic(uuid,uuid,uuid,text,text,text,text,uuid,integer,uuid,uuid);
drop function if exists public.upsert_vulnerability_remediation_ticket_binding_atomic(uuid,uuid,uuid,uuid,text,text,text,text,text,uuid,integer,uuid,text);
drop function if exists public.upsert_vulnerability_remediation_ticket_binding_atomic(uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb,jsonb,uuid,integer,uuid,text);

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.m11_valid_connector_config(uuid,jsonb)'::regprocedure) into v_definition;
  v_definition := replace(v_definition,
      '    if v_host ~ ''^[a-z0-9-]+\.atlassian\.net$'' then
      return not exists(select 1 from jsonb_object_keys(p_config) k where k not in (''providerHost'',''siteId''))
        and (not (p_config ? ''siteId'') or char_length(p_config->>''siteId'') between 1 and 200);
    end if;',
      '    if v_host = ''api.atlassian.com'' then
      return p_config->>''providerHost'' = ''api.atlassian.com''
        and (p_config->>''cloudId'') ~ ''^[A-Fa-f0-9-]{36}$''
        and (p_config->>''siteHost'') ~ ''^[a-z0-9-]+\.atlassian\.net$''
        and not exists(select 1 from jsonb_object_keys(p_config) k where k not in (''providerHost'',''cloudId'',''siteHost''));
    end if;');
  if position('atlassian.net' in v_definition) = 0 then
    v_definition := replace(v_definition,
      '    return p_config->>''projectId'' ~ ''^[0-9]{1,20}$''
      and not exists(select 1 from jsonb_object_keys(p_config) k where k not in (''providerHost'',''projectId''));',
      '    if v_host = ''api.atlassian.com'' then
      return p_config->>''providerHost'' = ''api.atlassian.com''
        and (p_config->>''cloudId'') ~ ''^[A-Fa-f0-9-]{36}$''
        and (p_config->>''siteHost'') ~ ''^[a-z0-9-]+\.atlassian\.net$''
        and not exists(select 1 from jsonb_object_keys(p_config) k where k not in (''providerHost'',''cloudId'',''siteHost''));
    end if;
    return p_config->>''projectId'' ~ ''^[0-9]{1,20}$''
      and not exists(select 1 from jsonb_object_keys(p_config) k where k not in (''providerHost'',''projectId''));');
  end if;
  execute v_definition;
  select pg_get_functiondef('public.m11_valid_connector_config(uuid,jsonb)'::regprocedure) into v_definition;
  if position('api.atlassian.com' in v_definition) = 0
    or position('siteHost' in v_definition) = 0
    or position('''siteId''' in v_definition) > 0 then
    raise exception 'M11-05 Jira connector config patch did not apply';
  end if;

  select pg_get_functiondef('public.create_connector_atomic(uuid,uuid,uuid,text,text,text,text,jsonb,text)'::regprocedure) into v_definition;
  v_definition := replace(v_definition,
    'coalesce(p_connector_type, '''') not in (''reference_conformance'',''github_actions'',''gitlab_ci'',''azure_devops'')',
    'coalesce(p_connector_type, '''') not in (''reference_conformance'',''github_actions'',''gitlab_ci'',''azure_devops'',''jira'')');
  v_definition := replace(v_definition,
    'or (p_connector_type=''jira'' and coalesce(p_connection_config->>''providerHost'','''') !~ ''^[a-z0-9-]+\.atlassian\.net$'')',
    '');
  v_definition := replace(v_definition,
    'or (p_connector_type=''azure_devops'' and not (p_connection_config ? ''serviceConnectionId'' and p_connection_config ? ''organization''))',
    'or (p_connector_type=''azure_devops'' and not (p_connection_config ? ''serviceConnectionId'' and p_connection_config ? ''organization''))
    or (p_connector_type=''jira'' and (coalesce(p_connection_config->>''providerHost'','''') <> ''api.atlassian.com'' or coalesce(p_connection_config->>''cloudId'','''') !~ ''^[A-Fa-f0-9-]{36}$'' or coalesce(p_connection_config->>''siteHost'','''') !~ ''^[a-z0-9-]+\.atlassian\.net$''))');
  execute v_definition;
  select pg_get_functiondef('public.create_connector_atomic(uuid,uuid,uuid,text,text,text,text,jsonb,text)'::regprocedure) into v_definition;
  if position('''jira''' in v_definition) = 0 or position('api.atlassian.com' in v_definition) = 0 then
    raise exception 'M11-05 Jira create_connector patch did not apply';
  end if;

  select pg_get_functiondef('public.m11_create_connector_atomic(uuid,uuid,bigint,uuid,text,text,text,text,jsonb,text)'::regprocedure) into v_definition;
  v_definition := replace(v_definition,
    'p_connector_type in (''github_actions'',''gitlab_ci'',''azure_devops'')',
    'p_connector_type in (''github_actions'',''gitlab_ci'',''azure_devops'',''jira'')');
  execute v_definition;

  select pg_get_functiondef('public.m11_execute_connector_command_atomic(uuid,uuid,uuid,text,integer,uuid,text,text,bigint,jsonb)'::regprocedure) into v_definition;
  v_definition := replace(v_definition,
    'or (v_connector.connector_type=''azure_devops'' and not (v_payload->''connectionConfig'' ? ''serviceConnectionId'' and v_payload->''connectionConfig'' ? ''organization''))',
    'or (v_connector.connector_type=''azure_devops'' and not (v_payload->''connectionConfig'' ? ''serviceConnectionId'' and v_payload->''connectionConfig'' ? ''organization''))
   or (v_connector.connector_type=''jira'' and (coalesce(v_payload->''connectionConfig''->>''providerHost'','''') <> ''api.atlassian.com'' or coalesce(v_payload->''connectionConfig''->>''cloudId'','''') !~ ''^[A-Fa-f0-9-]{36}$'' or coalesce(v_payload->''connectionConfig''->>''siteHost'','''') !~ ''^[a-z0-9-]+\.atlassian\.net$''))');
  execute v_definition;
end $$;

create or replace function public.m11_05_valid_ticket_field_mapping(p_mapping jsonb)
returns boolean language sql immutable security definer set search_path = public, pg_temp as $$
  select jsonb_typeof(p_mapping) = 'object'
    and p_mapping = '{"summary":"cra","description":"cra","status":"jira"}'::jsonb
$$;

create or replace function public.m11_05_valid_status_transitions(p_transitions jsonb)
returns boolean language sql immutable security definer set search_path = public, pg_temp as $$
  select jsonb_typeof(p_transitions) = 'array'
    and jsonb_array_length(p_transitions) between 1 and 100
    and not exists (
      select 1
      from jsonb_array_elements(p_transitions) entries(value)
      where jsonb_typeof(value) <> 'object'
        or exists(select 1 from jsonb_object_keys(value) keys(key)
          where key not in ('fromStatusId','toStatusId','transitionId'))
        or char_length(btrim(coalesce(value->>'fromStatusId',''))) not between 1 and 120
        or char_length(btrim(coalesce(value->>'toStatusId',''))) not between 1 and 120
        or char_length(btrim(coalesce(value->>'transitionId',''))) not between 1 and 120
    )
    and not exists (
      select 1
      from jsonb_array_elements(p_transitions) entries(value)
      group by value->>'fromStatusId', value->>'toStatusId'
      having count(*) > 1
    )
$$;

create or replace function public.m11_05_valid_status_mappings(p_mappings jsonb)
returns boolean language sql immutable security definer set search_path = public, pg_temp as $$
  select jsonb_typeof(p_mappings) = 'array'
    and jsonb_array_length(p_mappings) between 1 and 100
    and not exists (
      select 1
      from jsonb_array_elements(p_mappings) entries(value)
      where jsonb_typeof(value) <> 'object'
        or exists(select 1 from jsonb_object_keys(value) keys(key)
          where key not in ('statusId','workState'))
        or char_length(btrim(coalesce(value->>'statusId',''))) not between 1 and 120
        or coalesce(value->>'workState','') not in ('open','in_progress','closed')
    )
    and not exists (
      select 1
      from jsonb_array_elements(p_mappings) entries(value)
      group by value->>'statusId'
      having count(*) > 1
    )
$$;

create or replace function public.m11_05_valid_custom_field_mappings(p_mappings jsonb)
returns boolean language sql immutable security definer set search_path = public, pg_temp as $$
  select jsonb_typeof(p_mappings) = 'array'
    and jsonb_array_length(p_mappings) between 0 and 25
    and not exists (
      select 1
      from jsonb_array_elements(p_mappings) entries(value)
      where jsonb_typeof(value) <> 'object'
        or exists(select 1 from jsonb_object_keys(value) keys(key)
          where key not in ('fieldId','source'))
        or coalesce(value->>'fieldId','') !~ '^customfield_[0-9]+$'
        or coalesce(value->>'source','') not in ('finding_id','severity','advisory_id')
    )
    and not exists (
      select 1
      from jsonb_array_elements(p_mappings) entries(value)
      group by value->>'fieldId'
      having count(*) > 1
    )
$$;

create table if not exists public.vulnerability_remediation_ticket_bindings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connector_id uuid not null,
  product_id uuid not null,
  provider text not null check (provider in ('jira')),
  provider_host text not null check (provider_host = 'api.atlassian.com'),
  provider_cloud_id text not null check (provider_cloud_id ~ '^[A-Fa-f0-9-]{36}$'),
  site_host text not null check (site_host ~ '^[a-z0-9-]+\.atlassian\.net$'),
  project_id text not null check (char_length(btrim(project_id)) between 1 and 120),
  project_key text not null check (project_key ~ '^[A-Z][A-Z0-9_]{1,20}$'),
  issue_type_id text not null check (char_length(btrim(issue_type_id)) between 1 and 120),
  field_mapping jsonb not null check (public.m11_05_valid_ticket_field_mapping(field_mapping)),
  custom_field_mappings jsonb not null default '[]'::jsonb check (public.m11_05_valid_custom_field_mappings(custom_field_mappings)),
  status_transitions jsonb not null check (public.m11_05_valid_status_transitions(status_transitions)),
  status_mappings jsonb not null check (public.m11_05_valid_status_mappings(status_mappings)),
  external_base_url text not null check (external_base_url ~ '^https://[a-z0-9-]+\.atlassian\.net$'),
  status text not null default 'active' check (status in ('active','revoked')),
  version integer not null default 1 check (version > 0),
  created_by uuid not null references public.users(id) on delete restrict,
  updated_by uuid not null references public.users(id) on delete restrict,
  revoked_by uuid references public.users(id) on delete restrict,
  revoked_reason text check (revoked_reason is null or char_length(btrim(revoked_reason)) between 1 and 500),
  revoked_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id),
  foreign key (organization_id, connector_id) references public.connectors(organization_id, id) on delete restrict,
  foreign key (organization_id, product_id) references public.products(organization_id, id) on delete restrict,
  check ((revoked_at is null and revoked_by is null and revoked_reason is null)
    or (revoked_at is not null and revoked_by is not null and revoked_reason is not null))
);

create unique index if not exists vulnerability_remediation_ticket_bindings_active_scope_idx
  on public.vulnerability_remediation_ticket_bindings(
    organization_id, provider, provider_host, provider_cloud_id, project_id, issue_type_id, product_id
  ) where status = 'active';
create index if not exists vulnerability_remediation_ticket_bindings_connector_idx
  on public.vulnerability_remediation_ticket_bindings(organization_id, connector_id, status);

create table if not exists public.vulnerability_remediation_ticket_status_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  binding_id uuid not null,
  external_status_id text not null check (char_length(btrim(external_status_id)) between 1 and 120),
  external_status_name text not null check (char_length(btrim(external_status_name)) between 1 and 200),
  mapped_status text not null check (mapped_status in ('linked','external_closed_pending_review','conflict','deleted_or_moved')),
  external_is_closed boolean not null default false,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id),
  unique (organization_id, binding_id, external_status_id),
  foreign key (organization_id, binding_id)
    references public.vulnerability_remediation_ticket_bindings(organization_id, id) on delete cascade,
  check ((mapped_status = 'external_closed_pending_review') = external_is_closed)
);

create table if not exists public.vulnerability_remediation_tickets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  finding_id uuid not null,
  binding_id uuid not null,
  provider text not null check (provider in ('jira')),
  external_issue_id text check (external_issue_id is null or char_length(btrim(external_issue_id)) between 1 and 200),
  external_issue_key text check (external_issue_key is null or char_length(btrim(external_issue_key)) between 1 and 200),
  external_url text check (external_url is null or external_url ~ '^https://'),
  external_status_id text check (external_status_id is null or char_length(btrim(external_status_id)) between 1 and 120),
  external_status_name text check (external_status_name is null or char_length(btrim(external_status_name)) between 1 and 200),
  provider_project_id text check (provider_project_id is null or char_length(btrim(provider_project_id)) between 1 and 120),
  correlation_id uuid not null default gen_random_uuid(),
  status text not null check (status in (
    'sync_pending','linked','sync_error','external_closed_pending_review','conflict','deleted_or_moved'
  )),
  sync_revision integer not null default 0 check (sync_revision >= 0),
  last_sync_direction text not null check (last_sync_direction in ('outbound','inbound','reconcile')),
  last_sync_at timestamptz not null default clock_timestamp(),
  last_provider_event_at timestamptz,
  last_inbound_delivery_id text check (last_inbound_delivery_id is null or char_length(btrim(last_inbound_delivery_id)) between 1 and 300),
  conflict_reason text check (conflict_reason is null or char_length(btrim(conflict_reason)) between 1 and 500),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id),
  unique (organization_id, binding_id, finding_id),
  foreign key (organization_id, finding_id)
    references public.vulnerability_findings(organization_id, id) on delete cascade,
  foreign key (organization_id, binding_id)
    references public.vulnerability_remediation_ticket_bindings(organization_id, id) on delete restrict,
  check ((external_issue_id is null and external_issue_key is null and external_url is null)
    or (external_issue_id is not null and external_issue_key is not null and external_url is not null))
);

create unique index if not exists vulnerability_remediation_tickets_external_id_idx
  on public.vulnerability_remediation_tickets(organization_id, provider, external_issue_id)
  where external_issue_id is not null;
create unique index if not exists vulnerability_remediation_tickets_external_key_idx
  on public.vulnerability_remediation_tickets(organization_id, provider, external_issue_key)
  where external_issue_key is not null;
create index if not exists vulnerability_remediation_tickets_finding_idx
  on public.vulnerability_remediation_tickets(organization_id, finding_id, updated_at desc);

create table if not exists public.vulnerability_remediation_ticket_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references public.users(id) on delete restrict,
  ticket_id uuid,
  binding_id uuid not null,
  finding_id uuid not null,
  operation text not null check (operation in ('reserve_outbound','finalize_outbound')),
  idempotency_key uuid not null,
  context_digest text not null check (context_digest ~ '^[a-f0-9]{64}$'),
  state text not null check (state in ('reserved','completed','conflict')),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object' and octet_length(result::text) <= 20000),
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  unique (organization_id, actor_user_id, idempotency_key),
  foreign key (organization_id, ticket_id) references public.vulnerability_remediation_tickets(organization_id, id) on delete restrict,
  foreign key (organization_id, binding_id) references public.vulnerability_remediation_ticket_bindings(organization_id, id) on delete restrict,
  foreign key (organization_id, finding_id) references public.vulnerability_findings(organization_id, id) on delete cascade
);

create table if not exists public.vulnerability_remediation_ticket_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  binding_id uuid not null,
  ticket_id uuid,
  provider text not null check (provider in ('jira')),
  delivery_id text not null check (char_length(btrim(delivery_id)) between 1 and 300),
  external_issue_id text not null check (char_length(btrim(external_issue_id)) between 1 and 200),
  external_issue_key text not null check (char_length(btrim(external_issue_key)) between 1 and 200),
  external_status_id text not null check (char_length(btrim(external_status_id)) between 1 and 120),
  external_status_name text not null check (char_length(btrim(external_status_name)) between 1 and 200),
  provider_project_id text not null check (char_length(btrim(provider_project_id)) between 1 and 120),
  provider_updated_at timestamptz not null,
  processed_at timestamptz not null default clock_timestamp(),
  outcome text not null check (outcome in ('processed','duplicate','unbound','stale','unknown_status')),
  unique (provider, delivery_id),
  foreign key (organization_id, binding_id)
    references public.vulnerability_remediation_ticket_bindings(organization_id, id) on delete restrict,
  foreign key (organization_id, ticket_id)
    references public.vulnerability_remediation_tickets(organization_id, id) on delete set null
);

alter table public.vulnerability_remediation_ticket_bindings enable row level security;
alter table public.vulnerability_remediation_ticket_status_mappings enable row level security;
alter table public.vulnerability_remediation_tickets enable row level security;
alter table public.vulnerability_remediation_ticket_operations enable row level security;
alter table public.vulnerability_remediation_ticket_events enable row level security;
revoke all on table public.vulnerability_remediation_ticket_bindings,
  public.vulnerability_remediation_ticket_status_mappings,
  public.vulnerability_remediation_tickets,
  public.vulnerability_remediation_ticket_operations,
  public.vulnerability_remediation_ticket_events from public, anon, authenticated, service_role;
grant select on table public.vulnerability_remediation_ticket_bindings,
  public.vulnerability_remediation_ticket_status_mappings,
  public.vulnerability_remediation_tickets,
  public.vulnerability_remediation_ticket_operations,
  public.vulnerability_remediation_ticket_events to service_role;

drop trigger if exists set_vulnerability_remediation_ticket_bindings_updated_at
  on public.vulnerability_remediation_ticket_bindings;
create trigger set_vulnerability_remediation_ticket_bindings_updated_at
  before update on public.vulnerability_remediation_ticket_bindings
  for each row execute function public.set_updated_at();
drop trigger if exists set_vulnerability_remediation_tickets_updated_at
  on public.vulnerability_remediation_tickets;
create trigger set_vulnerability_remediation_tickets_updated_at
  before update on public.vulnerability_remediation_tickets
  for each row execute function public.set_updated_at();

insert into public.organization_export_source_tables(
  source_id, table_name, tenant_key_column, record_order_column, table_sort
) values
  ('vulnerability_triage_operational', 'vulnerability_remediation_ticket_bindings', 'organization_id', 'id', 30),
  ('vulnerability_triage_operational', 'vulnerability_remediation_ticket_status_mappings', 'organization_id', 'id', 31),
  ('vulnerability_triage_operational', 'vulnerability_remediation_tickets', 'organization_id', 'id', 32),
  ('vulnerability_triage_operational', 'vulnerability_remediation_ticket_operations', 'organization_id', 'id', 33),
  ('vulnerability_triage_operational', 'vulnerability_remediation_ticket_events', 'organization_id', 'id', 34)
on conflict (source_id, table_name) do update set
  tenant_key_column = excluded.tenant_key_column,
  record_order_column = excluded.record_order_column,
  table_sort = excluded.table_sort;

alter table public.vulnerability_triage_commands
  drop constraint if exists vulnerability_triage_commands_operation_check,
  add constraint vulnerability_triage_commands_operation_check check
    (operation in (
      'assign', 'suppress', 'set_sla_policy', 'record_remediation_anchor',
      'create_vex_export_snapshot', 'configure_vex_publication_target',
      'queue_vex_publication', 'retry_vex_publication', 'withdraw_vex_publication',
      'note_create', 'note_update', 'note_delete',
      'create_reporting_obligation', 'correct_reporting_anchor',
      'record_reporting_submission', 'cancel_reporting_obligation',
      'create_reporting_rehearsal', 'replay_reporting_rehearsal',
      'upsert_remediation_ticket_binding'
    ));

create or replace function public.m11_05_actor_is_owner(
  p_organization_id uuid, p_actor_user_id uuid
) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.organization_members members
    join public.users users on users.id = members.user_id and users.is_active
    join public.organizations organizations on organizations.id = members.organization_id and organizations.is_active
    where members.organization_id = p_organization_id
      and members.user_id = p_actor_user_id
      and members.role = 'owner'
  )
$$;

create or replace function public.m11_05_ticket_binding_json(
  p_organization_id uuid, p_binding_id uuid
) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', b.id, 'organizationId', b.organization_id, 'connectorId', b.connector_id,
    'productId', b.product_id, 'provider', b.provider, 'providerHost', b.provider_host,
    'providerCloudId', b.provider_cloud_id, 'siteHost', b.site_host, 'projectId', b.project_id, 'projectKey', b.project_key,
    'issueTypeId', b.issue_type_id, 'fieldMapping', b.field_mapping,
    'customFieldMappings', b.custom_field_mappings, 'statusTransitions', b.status_transitions,
    'statusMappings', b.status_mappings, 'externalBaseUrl', b.external_base_url,
    'status', b.status, 'version', b.version,
    'createdAt', public.m2_utc_z(b.created_at), 'updatedAt', public.m2_utc_z(b.updated_at)
  )
  from public.vulnerability_remediation_ticket_bindings b
  where b.organization_id = p_organization_id and b.id = p_binding_id
$$;

create or replace function public.m11_05_ticket_json(
  p_organization_id uuid, p_ticket_id uuid
) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', t.id, 'organizationId', t.organization_id, 'findingId', t.finding_id,
    'bindingId', t.binding_id, 'provider', t.provider,
    'externalIssueId', t.external_issue_id, 'externalIssueKey', t.external_issue_key,
    'externalUrl', t.external_url, 'externalStatusId', t.external_status_id,
    'externalStatusName', t.external_status_name, 'providerProjectId', t.provider_project_id,
    'correlationId', t.correlation_id, 'status', t.status, 'syncRevision', t.sync_revision,
    'lastSyncDirection', t.last_sync_direction, 'lastSyncAt', public.m2_utc_z(t.last_sync_at),
    'lastProviderEventAt', case when t.last_provider_event_at is null then null else public.m2_utc_z(t.last_provider_event_at) end,
    'lastInboundDeliveryId', t.last_inbound_delivery_id,
    'conflictReason', t.conflict_reason, 'version', t.version,
    'createdAt', public.m2_utc_z(t.created_at), 'updatedAt', public.m2_utc_z(t.updated_at)
  )
  from public.vulnerability_remediation_tickets t
  where t.organization_id = p_organization_id and t.id = p_ticket_id
$$;

create or replace function public.m11_05_ticket_status(
  p_organization_id uuid, p_binding_id uuid, p_external_status_id text, p_external_status_name text
) returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_status text;
begin
  select case mapping.value->>'workState'
    when 'closed' then 'external_closed_pending_review'
    when 'open' then 'linked'
    when 'in_progress' then 'linked'
    else 'conflict' end into v_status
  from public.vulnerability_remediation_ticket_bindings b
  cross join lateral jsonb_array_elements(b.status_mappings) mapping(value)
  where b.organization_id = p_organization_id and b.id = p_binding_id
    and mapping.value->>'statusId' = btrim(p_external_status_id);
  return coalesce(v_status, 'conflict');
end;
$$;

create or replace function public.list_finding_remediation_tickets(
  p_organization_id uuid, p_actor_user_id uuid, p_finding_id uuid
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.m5_triage_active_member(p_organization_id, p_actor_user_id)
    or not exists (select 1 from public.vulnerability_findings findings
      where findings.organization_id = p_organization_id and findings.id = p_finding_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  return query select 'found'::text, jsonb_build_object(
    'bindings', coalesce((
      select jsonb_agg(public.m11_05_ticket_binding_json(p_organization_id, b.id) order by b.updated_at desc)
      from public.vulnerability_remediation_ticket_bindings b
      join public.vulnerability_findings f on f.organization_id = b.organization_id
        and f.id = p_finding_id
      join public.product_releases r on r.organization_id = f.organization_id
        and r.id = f.release_id and r.product_id = b.product_id
      where b.organization_id = p_organization_id and b.status = 'active'
    ), '[]'::jsonb),
    'tickets', coalesce((
      select jsonb_agg(public.m11_05_ticket_json(p_organization_id, t.id) order by t.updated_at desc)
      from public.vulnerability_remediation_tickets t
      where t.organization_id = p_organization_id and t.finding_id = p_finding_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.upsert_vulnerability_remediation_ticket_binding_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_connector_id uuid,
  p_product_id uuid,
  p_provider_cloud_id text,
  p_project_id text,
  p_project_key text,
  p_issue_type_id text,
  p_field_mapping jsonb,
  p_custom_field_mappings jsonb,
  p_status_transitions jsonb,
  p_status_mappings jsonb,
  p_expected_binding_id uuid,
  p_expected_version integer,
  p_idempotency_key uuid,
  p_context_digest text
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_connector public.connectors%rowtype;
  v_binding public.vulnerability_remediation_ticket_bindings%rowtype;
  v_existing record;
  v_digest text;
  v_now timestamptz := clock_timestamp();
begin
  if p_idempotency_key is null or p_context_digest !~ '^[a-f0-9]{64}$'
    or coalesce(p_provider_cloud_id,'') !~ '^[A-Fa-f0-9-]{36}$'
    or char_length(btrim(coalesce(p_project_id,''))) not between 1 and 120
    or p_project_key !~ '^[A-Z][A-Z0-9_]{1,20}$'
    or char_length(btrim(coalesce(p_issue_type_id,''))) not between 1 and 120
    or not public.m11_05_valid_ticket_field_mapping(p_field_mapping)
    or not public.m11_05_valid_custom_field_mappings(p_custom_field_mappings)
    or not public.m11_05_valid_status_transitions(p_status_transitions)
    or not public.m11_05_valid_status_mappings(p_status_mappings)
    or ((p_expected_binding_id is null) <> (p_expected_version is null)) then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  if not public.m11_05_actor_is_owner(p_organization_id, p_actor_user_id) then
    return query select 'forbidden'::text, null::jsonb; return;
  end if;
  v_digest := encode(extensions.digest(jsonb_build_object(
    'connectorId', p_connector_id, 'productId', p_product_id, 'providerHost', 'api.atlassian.com',
    'providerCloudId', btrim(p_provider_cloud_id), 'projectId', btrim(p_project_id),
    'projectKey', btrim(p_project_key), 'issueTypeId', btrim(p_issue_type_id),
    'fieldMapping', p_field_mapping, 'customFieldMappings', p_custom_field_mappings,
    'statusTransitions', p_status_transitions, 'statusMappings', p_status_mappings,
    'expectedBindingId', p_expected_binding_id, 'expectedVersion', p_expected_version,
    'contextDigest', p_context_digest
  )::text, 'sha256'), 'hex');
  select * into v_existing from public.m5_triage_command_result(
    p_organization_id, p_actor_user_id, p_idempotency_key, 'upsert_remediation_ticket_binding', v_digest);
  if found then return query select v_existing.outcome, v_existing.result; return; end if;

  select * into v_connector from public.connectors
  where organization_id = p_organization_id and id = p_connector_id and connector_type = 'jira'
    and enabled and archived_at is null and secret_ref is not null
    and connection_config->>'providerHost' = 'api.atlassian.com'
    and connection_config->>'cloudId' = btrim(p_provider_cloud_id)
    and connection_config->>'siteHost' ~ '^[a-z0-9-]+\.atlassian\.net$'
  for share;
  if not found
    or not exists(select 1 from public.connector_secrets s where s.organization_id = p_organization_id
      and s.connector_id = p_connector_id and s.id = v_connector.secret_ref and s.revoked_at is null)
    or not exists(select 1 from public.products p where p.organization_id = p_organization_id
      and p.id = p_product_id and p.archived_at is null) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;

  if p_expected_binding_id is not null then
    select * into v_binding from public.vulnerability_remediation_ticket_bindings
    where organization_id = p_organization_id and id = p_expected_binding_id and status = 'active'
    for update;
    if not found then return query select 'not_found'::text, null::jsonb; return; end if;
    if v_binding.version <> p_expected_version or v_binding.product_id <> p_product_id then
      return query select 'conflict'::text, jsonb_build_object('binding', public.m11_05_ticket_binding_json(p_organization_id, v_binding.id));
      return;
    end if;
    if exists (select 1 from public.vulnerability_remediation_tickets t
      where t.organization_id = p_organization_id and t.binding_id = v_binding.id)
      and (v_binding.connector_id <> p_connector_id
        or v_binding.provider_cloud_id <> btrim(p_provider_cloud_id)
        or v_binding.project_id <> btrim(p_project_id)
        or v_binding.issue_type_id <> btrim(p_issue_type_id)) then
      return query select 'conflict'::text, jsonb_build_object('binding', public.m11_05_ticket_binding_json(p_organization_id, v_binding.id));
      return;
    end if;
    update public.vulnerability_remediation_ticket_bindings
    set connector_id = p_connector_id,
      provider_host = 'api.atlassian.com',
      provider_cloud_id = btrim(p_provider_cloud_id),
      site_host = v_connector.connection_config->>'siteHost',
      project_id = btrim(p_project_id),
      project_key = btrim(p_project_key),
      issue_type_id = btrim(p_issue_type_id),
      field_mapping = p_field_mapping,
      custom_field_mappings = p_custom_field_mappings,
      status_transitions = p_status_transitions,
      status_mappings = p_status_mappings,
      external_base_url = 'https://' || (v_connector.connection_config->>'siteHost'),
      version = version + 1,
      updated_by = p_actor_user_id,
      updated_at = v_now
    where organization_id = p_organization_id and id = p_expected_binding_id
    returning * into v_binding;
  else
    insert into public.vulnerability_remediation_ticket_bindings(
      organization_id, connector_id, product_id, provider, provider_host, provider_cloud_id, site_host,
      project_id, project_key, issue_type_id, field_mapping, custom_field_mappings, status_transitions, status_mappings, external_base_url, created_by, updated_by, created_at, updated_at
    ) values (
      p_organization_id, p_connector_id, p_product_id, 'jira', 'api.atlassian.com', btrim(p_provider_cloud_id), v_connector.connection_config->>'siteHost',
      btrim(p_project_id), btrim(p_project_key), btrim(p_issue_type_id), p_field_mapping, p_custom_field_mappings, p_status_transitions, p_status_mappings, 'https://' || (v_connector.connection_config->>'siteHost'),
      p_actor_user_id, p_actor_user_id, v_now, v_now
    )
    returning * into v_binding;
  end if;

  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'vulnerability.remediation_ticket_binding_upserted',
    'vulnerability_remediation_ticket_binding', v_binding.id::text,
    jsonb_build_object('connectorId', p_connector_id, 'productId', p_product_id,
      'idempotencyKey', p_idempotency_key, 'contextDigest', p_context_digest));
  insert into public.vulnerability_triage_commands(organization_id, actor_user_id, idempotency_key, operation, request_digest, result)
  values (p_organization_id, p_actor_user_id, p_idempotency_key, 'upsert_remediation_ticket_binding', v_digest,
    jsonb_build_object('binding', public.m11_05_ticket_binding_json(p_organization_id, v_binding.id)));
  return query select 'upserted'::text, jsonb_build_object('binding', public.m11_05_ticket_binding_json(p_organization_id, v_binding.id));
exception when unique_violation then
  return query select 'conflict'::text, null::jsonb;
end;
$$;

create or replace function public.reserve_vulnerability_remediation_ticket_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_finding_id uuid,
  p_binding_id uuid,
  p_expected_version integer,
  p_idempotency_key uuid,
  p_context_digest text
) returns table(outcome text, ticket_id uuid, operation_id uuid, correlation_id uuid, ticket jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_binding public.vulnerability_remediation_ticket_bindings%rowtype;
  v_ticket public.vulnerability_remediation_tickets%rowtype;
  v_operation public.vulnerability_remediation_ticket_operations%rowtype;
  v_product_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  if p_idempotency_key is null or p_context_digest !~ '^[a-f0-9]{64}$'
    or p_expected_version is null or p_expected_version < 0 then
    return query select 'invalid_request'::text, null::uuid, null::uuid, null::uuid, null::jsonb; return;
  end if;
  if not public.m5_triage_actor_can_edit_findings(p_organization_id, p_actor_user_id) then
    return query select 'forbidden'::text, null::uuid, null::uuid, null::uuid, null::jsonb; return;
  end if;
  select r.product_id into v_product_id
  from public.vulnerability_findings f
  join public.product_releases r on r.organization_id = f.organization_id and r.id = f.release_id
  where f.organization_id = p_organization_id and f.id = p_finding_id and f.status = 'active'
  for share;
  if not found then return query select 'not_found'::text, null::uuid, null::uuid, null::uuid, null::jsonb; return; end if;
  select * into v_binding from public.vulnerability_remediation_ticket_bindings
  where organization_id = p_organization_id and id = p_binding_id and status = 'active' and product_id = v_product_id
  for share;
  if not found then return query select 'not_found'::text, null::uuid, null::uuid, null::uuid, null::jsonb; return; end if;

  select * into v_operation from public.vulnerability_remediation_ticket_operations
  where organization_id = p_organization_id and actor_user_id = p_actor_user_id and idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_operation.context_digest <> p_context_digest then
      return query select 'idempotency_mismatch'::text, null::uuid, v_operation.id, v_operation.correlation_id, null::jsonb; return;
    end if;
    return query select 'replayed'::text, v_operation.ticket_id, v_operation.id, v_operation.correlation_id,
      case when v_operation.ticket_id is null then null else public.m11_05_ticket_json(p_organization_id, v_operation.ticket_id) end;
    return;
  end if;

  select * into v_ticket from public.vulnerability_remediation_tickets
  where organization_id = p_organization_id and binding_id = p_binding_id and finding_id = p_finding_id
  for update;
  if found then
    if v_ticket.version <> p_expected_version then
      return query select 'conflict'::text, v_ticket.id, null::uuid, null::uuid, public.m11_05_ticket_json(p_organization_id, v_ticket.id);
      return;
    end if;
    update public.vulnerability_remediation_tickets
    set status = 'sync_pending', last_sync_direction = 'outbound', last_sync_at = v_now,
      sync_revision = sync_revision + 1, version = version + 1, conflict_reason = null,
      updated_at = v_now
    where organization_id = p_organization_id and id = v_ticket.id
    returning * into v_ticket;
  else
    if p_expected_version <> 0 then
      return query select 'conflict'::text, null::uuid, null::uuid, null::uuid, null::jsonb; return;
    end if;
    insert into public.vulnerability_remediation_tickets(
      organization_id, finding_id, binding_id, provider, status, sync_revision,
      last_sync_direction, last_sync_at, created_at, updated_at
    ) values (
      p_organization_id, p_finding_id, p_binding_id, v_binding.provider, 'sync_pending',
      1, 'outbound', v_now, v_now, v_now
    ) returning * into v_ticket;
  end if;

  insert into public.vulnerability_remediation_ticket_operations(
    organization_id, actor_user_id, ticket_id, binding_id, finding_id, operation,
    idempotency_key, context_digest, state, result, correlation_id
  ) values (
    p_organization_id, p_actor_user_id, v_ticket.id, p_binding_id, p_finding_id, 'reserve_outbound',
    p_idempotency_key, p_context_digest, 'reserved',
    jsonb_build_object('ticket', public.m11_05_ticket_json(p_organization_id, v_ticket.id)),
    v_ticket.correlation_id
  ) returning * into v_operation;

  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'vulnerability.remediation_ticket_sync_reserved',
    'vulnerability_remediation_ticket', v_ticket.id::text,
    jsonb_build_object('bindingId', p_binding_id, 'operationId', v_operation.id,
      'idempotencyKey', p_idempotency_key, 'contextDigest', p_context_digest));
  return query select 'reserved'::text, v_ticket.id, v_operation.id, v_operation.correlation_id,
    public.m11_05_ticket_json(p_organization_id, v_ticket.id);
exception when unique_violation then
  return query select 'conflict'::text, null::uuid, null::uuid, null::uuid, null::jsonb;
end;
$$;

create or replace function public.finalize_vulnerability_remediation_ticket_atomic(
  p_organization_id uuid,
  p_ticket_id uuid,
  p_operation_id uuid,
  p_external_issue_id text,
  p_external_issue_key text,
  p_external_status_id text,
  p_external_status_name text,
  p_provider_project_id text,
  p_provider_updated_at timestamptz
) returns table(outcome text, ticket jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ticket public.vulnerability_remediation_tickets%rowtype;
  v_binding public.vulnerability_remediation_ticket_bindings%rowtype;
  v_operation public.vulnerability_remediation_ticket_operations%rowtype;
  v_status text;
  v_now timestamptz := clock_timestamp();
begin
  if p_ticket_id is null or p_operation_id is null
    or char_length(btrim(coalesce(p_external_issue_id,''))) not between 1 and 200
    or char_length(btrim(coalesce(p_external_issue_key,''))) not between 1 and 200
    or char_length(btrim(coalesce(p_external_status_id,''))) not between 1 and 120
    or char_length(btrim(coalesce(p_external_status_name,''))) not between 1 and 200
    or char_length(btrim(coalesce(p_provider_project_id,''))) not between 1 and 120
    or p_provider_updated_at is null then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  select * into v_operation from public.vulnerability_remediation_ticket_operations
  where organization_id = p_organization_id and id = p_operation_id and ticket_id = p_ticket_id
  for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_operation.state = 'completed' then
    select * into v_ticket from public.vulnerability_remediation_tickets
    where organization_id = p_organization_id and id = p_ticket_id;
    if not found or v_ticket.external_issue_id <> btrim(p_external_issue_id)
      or v_ticket.external_issue_key <> btrim(p_external_issue_key)
      or v_ticket.provider_project_id <> btrim(p_provider_project_id) then
      return query select 'conflict'::text, null::jsonb; return;
    end if;
    return query select 'replayed'::text, public.m11_05_ticket_json(p_organization_id, p_ticket_id); return;
  end if;
  if v_operation.state <> 'reserved' then
    return query select 'conflict'::text, null::jsonb; return;
  end if;
  select * into v_ticket from public.vulnerability_remediation_tickets
  where organization_id = p_organization_id and id = p_ticket_id
  for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  select * into v_binding from public.vulnerability_remediation_ticket_bindings
  where organization_id = p_organization_id and id = v_ticket.binding_id and status = 'active'
  for share;
  if not found or v_binding.project_id <> btrim(p_provider_project_id)
    or not exists(select 1 from public.connectors c join public.connector_secrets s
      on s.organization_id = c.organization_id and s.connector_id = c.id and s.id = c.secret_ref and s.revoked_at is null
      where c.organization_id = p_organization_id and c.id = v_binding.connector_id
        and c.connector_type = 'jira' and c.enabled and c.archived_at is null
        and c.connection_config->>'providerHost' = 'api.atlassian.com'
        and c.connection_config->>'cloudId' = v_binding.provider_cloud_id
        and c.connection_config->>'siteHost' = v_binding.site_host) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  if exists (select 1 from public.vulnerability_remediation_tickets other
    where other.organization_id = p_organization_id and other.id <> p_ticket_id
      and other.provider = v_ticket.provider
      and (other.external_issue_id = btrim(p_external_issue_id)
        or other.external_issue_key = btrim(p_external_issue_key))) then
    return query select 'conflict'::text, public.m11_05_ticket_json(p_organization_id, p_ticket_id); return;
  end if;
  v_status := public.m11_05_ticket_status(p_organization_id, v_binding.id, p_external_status_id, p_external_status_name);
  update public.vulnerability_remediation_tickets
  set external_issue_id = btrim(p_external_issue_id),
    external_issue_key = btrim(p_external_issue_key),
    external_url = v_binding.external_base_url || '/browse/' || btrim(p_external_issue_key),
    external_status_id = btrim(p_external_status_id),
    external_status_name = btrim(p_external_status_name),
    provider_project_id = btrim(p_provider_project_id),
    status = v_status,
    last_sync_direction = 'outbound',
    last_sync_at = v_now,
    last_provider_event_at = greatest(coalesce(last_provider_event_at, p_provider_updated_at), p_provider_updated_at),
    conflict_reason = case when v_status = 'conflict' then 'unknown_external_status' else null end,
    sync_revision = sync_revision + 1,
    version = version + 1,
    updated_at = v_now
  where organization_id = p_organization_id and id = p_ticket_id
  returning * into v_ticket;
  update public.vulnerability_remediation_ticket_operations
  set state = 'completed', completed_at = v_now,
    result = jsonb_build_object('ticket', public.m11_05_ticket_json(p_organization_id, p_ticket_id))
  where organization_id = p_organization_id and id = p_operation_id;
  insert into public.audit_logs(organization_id, action, entity_type, entity_id, changes)
  values (p_organization_id, 'vulnerability.remediation_ticket_sync_finalized',
    'vulnerability_remediation_ticket', p_ticket_id::text,
    jsonb_build_object('operationId', p_operation_id, 'externalIssueId', p_external_issue_id,
      'externalIssueKey', p_external_issue_key, 'mappedStatus', v_status));
  return query select 'finalized'::text, public.m11_05_ticket_json(p_organization_id, p_ticket_id);
end;
$$;

create or replace function public.record_verified_vulnerability_ticket_event_atomic(
  p_organization_id uuid,
  p_binding_id uuid,
  p_delivery_id text,
  p_external_issue_id text,
  p_external_issue_key text,
  p_external_status_id text,
  p_external_status_name text,
  p_provider_project_id text,
  p_provider_updated_at timestamptz
) returns table(outcome text, ticket jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_existing public.vulnerability_remediation_ticket_events%rowtype;
  v_binding public.vulnerability_remediation_ticket_bindings%rowtype;
  v_ticket public.vulnerability_remediation_tickets%rowtype;
  v_status text;
  v_outcome text;
  v_now timestamptz := clock_timestamp();
begin
  if char_length(btrim(coalesce(p_delivery_id,''))) not between 1 and 300
    or char_length(btrim(coalesce(p_external_issue_id,''))) not between 1 and 200
    or char_length(btrim(coalesce(p_external_issue_key,''))) not between 1 and 200
    or char_length(btrim(coalesce(p_external_status_id,''))) not between 1 and 120
    or char_length(btrim(coalesce(p_external_status_name,''))) not between 1 and 200
    or char_length(btrim(coalesce(p_provider_project_id,''))) not between 1 and 120
    or p_provider_updated_at is null then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  select * into v_existing from public.vulnerability_remediation_ticket_events
  where provider = 'jira' and delivery_id = btrim(p_delivery_id);
  if found then
    return query select 'duplicate'::text,
      case when v_existing.organization_id <> p_organization_id or v_existing.binding_id <> p_binding_id then null::jsonb
        when v_existing.ticket_id is null then null::jsonb
        else public.m11_05_ticket_json(v_existing.organization_id, v_existing.ticket_id) end;
    return;
  end if;
  select * into v_binding from public.vulnerability_remediation_ticket_bindings
  where organization_id = p_organization_id and id = p_binding_id and provider = 'jira'
    and status = 'active' and project_id = btrim(p_provider_project_id)
  for share;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  select * into v_ticket from public.vulnerability_remediation_tickets
  where organization_id = p_organization_id and binding_id = p_binding_id
    and provider = 'jira'
    and external_issue_id = btrim(p_external_issue_id)
    and external_issue_key = btrim(p_external_issue_key)
  for update;
  if not found then
    insert into public.vulnerability_remediation_ticket_events(
      organization_id, binding_id, provider, delivery_id, external_issue_id, external_issue_key,
      external_status_id, external_status_name, provider_project_id, provider_updated_at, outcome
    ) values (
      p_organization_id, p_binding_id, 'jira', btrim(p_delivery_id), btrim(p_external_issue_id),
      btrim(p_external_issue_key), btrim(p_external_status_id), btrim(p_external_status_name),
      btrim(p_provider_project_id), p_provider_updated_at, 'unbound'
    );
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  if v_ticket.last_provider_event_at is not null and p_provider_updated_at < v_ticket.last_provider_event_at then
    insert into public.vulnerability_remediation_ticket_events(
      organization_id, binding_id, ticket_id, provider, delivery_id, external_issue_id, external_issue_key,
      external_status_id, external_status_name, provider_project_id, provider_updated_at, outcome
    ) values (
      p_organization_id, p_binding_id, v_ticket.id, 'jira', btrim(p_delivery_id), btrim(p_external_issue_id),
      btrim(p_external_issue_key), btrim(p_external_status_id), btrim(p_external_status_name),
      btrim(p_provider_project_id), p_provider_updated_at, 'stale'
    );
    return query select 'stale'::text, public.m11_05_ticket_json(p_organization_id, v_ticket.id); return;
  end if;
  v_status := public.m11_05_ticket_status(p_organization_id, p_binding_id, p_external_status_id, p_external_status_name);
  v_outcome := case when v_status = 'conflict' then 'unknown_status' else 'processed' end;
  if v_ticket.external_status_id = btrim(p_external_status_id)
    and v_ticket.external_status_name = btrim(p_external_status_name)
    and v_ticket.status = v_status
    and v_ticket.last_provider_event_at is not null
    and p_provider_updated_at <= v_ticket.last_provider_event_at then
    insert into public.vulnerability_remediation_ticket_events(
      organization_id, binding_id, ticket_id, provider, delivery_id, external_issue_id, external_issue_key,
      external_status_id, external_status_name, provider_project_id, provider_updated_at, outcome
    ) values (
      p_organization_id, p_binding_id, v_ticket.id, 'jira', btrim(p_delivery_id), btrim(p_external_issue_id),
      btrim(p_external_issue_key), btrim(p_external_status_id), btrim(p_external_status_name),
      btrim(p_provider_project_id), p_provider_updated_at, v_outcome
    );
    return query select case when v_outcome = 'unknown_status' then 'unknown_status' else 'recorded' end,
      public.m11_05_ticket_json(p_organization_id, v_ticket.id);
    return;
  end if;
  update public.vulnerability_remediation_tickets
  set external_status_id = btrim(p_external_status_id),
    external_status_name = btrim(p_external_status_name),
    provider_project_id = btrim(p_provider_project_id),
    status = v_status,
    last_sync_direction = 'inbound',
    last_sync_at = v_now,
    last_provider_event_at = p_provider_updated_at,
    last_inbound_delivery_id = btrim(p_delivery_id),
    conflict_reason = case when v_status = 'conflict' then 'unknown_external_status' else null end,
    sync_revision = sync_revision + 1,
    version = version + 1,
    updated_at = v_now
  where organization_id = p_organization_id and id = v_ticket.id
  returning * into v_ticket;
  insert into public.vulnerability_remediation_ticket_events(
    organization_id, binding_id, ticket_id, provider, delivery_id, external_issue_id, external_issue_key,
    external_status_id, external_status_name, provider_project_id, provider_updated_at, outcome
  ) values (
    p_organization_id, p_binding_id, v_ticket.id, 'jira', btrim(p_delivery_id), btrim(p_external_issue_id),
    btrim(p_external_issue_key), btrim(p_external_status_id), btrim(p_external_status_name),
    btrim(p_provider_project_id), p_provider_updated_at, v_outcome
  );
  insert into public.audit_logs(organization_id, action, entity_type, entity_id, changes)
  values (p_organization_id, 'vulnerability.remediation_ticket_event_recorded',
    'vulnerability_remediation_ticket', v_ticket.id::text,
    jsonb_build_object('deliveryId', p_delivery_id, 'externalStatusId', p_external_status_id,
      'externalStatusName', p_external_status_name, 'mappedStatus', v_status));
  return query select case when v_outcome = 'unknown_status' then 'unknown_status' else 'recorded' end,
    public.m11_05_ticket_json(p_organization_id, v_ticket.id);
end;
$$;

revoke all on function public.m11_05_actor_is_owner(uuid,uuid),
  public.m11_05_valid_ticket_field_mapping(jsonb),
  public.m11_05_valid_status_transitions(jsonb),
  public.m11_05_valid_status_mappings(jsonb),
  public.m11_05_valid_custom_field_mappings(jsonb),
  public.m11_05_ticket_binding_json(uuid,uuid),
  public.m11_05_ticket_json(uuid,uuid),
  public.m11_05_ticket_status(uuid,uuid,text,text),
  public.list_finding_remediation_tickets(uuid,uuid,uuid),
  public.upsert_vulnerability_remediation_ticket_binding_atomic(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,jsonb,uuid,integer,uuid,text),
  public.reserve_vulnerability_remediation_ticket_atomic(uuid,uuid,uuid,uuid,integer,uuid,text),
  public.finalize_vulnerability_remediation_ticket_atomic(uuid,uuid,uuid,text,text,text,text,text,timestamp with time zone),
  public.record_verified_vulnerability_ticket_event_atomic(uuid,uuid,text,text,text,text,text,text,timestamp with time zone)
  from public, anon, authenticated;
grant execute on function public.list_finding_remediation_tickets(uuid,uuid,uuid),
  public.upsert_vulnerability_remediation_ticket_binding_atomic(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,jsonb,uuid,integer,uuid,text),
  public.reserve_vulnerability_remediation_ticket_atomic(uuid,uuid,uuid,uuid,integer,uuid,text),
  public.finalize_vulnerability_remediation_ticket_atomic(uuid,uuid,uuid,text,text,text,text,text,timestamp with time zone),
  public.record_verified_vulnerability_ticket_event_atomic(uuid,uuid,text,text,text,text,text,text,timestamp with time zone)
  to service_role;
