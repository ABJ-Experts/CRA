-- CRA-M5-06: immutable, release-scoped VEX exports are intentionally kept
-- separate from assessment revisions and the regulatory outbox.  The export
-- record is evidence of exactly the effective assessments selected at one
-- point in time; publication is a separate durable delivery workflow.

create table public.vulnerability_vex_export_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  release_id uuid not null,
  export_format text not null check (export_format in ('openvex', 'cyclonedx-vex')),
  specification_version text not null check (
    (export_format = 'openvex' and specification_version = '0.2.0')
    or (export_format = 'cyclonedx-vex' and specification_version = '1.6')
  ),
  scope_version integer not null check (scope_version >= 0),
  scope_digest text not null check (scope_digest ~ '^[a-f0-9]{64}$'),
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  content_bytes integer not null check (content_bytes between 1 and 52428800),
  storage_bucket text not null default 'tenant-exports' check (storage_bucket = 'tenant-exports'),
  storage_object_path text not null check (
    storage_object_path !~ '[[:space:][:cntrl:]]'
    and storage_object_path !~ '(^|/)\.\.(/|$)'
    and storage_object_path ~ '^[0-9a-f-]{36}/vex/(openvex|cyclonedx-vex)/[0-9_]+/[a-f0-9]{64}\.json$'
  ),
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id),
  unique (organization_id, release_id, export_format, specification_version, scope_digest),
  foreign key (organization_id, release_id)
    references public.product_releases(organization_id, id) on delete restrict,
  check (storage_object_path = organization_id::text || '/vex/' || export_format || '/'
    || replace(specification_version, '.', '_') || '/' || content_sha256 || '.json')
);

create table public.vulnerability_vex_export_snapshot_assessments (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  snapshot_id uuid not null,
  assessment_id uuid not null,
  finding_id uuid not null,
  assessment_revision integer not null check (assessment_revision > 0),
  primary key (organization_id, snapshot_id, assessment_id),
  unique (organization_id, snapshot_id, finding_id),
  foreign key (organization_id, snapshot_id)
    references public.vulnerability_vex_export_snapshots(organization_id, id) on delete cascade,
  foreign key (organization_id, assessment_id)
    references public.vulnerability_finding_assessments(organization_id, id) on delete restrict,
  foreign key (organization_id, finding_id)
    references public.vulnerability_findings(organization_id, id) on delete restrict
);

create table public.vulnerability_vex_publication_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  target_key text not null check (target_key ~ '^[a-z][a-z0-9-]{0,62}$'),
  enabled boolean not null default false,
  version integer not null default 1 check (version > 0),
  current_snapshot_id uuid,
  current_publication_job_id uuid,
  published_at timestamptz,
  withdrawn_at timestamptz,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references public.users(id) on delete restrict,
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id),
  unique (organization_id, target_key),
  foreign key (organization_id, current_snapshot_id)
    references public.vulnerability_vex_export_snapshots(organization_id, id) on delete restrict,
  check ((current_snapshot_id is null and current_publication_job_id is null and published_at is null)
    or (current_snapshot_id is not null and current_publication_job_id is not null and published_at is not null))
);

create table public.vulnerability_vex_publication_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  snapshot_id uuid not null,
  target_id uuid not null,
  job_kind text not null check (job_kind in ('publish', 'withdraw')),
  event_key text not null check (event_key ~ '^vex-publication:(publish|withdraw):[0-9a-f-]{36}:[0-9a-f-]{36}$'),
  delivery_state text not null default 'pending' check (delivery_state in (
    'pending', 'leased', 'published', 'replaced', 'withdrawn', 'retrying', 'dead_letter'
  )),
  version integer not null default 1 check (version > 0),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 10),
  next_attempt_at timestamptz not null default clock_timestamp(),
  lease_owner uuid,
  lease_expires_at timestamptz,
  last_error_code text check (last_error_code is null or last_error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  last_error_detail text check (last_error_detail is null or char_length(last_error_detail) between 1 and 500),
  replaced_by_snapshot_id uuid,
  withdrawal_reason text check (withdrawal_reason is null or char_length(btrim(withdrawal_reason)) between 1 and 1000),
  completed_at timestamptz,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id),
  unique (organization_id, event_key),
  foreign key (organization_id, snapshot_id)
    references public.vulnerability_vex_export_snapshots(organization_id, id) on delete restrict,
  foreign key (organization_id, target_id)
    references public.vulnerability_vex_publication_targets(organization_id, id) on delete restrict,
  foreign key (organization_id, replaced_by_snapshot_id)
    references public.vulnerability_vex_export_snapshots(organization_id, id) on delete restrict,
  check ((delivery_state = 'leased') = (lease_owner is not null and lease_expires_at is not null)),
  check ((delivery_state in ('published', 'replaced', 'withdrawn')) = (completed_at is not null)),
  check ((delivery_state = 'replaced') = (replaced_by_snapshot_id is not null)),
  check ((delivery_state = 'withdrawn') = (withdrawal_reason is not null))
);

alter table public.vulnerability_vex_publication_targets
  add constraint vulnerability_vex_publication_targets_current_job_fk
  foreign key (organization_id, current_publication_job_id)
  references public.vulnerability_vex_publication_jobs(organization_id, id) on delete restrict;

create table public.vulnerability_vex_publication_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null,
  attempt_number integer not null check (attempt_number > 0),
  outcome text not null check (outcome in ('claimed', 'published', 'replaced', 'withdrawn', 'retrying', 'dead_letter')),
  remote_version text check (remote_version is null or char_length(btrim(remote_version)) between 1 and 500),
  http_status integer check (http_status is null or http_status between 100 and 599),
  error_code text check (error_code is null or error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  error_detail text check (error_detail is null or char_length(error_detail) between 1 and 500),
  occurred_at timestamptz not null default clock_timestamp(),
  unique (organization_id, job_id, attempt_number, outcome),
  foreign key (organization_id, job_id)
    references public.vulnerability_vex_publication_jobs(organization_id, id) on delete cascade
);

create index vulnerability_vex_export_snapshots_release_idx
  on public.vulnerability_vex_export_snapshots(organization_id, release_id, created_at desc, id desc);
create index vulnerability_vex_export_snapshot_assessments_assessment_idx
  on public.vulnerability_vex_export_snapshot_assessments(organization_id, assessment_id, snapshot_id);
create index vulnerability_vex_publication_jobs_due_idx
  on public.vulnerability_vex_publication_jobs(organization_id, next_attempt_at, created_at, id)
  where delivery_state in ('pending', 'retrying');
create index vulnerability_vex_publication_jobs_target_idx
  on public.vulnerability_vex_publication_jobs(organization_id, target_id, created_at desc, id desc);
create index vulnerability_vex_publication_attempts_job_idx
  on public.vulnerability_vex_publication_attempts(organization_id, job_id, occurred_at, id);

alter table public.vulnerability_vex_export_snapshots enable row level security;
alter table public.vulnerability_vex_export_snapshot_assessments enable row level security;
alter table public.vulnerability_vex_publication_targets enable row level security;
alter table public.vulnerability_vex_publication_jobs enable row level security;
alter table public.vulnerability_vex_publication_attempts enable row level security;

revoke all on table public.vulnerability_vex_export_snapshots,
  public.vulnerability_vex_export_snapshot_assessments,
  public.vulnerability_vex_publication_targets,
  public.vulnerability_vex_publication_jobs,
  public.vulnerability_vex_publication_attempts from public, anon, authenticated;
grant all on table public.vulnerability_vex_export_snapshots,
  public.vulnerability_vex_export_snapshot_assessments,
  public.vulnerability_vex_publication_targets,
  public.vulnerability_vex_publication_jobs,
  public.vulnerability_vex_publication_attempts to service_role;

-- A VEX snapshot and a publication attempt are evidence.  Only the narrow
-- transition functions below may change current target pointers or jobs.
create or replace function public.m5_vex_export_prevent_snapshot_mutation()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' and not exists (
    select 1 from public.organizations organizations where organizations.id = old.organization_id
  ) then
    return old;
  end if;
  raise exception 'VEX export snapshots are immutable' using errcode = 'check_violation';
end;
$$;
create trigger m5_vex_export_prevent_snapshot_mutation
  before update or delete on public.vulnerability_vex_export_snapshots
  for each row execute function public.m5_vex_export_prevent_snapshot_mutation();

create or replace function public.m5_vex_export_prevent_snapshot_assessment_mutation()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' and not exists (
    select 1 from public.organizations organizations where organizations.id = old.organization_id
  ) then
    return old;
  end if;
  raise exception 'VEX export snapshot assessments are immutable' using errcode = 'check_violation';
end;
$$;
create trigger m5_vex_export_prevent_snapshot_assessment_mutation
  before update or delete on public.vulnerability_vex_export_snapshot_assessments
  for each row execute function public.m5_vex_export_prevent_snapshot_assessment_mutation();

create or replace function public.m5_vex_export_prevent_publication_attempt_mutation()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' and not exists (
    select 1 from public.organizations organizations where organizations.id = old.organization_id
  ) then
    return old;
  end if;
  raise exception 'VEX publication attempts are immutable' using errcode = 'check_violation';
end;
$$;
create trigger m5_vex_export_prevent_publication_attempt_mutation
  before update or delete on public.vulnerability_vex_publication_attempts
  for each row execute function public.m5_vex_export_prevent_publication_attempt_mutation();

create trigger set_vulnerability_vex_publication_targets_updated_at
  before update on public.vulnerability_vex_publication_targets
  for each row execute function public.set_updated_at();

create trigger set_vulnerability_vex_publication_jobs_updated_at
  before update on public.vulnerability_vex_publication_jobs
  for each row execute function public.set_updated_at();

create or replace function public.m5_vex_export_scope_payload(
  p_organization_id uuid, p_product_id uuid, p_release_id uuid
) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with release_scope as (
    select products.id as product_id, products.name as product_name,
      releases.id as release_id, releases.label as release_label,
      releases.release_version as release_version, releases.version as scope_version
    from public.products products
    join public.product_releases releases
      on releases.organization_id = products.organization_id and releases.product_id = products.id
    where products.organization_id = p_organization_id
      and products.id = p_product_id and releases.id = p_release_id
  ), eligible as (
    select findings.id as finding_id, findings.component_identity,
      findings.evaluated_component_value as component_version,
      findings.canonical_advisory_id, assessments.id as assessment_id,
      assessments.revision as assessment_revision, assessments.vex_status,
      assessments.vex_justification, assessments.approval_state,
      assessments.submitted_at, assessments.decided_at,
      case when occurrences.canonical_purl_count = 1 then occurrences.canonical_purl else null end as canonical_purl,
      case when occurrences.canonical_purl_count = 0 then 'canonical_purl_missing'
        when occurrences.canonical_purl_count > 1 then 'canonical_purl_ambiguous' else null end as export_mapping_issue
    from public.vulnerability_findings findings
    join public.vulnerability_finding_assessments assessments
      on assessments.organization_id = findings.organization_id
      and assessments.id = public.m5_bulk_effective_assessment_id(p_organization_id, findings.id)
    left join lateral (
      select count(distinct occurrences.canonical_purl) filter (where occurrences.canonical_purl is not null) as canonical_purl_count,
        min(occurrences.canonical_purl) filter (where occurrences.canonical_purl is not null) as canonical_purl
      from public.vulnerability_finding_component_occurrences links
      join public.vulnerability_component_occurrences occurrences
        on occurrences.organization_id = links.organization_id and occurrences.id = links.occurrence_id
      where links.organization_id = findings.organization_id and links.finding_id = findings.id
        and links.state = 'active' and occurrences.release_id = findings.release_id
    ) occurrences on true
    where findings.organization_id = p_organization_id and findings.release_id = p_release_id
      and findings.status = 'active' and assessments.is_current
      and assessments.approval_state in ('approved', 'approval_not_required')
  )
  select jsonb_build_object(
    'organizationId', p_organization_id,
    'product', jsonb_build_object('id', scope.product_id, 'name', scope.product_name),
    'release', jsonb_build_object('id', scope.release_id, 'label', scope.release_label,
      'version', scope.release_version),
    'scopeVersion', scope.scope_version,
    'assessmentCount', (select count(*) from eligible),
    'assessments', coalesce((select jsonb_agg(jsonb_build_object(
      'findingId', eligible.finding_id,
      'componentIdentity', eligible.component_identity,
      'componentVersion', eligible.component_version,
      'canonicalPurl', eligible.canonical_purl,
      'exportMappingIssue', eligible.export_mapping_issue,
      'advisoryId', eligible.canonical_advisory_id,
      'assessmentId', eligible.assessment_id,
      'revision', eligible.assessment_revision,
      'status', eligible.vex_status,
      'justification', eligible.vex_justification,
      'approvalState', eligible.approval_state,
      'submittedAt', public.m2_utc_z(eligible.submitted_at),
      'decidedAt', case when eligible.decided_at is null then null else public.m2_utc_z(eligible.decided_at) end
    ) order by eligible.finding_id, eligible.assessment_revision) from eligible), '[]'::jsonb)
  ) from release_scope scope
$$;

create or replace function public.m5_vex_export_scope_json(
  p_organization_id uuid, p_product_id uuid, p_release_id uuid
) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with payload as (
    select public.m5_vex_export_scope_payload(p_organization_id, p_product_id, p_release_id) as value
  ) select case when value is null then null else jsonb_build_object(
    'scopeDigest', encode(extensions.digest(value::text, 'sha256'), 'hex'),
    'scope', value
  ) end from payload
$$;

create or replace function public.m5_vex_export_snapshot_json(
  p_organization_id uuid, p_snapshot_id uuid
) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', snapshots.id,
    'organizationId', snapshots.organization_id,
    'productId', releases.product_id,
    'releaseId', snapshots.release_id,
    'format', snapshots.export_format,
    'specificationVersion', snapshots.specification_version,
    'scopeVersion', snapshots.scope_version,
    'scopeDigest', snapshots.scope_digest,
    'contentSha256', snapshots.content_sha256,
    'byteSize', snapshots.content_bytes,
    'assessmentRevisionReferences', coalesce((select jsonb_agg(jsonb_build_object(
      'findingId', refs.finding_id,
      'assessmentId', refs.assessment_id,
      'assessmentRevision', refs.assessment_revision,
      'status', assessments.vex_status,
      'justification', assessments.vex_justification,
      'approvalState', assessments.approval_state
    ) order by refs.finding_id, refs.assessment_revision)
      from public.vulnerability_vex_export_snapshot_assessments refs
      join public.vulnerability_finding_assessments assessments
        on assessments.organization_id = refs.organization_id and assessments.id = refs.assessment_id
      where refs.organization_id = snapshots.organization_id and refs.snapshot_id = snapshots.id), '[]'::jsonb),
    'createdAt', public.m2_utc_z(snapshots.created_at),
    'createdByUserId', snapshots.created_by
  )
  from public.vulnerability_vex_export_snapshots snapshots
  join public.product_releases releases
    on releases.organization_id = snapshots.organization_id and releases.id = snapshots.release_id
  where snapshots.organization_id = p_organization_id and snapshots.id = p_snapshot_id
$$;

create or replace function public.preview_vulnerability_vex_export_scope(
  p_organization_id uuid, p_actor_user_id uuid, p_product_id uuid, p_release_id uuid, p_export_format text
) returns table(outcome text, result jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_scope jsonb;
begin
  if p_export_format is null or p_export_format not in ('openvex', 'cyclonedx-vex')
    or not public.m5_triage_actor_has_permission(p_organization_id, p_actor_user_id, 'can_export_findings') then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  v_scope := public.m5_vex_export_scope_json(p_organization_id, p_product_id, p_release_id);
  if v_scope is null then return query select 'not_found'::text, null::jsonb; return; end if;
  return query select case when (v_scope #>> '{scope,assessmentCount}')::integer = 0
    then 'no_eligible_assessments' else 'found' end, v_scope;
end;
$$;

alter table public.vulnerability_triage_commands
  drop constraint if exists vulnerability_triage_commands_operation_check,
  add constraint vulnerability_triage_commands_operation_check check (operation in (
    'assign', 'suppress', 'set_sla_policy', 'record_remediation_anchor',
    'create_vex_export_snapshot', 'configure_vex_publication_target',
    'queue_vex_publication', 'retry_vex_publication', 'withdraw_vex_publication'
  ));

-- Keep the established base-role → custom-role → override merge order.  The
-- resolver is intentionally feature-aware, so new permission keys need an
-- explicit base-role default here rather than a parallel RBAC mechanism.
create or replace function public.m5_triage_actor_has_permission(
  p_organization_id uuid, p_actor_user_id uuid, p_permission_key text
) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  with membership as (
    select member.role
    from public.organization_members member
    join public.users user_record on user_record.id = member.user_id and user_record.is_active
    join public.organizations organization on organization.id = member.organization_id and organization.is_active
    where member.organization_id = p_organization_id and member.user_id = p_actor_user_id
  ), base_permissions as (
    select role, case p_permission_key
      when 'can_edit_findings' then role in ('owner', 'admin')
      when 'can_edit_organization' then role = 'owner'
      when 'can_export_findings' then role in ('owner', 'admin')
      when 'can_manage_finding_publication' then role in ('owner', 'admin')
      else false end as granted
    from membership
  ), custom_permissions as (
    select bool_or((custom_role.permissions ->> p_permission_key)::boolean) as granted
    from membership
    join public.user_role_assignments assignment
      on assignment.organization_id = p_organization_id and assignment.user_id = p_actor_user_id
    join public.custom_roles custom_role
      on custom_role.organization_id = p_organization_id and custom_role.id = assignment.role_id
    where custom_role.is_active and not custom_role.is_deleted
      and jsonb_typeof(custom_role.permissions -> p_permission_key) = 'boolean'
      and (custom_role.permissions ->> p_permission_key)::boolean
  ), override_permissions as (
    select case when jsonb_typeof(permission_override.permissions -> p_permission_key) = 'boolean'
      then (permission_override.permissions ->> p_permission_key)::boolean end as granted
    from base_permissions base_permission
    left join public.base_role_permission_overrides permission_override
      on permission_override.organization_id = p_organization_id and permission_override.base_role = base_permission.role
  ) select coalesce(
    (select granted from override_permissions where granted is not null limit 1),
    (select coalesce(base_permissions.granted, false) or coalesce(custom_permissions.granted, false)
      from base_permissions cross join custom_permissions), false
  )
$$;

create or replace function public.create_vulnerability_vex_export_snapshot_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_product_id uuid, p_release_id uuid,
  p_export_format text, p_specification_version text, p_expected_scope_digest text,
  p_content_sha256 text, p_content_bytes integer, p_storage_object_path text,
  p_idempotency_key uuid, p_correlation_id uuid default null
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_release public.product_releases%rowtype;
  v_scope jsonb;
  v_existing record;
  v_snapshot public.vulnerability_vex_export_snapshots%rowtype;
  v_digest text;
begin
  if p_organization_id is null or p_actor_user_id is null or p_product_id is null or p_release_id is null
    or p_idempotency_key is null or p_export_format is null or p_export_format not in ('openvex', 'cyclonedx-vex')
    or (p_export_format = 'openvex' and p_specification_version <> '0.2.0')
    or (p_export_format = 'cyclonedx-vex' and p_specification_version <> '1.6')
    or p_expected_scope_digest !~ '^[a-f0-9]{64}$' or p_content_sha256 !~ '^[a-f0-9]{64}$'
    or p_content_bytes not between 1 and 52428800
    or p_storage_object_path <> p_organization_id::text || '/vex/' || p_export_format || '/'
      || replace(p_specification_version, '.', '_') || '/' || p_content_sha256 || '.json'
    or not public.m5_triage_actor_has_permission(p_organization_id, p_actor_user_id, 'can_export_findings') then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':' || p_actor_user_id::text || ':' || p_idempotency_key::text, 0));
  v_digest := encode(extensions.digest(jsonb_build_object(
    'productId', p_product_id, 'releaseId', p_release_id, 'format', p_export_format,
    'specificationVersion', p_specification_version, 'expectedScopeDigest', p_expected_scope_digest,
    'contentSha256', p_content_sha256, 'contentBytes', p_content_bytes,
    'storageObjectPath', p_storage_object_path
  )::text, 'sha256'), 'hex');
  select * into v_existing from public.m5_triage_command_result(
    p_organization_id, p_actor_user_id, p_idempotency_key, 'create_vex_export_snapshot', v_digest);
  if found then return query select v_existing.outcome, v_existing.result; return; end if;

  select * into v_release from public.product_releases releases
  where releases.organization_id = p_organization_id and releases.id = p_release_id
    and releases.product_id = p_product_id for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  perform 1 from public.vulnerability_findings findings
    where findings.organization_id = p_organization_id and findings.release_id = p_release_id for share;
  perform 1 from public.vulnerability_finding_assessments assessments
    join public.vulnerability_findings findings on findings.organization_id = assessments.organization_id
      and findings.id = assessments.finding_id
    where assessments.organization_id = p_organization_id and findings.release_id = p_release_id for share;
  v_scope := public.m5_vex_export_scope_json(p_organization_id, p_product_id, p_release_id);
  if v_scope is null then return query select 'not_found'::text, null::jsonb; return; end if;
  if (v_scope #>> '{scope,assessmentCount}')::integer = 0 then
    return query select 'no_eligible_assessments'::text, v_scope; return;
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_scope #> '{scope,assessments}') assessment
    where assessment ->> 'canonicalPurl' is null
  ) then
    return query select 'mapping_unavailable'::text, v_scope; return;
  end if;
  if v_scope ->> 'scopeDigest' <> p_expected_scope_digest then
    return query select 'scope_conflict'::text, v_scope; return;
  end if;
  if not exists (select 1 from storage.buckets buckets where buckets.id = 'tenant-exports' and not buckets.public)
    or not exists (select 1 from storage.objects objects
      where objects.bucket_id = 'tenant-exports' and objects.name = p_storage_object_path) then
    return query select 'storage_missing'::text, null::jsonb; return;
  end if;
  select * into v_snapshot from public.vulnerability_vex_export_snapshots snapshots
    where snapshots.organization_id = p_organization_id and snapshots.release_id = p_release_id
      and snapshots.export_format = p_export_format and snapshots.specification_version = p_specification_version
      and snapshots.scope_digest = p_expected_scope_digest for update;
  if found then
    if v_snapshot.content_sha256 <> p_content_sha256 or v_snapshot.content_bytes <> p_content_bytes
      or v_snapshot.storage_object_path <> p_storage_object_path then
      return query select 'snapshot_conflict'::text, public.m5_vex_export_snapshot_json(p_organization_id, v_snapshot.id); return;
    end if;
    insert into public.vulnerability_triage_commands(organization_id, actor_user_id, idempotency_key, operation, request_digest, result)
    values (p_organization_id, p_actor_user_id, p_idempotency_key, 'create_vex_export_snapshot', v_digest,
      jsonb_build_object('snapshot', public.m5_vex_export_snapshot_json(p_organization_id, v_snapshot.id)));
    return query select 'reused'::text,
      jsonb_build_object('snapshot', public.m5_vex_export_snapshot_json(p_organization_id, v_snapshot.id)); return;
  end if;

  insert into public.vulnerability_vex_export_snapshots(
    organization_id, release_id, export_format, specification_version, scope_version, scope_digest,
    content_sha256, content_bytes, storage_object_path, created_by
  ) values (
    p_organization_id, p_release_id, p_export_format, p_specification_version, v_release.version, p_expected_scope_digest,
    p_content_sha256, p_content_bytes, p_storage_object_path, p_actor_user_id
  ) returning * into v_snapshot;
  insert into public.vulnerability_vex_export_snapshot_assessments(
    organization_id, snapshot_id, assessment_id, finding_id, assessment_revision
  ) select p_organization_id, v_snapshot.id, assessments.id, assessments.finding_id, assessments.revision
    from public.vulnerability_finding_assessments assessments
    join public.vulnerability_findings findings
      on findings.organization_id = assessments.organization_id and findings.id = assessments.finding_id
    where assessments.organization_id = p_organization_id and findings.release_id = p_release_id
      and assessments.is_current and assessments.approval_state in ('approved', 'approval_not_required')
    order by assessments.finding_id, assessments.revision;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'vulnerability.vex_export_created',
    'vulnerability_vex_export_snapshot', v_snapshot.id::text,
    jsonb_build_object('releaseId', p_release_id, 'format', p_export_format,
      'specificationVersion', p_specification_version, 'scopeDigest', p_expected_scope_digest,
      'contentSha256', p_content_sha256, 'idempotencyKey', p_idempotency_key,
      'correlationId', p_correlation_id));
  insert into public.vulnerability_triage_commands(organization_id, actor_user_id, idempotency_key, operation, request_digest, result)
  values (p_organization_id, p_actor_user_id, p_idempotency_key, 'create_vex_export_snapshot', v_digest,
    jsonb_build_object('snapshot', public.m5_vex_export_snapshot_json(p_organization_id, v_snapshot.id)));
  return query select 'created'::text,
    jsonb_build_object('snapshot', public.m5_vex_export_snapshot_json(p_organization_id, v_snapshot.id));
end;
$$;

create or replace function public.list_vulnerability_vex_export_snapshots(
  p_organization_id uuid, p_actor_user_id uuid, p_product_id uuid, p_release_id uuid
) returns table(outcome text, result jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.m5_triage_actor_has_permission(p_organization_id, p_actor_user_id, 'can_export_findings')
    or not exists (select 1 from public.product_releases releases
      where releases.organization_id = p_organization_id and releases.id = p_release_id
        and releases.product_id = p_product_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  return query select 'found'::text, jsonb_build_object('snapshots', coalesce((
    select jsonb_agg(public.m5_vex_export_snapshot_json(p_organization_id, snapshots.id)
      order by snapshots.created_at desc, snapshots.id desc)
    from public.vulnerability_vex_export_snapshots snapshots
    where snapshots.organization_id = p_organization_id and snapshots.release_id = p_release_id
  ), '[]'::jsonb));
end;
$$;

create or replace function public.get_vulnerability_vex_export_storage_locator(
  p_organization_id uuid, p_actor_user_id uuid, p_snapshot_id uuid
) returns table(outcome text, result jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_snapshot public.vulnerability_vex_export_snapshots%rowtype;
begin
  if not public.m5_triage_actor_has_permission(p_organization_id, p_actor_user_id, 'can_export_findings') then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  select * into v_snapshot from public.vulnerability_vex_export_snapshots snapshots
    where snapshots.organization_id = p_organization_id and snapshots.id = p_snapshot_id;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  return query select 'found'::text, jsonb_build_object(
    'storageBucket', v_snapshot.storage_bucket, 'storageObjectPath', v_snapshot.storage_object_path,
    'contentSha256', v_snapshot.content_sha256, 'byteSize', v_snapshot.content_bytes,
    'format', v_snapshot.export_format
  );
end;
$$;

create or replace function public.get_vulnerability_vex_export_snapshot(
  p_organization_id uuid, p_actor_user_id uuid, p_snapshot_id uuid
) returns table(outcome text, result jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.m5_triage_actor_has_permission(p_organization_id, p_actor_user_id, 'can_export_findings')
    or not exists (select 1 from public.vulnerability_vex_export_snapshots snapshots
      where snapshots.organization_id = p_organization_id and snapshots.id = p_snapshot_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  return query select 'found'::text,
    public.m5_vex_export_snapshot_json(p_organization_id, p_snapshot_id);
end;
$$;

create or replace function public.m5_vex_publication_target_json(
  p_organization_id uuid, p_target_id uuid
) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', targets.id, 'targetKey', targets.target_key, 'enabled', targets.enabled,
    'version', targets.version, 'currentSnapshotId', targets.current_snapshot_id,
    'publishedAt', case when targets.published_at is null then null else public.m2_utc_z(targets.published_at) end,
    'withdrawnAt', case when targets.withdrawn_at is null then null else public.m2_utc_z(targets.withdrawn_at) end,
    'updatedAt', public.m2_utc_z(targets.updated_at),
    'updatedByUserId', targets.updated_by
  ) from public.vulnerability_vex_publication_targets targets
  where targets.organization_id = p_organization_id and targets.id = p_target_id
$$;

create or replace function public.set_vulnerability_vex_publication_target_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_target_key text, p_enabled boolean,
  p_expected_version integer, p_idempotency_key uuid, p_correlation_id uuid default null
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_target public.vulnerability_vex_publication_targets%rowtype; v_existing record; v_digest text;
begin
  if p_organization_id is null or p_actor_user_id is null or p_target_key !~ '^[a-z][a-z0-9-]{0,62}$'
    or p_enabled is null or p_expected_version is null or p_expected_version < 0 or p_idempotency_key is null
    or not public.m5_triage_actor_has_permission(p_organization_id, p_actor_user_id, 'can_manage_finding_publication') then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':' || p_actor_user_id::text || ':' || p_idempotency_key::text, 0));
  v_digest := encode(extensions.digest(jsonb_build_object('targetKey', p_target_key,
    'enabled', p_enabled, 'expectedVersion', p_expected_version)::text, 'sha256'), 'hex');
  select * into v_existing from public.m5_triage_command_result(
    p_organization_id, p_actor_user_id, p_idempotency_key, 'configure_vex_publication_target', v_digest);
  if found then return query select v_existing.outcome, v_existing.result; return; end if;
  select * into v_target from public.vulnerability_vex_publication_targets targets
    where targets.organization_id = p_organization_id and targets.target_key = p_target_key for update;
  if found and v_target.version <> p_expected_version then
    return query select 'conflict'::text, jsonb_build_object('target', public.m5_vex_publication_target_json(p_organization_id, v_target.id)); return;
  end if;
  if not found and p_expected_version <> 0 then return query select 'conflict'::text, null::jsonb; return; end if;
  insert into public.vulnerability_vex_publication_targets(
    organization_id, target_key, enabled, created_by, updated_by
  ) values (p_organization_id, p_target_key, p_enabled, p_actor_user_id, p_actor_user_id)
  on conflict (organization_id, target_key) do update set
    enabled = excluded.enabled, version = public.vulnerability_vex_publication_targets.version + 1,
    updated_by = excluded.updated_by
  returning * into v_target;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'vulnerability.vex_publication_target_configured',
    'vulnerability_vex_publication_target', v_target.id::text,
    jsonb_build_object('targetKey', v_target.target_key, 'enabled', v_target.enabled,
      'version', v_target.version, 'idempotencyKey', p_idempotency_key, 'correlationId', p_correlation_id));
  insert into public.vulnerability_triage_commands(organization_id, actor_user_id, idempotency_key, operation, request_digest, result)
  values (p_organization_id, p_actor_user_id, p_idempotency_key, 'configure_vex_publication_target', v_digest,
    jsonb_build_object('target', public.m5_vex_publication_target_json(p_organization_id, v_target.id)));
  return query select 'updated'::text,
    jsonb_build_object('target', public.m5_vex_publication_target_json(p_organization_id, v_target.id));
end;
$$;

create or replace function public.list_vulnerability_vex_publication_targets(
  p_organization_id uuid, p_actor_user_id uuid
) returns table(outcome text, result jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.m5_triage_actor_has_permission(p_organization_id, p_actor_user_id, 'can_manage_finding_publication') then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  return query select 'found'::text, jsonb_build_object('targets', coalesce((
    select jsonb_agg(public.m5_vex_publication_target_json(p_organization_id, targets.id)
      order by targets.target_key)
    from public.vulnerability_vex_publication_targets targets where targets.organization_id = p_organization_id
  ), '[]'::jsonb));
end;
$$;

create or replace function public.m5_vex_publication_job_json(
  p_organization_id uuid, p_job_id uuid
) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', jobs.id, 'organizationId', jobs.organization_id,
    'exportId', jobs.snapshot_id, 'targetId', jobs.target_id,
    'eventKey', jobs.event_key, 'kind', jobs.job_kind, 'targetKey', targets.target_key,
    'state', jobs.delivery_state, 'attempts', jobs.attempt_count, 'version', jobs.version,
    'lastErrorCode', jobs.last_error_code, 'lastErrorMessage', jobs.last_error_detail,
    'publishedAt', case when jobs.completed_at is null then null else public.m2_utc_z(jobs.completed_at) end,
    'replacedByExportId', jobs.replaced_by_snapshot_id,
    'withdrawnAt', case when jobs.delivery_state = 'withdrawn' then public.m2_utc_z(jobs.completed_at) else null end,
    'withdrawnReason', jobs.withdrawal_reason,
    'createdAt', public.m2_utc_z(jobs.created_at), 'updatedAt', public.m2_utc_z(jobs.updated_at)
  ) from public.vulnerability_vex_publication_jobs jobs
  join public.vulnerability_vex_publication_targets targets
    on targets.organization_id = jobs.organization_id and targets.id = jobs.target_id
  where jobs.organization_id = p_organization_id and jobs.id = p_job_id
$$;

create or replace function public.enqueue_vulnerability_vex_publication_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_snapshot_id uuid, p_target_id uuid,
  p_expected_target_version integer, p_job_kind text, p_expected_content_sha256 text,
  p_confirm_target boolean, p_withdrawal_reason text, p_idempotency_key uuid, p_correlation_id uuid default null
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_target public.vulnerability_vex_publication_targets%rowtype;
  v_job public.vulnerability_vex_publication_jobs%rowtype;
  v_existing record;
  v_digest text;
  v_snapshot_id uuid := p_snapshot_id;
  v_event_key text;
begin
  if p_organization_id is null or p_actor_user_id is null or p_target_id is null
    or p_expected_target_version is null or p_expected_target_version < 1
    or p_job_kind not in ('publish', 'withdraw') or p_expected_content_sha256 !~ '^[a-f0-9]{64}$'
    or p_confirm_target is not true or p_idempotency_key is null
    or (p_job_kind = 'publish' and p_withdrawal_reason is not null)
    or (p_job_kind = 'withdraw' and char_length(btrim(coalesce(p_withdrawal_reason, ''))) not between 1 and 1000)
    or not public.m5_triage_actor_has_permission(p_organization_id, p_actor_user_id, 'can_manage_finding_publication') then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':' || p_actor_user_id::text || ':' || p_idempotency_key::text, 0));
  v_digest := encode(extensions.digest(jsonb_build_object('snapshotId', p_snapshot_id,
    'targetId', p_target_id, 'expectedTargetVersion', p_expected_target_version,
    'jobKind', p_job_kind, 'expectedContentSha256', p_expected_content_sha256,
    'confirmTarget', p_confirm_target,
    'withdrawalReason', nullif(btrim(p_withdrawal_reason), ''))::text, 'sha256'), 'hex');
  select * into v_existing from public.m5_triage_command_result(
    p_organization_id, p_actor_user_id, p_idempotency_key, 'queue_vex_publication', v_digest);
  if found then return query select v_existing.outcome, v_existing.result; return; end if;
  select * into v_target from public.vulnerability_vex_publication_targets targets
    where targets.organization_id = p_organization_id and targets.id = p_target_id for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_target.version <> p_expected_target_version then
    return query select 'conflict'::text, jsonb_build_object('target', public.m5_vex_publication_target_json(p_organization_id, v_target.id)); return;
  end if;
  if p_job_kind = 'publish' then
    if not v_target.enabled or v_snapshot_id is null or not exists (
      select 1 from public.vulnerability_vex_export_snapshots snapshots
      where snapshots.organization_id = p_organization_id and snapshots.id = v_snapshot_id
        and snapshots.content_sha256 = p_expected_content_sha256
    ) then return query select 'invalid_state'::text, null::jsonb; return; end if;
  else
    v_snapshot_id := v_target.current_snapshot_id;
    if v_snapshot_id is null or not exists (
      select 1 from public.vulnerability_vex_export_snapshots snapshots
      where snapshots.organization_id = p_organization_id and snapshots.id = v_snapshot_id
        and snapshots.content_sha256 = p_expected_content_sha256
    ) then return query select 'invalid_state'::text, null::jsonb; return; end if;
  end if;
  v_event_key := 'vex-publication:' || p_job_kind || ':' || v_target.id::text || ':' || v_snapshot_id::text;
  select * into v_job from public.vulnerability_vex_publication_jobs jobs
    where jobs.organization_id = p_organization_id and jobs.event_key = v_event_key for update;
  if found then
    if v_job.delivery_state in ('pending', 'leased') then
      null;
    elsif (p_job_kind = 'publish' and v_job.delivery_state = 'published')
      or (p_job_kind = 'withdraw' and v_job.delivery_state = 'withdrawn') then
      null;
    else
      update public.vulnerability_vex_publication_jobs set delivery_state = 'pending', next_attempt_at = clock_timestamp(),
        lease_owner = null, lease_expires_at = null, last_error_code = null, last_error_detail = null,
        version = version + 1, updated_at = clock_timestamp() where organization_id = p_organization_id and id = v_job.id
      returning * into v_job;
    end if;
  else
    insert into public.vulnerability_vex_publication_jobs(
      organization_id, snapshot_id, target_id, job_kind, event_key, created_by
      , withdrawal_reason
    ) values (p_organization_id, v_snapshot_id, v_target.id, p_job_kind, v_event_key, p_actor_user_id,
      case when p_job_kind = 'withdraw' then btrim(p_withdrawal_reason) else null end)
    returning * into v_job;
  end if;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id,
    case when p_job_kind = 'publish' then 'vulnerability.vex_publication_queued' else 'vulnerability.vex_publication_withdrawal_queued' end,
    'vulnerability_vex_publication_job', v_job.id::text,
    jsonb_build_object('snapshotId', v_job.snapshot_id, 'targetKey', v_target.target_key,
      'eventKey', v_job.event_key, 'idempotencyKey', p_idempotency_key, 'correlationId', p_correlation_id));
  insert into public.vulnerability_triage_commands(organization_id, actor_user_id, idempotency_key, operation, request_digest, result)
  values (p_organization_id, p_actor_user_id, p_idempotency_key, 'queue_vex_publication', v_digest,
    jsonb_build_object('job', public.m5_vex_publication_job_json(p_organization_id, v_job.id)));
  return query select case when v_job.delivery_state = 'pending' then 'queued' else v_job.delivery_state end,
    jsonb_build_object('job', public.m5_vex_publication_job_json(p_organization_id, v_job.id));
end;
$$;

create or replace function public.list_vulnerability_vex_publication_jobs(
  p_organization_id uuid, p_actor_user_id uuid, p_snapshot_id uuid
) returns table(outcome text, result jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.m5_triage_actor_has_permission(p_organization_id, p_actor_user_id, 'can_manage_finding_publication')
    or not exists (select 1 from public.vulnerability_vex_export_snapshots snapshots
      where snapshots.organization_id = p_organization_id and snapshots.id = p_snapshot_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  return query select 'found'::text, jsonb_build_object('jobs', coalesce((
    select jsonb_agg(public.m5_vex_publication_job_json(p_organization_id, jobs.id)
      order by jobs.created_at desc, jobs.id desc)
    from public.vulnerability_vex_publication_jobs jobs
    where jobs.organization_id = p_organization_id and jobs.snapshot_id = p_snapshot_id
  ), '[]'::jsonb));
end;
$$;

create or replace function public.retry_vulnerability_vex_publication_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_job_id uuid, p_expected_version integer,
  p_idempotency_key uuid, p_correlation_id uuid default null
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.vulnerability_vex_publication_jobs%rowtype; v_existing record; v_digest text;
begin
  if p_organization_id is null or p_actor_user_id is null or p_job_id is null or p_expected_version is null
    or p_expected_version < 1 or p_idempotency_key is null
    or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_manage_finding_publication') then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_actor_user_id::text||':'||p_idempotency_key::text,0));
  v_digest:=encode(extensions.digest(jsonb_build_object('jobId',p_job_id,'expectedVersion',p_expected_version)::text,'sha256'),'hex');
  select * into v_existing from public.m5_triage_command_result(p_organization_id,p_actor_user_id,p_idempotency_key,'retry_vex_publication',v_digest);
  if found then return query select v_existing.outcome,v_existing.result; return; end if;
  select * into v_job from public.vulnerability_vex_publication_jobs jobs where jobs.organization_id=p_organization_id and jobs.id=p_job_id for update;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  if v_job.version<>p_expected_version then return query select 'conflict'::text,jsonb_build_object('job',public.m5_vex_publication_job_json(p_organization_id,p_job_id)); return; end if;
  if v_job.delivery_state not in ('retrying','dead_letter') then return query select 'invalid_state'::text,jsonb_build_object('job',public.m5_vex_publication_job_json(p_organization_id,p_job_id)); return; end if;
  update public.vulnerability_vex_publication_jobs set delivery_state='pending',attempt_count=0,next_attempt_at=clock_timestamp(),last_error_code=null,last_error_detail=null,version=version+1,updated_at=clock_timestamp()
    where organization_id=p_organization_id and id=p_job_id returning * into v_job;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'vulnerability.vex_publication_retried','vulnerability_vex_publication_job',p_job_id::text,jsonb_build_object('idempotencyKey',p_idempotency_key,'correlationId',p_correlation_id));
  insert into public.vulnerability_triage_commands(organization_id,actor_user_id,idempotency_key,operation,request_digest,result) values(p_organization_id,p_actor_user_id,p_idempotency_key,'retry_vex_publication',v_digest,jsonb_build_object('job',public.m5_vex_publication_job_json(p_organization_id,p_job_id)));
  return query select 'queued'::text,jsonb_build_object('job',public.m5_vex_publication_job_json(p_organization_id,p_job_id));
end;
$$;

create or replace function public.withdraw_vulnerability_vex_publication_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_job_id uuid,p_expected_version integer,p_withdrawal_reason text,p_idempotency_key uuid,p_correlation_id uuid default null
) returns table(outcome text,result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.vulnerability_vex_publication_jobs%rowtype; v_target public.vulnerability_vex_publication_targets%rowtype; v_existing record; v_digest text; v_result record;
begin
  if p_organization_id is null or p_actor_user_id is null or p_job_id is null or p_expected_version is null or p_expected_version<1 or p_idempotency_key is null or char_length(btrim(coalesce(p_withdrawal_reason,''))) not between 1 and 1000 or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_manage_finding_publication') then return query select 'invalid_request'::text,null::jsonb; return; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_actor_user_id::text||':'||p_idempotency_key::text,0));
  v_digest:=encode(extensions.digest(jsonb_build_object('jobId',p_job_id,'expectedVersion',p_expected_version,'withdrawalReason',btrim(p_withdrawal_reason))::text,'sha256'),'hex');
  select * into v_existing from public.m5_triage_command_result(p_organization_id,p_actor_user_id,p_idempotency_key,'withdraw_vex_publication',v_digest); if found then return query select v_existing.outcome,v_existing.result; return; end if;
  select * into v_job from public.vulnerability_vex_publication_jobs jobs where jobs.organization_id=p_organization_id and jobs.id=p_job_id for update; if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  if v_job.version<>p_expected_version or v_job.delivery_state not in ('published','replaced') then return query select 'conflict'::text,jsonb_build_object('job',public.m5_vex_publication_job_json(p_organization_id,p_job_id)); return; end if;
  select * into v_target from public.vulnerability_vex_publication_targets targets where targets.organization_id=p_organization_id and targets.id=v_job.target_id for update;
  if not found or v_target.current_publication_job_id<>p_job_id then return query select 'invalid_state'::text,null::jsonb; return; end if;
  select * into v_result from public.enqueue_vulnerability_vex_publication_atomic(p_organization_id,p_actor_user_id,null,v_target.id,v_target.version,'withdraw',(select content_sha256 from public.vulnerability_vex_export_snapshots where organization_id=p_organization_id and id=v_target.current_snapshot_id),true,btrim(p_withdrawal_reason),gen_random_uuid(),p_correlation_id);
  insert into public.vulnerability_triage_commands(organization_id,actor_user_id,idempotency_key,operation,request_digest,result) values(p_organization_id,p_actor_user_id,p_idempotency_key,'withdraw_vex_publication',v_digest,v_result.result);
  return query select v_result.outcome,v_result.result;
end;
$$;

create or replace function public.list_vulnerability_vex_publication_due_organizations(
  p_limit integer default 50
) returns table(organization_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select jobs.organization_id
  from public.vulnerability_vex_publication_jobs jobs
  where (
    jobs.delivery_state in ('pending', 'retrying')
    and jobs.next_attempt_at <= clock_timestamp()
  ) or (
    jobs.delivery_state = 'leased'
    and jobs.lease_expires_at <= clock_timestamp()
  )
  group by jobs.organization_id order by min(jobs.next_attempt_at), jobs.organization_id
  limit greatest(1, least(coalesce(p_limit, 50), 200))
$$;

create or replace function public.claim_vulnerability_vex_publication_job(
  p_organization_id uuid, p_worker_id uuid, p_lease_seconds integer
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.vulnerability_vex_publication_jobs%rowtype; v_now timestamptz := clock_timestamp();
begin
  if p_organization_id is null or p_worker_id is null or p_lease_seconds not between 5 and 900 then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  select * into v_job from public.vulnerability_vex_publication_jobs jobs
    where jobs.organization_id = p_organization_id
      and ((jobs.delivery_state in ('pending', 'retrying') and jobs.next_attempt_at <= v_now)
        or (jobs.delivery_state = 'leased' and jobs.lease_expires_at <= v_now))
      and jobs.attempt_count < jobs.max_attempts
    order by jobs.next_attempt_at, jobs.created_at, jobs.id for update skip locked limit 1;
  if not found then return query select 'empty'::text, null::jsonb; return; end if;
  update public.vulnerability_vex_publication_jobs set delivery_state = 'leased', attempt_count = v_job.attempt_count + 1,
    lease_owner = p_worker_id, lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
    last_error_code = null, last_error_detail = null, version = version + 1,
    updated_at = v_now where organization_id = p_organization_id and id = v_job.id returning * into v_job;
  insert into public.vulnerability_vex_publication_attempts(organization_id, job_id, attempt_number, outcome)
  values (p_organization_id, v_job.id, v_job.attempt_count, 'claimed');
  return query select 'claimed'::text, jsonb_build_object(
    'job', public.m5_vex_publication_job_json(p_organization_id, v_job.id),
    'storageBucket', snapshots.storage_bucket, 'storageObjectPath', snapshots.storage_object_path,
    'contentSha256', snapshots.content_sha256, 'format', snapshots.export_format,
    'specificationVersion', snapshots.specification_version,
    'leaseOwner', p_worker_id, 'leaseExpiresAt', public.m2_utc_z(v_job.lease_expires_at)
  ) from public.vulnerability_vex_export_snapshots snapshots
  where snapshots.organization_id = p_organization_id and snapshots.id = v_job.snapshot_id;
end;
$$;

create or replace function public.complete_vulnerability_vex_publication_job(
  p_organization_id uuid, p_job_id uuid, p_worker_id uuid, p_remote_version text default null,
  p_http_status integer default null
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.vulnerability_vex_publication_jobs%rowtype; v_target public.vulnerability_vex_publication_targets%rowtype; v_now timestamptz := clock_timestamp();
begin
  if p_organization_id is null or p_job_id is null or p_worker_id is null
    or (p_remote_version is not null and char_length(btrim(p_remote_version)) not between 1 and 500)
    or (p_http_status is not null and p_http_status not between 100 and 599) then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  select * into v_job from public.vulnerability_vex_publication_jobs jobs
    where jobs.organization_id = p_organization_id and jobs.id = p_job_id for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_job.delivery_state in ('published', 'replaced', 'withdrawn') then
    return query select 'idempotent'::text, jsonb_build_object('job', public.m5_vex_publication_job_json(p_organization_id, v_job.id)); return;
  end if;
  if v_job.delivery_state <> 'leased' or v_job.lease_owner <> p_worker_id or v_job.lease_expires_at <= v_now then
    return query select 'lease_conflict'::text, null::jsonb; return;
  end if;
  select * into v_target from public.vulnerability_vex_publication_targets targets
    where targets.organization_id = p_organization_id and targets.id = v_job.target_id for update;
  if v_job.job_kind = 'publish' then
    if v_target.current_publication_job_id is not null
      and v_target.current_publication_job_id <> v_job.id then
      update public.vulnerability_vex_publication_jobs set delivery_state = 'replaced',
        replaced_by_snapshot_id = v_job.snapshot_id, version = version + 1, updated_at = v_now
      where organization_id = p_organization_id and id = v_target.current_publication_job_id
        and delivery_state = 'published';
    end if;
    update public.vulnerability_vex_publication_targets set current_snapshot_id = v_job.snapshot_id,
      current_publication_job_id = v_job.id, published_at = v_now, withdrawn_at = null,
      version = version + 1, updated_by = v_job.created_by, updated_at = v_now
      where organization_id = p_organization_id and id = v_target.id;
  else
    if v_target.current_snapshot_id is distinct from v_job.snapshot_id then
      update public.vulnerability_vex_publication_jobs set delivery_state = 'replaced',
        replaced_by_snapshot_id = v_target.current_snapshot_id, lease_owner = null, lease_expires_at = null,
        completed_at = coalesce(v_target.published_at, v_now), version = version + 1, updated_at = v_now
        where organization_id = p_organization_id and id = v_job.id returning * into v_job;
      insert into public.vulnerability_vex_publication_attempts(
        organization_id, job_id, attempt_number, outcome, error_code, error_detail
      ) values (p_organization_id, v_job.id, v_job.attempt_count, 'replaced',
        'target_superseded', 'A newer publication changed the target before withdrawal.');
      insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
      values (p_organization_id, v_job.created_by, 'vulnerability.vex_publication_withdrawal_replaced',
        'vulnerability_vex_publication_job', v_job.id::text,
        jsonb_build_object('eventKey', v_job.event_key, 'attemptCount', v_job.attempt_count));
      return query select 'replaced'::text,
        jsonb_build_object('job', public.m5_vex_publication_job_json(p_organization_id, v_job.id)); return;
    end if;
    update public.vulnerability_vex_publication_targets set current_snapshot_id = null, current_publication_job_id = null,
      published_at = null, withdrawn_at = v_now, version = version + 1,
      updated_by = v_job.created_by, updated_at = v_now
      where organization_id = p_organization_id and id = v_target.id;
  end if;
  update public.vulnerability_vex_publication_jobs set delivery_state = case when v_job.job_kind = 'publish'
      then 'published' else 'withdrawn' end, lease_owner = null, lease_expires_at = null,
    completed_at = v_now, version = version + 1, updated_at = v_now
    where organization_id = p_organization_id and id = v_job.id returning * into v_job;
  insert into public.vulnerability_vex_publication_attempts(
    organization_id, job_id, attempt_number, outcome, remote_version, http_status
  ) values (p_organization_id, v_job.id, v_job.attempt_count,
    case when v_job.job_kind = 'publish' then 'published' else 'withdrawn' end,
    nullif(btrim(p_remote_version), ''), p_http_status);
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, v_job.created_by,
    case when v_job.job_kind = 'publish' then 'vulnerability.vex_publication_succeeded' else 'vulnerability.vex_publication_withdrawn' end,
    'vulnerability_vex_publication_job', v_job.id::text,
    jsonb_build_object('eventKey', v_job.event_key, 'attemptCount', v_job.attempt_count,
      'httpStatus', p_http_status));
  return query select case when v_job.job_kind = 'publish' then 'published' else 'withdrawn' end,
    jsonb_build_object('job', public.m5_vex_publication_job_json(p_organization_id, v_job.id),
      'target', public.m5_vex_publication_target_json(p_organization_id, v_target.id));
end;
$$;

create or replace function public.fail_vulnerability_vex_publication_job(
  p_organization_id uuid, p_job_id uuid, p_worker_id uuid, p_error_code text,
  p_error_detail text, p_retry_at timestamptz default null
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.vulnerability_vex_publication_jobs%rowtype; v_now timestamptz := clock_timestamp(); v_outcome text;
begin
  if p_organization_id is null or p_job_id is null or p_worker_id is null
    or p_error_code !~ '^[a-z][a-z0-9_]{0,63}$' or char_length(coalesce(p_error_detail, '')) not between 1 and 500
    or (p_retry_at is not null and (p_retry_at <= v_now or p_retry_at > v_now + interval '7 days')) then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  select * into v_job from public.vulnerability_vex_publication_jobs jobs
    where jobs.organization_id = p_organization_id and jobs.id = p_job_id for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_job.delivery_state <> 'leased' or v_job.lease_owner <> p_worker_id or v_job.lease_expires_at <= v_now then
    return query select 'lease_conflict'::text, null::jsonb; return;
  end if;
  v_outcome := case when p_retry_at is not null and v_job.attempt_count < v_job.max_attempts then 'retrying' else 'dead_letter' end;
  update public.vulnerability_vex_publication_jobs set delivery_state = v_outcome,
    next_attempt_at = coalesce(p_retry_at, v_now), lease_owner = null, lease_expires_at = null,
    last_error_code = p_error_code, last_error_detail = p_error_detail, version = version + 1, updated_at = v_now
    where organization_id = p_organization_id and id = v_job.id returning * into v_job;
  insert into public.vulnerability_vex_publication_attempts(
    organization_id, job_id, attempt_number, outcome, error_code, error_detail
  ) values (p_organization_id, v_job.id, v_job.attempt_count, v_outcome, p_error_code, p_error_detail);
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, v_job.created_by, 'vulnerability.vex_publication_failed',
    'vulnerability_vex_publication_job', v_job.id::text,
    jsonb_build_object('eventKey', v_job.event_key, 'attemptCount', v_job.attempt_count,
      'outcome', v_outcome, 'errorCode', p_error_code));
  return query select v_outcome, jsonb_build_object('job', public.m5_vex_publication_job_json(p_organization_id, v_job.id));
end;
$$;

alter function public.preview_vulnerability_vex_export_scope(uuid,uuid,uuid,uuid,text) owner to postgres;
alter function public.m5_vex_export_prevent_snapshot_mutation() owner to postgres;
alter function public.m5_vex_export_prevent_snapshot_assessment_mutation() owner to postgres;
alter function public.m5_vex_export_prevent_publication_attempt_mutation() owner to postgres;
alter function public.m5_vex_export_scope_payload(uuid,uuid,uuid) owner to postgres;
alter function public.m5_vex_export_scope_json(uuid,uuid,uuid) owner to postgres;
alter function public.m5_vex_export_snapshot_json(uuid,uuid) owner to postgres;
alter function public.m5_vex_publication_target_json(uuid,uuid) owner to postgres;
alter function public.m5_vex_publication_job_json(uuid,uuid) owner to postgres;
alter function public.create_vulnerability_vex_export_snapshot_atomic(uuid,uuid,uuid,uuid,text,text,text,text,integer,text,uuid,uuid) owner to postgres;
alter function public.list_vulnerability_vex_export_snapshots(uuid,uuid,uuid,uuid) owner to postgres;
alter function public.get_vulnerability_vex_export_storage_locator(uuid,uuid,uuid) owner to postgres;
alter function public.get_vulnerability_vex_export_snapshot(uuid,uuid,uuid) owner to postgres;
alter function public.set_vulnerability_vex_publication_target_atomic(uuid,uuid,text,boolean,integer,uuid,uuid) owner to postgres;
alter function public.list_vulnerability_vex_publication_targets(uuid,uuid) owner to postgres;
alter function public.enqueue_vulnerability_vex_publication_atomic(uuid,uuid,uuid,uuid,integer,text,text,boolean,text,uuid,uuid) owner to postgres;
alter function public.list_vulnerability_vex_publication_jobs(uuid,uuid,uuid) owner to postgres;
alter function public.retry_vulnerability_vex_publication_atomic(uuid,uuid,uuid,integer,uuid,uuid) owner to postgres;
alter function public.withdraw_vulnerability_vex_publication_atomic(uuid,uuid,uuid,integer,text,uuid,uuid) owner to postgres;
alter function public.list_vulnerability_vex_publication_due_organizations(integer) owner to postgres;
alter function public.claim_vulnerability_vex_publication_job(uuid,uuid,integer) owner to postgres;
alter function public.complete_vulnerability_vex_publication_job(uuid,uuid,uuid,text,integer) owner to postgres;
alter function public.fail_vulnerability_vex_publication_job(uuid,uuid,uuid,text,text,timestamp with time zone) owner to postgres;

revoke all on function public.preview_vulnerability_vex_export_scope(uuid,uuid,uuid,uuid,text),
  public.m5_vex_export_prevent_snapshot_mutation(),
  public.m5_vex_export_prevent_snapshot_assessment_mutation(),
  public.m5_vex_export_prevent_publication_attempt_mutation(),
  public.m5_vex_export_scope_payload(uuid,uuid,uuid),
  public.m5_vex_export_scope_json(uuid,uuid,uuid),
  public.m5_vex_export_snapshot_json(uuid,uuid),
  public.m5_vex_publication_target_json(uuid,uuid),
  public.m5_vex_publication_job_json(uuid,uuid),
  public.create_vulnerability_vex_export_snapshot_atomic(uuid,uuid,uuid,uuid,text,text,text,text,integer,text,uuid,uuid),
  public.list_vulnerability_vex_export_snapshots(uuid,uuid,uuid,uuid),
  public.get_vulnerability_vex_export_storage_locator(uuid,uuid,uuid),
  public.get_vulnerability_vex_export_snapshot(uuid,uuid,uuid),
  public.set_vulnerability_vex_publication_target_atomic(uuid,uuid,text,boolean,integer,uuid,uuid),
  public.list_vulnerability_vex_publication_targets(uuid,uuid),
  public.enqueue_vulnerability_vex_publication_atomic(uuid,uuid,uuid,uuid,integer,text,text,boolean,text,uuid,uuid),
  public.list_vulnerability_vex_publication_jobs(uuid,uuid,uuid),
  public.retry_vulnerability_vex_publication_atomic(uuid,uuid,uuid,integer,uuid,uuid),
  public.withdraw_vulnerability_vex_publication_atomic(uuid,uuid,uuid,integer,text,uuid,uuid),
  public.list_vulnerability_vex_publication_due_organizations(integer),
  public.claim_vulnerability_vex_publication_job(uuid,uuid,integer),
  public.complete_vulnerability_vex_publication_job(uuid,uuid,uuid,text,integer),
  public.fail_vulnerability_vex_publication_job(uuid,uuid,uuid,text,text,timestamp with time zone)
from public, anon, authenticated;
grant execute on function public.preview_vulnerability_vex_export_scope(uuid,uuid,uuid,uuid,text),
  public.create_vulnerability_vex_export_snapshot_atomic(uuid,uuid,uuid,uuid,text,text,text,text,integer,text,uuid,uuid),
  public.list_vulnerability_vex_export_snapshots(uuid,uuid,uuid,uuid),
  public.get_vulnerability_vex_export_storage_locator(uuid,uuid,uuid),
  public.get_vulnerability_vex_export_snapshot(uuid,uuid,uuid),
  public.set_vulnerability_vex_publication_target_atomic(uuid,uuid,text,boolean,integer,uuid,uuid),
  public.list_vulnerability_vex_publication_targets(uuid,uuid),
  public.enqueue_vulnerability_vex_publication_atomic(uuid,uuid,uuid,uuid,integer,text,text,boolean,text,uuid,uuid),
  public.list_vulnerability_vex_publication_jobs(uuid,uuid,uuid),
  public.retry_vulnerability_vex_publication_atomic(uuid,uuid,uuid,integer,uuid,uuid),
  public.withdraw_vulnerability_vex_publication_atomic(uuid,uuid,uuid,integer,text,uuid,uuid),
  public.list_vulnerability_vex_publication_due_organizations(integer),
  public.claim_vulnerability_vex_publication_job(uuid,uuid,integer),
  public.complete_vulnerability_vex_publication_job(uuid,uuid,uuid,text,integer),
  public.fail_vulnerability_vex_publication_job(uuid,uuid,uuid,text,text,timestamp with time zone)
to service_role;
