create or replace function public.list_due_vulnerability_finding_review_notification_orgs(p_limit integer default 1000)
returns table(organization_id uuid) language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_limit not between 1 and 1000 then return; end if;
  return query select distinct e.organization_id from public.vulnerability_finding_review_events e
  where e.review_state='open' and e.notification_due_at<=clock_timestamp()
    and (e.notification_status in ('queued','retrying') or (e.notification_status='leased' and e.notification_lease_expires_at<=clock_timestamp()))
  order by e.organization_id limit p_limit;
end; $$;
alter function public.list_due_vulnerability_finding_review_notification_orgs(integer) owner to postgres;
revoke all on function public.list_due_vulnerability_finding_review_notification_orgs(integer) from public,anon,authenticated;
grant execute on function public.list_due_vulnerability_finding_review_notification_orgs(integer) to service_role;
