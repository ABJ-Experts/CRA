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
