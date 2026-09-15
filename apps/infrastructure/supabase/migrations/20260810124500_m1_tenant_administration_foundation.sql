-- =============================================================================
-- M1 V1 durable tenant administration and data lifecycle.
--
-- All browser roles are denied. The service role crosses the storage boundary
-- only through explicitly scoped tables/RPCs; every tenant RPC takes the
-- organization identifier first and writes its audit fact transactionally.
-- =============================================================================

-- Server-owned, test/local-safe catalogs. Membership is never inferred from a
-- browser locale, deployment region, or arbitrary provider input.
create table public.tenant_settings_catalog (
  category text not null,
  identifier text not null,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  primary key (category, identifier),
  constraint tenant_settings_catalog_category_check check (category in (
    'timezone', 'notification_channel', 'ai_provider', 'data_residency'
  )),
  constraint tenant_settings_catalog_identifier_check
    check (length(identifier) between 1 and 128)
);

insert into public.tenant_settings_catalog (category, identifier, sort_order) values
  ('timezone', 'Etc/UTC', 1),
  ('timezone', 'Asia/Kolkata', 2),
  ('timezone', 'America/New_York', 3),
  ('notification_channel', 'email', 1),
  ('notification_channel', 'in_app', 2),
  ('ai_provider', 'test_ai', 1),
  ('data_residency', 'local', 1);

create table public.retention_evidence_classes (
  identifier text primary key,
  enabled boolean not null default true,
  default_requested_retention_days integer not null default 0,
  constraint retention_evidence_classes_identifier_check
    check (identifier ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint retention_evidence_classes_days_check
    check (default_requested_retention_days between 0 and 36500)
);

insert into public.retention_evidence_classes (identifier, default_requested_retention_days) values
  ('audit_event', 0), ('export_artifact', 0), ('security_event', 0);

create table public.organization_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  configured boolean not null default false,
  version integer not null default 0,
  timezone text,
  working_days text[],
  holidays date[],
  notification_channel_ids text[],
  mfa_enforcement_date date,
  maximum_session_age_minutes integer,
  ai_provider_id text,
  data_residency_id text,
  updated_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_settings_version_check check (version >= 0),
  constraint organization_settings_state_check check (
    (not configured and version = 0 and timezone is null and working_days is null
      and holidays is null and notification_channel_ids is null
      and mfa_enforcement_date is null and maximum_session_age_minutes is null
      and ai_provider_id is null and data_residency_id is null)
    or
    (configured and version > 0 and timezone is not null and working_days is not null
      and cardinality(working_days) > 0 and holidays is not null
      and notification_channel_ids is not null
      and maximum_session_age_minutes between 5 and 43200
      and ai_provider_id is not null and data_residency_id is not null)
  )
);

create index organization_settings_updated_by_idx on public.organization_settings (updated_by);

create table public.organization_lifecycles (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  status text not null default 'active',
  version integer not null default 0,
  changed_at timestamptz not null default now(),
  changed_by uuid references public.users (id) on delete set null,
  deactivated_at timestamptz,
  purge_after timestamptz,
  purge_block_reasons jsonb not null default '[]'::jsonb,
  safe_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_lifecycles_status_check check (status in (
    'active', 'deactivated', 'purge_scheduled', 'purge_blocked', 'purging', 'purged'
  )),
  constraint organization_lifecycles_version_check check (version >= 0),
  constraint organization_lifecycles_block_reasons_check
    check (jsonb_typeof(purge_block_reasons) = 'array')
);

create index organization_lifecycles_changed_by_idx on public.organization_lifecycles (changed_by);
create index organization_lifecycles_due_idx on public.organization_lifecycles (status, purge_after)
  where status in ('purge_scheduled', 'purge_blocked', 'purging');

create table public.organization_retention_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  evidence_class text not null references public.retention_evidence_classes (identifier),
  version integer not null default 1,
  requested_retention_days integer not null,
  effective_floor_days integer not null default 0,
  effective_retention_days integer not null,
  floor_snapshot_version integer not null default 0,
  updated_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, evidence_class),
  constraint organization_retention_policies_days_check check (
    requested_retention_days between 0 and 36500
    and effective_floor_days between 0 and 36500
    and effective_retention_days = greatest(requested_retention_days, effective_floor_days)
  ),
  constraint organization_retention_policies_version_check
    check (version > 0 and floor_snapshot_version >= 0)
);

create index organization_retention_policies_updated_by_idx
  on public.organization_retention_policies (updated_by);

create table public.retention_authority_states (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  authority_kind text not null,
  available boolean not null default false,
  last_reconciled_at timestamptz,
  safe_error_code text,
  primary key (organization_id, authority_kind),
  constraint retention_authority_states_kind_check check (authority_kind in (
    'product', 'evidence_class', 'obligation', 'legal_hold'
  ))
);

create table public.retention_authoritative_facts (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  evidence_class text not null references public.retention_evidence_classes (identifier),
  reason_kind text not null,
  source_record_id uuid not null,
  required_retention_days integer not null,
  protect_through timestamptz,
  active boolean not null default true,
  first_observed_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),
  primary key (organization_id, evidence_class, reason_kind, source_record_id),
  constraint retention_authoritative_facts_kind_check check (reason_kind in (
    'product', 'evidence_class', 'obligation', 'legal_hold'
  )),
  constraint retention_authoritative_facts_days_check
    check (required_retention_days between 0 and 36500)
);

create index retention_authoritative_facts_active_idx
  on public.retention_authoritative_facts (organization_id, evidence_class, reason_kind)
  where active;

create table public.retention_floor_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  evidence_class text not null,
  snapshot_version integer not null,
  effective_floor_days integer not null,
  reason_digest text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, evidence_class, snapshot_version),
  foreign key (organization_id, evidence_class)
    references public.organization_retention_policies (organization_id, evidence_class)
    on delete cascade,
  constraint retention_floor_snapshots_digest_check check (reason_digest ~ '^[0-9a-f]{64}$')
);

create table public.retention_floor_reasons (
  snapshot_id uuid not null references public.retention_floor_snapshots (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  evidence_class text not null,
  reason_kind text not null,
  source_record_id uuid not null,
  required_retention_days integer not null,
  protect_through timestamptz,
  primary key (snapshot_id, reason_kind, source_record_id),
  constraint retention_floor_reasons_kind_check check (reason_kind in (
    'product', 'evidence_class', 'obligation', 'legal_hold'
  ))
);

create index retention_floor_reasons_tenant_idx
  on public.retention_floor_reasons (organization_id, evidence_class, reason_kind);

create table public.evidence_protection_watermarks (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  evidence_class text not null references public.retention_evidence_classes (identifier),
  protected_through timestamptz not null default '-infinity',
  updated_at timestamptz not null default now(),
  primary key (organization_id, evidence_class)
);

create table public.retention_cleanup_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  evidence_class text not null references public.retention_evidence_classes (identifier),
  status text not null default 'queued',
  requested_by uuid references public.users (id) on delete set null,
  lease_owner uuid,
  lease_expires_at timestamptz,
  checkpoint_version integer not null default 0,
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  available_at timestamptz not null default now(),
  safe_error_code text,
  safe_diagnostics jsonb,
  blocked_reasons jsonb not null default '[]'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint retention_cleanup_runs_status_check check (status in (
    'queued', 'running', 'retry', 'blocked', 'completed', 'dead_letter'
  )),
  constraint retention_cleanup_runs_attempt_check check (
    checkpoint_version >= 0 and attempt_count >= 0 and max_attempts between 1 and 100
  ),
  constraint retention_cleanup_runs_json_check check (
    jsonb_typeof(blocked_reasons) = 'array'
    and (safe_diagnostics is null or jsonb_typeof(safe_diagnostics) = 'object')
  )
);

create index retention_cleanup_runs_claim_idx
  on public.retention_cleanup_runs (organization_id, status, available_at, created_at);
create index retention_cleanup_runs_requested_by_idx on public.retention_cleanup_runs (requested_by);

create table public.retention_cleanup_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  cleanup_run_id uuid not null references public.retention_cleanup_runs (id) on delete cascade,
  evidence_class text not null references public.retention_evidence_classes (identifier),
  source_record_id uuid not null,
  observed_at timestamptz not null,
  protection_watermark timestamptz not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  safe_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, cleanup_run_id, source_record_id),
  constraint retention_cleanup_items_status_check check (status in (
    'pending', 'deleted', 'skipped_protected', 'failed'
  ))
);

create index retention_cleanup_items_run_idx
  on public.retention_cleanup_items (organization_id, cleanup_run_id, status);

create table public.organization_export_sources (
  source_id text primary key,
  enabled boolean not null default true,
  sort_order integer not null,
  constraint organization_export_sources_id_check
    check (source_id ~ '^[a-z][a-z0-9_]{0,63}$')
);

insert into public.organization_export_sources (source_id, sort_order) values
  ('organization_profile', 1), ('memberships', 2), ('audit_logs', 3);

create table public.organization_export_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  actor_user_id uuid not null references public.users (id) on delete restrict,
  correlation_id text,
  request_digest text not null,
  status text not null default 'queued',
  completed_parts integer not null default 0,
  total_parts integer not null default 0,
  checkpoint_version integer not null default 0,
  lease_owner uuid,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  available_at timestamptz not null default now(),
  safe_error_code text,
  safe_diagnostics jsonb,
  manifest_format_version integer,
  manifest_sha256 text,
  artifact_sha256 text,
  artifact_object_path text,
  manifest_file_count integer,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_export_jobs_status_check check (status in (
    'queued', 'running', 'paused', 'completed', 'failed', 'expired', 'dead_letter'
  )),
  constraint organization_export_jobs_digest_check check (request_digest ~ '^[0-9a-f]{64}$'),
  constraint organization_export_jobs_progress_check check (
    completed_parts >= 0 and total_parts >= 0 and completed_parts <= total_parts
    and checkpoint_version >= 0 and attempt_count >= 0 and max_attempts between 1 and 100
  ),
  constraint organization_export_jobs_hash_check check (
    (manifest_sha256 is null or manifest_sha256 ~ '^[0-9a-f]{64}$')
    and (artifact_sha256 is null or artifact_sha256 ~ '^[0-9a-f]{64}$')
  ),
  constraint organization_export_jobs_diagnostics_check
    check (safe_diagnostics is null or jsonb_typeof(safe_diagnostics) = 'object')
);

create index organization_export_jobs_claim_idx
  on public.organization_export_jobs (organization_id, status, available_at, created_at);
create index organization_export_jobs_actor_idx
  on public.organization_export_jobs (actor_user_id, created_at desc);

create table public.organization_export_idempotencies (
  actor_user_id uuid not null references public.users (id) on delete cascade,
  idempotency_key uuid not null,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  request_digest text not null,
  export_job_id uuid not null references public.organization_export_jobs (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (actor_user_id, idempotency_key),
  constraint organization_export_idempotencies_digest_check check (request_digest ~ '^[0-9a-f]{64}$')
);

create index organization_export_idempotencies_org_idx
  on public.organization_export_idempotencies (organization_id, export_job_id);

create table public.organization_export_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  export_job_id uuid not null references public.organization_export_jobs (id) on delete cascade,
  snapshot_version integer not null,
  source_catalog_version integer not null default 1,
  source_ids text[] not null,
  created_at timestamptz not null default now(),
  unique (organization_id, export_job_id, snapshot_version)
);

create table public.organization_export_parts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  export_job_id uuid not null references public.organization_export_jobs (id) on delete cascade,
  source_id text not null references public.organization_export_sources (source_id),
  part_number integer not null,
  object_path text not null,
  sha256 text not null,
  byte_size bigint not null,
  created_at timestamptz not null default now(),
  unique (organization_id, export_job_id, source_id, part_number),
  constraint organization_export_parts_number_check check (part_number > 0 and byte_size >= 0),
  constraint organization_export_parts_hash_check check (sha256 ~ '^[0-9a-f]{64}$')
);

create index organization_export_parts_job_idx
  on public.organization_export_parts (organization_id, export_job_id, part_number);

create table public.organization_session_bindings (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  session_id uuid not null,
  user_id uuid not null references public.users (id) on delete cascade,
  issued_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  primary key (organization_id, session_id),
  unique (organization_id, user_id, session_id)
);

create index organization_session_bindings_user_idx
  on public.organization_session_bindings (user_id, organization_id);

create table public.organization_session_revocations (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  session_id uuid not null,
  user_id uuid not null references public.users (id) on delete cascade,
  reason text not null,
  lifecycle_version integer,
  revoked_at timestamptz not null default now(),
  primary key (organization_id, session_id),
  constraint organization_session_revocations_reason_check check (reason in (
    'settings_policy_tightened', 'organization_deactivated', 'membership_revoked'
  ))
);

create index organization_session_revocations_user_idx
  on public.organization_session_revocations (user_id, organization_id, revoked_at desc);

create table public.destructive_reauth_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  actor_user_id uuid not null references public.users (id) on delete cascade,
  session_id uuid not null,
  lifecycle_version integer not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_for text,
  created_at timestamptz not null default now(),
  constraint destructive_reauth_grants_consumed_for_check
    check (consumed_for is null or consumed_for in ('deactivate', 'schedule_purge', 'recover')),
  constraint destructive_reauth_grants_consumption_pair
    check ((consumed_at is null) = (consumed_for is null))
);

create index destructive_reauth_grants_lookup_idx
  on public.destructive_reauth_grants (organization_id, actor_user_id, session_id, expires_at)
  where consumed_at is null;

create table public.organization_purge_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations (id) on delete cascade,
  requested_by uuid references public.users (id) on delete set null,
  lifecycle_version integer not null,
  status text not null default 'scheduled',
  purge_after timestamptz not null,
  lease_owner uuid,
  lease_expires_at timestamptz,
  checkpoint_version integer not null default 0,
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  available_at timestamptz not null,
  safe_error_code text,
  safe_diagnostics jsonb,
  blocked_reasons jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_purge_jobs_status_check check (status in (
    'scheduled', 'running', 'blocked', 'retry', 'dead_letter'
  )),
  constraint organization_purge_jobs_json_check check (
    jsonb_typeof(blocked_reasons) = 'array'
    and (safe_diagnostics is null or jsonb_typeof(safe_diagnostics) = 'object')
  )
);

create index organization_purge_jobs_claim_idx
  on public.organization_purge_jobs (status, available_at, purge_after);
create index organization_purge_jobs_requested_by_idx on public.organization_purge_jobs (requested_by);

create table public.organization_purge_work_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  purge_job_id uuid not null references public.organization_purge_jobs (id) on delete cascade,
  work_kind text not null,
  status text not null default 'pending',
  checkpoint_version integer not null default 0,
  safe_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, purge_job_id, work_kind),
  constraint organization_purge_work_items_kind_check check (work_kind in (
    'final_eligibility', 'artifact_inventory', 'database_delete'
  )),
  constraint organization_purge_work_items_status_check check (status in (
    'pending', 'running', 'completed', 'failed'
  ))
);

-- These platform records intentionally have no FK to organizations. They are
-- the minimal proof and retryable artifact work that survive tenant deletion.
create table public.organization_deletion_proofs (
  id uuid primary key default gen_random_uuid(),
  deleted_organization_id uuid not null unique,
  organization_slug_digest text not null,
  purge_job_id uuid not null,
  lifecycle_version integer not null,
  database_deleted_at timestamptz not null,
  artifact_deletion_completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint organization_deletion_proofs_digest_check
    check (organization_slug_digest ~ '^[0-9a-f]{64}$')
);

create table public.organization_deletion_artifact_work (
  id uuid primary key default gen_random_uuid(),
  deletion_proof_id uuid not null references public.organization_deletion_proofs (id) on delete cascade,
  bucket_id text not null,
  object_prefix text not null,
  status text not null default 'queued',
  lease_owner uuid,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  max_attempts integer not null default 20,
  safe_error_code text,
  available_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_deletion_artifact_work_status_check check (status in (
    'queued', 'running', 'retry', 'completed', 'dead_letter'
  ))
);

create index organization_deletion_artifact_work_claim_idx
  on public.organization_deletion_artifact_work (status, available_at);

-- The bucket is private. No object policy grants browser reads or writes;
-- workers use the server-side service credential and organization-first paths.
insert into storage.buckets (id, name, public, file_size_limit)
values ('tenant-exports', 'tenant-exports', false, 52428800)
on conflict (id) do update set public = false;

-- Initialize new organizations and backfill existing organizations without
-- changing profile/onboarding state or inventing settings values.
create or replace function public.initialize_tenant_administration_state()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  insert into public.organization_settings (organization_id) values (new.id)
  on conflict (organization_id) do nothing;
  insert into public.organization_lifecycles (organization_id, status)
  values (new.id, case when new.is_active then 'active' else 'deactivated' end)
  on conflict (organization_id) do nothing;
  insert into public.organization_retention_policies (
    organization_id, evidence_class, requested_retention_days, effective_retention_days
  )
  select new.id, c.identifier, c.default_requested_retention_days, c.default_requested_retention_days
    from public.retention_evidence_classes c where c.enabled
  on conflict (organization_id, evidence_class) do nothing;
  insert into public.evidence_protection_watermarks (organization_id, evidence_class)
  select new.id, c.identifier from public.retention_evidence_classes c where c.enabled
  on conflict (organization_id, evidence_class) do nothing;
  insert into public.retention_authority_states (organization_id, authority_kind)
  select new.id, kind from unnest(array['product','evidence_class','obligation','legal_hold']) kind
  on conflict (organization_id, authority_kind) do nothing;
  return new;
end;
$$;

alter function public.initialize_tenant_administration_state() owner to postgres;
revoke all on function public.initialize_tenant_administration_state() from public, anon, authenticated;

drop trigger if exists initialize_tenant_administration_state on public.organizations;
create trigger initialize_tenant_administration_state
  after insert on public.organizations
  for each row execute function public.initialize_tenant_administration_state();

insert into public.organization_settings (organization_id)
select id from public.organizations on conflict (organization_id) do nothing;
insert into public.organization_lifecycles (organization_id, status)
select id, case when is_active then 'active' else 'deactivated' end from public.organizations
on conflict (organization_id) do nothing;
insert into public.organization_retention_policies (
  organization_id, evidence_class, requested_retention_days, effective_retention_days
)
select o.id, c.identifier, c.default_requested_retention_days, c.default_requested_retention_days
  from public.organizations o cross join public.retention_evidence_classes c where c.enabled
on conflict (organization_id, evidence_class) do nothing;
insert into public.evidence_protection_watermarks (organization_id, evidence_class)
select o.id, c.identifier from public.organizations o cross join public.retention_evidence_classes c where c.enabled
on conflict (organization_id, evidence_class) do nothing;
insert into public.retention_authority_states (organization_id, authority_kind)
select o.id, kind from public.organizations o
cross join unnest(array['product','evidence_class','obligation','legal_hold']) kind
on conflict (organization_id, authority_kind) do nothing;

create trigger set_organization_settings_updated_at before update on public.organization_settings
  for each row execute function public.set_updated_at();
create trigger set_organization_lifecycles_updated_at before update on public.organization_lifecycles
  for each row execute function public.set_updated_at();
create trigger set_organization_retention_policies_updated_at before update on public.organization_retention_policies
  for each row execute function public.set_updated_at();
create trigger set_evidence_protection_watermarks_updated_at before update on public.evidence_protection_watermarks
  for each row execute function public.set_updated_at();
create trigger set_retention_cleanup_runs_updated_at before update on public.retention_cleanup_runs
  for each row execute function public.set_updated_at();
create trigger set_retention_cleanup_items_updated_at before update on public.retention_cleanup_items
  for each row execute function public.set_updated_at();
create trigger set_organization_export_jobs_updated_at before update on public.organization_export_jobs
  for each row execute function public.set_updated_at();
create trigger set_organization_purge_jobs_updated_at before update on public.organization_purge_jobs
  for each row execute function public.set_updated_at();
create trigger set_organization_purge_work_items_updated_at before update on public.organization_purge_work_items
  for each row execute function public.set_updated_at();
create trigger set_organization_deletion_artifact_work_updated_at before update on public.organization_deletion_artifact_work
  for each row execute function public.set_updated_at();

create or replace function public.m1_settings_json(p_organization_id uuid)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select case when not s.configured then
    jsonb_build_object('status', 'unconfigured', 'version', 0, 'values', null)
  else jsonb_build_object(
    'status', 'configured', 'version', s.version,
    'values', jsonb_build_object(
      'timezone', s.timezone, 'workingDays', to_jsonb(s.working_days),
      'holidays', to_jsonb(s.holidays),
      'notificationChannelIds', to_jsonb(s.notification_channel_ids),
      'mfaEnforcementDate', s.mfa_enforcement_date,
      'maximumSessionAgeMinutes', s.maximum_session_age_minutes,
      'aiProviderId', s.ai_provider_id, 'dataResidencyId', s.data_residency_id
    )
  ) end
  from public.organization_settings s where s.organization_id = p_organization_id;
$$;

create or replace function public.m1_retention_policy_json(
  p_organization_id uuid,
  p_evidence_class text
)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', p.id, 'evidenceClass', p.evidence_class, 'version', p.version,
    'requestedRetentionDays', p.requested_retention_days,
    'effectiveRetentionDays', p.effective_retention_days,
    'effectiveFloorDays', p.effective_floor_days,
    'controllingReasons', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', r.reason_kind, 'recordId', r.source_record_id,
        'requiredRetentionDays', r.required_retention_days
      ) order by r.reason_kind, r.source_record_id)
      from public.retention_floor_reasons r
      where r.organization_id = p.organization_id
        and r.evidence_class = p.evidence_class
        and r.snapshot_id = (
          select s.id from public.retention_floor_snapshots s
          where s.organization_id = p.organization_id
            and s.evidence_class = p.evidence_class
            and s.snapshot_version = p.floor_snapshot_version
        )
    ), '[]'::jsonb),
    'createdAt', p.created_at, 'updatedAt', p.updated_at
  )
  from public.organization_retention_policies p
  where p.organization_id = p_organization_id and p.evidence_class = p_evidence_class;
$$;

create or replace function public.get_organization_settings_catalog(p_organization_id uuid)
  returns table (outcome text, catalog jsonb)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.organizations where id = p_organization_id) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  return query select 'found'::text, jsonb_build_object(
    'timezones', coalesce((select jsonb_agg(identifier order by sort_order, identifier)
      from public.tenant_settings_catalog where category = 'timezone' and enabled), '[]'::jsonb),
    'notificationChannels', coalesce((select jsonb_agg(identifier order by sort_order, identifier)
      from public.tenant_settings_catalog where category = 'notification_channel' and enabled), '[]'::jsonb),
    'aiProviders', coalesce((select jsonb_agg(identifier order by sort_order, identifier)
      from public.tenant_settings_catalog where category = 'ai_provider' and enabled), '[]'::jsonb),
    'dataResidencies', coalesce((select jsonb_agg(identifier order by sort_order, identifier)
      from public.tenant_settings_catalog where category = 'data_residency' and enabled), '[]'::jsonb),
    'minimumSessionAgeMinutes', 5, 'maximumSessionAgeMinutes', 43200
  );
end;
$$;

create or replace function public.get_organization_settings(p_organization_id uuid)
  returns table (outcome text, settings jsonb)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.organization_settings where organization_id = p_organization_id) then
    return query select 'not_found'::text, null::jsonb;
  else
    return query select 'found'::text, public.m1_settings_json(p_organization_id);
  end if;
end;
$$;

create or replace function public.update_organization_settings_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_expected_version integer,
  p_timezone text,
  p_working_days text[],
  p_holidays date[],
  p_notification_channel_ids text[],
  p_mfa_enforcement_date date,
  p_maximum_session_age_minutes integer,
  p_ai_provider_id text,
  p_data_residency_id text,
  p_session_id uuid
)
  returns table (outcome text, settings jsonb, session_policy_tightened boolean)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_old public.organization_settings%rowtype;
  v_tightened boolean := false;
begin
  if not exists (
    select 1 from public.organization_members m
    join public.organization_lifecycles l on l.organization_id = m.organization_id
    where m.organization_id = p_organization_id and m.user_id = p_actor_user_id
      and l.status = 'active'
  ) then
    return query select 'not_found'::text, null::jsonb, false;
    return;
  end if;
  select * into v_old from public.organization_settings
    where organization_id = p_organization_id for update;
  if not found then
    return query select 'not_found'::text, null::jsonb, false;
    return;
  end if;
  if v_old.version <> p_expected_version then
    return query select 'conflict'::text, public.m1_settings_json(p_organization_id), false;
    return;
  end if;
  if p_session_id is null
     or p_maximum_session_age_minutes not between 5 and 43200
     or p_working_days is null or cardinality(p_working_days) = 0
     or cardinality(p_working_days) <> (select count(distinct x) from unnest(p_working_days) x)
     or exists (select 1 from unnest(p_working_days) d where d not in (
       'monday','tuesday','wednesday','thursday','friday','saturday','sunday'
     ))
     or p_holidays is null
     or cardinality(p_holidays) <> (select count(distinct x) from unnest(p_holidays) x)
     or p_notification_channel_ids is null
     or cardinality(p_notification_channel_ids) <>
       (select count(distinct x) from unnest(p_notification_channel_ids) x)
     or not exists (select 1 from public.tenant_settings_catalog
       where category = 'timezone' and identifier = p_timezone and enabled)
     or exists (select 1 from unnest(p_notification_channel_ids) x
       where not exists (select 1 from public.tenant_settings_catalog
         where category = 'notification_channel' and identifier = x and enabled))
     or not exists (select 1 from public.tenant_settings_catalog
       where category = 'ai_provider' and identifier = p_ai_provider_id and enabled)
     or not exists (select 1 from public.tenant_settings_catalog
       where category = 'data_residency' and identifier = p_data_residency_id and enabled)
  then
    return query select 'invalid_catalog'::text, public.m1_settings_json(p_organization_id), false;
    return;
  end if;

  v_tightened := v_old.configured and (
    p_maximum_session_age_minutes < v_old.maximum_session_age_minutes
    or (p_mfa_enforcement_date is not null and
      (v_old.mfa_enforcement_date is null or p_mfa_enforcement_date < v_old.mfa_enforcement_date))
  );
  update public.organization_settings set
    configured = true, version = version + 1, timezone = p_timezone,
    working_days = p_working_days, holidays = p_holidays,
    notification_channel_ids = p_notification_channel_ids,
    mfa_enforcement_date = p_mfa_enforcement_date,
    maximum_session_age_minutes = p_maximum_session_age_minutes,
    ai_provider_id = p_ai_provider_id, data_residency_id = p_data_residency_id,
    updated_by = p_actor_user_id, updated_at = now()
  where organization_id = p_organization_id;

  if v_tightened then
    insert into public.organization_session_revocations (
      organization_id, session_id, user_id, reason, lifecycle_version
    )
    select b.organization_id, b.session_id, b.user_id, 'settings_policy_tightened', l.version
      from public.organization_session_bindings b
      join public.organization_lifecycles l on l.organization_id = b.organization_id
     where b.organization_id = p_organization_id
    on conflict (organization_id, session_id) do update
      set reason = excluded.reason, lifecycle_version = excluded.lifecycle_version,
          revoked_at = excluded.revoked_at;
  end if;

  insert into public.audit_logs (
    organization_id, user_id, action, entity_type, entity_id, changes
  ) values (
    p_organization_id, p_actor_user_id, 'organization.settings_updated',
    'organization_settings', p_organization_id::text,
    jsonb_build_object(
      'before', jsonb_build_object('configured', v_old.configured, 'version', v_old.version),
      'after', jsonb_build_object('configured', true, 'version', v_old.version + 1),
      'sessionPolicyTightened', v_tightened
    )
  );
  return query select 'updated'::text, public.m1_settings_json(p_organization_id), v_tightened;
end;
$$;

create or replace function public.get_organization_retention_policies(p_organization_id uuid)
  returns table (outcome text, policies jsonb)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.organizations where id = p_organization_id) then
    return query select 'not_found'::text, null::jsonb;
  else
    return query select 'found'::text, coalesce(jsonb_agg(
      public.m1_retention_policy_json(p_organization_id, p.evidence_class)
      order by p.evidence_class
    ), '[]'::jsonb)
    from public.organization_retention_policies p where p.organization_id = p_organization_id;
  end if;
end;
$$;

create or replace function public.update_organization_retention_policy_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_evidence_class text,
  p_expected_version integer,
  p_requested_retention_days integer
)
  returns table (outcome text, policy jsonb)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare v_policy public.organization_retention_policies%rowtype;
begin
  if p_requested_retention_days not between 0 and 36500
     or not exists (select 1 from public.retention_evidence_classes
       where identifier = p_evidence_class and enabled) then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  if not exists (select 1 from public.organization_members m
    join public.organization_lifecycles l on l.organization_id = m.organization_id
    where m.organization_id = p_organization_id and m.user_id = p_actor_user_id
      and l.status = 'active') then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  select * into v_policy from public.organization_retention_policies
    where organization_id = p_organization_id and evidence_class = p_evidence_class for update;
  if not found then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  if v_policy.version <> p_expected_version then
    return query select 'conflict'::text,
      public.m1_retention_policy_json(p_organization_id, p_evidence_class);
    return;
  end if;
  update public.organization_retention_policies set
    version = version + 1, requested_retention_days = p_requested_retention_days,
    effective_retention_days = greatest(p_requested_retention_days, effective_floor_days),
    updated_by = p_actor_user_id, updated_at = now()
  where organization_id = p_organization_id and evidence_class = p_evidence_class;
  insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'organization.retention_policy_updated',
    'organization_retention_policy', v_policy.id::text,
    jsonb_build_object(
      'evidenceClass', p_evidence_class,
      'before', jsonb_build_object('version', v_policy.version,
        'requestedRetentionDays', v_policy.requested_retention_days),
      'after', jsonb_build_object('version', v_policy.version + 1,
        'requestedRetentionDays', p_requested_retention_days)
    ));
  return query select 'updated'::text,
    public.m1_retention_policy_json(p_organization_id, p_evidence_class);
end;
$$;

create or replace function public.reconcile_organization_retention_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_authority_kind text,
  p_authority_available boolean,
  p_facts jsonb
)
  returns table (outcome text, policies jsonb)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_fact jsonb;
  v_class text;
  v_record_id uuid;
  v_days integer;
  v_protect_through timestamptz;
  v_policy public.organization_retention_policies%rowtype;
  v_snapshot_id uuid;
  v_reason_json jsonb;
  v_floor integer;
begin
  if p_authority_kind not in ('product','evidence_class','obligation','legal_hold')
     or jsonb_typeof(p_facts) <> 'array' then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  if not exists (select 1 from public.organization_members
    where organization_id = p_organization_id and user_id = p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  -- Validate the complete provider payload before changing authority state or
  -- facts so one malformed trailing record cannot leave a partial reconcile.
  for v_fact in select value from jsonb_array_elements(p_facts) loop
    begin
      v_class := v_fact->>'evidenceClass';
      v_record_id := (v_fact->>'recordId')::uuid;
      v_days := (v_fact->>'requiredRetentionDays')::integer;
      v_protect_through := nullif(v_fact->>'protectThrough', '')::timestamptz;
    exception when others then
      return query select 'invalid_request'::text, null::jsonb;
      return;
    end;
    if v_days not between 0 and 36500 or not exists (
      select 1 from public.organization_retention_policies
      where organization_id = p_organization_id and evidence_class = v_class
    ) then
      return query select 'invalid_request'::text, null::jsonb;
      return;
    end if;
  end loop;
  update public.retention_authority_states set
    available = p_authority_available, last_reconciled_at = now(),
    safe_error_code = case when p_authority_available then null else 'unavailable' end
  where organization_id = p_organization_id and authority_kind = p_authority_kind;
  if not p_authority_available then
    insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, changes)
    values (p_organization_id, p_actor_user_id, 'organization.retention_authority_unavailable',
      'retention_authority', p_authority_kind, jsonb_build_object('authorityKind', p_authority_kind));
    return query select 'unavailable'::text, null::jsonb;
    return;
  end if;

  for v_fact in select value from jsonb_array_elements(p_facts) loop
    begin
      v_class := v_fact->>'evidenceClass';
      v_record_id := (v_fact->>'recordId')::uuid;
      v_days := (v_fact->>'requiredRetentionDays')::integer;
      v_protect_through := nullif(v_fact->>'protectThrough', '')::timestamptz;
    exception when others then
      return query select 'invalid_request'::text, null::jsonb;
      return;
    end;
    if v_days not between 0 and 36500 or not exists (
      select 1 from public.organization_retention_policies
      where organization_id = p_organization_id and evidence_class = v_class
    ) then
      return query select 'invalid_request'::text, null::jsonb;
      return;
    end if;
    insert into public.retention_authoritative_facts (
      organization_id, evidence_class, reason_kind, source_record_id,
      required_retention_days, protect_through
    ) values (p_organization_id, v_class, p_authority_kind, v_record_id, v_days, v_protect_through)
    on conflict (organization_id, evidence_class, reason_kind, source_record_id) do update
      set required_retention_days = greatest(
            retention_authoritative_facts.required_retention_days,
            excluded.required_retention_days),
          protect_through = greatest(
            coalesce(retention_authoritative_facts.protect_through, '-infinity'),
            coalesce(excluded.protect_through, '-infinity')),
          active = true, last_observed_at = now();
    if v_protect_through is not null then
      insert into public.evidence_protection_watermarks (
        organization_id, evidence_class, protected_through
      ) values (p_organization_id, v_class, v_protect_through)
      on conflict (organization_id, evidence_class) do update
        set protected_through = greatest(
              evidence_protection_watermarks.protected_through,
              excluded.protected_through),
            updated_at = now();
    end if;
  end loop;

  for v_policy in select * from public.organization_retention_policies
    where organization_id = p_organization_id for update
  loop
    select coalesce(max(required_retention_days), 0),
      coalesce(jsonb_agg(jsonb_build_object(
        'kind', reason_kind, 'recordId', source_record_id,
        'requiredRetentionDays', required_retention_days,
        'protectThrough', protect_through
      ) order by reason_kind, source_record_id), '[]'::jsonb)
      into v_floor, v_reason_json
      from public.retention_authoritative_facts
      where organization_id = p_organization_id
        and evidence_class = v_policy.evidence_class and active;
    if v_floor <> v_policy.effective_floor_days or p_facts <> '[]'::jsonb then
      v_policy.floor_snapshot_version := v_policy.floor_snapshot_version + 1;
      insert into public.retention_floor_snapshots (
        organization_id, evidence_class, snapshot_version,
        effective_floor_days, reason_digest
      ) values (
        p_organization_id, v_policy.evidence_class, v_policy.floor_snapshot_version,
        v_floor, encode(extensions.digest(v_reason_json::text, 'sha256'), 'hex')
      ) returning id into v_snapshot_id;
      insert into public.retention_floor_reasons (
        snapshot_id, organization_id, evidence_class, reason_kind,
        source_record_id, required_retention_days, protect_through
      )
      select v_snapshot_id, p_organization_id, v_policy.evidence_class,
        f.reason_kind, f.source_record_id, f.required_retention_days, f.protect_through
      from public.retention_authoritative_facts f
      where f.organization_id = p_organization_id
        and f.evidence_class = v_policy.evidence_class and f.active
      order by f.reason_kind, f.source_record_id;
      update public.organization_retention_policies set
        version = version + 1, floor_snapshot_version = v_policy.floor_snapshot_version,
        effective_floor_days = v_floor,
        effective_retention_days = greatest(requested_retention_days, v_floor),
        updated_by = p_actor_user_id, updated_at = now()
      where id = v_policy.id;
    end if;
  end loop;
  insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'organization.retention_reconciled',
    'organization_retention_policy_set', p_organization_id::text,
    jsonb_build_object('authorityKind', p_authority_kind, 'factCount', jsonb_array_length(p_facts)));
  return query select 'reconciled'::text, coalesce(jsonb_agg(
    public.m1_retention_policy_json(p_organization_id, p.evidence_class)
    order by p.evidence_class), '[]'::jsonb)
  from public.organization_retention_policies p where p.organization_id = p_organization_id;
end;
$$;

create or replace function public.claim_retention_cleanup_atomic(
  p_organization_id uuid,
  p_lease_owner uuid,
  p_lease_seconds integer
)
  returns table (
    outcome text, cleanup_run_id uuid, lease_owner uuid,
    checkpoint_version integer, blocked_reasons jsonb
  )
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_run public.retention_cleanup_runs%rowtype;
  v_reasons jsonb;
begin
  if p_lease_seconds not between 1 and 3600 then
    return query select 'invalid_request'::text, null::uuid, null::uuid, null::integer, null::jsonb;
    return;
  end if;
  select * into v_run from public.retention_cleanup_runs
   where organization_id = p_organization_id
     and (
       (status in ('queued','retry') and available_at <= now())
       or (status = 'running' and lease_expires_at <= now())
     )
   order by created_at for update skip locked limit 1;
  if not found then
    return query select case when exists (select 1 from public.organizations where id = p_organization_id)
      then 'none_available' else 'not_found' end,
      null::uuid, null::uuid, null::integer, null::jsonb;
    return;
  end if;
  if exists (select 1 from public.retention_authority_states
    where organization_id = p_organization_id and not available) then
    v_reasons := coalesce((select jsonb_agg(jsonb_build_object(
      'kind', authority_kind, 'code', 'unavailable') order by authority_kind)
      from public.retention_authority_states
      where organization_id = p_organization_id and not available), '[]'::jsonb);
    update public.retention_cleanup_runs set status = 'retry', safe_error_code = 'unavailable',
      safe_diagnostics = jsonb_build_object('authorityRecheck', 'failed_closed'),
      blocked_reasons = v_reasons, attempt_count = attempt_count + 1,
      available_at = now() + interval '1 minute', updated_at = now()
    where id = v_run.id;
    insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
    values (p_organization_id, 'organization.retention_cleanup_unavailable',
      'retention_cleanup_run', v_run.id::text, jsonb_build_object('outcome', 'unavailable'));
    return query select 'unavailable'::text, v_run.id, null::uuid,
      v_run.checkpoint_version, v_reasons;
    return;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'kind', f.reason_kind, 'recordId', f.source_record_id,
    'requiredRetentionDays', f.required_retention_days,
    'protectThrough', f.protect_through
  ) order by f.reason_kind, f.source_record_id), '[]'::jsonb)
  into v_reasons
  from public.retention_authoritative_facts f
  where f.organization_id = p_organization_id
    and f.evidence_class = v_run.evidence_class and f.active
    and (f.reason_kind = 'legal_hold' or f.protect_through > now());
  if jsonb_array_length(v_reasons) > 0 then
    update public.retention_cleanup_runs set status = 'blocked',
      safe_error_code = 'retention_protected', blocked_reasons = v_reasons,
      updated_at = now() where id = v_run.id;
    insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
    values (p_organization_id, 'organization.retention_cleanup_blocked',
      'retention_cleanup_run', v_run.id::text,
      jsonb_build_object('reasonCount', jsonb_array_length(v_reasons)));
    return query select 'blocked'::text, v_run.id, null::uuid,
      v_run.checkpoint_version, v_reasons;
    return;
  end if;
  update public.retention_cleanup_runs set status = 'running',
    lease_owner = p_lease_owner, lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    attempt_count = attempt_count + 1, started_at = coalesce(started_at, now()),
    safe_error_code = null, safe_diagnostics = null, blocked_reasons = '[]', updated_at = now()
  where id = v_run.id;
  insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
  values (p_organization_id, 'organization.retention_cleanup_claimed',
    'retention_cleanup_run', v_run.id::text,
    jsonb_build_object('checkpointVersion', v_run.checkpoint_version));
  return query select 'claimed'::text, v_run.id, p_lease_owner,
    v_run.checkpoint_version, '[]'::jsonb;
end;
$$;

create or replace function public.complete_retention_cleanup_atomic(
  p_organization_id uuid,
  p_cleanup_run_id uuid,
  p_lease_owner uuid,
  p_expected_checkpoint_version integer,
  p_item_results jsonb
)
  returns table (outcome text, checkpoint_version integer)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_run public.retention_cleanup_runs%rowtype;
  v_result jsonb;
  v_item public.retention_cleanup_items%rowtype;
  v_current_watermark timestamptz;
  v_reasons jsonb;
begin
  select * into v_run from public.retention_cleanup_runs
  where id = p_cleanup_run_id and organization_id = p_organization_id for update;
  if not found then return query select 'not_found'::text, null::integer; return; end if;
  if v_run.status <> 'running' or v_run.lease_owner <> p_lease_owner
     or v_run.lease_expires_at <= now() or v_run.checkpoint_version <> p_expected_checkpoint_version then
    return query select 'conflict'::text, v_run.checkpoint_version; return;
  end if;
  if p_item_results is null or jsonb_typeof(p_item_results) <> 'array' then
    return query select 'invalid_request'::text, v_run.checkpoint_version; return;
  end if;
  if jsonb_array_length(p_item_results) <> (
      select count(*) from public.retention_cleanup_items
      where organization_id = p_organization_id and cleanup_run_id = p_cleanup_run_id
        and status = 'pending'
    )
    or jsonb_array_length(p_item_results) <> (
      select count(distinct value->>'itemId') from jsonb_array_elements(p_item_results)
    )
    or exists (
      select 1 from jsonb_array_elements(p_item_results) supplied(value)
      where jsonb_typeof(value) <> 'object'
        or value->>'itemId' is null
        or value->>'status' is null
        or value->>'status' not in ('deleted','skipped_protected','failed')
        or not exists (
          select 1 from public.retention_cleanup_items i
          where i.id::text = value->>'itemId'
            and i.organization_id = p_organization_id
            and i.cleanup_run_id = p_cleanup_run_id and i.status = 'pending'
        )
    )
    or exists (
      select 1 from public.retention_cleanup_items i
      where i.organization_id = p_organization_id
        and i.cleanup_run_id = p_cleanup_run_id and i.status = 'pending'
        and not exists (
          select 1 from jsonb_array_elements(p_item_results) supplied(value)
          where value->>'itemId' = i.id::text
        )
    ) then
    return query select 'invalid_request'::text, v_run.checkpoint_version; return;
  end if;
  -- The authoritative check is repeated in the completion transaction, after
  -- the worker has selected candidates and immediately before accepting delete.
  select coalesce(jsonb_agg(reason order by reason->>'kind', reason->>'recordId'), '[]'::jsonb)
    into v_reasons from (
      select jsonb_build_object('kind', s.authority_kind, 'code', 'unavailable') reason
      from public.retention_authority_states s
      where s.organization_id = p_organization_id and not s.available
      union all
      select jsonb_build_object('kind', f.reason_kind, 'recordId', f.source_record_id,
        'requiredRetentionDays', f.required_retention_days,
        'protectThrough', f.protect_through)
      from public.retention_authoritative_facts f
      where f.organization_id = p_organization_id
        and f.evidence_class = v_run.evidence_class and f.active
        and (f.reason_kind = 'legal_hold' or f.protect_through > now())
    ) controlling;
  if jsonb_array_length(v_reasons) > 0 then
    update public.retention_cleanup_runs set status = 'blocked',
      safe_error_code = 'retention_protected', lease_owner = null, lease_expires_at = null,
      blocked_reasons = v_reasons,
      updated_at = now() where id = v_run.id;
    insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
    values (p_organization_id, 'organization.retention_cleanup_blocked',
      'retention_cleanup_run', v_run.id::text,
      jsonb_build_object('phase', 'final_completion_recheck',
        'reasonCount', jsonb_array_length(v_reasons)));
    return query select 'blocked'::text, v_run.checkpoint_version; return;
  end if;
  select protected_through into v_current_watermark
    from public.evidence_protection_watermarks
   where organization_id = p_organization_id and evidence_class = v_run.evidence_class;
  for v_result in select value from jsonb_array_elements(p_item_results) loop
    begin
      select * into strict v_item from public.retention_cleanup_items
       where id = (v_result->>'itemId')::uuid
         and organization_id = p_organization_id
         and cleanup_run_id = p_cleanup_run_id and status = 'pending'
       for update;
    exception when others then
      return query select 'invalid_request'::text, v_run.checkpoint_version; return;
    end;
    if v_result->>'status' not in ('deleted','skipped_protected','failed') then
      return query select 'invalid_request'::text, v_run.checkpoint_version; return;
    end if;
    if v_result->>'status' = 'deleted' and (
      v_item.protection_watermark < v_current_watermark
      or v_item.observed_at > now() - make_interval(days => (
        select effective_retention_days from public.organization_retention_policies
         where organization_id = p_organization_id and evidence_class = v_run.evidence_class
      ))
    ) then
      update public.retention_cleanup_runs set status = 'blocked',
        safe_error_code = 'retention_protected', lease_owner = null,
        lease_expires_at = null, blocked_reasons = jsonb_build_array(jsonb_build_object(
          'kind', 'evidence_watermark', 'recordId', v_item.source_record_id)),
        updated_at = now() where id = v_run.id;
      insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
      values (p_organization_id, 'organization.retention_cleanup_blocked',
        'retention_cleanup_run', v_run.id::text,
        jsonb_build_object('phase', 'final_completion_recheck', 'reasonCount', 1));
      return query select 'blocked'::text, v_run.checkpoint_version; return;
    end if;
  end loop;
  for v_result in select value from jsonb_array_elements(p_item_results) loop
    update public.retention_cleanup_items set
      status = v_result->>'status',
      safe_error_code = nullif(v_result->>'safeErrorCode', ''),
      attempt_count = attempt_count + 1, updated_at = now()
    where id = (v_result->>'itemId')::uuid
      and organization_id = p_organization_id and cleanup_run_id = p_cleanup_run_id;
  end loop;
  update public.retention_cleanup_runs r set status = 'completed',
    checkpoint_version = r.checkpoint_version + 1, completed_at = now(),
    lease_owner = null, lease_expires_at = null, updated_at = now()
  where id = v_run.id;
  if exists (select 1 from public.retention_cleanup_items
    where organization_id = p_organization_id and cleanup_run_id = p_cleanup_run_id
      and status = 'pending') then
    raise exception 'cleanup completion left pending items' using errcode = 'check_violation';
  end if;
  insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
  values (p_organization_id, 'organization.retention_cleanup_completed',
    'retention_cleanup_run', v_run.id::text,
    jsonb_build_object('checkpointVersion', v_run.checkpoint_version + 1,
      'itemCount', jsonb_array_length(p_item_results)));
  return query select 'completed'::text, v_run.checkpoint_version + 1;
end;
$$;

create or replace function public.fail_retention_cleanup_atomic(
  p_organization_id uuid,
  p_cleanup_run_id uuid,
  p_lease_owner uuid,
  p_expected_checkpoint_version integer,
  p_safe_error_code text,
  p_retryable boolean,
  p_safe_diagnostics jsonb default null
)
  returns table (outcome text, status text)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare v_run public.retention_cleanup_runs%rowtype; v_status text;
begin
  select * into v_run from public.retention_cleanup_runs
  where id = p_cleanup_run_id and organization_id = p_organization_id for update;
  if not found then return query select 'not_found'::text, null::text; return; end if;
  if v_run.status <> 'running' or v_run.lease_owner <> p_lease_owner
     or v_run.lease_expires_at <= now()
     or v_run.checkpoint_version <> p_expected_checkpoint_version then
    return query select 'conflict'::text, v_run.status; return;
  end if;
  if p_safe_error_code is null or length(p_safe_error_code) > 64
     or (p_safe_diagnostics is not null and jsonb_typeof(p_safe_diagnostics) <> 'object') then
    return query select 'invalid_request'::text, v_run.status; return;
  end if;
  v_status := case when p_retryable and v_run.attempt_count < v_run.max_attempts
    then 'retry' else 'dead_letter' end;
  update public.retention_cleanup_runs set status = v_status,
    safe_error_code = p_safe_error_code, safe_diagnostics = p_safe_diagnostics,
    available_at = now() + interval '1 minute', lease_owner = null,
    lease_expires_at = null, updated_at = now() where id = v_run.id;
  insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
  values (p_organization_id, 'organization.retention_cleanup_failed',
    'retention_cleanup_run', v_run.id::text,
    jsonb_build_object('status', v_status, 'safeErrorCode', p_safe_error_code));
  return query select 'recorded'::text, v_status;
end;
$$;

create or replace function public.request_organization_export_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key uuid,
  p_request_digest text,
  p_correlation_id text default null
)
  returns table (outcome text, export_job_id uuid, export_job jsonb, idempotent boolean)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare v_existing public.organization_export_idempotencies%rowtype; v_job_id uuid;
begin
  if p_request_digest !~ '^[0-9a-f]{64}$' or length(coalesce(p_correlation_id, '')) > 128 then
    return query select 'invalid_request'::text, null::uuid, null::jsonb, false; return;
  end if;
  select * into v_existing from public.organization_export_idempotencies
  where actor_user_id = p_actor_user_id and idempotency_key = p_idempotency_key for update;
  if found then
    if v_existing.organization_id = p_organization_id
       and v_existing.request_digest = p_request_digest then
      return query select 'replayed'::text, v_existing.export_job_id,
        (select jsonb_build_object('id', j.id, 'status', j.status,
          'completedParts', j.completed_parts, 'totalParts', j.total_parts,
          'checkpointVersion', j.checkpoint_version)
         from public.organization_export_jobs j where j.id = v_existing.export_job_id), true;
    else
      return query select 'idempotency_mismatch'::text, null::uuid, null::jsonb, false;
    end if;
    return;
  end if;
  if not exists (select 1 from public.organization_members m
    join public.organization_lifecycles l on l.organization_id = m.organization_id
    where m.organization_id = p_organization_id and m.user_id = p_actor_user_id
      and l.status = 'active') then
    return query select 'not_found'::text, null::uuid, null::jsonb, false; return;
  end if;
  insert into public.organization_export_jobs (
    organization_id, actor_user_id, correlation_id, request_digest
  ) values (p_organization_id, p_actor_user_id, p_correlation_id, p_request_digest)
  returning id into v_job_id;
  insert into public.organization_export_idempotencies (
    actor_user_id, idempotency_key, organization_id, request_digest, export_job_id
  ) values (p_actor_user_id, p_idempotency_key, p_organization_id, p_request_digest, v_job_id);
  insert into public.organization_export_snapshots (
    organization_id, export_job_id, snapshot_version, source_ids
  ) select p_organization_id, v_job_id, 1, array_agg(source_id order by sort_order)
      from public.organization_export_sources where enabled;
  insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'organization.export_requested',
    'organization_export_job', v_job_id::text,
    jsonb_build_object('correlationPresent', p_correlation_id is not null));
  return query select 'created'::text, v_job_id,
    jsonb_build_object('id', v_job_id, 'status', 'queued',
      'completedParts', 0, 'totalParts', 0, 'checkpointVersion', 0), false;
end;
$$;

create or replace function public.claim_organization_export_atomic(
  p_organization_id uuid,
  p_lease_owner uuid,
  p_lease_seconds integer
)
  returns table (
    outcome text, export_job_id uuid, lease_owner uuid,
    checkpoint_version integer, snapshot jsonb
  )
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare v_job public.organization_export_jobs%rowtype;
begin
  if p_lease_seconds not between 1 and 3600 then
    return query select 'invalid_request'::text, null::uuid, null::uuid, null::integer, null::jsonb; return;
  end if;
  if not exists (select 1 from public.organization_lifecycles
    where organization_id = p_organization_id and status = 'active') then
    return query select case when exists (select 1 from public.organizations where id = p_organization_id)
      then 'invalid_state' else 'not_found' end,
      null::uuid, null::uuid, null::integer, null::jsonb; return;
  end if;
  select * into v_job from public.organization_export_jobs
   where organization_id = p_organization_id
     and status in ('queued','running') and available_at <= now()
     and (status = 'queued' or lease_expires_at <= now())
   order by created_at for update skip locked limit 1;
  if not found then
    return query select 'none_available'::text, null::uuid, null::uuid, null::integer, null::jsonb; return;
  end if;
  update public.organization_export_jobs set status = 'running',
    lease_owner = p_lease_owner, lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    attempt_count = attempt_count + 1, updated_at = now()
  where id = v_job.id;
  insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
  values (p_organization_id, 'organization.export_claimed', 'organization_export_job',
    v_job.id::text, jsonb_build_object('checkpointVersion', v_job.checkpoint_version));
  return query select 'claimed'::text, v_job.id, p_lease_owner, v_job.checkpoint_version,
    (select jsonb_build_object('snapshotVersion', s.snapshot_version, 'sourceIds', s.source_ids)
       from public.organization_export_snapshots s
      where s.organization_id = p_organization_id and s.export_job_id = v_job.id
      order by snapshot_version desc limit 1);
end;
$$;

create or replace function public.checkpoint_organization_export_atomic(
  p_organization_id uuid,
  p_export_job_id uuid,
  p_lease_owner uuid,
  p_expected_checkpoint_version integer,
  p_completed_parts integer,
  p_total_parts integer,
  p_parts jsonb
)
  returns table (outcome text, checkpoint_version integer)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_job public.organization_export_jobs%rowtype;
  v_part jsonb;
  v_predicted_count integer;
begin
  select * into v_job from public.organization_export_jobs
   where id = p_export_job_id and organization_id = p_organization_id for update;
  if not found then return query select 'not_found'::text, null::integer; return; end if;
  if v_job.status <> 'running' or v_job.lease_owner <> p_lease_owner
     or v_job.lease_expires_at <= now() or v_job.checkpoint_version <> p_expected_checkpoint_version then
    return query select 'conflict'::text, v_job.checkpoint_version; return;
  end if;
  if p_parts is null or jsonb_typeof(p_parts) <> 'array'
     or p_total_parts <= 0 or p_completed_parts < v_job.completed_parts
     or p_total_parts < p_completed_parts
     or jsonb_array_length(p_parts) <> (
       select count(distinct (value->>'sourceId', value->>'partNumber'))
       from jsonb_array_elements(p_parts)
     ) then
    return query select 'invalid_request'::text, v_job.checkpoint_version; return;
  end if;
  for v_part in select value from jsonb_array_elements(p_parts) loop
    begin
      if jsonb_typeof(v_part) <> 'object'
         or not exists (select 1 from public.organization_export_sources
           where source_id = v_part->>'sourceId' and enabled)
         or (v_part->>'sha256') !~ '^[0-9a-f]{64}$'
         or coalesce((v_part->>'partNumber')::integer, 0) <= 0
         or coalesce((v_part->>'byteSize')::bigint, -1) < 0
         or (v_part->>'objectPath') !~ ('^' || p_organization_id::text || '/') then
        return query select 'invalid_request'::text, v_job.checkpoint_version; return;
      end if;
    exception when others then
      return query select 'invalid_request'::text, v_job.checkpoint_version; return;
    end;
  end loop;
  select count(*) into v_predicted_count from (
    select source_id, part_number
    from public.organization_export_parts
    where organization_id = p_organization_id and export_job_id = p_export_job_id
    union
    select value->>'sourceId', (value->>'partNumber')::integer
    from jsonb_array_elements(p_parts)
  ) ledger;
  if v_predicted_count <> p_completed_parts then
    return query select 'invalid_request'::text, v_job.checkpoint_version; return;
  end if;
  for v_part in select value from jsonb_array_elements(p_parts) loop
    insert into public.organization_export_parts (
      organization_id, export_job_id, source_id, part_number, object_path, sha256, byte_size
    ) values (p_organization_id, p_export_job_id, v_part->>'sourceId',
      (v_part->>'partNumber')::integer, v_part->>'objectPath', v_part->>'sha256',
      (v_part->>'byteSize')::bigint)
    on conflict (organization_id, export_job_id, source_id, part_number) do update
      set object_path = excluded.object_path, sha256 = excluded.sha256,
          byte_size = excluded.byte_size;
  end loop;
  update public.organization_export_jobs j set completed_parts = p_completed_parts,
    total_parts = p_total_parts, checkpoint_version = j.checkpoint_version + 1,
    updated_at = now() where id = p_export_job_id;
  insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
  values (p_organization_id, 'organization.export_checkpointed',
    'organization_export_job', p_export_job_id::text,
    jsonb_build_object('checkpointVersion', v_job.checkpoint_version + 1,
      'completedParts', p_completed_parts, 'totalParts', p_total_parts));
  return query select 'checkpointed'::text, v_job.checkpoint_version + 1;
end;
$$;

create or replace function public.complete_organization_export_atomic(
  p_organization_id uuid,
  p_export_job_id uuid,
  p_lease_owner uuid,
  p_expected_checkpoint_version integer,
  p_manifest_file_count integer,
  p_manifest_sha256 text,
  p_artifact_sha256 text,
  p_artifact_object_path text default null
)
  returns table (outcome text, export_job jsonb)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare v_job public.organization_export_jobs%rowtype; v_actual_count integer;
begin
  select * into v_job from public.organization_export_jobs
   where id = p_export_job_id and organization_id = p_organization_id for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_job.status <> 'running' or v_job.lease_owner <> p_lease_owner
     or v_job.lease_expires_at <= now() or v_job.checkpoint_version <> p_expected_checkpoint_version then
    return query select 'conflict'::text, null::jsonb; return;
  end if;
  select count(*) into v_actual_count from public.organization_export_parts
    where organization_id = p_organization_id and export_job_id = p_export_job_id;
  if p_manifest_sha256 !~ '^[0-9a-f]{64}$' or p_artifact_sha256 !~ '^[0-9a-f]{64}$'
     or v_actual_count <= 0
     or p_manifest_file_count <> v_actual_count
     or v_actual_count <> v_job.completed_parts
     or v_job.completed_parts <> v_job.total_parts
     or p_artifact_object_path is not null
        and p_artifact_object_path !~ ('^' || p_organization_id::text || '/') then
    update public.organization_export_jobs set status = 'failed',
      safe_error_code = 'verification_failed',
      safe_diagnostics = jsonb_build_object('verification', 'failed_closed'),
      lease_owner = null, lease_expires_at = null, updated_at = now()
    where id = p_export_job_id;
    insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
    values (p_organization_id, 'organization.export_verification_failed',
      'organization_export_job', p_export_job_id::text,
      jsonb_build_object('safeErrorCode', 'verification_failed'));
    return query select 'verification_failed'::text,
      jsonb_build_object('id', p_export_job_id, 'status', 'failed',
        'errorCode', 'verification_failed');
    return;
  end if;
  update public.organization_export_jobs set status = 'completed',
    manifest_format_version = 1, manifest_sha256 = p_manifest_sha256,
    artifact_sha256 = p_artifact_sha256, artifact_object_path = p_artifact_object_path,
    manifest_file_count = p_manifest_file_count, verified_at = now(),
    safe_error_code = null, safe_diagnostics = null,
    lease_owner = null, lease_expires_at = null, updated_at = now()
  where id = p_export_job_id;
  insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
  values (p_organization_id, 'organization.export_completed', 'organization_export_job',
    p_export_job_id::text, jsonb_build_object('formatVersion', 1,
      'fileCount', p_manifest_file_count, 'verified', true));
  return query select 'completed'::text,
    jsonb_build_object('id', p_export_job_id, 'status', 'completed',
      'manifest', jsonb_build_object('formatVersion', 1, 'sha256', p_manifest_sha256,
        'fileCount', p_manifest_file_count, 'verifiedAt', now()));
end;
$$;

create or replace function public.fail_organization_export_atomic(
  p_organization_id uuid,
  p_export_job_id uuid,
  p_lease_owner uuid,
  p_expected_checkpoint_version integer,
  p_safe_error_code text,
  p_retryable boolean,
  p_pause boolean default false,
  p_safe_diagnostics jsonb default null
)
  returns table (outcome text, status text)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare v_job public.organization_export_jobs%rowtype; v_status text;
begin
  select * into v_job from public.organization_export_jobs
   where id = p_export_job_id and organization_id = p_organization_id for update;
  if not found then return query select 'not_found'::text, null::text; return; end if;
  if v_job.status <> 'running' or v_job.lease_owner <> p_lease_owner
     or v_job.lease_expires_at <= now()
     or v_job.checkpoint_version <> p_expected_checkpoint_version then
    return query select 'conflict'::text, v_job.status; return;
  end if;
  if p_safe_error_code is null or length(p_safe_error_code) > 64
     or (p_safe_diagnostics is not null and jsonb_typeof(p_safe_diagnostics) <> 'object') then
    return query select 'invalid_request'::text, v_job.status; return;
  end if;
  v_status := case when p_pause then 'paused'
    when p_retryable and v_job.attempt_count < v_job.max_attempts then 'queued'
    when p_retryable then 'dead_letter' else 'failed' end;
  update public.organization_export_jobs set status = v_status,
    safe_error_code = p_safe_error_code, safe_diagnostics = p_safe_diagnostics,
    available_at = now() + interval '1 minute', lease_owner = null,
    lease_expires_at = null, updated_at = now() where id = p_export_job_id;
  insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
  values (p_organization_id, 'organization.export_failed', 'organization_export_job',
    p_export_job_id::text, jsonb_build_object('status', v_status,
      'safeErrorCode', p_safe_error_code));
  return query select 'recorded'::text, v_status;
end;
$$;

create or replace function public.register_organization_session_atomic(
  p_organization_id uuid,
  p_user_id uuid,
  p_session_id uuid,
  p_issued_at timestamptz
)
  returns table (outcome text)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.organization_members
    where organization_id = p_organization_id and user_id = p_user_id) then
    return query select 'not_found'::text; return;
  end if;
  insert into public.organization_session_bindings (
    organization_id, session_id, user_id, issued_at
  ) values (p_organization_id, p_session_id, p_user_id, p_issued_at)
  on conflict (organization_id, session_id) do update
    set user_id = excluded.user_id, issued_at = excluded.issued_at, last_seen_at = now();
  return query select 'registered'::text;
end;
$$;

create or replace function public.create_destructive_reauth_grant_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_session_id uuid,
  p_lifecycle_version integer,
  p_expires_at timestamptz
)
  returns table (outcome text, grant_id uuid, expires_at timestamptz)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  -- Password/MFA verification remains an API-owned port. This RPC persists only
  -- the successful, short-lived proof binding and never receives a secret.
  if p_expires_at <= now() or p_expires_at > now() + interval '15 minutes'
     or not exists (select 1 from public.organization_members m
       join public.organization_lifecycles l on l.organization_id = m.organization_id
       where m.organization_id = p_organization_id and m.user_id = p_actor_user_id
         and m.role = 'owner' and l.version = p_lifecycle_version)
     or not exists (select 1 from public.organization_session_bindings
       where organization_id = p_organization_id and user_id = p_actor_user_id
         and session_id = p_session_id) then
    return query select 'not_found'::text, null::uuid, null::timestamptz; return;
  end if;
  insert into public.destructive_reauth_grants (
    organization_id, actor_user_id, session_id, lifecycle_version, expires_at
  ) values (p_organization_id, p_actor_user_id, p_session_id,
    p_lifecycle_version, p_expires_at) returning id into v_id;
  insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'organization.destructive_reauth_granted',
    'destructive_reauth_grant', v_id::text,
    jsonb_build_object('lifecycleVersion', p_lifecycle_version,
      'expiresAt', p_expires_at));
  return query select 'created'::text, v_id, p_expires_at;
end;
$$;

create or replace function public.consume_destructive_reauth_grant_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_session_id uuid,
  p_grant_id uuid,
  p_lifecycle_version integer,
  p_consumed_for text
)
  returns boolean
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if p_consumed_for not in ('deactivate','schedule_purge','recover') then return false; end if;
  update public.destructive_reauth_grants set consumed_at = now(), consumed_for = p_consumed_for
   where id = p_grant_id and organization_id = p_organization_id
     and actor_user_id = p_actor_user_id and session_id = p_session_id
     and lifecycle_version = p_lifecycle_version and expires_at > now()
     and consumed_at is null;
  return found;
end;
$$;

-- Lifecycle state is an API-facing durable projection. Normalize worker and
-- unavailable integration state here so callers never receive provider names,
-- raw worker diagnostics, or an array that violates the strict wire schema.
create or replace function public.m1_normalize_lifecycle_blockers(p_reasons jsonb)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  with raw as (
    select value
    from jsonb_array_elements(coalesce(p_reasons, '[]'::jsonb))
  ), normalized as (
    select jsonb_build_object(
      'kind', 'unavailable', 'code', 'dependency_unavailable'
    ) as blocker
    where exists (
      select 1
      from raw
      where value->>'code' = 'unavailable'
         or (
           value->>'kind' = 'unavailable'
           and value->>'code' = 'dependency_unavailable'
         )
    )

    union all

    select jsonb_build_object(
      'kind', 'worker_failure', 'code', 'worker_failure'
    ) as blocker
    where exists (select 1 from raw where value->>'kind' = 'worker_failure')

    union all

    select jsonb_build_object(
      'kind', value->>'kind',
      'recordId', value->>'recordId',
      'requiredRetentionDays', (value->>'requiredRetentionDays')::integer
    ) as blocker
    from raw
    where value->>'kind' in ('product', 'evidence_class', 'obligation', 'legal_hold')
      and value->>'recordId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and value->>'requiredRetentionDays' ~ '^[0-9]+$'
  )
  select coalesce(jsonb_agg(distinct blocker order by blocker), '[]'::jsonb)
  from normalized;
$$;

create or replace function public.m1_organization_lifecycle_json(p_organization_id uuid)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'status', l.status,
    'version', l.version,
    'changedAt', l.changed_at,
    'blockers', public.m1_normalize_lifecycle_blockers(l.purge_block_reasons),
    'error', case
      when l.status <> 'purge_blocked' then null
      when public.m1_normalize_lifecycle_blockers(l.purge_block_reasons)
        @> jsonb_build_array(jsonb_build_object(
          'kind', 'unavailable', 'code', 'dependency_unavailable'
        ))
      then jsonb_build_object(
        'code', 'unavailable',
        'message', 'Organization administration request could not be completed.'
      )
      else jsonb_build_object(
        'code', 'invalid_state',
        'message', 'Organization administration request could not be completed.'
      )
    end
  )
  from public.organization_lifecycles l
  where l.organization_id = p_organization_id;
$$;

create or replace function public.get_organization_lifecycle(p_organization_id uuid)
  returns table (outcome text, lifecycle jsonb)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.organization_lifecycles where organization_id = p_organization_id) then
    return query select 'not_found'::text, null::jsonb;
  else
    return query select 'found'::text, public.m1_organization_lifecycle_json(p_organization_id);
  end if;
end;
$$;

create or replace function public.deactivate_organization_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_session_id uuid,
  p_reauth_grant_id uuid,
  p_expected_version integer,
  p_confirmation text
)
  returns table (outcome text, lifecycle jsonb)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare v_lifecycle public.organization_lifecycles%rowtype;
begin
  select * into v_lifecycle from public.organization_lifecycles
   where organization_id = p_organization_id for update;
  if not found or not exists (select 1 from public.organization_members
    where organization_id = p_organization_id and user_id = p_actor_user_id and role = 'owner') then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  -- Check the grant before version/state so a replay does not become a version oracle.
  if not public.consume_destructive_reauth_grant_atomic(p_organization_id,
    p_actor_user_id, p_session_id, p_reauth_grant_id, p_expected_version, 'deactivate') then
    return query select 'invalid_grant'::text, null::jsonb; return;
  end if;
  if p_confirmation <> 'DEACTIVATE ORGANIZATION' then
    raise exception 'invalid confirmation' using errcode = '22023';
  end if;
  if v_lifecycle.version <> p_expected_version then
    raise exception 'stale lifecycle version' using errcode = '40001';
  end if;
  if v_lifecycle.status <> 'active' then
    raise exception 'invalid lifecycle state' using errcode = '55000';
  end if;
  update public.organization_lifecycles set status = 'deactivated',
    version = version + 1, changed_at = now(), changed_by = p_actor_user_id,
    deactivated_at = now(), purge_after = null, purge_block_reasons = '[]',
    safe_error_code = null, updated_at = now()
   where organization_id = p_organization_id;
  update public.organizations set is_active = false where id = p_organization_id;
  update public.organization_export_jobs set status = 'paused',
    safe_error_code = 'organization_deactivated', lease_owner = null,
    lease_expires_at = null, updated_at = now()
   where organization_id = p_organization_id and status in ('queued','running');
  insert into public.organization_session_revocations (
    organization_id, session_id, user_id, reason, lifecycle_version
  )
  select b.organization_id, b.session_id, b.user_id, 'organization_deactivated',
    v_lifecycle.version + 1
  from public.organization_session_bindings b
  join public.organization_members m on m.organization_id = b.organization_id
    and m.user_id = b.user_id
  where b.organization_id = p_organization_id
  on conflict (organization_id, session_id) do update set
    reason = excluded.reason, lifecycle_version = excluded.lifecycle_version,
    revoked_at = excluded.revoked_at;
  insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'organization.deactivated',
    'organization_lifecycle', p_organization_id::text,
    jsonb_build_object('beforeStatus', 'active', 'afterStatus', 'deactivated',
      'beforeVersion', v_lifecycle.version, 'afterVersion', v_lifecycle.version + 1));
  return query select 'deactivated'::text,
    public.m1_organization_lifecycle_json(p_organization_id);
exception when sqlstate '22023' then
  return query select 'invalid_request'::text, null::jsonb;
when sqlstate '40001' then
  return query select 'conflict'::text, null::jsonb;
when sqlstate '55000' then
  return query select 'invalid_state'::text, null::jsonb;
end;
$$;

create or replace function public.recover_organization_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_session_id uuid,
  p_reauth_grant_id uuid,
  p_expected_version integer
)
  returns table (outcome text, lifecycle jsonb)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare v_lifecycle public.organization_lifecycles%rowtype;
begin
  select * into v_lifecycle from public.organization_lifecycles
   where organization_id = p_organization_id for update;
  if not found or not exists (select 1 from public.organization_members
    where organization_id = p_organization_id and user_id = p_actor_user_id and role = 'owner') then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  if not public.consume_destructive_reauth_grant_atomic(p_organization_id,
    p_actor_user_id, p_session_id, p_reauth_grant_id, p_expected_version, 'recover') then
    return query select 'invalid_grant'::text, null::jsonb; return;
  end if;
  if v_lifecycle.version <> p_expected_version then
    raise exception 'stale lifecycle version' using errcode = '40001';
  end if;
  if v_lifecycle.status not in ('deactivated','purge_scheduled','purge_blocked') then
    raise exception 'invalid lifecycle state' using errcode = '55000';
  end if;
  update public.organization_lifecycles set status = 'active', version = version + 1,
    changed_at = now(), changed_by = p_actor_user_id, purge_after = null,
    purge_block_reasons = '[]', safe_error_code = null, updated_at = now()
  where organization_id = p_organization_id;
  update public.organizations set is_active = true where id = p_organization_id;
  update public.organization_export_jobs set status = 'queued', safe_error_code = null,
    available_at = now(), updated_at = now()
  where organization_id = p_organization_id and status = 'paused';
  delete from public.organization_purge_jobs where organization_id = p_organization_id;
  insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'organization.recovered',
    'organization_lifecycle', p_organization_id::text,
    jsonb_build_object('beforeStatus', v_lifecycle.status, 'afterStatus', 'active',
      'beforeVersion', v_lifecycle.version, 'afterVersion', v_lifecycle.version + 1));
  return query select 'recovered'::text,
    public.m1_organization_lifecycle_json(p_organization_id);
exception when sqlstate '40001' then return query select 'conflict'::text, null::jsonb;
when sqlstate '55000' then return query select 'invalid_state'::text, null::jsonb;
end;
$$;

create or replace function public.schedule_organization_purge_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_session_id uuid,
  p_reauth_grant_id uuid,
  p_expected_version integer,
  p_confirmation text
)
  returns table (outcome text, purge_job_id uuid, lifecycle jsonb)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare v_lifecycle public.organization_lifecycles%rowtype; v_slug text; v_job uuid; v_purge_after timestamptz;
begin
  select * into v_lifecycle from public.organization_lifecycles
   where organization_id = p_organization_id for update;
  select slug into v_slug from public.organizations where id = p_organization_id;
  if not found or not exists (select 1 from public.organization_members
    where organization_id = p_organization_id and user_id = p_actor_user_id and role = 'owner') then
    return query select 'not_found'::text, null::uuid, null::jsonb; return;
  end if;
  if not public.consume_destructive_reauth_grant_atomic(p_organization_id,
    p_actor_user_id, p_session_id, p_reauth_grant_id, p_expected_version, 'schedule_purge') then
    return query select 'invalid_grant'::text, null::uuid, null::jsonb; return;
  end if;
  if p_confirmation <> 'DELETE ' || v_slug then
    raise exception 'invalid confirmation' using errcode = '22023';
  end if;
  if v_lifecycle.version <> p_expected_version then
    raise exception 'stale lifecycle version' using errcode = '40001';
  end if;
  if v_lifecycle.status <> 'deactivated' then
    raise exception 'invalid lifecycle state' using errcode = '55000';
  end if;
  v_purge_after := now() + interval '30 days';
  update public.organization_lifecycles set status = 'purge_scheduled',
    version = version + 1, changed_at = now(), changed_by = p_actor_user_id,
    purge_after = v_purge_after, purge_block_reasons = '[]',
    safe_error_code = null, updated_at = now()
  where organization_id = p_organization_id;
  insert into public.organization_purge_jobs (
    organization_id, requested_by, lifecycle_version, purge_after, available_at
  ) values (p_organization_id, p_actor_user_id, v_lifecycle.version + 1,
    v_purge_after, v_purge_after) returning id into v_job;
  insert into public.organization_purge_work_items (
    organization_id, purge_job_id, work_kind
  ) values (p_organization_id, v_job, 'final_eligibility'),
           (p_organization_id, v_job, 'artifact_inventory'),
           (p_organization_id, v_job, 'database_delete');
  insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'organization.purge_scheduled',
    'organization_purge_job', v_job::text,
    jsonb_build_object('purgeAfter', v_purge_after,
      'lifecycleVersion', v_lifecycle.version + 1));
  return query select 'scheduled'::text, v_job,
    public.m1_organization_lifecycle_json(p_organization_id);
exception when unique_violation then
  return query select 'conflict'::text, null::uuid, null::jsonb;
when sqlstate '22023' then return query select 'invalid_request'::text, null::uuid, null::jsonb;
when sqlstate '40001' then return query select 'conflict'::text, null::uuid, null::jsonb;
when sqlstate '55000' then return query select 'invalid_state'::text, null::uuid, null::jsonb;
end;
$$;

create or replace function public.claim_organization_purge_atomic(
  p_organization_id uuid,
  p_lease_owner uuid,
  p_lease_seconds integer
)
  returns table (
    outcome text, purge_job_id uuid, lease_owner uuid,
    checkpoint_version integer, blocked_reasons jsonb
  )
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare v_job public.organization_purge_jobs%rowtype; v_lifecycle public.organization_lifecycles%rowtype; v_reasons jsonb;
begin
  if p_lease_seconds not between 1 and 3600 then
    return query select 'invalid_request'::text, null::uuid, null::uuid, null::integer, null::jsonb; return;
  end if;
  select * into v_lifecycle from public.organization_lifecycles
    where organization_id = p_organization_id for update;
  if not found then
    return query select 'not_found'::text, null::uuid, null::uuid, null::integer, null::jsonb; return;
  end if;
  select * into v_job from public.organization_purge_jobs
   where organization_id = p_organization_id
     and status in ('scheduled','retry','running')
     and purge_after <= now() and available_at <= now()
     and (status <> 'running' or lease_expires_at <= now())
   for update skip locked;
  if not found then
    return query select 'none_available'::text, null::uuid, null::uuid, null::integer, null::jsonb; return;
  end if;
  select coalesce(jsonb_agg(reason order by reason->>'kind', reason->>'recordId'), '[]'::jsonb)
    into v_reasons from (
      select jsonb_build_object('kind', s.authority_kind, 'code', 'unavailable') reason
      from public.retention_authority_states s
      where s.organization_id = p_organization_id and not s.available
      union all
      select jsonb_build_object('kind', f.reason_kind, 'recordId', f.source_record_id,
        'requiredRetentionDays', f.required_retention_days,
        'protectThrough', f.protect_through)
      from public.retention_authoritative_facts f
      where f.organization_id = p_organization_id and f.active
        and (f.reason_kind = 'legal_hold' or f.protect_through > now())
    ) controlling;
  if jsonb_array_length(v_reasons) > 0 then
    update public.organization_purge_jobs set status = 'blocked',
      safe_error_code = 'retention_protected', blocked_reasons = v_reasons,
      updated_at = now() where id = v_job.id;
    update public.organization_lifecycles set status = 'purge_blocked',
      version = version + 1, changed_at = now(),
      purge_block_reasons = public.m1_normalize_lifecycle_blockers(v_reasons),
      safe_error_code = case when public.m1_normalize_lifecycle_blockers(v_reasons)
        @> jsonb_build_array(jsonb_build_object(
          'kind', 'unavailable', 'code', 'dependency_unavailable'
        )) then 'unavailable' else 'invalid_state' end,
      updated_at = now()
    where organization_id = p_organization_id;
    insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
    values (p_organization_id, 'organization.purge_blocked', 'organization_purge_job',
      v_job.id::text, jsonb_build_object('reasonCount', jsonb_array_length(v_reasons)));
    return query select 'blocked'::text, v_job.id, null::uuid,
      v_job.checkpoint_version, v_reasons; return;
  end if;
  if v_lifecycle.status not in ('purge_scheduled','purging') then
    return query select 'invalid_state'::text, v_job.id, null::uuid,
      v_job.checkpoint_version, '[]'::jsonb; return;
  end if;
  update public.organization_purge_jobs set status = 'running',
    lease_owner = p_lease_owner, lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    attempt_count = attempt_count + 1, updated_at = now() where id = v_job.id;
  update public.organization_lifecycles set status = 'purging',
    version = case when status = 'purging' then version else version + 1 end,
    changed_at = case when status = 'purging' then changed_at else now() end,
    purge_block_reasons = '[]', safe_error_code = null, updated_at = now()
  where organization_id = p_organization_id;
  update public.organization_purge_work_items w set status = 'completed',
    checkpoint_version = w.checkpoint_version + 1, updated_at = now()
  where w.organization_id = p_organization_id and w.purge_job_id = v_job.id
    and w.work_kind = 'final_eligibility';
  insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
  values (p_organization_id, 'organization.purge_claimed', 'organization_purge_job',
    v_job.id::text, jsonb_build_object('checkpointVersion', v_job.checkpoint_version));
  return query select 'claimed'::text, v_job.id, p_lease_owner,
    v_job.checkpoint_version, '[]'::jsonb;
end;
$$;

create or replace function public.complete_organization_purge_atomic(
  p_organization_id uuid,
  p_purge_job_id uuid,
  p_lease_owner uuid,
  p_expected_checkpoint_version integer
)
  returns table (outcome text, deletion_proof_id uuid)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_job public.organization_purge_jobs%rowtype;
  v_lifecycle public.organization_lifecycles%rowtype;
  v_slug text;
  v_proof uuid;
  v_reasons jsonb;
begin
  select * into v_job from public.organization_purge_jobs
   where id = p_purge_job_id and organization_id = p_organization_id for update;
  if not found then return query select 'not_found'::text, null::uuid; return; end if;
  select * into v_lifecycle from public.organization_lifecycles
   where organization_id = p_organization_id for update;
  select slug into v_slug from public.organizations where id = p_organization_id;
  if v_job.status <> 'running' or v_job.lease_owner <> p_lease_owner
     or v_job.lease_expires_at <= now()
     or v_job.checkpoint_version <> p_expected_checkpoint_version
     or v_lifecycle.status <> 'purging' then
    return query select 'conflict'::text, null::uuid; return;
  end if;
  -- Final, same-transaction authority check. Any missing authority or newly
  -- observed hold aborts deletion and retains every controlling reason.
  select coalesce(jsonb_agg(reason order by reason->>'kind', reason->>'recordId'), '[]'::jsonb)
    into v_reasons from (
      select jsonb_build_object('kind', s.authority_kind, 'code', 'unavailable') reason
      from public.retention_authority_states s
      where s.organization_id = p_organization_id and not s.available
      union all
      select jsonb_build_object('kind', f.reason_kind, 'recordId', f.source_record_id,
        'requiredRetentionDays', f.required_retention_days,
        'protectThrough', f.protect_through)
      from public.retention_authoritative_facts f
      where f.organization_id = p_organization_id and f.active
        and (f.reason_kind = 'legal_hold' or f.protect_through > now())
    ) controlling;
  if jsonb_array_length(v_reasons) > 0 then
    update public.organization_purge_jobs set status = 'blocked',
      safe_error_code = 'retention_protected', blocked_reasons = v_reasons,
      lease_owner = null, lease_expires_at = null, updated_at = now()
    where id = p_purge_job_id and organization_id = p_organization_id;
    update public.organization_lifecycles set status = 'purge_blocked',
      version = version + 1, changed_at = now(),
      purge_block_reasons = public.m1_normalize_lifecycle_blockers(v_reasons),
      safe_error_code = case when public.m1_normalize_lifecycle_blockers(v_reasons)
        @> jsonb_build_array(jsonb_build_object(
          'kind', 'unavailable', 'code', 'dependency_unavailable'
        )) then 'unavailable' else 'invalid_state' end,
      updated_at = now()
    where organization_id = p_organization_id and status = 'purging';
    insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
    values (p_organization_id, 'organization.purge_blocked', 'organization_purge_job',
      p_purge_job_id::text, jsonb_build_object(
        'phase', 'final_completion_recheck',
        'reasonCount', jsonb_array_length(v_reasons)));
    return query select 'blocked'::text, null::uuid; return;
  end if;
  insert into public.organization_deletion_proofs (
    deleted_organization_id, organization_slug_digest, purge_job_id,
    lifecycle_version, database_deleted_at
  ) values (
    p_organization_id, encode(extensions.digest(v_slug, 'sha256'), 'hex'),
    p_purge_job_id, v_lifecycle.version, now()
  ) returning id into v_proof;
  insert into public.organization_deletion_artifact_work (
    deletion_proof_id, bucket_id, object_prefix
  ) values (v_proof, 'tenant-exports', p_organization_id::text || '/');
  update public.organization_purge_work_items w set status = 'completed',
    checkpoint_version = w.checkpoint_version + 1, updated_at = now()
  where organization_id = p_organization_id and purge_job_id = p_purge_job_id
    and work_kind in ('artifact_inventory','database_delete');
  insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
  values (p_organization_id, 'organization.purged', 'organization_deletion_proof',
    v_proof::text, jsonb_build_object('lifecycleVersion', v_lifecycle.version));
  -- Cascades remove tenant rows, including the old tenant audit stream and job.
  -- The proof/artifact work above has no tenant FK and survives this statement.
  delete from public.organizations where id = p_organization_id;
  return query select 'purged'::text, v_proof;
end;
$$;

create or replace function public.fail_organization_purge_atomic(
  p_organization_id uuid,
  p_purge_job_id uuid,
  p_lease_owner uuid,
  p_expected_checkpoint_version integer,
  p_safe_error_code text,
  p_retryable boolean,
  p_safe_diagnostics jsonb default null
)
  returns table (outcome text, status text)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare v_job public.organization_purge_jobs%rowtype; v_status text;
begin
  select * into v_job from public.organization_purge_jobs
   where id = p_purge_job_id and organization_id = p_organization_id for update;
  if not found then return query select 'not_found'::text, null::text; return; end if;
  if v_job.status <> 'running' or v_job.lease_owner <> p_lease_owner
     or v_job.lease_expires_at <= now()
     or v_job.checkpoint_version <> p_expected_checkpoint_version then
    return query select 'conflict'::text, v_job.status; return;
  end if;
  if p_safe_error_code is null or length(p_safe_error_code) > 64
     or (p_safe_diagnostics is not null and jsonb_typeof(p_safe_diagnostics) <> 'object') then
    return query select 'invalid_request'::text, v_job.status; return;
  end if;
  v_status := case when p_retryable and v_job.attempt_count < v_job.max_attempts
    then 'retry' else 'dead_letter' end;
  update public.organization_purge_jobs set status = v_status,
    safe_error_code = p_safe_error_code, safe_diagnostics = p_safe_diagnostics,
    available_at = now() + interval '1 minute', lease_owner = null,
    lease_expires_at = null, updated_at = now() where id = p_purge_job_id;
  if v_status = 'dead_letter' then
    update public.organization_lifecycles l set status = 'purge_blocked',
      version = l.version + 1, changed_at = now(), safe_error_code = 'invalid_state',
      purge_block_reasons = jsonb_build_array(jsonb_build_object(
        'kind', 'worker_failure', 'code', 'worker_failure')),
      updated_at = now()
    where l.organization_id = p_organization_id and l.status = 'purging';
  end if;
  insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
  values (p_organization_id, 'organization.purge_failed', 'organization_purge_job',
    p_purge_job_id::text, jsonb_build_object('status', v_status,
      'safeErrorCode', p_safe_error_code));
  return query select 'recorded'::text, v_status;
end;
$$;

create index organization_deletion_artifact_work_proof_idx
  on public.organization_deletion_artifact_work (deletion_proof_id);

-- Defence in depth: RLS is enabled but intentionally not forced so postgres-
-- owned SECURITY DEFINER functions can execute. Browser roles have no table
-- access; service_role remains subject to organization-first repository/RPC
-- checks because its JWT bypasses RLS.
alter table public.tenant_settings_catalog enable row level security;
alter table public.retention_evidence_classes enable row level security;
alter table public.organization_settings enable row level security;
alter table public.organization_lifecycles enable row level security;
alter table public.organization_retention_policies enable row level security;
alter table public.retention_authority_states enable row level security;
alter table public.retention_authoritative_facts enable row level security;
alter table public.retention_floor_snapshots enable row level security;
alter table public.retention_floor_reasons enable row level security;
alter table public.evidence_protection_watermarks enable row level security;
alter table public.retention_cleanup_runs enable row level security;
alter table public.retention_cleanup_items enable row level security;
alter table public.organization_export_sources enable row level security;
alter table public.organization_export_jobs enable row level security;
alter table public.organization_export_idempotencies enable row level security;
alter table public.organization_export_snapshots enable row level security;
alter table public.organization_export_parts enable row level security;
alter table public.organization_session_bindings enable row level security;
alter table public.organization_session_revocations enable row level security;
alter table public.destructive_reauth_grants enable row level security;
alter table public.organization_purge_jobs enable row level security;
alter table public.organization_purge_work_items enable row level security;
alter table public.organization_deletion_proofs enable row level security;
alter table public.organization_deletion_artifact_work enable row level security;

grant all on table public.tenant_settings_catalog to service_role;
grant all on table public.retention_evidence_classes to service_role;
grant all on table public.organization_settings to service_role;
grant all on table public.organization_lifecycles to service_role;
grant all on table public.organization_retention_policies to service_role;
grant all on table public.retention_authority_states to service_role;
grant all on table public.retention_authoritative_facts to service_role;
grant all on table public.retention_floor_snapshots to service_role;
grant all on table public.retention_floor_reasons to service_role;
grant all on table public.evidence_protection_watermarks to service_role;
grant all on table public.retention_cleanup_runs to service_role;
grant all on table public.retention_cleanup_items to service_role;
grant all on table public.organization_export_sources to service_role;
grant all on table public.organization_export_jobs to service_role;
grant all on table public.organization_export_idempotencies to service_role;
grant all on table public.organization_export_snapshots to service_role;
grant all on table public.organization_export_parts to service_role;
grant all on table public.organization_session_bindings to service_role;
grant all on table public.organization_session_revocations to service_role;
grant all on table public.destructive_reauth_grants to service_role;
grant all on table public.organization_purge_jobs to service_role;
grant all on table public.organization_purge_work_items to service_role;
grant all on table public.organization_deletion_proofs to service_role;
grant all on table public.organization_deletion_artifact_work to service_role;

revoke all on table public.tenant_settings_catalog from public, anon, authenticated;
revoke all on table public.retention_evidence_classes from public, anon, authenticated;
revoke all on table public.organization_settings from public, anon, authenticated;
revoke all on table public.organization_lifecycles from public, anon, authenticated;
revoke all on table public.organization_retention_policies from public, anon, authenticated;
revoke all on table public.retention_authority_states from public, anon, authenticated;
revoke all on table public.retention_authoritative_facts from public, anon, authenticated;
revoke all on table public.retention_floor_snapshots from public, anon, authenticated;
revoke all on table public.retention_floor_reasons from public, anon, authenticated;
revoke all on table public.evidence_protection_watermarks from public, anon, authenticated;
revoke all on table public.retention_cleanup_runs from public, anon, authenticated;
revoke all on table public.retention_cleanup_items from public, anon, authenticated;
revoke all on table public.organization_export_sources from public, anon, authenticated;
revoke all on table public.organization_export_jobs from public, anon, authenticated;
revoke all on table public.organization_export_idempotencies from public, anon, authenticated;
revoke all on table public.organization_export_snapshots from public, anon, authenticated;
revoke all on table public.organization_export_parts from public, anon, authenticated;
revoke all on table public.organization_session_bindings from public, anon, authenticated;
revoke all on table public.organization_session_revocations from public, anon, authenticated;
revoke all on table public.destructive_reauth_grants from public, anon, authenticated;
revoke all on table public.organization_purge_jobs from public, anon, authenticated;
revoke all on table public.organization_purge_work_items from public, anon, authenticated;
revoke all on table public.organization_deletion_proofs from public, anon, authenticated;
revoke all on table public.organization_deletion_artifact_work from public, anon, authenticated;

alter function public.m1_settings_json(uuid) owner to postgres;
alter function public.m1_retention_policy_json(uuid, text) owner to postgres;
alter function public.m1_normalize_lifecycle_blockers(jsonb) owner to postgres;
alter function public.m1_organization_lifecycle_json(uuid) owner to postgres;
alter function public.get_organization_settings_catalog(uuid) owner to postgres;
alter function public.get_organization_settings(uuid) owner to postgres;
alter function public.get_organization_lifecycle(uuid) owner to postgres;
alter function public.update_organization_settings_atomic(uuid, uuid, integer, text, text[], date[], text[], date, integer, text, text, uuid) owner to postgres;
alter function public.get_organization_retention_policies(uuid) owner to postgres;
alter function public.update_organization_retention_policy_atomic(uuid, uuid, text, integer, integer) owner to postgres;
alter function public.reconcile_organization_retention_atomic(uuid, uuid, text, boolean, jsonb) owner to postgres;
alter function public.claim_retention_cleanup_atomic(uuid, uuid, integer) owner to postgres;
alter function public.complete_retention_cleanup_atomic(uuid, uuid, uuid, integer, jsonb) owner to postgres;
alter function public.fail_retention_cleanup_atomic(uuid, uuid, uuid, integer, text, boolean, jsonb) owner to postgres;
alter function public.request_organization_export_atomic(uuid, uuid, uuid, text, text) owner to postgres;
alter function public.claim_organization_export_atomic(uuid, uuid, integer) owner to postgres;
alter function public.checkpoint_organization_export_atomic(uuid, uuid, uuid, integer, integer, integer, jsonb) owner to postgres;
alter function public.complete_organization_export_atomic(uuid, uuid, uuid, integer, integer, text, text, text) owner to postgres;
alter function public.fail_organization_export_atomic(uuid, uuid, uuid, integer, text, boolean, boolean, jsonb) owner to postgres;
alter function public.register_organization_session_atomic(uuid, uuid, uuid, timestamptz) owner to postgres;
alter function public.create_destructive_reauth_grant_atomic(uuid, uuid, uuid, integer, timestamptz) owner to postgres;
alter function public.consume_destructive_reauth_grant_atomic(uuid, uuid, uuid, uuid, integer, text) owner to postgres;
alter function public.deactivate_organization_atomic(uuid, uuid, uuid, uuid, integer, text) owner to postgres;
alter function public.recover_organization_atomic(uuid, uuid, uuid, uuid, integer) owner to postgres;
alter function public.schedule_organization_purge_atomic(uuid, uuid, uuid, uuid, integer, text) owner to postgres;
alter function public.claim_organization_purge_atomic(uuid, uuid, integer) owner to postgres;
alter function public.complete_organization_purge_atomic(uuid, uuid, uuid, integer) owner to postgres;
alter function public.fail_organization_purge_atomic(uuid, uuid, uuid, integer, text, boolean, jsonb) owner to postgres;

revoke all on function public.m1_settings_json(uuid) from public, anon, authenticated;
revoke all on function public.m1_retention_policy_json(uuid, text) from public, anon, authenticated;
revoke all on function public.m1_normalize_lifecycle_blockers(jsonb) from public, anon, authenticated;
revoke all on function public.m1_organization_lifecycle_json(uuid) from public, anon, authenticated;
revoke all on function public.get_organization_settings_catalog(uuid) from public, anon, authenticated;
revoke all on function public.get_organization_settings(uuid) from public, anon, authenticated;
revoke all on function public.get_organization_lifecycle(uuid) from public, anon, authenticated;
revoke all on function public.update_organization_settings_atomic(uuid, uuid, integer, text, text[], date[], text[], date, integer, text, text, uuid) from public, anon, authenticated;
revoke all on function public.get_organization_retention_policies(uuid) from public, anon, authenticated;
revoke all on function public.update_organization_retention_policy_atomic(uuid, uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public.reconcile_organization_retention_atomic(uuid, uuid, text, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.claim_retention_cleanup_atomic(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.complete_retention_cleanup_atomic(uuid, uuid, uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function public.fail_retention_cleanup_atomic(uuid, uuid, uuid, integer, text, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.request_organization_export_atomic(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.claim_organization_export_atomic(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.checkpoint_organization_export_atomic(uuid, uuid, uuid, integer, integer, integer, jsonb) from public, anon, authenticated;
revoke all on function public.complete_organization_export_atomic(uuid, uuid, uuid, integer, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.fail_organization_export_atomic(uuid, uuid, uuid, integer, text, boolean, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.register_organization_session_atomic(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.create_destructive_reauth_grant_atomic(uuid, uuid, uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.consume_destructive_reauth_grant_atomic(uuid, uuid, uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.deactivate_organization_atomic(uuid, uuid, uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.recover_organization_atomic(uuid, uuid, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.schedule_organization_purge_atomic(uuid, uuid, uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.claim_organization_purge_atomic(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.complete_organization_purge_atomic(uuid, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.fail_organization_purge_atomic(uuid, uuid, uuid, integer, text, boolean, jsonb) from public, anon, authenticated;

grant execute on function public.get_organization_settings_catalog(uuid) to service_role;
grant execute on function public.get_organization_settings(uuid) to service_role;
grant execute on function public.get_organization_lifecycle(uuid) to service_role;
grant execute on function public.update_organization_settings_atomic(uuid, uuid, integer, text, text[], date[], text[], date, integer, text, text, uuid) to service_role;
grant execute on function public.get_organization_retention_policies(uuid) to service_role;
grant execute on function public.update_organization_retention_policy_atomic(uuid, uuid, text, integer, integer) to service_role;
grant execute on function public.reconcile_organization_retention_atomic(uuid, uuid, text, boolean, jsonb) to service_role;
grant execute on function public.claim_retention_cleanup_atomic(uuid, uuid, integer) to service_role;
grant execute on function public.complete_retention_cleanup_atomic(uuid, uuid, uuid, integer, jsonb) to service_role;
grant execute on function public.fail_retention_cleanup_atomic(uuid, uuid, uuid, integer, text, boolean, jsonb) to service_role;
grant execute on function public.request_organization_export_atomic(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.claim_organization_export_atomic(uuid, uuid, integer) to service_role;
grant execute on function public.checkpoint_organization_export_atomic(uuid, uuid, uuid, integer, integer, integer, jsonb) to service_role;
grant execute on function public.complete_organization_export_atomic(uuid, uuid, uuid, integer, integer, text, text, text) to service_role;
grant execute on function public.fail_organization_export_atomic(uuid, uuid, uuid, integer, text, boolean, boolean, jsonb) to service_role;
grant execute on function public.register_organization_session_atomic(uuid, uuid, uuid, timestamptz) to service_role;
grant execute on function public.create_destructive_reauth_grant_atomic(uuid, uuid, uuid, integer, timestamptz) to service_role;
grant execute on function public.consume_destructive_reauth_grant_atomic(uuid, uuid, uuid, uuid, integer, text) to service_role;
grant execute on function public.deactivate_organization_atomic(uuid, uuid, uuid, uuid, integer, text) to service_role;
grant execute on function public.recover_organization_atomic(uuid, uuid, uuid, uuid, integer) to service_role;
grant execute on function public.schedule_organization_purge_atomic(uuid, uuid, uuid, uuid, integer, text) to service_role;
grant execute on function public.claim_organization_purge_atomic(uuid, uuid, integer) to service_role;
grant execute on function public.complete_organization_purge_atomic(uuid, uuid, uuid, integer) to service_role;
grant execute on function public.fail_organization_purge_atomic(uuid, uuid, uuid, integer, text, boolean, jsonb) to service_role;
