-- Keep routing timestamps enforced by the same trigger as existing mutable tables.
create trigger set_workflow_task_groups_updated_at
 before update on public.workflow_task_groups
 for each row execute function public.set_updated_at();

create trigger set_workflow_task_routes_updated_at
 before update on public.workflow_task_routes
 for each row execute function public.set_updated_at();
