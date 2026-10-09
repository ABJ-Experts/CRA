begin;

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then
    raise exception 'check failed: %', p_name;
  end if;
end;
$$;

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_actor uuid;
  v_created record;
  v_obligation_id uuid;
  v_stage public.reporting_obligation_stages%rowtype;
  v_alert_id uuid;
  v_delivery_id uuid;
  v_result record;
begin
  select id into v_actor from public.users where email = 'owner@cra.test';
  select * into v_created from public.create_reporting_rehearsal_atomic(
    v_org, v_actor, 'severe_incident',
    date_trunc('second', clock_timestamp()) - interval '4 days',
    'Synthetic send-time guard test.', gen_random_uuid(), gen_random_uuid()
  );
  perform pg_temp.check('rehearsal fixture created', v_created.outcome = 'created');
  v_obligation_id := (v_created.result->'obligation'->>'id')::uuid;
  select * into v_stage from public.reporting_obligation_stages
  where organization_id = v_org and obligation_id = v_obligation_id
    and due_at is not null order by due_at limit 1;
  perform pg_temp.check('rehearsal has a due stage', v_stage.id is not null);

  -- Simulate an alert persisted by an older worker before the materializer guard.
  insert into public.reporting_deadline_alerts(
    organization_id, obligation_id, stage_id, deadline_revision,
    threshold_percent, idempotency_key, threshold_crossed_at, due_at
  ) values (
    v_org, v_obligation_id, v_stage.id, v_stage.deadline_revision,
    50, 'm12-03-rehearsal-send-' || gen_random_uuid()::text,
    date_trunc('second', clock_timestamp()), v_stage.due_at
  ) returning id into v_alert_id;
  insert into public.reporting_deadline_alert_deliveries(
    organization_id, alert_id, recipient_user_id, original_recipient_user_id,
    channel, due_at, delivery_state, delivery_attempts,
    lease_owner, lease_expires_at, checkpoint_version
  ) values (
    v_org, v_alert_id, v_actor, v_actor, 'email', clock_timestamp(),
    'leased', 1, 'rehearsal-guard-test', clock_timestamp() + interval '2 minutes', 2
  ) returning id into v_delivery_id;

  select * into v_result from public.get_reporting_deadline_alert_delivery_details(
    v_org, v_delivery_id, 'rehearsal-guard-test', 2
  );
  perform pg_temp.check(
    'persisted rehearsal delivery is cancelled before recipient details are returned',
    v_result.outcome = 'cancelled' and v_result.details is null
    and exists (select 1 from public.reporting_deadline_alert_deliveries
      where organization_id = v_org and id = v_delivery_id
        and delivery_state = 'cancelled' and cancelled_at is not null
        and lease_owner is null and lease_expires_at is null)
  );
end;
$$;

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_actor uuid;
  v_admin uuid;
  v_obligation record;
  v_obligation_id uuid;
  v_stage public.reporting_obligation_stages%rowtype;
  v_alert_id uuid;
  v_delivery_id uuid;
  v_duplicate_id uuid;
  v_result record;
  v_listed record;
  v_retried record;
  v_replay record;
  v_retry_key uuid := gen_random_uuid();
begin
  select id into v_actor from public.users where email = 'owner@cra.test';
  select id into v_admin from public.users where email = 'admin@cra.test';
  select * into v_obligation from public.create_reporting_obligation_atomic(
    v_org,
    v_actor,
    'severe_incident',
    null,
    date_trunc('second', clock_timestamp()) - interval '4 hours',
    'Recipient unavailable critical routing regression.',
    gen_random_uuid(),
    gen_random_uuid()
  );
  perform pg_temp.check('critical routing fixture created', v_obligation.outcome = 'created');
  v_obligation_id := (v_obligation.result->'obligation'->>'id')::uuid;

  select * into v_stage from public.reporting_obligation_stages
  where organization_id = v_org and obligation_id = v_obligation_id
    and due_at is not null
  order by due_at limit 1;
  perform pg_temp.check('critical routing fixture has a due stage', v_stage.id is not null);

  insert into public.reporting_deadline_alerts(
    organization_id, obligation_id, stage_id, deadline_revision,
    threshold_percent, idempotency_key, threshold_crossed_at, due_at
  ) values (
    v_org, v_obligation_id, v_stage.id, v_stage.deadline_revision,
    50, 'm12-03-recipient-unavailable-' || gen_random_uuid()::text,
    date_trunc('second', clock_timestamp()), v_stage.due_at
  ) returning id into v_alert_id;
  insert into public.reporting_deadline_alert_deliveries(
    organization_id, alert_id, recipient_user_id, original_recipient_user_id,
    channel, due_at, delivery_state, delivery_attempts,
    lease_owner, lease_expires_at, checkpoint_version
  ) values (
    v_org, v_alert_id, v_actor, v_actor, 'email', clock_timestamp(),
    'leased', 1, 'recipient-unavailable-test', clock_timestamp() + interval '2 minutes', 3
  ) returning id into v_delivery_id;

  insert into public.base_role_permission_overrides(organization_id, base_role, permissions)
  values
    (v_org, 'owner', '{"can_view_findings": false}'::jsonb),
    (v_org, 'admin', '{"can_view_findings": false}'::jsonb)
  on conflict(organization_id, base_role) do update
    set permissions = public.base_role_permission_overrides.permissions || excluded.permissions;

  select * into v_result from public.get_reporting_deadline_alert_delivery_details(
    v_org, v_delivery_id, 'recipient-unavailable-test', 3
  );
  perform pg_temp.check(
    'recipient-unavailable critical delivery becomes admin-visible exhausted work',
    v_result.outcome = 'recipient_unavailable' and v_result.details is null
    and exists (select 1 from public.reporting_deadline_alert_deliveries
      where organization_id = v_org and id = v_delivery_id
        and delivery_state = 'dead_letter'
        and last_error_code = 'recipient_unavailable'
        and cancelled_at is null
        and lease_owner is null and lease_expires_at is null)
    and (select count(*)=1 from public.audit_logs
      where organization_id=v_org and entity_id=v_delivery_id::text
        and action='reporting.deadline_recipient_unavailable'
        and changes->>'safeErrorCode'='recipient_unavailable')
  );
  select * into v_listed from public.list_notification_dispatches_atomic(
    v_org,v_actor,'exhausted','reporting_deadline',null,null,50
  );
  perform pg_temp.check(
    'recipient-unavailable critical delivery appears with a safe error code',
    v_listed.outcome='found' and exists(
      select 1 from jsonb_array_elements(v_listed.result->'rows') row
      where row->>'deliveryRef'='m6_'||v_delivery_id::text
        and row->>'status'='exhausted'
        and row->>'safeErrorCode'='recipient_unavailable'
        and not row ? 'payload'
    )
  );
  select * into v_retried from public.retry_notification_dispatch_atomic(
    v_org,v_actor,'m6_'||v_delivery_id::text,3,v_retry_key
  );
  perform pg_temp.check(
    'critical retry waits for a valid authorized destination',
    v_retried.outcome='forbidden'
    and (select delivery_state='dead_letter' from public.reporting_deadline_alert_deliveries
      where organization_id=v_org and id=v_delivery_id)
  );
  update public.base_role_permission_overrides
  set permissions=jsonb_set(permissions,'{can_view_findings}','true'::jsonb)
  where organization_id=v_org and base_role='owner';
  select * into v_retried from public.retry_notification_dispatch_atomic(
    v_org,v_actor,'m6_'||v_delivery_id::text,3,v_retry_key
  );
  perform pg_temp.check(
    'route repair permits a versioned critical retry',
    v_retried.outcome='queued'
    and (select delivery_state='queued' and checkpoint_version=4 and last_error_code is null
      from public.reporting_deadline_alert_deliveries
      where organization_id=v_org and id=v_delivery_id)
  );
  select * into v_replay from public.retry_notification_dispatch_atomic(
    v_org,v_actor,'m6_'||v_delivery_id::text,3,v_retry_key
  );
  perform pg_temp.check(
    'critical retry is idempotent after route repair',
    v_replay.outcome='replayed' and v_replay.result=v_retried.result
  );
  select * into v_replay from public.retry_notification_dispatch_atomic(
    v_org,v_actor,'m6_'||v_delivery_id::text,3,gen_random_uuid()
  );
  perform pg_temp.check('concurrent stale critical retry conflicts',v_replay.outcome='conflict');

  update public.reporting_deadline_alert_deliveries
  set delivery_state='leased',lease_owner='recipient-unavailable-test',
    lease_expires_at=clock_timestamp()+interval '2 minutes',checkpoint_version=5
  where organization_id=v_org and id=v_delivery_id;
  select * into v_result from public.get_reporting_deadline_alert_delivery_details(
    v_org,v_delivery_id,'recipient-unavailable-test',5
  );
  perform pg_temp.check('repaired recipient is resolved at send time',
    v_result.outcome='found'
    and v_result.details #>> '{recipient,userId}'=v_actor::text);
  insert into public.reporting_deadline_alert_deliveries(
    organization_id,alert_id,recipient_user_id,original_recipient_user_id,
    channel,due_at,delivery_state,delivery_attempts,
    lease_owner,lease_expires_at,checkpoint_version
  ) values (
    v_org,v_alert_id,v_admin,v_admin,'email',clock_timestamp(),
    'leased',1,'duplicate-recipient-test',clock_timestamp()+interval '2 minutes',1
  ) returning id into v_duplicate_id;
  select * into v_result from public.get_reporting_deadline_alert_delivery_details(
    v_org,v_duplicate_id,'duplicate-recipient-test',1
  );
  perform pg_temp.check('changed route cannot email the same effective recipient twice',
    v_result.outcome='cancelled'
    and (select delivery_state='cancelled' and cancelled_at is not null
      from public.reporting_deadline_alert_deliveries
      where organization_id=v_org and id=v_duplicate_id));
end;
$$;

select pg_temp.check(
  'send-time guard remains service-only with a pinned search path',
  has_function_privilege('service_role',
    'public.get_reporting_deadline_alert_delivery_details(uuid,uuid,text,integer)', 'execute')
  and not has_function_privilege('authenticated',
    'public.get_reporting_deadline_alert_delivery_details(uuid,uuid,text,integer)', 'execute')
  and (select prosecdef and proconfig @> array['search_path=public, pg_temp']
    from pg_proc where oid =
      'public.get_reporting_deadline_alert_delivery_details(uuid,uuid,text,integer)'::regprocedure)
);

rollback;
