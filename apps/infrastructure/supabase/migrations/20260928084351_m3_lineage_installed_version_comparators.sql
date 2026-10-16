-- New report policy uses the installed M4 ordering. No historical report,
-- component change or finding snapshot is rewritten. M5 readiness is unchanged.
alter table public.sbom_diff_reports alter column comparator_version
  set default 'm3-m4-version-comparators.v1';

create or replace function public.enqueue_sbom_diff_report_atomic(
  p_organization_id uuid,
  p_source_id uuid,
  p_baseline_source_id uuid
) returns table(outcome text, report jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source public.sbom_sources%rowtype;
  v_baseline public.sbom_sources%rowtype;
  v_document uuid;
  v_baseline_document uuid;
  v_report public.sbom_diff_reports%rowtype;
begin
  select * into v_source
  from public.sbom_sources sources
  where sources.organization_id = p_organization_id
    and sources.id = p_source_id
    and sources.deduplicated_from_source_id is null
  for share;
  select * into v_baseline
  from public.sbom_sources sources
  where sources.organization_id = p_organization_id
    and sources.id = p_baseline_source_id
    and sources.deduplicated_from_source_id is null
  for share;
  if not found
    or v_source.release_id <> v_baseline.release_id
    or p_source_id = p_baseline_source_id then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  select mappings.document_id into v_document
  from public.sbom_document_sources mappings
  join public.sbom_documents documents
    on documents.organization_id = mappings.organization_id
   and documents.id = mappings.document_id
   and documents.state = 'completed'
  where mappings.organization_id = p_organization_id
    and mappings.source_id = p_source_id
  order by documents.completed_at desc, documents.id desc
  limit 1;
  select mappings.document_id into v_baseline_document
  from public.sbom_document_sources mappings
  join public.sbom_documents documents
    on documents.organization_id = mappings.organization_id
   and documents.id = mappings.document_id
   and documents.state = 'completed'
  where mappings.organization_id = p_organization_id
    and mappings.source_id = p_baseline_source_id
  order by documents.completed_at desc, documents.id desc
  limit 1;
  if v_document is null or v_baseline_document is null or v_document = v_baseline_document then
    return query select 'no_comparable_version'::text, null::jsonb;
    return;
  end if;
  insert into public.sbom_diff_reports(
    organization_id, source_id, baseline_source_id, release_id,
    document_id, baseline_document_id
  ) values (
    p_organization_id, p_source_id, p_baseline_source_id, v_source.release_id,
    v_document, v_baseline_document
  )
  on conflict (organization_id, source_id, baseline_source_id, comparator_version)
  do nothing
  returning * into v_report;
  if v_report.id is null then
    select * into v_report
    from public.sbom_diff_reports reports
    where reports.organization_id = p_organization_id
      and reports.source_id = p_source_id
      and reports.baseline_source_id = p_baseline_source_id
      and reports.comparator_version = 'm3-m4-version-comparators.v1';
  end if;
  return query select
    case when v_report.state = 'completed' then 'completed' else 'queued' end,
    public.sbom_diff_report_json(p_organization_id, v_report.id);
end;
$$;

alter function public.enqueue_sbom_diff_report_atomic(uuid, uuid, uuid) owner to postgres;
revoke all on function public.enqueue_sbom_diff_report_atomic(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.enqueue_sbom_diff_report_atomic(uuid, uuid, uuid) to service_role;
