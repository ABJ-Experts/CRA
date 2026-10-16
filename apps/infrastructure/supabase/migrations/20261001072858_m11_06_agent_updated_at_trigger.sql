-- Keep agent identity/health timestamps aligned with every other updated_at table.
create trigger connector_agents_set_updated_at before update on public.connector_agents
 for each row execute function public.set_updated_at();
