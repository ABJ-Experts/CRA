begin;

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok,false) then raise exception 'check failed: %',p_name; end if;
end $$;

select pg_temp.check('critical operations exist and are service-only',
  to_regprocedure('public.pin_product_support_alert_original_recipient_atomic(uuid,uuid,uuid,integer,uuid)') is not null
  and has_function_privilege('service_role','public.pin_product_support_alert_original_recipient_atomic(uuid,uuid,uuid,integer,uuid)','execute')
  and not has_function_privilege('authenticated','public.pin_product_support_alert_original_recipient_atomic(uuid,uuid,uuid,integer,uuid)','execute')
  and (select prosecdef and proconfig @> array['search_path=public, pg_temp']
       from pg_proc where oid='public.pin_product_support_alert_original_recipient_atomic(uuid,uuid,uuid,integer,uuid)'::regprocedure)
);

do $$
<<critical_delivery_case>>
declare
  org_id uuid := '00000000-0000-4000-8000-0000000000ca';
  actor_id uuid;
  admin_id uuid;
  v_product_id uuid;
  v_release_id uuid;
  v_period_id uuid;
  m2_id uuid := gen_random_uuid();
  historic_m2_id uuid := gen_random_uuid();
  expired_m2_id uuid := gen_random_uuid();
  m6_id uuid := gen_random_uuid();
  alert_id uuid := gen_random_uuid();
  retry_key uuid := gen_random_uuid();
  v_obligation_id uuid;
  v_stage_id uuid;
  stage_revision integer;
  period_result record;
  obligation_result record;
  lease_owner_id uuid := gen_random_uuid();
  leased record;
  pinned record;
  listed record;
  retried record;
  replayed record;
  rejected record;
begin
  select id into actor_id from public.users where email='owner@cra.test';
  select id into admin_id from public.users where email='admin@cra.test';
  select p.id,r.id into v_product_id,v_release_id
    from public.products p join public.product_releases r on r.organization_id=p.organization_id and r.product_id=p.id
    where p.organization_id=org_id and p.archived_at is null order by p.id,r.id limit 1;
  perform pg_temp.check('seeded critical fixture scope',actor_id is not null and v_product_id is not null and v_release_id is not null);
  select * into period_result from public.create_product_support_period_atomic(
    org_id,v_product_id,v_release_id,actor_id,clock_timestamp(),clock_timestamp()+interval '12 years',
    'M12-03 transactional critical delivery fixture.',gen_random_uuid(),gen_random_uuid());
  v_period_id := (period_result.support_period->>'id')::uuid;
  perform pg_temp.check('M2 support period fixture exists',v_period_id is not null);

  insert into public.product_regulatory_outbox_events(
    id,organization_id,product_id,release_id,event_type,event_key,payload,correlation_id,
    delivery_state,due_at,support_period_id,support_period_revision,alert_threshold_days
  ) values(
    m2_id,org_id,v_product_id,v_release_id,'support_period.alert','m1203-critical:'||m2_id::text,
    '{}'::jsonb,gen_random_uuid(),'scheduled',clock_timestamp()-interval '1 minute',v_period_id,1,7
  );
  select * into leased from public.claim_product_support_alert_atomic(org_id,lease_owner_id,60);
  perform pg_temp.check('M2 source-owned claim remains usable',leased.outcome='claimed'
    and leased.delivery_id=m2_id and leased.checkpoint_version=1
    and (select last_attempt_at is not null from public.product_regulatory_outbox_events where id=m2_id));
  select * into pinned from public.pin_product_support_alert_original_recipient_atomic(
    org_id,m2_id,lease_owner_id,1,actor_id);
  perform pg_temp.check('M2 original recipient pins once',pinned.outcome='pinned'
    and (select original_recipient_user_id=actor_id from public.product_regulatory_outbox_events where id=m2_id));
  select * into pinned from public.pin_product_support_alert_original_recipient_atomic(
    org_id,m2_id,lease_owner_id,1,actor_id);
  perform pg_temp.check('M2 same-lease original pin is idempotent',pinned.outcome='pinned');
  select * into rejected from public.pin_product_support_alert_original_recipient_atomic(
    gen_random_uuid(),m2_id,lease_owner_id,1,actor_id);
  perform pg_temp.check('M2 pin rejects tenant substitution',rejected.outcome='conflict');
  update public.product_regulatory_outbox_events
    set delivery_state='dead_letter',lease_owner=null,lease_expires_at=null,last_error_code='provider_unavailable'
    where organization_id=org_id and id=m2_id;

  select * into listed from public.list_notification_dispatches_atomic(org_id,actor_id,'exhausted','support_period',null,null,50);
  perform pg_temp.check('M2 critical exhausted work appears without message body',listed.outcome='found'
    and exists(select 1 from jsonb_array_elements(listed.result->'rows') row
      where row->>'deliveryRef'='m2_'||m2_id::text and row->>'status'='exhausted'
        and row->>'originalRecipientUserId'=actor_id::text and not row ? 'payload'));
  select * into rejected from public.list_notification_dispatches_atomic(
    gen_random_uuid(),actor_id,'exhausted','support_period',null,null,50);
  perform pg_temp.check('tenant substitution cannot list critical deliveries',rejected.outcome='forbidden'
    and rejected.result is null);
  select * into rejected from public.list_notification_dispatches_atomic(
    org_id,(select id from public.users where email='viewer@cra.test'),'exhausted','support_period',null,null,50);
  perform pg_temp.check('non-audit viewer cannot list critical deliveries',rejected.outcome='forbidden'
    and rejected.result is null);
  select * into retried from public.retry_notification_dispatch_atomic(
    org_id,actor_id,'m2_'||m2_id::text,1,retry_key);
  perform pg_temp.check('M2 critical retry queues source-owned alert',retried.outcome='queued'
    and retried.result #>> '{delivery,status}'='queued'
    and (select delivery_state='retrying' from public.product_regulatory_outbox_events where id=m2_id));
  select * into replayed from public.retry_notification_dispatch_atomic(
    org_id,actor_id,'m2_'||m2_id::text,1,retry_key);
  perform pg_temp.check('M2 critical retry replays idempotently',replayed.outcome='replayed'
    and replayed.result=retried.result);
  select * into rejected from public.retry_notification_dispatch_atomic(
    org_id,actor_id,'m2_'||m2_id::text,2,retry_key);
  perform pg_temp.check('M2 retry key cannot be reused for another version',rejected.outcome='idempotency_conflict');

  select * into rejected from public.retry_notification_dispatch_atomic(
    org_id,actor_id,'m2_'||m2_id::text,1,gen_random_uuid());
  perform pg_temp.check('M2 stale retry conflicts',rejected.outcome='conflict');
  update public.product_regulatory_outbox_events
    set delivery_state='leased',lease_owner=lease_owner_id,
      lease_expires_at=clock_timestamp()+interval '1 minute',checkpoint_version=3,delivery_attempts=2
    where organization_id=org_id and id=m2_id;
  select * into leased from public.complete_product_support_alert_delivery_atomic(
    org_id,m2_id,lease_owner_id,3,actor_id);
  perform pg_temp.check('M2 completion records provider acceptance, not receipt',leased.outcome='completed'
    and (select delivery_state='provider_accepted' from public.product_regulatory_outbox_events where id=m2_id)
    and (select count(*)=1 from public.audit_logs a where a.organization_id=org_id
      and a.action='product.support_alert_provider_accepted' and a.entity_id=m2_id::text));
  select * into rejected from public.complete_product_support_alert_delivery_atomic(
    org_id,m2_id,lease_owner_id,3,actor_id);
  perform pg_temp.check('duplicate M2 completion cannot append a second acceptance fact',rejected.outcome='conflict'
    and (select count(*)=1 from public.audit_logs a where a.organization_id=org_id
      and a.action='product.support_alert_provider_accepted' and a.entity_id=m2_id::text));
  select * into rejected from public.retry_notification_dispatch_atomic(
    org_id,actor_id,'m2_'||m2_id::text,3,gen_random_uuid());
  perform pg_temp.check('provider-accepted M2 alert cannot be retried',rejected.outcome='invalid_state');
  select * into listed from public.list_notification_dispatches_atomic(
    org_id,actor_id,'provider_accepted','support_period',null,null,50);
  perform pg_temp.check('M2 SMTP acceptance is not labelled delivered',
    exists(select 1 from jsonb_array_elements(listed.result->'rows') row
      where row->>'deliveryRef'='m2_'||m2_id::text and row->>'status'='provider_accepted'));

  insert into public.product_regulatory_outbox_events(
    id,organization_id,product_id,release_id,event_type,event_key,payload,correlation_id,
    delivery_state,due_at,support_period_id,support_period_revision,alert_threshold_days
  ) values(
    expired_m2_id,org_id,v_product_id,v_release_id,'support_period.alert',
    'm1203-expired:'||expired_m2_id::text,'{}'::jsonb,gen_random_uuid(),
    'scheduled',clock_timestamp()-interval '2 minutes',v_period_id,1,9
  );
  update public.product_regulatory_outbox_events
    set delivery_state='leased',lease_owner=lease_owner_id,
      lease_expires_at=clock_timestamp()-interval '1 minute',checkpoint_version=1,delivery_attempts=1
    where organization_id=org_id and id=expired_m2_id;
  select * into leased from public.claim_product_support_alert_atomic(org_id,gen_random_uuid(),60);
  perform pg_temp.check('expired M2 lease is quarantined, never auto-replayed',leased.outcome='none_available'
    and (select delivery_state='dead_letter' and last_error_code='delivery_uncertain'
      from public.product_regulatory_outbox_events where id=expired_m2_id)
    and exists(select 1 from public.audit_logs a where a.organization_id=org_id
      and a.action='product.support_alert_delivery_uncertain' and a.entity_id=expired_m2_id::text));

  insert into public.product_regulatory_outbox_events(
    id,organization_id,product_id,release_id,event_type,event_key,payload,correlation_id,
    delivery_state,due_at,support_period_id,support_period_revision,alert_threshold_days,checkpoint_version
  ) values(
    historic_m2_id,org_id,v_product_id,v_release_id,'support_period.alert',
    'm1203-historic:'||historic_m2_id::text,'{}'::jsonb,gen_random_uuid(),
    'dead_letter',clock_timestamp()-interval '1 minute',v_period_id,1,8,1
  );
  select * into retried from public.retry_notification_dispatch_atomic(
    org_id,actor_id,'m2_'||historic_m2_id::text,1,gen_random_uuid());
  perform pg_temp.check('explicit admin retry can pin a historic unpinned alert',retried.outcome='queued'
    and (select original_recipient_user_id=actor_id from public.product_regulatory_outbox_events where id=historic_m2_id));

  insert into public.base_role_permission_overrides(organization_id,base_role,permissions)
  values(org_id,'owner','{"can_view_products":false}'::jsonb)
  on conflict(organization_id,base_role) do update
    set permissions=public.base_role_permission_overrides.permissions||excluded.permissions;
  perform pg_temp.check('revoked product owner falls back to eligible admin',
    not exists(select 1 from public.get_product_support_alert_product_owner_recipient(org_id,v_product_id))
    and (select user_id=admin_id from public.get_product_support_alert_owner_or_admin_recipient(org_id)));
  update public.products set responsible_owner_id=admin_id where organization_id=org_id and id=v_product_id;
  update public.product_regulatory_outbox_events
    set delivery_state='leased',lease_owner=lease_owner_id,lease_expires_at=clock_timestamp()+interval '1 minute',
      checkpoint_version=checkpoint_version+1
    where organization_id=org_id and id=historic_m2_id;
  select * into rejected from public.pin_product_support_alert_original_recipient_atomic(
    org_id,historic_m2_id,lease_owner_id,3,admin_id);
  perform pg_temp.check('changed accountable owner cannot silently replace pinned original',rejected.outcome='conflict');
  update public.product_regulatory_outbox_events
    set delivery_state='dead_letter',lease_owner=null,lease_expires_at=null,last_error_code='original_recipient_changed'
    where organization_id=org_id and id=historic_m2_id;
  update public.base_role_permission_overrides
    set permissions=jsonb_set(permissions,'{can_view_products}','true'::jsonb)
    where organization_id=org_id and base_role='owner';
  select * into retried from public.retry_notification_dispatch_atomic(
    org_id,actor_id,'m2_'||historic_m2_id::text,3,gen_random_uuid());
  perform pg_temp.check('versioned admin retry audits and revalidates changed accountable owner',retried.outcome='queued'
    and (select original_recipient_user_id=admin_id from public.product_regulatory_outbox_events where id=historic_m2_id)
    and exists(select 1 from public.audit_logs a where a.organization_id=org_id
      and a.action='notification.critical_delivery_retry_requested' and a.entity_id=historic_m2_id::text
      and a.changes->>'previousOriginalRecipientUserId'=critical_delivery_case.actor_id::text));

  select * into obligation_result from public.create_reporting_obligation_atomic(
    org_id,actor_id,'severe_incident',null,date_trunc('second',clock_timestamp()),
    'M12-03 transactional critical delivery fixture.',gen_random_uuid(),gen_random_uuid());
  v_obligation_id := (obligation_result.result->'obligation'->>'id')::uuid;
  select s.id,s.deadline_revision into v_stage_id,stage_revision
    from public.reporting_obligation_stages s
    where s.organization_id=org_id and s.obligation_id=v_obligation_id and s.state in ('running','overdue')
    order by s.id limit 1;
  perform pg_temp.check('reporting fixture scope',v_obligation_id is not null and v_stage_id is not null);
  insert into public.reporting_deadline_alerts(id,organization_id,obligation_id,stage_id,deadline_revision,threshold_percent,
    idempotency_key,threshold_crossed_at,due_at)
  values(alert_id,org_id,v_obligation_id,v_stage_id,stage_revision,50,'m1203-critical:'||alert_id::text,clock_timestamp(),clock_timestamp());
  insert into public.reporting_deadline_alert_deliveries(
    id,organization_id,alert_id,recipient_user_id,original_recipient_user_id,channel,delivery_state,delivery_attempts,due_at)
  values(m6_id,org_id,alert_id,actor_id,actor_id,'email','dead_letter',12,clock_timestamp());
  select * into listed from public.list_notification_dispatches_atomic(org_id,actor_id,'exhausted','reporting_deadline',null,null,50);
  perform pg_temp.check('M6 critical exhausted work appears',listed.outcome='found'
    and exists(select 1 from jsonb_array_elements(listed.result->'rows') row
      where row->>'deliveryRef'='m6_'||m6_id::text and row->>'status'='exhausted'));
  select * into retried from public.retry_notification_dispatch_atomic(
    org_id,actor_id,'m6_'||m6_id::text,1,gen_random_uuid());
  perform pg_temp.check('M6 critical retry queues source-owned delivery',retried.outcome='queued'
    and (select delivery_state='queued' from public.reporting_deadline_alert_deliveries where id=m6_id));
  update public.reporting_deadline_alert_deliveries
    set delivery_state='provider_accepted',delivered_at=clock_timestamp()
    where organization_id=org_id and id=m6_id;
  select * into rejected from public.retry_notification_dispatch_atomic(
    org_id,actor_id,'m6_'||m6_id::text,2,gen_random_uuid());
  perform pg_temp.check('provider-accepted M6 alert cannot be retried',rejected.outcome='invalid_state');

  select * into listed from public.list_notification_dispatches_atomic(org_id,actor_id,null,null,null,null,1);
  perform pg_temp.check('combined critical listing paginates',listed.outcome='found'
    and jsonb_array_length(listed.result->'rows')=1 and listed.result->>'nextCursor' is not null);
  select * into rejected from public.list_notification_dispatches_atomic(
    org_id,actor_id,null,'evidence',null,listed.result->>'nextCursor',1);
  perform pg_temp.check('cursor cannot be reused with different filter',rejected.outcome='invalid_request');
end $$;

do $$
declare
  org_id uuid := '00000000-0000-4000-8000-0000000000ca';
  actor_id uuid;
  rehearsal record;
  rehearsal_id uuid;
  rehearsal_stage_id uuid;
  materialized integer;
begin
  select id into actor_id from public.users where email='owner@cra.test';
  select * into rehearsal from public.create_reporting_rehearsal_atomic(
    org_id,actor_id,'severe_incident',date_trunc('second',clock_timestamp())-interval '4 days',
    'M12-03 synthetic deadline exclusion regression.',gen_random_uuid(),gen_random_uuid());
  rehearsal_id := (rehearsal.result->'obligation'->>'id')::uuid;
  select s.id into rehearsal_stage_id from public.reporting_obligation_stages s
  where s.organization_id=org_id and s.obligation_id=rehearsal_id and s.due_at is not null
  order by s.due_at limit 1;
  perform pg_temp.check('overdue rehearsal fixture has an eligible stage',rehearsal_stage_id is not null);
  materialized := public.m6_materialize_reporting_deadline_alerts(org_id,rehearsal_stage_id,clock_timestamp());
  perform pg_temp.check('M12-03 critical routing never materializes rehearsal alerts',materialized=0
    and not exists(select 1 from public.reporting_deadline_alerts a
      where a.organization_id=org_id and a.obligation_id=rehearsal_id));
end $$;

rollback;
