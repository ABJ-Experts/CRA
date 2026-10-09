-- Keep environments that applied the initial M4-06 bundle migration aligned
-- with the finalized offline-bundle event vocabulary.
alter table public.vulnerability_feed_events
  drop constraint if exists vulnerability_feed_events_event_type_check,
  add constraint vulnerability_feed_events_event_type_check check (event_type in (
    'sync_queued', 'sync_claimed', 'checkpoint_saved', 'staging_completed', 'sync_promoted',
    'sync_failed', 'sync_dead_lettered', 'sync_replayed', 'freshness_stale', 'freshness_recovered',
    'feed_disabled', 'feed_enabled', 'offline_bundle_staging_started'
  ));
