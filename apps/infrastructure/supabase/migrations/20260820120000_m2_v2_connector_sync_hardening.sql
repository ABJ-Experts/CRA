-- M2 V2 connector-sync hardening. This is deliberately additive: the
-- foundation migration is already applied to local CRA environments.

-- `parentExternalId` is a policy-controlled product-structure field. It is
-- consumed by the application-layer hierarchy planner; it is not a direct
-- vendor payload column.
create or replace function public.m2_v2_valid_field_authority_field(p_entity_type text, p_field_name text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select case p_entity_type
    when 'product' then p_field_name in ('name', 'internalCode', 'productType', 'description', 'parentExternalId')
    when 'release' then p_field_name in ('label', 'releaseVersion', 'description')
    else false
  end
$$;

-- Connector creation is a durable command. Keep its idempotency fact on the
-- connector row rather than adding a second source of truth; historical rows
-- predate this command and intentionally retain null idempotency metadata.
alter table public.connectors
  add column if not exists create_idempotency_key uuid,
  add column if not exists create_request_digest text,
  add constraint connectors_create_idempotency_pair_check check (
    (create_idempotency_key is null and create_request_digest is null)
    or (create_idempotency_key is not null and create_request_digest ~ '^[a-f0-9]{64}$')
  ) not valid;

create unique index connectors_create_idempotency_key
  on public.connectors(organization_id, created_by, create_idempotency_key)
  where create_idempotency_key is not null;

create or replace function public.create_connector_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_idempotency_key uuid,
  p_connector_type text, p_display_name text, p_adapter_version text, p_mapping_version text,
  p_connection_config jsonb, p_commit_policy text
) returns table(outcome text, connector jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_connector public.connectors%rowtype;
  v_replay public.connectors%rowtype;
  v_request_digest text;
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  if p_idempotency_key is null
    or char_length(btrim(coalesce(p_display_name, ''))) not between 1 and 200
    or coalesce(p_connector_type, '') <> 'reference_conformance'
    or coalesce(p_adapter_version, '') !~ '^[0-9]+\.[0-9]+\.[0-9]+$'
    or char_length(btrim(coalesce(p_mapping_version, ''))) not between 1 and 100
    or coalesce(p_commit_policy, '') not in ('manual', 'auto')
    or jsonb_typeof(coalesce(p_connection_config, '{}'::jsonb)) <> 'object'
    or coalesce(p_connection_config, '{}'::jsonb)::text
      ~* '"[^"]*(password|secret|token|api[_-]?key|private[_-]?key)[^"]*"\s*:' then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;

  v_request_digest := encode(extensions.digest(jsonb_build_object(
    'connectorType', p_connector_type,
    'displayName', btrim(p_display_name),
    'adapterVersion', p_adapter_version,
    'mappingVersion', btrim(p_mapping_version),
    'connectionConfig', coalesce(p_connection_config, '{}'::jsonb),
    'commitPolicy', p_commit_policy
  )::text, 'sha256'), 'hex');

  select * into v_replay
  from public.connectors
  where organization_id = p_organization_id
    and created_by = p_actor_user_id
    and create_idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_replay.create_request_digest = v_request_digest then
      return query select 'replayed'::text, public.m2_v2_connector_json(v_replay); return;
    end if;
    return query select 'idempotency_mismatch'::text, null::jsonb; return;
  end if;

  insert into public.connectors(
    organization_id, connector_type, display_name, adapter_version, mapping_version,
    connection_config, commit_policy, create_idempotency_key, create_request_digest,
    created_by, updated_by
  ) values (
    p_organization_id, p_connector_type, btrim(p_display_name), p_adapter_version, btrim(p_mapping_version),
    coalesce(p_connection_config, '{}'::jsonb), p_commit_policy, p_idempotency_key, v_request_digest,
    p_actor_user_id, p_actor_user_id
  ) on conflict (organization_id, created_by, create_idempotency_key)
    where create_idempotency_key is not null do nothing
  returning * into v_connector;
  if not found then
    select * into v_replay
    from public.connectors
    where organization_id = p_organization_id
      and created_by = p_actor_user_id
      and create_idempotency_key = p_idempotency_key
    for update;
    if found and v_replay.create_request_digest = v_request_digest then
      return query select 'replayed'::text, public.m2_v2_connector_json(v_replay); return;
    end if;
    return query select 'idempotency_mismatch'::text, null::jsonb; return;
  end if;

  insert into public.sync_connector_cursors(organization_id, connector_id)
  values (p_organization_id, v_connector.id);
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, p_actor_user_id, 'connector.created', 'connector', v_connector.id::text,
    jsonb_build_object(
      'connectorType', p_connector_type,
      'displayName', v_connector.display_name,
      'requestDigest', v_request_digest
    )
  );
  return query select 'created'::text, public.m2_v2_connector_json(v_connector);
end;
$$;

-- Expose the server-authoritative plan row count so the commit request can
-- retain its stale-preview guard without rebuilding counts in a browser.
create or replace function public.m2_v2_sync_run_json(p_run public.sync_runs)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', p_run.id, 'organizationId', p_run.organization_id, 'connectorId', p_run.connector_id,
    'reconciliationKind', p_run.reconciliation_kind, 'workKind', p_run.work_kind, 'status', p_run.status,
    'adapterVersion', p_run.adapter_version, 'mappingVersion', p_run.mapping_version,
    'cursorFrom', p_run.cursor_from, 'cursorTo', p_run.cursor_to,
    'fetchContentHash', p_run.fetch_content_hash, 'planBasisDigest', p_run.plan_basis_digest,
    'rowCount', p_run.row_count,
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

-- The status trigger is an implementation detail, but its state machine must
-- allow connector disablement to fail queued work and an operator to retry a
-- failed run. It must never be callable by browser roles.
create or replace function public.enforce_sync_run_status_transition()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = old.status then return new; end if;
  if not (
    (old.status = 'queued' and new.status in ('running', 'canceled', 'failed'))
    or (old.status = 'running' and new.status in ('waiting_for_review', 'queued', 'completed', 'retrying', 'failed', 'canceled'))
    or (old.status = 'waiting_for_review' and new.status in ('queued', 'canceled'))
    or (old.status = 'retrying' and new.status in ('running', 'canceled', 'failed'))
    or (old.status = 'failed' and new.status = 'queued')
  ) then
    raise exception using errcode = '23514', message = 'invalid sync run status transition';
  end if;
  return new;
end;
$$;

-- New plan rows use the shared SyncFieldDiff object. Convert the short-lived
-- raw plans written by the foundation migration before adding the database
-- invariant: a NOT VALID CHECK would otherwise reject an `applied_at` update
-- while replaying an older plan.
create or replace function public.m2_v2_valid_sync_field_diffs(p_field_diffs jsonb)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select jsonb_typeof(p_field_diffs) = 'object'
    and not exists (
      select 1
      from jsonb_each(p_field_diffs) as entries(field_name, field_diff)
      where jsonb_typeof(field_diff) <> 'object'
        or field_diff->>'field' is distinct from field_name
        or not field_diff ? 'craValue'
        or not field_diff ? 'externalValue'
        or not field_diff ? 'authorityPolicyId'
        or not field_diff ? 'permittedActions'
        or jsonb_typeof(field_diff->'permittedActions') <> 'array'
        or (field_diff->>'authorityPolicyId' is not null
          and field_diff->>'authorityPolicyId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
        or exists (
          select 1
          from jsonb_array_elements_text(field_diff->'permittedActions') as actions(action)
          where action not in ('accept_external', 'keep_cra', 'enter_manual_value')
        )
    )
$$;

create function public.m2_v2_normalize_sync_field_diffs(p_field_diffs jsonb)
returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select case
    when public.m2_v2_valid_sync_field_diffs(p_field_diffs) then p_field_diffs
    else (
      select coalesce(jsonb_object_agg(field_name, jsonb_build_object(
        'field', field_name,
        'craValue', 'null'::jsonb,
        'externalValue', case
          when jsonb_typeof(field_value) = 'object' and field_value ? 'externalValue'
            then field_value -> 'externalValue'
          else field_value
        end,
        'authorityPolicyId', null,
        'permittedActions', jsonb_build_array('accept_external', 'keep_cra', 'enter_manual_value')
      )), '{}'::jsonb)
      from jsonb_each(p_field_diffs) as entries(field_name, field_value)
    )
  end
$$;

update public.sync_run_plan_items
set field_diffs = public.m2_v2_normalize_sync_field_diffs(field_diffs)
where not public.m2_v2_valid_sync_field_diffs(field_diffs);

drop function public.m2_v2_normalize_sync_field_diffs(jsonb);

alter table public.sync_run_plan_items
  add constraint sync_run_plan_items_field_diffs_schema_check
  check (public.m2_v2_valid_sync_field_diffs(field_diffs)) not valid;

-- A first-seen child has no durable external identity until its product create
-- commits. Its hierarchy conflict is therefore anchored to the persisted plan
-- item, never to a fabricated/nullable identity. Existing identity-bound
-- conflicts remain unchanged; exactly one target is authoritative per row.
alter table public.sync_conflicts
  alter column external_identity_id drop not null,
  add column if not exists plan_item_id uuid,
  add constraint sync_conflicts_plan_item_fkey
    foreign key (organization_id, plan_item_id)
    references public.sync_run_plan_items(organization_id, id) on delete restrict,
  add constraint sync_conflicts_exactly_one_target_check
    check (num_nonnulls(external_identity_id, plan_item_id) = 1) not valid;

drop index public.sync_conflicts_open_key;
create unique index sync_conflicts_open_key
  on public.sync_conflicts(
    organization_id, (coalesce(external_identity_id, plan_item_id)), field_path
  ) where resolution_status = 'open';

create index sync_conflicts_plan_item_idx
  on public.sync_conflicts(organization_id, plan_item_id)
  where plan_item_id is not null;

-- Keep plans created before this corrective migration replayable while all new
-- writes are constrained to the canonical structured format above.
create or replace function public.m2_v2_sync_field_external_value(p_field_diffs jsonb, p_field_name text)
returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select case jsonb_typeof(p_field_diffs -> p_field_name)
    when 'object' then p_field_diffs -> p_field_name -> 'externalValue'
    else p_field_diffs -> p_field_name
  end
$$;

-- Resolution values are JSON because conflicts can represent non-scalar future
-- entities. Product and release fields are scalar here; reject an object or
-- array instead of accidentally stringifying hostile/manual JSON into CRA.
create or replace function public.m2_v2_sync_text_field_value(
  p_value jsonb,
  p_allow_null boolean,
  p_field_name text
) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if jsonb_typeof(p_value) = 'string' then
    return p_value #>> '{}';
  end if;
  if p_allow_null and (p_value is null or p_value = 'null'::jsonb) then
    return null;
  end if;
  raise exception using errcode = '22023',
    message = format('sync commit rejected: malformed value for %s', p_field_name);
end;
$$;

-- The preview digest is calculated in the database and used by both the
-- read-only preview and the locked persistence path. This prevents policy or
-- connector configuration changes from silently invalidating a preview.
create or replace function public.m2_v2_field_authority_policy_preview_digest(
  p_organization_id uuid,
  p_connector_id uuid,
  p_entity_type text,
  p_field_name text,
  p_policy_value text,
  p_protected boolean,
  p_protected_reason text
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_connector public.connectors%rowtype;
  v_current_policy_version integer := 0;
begin
  select * into v_connector
  from public.connectors
  where organization_id = p_organization_id and id = p_connector_id and archived_at is null;
  if not found then return null; end if;

  select policy_version into v_current_policy_version
  from public.field_authority_policies
  where organization_id = p_organization_id and connector_id = p_connector_id
    and entity_type = p_entity_type and field_name = p_field_name and superseded_at is null;

  return encode(extensions.digest(jsonb_build_object(
    'organizationId', p_organization_id,
    'connectorId', p_connector_id,
    'connectorVersion', v_connector.version,
    'mappingVersion', v_connector.mapping_version,
    'currentPolicyVersion', coalesce(v_current_policy_version, 0),
    'entityType', p_entity_type,
    'fieldName', p_field_name,
    'policyValue', p_policy_value,
    'protected', coalesce(p_protected, false),
    'protectedReason', nullif(btrim(coalesce(p_protected_reason, '')), '')
  )::text, 'sha256'), 'hex');
end;
$$;

create or replace function public.preview_field_authority_policy(
  p_organization_id uuid,
  p_connector_id uuid,
  p_actor_user_id uuid,
  p_entity_type text,
  p_field_name text,
  p_policy_value text,
  p_protected boolean,
  p_protected_reason text
) returns table(outcome text, preview jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_run_id uuid;
  v_digest text;
  v_affected_count integer := 0;
  v_create_count integer := 0;
  v_update_count integer := 0;
  v_ignored_count integer := 0;
  v_conflict_count integer := 0;
  v_samples jsonb := '[]'::jsonb;
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  if not public.m2_v2_valid_field_authority_field(p_entity_type, p_field_name)
    or p_policy_value not in ('external_authoritative', 'cra_authoritative', 'newest_with_review', 'manual_only')
    or (coalesce(p_protected, false) and p_policy_value = 'external_authoritative')
    or (coalesce(p_protected, false) and char_length(btrim(coalesce(p_protected_reason, ''))) = 0)
    or (not coalesce(p_protected, false) and nullif(btrim(coalesce(p_protected_reason, '')), '') is not null) then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  if not exists (
    select 1 from public.connectors
    where organization_id = p_organization_id and id = p_connector_id and archived_at is null
  ) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;

  v_digest := public.m2_v2_field_authority_policy_preview_digest(
    p_organization_id, p_connector_id, p_entity_type, p_field_name,
    p_policy_value, p_protected, p_protected_reason
  );
  select id into v_run_id
  from public.sync_runs
  where organization_id = p_organization_id and connector_id = p_connector_id
    and work_kind = 'dry_run' and expires_at > now() and fetch_content_hash is not null
  order by created_at desc, id desc
  limit 1;

  if v_run_id is not null then
    select count(*) into v_affected_count
    from public.sync_run_plan_items
    where organization_id = p_organization_id and sync_run_id = v_run_id
      and entity_type = p_entity_type and field_diffs ? p_field_name;

    select count(*) into v_create_count
    from public.sync_run_plan_items
    where organization_id = p_organization_id and sync_run_id = v_run_id
      and entity_type = p_entity_type and proposed_action = 'create' and field_diffs ? p_field_name;

    select coalesce(jsonb_agg(jsonb_build_object(
      'externalId', external_id,
      'field', p_field_name,
      'craValue', coalesce(field_diffs -> p_field_name -> 'craValue', 'null'::jsonb),
      'externalValue', public.m2_v2_sync_field_external_value(field_diffs, p_field_name)
    ) order by created_at, id), '[]'::jsonb)
    into v_samples
    from (
      select *
      from public.sync_run_plan_items
      where organization_id = p_organization_id and sync_run_id = v_run_id
        and entity_type = p_entity_type and field_diffs ? p_field_name
      order by created_at, id
      limit 50
    ) sampled_items;
  end if;

  if p_policy_value = 'external_authoritative' then
    v_update_count := greatest(v_affected_count - v_create_count, 0);
  elsif p_policy_value = 'newest_with_review' then
    v_conflict_count := greatest(v_affected_count - v_create_count, 0);
  else
    v_ignored_count := greatest(v_affected_count - v_create_count, 0);
  end if;

  return query select 'previewed'::text, jsonb_build_object(
    'wouldCreate', v_create_count,
    'wouldUpdate', v_update_count,
    'wouldBeIgnored', v_ignored_count,
    'wouldConflict', v_conflict_count,
    'sampleDiffs', v_samples,
    'previewDigest', v_digest
  );
end;
$$;

-- The changed signature makes a preview digest mandatory. The old overload is
-- removed after the replacement is created so stale clients fail rather than
-- bypassing the review gate.
create function public.upsert_field_authority_policy_atomic(
  p_organization_id uuid,
  p_connector_id uuid,
  p_actor_user_id uuid,
  p_entity_type text,
  p_field_name text,
  p_policy_value text,
  p_protected boolean,
  p_protected_reason text,
  p_preview_digest text
) returns table(outcome text, policy jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_connector public.connectors%rowtype;
  v_old public.field_authority_policies%rowtype;
  v_new public.field_authority_policies%rowtype;
  v_new_id uuid := gen_random_uuid();
  v_expected_digest text;
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  if not public.m2_v2_valid_field_authority_field(p_entity_type, p_field_name)
    or p_policy_value not in ('external_authoritative', 'cra_authoritative', 'newest_with_review', 'manual_only')
    or (coalesce(p_protected, false) and p_policy_value = 'external_authoritative')
    or (coalesce(p_protected, false) and char_length(btrim(coalesce(p_protected_reason, ''))) = 0)
    or (not coalesce(p_protected, false) and nullif(btrim(coalesce(p_protected_reason, '')), '') is not null)
    or p_preview_digest !~ '^[a-f0-9]{64}$' then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;

  select * into v_connector
  from public.connectors
  where organization_id = p_organization_id and id = p_connector_id and archived_at is null
  for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;

  select * into v_old
  from public.field_authority_policies
  where organization_id = p_organization_id and connector_id = p_connector_id
    and entity_type = p_entity_type and field_name = p_field_name and superseded_at is null
  for update;

  v_expected_digest := public.m2_v2_field_authority_policy_preview_digest(
    p_organization_id, p_connector_id, p_entity_type, p_field_name,
    p_policy_value, p_protected, p_protected_reason
  );
  if v_expected_digest is distinct from p_preview_digest then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;

  if v_old.id is not null then
    update public.field_authority_policies
    set superseded_at = now(), superseded_by_id = v_new_id
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
    jsonb_build_object('entityType', p_entity_type, 'field', p_field_name, 'policyValue', p_policy_value,
      'protected', v_new.protected, 'previewDigest', p_preview_digest));
  return query select 'updated'::text, jsonb_build_object(
    'id', v_new.id, 'connectorId', v_new.connector_id, 'entityType', v_new.entity_type, 'fieldName', v_new.field_name,
    'policyValue', v_new.policy_value, 'protected', v_new.protected, 'protectedReason', v_new.protected_reason,
    'policyVersion', v_new.policy_version
  );
end;
$$;
drop function public.upsert_field_authority_policy_atomic(uuid, uuid, uuid, text, text, text, boolean, text);

-- Persist plan items before resolving plan-bound conflicts. This lets a
-- first-seen child remain a `create` while carrying a real, durable review
-- blocker without inventing an external identity before product materializes.
create or replace function public.save_sync_run_plan_atomic(
  p_organization_id uuid, p_sync_run_id uuid, p_worker_id text,
  p_cursor_to text, p_fetch_content_hash text, p_plan_items jsonb, p_conflicts jsonb
) returns table(outcome text, run jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_run public.sync_runs%rowtype;
  v_connector public.connectors%rowtype;
  v_item jsonb;
  v_conflict jsonb;
  v_plan_item_id uuid;
  v_plan_item_count integer;
  v_inserted integer;
  v_plan_count integer := 0;
  v_create integer := 0;
  v_update integer := 0;
  v_unchanged integer := 0;
  v_skip integer := 0;
  v_conflict_ct integer := 0;
  v_tombstone integer := 0;
  v_cycle integer := 0;
  v_has_blockers boolean;
begin
  select * into v_run
  from public.sync_runs
  where organization_id = p_organization_id and id = p_sync_run_id and status = 'running'
    and lease_owner = btrim(p_worker_id) and lease_expires_at > now()
  for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if jsonb_typeof(p_plan_items) <> 'array' or jsonb_typeof(p_conflicts) <> 'array' then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;

  for v_item in select value from jsonb_array_elements(p_plan_items) loop
    if jsonb_typeof(v_item) <> 'object'
      or coalesce(v_item->>'proposedAction', '') not in (
        'create', 'update', 'unchanged', 'archive', 'conflict', 'ambiguous_match',
        'pending_required_fields', 'rejected', 'skipped_tombstone'
      )
      or coalesce(v_item->>'entityType', '') not in ('product', 'release')
      or char_length(btrim(coalesce(v_item->>'externalId', ''))) not between 1 and 500
      or not public.m2_v2_valid_sync_field_diffs(coalesce(v_item->'fieldDiffs', '{}'::jsonb))
      or jsonb_typeof(coalesce(v_item->'issues', '[]'::jsonb)) <> 'array' then
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
    v_plan_count := v_plan_count + 1;
    case v_item->>'proposedAction'
      when 'create' then v_create := v_create + 1;
      when 'update' then v_update := v_update + 1;
      when 'unchanged' then v_unchanged := v_unchanged + 1;
      when 'archive' then v_tombstone := v_tombstone + 1;
      when 'ambiguous_match', 'pending_required_fields', 'rejected' then v_skip := v_skip + 1;
      else null;
    end case;
  end loop;

  for v_conflict in select value from jsonb_array_elements(p_conflicts) loop
    if jsonb_typeof(v_conflict) <> 'object'
      or coalesce(v_conflict->>'entityType', '') not in ('product', 'release', 'baseline', 'relationship')
      or char_length(btrim(coalesce(v_conflict->>'fieldPath', ''))) not between 1 and 200
      or (nullif(v_conflict->>'externalIdentityId', '') is not null
        and nullif(v_conflict->>'planItemExternalId', '') is not null) then
      raise exception using errcode = '22023', message = 'invalid sync conflict target';
    end if;

    v_plan_item_id := null;
    if nullif(v_conflict->>'externalIdentityId', '') is not null then
      if not exists (
        select 1 from public.product_external_identities identities
        where identities.organization_id = p_organization_id
          and identities.id = (v_conflict->>'externalIdentityId')::uuid
          and identities.connector_id = v_run.connector_id
      ) then
        raise exception using errcode = '22023', message = 'invalid sync conflict identity';
      end if;
    elsif nullif(v_conflict->>'planItemExternalId', '') is not null then
      if nullif(v_conflict->>'entityId', '') is not null then
        raise exception using errcode = '22023', message = 'plan-bound sync conflict cannot name an unmapped entity';
      end if;
      select count(*) into v_plan_item_count
      from public.sync_run_plan_items items
      where items.organization_id = p_organization_id and items.sync_run_id = p_sync_run_id
        and items.external_id = v_conflict->>'planItemExternalId'
        and items.entity_type = v_conflict->>'entityType';
      if v_plan_item_count <> 1 then
        raise exception using errcode = '22023', message = 'ambiguous sync conflict plan item';
      end if;
      select id into v_plan_item_id
      from public.sync_run_plan_items items
      where items.organization_id = p_organization_id and items.sync_run_id = p_sync_run_id
        and items.external_id = v_conflict->>'planItemExternalId'
        and items.entity_type = v_conflict->>'entityType';
    else
      raise exception using errcode = '22023', message = 'missing sync conflict target';
    end if;

    insert into public.sync_conflicts(
      organization_id, connector_id, sync_run_id, external_identity_id, plan_item_id,
      entity_type, entity_id, field_path, conflict_kind, cra_value, cra_value_source,
      cra_value_observed_at, external_value, external_value_hash, external_value_observed_at,
      authority_policy_id, authority_policy_snapshot, permitted_actions, correlation_id
    ) values (
      p_organization_id, v_run.connector_id, p_sync_run_id,
      nullif(v_conflict->>'externalIdentityId', '')::uuid, v_plan_item_id,
      v_conflict->>'entityType', nullif(v_conflict->>'entityId', '')::uuid, v_conflict->>'fieldPath',
      coalesce(v_conflict->>'conflictKind', 'field_value'), coalesce(v_conflict->'craValue', 'null'::jsonb),
      coalesce(v_conflict->>'craValueSource', 'prior_sync_apply'),
      coalesce((v_conflict->>'craValueObservedAt')::timestamptz, now()),
      coalesce(v_conflict->'externalValue', 'null'::jsonb), v_conflict->>'externalValueHash',
      coalesce((v_conflict->>'externalValueObservedAt')::timestamptz, now()),
      nullif(v_conflict->>'authorityPolicyId', '')::uuid,
      coalesce(v_conflict->'authorityPolicySnapshot', '{}'::jsonb),
      coalesce((select array_agg(value #>> '{}')
        from jsonb_array_elements(coalesce(v_conflict->'permittedActions',
          '["accept_external","keep_cra","enter_manual_value"]'::jsonb))),
        array['accept_external', 'keep_cra', 'enter_manual_value']),
      v_run.correlation_id
    ) on conflict do nothing;
    get diagnostics v_inserted = row_count;
    v_conflict_ct := v_conflict_ct + v_inserted;
  end loop;

  v_has_blockers := v_conflict_ct > 0 or v_cycle > 0 or exists (
    select 1 from public.sync_run_plan_items items
    where items.organization_id = p_organization_id and items.sync_run_id = p_sync_run_id
      and items.proposed_action in ('ambiguous_match', 'pending_required_fields', 'rejected')
  );
  select * into v_connector
  from public.connectors
  where organization_id = p_organization_id and id = v_run.connector_id;

  update public.sync_runs set
    cursor_to = p_cursor_to, fetch_content_hash = p_fetch_content_hash,
    plan_basis_digest = encode(extensions.digest(jsonb_build_object(
      'adapterVersion', v_run.adapter_version, 'mappingVersion', v_run.mapping_version,
      'fetchContentHash', p_fetch_content_hash, 'cursorFrom', v_run.cursor_from
    )::text, 'sha256'), 'hex'),
    row_count = v_plan_count + v_conflict_ct,
    processed_count = v_plan_count + v_conflict_ct,
    create_count = v_create, update_count = v_update, unchanged_count = v_unchanged, skip_count = v_skip,
    conflict_count = v_conflict_ct, tombstone_count = v_tombstone, cycle_blocked_count = v_cycle,
    status = case when v_has_blockers or v_connector.commit_policy = 'manual' then 'waiting_for_review' else 'queued' end,
    work_kind = case when v_has_blockers or v_connector.commit_policy = 'manual' then 'dry_run' else 'commit' end,
    lease_owner = null, lease_expires_at = null, next_attempt_at = now()
  where organization_id = p_organization_id and id = p_sync_run_id
  returning * into v_run;
  return query select 'saved'::text, public.m2_v2_sync_run_json(v_run);
exception when invalid_text_representation or numeric_value_out_of_range or check_violation then
  return query select 'invalid_request'::text, null::jsonb;
end;
$$;

-- The worker has already selected an organization fairly. Claiming must never
-- lease a different tenant's run and strand it until lease expiry.
create function public.claim_sync_run(p_organization_id uuid, p_worker_id text, p_lease_seconds integer)
returns table(outcome text, run jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_run public.sync_runs%rowtype; v_connector public.connectors%rowtype;
begin
  if p_organization_id is null or char_length(btrim(coalesce(p_worker_id, ''))) not between 1 and 100
    or p_lease_seconds not between 10 and 300 then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  select runs.* into v_run
  from public.sync_runs runs
  join public.sync_connector_cursors cursors
    on cursors.organization_id = runs.organization_id and cursors.connector_id = runs.connector_id
  where runs.organization_id = p_organization_id
    and runs.status in ('queued', 'retrying') and runs.next_attempt_at <= now()
    and runs.expires_at > now() and (runs.lease_expires_at is null or runs.lease_expires_at <= now())
    and cursors.circuit_state <> 'open'
  order by runs.next_attempt_at, runs.created_at, runs.id
  for update of runs skip locked limit 1;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;

  select * into v_connector
  from public.connectors
  where organization_id = v_run.organization_id and id = v_run.connector_id;
  if v_connector.archived_at is not null or not v_connector.enabled then
    update public.sync_runs
    set status = 'failed', error_code = 'connector_disabled', lease_owner = null, lease_expires_at = null
    where organization_id = v_run.organization_id and id = v_run.id;
    return query select 'connector_disabled'::text, null::jsonb; return;
  end if;

  update public.sync_runs
  set status = 'running', lease_owner = btrim(p_worker_id),
    lease_expires_at = now() + make_interval(secs => p_lease_seconds), error_code = null
  where organization_id = v_run.organization_id and id = v_run.id
  returning * into v_run;
  return query select 'claimed'::text, public.m2_v2_sync_run_json(v_run);
end;
$$;
drop function public.claim_sync_run(text, integer);

create or replace function public.retry_sync_run_atomic(
  p_organization_id uuid,
  p_sync_run_id uuid,
  p_actor_user_id uuid
) returns table(outcome text, run jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_run public.sync_runs%rowtype; v_prior_error_code text;
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  select * into v_run
  from public.sync_runs
  where organization_id = p_organization_id and id = p_sync_run_id
  for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_run.status <> 'failed' then
    return query select 'invalid_state'::text, public.m2_v2_sync_run_json(v_run); return;
  end if;
  v_prior_error_code := v_run.error_code;

  -- This is an operator retry, not a fresh run. Preserve the phase and retry
  -- history so a failed commit replays its already-reviewed durable plan
  -- instead of running a new dry run (and creating duplicate plan rows).
  update public.sync_runs
  set status = 'queued', error_code = null,
    lease_owner = null, lease_expires_at = null, next_attempt_at = now(), expires_at = now() + interval '24 hours'
  where organization_id = p_organization_id and id = p_sync_run_id
  returning * into v_run;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'sync_run.retried', 'sync_run', p_sync_run_id::text,
    jsonb_build_object('priorErrorCode', v_prior_error_code));
  return query select 'queued'::text, public.m2_v2_sync_run_json(v_run);
end;
$$;

-- Resolving is the durable transition that releases a reviewed run for commit.
-- Keep the operational count in sync with the open-conflict query the commit
-- gate uses, but retain the historical count in the conflict/audit records.
create or replace function public.resolve_sync_conflict_atomic(
  p_organization_id uuid, p_conflict_id uuid, p_actor_user_id uuid, p_expected_version integer,
  p_chosen_action text, p_manual_value jsonb, p_reason text, p_correlation_id uuid
) returns table(outcome text, conflict jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_conflict public.sync_conflicts%rowtype;
  v_before jsonb;
  v_parent_external_id text;
  v_materialized_parent_count integer;
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id)
     or p_expected_version is null
     or char_length(btrim(coalesce(p_reason, ''))) not between 1 and 1000 then
    return query select 'not_found'::text, null::jsonb; return;
  end if;

  select * into v_conflict
  from public.sync_conflicts
  where organization_id = p_organization_id and id = p_conflict_id
  for update;
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

  -- A parent that has no durable connector identity yet can only be accepted
  -- when this exact run will create it. Do this before resolving the conflict:
  -- a reviewed decision must never become an edge to an ambiguous, skipped, or
  -- permission-hidden provider record.
  if p_chosen_action = 'accept_external' and v_conflict.field_path = 'parentExternalId' then
    if jsonb_typeof(v_conflict.external_value) <> 'object'
      or jsonb_typeof(v_conflict.external_value -> 'externalId') <> 'string'
      or jsonb_typeof(v_conflict.external_value -> 'materializedInPlan') <> 'boolean'
      or not (v_conflict.external_value ? 'parentExternalIdentityId')
      or not (v_conflict.external_value ? 'craParentProductId') then
      return query select 'invalid_request'::text, null::jsonb; return;
    end if;
    v_parent_external_id := btrim(v_conflict.external_value ->> 'externalId');
    if char_length(v_parent_external_id) not between 1 and 500 then
      return query select 'invalid_request'::text, null::jsonb; return;
    end if;
    if nullif(v_conflict.external_value ->> 'parentExternalIdentityId', '') is null then
      if (v_conflict.external_value ->> 'materializedInPlan')::boolean is not true then
        return query select 'invalid_request'::text, null::jsonb; return;
      end if;
      select count(*) into v_materialized_parent_count
      from public.sync_run_plan_items items
      where items.organization_id = p_organization_id
        and items.sync_run_id = v_conflict.sync_run_id
        and items.entity_type = 'product'
        and items.proposed_action = 'create'
        and items.external_id = v_parent_external_id;
      if v_materialized_parent_count <> 1 then
        return query select 'invalid_request'::text, null::jsonb; return;
      end if;
    end if;
  end if;

  v_before := public.m2_v2_sync_conflict_json(v_conflict);
  update public.sync_conflicts set
    resolution_status = 'resolved',
    resolution_chosen_action = p_chosen_action,
    resolution_value = case
      when p_chosen_action = 'enter_manual_value' then p_manual_value
      when p_chosen_action = 'accept_external' then v_conflict.external_value
      else v_conflict.cra_value
    end,
    resolution_reason = btrim(p_reason),
    resolved_by = p_actor_user_id,
    resolved_at = now(),
    resolved_against_external_value_hash = v_conflict.external_value_hash,
    version = version + 1,
    updated_at = now()
  where organization_id = p_organization_id and id = p_conflict_id
  returning * into v_conflict;

  update public.sync_runs
  set conflict_count = greatest(conflict_count - 1, 0)
  where organization_id = p_organization_id and id = v_conflict.sync_run_id;

  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, p_actor_user_id, 'conflict.resolved', 'sync_conflict', p_conflict_id::text,
    jsonb_build_object(
      'before', v_before,
      'after', public.m2_v2_sync_conflict_json(v_conflict),
      'correlationId', p_correlation_id
    )
  );
  return query select 'resolved'::text, public.m2_v2_sync_conflict_json(v_conflict);
end;
$$;

-- Commit product/release effects, their created external identities, reviewed
-- embedded hierarchy edges, and cursor advance inside one transaction.
create or replace function public.commit_sync_run_atomic(
  p_organization_id uuid, p_sync_run_id uuid, p_actor_user_id uuid,
  p_fetch_content_hash text, p_idempotency_key uuid, p_correlation_id uuid
) returns table(outcome text, run jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_run public.sync_runs%rowtype;
  v_cursor public.sync_connector_cursors%rowtype;
  v_connector public.connectors%rowtype;
  v_worker_actor uuid;
  v_item public.sync_run_plan_items%rowtype;
  v_product public.products%rowtype;
  v_release public.product_releases%rowtype;
  v_identity public.product_external_identities%rowtype;
  v_conflict public.sync_conflicts%rowtype;
  v_hierarchy_conflict public.sync_conflicts%rowtype;
  v_connector_owned_link public.product_relationships%rowtype;
  v_result record;
  v_hierarchy_result record;
  v_digest text;
  v_applied integer := 0;
  v_product_id uuid;
  v_release_id uuid;
  v_parent_product_id uuid;
  v_hierarchy_graph_version integer;
  v_connector_owned_link_count integer;
  v_parent_external_id text;
  v_parent_payload jsonb;
  v_parent_external_identity_id uuid;
  v_payload_parent_product_id uuid;
  v_materialized_in_plan boolean;
  v_parent_plan_item_count integer;
  v_hierarchy_effective_at timestamptz;
  v_hierarchy_provenance_prefix text;
  v_hierarchy_provenance text;
  v_overrides jsonb;
  v_name text;
  v_internal_code text;
  v_product_type text;
  v_description text;
  v_description_provided boolean;
  v_label text;
  v_release_version text;
  v_did_apply boolean;
  v_keep_cra_fields text[];
begin
  if p_idempotency_key is null or p_correlation_id is null or not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_sync_run_id::text, 2));

  select * into v_run
  from public.sync_runs
  where organization_id = p_organization_id and id = p_sync_run_id and status = 'running' and work_kind = 'commit'
  for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_run.fetch_content_hash is distinct from p_fetch_content_hash then
    update public.sync_runs
    set status = 'waiting_for_review', work_kind = 'dry_run', error_code = 'plan_basis_changed',
      lease_owner = null, lease_expires_at = null
    where organization_id = p_organization_id and id = p_sync_run_id
    returning * into v_run;
    return query select 'plan_basis_changed'::text, public.m2_v2_sync_run_json(v_run); return;
  end if;
  if exists (
    select 1 from public.sync_conflicts conflicts
    where conflicts.organization_id = p_organization_id and conflicts.sync_run_id = p_sync_run_id
      and conflicts.resolution_status = 'open'
  ) then
    update public.sync_runs
    set status = 'waiting_for_review', work_kind = 'dry_run', error_code = 'blocked_by_conflicts',
      lease_owner = null, lease_expires_at = null
    where organization_id = p_organization_id and id = p_sync_run_id
    returning * into v_run;
    return query select 'blocked_by_conflicts'::text, public.m2_v2_sync_run_json(v_run); return;
  end if;

  select * into v_connector
  from public.connectors
  where organization_id = p_organization_id and id = v_run.connector_id
  for update;
  if not found or v_connector.archived_at is not null or not v_connector.enabled then
    update public.sync_runs
    set status = 'failed', error_code = 'connector_disabled', lease_owner = null, lease_expires_at = null
    where organization_id = p_organization_id and id = p_sync_run_id
    returning * into v_run;
    return query select 'connector_disabled'::text, public.m2_v2_sync_run_json(v_run); return;
  end if;

  select * into v_cursor
  from public.sync_connector_cursors
  where organization_id = p_organization_id and connector_id = v_run.connector_id
  for update;
  if v_run.reconciliation_kind = 'incremental' and v_cursor.cursor is distinct from v_run.cursor_from then
    update public.sync_runs
    set status = 'waiting_for_review', work_kind = 'dry_run', error_code = 'cursor_drifted',
      lease_owner = null, lease_expires_at = null
    where organization_id = p_organization_id and id = p_sync_run_id
    returning * into v_run;
    return query select 'cursor_drifted'::text, public.m2_v2_sync_run_json(v_run); return;
  end if;

  v_worker_actor := coalesce(p_actor_user_id, public.resolve_connector_sync_worker_actor(p_organization_id));
  if v_worker_actor is null then return query select 'retryable_unavailable'::text, null::jsonb; return; end if;
  v_digest := encode(extensions.digest(jsonb_build_object('syncRunId', p_sync_run_id)::text, 'sha256'), 'hex');

  for v_item in
    select * from public.sync_run_plan_items items
    where items.organization_id = p_organization_id and items.sync_run_id = p_sync_run_id
      and items.proposed_action in ('create', 'update', 'archive', 'conflict')
      and items.applied_at is null
    order by case items.entity_type when 'product' then 0 else 1 end, items.created_at, items.id
  loop
    v_did_apply := false;
    v_overrides := '{}'::jsonb;
    v_keep_cra_fields := array[]::text[];
    if v_item.proposed_action = 'conflict' and v_item.entity_type in ('product', 'release') then
      for v_conflict in
        select * from public.sync_conflicts conflicts
        where conflicts.organization_id = p_organization_id and conflicts.sync_run_id = p_sync_run_id
          and conflicts.entity_type = v_item.entity_type
          and conflicts.entity_id = case when v_item.entity_type = 'product' then v_item.cra_product_id else v_item.cra_release_id end
          and conflicts.resolution_status = 'resolved'
          and conflicts.field_path in ('name', 'internalCode', 'productType', 'description', 'label', 'releaseVersion')
        order by conflicts.resolved_at, conflicts.id
      loop
        if v_conflict.resolution_chosen_action = 'accept_external' then
          v_overrides := v_overrides || jsonb_build_object(v_conflict.field_path, v_conflict.external_value);
        elsif v_conflict.resolution_chosen_action = 'enter_manual_value' then
          v_overrides := v_overrides || jsonb_build_object(v_conflict.field_path, v_conflict.resolution_value);
        else
          v_keep_cra_fields := array_append(v_keep_cra_fields, v_conflict.field_path);
        end if;
      end loop;
    end if;

    if v_item.entity_type = 'product' and v_item.proposed_action = 'create' then
      if not (v_item.field_diffs ? 'responsibleOwnerId') or not (v_item.field_diffs ? 'legalEntityId') then
        raise exception using errcode = '22023', message = format('sync commit rejected: create plan item %s is missing required bindings', v_item.id);
      end if;
      select * into v_result from public.create_product_atomic(
        p_organization_id, v_worker_actor, gen_random_uuid(),
        public.m2_v2_sync_text_field_value(public.m2_v2_sync_field_external_value(v_item.field_diffs, 'name'), false, 'name'),
        public.m2_v2_sync_text_field_value(public.m2_v2_sync_field_external_value(v_item.field_diffs, 'internalCode'), false, 'internalCode'),
        public.m2_v2_sync_text_field_value(public.m2_v2_sync_field_external_value(v_item.field_diffs, 'productType'), false, 'productType'),
        public.m2_v2_sync_text_field_value(public.m2_v2_sync_field_external_value(v_item.field_diffs, 'description'), true, 'description'),
        public.m2_v2_sync_text_field_value(public.m2_v2_sync_field_external_value(v_item.field_diffs, 'responsibleOwnerId'), false, 'responsibleOwnerId')::uuid,
        public.m2_v2_sync_text_field_value(public.m2_v2_sync_field_external_value(v_item.field_diffs, 'legalEntityId'), false, 'legalEntityId')::uuid
      );
      if v_result.outcome not in ('created', 'replayed') then
        raise exception using errcode = '22023', message = format('sync commit rejected: plan item %s returned outcome %s', v_item.id, v_result.outcome);
      end if;
      v_product_id := (v_result.product ->> 'id')::uuid;
      if v_product_id is null then
        raise exception using errcode = '22023', message = format('sync commit rejected: plan item %s returned no product id', v_item.id);
      end if;
      update public.sync_run_plan_items set cra_product_id = v_product_id
      where organization_id = p_organization_id and id = v_item.id;
      update public.sync_conflicts
      set entity_id = v_product_id
      where organization_id = p_organization_id and sync_run_id = p_sync_run_id
        and plan_item_id = v_item.id and entity_id is null;
      select * into v_identity from public.product_external_identities
      where organization_id = p_organization_id and connector_id = v_run.connector_id and entity_type = 'product'
        and external_id_normalized = lower(regexp_replace(normalize(v_item.external_id, nfkc), '\\s+', '', 'g'))
        and superseded_at is null and unlinked_at is null
      for update;
      if found and v_identity.cra_product_id is distinct from v_product_id then
        raise exception using errcode = '22023', message = format('sync commit rejected: external identity %s was linked concurrently', v_item.external_id);
      elsif not found then
        insert into public.product_external_identities(
          organization_id, connector_id, entity_type, external_id, cra_product_id, cra_release_id,
          match_method, match_confidence, linked_by, created_by, updated_by
        ) values (
          p_organization_id, v_run.connector_id, 'product', v_item.external_id, v_product_id, null,
          'adapter_asserted_id', 'certain', v_worker_actor, v_worker_actor, v_worker_actor
        ) returning * into v_identity;
        insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
        values (p_organization_id, v_worker_actor, 'product_external_identity.sync_created', 'product_external_identity', v_identity.id::text,
          jsonb_build_object('syncRunId', p_sync_run_id, 'externalId', v_item.external_id, 'craProductId', v_product_id));
      end if;
      v_did_apply := true;
    elsif v_item.entity_type = 'product' and v_item.proposed_action in ('update', 'conflict') then
      select * into v_product from public.products
      where organization_id = p_organization_id and id = v_item.cra_product_id
      for update;
      if not found then
        raise exception using errcode = '22023', message = format('sync commit rejected: plan item %s targets an entity that no longer exists', v_item.id);
      end if;
      v_name := v_product.name;
      v_internal_code := v_product.internal_code;
      v_product_type := v_product.product_type;
      v_description := v_product.description;
      v_description_provided := false;
      if v_item.field_diffs ? 'name' and not ('name' = any (v_keep_cra_fields)) then v_name := public.m2_v2_sync_text_field_value(public.m2_v2_sync_field_external_value(v_item.field_diffs, 'name'), false, 'name'); v_did_apply := true; end if;
      if v_item.field_diffs ? 'internalCode' and not ('internalCode' = any (v_keep_cra_fields)) then v_internal_code := public.m2_v2_sync_text_field_value(public.m2_v2_sync_field_external_value(v_item.field_diffs, 'internalCode'), false, 'internalCode'); v_did_apply := true; end if;
      if v_item.field_diffs ? 'productType' and not ('productType' = any (v_keep_cra_fields)) then v_product_type := public.m2_v2_sync_text_field_value(public.m2_v2_sync_field_external_value(v_item.field_diffs, 'productType'), false, 'productType'); v_did_apply := true; end if;
      if v_item.field_diffs ? 'description' and not ('description' = any (v_keep_cra_fields)) then v_description := public.m2_v2_sync_text_field_value(public.m2_v2_sync_field_external_value(v_item.field_diffs, 'description'), true, 'description'); v_description_provided := true; v_did_apply := true; end if;
      if v_overrides ? 'name' then v_name := public.m2_v2_sync_text_field_value(v_overrides -> 'name', false, 'name'); v_did_apply := true; end if;
      if v_overrides ? 'internalCode' then v_internal_code := public.m2_v2_sync_text_field_value(v_overrides -> 'internalCode', false, 'internalCode'); v_did_apply := true; end if;
      if v_overrides ? 'productType' then v_product_type := public.m2_v2_sync_text_field_value(v_overrides -> 'productType', false, 'productType'); v_did_apply := true; end if;
      if v_overrides ? 'description' then v_description := public.m2_v2_sync_text_field_value(v_overrides -> 'description', true, 'description'); v_description_provided := true; v_did_apply := true; end if;
      if v_did_apply then
        select * into v_result from public.update_product_atomic(
          p_organization_id, v_item.cra_product_id, v_worker_actor, coalesce(v_item.expected_version, v_product.version),
          v_name, v_internal_code, v_product_type, v_description, v_description_provided, null::uuid
        );
        if v_result.outcome not in ('updated', 'replayed') then
          raise exception using errcode = '22023', message = format('sync commit rejected: plan item %s returned outcome %s', v_item.id, v_result.outcome);
        end if;
      end if;
    elsif v_item.entity_type = 'product' and v_item.proposed_action = 'archive' then
      select * into v_product from public.products
      where organization_id = p_organization_id and id = v_item.cra_product_id
      for update;
      if not found then
        raise exception using errcode = '22023', message = format('sync commit rejected: plan item %s targets an entity that no longer exists', v_item.id);
      end if;
      select * into v_result from public.archive_product_atomic(
        p_organization_id, v_item.cra_product_id, v_worker_actor, coalesce(v_item.expected_version, v_product.version),
        'External system reported this product as removed.'::text
      );
      if v_result.outcome not in ('archived', 'replayed') then
        raise exception using errcode = '22023', message = format('sync commit rejected: plan item %s returned outcome %s', v_item.id, v_result.outcome);
      end if;
      v_did_apply := true;
    elsif v_item.entity_type = 'release' and v_item.proposed_action = 'create' then
      if v_item.cra_product_id is null then
        raise exception using errcode = '22023', message = format('sync commit rejected: release plan item %s has no product mapping', v_item.id);
      end if;
      select * into v_result from public.create_product_release_atomic(
        p_organization_id, v_item.cra_product_id, v_worker_actor, gen_random_uuid(),
        public.m2_v2_sync_text_field_value(public.m2_v2_sync_field_external_value(v_item.field_diffs, 'label'), false, 'label'),
        public.m2_v2_sync_text_field_value(public.m2_v2_sync_field_external_value(v_item.field_diffs, 'releaseVersion'), false, 'releaseVersion'),
        public.m2_v2_sync_text_field_value(public.m2_v2_sync_field_external_value(v_item.field_diffs, 'description'), true, 'description')
      );
      if v_result.outcome not in ('created', 'replayed') then
        raise exception using errcode = '22023', message = format('sync commit rejected: plan item %s returned outcome %s', v_item.id, v_result.outcome);
      end if;
      v_release_id := (v_result.release ->> 'id')::uuid;
      if v_release_id is null then
        raise exception using errcode = '22023', message = format('sync commit rejected: plan item %s returned no release id', v_item.id);
      end if;
      update public.sync_run_plan_items set cra_release_id = v_release_id
      where organization_id = p_organization_id and id = v_item.id;
      select * into v_identity from public.product_external_identities
      where organization_id = p_organization_id and connector_id = v_run.connector_id and entity_type = 'release'
        and external_id_normalized = lower(regexp_replace(normalize(v_item.external_id, nfkc), '\\s+', '', 'g'))
        and superseded_at is null and unlinked_at is null
      for update;
      if found and (v_identity.cra_product_id is distinct from v_item.cra_product_id or v_identity.cra_release_id is distinct from v_release_id) then
        raise exception using errcode = '22023', message = format('sync commit rejected: external identity %s was linked concurrently', v_item.external_id);
      elsif not found then
        insert into public.product_external_identities(
          organization_id, connector_id, entity_type, external_id, cra_product_id, cra_release_id,
          match_method, match_confidence, linked_by, created_by, updated_by
        ) values (
          p_organization_id, v_run.connector_id, 'release', v_item.external_id, v_item.cra_product_id, v_release_id,
          'adapter_asserted_id', 'certain', v_worker_actor, v_worker_actor, v_worker_actor
        ) returning * into v_identity;
        insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
        values (p_organization_id, v_worker_actor, 'product_external_identity.sync_created', 'product_external_identity', v_identity.id::text,
          jsonb_build_object('syncRunId', p_sync_run_id, 'externalId', v_item.external_id,
            'craProductId', v_item.cra_product_id, 'craReleaseId', v_release_id));
      end if;
      v_did_apply := true;
    elsif v_item.entity_type = 'release' and v_item.proposed_action in ('update', 'conflict') then
      select * into v_release from public.product_releases
      where organization_id = p_organization_id and id = v_item.cra_release_id and product_id = v_item.cra_product_id
      for update;
      if not found then
        raise exception using errcode = '22023', message = format('sync commit rejected: plan item %s targets an entity that no longer exists', v_item.id);
      end if;
      v_label := v_release.label;
      v_release_version := v_release.release_version;
      v_description := v_release.description;
      v_description_provided := false;
      if v_item.field_diffs ? 'label' and not ('label' = any (v_keep_cra_fields)) then v_label := public.m2_v2_sync_text_field_value(public.m2_v2_sync_field_external_value(v_item.field_diffs, 'label'), false, 'label'); v_did_apply := true; end if;
      if v_item.field_diffs ? 'releaseVersion' and not ('releaseVersion' = any (v_keep_cra_fields)) then v_release_version := public.m2_v2_sync_text_field_value(public.m2_v2_sync_field_external_value(v_item.field_diffs, 'releaseVersion'), false, 'releaseVersion'); v_did_apply := true; end if;
      if v_item.field_diffs ? 'description' and not ('description' = any (v_keep_cra_fields)) then v_description := public.m2_v2_sync_text_field_value(public.m2_v2_sync_field_external_value(v_item.field_diffs, 'description'), true, 'description'); v_description_provided := true; v_did_apply := true; end if;
      if v_overrides ? 'label' then v_label := public.m2_v2_sync_text_field_value(v_overrides -> 'label', false, 'label'); v_did_apply := true; end if;
      if v_overrides ? 'releaseVersion' then v_release_version := public.m2_v2_sync_text_field_value(v_overrides -> 'releaseVersion', false, 'releaseVersion'); v_did_apply := true; end if;
      if v_overrides ? 'description' then v_description := public.m2_v2_sync_text_field_value(v_overrides -> 'description', true, 'description'); v_description_provided := true; v_did_apply := true; end if;
      if v_did_apply then
        select * into v_result from public.update_product_release_atomic(
          p_organization_id, v_item.cra_product_id, v_item.cra_release_id, v_worker_actor,
          coalesce(v_item.expected_version, v_release.version), v_label, v_release_version,
          v_description, v_description_provided
        );
        if v_result.outcome not in ('updated', 'replayed') then
          raise exception using errcode = '22023', message = format('sync commit rejected: plan item %s returned outcome %s', v_item.id, v_result.outcome);
        end if;
      end if;
    elsif v_item.entity_type = 'release' and v_item.proposed_action = 'archive' then
      select * into v_release from public.product_releases
      where organization_id = p_organization_id and id = v_item.cra_release_id and product_id = v_item.cra_product_id
      for update;
      if not found then
        raise exception using errcode = '22023', message = format('sync commit rejected: plan item %s targets an entity that no longer exists', v_item.id);
      end if;
      select * into v_result from public.archive_product_release_atomic(
        p_organization_id, v_item.cra_product_id, v_item.cra_release_id, v_worker_actor,
        coalesce(v_item.expected_version, v_release.version), 'External system reported this release as removed.'::text
      );
      if v_result.outcome not in ('archived', 'replayed') then
        raise exception using errcode = '22023', message = format('sync commit rejected: plan item %s returned outcome %s', v_item.id, v_result.outcome);
      end if;
      v_did_apply := true;
    end if;

    update public.sync_run_plan_items set applied_at = now()
    where organization_id = p_organization_id and id = v_item.id;
    if v_did_apply then v_applied := v_applied + 1; end if;
  end loop;

  -- Product/release materialization precedes embedded structure. The hierarchy
  -- payload is plan-bound: it may name an already-persisted parent identity or
  -- a uniquely-created parent in this same run, but it is never globally
  -- re-resolved. Missing parent fields deliberately never end a relationship.
  v_hierarchy_provenance_prefix := 'connector-sync:v1:' || v_run.connector_id::text || ':';
  v_hierarchy_provenance := v_hierarchy_provenance_prefix || p_sync_run_id::text;
  for v_item in
    select *
    from public.sync_run_plan_items items
    where items.organization_id = p_organization_id and items.sync_run_id = p_sync_run_id
      and items.entity_type = 'product' and items.field_diffs ? 'parentExternalId'
    order by items.created_at, items.id
  loop
    if v_item.cra_product_id is null then
      raise exception using errcode = 'P0001', message = 'sync_hierarchy_review_required';
    end if;

    select * into v_hierarchy_conflict
    from public.sync_conflicts conflicts
    where conflicts.organization_id = p_organization_id
      and conflicts.sync_run_id = p_sync_run_id
      and conflicts.entity_type = 'product'
      and conflicts.field_path = 'parentExternalId'
      and conflicts.resolution_status = 'resolved'
      and (
        conflicts.plan_item_id = v_item.id
        or (
          conflicts.external_identity_id is not null
          and conflicts.entity_id = v_item.cra_product_id
        )
      )
    order by conflicts.resolved_at desc, conflicts.id desc
    limit 1
    for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'sync_hierarchy_review_required';
    end if;

    -- Existing children remain attached to their durable identity. A child
    -- created by this run remains attached to its own persisted plan item;
    -- after materialization we fill only entity_id for audit/read ergonomics.
    if v_hierarchy_conflict.external_identity_id is not null then
      select * into v_identity
      from public.product_external_identities identities
      where identities.organization_id = p_organization_id
        and identities.id = v_hierarchy_conflict.external_identity_id
        and identities.connector_id = v_run.connector_id
        and identities.entity_type = 'product'
        and identities.cra_product_id = v_item.cra_product_id
        and identities.superseded_at is null and identities.unlinked_at is null;
      if not found then
        raise exception using errcode = 'P0001', message = 'sync_hierarchy_review_required';
      end if;
    elsif v_hierarchy_conflict.plan_item_id is distinct from v_item.id then
      raise exception using errcode = 'P0001', message = 'sync_hierarchy_review_required';
    end if;

    if nullif(v_item.field_diffs -> 'parentExternalId' ->> 'authorityPolicyId', '') is null
      or v_item.field_diffs -> 'parentExternalId' ->> 'authorityPolicyId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or not exists (
        select 1 from public.field_authority_policies policies
        where policies.organization_id = p_organization_id
          and policies.connector_id = v_run.connector_id
          and policies.id = (v_item.field_diffs -> 'parentExternalId' ->> 'authorityPolicyId')::uuid
          and policies.id = v_hierarchy_conflict.authority_policy_id
          and policies.entity_type = 'product'
          and policies.field_name = 'parentExternalId'
          and policies.superseded_at is null
      ) then
      raise exception using errcode = 'P0001', message = 'sync_hierarchy_review_required';
    end if;

    v_parent_payload := public.m2_v2_sync_field_external_value(v_item.field_diffs, 'parentExternalId');
    if v_hierarchy_conflict.external_value is distinct from v_parent_payload
      or jsonb_typeof(v_parent_payload) <> 'object'
      or jsonb_typeof(v_parent_payload -> 'externalId') <> 'string'
      or jsonb_typeof(v_parent_payload -> 'materializedInPlan') <> 'boolean'
      or not (v_parent_payload ? 'craParentProductId')
      or not (v_parent_payload ? 'parentExternalIdentityId') then
      raise exception using errcode = 'P0001', message = 'sync_hierarchy_review_required';
    end if;
    v_parent_external_id := btrim(v_parent_payload ->> 'externalId');
    if char_length(v_parent_external_id) not between 1 and 500 then
      raise exception using errcode = 'P0001', message = 'sync_hierarchy_review_required';
    end if;
    v_materialized_in_plan := (v_parent_payload ->> 'materializedInPlan')::boolean;
    begin
      v_parent_external_identity_id := nullif(v_parent_payload ->> 'parentExternalIdentityId', '')::uuid;
      v_payload_parent_product_id := nullif(v_parent_payload ->> 'craParentProductId', '')::uuid;
    exception when others then
      raise exception using errcode = 'P0001', message = 'sync_hierarchy_review_required';
    end;

    if v_hierarchy_conflict.resolution_chosen_action = 'keep_cra' then
      continue;
    elsif v_hierarchy_conflict.resolution_chosen_action = 'enter_manual_value' then
      begin
        v_parent_product_id := public.m2_v2_sync_text_field_value(
          v_hierarchy_conflict.resolution_value, false, 'parentExternalId'
        )::uuid;
      exception when others then
        raise exception using errcode = 'P0001', message = 'sync_hierarchy_review_required';
      end;
      if not exists (
        select 1
        from public.product_external_identities identities
        where identities.organization_id = p_organization_id
          and identities.connector_id = v_run.connector_id
          and identities.entity_type = 'product'
          and identities.cra_product_id = v_parent_product_id
          and identities.superseded_at is null and identities.unlinked_at is null
      ) then
        raise exception using errcode = 'P0001', message = 'sync_hierarchy_review_required';
      end if;
    elsif v_hierarchy_conflict.resolution_chosen_action = 'accept_external' then
      if v_parent_external_identity_id is not null then
        if v_materialized_in_plan or v_payload_parent_product_id is null then
          raise exception using errcode = 'P0001', message = 'sync_hierarchy_review_required';
        end if;
        select * into v_identity
        from public.product_external_identities identities
        where identities.organization_id = p_organization_id
          and identities.id = v_parent_external_identity_id
          and identities.connector_id = v_run.connector_id
          and identities.entity_type = 'product'
          and identities.cra_product_id = v_payload_parent_product_id
          and identities.external_id_normalized = lower(regexp_replace(normalize(v_parent_external_id, nfkc), '\\s+', '', 'g'))
          and identities.superseded_at is null and identities.unlinked_at is null
        for update;
        if not found then
          raise exception using errcode = 'P0001', message = 'sync_hierarchy_review_required';
        end if;
        v_parent_product_id := v_identity.cra_product_id;
      else
        if not v_materialized_in_plan then
          raise exception using errcode = 'P0001', message = 'sync_hierarchy_review_required';
        end if;
        select count(*) into v_parent_plan_item_count
        from public.sync_run_plan_items parent_items
        where parent_items.organization_id = p_organization_id
          and parent_items.sync_run_id = p_sync_run_id
          and parent_items.entity_type = 'product'
          and parent_items.proposed_action = 'create'
          and parent_items.external_id = v_parent_external_id
          and parent_items.cra_product_id is not null;
        if v_parent_plan_item_count <> 1 then
          raise exception using errcode = 'P0001', message = 'sync_hierarchy_review_required';
        end if;
        select parent_items.cra_product_id into v_parent_product_id
        from public.sync_run_plan_items parent_items
        where parent_items.organization_id = p_organization_id
          and parent_items.sync_run_id = p_sync_run_id
          and parent_items.entity_type = 'product'
          and parent_items.proposed_action = 'create'
          and parent_items.external_id = v_parent_external_id
          and parent_items.cra_product_id is not null;
        if v_payload_parent_product_id is not null and v_payload_parent_product_id is distinct from v_parent_product_id then
          raise exception using errcode = 'P0001', message = 'sync_hierarchy_review_required';
        end if;
        select * into v_identity
        from public.product_external_identities identities
        where identities.organization_id = p_organization_id
          and identities.connector_id = v_run.connector_id
          and identities.entity_type = 'product'
          and identities.cra_product_id = v_parent_product_id
          and identities.external_id_normalized = lower(regexp_replace(normalize(v_parent_external_id, nfkc), '\\s+', '', 'g'))
          and identities.superseded_at is null and identities.unlinked_at is null
        for update;
        if not found then
          raise exception using errcode = 'P0001', message = 'sync_hierarchy_review_required';
        end if;
      end if;
    else
      raise exception using errcode = 'P0001', message = 'sync_hierarchy_review_required';
    end if;

    v_connector_owned_link := null;
    select count(*) into v_connector_owned_link_count
    from public.product_relationships relationships
    where relationships.organization_id = p_organization_id
      and relationships.relationship_type = 'embedded'
      and relationships.target_product_id = v_item.cra_product_id
      and relationships.ended_at is null
      and relationships.source = 'connector_sync'
      and relationships.provenance like v_hierarchy_provenance_prefix || '%';
    if v_connector_owned_link_count > 1 then
      raise exception using errcode = 'P0001', message = 'sync_hierarchy_review_required';
    end if;
    select * into v_connector_owned_link
    from public.product_relationships relationships
    where relationships.organization_id = p_organization_id
      and relationships.relationship_type = 'embedded'
      and relationships.target_product_id = v_item.cra_product_id
      and relationships.ended_at is null
      and relationships.source = 'connector_sync'
      and relationships.provenance like v_hierarchy_provenance_prefix || '%'
    order by relationships.effective_starts_at desc, relationships.id desc
    limit 1
    for update;

    if v_connector_owned_link.id is not null
      and v_connector_owned_link.source_product_id = v_parent_product_id then
      continue;
    end if;

    select product_relationship_graph_version into v_hierarchy_graph_version
    from public.organization_settings
    where organization_id = p_organization_id;
    if v_hierarchy_graph_version is null then
      raise exception using errcode = 'P0001', message = 'sync_hierarchy_review_required';
    end if;
    v_hierarchy_effective_at := clock_timestamp();

    -- `supersede_product_component_link_atomic` changes a component below the
    -- same parent, so it cannot model a parent switch. End only the exact
    -- connector-owned edge, then re-preview/create the new parent -> child
    -- edge against the returned graph version. Manual and other-connector
    -- edges are not selected by the bounded ownership query above.
    if v_connector_owned_link.id is not null then
      select * into v_hierarchy_result from public.end_product_component_link_atomic(
        p_organization_id, v_connector_owned_link.source_product_id, v_connector_owned_link.id, v_worker_actor,
        v_connector_owned_link.version, v_hierarchy_graph_version,
        'Approved external parent change from connector synchronization.', v_hierarchy_effective_at, p_correlation_id
      );
      if v_hierarchy_result.outcome <> 'ended' then
        raise exception using errcode = 'P0001', message = 'sync_hierarchy_review_required';
      end if;
      v_hierarchy_graph_version := v_hierarchy_result.graph_version;
    end if;

    select * into v_hierarchy_result from public.preview_product_component_link(
      p_organization_id, v_parent_product_id, v_item.cra_product_id, v_worker_actor,
      v_hierarchy_graph_version, null::uuid, null::uuid, 1,
      'connector_sync', v_hierarchy_provenance,
      'Approved external parent change from connector synchronization.', v_hierarchy_effective_at, null::timestamptz
    );
    if v_hierarchy_result.outcome <> 'allowed' then
      raise exception using errcode = 'P0001', message = 'sync_hierarchy_review_required';
    end if;

    select * into v_hierarchy_result from public.create_product_component_link_atomic(
      p_organization_id, v_parent_product_id, v_item.cra_product_id, v_worker_actor,
      v_hierarchy_graph_version, null::uuid, null::uuid, 1,
      'connector_sync', v_hierarchy_provenance,
      'Approved external parent change from connector synchronization.', v_hierarchy_effective_at, null::timestamptz,
      gen_random_uuid(), p_correlation_id
    );
    if v_hierarchy_result.outcome not in ('created', 'replayed') then
      raise exception using errcode = 'P0001', message = 'sync_hierarchy_review_required';
    end if;
    v_applied := v_applied + 1;
  end loop;

  update public.sync_connector_cursors set
    cursor = v_run.cursor_to, cursor_issued_at = now(), last_committed_run_id = v_run.id, last_committed_at = now(),
    last_full_reconciliation_at = case when v_run.reconciliation_kind = 'full' then now() else last_full_reconciliation_at end,
    consecutive_failure_count = 0, circuit_state = 'closed', circuit_opened_at = null, updated_at = now()
  where organization_id = p_organization_id and connector_id = v_run.connector_id;

  update public.sync_runs set
    status = 'completed', committed_at = now(), commit_idempotency_key = p_idempotency_key,
    commit_actor_user_id = p_actor_user_id, commit_request_digest = v_digest,
    lease_owner = null, lease_expires_at = null
  where organization_id = p_organization_id and id = p_sync_run_id
  returning * into v_run;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, coalesce(p_actor_user_id, v_worker_actor), 'sync_run.committed', 'sync_run', p_sync_run_id::text,
    jsonb_build_object('appliedCount', v_applied, 'cursorTo', v_run.cursor_to, 'correlationId', p_correlation_id));
  return query select 'completed'::text, public.m2_v2_sync_run_json(v_run);
exception when others then
  -- Re-preview/cursor/identity races are reviewable, not a partial product
  -- commit. The exception subtransaction has already rolled back all product,
  -- identity, and relationship effects before this state transition is stored.
  if SQLSTATE = 'P0001' and SQLERRM = 'sync_hierarchy_review_required' then
    update public.sync_runs
    set status = 'waiting_for_review', work_kind = 'dry_run', error_code = 'hierarchy_review_required',
      lease_owner = null, lease_expires_at = null
    where organization_id = p_organization_id and id = p_sync_run_id
    returning * into v_run;
    return query select 'waiting_for_review'::text, public.m2_v2_sync_run_json(v_run);
  end if;
  if v_run.retry_count >= 5 then
    update public.sync_runs set status = 'failed', error_code = 'commit_apply_failed', lease_owner = null, lease_expires_at = null
    where organization_id = p_organization_id and id = p_sync_run_id
    returning * into v_run;
    return query select 'failed'::text, public.m2_v2_sync_run_json(v_run);
  else
    update public.sync_runs set
      status = 'retrying', work_kind = 'commit', retry_count = retry_count + 1, error_code = 'commit_apply_failed',
      next_attempt_at = now() + make_interval(secs => least(300, (2 ^ retry_count)::int * 5)),
      lease_owner = null, lease_expires_at = null
    where organization_id = p_organization_id and id = p_sync_run_id
    returning * into v_run;
    return query select 'retrying'::text, public.m2_v2_sync_run_json(v_run);
  end if;
end;
$$;

-- Foreign-key indexes: existing claim/cursor/plan/run indexes already cover
-- their corresponding keys. These close the remaining connector-specific
-- parent-delete and actor-reference scans identified by the local advisor.
create index if not exists connector_secrets_connector_idx on public.connector_secrets(organization_id, connector_id);
create index if not exists connector_secrets_rotated_by_idx on public.connector_secrets(rotated_by);
create index if not exists connectors_secret_ref_idx on public.connectors(organization_id, secret_ref);
create index if not exists connectors_archived_by_idx on public.connectors(archived_by);
create index if not exists connectors_created_by_idx on public.connectors(created_by);
create index if not exists connectors_updated_by_idx on public.connectors(updated_by);
create index if not exists product_external_identities_connector_idx on public.product_external_identities(organization_id, connector_id);
create index if not exists product_external_identities_product_release_idx on public.product_external_identities(organization_id, cra_product_id, cra_release_id);
create index if not exists product_external_identities_supersedes_idx on public.product_external_identities(organization_id, supersedes_id);
create index if not exists product_external_identities_superseded_by_idx on public.product_external_identities(organization_id, superseded_by_id);
create index if not exists product_external_identities_linked_by_idx on public.product_external_identities(linked_by);
create index if not exists product_external_identities_unlinked_by_idx on public.product_external_identities(unlinked_by);
create index if not exists product_external_identities_created_by_idx on public.product_external_identities(created_by);
create index if not exists product_external_identities_updated_by_idx on public.product_external_identities(updated_by);
create index if not exists field_authority_policies_connector_idx on public.field_authority_policies(organization_id, connector_id);
create index if not exists field_authority_policies_supersedes_idx on public.field_authority_policies(organization_id, supersedes_id);
create index if not exists field_authority_policies_superseded_by_idx on public.field_authority_policies(organization_id, superseded_by_id);
create index if not exists field_authority_policies_created_by_idx on public.field_authority_policies(created_by);
create index if not exists field_authority_policies_updated_by_idx on public.field_authority_policies(updated_by);
create index if not exists sync_runs_actor_user_idx on public.sync_runs(actor_user_id);
create index if not exists sync_conflicts_connector_idx on public.sync_conflicts(organization_id, connector_id);
create index if not exists sync_conflicts_external_identity_idx on public.sync_conflicts(organization_id, external_identity_id);
create index if not exists sync_conflicts_authority_policy_idx on public.sync_conflicts(organization_id, authority_policy_id);
create index if not exists sync_conflicts_supersedes_idx on public.sync_conflicts(organization_id, supersedes_conflict_id);
create index if not exists sync_conflicts_resolved_by_idx on public.sync_conflicts(resolved_by);
create index if not exists sync_connector_cursors_last_committed_run_idx on public.sync_connector_cursors(organization_id, last_committed_run_id);
create index if not exists product_relationships_connector_sync_active_child_idx
  on public.product_relationships(organization_id, target_product_id, provenance, effective_starts_at desc, id desc)
  where relationship_type = 'embedded' and ended_at is null and source = 'connector_sync';

revoke all on function public.enforce_sync_run_status_transition() from public, anon, authenticated;
grant execute on function public.enforce_sync_run_status_transition() to service_role;
revoke all on function
  public.create_connector_atomic(uuid, uuid, uuid, text, text, text, text, jsonb, text),
  public.m2_v2_valid_field_authority_field(text, text),
  public.m2_v2_sync_run_json(public.sync_runs),
  public.m2_v2_valid_sync_field_diffs(jsonb),
  public.m2_v2_sync_field_external_value(jsonb, text),
  public.m2_v2_sync_text_field_value(jsonb, boolean, text),
  public.m2_v2_sync_conflict_json(public.sync_conflicts),
  public.m2_v2_field_authority_policy_preview_digest(uuid, uuid, text, text, text, boolean, text),
  public.preview_field_authority_policy(uuid, uuid, uuid, text, text, text, boolean, text),
  public.upsert_field_authority_policy_atomic(uuid, uuid, uuid, text, text, text, boolean, text, text),
  public.claim_sync_run(uuid, text, integer),
  public.save_sync_run_plan_atomic(uuid, uuid, text, text, text, jsonb, jsonb),
  public.retry_sync_run_atomic(uuid, uuid, uuid),
  public.resolve_sync_conflict_atomic(uuid, uuid, uuid, integer, text, jsonb, text, uuid),
  public.commit_sync_run_atomic(uuid, uuid, uuid, text, uuid, uuid)
from public, anon, authenticated;
grant execute on function
  public.create_connector_atomic(uuid, uuid, uuid, text, text, text, text, jsonb, text),
  public.m2_v2_valid_field_authority_field(text, text),
  public.m2_v2_sync_run_json(public.sync_runs),
  public.m2_v2_valid_sync_field_diffs(jsonb),
  public.m2_v2_sync_conflict_json(public.sync_conflicts),
  public.m2_v2_field_authority_policy_preview_digest(uuid, uuid, text, text, text, boolean, text),
  public.preview_field_authority_policy(uuid, uuid, uuid, text, text, text, boolean, text),
  public.upsert_field_authority_policy_atomic(uuid, uuid, uuid, text, text, text, boolean, text, text),
  public.claim_sync_run(uuid, text, integer),
  public.save_sync_run_plan_atomic(uuid, uuid, text, text, text, jsonb, jsonb),
  public.retry_sync_run_atomic(uuid, uuid, uuid),
  public.resolve_sync_conflict_atomic(uuid, uuid, uuid, integer, text, jsonb, text, uuid),
  public.commit_sync_run_atomic(uuid, uuid, uuid, text, uuid, uuid)
to service_role;
