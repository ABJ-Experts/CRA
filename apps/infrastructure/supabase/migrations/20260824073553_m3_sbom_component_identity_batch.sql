-- Persist searchable component identities during the same durable batch as
-- their source component rows. This keeps original document-local references
-- and optional PURL/CPE values independently traceable without a second scan.

create or replace function public.persist_sbom_normalization_batch_atomic(
  p_organization_id uuid, p_job_id uuid, p_worker_id text, p_document_id uuid,
  p_components jsonb, p_edges jsonb, p_diagnostics jsonb, p_source_offset bigint
) returns table(outcome text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_component_count integer;
begin
  if jsonb_typeof(p_components) <> 'array' or jsonb_typeof(p_edges) <> 'array' or jsonb_typeof(p_diagnostics) <> 'array' or jsonb_array_length(p_diagnostics) > 100 or octet_length(p_diagnostics::text) > 524288 or p_source_offset < 0 then
    return query select 'invalid_request'::text; return;
  end if;
  if not exists (select 1 from public.sbom_ingest_jobs jobs where jobs.organization_id = p_organization_id and jobs.id = p_job_id and jobs.status = 'processing' and jobs.lease_owner = btrim(p_worker_id) and jobs.lease_expires_at > now()) then
    return query select 'not_found'::text; return;
  end if;
  if not exists (select 1 from public.sbom_documents documents where documents.organization_id = p_organization_id and documents.id = p_document_id and documents.ingest_job_id = p_job_id and documents.state = 'processing' for update) then
    return query select 'not_found'::text; return;
  end if;
  insert into public.sbom_components(organization_id,document_id,document_local_ref,source_offset,source_byte_end,source_path,source_line,original_name,normalized_name,original_version,normalized_version,original_purl,canonical_purl,cpe,ecosystem,scope,supplier,license_expression,hashes)
  select p_organization_id,p_document_id,x.document_local_ref,x.source_offset,x.source_byte_end,x.source_path,x.source_line,x.original_name,x.normalized_name,x.original_version,x.normalized_version,x.original_purl,x.canonical_purl,x.cpe,x.ecosystem,x.scope,x.supplier,x.license_expression,coalesce(x.hashes,'[]'::jsonb)
  from jsonb_to_recordset(p_components) as x(document_local_ref text,source_offset bigint,source_byte_end bigint,source_path text,source_line integer,original_name text,normalized_name text,original_version text,normalized_version text,original_purl text,canonical_purl text,cpe text,ecosystem text,scope text,supplier text,license_expression text,hashes jsonb)
  on conflict (organization_id,document_id,document_local_ref) do update set source_offset=excluded.source_offset,source_byte_end=excluded.source_byte_end,source_path=excluded.source_path,source_line=excluded.source_line,original_name=excluded.original_name,normalized_name=excluded.normalized_name,original_version=excluded.original_version,normalized_version=excluded.normalized_version,original_purl=excluded.original_purl,canonical_purl=excluded.canonical_purl,cpe=excluded.cpe,ecosystem=excluded.ecosystem,scope=excluded.scope,supplier=excluded.supplier,license_expression=excluded.license_expression,hashes=excluded.hashes;
  insert into public.sbom_component_identities(organization_id,document_id,component_id,identity_type,original_value,canonical_value)
  select c.organization_id,c.document_id,c.id,'bom_ref',c.document_local_ref,c.document_local_ref
  from public.sbom_components c where c.organization_id=p_organization_id and c.document_id=p_document_id
  on conflict (organization_id,document_id,component_id,identity_type,original_value) do nothing;
  insert into public.sbom_component_identities(organization_id,document_id,component_id,identity_type,original_value,canonical_value)
  select c.organization_id,c.document_id,c.id,'purl',c.original_purl,c.canonical_purl
  from public.sbom_components c where c.organization_id=p_organization_id and c.document_id=p_document_id and c.original_purl is not null
  on conflict (organization_id,document_id,component_id,identity_type,original_value) do update set canonical_value=excluded.canonical_value;
  insert into public.sbom_component_identities(organization_id,document_id,component_id,identity_type,original_value,canonical_value)
  select c.organization_id,c.document_id,c.id,'cpe',c.cpe,null
  from public.sbom_components c where c.organization_id=p_organization_id and c.document_id=p_document_id and c.cpe is not null
  on conflict (organization_id,document_id,component_id,identity_type,original_value) do nothing;
  insert into public.sbom_component_dependencies(organization_id,document_id,parent_component_id,child_component_id,parent_reference,child_reference,source_offset,source_byte_end,source_path,source_line)
  select p_organization_id,p_document_id,parent_component.id,child_component.id,x.parent_reference,x.child_reference,x.source_offset,x.source_byte_end,x.source_path,x.source_line
  from jsonb_to_recordset(p_edges) as x(parent_reference text,child_reference text,source_offset bigint,source_byte_end bigint,source_path text,source_line integer)
  left join public.sbom_components parent_component on parent_component.organization_id=p_organization_id and parent_component.document_id=p_document_id and parent_component.document_local_ref=x.parent_reference
  left join public.sbom_components child_component on child_component.organization_id=p_organization_id and child_component.document_id=p_document_id and child_component.document_local_ref=x.child_reference
  on conflict (organization_id,document_id,parent_reference,child_reference,edge_state) do update set source_offset=excluded.source_offset,source_byte_end=excluded.source_byte_end,source_path=excluded.source_path,source_line=excluded.source_line;
  select count(*) into v_component_count from public.sbom_components where organization_id=p_organization_id and document_id=p_document_id;
  if v_component_count > 50000 then
    update public.sbom_documents set state='failed',progress_stage='failed',error_code='normalization_component_limit_exceeded',error_message='The document exceeds the configured component ceiling.' where organization_id=p_organization_id and id=p_document_id;
    update public.sbom_ingest_jobs set status='failed',progress_stage='failed',error_code='normalization_component_limit_exceeded',lease_owner=null,lease_expires_at=null where organization_id=p_organization_id and id=p_job_id;
    return query select 'failed'::text; return;
  end if;
  update public.sbom_documents set progress_stage='batching',progress_component_count=v_component_count,progress_dependency_count=(select count(*) from public.sbom_component_dependencies where organization_id=p_organization_id and document_id=p_document_id),checkpoint_source_offset=greatest(checkpoint_source_offset,p_source_offset),checkpoint_batch=checkpoint_batch+1,diagnostics=p_diagnostics where organization_id=p_organization_id and id=p_document_id;
  update public.sbom_ingest_jobs set progress_stage='batching',progress_percent=greatest(progress_percent,75) where organization_id=p_organization_id and id=p_job_id;
  return query select 'persisted'::text;
end;
$$;

alter function public.persist_sbom_normalization_batch_atomic(uuid,uuid,text,uuid,jsonb,jsonb,jsonb,bigint) owner to postgres;
revoke all on function public.persist_sbom_normalization_batch_atomic(uuid,uuid,text,uuid,jsonb,jsonb,jsonb,bigint) from public, anon, authenticated;
grant execute on function public.persist_sbom_normalization_batch_atomic(uuid,uuid,text,uuid,jsonb,jsonb,jsonb,bigint) to service_role;
