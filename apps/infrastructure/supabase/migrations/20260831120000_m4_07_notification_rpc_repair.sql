-- Align the already-applied local M4-07 notification worker boundary.
create or replace function public.list_due_vulnerability_finding_review_notification_orgs(p_limit integer default 1000)
returns table(organization_id uuid) language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_limit not between 1 and 1000 then return; end if;
  return query select distinct e.organization_id from public.vulnerability_finding_review_events e
  where e.review_state='open' and e.notification_due_at<=clock_timestamp()
    and (e.notification_status in ('queued','retrying') or (e.notification_status='leased' and e.notification_lease_expires_at<=clock_timestamp()))
  order by e.organization_id limit p_limit;
end; $$;
create or replace function public.get_vulnerability_finding_review_notification_details(p_organization_id uuid,p_event_id uuid)
returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_organization_id is null or p_event_id is null then return query select 'not_found',null::jsonb; return; end if;
  return query select 'found',jsonb_build_object('recipient',jsonb_build_object('userId',u.id,'email',u.email),'review',jsonb_build_object('advisoryId',s.source_record_key,'transition',replace(e.transition_kind,'advisory_',''),'reviewState',case when e.review_state='open' then 'review_required' else 'no_review_required' end))
  from public.vulnerability_finding_review_events e join public.vulnerability_source_records s on s.id=e.source_record_id join public.organization_members m on m.organization_id=e.organization_id and m.role in ('owner','admin') join public.users u on u.id=m.user_id and u.is_active
  where e.organization_id=p_organization_id and e.id=p_event_id order by case m.role when 'owner' then 0 else 1 end,u.id limit 1;
  if not found then return query select 'not_found',null::jsonb; end if;
end; $$;
alter function public.list_due_vulnerability_finding_review_notification_orgs(integer) owner to postgres;
alter function public.get_vulnerability_finding_review_notification_details(uuid,uuid) owner to postgres;
revoke all on function public.list_due_vulnerability_finding_review_notification_orgs(integer),public.get_vulnerability_finding_review_notification_details(uuid,uuid) from public,anon,authenticated;
grant execute on function public.list_due_vulnerability_finding_review_notification_orgs(integer),public.get_vulnerability_finding_review_notification_details(uuid,uuid) to service_role;
