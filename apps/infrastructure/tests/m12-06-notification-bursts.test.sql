begin;

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok,false) then raise exception 'check failed: %',p_name; end if;
end $$;

select pg_temp.check('burst uses the existing dispatch ledger',exists (
  select 1 from information_schema.columns where table_schema='public'
    and table_name='notification_dispatches' and column_name='semantic_revision'
));
select pg_temp.check('burst uses the existing batch ledger',exists (
  select 1 from information_schema.columns where table_schema='public'
    and table_name='notification_digest_batches' and column_name='batch_kind'
));
select pg_temp.check('burst policy is independently versioned',exists (
  select 1 from information_schema.columns where table_schema='public'
    and table_name='organization_settings' and column_name='notification_burst_version'
));
select pg_temp.check('burst lifecycle RPCs exist',
  to_regprocedure('public.get_notification_burst_policy_atomic(uuid,uuid)') is not null
  and to_regprocedure('public.update_notification_burst_policy_atomic(uuid,uuid,integer,boolean,uuid)') is not null
  and to_regprocedure('public.schedule_notification_burst_batches_atomic(uuid,timestamp with time zone,integer)') is not null
  and to_regprocedure('public.claim_notification_burst_batch_atomic(uuid,uuid,integer)') is not null
  and to_regprocedure('public.prepare_notification_burst_batch_atomic(uuid,uuid,uuid,integer)') is not null
  and to_regprocedure('public.complete_notification_burst_batch_atomic(uuid,uuid,uuid,integer,text,text,text)') is not null
);
select pg_temp.check('scoped grouped feed projection exists',
  to_regprocedure('public.m12_06_feed_rows(uuid,uuid)') is not null);
select pg_temp.check('default feed reuses the parity-tested projection',
  position('public.m12_06_feed_rows' in pg_get_functiondef(
    'public.m1204_feed_rows(uuid,uuid)'::regprocedure))>0);

do $$
declare
  v_org uuid:='00000000-0000-4000-8000-0000000000ca';
  v_owner uuid;
  v_policy jsonb;
  v_result record;
  v_key uuid:=gen_random_uuid();
begin
  select id into v_owner from public.users where email='owner@cra.test';
  perform pg_temp.check('seeded owner exists',v_owner is not null);
  update public.organization_settings
  set notification_delivery_mode='unified'
  where organization_id=v_org;
  select result into v_policy from public.get_notification_burst_policy_atomic(v_org,v_owner);
  perform pg_temp.check('burst defaults off',v_policy #>> '{policy,enabled}'='false');
  select * into v_result from public.update_notification_burst_policy_atomic(v_org,v_owner,1,true,v_key);
  perform pg_temp.check('owner can enable burst with version',v_result.outcome='updated'
    and v_result.result #>> '{policy,enabled}'='true'
    and v_result.result #>> '{policy,version}'='2');
  select * into v_result from public.update_notification_burst_policy_atomic(v_org,v_owner,1,true,v_key);
  perform pg_temp.check('policy idempotent replay',v_result.outcome='replayed');
  select * into v_result from public.update_notification_burst_policy_atomic(v_org,v_owner,1,false,gen_random_uuid());
  perform pg_temp.check('stale policy version conflicts',v_result.outcome='conflict');
  select * into v_result from public.update_notification_burst_policy_atomic(
    '00000000-0000-4000-8000-0000000000cb',v_owner,1,true,gen_random_uuid());
  perform pg_temp.check('other tenant cannot enable policy',v_result.outcome='forbidden');
end $$;

do $$
declare
  v_org uuid:='00000000-0000-4000-8000-0000000000ca';
  v_owner uuid;
  v_window timestamptz:=date_bin(interval '2 minutes',
    clock_timestamp()-interval '4 minutes',
    '2000-01-01 00:00:00+00'::timestamptz);
  v_first uuid:=gen_random_uuid(); v_second uuid:=gen_random_uuid();
  v_third uuid:=gen_random_uuid(); v_fourth uuid:=gen_random_uuid();
  v_fifth uuid:=gen_random_uuid(); v_old uuid:=gen_random_uuid();
  v_batch uuid; v_claim record; v_prepared record; v_group jsonb;
begin
  select id into v_owner from public.users where email='owner@cra.test';
  update public.organization_settings
  set notification_delivery_mode='unified',notification_burst_enabled=true,
    notification_burst_started_at=v_window-interval '1 minute',
    notification_feed_started_at=v_window-interval '1 minute'
  where organization_id=v_org;
  insert into public.vulnerability_triage_alert_events(
    id,organization_id,finding_id,event_kind,event_key,state,due_at,created_at
  ) values
    (v_first,v_org,'90100000-0000-4000-8000-000000000014',
      'internal_sla_breached','m1206-test:'||v_first::text,'queued',
      v_window+interval '10 seconds',v_window+interval '10 seconds'),
    (v_second,v_org,'90100000-0000-4000-8000-000000000014',
      'internal_sla_breached','m1206-test:'||v_second::text,'queued',
      v_window+interval '11 seconds',v_window+interval '11 seconds');
  insert into public.notification_dispatches(
    organization_id,category,source_type,source_id,source_subtype,source_link,
    safe_title,original_recipient_user_id,effective_recipient_user_id,
    status,created_at,next_attempt_at
  ) values
    (v_org,'finding_triage','finding_triage_alert',v_first,
      'internal_sla_breached','/findings?findingId=90100000-0000-4000-8000-000000000014',
      'Test finding',v_owner,v_owner,'queued',v_window+interval '10 seconds',v_window),
    (v_org,'finding_triage','finding_triage_alert',v_second,
      'internal_sla_breached','/findings?findingId=90100000-0000-4000-8000-000000000014',
      'Test finding',v_owner,v_owner,'queued',v_window+interval '11 seconds',v_window);
  perform pg_temp.check('eligible events enter burst pending',
    (select count(*) from public.notification_dispatches d
      where d.organization_id=v_org and d.source_id in (v_first,v_second)
        and d.status='burst_pending')=2);
  insert into public.vulnerability_triage_alert_events(
    id,organization_id,finding_id,event_kind,event_key,due_at,created_at
  ) values(v_old,v_org,'90100000-0000-4000-8000-000000000014',
    'internal_sla_breached','m1206-test:'||v_old::text,
    v_window+interval '10 seconds',v_window-interval '90 seconds');
  insert into public.notification_dispatches(
    organization_id,category,source_type,source_id,source_subtype,source_link,
    safe_title,original_recipient_user_id,effective_recipient_user_id,
    status,created_at,next_attempt_at
  ) values(v_org,'finding_triage','finding_triage_alert',v_old,
    'internal_sla_breached','/findings?findingId=90100000-0000-4000-8000-000000000014',
    'Test finding',v_owner,v_owner,'queued',v_window+interval '10 seconds',v_window);
  perform pg_temp.check('pre-opt-in source is not batched when bridged later',
    (select status='queued' from public.notification_dispatches d
      where d.organization_id=v_org and d.source_id=v_old));
  perform pg_temp.check('scoped projection preserves all authorized feed rows',
    not exists(select f.* from public.m1204_feed_rows(v_org,v_owner) f
      except all
      select f.* from public.m12_06_feed_rows(v_org,v_owner) f)
    and not exists(select f.* from public.m12_06_feed_rows(v_org,v_owner) f
      except all
      select f.* from public.m1204_feed_rows(v_org,v_owner) f));
  select result->'items' into v_group
  from public.list_notification_feed_grouped_atomic(
    v_org,v_owner,'finding_triage',null,'all',null,25);
  perform pg_temp.check('closed feed window has authorized summary',
    exists(select 1 from jsonb_array_elements(v_group) x
      where x->>'kind'='batch'
        and x->>'eventClass'='finding_sla_breached'
        and x->>'windowStartsAt'=to_char(v_window at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        and (x->>'visibleCount')::integer>=2
        and (x->>'previewCount')::integer=jsonb_array_length(x->'previewItems')));
  perform pg_temp.check('cohort link rechecks member visibility',
    (select jsonb_array_length(result->'items')
      from public.list_notification_feed_cohort_atomic(
        v_org,v_owner,'finding_sla_breached',v_window,null,25))>=2);
  perform pg_temp.check('other tenant cannot list grouped feed',
    (select outcome from public.list_notification_feed_grouped_atomic(
      '00000000-0000-4000-8000-0000000000cb',v_owner,
      null,null,'all',null,25))='forbidden');
  perform pg_temp.check('scheduler creates bounded burst',
    (select created from public.schedule_notification_burst_batches_atomic(
      v_org,clock_timestamp(),1000))>=1);
  select b.id into v_batch from public.notification_digest_batches b
  where b.organization_id=v_org and b.batch_kind='burst'
    and exists(select 1 from public.notification_dispatches d
      where d.organization_id=v_org and d.source_id=v_first
        and d.id=any(b.dispatch_ids))
    and exists(select 1 from public.notification_dispatches d
      where d.organization_id=v_org and d.source_id=v_second
        and d.id=any(b.dispatch_ids));
  perform pg_temp.check('members frozen in existing ledger',v_batch is not null);
  select * into v_claim from public.claim_notification_burst_batch_atomic(
    v_org,gen_random_uuid(),120);
  perform pg_temp.check('burst claim is fenced',v_claim.outcome='claimed');
  update public.notification_digest_batches
  set lease_expires_at=clock_timestamp()-interval '1 second'
  where organization_id=v_org and id=(v_claim.batch->>'batchId')::uuid;
  perform * from public.reconcile_notification_ambiguous_leases_atomic(
    clock_timestamp(),100);
  perform pg_temp.check('restart before prepare safely releases members',
    (select status='cancelled'
      and safe_error_code='lease_expired_before_prepare'
      and cardinality(prepared_dispatch_ids)=0
      from public.notification_digest_batches
      where organization_id=v_org and id=(v_claim.batch->>'batchId')::uuid)
    and (select count(*) from public.notification_dispatches d
      where d.organization_id=v_org and d.source_id in (v_first,v_second)
        and d.status='burst_pending')=2);
  perform pg_temp.check('released members can be rescheduled',
    (select created from public.schedule_notification_burst_batches_atomic(
      v_org,clock_timestamp(),1000))>=1);
  select * into v_claim from public.claim_notification_burst_batch_atomic(
    v_org,gen_random_uuid(),120);
  perform pg_temp.check('rescheduled burst can be claimed',
    v_claim.outcome='claimed');
  select * into v_prepared from public.prepare_notification_burst_batch_atomic(
    v_org,(v_claim.batch->>'batchId')::uuid,
    (v_claim.batch->>'leaseOwner')::uuid,
    (v_claim.batch->>'checkpointVersion')::integer);
  perform pg_temp.check('prepared payload has exact count and filtered link',
    v_prepared.outcome='ready'
    and (v_prepared.delivery #>> '{payload,count}')::integer>=2
    and v_prepared.delivery #>> '{payload,href}'=
      '/notifications?batchId='||(v_claim.batch->>'batchId'));
  perform pg_temp.check('batch link returns only visible frozen events',
    (select jsonb_array_length(result->'items')
      from public.list_notification_feed_batch_atomic(v_org,v_owner,
        (v_claim.batch->>'batchId')::uuid,null,25))>=2);
  update public.notification_digest_batches
  set lease_expires_at=clock_timestamp()-interval '1 second'
  where organization_id=v_org and id=(v_claim.batch->>'batchId')::uuid;
  perform * from public.reconcile_notification_ambiguous_leases_atomic(
    clock_timestamp(),100);
  perform pg_temp.check('restart after prepare parks uncertain outcome',
    (select status='exhausted' and safe_error_code='lease_expired_ambiguous'
      and cardinality(prepared_dispatch_ids)>=2
      from public.notification_digest_batches
      where organization_id=v_org and id=(v_claim.batch->>'batchId')::uuid)
    and (select count(*) from public.notification_dispatches d
      where d.organization_id=v_org and d.source_id in (v_first,v_second)
        and d.status='exhausted' and d.safe_error_code='lease_expired_ambiguous')=2);
  update public.organization_settings
  set notification_burst_started_at=v_window+interval '10.5 seconds'
  where organization_id=v_org;
  insert into public.vulnerability_triage_alert_events(
    id,organization_id,finding_id,event_kind,event_key,due_at,created_at
  ) values(v_third,v_org,'90100000-0000-4000-8000-000000000014',
    'internal_sla_breached','m1206-test:'||v_third::text,
    v_window+interval '12 seconds',v_window+interval '12 seconds');
  select result->'items' into v_group
  from public.list_notification_feed_grouped_atomic(
    v_org,v_owner,'finding_triage',null,'all',null,25);
  perform pg_temp.check('mid-window opt-in groups only later source events',
    exists(select 1 from jsonb_array_elements(v_group) x
      where x->>'kind'='batch' and x->>'eventClass'='finding_sla_breached'
        and (x->>'visibleCount')::integer=2));
  perform pg_temp.check('mid-window filtered inbox count matches summary',
    (select jsonb_array_length(result->'items')
      from public.list_notification_feed_cohort_atomic(
        v_org,v_owner,'finding_sla_breached',v_window,null,25))=2);
  insert into public.vulnerability_triage_alert_events(
    id,organization_id,finding_id,event_kind,event_key,due_at,created_at
  ) values
    (v_fourth,v_org,'90100000-0000-4000-8000-000000000014',
      'internal_sla_breached','m1206-test:'||v_fourth::text,
      v_window+interval '13 seconds',v_window+interval '13 seconds'),
    (v_fifth,v_org,'90100000-0000-4000-8000-000000000014',
      'internal_sla_breached','m1206-test:'||v_fifth::text,
      v_window+interval '14 seconds',v_window+interval '14 seconds');
  insert into public.notification_dispatches(
    organization_id,category,source_type,source_id,source_subtype,source_link,
    safe_title,original_recipient_user_id,effective_recipient_user_id,
    status,created_at,next_attempt_at
  ) values
    (v_org,'finding_triage','finding_triage_alert',v_fourth,
      'internal_sla_breached','/findings?findingId=90100000-0000-4000-8000-000000000014',
      'Test finding',v_owner,v_owner,'queued',v_window+interval '13 seconds',v_window),
    (v_org,'finding_triage','finding_triage_alert',v_fifth,
      'internal_sla_breached','/findings?findingId=90100000-0000-4000-8000-000000000014',
      'Test finding',v_owner,v_owner,'queued',v_window+interval '14 seconds',v_window);
  perform * from public.schedule_notification_burst_batches_atomic(
    v_org,clock_timestamp(),1000);
  select * into v_claim from public.claim_notification_burst_batch_atomic(
    v_org,gen_random_uuid(),120);
  perform pg_temp.check('unprepared burst can be claimed for failure',
    v_claim.outcome='claimed');
  select * into v_prepared from public.fail_notification_burst_batch_atomic(
    v_org,(v_claim.batch->>'batchId')::uuid,
    (v_claim.batch->>'leaseOwner')::uuid,
    (v_claim.batch->>'checkpointVersion')::integer,
    'preparation_failed',false);
  perform pg_temp.check('unprepared failure exhausts safely',
    v_prepared.outcome='exhausted'
    and (select count(*) from public.notification_dispatches d
      where d.organization_id=v_org and d.source_id in (v_fourth,v_fifth)
        and d.status='queued')=2);
end $$;

do $$
declare
  v_org uuid:='00000000-0000-4000-8000-0000000000ca';
  v_owner uuid; v_suppression uuid:=gen_random_uuid();
  v_window timestamptz:=date_bin(interval '2 minutes',
    clock_timestamp()-interval '8 minutes',
    '2000-01-01 00:00:00+00'::timestamptz);
  v_sla_one uuid:=gen_random_uuid(); v_sla_two uuid:=gen_random_uuid();
  v_supp_one uuid:=gen_random_uuid(); v_supp_two uuid:=gen_random_uuid();
  v_created integer;
begin
  select id into v_owner from public.users where email='owner@cra.test';
  update public.organization_settings
  set notification_delivery_mode='unified',notification_burst_enabled=true,
    notification_burst_started_at=v_window-interval '1 minute',
    notification_feed_started_at=v_window-interval '1 minute'
  where organization_id=v_org;
  insert into public.vulnerability_finding_suppressions(
    id,organization_id,finding_id,revision,reason,expires_at,is_current,
    ended_at,ended_reason,created_by,created_at)
  values(v_suppression,v_org,'90100000-0000-4000-8000-000000000014',
    1,'M12-06 batch index regression',v_window,false,v_window,'expired',
    v_owner,v_window-interval '1 hour');
  insert into public.vulnerability_triage_alert_events(
    id,organization_id,finding_id,suppression_id,event_kind,event_key,
    due_at,created_at)
  values
    (v_sla_one,v_org,'90100000-0000-4000-8000-000000000014',null,
      'internal_sla_breached','m1206-index:'||v_sla_one::text,
      v_window+interval '10 seconds',v_window+interval '10 seconds'),
    (v_sla_two,v_org,'90100000-0000-4000-8000-000000000014',null,
      'internal_sla_breached','m1206-index:'||v_sla_two::text,
      v_window+interval '11 seconds',v_window+interval '11 seconds'),
    (v_supp_one,v_org,'90100000-0000-4000-8000-000000000014',v_suppression,
      'suppression_expired','m1206-index:'||v_supp_one::text,
      v_window+interval '12 seconds',v_window+interval '12 seconds'),
    (v_supp_two,v_org,'90100000-0000-4000-8000-000000000014',v_suppression,
      'suppression_expired','m1206-index:'||v_supp_two::text,
      v_window+interval '13 seconds',v_window+interval '13 seconds');
  insert into public.notification_dispatches(
    organization_id,category,source_type,source_id,source_subtype,source_link,
    safe_title,original_recipient_user_id,effective_recipient_user_id,
    semantic_revision,status,created_at,next_attempt_at)
  select v_org,'finding_triage','finding_triage_alert',x.id,x.event_kind,
    '/findings?findingId=90100000-0000-4000-8000-000000000014',
    'Test finding',v_owner,v_owner,
    case when x.id=v_sla_two then 'cycle-2' else 'cycle-1' end,
    'queued',x.created_at,v_window
  from (values
    (v_sla_one,'internal_sla_breached'::text,v_window+interval '10 seconds'),
    (v_sla_two,'internal_sla_breached'::text,v_window+interval '11 seconds'),
    (v_supp_one,'suppression_expired'::text,v_window+interval '12 seconds'),
    (v_supp_two,'suppression_expired'::text,v_window+interval '13 seconds')
  ) x(id,event_kind,created_at);
  perform pg_temp.check('changed source events keep distinct revision identities',
    (select count(*) from public.notification_dispatches d
      where d.organization_id=v_org and d.source_id in (v_sla_one,v_sla_two)
        and d.semantic_revision in ('cycle-1','cycle-2'))=2);
  begin
    insert into public.notification_dispatches(
      organization_id,category,source_type,source_id,source_subtype,
      original_recipient_user_id,effective_recipient_user_id,
      semantic_revision,status)
    values(v_org,'finding_triage','finding_triage_alert',v_sla_one,
      'internal_sla_breached',v_owner,v_owner,'cycle-2','cancelled');
    raise exception 'same source event accepted a second semantic revision';
  exception when unique_violation then
    perform pg_temp.check('same source UUID remains one retry identity',
      (select count(*) from public.notification_dispatches d
        where d.organization_id=v_org and d.source_id=v_sla_one)=1);
  end;
  select created into v_created
  from public.schedule_notification_burst_batches_atomic(v_org,clock_timestamp(),1000);
  perform pg_temp.check('both same-category event classes get separate batches',
    v_created=2
    and (select count(distinct b.event_class) from public.notification_digest_batches b
      where b.organization_id=v_org and b.batch_kind='burst'
        and b.window_start=v_window and b.category='finding_triage'
        and b.event_class in ('finding_sla_breached','finding_suppression_expired'))=2
    and (select count(*) from public.notification_dispatches d
      where d.organization_id=v_org
        and d.source_id in (v_sla_one,v_sla_two,v_supp_one,v_supp_two)
        and d.status='burst_pending')=4);
  perform pg_temp.check('repeat scheduling does not duplicate either class',
    (select created from public.schedule_notification_burst_batches_atomic(
      v_org,clock_timestamp(),1000))=0
    and (select count(*) from public.notification_digest_batches b
      where b.organization_id=v_org and b.batch_kind='burst'
        and b.window_start=v_window and b.category='finding_triage')=2);
end $$;

select pg_temp.check('burst RPC private and pinned',
  has_function_privilege('service_role',
    'public.schedule_notification_burst_batches_atomic(uuid,timestamp with time zone,integer)','execute')
  and not has_function_privilege('authenticated',
    'public.schedule_notification_burst_batches_atomic(uuid,timestamp with time zone,integer)','execute')
  and (select prosecdef and proconfig @> array['search_path=public, pg_temp']
    from pg_proc where oid='public.schedule_notification_burst_batches_atomic(uuid,timestamp with time zone,integer)'::regprocedure)
);

rollback;
