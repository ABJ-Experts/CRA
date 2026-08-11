-- Immutable export-record materialization. A claimed export snapshots all
-- registered physical tenant tables inside this one SECURITY DEFINER statement
-- before the worker writes any NDJSON part. The mapping is data, rather than
-- dynamic worker input, so missing source coverage fails closed.

create table public.organization_export_source_tables (
  source_id text not null references public.organization_export_sources (source_id)
    on delete restrict,
  table_name text not null check (table_name ~ '^[a-z][a-z0-9_]{0,63}$'),
  tenant_key_column text not null check (tenant_key_column in ('id', 'organization_id')),
  record_order_column text not null check (record_order_column ~ '^[a-z][a-z0-9_]{0,63}$'),
  table_sort integer not null check (table_sort > 0),
  primary key (source_id, table_name),
  unique (source_id, table_sort)
);

insert into public.organization_export_source_tables (
  source_id, table_name, tenant_key_column, record_order_column, table_sort
) values
  ('organization_profile', 'organizations', 'id', 'id', 1),
  ('organization_profile', 'organization_legal_profiles', 'organization_id', 'id', 2),
  ('memberships', 'organization_members', 'organization_id', 'id', 1),
  ('audit_logs', 'audit_logs', 'organization_id', 'id', 1),
  ('invitations', 'invitations', 'organization_id', 'id', 1),
  ('custom_roles', 'custom_roles', 'organization_id', 'id', 1),
  ('base_role_permission_overrides', 'base_role_permission_overrides', 'organization_id', 'base_role', 1),
  ('menu_permissions', 'menu_permissions', 'organization_id', 'menu_key', 1),
  ('user_role_assignments', 'user_role_assignments', 'organization_id', 'id', 1),
  ('user_table_preferences', 'user_table_preferences', 'organization_id', 'id', 1),
  ('organization_onboarding', 'organization_onboarding', 'organization_id', 'organization_id', 1),
  ('organization_onboarding_stages', 'organization_onboarding_stages', 'organization_id', 'id', 1),
  ('organization_onboarding_evidence', 'organization_onboarding_evidence', 'organization_id', 'id', 1),
  ('organization_settings', 'organization_settings', 'organization_id', 'organization_id', 1),
  ('organization_lifecycles', 'organization_lifecycles', 'organization_id', 'organization_id', 1),
  ('organization_retention_policies', 'organization_retention_policies', 'organization_id', 'evidence_class', 1),
  ('retention_authority_states', 'retention_authority_states', 'organization_id', 'authority_kind', 1),
  ('retention_authoritative_facts', 'retention_authoritative_facts', 'organization_id', 'source_record_id', 1),
  ('retention_floor_snapshots', 'retention_floor_snapshots', 'organization_id', 'id', 1),
  ('retention_floor_reasons', 'retention_floor_reasons', 'organization_id', 'source_record_id', 1),
  ('evidence_protection_watermarks', 'evidence_protection_watermarks', 'organization_id', 'evidence_class', 1),
  ('retention_cleanup_runs', 'retention_cleanup_runs', 'organization_id', 'id', 1),
  ('retention_cleanup_items', 'retention_cleanup_items', 'organization_id', 'id', 1),
  ('organization_export_jobs', 'organization_export_jobs', 'organization_id', 'id', 1),
  ('organization_export_parts', 'organization_export_parts', 'organization_id', 'id', 1),
  ('organization_export_snapshots', 'organization_export_snapshots', 'organization_id', 'id', 1),
  ('organization_purge_jobs', 'organization_purge_jobs', 'organization_id', 'id', 1),
  ('organization_purge_work_items', 'organization_purge_work_items', 'organization_id', 'id', 1),
  ('organization_permissions_version', 'organization_permissions_version', 'organization_id', 'organization_id', 1)
on conflict (source_id, table_name) do update
  set tenant_key_column = excluded.tenant_key_column,
      record_order_column = excluded.record_order_column,
      table_sort = excluded.table_sort;

create table public.organization_export_snapshot_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  export_job_id uuid not null references public.organization_export_jobs (id) on delete cascade,
  source_id text not null references public.organization_export_sources (source_id)
    on delete restrict,
  table_name text not null,
  table_sort integer not null check (table_sort > 0),
  record_index bigint not null check (record_index > 0),
  record_payload jsonb not null check (jsonb_typeof(record_payload) = 'object'),
  created_at timestamptz not null default now(),
  unique (organization_id, export_job_id, source_id, table_name, record_index),
  foreign key (source_id, table_name)
    references public.organization_export_source_tables (source_id, table_name)
    on delete restrict
);

create index organization_export_snapshot_records_read_idx
  on public.organization_export_snapshot_records (
    organization_id, export_job_id, source_id, table_sort, record_index
  );

alter table public.organization_export_snapshots
  add column if not exists materialized_at timestamptz,
  add column if not exists materialized_by uuid references public.users (id) on delete restrict,
  add column if not exists materialized_checkpoint_version integer;

create table public.organization_export_artifact_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  export_job_id uuid not null references public.organization_export_jobs (id) on delete cascade,
  artifact_key text not null check (artifact_key ~ '^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,511}$'),
  snapshot_object_path text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint not null check (byte_size >= 0),
  content_type text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, export_job_id, artifact_key),
  unique (organization_id, export_job_id, snapshot_object_path)
);

create index organization_export_artifact_snapshots_read_idx
  on public.organization_export_artifact_snapshots (organization_id, export_job_id, artifact_key);

create or replace function public.m1_export_redact_jsonb(p_value jsonb)
  returns jsonb
  language plpgsql
  immutable
  set search_path = public, pg_temp
as $$
declare v_result jsonb;
begin
  case jsonb_typeof(p_value)
    when 'object' then
      select coalesce(
        jsonb_object_agg(item.key, public.m1_export_redact_jsonb(item.value)),
        '{}'::jsonb
      ) into v_result
      from jsonb_each(p_value) item
      where item.key !~* '(token|password|secret|credential|otp|recovery|api[_-]?key|access[_-]?token|refresh[_-]?token|(encryption|private|signing|provider)[_-]?key)';
      return v_result;
    when 'array' then
      select coalesce(jsonb_agg(public.m1_export_redact_jsonb(item.value)), '[]'::jsonb)
        into v_result
      from jsonb_array_elements(p_value) item;
      return v_result;
    else
      return p_value;
  end case;
end;
$$;

create function public.materialize_organization_export_snapshot_atomic(
  p_organization_id uuid,
  p_export_job_id uuid,
  p_lease_owner uuid,
  p_expected_checkpoint_version integer
)
  returns table (outcome text, checkpoint_version integer)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_job public.organization_export_jobs%rowtype;
  v_snapshot public.organization_export_snapshots%rowtype;
  v_mapping public.organization_export_source_tables%rowtype;
  v_source_id text;
  v_source_count integer := 0;
begin
  -- Freeze every physical source before the first record read. SHARE locks
  -- conflict with DML RowExclusive locks, giving this atomic RPC one stable
  -- materialization boundary without relying on browser or worker memory.
  lock table
    public.organizations,
    public.organization_legal_profiles,
    public.organization_members,
    public.audit_logs,
    public.invitations,
    public.custom_roles,
    public.base_role_permission_overrides,
    public.menu_permissions,
    public.user_role_assignments,
    public.user_table_preferences,
    public.organization_onboarding,
    public.organization_onboarding_stages,
    public.organization_onboarding_evidence,
    public.organization_settings,
    public.organization_lifecycles,
    public.organization_retention_policies,
    public.retention_authority_states,
    public.retention_authoritative_facts,
    public.retention_floor_snapshots,
    public.retention_floor_reasons,
    public.evidence_protection_watermarks,
    public.retention_cleanup_runs,
    public.retention_cleanup_items,
    public.organization_export_jobs,
    public.organization_export_parts,
    public.organization_export_snapshots,
    public.organization_purge_jobs,
    public.organization_purge_work_items,
    public.organization_permissions_version
  in share mode;

  select * into v_job
    from public.organization_export_jobs
   where id = p_export_job_id and organization_id = p_organization_id
   for update;
  if not found then
    return query select 'not_found'::text, null::integer;
    return;
  end if;
  if v_job.status <> 'running' or v_job.lease_owner <> p_lease_owner
     or v_job.lease_expires_at <= now()
     or v_job.checkpoint_version <> p_expected_checkpoint_version then
    return query select 'conflict'::text, v_job.checkpoint_version;
    return;
  end if;

  select * into v_snapshot
    from public.organization_export_snapshots
   where organization_id = p_organization_id and export_job_id = p_export_job_id
   order by snapshot_version desc
   limit 1
   for update;
  if not found or cardinality(v_snapshot.source_ids) = 0 then
    return query select 'invalid_request'::text, v_job.checkpoint_version;
    return;
  end if;
  if v_snapshot.materialized_at is not null then
    return query select 'replayed'::text, v_job.checkpoint_version;
    return;
  end if;
  if exists (
    select 1 from public.organization_export_snapshot_records records
     where records.organization_id = p_organization_id
       and records.export_job_id = p_export_job_id
  ) then
    return query select 'invalid_request'::text, v_job.checkpoint_version;
    return;
  end if;

  foreach v_source_id in array v_snapshot.source_ids loop
    if not exists (
      select 1 from public.organization_export_source_tables mappings
       where mappings.source_id = v_source_id
    ) then
      return query select 'invalid_request'::text, v_job.checkpoint_version;
      return;
    end if;
    for v_mapping in
      select * from public.organization_export_source_tables mappings
       where mappings.source_id = v_source_id
       order by mappings.table_sort
    loop
      execute format(
        'insert into public.organization_export_snapshot_records
          (organization_id, export_job_id, source_id, table_name, table_sort, record_index, record_payload)
         select $1, $2, $3, $4, $5,
                row_number() over (order by source.%I),
                public.m1_export_redact_jsonb(to_jsonb(source))
           from public.%I source
          where source.%I = $1
          order by source.%I',
        v_mapping.record_order_column,
        v_mapping.table_name,
        v_mapping.tenant_key_column,
        v_mapping.record_order_column
      ) using p_organization_id, p_export_job_id, v_source_id,
        v_mapping.table_name, v_mapping.table_sort;
      v_source_count := v_source_count + 1;
    end loop;
  end loop;
  if v_source_count <> (
    select count(*) from public.organization_export_source_tables mappings
     where mappings.source_id = any(v_snapshot.source_ids)
  ) then
    return query select 'invalid_request'::text, v_job.checkpoint_version;
    return;
  end if;

  update public.organization_export_snapshots snapshots
     set materialized_at = now(),
         materialized_by = v_job.actor_user_id,
         materialized_checkpoint_version = v_job.checkpoint_version
   where snapshots.id = v_snapshot.id;
  insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, 'organization.export_snapshot_materialized',
    'organization_export_job', p_export_job_id::text,
    jsonb_build_object('sourceCount', v_source_count,
      'checkpointVersion', v_job.checkpoint_version)
  );
  return query select 'materialized'::text, v_job.checkpoint_version;
end;
$$;

create function public.record_organization_export_artifact_snapshot_atomic(
  p_organization_id uuid,
  p_export_job_id uuid,
  p_lease_owner uuid,
  p_expected_checkpoint_version integer,
  p_artifact_key text,
  p_snapshot_object_path text,
  p_sha256 text,
  p_byte_size bigint,
  p_content_type text,
  p_metadata jsonb default '{}'::jsonb
)
  returns table (outcome text)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare v_job public.organization_export_jobs%rowtype;
begin
  select * into v_job from public.organization_export_jobs
   where id = p_export_job_id and organization_id = p_organization_id
   for update;
  if not found then return query select 'not_found'::text; return; end if;
  if v_job.status <> 'running' or v_job.lease_owner <> p_lease_owner
     or v_job.lease_expires_at <= now()
     or v_job.checkpoint_version <> p_expected_checkpoint_version then
    return query select 'conflict'::text;
    return;
  end if;
  if not exists (
    select 1 from public.organization_export_snapshots snapshots
     where snapshots.organization_id = p_organization_id
       and snapshots.export_job_id = p_export_job_id
       and snapshots.materialized_at is not null
  ) then
    return query select 'invalid_request'::text;
    return;
  end if;
  if p_artifact_key !~ '^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,511}$'
     or p_snapshot_object_path !~ ('^' || p_organization_id::text || '/' || p_export_job_id::text || '/artifacts/')
     or p_sha256 !~ '^[0-9a-f]{64}$'
     or p_byte_size < 0
     or p_metadata is null
     or jsonb_typeof(p_metadata) <> 'object' then
    return query select 'invalid_request'::text;
    return;
  end if;
  insert into public.organization_export_artifact_snapshots (
    organization_id, export_job_id, artifact_key, snapshot_object_path,
    sha256, byte_size, content_type, metadata
  ) values (
    p_organization_id, p_export_job_id, p_artifact_key, p_snapshot_object_path,
    p_sha256, p_byte_size, p_content_type, public.m1_export_redact_jsonb(p_metadata)
  ) on conflict (organization_id, export_job_id, artifact_key) do nothing;
  if found then return query select 'recorded'::text; return; end if;
  if exists (
    select 1 from public.organization_export_artifact_snapshots artifacts
     where artifacts.organization_id = p_organization_id
       and artifacts.export_job_id = p_export_job_id
       and artifacts.artifact_key = p_artifact_key
       and artifacts.snapshot_object_path = p_snapshot_object_path
       and artifacts.sha256 = p_sha256
       and artifacts.byte_size = p_byte_size
  ) then
    return query select 'replayed'::text;
    return;
  end if;
  return query select 'invalid_request'::text;
end;
$$;

alter function public.m1_export_redact_jsonb(jsonb) owner to postgres;
alter function public.materialize_organization_export_snapshot_atomic(uuid, uuid, uuid, integer) owner to postgres;
alter function public.record_organization_export_artifact_snapshot_atomic(uuid, uuid, uuid, integer, text, text, text, bigint, text, jsonb) owner to postgres;
revoke all on function public.m1_export_redact_jsonb(jsonb) from public, anon, authenticated;
revoke all on function public.materialize_organization_export_snapshot_atomic(uuid, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.record_organization_export_artifact_snapshot_atomic(uuid, uuid, uuid, integer, text, text, text, bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.materialize_organization_export_snapshot_atomic(uuid, uuid, uuid, integer) to service_role;
grant execute on function public.record_organization_export_artifact_snapshot_atomic(uuid, uuid, uuid, integer, text, text, text, bigint, text, jsonb) to service_role;

alter table public.organization_export_source_tables enable row level security;
alter table public.organization_export_snapshot_records enable row level security;
alter table public.organization_export_artifact_snapshots enable row level security;
grant all on table public.organization_export_source_tables to service_role;
grant all on table public.organization_export_snapshot_records to service_role;
grant all on table public.organization_export_artifact_snapshots to service_role;
revoke all on table public.organization_export_source_tables from public, anon, authenticated;
revoke all on table public.organization_export_snapshot_records from public, anon, authenticated;
revoke all on table public.organization_export_artifact_snapshots from public, anon, authenticated;
