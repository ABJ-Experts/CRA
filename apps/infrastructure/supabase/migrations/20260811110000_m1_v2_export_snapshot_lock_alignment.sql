-- V2 adds legal-entity and branding records to the durable organization export
-- registry. Snapshot materialization must share-lock every registered source so
-- a single export cannot combine pre- and post-write records.
create or replace function public.materialize_organization_export_snapshot_atomic(
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
    public.organization_permissions_version,
    public.organization_legal_entities,
    public.organization_legal_entity_dependency_authorities,
    public.organization_legal_entity_dependency_facts,
    public.organization_branding_drafts,
    public.organization_branding_assets,
    public.organization_branding_versions
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
  if exists (
    select 1
      from unnest(v_snapshot.source_ids) as requested(source_id)
     where not exists (
       select 1
         from public.organization_export_source_tables mappings
        where mappings.source_id = requested.source_id
     )
  ) then
    return query select 'invalid_request'::text, v_job.checkpoint_version;
    return;
  end if;

  foreach v_source_id in array v_snapshot.source_ids loop
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

alter function public.materialize_organization_export_snapshot_atomic(
  uuid, uuid, uuid, integer
) owner to postgres;
revoke all on function public.materialize_organization_export_snapshot_atomic(
  uuid, uuid, uuid, integer
) from public, anon, authenticated;
grant execute on function public.materialize_organization_export_snapshot_atomic(
  uuid, uuid, uuid, integer
) to service_role;
