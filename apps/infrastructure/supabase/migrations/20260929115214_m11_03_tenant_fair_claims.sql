-- Durable tenant fairness across more organizations than one worker tick can visit.
-- The most recent attempt is already recorded; no additional scheduler state is needed.
create index webhook_delivery_attempts_org_started_idx on public.webhook_delivery_attempts(organization_id,started_at desc);
create or replace function public.m1103_list_due_webhook_delivery_organizations(p_limit integer default 50)
returns table(organization_id uuid,oldest_due_at timestamptz)
language sql security definer set search_path=public,pg_temp as $$
 with due as (
  select d.organization_id,min(case when d.status='delivering' then d.lease_expires_at else d.next_attempt_at end) due_at
  from public.webhook_deliveries d join public.organizations o on o.id=d.organization_id and o.is_active
  where (d.status in ('pending','retrying') and d.next_attempt_at<=clock_timestamp()) or (d.status='delivering' and d.lease_expires_at<=clock_timestamp())
  group by d.organization_id
 )
 select d.organization_id,d.due_at from due d
 left join lateral (
  select a.started_at from public.webhook_delivery_attempts a where a.organization_id=d.organization_id order by a.started_at desc limit 1
 ) served on true
 order by served.started_at asc nulls first,d.due_at,d.organization_id
 limit greatest(1,least(100,coalesce(p_limit,50)))
$$;
alter function public.m1103_list_due_webhook_delivery_organizations(integer) owner to postgres;
revoke all on function public.m1103_list_due_webhook_delivery_organizations(integer) from public,anon,authenticated,service_role;
grant execute on function public.m1103_list_due_webhook_delivery_organizations(integer) to service_role;

-- Reuse the repository's timestamp trigger, including maintenance/health writes.
-- Rewrapping changes updated_at but never configuration or credential revisions.
create trigger webhook_endpoints_set_updated_at before update on public.webhook_endpoints for each row execute function public.set_updated_at();
create trigger webhook_deliveries_set_updated_at before update on public.webhook_deliveries for each row execute function public.set_updated_at();
-- Parent identity deletion must not scan every tenant's delivery/configuration history.
create index webhook_deliveries_authorization_actor_idx on public.webhook_deliveries(authorization_actor_user_id);
create index webhook_endpoint_commands_actor_idx on public.webhook_endpoint_commands(actor_user_id);
create index webhook_endpoints_authorization_actor_idx on public.webhook_endpoints(authorization_actor_user_id);
create index webhook_endpoints_created_by_idx on public.webhook_endpoints(created_by);
create index webhook_endpoints_updated_by_idx on public.webhook_endpoints(updated_by);
create index webhook_endpoints_disabled_by_idx on public.webhook_endpoints(disabled_by);
