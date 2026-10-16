-- M7-03: enrich the established M7-01 section projection without changing
-- its identity or legacy fields. The added fields expose pinned evidence and
-- immutable review history to the existing workspace.
create or replace function public.m7_technical_file_section_json(p_organization_id uuid,p_section_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object(
  'id',s.id,'key',s.section_key,'heading',s.heading,'requirementText',s.requirement_text,'sortOrder',s.sort_order,
  'narrative',s.narrative,'applicability',s.applicability,'nonApplicabilityReason',s.non_applicability_reason,'version',s.version,
  'status',case when s.applicability='not_applicable' then 'not_applicable'
    when exists(select 1 from public.technical_file_section_sources x where x.organization_id=s.organization_id and x.section_id=s.id and public.m7_evidence_section_source_state(s.organization_id,f.product_id,x.id)='unavailable') then 'unavailable'
    when exists(select 1 from public.technical_file_section_sources x where x.organization_id=s.organization_id and x.section_id=s.id and public.m7_evidence_section_source_state(s.organization_id,f.product_id,x.id)='stale') then 'stale'
    when s.narrative is null and not exists(select 1 from public.technical_file_section_sources x where x.organization_id=s.organization_id and x.section_id=s.id) then 'incomplete' else 'complete' end,
  'sources',coalesce((select jsonb_agg(jsonb_build_object(
    'id',x.id,'kind',x.source_kind,'recordId',x.record_id,'observedRevision',x.observed_revision,'title',x.title,
    'editionOrRevision',x.edition_or_revision,'issuer',x.issuer,'locator',x.locator,'rationale',x.rationale,
    'status',public.m7_evidence_section_source_state(s.organization_id,f.product_id,x.id),
    'linkVersion',x.link_version,'sourceFingerprint',x.source_fingerprint,
    'staleAt',case when x.stale_at is null then null else to_char(x.stale_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
    'staleReason',x.stale_reason,'currentObservedRevision',x.stale_current_revision,'currentFingerprint',x.stale_current_fingerprint,
    'reviewedAt',case when x.reviewed_at is null then null else to_char(x.reviewed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
    'reviews',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'sourceId',r.source_id,'decision',r.decision,'rationale',r.rationale,'previousObservedRevision',r.linked_revision,'previousFingerprint',r.linked_fingerprint,'reviewedObservedRevision',r.reviewed_against_revision,'reviewedFingerprint',r.reviewed_against_fingerprint,'reviewedByUserId',r.created_by,'createdAt',to_char(r.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')) order by r.created_at,r.id) from public.technical_file_section_source_reviews r where r.organization_id=x.organization_id and r.source_id=x.id),'[]'::jsonb),
    'createdAt',to_char(x.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')
  ) order by x.created_at,x.id) from public.technical_file_section_sources x where x.organization_id=s.organization_id and x.section_id=s.id),'[]'::jsonb),
  'updatedAt',to_char(s.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')
 ) from public.technical_file_sections s join public.technical_files f on f.organization_id=s.organization_id and f.id=s.technical_file_id
 where s.organization_id=p_organization_id and s.id=p_section_id
$$;

revoke all on function public.m7_technical_file_section_json(uuid,uuid) from public,anon,authenticated;
alter function public.m7_technical_file_section_json(uuid,uuid) owner to postgres;
grant execute on function public.m7_technical_file_section_json(uuid,uuid) to service_role;
notify pgrst, 'reload schema';
