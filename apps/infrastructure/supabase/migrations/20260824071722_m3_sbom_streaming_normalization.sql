-- M3-03 streaming normalization. Raw source evidence remains immutable; the
-- normalized graph is private until the document is atomically completed.
-- The 50k component ceiling is deliberately encoded in constraints rather than
-- table partitioning: tenant-leading B-tree indexes are the operationally
-- simpler choice until sustained multi-million component row volumes.

alter table public.sbom_ingest_jobs
  drop constraint if exists sbom_ingest_jobs_state_check,
  drop constraint if exists sbom_ingest_jobs_error_code_check,
  add constraint sbom_ingest_jobs_error_code_check check (error_code is null or error_code in (
    'provider_unavailable', 'source_missing', 'content_hash_mismatch', 'storage_timeout',
    'authorization_changed', 'unknown_failure', 'invalid_sbom',
    'normalization_byte_limit_exceeded', 'normalization_component_limit_exceeded',
    'normalization_failed'
  )),
  add constraint sbom_ingest_jobs_state_check check (
    (status = 'queued' and progress_stage = 'queued' and completed_at is null and dead_lettered_at is null)
    or (status = 'processing' and progress_stage in (
      'claiming', 'verifying_original', 'recording_evidence', 'parsing', 'batching', 'resolving_graph'
    ) and completed_at is null and dead_lettered_at is null)
    or (status = 'failed' and progress_stage = 'failed' and completed_at is null and dead_lettered_at is null)
    or (status = 'completed' and progress_stage = 'completed' and progress_percent = 100 and completed_at is not null and dead_lettered_at is null)
    or (status = 'dead_letter' and progress_stage = 'dead_letter' and completed_at is null and dead_lettered_at is not null)
  );

create table public.sbom_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_id uuid not null,
  raw_object_id uuid not null,
  ingest_job_id uuid not null,
  document_sha256 text not null check (document_sha256 ~ '^[a-f0-9]{64}$'),
  format text not null check (format in ('cyclonedx', 'spdx')),
  serialization text not null check (serialization in ('json', 'json_ld', 'xml', 'tag_value')),
  specification_version text not null check (char_length(btrim(specification_version)) between 1 and 40 and specification_version = btrim(specification_version)),
  parser_name text not null check (char_length(btrim(parser_name)) between 1 and 120 and parser_name = btrim(parser_name)),
  parser_version text not null check (char_length(btrim(parser_version)) between 1 and 80 and parser_version = btrim(parser_version)),
  normalizer_name text not null check (char_length(btrim(normalizer_name)) between 1 and 120 and normalizer_name = btrim(normalizer_name)),
  normalizer_version text not null check (char_length(btrim(normalizer_version)) between 1 and 80 and normalizer_version = btrim(normalizer_version)),
  validation_status text not null check (validation_status in ('valid', 'valid_with_warnings', 'invalid')),
  state text not null default 'queued' constraint sbom_documents_state_value_check check (state in ('queued', 'processing', 'completed', 'failed')),
  progress_stage text not null default 'queued' check (progress_stage in ('queued', 'parsing', 'batching', 'resolving_graph', 'completed', 'failed')),
  progress_component_count integer not null default 0 check (progress_component_count between 0 and 50000),
  progress_dependency_count integer not null default 0 check (progress_dependency_count >= 0),
  checkpoint_source_offset bigint not null default 0 check (checkpoint_source_offset >= 0),
  checkpoint_batch integer not null default 0 check (checkpoint_batch >= 0),
  component_count integer not null default 0 check (component_count between 0 and 50000),
  dependency_count integer not null default 0 check (dependency_count >= 0),
  maximum_depth integer not null default 0 check (maximum_depth between 0 and 50000),
  warning_count integer not null default 0 check (warning_count >= 0),
  diagnostics jsonb not null default '[]'::jsonb check (
    jsonb_typeof(diagnostics) = 'array' and jsonb_array_length(diagnostics) <= 100 and octet_length(diagnostics::text) <= 524288
  ),
  omitted_diagnostic_count integer not null default 0 check (omitted_diagnostic_count >= 0),
  error_code text check (error_code is null or char_length(btrim(error_code)) between 1 and 120),
  error_message text check (error_message is null or char_length(btrim(error_message)) between 1 and 1000),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, document_sha256, normalizer_version),
  constraint sbom_documents_source_fkey foreign key (organization_id, source_id)
    references public.sbom_sources(organization_id, id) on delete restrict,
  constraint sbom_documents_raw_object_fkey foreign key (organization_id, raw_object_id)
    references public.sbom_raw_objects(organization_id, id) on delete restrict,
  constraint sbom_documents_job_fkey foreign key (organization_id, ingest_job_id)
    references public.sbom_ingest_jobs(organization_id, id) on delete restrict,
  constraint sbom_documents_state_check check (
    (state = 'queued' and progress_stage = 'queued' and completed_at is null and error_code is null and error_message is null)
    or (state = 'processing' and progress_stage in ('parsing', 'batching', 'resolving_graph') and completed_at is null and error_code is null and error_message is null)
    or (state = 'completed' and progress_stage = 'completed' and completed_at is not null and error_code is null and error_message is null)
    or (state = 'failed' and progress_stage = 'failed' and completed_at is null and error_code is not null and error_message is not null)
  )
);

create table public.sbom_document_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null,
  source_id uuid not null,
  raw_object_id uuid not null,
  release_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, document_id, source_id),
  constraint sbom_document_sources_document_fkey foreign key (organization_id, document_id)
    references public.sbom_documents(organization_id, id) on delete cascade,
  constraint sbom_document_sources_source_fkey foreign key (organization_id, source_id)
    references public.sbom_sources(organization_id, id) on delete restrict,
  constraint sbom_document_sources_raw_object_fkey foreign key (organization_id, raw_object_id)
    references public.sbom_raw_objects(organization_id, id) on delete restrict
);

create table public.sbom_components (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null,
  document_local_ref text not null check (char_length(btrim(document_local_ref)) between 1 and 1024 and document_local_ref = btrim(document_local_ref)),
  source_offset bigint not null check (source_offset >= 0),
  source_path text not null check (char_length(btrim(source_path)) between 1 and 1000 and source_path = btrim(source_path)),
  source_line integer check (source_line is null or source_line >= 1),
  source_byte_end bigint not null check (source_byte_end >= source_offset),
  original_name text not null check (char_length(btrim(original_name)) between 1 and 1024),
  normalized_name text not null check (char_length(btrim(normalized_name)) between 1 and 1024),
  original_version text check (original_version is null or char_length(original_version) <= 1024),
  normalized_version text check (normalized_version is null or char_length(normalized_version) <= 1024),
  original_purl text check (original_purl is null or char_length(original_purl) <= 4096),
  canonical_purl text check (canonical_purl is null or char_length(canonical_purl) <= 4096),
  cpe text check (cpe is null or char_length(cpe) <= 4096),
  ecosystem text check (ecosystem is null or char_length(btrim(ecosystem)) between 1 and 120),
  scope text check (scope is null or char_length(btrim(scope)) between 1 and 120),
  supplier text check (supplier is null or char_length(btrim(supplier)) between 1 and 1024),
  license_expression text check (license_expression is null or char_length(license_expression) <= 4096),
  hashes jsonb not null default '[]'::jsonb check (jsonb_typeof(hashes) = 'array' and jsonb_array_length(hashes) <= 100 and octet_length(hashes::text) <= 131072),
  depth integer not null default 0 check (depth between 0 and 50000),
  canonical_parent_component_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, document_id, id),
  unique (organization_id, document_id, document_local_ref),
  constraint sbom_components_document_fkey foreign key (organization_id, document_id)
    references public.sbom_documents(organization_id, id) on delete cascade,
  constraint sbom_components_parent_fkey foreign key (organization_id, document_id, canonical_parent_component_id)
    references public.sbom_components(organization_id, document_id, id) on delete restrict,
  constraint sbom_components_parent_not_self check (canonical_parent_component_id is null or canonical_parent_component_id <> id)
);

create table public.sbom_component_identities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null,
  component_id uuid not null,
  identity_type text not null check (identity_type in ('purl', 'cpe', 'bom_ref', 'spdx_id', 'other')),
  original_value text not null check (char_length(original_value) between 1 and 4096),
  canonical_value text check (canonical_value is null or char_length(canonical_value) <= 4096),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, document_id, component_id, identity_type, original_value),
  constraint sbom_component_identities_component_fkey foreign key (organization_id, document_id, component_id)
    references public.sbom_components(organization_id, document_id, id) on delete cascade
);

create table public.sbom_component_dependencies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null,
  parent_component_id uuid,
  child_component_id uuid,
  parent_reference text not null check (char_length(btrim(parent_reference)) between 1 and 1024),
  child_reference text not null check (char_length(btrim(child_reference)) between 1 and 1024),
  source_offset bigint not null check (source_offset >= 0),
  source_byte_end bigint not null check (source_byte_end >= source_offset),
  source_path text not null check (char_length(btrim(source_path)) between 1 and 1000),
  source_line integer check (source_line is null or source_line >= 1),
  edge_state text not null default 'candidate' check (edge_state in ('candidate', 'retained', 'omitted')),
  omission_code text check (omission_code is null or omission_code in ('missing_dependency_reference', 'duplicate_dependency_edge', 'self_dependency_edge', 'cycle_dependency_edge')),
  omission_message text check (omission_message is null or char_length(omission_message) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, document_id, parent_reference, child_reference, edge_state),
  constraint sbom_component_dependencies_document_fkey foreign key (organization_id, document_id)
    references public.sbom_documents(organization_id, id) on delete cascade,
  constraint sbom_component_dependencies_parent_fkey foreign key (organization_id, document_id, parent_component_id)
    references public.sbom_components(organization_id, document_id, id) on delete cascade,
  constraint sbom_component_dependencies_child_fkey foreign key (organization_id, document_id, child_component_id)
    references public.sbom_components(organization_id, document_id, id) on delete cascade,
  constraint sbom_component_dependencies_state_check check (
    (edge_state = 'candidate' and omission_code is null and omission_message is null)
    or (edge_state = 'retained' and omission_code is null and omission_message is null and parent_component_id is not null and child_component_id is not null)
    or (edge_state = 'omitted' and omission_code is not null and omission_message is not null)
  )
);

create index sbom_documents_org_release_created_idx on public.sbom_documents(organization_id, source_id, created_at desc);
create index sbom_document_sources_org_release_document_idx on public.sbom_document_sources(organization_id, release_id, document_id);
create index sbom_components_org_canonical_purl_idx on public.sbom_components(organization_id, canonical_purl) where canonical_purl is not null;
create index sbom_components_org_name_version_idx on public.sbom_components(organization_id, normalized_name, normalized_version);
create index sbom_components_document_depth_idx on public.sbom_components(organization_id, document_id, depth, source_offset, id);
create index sbom_component_identities_local_lookup_idx on public.sbom_component_identities(organization_id, document_id, original_value, identity_type);
create index sbom_component_dependencies_parent_child_idx on public.sbom_component_dependencies(organization_id, document_id, parent_component_id, child_component_id) where edge_state = 'retained';
create index sbom_component_dependencies_child_parent_idx on public.sbom_component_dependencies(organization_id, document_id, child_component_id, parent_component_id) where edge_state = 'retained';

alter table public.sbom_documents enable row level security;
alter table public.sbom_document_sources enable row level security;
alter table public.sbom_components enable row level security;
alter table public.sbom_component_identities enable row level security;
alter table public.sbom_component_dependencies enable row level security;

-- Explicit policies document the tenant-member rule; browser roles still have
-- no table grants, so all reads remain mediated by the API service role.
create policy sbom_documents_select_member on public.sbom_documents for select to authenticated using (public.user_is_member_of(organization_id));
create policy sbom_document_sources_select_member on public.sbom_document_sources for select to authenticated using (public.user_is_member_of(organization_id));
create policy sbom_components_select_member on public.sbom_components for select to authenticated using (public.user_is_member_of(organization_id));
create policy sbom_component_identities_select_member on public.sbom_component_identities for select to authenticated using (public.user_is_member_of(organization_id));
create policy sbom_component_dependencies_select_member on public.sbom_component_dependencies for select to authenticated using (public.user_is_member_of(organization_id));
revoke all on public.sbom_documents, public.sbom_document_sources, public.sbom_components,
  public.sbom_component_identities, public.sbom_component_dependencies from public, anon, authenticated;
grant select, insert, update, delete on public.sbom_documents, public.sbom_document_sources, public.sbom_components,
  public.sbom_component_identities, public.sbom_component_dependencies to service_role;

create trigger set_sbom_documents_updated_at before update on public.sbom_documents for each row execute function public.set_updated_at();
create trigger set_sbom_document_sources_updated_at before update on public.sbom_document_sources for each row execute function public.set_updated_at();
create trigger set_sbom_components_updated_at before update on public.sbom_components for each row execute function public.set_updated_at();
create trigger set_sbom_component_identities_updated_at before update on public.sbom_component_identities for each row execute function public.set_updated_at();
create trigger set_sbom_component_dependencies_updated_at before update on public.sbom_component_dependencies for each row execute function public.set_updated_at();

create or replace function public.sbom_document_json(p_organization_id uuid, p_document_id uuid)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', d.id, 'sourceId', d.source_id, 'format', d.format, 'specificationVersion', d.specification_version,
    'parser', jsonb_build_object('name', d.parser_name, 'version', d.parser_version),
    'normalizer', jsonb_build_object('name', d.normalizer_name, 'version', d.normalizer_version),
    'state', d.state, 'validationStatus', d.validation_status, 'componentCount', d.component_count,
    'dependencyCount', d.dependency_count, 'maximumDepth', d.maximum_depth, 'warningCount', d.warning_count,
    'error', case when d.error_code is null then null else jsonb_build_object('code', d.error_code, 'message', d.error_message, 'retryable', d.state = 'failed') end,
    'completedAt', d.completed_at, 'createdAt', d.created_at, 'updatedAt', d.updated_at
  ) from public.sbom_documents d where d.organization_id = p_organization_id and d.id = p_document_id;
$$;

create or replace function public.sbom_component_json(p_organization_id uuid, p_component_id uuid)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', c.id, 'documentId', c.document_id, 'documentLocalRef', c.document_local_ref,
    'originalName', c.original_name, 'normalizedName', c.normalized_name, 'originalVersion', c.original_version,
    'normalizedVersion', c.normalized_version, 'originalPurl', c.original_purl, 'canonicalPurl', c.canonical_purl,
    'cpe', c.cpe, 'ecosystem', c.ecosystem, 'scope', c.scope, 'supplier', c.supplier,
    'licenseExpression', c.license_expression, 'hashes', c.hashes, 'depth', c.depth,
    'parentComponentId', c.canonical_parent_component_id,
    'sourceLocation', jsonb_build_object('path', c.source_path, 'byteStart', c.source_offset, 'byteEnd', c.source_byte_end, 'line', c.source_line)
  ) from public.sbom_components c where c.organization_id = p_organization_id and c.id = p_component_id;
$$;

create or replace function public.finalize_sbom_document_normalization_atomic(
  p_organization_id uuid, p_job_id uuid, p_worker_id text, p_document_id uuid
) returns table(outcome text, document jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.sbom_ingest_jobs%rowtype; v_document public.sbom_documents%rowtype; v_edge record; v_cycle boolean; v_components integer; v_dependencies integer; v_warnings integer; v_depth integer;
begin
  if char_length(btrim(p_worker_id)) not between 1 and 100 then return query select 'invalid_request'::text, null::jsonb; return; end if;
  select * into v_job from public.sbom_ingest_jobs j where j.organization_id = p_organization_id and j.id = p_job_id
    and (j.status = 'completed' or (j.status = 'processing' and j.lease_owner = btrim(p_worker_id) and j.lease_expires_at > now())) for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  select * into v_document from public.sbom_documents d where d.organization_id = p_organization_id and d.id = p_document_id and d.ingest_job_id = p_job_id for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_document.state = 'completed' and v_job.status = 'completed' then return query select 'completed'::text, public.sbom_document_json(p_organization_id, p_document_id); return; end if;
  if v_document.validation_status not in ('valid', 'valid_with_warnings') or v_document.state not in ('queued', 'processing') then return query select 'invalid_state'::text, public.sbom_document_json(p_organization_id, p_document_id); return; end if;
  if not exists (select 1 from public.sbom_sources s where s.organization_id = p_organization_id and s.id = v_document.source_id and s.raw_object_id = v_document.raw_object_id and s.status = 'verified') then return query select 'not_found'::text, null::jsonb; return; end if;
  select count(*) into v_components from public.sbom_components c where c.organization_id = p_organization_id and c.document_id = p_document_id;
  if v_components > 50000 then return query select 'invalid_state'::text, public.sbom_document_json(p_organization_id, p_document_id); return; end if;
  update public.sbom_component_dependencies e set edge_state = 'omitted', omission_code = 'missing_dependency_reference', omission_message = 'Dependency reference is not present in this document.'
   where e.organization_id = p_organization_id and e.document_id = p_document_id and e.edge_state = 'candidate' and (e.parent_component_id is null or e.child_component_id is null);
  update public.sbom_component_dependencies e set edge_state = 'omitted', omission_code = 'self_dependency_edge', omission_message = 'A component cannot depend on itself.'
   where e.organization_id = p_organization_id and e.document_id = p_document_id and e.edge_state = 'candidate' and e.parent_component_id = e.child_component_id;
  for v_edge in select e.* from public.sbom_component_dependencies e where e.organization_id = p_organization_id and e.document_id = p_document_id and e.edge_state = 'candidate' order by e.source_offset, e.parent_reference, e.child_reference, e.id loop
    if exists (select 1 from public.sbom_component_dependencies previous where previous.organization_id = p_organization_id and previous.document_id = p_document_id and previous.edge_state = 'retained' and previous.parent_component_id = v_edge.parent_component_id and previous.child_component_id = v_edge.child_component_id) then
      update public.sbom_component_dependencies set edge_state = 'omitted', omission_code = 'duplicate_dependency_edge', omission_message = 'Duplicate dependency edge was omitted deterministically.' where organization_id = p_organization_id and id = v_edge.id;
    else
      with recursive reachable(component_id, depth) as (
        select e.child_component_id, 1 from public.sbom_component_dependencies e where e.organization_id = p_organization_id and e.document_id = p_document_id and e.edge_state = 'retained' and e.parent_component_id = v_edge.child_component_id
        union all
        select e.child_component_id, r.depth + 1 from reachable r join public.sbom_component_dependencies e on e.organization_id = p_organization_id and e.document_id = p_document_id and e.edge_state = 'retained' and e.parent_component_id = r.component_id where r.depth < 50000
      ) select exists(select 1 from reachable where component_id = v_edge.parent_component_id) into v_cycle;
      if v_cycle then update public.sbom_component_dependencies set edge_state = 'omitted', omission_code = 'cycle_dependency_edge', omission_message = 'Cycle-forming dependency edge was omitted deterministically.' where organization_id = p_organization_id and id = v_edge.id;
      else update public.sbom_component_dependencies set edge_state = 'retained' where organization_id = p_organization_id and id = v_edge.id; end if;
    end if;
  end loop;
  update public.sbom_components set canonical_parent_component_id = null, depth = 0 where organization_id = p_organization_id and document_id = p_document_id;
  with recursive parent_choice as (
    select distinct on (e.child_component_id) e.child_component_id, e.parent_component_id from public.sbom_component_dependencies e where e.organization_id = p_organization_id and e.document_id = p_document_id and e.edge_state = 'retained' order by e.child_component_id, e.source_offset, e.parent_reference, e.id
  ), walk(component_id, parent_component_id, depth) as (
    select c.id, null::uuid, 0 from public.sbom_components c where c.organization_id = p_organization_id and c.document_id = p_document_id and not exists (select 1 from parent_choice p where p.child_component_id = c.id)
    union all
    select p.child_component_id, p.parent_component_id, w.depth + 1 from walk w join parent_choice p on p.parent_component_id = w.component_id where w.depth < 50000
  ) update public.sbom_components c set canonical_parent_component_id = w.parent_component_id, depth = w.depth from walk w where c.organization_id = p_organization_id and c.document_id = p_document_id and c.id = w.component_id;
  select count(*) into v_dependencies from public.sbom_component_dependencies e where e.organization_id = p_organization_id and e.document_id = p_document_id and e.edge_state = 'retained';
  select count(*) into v_warnings from public.sbom_component_dependencies e where e.organization_id = p_organization_id and e.document_id = p_document_id and e.edge_state = 'omitted';
  select coalesce(max(depth), 0) into v_depth from public.sbom_components c where c.organization_id = p_organization_id and c.document_id = p_document_id;
  update public.sbom_documents set state = 'completed', progress_stage = 'completed', progress_component_count = v_components, progress_dependency_count = v_dependencies, component_count = v_components, dependency_count = v_dependencies, maximum_depth = v_depth, warning_count = warning_count + v_warnings, completed_at = now() where organization_id = p_organization_id and id = p_document_id;
  update public.sbom_ingest_jobs set status = 'completed', progress_stage = 'completed', progress_percent = 100, lease_owner = null, lease_expires_at = null, completed_at = now() where organization_id = p_organization_id and id = p_job_id;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes) values (p_organization_id, v_job.actor_user_id, 'sbom.normalization_completed', 'sbom_document', p_document_id::text, jsonb_build_object('sourceId', v_document.source_id, 'componentCount', v_components, 'dependencyCount', v_dependencies, 'maximumDepth', v_depth, 'correlationId', v_job.correlation_id));
  return query select 'completed'::text, public.sbom_document_json(p_organization_id, p_document_id);
end;
$$;

create or replace function public.list_sbom_documents_for_release(p_organization_id uuid, p_actor_user_id uuid, p_product_id uuid, p_release_id uuid, p_limit integer, p_cursor text)
returns table(outcome text, result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_rows jsonb; v_cursor uuid; begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id) or p_limit not between 1 and 100 or not exists(select 1 from public.product_releases r where r.organization_id=p_organization_id and r.product_id=p_product_id and r.id=p_release_id) then return query select 'not_found'::text,null::jsonb; return; end if;
  begin v_cursor := nullif(p_cursor, '')::uuid; exception when invalid_text_representation then return query select 'invalid_request'::text,null::jsonb; return; end;
  select coalesce(jsonb_agg(public.sbom_document_json(p_organization_id, x.id) order by x.created_at desc, x.id desc),'[]'::jsonb) into v_rows from (select d.id,d.created_at from public.sbom_documents d join public.sbom_document_sources ds on ds.organization_id=d.organization_id and ds.document_id=d.id where d.organization_id=p_organization_id and ds.release_id=p_release_id and (v_cursor is null or d.id < v_cursor) order by d.created_at desc,d.id desc limit p_limit) x;
  return query select 'found'::text,jsonb_build_object('documents',v_rows,'nextCursor',case when jsonb_array_length(v_rows)=p_limit then v_rows->(p_limit-1)->>'id' else null end); end;
$$;

create or replace function public.get_sbom_document(p_organization_id uuid, p_actor_user_id uuid, p_document_id uuid)
returns table(outcome text, result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
begin if not public.m2_active_member(p_organization_id,p_actor_user_id) or not exists(select 1 from public.sbom_documents d where d.organization_id=p_organization_id and d.id=p_document_id) then return query select 'not_found'::text,null::jsonb; return; end if; return query select 'found'::text,jsonb_build_object('document',public.sbom_document_json(p_organization_id,p_document_id),'diagnostics',(select diagnostics from public.sbom_documents where organization_id=p_organization_id and id=p_document_id)); end;
$$;

create or replace function public.search_sbom_components(p_organization_id uuid, p_actor_user_id uuid, p_document_id uuid, p_q text, p_limit integer, p_cursor text)
returns table(outcome text, result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_rows jsonb; v_cursor uuid; begin
  if not public.m2_active_member(p_organization_id,p_actor_user_id) or p_limit not between 1 and 100 or not exists(select 1 from public.sbom_documents d where d.organization_id=p_organization_id and d.id=p_document_id and d.state='completed') then return query select 'not_found'::text,null::jsonb; return; end if;
  begin v_cursor := nullif(p_cursor,'')::uuid; exception when invalid_text_representation then return query select 'invalid_request'::text,null::jsonb; return; end;
  select coalesce(jsonb_agg(public.sbom_component_json(p_organization_id,x.id) order by x.normalized_name,x.id),'[]'::jsonb) into v_rows from (select c.id,c.normalized_name from public.sbom_components c where c.organization_id=p_organization_id and c.document_id=p_document_id and (v_cursor is null or c.id>v_cursor) and (nullif(btrim(p_q),'') is null or c.normalized_name ilike '%'||btrim(p_q)||'%' or c.canonical_purl ilike '%'||btrim(p_q)||'%') order by c.normalized_name,c.id limit p_limit) x;
  return query select 'found'::text,jsonb_build_object('components',v_rows,'nextCursor',case when jsonb_array_length(v_rows)=p_limit then v_rows->(p_limit-1)->>'id' else null end); end;
$$;

create or replace function public.list_sbom_dependency_tree(p_organization_id uuid, p_actor_user_id uuid, p_document_id uuid, p_parent_component_id uuid, p_q text, p_limit integer, p_cursor text)
returns table(outcome text, result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_rows jsonb; v_cursor uuid; begin
  if not public.m2_active_member(p_organization_id,p_actor_user_id) or p_limit not between 1 and 100 or not exists(select 1 from public.sbom_documents d where d.organization_id=p_organization_id and d.id=p_document_id and d.state='completed') then return query select 'not_found'::text,null::jsonb; return; end if;
  begin v_cursor := nullif(p_cursor,'')::uuid; exception when invalid_text_representation then return query select 'invalid_request'::text,null::jsonb; return; end;
  select coalesce(jsonb_agg(jsonb_build_object('component',public.sbom_component_json(p_organization_id,x.id),'childCount',x.child_count) order by x.normalized_name,x.id),'[]'::jsonb) into v_rows from (select c.id,c.normalized_name,(select count(*) from public.sbom_components child where child.organization_id=p_organization_id and child.document_id=p_document_id and child.canonical_parent_component_id=c.id) child_count from public.sbom_components c where c.organization_id=p_organization_id and c.document_id=p_document_id and c.canonical_parent_component_id is not distinct from p_parent_component_id and (v_cursor is null or c.id>v_cursor) and (nullif(btrim(p_q),'') is null or c.normalized_name ilike '%'||btrim(p_q)||'%') order by c.normalized_name,c.id limit p_limit) x;
  return query select 'found'::text,jsonb_build_object('items',v_rows,'nextCursor',case when jsonb_array_length(v_rows)=p_limit then v_rows->(p_limit-1)->>'component'->>'id' else null end); end;
$$;

alter function public.sbom_document_json(uuid, uuid) owner to postgres;
alter function public.sbom_component_json(uuid, uuid) owner to postgres;
alter function public.finalize_sbom_document_normalization_atomic(uuid, uuid, text, uuid) owner to postgres;
alter function public.list_sbom_documents_for_release(uuid, uuid, uuid, uuid, integer, text) owner to postgres;
alter function public.get_sbom_document(uuid, uuid, uuid) owner to postgres;
alter function public.search_sbom_components(uuid, uuid, uuid, text, integer, text) owner to postgres;
alter function public.list_sbom_dependency_tree(uuid, uuid, uuid, uuid, text, integer, text) owner to postgres;
revoke all on function public.sbom_document_json(uuid, uuid), public.sbom_component_json(uuid, uuid), public.finalize_sbom_document_normalization_atomic(uuid, uuid, text, uuid), public.list_sbom_documents_for_release(uuid, uuid, uuid, uuid, integer, text), public.get_sbom_document(uuid, uuid, uuid), public.search_sbom_components(uuid, uuid, uuid, text, integer, text), public.list_sbom_dependency_tree(uuid, uuid, uuid, uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.finalize_sbom_document_normalization_atomic(uuid, uuid, text, uuid), public.list_sbom_documents_for_release(uuid, uuid, uuid, uuid, integer, text), public.get_sbom_document(uuid, uuid, uuid), public.search_sbom_components(uuid, uuid, uuid, text, integer, text), public.list_sbom_dependency_tree(uuid, uuid, uuid, uuid, text, integer, text) to service_role;
