-- Support public.users deletion without a full scan of per-user read state.
create index notification_feed_reads_user_fk_idx
  on public.notification_feed_reads(user_id,organization_id);

create or replace function public.list_notification_feed_cleanup_organizations_atomic(p_limit integer)
returns table(organization_id uuid)
language sql stable security definer set search_path=public,pg_temp as $$
  select r.organization_id from public.notification_feed_reads r
  where p_limit between 1 and 100
    and r.event_occurred_at<statement_timestamp()-interval '180 days'
  group by r.organization_id order by min(r.event_occurred_at),r.organization_id limit p_limit
$$;
