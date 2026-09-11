-- Worker-only normalization boundaries.  Rows remain private and every write
-- is pinned to an organization, live lease, and processing document.

create or replace function public.sbom_actor_can_view(p_organization_id uuid, p_actor_user_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.organization_members members
    join public.users users on users.id = members.user_id and users.is_active
    left join public.base_role_permission_overrides overrides
      on overrides.organization_id = members.organization_id and overrides.base_role = members.role
    where members.organization_id = p_organization_id and members.user_id = p_actor_user_id
      and coalesce(
        case when jsonb_typeof(overrides.permissions -> 'can_view_sboms') = 'boolean'
          then (overrides.permissions ->> 'can_view_sboms')::boolean end,
        true
      )
  );
$$;

create or replace function public.create_or_resume_sbom_document_normalization_atomic(
  p_organization_id uuid, p_job_id uuid, p_worker_id text, p_document_id uuid,
  p_format text, p_serialization text, p_specification_version text,
  p_parser_name text, p_parser_version text, p_normalizer_name text, p_normalizer_version text
) returns table(outcome text, document jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.sbom_ingest_jobs%rowtype; v_source public.sbom_sources%rowtype; v_document public.sbom_documents%rowtype;
begin
  if char_length(btrim(p_worker_id)) not between 1 and 100
    or p_format not in ('cyclonedx', 'spdx') or p_serialization not in ('json', 'json_ld', 'xml', 'tag_value')
    or char_length(btrim(coalesce(p_specification_version,''))) not between 1 and 40
    or char_length(btrim(coalesce(p_parser_name,''))) not between 1 and 120
    or char_length(btrim(coalesce(p_parser_version,''))) not between 1 and 80
    or char_length(btrim(coalesce(p_normalizer_name,''))) not between 1 and 120
    or char_length(btrim(coalesce(p_normalizer_version,''))) not between 1 and 80 then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  select * into v_job from public.sbom_ingest_jobs jobs where jobs.organization_id = p_organization_id and jobs.id = p_job_id
    and jobs.status = 'processing' and jobs.lease_owner = btrim(p_worker_id) and jobs.lease_expires_at > now() for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_job.validation_status not in ('valid', 'valid_with_warnings') then return query select 'invalid_state'::text, null::jsonb; return; end if;
  select * into v_source from public.sbom_sources sources where sources.organization_id = p_organization_id and sources.id = v_job.source_id and sources.status = 'verified' for share;
  if not found or v_source.raw_object_id is null then return query select 'not_found'::text, null::jsonb; return; end if;
  select * into v_document from public.sbom_documents documents where documents.organization_id = p_organization_id and documents.document_sha256 = v_job.input_sha256 and documents.normalizer_version = btrim(p_normalizer_version) for update;
  if found then
    if v_document.ingest_job_id <> p_job_id then return query select 'invalid_state'::text, public.sbom_document_json(p_organization_id, v_document.id); return; end if;
    return query select case when v_document.state = 'completed' then 'completed' else 'resumed' end, public.sbom_document_json(p_organization_id, v_document.id); return;
  end if;
  insert into public.sbom_documents(id, organization_id, source_id, raw_object_id, ingest_job_id, document_sha256, format, serialization, specification_version, parser_name, parser_version, normalizer_name, normalizer_version, validation_status, state, progress_stage)
  values (p_document_id, p_organization_id, v_source.id, v_source.raw_object_id, p_job_id, v_job.input_sha256, p_format, p_serialization, btrim(p_specification_version), btrim(p_parser_name), btrim(p_parser_version), btrim(p_normalizer_name), btrim(p_normalizer_version), v_job.validation_status, 'processing', 'parsing')
  returning * into v_document;
  insert into public.sbom_document_sources(organization_id, document_id, source_id, raw_object_id, release_id)
  values (p_organization_id, v_document.id, v_source.id, v_source.raw_object_id, v_source.release_id)
  on conflict (organization_id, document_id, source_id) do nothing;
  update public.sbom_ingest_jobs set progress_stage = 'parsing', progress_percent = greatest(progress_percent, 25) where organization_id = p_organization_id and id = p_job_id;
  return query select 'created'::text, public.sbom_document_json(p_organization_id, v_document.id);
end;
$$;

create or replace function public.persist_sbom_normalization_batch_atomic(
  p_organization_id uuid, p_job_id uuid, p_worker_id text, p_document_id uuid,
  p_components jsonb, p_identities jsonb, p_dependencies jsonb,
  p_checkpoint_source_offset bigint, p_checkpoint_batch integer
) returns table(outcome text, document jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_document public.sbom_documents%rowtype; v_component_count integer;
begin
  if jsonb_typeof(p_components) <> 'array' or jsonb_typeof(p_identities) <> 'array' or jsonb_typeof(p_dependencies) <> 'array'
    or p_checkpoint_source_offset < 0 or p_checkpoint_batch < 0 then return query select 'invalid_request'::text, null::jsonb; return; end if;
  if not exists (select 1 from public.sbom_ingest_jobs jobs where jobs.organization_id=p_organization_id and jobs.id=p_job_id and jobs.status='processing' and jobs.lease_owner=btrim(p_worker_id) and jobs.lease_expires_at>now()) then return query select 'not_found'::text,null::jsonb; return; end if;
  select * into v_document from public.sbom_documents documents where documents.organization_id=p_organization_id and documents.id=p_document_id and documents.ingest_job_id=p_job_id and documents.state='processing' for update;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  insert into public.sbom_components(organization_id, document_id, document_local_ref, source_offset, source_byte_end, source_path, source_line, original_name, normalized_name, original_version, normalized_version, original_purl, canonical_purl, cpe, ecosystem, scope, supplier, license_expression, hashes)
  select p_organization_id,p_document_id,x.document_local_ref,x.source_offset,x.source_byte_end,x.source_path,x.source_line,x.original_name,x.normalized_name,x.original_version,x.normalized_version,x.original_purl,x.canonical_purl,x.cpe,x.ecosystem,x.scope,x.supplier,x.license_expression,coalesce(x.hashes,'[]'::jsonb)
  from jsonb_to_recordset(p_components) as x(document_local_ref text,source_offset bigint,source_byte_end bigint,source_path text,source_line integer,original_name text,normalized_name text,original_version text,normalized_version text,original_purl text,canonical_purl text,cpe text,ecosystem text,scope text,supplier text,license_expression text,hashes jsonb)
  on conflict (organization_id,document_id,document_local_ref) do update set source_offset=excluded.source_offset,source_byte_end=excluded.source_byte_end,source_path=excluded.source_path,source_line=excluded.source_line,original_name=excluded.original_name,normalized_name=excluded.normalized_name,original_version=excluded.original_version,normalized_version=excluded.normalized_version,original_purl=excluded.original_purl,canonical_purl=excluded.canonical_purl,cpe=excluded.cpe,ecosystem=excluded.ecosystem,scope=excluded.scope,supplier=excluded.supplier,license_expression=excluded.license_expression,hashes=excluded.hashes;
  insert into public.sbom_component_identities(organization_id,document_id,component_id,identity_type,original_value,canonical_value)
  select p_organization_id,p_document_id,c.id,x.identity_type,x.original_value,x.canonical_value from jsonb_to_recordset(p_identities) as x(document_local_ref text,identity_type text,original_value text,canonical_value text) join public.sbom_components c on c.organization_id=p_organization_id and c.document_id=p_document_id and c.document_local_ref=x.document_local_ref
  on conflict (organization_id,document_id,component_id,identity_type,original_value) do update set canonical_value=excluded.canonical_value;
  insert into public.sbom_component_dependencies(organization_id,document_id,parent_component_id,child_component_id,parent_reference,child_reference,source_offset,source_byte_end,source_path,source_line)
  select p_organization_id,p_document_id,parent_component.id,child_component.id,x.parent_reference,x.child_reference,x.source_offset,x.source_byte_end,x.source_path,x.source_line from jsonb_to_recordset(p_dependencies) as x(parent_reference text,child_reference text,source_offset bigint,source_byte_end bigint,source_path text,source_line integer) left join public.sbom_components parent_component on parent_component.organization_id=p_organization_id and parent_component.document_id=p_document_id and parent_component.document_local_ref=x.parent_reference left join public.sbom_components child_component on child_component.organization_id=p_organization_id and child_component.document_id=p_document_id and child_component.document_local_ref=x.child_reference
  on conflict (organization_id,document_id,parent_reference,child_reference,edge_state) do update set source_offset=excluded.source_offset,source_byte_end=excluded.source_byte_end,source_path=excluded.source_path,source_line=excluded.source_line;
  select count(*) into v_component_count from public.sbom_components where organization_id=p_organization_id and document_id=p_document_id;
  if v_component_count > 50000 then return query select 'invalid_state'::text,public.sbom_document_json(p_organization_id,p_document_id); return; end if;
  update public.sbom_documents set progress_stage='batching',progress_component_count=v_component_count,progress_dependency_count=(select count(*) from public.sbom_component_dependencies where organization_id=p_organization_id and document_id=p_document_id),checkpoint_source_offset=greatest(checkpoint_source_offset,p_checkpoint_source_offset),checkpoint_batch=greatest(checkpoint_batch,p_checkpoint_batch) where organization_id=p_organization_id and id=p_document_id;
  update public.sbom_ingest_jobs set progress_stage='batching',progress_percent=greatest(progress_percent,75) where organization_id=p_organization_id and id=p_job_id;
  return query select 'persisted'::text,public.sbom_document_json(p_organization_id,p_document_id);
end;
$$;

-- Read RPCs require the same effective can_view_sboms gate as the API. Custom
-- roles are additive; only the organization base-role override can revoke it.
create or replace function public.list_sbom_documents_for_release(p_organization_id uuid, p_actor_user_id uuid, p_product_id uuid, p_release_id uuid, p_limit integer, p_cursor text)
returns table(outcome text, result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_rows jsonb; v_cursor uuid; begin
  if not public.sbom_actor_can_view(p_organization_id,p_actor_user_id) or p_limit not between 1 and 100 or not exists(select 1 from public.product_releases r where r.organization_id=p_organization_id and r.product_id=p_product_id and r.id=p_release_id) then return query select 'not_found'::text,null::jsonb; return; end if;
  begin v_cursor := nullif(p_cursor,'')::uuid; exception when invalid_text_representation then return query select 'invalid_request'::text,null::jsonb; return; end;
  select coalesce(jsonb_agg(public.sbom_document_json(p_organization_id,x.id) order by x.created_at desc,x.id desc),'[]'::jsonb) into v_rows from (select distinct d.id,d.created_at from public.sbom_documents d join public.sbom_document_sources ds on ds.organization_id=d.organization_id and ds.document_id=d.id where d.organization_id=p_organization_id and ds.release_id=p_release_id and (v_cursor is null or d.id<v_cursor) order by d.created_at desc,d.id desc limit p_limit) x;
  return query select 'found'::text,jsonb_build_object('documents',v_rows,'nextCursor',case when jsonb_array_length(v_rows)=p_limit then v_rows->(p_limit-1)->>'id' else null end); end;
$$;

create or replace function public.get_sbom_document(p_organization_id uuid,p_actor_user_id uuid,p_document_id uuid) returns table(outcome text,result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$ begin if not public.sbom_actor_can_view(p_organization_id,p_actor_user_id) or not exists(select 1 from public.sbom_documents d where d.organization_id=p_organization_id and d.id=p_document_id) then return query select 'not_found'::text,null::jsonb; return; end if; return query select 'found'::text,jsonb_build_object('document',public.sbom_document_json(p_organization_id,p_document_id),'diagnostics',(select diagnostics from public.sbom_documents where organization_id=p_organization_id and id=p_document_id)); end; $$;
create or replace function public.search_sbom_components(p_organization_id uuid,p_actor_user_id uuid,p_document_id uuid,p_q text,p_limit integer,p_cursor text) returns table(outcome text,result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$ declare v_rows jsonb; v_cursor uuid; begin if not public.sbom_actor_can_view(p_organization_id,p_actor_user_id) or p_limit not between 1 and 100 or not exists(select 1 from public.sbom_documents d where d.organization_id=p_organization_id and d.id=p_document_id and d.state='completed') then return query select 'not_found'::text,null::jsonb; return; end if; begin v_cursor:=nullif(p_cursor,'')::uuid; exception when invalid_text_representation then return query select 'invalid_request'::text,null::jsonb; return; end; select coalesce(jsonb_agg(public.sbom_component_json(p_organization_id,x.id) order by x.normalized_name,x.id),'[]'::jsonb) into v_rows from (select c.id,c.normalized_name from public.sbom_components c where c.organization_id=p_organization_id and c.document_id=p_document_id and (v_cursor is null or c.id>v_cursor) and (nullif(btrim(p_q),'') is null or c.normalized_name ilike '%'||btrim(p_q)||'%' or c.canonical_purl ilike '%'||btrim(p_q)||'%') order by c.normalized_name,c.id limit p_limit) x; return query select 'found'::text,jsonb_build_object('components',v_rows,'nextCursor',case when jsonb_array_length(v_rows)=p_limit then v_rows->(p_limit-1)->>'id' else null end); end; $$;
create or replace function public.list_sbom_dependency_tree(p_organization_id uuid,p_actor_user_id uuid,p_document_id uuid,p_parent_component_id uuid,p_q text,p_limit integer,p_cursor text) returns table(outcome text,result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$ declare v_rows jsonb; v_cursor uuid; begin if not public.sbom_actor_can_view(p_organization_id,p_actor_user_id) or p_limit not between 1 and 100 or not exists(select 1 from public.sbom_documents d where d.organization_id=p_organization_id and d.id=p_document_id and d.state='completed') then return query select 'not_found'::text,null::jsonb; return; end if; begin v_cursor:=nullif(p_cursor,'')::uuid; exception when invalid_text_representation then return query select 'invalid_request'::text,null::jsonb; return; end; select coalesce(jsonb_agg(jsonb_build_object('component',public.sbom_component_json(p_organization_id,x.id),'childCount',x.child_count) order by x.normalized_name,x.id),'[]'::jsonb) into v_rows from (select c.id,c.normalized_name,(select count(*) from public.sbom_components child where child.organization_id=p_organization_id and child.document_id=p_document_id and child.canonical_parent_component_id=c.id) child_count from public.sbom_components c where c.organization_id=p_organization_id and c.document_id=p_document_id and c.canonical_parent_component_id is not distinct from p_parent_component_id and (v_cursor is null or c.id>v_cursor) and (nullif(btrim(p_q),'') is null or c.normalized_name ilike '%'||btrim(p_q)||'%') order by c.normalized_name,c.id limit p_limit) x; return query select 'found'::text,jsonb_build_object('items',v_rows,'nextCursor',case when jsonb_array_length(v_rows)=p_limit then (v_rows->(p_limit-1)->'component')->>'id' else null end); end; $$;

alter function public.sbom_actor_can_view(uuid,uuid) owner to postgres;
alter function public.create_or_resume_sbom_document_normalization_atomic(uuid,uuid,text,uuid,text,text,text,text,text,text,text) owner to postgres;
alter function public.persist_sbom_normalization_batch_atomic(uuid,uuid,text,uuid,jsonb,jsonb,jsonb,bigint,integer) owner to postgres;
revoke all on function public.sbom_actor_can_view(uuid,uuid), public.create_or_resume_sbom_document_normalization_atomic(uuid,uuid,text,uuid,text,text,text,text,text,text,text), public.persist_sbom_normalization_batch_atomic(uuid,uuid,text,uuid,jsonb,jsonb,jsonb,bigint,integer) from public,anon,authenticated;
grant execute on function public.create_or_resume_sbom_document_normalization_atomic(uuid,uuid,text,uuid,text,text,text,text,text,text,text), public.persist_sbom_normalization_batch_atomic(uuid,uuid,text,uuid,jsonb,jsonb,jsonb,bigint,integer) to service_role;
