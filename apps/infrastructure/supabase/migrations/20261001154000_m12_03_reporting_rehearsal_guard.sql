-- Restore M6-07's rehearsal exclusion after M12-03 replaced this producer.
-- Synthetic stages may still be evaluated, but never publish legal alerts.
create or replace function public.m6_materialize_reporting_deadline_alerts(
  p_organization_id uuid,p_stage_id uuid,p_database_now timestamptz
) returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_stage public.reporting_obligation_stages%rowtype; v_obligation public.reporting_obligations%rowtype;
  v_threshold integer; v_elapsed integer; v_alert_id uuid; v_created integer:=0;
begin
 select s.* into v_stage from public.reporting_obligation_stages s
 where s.organization_id=p_organization_id and s.id=p_stage_id for update;
 if not found or v_stage.due_at is null then return 0; end if;
 select o.* into v_obligation from public.reporting_obligations o
 where o.organization_id=p_organization_id and o.id=v_stage.obligation_id;
 if not found or v_obligation.status='cancelled' or v_obligation.is_rehearsal then return 0; end if;
 v_elapsed:=public.m6_reporting_stage_elapsed_percent(p_organization_id,p_stage_id,p_database_now);
 if v_elapsed is null then return 0; end if;
 for v_threshold in select unnest(array[50,75,90,100]) loop
  if v_elapsed<v_threshold then continue; end if;
  v_alert_id:=null;
  insert into public.reporting_deadline_alerts(organization_id,obligation_id,stage_id,deadline_revision,threshold_percent,idempotency_key,threshold_crossed_at,due_at)
   values(p_organization_id,v_stage.obligation_id,v_stage.id,v_stage.deadline_revision,v_threshold,concat('reporting-deadline:',v_stage.id::text,':',v_stage.deadline_revision::text,':',v_threshold::text),date_trunc('second',p_database_now),v_stage.due_at)
   on conflict(stage_id,deadline_revision,threshold_percent) do nothing returning id into v_alert_id;
  if v_alert_id is null then continue; end if;
  insert into public.reporting_obligation_events(organization_id,obligation_id,event_kind,stage_kind,occurred_at,new_value)
   values(p_organization_id,v_stage.obligation_id,case when v_threshold=100 then 'deadline_breached' else 'deadline_threshold_crossed' end,v_stage.stage_kind,date_trunc('second',p_database_now),jsonb_build_object('thresholdPercent',v_threshold,'deadlineRevision',v_stage.deadline_revision,'dueAt',public.m6_utc_second_z(v_stage.due_at),'elapsedPercent',v_elapsed));
  insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
   values(p_organization_id,case when v_threshold=100 then 'reporting.deadline_breached.high' else 'reporting.deadline_threshold_crossed' end,'reporting_obligation',v_stage.obligation_id::text,jsonb_build_object('stage',v_stage.stage_kind,'thresholdPercent',v_threshold,'deadlineRevision',v_stage.deadline_revision,'dueAt',public.m6_utc_second_z(v_stage.due_at),'severity',case when v_threshold=100 then 'high' else 'warning' end));
  insert into public.reporting_deadline_alert_deliveries(organization_id,alert_id,recipient_user_id,original_recipient_user_id,channel,due_at)
   select p_organization_id,v_alert_id,(route.recipient->>'userId')::uuid,m.user_id,'email',date_trunc('second',p_database_now)
   from public.organization_members m
   join public.users u on u.id=m.user_id and u.is_active
   cross join lateral public.resolve_critical_notification_recipient(p_organization_id,m.user_id,null,'reporting_deadline') route
   where m.organization_id=p_organization_id and m.role in ('owner','admin')
    and public.m5_triage_actor_has_permission(p_organization_id,m.user_id,'can_view_findings')
    and route.outcome='resolved'
   order by case m.role when 'owner' then 0 else 1 end,m.user_id
   on conflict(alert_id,recipient_user_id,channel) do nothing;
  if not exists(select 1 from public.reporting_deadline_alert_deliveries d
    where d.organization_id=p_organization_id and d.alert_id=v_alert_id) then
    insert into public.reporting_deadline_alert_deliveries(
      organization_id,alert_id,recipient_user_id,original_recipient_user_id,
      channel,due_at,delivery_state,last_error_code
    ) values(
      p_organization_id,v_alert_id,v_obligation.created_by_user_id,v_obligation.created_by_user_id,
      'email',date_trunc('second',p_database_now),'dead_letter','recipient_unavailable'
    );
  end if;
  v_created:=v_created+1;
 end loop;
 if v_elapsed>=100 and v_stage.state='running' then
   update public.reporting_obligation_stages set state='overdue',overdue_at=coalesce(overdue_at,due_at),
     version=version+1,updated_at=date_trunc('second',p_database_now)
   where organization_id=p_organization_id and id=v_stage.id;
 end if;
 return v_created;
end $$;

alter function public.m6_materialize_reporting_deadline_alerts(uuid,uuid,timestamptz) owner to postgres;
revoke all on function public.m6_materialize_reporting_deadline_alerts(uuid,uuid,timestamptz)
  from public,anon,authenticated;
grant execute on function public.m6_materialize_reporting_deadline_alerts(uuid,uuid,timestamptz)
  to service_role;
