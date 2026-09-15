-- Align already-upgraded databases with the projection shapes in the initial
-- quality migration. Selecting only the target composite prevents joined
-- source/document columns from being assigned positionally to report rows.
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
      and (older_report.id is null or older_report.state in ('queued','processing','failed'))
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

create or replace function public.persist_sbom_quality_report_atomic(
  p_organization_id uuid, p_report_id uuid, p_worker_id text, p_report jsonb, p_findings jsonb, p_complete boolean
) returns table(outcome text, report jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_quality_report public.sbom_quality_reports%rowtype; v_baseline uuid;
begin
  if char_length(btrim(p_worker_id)) not between 1 and 100
    or jsonb_typeof(p_report) <> 'object' or jsonb_typeof(p_findings) <> 'array'
    or jsonb_array_length(p_findings) > 1000 or octet_length(p_findings::text) > 1048576
    or jsonb_typeof(p_report -> 'inputs') <> 'object' or jsonb_typeof(p_report -> 'dimensions') <> 'array'
    or jsonb_typeof(p_report -> 'weights') <> 'object' or jsonb_typeof(p_report -> 'bsiProfile') <> 'object'
    or jsonb_typeof(p_report -> 'baseline') <> 'object' or jsonb_typeof(p_report -> 'regression') <> 'object'
    or (p_report ->> 'assessmentStatus') not in ('valid', 'warning', 'invalid', 'first_document', 'no_baseline', 'regression')
    or coalesce((p_report ->> 'totalScore')::numeric, -1) not between 0 and 100 then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  select r.* into v_quality_report from public.sbom_quality_reports r
    join public.sbom_documents d on d.organization_id=r.organization_id and d.id=r.document_id and d.state='completed'
    where r.organization_id=p_organization_id and r.id=p_report_id and r.state='processing'
      and r.lease_owner=btrim(p_worker_id) and r.lease_expires_at>now() for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  begin v_baseline := nullif(p_report #>> '{baseline,reportId}', '')::uuid; exception when invalid_text_representation then return query select 'invalid_request'::text, null::jsonb; return; end;
  if v_baseline is not null and not exists (
    select 1 from public.sbom_quality_reports b where b.organization_id=p_organization_id and b.id=v_baseline and b.release_id=v_quality_report.release_id and b.state='completed'
  ) then return query select 'invalid_request'::text, null::jsonb; return; end if;
  insert into public.sbom_quality_findings(organization_id,report_id,document_id,component_id,finding_key,category,code,rule_id,severity,dimension,source_path,source_offset,expected_condition,actual_condition,remediation)
  select p_organization_id,p_report_id,v_quality_report.document_id,x.component_id,x.finding_key,x.category,x.code,x.rule_id,x.severity,x.dimension,x.source_path,x.source_offset,x.expected_condition,x.actual_condition,x.remediation
  from jsonb_to_recordset(p_findings) as x(component_id uuid,finding_key text,category text,code text,rule_id text,severity text,dimension text,source_path text,source_offset bigint,expected_condition text,actual_condition text,remediation text)
  left join public.sbom_components c on c.organization_id=p_organization_id and c.document_id=v_quality_report.document_id and c.id=x.component_id
  where x.component_id is null or c.id is not null
  on conflict (organization_id,report_id,finding_key) do update set category=excluded.category,code=excluded.code,rule_id=excluded.rule_id,severity=excluded.severity,dimension=excluded.dimension,source_path=excluded.source_path,source_offset=excluded.source_offset,expected_condition=excluded.expected_condition,actual_condition=excluded.actual_condition,remediation=excluded.remediation;
  update public.sbom_quality_reports set raw_inputs=p_report->'inputs', dimension_scores=p_report->'dimensions', weights=p_report->'weights',
    total_score=(p_report->>'totalScore')::numeric, quality_status=p_report->>'assessmentStatus', profile_summary=p_report->'bsiProfile', baseline_report_id=v_baseline,
    baseline=p_report->'baseline', regression_state=case when p_report#>>'{regression,status}'='regression' then 'warning' else 'none' end, regression_summary=p_report->'regression',
    progress_finding_count=(select count(*) from public.sbom_quality_findings where organization_id=p_organization_id and report_id=p_report_id),
    state=case when p_complete then 'completed' else 'processing' end, progress_stage=case when p_complete then 'completed' else 'recording_findings' end,
    progress_percent=case when p_complete then 100 else greatest(progress_percent,90) end, progress_message=case when p_complete then 'Quality assessment completed.' else 'Recording quality findings.' end,
    lease_owner=case when p_complete then null else lease_owner end, lease_expires_at=case when p_complete then null else lease_expires_at end,
    completed_at=case when p_complete then now() else null end, updated_at=now()
  where organization_id=p_organization_id and id=p_report_id;
  return query select case when p_complete then 'completed' else 'persisted' end, public.sbom_quality_report_json(p_organization_id,p_report_id);
end;
$$;

alter function public.claim_sbom_quality_report(uuid, text, integer) owner to postgres;
alter function public.persist_sbom_quality_report_atomic(uuid, uuid, text, jsonb, jsonb, boolean) owner to postgres;
revoke all on function public.claim_sbom_quality_report(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.persist_sbom_quality_report_atomic(uuid, uuid, text, jsonb, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.claim_sbom_quality_report(uuid, text, integer) to service_role;
grant execute on function public.persist_sbom_quality_report_atomic(uuid, uuid, text, jsonb, jsonb, boolean) to service_role;
