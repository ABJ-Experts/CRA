-- M3-05 diff scans must consume the once-normalized purl_package projection.
-- `COLLATE "C"` matches the worker's bytewise identity comparison exactly.

create or replace function public.list_sbom_diff_component_facts(
  p_organization_id uuid,
  p_report_id uuid,
  p_worker_id text,
  p_side text,
  p_limit integer,
  p_cursor text
) returns table(outcome text, result jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_report public.sbom_diff_reports%rowtype;
  v_document_id uuid;
  v_cursor jsonb;
  v_identity_rank integer := 0;
  v_identity text := '';
  v_offset bigint := 0;
  v_id uuid;
  v_inserted integer := 0;
  v_rows jsonb;
begin
  if p_side not in ('current', 'baseline') or p_limit not between 1 and 1000 then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  select * into v_report
  from public.sbom_diff_reports reports
  where reports.organization_id = p_organization_id
    and reports.id = p_report_id
    and reports.state = 'processing'
    and reports.lease_owner = btrim(p_worker_id)
    and reports.lease_expires_at > now();
  if not found then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;

  v_document_id := case
    when p_side = 'current' then v_report.document_id
    else v_report.baseline_document_id
  end;

  -- Derive legacy rows in bounded inserts before exposing any identity-ordered
  -- page.  Returning a partial projection would make a later identity sort
  -- before an already-issued cursor and lose a component deterministically.
  loop
    select inserted_count into v_inserted
    from public.ensure_sbom_component_diff_identities_atomic(
      p_organization_id, v_document_id, 5000
    );
    exit when coalesce(v_inserted, 0) = 0;
  end loop;

  if nullif(p_cursor, '') is not null then
    begin
      v_cursor := convert_from(decode(p_cursor, 'base64'), 'utf8')::jsonb;
      if jsonb_typeof(v_cursor) <> 'array' or jsonb_array_length(v_cursor) <> 4 then
        raise exception 'invalid cursor';
      end if;
      v_identity_rank := (v_cursor ->> 0)::integer;
      v_identity := coalesce(v_cursor ->> 1, '');
      v_offset := (v_cursor ->> 2)::bigint;
      v_id := (v_cursor ->> 3)::uuid;
      if v_identity_rank not in (0, 1) then raise exception 'invalid cursor'; end if;
    exception when others then
      return query select 'invalid_request'::text, null::jsonb;
      return;
    end;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'componentId', rows.id,
        'packageIdentity', rows.package_identity,
        'canonicalPurl', rows.canonical_purl,
        'normalizedName', rows.normalized_name,
        'normalizedVersion', rows.normalized_version,
        'ecosystem', rows.ecosystem,
        'sourceOffset', rows.source_offset
      ) order by
        rows.identity_rank,
        coalesce(rows.package_identity, '') collate "C",
        rows.source_offset,
        rows.id
    ),
    '[]'::jsonb
  ) into v_rows
  from (
    select
      components.id,
      identities.canonical_value as package_identity,
      case when components.canonical_purl is null then 0 else 1 end as identity_rank,
      components.canonical_purl,
      components.normalized_name,
      components.normalized_version,
      components.ecosystem,
      components.source_offset
    from public.sbom_components components
    left join public.sbom_component_identities identities
      on identities.organization_id = components.organization_id
     and identities.document_id = components.document_id
     and identities.component_id = components.id
     and identities.identity_type = 'purl_package'
    where components.organization_id = p_organization_id
      and components.document_id = v_document_id
      and (
        components.canonical_purl is null
        or identities.canonical_value is not null
      )
      and (
        case when components.canonical_purl is null then 0 else 1 end,
        coalesce(identities.canonical_value, '') collate "C",
        components.source_offset,
        components.id
      ) > (
        v_identity_rank,
        v_identity collate "C",
        v_offset,
        coalesce(v_id, '00000000-0000-0000-0000-000000000000'::uuid)
      )
    order by
      case when components.canonical_purl is null then 0 else 1 end,
      coalesce(identities.canonical_value, '') collate "C",
      components.source_offset,
      components.id
    limit p_limit
  ) rows;

  return query select
    'found'::text,
    jsonb_build_object(
      'items', v_rows,
      'nextCursor', case
        when jsonb_array_length(v_rows) = p_limit then encode(
          convert_to(
            jsonb_build_array(
              case when (v_rows -> (p_limit - 1) ->> 'packageIdentity') is null then 0 else 1 end,
              v_rows -> (p_limit - 1) -> 'packageIdentity',
              (v_rows -> (p_limit - 1) ->> 'sourceOffset')::bigint,
              v_rows -> (p_limit - 1) ->> 'componentId'
            )::text,
            'utf8'
          ),
          'base64'
        )
        else null
      end
    );
end;
$$;

-- Component comparison remains ready for exact additions/removals.  Only an
-- unresolved version transition needs the unavailable M4 comparator; finding
-- delta availability is reported independently.
create or replace function public.sbom_diff_report_json(
  p_organization_id uuid,
  p_report_id uuid
) returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', reports.id,
    'sourceId', reports.source_id,
    'baselineSourceId', reports.baseline_source_id,
    'releaseId', reports.release_id,
    'documentId', reports.document_id,
    'baselineDocumentId', reports.baseline_document_id,
    'state', reports.state,
    'comparisonStatus', case
      when reports.state = 'failed' then 'failed'
      when reports.state <> 'completed' then 'ready'
      when not exists (
        select 1
        from public.sbom_diff_component_changes changes
        where changes.organization_id = reports.organization_id
          and changes.report_id = reports.id
          and changes.change_type <> 'unchanged'
      ) then 'identical'
      when exists (
        select 1
        from public.sbom_diff_component_changes changes
        where changes.organization_id = reports.organization_id
          and changes.report_id = reports.id
          and changes.change_type = 'unresolved'
      ) then 'partial_integration_unavailable'
      else 'ready'
    end,
    'comparatorVersion', reports.comparator_version,
    'findingDelta', jsonb_build_object('state', reports.finding_delta_state),
    'counts', jsonb_build_object('componentChanges', reports.progress_change_count),
    'progress', jsonb_build_object(
      'stage', reports.progress_stage,
      'percent', reports.progress_percent
    ),
    'error', case when reports.error_code is null then null else jsonb_build_object(
      'code', reports.error_code,
      'message', reports.error_message,
      'retryable', reports.attempt_count < reports.max_attempts
    ) end,
    'completedAt', reports.completed_at,
    'createdAt', reports.created_at,
    'updatedAt', reports.updated_at
  )
  from public.sbom_diff_reports reports
  where reports.organization_id = p_organization_id and reports.id = p_report_id;
$$;

alter function public.list_sbom_diff_component_facts(uuid, uuid, text, text, integer, text) owner to postgres;
alter function public.sbom_diff_report_json(uuid, uuid) owner to postgres;
revoke all on function public.list_sbom_diff_component_facts(uuid, uuid, text, text, integer, text)
from public, anon, authenticated;
grant execute on function public.list_sbom_diff_component_facts(uuid, uuid, text, text, integer, text)
to service_role;
