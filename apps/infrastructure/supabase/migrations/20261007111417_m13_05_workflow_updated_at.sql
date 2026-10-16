-- Shared infrastructure gate: mutable workflow timestamps follow the existing trigger contract.
create trigger set_siem_destinations_updated_at before update on public.siem_destinations for each row execute function public.set_updated_at();
create trigger set_siem_deliveries_updated_at before update on public.siem_deliveries for each row execute function public.set_updated_at();
