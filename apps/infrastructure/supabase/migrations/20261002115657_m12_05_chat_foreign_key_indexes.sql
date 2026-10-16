-- Cover tenant-owned foreign keys used during account deletion and retention.
create index notification_chat_channels_created_by_fk_idx
  on public.notification_chat_channels(created_by_user_id);
create index notification_chat_channels_last_command_actor_fk_idx
  on public.notification_chat_channels(last_command_actor)
  where last_command_actor is not null;
create index notification_chat_deliveries_last_retry_actor_fk_idx
  on public.notification_chat_deliveries(last_retry_actor)
  where last_retry_actor is not null;
