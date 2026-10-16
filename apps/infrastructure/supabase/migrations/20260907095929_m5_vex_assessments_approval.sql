-- CRA-M5-02: tenant-scoped, versioned OpenVEX assessments.  This is an
-- additive workflow beside (not in place of) M4's document-scoped human
-- verdict.  Assessment content is append-only; workflow decisions and audit
-- facts are committed atomically by the RPCs below.

create table public.vulnerability_finding_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  finding_id uuid not null,
  supersedes_id uuid,
  superseded_by_id uuid,
  superseded_at timestamptz,
  revision integer not null check (revision > 0),
  is_current boolean not null default true,
  vex_status text not null check (vex_status in ('under_investigation', 'affected', 'not_affected', 'fixed')),
  vex_justification text check (vex_justification is null or vex_justification in (
    'component_not_present', 'vulnerable_code_not_present',
    'vulnerable_code_not_in_execute_path',
    'vulnerable_code_cannot_be_controlled_by_adversary',
    'inline_mitigations_already_exist'
  )),
  detail text not null check (char_length(btrim(detail)) between 1 and 4000),
  change_reason text check (change_reason is null or char_length(btrim(change_reason)) between 1 and 2000),
  approval_state text not null check (approval_state in ('awaiting_approval', 'approval_not_required', 'approved', 'rejected')),
  approval_required boolean not null,
  policy_severity text not null check (policy_severity in ('critical', 'high', 'medium', 'low', 'unknown')),
  policy_version integer not null check (policy_version >= 0),
  decision_reason text check (decision_reason is null or char_length(btrim(decision_reason)) between 1 and 2000),
  submitted_at timestamptz not null default clock_timestamp(),
  submitted_by uuid not null references public.users(id) on delete restrict,
  decided_at timestamptz,
  decided_by uuid references public.users(id) on delete restrict,
  -- Version zero is the create sentinel at the wire boundary; persisted
  -- revisions start at one so it can never update an existing assessment.
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references public.users(id) on delete restrict,
  unique (organization_id, id),
  unique (organization_id, finding_id, revision),
  foreign key (organization_id, finding_id)
    references public.vulnerability_findings(organization_id, id) on delete restrict,
  foreign key (organization_id, supersedes_id)
    references public.vulnerability_finding_assessments(organization_id, id)
    on delete restrict deferrable initially deferred,
  foreign key (organization_id, superseded_by_id)
    references public.vulnerability_finding_assessments(organization_id, id)
    on delete restrict deferrable initially deferred,
  constraint vulnerability_finding_assessments_justification_check check (
    (vex_status = 'not_affected' and vex_justification is not null)
    or (vex_status <> 'not_affected' and vex_justification is null)
  ),
  constraint vulnerability_finding_assessments_approval_check check (
    (approval_required and approval_state in ('awaiting_approval', 'approved', 'rejected'))
    or (not approval_required and approval_state = 'approval_not_required')
  ),
  constraint vulnerability_finding_assessments_decision_check check (
    (approval_state = 'awaiting_approval' and decided_at is null and decided_by is null and decision_reason is null)
    or (approval_state = 'approved' and decided_at is not null and decided_by is not null)
    or (approval_state = 'rejected' and decided_at is not null and decided_by is not null
      and char_length(btrim(decision_reason)) between 1 and 2000)
    or (approval_state = 'approval_not_required'
      and decided_at is null and decided_by is null and decision_reason is null)
  ),
  constraint vulnerability_finding_assessments_supersession_check check (
    (is_current and superseded_at is null and superseded_by_id is null)
    or (not is_current and superseded_at is not null and superseded_by_id is not null)
  )
);

create unique index vulnerability_finding_assessments_one_current_idx
  on public.vulnerability_finding_assessments(organization_id, finding_id)
  where is_current;
create index vulnerability_finding_assessments_current_approval_idx
  on public.vulnerability_finding_assessments(organization_id, approval_state, submitted_at desc, id desc)
  where is_current and approval_state = 'awaiting_approval';
create index vulnerability_finding_assessments_history_idx
  on public.vulnerability_finding_assessments(organization_id, finding_id, revision desc, id desc);

create table public.vulnerability_finding_assessment_evidence_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assessment_id uuid not null,
  kind text not null check (kind in ('external', 'internal')),
  title text not null check (title = btrim(title) and char_length(title) between 1 and 500),
  external_url text,
  document_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid not null references public.users(id) on delete restrict,
  unique (organization_id, assessment_id, id),
  foreign key (organization_id, assessment_id)
    references public.vulnerability_finding_assessments(organization_id, id) on delete restrict,
  foreign key (organization_id, document_id)
    references public.sbom_documents(organization_id, id) on delete restrict,
  constraint vulnerability_finding_assessment_evidence_kind_check check (
    (kind = 'external' and external_url is not null and document_id is null
      and external_url = btrim(external_url)
      and external_url !~ '[[:space:][:cntrl:]]'
      and external_url ~ '^https://[^/@?#]+(?:/[^?#]*)?(?:\\?[^#]*)?$')
    or (kind = 'internal' and external_url is null and document_id is not null)
  )
);
create index vulnerability_finding_assessment_evidence_links_assessment_idx
  on public.vulnerability_finding_assessment_evidence_links(organization_id, assessment_id, id);

create table public.vulnerability_finding_assessment_history_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assessment_id uuid not null,
  event_type text not null check (event_type in ('submitted', 'approved', 'rejected', 'superseded')),
  actor_user_id uuid not null references public.users(id) on delete restrict,
  occurred_at timestamptz not null default clock_timestamp(),
  reason text check (reason is null or char_length(btrim(reason)) between 1 and 2000),
  previous_values jsonb check (previous_values is null or jsonb_typeof(previous_values) = 'object'),
  new_values jsonb not null check (jsonb_typeof(new_values) = 'object'),
  unique (organization_id, id),
  foreign key (organization_id, assessment_id)
    references public.vulnerability_finding_assessments(organization_id, id) on delete restrict
);
create index vulnerability_finding_assessment_history_events_finding_idx
  on public.vulnerability_finding_assessment_history_events(organization_id, assessment_id, occurred_at, id);

create table public.vulnerability_assessment_approval_policies (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  severity text not null check (severity in ('critical', 'high', 'medium', 'low', 'unknown')),
  approval_required boolean not null,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid not null references public.users(id) on delete restrict,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references public.users(id) on delete restrict,
  primary key (organization_id, severity)
);

create table public.vulnerability_finding_assessment_commands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid not null references public.users(id) on delete restrict,
  idempotency_key uuid not null,
  operation text not null check (operation in ('submit', 'approve', 'reject', 'set_policy')),
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, actor_user_id, idempotency_key)
);
create index vulnerability_finding_assessment_commands_created_idx
  on public.vulnerability_finding_assessment_commands(organization_id, created_at desc, id);

alter table public.vulnerability_finding_assessments enable row level security;
alter table public.vulnerability_finding_assessment_evidence_links enable row level security;
alter table public.vulnerability_finding_assessment_history_events enable row level security;
alter table public.vulnerability_assessment_approval_policies enable row level security;
alter table public.vulnerability_finding_assessment_commands enable row level security;
create trigger set_vulnerability_finding_assessments_updated_at
  before update on public.vulnerability_finding_assessments
  for each row execute function public.set_updated_at();
create trigger set_vulnerability_assessment_approval_policies_updated_at
  before update on public.vulnerability_assessment_approval_policies
  for each row execute function public.set_updated_at();
grant all on table public.vulnerability_finding_assessments,
  public.vulnerability_finding_assessment_evidence_links,
  public.vulnerability_finding_assessment_history_events,
  public.vulnerability_assessment_approval_policies,
  public.vulnerability_finding_assessment_commands to service_role;
revoke all on table public.vulnerability_finding_assessments,
  public.vulnerability_finding_assessment_evidence_links,
  public.vulnerability_finding_assessment_history_events,
  public.vulnerability_assessment_approval_policies,
  public.vulnerability_finding_assessment_commands from public, anon, authenticated;

-- Database callers cannot rewrite a submitted revision.  The only permitted
-- updates are superseding its current pointer or its single approval decision.
create or replace function public.m5_vex_guard_assessment_update()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.is_current and not new.is_current
    and new.superseded_at is not null and new.superseded_by_id is not null
    and new.version = old.version and new.updated_at = old.updated_at and new.updated_by = old.updated_by
    and new.approval_state = old.approval_state and new.decided_at is not distinct from old.decided_at
    and new.decided_by is not distinct from old.decided_by and new.decision_reason is not distinct from old.decision_reason
    and new.vex_status = old.vex_status and new.vex_justification is not distinct from old.vex_justification
    and new.detail = old.detail and new.change_reason is not distinct from old.change_reason then
    return new;
  end if;
  if old.is_current and new.is_current and old.approval_state = 'awaiting_approval'
    and new.approval_state in ('approved', 'rejected')
    and new.version = old.version + 1 and new.updated_at >= old.updated_at
    and new.updated_by = new.decided_by and new.decided_at is not null
    and new.vex_status = old.vex_status and new.vex_justification is not distinct from old.vex_justification
    and new.detail = old.detail and new.change_reason is not distinct from old.change_reason
    and new.approval_required = old.approval_required and new.policy_severity = old.policy_severity
    and new.policy_version = old.policy_version and new.submitted_at = old.submitted_at
    and new.submitted_by = old.submitted_by and new.superseded_at is null and new.superseded_by_id is null then
    return new;
  end if;
  raise exception 'submitted VEX assessment revisions are immutable' using errcode = 'check_violation';
end;
$$;

-- VEX assessments are durable tenant audit evidence and must remain portable
-- with the rest of the tenant export snapshot. Command idempotency rows remain
-- deliberately excluded by the application-side export registry.
insert into public.organization_export_sources(source_id, enabled, sort_order)
values ('vulnerability_vex_assessments', true, 46)
on conflict(source_id) do update set
  enabled = excluded.enabled,
  sort_order = excluded.sort_order;

insert into public.organization_export_source_tables(
  source_id, table_name, tenant_key_column, record_order_column, table_sort
) values
  ('vulnerability_vex_assessments', 'vulnerability_finding_assessments', 'organization_id', 'id', 1),
  ('vulnerability_vex_assessments', 'vulnerability_finding_assessment_evidence_links', 'organization_id', 'id', 2),
  ('vulnerability_vex_assessments', 'vulnerability_finding_assessment_history_events', 'organization_id', 'id', 3),
  ('vulnerability_vex_assessments', 'vulnerability_assessment_approval_policies', 'organization_id', 'severity', 4)
on conflict(source_id, table_name) do update set
  tenant_key_column = excluded.tenant_key_column,
  record_order_column = excluded.record_order_column,
  table_sort = excluded.table_sort;

-- The export materializer holds a share lock across every registered tenant
-- source so a snapshot cannot split an immutable assessment from its evidence,
-- history, or policy record.
create or replace function public.materialize_organization_export_snapshot_atomic(
  p_organization_id uuid,p_export_job_id uuid,p_lease_owner uuid,p_expected_checkpoint_version integer
) returns table(outcome text,checkpoint_version integer)
language plpgsql security definer set search_path=public,pg_temp as $m5_export$
declare v_job public.organization_export_jobs%rowtype; v_snapshot public.organization_export_snapshots%rowtype; v_mapping public.organization_export_source_tables%rowtype; v_source_id text; v_source_count integer:=0;
begin
  lock table
    public.organizations, public.organization_legal_profiles, public.organization_members, public.audit_logs, public.invitations, public.custom_roles, public.base_role_permission_overrides, public.menu_permissions, public.user_role_assignments, public.user_table_preferences, public.organization_onboarding, public.organization_onboarding_stages, public.organization_onboarding_evidence, public.organization_settings, public.organization_lifecycles, public.organization_retention_policies, public.retention_authority_states, public.retention_authoritative_facts, public.retention_floor_snapshots, public.retention_floor_reasons, public.evidence_protection_watermarks, public.retention_cleanup_runs, public.retention_cleanup_items, public.organization_export_jobs, public.organization_export_parts, public.organization_export_snapshots, public.organization_purge_jobs, public.organization_purge_work_items, public.organization_permissions_version, public.organization_legal_entities, public.organization_legal_entity_dependency_authorities, public.organization_legal_entity_dependency_facts, public.organization_branding_drafts, public.organization_branding_assets, public.organization_branding_versions, public.products, public.product_releases, public.product_legal_entity_assignments, public.product_lifecycle_dependency_facts, public.product_release_market_availability, public.product_regulatory_outbox_events, public.product_support_periods, public.software_baselines, public.software_baseline_release_memberships, public.product_relationships, public.finding_propagation_sources, public.finding_impact_associations, public.finding_product_impact_overrides, public.finding_propagation_jobs, public.product_import_jobs, public.product_import_rows, public.product_substantial_modification_assessments, public.product_substantial_modification_releases, public.product_security_update_artifacts, public.connectors, public.product_external_identities, public.field_authority_policies, public.sync_runs, public.sync_run_plan_items, public.sync_conflicts, public.sync_connector_cursors, public.sbom_documents, public.sbom_document_sources, public.sbom_components, public.sbom_component_identities, public.sbom_component_dependencies, public.organization_sbom_quality_settings, public.sbom_quality_reports, public.sbom_quality_findings, public.sbom_diff_reports, public.sbom_diff_component_changes, public.sbom_supplier_requests, public.sbom_supplier_submissions, public.sbom_composite_reviews, public.sbom_composite_review_inputs, public.sbom_composite_conflicts, public.sbom_composite_unresolved_relationships, public.sbom_composite_component_provenance, public.sbom_composite_dependency_provenance, public.vulnerability_reachability_results, public.vulnerability_finding_review_events, public.vulnerability_finding_assessments, public.vulnerability_finding_assessment_evidence_links, public.vulnerability_finding_assessment_history_events, public.vulnerability_assessment_approval_policies
  in share mode;
  select * into v_job from public.organization_export_jobs jobs where jobs.id=p_export_job_id and jobs.organization_id=p_organization_id for update;
  if not found then return query select 'not_found'::text,null::integer; return; end if;
  if v_job.status<>'running' or v_job.lease_owner<>p_lease_owner or v_job.lease_expires_at<=now() or v_job.checkpoint_version<>p_expected_checkpoint_version then return query select 'conflict'::text,v_job.checkpoint_version; return; end if;
  select * into v_snapshot from public.organization_export_snapshots snapshots where snapshots.organization_id=p_organization_id and snapshots.export_job_id=p_export_job_id order by snapshots.snapshot_version desc limit 1 for update;
  if not found or cardinality(v_snapshot.source_ids)=0 then return query select 'invalid_request'::text,v_job.checkpoint_version; return; end if;
  if v_snapshot.materialized_at is not null then return query select 'replayed'::text,v_job.checkpoint_version; return; end if;
  if exists(select 1 from public.organization_export_snapshot_records records where records.organization_id=p_organization_id and records.export_job_id=p_export_job_id) then return query select 'invalid_request'::text,v_job.checkpoint_version; return; end if;
  if exists(select 1 from unnest(v_snapshot.source_ids) requested(source_id) where not exists(select 1 from public.organization_export_source_tables mappings where mappings.source_id=requested.source_id)) then return query select 'invalid_request'::text,v_job.checkpoint_version; return; end if;
  foreach v_source_id in array v_snapshot.source_ids loop
    for v_mapping in select * from public.organization_export_source_tables mappings where mappings.source_id=v_source_id order by mappings.table_sort loop
      if v_mapping.table_name='product_import_jobs' then
        insert into public.organization_export_snapshot_records(organization_id,export_job_id,source_id,table_name,table_sort,record_index,record_payload)
        select p_organization_id,p_export_job_id,v_source_id,v_mapping.table_name,v_mapping.table_sort,row_number() over(order by jobs.created_at,jobs.id),public.m1_export_redact_jsonb(public.m2_product_import_job_export_json(jobs)) from public.product_import_jobs jobs where jobs.organization_id=p_organization_id order by jobs.created_at,jobs.id;
      elsif v_mapping.table_name='product_import_rows' then
        insert into public.organization_export_snapshot_records(organization_id,export_job_id,source_id,table_name,table_sort,record_index,record_payload)
        select p_organization_id,p_export_job_id,v_source_id,v_mapping.table_name,v_mapping.table_sort,row_number() over(order by rows.import_id,rows.source_row_number,rows.id),public.m1_export_redact_jsonb(public.m2_product_import_row_export_json(rows)) from public.product_import_rows rows where rows.organization_id=p_organization_id order by rows.import_id,rows.source_row_number,rows.id;
      else
        execute format('insert into public.organization_export_snapshot_records (organization_id,export_job_id,source_id,table_name,table_sort,record_index,record_payload) select $1,$2,$3,$4,$5,row_number() over(order by source.%I),public.m1_export_redact_jsonb(to_jsonb(source)) from public.%I source where source.%I=$1 order by source.%I',v_mapping.record_order_column,v_mapping.table_name,v_mapping.tenant_key_column,v_mapping.record_order_column) using p_organization_id,p_export_job_id,v_source_id,v_mapping.table_name,v_mapping.table_sort;
      end if;
      v_source_count:=v_source_count+1;
    end loop;
  end loop;
  if v_source_count<>(select count(*) from public.organization_export_source_tables mappings where mappings.source_id=any(v_snapshot.source_ids)) then return query select 'invalid_request'::text,v_job.checkpoint_version; return; end if;
  update public.organization_export_snapshots snapshots set materialized_at=now(),materialized_by=v_job.actor_user_id,materialized_checkpoint_version=v_job.checkpoint_version where snapshots.id=v_snapshot.id;
  insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes) values(p_organization_id,'organization.export_snapshot_materialized','organization_export_job',p_export_job_id::text,jsonb_build_object('sourceCount',v_source_count,'checkpointVersion',v_job.checkpoint_version));
  return query select 'materialized'::text,v_job.checkpoint_version;
end;
$m5_export$;

alter function public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer) owner to postgres;
revoke all on function public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer) to service_role;
create trigger m5_vex_guard_assessment_update
  before update on public.vulnerability_finding_assessments
  for each row execute function public.m5_vex_guard_assessment_update();

create or replace function public.m5_vex_guard_assessment_delete()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.organizations where id = old.organization_id) then
    return old;
  end if;
  raise exception 'VEX assessment revisions cannot be deleted' using errcode = 'check_violation';
end;
$$;
create trigger m5_vex_guard_assessment_delete
  before delete on public.vulnerability_finding_assessments
  for each row execute function public.m5_vex_guard_assessment_delete();

-- Assessment evidence and timeline facts are part of the submitted revision,
-- not mutable attachments.  Tenant offboarding cascades remain permitted.
create or replace function public.m5_vex_guard_append_only()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' and not exists (
    select 1 from public.organizations where id = old.organization_id
  ) then
    return old;
  end if;
  raise exception 'VEX evidence and history facts are append-only' using errcode = 'check_violation';
end;
$$;
create trigger m5_vex_guard_evidence_link_append_only
  before update or delete on public.vulnerability_finding_assessment_evidence_links
  for each row execute function public.m5_vex_guard_append_only();
create trigger m5_vex_guard_history_event_append_only
  before update or delete on public.vulnerability_finding_assessment_history_events
  for each row execute function public.m5_vex_guard_append_only();

create or replace function public.m5_vex_active_member(
  p_organization_id uuid, p_actor_user_id uuid
) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select p_organization_id is not null and p_actor_user_id is not null
    and public.m5_triage_active_member(p_organization_id, p_actor_user_id)
$$;

create or replace function public.m5_vex_assessment_json(
  p_organization_id uuid, p_assessment_id uuid
) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', assessments.id, 'findingId', assessments.finding_id,
    'revision', assessments.revision, 'version', assessments.version, 'isCurrent', assessments.is_current,
    'supersedesId', assessments.supersedes_id, 'status', assessments.vex_status,
    'justification', assessments.vex_justification, 'detail', assessments.detail,
    'changeReason', assessments.change_reason, 'approvalState', assessments.approval_state,
    'approvalRequired', assessments.approval_required, 'policySeverity', assessments.policy_severity,
    'policyVersion', assessments.policy_version, 'decisionReason', assessments.decision_reason,
    'submittedAt', to_char(assessments.submitted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'submittedByUserId', assessments.submitted_by,
    'decidedAt', case when assessments.decided_at is null then null else to_char(assessments.decided_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'decidedByUserId', assessments.decided_by,
    'evidenceLinks', coalesce((select jsonb_agg(case when links.kind = 'external' then jsonb_build_object(
      'id', links.id, 'kind', links.kind, 'url', links.external_url, 'title', links.title
    ) else jsonb_build_object(
      'id', links.id, 'kind', links.kind, 'evidenceId', links.document_id, 'title', links.title
    ) end order by links.id) from public.vulnerability_finding_assessment_evidence_links links
      where links.organization_id = assessments.organization_id and links.assessment_id = assessments.id), '[]'::jsonb)
  ) from public.vulnerability_finding_assessments assessments
  where assessments.organization_id = p_organization_id and assessments.id = p_assessment_id
$$;

create or replace function public.m5_vex_history_event_json(
  p_organization_id uuid, p_history_event_id uuid
) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', events.id, 'assessmentId', events.assessment_id, 'eventType', events.event_type,
    'actorUserId', events.actor_user_id,
    'occurredAt', to_char(events.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'reason', events.reason, 'previousValues', events.previous_values, 'newValues', events.new_values
  ) from public.vulnerability_finding_assessment_history_events events
  where events.organization_id = p_organization_id and events.id = p_history_event_id
$$;

create or replace function public.m5_vex_command_result(
  p_organization_id uuid, p_actor_user_id uuid, p_idempotency_key uuid,
  p_operation text, p_digest text
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_command public.vulnerability_finding_assessment_commands%rowtype;
begin
  select * into v_command from public.vulnerability_finding_assessment_commands commands
  where commands.organization_id = p_organization_id and commands.actor_user_id = p_actor_user_id
    and commands.idempotency_key = p_idempotency_key for update;
  if not found then return; end if;
  if v_command.operation <> p_operation or v_command.request_digest <> p_digest then
    return query select 'idempotency_conflict'::text, null::jsonb;
  else return query select 'idempotent'::text,
    case when v_command.result ? 'idempotent'
      then jsonb_set(v_command.result, '{idempotent}', 'true'::jsonb)
      else v_command.result end;
  end if;
end;
$$;

create or replace function public.get_finding_vex_assessment(
  p_organization_id uuid, p_actor_user_id uuid, p_finding_id uuid
) returns table(outcome text, result jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.m5_vex_active_member(p_organization_id, p_actor_user_id) or p_finding_id is null
    or not exists (select 1 from public.vulnerability_findings findings
      where findings.organization_id = p_organization_id and findings.id = p_finding_id and findings.status = 'active') then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  return query select 'found'::text, jsonb_build_object(
    'assessment', (select public.m5_vex_assessment_json(p_organization_id, assessments.id)
      from public.vulnerability_finding_assessments assessments
      where assessments.organization_id = p_organization_id and assessments.finding_id = p_finding_id and assessments.is_current),
    'history', coalesce((select jsonb_agg(public.m5_vex_history_event_json(p_organization_id, events.id)
      order by events.occurred_at asc, events.id asc)
      from public.vulnerability_finding_assessment_history_events events
      join public.vulnerability_finding_assessments assessments
        on assessments.organization_id = events.organization_id and assessments.id = events.assessment_id
      where events.organization_id = p_organization_id and assessments.finding_id = p_finding_id), '[]'::jsonb)
  );
end;
$$;

create or replace function public.list_vulnerability_assessment_approval_policy(
  p_organization_id uuid, p_actor_user_id uuid
) returns table(outcome text, result jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.m5_vex_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  return query select 'found'::text, jsonb_build_object('policies', (
    select jsonb_agg(jsonb_build_object(
      'severity', severities.severity, 'approvalRequired', coalesce(policies.approval_required, severities.default_required),
      'version', coalesce(policies.version, 0), 'isOverride', policies.severity is not null,
      'updatedAt', case when policies.updated_at is null then null else to_char(policies.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
      'updatedByUserId', policies.updated_by
    ) order by severities.position)
    from (values ('critical'::text, true, 1), ('high'::text, true, 2), ('medium'::text, false, 3), ('low'::text, false, 4), ('unknown'::text, false, 5))
      as severities(severity, default_required, position)
    left join public.vulnerability_assessment_approval_policies policies
      on policies.organization_id = p_organization_id and policies.severity = severities.severity
  ));
end;
$$;

create or replace function public.submit_vulnerability_finding_vex_assessment_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_finding_id uuid,
  p_vex_status text, p_justification text, p_detail text, p_evidence_links jsonb,
  p_change_reason text, p_expected_version integer, p_idempotency_key uuid, p_request_digest text
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_finding public.vulnerability_findings%rowtype;
  v_current public.vulnerability_finding_assessments%rowtype;
  v_assessment public.vulnerability_finding_assessments%rowtype;
  v_policy public.vulnerability_assessment_approval_policies%rowtype;
  v_severity text; v_required boolean; v_revision integer; v_payload jsonb;
  v_has_current boolean := false;
  v_new_assessment_id uuid := gen_random_uuid();
begin
  if not public.m5_vex_active_member(p_organization_id, p_actor_user_id)
    or p_finding_id is null or p_expected_version is null or p_expected_version < 0
    or p_idempotency_key is null or p_request_digest !~ '^[a-f0-9]{64}$'
    or p_vex_status not in ('under_investigation', 'affected', 'not_affected', 'fixed')
    or char_length(btrim(coalesce(p_detail, ''))) not between 1 and 4000
    or char_length(btrim(coalesce(p_change_reason, ''))) not between 1 and 2000
    or jsonb_typeof(p_evidence_links) <> 'array' or jsonb_array_length(p_evidence_links) > 100
    or (p_vex_status = 'not_affected' and (p_justification is null or p_justification not in (
      'component_not_present', 'vulnerable_code_not_present', 'vulnerable_code_not_in_execute_path',
      'vulnerable_code_cannot_be_controlled_by_adversary', 'inline_mitigations_already_exist')))
    or (p_vex_status <> 'not_affected' and p_justification is not null) then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_user_id::text || ':' || p_idempotency_key::text, 0));
  return query select * from public.m5_vex_command_result(p_organization_id, p_actor_user_id, p_idempotency_key, 'submit', p_request_digest);
  if found then return; end if;
  select * into v_finding from public.vulnerability_findings findings
  where findings.organization_id = p_organization_id and findings.id = p_finding_id and findings.status = 'active' for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  select * into v_current from public.vulnerability_finding_assessments assessments
  where assessments.organization_id = p_organization_id and assessments.finding_id = p_finding_id and assessments.is_current for update;
  v_has_current := found;
  if found and p_expected_version <> v_current.version then
    return query select 'conflict'::text, null::jsonb; return;
  end if;
  if not v_has_current and p_expected_version <> 0 then
    return query select 'conflict'::text, null::jsonb; return;
  end if;
  if exists (select 1 from jsonb_array_elements(p_evidence_links) evidence
    where jsonb_typeof(evidence) <> 'object'
      or (evidence->>'kind' = 'external' and ((select count(*) from jsonb_object_keys(evidence)) <> 3
        or evidence->>'url' <> btrim(evidence->>'url')
        or evidence->>'url' ~ '[[:space:][:cntrl:]]'
        or char_length(btrim(coalesce(evidence->>'title', ''))) not between 1 and 500
        or coalesce(evidence->>'url', '') !~ '^https://[^/@?#]+(?:/[^?#]*)?(?:\\?[^#]*)?$'))
      or (evidence->>'kind' = 'internal' and ((select count(*) from jsonb_object_keys(evidence)) <> 3
        or char_length(btrim(coalesce(evidence->>'title', ''))) not between 1 and 500
        or coalesce(evidence->>'evidenceId', '') !~ '^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$'))
      or evidence->>'kind' not in ('external', 'internal')) then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  if exists (select 1 from jsonb_array_elements(p_evidence_links) evidence
    where evidence->>'kind' = 'internal' and not exists (
      select 1 from public.sbom_documents documents where documents.organization_id = p_organization_id
        and documents.id = (evidence->>'evidenceId')::uuid and documents.state = 'completed')) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  select case when coalesce((public.m4_03_intelligence_with_provenance_json(v_finding.vulnerability_id, v_finding.last_evaluated_at) #>> '{cvss,preferred,baseScore}')::numeric, -1) < 0 then 'unknown'
    when (public.m4_03_intelligence_with_provenance_json(v_finding.vulnerability_id, v_finding.last_evaluated_at) #>> '{cvss,preferred,baseScore}')::numeric >= 9 then 'critical'
    when (public.m4_03_intelligence_with_provenance_json(v_finding.vulnerability_id, v_finding.last_evaluated_at) #>> '{cvss,preferred,baseScore}')::numeric >= 7 then 'high'
    when (public.m4_03_intelligence_with_provenance_json(v_finding.vulnerability_id, v_finding.last_evaluated_at) #>> '{cvss,preferred,baseScore}')::numeric >= 4 then 'medium' else 'low' end into v_severity;
  select * into v_policy from public.vulnerability_assessment_approval_policies policies
  where policies.organization_id = p_organization_id and policies.severity = v_severity for share;
  v_required := coalesce(v_policy.approval_required, v_severity in ('critical', 'high'));
  v_revision := coalesce(v_current.revision, 0) + 1;
  if v_has_current then
    update public.vulnerability_finding_assessments set is_current = false, superseded_at = clock_timestamp(), superseded_by_id = v_new_assessment_id
    where organization_id = p_organization_id and id = v_current.id;
  end if;
  insert into public.vulnerability_finding_assessments(
    id, organization_id, finding_id, supersedes_id, revision, vex_status, vex_justification, detail, change_reason,
    approval_state, approval_required, policy_severity, policy_version, submitted_by, updated_by
  ) values (
    v_new_assessment_id, p_organization_id, p_finding_id,
    case when v_has_current then v_current.id else null end,
    v_revision, p_vex_status,
    case when p_vex_status = 'not_affected' then p_justification else null end, btrim(p_detail),
    btrim(p_change_reason),
    case when v_required then 'awaiting_approval' else 'approval_not_required' end,
    v_required, v_severity, coalesce(v_policy.version, 0), p_actor_user_id, p_actor_user_id
  ) returning * into v_assessment;
  insert into public.vulnerability_finding_assessment_evidence_links(
    organization_id, assessment_id, kind, title, external_url, document_id, created_by
  ) select p_organization_id, v_assessment.id, evidence->>'kind',
    btrim(evidence->>'title'),
    case when evidence->>'kind' = 'external' then evidence->>'url' else null end,
    case when evidence->>'kind' = 'internal' then (evidence->>'evidenceId')::uuid else null end,
    p_actor_user_id from jsonb_array_elements(p_evidence_links) evidence;
  v_payload := jsonb_build_object(
    'assessment', public.m5_vex_assessment_json(p_organization_id, v_assessment.id),
    'idempotent', false
  );
  if v_has_current then
    insert into public.vulnerability_finding_assessment_history_events(
      organization_id, assessment_id, event_type, actor_user_id, reason, previous_values, new_values
    ) values (
      p_organization_id, v_current.id, 'superseded', p_actor_user_id, btrim(p_change_reason),
      jsonb_build_object('isCurrent', true), jsonb_build_object('isCurrent', false, 'supersededById', v_assessment.id)
    );
  end if;
  insert into public.vulnerability_finding_assessment_history_events(
    organization_id, assessment_id, event_type, actor_user_id, reason, previous_values, new_values
  ) values (
    p_organization_id, v_assessment.id, 'submitted', p_actor_user_id, btrim(p_change_reason), null,
    jsonb_build_object('status', v_assessment.vex_status, 'approvalState', v_assessment.approval_state,
      'revision', v_assessment.revision, 'version', v_assessment.version)
  );
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'vulnerability.finding_vex_assessment_submitted',
    'vulnerability_finding_assessment', v_assessment.id::text,
    jsonb_build_object('previousAssessmentId', v_current.id, 'assessment', v_payload -> 'assessment', 'changeReason', p_change_reason,
      'idempotencyKey', p_idempotency_key));
  insert into public.vulnerability_finding_assessment_commands(organization_id, actor_user_id, idempotency_key, operation, request_digest, result)
  values (p_organization_id, p_actor_user_id, p_idempotency_key, 'submit', p_request_digest, v_payload);
  return query select 'submitted'::text, v_payload;
end;
$$;

create or replace function public.m5_vex_decide_assessment_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_finding_id uuid, p_assessment_id uuid,
  p_expected_version integer, p_decision text, p_decision_reason text, p_idempotency_key uuid, p_request_digest text
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_assessment public.vulnerability_finding_assessments%rowtype; v_payload jsonb;
begin
  if not public.m5_vex_active_member(p_organization_id, p_actor_user_id) or p_finding_id is null or p_assessment_id is null
    or p_expected_version is null or p_idempotency_key is null or p_request_digest !~ '^[a-f0-9]{64}$'
    or p_decision not in ('approve', 'reject')
    or (p_decision = 'reject' and char_length(btrim(coalesce(p_decision_reason, ''))) not between 1 and 2000)
    or (p_decision = 'approve' and p_decision_reason is not null and char_length(btrim(p_decision_reason)) not between 1 and 2000) then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_user_id::text || ':' || p_idempotency_key::text, 0));
  return query select * from public.m5_vex_command_result(p_organization_id, p_actor_user_id, p_idempotency_key, p_decision, p_request_digest);
  if found then return; end if;
  if not exists (select 1 from public.vulnerability_findings findings where findings.organization_id = p_organization_id
    and findings.id = p_finding_id and findings.status = 'active') then return query select 'not_found'::text, null::jsonb; return; end if;
  select * into v_assessment from public.vulnerability_finding_assessments assessments
  where assessments.organization_id = p_organization_id and assessments.finding_id = p_finding_id
    and assessments.id = p_assessment_id and assessments.is_current for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_assessment.version <> p_expected_version then return query select 'conflict'::text, null::jsonb; return; end if;
  if v_assessment.approval_state <> 'awaiting_approval' then return query select 'invalid_state'::text, null::jsonb; return; end if;
  if v_assessment.submitted_by = p_actor_user_id then return query select 'forbidden'::text, null::jsonb; return; end if;
  update public.vulnerability_finding_assessments set approval_state = case when p_decision = 'approve' then 'approved' else 'rejected' end,
    decision_reason = case when p_decision = 'reject' then btrim(p_decision_reason) else null end,
    decided_at = clock_timestamp(), decided_by = p_actor_user_id, version = version + 1,
    updated_at = clock_timestamp(), updated_by = p_actor_user_id
  where organization_id = p_organization_id and id = v_assessment.id returning * into v_assessment;
  v_payload := jsonb_build_object(
    'assessment', public.m5_vex_assessment_json(p_organization_id, v_assessment.id),
    'idempotent', false
  );
  insert into public.vulnerability_finding_assessment_history_events(
    organization_id, assessment_id, event_type, actor_user_id, reason, previous_values, new_values
  ) values (
    p_organization_id, v_assessment.id, case when p_decision = 'approve' then 'approved' else 'rejected' end,
    p_actor_user_id, case when p_decision = 'reject' then btrim(p_decision_reason) else null end,
    jsonb_build_object('approvalState', 'awaiting_approval', 'version', v_assessment.version - 1),
    jsonb_build_object('approvalState', v_assessment.approval_state, 'version', v_assessment.version)
  );
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'vulnerability.finding_vex_assessment_' || p_decision || 'd',
    'vulnerability_finding_assessment', v_assessment.id::text,
    jsonb_build_object('previousApprovalState', 'awaiting_approval', 'assessment', v_payload -> 'assessment',
      'decisionReason', p_decision_reason, 'idempotencyKey', p_idempotency_key));
  insert into public.vulnerability_finding_assessment_commands(organization_id, actor_user_id, idempotency_key, operation, request_digest, result)
  values (p_organization_id, p_actor_user_id, p_idempotency_key, p_decision, p_request_digest, v_payload);
  return query select case when p_decision = 'approve' then 'approved' else 'rejected' end, v_payload;
end;
$$;

create or replace function public.approve_vulnerability_finding_vex_assessment_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_finding_id uuid, p_assessment_id uuid,
  p_expected_version integer, p_decision_reason text, p_idempotency_key uuid, p_request_digest text
) returns table(outcome text, result jsonb)
language sql security definer set search_path = public, pg_temp as $$
  select * from public.m5_vex_decide_assessment_atomic(
    p_organization_id, p_actor_user_id, p_finding_id, p_assessment_id, p_expected_version,
    'approve', p_decision_reason, p_idempotency_key, p_request_digest)
$$;

create or replace function public.reject_vulnerability_finding_vex_assessment_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_finding_id uuid, p_assessment_id uuid,
  p_expected_version integer, p_decision_reason text, p_idempotency_key uuid, p_request_digest text
) returns table(outcome text, result jsonb)
language sql security definer set search_path = public, pg_temp as $$
  select * from public.m5_vex_decide_assessment_atomic(
    p_organization_id, p_actor_user_id, p_finding_id, p_assessment_id, p_expected_version,
    'reject', p_decision_reason, p_idempotency_key, p_request_digest)
$$;

create or replace function public.set_vulnerability_assessment_approval_policy_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_severity text, p_approval_required boolean,
  p_expected_version integer, p_idempotency_key uuid, p_request_digest text
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_policy public.vulnerability_assessment_approval_policies%rowtype; v_payload jsonb;
begin
  if not public.m5_vex_active_member(p_organization_id, p_actor_user_id) or p_severity not in ('critical', 'high', 'medium', 'low', 'unknown')
    or p_approval_required is null or p_expected_version is null or p_expected_version < 0
    or p_idempotency_key is null or p_request_digest !~ '^[a-f0-9]{64}$' then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_user_id::text || ':' || p_idempotency_key::text, 0));
  return query select * from public.m5_vex_command_result(p_organization_id, p_actor_user_id, p_idempotency_key, 'set_policy', p_request_digest);
  if found then return; end if;
  select * into v_policy from public.vulnerability_assessment_approval_policies policies
  where policies.organization_id = p_organization_id and policies.severity = p_severity for update;
  if found and p_expected_version <> v_policy.version then return query select 'conflict'::text, null::jsonb; return; end if;
  if not found and p_expected_version <> 0 then return query select 'conflict'::text, null::jsonb; return; end if;
  insert into public.vulnerability_assessment_approval_policies(organization_id, severity, approval_required, created_by, updated_by)
  values (p_organization_id, p_severity, p_approval_required, p_actor_user_id, p_actor_user_id)
  on conflict (organization_id, severity) do update set approval_required = excluded.approval_required,
    version = public.vulnerability_assessment_approval_policies.version + 1,
    updated_at = clock_timestamp(), updated_by = excluded.updated_by
  returning * into v_policy;
  v_payload := jsonb_build_object('policy', jsonb_build_object(
    'severity', v_policy.severity, 'approvalRequired', v_policy.approval_required,
    'version', v_policy.version, 'isOverride', true,
    'updatedAt', to_char(v_policy.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedByUserId', v_policy.updated_by));
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'vulnerability.assessment_approval_policy_set',
    'vulnerability_assessment_approval_policy', p_severity,
    jsonb_build_object('policy', v_payload, 'idempotencyKey', p_idempotency_key));
  insert into public.vulnerability_finding_assessment_commands(organization_id, actor_user_id, idempotency_key, operation, request_digest, result)
  values (p_organization_id, p_actor_user_id, p_idempotency_key, 'set_policy', p_request_digest, v_payload);
  return query select 'updated'::text, v_payload;
end;
$$;

alter function public.m5_vex_guard_assessment_update() owner to postgres;
alter function public.m5_vex_guard_assessment_delete() owner to postgres;
alter function public.m5_vex_guard_append_only() owner to postgres;
alter function public.m5_vex_active_member(uuid, uuid) owner to postgres;
alter function public.m5_vex_assessment_json(uuid, uuid) owner to postgres;
alter function public.m5_vex_command_result(uuid, uuid, uuid, text, text) owner to postgres;
alter function public.get_finding_vex_assessment(uuid, uuid, uuid) owner to postgres;
alter function public.list_vulnerability_assessment_approval_policy(uuid, uuid) owner to postgres;
alter function public.submit_vulnerability_finding_vex_assessment_atomic(uuid, uuid, uuid, text, text, text, jsonb, text, integer, uuid, text) owner to postgres;
alter function public.m5_vex_decide_assessment_atomic(uuid, uuid, uuid, uuid, integer, text, text, uuid, text) owner to postgres;
alter function public.approve_vulnerability_finding_vex_assessment_atomic(uuid, uuid, uuid, uuid, integer, text, uuid, text) owner to postgres;
alter function public.reject_vulnerability_finding_vex_assessment_atomic(uuid, uuid, uuid, uuid, integer, text, uuid, text) owner to postgres;
alter function public.set_vulnerability_assessment_approval_policy_atomic(uuid, uuid, text, boolean, integer, uuid, text) owner to postgres;
revoke all on function public.m5_vex_guard_assessment_update(), public.m5_vex_guard_assessment_delete(),
  public.m5_vex_guard_append_only(), public.m5_vex_active_member(uuid, uuid), public.m5_vex_assessment_json(uuid, uuid),
  public.m5_vex_command_result(uuid, uuid, uuid, text, text), public.get_finding_vex_assessment(uuid, uuid, uuid),
  public.list_vulnerability_assessment_approval_policy(uuid, uuid),
  public.submit_vulnerability_finding_vex_assessment_atomic(uuid, uuid, uuid, text, text, text, jsonb, text, integer, uuid, text),
  public.m5_vex_decide_assessment_atomic(uuid, uuid, uuid, uuid, integer, text, text, uuid, text),
  public.approve_vulnerability_finding_vex_assessment_atomic(uuid, uuid, uuid, uuid, integer, text, uuid, text),
  public.reject_vulnerability_finding_vex_assessment_atomic(uuid, uuid, uuid, uuid, integer, text, uuid, text),
  public.set_vulnerability_assessment_approval_policy_atomic(uuid, uuid, text, boolean, integer, uuid, text)
  from public, anon, authenticated;
grant execute on function public.get_finding_vex_assessment(uuid, uuid, uuid),
  public.list_vulnerability_assessment_approval_policy(uuid, uuid),
  public.submit_vulnerability_finding_vex_assessment_atomic(uuid, uuid, uuid, text, text, text, jsonb, text, integer, uuid, text),
  public.approve_vulnerability_finding_vex_assessment_atomic(uuid, uuid, uuid, uuid, integer, text, uuid, text),
  public.reject_vulnerability_finding_vex_assessment_atomic(uuid, uuid, uuid, uuid, integer, text, uuid, text),
  public.set_vulnerability_assessment_approval_policy_atomic(uuid, uuid, text, boolean, integer, uuid, text)
  to service_role;

-- This is deliberately a forward replacement: M5-01's queue remains a
-- tenant-wide keyset query, now with the additive current-VEX projection and
-- filters.  The corrected camel-case key matches the parsed web contract.
create or replace function public.list_finding_triage_queue(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_filters jsonb default '{}'::jsonb,
  p_limit integer default 50,
  p_cursor text default null,
  p_sort text default null,
  p_order text default null
) returns table(outcome text, result jsonb)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_cursor jsonb := '{}'::jsonb;
  v_sort text;
  v_direction text;
  v_cursor_value text;
  v_cursor_id uuid;
  v_rows jsonb;
  v_invalid_filters jsonb := '[]'::jsonb;
begin
  if not public.m5_triage_active_member(p_organization_id, p_actor_user_id)
     or jsonb_typeof(p_filters) <> 'object' or p_limit not between 1 and 100
     or (p_cursor is not null and char_length(p_cursor) > 1024) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  v_sort := coalesce(p_sort, p_filters ->> 'sort', 'lastEvaluatedAt');
  v_direction := coalesce(p_order, p_filters ->> 'order', p_filters ->> 'direction', 'desc');
  if v_sort not in ('lastEvaluatedAt', 'firstDetectedAt', 'severity', 'epss')
     or v_direction not in ('asc', 'desc') then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  if p_cursor is not null then
    begin
      v_cursor := convert_from(decode(
        translate(p_cursor, '-_', '+/') || repeat('=', (4 - length(p_cursor) % 4) % 4), 'base64'
      ), 'utf8')::jsonb;
      v_cursor_value := v_cursor ->> 'value';
      v_cursor_id := (v_cursor ->> 'id')::uuid;
      if v_cursor ->> 'sort' <> v_sort or v_cursor ->> 'direction' <> v_direction
         or v_cursor_value is null then raise exception 'invalid cursor'; end if;
    exception when others then
      return query select 'invalid_cursor'::text, null::jsonb;
      return;
    end;
  end if;
  -- Referenced IDs are intentionally never relaxed: a stale, deleted, or
  -- cross-tenant ID yields an empty page with a safe explanation.
  if jsonb_typeof(p_filters -> 'productIds') = 'array' and exists (
    select 1 from jsonb_array_elements_text(p_filters -> 'productIds') item
    where not exists (select 1 from public.products products
      where products.organization_id = p_organization_id and products.id = item::uuid)
  ) then v_invalid_filters := v_invalid_filters || jsonb_build_array(jsonb_build_object(
    'field', 'productIds', 'referenceId', null, 'code', 'unavailable',
    'message', 'A selected product is unavailable.'));
  end if;
  if jsonb_typeof(p_filters -> 'releaseIds') = 'array' and exists (
    select 1 from jsonb_array_elements_text(p_filters -> 'releaseIds') item
    where not exists (select 1 from public.product_releases releases
      where releases.organization_id = p_organization_id and releases.id = item::uuid)
  ) then v_invalid_filters := v_invalid_filters || jsonb_build_array(jsonb_build_object(
    'field', 'releaseIds', 'referenceId', null, 'code', 'unavailable',
    'message', 'A selected release is unavailable.'));
  end if;
  if jsonb_typeof(p_filters -> 'assessedByUserIds') = 'array' and exists (
    select 1 from jsonb_array_elements_text(p_filters -> 'assessedByUserIds') item
    where not exists (select 1 from public.organization_members members
      join public.users users on users.id = members.user_id and users.is_active
      where members.organization_id = p_organization_id and members.user_id = item::uuid)
  ) then v_invalid_filters := v_invalid_filters || jsonb_build_array(jsonb_build_object(
    'field', 'assessedByUserIds', 'referenceId', null, 'code', 'unavailable',
    'message', 'A selected assessor is unavailable.'));
  end if;
  if jsonb_array_length(v_invalid_filters) > 0 then
    return query select 'found'::text, jsonb_build_object('rows', '[]'::jsonb, 'nextCursor', null,
      'filterIssues', v_invalid_filters);
    return;
  end if;
  with base as (
    select findings.*, releases.label as release_name, products.id as product_id, products.name as product_name,
      occurrences.document_id, occurrences.component_id, occurrences.canonical_purl,
      occurrences.canonical_cpe, occurrences.component_version,
      public.m4_03_intelligence_with_provenance_json(findings.vulnerability_id, findings.last_evaluated_at) intelligence,
      reachability.result as reachability,
      vex.vex_status, vex.approval_state
    from public.vulnerability_findings findings
    join public.product_releases releases on releases.organization_id = findings.organization_id and releases.id = findings.release_id
    join public.products products on products.organization_id = releases.organization_id and products.id = releases.product_id
    left join lateral (
      select occurrences.* from public.vulnerability_finding_component_occurrences links
      join public.vulnerability_component_occurrences occurrences
        on occurrences.organization_id = links.organization_id and occurrences.id = links.occurrence_id
      where links.organization_id = findings.organization_id and links.finding_id = findings.id and links.state = 'active'
      order by occurrences.id limit 1
    ) occurrences on true
    left join lateral (
      select public.m4_07_reachability_result_json(results.id) result
      from public.vulnerability_reachability_results results
      where results.organization_id = findings.organization_id and results.finding_id = findings.id and results.freshness = 'current'
      order by results.executed_at desc, results.id desc limit 1
    ) reachability on true
    left join lateral (
      select assessments.vex_status, assessments.approval_state
      from public.vulnerability_finding_assessments assessments
      where assessments.organization_id = findings.organization_id
        and assessments.finding_id = findings.id and assessments.is_current
    ) vex on true
    where findings.organization_id = p_organization_id
      and (p_filters -> 'findingStates' is null or findings.status::text = any(
        array(select jsonb_array_elements_text(p_filters -> 'findingStates'))
      ))
  ), filtered as (
    select base.*,
      coalesce((intelligence #>> '{cvss,preferred,baseScore}')::numeric, -1) as severity_score,
      (intelligence #>> '{epss,value}')::numeric as epss_score,
      case when v_sort = 'lastEvaluatedAt' then extract(epoch from last_evaluated_at)::text
        when v_sort = 'firstDetectedAt' then extract(epoch from first_detected_at)::text
        when v_sort = 'severity' then coalesce((intelligence #>> '{cvss,preferred,baseScore}')::numeric, -1)::text
        else coalesce((intelligence #>> '{epss,value}')::numeric, -1)::text end as sort_value
    from base
    where (p_filters -> 'productIds' is null or product_id = any(array(select jsonb_array_elements_text(p_filters -> 'productIds')::uuid)))
      and (p_filters -> 'releaseIds' is null or release_id = any(array(select jsonb_array_elements_text(p_filters -> 'releaseIds')::uuid)))
      and (p_filters -> 'assessmentStates' is null or
        case when human_verdict is null then 'unassessed' else human_verdict end = any(array(select jsonb_array_elements_text(p_filters -> 'assessmentStates'))))
      and (p_filters -> 'reEvaluationStates' is null or reevaluation_state = any(array(select jsonb_array_elements_text(p_filters -> 'reEvaluationStates'))))
      and (p_filters -> 'vexStatuses' is null or vex_status = any(array(select jsonb_array_elements_text(p_filters -> 'vexStatuses'))))
      and (p_filters -> 'approvalStates' is null or approval_state = any(array(select jsonb_array_elements_text(p_filters -> 'approvalStates'))))
      and (p_filters -> 'assessedByUserIds' is null or human_assessed_by = any(array(select jsonb_array_elements_text(p_filters -> 'assessedByUserIds')::uuid)))
      and (p_filters ->> 'ageDaysMin' is null or first_detected_at <= clock_timestamp() - make_interval(days => (p_filters ->> 'ageDaysMin')::integer))
      and (p_filters ->> 'ageDaysMax' is null or first_detected_at >= clock_timestamp() - make_interval(days => (p_filters ->> 'ageDaysMax')::integer))
      and (p_filters -> 'severities' is null or case when coalesce((intelligence #>> '{cvss,preferred,baseScore}')::numeric, -1) < 0 then 'unknown'
        when (intelligence #>> '{cvss,preferred,baseScore}')::numeric >= 9 then 'critical'
        when (intelligence #>> '{cvss,preferred,baseScore}')::numeric >= 7 then 'high'
        when (intelligence #>> '{cvss,preferred,baseScore}')::numeric >= 4 then 'medium' else 'low' end
        = any(array(select jsonb_array_elements_text(p_filters -> 'severities'))))
      and (p_filters ->> 'epssMin' is null or coalesce((intelligence #>> '{epss,value}')::numeric, -1) >= (p_filters ->> 'epssMin')::numeric)
      and (p_filters ->> 'epssMax' is null or coalesce((intelligence #>> '{epss,value}')::numeric, -1) <= (p_filters ->> 'epssMax')::numeric)
      and (coalesce(p_filters ->> 'epssState', 'known') <> 'unknown' or (intelligence #>> '{epss,value}') is null)
      and (p_filters -> 'kevStatuses' is null or intelligence #>> '{kev,status}' = any(array(select jsonb_array_elements_text(p_filters -> 'kevStatuses'))))
      and (p_filters -> 'reachability' is null or coalesce(reachability ->> 'verdict', 'unknown') = any(array(select jsonb_array_elements_text(p_filters -> 'reachability'))))
  ), page as (
    select * from filtered
    where p_cursor is null or case when v_direction = 'desc' then
      (sort_value::numeric, id) < (v_cursor_value::numeric, v_cursor_id)
    else (sort_value::numeric, id) > (v_cursor_value::numeric, v_cursor_id) end
    order by case when v_direction = 'asc' then sort_value::numeric end asc nulls last,
      case when v_direction = 'desc' then sort_value::numeric end desc nulls last,
      case when v_direction = 'asc' then id end asc,
      case when v_direction = 'desc' then id end desc
    limit p_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'finding', jsonb_build_object(
      'id', id, 'documentId', document_id, 'releaseId', release_id, 'componentId', component_id,
      'canonicalPurl', canonical_purl, 'canonicalCpe', canonical_cpe,
      'evaluatedVersion', coalesce(component_version, evaluated_component_value),
      'advisoryId', canonical_advisory_id,
      'advisoryAliases', coalesce((select jsonb_agg(aliases.alias order by lower(aliases.alias))
        from public.vulnerability_aliases aliases where aliases.vulnerability_id = page.vulnerability_id), '[]'::jsonb),
      'matchMethod', match_method, 'outcome', 'affected', 'sourceFeed', source_feed_key,
      'sourceRecordId', source_record_id, 'sourceRecordVersionId', source_record_version_id,
      'affectedRangeId', affected_range_id, 'affectedRangeEvents', event_sequence,
      'affectedVersions', coalesce(affected_range -> 'versions', '[]'::jsonb),
      'comparator', comparator_name, 'comparatorVersion', comparator_version,
      'confidence', jsonb_build_object('score', confidence,
        'level', case when confidence >= .9 then 'high' when confidence >= .6 then 'medium' else 'low' end,
        'explanation', confidence_explanation, 'tableVersion', confidence_table_version),
      'cpeSpecificity', case when match_method = 'cpe_nvd' then coalesce(affected_range ->> 'm4CpeSpecificity', 'broad_family') else null end,
      'cpeConfigurationEvidence', case when match_method = 'cpe_nvd' then coalesce(affected_range -> 'm4CpeConfigurationEvidence', '{}'::jsonb) else null end,
      'reEvaluationState', reevaluation_state,
      'humanAssessment', case when human_verdict is null then null else jsonb_build_object(
        'verdict', human_verdict, 'rationale', human_rationale,
        'assessedByUserId', human_assessed_by, 'assessedAt', human_assessed_at) end,
      'firstDetectedAt', first_detected_at, 'lastEvaluatedAt', last_evaluated_at,
      'createdAt', created_at, 'updatedAt', updated_at
    ),
    'product', jsonb_build_object('id', product_id, 'name', product_name),
    'release', jsonb_build_object('id', release_id, 'name', release_name),
    'severity', case when severity_score < 0 then 'unknown' when severity_score >= 9 then 'critical'
      when severity_score >= 7 then 'high' when severity_score >= 4 then 'medium' else 'low' end,
    'epss', epss_score, 'kevStatus', coalesce(intelligence #>> '{kev,status}', 'unavailable'),
    'reachability', reachability ->> 'verdict',
    'assessmentState', case when human_verdict is null then 'unassessed' else human_verdict end,
    'vexStatus', vex_status, 'approvalState', approval_state,
    'sortValue', sort_value
  ) order by case when v_direction = 'asc' then sort_value::numeric end asc nulls last,
    case when v_direction = 'desc' then sort_value::numeric end desc nulls last,
    case when v_direction = 'asc' then id end asc, case when v_direction = 'desc' then id end desc), '[]'::jsonb)
  into v_rows from page;
  return query select 'found'::text, jsonb_build_object(
    'rows', coalesce((select jsonb_agg(row_item - 'sortValue' order by ordinal)
      from jsonb_array_elements(v_rows) with ordinality rows(row_item, ordinal)), '[]'::jsonb),
    'nextCursor', case when jsonb_array_length(v_rows) = p_limit then
      translate(replace(encode(convert_to(jsonb_build_object('sort', v_sort, 'direction', v_direction,
        'value', v_rows -> (p_limit - 1) ->> 'sortValue', 'id', v_rows -> (p_limit - 1) -> 'finding' ->> 'id')::text, 'utf8'), 'base64'), E'\n', ''), '+/=', '-_')
      else null end,
    'filterIssues', '[]'::jsonb
  );
end;
$$;
