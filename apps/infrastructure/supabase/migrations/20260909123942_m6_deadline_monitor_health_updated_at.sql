-- Keep the singleton operational-health record inside the repository-wide
-- mutable-record invariant. The monitor still supplies database time for its
-- authority fields; this trigger owns its generic update timestamp.
drop trigger if exists set_reporting_deadline_monitor_health_updated_at
  on public.reporting_deadline_monitor_health;
create trigger set_reporting_deadline_monitor_health_updated_at
  before update on public.reporting_deadline_monitor_health
  for each row execute function public.set_updated_at();
