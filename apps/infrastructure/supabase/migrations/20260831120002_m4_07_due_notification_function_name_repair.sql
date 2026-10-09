-- PostgreSQL identifiers are limited to 63 bytes. Retain the accidentally
-- truncated legacy RPC with no executable grants and expose the short name.
do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'list_due_vulnerability_finding_review_notification_organization'
      and pg_get_function_identity_arguments(p.oid) = 'p_limit integer'
  ) then
    execute 'revoke all on function public.list_due_vulnerability_finding_review_notification_organization(integer) from public,anon,authenticated,service_role';
  end if;
end $$;
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
