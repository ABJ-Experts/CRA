-- M3-04 explainable SBOM quality reports.  Raw evidence and the normalized
-- graph remain authoritative; reports are source/release observations that can
-- be reproduced from their recorded inputs, formula and profile snapshot.

alter table public.sbom_components
  add column supplier_values jsonb not null default '[]'::jsonb check (
    jsonb_typeof(supplier_values) = 'array'
    and jsonb_array_length(supplier_values) <= 20
    and octet_length(supplier_values::text) <= 32768
  ),
  add column license_values jsonb not null default '[]'::jsonb check (
    jsonb_typeof(license_values) = 'array'
    and jsonb_array_length(license_values) <= 20
    and octet_length(license_values::text) <= 32768
  );

create table public.organization_sbom_quality_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  bsi_profile_enabled boolean not null default false,
  bsi_ruleset_version text not null default 'bsi-tr-03183-2.v2.0.0' check (
    bsi_ruleset_version = 'bsi-tr-03183-2.v2.0.0'
  ),
  config_version integer not null default 0 check (config_version >= 0),
  created_by uuid references public.users(id) on delete restrict,
  updated_by uuid references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sbom_quality_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_id uuid not null,
  release_id uuid not null,
  document_id uuid not null,
  formula_version text not null check (formula_version = 'sbom-quality.v1'),
  bsi_ruleset_version text not null check (bsi_ruleset_version = 'bsi-tr-03183-2.v2.0.0'),
  profile_enabled boolean not null,
  config_version integer not null check (config_version >= 0),
  state text not null default 'queued' constraint sbom_quality_reports_state_value_check check (state in ('queued', 'processing', 'completed', 'failed')),
  quality_status text check (quality_status is null or quality_status in ('valid', 'warning', 'invalid', 'first_document', 'no_baseline', 'regression')),
  raw_inputs jsonb check (raw_inputs is null or (jsonb_typeof(raw_inputs) = 'object' and octet_length(raw_inputs::text) <= 524288)),
  dimension_scores jsonb check (dimension_scores is null or (jsonb_typeof(dimension_scores) = 'array' and octet_length(dimension_scores::text) <= 131072)),
  weights jsonb check (weights is null or (jsonb_typeof(weights) = 'object' and octet_length(weights::text) <= 32768)),
  total_score numeric(5,2) check (total_score is null or total_score between 0 and 100),
  profile_summary jsonb check (profile_summary is null or (jsonb_typeof(profile_summary) = 'object' and octet_length(profile_summary::text) <= 131072)),
  baseline_report_id uuid,
  baseline jsonb check (baseline is null or (jsonb_typeof(baseline) = 'object' and octet_length(baseline::text) <= 32768)),
  regression_state text not null default 'not_evaluated' check (regression_state in ('not_evaluated', 'first_document', 'no_baseline', 'none', 'warning')),
  regression_summary jsonb check (regression_summary is null or (jsonb_typeof(regression_summary) = 'object' and octet_length(regression_summary::text) <= 131072)),
  progress_finding_count integer not null default 0 check (progress_finding_count >= 0),
  progress_stage text not null default 'queued' check (progress_stage in ('queued', 'collecting_inputs', 'scoring', 'comparing_baseline', 'evaluating_bsi', 'recording_findings', 'completed', 'failed')),
  progress_percent integer not null default 0 check (progress_percent between 0 and 100),
  progress_message text not null default 'Quality assessment is queued.' check (char_length(btrim(progress_message)) between 1 and 500),
  attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  max_attempts integer not null default 5 check (max_attempts = 5),
  next_attempt_at timestamptz not null default now(),
  lease_owner text check (lease_owner is null or char_length(btrim(lease_owner)) between 1 and 100),
  lease_expires_at timestamptz,
  error_code text check (error_code is null or error_code in ('normalized_document_missing', 'quality_persistence_unavailable', 'quality_configuration_unavailable', 'quality_source_missing', 'quality_statement_timeout', 'quality_calculation_failed', 'provider_unavailable', 'unexpected_failure')),
  error_message text check (error_message is null or char_length(btrim(error_message)) between 1 and 1000),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, source_id, formula_version, bsi_ruleset_version, config_version),
  constraint sbom_quality_reports_source_fkey foreign key (organization_id, source_id)
    references public.sbom_sources(organization_id, id) on delete cascade,
  constraint sbom_quality_reports_document_source_fkey foreign key (organization_id, document_id, source_id)
    references public.sbom_document_sources(organization_id, document_id, source_id) on delete cascade,
  constraint sbom_quality_reports_baseline_fkey foreign key (organization_id, baseline_report_id)
    references public.sbom_quality_reports(organization_id, id) on delete restrict,
  constraint sbom_quality_reports_state_check check (
    (state = 'queued' and progress_stage = 'queued' and lease_owner is null and lease_expires_at is null and completed_at is null and error_code is null and error_message is null)
    or (state = 'processing' and progress_stage in ('collecting_inputs', 'scoring', 'comparing_baseline', 'evaluating_bsi', 'recording_findings') and lease_owner is not null and lease_expires_at is not null and completed_at is null and error_code is null and error_message is null)
    or (state = 'completed' and progress_stage = 'completed' and progress_percent = 100 and lease_owner is null and lease_expires_at is null and completed_at is not null and error_code is null and error_message is null and raw_inputs is not null and dimension_scores is not null and weights is not null and total_score is not null)
    or (state = 'failed' and progress_stage = 'failed' and lease_owner is null and lease_expires_at is null and completed_at is null and error_code is not null and error_message is not null)
  )
);

create table public.sbom_quality_findings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  report_id uuid not null,
  document_id uuid not null,
  component_id uuid,
  finding_key text not null check (char_length(btrim(finding_key)) between 1 and 256),
  category text not null check (category in ('coverage', 'profile', 'regression')),
  code text not null check (char_length(btrim(code)) between 1 and 120),
  rule_id text check (rule_id is null or char_length(btrim(rule_id)) between 1 and 160),
  severity text not null check (severity in ('info', 'warning', 'error')),
  dimension text check (dimension is null or dimension in ('purl', 'hash', 'supplier', 'license', 'top_level_dependency', 'transitive_depth', 'regression')),
  source_path text check (source_path is null or char_length(source_path) <= 1000),
  source_offset bigint check (source_offset is null or source_offset >= 0),
  expected_condition text check (expected_condition is null or char_length(expected_condition) <= 2000),
  actual_condition text check (actual_condition is null or char_length(actual_condition) <= 4000),
  remediation text not null check (char_length(btrim(remediation)) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, report_id, finding_key),
  constraint sbom_quality_findings_report_fkey foreign key (organization_id, report_id)
    references public.sbom_quality_reports(organization_id, id) on delete cascade,
  constraint sbom_quality_findings_component_fkey foreign key (organization_id, document_id, component_id)
    references public.sbom_components(organization_id, document_id, id) on delete cascade
);

create index sbom_quality_reports_org_source_created_idx on public.sbom_quality_reports(organization_id, source_id, created_at desc, id desc);
create index sbom_quality_reports_org_release_state_created_idx on public.sbom_quality_reports(organization_id, release_id, state, created_at desc, id desc);
create index sbom_quality_reports_claim_idx on public.sbom_quality_reports(organization_id, next_attempt_at, created_at, id)
  where state in ('queued', 'failed');
create index sbom_quality_reports_recovery_idx on public.sbom_quality_reports(organization_id, lease_expires_at)
  where state = 'processing';
create index sbom_quality_findings_report_created_idx on public.sbom_quality_findings(organization_id, report_id, created_at, id);
create index sbom_quality_findings_component_idx on public.sbom_quality_findings(organization_id, component_id) where component_id is not null;

alter table public.organization_sbom_quality_settings enable row level security;
alter table public.sbom_quality_reports enable row level security;
alter table public.sbom_quality_findings enable row level security;

create policy organization_sbom_quality_settings_select_member on public.organization_sbom_quality_settings
  for select to authenticated using (public.user_is_member_of(organization_id));
create policy sbom_quality_reports_select_member on public.sbom_quality_reports
  for select to authenticated using (public.user_is_member_of(organization_id));
create policy sbom_quality_findings_select_member on public.sbom_quality_findings
  for select to authenticated using (public.user_is_member_of(organization_id));

revoke all on public.organization_sbom_quality_settings, public.sbom_quality_reports, public.sbom_quality_findings from public, anon, authenticated;
grant select, insert, update, delete on public.organization_sbom_quality_settings, public.sbom_quality_reports, public.sbom_quality_findings to service_role;

create trigger set_organization_sbom_quality_settings_updated_at before update on public.organization_sbom_quality_settings for each row execute function public.set_updated_at();
create trigger set_sbom_quality_reports_updated_at before update on public.sbom_quality_reports for each row execute function public.set_updated_at();
create trigger set_sbom_quality_findings_updated_at before update on public.sbom_quality_findings for each row execute function public.set_updated_at();

create or replace function public.sbom_quality_cursor_encode(p_sort_value text, p_id uuid)
returns text language sql immutable set search_path = public, pg_temp as $$
  select encode(convert_to(jsonb_build_array(p_sort_value, p_id::text)::text, 'utf8'), 'base64');
$$;

create or replace function public.enqueue_sbom_quality_report_atomic(
  p_organization_id uuid, p_source_id uuid, p_document_id uuid
) returns table(outcome text, report jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_source public.sbom_sources%rowtype;
  v_settings public.organization_sbom_quality_settings%rowtype;
  v_report public.sbom_quality_reports%rowtype;
begin
  select s.* into v_source from public.sbom_sources s
    join public.sbom_document_sources ds on ds.organization_id = s.organization_id and ds.source_id = s.id
    join public.sbom_documents d on d.organization_id = ds.organization_id and d.id = ds.document_id
    where s.organization_id = p_organization_id and s.id = p_source_id and ds.document_id = p_document_id
      and s.status = 'verified' and d.state = 'completed'
    for share;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  select * into v_settings from public.organization_sbom_quality_settings where organization_id = p_organization_id;
  insert into public.sbom_quality_reports(organization_id, source_id, release_id, document_id, formula_version, bsi_ruleset_version, profile_enabled, config_version)
  values (p_organization_id, p_source_id, v_source.release_id, p_document_id, 'sbom-quality.v1',
    coalesce(v_settings.bsi_ruleset_version, 'bsi-tr-03183-2.v2.0.0'), coalesce(v_settings.bsi_profile_enabled, false), coalesce(v_settings.config_version, 0))
  on conflict (organization_id, source_id, formula_version, bsi_ruleset_version, config_version) do nothing
  returning * into v_report;
  if v_report.id is null then
    select * into v_report from public.sbom_quality_reports where organization_id=p_organization_id
      and source_id=p_source_id and formula_version='sbom-quality.v1'
      and bsi_ruleset_version=coalesce(v_settings.bsi_ruleset_version, 'bsi-tr-03183-2.v2.0.0')
      and config_version=coalesce(v_settings.config_version, 0);
  end if;
  return query select case when v_report.state = 'completed' then 'completed' else 'queued' end,
    public.sbom_quality_report_json(p_organization_id, v_report.id);
end;
$$;

-- A completed graph may gain an additional immutable source/release later.
-- Both transition paths enqueue exactly one independently reproducible report.
create or replace function public.enqueue_sbom_quality_for_completed_document_trigger()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_source record;
begin
  if tg_table_name = 'sbom_documents' then
    if new.state <> 'completed' or old.state = 'completed' then return new; end if;
    for v_source in select source_id from public.sbom_document_sources where organization_id = new.organization_id and document_id = new.id loop
      perform outcome from public.enqueue_sbom_quality_report_atomic(new.organization_id, v_source.source_id, new.id);
    end loop;
    return new;
  end if;
  if exists (select 1 from public.sbom_documents d where d.organization_id = new.organization_id and d.id = new.document_id and d.state = 'completed') then
    perform outcome from public.enqueue_sbom_quality_report_atomic(new.organization_id, new.source_id, new.document_id);
  end if;
  return new;
end;
$$;

create trigger enqueue_sbom_quality_after_document_completed
  after update of state on public.sbom_documents for each row execute function public.enqueue_sbom_quality_for_completed_document_trigger();
create trigger enqueue_sbom_quality_after_document_source_added
  after insert on public.sbom_document_sources for each row execute function public.enqueue_sbom_quality_for_completed_document_trigger();

create or replace function public.sbom_quality_report_json(p_organization_id uuid, p_report_id uuid)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', r.id, 'sourceId', r.source_id, 'releaseId', r.release_id, 'documentId', r.document_id,
    'state', r.state, 'assessmentStatus', r.quality_status, 'formulaVersion', r.formula_version,
    'rulesetVersion', r.bsi_ruleset_version, 'configurationVersion', r.config_version,
    'inputs', r.raw_inputs, 'dimensions', coalesce(r.dimension_scores, '[]'::jsonb),
    'totalScore', r.total_score, 'bsiProfile', r.profile_summary, 'baseline', r.baseline,
    'regression', r.regression_summary,
    'progress', jsonb_build_object('stage', r.progress_stage, 'percent', r.progress_percent, 'message', r.progress_message),
    'error', case when r.error_code is null then null else jsonb_build_object('code', r.error_code, 'message', r.error_message, 'retryable', r.attempt_count < r.max_attempts) end,
    'completedAt', r.completed_at, 'createdAt', r.created_at, 'updatedAt', r.updated_at
  ) from public.sbom_quality_reports r where r.organization_id = p_organization_id and r.id = p_report_id;
$$;

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
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':' || v_report.release_id::text,
    0
  ));
  select * into v_source from public.sbom_sources
    where organization_id=p_organization_id and id=v_report.source_id;
  if not found then return query select 'empty'::text, null::jsonb; return; end if;

  -- A later source never jumps an earlier eligible source in the same release.
  -- This makes baseline choice deterministic even when workers race.
  if exists (
    select 1
    from public.sbom_document_sources older_mapping
    join public.sbom_sources older_source
      on older_source.organization_id=older_mapping.organization_id
     and older_source.id=older_mapping.source_id
    join public.sbom_documents older_document
      on older_document.organization_id=older_mapping.organization_id
     and older_document.id=older_mapping.document_id
     and older_document.state='completed'
    left join public.sbom_quality_reports older_report
      on older_report.organization_id=older_mapping.organization_id
     and older_report.source_id=older_mapping.source_id
     and older_report.formula_version=v_report.formula_version
     and older_report.bsi_ruleset_version=v_report.bsi_ruleset_version
    where older_mapping.organization_id=p_organization_id
      and older_mapping.release_id=v_report.release_id
      and (older_source.verified_at, older_source.id) < (v_source.verified_at, v_source.id)
      and (older_report.id is null or older_report.state in ('queued','processing','failed'))
  ) then
    return query select 'empty'::text, null::jsonb; return;
  end if;

  if v_source.supersedes_source_id is not null then
    select b.* into v_baseline_report from public.sbom_quality_reports b
      where b.organization_id=p_organization_id
        and b.source_id=v_source.supersedes_source_id
        and b.release_id=v_report.release_id
        and b.formula_version=v_report.formula_version
        and b.bsi_ruleset_version=v_report.bsi_ruleset_version
        and b.state='completed'
      order by b.completed_at desc, b.id desc limit 1;
  else
    select b.* into v_baseline_report from public.sbom_quality_reports b
      join public.sbom_sources baseline_source
        on baseline_source.organization_id=b.organization_id
       and baseline_source.id=b.source_id
      where b.organization_id=p_organization_id
        and b.release_id=v_report.release_id
        and b.formula_version=v_report.formula_version
        and b.bsi_ruleset_version=v_report.bsi_ruleset_version
        and b.state='completed'
        and (baseline_source.verified_at, baseline_source.id) < (v_source.verified_at, v_source.id)
      order by baseline_source.verified_at desc, baseline_source.id desc limit 1;
  end if;
  if found then
    v_baseline := jsonb_build_object(
      'status','available','reportId',v_baseline_report.id,'sourceId',v_baseline_report.source_id,
      'totalScore',v_baseline_report.total_score,'completedAt',v_baseline_report.completed_at,
      'quality',jsonb_build_object('formulaVersion',v_baseline_report.formula_version,
        'inputs',v_baseline_report.raw_inputs,'dimensions',v_baseline_report.dimension_scores,
        'totalScore',v_baseline_report.total_score)
    );
  elsif not exists (
    select 1 from public.sbom_document_sources earlier_mapping
    join public.sbom_sources earlier_source
      on earlier_source.organization_id=earlier_mapping.organization_id
     and earlier_source.id=earlier_mapping.source_id
    join public.sbom_documents earlier_document
      on earlier_document.organization_id=earlier_mapping.organization_id
     and earlier_document.id=earlier_mapping.document_id
     and earlier_document.state='completed'
    where earlier_mapping.organization_id=p_organization_id
      and earlier_mapping.release_id=v_report.release_id
      and (earlier_source.verified_at, earlier_source.id) < (v_source.verified_at, v_source.id)
  ) then
    v_baseline := jsonb_build_object('status','first_document');
  else
    v_baseline := jsonb_build_object('status','no_baseline');
  end if;
  update public.sbom_quality_reports set state = 'processing', progress_stage = 'collecting_inputs', progress_percent = 10,
    progress_message = 'Collecting normalized component facts.', attempt_count = attempt_count + 1,
    lease_owner = btrim(p_worker_id), lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    error_code = null, error_message = null, updated_at = now()
  where organization_id = p_organization_id and id = v_report.id
  returning * into v_report;
  return query select 'claimed'::text, jsonb_build_object(
    'id',v_report.id,'sourceId',v_report.source_id,'releaseId',v_report.release_id,
    'documentId',v_report.document_id,'configurationVersion',v_report.config_version,
    'bsiProfile',jsonb_build_object('enabled',v_report.profile_enabled,'rulesetVersion',v_report.bsi_ruleset_version),
    'baseline',v_baseline
  );
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
    join public.sbom_documents d on d.organization_id = r.organization_id and d.id = r.document_id and d.state = 'completed'
    where r.organization_id = p_organization_id and r.id = p_report_id and r.state = 'processing'
      and r.lease_owner = btrim(p_worker_id) and r.lease_expires_at > now()
    for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  begin v_baseline := nullif(p_report #>> '{baseline,reportId}', '')::uuid; exception when invalid_text_representation then return query select 'invalid_request'::text, null::jsonb; return; end;
  if v_baseline is not null and not exists (
    select 1 from public.sbom_quality_reports b where b.organization_id = p_organization_id and b.id = v_baseline
      and b.release_id = v_quality_report.release_id and b.state = 'completed'
  ) then return query select 'invalid_request'::text, null::jsonb; return; end if;
  insert into public.sbom_quality_findings(organization_id,report_id,document_id,component_id,finding_key,category,code,rule_id,severity,dimension,source_path,source_offset,expected_condition,actual_condition,remediation)
  select p_organization_id,p_report_id,v_quality_report.document_id,x.component_id,x.finding_key,x.category,x.code,x.rule_id,x.severity,x.dimension,x.source_path,x.source_offset,x.expected_condition,x.actual_condition,x.remediation
  from jsonb_to_recordset(p_findings) as x(component_id uuid,finding_key text,category text,code text,rule_id text,severity text,dimension text,source_path text,source_offset bigint,expected_condition text,actual_condition text,remediation text)
  left join public.sbom_components c on c.organization_id=p_organization_id and c.document_id=v_quality_report.document_id and c.id=x.component_id
  where x.component_id is null or c.id is not null
  on conflict (organization_id,report_id,finding_key) do update set category=excluded.category,code=excluded.code,rule_id=excluded.rule_id,severity=excluded.severity,dimension=excluded.dimension,source_path=excluded.source_path,source_offset=excluded.source_offset,expected_condition=excluded.expected_condition,actual_condition=excluded.actual_condition,remediation=excluded.remediation;
  update public.sbom_quality_reports set raw_inputs = p_report -> 'inputs', dimension_scores = p_report -> 'dimensions', weights = p_report -> 'weights',
    total_score = (p_report ->> 'totalScore')::numeric, quality_status = p_report ->> 'assessmentStatus', profile_summary = p_report -> 'bsiProfile',
    baseline_report_id = v_baseline, baseline = p_report -> 'baseline', regression_state = case when p_report #>> '{regression,status}' = 'regression' then 'warning' else 'none' end, regression_summary = p_report -> 'regression',
    progress_finding_count = (select count(*) from public.sbom_quality_findings where organization_id=p_organization_id and report_id=p_report_id),
    state = case when p_complete then 'completed' else 'processing' end,
    progress_stage = case when p_complete then 'completed' else 'recording_findings' end,
    progress_percent = case when p_complete then 100 else greatest(progress_percent, 90) end,
    progress_message = case when p_complete then 'Quality assessment completed.' else 'Recording quality findings.' end,
    lease_owner = case when p_complete then null else lease_owner end,
    lease_expires_at = case when p_complete then null else lease_expires_at end,
    completed_at = case when p_complete then now() else null end, updated_at = now()
  where organization_id = p_organization_id and id = p_report_id;
  return query select case when p_complete then 'completed' else 'persisted' end, public.sbom_quality_report_json(p_organization_id, p_report_id);
end;
$$;

create or replace function public.fail_sbom_quality_report(
  p_organization_id uuid, p_report_id uuid, p_worker_id text, p_error_code text, p_error_message text
) returns table(outcome text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_error_code not in ('normalized_document_missing', 'quality_persistence_unavailable', 'quality_configuration_unavailable', 'quality_source_missing', 'quality_statement_timeout', 'quality_calculation_failed', 'provider_unavailable', 'unexpected_failure')
    or char_length(btrim(coalesce(p_error_message, ''))) not between 1 and 1000 then
    return query select 'invalid_request'::text; return;
  end if;
  update public.sbom_quality_reports set state='failed', progress_stage='failed', lease_owner=null, lease_expires_at=null,
    error_code=p_error_code, error_message=btrim(p_error_message), next_attempt_at=now(), updated_at=now()
  where organization_id=p_organization_id and id=p_report_id and state='processing'
    and lease_owner=btrim(p_worker_id) and lease_expires_at>now();
  if not found then return query select 'not_found'::text; return; end if;
  return query select 'failed'::text;
end;
$$;

create or replace function public.get_sbom_quality_report(
  p_organization_id uuid, p_actor_user_id uuid, p_source_id uuid
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_report_id uuid;
begin
  if not public.sbom_actor_can_view(p_organization_id, p_actor_user_id)
    or not exists (select 1 from public.sbom_sources where organization_id=p_organization_id and id=p_source_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  select id into v_report_id from public.sbom_quality_reports
    where organization_id=p_organization_id and source_id=p_source_id order by created_at desc,id desc limit 1;
  if v_report_id is null then return query select 'not_found'::text, null::jsonb; return; end if;
  return query select 'found'::text, jsonb_build_object('report', public.sbom_quality_report_json(p_organization_id, v_report_id));
end;
$$;

create or replace function public.list_sbom_quality_findings(
  p_organization_id uuid, p_actor_user_id uuid, p_source_id uuid, p_limit integer, p_cursor text,
  p_severity text, p_kind text
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_report_id uuid; v_rows jsonb; v_cursor jsonb; v_created timestamptz; v_id uuid;
begin
  if not public.sbom_actor_can_view(p_organization_id,p_actor_user_id) or p_limit not between 1 and 100
    or p_severity is not null and p_severity not in ('info','warning','error')
    or p_kind is not null and p_kind not in ('coverage_gap','bsi_rule','regression')
    or not exists(select 1 from public.sbom_sources where organization_id=p_organization_id and id=p_source_id) then
    return query select 'not_found'::text,null::jsonb; return;
  end if;
  select id into v_report_id from public.sbom_quality_reports where organization_id=p_organization_id and source_id=p_source_id order by created_at desc,id desc limit 1;
  if v_report_id is null then return query select 'not_found'::text,null::jsonb; return; end if;
  if nullif(p_cursor,'') is not null then
    begin
      v_cursor := convert_from(decode(p_cursor,'base64'),'utf8')::jsonb;
      v_created := (v_cursor ->> 0)::timestamptz; v_id := (v_cursor ->> 1)::uuid;
      if jsonb_typeof(v_cursor) <> 'array' or jsonb_array_length(v_cursor) <> 2 then raise exception 'invalid cursor'; end if;
    exception when others then return query select 'invalid_request'::text,null::jsonb; return; end;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'reportId',x.report_id,'kind',case x.category when 'coverage' then 'coverage_gap' when 'profile' then 'bsi_rule' else 'regression' end,'code',x.code,'ruleId',x.rule_id,'severity',x.severity,'dimension',x.dimension,'componentId',x.component_id,'sourcePath',x.source_path,'expected',x.expected_condition,'actual',x.actual_condition,'remediation',x.remediation,'createdAt',x.created_at) order by x.created_at,x.id),'[]'::jsonb) into v_rows
  from (select f.* from public.sbom_quality_findings f where f.organization_id=p_organization_id and f.report_id=v_report_id and (v_cursor is null or (f.created_at,f.id)>(v_created,v_id)) and (p_severity is null or f.severity=p_severity) and (p_kind is null or (case f.category when 'coverage' then 'coverage_gap' when 'profile' then 'bsi_rule' else 'regression' end)=p_kind) order by f.created_at,f.id limit p_limit) x;
  return query select 'found'::text,jsonb_build_object('findings',v_rows,'nextCursor',case when jsonb_array_length(v_rows)=p_limit then public.sbom_quality_cursor_encode((v_rows->(p_limit-1)->>'createdAt'),(v_rows->(p_limit-1)->>'id')::uuid) else null end);
end;
$$;

create or replace function public.get_organization_sbom_quality_settings(
  p_organization_id uuid, p_actor_user_id uuid
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.sbom_actor_can_view(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb; return; end if;
  return query select 'found'::text,jsonb_build_object('bsiProfileEnabled',coalesce((select bsi_profile_enabled from public.organization_sbom_quality_settings where organization_id=p_organization_id),false),'bsiRulesetVersion',coalesce((select bsi_ruleset_version from public.organization_sbom_quality_settings where organization_id=p_organization_id),'bsi-tr-03183-2.v2.0.0'),'configVersion',coalesce((select config_version from public.organization_sbom_quality_settings where organization_id=p_organization_id),1));
end;
$$;

create or replace function public.update_organization_sbom_quality_settings_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_bsi_profile_enabled boolean
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_settings public.organization_sbom_quality_settings%rowtype;
begin
  if not exists(select 1 from public.organization_members m join public.users u on u.id=m.user_id and u.is_active where m.organization_id=p_organization_id and m.user_id=p_actor_user_id and m.role='owner') then
    return query select 'not_found'::text,null::jsonb; return;
  end if;
  insert into public.organization_sbom_quality_settings(organization_id,bsi_profile_enabled,created_by,updated_by)
  values(p_organization_id,p_bsi_profile_enabled,p_actor_user_id,p_actor_user_id)
  on conflict (organization_id) do update set bsi_profile_enabled=excluded.bsi_profile_enabled,config_version=public.organization_sbom_quality_settings.config_version+1,updated_by=excluded.updated_by,updated_at=now()
  returning * into v_settings;
  return query select 'updated'::text,jsonb_build_object('bsiProfileEnabled',v_settings.bsi_profile_enabled,'bsiRulesetVersion',v_settings.bsi_ruleset_version,'configVersion',v_settings.config_version);
end;
$$;

-- Contract-facing settings names keep the quality feature independent from the
-- physical settings table and give owners optimistic-concurrency protection.
create or replace function public.get_sbom_quality_settings(
  p_organization_id uuid, p_actor_user_id uuid
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.sbom_actor_can_view(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb; return; end if;
  return query select 'found'::text,jsonb_build_object('settings',jsonb_build_object(
    'version',coalesce((select config_version from public.organization_sbom_quality_settings where organization_id=p_organization_id),0),
    'bsiProfileEnabled',coalesce((select bsi_profile_enabled from public.organization_sbom_quality_settings where organization_id=p_organization_id),false),
    'rulesetVersion',coalesce((select bsi_ruleset_version from public.organization_sbom_quality_settings where organization_id=p_organization_id),'bsi-tr-03183-2.v2.0.0'),
    'updatedAt',coalesce((select updated_at from public.organization_sbom_quality_settings where organization_id=p_organization_id),now())
  ));
end;
$$;

create or replace function public.update_sbom_quality_settings_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_expected_version integer,
  p_bsi_profile_enabled boolean, p_idempotency_key uuid
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_settings public.organization_sbom_quality_settings%rowtype;
begin
  if p_expected_version < 0 or not exists(select 1 from public.organization_members m join public.users u on u.id=m.user_id and u.is_active where m.organization_id=p_organization_id and m.user_id=p_actor_user_id and m.role='owner') then
    return query select 'not_found'::text,null::jsonb; return;
  end if;
  insert into public.organization_sbom_quality_settings(organization_id,bsi_profile_enabled,created_by,updated_by)
  values(p_organization_id,p_bsi_profile_enabled,p_actor_user_id,p_actor_user_id)
  on conflict (organization_id) do nothing;
  select * into v_settings from public.organization_sbom_quality_settings where organization_id=p_organization_id for update;
  if v_settings.config_version <> p_expected_version then return query select 'conflict'::text,null::jsonb; return; end if;
  update public.organization_sbom_quality_settings set bsi_profile_enabled=p_bsi_profile_enabled,config_version=config_version+1,updated_by=p_actor_user_id,updated_at=now()
    where organization_id=p_organization_id returning * into v_settings;
  return query select 'updated'::text,jsonb_build_object('settings',jsonb_build_object('version',v_settings.config_version,'bsiProfileEnabled',v_settings.bsi_profile_enabled,'rulesetVersion',v_settings.bsi_ruleset_version,'updatedAt',v_settings.updated_at));
end;
$$;

create or replace function public.enqueue_sbom_quality_assessment_atomic(
  p_organization_id uuid, p_job_id uuid, p_worker_id text, p_document_id uuid
) returns table(outcome text, report jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_source_id uuid; v_result record;
begin
  select j.source_id into v_source_id from public.sbom_ingest_jobs j
  join public.sbom_documents d on d.organization_id=j.organization_id and d.id=p_document_id and d.state='completed'
  where j.organization_id=p_organization_id and j.id=p_job_id and d.ingest_job_id=p_job_id and j.status='completed';
  if v_source_id is null then return query select 'not_found'::text,null::jsonb; return; end if;
  select * into v_result from public.enqueue_sbom_quality_report_atomic(p_organization_id,v_source_id,p_document_id);
  return query select case when v_result.outcome='completed' then 'replayed' else 'queued' end,v_result.report;
end;
$$;

-- Preserve the original M3 batch shape while recording the ordered source
-- values needed for quality.  Existing scalar supplier/license fields remain
-- present for M3-03 compatibility.
create or replace function public.persist_sbom_normalization_batch_atomic(
  p_organization_id uuid, p_job_id uuid, p_worker_id text, p_document_id uuid,
  p_components jsonb, p_edges jsonb, p_diagnostics jsonb, p_source_offset bigint
) returns table(outcome text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_component_count integer;
begin
  if jsonb_typeof(p_components) <> 'array' or jsonb_typeof(p_edges) <> 'array' or jsonb_typeof(p_diagnostics) <> 'array' or jsonb_array_length(p_diagnostics) > 100 or octet_length(p_diagnostics::text) > 524288 or p_source_offset < 0 then return query select 'invalid_request'::text; return; end if;
  if not exists (select 1 from public.sbom_ingest_jobs jobs where jobs.organization_id=p_organization_id and jobs.id=p_job_id and jobs.status='processing' and jobs.lease_owner=btrim(p_worker_id) and jobs.lease_expires_at>now()) then return query select 'not_found'::text; return; end if;
  if not exists (select 1 from public.sbom_documents documents where documents.organization_id=p_organization_id and documents.id=p_document_id and documents.ingest_job_id=p_job_id and documents.state='processing' for update) then return query select 'not_found'::text; return; end if;
  insert into public.sbom_components(organization_id,document_id,document_local_ref,source_offset,source_byte_end,source_path,source_line,original_name,normalized_name,original_version,normalized_version,original_purl,canonical_purl,cpe,ecosystem,scope,supplier,license_expression,hashes,supplier_values,license_values)
  select p_organization_id,p_document_id,x.document_local_ref,x.source_offset,x.source_byte_end,x.source_path,x.source_line,x.original_name,x.normalized_name,x.original_version,x.normalized_version,x.original_purl,x.canonical_purl,x.cpe,x.ecosystem,x.scope,x.supplier,x.license_expression,coalesce(x.hashes,'[]'::jsonb),coalesce(x.supplier_values,'[]'::jsonb),coalesce(x.license_values,'[]'::jsonb)
  from jsonb_to_recordset(p_components) as x(document_local_ref text,source_offset bigint,source_byte_end bigint,source_path text,source_line integer,original_name text,normalized_name text,original_version text,normalized_version text,original_purl text,canonical_purl text,cpe text,ecosystem text,scope text,supplier text,license_expression text,hashes jsonb,supplier_values jsonb,license_values jsonb)
  on conflict (organization_id,document_id,document_local_ref) do update set source_offset=excluded.source_offset,source_byte_end=excluded.source_byte_end,source_path=excluded.source_path,source_line=excluded.source_line,original_name=excluded.original_name,normalized_name=excluded.normalized_name,original_version=excluded.original_version,normalized_version=excluded.normalized_version,original_purl=excluded.original_purl,canonical_purl=excluded.canonical_purl,cpe=excluded.cpe,ecosystem=excluded.ecosystem,scope=excluded.scope,supplier=excluded.supplier,license_expression=excluded.license_expression,hashes=excluded.hashes,supplier_values=excluded.supplier_values,license_values=excluded.license_values;
  insert into public.sbom_component_identities(organization_id,document_id,component_id,identity_type,original_value,canonical_value)
  select c.organization_id,c.document_id,c.id,'bom_ref',c.document_local_ref,c.document_local_ref from public.sbom_components c join jsonb_to_recordset(p_components) as x(document_local_ref text) on x.document_local_ref=c.document_local_ref where c.organization_id=p_organization_id and c.document_id=p_document_id on conflict (organization_id,document_id,component_id,identity_type,original_value) do nothing;
  insert into public.sbom_component_identities(organization_id,document_id,component_id,identity_type,original_value,canonical_value)
  select c.organization_id,c.document_id,c.id,'purl',c.original_purl,c.canonical_purl from public.sbom_components c join jsonb_to_recordset(p_components) as x(document_local_ref text) on x.document_local_ref=c.document_local_ref where c.organization_id=p_organization_id and c.document_id=p_document_id and c.original_purl is not null on conflict (organization_id,document_id,component_id,identity_type,original_value) do update set canonical_value=excluded.canonical_value;
  insert into public.sbom_component_identities(organization_id,document_id,component_id,identity_type,original_value,canonical_value)
  select c.organization_id,c.document_id,c.id,'cpe',c.cpe,null from public.sbom_components c join jsonb_to_recordset(p_components) as x(document_local_ref text) on x.document_local_ref=c.document_local_ref where c.organization_id=p_organization_id and c.document_id=p_document_id and c.cpe is not null on conflict (organization_id,document_id,component_id,identity_type,original_value) do nothing;
  insert into public.sbom_component_dependencies(organization_id,document_id,parent_component_id,child_component_id,parent_reference,child_reference,source_offset,source_byte_end,source_path,source_line)
  select p_organization_id,p_document_id,parent_component.id,child_component.id,x.parent_reference,x.child_reference,x.source_offset,x.source_byte_end,x.source_path,x.source_line from jsonb_to_recordset(p_edges) as x(parent_reference text,child_reference text,source_offset bigint,source_byte_end bigint,source_path text,source_line integer) left join public.sbom_components parent_component on parent_component.organization_id=p_organization_id and parent_component.document_id=p_document_id and parent_component.document_local_ref=x.parent_reference left join public.sbom_components child_component on child_component.organization_id=p_organization_id and child_component.document_id=p_document_id and child_component.document_local_ref=x.child_reference on conflict (organization_id,document_id,parent_reference,child_reference,edge_state) do update set source_offset=excluded.source_offset,source_byte_end=excluded.source_byte_end,source_path=excluded.source_path,source_line=excluded.source_line;
  select count(*) into v_component_count from public.sbom_components where organization_id=p_organization_id and document_id=p_document_id;
  if v_component_count>50000 then update public.sbom_documents set state='failed',progress_stage='failed',error_code='normalization_component_limit_exceeded',error_message='The document exceeds the configured component ceiling.' where organization_id=p_organization_id and id=p_document_id; update public.sbom_ingest_jobs set status='failed',progress_stage='failed',error_code='normalization_component_limit_exceeded',lease_owner=null,lease_expires_at=null where organization_id=p_organization_id and id=p_job_id; return query select 'failed'::text; return; end if;
  update public.sbom_documents set progress_stage='batching',progress_component_count=v_component_count,progress_dependency_count=(select count(*) from public.sbom_component_dependencies where organization_id=p_organization_id and document_id=p_document_id),checkpoint_source_offset=greatest(checkpoint_source_offset,p_source_offset),checkpoint_batch=checkpoint_batch+1,diagnostics=p_diagnostics where organization_id=p_organization_id and id=p_document_id;
  update public.sbom_ingest_jobs set progress_stage='batching',progress_percent=greatest(progress_percent,75) where organization_id=p_organization_id and id=p_job_id;
  return query select 'persisted'::text;
end;
$$;

-- Correct tuple cursors for all ordered M3 reads.  Bare UUID cursors were not
-- compatible with the documented sort orders and could skip or repeat rows.
create or replace function public.list_sbom_documents_for_release(
  p_organization_id uuid, p_actor_user_id uuid, p_product_id uuid,
  p_release_id uuid, p_limit integer, p_cursor text
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_rows jsonb; v_cursor jsonb; v_created timestamptz; v_id uuid;
begin
  if not public.sbom_actor_can_view(p_organization_id,p_actor_user_id) or p_limit not between 1 and 100
    or not exists(select 1 from public.product_releases r where r.organization_id=p_organization_id and r.product_id=p_product_id and r.id=p_release_id) then
    return query select 'not_found'::text,null::jsonb; return;
  end if;
  if nullif(p_cursor,'') is not null then
    begin
      v_cursor:=convert_from(decode(p_cursor,'base64'),'utf8')::jsonb;
      v_created:=(v_cursor->>0)::timestamptz; v_id:=(v_cursor->>1)::uuid;
      if jsonb_typeof(v_cursor)<>'array' or jsonb_array_length(v_cursor)<>2 then raise exception 'invalid cursor'; end if;
    exception when others then return query select 'invalid_request'::text,null::jsonb; return;
    end;
  end if;
  select coalesce(jsonb_agg(jsonb_set(public.sbom_document_json(p_organization_id,x.id),'{sourceId}',to_jsonb(x.source_id::text)) order by x.created_at desc,x.id desc),'[]'::jsonb)
    into v_rows
  from (
    select * from (
      select distinct on (d.id) d.id,d.created_at,ds.source_id
      from public.sbom_documents d
      join public.sbom_document_sources ds on ds.organization_id=d.organization_id and ds.document_id=d.id
      where d.organization_id=p_organization_id and ds.release_id=p_release_id
        and (v_cursor is null or (d.created_at,d.id)<(v_created,v_id))
      order by d.id,ds.created_at desc,ds.source_id desc
    ) mapped
    order by mapped.created_at desc,mapped.id desc
    limit p_limit
  ) x;
  return query select 'found'::text,jsonb_build_object('documents',v_rows,'nextCursor',case when jsonb_array_length(v_rows)=p_limit then public.sbom_quality_cursor_encode(v_rows->(p_limit-1)->>'createdAt',(v_rows->(p_limit-1)->>'id')::uuid) else null end);
end;
$$;

create or replace function public.search_sbom_components(p_organization_id uuid,p_actor_user_id uuid,p_document_id uuid,p_q text,p_limit integer,p_cursor text)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$ declare v_rows jsonb;v_cursor jsonb;v_name text;v_id uuid;begin if not public.sbom_actor_can_view(p_organization_id,p_actor_user_id) or p_limit not between 1 and 100 or not exists(select 1 from public.sbom_documents d where d.organization_id=p_organization_id and d.id=p_document_id and d.state='completed') then return query select 'not_found'::text,null::jsonb;return;end if;if nullif(p_cursor,'') is not null then begin v_cursor:=convert_from(decode(p_cursor,'base64'),'utf8')::jsonb;v_name:=v_cursor->>0;v_id:=(v_cursor->>1)::uuid;if jsonb_typeof(v_cursor)<>'array' or jsonb_array_length(v_cursor)<>2 then raise exception 'invalid cursor';end if;exception when others then return query select 'invalid_request'::text,null::jsonb;return;end;end if;select coalesce(jsonb_agg(public.sbom_component_json(p_organization_id,x.id) order by x.normalized_name,x.id),'[]'::jsonb) into v_rows from(select c.id,c.normalized_name from public.sbom_components c where c.organization_id=p_organization_id and c.document_id=p_document_id and(v_cursor is null or(c.normalized_name,c.id)>(v_name,v_id))and(nullif(btrim(p_q),'')is null or c.normalized_name ilike '%'||btrim(p_q)||'%'or c.canonical_purl ilike '%'||btrim(p_q)||'%')order by c.normalized_name,c.id limit p_limit)x;return query select 'found'::text,jsonb_build_object('components',v_rows,'nextCursor',case when jsonb_array_length(v_rows)=p_limit then public.sbom_quality_cursor_encode(v_rows->(p_limit-1)->>'normalizedName',(v_rows->(p_limit-1)->>'id')::uuid) else null end);end;$$;

create or replace function public.list_sbom_dependency_tree(p_organization_id uuid,p_actor_user_id uuid,p_document_id uuid,p_parent_component_id uuid,p_q text,p_limit integer,p_cursor text)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$ declare v_rows jsonb;v_cursor jsonb;v_name text;v_id uuid;begin if not public.sbom_actor_can_view(p_organization_id,p_actor_user_id) or p_limit not between 1 and 100 or not exists(select 1 from public.sbom_documents d where d.organization_id=p_organization_id and d.id=p_document_id and d.state='completed') then return query select 'not_found'::text,null::jsonb;return;end if;if nullif(p_cursor,'')is not null then begin v_cursor:=convert_from(decode(p_cursor,'base64'),'utf8')::jsonb;v_name:=v_cursor->>0;v_id:=(v_cursor->>1)::uuid;if jsonb_typeof(v_cursor)<>'array'or jsonb_array_length(v_cursor)<>2 then raise exception 'invalid cursor';end if;exception when others then return query select 'invalid_request'::text,null::jsonb;return;end;end if;select coalesce(jsonb_agg(jsonb_build_object('component',public.sbom_component_json(p_organization_id,x.id),'childCount',x.child_count)order by x.normalized_name,x.id),'[]'::jsonb)into v_rows from(select c.id,c.normalized_name,(select count(*)from public.sbom_components child where child.organization_id=p_organization_id and child.document_id=p_document_id and child.canonical_parent_component_id=c.id)child_count from public.sbom_components c where c.organization_id=p_organization_id and c.document_id=p_document_id and c.canonical_parent_component_id is not distinct from p_parent_component_id and(v_cursor is null or(c.normalized_name,c.id)>(v_name,v_id))and(nullif(btrim(p_q),'')is null or c.normalized_name ilike '%'||btrim(p_q)||'%')order by c.normalized_name,c.id limit p_limit)x;return query select 'found'::text,jsonb_build_object('items',v_rows,'nextCursor',case when jsonb_array_length(v_rows)=p_limit then public.sbom_quality_cursor_encode(v_rows->(p_limit-1)->'component'->>'normalizedName',(v_rows->(p_limit-1)->'component'->>'id')::uuid) else null end);end;$$;

-- The worker only receives one bounded page of normalized facts at a time.
-- The page cursor is the immutable source-order tuple, never an inferred name.
create or replace function public.list_due_sbom_quality_organizations(
  p_limit integer
) returns table(organization_id uuid)
language sql security definer set search_path = public, pg_temp as $$
  select distinct r.organization_id
  from public.sbom_quality_reports r
  where p_limit between 1 and 1000
    and (
      (r.state in ('queued','failed') and r.next_attempt_at <= now() and r.attempt_count < r.max_attempts)
      or (r.state='processing' and r.lease_expires_at <= now())
    )
  order by r.organization_id
  limit p_limit;
$$;

create or replace function public.list_sbom_quality_component_facts(
  p_organization_id uuid, p_report_id uuid, p_document_id uuid,
  p_limit integer, p_cursor text
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cursor jsonb;
  v_offset bigint;
  v_id uuid;
  v_rows jsonb;
  v_next_offset bigint;
  v_next_id uuid;
  v_primary jsonb;
  v_maximum_depth integer;
begin
  if p_limit not between 1 and 5000 or not exists (
    select 1 from public.sbom_quality_reports r
    join public.sbom_documents d
      on d.organization_id=r.organization_id and d.id=r.document_id and d.state='completed'
    where r.organization_id=p_organization_id and r.id=p_report_id
      and r.document_id=p_document_id and r.state='processing'
  ) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  if nullif(p_cursor,'') is not null then
    begin
      v_cursor := convert_from(decode(p_cursor,'base64'),'utf8')::jsonb;
      if jsonb_typeof(v_cursor) <> 'array' or jsonb_array_length(v_cursor) <> 2 then
        raise exception 'invalid cursor';
      end if;
      v_offset := (v_cursor ->> 0)::bigint;
      v_id := (v_cursor ->> 1)::uuid;
    exception when others then
      return query select 'invalid_request'::text, null::jsonb; return;
    end;
  end if;
  with page as (
    select c.* from public.sbom_components c
    where c.organization_id=p_organization_id and c.document_id=p_document_id
      and (v_cursor is null or (c.source_offset,c.id) > (v_offset,v_id))
    order by c.source_offset,c.id limit p_limit
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'canonicalPurl',p.canonical_purl,'hashes',p.hashes,'supplier',p.supplier,
      'supplierValues',p.supplier_values,'licenseExpression',p.license_expression,
      'licenseValues',p.license_values,'depth',p.depth
    ) order by p.source_offset,p.id),'[]'::jsonb),
    (select last_row.source_offset from page last_row order by last_row.source_offset desc,last_row.id desc limit 1),
    (select last_row.id from page last_row order by last_row.source_offset desc,last_row.id desc limit 1)
  into v_rows,v_next_offset,v_next_id from page p;
  select d.maximum_depth into v_maximum_depth from public.sbom_documents d
    where d.organization_id=p_organization_id and d.id=p_document_id;
  with roots as (
    select c.id from public.sbom_components c
    where c.organization_id=p_organization_id and c.document_id=p_document_id
      and c.canonical_parent_component_id is null
    order by c.source_offset,c.document_local_ref,c.id limit 2
  ), root as (
    select id from roots where (select count(*) from roots) = 1
  )
  select jsonb_build_object('id',root.id,'directDependencyCount',(
    select count(*) from public.sbom_component_dependencies e
    where e.organization_id=p_organization_id and e.document_id=p_document_id
      and e.parent_component_id=root.id and e.edge_state='retained'
  )) into v_primary from root;
  return query select 'found'::text, jsonb_build_object(
    'components',v_rows,'primaryComponent',v_primary,'maximumDepth',coalesce(v_maximum_depth,0),
    'nextCursor',case when jsonb_array_length(v_rows)=p_limit
      then public.sbom_quality_cursor_encode(v_next_offset::text,v_next_id) else null end
  );
end;
$$;

alter function public.sbom_quality_cursor_encode(text,uuid) owner to postgres;
alter function public.list_due_sbom_quality_organizations(integer) owner to postgres;
alter function public.list_sbom_quality_component_facts(uuid,uuid,uuid,integer,text) owner to postgres;
alter function public.sbom_quality_report_json(uuid,uuid) owner to postgres;
alter function public.enqueue_sbom_quality_report_atomic(uuid,uuid,uuid) owner to postgres;
alter function public.claim_sbom_quality_report(uuid,text,integer) owner to postgres;
alter function public.persist_sbom_quality_report_atomic(uuid,uuid,text,jsonb,jsonb,boolean) owner to postgres;
alter function public.fail_sbom_quality_report(uuid,uuid,text,text,text) owner to postgres;
alter function public.get_sbom_quality_report(uuid,uuid,uuid) owner to postgres;
alter function public.list_sbom_quality_findings(uuid,uuid,uuid,integer,text,text,text) owner to postgres;
alter function public.get_organization_sbom_quality_settings(uuid,uuid) owner to postgres;
alter function public.update_organization_sbom_quality_settings_atomic(uuid,uuid,boolean) owner to postgres;
alter function public.get_sbom_quality_settings(uuid,uuid) owner to postgres;
alter function public.update_sbom_quality_settings_atomic(uuid,uuid,integer,boolean,uuid) owner to postgres;
alter function public.enqueue_sbom_quality_assessment_atomic(uuid,uuid,text,uuid) owner to postgres;
alter function public.persist_sbom_normalization_batch_atomic(uuid,uuid,text,uuid,jsonb,jsonb,jsonb,bigint) owner to postgres;
alter function public.list_sbom_documents_for_release(uuid,uuid,uuid,uuid,integer,text) owner to postgres;
alter function public.search_sbom_components(uuid,uuid,uuid,text,integer,text) owner to postgres;
alter function public.list_sbom_dependency_tree(uuid,uuid,uuid,uuid,text,integer,text) owner to postgres;
revoke all on function public.sbom_quality_cursor_encode(text,uuid),public.sbom_quality_report_json(uuid,uuid),public.enqueue_sbom_quality_report_atomic(uuid,uuid,uuid),public.enqueue_sbom_quality_for_completed_document_trigger(),public.claim_sbom_quality_report(uuid,text,integer),public.persist_sbom_quality_report_atomic(uuid,uuid,text,jsonb,jsonb,boolean),public.fail_sbom_quality_report(uuid,uuid,text,text,text),public.get_sbom_quality_report(uuid,uuid,uuid),public.list_sbom_quality_findings(uuid,uuid,uuid,integer,text,text,text),public.get_organization_sbom_quality_settings(uuid,uuid),public.update_organization_sbom_quality_settings_atomic(uuid,uuid,boolean),public.get_sbom_quality_settings(uuid,uuid),public.update_sbom_quality_settings_atomic(uuid,uuid,integer,boolean,uuid),public.enqueue_sbom_quality_assessment_atomic(uuid,uuid,text,uuid),public.list_due_sbom_quality_organizations(integer),public.list_sbom_quality_component_facts(uuid,uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.enqueue_sbom_quality_report_atomic(uuid,uuid,uuid),public.enqueue_sbom_quality_assessment_atomic(uuid,uuid,text,uuid),public.claim_sbom_quality_report(uuid,text,integer),public.persist_sbom_quality_report_atomic(uuid,uuid,text,jsonb,jsonb,boolean),public.fail_sbom_quality_report(uuid,uuid,text,text,text),public.get_sbom_quality_report(uuid,uuid,uuid),public.list_sbom_quality_findings(uuid,uuid,uuid,integer,text,text,text),public.get_organization_sbom_quality_settings(uuid,uuid),public.update_organization_sbom_quality_settings_atomic(uuid,uuid,boolean),public.get_sbom_quality_settings(uuid,uuid),public.update_sbom_quality_settings_atomic(uuid,uuid,integer,boolean,uuid),public.list_due_sbom_quality_organizations(integer),public.list_sbom_quality_component_facts(uuid,uuid,uuid,integer,text) to service_role;

do $$
declare v_row record;
begin
  for v_row in select ds.organization_id,ds.source_id,ds.document_id from public.sbom_document_sources ds join public.sbom_documents d on d.organization_id=ds.organization_id and d.id=ds.document_id where d.state='completed' loop
    perform outcome from public.enqueue_sbom_quality_report_atomic(v_row.organization_id,v_row.source_id,v_row.document_id);
  end loop;
end;
$$;
