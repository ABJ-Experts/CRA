-- Import workflow records are tenant audit evidence, but their export must be
-- an allowlist rather than to_jsonb(table): source/report paths, idempotency
-- material, raw proposed values, normalized lookup keys, and resolved target
-- UUIDs remain private to the import boundary.
insert into public.organization_export_source_tables(
  source_id,table_name,tenant_key_column,record_order_column,table_sort
) values
  ('product_registry', 'product_import_jobs', 'organization_id', 'id', 11),
  ('product_registry', 'product_import_rows', 'organization_id', 'id', 12)
on conflict(source_id,table_name) do update set
  tenant_key_column=excluded.tenant_key_column,
  record_order_column=excluded.record_order_column,
  table_sort=excluded.table_sort;

create function public.m2_product_import_job_export_json(p_job public.product_import_jobs)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id',p_job.id,
    'organization_id',p_job.organization_id,
    'actor_user_id',p_job.actor_user_id,
    'commit_actor_user_id',p_job.commit_actor_user_id,
    'schema_version',p_job.schema_version,
    'content_hash',p_job.content_hash,
    'status',p_job.status,
    'byte_size',p_job.byte_size,
    'row_count',p_job.row_count,
    'processed_row_count',p_job.processed_row_count,
    'committed_row_count',p_job.committed_row_count,
    'create_count',p_job.create_count,
    'update_count',p_job.update_count,
    'unchanged_count',p_job.unchanged_count,
    'skipped_count',p_job.skipped_count,
    'failed_count',p_job.failed_count,
    'warning_count',p_job.warning_count,
    'retry_count',p_job.retry_count,
    'error_code',p_job.error_code,
    'cancellation_reason',p_job.cancellation_reason,
    'correlation_id',p_job.correlation_id,
    'expires_at',p_job.expires_at,
    'retention_until',p_job.retention_until,
    'dry_run_completed_at',p_job.dry_run_completed_at,
    'committed_at',p_job.committed_at,
    'canceled_at',p_job.canceled_at,
    'created_at',p_job.created_at,
    'updated_at',p_job.updated_at
  );
$$;

create function public.m2_product_import_row_export_json(p_row public.product_import_rows)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'organization_id',p_row.organization_id,
    'import_id',p_row.import_id,
    'source_row_number',p_row.source_row_number,
    'row_type',p_row.row_type,
    'proposed_action',p_row.proposed_action,
    'result',p_row.result,
    'product_internal_code',p_row.product_internal_code,
    'release_version',p_row.release_version,
    'issues',p_row.issues,
    'committed_at',p_row.committed_at,
    'created_at',p_row.created_at,
    'updated_at',p_row.updated_at
  );
$$;

create or replace function public.materialize_organization_export_snapshot_atomic(
  p_organization_id uuid,p_export_job_id uuid,p_lease_owner uuid,p_expected_checkpoint_version integer
) returns table(outcome text,checkpoint_version integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_job public.organization_export_jobs%rowtype;
  v_snapshot public.organization_export_snapshots%rowtype;
  v_mapping public.organization_export_source_tables%rowtype;
  v_source_id text;
  v_source_count integer:=0;
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
    public.organization_branding_versions,
    public.products,
    public.product_releases,
    public.product_legal_entity_assignments,
    public.product_lifecycle_dependency_facts,
    public.product_release_market_availability,
    public.product_regulatory_outbox_events,
    public.product_support_periods,
    public.software_baselines,
    public.software_baseline_release_memberships,
    public.product_relationships,
    public.finding_propagation_sources,
    public.finding_impact_associations,
    public.finding_product_impact_overrides,
    public.finding_propagation_jobs,
    public.product_import_jobs,
    public.product_import_rows
  in share mode;

  select * into v_job from public.organization_export_jobs jobs
   where jobs.id=p_export_job_id and jobs.organization_id=p_organization_id for update;
  if not found then return query select 'not_found'::text,null::integer; return; end if;
  if v_job.status<>'running' or v_job.lease_owner<>p_lease_owner
     or v_job.lease_expires_at<=now() or v_job.checkpoint_version<>p_expected_checkpoint_version then
    return query select 'conflict'::text,v_job.checkpoint_version; return; end if;
  select * into v_snapshot from public.organization_export_snapshots snapshots
   where snapshots.organization_id=p_organization_id and snapshots.export_job_id=p_export_job_id
   order by snapshots.snapshot_version desc limit 1 for update;
  if not found or cardinality(v_snapshot.source_ids)=0 then
    return query select 'invalid_request'::text,v_job.checkpoint_version; return; end if;
  if v_snapshot.materialized_at is not null then
    return query select 'replayed'::text,v_job.checkpoint_version; return; end if;
  if exists(select 1 from public.organization_export_snapshot_records records
    where records.organization_id=p_organization_id and records.export_job_id=p_export_job_id) then
    return query select 'invalid_request'::text,v_job.checkpoint_version; return; end if;
  if exists(select 1 from unnest(v_snapshot.source_ids) requested(source_id)
    where not exists(select 1 from public.organization_export_source_tables mappings
      where mappings.source_id=requested.source_id)) then
    return query select 'invalid_request'::text,v_job.checkpoint_version; return; end if;

  foreach v_source_id in array v_snapshot.source_ids loop
    for v_mapping in select * from public.organization_export_source_tables mappings
      where mappings.source_id=v_source_id order by mappings.table_sort
    loop
      if v_mapping.table_name='product_import_jobs' then
        insert into public.organization_export_snapshot_records(
          organization_id,export_job_id,source_id,table_name,table_sort,record_index,record_payload
        ) select p_organization_id,p_export_job_id,v_source_id,v_mapping.table_name,
          v_mapping.table_sort,row_number() over(order by jobs.created_at,jobs.id),
          public.m1_export_redact_jsonb(public.m2_product_import_job_export_json(jobs))
        from public.product_import_jobs jobs where jobs.organization_id=p_organization_id
        order by jobs.created_at,jobs.id;
      elsif v_mapping.table_name='product_import_rows' then
        insert into public.organization_export_snapshot_records(
          organization_id,export_job_id,source_id,table_name,table_sort,record_index,record_payload
        ) select p_organization_id,p_export_job_id,v_source_id,v_mapping.table_name,
          v_mapping.table_sort,row_number() over(order by rows.import_id,rows.source_row_number,rows.id),
          public.m1_export_redact_jsonb(public.m2_product_import_row_export_json(rows))
        from public.product_import_rows rows where rows.organization_id=p_organization_id
        order by rows.import_id,rows.source_row_number,rows.id;
      else
        execute format(
          'insert into public.organization_export_snapshot_records
            (organization_id,export_job_id,source_id,table_name,table_sort,record_index,record_payload)
           select $1,$2,$3,$4,$5,row_number() over(order by source.%I),
                  public.m1_export_redact_jsonb(to_jsonb(source))
             from public.%I source where source.%I=$1 order by source.%I',
          v_mapping.record_order_column,v_mapping.table_name,
          v_mapping.tenant_key_column,v_mapping.record_order_column
        ) using p_organization_id,p_export_job_id,v_source_id,v_mapping.table_name,v_mapping.table_sort;
      end if;
      v_source_count:=v_source_count+1;
    end loop;
  end loop;
  if v_source_count<>(select count(*) from public.organization_export_source_tables mappings
    where mappings.source_id=any(v_snapshot.source_ids)) then
    return query select 'invalid_request'::text,v_job.checkpoint_version; return; end if;
  update public.organization_export_snapshots snapshots set
    materialized_at=now(),materialized_by=v_job.actor_user_id,
    materialized_checkpoint_version=v_job.checkpoint_version where snapshots.id=v_snapshot.id;
  insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
  values(p_organization_id,'organization.export_snapshot_materialized','organization_export_job',
    p_export_job_id::text,jsonb_build_object('sourceCount',v_source_count,
      'checkpointVersion',v_job.checkpoint_version));
  return query select 'materialized'::text,v_job.checkpoint_version;
end;
$$;

alter function public.m2_product_import_job_export_json(public.product_import_jobs) owner to postgres;
alter function public.m2_product_import_row_export_json(public.product_import_rows) owner to postgres;
alter function public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer) owner to postgres;

revoke all on function
  public.m2_product_import_job_export_json(public.product_import_jobs),
  public.m2_product_import_row_export_json(public.product_import_rows),
  public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)
from public,anon,authenticated;

grant execute on function public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)
to service_role;
