-- Source freshness, not the transport completion time, is authoritative for
-- an imported mirror's operator-visible age and healthy/stale state.
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
    'sourceSnapshotAt', configs.last_source_snapshot_at,
    'sourceSnapshotAgeSeconds', case when configs.last_source_snapshot_at is null then null
      else greatest(0, floor(extract(epoch from now() - configs.last_source_snapshot_at))::integer) end,
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

alter function public.vulnerability_feed_health_json(text) owner to postgres;
revoke all on function public.vulnerability_feed_health_json(text) from public, anon, authenticated;
grant execute on function public.vulnerability_feed_health_json(text) to service_role;
