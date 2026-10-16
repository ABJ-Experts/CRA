begin;

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then
    raise exception 'check failed: %', p_name;
  end if;
end;
$$;

create or replace function pg_temp.create_validity_event(
  p_org uuid,p_owner uuid,p_product uuid,p_title text
) returns uuid language plpgsql as $$
declare v_document uuid := gen_random_uuid(); v_version uuid := gen_random_uuid();
begin
  insert into public.evidence_documents(id,organization_id,created_by) values(v_document,p_org,p_owner);
  insert into public.evidence_document_versions(
    id,organization_id,document_id,version_number,title,document_class,retention_evidence_class,owner_user_id,uploader_user_id,
    validity_starts_on,validity_ends_on,object_key,original_filename,declared_size_bytes,upload_expires_at,initialize_idempotency_key,initialize_request_digest
  ) values(
    v_version,p_org,v_document,1,p_title,'certificate','evidence_document',p_owner,p_owner,
    current_date - 1,current_date + 7,'m12-03-digest/'||v_version::text,p_title||'.pdf',10,clock_timestamp()+interval '10 minutes',gen_random_uuid(),repeat('c',64)
  );
  insert into public.evidence_document_version_products(organization_id,version_id,product_id) values(p_org,v_version,p_product);
  update public.evidence_document_versions
  set processing_state='clean',actual_size_bytes=10,detected_media_type='application/pdf',original_sha256=repeat('d',64),finalized_at=clock_timestamp()
  where organization_id=p_org and id=v_version;
  update public.evidence_documents set current_version_id=v_version where organization_id=p_org and id=v_document;
  insert into public.evidence_document_notification_outbox(organization_id,version_id,owner_user_id,event_type,threshold_days,next_attempt_at)
  values(p_org,v_version,p_owner,'evidence_validity_expiring',14,clock_timestamp());
  return v_version;
end;
$$;

select pg_temp.check(
  'digest RPCs are service-only pinned security definers',
  has_function_privilege('service_role','public.schedule_notification_digest_batches_atomic(uuid,timestamp with time zone,integer)','execute')
  and has_function_privilege('service_role','public.claim_notification_digest_batch_atomic(uuid,uuid,integer)','execute')
  and has_function_privilege('service_role','public.prepare_notification_digest_batch_atomic(uuid,uuid,uuid,integer)','execute')
  and has_function_privilege('service_role','public.complete_notification_digest_batch_atomic(uuid,uuid,uuid,integer,text,text,text)','execute')
  and not has_function_privilege('authenticated','public.schedule_notification_digest_batches_atomic(uuid,timestamp with time zone,integer)','execute')
  and (select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid='public.schedule_notification_digest_batches_atomic(uuid,timestamp with time zone,integer)'::regprocedure)
);

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_owner uuid;
  v_admin uuid;
  v_product uuid;
  v_bridge record;
  v_schedule record;
  v_claim record;
  v_prepare record;
  v_complete record;
  v_batch uuid;
  v_fallback record;
  v_daily_one uuid;
  v_daily_two uuid;
begin
  select id into v_owner from public.users where email='owner@cra.test';
  select id into v_admin from public.users where email='admin@cra.test';
  select id into v_product from public.products where organization_id=v_org and archived_at is null limit 1;
  update public.organization_settings set notification_delivery_mode='unified' where organization_id=v_org;
  perform public.m12_03_ensure_notification_preference(v_org,v_owner);
  update public.notification_preferences
  set modes='{"finding_triage":"immediate","evidence":"daily","supplier_owner":"off"}'::jsonb,
      timezone='Europe/Berlin',digest_local_time=time '09:00',weekly_day=1,quiet_start=null,quiet_end=null,version=version+1
  where organization_id=v_org and user_id=v_owner;

  v_daily_one := pg_temp.create_validity_event(v_org,v_owner,v_product,'daily-one');
  v_daily_two := pg_temp.create_validity_event(v_org,v_owner,v_product,'daily-two');
  select * into v_bridge from public.bridge_evidence_validity_notification_dispatches_atomic(v_org,100);
  perform pg_temp.check(
    'pending digest work enumerates its organization before any batch exists',
    exists(select 1 from public.list_due_notification_digest_organizations_atomic(null,100) where organization_id=v_org)
  );
  select * into v_schedule from public.schedule_notification_digest_batches_atomic(v_org,'2026-03-30 07:30:00+00'::timestamptz,1000);
  select id into v_batch from public.notification_digest_batches where organization_id=v_org and user_id=v_owner and status='queued' order by created_at desc limit 1;
  select * into v_claim from public.claim_notification_digest_batch_atomic(v_org,'00000000-0000-4000-8000-0000001203aa',60);
  select * into v_prepare from public.prepare_notification_digest_batch_atomic(v_org,(v_claim.batch->>'batchId')::uuid,'00000000-0000-4000-8000-0000001203aa',(v_claim.batch->>'checkpointVersion')::integer);
  select * into v_complete from public.complete_notification_digest_batch_atomic(v_org,(v_claim.batch->>'batchId')::uuid,'00000000-0000-4000-8000-0000001203aa',(v_claim.batch->>'checkpointVersion')::integer,'provider_accepted','digest-message-hash',null);

  perform pg_temp.check(
    'daily digest creates one DST-aware frozen batch and completes source rows atomically',
    v_bridge.outcome='bridged'
    and v_schedule.outcome='scheduled'
    and v_schedule.created=1
    and exists(
      select 1 from public.notification_digest_batches b
      where b.id=v_batch and cardinality(b.dispatch_ids)=2 and cardinality(b.dispatch_ids)<=100
        and b.window_end=('2026-03-30 09:00:00'::timestamp at time zone 'Europe/Berlin')
    )
    and v_claim.outcome='claimed'
    and v_prepare.outcome='ready'
    and v_prepare.delivery #>> '{payload,kind}'='digest'
    and jsonb_array_length(v_prepare.delivery #> '{payload,items}')=2
    and not exists (
      select 1 from jsonb_array_elements(v_prepare.delivery #> '{payload,items}') item
      where nullif(item->>'title','') is null or nullif(item->>'href','') is null
        or nullif(item->>'date','') is null or nullif(item->>'category','') is null
    )
    and v_complete.outcome='completed'
    and not exists(select 1 from public.evidence_document_notification_outbox
      where organization_id=v_org and version_id in (v_daily_one,v_daily_two) and status<>'sent')
  );

  perform pg_temp.create_validity_event(v_org,v_owner,v_product,'late-one');
  perform pg_temp.create_validity_event(v_org,v_owner,v_product,'late-invalid');
  perform public.bridge_evidence_validity_notification_dispatches_atomic(v_org,100);
  select * into v_schedule from public.schedule_notification_digest_batches_atomic(v_org,'2026-03-30 07:45:00+00'::timestamptz,1000);
  perform pg_temp.check(
    'late arrivals receive a new batch index in the same local window',
    v_schedule.created=1
    and exists(select 1 from public.notification_digest_batches where organization_id=v_org and user_id=v_owner and batch_index=2 and cardinality(dispatch_ids)=2)
  );
  update public.evidence_document_notification_outbox n set status='sent',sent_at=clock_timestamp()
  from public.notification_dispatches d
  where d.organization_id=v_org and d.source_type='evidence_validity' and d.safe_title='late-invalid'
    and n.organization_id=d.organization_id and n.id=d.source_id;
  select * into v_claim from public.claim_notification_digest_batch_atomic(v_org,'00000000-0000-4000-8000-0000001203aa',60);
  select * into v_prepare from public.prepare_notification_digest_batch_atomic(v_org,(v_claim.batch->>'batchId')::uuid,'00000000-0000-4000-8000-0000001203aa',(v_claim.batch->>'checkpointVersion')::integer);
  perform pg_temp.check(
    'send-time source recheck omits unavailable items without discarding valid items',
    v_prepare.outcome='ready'
    and jsonb_array_length(v_prepare.delivery #> '{payload,items}')=1
    and v_prepare.delivery #>> '{payload,items,0,title}'='late-one'
    and exists(select 1 from public.notification_dispatches where organization_id=v_org and safe_title='late-invalid' and status='cancelled')
  );
  select * into v_complete from public.complete_notification_digest_batch_atomic(v_org,(v_claim.batch->>'batchId')::uuid,'00000000-0000-4000-8000-0000001203aa',(v_claim.batch->>'checkpointVersion')::integer,'provider_accepted','late-message-hash',null);
  perform pg_temp.check('late batch accepts only the valid item',v_complete.outcome='completed');

  select * into v_fallback from public.resolve_critical_notification_recipient(v_org,gen_random_uuid(),null,'reporting_deadline');
  perform pg_temp.check(
    'critical resolver falls back to eligible owner or admin when original is unavailable',
    v_fallback.outcome='resolved'
    and (v_fallback.recipient->>'userId')::uuid in (v_owner,v_admin)
  );
end;
$$;

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_owner uuid;
  v_worker uuid := '00000000-0000-4000-8000-0000001203bc';
  v_dispatch_id uuid;
  v_first record;
  v_second record;
begin
  select id into v_owner from public.users where email='owner@cra.test';
  for batch_number in 1..101 loop
    insert into public.notification_dispatches(
      organization_id,category,source_type,source_id,source_subtype,
      original_recipient_user_id,effective_recipient_user_id,status
    ) values (
      v_org,'evidence','evidence_validity',gen_random_uuid(),'m12_03_reconcile_cap',
      v_owner,v_owner,'digest_pending'
    ) returning id into v_dispatch_id;
    insert into public.notification_digest_batches(
      organization_id,user_id,category,window_start,window_end,batch_index,
      dispatch_ids,status,lease_owner,lease_expires_at
    ) values (
      v_org,v_owner,'evidence','2020-01-01 00:00:00+00','2020-01-02 00:00:00+00',
      batch_number,array[v_dispatch_id],'leased',v_worker,clock_timestamp()-interval '1 minute'
    );
  end loop;

  select * into v_first from public.reconcile_notification_ambiguous_leases_atomic(clock_timestamp(),1000);
  perform pg_temp.check('digest reconciliation caps one transaction at 100 batches and 100 children',
    v_first.digests=100 and v_first.dispatches=100
    and (select count(*) from public.notification_digest_batches
      where organization_id=v_org and window_start='2020-01-01 00:00:00+00' and status='leased')=1
    and (select count(*) from public.notification_dispatches
      where organization_id=v_org and source_subtype='m12_03_reconcile_cap'
        and status='exhausted' and safe_error_code='lease_expired_ambiguous')=100);
  select * into v_second from public.reconcile_notification_ambiguous_leases_atomic(clock_timestamp(),1000);
  perform pg_temp.check('later reconciliation drains the remaining ambiguous digest without automatic resend',
    v_second.digests=1 and v_second.dispatches=1
    and not exists(select 1 from public.notification_dispatches
      where organization_id=v_org and source_subtype='m12_03_reconcile_cap' and status<>'exhausted'));
end;
$$;

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_owner uuid;
  v_product uuid;
  v_schedule record;
begin
  select id into v_owner from public.users where email='owner@cra.test';
  select id into v_product from public.products where organization_id=v_org and archived_at is null limit 1;
  update public.notification_preferences
  set modes='{"finding_triage":"immediate","evidence":"daily","supplier_owner":"off"}'::jsonb,
      timezone='Europe/Berlin',digest_local_time=time '09:00',quiet_start=time '08:00',quiet_end=time '10:00',version=version+1
  where organization_id=v_org and user_id=v_owner;
  perform pg_temp.create_validity_event(v_org,v_owner,v_product,'quiet-deferred');
  perform public.bridge_evidence_validity_notification_dispatches_atomic(v_org,100);
  select * into v_schedule from public.schedule_notification_digest_batches_atomic(v_org,'2026-03-30 07:30:00+00'::timestamptz,1000);
  perform pg_temp.check(
    'quiet hours defer digest without creating a batch or discarding source work',
    v_schedule.created=0 and v_schedule.deferred>=1
    and exists(select 1 from public.notification_dispatches where organization_id=v_org and status='digest_pending' and safe_error_code='quiet_hours_deferred')
  );
  select * into v_schedule from public.schedule_notification_digest_batches_atomic(v_org,'2026-03-30 08:30:00+00'::timestamptz,1000);
  perform pg_temp.check(
    'deferred digest becomes eligible after quiet hours end in the same local day',
    v_schedule.created=1
    and exists(select 1 from public.notification_digest_batches where organization_id=v_org and user_id=v_owner and status='queued')
  );
end;
$$;

select pg_temp.check(
  'DST fold chooses the first local occurrence of the configured send time',
  (select window_end='2026-10-25 00:30:00+00'::timestamptz
   from public.m12_03_digest_window('daily','Europe/Berlin',time '02:30',1,'2026-10-25 01:00:00+00'::timestamptz))
);

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_owner uuid;
  v_product uuid;
  v_schedule record;
  v_bridge record;
begin
  select id into v_owner from public.users where email='owner@cra.test';
  select id into v_product from public.products where organization_id=v_org and archived_at is null limit 1;
  update public.notification_preferences
  set modes='{"finding_triage":"immediate","evidence":"weekly","supplier_owner":"off"}'::jsonb,
      timezone='Europe/Berlin',digest_local_time=time '09:00',weekly_day=2,quiet_start=null,quiet_end=null,version=version+1
  where organization_id=v_org and user_id=v_owner;
  perform pg_temp.create_validity_event(v_org,v_owner,v_product,'weekly-tuesday');
  perform public.bridge_evidence_validity_notification_dispatches_atomic(v_org,100);
  select * into v_schedule from public.schedule_notification_digest_batches_atomic(v_org,'2026-03-30 07:30:00+00'::timestamptz,1000);
  perform pg_temp.check('weekly digest does not run on the wrong local weekday', v_schedule.created=0);
  select * into v_schedule from public.schedule_notification_digest_batches_atomic(v_org,'2026-03-31 07:30:00+00'::timestamptz,1000);
  perform pg_temp.check('weekly digest runs once in the configured local weekday window', v_schedule.created=1);

  update public.notification_preferences
  set modes='{"finding_triage":"immediate","evidence":"off","supplier_owner":"off"}'::jsonb,version=version+1
  where organization_id=v_org and user_id=v_owner;
  perform pg_temp.create_validity_event(v_org,v_owner,v_product,'off-suppressed');
  select * into v_bridge from public.bridge_evidence_validity_notification_dispatches_atomic(v_org,100);
  perform pg_temp.check(
    'off mode suppresses optional evidence and terminally clears the source queue',
    v_bridge.created>=1
    and exists(select 1 from public.notification_dispatches where organization_id=v_org and status='cancelled' and safe_error_code='preference_suppressed')
    and not exists(select 1 from public.evidence_document_notification_outbox n join public.evidence_document_versions v on v.organization_id=n.organization_id and v.id=n.version_id where n.organization_id=v_org and v.title='off-suppressed' and n.status<>'sent')
  );
end;
$$;


do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_owner uuid;
  v_admin uuid;
  v_create record;
  v_reconcile record;
  v_obligation uuid;
  v_delivery record;
  v_checkpoint integer;
  v_details record;
  v_failure record;
begin
  select id into v_owner from public.users where email='owner@cra.test';
  select id into v_admin from public.users where email='admin@cra.test';
  perform public.m12_03_ensure_notification_preference(v_org,v_owner);
  update public.notification_preferences set critical_alternate_user_id=v_admin,version=version+1 where organization_id=v_org and user_id=v_owner;
  select * into v_create from public.create_reporting_obligation_atomic(
    v_org,v_owner,'severe_incident',null,date_trunc('second', clock_timestamp()) - interval '2 days','M12-03 provenance test',gen_random_uuid(),gen_random_uuid()
  );
  v_obligation := (v_create.result->'obligation'->>'id')::uuid;
  select * into v_reconcile from public.reconcile_reporting_deadline_monitoring_atomic(clock_timestamp(),1000);
  select d.* into v_delivery
  from public.reporting_deadline_alert_deliveries d
  join public.reporting_deadline_alerts a on a.organization_id=d.organization_id and a.id=d.alert_id
  where a.organization_id=v_org and a.obligation_id=v_obligation and d.original_recipient_user_id=v_owner and d.recipient_user_id=v_admin
  order by d.created_at,d.id limit 1;
  perform pg_temp.check(
    'M6 critical delivery preserves original owner while routing to effective alternate',
    v_reconcile.outcome='reconciled' and v_delivery.id is not null
  );
  update public.organization_members set role='member'
  where organization_id=v_org and user_id=v_admin;
  perform pg_temp.check(
    'downgraded alternate cannot receive mandatory mail',
    (select recipient->>'userId' from public.resolve_critical_notification_recipient(v_org,v_owner,null,'reporting_deadline'))=v_owner::text
  );
  update public.organization_members set role='admin'
  where organization_id=v_org and user_id=v_admin;
  update public.reporting_deadline_alert_deliveries
  set delivery_state='leased',lease_owner='m12-retry',lease_expires_at=clock_timestamp()+interval '60 seconds',
    checkpoint_version=checkpoint_version+1
  where organization_id=v_org and id=v_delivery.id returning checkpoint_version into v_checkpoint;
  select * into v_details from public.get_reporting_deadline_alert_delivery_details(v_org,v_delivery.id,'m12-retry',v_checkpoint);
  select * into v_failure from public.fail_reporting_deadline_alert_delivery_atomic(v_org,v_delivery.id,'m12-retry',v_checkpoint,'smtp_timeout',true);
  update public.notification_preferences set critical_alternate_user_id=null,version=version+1
  where organization_id=v_org and user_id=v_owner;
  update public.reporting_deadline_alert_deliveries
  set delivery_state='leased',lease_owner='m12-retry',lease_expires_at=clock_timestamp()+interval '60 seconds',
    checkpoint_version=checkpoint_version+1
  where organization_id=v_org and id=v_delivery.id returning checkpoint_version into v_checkpoint;
  select * into v_details from public.get_reporting_deadline_alert_delivery_details(v_org,v_delivery.id,'m12-retry',v_checkpoint);
  perform pg_temp.check(
    'failed M6 attempt clears frozen recipient and rechecks route on retry',
    v_failure.outcome='retry_scheduled' and v_details.outcome='found'
    and v_details.details #>> '{recipient,userId}'=v_owner::text
    and exists(select 1 from public.reporting_deadline_alert_deliveries
      where organization_id=v_org and id=v_delivery.id and prepared_recipient_user_id=v_owner)
  );
end;
$$;

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_owner uuid;
  v_admin uuid;
  v_create record;
  v_obligation uuid;
  v_alert uuid;
  v_owner_delivery uuid;
  v_admin_delivery uuid;
  v_owner_checkpoint integer;
  v_admin_checkpoint integer;
  v_details record;
  v_complete record;
begin
  select id into v_owner from public.users where email='owner@cra.test';
  select id into v_admin from public.users where email='admin@cra.test';
  update public.notification_preferences set critical_alternate_user_id=null,version=version+1
  where organization_id=v_org and user_id=v_owner;
  select * into v_create from public.create_reporting_obligation_atomic(
    v_org,v_owner,'severe_incident',null,date_trunc('second',clock_timestamp())-interval '2 days',
    'M12-03 in-flight route test',gen_random_uuid(),gen_random_uuid()
  );
  v_obligation:=(v_create.result->'obligation'->>'id')::uuid;
  perform public.reconcile_reporting_deadline_monitoring_atomic(clock_timestamp(),1000);
  select id into v_alert from public.reporting_deadline_alerts
  where organization_id=v_org and obligation_id=v_obligation and threshold_percent=50 limit 1;
  select id into v_owner_delivery from public.reporting_deadline_alert_deliveries
  where organization_id=v_org and alert_id=v_alert and original_recipient_user_id=v_owner;
  select id into v_admin_delivery from public.reporting_deadline_alert_deliveries
  where organization_id=v_org and alert_id=v_alert and original_recipient_user_id=v_admin;
  update public.notification_preferences set critical_alternate_user_id=v_admin,version=version+1
  where organization_id=v_org and user_id=v_owner;
  update public.reporting_deadline_alert_deliveries
  set delivery_state='leased',lease_owner='m12-sql',lease_expires_at=clock_timestamp()+interval '60 seconds',
    checkpoint_version=checkpoint_version+1
  where organization_id=v_org and id=v_owner_delivery returning checkpoint_version into v_owner_checkpoint;
  select * into v_details from public.get_reporting_deadline_alert_delivery_details(v_org,v_owner_delivery,'m12-sql',v_owner_checkpoint);
  update public.notification_preferences set critical_alternate_user_id=null,version=version+1
  where organization_id=v_org and user_id=v_owner;
  select * into v_complete from public.complete_reporting_deadline_alert_delivery_atomic(v_org,v_owner_delivery,'m12-sql',v_owner_checkpoint);
  update public.reporting_deadline_alert_deliveries
  set delivery_state='leased',lease_owner='m12-sql',lease_expires_at=clock_timestamp()+interval '60 seconds',
    checkpoint_version=checkpoint_version+1
  where organization_id=v_org and id=v_admin_delivery returning checkpoint_version into v_admin_checkpoint;
  select * into v_details from public.get_reporting_deadline_alert_delivery_details(v_org,v_admin_delivery,'m12-sql',v_admin_checkpoint);
  perform pg_temp.check(
    'route changes preserve in-flight checkpoint and dedupe convergent recipients',
    v_complete.outcome='completed' and v_details.outcome='cancelled'
    and exists(select 1 from public.reporting_deadline_alert_deliveries
      where organization_id=v_org and id=v_owner_delivery and prepared_recipient_user_id=v_admin
        and delivery_state='provider_accepted')
  );
end;
$$;

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_owner uuid;
  v_product uuid;
  v_worker uuid := '00000000-0000-4000-8000-0000001203bb';
  v_claim record;
  v_schedule record;
  v_digest_claim record;
  v_reconcile record;
  v_reconcile_again record;
  v_digest_dispatch_id uuid;
  v_digest_dispatch_version integer;
  v_retry record;
  v_reprepared record;
begin
  select id into v_owner from public.users where email='owner@cra.test';
  select id into v_product from public.products where organization_id=v_org and archived_at is null limit 1;

  update public.notification_preferences
  set modes='{"finding_triage":"immediate","evidence":"immediate","supplier_owner":"off"}'::jsonb,quiet_start=null,quiet_end=null,version=version+1
  where organization_id=v_org and user_id=v_owner;
  perform pg_temp.create_validity_event(v_org,v_owner,v_product,'ambiguous-immediate');
  perform public.bridge_evidence_validity_notification_dispatches_atomic(v_org,100);
  select * into v_claim from public.claim_notification_dispatch_atomic(v_org,v_worker,60);

  update public.notification_preferences
  set modes='{"finding_triage":"immediate","evidence":"daily","supplier_owner":"off"}'::jsonb,timezone='Europe/Berlin',digest_local_time=time '09:00',version=version+1
  where organization_id=v_org and user_id=v_owner;
  perform pg_temp.create_validity_event(v_org,v_owner,v_product,'ambiguous-digest');
  perform public.bridge_evidence_validity_notification_dispatches_atomic(v_org,100);
  select * into v_schedule from public.schedule_notification_digest_batches_atomic(v_org,'2026-03-30 07:30:00+00'::timestamptz,1000);
  select * into v_digest_claim from public.claim_notification_digest_batch_atomic(v_org,v_worker,60);
  select d.id into v_digest_dispatch_id
  from public.notification_digest_batches b
  join public.notification_dispatches d on d.organization_id=b.organization_id and d.id=any(b.dispatch_ids)
  where b.organization_id=v_org and b.id=(v_digest_claim.batch->>'batchId')::uuid
  order by d.id limit 1;
  update public.notification_preferences
  set modes='{"finding_triage":"immediate","evidence":"immediate","supplier_owner":"off"}'::jsonb,version=version+1
  where organization_id=v_org and user_id=v_owner;
  perform public.schedule_notification_digest_batches_atomic(v_org,'2026-03-30 07:30:00+00'::timestamptz,1000);
  perform pg_temp.check('preference change cannot queue a child of a live digest batch for concurrent immediate send',
    exists(select 1 from public.notification_dispatches
      where organization_id=v_org and id=v_digest_dispatch_id and status='digest_pending'));
  update public.notification_preferences
  set modes='{"finding_triage":"immediate","evidence":"daily","supplier_owner":"off"}'::jsonb,version=version+1
  where organization_id=v_org and user_id=v_owner;
  -- Simulate a queued child created before the race guard was installed.
  update public.notification_dispatches set status='queued',version=version+1
  where organization_id=v_org and id=v_digest_dispatch_id;

  select * into v_reconcile from public.reconcile_notification_ambiguous_leases_atomic(clock_timestamp()+interval '2 hours',1000);
  select d.id,d.version into v_digest_dispatch_id,v_digest_dispatch_version
  from public.notification_digest_batches b
  join public.notification_dispatches d on d.organization_id=b.organization_id and d.id=any(b.dispatch_ids)
  where b.organization_id=v_org and b.id=(v_digest_claim.batch->>'batchId')::uuid
  order by d.id limit 1;
  perform pg_temp.check(
    'expired ambiguous digest lease exhausts its children without acknowledging source work',
    v_reconcile.outcome='reconciled'
    and v_reconcile.dispatches>=1
    and v_reconcile.digests>=1
    and exists(select 1 from public.notification_dispatches where organization_id=v_org and status='exhausted' and safe_error_code='lease_expired_ambiguous')
    and exists(select 1 from public.notification_digest_batches where organization_id=v_org and status='exhausted' and safe_error_code='lease_expired_ambiguous')
    and not exists (
      select 1 from public.notification_digest_batches b
      join public.notification_dispatches d on d.organization_id=b.organization_id and d.id=any(b.dispatch_ids)
      where b.organization_id=v_org and b.id=(v_digest_claim.batch->>'batchId')::uuid
        and d.status='digest_pending'
    )
    and exists (
      select 1 from public.notification_dispatches d
      join public.evidence_document_notification_outbox n on n.organization_id=d.organization_id and n.id=d.source_id
      where d.organization_id=v_org and d.id=v_digest_dispatch_id
        and d.status='exhausted' and d.safe_error_code='lease_expired_ambiguous' and n.status<>'sent'
    )
    and exists(select 1 from public.audit_logs
      where organization_id=v_org and action='notification.digest_lease_ambiguous'
        and entity_id=v_digest_claim.batch->>'batchId')
    and exists(select 1 from public.audit_logs
      where organization_id=v_org and action='notification.dispatch_lease_ambiguous'
        and entity_id=v_digest_dispatch_id::text)
  );
  select * into v_schedule from public.schedule_notification_digest_batches_atomic(
    v_org,'2026-03-30 07:30:00+00'::timestamptz,1000
  );
  perform pg_temp.check('ambiguous child is not automatically scheduled again',
    not exists(select 1 from public.notification_digest_batches
      where organization_id=v_org and status='queued' and v_digest_dispatch_id=any(dispatch_ids)));
  select * into v_reconcile_again from public.reconcile_notification_ambiguous_leases_atomic(
    clock_timestamp()+interval '2 hours',1000
  );
  perform pg_temp.check('reconciliation is idempotent and records each ambiguous batch once',
    v_reconcile_again.dispatches=0 and v_reconcile_again.digests=0
    and (select count(*) from public.audit_logs
      where organization_id=v_org and action='notification.digest_lease_ambiguous'
        and entity_id=v_digest_claim.batch->>'batchId')=1);

  select * into v_retry from public.retry_notification_dispatch_atomic(
    v_org,v_owner,v_digest_dispatch_id::text,v_digest_dispatch_version,gen_random_uuid()
  );
  perform pg_temp.check('explicit admin retry requeues only the selected exhausted digest item',
    v_retry.outcome='queued'
    and exists(select 1 from public.notification_dispatches
      where organization_id=v_org and id=v_digest_dispatch_id and status='queued'));
  update public.notification_dispatches
  set status='leased',lease_owner=v_worker,lease_expires_at=clock_timestamp()+interval '1 minute',version=version+1
  where organization_id=v_org and id=v_digest_dispatch_id returning version into v_digest_dispatch_version;
  select * into v_reprepared from public.prepare_notification_dispatch_atomic(
    v_org,v_digest_dispatch_id,v_worker,v_digest_dispatch_version
  );
  perform pg_temp.check('retry respects the current digest preference rather than sending immediately',
    v_reprepared.outcome='cancelled'
    and exists(select 1 from public.notification_dispatches
      where organization_id=v_org and id=v_digest_dispatch_id and status='digest_pending'));
  select * into v_schedule from public.schedule_notification_digest_batches_atomic(
    v_org,'2026-03-30 07:30:00+00'::timestamptz,1000
  );
  perform pg_temp.check('manual retry can create a new batch while the exhausted batch remains evidence',
    v_schedule.created>=1
    and exists(select 1 from public.notification_digest_batches
      where organization_id=v_org and status='queued' and id<>(v_digest_claim.batch->>'batchId')::uuid
        and v_digest_dispatch_id=any(dispatch_ids))
    and exists(select 1 from public.notification_digest_batches
      where organization_id=v_org and id=(v_digest_claim.batch->>'batchId')::uuid and status='exhausted'));
end;
$$;

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_owner uuid;
  v_create record;
  v_reconcile record;
  v_obligation uuid;
begin
  select id into v_owner from public.users where email='owner@cra.test';
  select * into v_create from public.create_reporting_obligation_atomic(
    v_org,v_owner,'severe_incident',null,date_trunc('second',clock_timestamp())-interval '2 days',
    'M12-03 unresolved critical route',gen_random_uuid(),gen_random_uuid()
  );
  v_obligation:=(v_create.result->'obligation'->>'id')::uuid;
  update public.users u set is_active=false
  where u.id in (select m.user_id from public.organization_members m
    where m.organization_id=v_org and m.role in ('owner','admin'));
  select * into v_reconcile from public.reconcile_reporting_deadline_monitoring_atomic(clock_timestamp(),1000);
  perform pg_temp.check(
    'M6 threshold with no eligible recipient keeps an admin-visible unresolved delivery',
    v_reconcile.outcome='reconciled'
    and exists(select 1 from public.reporting_deadline_alert_deliveries d
      join public.reporting_deadline_alerts a on a.organization_id=d.organization_id and a.id=d.alert_id
      where a.organization_id=v_org and a.obligation_id=v_obligation
        and d.delivery_state='dead_letter' and d.last_error_code='recipient_unavailable'
        and d.original_recipient_user_id=v_owner and d.recipient_user_id=v_owner)
  );
end;
$$;

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_owner uuid;
  v_product uuid;
  v_dispatch uuid;
  v_batch uuid;
  v_checkpoint integer;
  v_prepare record;
begin
  select id into v_owner from public.users where email='owner@cra.test';
  select id into v_product from public.products where organization_id=v_org and archived_at is null limit 1;
  update public.users set is_active=true where id=v_owner;
  update public.notification_preferences
  set modes='{"finding_triage":"immediate","evidence":"daily","supplier_owner":"off"}'::jsonb,
    timezone='Europe/Berlin',digest_local_time=time '09:00',quiet_start=null,quiet_end=null,version=version+1
  where organization_id=v_org and user_id=v_owner;
  perform pg_temp.create_validity_event(v_org,v_owner,v_product,'preference-changed');
  perform public.bridge_evidence_validity_notification_dispatches_atomic(v_org,100);
  select id into v_dispatch from public.notification_dispatches
  where organization_id=v_org and safe_title='preference-changed';
  perform public.schedule_notification_digest_batches_atomic(v_org,'2026-03-30 07:30:00+00'::timestamptz,1000);
  select id into v_batch from public.notification_digest_batches
  where organization_id=v_org and v_dispatch=any(dispatch_ids) order by created_at desc limit 1;
  update public.notification_preferences
  set modes='{"finding_triage":"immediate","evidence":"immediate","supplier_owner":"off"}'::jsonb,version=version+1
  where organization_id=v_org and user_id=v_owner;
  update public.notification_digest_batches
  set status='leased',lease_owner='00000000-0000-4000-8000-0000001203cc',
    lease_expires_at=clock_timestamp()+interval '60 seconds',version=version+1
  where organization_id=v_org and id=v_batch returning version into v_checkpoint;
  select * into v_prepare from public.prepare_notification_digest_batch_atomic(
    v_org,v_batch,'00000000-0000-4000-8000-0000001203cc',v_checkpoint);
  perform pg_temp.check(
    'changed digest preference requeues unaccepted work for immediate delivery',
    v_prepare.outcome='cancelled'
    and exists(select 1 from public.notification_dispatches where organization_id=v_org and id=v_dispatch and status='queued')
    and exists(select 1 from public.notification_digest_batches where organization_id=v_org and id=v_batch and status='cancelled')
  );
end;
$$;

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_owner uuid;
  v_create record;
  v_obligation uuid;
  v_delivery uuid;
  v_checkpoint integer;
  v_claim record;
  v_late_complete record;
begin
  select id into v_owner from public.users where email='owner@cra.test';
  select * into v_create from public.create_reporting_obligation_atomic(
    v_org,v_owner,'severe_incident',null,date_trunc('second',clock_timestamp())-interval '2 days',
    'M12-03 uncertain SMTP lease',gen_random_uuid(),gen_random_uuid()
  );
  v_obligation:=(v_create.result->'obligation'->>'id')::uuid;
  perform public.reconcile_reporting_deadline_monitoring_atomic(clock_timestamp(),1000);
  select d.id into v_delivery from public.reporting_deadline_alert_deliveries d
  join public.reporting_deadline_alerts a on a.organization_id=d.organization_id and a.id=d.alert_id
  where a.organization_id=v_org and a.obligation_id=v_obligation and d.original_recipient_user_id=v_owner
  order by a.threshold_percent limit 1;
  update public.reporting_deadline_alert_deliveries
  set delivery_state='leased',lease_owner='crashed-worker',lease_expires_at=clock_timestamp()-interval '1 second',
    delivery_attempts=1,checkpoint_version=checkpoint_version+1
  where organization_id=v_org and id=v_delivery returning checkpoint_version into v_checkpoint;
  select * into v_claim from public.claim_reporting_deadline_alert_delivery_atomic(v_org,'new-worker',120);
  select * into v_late_complete from public.complete_reporting_deadline_alert_delivery_atomic(
    v_org,v_delivery,'crashed-worker',v_checkpoint);
  perform pg_temp.check(
    'expired M6 SMTP lease is quarantined rather than automatically resent',
    (v_claim.delivery is null or (v_claim.delivery->>'id')::uuid<>v_delivery)
    and v_late_complete.outcome='conflict'
    and exists(select 1 from public.reporting_deadline_alert_deliveries
      where organization_id=v_org and id=v_delivery and delivery_state='dead_letter'
        and last_error_code='delivery_uncertain' and lease_owner is null)
    and exists(select 1 from public.audit_logs where organization_id=v_org
      and action='reporting.deadline_delivery_uncertain' and entity_id=v_delivery::text)
  );
end;
$$;

rollback;
