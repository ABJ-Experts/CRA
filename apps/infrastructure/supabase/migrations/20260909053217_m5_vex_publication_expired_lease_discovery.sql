-- A crashed worker leaves an expired lease. Include it in the durable worker's
-- discovery query so its existing claim RPC can recover the job.
create or replace function public.list_vulnerability_vex_publication_due_organizations(
  p_limit integer default 50
) returns table(organization_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select jobs.organization_id
  from public.vulnerability_vex_publication_jobs jobs
  where (
    jobs.delivery_state in ('pending', 'retrying')
    and jobs.next_attempt_at <= clock_timestamp()
  ) or (
    jobs.delivery_state = 'leased'
    and jobs.lease_expires_at <= clock_timestamp()
  )
  group by jobs.organization_id order by min(jobs.next_attempt_at), jobs.organization_id
  limit greatest(1, least(coalesce(p_limit, 50), 200))
$$;

alter function public.list_vulnerability_vex_publication_due_organizations(integer) owner to postgres;
revoke all on function public.list_vulnerability_vex_publication_due_organizations(integer)
  from public, anon, authenticated;
grant execute on function public.list_vulnerability_vex_publication_due_organizations(integer)
  to service_role;
