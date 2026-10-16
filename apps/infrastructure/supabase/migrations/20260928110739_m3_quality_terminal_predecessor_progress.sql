-- Terminal failed reports remain readable, but cannot block later quality work.
-- Retryable, queued and live processing predecessors retain ordered evaluation.
create or replace function public.claim_sbom_quality_report(
  p_organization_id uuid, p_worker_id text, p_lease_seconds integer
) returns table(outcome text, work jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_report public.sbom_quality_reports%rowtype;
  v_source public.sbom_sources%rowtype;
  v_baseline jsonb;
  v_baseline_report public.sbom_quality_reports%rowtype;
begin
  if char_length(btrim(p_worker_id)) not between 1 and 100 or p_lease_seconds not between 15 and 900 then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  update public.sbom_quality_reports set state = 'failed', progress_stage = 'failed', lease_owner = null, lease_expires_at = null,
    error_code = 'unexpected_failure', error_message = 'The quality worker lease expired.', next_attempt_at = now(), updated_at = now()
  where organization_id = p_organization_id and state = 'processing' and lease_expires_at <= now();
  select * into v_report from public.sbom_quality_reports r
    where r.organization_id = p_organization_id and r.state in ('queued', 'failed') and r.next_attempt_at <= now()
      and r.attempt_count < r.max_attempts
    order by r.created_at, r.id for update skip locked limit 1;
  if not found then return query select 'empty'::text, null::jsonb; return; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || v_report.release_id::text, 0));
  select * into v_source from public.sbom_sources where organization_id=p_organization_id and id=v_report.source_id;
  if not found then return query select 'empty'::text, null::jsonb; return; end if;
  if exists (
    select 1 from public.sbom_document_sources older_mapping
    join public.sbom_sources older_source on older_source.organization_id=older_mapping.organization_id and older_source.id=older_mapping.source_id
    join public.sbom_documents older_document on older_document.organization_id=older_mapping.organization_id and older_document.id=older_mapping.document_id and older_document.state='completed'
    left join public.sbom_quality_reports older_report on older_report.organization_id=older_mapping.organization_id and older_report.source_id=older_mapping.source_id and older_report.formula_version=v_report.formula_version and older_report.bsi_ruleset_version=v_report.bsi_ruleset_version
    where older_mapping.organization_id=p_organization_id and older_mapping.release_id=v_report.release_id
      and (older_source.verified_at, older_source.id) < (v_source.verified_at, v_source.id)
      and (older_report.id is null
        or older_report.state in ('queued','processing')
        or (older_report.state='failed' and older_report.attempt_count<older_report.max_attempts))
  ) then return query select 'empty'::text, null::jsonb; return; end if;
  if v_source.supersedes_source_id is not null then
    select b.* into v_baseline_report from public.sbom_quality_reports b
      where b.organization_id=p_organization_id and b.source_id=v_source.supersedes_source_id and b.release_id=v_report.release_id
        and b.formula_version=v_report.formula_version and b.bsi_ruleset_version=v_report.bsi_ruleset_version and b.state='completed'
      order by b.completed_at desc, b.id desc limit 1;
  else
    select b.* into v_baseline_report from public.sbom_quality_reports b
      join public.sbom_sources baseline_source on baseline_source.organization_id=b.organization_id and baseline_source.id=b.source_id
      where b.organization_id=p_organization_id and b.release_id=v_report.release_id and b.formula_version=v_report.formula_version
        and b.bsi_ruleset_version=v_report.bsi_ruleset_version and b.state='completed'
        and (baseline_source.verified_at, baseline_source.id) < (v_source.verified_at, v_source.id)
      order by baseline_source.verified_at desc, baseline_source.id desc limit 1;
  end if;
  if found then
    v_baseline := jsonb_build_object('status','available','reportId',v_baseline_report.id,'sourceId',v_baseline_report.source_id,
      'totalScore',v_baseline_report.total_score,'completedAt',v_baseline_report.completed_at,
      'quality',jsonb_build_object('formulaVersion',v_baseline_report.formula_version,'inputs',v_baseline_report.raw_inputs,
        'dimensions',v_baseline_report.dimension_scores,'totalScore',v_baseline_report.total_score));
  elsif not exists (
    select 1 from public.sbom_document_sources earlier_mapping
    join public.sbom_sources earlier_source on earlier_source.organization_id=earlier_mapping.organization_id and earlier_source.id=earlier_mapping.source_id
    join public.sbom_documents earlier_document on earlier_document.organization_id=earlier_mapping.organization_id and earlier_document.id=earlier_mapping.document_id and earlier_document.state='completed'
    where earlier_mapping.organization_id=p_organization_id and earlier_mapping.release_id=v_report.release_id
      and (earlier_source.verified_at, earlier_source.id) < (v_source.verified_at, v_source.id)
  ) then v_baseline := jsonb_build_object('status','first_document');
  else v_baseline := jsonb_build_object('status','no_baseline');
  end if;
  update public.sbom_quality_reports set state = 'processing', progress_stage = 'collecting_inputs', progress_percent = 10,
    progress_message = 'Collecting normalized component facts.', attempt_count = attempt_count + 1,
    lease_owner = btrim(p_worker_id), lease_expires_at = now() + make_interval(secs => p_lease_seconds), error_code = null, error_message = null, updated_at = now()
  where organization_id = p_organization_id and id = v_report.id returning * into v_report;
  return query select 'claimed'::text, jsonb_build_object('id',v_report.id,'sourceId',v_report.source_id,'releaseId',v_report.release_id,
    'documentId',v_report.document_id,'configurationVersion',v_report.config_version,
    'bsiProfile',jsonb_build_object('enabled',v_report.profile_enabled,'rulesetVersion',v_report.bsi_ruleset_version),'baseline',v_baseline);
end;
$$;

alter function public.claim_sbom_quality_report(uuid,text,integer) owner to postgres;
revoke all on function public.claim_sbom_quality_report(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.claim_sbom_quality_report(uuid,text,integer) to service_role;
