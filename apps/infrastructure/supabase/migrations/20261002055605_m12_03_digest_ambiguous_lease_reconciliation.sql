-- An expired digest lease has an ambiguous SMTP outcome. Keep the batch
-- and source evidence until an explicit administrator retry.

create or replace function public.schedule_notification_digest_batches_atomic(
  p_organization_id uuid,p_now timestamptz default clock_timestamp(),p_limit integer default 1000
) returns table(outcome text,created integer,cancelled integer,deferred integer) language plpgsql security definer set search_path=public,pg_temp as $$
declare created_count integer; cancelled_count integer; deferred_count integer;
begin
  if p_organization_id is null or p_now is null or p_limit not between 1 and 10000 then
    return query select 'invalid_request',0,0,0; return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('notification-digest:'||p_organization_id::text,0));
  if not exists(select 1 from public.organization_settings where organization_id=p_organization_id and notification_delivery_mode='unified') then
    return query select 'legacy',0,0,0; return;
  end if;

  with invalid as (
    select d.id,coalesce(pref.modes->>d.category,'immediate') mode,
      case
        when d.effective_recipient_user_id is null or not exists(select 1 from public.organization_members m join public.users u on u.id=m.user_id and u.is_active where m.organization_id=d.organization_id and m.user_id=d.effective_recipient_user_id) then 'recipient_unavailable'
        when coalesce(pref.modes->>d.category,'immediate') not in ('daily','weekly') then 'preference_changed'
        when not public.m12_03_dispatch_source_valid(d.organization_id,d.id) then 'source_unavailable'
        else null
      end code
    from public.notification_dispatches d
    left join public.notification_preferences pref on pref.organization_id=d.organization_id and pref.user_id=d.effective_recipient_user_id
    where d.organization_id=p_organization_id and d.status='digest_pending'
      and not exists (
        select 1 from public.notification_digest_batches active_batch
        where active_batch.organization_id=d.organization_id
          and active_batch.status in ('queued','retrying','leased')
          and d.id=any(active_batch.dispatch_ids)
      )
  ), changed as (
    update public.notification_dispatches d
    set status=case when invalid.mode='immediate' and invalid.code='preference_changed' then 'queued' else 'cancelled' end,
      safe_error_code=case when invalid.mode='immediate' and invalid.code='preference_changed' then null
        when invalid.mode='off' and invalid.code='preference_changed' then 'preference_suppressed' else invalid.code end,
      next_attempt_at=case when invalid.mode='immediate' and invalid.code='preference_changed' then clock_timestamp() else d.next_attempt_at end,
      version=version+1
    from invalid where invalid.id=d.id and invalid.code is not null
    returning d.id
  ) select count(*)::integer into cancelled_count from changed;
  update public.evidence_document_notification_outbox n
  set status=case d.safe_error_code when 'preference_suppressed' then 'sent'
      when 'recipient_unavailable' then 'recipient_unavailable' else 'obsolete' end,
    sent_at=case when d.safe_error_code in ('preference_suppressed','recipient_unavailable') then clock_timestamp() else n.sent_at end,
    lease_owner=null,lease_expires_at=null,last_error=d.safe_error_code
  from public.notification_dispatches d
  where d.organization_id=p_organization_id and d.status='cancelled'
    and d.safe_error_code in ('preference_suppressed','recipient_unavailable','source_unavailable')
    and d.source_type like 'evidence_%' and n.organization_id=d.organization_id and n.id=d.source_id
    and n.status in ('queued','leased');

  with quiet_candidates as (
    select d.id,public.m12_03_first_local_occurrence(
      date_trunc('day',p_now at time zone pref.timezone)+pref.quiet_end
        + case when date_trunc('day',p_now at time zone pref.timezone)+pref.quiet_end
          <= p_now at time zone pref.timezone then interval '1 day' else interval '0 day' end,
      pref.timezone) next_attempt
    from public.notification_dispatches d
    join public.notification_preferences pref on pref.organization_id=d.organization_id and pref.user_id=d.effective_recipient_user_id
    cross join lateral public.m12_03_digest_window(pref.modes->>d.category,pref.timezone,pref.digest_local_time,pref.weekly_day,p_now) w
    where d.organization_id=p_organization_id and d.status='digest_pending'
      and (w.is_due or d.safe_error_code='quiet_hours_deferred')
      and public.m12_03_local_time_in_quiet((p_now at time zone pref.timezone)::time,pref.quiet_start,pref.quiet_end)
      and not exists(select 1 from public.notification_digest_batches existing
        where existing.organization_id=d.organization_id and existing.status not in ('cancelled','exhausted') and d.id=any(existing.dispatch_ids))
  ), changed as (
    update public.notification_dispatches d
    set safe_error_code='quiet_hours_deferred',next_attempt_at=q.next_attempt,version=version+1
    from quiet_candidates q where q.id=d.id and d.safe_error_code is distinct from 'quiet_hours_deferred'
    returning d.id
  ) select count(*)::integer into deferred_count from changed;

  with eligible as (
    select d.id,d.organization_id,d.category,d.effective_recipient_user_id user_id,pref.version preference_version,w.window_start,w.window_end,
      row_number() over(partition by d.organization_id,d.effective_recipient_user_id,d.category,w.window_start,w.window_end order by d.created_at,d.id) rn
    from public.notification_dispatches d
    join public.notification_preferences pref on pref.organization_id=d.organization_id and pref.user_id=d.effective_recipient_user_id
    cross join lateral public.m12_03_digest_window(pref.modes->>d.category,pref.timezone,pref.digest_local_time,pref.weekly_day,p_now) w
    where d.organization_id=p_organization_id and d.status='digest_pending'
      and (pref.modes->>d.category) in ('daily','weekly')
      and (w.is_due or d.safe_error_code='quiet_hours_deferred')
      and not public.m12_03_local_time_in_quiet((p_now at time zone pref.timezone)::time,pref.quiet_start,pref.quiet_end)
      and (d.safe_error_code is distinct from 'quiet_hours_deferred' or d.next_attempt_at<=p_now)
      and public.m12_03_dispatch_source_valid(d.organization_id,d.id)
      and not exists (
        select 1 from public.notification_digest_batches existing
        where existing.organization_id=d.organization_id and existing.status not in ('cancelled','exhausted') and d.id=any(existing.dispatch_ids)
      )
    order by d.created_at,d.id
    limit p_limit
  ), numbered as (
    select eligible.*,(((rn-1)/100)+1)::integer chunk_index from eligible
  ), grouped as (
    select organization_id,user_id,category,window_start,window_end,preference_version,
      (chunk_index+coalesce((
        select max(existing.batch_index) from public.notification_digest_batches existing
        where existing.organization_id=numbered.organization_id and existing.user_id=numbered.user_id
          and existing.category=numbered.category and existing.window_start=numbered.window_start
          and existing.window_end=numbered.window_end
      ),0))::integer batch_index,array_agg(id order by rn) dispatch_ids
    from numbered group by organization_id,user_id,category,window_start,window_end,preference_version,chunk_index
  ), inserted as (
    insert into public.notification_digest_batches(organization_id,user_id,category,window_start,window_end,preference_version,batch_index,dispatch_ids,next_attempt_at)
    select organization_id,user_id,category,window_start,window_end,preference_version,batch_index,dispatch_ids,clock_timestamp() from grouped
    on conflict(organization_id,user_id,category,window_start,window_end,batch_index) do nothing
    returning id
  ) select count(*)::integer into created_count from inserted;

  update public.notification_dispatches d set safe_error_code=null,version=version+1
  where d.organization_id=p_organization_id and d.status='digest_pending' and d.safe_error_code='quiet_hours_deferred'
    and exists(select 1 from public.notification_digest_batches b
      where b.organization_id=d.organization_id and b.status not in ('cancelled','exhausted') and d.id=any(b.dispatch_ids));

  return query select 'scheduled',coalesce(created_count,0),coalesce(cancelled_count,0),coalesce(deferred_count,0);
end $$;

create or replace function public.list_due_notification_digest_organizations_atomic(
  p_after_organization_id uuid default null,p_limit integer default 1000
) returns table(organization_id uuid) language sql stable security definer set search_path=public,pg_temp as $$
  select due.organization_id from (
    select b.organization_id from public.notification_digest_batches b
    join public.organization_settings s on s.organization_id=b.organization_id and s.notification_delivery_mode='unified'
    where b.next_attempt_at<=clock_timestamp() and b.status in ('queued','retrying')
    union
    select d.organization_id from public.notification_dispatches d
    join public.organization_settings s on s.organization_id=d.organization_id and s.notification_delivery_mode='unified'
    where d.status='digest_pending' and d.next_attempt_at<=clock_timestamp()
      and not exists(select 1 from public.notification_digest_batches b
        where b.organization_id=d.organization_id and b.status not in ('cancelled','exhausted') and d.id=any(b.dispatch_ids))
  ) due
  where p_limit between 1 and 10000
    and (p_after_organization_id is null or due.organization_id > p_after_organization_id)
  order by due.organization_id limit p_limit
$$;

create or replace function public.reconcile_notification_ambiguous_leases_atomic(
  p_now timestamptz default clock_timestamp(),p_limit integer default 1000
) returns table(outcome text,dispatches integer,digests integer)
language plpgsql security definer set search_path=public,pg_temp as $$
declare direct_count integer; child_count integer; digest_count integer;
begin
  if p_now is null or p_limit not between 1 and 10000 then
    return query select 'invalid_request',0,0; return;
  end if;

  with due as (
    select id from public.notification_dispatches
    where status='leased' and lease_expires_at<=p_now
    order by lease_expires_at,id limit p_limit for update skip locked
  ), changed as (
    update public.notification_dispatches d
    set status='exhausted',lease_owner=null,lease_expires_at=null,
      safe_error_code='lease_expired_ambiguous',version=version+1
    from due where due.id=d.id
    returning d.organization_id,d.id,d.source_type,d.attempt_count
  ), recorded as (
    insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
    select organization_id,'notification.dispatch_lease_ambiguous','notification_dispatch',id::text,
      jsonb_build_object('sourceType',source_type,'attempt',attempt_count)
    from changed returning 1
  ) select count(*)::integer into direct_count from recorded;

  with due as (
    select id from public.notification_digest_batches
    where status='leased' and lease_expires_at<=p_now
    -- Each batch has up to 100 children; cap one reconciliation transaction.
    order by lease_expires_at,id limit least(p_limit,100) for update skip locked
  ), changed as (
    update public.notification_digest_batches b
    set status='exhausted',lease_owner=null,lease_expires_at=null,
      safe_error_code='lease_expired_ambiguous',version=version+1
    from due where due.id=b.id
    returning b.organization_id,b.id,b.dispatch_ids,b.attempt_count
  ), children as (
    update public.notification_dispatches d
    set status='exhausted',safe_error_code='lease_expired_ambiguous',version=version+1
    from changed b
    where d.organization_id=b.organization_id and d.id=any(b.dispatch_ids)
      and d.status in ('digest_pending','queued','retrying')
    returning d.organization_id,d.id,d.source_type,d.attempt_count
  ), batch_facts as (
    insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
    select organization_id,'notification.digest_lease_ambiguous','notification_digest_batch',id::text,
      jsonb_build_object('itemCount',cardinality(dispatch_ids),'attempt',attempt_count)
    from changed returning 1
  ), child_facts as (
    insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
    select organization_id,'notification.dispatch_lease_ambiguous','notification_dispatch',id::text,
      jsonb_build_object('sourceType',source_type,'attempt',attempt_count)
    from children returning 1
  ) select (select count(*)::integer from batch_facts),(select count(*)::integer from child_facts)
    into digest_count,child_count;

  return query select 'reconciled',coalesce(direct_count,0)+coalesce(child_count,0),coalesce(digest_count,0);
end $$;

alter function public.schedule_notification_digest_batches_atomic(uuid,timestamptz,integer) owner to postgres;
alter function public.list_due_notification_digest_organizations_atomic(uuid,integer) owner to postgres;
alter function public.reconcile_notification_ambiguous_leases_atomic(timestamptz,integer) owner to postgres;

revoke all on function
  public.schedule_notification_digest_batches_atomic(uuid,timestamptz,integer),
  public.list_due_notification_digest_organizations_atomic(uuid,integer),
  public.reconcile_notification_ambiguous_leases_atomic(timestamptz,integer)
from public,anon,authenticated;

grant execute on function
  public.schedule_notification_digest_batches_atomic(uuid,timestamptz,integer),
  public.list_due_notification_digest_organizations_atomic(uuid,integer),
  public.reconcile_notification_ambiguous_leases_atomic(timestamptz,integer)
to service_role;
