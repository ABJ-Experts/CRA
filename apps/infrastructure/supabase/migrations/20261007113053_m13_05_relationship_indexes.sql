-- Cover source-evidence, replay ancestry, attempt history and authority foreign keys.
create index siem_deliveries_source_event on public.siem_deliveries(event_id,organization_id);
create index siem_deliveries_replay_parent on public.siem_deliveries(replay_of,organization_id) where replay_of is not null;
create index siem_attempt_delivery_history on public.siem_delivery_attempts(organization_id,delivery_id,created_at);
create index siem_destination_authority on public.siem_destinations(authority_user_id,organization_id);
