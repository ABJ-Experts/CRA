-- Reuse validation only through verified same-content alias provenance.
-- Alias metadata diagnostics are a read projection; persisted reports stay unchanged.
create or replace function public.sbom_validation_report_json(p_organization_id uuid,p_source_id uuid)
returns jsonb language plpgsql stable set search_path=public,pg_temp as $$
declare
  v_report jsonb; v_source public.sbom_sources%rowtype; v_own boolean;
  v_added jsonb:='[]'::jsonb; v_kept jsonb; v_combined jsonb; v_removed integer;
  v_warning integer; v_omitted integer; v_status text;
begin
  select jobs.validation_report,true into v_report,v_own from public.sbom_ingest_jobs jobs
    where jobs.organization_id=p_organization_id and jobs.source_id=p_source_id;
  if not coalesce(v_own,false) then
    select aliases.* into v_source from public.sbom_sources aliases
      where aliases.organization_id=p_organization_id and aliases.id=p_source_id and aliases.status='verified';
    if found then
      select jobs.validation_report into v_report from public.sbom_sources canonical
      join public.sbom_raw_objects raw on raw.organization_id=canonical.organization_id and raw.id=canonical.raw_object_id
      join public.sbom_ingest_jobs jobs on jobs.organization_id=canonical.organization_id and jobs.source_id=canonical.id
        and jobs.input_sha256=raw.sha256 and jobs.release_id=canonical.release_id
      where canonical.organization_id=p_organization_id and canonical.id=v_source.deduplicated_from_source_id
        and canonical.status='verified' and canonical.deduplicated_from_source_id is null
        and canonical.product_id=v_source.product_id and canonical.release_id=v_source.release_id
        and canonical.raw_object_id=v_source.raw_object_id and raw.sha256=v_source.declared_sha256
        and canonical.declared_sha256=v_source.declared_sha256
        and canonical.declared_byte_size=v_source.declared_byte_size and raw.byte_size=v_source.declared_byte_size;
    end if;
    if v_report is not null and v_report->>'status'<>'pending' and v_report->'detected'<>'null'::jsonb then
      -- Remove visible canonical declaration warnings before checking this alias.
      select coalesce(jsonb_agg(item order by ordinal),'[]'::jsonb)
        into v_kept from jsonb_array_elements(v_report->'diagnostics') with ordinality entries(item,ordinal)
        where not(item->>'severity'='warning' and item->>'code' in('declared_format_mismatch','declared_spec_version_mismatch'));
      v_removed:=jsonb_array_length(v_report->'diagnostics')-jsonb_array_length(v_kept);
      if v_source.declared_format is not null and v_source.declared_format<>(v_report#>>'{detected,format}') then
        v_added:=v_added||jsonb_build_array(jsonb_build_object('severity','warning','code','declared_format_mismatch','location','$',
          'message','Declared SBOM format does not match detected content.',
          'remediation','Review the declared format metadata; CRA validated the content-detected format.'));
      end if;
      if v_source.declared_spec_version is not null and v_source.declared_spec_version<>(v_report#>>'{detected,specificationVersion}') then
        v_added:=v_added||jsonb_build_array(jsonb_build_object('severity','warning','code','declared_spec_version_mismatch','location','$',
          'message','Declared SBOM spec version does not match detected content.',
          'remediation','Review the declared spec version metadata; CRA validated the content-detected version.'));
      end if;
      v_combined:=v_added||v_kept;
      v_warning:=greatest(0,(v_report->>'warningCount')::integer-v_removed)+jsonb_array_length(v_added);
      v_omitted:=(v_report->>'omittedDiagnosticCount')::integer+greatest(0,jsonb_array_length(v_combined)-100);
      select coalesce(jsonb_agg(item order by ordinal),'[]'::jsonb) into v_kept
        from jsonb_array_elements(v_combined) with ordinality entries(item,ordinal) where ordinal<=100;
      v_status:=case when v_report->>'status'='invalid' then 'invalid' when v_warning>0 then 'valid_with_warnings' else 'valid' end;
      v_report:=v_report||jsonb_build_object('status',v_status,'diagnostics',v_kept,'warningCount',v_warning,'omittedDiagnosticCount',v_omitted);
    end if;
  end if;
  return coalesce(v_report,jsonb_build_object('status','pending','detected',null,'validator',null,'diagnostics','[]'::jsonb,
    'errorCount',0,'warningCount',0,'omittedDiagnosticCount',0,'completedAt',null));
end $$;
create or replace function public.sbom_validation_summary_json(p_organization_id uuid,p_source_id uuid)
returns jsonb language sql stable set search_path=public,pg_temp as $$
  select jsonb_build_object('status',report->>'status','errorCount',(report->>'errorCount')::integer,
    'warningCount',(report->>'warningCount')::integer,'omittedDiagnosticCount',(report->>'omittedDiagnosticCount')::integer,
    'completedAt',report->'completedAt') from (select public.sbom_validation_report_json(p_organization_id,p_source_id) report) projected;
$$;
revoke all on function public.sbom_validation_report_json(uuid,uuid),public.sbom_validation_summary_json(uuid,uuid) from public,anon,authenticated,service_role;
