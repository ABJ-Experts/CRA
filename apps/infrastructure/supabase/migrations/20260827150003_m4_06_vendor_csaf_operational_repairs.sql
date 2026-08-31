-- Complete the M4-06 operational surface without introducing another mirror
-- model. CSAF is a first-class feed configuration and must use source snapshot
-- time for freshness just like an offline bundle does.

create or replace function public.set_vulnerability_feed_configuration(
  p_feed_key text, p_enabled boolean, p_disabled_reason text default null,
  p_schedule_interval_seconds integer default null, p_stale_threshold_seconds integer default null
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_feed_key not in ('nvd', 'osv', 'cisa_kev', 'epss', 'github_advisory', 'vendor_csaf')
    or (not p_enabled and char_length(btrim(coalesce(p_disabled_reason, ''))) not between 1 and 500)
    or (p_enabled and p_disabled_reason is not null)
    or (p_schedule_interval_seconds is not null and p_schedule_interval_seconds not between 60 and 604800)
    or (p_stale_threshold_seconds is not null and p_stale_threshold_seconds not between 60 and 1209600) then
    return 'invalid_request';
  end if;
  update public.vulnerability_feed_configs set enabled = p_enabled,
    disabled_reason = case when p_enabled then null else btrim(p_disabled_reason) end,
    sync_state = case when p_enabled then case when last_success_at is null then 'never_synced' else 'healthy' end else 'disabled' end,
    freshness_state = case when p_enabled then case when last_success_at is null then 'never_synced' else 'healthy' end else 'disabled' end,
    schedule_interval_seconds = coalesce(p_schedule_interval_seconds, schedule_interval_seconds),
    stale_threshold_seconds = coalesce(p_stale_threshold_seconds, stale_threshold_seconds),
    next_scheduled_at = case when p_enabled then now() else next_scheduled_at end,
    lease_owner = null, lease_expires_at = null, updated_at = now()
  where feed_key = p_feed_key;
  if not found then return 'not_found'; end if;
  insert into public.vulnerability_feed_events(feed_key, event_type, detail)
  values (p_feed_key, case when p_enabled then 'feed_enabled' else 'feed_disabled' end,
    case when p_enabled then '{}'::jsonb else jsonb_build_object('reason', btrim(p_disabled_reason)) end);
  return case when p_enabled then 'enabled' else 'disabled' end;
end;
$$;

create or replace function public.vulnerability_feed_health_json(p_feed_key text default null)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'feedKey', configs.feed_key,
    'enabled', configs.enabled,
    'scheduleIntervalSeconds', configs.schedule_interval_seconds,
    'staleAfterSeconds', configs.stale_threshold_seconds,
    'staleThresholdSeconds', configs.stale_threshold_seconds,
    'syncState', configs.sync_state,
    'freshnessState', case
      when not configs.enabled then 'disabled'
      when coalesce(configs.last_source_snapshot_at, configs.last_success_at) is null then 'never_synced'
      when coalesce(configs.last_source_snapshot_at, configs.last_success_at) < now() - make_interval(secs => configs.stale_threshold_seconds) then 'stale'
      else 'healthy' end,
    'lastAttemptAt', configs.last_attempt_at,
    'lastSuccessAt', configs.last_success_at,
    'lastCompleteSnapshotAt', configs.last_complete_snapshot_at,
    'lastRecordCount', configs.last_record_count,
    'lastFailureCode', configs.last_failure_code,
    'lastFailureReason', configs.last_failure_reason,
    'lastFailureAt', configs.last_failure_at,
    'latestFailureAt', configs.last_failure_at,
    'nextScheduledAt', configs.next_scheduled_at,
    'queueDepth', (select count(*) from public.vulnerability_feed_sync_runs runs
      where runs.feed_key = configs.feed_key and runs.status in ('queued', 'failed')),
    'oldestQueuedAt', (select min(runs.created_at) from public.vulnerability_feed_sync_runs runs
      where runs.feed_key = configs.feed_key and runs.status in ('queued', 'failed')),
    'oldestQueuedAgeSeconds', (select greatest(0, floor(extract(epoch from now() - min(runs.created_at)))::integer)
      from public.vulnerability_feed_sync_runs runs
      where runs.feed_key = configs.feed_key and runs.status in ('queued', 'failed')),
    'deadLetterCount', (select count(*) from public.vulnerability_feed_sync_runs runs
      where runs.feed_key = configs.feed_key and runs.status = 'dead_letter'),
    'failureCount', (select count(*) from public.vulnerability_feed_sync_runs runs
      where runs.feed_key = configs.feed_key and runs.status in ('failed', 'dead_letter')),
    'currentRun', (select jsonb_build_object('id', runs.id, 'status', runs.status, 'startedAt', runs.started_at,
      'attemptCount', runs.attempt_count, 'leaseExpiresAt', runs.lease_expires_at)
      from public.vulnerability_feed_sync_runs runs where runs.feed_key = configs.feed_key and runs.status = 'processing'
      order by runs.started_at limit 1),
    'activeRunAgeSeconds', (select floor(extract(epoch from now() - runs.started_at))::integer
      from public.vulnerability_feed_sync_runs runs where runs.feed_key = configs.feed_key and runs.status = 'processing'
      order by runs.started_at limit 1),
    'mirrorAgeSeconds', case when coalesce(configs.last_source_snapshot_at, configs.last_success_at) is null then null
      else greatest(0, floor(extract(epoch from now() - coalesce(configs.last_source_snapshot_at, configs.last_success_at)))::integer) end
  ) order by configs.feed_key), '[]'::jsonb)
  from public.vulnerability_feed_configs configs
  where p_feed_key is null or configs.feed_key = p_feed_key;
$$;

create or replace function public.refresh_vulnerability_feed_freshness()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_config public.vulnerability_feed_configs%rowtype; v_next_state text; v_changed integer := 0;
begin
  for v_config in select * from public.vulnerability_feed_configs for update loop
    v_next_state := case when not v_config.enabled then 'disabled'
      when coalesce(v_config.last_source_snapshot_at, v_config.last_success_at) is null then 'never_synced'
      when coalesce(v_config.last_source_snapshot_at, v_config.last_success_at) < now() - make_interval(secs => v_config.stale_threshold_seconds) then 'stale'
      else 'healthy' end;
    if v_config.freshness_state <> v_next_state then
      update public.vulnerability_feed_configs set freshness_state = v_next_state, updated_at = now()
      where feed_key = v_config.feed_key;
      insert into public.vulnerability_feed_events(feed_key, event_type, detail)
      values (v_config.feed_key,
        case when v_next_state = 'stale' then 'freshness_stale' else 'freshness_recovered' end,
        jsonb_build_object('previousState', v_config.freshness_state, 'currentState', v_next_state));
      v_changed := v_changed + 1;
    end if;
  end loop;
  return v_changed;
end;
$$;

-- The scheduled worker and manual routes both configure CSAF. Replacing the
-- old allowlist prevents an accepted API feed key from failing below the port.
create or replace function public.request_vulnerability_feed_sync(
  p_feed_key text, p_actor_user_id uuid, p_idempotency_key uuid, p_correlation_id uuid
) returns table(outcome text, run jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_config public.vulnerability_feed_configs%rowtype; v_run public.vulnerability_feed_sync_runs%rowtype;
begin
  if p_feed_key not in ('nvd', 'osv', 'cisa_kev', 'epss', 'github_advisory', 'vendor_csaf')
    or p_actor_user_id is null or p_idempotency_key is null or p_correlation_id is null then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  select * into v_config from public.vulnerability_feed_configs where feed_key = p_feed_key for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if not v_config.enabled then return query select 'disabled'::text, null::jsonb; return; end if;
  select * into v_run from public.vulnerability_feed_sync_runs
  where feed_key = p_feed_key and requested_by = p_actor_user_id and idempotency_key = p_idempotency_key for update;
  if found then return query select 'replayed'::text, jsonb_build_object('id', v_run.id, 'status', v_run.status, 'feedKey', v_run.feed_key); return; end if;
  select * into v_run from public.vulnerability_feed_sync_runs
  where feed_key = p_feed_key and status in ('queued', 'processing', 'failed') for update;
  if found then return query select 'already_queued'::text, jsonb_build_object('id', v_run.id, 'status', v_run.status, 'feedKey', v_run.feed_key); return; end if;
  insert into public.vulnerability_feed_sync_runs(feed_key, run_kind, correlation_id, requested_by, idempotency_key)
  values (p_feed_key, 'manual', p_correlation_id, p_actor_user_id, p_idempotency_key) returning * into v_run;
  update public.vulnerability_feed_configs set next_scheduled_at = now(), updated_at = now() where feed_key = p_feed_key;
  insert into public.vulnerability_feed_events(feed_key, run_id, actor_user_id, correlation_id, event_type)
  values (p_feed_key, v_run.id, p_actor_user_id, p_correlation_id, 'sync_queued');
  return query select 'queued'::text, jsonb_build_object('id', v_run.id, 'status', v_run.status, 'feedKey', v_run.feed_key);
exception when unique_violation then
  select * into v_run from public.vulnerability_feed_sync_runs
  where feed_key = p_feed_key and requested_by = p_actor_user_id and idempotency_key = p_idempotency_key;
  if found then return query select 'replayed'::text, jsonb_build_object('id', v_run.id, 'status', v_run.status, 'feedKey', v_run.feed_key); return; end if;
  return query select 'already_queued'::text, null::jsonb;
end;
$$;

create or replace function public.replay_vulnerability_feed_sync(
  p_feed_key text, p_run_id uuid, p_actor_user_id uuid, p_idempotency_key uuid, p_correlation_id uuid
) returns table(outcome text, run jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_run public.vulnerability_feed_sync_runs%rowtype; v_replayed public.vulnerability_feed_sync_runs%rowtype;
begin
  if p_feed_key not in ('nvd', 'osv', 'cisa_kev', 'epss', 'github_advisory', 'vendor_csaf') or p_run_id is null
    or p_actor_user_id is null or p_idempotency_key is null or p_correlation_id is null then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  select * into v_replayed from public.vulnerability_feed_sync_runs where feed_key = p_feed_key
    and replayed_by = p_actor_user_id and replay_idempotency_key = p_idempotency_key for update;
  if found then
    if v_replayed.id = p_run_id then return query select 'replayed'::text,
      jsonb_build_object('id', v_replayed.id, 'status', v_replayed.status, 'feedKey', v_replayed.feed_key); return; end if;
    return query select 'idempotency_mismatch'::text, null::jsonb; return;
  end if;
  select * into v_run from public.vulnerability_feed_sync_runs where id = p_run_id and feed_key = p_feed_key for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_run.status <> 'dead_letter' then return query select 'invalid_state'::text,
    jsonb_build_object('id', v_run.id, 'status', v_run.status, 'feedKey', v_run.feed_key); return; end if;
  update public.vulnerability_feed_sync_runs set status = 'queued', attempt_count = 0, next_attempt_at = now(),
    failure_code = null, failure_reason = null, dead_lettered_at = null, replay_idempotency_key = p_idempotency_key,
    replayed_by = p_actor_user_id, replayed_at = now(), correlation_id = p_correlation_id, updated_at = now()
  where id = p_run_id returning * into v_run;
  insert into public.vulnerability_feed_events(feed_key, run_id, actor_user_id, correlation_id, event_type)
  values (p_feed_key, v_run.id, p_actor_user_id, p_correlation_id, 'sync_replayed');
  return query select 'queued'::text, jsonb_build_object('id', v_run.id, 'status', v_run.status, 'feedKey', v_run.feed_key);
exception when unique_violation then
  select * into v_replayed from public.vulnerability_feed_sync_runs where feed_key = p_feed_key
    and replayed_by = p_actor_user_id and replay_idempotency_key = p_idempotency_key;
  if found and v_replayed.id = p_run_id then return query select 'replayed'::text,
    jsonb_build_object('id', v_replayed.id, 'status', v_replayed.status, 'feedKey', v_replayed.feed_key); return; end if;
  return query select 'idempotency_mismatch'::text, null::jsonb;
end;
$$;

-- A preflight summary becomes meaningful only after every verified record has
-- reached durable staging. The projection compares that complete snapshot to
-- the currently promoted source records without exposing payload contents.
create or replace function public.vulnerability_offline_bundle_import_json(p_import_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with staged as (
    select runs.feed_key, records.source_record_key, records.record_sha256
    from public.vulnerability_feed_sync_runs runs
    join public.vulnerability_feed_staged_records records on records.run_id = runs.id
    where runs.bundle_import_id = p_import_id
  ), estimates as (
    select
      count(*) filter (where sources.id is null)::integer as records_to_create,
      count(*) filter (where sources.id is not null and versions.record_sha256 is distinct from staged.record_sha256)::integer as records_to_update,
      0::integer as records_to_withdraw
    from staged
    left join public.vulnerability_source_records sources
      on sources.feed_key = staged.feed_key and sources.source_record_key = staged.source_record_key
    left join public.vulnerability_source_record_versions versions on versions.id = sources.current_version_id
  ), withdrawals as (
    select count(*)::integer as records_to_withdraw
    from public.vulnerability_feed_sync_runs runs
    join public.vulnerability_source_records sources on sources.feed_key = runs.feed_key
    join public.vulnerability_source_record_versions versions on versions.id = sources.current_version_id
    left join staged on staged.feed_key = sources.feed_key and staged.source_record_key = sources.source_record_key
    where runs.bundle_import_id = p_import_id and staged.source_record_key is null and versions.record_state = 'active'
  )
  select case when imports.id is null then null else jsonb_build_object(
    'id', imports.id,
    'status', case imports.status when 'staging' then 'awaiting_confirmation' when 'promoting' then 'promoting'
      when 'completed' then 'completed' when 'rejected' then 'rejected' else 'failed' end,
    'bundleSha256', imports.manifest_sha256, 'manifest', imports.signed_manifest,
    'signature', imports.verification_receipt, 'compatibility', jsonb_build_object('status', 'compatible', 'reason', null),
    'estimatedChanges', jsonb_build_object('recordsToCreate', coalesce(estimates.records_to_create, 0),
      'recordsToUpdate', coalesce(estimates.records_to_update, 0), 'recordsToWithdraw', coalesce(withdrawals.records_to_withdraw, 0)),
    'sourceSnapshotAt', (select max(runs.source_snapshot_at) from public.vulnerability_feed_sync_runs runs where runs.bundle_import_id = imports.id),
    'sourceSnapshotAgeSeconds', (select least(2147483647::numeric, greatest(0::numeric,
      extract(epoch from clock_timestamp() - max(runs.source_snapshot_at))))::integer from public.vulnerability_feed_sync_runs runs where runs.bundle_import_id = imports.id),
    'failureCode', case imports.failure_code when 'rollback_rejected' then 'bundle_rollback_rejected'
      when 'incompatible_version' then 'compatibility_incompatible' when 'insufficient_storage' then 'disk_capacity_unavailable'
      when 'invalid_manifest' then 'manifest_invalid' when 'payload_hash_mismatch' then 'payload_hash_mismatch'
      when 'payload_inventory_invalid' then 'payload_inventory_invalid' when 'invalid_signature' then 'signature_invalid'
      when 'untrusted_key' then 'untrusted_key' when 'key_revoked' then 'untrusted_key' when 'key_expired' then 'untrusted_key'
      else case when imports.failure_code is null then null else 'unknown' end end,
    'createdAt', imports.created_at, 'updatedAt', imports.updated_at, 'completedAt', imports.completed_at,
    'runs', coalesce((select jsonb_agg(jsonb_build_object('id', runs.id, 'feedKey', runs.feed_key) order by runs.feed_key)
      from public.vulnerability_feed_sync_runs runs where runs.bundle_import_id = imports.id), '[]'::jsonb)
  ) end
  from public.vulnerability_offline_bundle_imports imports
  left join estimates on true left join withdrawals on true
  where imports.id = p_import_id;
$$;

alter function public.set_vulnerability_feed_configuration(text, boolean, text, integer, integer) owner to postgres;
alter function public.vulnerability_feed_health_json(text) owner to postgres;
alter function public.request_vulnerability_feed_sync(text, uuid, uuid, uuid) owner to postgres;
alter function public.replay_vulnerability_feed_sync(text, uuid, uuid, uuid, uuid) owner to postgres;
alter function public.refresh_vulnerability_feed_freshness() owner to postgres;
alter function public.vulnerability_offline_bundle_import_json(uuid) owner to postgres;
revoke all on function public.set_vulnerability_feed_configuration(text, boolean, text, integer, integer),
  public.vulnerability_feed_health_json(text), public.request_vulnerability_feed_sync(text, uuid, uuid, uuid),
  public.replay_vulnerability_feed_sync(text, uuid, uuid, uuid, uuid), public.refresh_vulnerability_feed_freshness() from public, anon, authenticated;
revoke all on function public.vulnerability_offline_bundle_import_json(uuid) from public, anon, authenticated;
grant execute on function public.set_vulnerability_feed_configuration(text, boolean, text, integer, integer),
  public.vulnerability_feed_health_json(text), public.request_vulnerability_feed_sync(text, uuid, uuid, uuid),
  public.replay_vulnerability_feed_sync(text, uuid, uuid, uuid, uuid), public.refresh_vulnerability_feed_freshness() to service_role;
grant execute on function public.vulnerability_offline_bundle_import_json(uuid) to service_role;
