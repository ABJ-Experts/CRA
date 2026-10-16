-- M2 V2 PLM/ALM product-structure synchronization foundation (FR-PROD-012).
-- Vendor-neutral connector framework: connectors, per-field system-of-record
-- authority policy, tenant-scoped external identity mapping, and a durable
-- dry-run/commit/conflict sync-run engine. No vendor SDK, no real vendor
-- adapter -- only the reference conformance adapter proves the contract
-- (built in the application layer, not here). Every product/release mutation
-- this migration's commit path performs goes through the EXISTING atomic
-- RPCs (create_product_atomic, update_product_atomic, etc.) -- no new
-- mutation logic is invented, only sync-specific orchestration around them.

-- =============================================================================
-- 1. connectors
-- =============================================================================

create table public.connectors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connector_type text not null check (connector_type in ('reference_conformance')),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 200),
  adapter_version text not null check (adapter_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  mapping_version text not null check (char_length(btrim(mapping_version)) between 1 and 100),
  connection_config jsonb not null default '{}'::jsonb
    check (jsonb_typeof(connection_config) = 'object'
      and connection_config::text !~* '"[^"]*(password|secret|token|api[_-]?key|private[_-]?key)[^"]*"\s*:'),
  secret_ref uuid,
  commit_policy text not null default 'manual' check (commit_policy in ('manual', 'auto')),
  enabled boolean not null default true,
  last_tested_at timestamptz,
  last_test_outcome text check (last_test_outcome is null or last_test_outcome in ('success', 'failure')),
  last_test_error_code text check (last_test_error_code is null or last_test_error_code ~ '^[a-z0-9_]{1,120}$'),
  archived_at timestamptz,
  archived_by uuid references public.users(id) on delete restrict,
  archived_reason text,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.users(id) on delete restrict,
  unique (organization_id, id),
  constraint connectors_archive_pair_check check (
    (archived_at is null and archived_by is null and archived_reason is null)
    or (archived_at is not null and archived_by is not null
      and char_length(btrim(archived_reason)) between 1 and 500)
  )
);
create index connectors_org_enabled_idx on public.connectors(organization_id, enabled) where archived_at is null;

-- =============================================================================
-- 2. connector_secrets -- encrypted at rest, no read path in any API response.
--    Keyed from a server-held env secret, mirroring the COOKIE_SIGNING_SECRET
--    HMAC-key-from-env convention already used for signed cookies. No new
--    external secrets-manager dependency.
-- =============================================================================

create table public.connector_secrets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connector_id uuid not null,
  ciphertext bytea not null,
  rotated_at timestamptz not null default now(),
  rotated_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, connector_id) references public.connectors(organization_id, id) on delete cascade
);

alter table public.connectors
  add constraint connectors_secret_ref_fkey
  -- Same composite-NOT-NULL-column hazard as sync_connector_cursors below;
  -- no RPC ever deletes an individual connector_secrets row.
  foreign key (organization_id, secret_ref) references public.connector_secrets(organization_id, id) on delete no action deferrable initially deferred;

-- =============================================================================
-- 3. product_external_identities -- tenant + connector scoped mapping,
--    supersession chain (never rewritten in place, mirrors
--    product_substantial_modification_assessments).
-- =============================================================================

create table public.product_external_identities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connector_id uuid not null,
  entity_type text not null check (entity_type in ('product', 'release')),
  external_id text not null check (char_length(btrim(external_id)) between 1 and 500),
  external_id_normalized text generated always as (
    lower(regexp_replace(normalize(external_id, nfkc), '\s+', '', 'g'))
  ) stored,
  external_display_label text check (external_display_label is null or char_length(btrim(external_display_label)) between 1 and 500),
  cra_product_id uuid not null,
  cra_release_id uuid,
  match_method text not null check (match_method in (
    'exact_normalized_code', 'exact_normalized_release_version', 'manual_link', 'manual_merge', 'adapter_asserted_id'
  )),
  match_confidence text not null check (match_confidence in ('certain', 'ambiguous_resolved')),
  linked_at timestamptz not null default now(),
  linked_by uuid not null references public.users(id) on delete restrict,
  unlinked_at timestamptz,
  unlinked_by uuid references public.users(id) on delete restrict,
  unlink_reason text,
  supersedes_id uuid,
  superseded_at timestamptz,
  superseded_by_id uuid,
  supersession_reason text,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.users(id) on delete restrict,
  unique (organization_id, id),
  foreign key (organization_id, connector_id) references public.connectors(organization_id, id) on delete restrict,
  foreign key (organization_id, cra_product_id) references public.products(organization_id, id) on delete restrict,
  constraint product_external_identity_release_fkey
    foreign key (organization_id, cra_product_id, cra_release_id)
    references public.product_releases(organization_id, product_id, id) on delete restrict,
  foreign key (organization_id, supersedes_id) references public.product_external_identities(organization_id, id) on delete restrict,
  foreign key (organization_id, superseded_by_id) references public.product_external_identities(organization_id, id) on delete restrict,
  constraint product_external_identity_entity_pair_check check (
    (entity_type = 'product' and cra_release_id is null) or (entity_type = 'release' and cra_release_id is not null)
  ),
  constraint product_external_identity_unlink_pair_check check (
    (unlinked_at is null and unlinked_by is null and unlink_reason is null)
    or (unlinked_at is not null and unlinked_by is not null and char_length(btrim(unlink_reason)) between 1 and 500)
  ),
  constraint product_external_identity_supersession_pair_check check (
    (superseded_at is null and superseded_by_id is null and supersession_reason is null)
    or (superseded_at is not null and superseded_by_id is not null and char_length(btrim(supersession_reason)) between 1 and 500)
  ),
  constraint product_external_identity_no_self_supersede_check check (supersedes_id is distinct from id and superseded_by_id is distinct from id)
);
create unique index product_external_identities_active_key
  on public.product_external_identities(organization_id, connector_id, entity_type, external_id_normalized)
  where superseded_at is null and unlinked_at is null;
create index product_external_identities_cra_idx
  on public.product_external_identities(organization_id, cra_product_id, cra_release_id)
  where superseded_at is null and unlinked_at is null;

-- =============================================================================
-- 4. field_authority_policies -- per-field system of record, versioned via
--    the same supersession-chain pattern.
-- =============================================================================

create or replace function public.m2_v2_valid_field_authority_field(p_entity_type text, p_field_name text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select case p_entity_type
    when 'product' then p_field_name in ('name', 'internalCode', 'productType', 'description')
    when 'release' then p_field_name in ('label', 'releaseVersion', 'description')
    else false
  end
$$;

create table public.field_authority_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connector_id uuid not null,
  entity_type text not null check (entity_type in ('product', 'release')),
  field_name text not null,
  policy_value text not null check (policy_value in (
    'external_authoritative', 'cra_authoritative', 'newest_with_review', 'manual_only'
  )),
  protected boolean not null default false,
  protected_reason text,
  policy_version integer not null default 1 check (policy_version > 0),
  effective_from timestamptz not null default now(),
  supersedes_id uuid,
  superseded_at timestamptz,
  superseded_by_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.users(id) on delete restrict,
  unique (organization_id, id),
  foreign key (organization_id, connector_id) references public.connectors(organization_id, id) on delete restrict,
  foreign key (organization_id, supersedes_id) references public.field_authority_policies(organization_id, id) on delete restrict,
  foreign key (organization_id, superseded_by_id) references public.field_authority_policies(organization_id, id) on delete restrict,
  constraint field_authority_policy_field_check check (public.m2_v2_valid_field_authority_field(entity_type, field_name)),
  constraint field_authority_policy_protected_reason_check check (
    (protected = false and protected_reason is null) or (protected = true and char_length(btrim(protected_reason)) between 1 and 500)
  ),
  constraint field_authority_policy_protected_never_external_check check (protected = false or policy_value <> 'external_authoritative')
);
create unique index field_authority_policies_active_key
  on public.field_authority_policies(organization_id, connector_id, entity_type, field_name)
  where superseded_at is null;

-- =============================================================================
-- 5. sync_runs -- the durable queue AND the run record in one row.
-- =============================================================================

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connector_id uuid not null,
  reconciliation_kind text not null check (reconciliation_kind in ('incremental', 'full')),
  work_kind text not null default 'dry_run' check (work_kind in ('dry_run', 'commit')),
  status text not null default 'queued' check (status in (
    'queued', 'running', 'waiting_for_review', 'retrying', 'failed', 'canceled', 'completed'
  )),
  actor_kind text not null check (actor_kind in ('user', 'system_schedule')),
  actor_user_id uuid references public.users(id) on delete restrict,
  trigger_idempotency_key uuid not null,
  trigger_request_digest text not null check (trigger_request_digest ~ '^[a-f0-9]{64}$'),
  commit_idempotency_key uuid,
  commit_actor_user_id uuid references public.users(id) on delete restrict,
  commit_request_digest text check (commit_request_digest is null or commit_request_digest ~ '^[a-f0-9]{64}$'),
  adapter_version text not null,
  mapping_version text not null,
  cursor_from text,
  cursor_to text,
  fetch_content_hash text check (fetch_content_hash is null or fetch_content_hash ~ '^[a-f0-9]{64}$'),
  plan_basis_digest text check (plan_basis_digest is null or plan_basis_digest ~ '^[a-f0-9]{64}$'),
  row_count integer not null default 0 check (row_count >= 0),
  processed_count integer not null default 0 check (processed_count >= 0),
  checkpoint_cursor text,
  create_count integer not null default 0 check (create_count >= 0),
  update_count integer not null default 0 check (update_count >= 0),
  unchanged_count integer not null default 0 check (unchanged_count >= 0),
  skip_count integer not null default 0 check (skip_count >= 0),
  conflict_count integer not null default 0 check (conflict_count >= 0),
  tombstone_count integer not null default 0 check (tombstone_count >= 0),
  cycle_blocked_count integer not null default 0 check (cycle_blocked_count >= 0),
  estimated_graph_impact jsonb not null default '{}'::jsonb check (jsonb_typeof(estimated_graph_impact) = 'object'),
  retry_count integer not null default 0 check (retry_count between 0 and 5),
  next_attempt_at timestamptz not null default now(),
  lease_owner text check (lease_owner is null or char_length(btrim(lease_owner)) between 1 and 100),
  lease_expires_at timestamptz,
  error_code text check (error_code is null or error_code ~ '^[a-z0-9_]{1,120}$'),
  correlation_id uuid not null,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  committed_at timestamptz,
  canceled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, connector_id) references public.connectors(organization_id, id) on delete restrict,
  constraint sync_run_lease_check check ((lease_owner is null) = (lease_expires_at is null)),
  constraint sync_run_commit_identity_check check (
    (commit_idempotency_key is null) = (commit_request_digest is null)
    and (commit_actor_user_id is null) = (commit_idempotency_key is null)
  ),
  constraint sync_run_actor_check check ((actor_kind = 'user') = (actor_user_id is not null)),
  constraint sync_run_terminal_time_check check (
    (status = 'completed') = (committed_at is not null)
    and (status = 'canceled') = (canceled_at is not null)
  ),
  constraint sync_run_cancellation_reason_check check (
    (canceled_at is null and cancellation_reason is null)
    or (canceled_at is not null and char_length(btrim(cancellation_reason)) between 1 and 500)
  ),
  constraint sync_run_count_bounds_check check (
    create_count + update_count + unchanged_count + skip_count + conflict_count <= row_count
  )
);
create unique index sync_runs_connector_exclusive_idx
  on public.sync_runs(organization_id, connector_id)
  where status in ('queued', 'running', 'waiting_for_review', 'retrying');
create index sync_runs_claim_idx
  on public.sync_runs(organization_id, next_attempt_at, created_at, id)
  where status in ('queued', 'retrying');
create unique index sync_runs_trigger_idempotency_key
  on public.sync_runs(organization_id, actor_user_id, trigger_idempotency_key) where actor_user_id is not null;
create index sync_runs_history_idx on public.sync_runs(organization_id, connector_id, created_at desc, id desc);

create or replace function public.enforce_sync_run_status_transition()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = old.status then return new; end if;
  if not (
    (old.status = 'queued' and new.status in ('running', 'canceled'))
    or (old.status = 'running' and new.status in ('waiting_for_review', 'queued', 'completed', 'retrying', 'failed', 'canceled'))
    or (old.status = 'waiting_for_review' and new.status in ('queued', 'canceled'))
    or (old.status = 'retrying' and new.status in ('running', 'canceled'))
  ) then
    raise exception using errcode = '23514', message = 'invalid sync run status transition';
  end if;
  return new;
end;
$$;
create trigger sync_runs_enforce_status_transition
  before update of status on public.sync_runs
  for each row execute function public.enforce_sync_run_status_transition();
create trigger sync_runs_set_updated_at before update on public.sync_runs
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 6. sync_run_plan_items -- the persisted dry-run plan. Commit REPLAYS these,
--    never recomputes the diff.
-- =============================================================================

create table public.sync_run_plan_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sync_run_id uuid not null,
  external_id text not null,
  entity_type text not null check (entity_type in ('product', 'release')),
  proposed_action text not null check (proposed_action in (
    'create', 'update', 'unchanged', 'archive', 'conflict', 'ambiguous_match',
    'pending_required_fields', 'rejected', 'skipped_tombstone'
  )),
  field_diffs jsonb not null default '{}'::jsonb check (jsonb_typeof(field_diffs) = 'object'),
  issues jsonb not null default '[]'::jsonb check (jsonb_typeof(issues) = 'array'),
  cra_product_id uuid,
  cra_release_id uuid,
  expected_version integer,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, sync_run_id) references public.sync_runs(organization_id, id) on delete cascade
);
create index sync_run_plan_items_run_idx on public.sync_run_plan_items(organization_id, sync_run_id, proposed_action);

-- =============================================================================
-- 7. sync_conflicts
-- =============================================================================

create table public.sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connector_id uuid not null,
  sync_run_id uuid not null,
  external_identity_id uuid not null,
  entity_type text not null check (entity_type in ('product', 'release', 'baseline', 'relationship')),
  entity_id uuid,
  field_path text not null check (char_length(btrim(field_path)) between 1 and 200),
  conflict_kind text not null default 'field_value' check (conflict_kind in (
    'field_value', 'deletion_vs_active_use', 'cycle', 'duplicate_identity'
  )),
  cra_value jsonb not null,
  cra_value_source text not null check (cra_value_source in ('cra_manual_entry', 'prior_sync_apply')),
  cra_value_observed_at timestamptz not null,
  external_value jsonb not null,
  external_value_hash text not null check (external_value_hash ~ '^[a-f0-9]{64}$'),
  external_value_observed_at timestamptz not null,
  detected_at timestamptz not null default now(),
  authority_policy_id uuid,
  authority_policy_snapshot jsonb not null check (jsonb_typeof(authority_policy_snapshot) = 'object'),
  permitted_actions text[] not null default array['accept_external', 'keep_cra', 'enter_manual_value'],
  resolution_status text not null default 'open' check (resolution_status in ('open', 'resolved', 'superseded')),
  resolution_chosen_action text check (resolution_chosen_action is null or resolution_chosen_action = any (permitted_actions)),
  resolution_value jsonb,
  resolution_reason text,
  resolved_by uuid references public.users(id) on delete restrict,
  resolved_at timestamptz,
  resolved_against_external_value_hash text check (resolved_against_external_value_hash is null or resolved_against_external_value_hash ~ '^[a-f0-9]{64}$'),
  supersedes_conflict_id uuid,
  version integer not null default 1 check (version > 0),
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, connector_id) references public.connectors(organization_id, id) on delete restrict,
  foreign key (organization_id, sync_run_id) references public.sync_runs(organization_id, id) on delete restrict,
  foreign key (organization_id, external_identity_id) references public.product_external_identities(organization_id, id) on delete restrict,
  foreign key (organization_id, authority_policy_id) references public.field_authority_policies(organization_id, id) on delete restrict,
  foreign key (organization_id, supersedes_conflict_id) references public.sync_conflicts(organization_id, id) on delete restrict,
  constraint sync_conflict_resolution_pair_check check (
    (resolution_status = 'open' and resolution_chosen_action is null and resolved_by is null and resolved_at is null)
    or (resolution_status in ('resolved', 'superseded') and resolution_chosen_action is not null
      and resolved_by is not null and resolved_at is not null and char_length(btrim(resolution_reason)) between 1 and 1000)
  )
);
create unique index sync_conflicts_open_key
  on public.sync_conflicts(organization_id, external_identity_id, field_path) where resolution_status = 'open';
create index sync_conflicts_run_idx on public.sync_conflicts(organization_id, sync_run_id);

-- =============================================================================
-- 8. sync_connector_cursors -- durable current position, one row per connector.
-- =============================================================================

create table public.sync_connector_cursors (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connector_id uuid not null,
  cursor text,
  cursor_issued_at timestamptz,
  last_committed_run_id uuid,
  last_committed_at timestamptz,
  last_full_reconciliation_at timestamptz,
  consecutive_failure_count integer not null default 0 check (consecutive_failure_count >= 0),
  circuit_state text not null default 'closed' check (circuit_state in ('closed', 'open', 'half_open')),
  circuit_opened_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (organization_id, connector_id),
  foreign key (organization_id, connector_id) references public.connectors(organization_id, id) on delete cascade,
  -- SET NULL is unsafe on a composite FK sharing the NOT NULL organization_id
  -- column (Postgres nulls the whole key together). No RPC ever deletes an
  -- individual sync_runs row; only a whole-tenant purge does, and that
  -- already deletes both tables via their own direct FKs to organizations --
  -- deferred keeps ordering-agnostic within that single cascading statement.
  foreign key (organization_id, last_committed_run_id) references public.sync_runs(organization_id, id) on delete no action deferrable initially deferred
);

create trigger connectors_set_updated_at before update on public.connectors
  for each row execute function public.set_updated_at();
create trigger product_external_identities_set_updated_at before update on public.product_external_identities
  for each row execute function public.set_updated_at();
create trigger field_authority_policies_set_updated_at before update on public.field_authority_policies
  for each row execute function public.set_updated_at();
create trigger sync_conflicts_set_updated_at before update on public.sync_conflicts
  for each row execute function public.set_updated_at();
create trigger sync_connector_cursors_set_updated_at before update on public.sync_connector_cursors
  for each row execute function public.set_updated_at();

-- =============================================================================
-- RLS + grants
-- =============================================================================

alter table public.connectors enable row level security;
alter table public.connector_secrets enable row level security;
alter table public.product_external_identities enable row level security;
alter table public.field_authority_policies enable row level security;
alter table public.sync_runs enable row level security;
alter table public.sync_run_plan_items enable row level security;
alter table public.sync_conflicts enable row level security;
alter table public.sync_connector_cursors enable row level security;

revoke all on table
  public.connectors, public.connector_secrets, public.product_external_identities,
  public.field_authority_policies, public.sync_runs, public.sync_run_plan_items,
  public.sync_conflicts, public.sync_connector_cursors
from public, anon, authenticated;
revoke all on table
  public.connectors, public.connector_secrets, public.product_external_identities,
  public.field_authority_policies, public.sync_runs, public.sync_run_plan_items,
  public.sync_conflicts, public.sync_connector_cursors
from service_role;

grant select, insert on table public.connectors to service_role;
grant update (
  display_name, mapping_version, connection_config, secret_ref, commit_policy, enabled,
  last_tested_at, last_test_outcome, last_test_error_code, archived_at, archived_by, archived_reason,
  version, updated_at, updated_by
) on table public.connectors to service_role;
grant select, insert on table public.connector_secrets to service_role;
grant select, insert on table public.product_external_identities to service_role;
grant update (
  external_display_label, unlinked_at, unlinked_by, unlink_reason,
  superseded_at, superseded_by_id, version, updated_at, updated_by
) on table public.product_external_identities to service_role;
grant select, insert on table public.field_authority_policies to service_role;
grant update (superseded_at, superseded_by_id, updated_at, updated_by) on table public.field_authority_policies to service_role;
grant select, insert on table public.sync_runs to service_role;
grant update (
  work_kind, status, commit_idempotency_key, commit_actor_user_id, commit_request_digest,
  cursor_to, fetch_content_hash, plan_basis_digest, row_count, processed_count, checkpoint_cursor,
  create_count, update_count, unchanged_count, skip_count, conflict_count, tombstone_count,
  cycle_blocked_count, estimated_graph_impact, retry_count, next_attempt_at, lease_owner,
  lease_expires_at, error_code, committed_at, canceled_at, cancellation_reason, updated_at
) on table public.sync_runs to service_role;
grant select, insert on table public.sync_run_plan_items to service_role;
grant update (applied_at) on table public.sync_run_plan_items to service_role;
grant select, insert on table public.sync_conflicts to service_role;
grant update (
  resolution_status, resolution_chosen_action, resolution_value, resolution_reason,
  resolved_by, resolved_at, resolved_against_external_value_hash, version, updated_at
) on table public.sync_conflicts to service_role;
grant select, insert on table public.sync_connector_cursors to service_role;
grant update (
  cursor, cursor_issued_at, last_committed_run_id, last_committed_at, last_full_reconciliation_at,
  consecutive_failure_count, circuit_state, circuit_opened_at, updated_at
) on table public.sync_connector_cursors to service_role;

-- =============================================================================
-- Retention integration -- one evidence class covers all connector-produced data.
-- =============================================================================

insert into public.retention_evidence_classes(identifier, default_requested_retention_days)
values ('connector_sync_record', 0)
on conflict(identifier) do update set enabled = true;
insert into public.organization_retention_policies(
  organization_id, evidence_class, requested_retention_days, effective_retention_days
)
select organizations.id, classes.identifier, classes.default_requested_retention_days, classes.default_requested_retention_days
from public.organizations organizations
join public.retention_evidence_classes classes on classes.identifier = 'connector_sync_record'
on conflict(organization_id, evidence_class) do nothing;
insert into public.evidence_protection_watermarks(organization_id, evidence_class)
select organizations.id, 'connector_sync_record'
from public.organizations organizations
on conflict(organization_id, evidence_class) do nothing;

-- =============================================================================
-- JSON envelopes
-- =============================================================================

create or replace function public.m2_v2_connector_json(p_connector public.connectors)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', p_connector.id, 'organizationId', p_connector.organization_id,
    'connectorType', p_connector.connector_type, 'displayName', p_connector.display_name,
    'adapterVersion', p_connector.adapter_version, 'mappingVersion', p_connector.mapping_version,
    'connectionConfig', p_connector.connection_config, 'hasSecret', p_connector.secret_ref is not null,
    'commitPolicy', p_connector.commit_policy, 'enabled', p_connector.enabled,
    'lastTestedAt', case when p_connector.last_tested_at is null then null else public.m2_utc_z(p_connector.last_tested_at) end,
    'lastTestOutcome', p_connector.last_test_outcome, 'lastTestErrorCode', p_connector.last_test_error_code,
    'archivedAt', case when p_connector.archived_at is null then null else public.m2_utc_z(p_connector.archived_at) end,
    'version', p_connector.version,
    'createdAt', public.m2_utc_z(p_connector.created_at), 'createdBy', p_connector.created_by,
    'updatedAt', public.m2_utc_z(p_connector.updated_at), 'updatedBy', p_connector.updated_by
  )
$$;

create or replace function public.m2_v2_sync_run_json(p_run public.sync_runs)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', p_run.id, 'organizationId', p_run.organization_id, 'connectorId', p_run.connector_id,
    'reconciliationKind', p_run.reconciliation_kind, 'workKind', p_run.work_kind, 'status', p_run.status,
    'adapterVersion', p_run.adapter_version, 'mappingVersion', p_run.mapping_version,
    'cursorFrom', p_run.cursor_from, 'cursorTo', p_run.cursor_to,
    'fetchContentHash', p_run.fetch_content_hash, 'planBasisDigest', p_run.plan_basis_digest,
    'counts', jsonb_build_object(
      'create', p_run.create_count, 'update', p_run.update_count, 'unchanged', p_run.unchanged_count,
      'skip', p_run.skip_count, 'conflict', p_run.conflict_count, 'tombstone', p_run.tombstone_count,
      'cycleBlocked', p_run.cycle_blocked_count
    ),
    'estimatedGraphImpact', p_run.estimated_graph_impact,
    'retryCount', p_run.retry_count, 'errorCode', p_run.error_code, 'correlationId', p_run.correlation_id,
    'expiresAt', public.m2_utc_z(p_run.expires_at),
    'committedAt', case when p_run.committed_at is null then null else public.m2_utc_z(p_run.committed_at) end,
    'canceledAt', case when p_run.canceled_at is null then null else public.m2_utc_z(p_run.canceled_at) end,
    'createdAt', public.m2_utc_z(p_run.created_at), 'updatedAt', public.m2_utc_z(p_run.updated_at)
  )
$$;

create or replace function public.m2_v2_sync_conflict_json(p_conflict public.sync_conflicts)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', p_conflict.id, 'organizationId', p_conflict.organization_id, 'connectorId', p_conflict.connector_id,
    'syncRunId', p_conflict.sync_run_id, 'externalIdentityId', p_conflict.external_identity_id,
    'entityType', p_conflict.entity_type, 'entityId', p_conflict.entity_id, 'fieldPath', p_conflict.field_path,
    'conflictKind', p_conflict.conflict_kind,
    'craValue', p_conflict.cra_value, 'craValueSource', p_conflict.cra_value_source,
    'craValueObservedAt', public.m2_utc_z(p_conflict.cra_value_observed_at),
    'externalValue', p_conflict.external_value,
    'externalValueObservedAt', public.m2_utc_z(p_conflict.external_value_observed_at),
    'detectedAt', public.m2_utc_z(p_conflict.detected_at),
    'authorityPolicyId', p_conflict.authority_policy_id,
    'permittedActions', to_jsonb(p_conflict.permitted_actions),
    'resolutionStatus', p_conflict.resolution_status, 'resolutionChosenAction', p_conflict.resolution_chosen_action,
    'resolutionValue', p_conflict.resolution_value, 'resolutionReason', p_conflict.resolution_reason,
    'resolvedBy', p_conflict.resolved_by,
    'resolvedAt', case when p_conflict.resolved_at is null then null else public.m2_utc_z(p_conflict.resolved_at) end,
    'version', p_conflict.version
  )
$$;

create or replace function public.m2_v2_external_identity_json(p_identity public.product_external_identities)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', p_identity.id, 'organizationId', p_identity.organization_id, 'connectorId', p_identity.connector_id,
    'entityType', p_identity.entity_type, 'externalId', p_identity.external_id,
    'externalDisplayLabel', p_identity.external_display_label,
    'craProductId', p_identity.cra_product_id, 'craReleaseId', p_identity.cra_release_id,
    'matchMethod', p_identity.match_method, 'matchConfidence', p_identity.match_confidence,
    'linkedAt', public.m2_utc_z(p_identity.linked_at), 'linkedBy', p_identity.linked_by,
    'unlinkedAt', case when p_identity.unlinked_at is null then null else public.m2_utc_z(p_identity.unlinked_at) end,
    'unlinkedBy', p_identity.unlinked_by, 'unlinkReason', p_identity.unlink_reason,
    'version', p_identity.version,
    'createdAt', public.m2_utc_z(p_identity.created_at), 'createdBy', p_identity.created_by,
    'updatedAt', public.m2_utc_z(p_identity.updated_at), 'updatedBy', p_identity.updated_by
  )
$$;

-- =============================================================================
-- Worker actor resolution -- exact precedent of
-- m2_v2_resolve_security_update_artifact_worker_actor.
-- =============================================================================

create or replace function public.resolve_connector_sync_worker_actor(p_organization_id uuid)
returns uuid language sql security definer set search_path = public, pg_temp as $$
  select member.user_id
  from public.organization_members member
  join public.users user_record on user_record.id = member.user_id and user_record.is_active
  where member.organization_id = p_organization_id and member.role in ('owner', 'admin')
  order by case member.role when 'owner' then 0 else 1 end, member.user_id
  limit 1
$$;

-- =============================================================================
-- Connector CRUD + secret + test
-- =============================================================================

create or replace function public.create_connector_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_idempotency_key uuid,
  p_connector_type text, p_display_name text, p_adapter_version text, p_mapping_version text,
  p_connection_config jsonb, p_commit_policy text
) returns table(outcome text, connector jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_connector public.connectors%rowtype;
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  if p_idempotency_key is null or char_length(btrim(p_display_name)) not between 1 and 200
     or p_connector_type not in ('reference_conformance') or p_commit_policy not in ('manual', 'auto')
     or jsonb_typeof(coalesce(p_connection_config, '{}'::jsonb)) <> 'object' then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  insert into public.connectors(
    organization_id, connector_type, display_name, adapter_version, mapping_version,
    connection_config, commit_policy, created_by, updated_by
  ) values (
    p_organization_id, p_connector_type, btrim(p_display_name), p_adapter_version, btrim(p_mapping_version),
    coalesce(p_connection_config, '{}'::jsonb), p_commit_policy, p_actor_user_id, p_actor_user_id
  ) returning * into v_connector;
  insert into public.sync_connector_cursors(organization_id, connector_id) values (p_organization_id, v_connector.id);
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'connector.created', 'connector', v_connector.id::text,
    jsonb_build_object('connectorType', p_connector_type, 'displayName', v_connector.display_name));
  return query select 'created'::text, public.m2_v2_connector_json(v_connector);
end;
$$;

create or replace function public.update_connector_atomic(
  p_organization_id uuid, p_connector_id uuid, p_actor_user_id uuid, p_expected_version integer,
  p_display_name text, p_mapping_version text, p_connection_config jsonb, p_commit_policy text
) returns table(outcome text, connector jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_connector public.connectors%rowtype;
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  select * into v_connector from public.connectors
  where organization_id = p_organization_id and id = p_connector_id and archived_at is null for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_connector.version <> p_expected_version then
    return query select 'conflict'::text, public.m2_v2_connector_json(v_connector); return;
  end if;
  if char_length(btrim(p_display_name)) not between 1 and 200 or p_commit_policy not in ('manual', 'auto')
     or jsonb_typeof(coalesce(p_connection_config, '{}'::jsonb)) <> 'object' then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  update public.connectors set
    display_name = btrim(p_display_name), mapping_version = btrim(p_mapping_version),
    connection_config = coalesce(p_connection_config, '{}'::jsonb), commit_policy = p_commit_policy,
    version = version + 1, updated_by = p_actor_user_id
  where organization_id = p_organization_id and id = p_connector_id
  returning * into v_connector;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'connector.updated', 'connector', p_connector_id::text, '{}'::jsonb);
  return query select 'updated'::text, public.m2_v2_connector_json(v_connector);
end;
$$;

create or replace function public.set_connector_secret_atomic(
  p_organization_id uuid, p_connector_id uuid, p_actor_user_id uuid, p_secret_value text, p_encryption_key text
) returns table(outcome text, connector jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_connector public.connectors%rowtype; v_secret_id uuid;
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  select * into v_connector from public.connectors
  where organization_id = p_organization_id and id = p_connector_id and archived_at is null for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if char_length(p_secret_value) < 1 or char_length(p_secret_value) > 20000 then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  insert into public.connector_secrets(organization_id, connector_id, ciphertext, rotated_by)
  values (p_organization_id, p_connector_id, extensions.pgp_sym_encrypt(p_secret_value, p_encryption_key), p_actor_user_id)
  returning id into v_secret_id;
  update public.connectors set secret_ref = v_secret_id, version = version + 1, updated_by = p_actor_user_id
  where organization_id = p_organization_id and id = p_connector_id
  returning * into v_connector;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'connector.secret_rotated', 'connector', p_connector_id::text,
    jsonb_build_object('secretRef', v_secret_id));
  return query select 'updated'::text, public.m2_v2_connector_json(v_connector);
end;
$$;

-- Worker-only resolver: never exposed through any controller route. Returns
-- the decrypted value for exactly one call; callers must not log or persist it.
create or replace function public.resolve_connector_secret(
  p_organization_id uuid, p_connector_id uuid, p_encryption_key text
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ciphertext bytea;
begin
  select secrets.ciphertext into v_ciphertext
  from public.connectors connectors
  join public.connector_secrets secrets
    on secrets.organization_id = connectors.organization_id and secrets.id = connectors.secret_ref
  where connectors.organization_id = p_organization_id and connectors.id = p_connector_id;
  if v_ciphertext is null then return null; end if;
  return extensions.pgp_sym_decrypt(v_ciphertext, p_encryption_key);
end;
$$;

create or replace function public.record_connector_test_atomic(
  p_organization_id uuid, p_connector_id uuid, p_actor_user_id uuid, p_outcome text, p_error_code text, p_latency_ms integer
) returns table(outcome text, connector jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_connector public.connectors%rowtype;
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id) or p_outcome not in ('success', 'failure') then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  update public.connectors set
    last_tested_at = now(), last_test_outcome = p_outcome, last_test_error_code = p_error_code
  where organization_id = p_organization_id and id = p_connector_id and archived_at is null
  returning * into v_connector;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'connector.tested', 'connector', p_connector_id::text,
    jsonb_build_object('outcome', p_outcome, 'latencyMs', p_latency_ms));
  return query select 'tested'::text, public.m2_v2_connector_json(v_connector);
end;
$$;

create or replace function public.archive_connector_atomic(
  p_organization_id uuid, p_connector_id uuid, p_actor_user_id uuid, p_expected_version integer, p_reason text
) returns table(outcome text, connector jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_connector public.connectors%rowtype;
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id)
     or char_length(btrim(p_reason)) not between 1 and 500 then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  select * into v_connector from public.connectors
  where organization_id = p_organization_id and id = p_connector_id and archived_at is null for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_connector.version <> p_expected_version then
    return query select 'conflict'::text, public.m2_v2_connector_json(v_connector); return;
  end if;
  if exists (
    select 1 from public.sync_runs runs
    where runs.organization_id = p_organization_id and runs.connector_id = p_connector_id
      and runs.status in ('queued', 'running', 'waiting_for_review', 'retrying')
  ) then
    return query select 'invalid_state'::text, null::jsonb; return;
  end if;
  update public.connectors set
    enabled = false, archived_at = now(), archived_by = p_actor_user_id, archived_reason = btrim(p_reason),
    version = version + 1, updated_by = p_actor_user_id
  where organization_id = p_organization_id and id = p_connector_id
  returning * into v_connector;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'connector.archived', 'connector', p_connector_id::text,
    jsonb_build_object('reason', p_reason));
  return query select 'archived'::text, public.m2_v2_connector_json(v_connector);
end;
$$;

-- =============================================================================
-- Field authority policy
-- =============================================================================

create or replace function public.upsert_field_authority_policy_atomic(
  p_organization_id uuid, p_connector_id uuid, p_actor_user_id uuid,
  p_entity_type text, p_field_name text, p_policy_value text, p_protected boolean, p_protected_reason text
) returns table(outcome text, policy jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old public.field_authority_policies%rowtype; v_new public.field_authority_policies%rowtype; v_new_id uuid := gen_random_uuid();
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  if not public.m2_v2_valid_field_authority_field(p_entity_type, p_field_name)
     or p_policy_value not in ('external_authoritative', 'cra_authoritative', 'newest_with_review', 'manual_only')
     or (p_protected and p_policy_value = 'external_authoritative')
     or (p_protected and char_length(btrim(coalesce(p_protected_reason, ''))) = 0) then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  if not exists (
    select 1 from public.connectors where organization_id = p_organization_id and id = p_connector_id and archived_at is null
  ) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  select * into v_old from public.field_authority_policies
  where organization_id = p_organization_id and connector_id = p_connector_id
    and entity_type = p_entity_type and field_name = p_field_name and superseded_at is null
  for update;
  if found then
    update public.field_authority_policies set superseded_at = now(), superseded_by_id = v_new_id
    where organization_id = p_organization_id and id = v_old.id;
  end if;
  insert into public.field_authority_policies(
    id, organization_id, connector_id, entity_type, field_name, policy_value, protected, protected_reason,
    policy_version, supersedes_id, created_by, updated_by
  ) values (
    v_new_id, p_organization_id, p_connector_id, p_entity_type, p_field_name, p_policy_value,
    coalesce(p_protected, false), nullif(btrim(coalesce(p_protected_reason, '')), ''),
    coalesce(v_old.policy_version, 0) + 1, v_old.id, p_actor_user_id, p_actor_user_id
  ) returning * into v_new;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'connector.authority_policy_updated', 'field_authority_policy', v_new.id::text,
    jsonb_build_object('entityType', p_entity_type, 'field', p_field_name, 'policyValue', p_policy_value, 'protected', v_new.protected));
  return query select 'updated'::text, jsonb_build_object(
    'id', v_new.id, 'connectorId', v_new.connector_id, 'entityType', v_new.entity_type, 'fieldName', v_new.field_name,
    'policyValue', v_new.policy_value, 'protected', v_new.protected, 'protectedReason', v_new.protected_reason,
    'policyVersion', v_new.policy_version
  );
end;
$$;

create or replace function public.list_field_authority_policies(p_organization_id uuid, p_actor_user_id uuid, p_connector_id uuid)
returns table(outcome text, policies jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  return query select 'found'::text, coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', policies.id, 'connectorId', policies.connector_id, 'entityType', policies.entity_type, 'fieldName', policies.field_name,
      'policyValue', policies.policy_value, 'protected', policies.protected, 'protectedReason', policies.protected_reason,
      'policyVersion', policies.policy_version
    ) order by policies.entity_type, policies.field_name)
    from public.field_authority_policies policies
    where policies.organization_id = p_organization_id and policies.connector_id = p_connector_id and policies.superseded_at is null
  ), '[]'::jsonb);
end;
$$;

-- =============================================================================
-- Identity mapping: link / unlink / merge
-- =============================================================================

create or replace function public.link_external_identity_atomic(
  p_organization_id uuid, p_connector_id uuid, p_actor_user_id uuid,
  p_entity_type text, p_external_id text, p_external_display_label text,
  p_cra_product_id uuid, p_cra_release_id uuid, p_match_method text
) returns table(outcome text, mapping jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_mapping public.product_external_identities%rowtype;
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  if p_entity_type not in ('product', 'release') or char_length(btrim(p_external_id)) not between 1 and 500
     or p_match_method not in ('exact_normalized_code', 'exact_normalized_release_version', 'manual_link', 'manual_merge', 'adapter_asserted_id')
     or (p_entity_type = 'product') <> (p_cra_release_id is null) then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  if not exists (select 1 from public.products where organization_id = p_organization_id and id = p_cra_product_id)
     or (p_cra_release_id is not null and not exists (
       select 1 from public.product_releases where organization_id = p_organization_id and product_id = p_cra_product_id and id = p_cra_release_id
     )) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  insert into public.product_external_identities(
    organization_id, connector_id, entity_type, external_id, external_display_label,
    cra_product_id, cra_release_id, match_method,
    match_confidence, linked_by, created_by, updated_by
  ) values (
    p_organization_id, p_connector_id, p_entity_type, btrim(p_external_id), nullif(btrim(coalesce(p_external_display_label, '')), ''),
    p_cra_product_id, p_cra_release_id, p_match_method,
    case when p_match_method = 'manual_link' then 'certain' else 'certain' end, p_actor_user_id, p_actor_user_id, p_actor_user_id
  ) returning * into v_mapping;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'product_external_identity.linked', 'product_external_identity', v_mapping.id::text,
    jsonb_build_object('externalId', p_external_id, 'craProductId', p_cra_product_id, 'craReleaseId', p_cra_release_id));
  return query select 'linked'::text, public.m2_v2_external_identity_json(v_mapping);
exception when unique_violation then return query select 'conflict'::text, null::jsonb;
end;
$$;

create or replace function public.unlink_external_identity_atomic(
  p_organization_id uuid, p_mapping_id uuid, p_actor_user_id uuid, p_reason text
) returns table(outcome text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id) or char_length(btrim(p_reason)) not between 1 and 500 then
    return query select 'not_found'::text; return;
  end if;
  update public.product_external_identities set
    unlinked_at = now(), unlinked_by = p_actor_user_id, unlink_reason = btrim(p_reason),
    version = version + 1, updated_by = p_actor_user_id
  where organization_id = p_organization_id and id = p_mapping_id and unlinked_at is null and superseded_at is null;
  if not found then return query select 'not_found'::text; return; end if;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'product_external_identity.unlinked', 'product_external_identity', p_mapping_id::text,
    jsonb_build_object('reason', p_reason));
  return query select 'unlinked'::text;
end;
$$;

create or replace function public.merge_external_identities_atomic(
  p_organization_id uuid, p_keep_mapping_id uuid, p_merge_from_mapping_id uuid, p_actor_user_id uuid, p_reason text
) returns table(outcome text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_keep public.product_external_identities%rowtype; v_merge_from public.product_external_identities%rowtype; v_new_id uuid := gen_random_uuid();
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id) or char_length(btrim(p_reason)) not between 1 and 500
     or p_keep_mapping_id = p_merge_from_mapping_id then
    return query select 'not_found'::text; return;
  end if;
  select * into v_keep from public.product_external_identities
  where organization_id = p_organization_id and id = p_keep_mapping_id and superseded_at is null and unlinked_at is null for update;
  select * into v_merge_from from public.product_external_identities
  where organization_id = p_organization_id and id = p_merge_from_mapping_id and superseded_at is null and unlinked_at is null for update;
  if not found or v_keep.id is null then return query select 'not_found'::text; return; end if;
  update public.product_external_identities set superseded_at = now(), superseded_by_id = v_new_id, supersession_reason = btrim(p_reason)
  where organization_id = p_organization_id and id = v_merge_from.id;
  insert into public.product_external_identities(
    id, organization_id, connector_id, entity_type, external_id, external_display_label,
    cra_product_id, cra_release_id, match_method, match_confidence, supersedes_id,
    linked_by, created_by, updated_by
  ) values (
    v_new_id, p_organization_id, v_merge_from.connector_id, v_merge_from.entity_type, v_merge_from.external_id,
    v_merge_from.external_display_label, v_keep.cra_product_id, v_keep.cra_release_id, 'manual_merge', 'certain',
    v_merge_from.id, p_actor_user_id, p_actor_user_id, p_actor_user_id
  );
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'product_external_identity.merged', 'product_external_identity', v_new_id::text,
    jsonb_build_object('keptMappingId', p_keep_mapping_id, 'mergedFromMappingId', p_merge_from_mapping_id, 'reason', p_reason));
  return query select 'merged'::text;
end;
$$;

-- =============================================================================
-- Sync run lifecycle: begin (dry-run trigger) -> claim -> save plan -> commit
-- =============================================================================

create or replace function public.begin_sync_run_atomic(
  p_organization_id uuid, p_connector_id uuid, p_actor_user_id uuid,
  p_reconciliation_kind text, p_idempotency_key uuid, p_correlation_id uuid
) returns table(outcome text, run jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_connector public.connectors%rowtype; v_run public.sync_runs%rowtype; v_existing public.sync_runs%rowtype;
  v_digest text; v_running_id uuid; v_cursor_from text;
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  if p_idempotency_key is null or p_correlation_id is null or p_reconciliation_kind not in ('incremental', 'full') then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  select * into v_connector from public.connectors
  where organization_id = p_organization_id and id = p_connector_id and archived_at is null and enabled for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;

  v_digest := encode(extensions.digest(jsonb_build_object(
    'connectorId', p_connector_id, 'reconciliationKind', p_reconciliation_kind
  )::text, 'sha256'), 'hex');
  select * into v_existing from public.sync_runs
  where organization_id = p_organization_id and actor_user_id = p_actor_user_id and trigger_idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_existing.trigger_request_digest <> v_digest then
      return query select 'idempotency_mismatch'::text, null::jsonb;
    else
      return query select 'queued'::text, public.m2_v2_sync_run_json(v_existing);
    end if;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_connector_id::text, 1));
  select id into v_running_id from public.sync_runs
  where organization_id = p_organization_id and connector_id = p_connector_id
    and status in ('queued', 'running', 'waiting_for_review', 'retrying');
  if v_running_id is not null then
    return query select 'already_running'::text, public.m2_v2_sync_run_json((
      select runs from public.sync_runs runs where runs.organization_id = p_organization_id and runs.id = v_running_id
    ));
    return;
  end if;

  -- Full reconciliation deliberately ignores the incremental cursor and walks
  -- from scratch; incremental runs must start exactly where the durable
  -- cursor last left off, or commit's drift check would reject every run
  -- after the first.
  if p_reconciliation_kind = 'incremental' then
    select cursor into v_cursor_from from public.sync_connector_cursors
    where organization_id = p_organization_id and connector_id = p_connector_id;
  end if;

  insert into public.sync_runs(
    organization_id, connector_id, reconciliation_kind, actor_kind, actor_user_id,
    trigger_idempotency_key, trigger_request_digest, adapter_version, mapping_version, correlation_id, cursor_from
  ) values (
    p_organization_id, p_connector_id, p_reconciliation_kind, 'user', p_actor_user_id,
    p_idempotency_key, v_digest, v_connector.adapter_version, v_connector.mapping_version, p_correlation_id, v_cursor_from
  ) returning * into v_run;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'sync_run.dry_run_started', 'sync_run', v_run.id::text,
    jsonb_build_object('reconciliationKind', p_reconciliation_kind, 'correlationId', p_correlation_id));
  return query select 'queued'::text, public.m2_v2_sync_run_json(v_run);
end;
$$;

create or replace function public.claim_sync_run(p_worker_id text, p_lease_seconds integer)
returns table(outcome text, run jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_run public.sync_runs%rowtype; v_connector public.connectors%rowtype;
begin
  if char_length(btrim(p_worker_id)) not between 1 and 100 or p_lease_seconds not between 10 and 300 then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  select * into v_run from public.sync_runs runs
  where runs.status in ('queued', 'retrying') and runs.next_attempt_at <= now()
    and runs.expires_at > now() and (runs.lease_expires_at is null or runs.lease_expires_at <= now())
  order by runs.next_attempt_at, runs.created_at, runs.id
  for update skip locked limit 1;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;

  select * into v_connector from public.connectors
  where organization_id = v_run.organization_id and id = v_run.connector_id;
  if v_connector.archived_at is not null or not v_connector.enabled then
    update public.sync_runs set status = 'failed', error_code = 'connector_disabled', lease_owner = null, lease_expires_at = null
    where organization_id = v_run.organization_id and id = v_run.id;
    return query select 'connector_disabled'::text, null::jsonb; return;
  end if;

  update public.sync_runs set
    status = 'running', lease_owner = btrim(p_worker_id), lease_expires_at = now() + make_interval(secs => p_lease_seconds), error_code = null
  where organization_id = v_run.organization_id and id = v_run.id
  returning * into v_run;
  return query select 'claimed'::text, public.m2_v2_sync_run_json(v_run);
end;
$$;

-- Persists the dry-run plan (rows already validated/diffed by the caller) and
-- transitions the run. Never touches products/product_releases/etc.
create or replace function public.save_sync_run_plan_atomic(
  p_organization_id uuid, p_sync_run_id uuid, p_worker_id text,
  p_cursor_to text, p_fetch_content_hash text, p_plan_items jsonb, p_conflicts jsonb
) returns table(outcome text, run jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_run public.sync_runs%rowtype; v_connector public.connectors%rowtype;
  v_item jsonb; v_conflict jsonb; v_create integer := 0; v_update integer := 0; v_unchanged integer := 0;
  v_skip integer := 0; v_conflict_ct integer := 0; v_tombstone integer := 0; v_cycle integer := 0;
  v_has_blockers boolean;
begin
  select * into v_run from public.sync_runs
  where organization_id = p_organization_id and id = p_sync_run_id and status = 'running'
    and lease_owner = btrim(p_worker_id) and lease_expires_at > now() for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if jsonb_typeof(p_plan_items) <> 'array' or jsonb_typeof(p_conflicts) <> 'array' then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;

  for v_item in select value from jsonb_array_elements(p_plan_items) loop
    if coalesce(v_item->>'proposedAction', '') not in (
      'create', 'update', 'unchanged', 'archive', 'conflict', 'ambiguous_match',
      'pending_required_fields', 'rejected', 'skipped_tombstone'
    ) then
      raise exception using errcode = '22023', message = 'invalid sync run plan item';
    end if;
    insert into public.sync_run_plan_items(
      organization_id, sync_run_id, external_id, entity_type, proposed_action,
      field_diffs, issues, cra_product_id, cra_release_id, expected_version
    ) values (
      p_organization_id, p_sync_run_id, v_item->>'externalId', v_item->>'entityType', v_item->>'proposedAction',
      coalesce(v_item->'fieldDiffs', '{}'::jsonb), coalesce(v_item->'issues', '[]'::jsonb),
      nullif(v_item->>'craProductId', '')::uuid, nullif(v_item->>'craReleaseId', '')::uuid,
      nullif(v_item->>'expectedVersion', '')::integer
    );
    case v_item->>'proposedAction'
      when 'create' then v_create := v_create + 1;
      when 'update' then v_update := v_update + 1;
      when 'unchanged' then v_unchanged := v_unchanged + 1;
      when 'archive' then v_tombstone := v_tombstone + 1;
      when 'conflict' then v_conflict_ct := v_conflict_ct + 1;
      when 'ambiguous_match', 'pending_required_fields', 'rejected' then v_skip := v_skip + 1;
      when 'skipped_tombstone' then null;
      else null;
    end case;
  end loop;

  for v_conflict in select value from jsonb_array_elements(p_conflicts) loop
    insert into public.sync_conflicts(
      organization_id, connector_id, sync_run_id, external_identity_id, entity_type, entity_id, field_path,
      conflict_kind, cra_value, cra_value_source, cra_value_observed_at, external_value, external_value_hash,
      external_value_observed_at, authority_policy_id, authority_policy_snapshot, permitted_actions, correlation_id
    ) values (
      p_organization_id, v_run.connector_id, p_sync_run_id, (v_conflict->>'externalIdentityId')::uuid,
      v_conflict->>'entityType', nullif(v_conflict->>'entityId', '')::uuid, v_conflict->>'fieldPath',
      coalesce(v_conflict->>'conflictKind', 'field_value'), coalesce(v_conflict->'craValue', 'null'::jsonb),
      coalesce(v_conflict->>'craValueSource', 'prior_sync_apply'), coalesce((v_conflict->>'craValueObservedAt')::timestamptz, now()),
      coalesce(v_conflict->'externalValue', 'null'::jsonb), v_conflict->>'externalValueHash',
      coalesce((v_conflict->>'externalValueObservedAt')::timestamptz, now()),
      nullif(v_conflict->>'authorityPolicyId', '')::uuid, coalesce(v_conflict->'authorityPolicySnapshot', '{}'::jsonb),
      coalesce((select array_agg(value #>> '{}') from jsonb_array_elements(coalesce(v_conflict->'permittedActions', '["accept_external","keep_cra","enter_manual_value"]'::jsonb))),
        array['accept_external', 'keep_cra', 'enter_manual_value']),
      v_run.correlation_id
    ) on conflict (organization_id, external_identity_id, field_path) where resolution_status = 'open' do nothing;
  end loop;

  v_has_blockers := (v_conflict_ct > 0) or (v_cycle > 0) or exists (
    select 1 from public.sync_run_plan_items items
    where items.organization_id = p_organization_id and items.sync_run_id = p_sync_run_id
      and items.proposed_action in ('ambiguous_match', 'pending_required_fields', 'rejected')
  );

  select * into v_connector from public.connectors where organization_id = p_organization_id and id = v_run.connector_id;

  update public.sync_runs set
    cursor_to = p_cursor_to, fetch_content_hash = p_fetch_content_hash,
    plan_basis_digest = encode(extensions.digest(jsonb_build_object(
      'adapterVersion', v_run.adapter_version, 'mappingVersion', v_run.mapping_version,
      'fetchContentHash', p_fetch_content_hash, 'cursorFrom', v_run.cursor_from
    )::text, 'sha256'), 'hex'),
    row_count = v_create + v_update + v_unchanged + v_skip + v_conflict_ct + v_tombstone,
    processed_count = v_create + v_update + v_unchanged + v_skip + v_conflict_ct + v_tombstone,
    create_count = v_create, update_count = v_update, unchanged_count = v_unchanged, skip_count = v_skip,
    conflict_count = v_conflict_ct, tombstone_count = v_tombstone, cycle_blocked_count = v_cycle,
    status = case
      when v_has_blockers or v_connector.commit_policy = 'manual' then 'waiting_for_review'
      else 'queued'
    end,
    work_kind = case when v_has_blockers or v_connector.commit_policy = 'manual' then 'dry_run' else 'commit' end,
    lease_owner = null, lease_expires_at = null,
    next_attempt_at = now()
  where organization_id = p_organization_id and id = p_sync_run_id
  returning * into v_run;

  return query select 'saved'::text, public.m2_v2_sync_run_json(v_run);
exception when invalid_text_representation or numeric_value_out_of_range then
  return query select 'invalid_request'::text, null::jsonb;
end;
$$;

-- Applies the persisted plan via the EXISTING atomic product/release RPCs,
-- in this one transaction, then advances the durable cursor. A crash between
-- "applied" and "cursor advanced" is impossible by construction.
create or replace function public.commit_sync_run_atomic(
  p_organization_id uuid, p_sync_run_id uuid, p_actor_user_id uuid,
  p_fetch_content_hash text, p_idempotency_key uuid, p_correlation_id uuid
) returns table(outcome text, run jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_run public.sync_runs%rowtype; v_cursor public.sync_connector_cursors%rowtype;
  v_worker_actor uuid; v_item public.sync_run_plan_items%rowtype;
  v_product public.products%rowtype; v_release public.product_releases%rowtype;
  v_result record; v_digest text; v_applied integer := 0;
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_sync_run_id::text, 2));

  select * into v_run from public.sync_runs
  where organization_id = p_organization_id and id = p_sync_run_id and status = 'running' and work_kind = 'commit'
  for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_run.fetch_content_hash is distinct from p_fetch_content_hash then
    update public.sync_runs set status = 'waiting_for_review', work_kind = 'dry_run', error_code = 'plan_basis_changed'
    where organization_id = p_organization_id and id = p_sync_run_id returning * into v_run;
    return query select 'plan_basis_changed'::text, public.m2_v2_sync_run_json(v_run); return;
  end if;
  if exists (
    select 1 from public.sync_conflicts conflicts
    where conflicts.organization_id = p_organization_id and conflicts.sync_run_id = p_sync_run_id and conflicts.resolution_status = 'open'
  ) then
    update public.sync_runs set status = 'waiting_for_review', work_kind = 'dry_run', error_code = 'blocked_by_conflicts'
    where organization_id = p_organization_id and id = p_sync_run_id returning * into v_run;
    return query select 'blocked_by_conflicts'::text, public.m2_v2_sync_run_json(v_run); return;
  end if;

  select * into v_cursor from public.sync_connector_cursors
  where organization_id = p_organization_id and connector_id = v_run.connector_id for update;
  if v_cursor.cursor is distinct from v_run.cursor_from then
    update public.sync_runs set status = 'waiting_for_review', work_kind = 'dry_run', error_code = 'cursor_drifted'
    where organization_id = p_organization_id and id = p_sync_run_id returning * into v_run;
    return query select 'cursor_drifted'::text, public.m2_v2_sync_run_json(v_run); return;
  end if;

  v_worker_actor := coalesce(p_actor_user_id, public.resolve_connector_sync_worker_actor(p_organization_id));
  if v_worker_actor is null then return query select 'retryable_unavailable'::text, null::jsonb; return; end if;

  v_digest := encode(extensions.digest(jsonb_build_object('syncRunId', p_sync_run_id)::text, 'sha256'), 'hex');

  for v_item in
    select * from public.sync_run_plan_items items
    where items.organization_id = p_organization_id and items.sync_run_id = p_sync_run_id
      and items.proposed_action in ('create', 'update', 'archive')
      and items.applied_at is null
    order by items.entity_type desc, items.created_at
  loop
    if v_item.entity_type = 'product' and v_item.proposed_action = 'create' then
      if not (v_item.field_diffs ? 'responsibleOwnerId') or not (v_item.field_diffs ? 'legalEntityId') then
        update public.sync_run_plan_items set applied_at = now() where organization_id = p_organization_id and id = v_item.id;
        continue;
      end if;
      select * into v_result from public.create_product_atomic(
        p_organization_id, v_worker_actor, gen_random_uuid(),
        v_item.field_diffs->>'name', v_item.field_diffs->>'internalCode', v_item.field_diffs->>'productType',
        v_item.field_diffs->>'description', (v_item.field_diffs->>'responsibleOwnerId')::uuid, (v_item.field_diffs->>'legalEntityId')::uuid
      );
    elsif v_item.entity_type = 'product' and v_item.proposed_action = 'update' then
      select * into v_product from public.products where organization_id = p_organization_id and id = v_item.cra_product_id for update;
      if not found then
        raise exception using errcode = '22023',
          message = format('sync commit rejected: plan item %s targets an entity that no longer exists', v_item.id);
      end if;
      select * into v_result from public.update_product_atomic(
        p_organization_id, v_item.cra_product_id, v_worker_actor, coalesce(v_item.expected_version, v_product.version),
        v_item.field_diffs->>'name', v_item.field_diffs->>'internalCode', v_item.field_diffs->>'productType',
        v_item.field_diffs->>'description', v_item.field_diffs ? 'description', null::uuid
      );
    elsif v_item.entity_type = 'product' and v_item.proposed_action = 'archive' then
      select * into v_product from public.products where organization_id = p_organization_id and id = v_item.cra_product_id for update;
      if not found then
        raise exception using errcode = '22023',
          message = format('sync commit rejected: plan item %s targets an entity that no longer exists', v_item.id);
      end if;
      select * into v_result from public.archive_product_atomic(
        p_organization_id, v_item.cra_product_id, v_worker_actor, coalesce(v_item.expected_version, v_product.version),
        'External system reported this product as removed.'::text
      );
    elsif v_item.entity_type = 'release' and v_item.proposed_action = 'create' then
      select * into v_result from public.create_product_release_atomic(
        p_organization_id, v_item.cra_product_id, v_worker_actor, gen_random_uuid(),
        v_item.field_diffs->>'label', v_item.field_diffs->>'releaseVersion', v_item.field_diffs->>'description'
      );
    elsif v_item.entity_type = 'release' and v_item.proposed_action = 'update' then
      select * into v_release from public.product_releases where organization_id = p_organization_id and id = v_item.cra_release_id for update;
      if not found then
        raise exception using errcode = '22023',
          message = format('sync commit rejected: plan item %s targets an entity that no longer exists', v_item.id);
      end if;
      select * into v_result from public.update_product_release_atomic(
        p_organization_id, v_item.cra_product_id, v_item.cra_release_id, v_worker_actor,
        coalesce(v_item.expected_version, v_release.version),
        v_item.field_diffs->>'label', v_item.field_diffs->>'releaseVersion',
        v_item.field_diffs->>'description', v_item.field_diffs ? 'description'
      );
    elsif v_item.entity_type = 'release' and v_item.proposed_action = 'archive' then
      select * into v_release from public.product_releases where organization_id = p_organization_id and id = v_item.cra_release_id for update;
      if not found then
        raise exception using errcode = '22023',
          message = format('sync commit rejected: plan item %s targets an entity that no longer exists', v_item.id);
      end if;
      select * into v_result from public.archive_product_release_atomic(
        p_organization_id, v_item.cra_product_id, v_item.cra_release_id, v_worker_actor,
        coalesce(v_item.expected_version, v_release.version), 'External system reported this release as removed.'::text
      );
    else
      continue;
    end if;

    if v_result.outcome not in ('created', 'updated', 'archived', 'replayed') then
      raise exception using errcode = '22023',
        message = format('sync commit rejected: plan item %s returned outcome %s', v_item.id, v_result.outcome);
    end if;

    update public.sync_run_plan_items set applied_at = now() where organization_id = p_organization_id and id = v_item.id;
    v_applied := v_applied + 1;
  end loop;

  update public.sync_connector_cursors set
    cursor = v_run.cursor_to, cursor_issued_at = now(), last_committed_run_id = v_run.id, last_committed_at = now(),
    last_full_reconciliation_at = case when v_run.reconciliation_kind = 'full' then now() else last_full_reconciliation_at end,
    consecutive_failure_count = 0, circuit_state = 'closed', circuit_opened_at = null, updated_at = now()
  where organization_id = p_organization_id and connector_id = v_run.connector_id;

  update public.sync_runs set
    status = 'completed', committed_at = now(), commit_idempotency_key = p_idempotency_key,
    commit_actor_user_id = p_actor_user_id, commit_request_digest = v_digest
  where organization_id = p_organization_id and id = p_sync_run_id
  returning * into v_run;

  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, coalesce(p_actor_user_id, v_worker_actor), 'sync_run.committed', 'sync_run', p_sync_run_id::text,
    jsonb_build_object('appliedCount', v_applied, 'cursorTo', v_run.cursor_to, 'correlationId', p_correlation_id));

  return query select 'completed'::text, public.m2_v2_sync_run_json(v_run);
exception when others then
  -- Rolls back every mutation this call performed (the implicit savepoint at
  -- function entry) -- all-or-nothing, cursor is never advanced on a partial
  -- apply. The run itself becomes retrying/failed outside that rollback.
  if v_run.retry_count >= 5 then
    update public.sync_runs set status = 'failed', error_code = 'commit_apply_failed', lease_owner = null, lease_expires_at = null
    where organization_id = p_organization_id and id = p_sync_run_id returning * into v_run;
    return query select 'failed'::text, public.m2_v2_sync_run_json(v_run);
  else
    update public.sync_runs set status = 'retrying', work_kind = 'commit', retry_count = retry_count + 1, error_code = 'commit_apply_failed',
      next_attempt_at = now() + make_interval(secs => least(300, (2 ^ retry_count)::int * 5)), lease_owner = null, lease_expires_at = null
    where organization_id = p_organization_id and id = p_sync_run_id returning * into v_run;
    return query select 'retrying'::text, public.m2_v2_sync_run_json(v_run);
  end if;
end;
$$;

-- Manual-approval step: a human (or an auto-policy connector, called by the
-- worker itself) requests commit on a plan sitting in waiting_for_review.
-- Re-queues the SAME run for the worker to claim and apply -- never a new row.
create or replace function public.request_sync_run_commit_atomic(
  p_organization_id uuid, p_sync_run_id uuid, p_actor_user_id uuid, p_expected_row_count integer
) returns table(outcome text, run jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_run public.sync_runs%rowtype;
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  select * into v_run from public.sync_runs
  where organization_id = p_organization_id and id = p_sync_run_id and status = 'waiting_for_review'
  for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_run.expires_at <= now() then
    return query select 'dry_run_expired'::text, null::jsonb; return;
  end if;
  if p_expected_row_count is not null and v_run.row_count <> p_expected_row_count then
    return query select 'stale_preview'::text, public.m2_v2_sync_run_json(v_run); return;
  end if;
  if exists (
    select 1 from public.sync_conflicts conflicts
    where conflicts.organization_id = p_organization_id and conflicts.sync_run_id = p_sync_run_id and conflicts.resolution_status = 'open'
  ) then
    return query select 'blocked_by_conflicts'::text, public.m2_v2_sync_run_json(v_run); return;
  end if;
  update public.sync_runs set status = 'queued', work_kind = 'commit', next_attempt_at = now()
  where organization_id = p_organization_id and id = p_sync_run_id
  returning * into v_run;
  return query select 'queued'::text, public.m2_v2_sync_run_json(v_run);
end;
$$;

create or replace function public.cancel_sync_run_atomic(
  p_organization_id uuid, p_sync_run_id uuid, p_actor_user_id uuid, p_reason text
) returns table(outcome text, run jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_run public.sync_runs%rowtype;
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  update public.sync_runs set
    status = 'canceled', canceled_at = now(), cancellation_reason = coalesce(nullif(btrim(p_reason), ''), 'Canceled by operator.'),
    lease_owner = null, lease_expires_at = null
  where organization_id = p_organization_id and id = p_sync_run_id
    and status in ('queued', 'running', 'waiting_for_review', 'retrying')
  returning * into v_run;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'sync_run.canceled', 'sync_run', p_sync_run_id::text, jsonb_build_object('reason', p_reason));
  return query select 'canceled'::text, public.m2_v2_sync_run_json(v_run);
end;
$$;

create or replace function public.fail_sync_run_atomic(p_organization_id uuid, p_sync_run_id uuid, p_worker_id text, p_error_code text)
returns table(outcome text, run jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_run public.sync_runs%rowtype;
begin
  select * into v_run from public.sync_runs
  where organization_id = p_organization_id and id = p_sync_run_id and status in ('running')
    and lease_owner = btrim(p_worker_id) for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_run.retry_count >= 5 then
    update public.sync_runs set status = 'failed', error_code = p_error_code, lease_owner = null, lease_expires_at = null
    where organization_id = p_organization_id and id = p_sync_run_id returning * into v_run;
    return query select 'failed'::text, public.m2_v2_sync_run_json(v_run); return;
  end if;
  update public.sync_runs set
    status = 'retrying', retry_count = retry_count + 1, error_code = p_error_code,
    next_attempt_at = now() + make_interval(secs => least(300, (2 ^ retry_count)::int * 5)),
    lease_owner = null, lease_expires_at = null
  where organization_id = p_organization_id and id = p_sync_run_id
  returning * into v_run;
  return query select 'retrying'::text, public.m2_v2_sync_run_json(v_run);
end;
$$;

create or replace function public.list_due_sync_run_organizations(p_limit integer)
returns table(organization_id uuid, oldest_due_at timestamptz)
language sql security definer set search_path = public, pg_temp as $$
  select runs.organization_id, min(runs.next_attempt_at)
  from public.sync_runs runs
  join public.sync_connector_cursors cursors
    on cursors.organization_id = runs.organization_id and cursors.connector_id = runs.connector_id
  where runs.status in ('queued', 'retrying') and runs.next_attempt_at <= now() and runs.expires_at > now()
    and (runs.lease_expires_at is null or runs.lease_expires_at <= now())
    and cursors.circuit_state <> 'open'
  group by runs.organization_id
  order by min(runs.next_attempt_at), runs.organization_id
  limit greatest(1, least(500, coalesce(p_limit, 50)))
$$;

-- =============================================================================
-- Conflict resolution
-- =============================================================================

create or replace function public.resolve_sync_conflict_atomic(
  p_organization_id uuid, p_conflict_id uuid, p_actor_user_id uuid, p_expected_version integer,
  p_chosen_action text, p_manual_value jsonb, p_reason text, p_correlation_id uuid
) returns table(outcome text, conflict jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_conflict public.sync_conflicts%rowtype; v_before jsonb;
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id)
     or p_expected_version is null or char_length(btrim(coalesce(p_reason, ''))) not between 1 and 1000 then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  select * into v_conflict from public.sync_conflicts
  where organization_id = p_organization_id and id = p_conflict_id for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_conflict.version <> p_expected_version then
    return query select 'conflict'::text, public.m2_v2_sync_conflict_json(v_conflict); return;
  end if;
  if v_conflict.resolution_status <> 'open' then
    return query select 'invalid_state'::text, null::jsonb; return;
  end if;
  if not (p_chosen_action = any (v_conflict.permitted_actions)) then
    return query select 'forbidden_by_policy'::text, null::jsonb; return;
  end if;
  v_before := public.m2_v2_sync_conflict_json(v_conflict);
  update public.sync_conflicts set
    resolution_status = 'resolved', resolution_chosen_action = p_chosen_action,
    resolution_value = case when p_chosen_action = 'enter_manual_value' then p_manual_value
      when p_chosen_action = 'accept_external' then v_conflict.external_value else v_conflict.cra_value end,
    resolution_reason = btrim(p_reason), resolved_by = p_actor_user_id, resolved_at = now(),
    resolved_against_external_value_hash = v_conflict.external_value_hash,
    version = version + 1, updated_at = now()
  where organization_id = p_organization_id and id = p_conflict_id
  returning * into v_conflict;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'conflict.resolved', 'sync_conflict', p_conflict_id::text,
    jsonb_build_object('before', v_before, 'after', public.m2_v2_sync_conflict_json(v_conflict), 'correlationId', p_correlation_id));
  return query select 'resolved'::text, public.m2_v2_sync_conflict_json(v_conflict);
end;
$$;

-- =============================================================================
-- Metrics snapshot
-- =============================================================================

create or replace function public.connector_compliance_metrics_snapshot(p_organization_id uuid)
returns table(
  connector_count bigint, connector_dead_letter_count bigint, connector_open_conflict_count bigint,
  connector_retry_count bigint, connector_stale_count bigint, connector_circuit_open_count bigint
)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_organization_id is null then
    raise exception 'organization id is required' using errcode = '22023';
  end if;
  return query select
    (select count(*) from public.connectors c where c.organization_id = p_organization_id and c.archived_at is null),
    (select count(*) from public.sync_runs r where r.organization_id = p_organization_id and r.status = 'failed'),
    (select count(*) from public.sync_conflicts sc where sc.organization_id = p_organization_id and sc.resolution_status = 'open'),
    (select coalesce(sum(r.retry_count), 0) from public.sync_runs r where r.organization_id = p_organization_id and r.status = 'retrying'),
    (select count(*) from public.sync_connector_cursors cur
      where cur.organization_id = p_organization_id and (cur.last_committed_at is null or cur.last_committed_at < now() - interval '7 days')),
    (select count(*) from public.sync_connector_cursors cur where cur.organization_id = p_organization_id and cur.circuit_state = 'open');
end;
$$;

-- =============================================================================
-- Grants: revoke from public/anon/authenticated, service_role only.
-- =============================================================================

revoke all on function
  public.resolve_connector_sync_worker_actor(uuid),
  public.create_connector_atomic(uuid, uuid, uuid, text, text, text, text, jsonb, text),
  public.update_connector_atomic(uuid, uuid, uuid, integer, text, text, jsonb, text),
  public.set_connector_secret_atomic(uuid, uuid, uuid, text, text),
  public.resolve_connector_secret(uuid, uuid, text),
  public.record_connector_test_atomic(uuid, uuid, uuid, text, text, integer),
  public.archive_connector_atomic(uuid, uuid, uuid, integer, text),
  public.upsert_field_authority_policy_atomic(uuid, uuid, uuid, text, text, text, boolean, text),
  public.list_field_authority_policies(uuid, uuid, uuid),
  public.link_external_identity_atomic(uuid, uuid, uuid, text, text, text, uuid, uuid, text),
  public.unlink_external_identity_atomic(uuid, uuid, uuid, text),
  public.merge_external_identities_atomic(uuid, uuid, uuid, uuid, text),
  public.begin_sync_run_atomic(uuid, uuid, uuid, text, uuid, uuid),
  public.request_sync_run_commit_atomic(uuid, uuid, uuid, integer),
  public.claim_sync_run(text, integer),
  public.save_sync_run_plan_atomic(uuid, uuid, text, text, text, jsonb, jsonb),
  public.commit_sync_run_atomic(uuid, uuid, uuid, text, uuid, uuid),
  public.cancel_sync_run_atomic(uuid, uuid, uuid, text),
  public.fail_sync_run_atomic(uuid, uuid, text, text),
  public.list_due_sync_run_organizations(integer),
  public.resolve_sync_conflict_atomic(uuid, uuid, uuid, integer, text, jsonb, text, uuid),
  public.connector_compliance_metrics_snapshot(uuid)
from public, anon, authenticated;

grant execute on function
  public.resolve_connector_sync_worker_actor(uuid),
  public.create_connector_atomic(uuid, uuid, uuid, text, text, text, text, jsonb, text),
  public.update_connector_atomic(uuid, uuid, uuid, integer, text, text, jsonb, text),
  public.set_connector_secret_atomic(uuid, uuid, uuid, text, text),
  public.resolve_connector_secret(uuid, uuid, text),
  public.record_connector_test_atomic(uuid, uuid, uuid, text, text, integer),
  public.archive_connector_atomic(uuid, uuid, uuid, integer, text),
  public.upsert_field_authority_policy_atomic(uuid, uuid, uuid, text, text, text, boolean, text),
  public.list_field_authority_policies(uuid, uuid, uuid),
  public.link_external_identity_atomic(uuid, uuid, uuid, text, text, text, uuid, uuid, text),
  public.unlink_external_identity_atomic(uuid, uuid, uuid, text),
  public.merge_external_identities_atomic(uuid, uuid, uuid, uuid, text),
  public.begin_sync_run_atomic(uuid, uuid, uuid, text, uuid, uuid),
  public.request_sync_run_commit_atomic(uuid, uuid, uuid, integer),
  public.claim_sync_run(text, integer),
  public.save_sync_run_plan_atomic(uuid, uuid, text, text, text, jsonb, jsonb),
  public.commit_sync_run_atomic(uuid, uuid, uuid, text, uuid, uuid),
  public.cancel_sync_run_atomic(uuid, uuid, uuid, text),
  public.fail_sync_run_atomic(uuid, uuid, text, text),
  public.list_due_sync_run_organizations(integer),
  public.resolve_sync_conflict_atomic(uuid, uuid, uuid, integer, text, jsonb, text, uuid),
  public.connector_compliance_metrics_snapshot(uuid)
to service_role;

-- =============================================================================
-- Tenant export source registry -- connector_secrets is excluded (ciphertext
-- credential material, not portable tenant record data; see export-archive.ts).
-- =============================================================================

insert into public.organization_export_sources (source_id, enabled, sort_order)
values ('connector_sync', true, 33)
on conflict (source_id) do nothing;

insert into public.organization_export_source_tables(
  source_id, table_name, tenant_key_column, record_order_column, table_sort
) values
  ('connector_sync', 'connectors', 'organization_id', 'created_at', 1),
  ('connector_sync', 'product_external_identities', 'organization_id', 'linked_at', 2),
  ('connector_sync', 'field_authority_policies', 'organization_id', 'created_at', 3),
  ('connector_sync', 'sync_runs', 'organization_id', 'created_at', 4),
  ('connector_sync', 'sync_run_plan_items', 'organization_id', 'created_at', 5),
  ('connector_sync', 'sync_conflicts', 'organization_id', 'detected_at', 6),
  ('connector_sync', 'sync_connector_cursors', 'organization_id', 'connector_id', 7)
on conflict(source_id, table_name) do update set
  tenant_key_column = excluded.tenant_key_column,
  record_order_column = excluded.record_order_column,
  table_sort = excluded.table_sort;
