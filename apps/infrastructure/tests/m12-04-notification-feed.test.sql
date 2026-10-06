begin;

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'check failed: %', p_name; end if;
end;
$$;

select pg_temp.check('feed read-state table exists', to_regclass('public.notification_feed_reads') is not null);
select pg_temp.check('feed activation column exists', exists (
  select 1 from information_schema.columns
  where table_schema='public' and table_name='organization_settings' and column_name='notification_feed_started_at'
));
select pg_temp.check('feed RPCs exist',
  to_regprocedure('public.list_notification_feed_atomic(uuid,uuid,text,text,text,text,integer)') is not null
  and to_regprocedure('public.count_notification_feed_unread_atomic(uuid,uuid)') is not null
  and to_regprocedure('public.resolve_notification_feed_destination_atomic(uuid,uuid,text)') is not null
  and to_regprocedure('public.mark_notification_feed_read_atomic(uuid,uuid,jsonb,uuid)') is not null
);

select pg_temp.check('feed state stays service-only',
  (select relrowsecurity and not relforcerowsecurity from pg_class
    where oid='public.notification_feed_reads'::regclass)
  and not has_table_privilege('authenticated','public.notification_feed_reads','select')
  and has_table_privilege('service_role','public.notification_feed_reads','select,insert,update,delete')
  and has_function_privilege('service_role',
    'public.list_notification_feed_atomic(uuid,uuid,text,text,text,text,integer)','execute')
  and not has_function_privilege('authenticated',
    'public.list_notification_feed_atomic(uuid,uuid,text,text,text,text,integer)','execute')
  and (select prosecdef and proconfig @> array['search_path=public, pg_temp']
    from pg_proc where oid='public.list_notification_feed_atomic(uuid,uuid,text,text,text,text,integer)'::regprocedure)
);

update public.organization_settings
set notification_feed_started_at=clock_timestamp()-interval '1 day'
where organization_id='00000000-0000-4000-8000-0000000000ca';

insert into public.vulnerability_triage_alert_events(
  id,organization_id,finding_id,event_kind,event_key,due_at
) values (
  '00000000-0000-4000-8000-000000120401',
  '00000000-0000-4000-8000-0000000000ca',
  '90100000-0000-4000-8000-000000000014',
  'internal_sla_breached','m1204:00000000000000000000000000000001',clock_timestamp()
);

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_owner uuid; v_viewer uuid; v_finding uuid;
  v_event uuid := '00000000-0000-4000-8000-000000120401'; v_ref text; v_row jsonb; v_items jsonb;
  v_fingerprint text; v_key uuid := gen_random_uuid(); v_mark record;
  v_unread_before integer;
begin
  select id into v_owner from public.users where email='owner@cra.test';
  select id into v_viewer from public.users where email='viewer@cra.test';
  select id into v_finding from public.vulnerability_findings
  where organization_id=v_org and status='active' limit 1;
  perform pg_temp.check('seeded finding and users exist',
    v_owner is not null and v_viewer is not null and v_finding is not null);
  v_ref:='m5_'||v_event::text||'_event';
  select result into v_row from public.list_notification_feed_atomic(
    v_org,v_owner,'finding_triage',null,'all',null,25);
  v_items:=v_row->'items';
  perform pg_temp.check('M5 source event is visible once to eligible owner',
    (select count(*)=1 from jsonb_array_elements(v_items) item
      where item->>'ref'=v_ref and item->>'sourceState'='available'
        and item->>'read'='false'));
  perform pg_temp.check('other user does not inherit owner feed',
    not exists(select 1 from jsonb_array_elements((select result->'items'
      from public.list_notification_feed_atomic(v_org,v_viewer,'finding_triage',null,'all',null,25))) item
      where item->>'ref'=v_ref));
  perform pg_temp.check('tenant substitution hides event',
    (select outcome from public.resolve_notification_feed_destination_atomic(
      '00000000-0000-4000-8000-0000000000cb',v_owner,v_ref)) in ('forbidden','not_found'));
  select item->>'fingerprint' into v_fingerprint
  from jsonb_array_elements(v_items) item where item->>'ref'=v_ref;
  select (result->>'count')::integer into v_unread_before
  from public.count_notification_feed_unread_atomic(v_org,v_owner);
  select * into v_mark from public.mark_notification_feed_read_atomic(v_org,v_owner,
    jsonb_build_array(jsonb_build_object('ref',v_ref,'expectedFingerprint',v_fingerprint)),v_key);
  perform pg_temp.check('mark-read is durable and independent',
    v_mark.outcome='updated' and v_mark.result #>> '{items,0,ref}'=v_ref
    and exists(select 1 from public.notification_feed_reads r
      where r.organization_id=v_org and r.user_id=v_owner and r.ref=v_ref
        and r.fingerprint=v_fingerprint and r.read_at is not null)
    and (select (result->>'count')::integer
      from public.count_notification_feed_unread_atomic(v_org,v_owner))=v_unread_before-1);
  select * into v_mark from public.mark_notification_feed_read_atomic(v_org,v_owner,
    jsonb_build_array(jsonb_build_object('ref',v_ref,'expectedFingerprint',v_fingerprint)),v_key);
  perform pg_temp.check('same mark-read command replays',
    v_mark.outcome='replayed' and v_mark.result->>'replayed'='true');
  perform pg_temp.check('missing fingerprint is invalid input',
    (select outcome from public.mark_notification_feed_read_atomic(v_org,v_owner,
      jsonb_build_array(jsonb_build_object('ref',v_ref)),gen_random_uuid()))='invalid_request');
  update public.vulnerability_triage_alert_events set due_at=due_at-interval '1 second'
  where organization_id=v_org and id=v_event;
  perform pg_temp.check('replay cannot acknowledge a revised source event',
    (select outcome from public.mark_notification_feed_read_atomic(v_org,v_owner,
      jsonb_build_array(jsonb_build_object('ref',v_ref,'expectedFingerprint',v_fingerprint)),v_key))='conflict');
  perform pg_temp.check('stale fingerprint conflicts',
    (select outcome from public.mark_notification_feed_read_atomic(v_org,v_owner,
      jsonb_build_array(jsonb_build_object('ref',v_ref,'expectedFingerprint',repeat('0',64))),
      gen_random_uuid()))='conflict');
  perform pg_temp.check('forged reference is not found',
    (select outcome from public.mark_notification_feed_read_atomic(v_org,v_owner,
      jsonb_build_array(jsonb_build_object('ref',
        'm5_00000000-0000-4000-8000-000000000001_event','expectedFingerprint',v_fingerprint)),
      gen_random_uuid()))='not_found');
end $$;

insert into public.notification_dispatches(
  organization_id,category,source_type,source_id,source_subtype,
  original_recipient_user_id,effective_recipient_user_id,status,
  attempt_count,last_attempt_at,safe_error_code
)
select '00000000-0000-4000-8000-0000000000ca','finding_triage',
  'finding_triage_alert','00000000-0000-4000-8000-000000120401',
  'internal_sla_breached',u.id,u.id,'exhausted',1,clock_timestamp(),'smtp_timeout'
from public.users u where u.email='owner@cra.test';
select pg_temp.check('unified optional dispatch failure has a safe feed notice',
  exists(select 1 from jsonb_array_elements((select result->'items'
    from public.list_notification_feed_atomic(
      '00000000-0000-4000-8000-0000000000ca',
      (select id from public.users where email='owner@cra.test'),
      'finding_triage',null,'all',null,25))) x
    where x->>'ref'='m5_00000000-0000-4000-8000-000000120401_failure'
      and x->>'summary'='Notification delivery needs attention'));

insert into public.product_regulatory_outbox_events(
  id,organization_id,product_id,release_id,event_type,event_key,payload,
  correlation_id,due_at,alert_threshold_days,delivery_state,original_recipient_user_id
)
select '00000000-0000-4000-8000-000000120402',p.organization_id,p.id,r.id,
  'support_period.alert','m1204:test:support','{}'::jsonb,gen_random_uuid(),
  clock_timestamp(),30,'scheduled',p.responsible_owner_id
from public.products p join public.product_releases r
  on r.organization_id=p.organization_id and r.product_id=p.id
where p.organization_id='00000000-0000-4000-8000-0000000000ca'
  and p.responsible_owner_id=(select id from public.users where email='owner@cra.test')
  and p.archived_at is null and r.archived_at is null
order by p.id,r.id limit 1;

insert into public.reporting_obligations(
  id,organization_id,obligation_type,awareness_at,awareness_basis,rule_set_id,
  rule_set_version,rule_snapshot,created_by_user_id,created_by_display_name
)
select '00000000-0000-4000-8000-000000120411',
  '00000000-0000-4000-8000-0000000000ca','severe_incident',
  date_trunc('second',clock_timestamp()),'Test event',r.id,r.version,'{}'::jsonb,
  u.id,'Test Owner'
from public.reporting_rule_sets r cross join public.users u
where u.email='owner@cra.test' order by r.id limit 1;
insert into public.reporting_obligation_stages(
  id,organization_id,obligation_id,stage_kind,anchor_kind,duration,state,due_at
) values (
  '00000000-0000-4000-8000-000000120412','00000000-0000-4000-8000-0000000000ca',
  '00000000-0000-4000-8000-000000120411','early_warning','awareness','PT24H',
  'running',clock_timestamp()+interval '1 day'
);
insert into public.reporting_deadline_alerts(
  id,organization_id,obligation_id,stage_id,deadline_revision,threshold_percent,
  idempotency_key,threshold_crossed_at,due_at
) values (
  '00000000-0000-4000-8000-000000120413','00000000-0000-4000-8000-0000000000ca',
  '00000000-0000-4000-8000-000000120411','00000000-0000-4000-8000-000000120412',
  1,75,'m1204:test:deadline',clock_timestamp(),clock_timestamp()
);
insert into public.reporting_deadline_alert_deliveries(
  id,organization_id,alert_id,recipient_user_id,original_recipient_user_id,channel,due_at
) select '00000000-0000-4000-8000-000000120414',
  '00000000-0000-4000-8000-0000000000ca','00000000-0000-4000-8000-000000120413',
  u.id,u.id,'email',clock_timestamp()
from public.users u where u.email='owner@cra.test';

do $$
declare v_org uuid := '00000000-0000-4000-8000-0000000000ca'; v_owner uuid;
  v_ref text := 'm2_00000000-0000-4000-8000-000000120402_event'; v_destination record;
begin
  select id into v_owner from public.users where email='owner@cra.test';
  perform pg_temp.check('M2 support and M6 deadline source branches are visible',
    exists(select 1 from jsonb_array_elements((select result->'items'
      from public.list_notification_feed_atomic(
        v_org,v_owner,'support_period',null,'all',null,25))) item
      where item->>'ref'=v_ref)
    and exists(select 1 from jsonb_array_elements((select result->'items'
      from public.list_notification_feed_atomic(
        v_org,v_owner,'reporting_deadline',null,'all',null,25))) item
      where item->>'ref'='m6_00000000-0000-4000-8000-000000120414_event'));
  select * into v_destination from public.resolve_notification_feed_destination_atomic(
    v_org,v_owner,v_ref);
  perform pg_temp.check('destination is a canonical local application path',
    v_destination.outcome='found'
    and v_destination.result->>'state'='available'
    and v_destination.result->>'url' ~ '^/products/[0-9a-f-]{36}$');
end $$;

update public.product_regulatory_outbox_events
set delivery_state='dead_letter',checkpoint_version=checkpoint_version+1,
  last_error_code='recipient_unavailable',last_attempt_at=clock_timestamp()
where id='00000000-0000-4000-8000-000000120402';

do $$
declare v_org uuid := '00000000-0000-4000-8000-0000000000ca'; v_owner uuid;
  v_failure jsonb;
begin
  select id into v_owner from public.users where email='owner@cra.test';
  select item into v_failure from jsonb_array_elements((select result->'items'
    from public.list_notification_feed_atomic(
      v_org,v_owner,'support_period',null,'unread',null,25))) item
  where item->>'ref'='m2_00000000-0000-4000-8000-000000120402_failure';
  perform pg_temp.check('critical recipient failure creates safe unread notice',
    v_failure->>'noticeKind'='failure'
    and v_failure->>'summary'='Notification delivery needs attention'
    and v_failure->>'ref'='m2_00000000-0000-4000-8000-000000120402_failure');
end $$;

do $$
declare v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_owner uuid; v_result record;
begin
  select id into v_owner from public.users where email='owner@cra.test';
  update public.reporting_obligations set status='cancelled',cancelled_at=clock_timestamp(),
    cancelled_by_user_id=v_owner,cancellation_reason='Test source unavailable'
  where organization_id=v_org and id='00000000-0000-4000-8000-000000120411';
  select * into v_result from public.resolve_notification_feed_destination_atomic(
    v_org,v_owner,'m6_00000000-0000-4000-8000-000000120414_event');
  perform pg_temp.check('unavailable source has honest unavailable destination',
    v_result.outcome='found' and v_result.result->>'state'='unavailable'
    and v_result.result->'url'='null'::jsonb);
  update public.reporting_obligations set status='active',cancelled_at=null,
    cancelled_by_user_id=null,cancellation_reason=null
  where organization_id=v_org and id='00000000-0000-4000-8000-000000120411';
  update public.users set is_active=false where id=v_owner;
  perform pg_temp.check('deactivated recipient cannot list or count',
    (select outcome from public.list_notification_feed_atomic(v_org,v_owner,null,null,'all',null,25))='forbidden'
    and (select outcome from public.count_notification_feed_unread_atomic(v_org,v_owner))='forbidden');
  update public.users set is_active=true where id=v_owner;
end $$;

update public.organization_settings set notification_feed_started_at='2026-09-01'
where organization_id='00000000-0000-4000-8000-0000000000ca';
update public.supplier_evidence_reminder_deliveries set scheduled_for=clock_timestamp()
where id='51dc6558-14ee-4418-acbb-cdd62efa207a';

do $$
declare v_org uuid := '00000000-0000-4000-8000-0000000000ca'; v_owner uuid;
begin
  select id into v_owner from public.users where email='owner@cra.test';
  perform pg_temp.check('M8 and M9 branches reuse source outboxes',
    exists(select 1 from jsonb_array_elements((select result->'items'
      from public.list_notification_feed_atomic(
        v_org,v_owner,'evidence',null,'all',null,25))) item
      where item->>'ref'='m8_fd416cd4-cb87-40a7-aea2-3a67c004b7f1_event')
    and exists(select 1 from jsonb_array_elements((select result->'items'
      from public.list_notification_feed_atomic(
        v_org,v_owner,'supplier_owner',null,'all',null,25))) item
      where item->>'ref'='m9_51dc6558-14ee-4418-acbb-cdd62efa207a_event'));
end $$;

update public.organization_settings set notification_feed_started_at='2026-01-01'
where organization_id='00000000-0000-4000-8000-0000000000ca';
insert into public.product_regulatory_outbox_events(
  id,organization_id,product_id,release_id,event_type,event_key,payload,
  correlation_id,due_at,alert_threshold_days,delivery_state,original_recipient_user_id,
  last_attempt_at,last_error_code
)
select '00000000-0000-4000-8000-000000120403',p.organization_id,p.id,r.id,
  'support_period.alert','m1204:test:late-failure','{}'::jsonb,gen_random_uuid(),
  clock_timestamp()-interval '181 days',30,'dead_letter',p.responsible_owner_id,
  clock_timestamp(),'delivery_uncertain'
from public.products p join public.product_releases r
  on r.organization_id=p.organization_id and r.product_id=p.id
where p.organization_id='00000000-0000-4000-8000-0000000000ca'
  and p.responsible_owner_id=(select id from public.users where email='owner@cra.test')
  and p.archived_at is null and r.archived_at is null
order by p.id,r.id limit 1;
select pg_temp.check('late failure remains visible for its own 180-day window',
  exists(select 1 from jsonb_array_elements((select result->'items'
    from public.list_notification_feed_atomic(
      '00000000-0000-4000-8000-0000000000ca',
      (select id from public.users where email='owner@cra.test'),
      'support_period',null,'all',null,25))) x
    where x->>'ref'='m2_00000000-0000-4000-8000-000000120403_failure')
  and not exists(select 1 from jsonb_array_elements((select result->'items'
    from public.list_notification_feed_atomic(
      '00000000-0000-4000-8000-0000000000ca',
      (select id from public.users where email='owner@cra.test'),
      'support_period',null,'all',null,25))) x
    where x->>'ref'='m2_00000000-0000-4000-8000-000000120403_event'));

insert into public.notification_feed_reads(
  organization_id,user_id,ref,fingerprint,event_occurred_at
) select '00000000-0000-4000-8000-0000000000ca',u.id,
  'm2_00000000-0000-4000-8000-000000120499_event',repeat('a',64),
  clock_timestamp()-interval '181 days' from public.users u where u.email='owner@cra.test';

select pg_temp.check('bounded retention discovers and cleans only expired feed read state',
  exists(select 1 from public.list_notification_feed_cleanup_organizations_atomic(20)
    where organization_id='00000000-0000-4000-8000-0000000000ca')
  and (select deleted_count from public.cleanup_notification_feed_reads_atomic(
    '00000000-0000-4000-8000-0000000000ca',1))=1);
select pg_temp.check('expired read state is removed without source deletion',
  not exists(select 1 from public.notification_feed_reads
    where ref='m2_00000000-0000-4000-8000-000000120499_event')
  and exists(select 1 from public.product_regulatory_outbox_events
    where id='00000000-0000-4000-8000-000000120402'));

rollback;
