-- Align the worker RPC surface with the streaming normalizer port.

drop function if exists public.persist_sbom_normalization_batch_atomic(uuid,uuid,text,uuid,jsonb,jsonb,jsonb,bigint,integer);

create or replace function public.begin_sbom_document_normalization_atomic(
  p_organization_id uuid, p_job_id uuid, p_worker_id text,
  p_parser_name text, p_parser_version text, p_normalizer_name text, p_normalizer_version text,
  p_format text, p_serialization text, p_specification_version text, p_validation_report jsonb
) returns table(outcome text, document jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.sbom_ingest_jobs%rowtype; v_result record; v_validation_status text;
begin
  if char_length(btrim(p_worker_id)) not between 1 and 100 or p_validation_report is null then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  v_validation_status := p_validation_report ->> 'status';
  if not public.valid_sbom_validation_report(p_validation_report,v_validation_status) then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  select * into v_job from public.sbom_ingest_jobs jobs where jobs.organization_id=p_organization_id and jobs.id=p_job_id
    and jobs.status='processing' and jobs.lease_owner=btrim(p_worker_id) and jobs.lease_expires_at>now() for update;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  if v_job.validation_report is not null and v_job.validation_report <> p_validation_report then return query select 'invalid_state'::text,null::jsonb; return; end if;
  if v_validation_status = 'invalid' then
    update public.sbom_ingest_jobs set validation_status=v_validation_status,detected_format=p_validation_report #>> '{detected,format}',detected_serialization=p_validation_report #>> '{detected,serialization}',detected_spec_version=p_validation_report #>> '{detected,specificationVersion}',validator_name=p_validation_report #>> '{validator,name}',validator_version=p_validation_report #>> '{validator,version}',validator_schema_asset_sha256=p_validation_report #>> '{validator,schemaAssetSha256}',validation_report=p_validation_report,validation_completed_at=(p_validation_report->>'completedAt')::timestamptz,status='failed',progress_stage='failed',error_code='invalid_sbom',lease_owner=null,lease_expires_at=null where organization_id=p_organization_id and id=p_job_id;
    return query select 'failed'::text,null::jsonb; return;
  end if;
  update public.sbom_ingest_jobs set validation_status=v_validation_status,detected_format=p_validation_report #>> '{detected,format}',detected_serialization=p_validation_report #>> '{detected,serialization}',detected_spec_version=p_validation_report #>> '{detected,specificationVersion}',validator_name=p_validation_report #>> '{validator,name}',validator_version=p_validation_report #>> '{validator,version}',validator_schema_asset_sha256=p_validation_report #>> '{validator,schemaAssetSha256}',validation_report=p_validation_report,validation_completed_at=(p_validation_report->>'completedAt')::timestamptz,progress_stage='parsing',progress_percent=greatest(progress_percent,25) where organization_id=p_organization_id and id=p_job_id;
  select * into v_result from public.create_or_resume_sbom_document_normalization_atomic(p_organization_id,p_job_id,p_worker_id,gen_random_uuid(),p_format,p_serialization,p_specification_version,p_parser_name,p_parser_version,p_normalizer_name,p_normalizer_version);
  return query select v_result.outcome,v_result.document;
end;
$$;

create or replace function public.persist_sbom_normalization_batch_atomic(
  p_organization_id uuid, p_job_id uuid, p_worker_id text, p_document_id uuid,
  p_components jsonb, p_edges jsonb, p_diagnostics jsonb, p_source_offset bigint
) returns table(outcome text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_component_count integer;
begin
  if jsonb_typeof(p_components)<>'array' or jsonb_typeof(p_edges)<>'array' or jsonb_typeof(p_diagnostics)<>'array' or jsonb_array_length(p_diagnostics)>100 or octet_length(p_diagnostics::text)>524288 or p_source_offset<0 then return query select 'invalid_request'::text; return; end if;
  if not exists(select 1 from public.sbom_ingest_jobs jobs where jobs.organization_id=p_organization_id and jobs.id=p_job_id and jobs.status='processing' and jobs.lease_owner=btrim(p_worker_id) and jobs.lease_expires_at>now()) then return query select 'not_found'::text; return; end if;
  perform 1 from public.sbom_documents documents where documents.organization_id=p_organization_id and documents.id=p_document_id and documents.ingest_job_id=p_job_id and documents.state='processing' for update;
  if not found then return query select 'not_found'::text; return; end if;
  insert into public.sbom_components(organization_id,document_id,document_local_ref,source_offset,source_byte_end,source_path,source_line,original_name,normalized_name,original_version,normalized_version,original_purl,canonical_purl,cpe,ecosystem,scope,supplier,license_expression,hashes)
  select p_organization_id,p_document_id,x.document_local_ref,x.source_offset,x.source_byte_end,x.source_path,x.source_line,x.original_name,x.normalized_name,x.original_version,x.normalized_version,x.original_purl,x.canonical_purl,x.cpe,x.ecosystem,x.scope,x.supplier,x.license_expression,coalesce(x.hashes,'[]'::jsonb) from jsonb_to_recordset(p_components) as x(document_local_ref text,source_offset bigint,source_byte_end bigint,source_path text,source_line integer,original_name text,normalized_name text,original_version text,normalized_version text,original_purl text,canonical_purl text,cpe text,ecosystem text,scope text,supplier text,license_expression text,hashes jsonb)
  on conflict (organization_id,document_id,document_local_ref) do update set source_offset=excluded.source_offset,source_byte_end=excluded.source_byte_end,source_path=excluded.source_path,source_line=excluded.source_line,original_name=excluded.original_name,normalized_name=excluded.normalized_name,original_version=excluded.original_version,normalized_version=excluded.normalized_version,original_purl=excluded.original_purl,canonical_purl=excluded.canonical_purl,cpe=excluded.cpe,ecosystem=excluded.ecosystem,scope=excluded.scope,supplier=excluded.supplier,license_expression=excluded.license_expression,hashes=excluded.hashes;
  insert into public.sbom_component_dependencies(organization_id,document_id,parent_component_id,child_component_id,parent_reference,child_reference,source_offset,source_byte_end,source_path,source_line)
  select p_organization_id,p_document_id,parent_component.id,child_component.id,x.parent_reference,x.child_reference,x.source_offset,x.source_byte_end,x.source_path,x.source_line from jsonb_to_recordset(p_edges) as x(parent_reference text,child_reference text,source_offset bigint,source_byte_end bigint,source_path text,source_line integer) left join public.sbom_components parent_component on parent_component.organization_id=p_organization_id and parent_component.document_id=p_document_id and parent_component.document_local_ref=x.parent_reference left join public.sbom_components child_component on child_component.organization_id=p_organization_id and child_component.document_id=p_document_id and child_component.document_local_ref=x.child_reference
  on conflict (organization_id,document_id,parent_reference,child_reference,edge_state) do update set source_offset=excluded.source_offset,source_byte_end=excluded.source_byte_end,source_path=excluded.source_path,source_line=excluded.source_line;
  select count(*) into v_component_count from public.sbom_components where organization_id=p_organization_id and document_id=p_document_id;
  if v_component_count>50000 then update public.sbom_documents set state='failed',progress_stage='failed',error_code='normalization_component_limit_exceeded',error_message='The document exceeds the configured component ceiling.' where organization_id=p_organization_id and id=p_document_id; update public.sbom_ingest_jobs set status='failed',progress_stage='failed',error_code='normalization_component_limit_exceeded',lease_owner=null,lease_expires_at=null where organization_id=p_organization_id and id=p_job_id; return query select 'failed'::text; return; end if;
  update public.sbom_documents set progress_stage='batching',progress_component_count=v_component_count,progress_dependency_count=(select count(*) from public.sbom_component_dependencies where organization_id=p_organization_id and document_id=p_document_id),checkpoint_source_offset=greatest(checkpoint_source_offset,p_source_offset),checkpoint_batch=checkpoint_batch+1,diagnostics=p_diagnostics where organization_id=p_organization_id and id=p_document_id;
  update public.sbom_ingest_jobs set progress_stage='batching',progress_percent=greatest(progress_percent,75) where organization_id=p_organization_id and id=p_job_id;
  return query select 'persisted'::text;
end;
$$;

alter function public.begin_sbom_document_normalization_atomic(uuid,uuid,text,text,text,text,text,text,text,text,jsonb) owner to postgres;
alter function public.persist_sbom_normalization_batch_atomic(uuid,uuid,text,uuid,jsonb,jsonb,jsonb,bigint) owner to postgres;
revoke all on function public.begin_sbom_document_normalization_atomic(uuid,uuid,text,text,text,text,text,text,text,text,jsonb),public.persist_sbom_normalization_batch_atomic(uuid,uuid,text,uuid,jsonb,jsonb,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.begin_sbom_document_normalization_atomic(uuid,uuid,text,text,text,text,text,text,text,text,jsonb),public.persist_sbom_normalization_batch_atomic(uuid,uuid,text,uuid,jsonb,jsonb,jsonb,bigint) to service_role;

-- Redeclare this body because the preceding migration is already present on
-- existing local stacks; the corrected JSON cursor expression is portable.
create or replace function public.list_sbom_dependency_tree(p_organization_id uuid,p_actor_user_id uuid,p_document_id uuid,p_parent_component_id uuid,p_q text,p_limit integer,p_cursor text) returns table(outcome text,result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$ declare v_rows jsonb; v_cursor uuid; begin if not public.sbom_actor_can_view(p_organization_id,p_actor_user_id) or p_limit not between 1 and 100 or not exists(select 1 from public.sbom_documents d where d.organization_id=p_organization_id and d.id=p_document_id and d.state='completed') then return query select 'not_found'::text,null::jsonb; return; end if; begin v_cursor:=nullif(p_cursor,'')::uuid; exception when invalid_text_representation then return query select 'invalid_request'::text,null::jsonb; return; end; select coalesce(jsonb_agg(jsonb_build_object('component',public.sbom_component_json(p_organization_id,x.id),'childCount',x.child_count) order by x.normalized_name,x.id),'[]'::jsonb) into v_rows from (select c.id,c.normalized_name,(select count(*) from public.sbom_components child where child.organization_id=p_organization_id and child.document_id=p_document_id and child.canonical_parent_component_id=c.id) child_count from public.sbom_components c where c.organization_id=p_organization_id and c.document_id=p_document_id and c.canonical_parent_component_id is not distinct from p_parent_component_id and (v_cursor is null or c.id>v_cursor) and (nullif(btrim(p_q),'') is null or c.normalized_name ilike '%'||btrim(p_q)||'%') order by c.normalized_name,c.id limit p_limit) x; return query select 'found'::text,jsonb_build_object('items',v_rows,'nextCursor',case when jsonb_array_length(v_rows)=p_limit then (v_rows->(p_limit-1)->'component')->>'id' else null end); end; $$;
