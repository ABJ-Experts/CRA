begin;

create or replace function pg_temp.check(p_name text,p_ok boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok,false) then raise exception 'check failed: %',p_name; end if;
end $$;

select pg_temp.check('scan bridge service-only and pinned',
  to_regprocedure('public.bridge_evidence_scan_notification_dispatches_atomic(uuid,integer)') is not null
  and has_function_privilege('service_role','public.bridge_evidence_scan_notification_dispatches_atomic(uuid,integer)','execute')
  and not has_function_privilege('authenticated','public.bridge_evidence_scan_notification_dispatches_atomic(uuid,integer)','execute')
  and not has_function_privilege('authenticated','public.m12_03_prepare_evidence_validity_base(uuid,uuid,uuid,integer)','execute')
  and (select prosecdef and proconfig @> array['search_path=public, pg_temp']
       from pg_proc where oid='public.bridge_evidence_scan_notification_dispatches_atomic(uuid,integer)'::regprocedure));

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_owner uuid;
  v_removed_user uuid := gen_random_uuid();
  v_product uuid;
  v_worker uuid := gen_random_uuid();
  v_document uuid;
  v_version uuid;
  v_event text;
  v_dispatch uuid;
  v_claim record;
  v_prepared record;
  v_complete record;
  v_bridge record;
  v_source_id uuid;
  v_checkpoint_version integer;
  v_direct_switch_blocked boolean := false;
  v_mode record;
  v_legacy_first jsonb;
  v_legacy_second jsonb;
  v_outbox_id uuid;
  v_fixture_outbox_ids uuid[] := array[]::uuid[];
begin
  select id into v_owner from public.users where email='owner@cra.test';
  select id into v_product from public.products where organization_id=v_org and archived_at is null order by id limit 1;
  perform pg_temp.check('local owner and product fixture',v_owner is not null and v_product is not null);
  update public.organization_settings set notification_delivery_mode='unified' where organization_id=v_org;
  insert into public.notification_preferences(organization_id,user_id,modes)
  values(v_org,v_owner,'{"finding_triage":"immediate","evidence":"immediate","supplier_owner":"immediate"}'::jsonb)
  on conflict(organization_id,user_id) do update set modes=excluded.modes;

  foreach v_event in array array[
    'evidence_quarantined','evidence_integrity_failure','evidence_quarantined',
    'evidence_integrity_failure','evidence_quarantined'
  ] loop
    v_document:=gen_random_uuid(); v_version:=gen_random_uuid();
    insert into public.evidence_documents(id,organization_id,created_by) values(v_document,v_org,v_owner);
    insert into public.evidence_document_versions(
      id,organization_id,document_id,version_number,title,document_class,retention_evidence_class,
      owner_user_id,uploader_user_id,object_key,original_filename,declared_size_bytes,
      upload_expires_at,initialize_idempotency_key,initialize_request_digest
    ) values(
      v_version,v_org,v_document,1,'M12-03 scan bridge fixture','certificate','evidence_document',
      v_owner,v_owner,'m12-03-scan/'||v_version,'fixture.pdf',10,
      clock_timestamp()+interval '10 minutes',gen_random_uuid(),repeat('a',64)
    );
    insert into public.evidence_document_version_products(organization_id,version_id,product_id)
    values(v_org,v_version,v_product);
    update public.evidence_document_versions set
      processing_state=case when v_event='evidence_quarantined' then 'quarantined' else 'failed' end,
      failure_code=case when v_event='evidence_integrity_failure' then 'integrity_mismatch' else null end,
      actual_size_bytes=10,detected_media_type='application/pdf',original_sha256=repeat('b',64),
      finalized_at=clock_timestamp()
    where organization_id=v_org and id=v_version;
    update public.evidence_documents set current_version_id=v_version where organization_id=v_org and id=v_document;
    insert into public.evidence_document_notification_outbox(
      organization_id,version_id,owner_user_id,event_type,next_attempt_at
    ) values(v_org,v_version,v_owner,v_event,clock_timestamp())
    returning id into v_outbox_id;
    v_fixture_outbox_ids := array_append(v_fixture_outbox_ids,v_outbox_id);
  end loop;

  -- Preserve an accountable source owner even after organization membership is removed.
  insert into public.users(id,email) values(v_removed_user,
    'm12-03-removed-'||replace(v_removed_user::text,'-','')||'@cra.test');
  insert into public.organization_members(organization_id,user_id,role)
  values(v_org,v_removed_user,'member');
  v_document:=gen_random_uuid(); v_version:=gen_random_uuid();
  insert into public.evidence_documents(id,organization_id,created_by) values(v_document,v_org,v_owner);
  insert into public.evidence_document_versions(
    id,organization_id,document_id,version_number,title,document_class,retention_evidence_class,
    owner_user_id,uploader_user_id,object_key,original_filename,declared_size_bytes,
    upload_expires_at,initialize_idempotency_key,initialize_request_digest
  ) values(
    v_version,v_org,v_document,1,'M12-03 removed recipient fixture','certificate','evidence_document',
    v_removed_user,v_owner,'m12-03-scan/'||v_version,'fixture.pdf',10,
    clock_timestamp()+interval '10 minutes',gen_random_uuid(),repeat('a',64)
  );
  insert into public.evidence_document_version_products(organization_id,version_id,product_id)
  values(v_org,v_version,v_product);
  update public.evidence_document_versions set processing_state='quarantined',actual_size_bytes=10,
    detected_media_type='application/pdf',original_sha256=repeat('b',64),finalized_at=clock_timestamp()
  where organization_id=v_org and id=v_version;
  update public.evidence_documents set current_version_id=v_version where organization_id=v_org and id=v_document;
  insert into public.evidence_document_notification_outbox(
    organization_id,version_id,owner_user_id,event_type,next_attempt_at
  ) values(v_org,v_version,v_removed_user,'evidence_quarantined',clock_timestamp())
  returning id into v_outbox_id;
  v_fixture_outbox_ids := array_append(v_fixture_outbox_ids,v_outbox_id);
  delete from public.organization_members where organization_id=v_org and user_id=v_removed_user;

  perform pg_temp.check('legacy scan claim skips unified organization',
    public.claim_evidence_document_notification_atomic(v_org,v_worker,60) is null);
  select * into v_bridge from public.bridge_evidence_scan_notification_dispatches_atomic(v_org,100);
  perform pg_temp.check('scan alert variants and unavailable owner bridged',
    v_bridge.outcome='bridged' and v_bridge.created>=6
    and (select count(distinct d.source_id)=6 from public.notification_dispatches d
      where d.organization_id=v_org and d.source_id=any(v_fixture_outbox_ids))
    and exists(select 1 from public.notification_dispatches d
      join public.evidence_document_notification_outbox n
        on n.organization_id=d.organization_id and n.id=d.source_id
      where d.organization_id=v_org and d.original_recipient_user_id=v_removed_user
        and d.status='cancelled' and d.safe_error_code='recipient_unavailable'
        and d.safe_title is null and n.status='recipient_unavailable'));
  select * into v_bridge from public.bridge_evidence_scan_notification_dispatches_atomic(v_org,100);
  perform pg_temp.check('duplicate bridge is idempotent',v_bridge.outcome='bridged' and v_bridge.created=0);
  select id into v_dispatch from public.notification_dispatches
  where organization_id=v_org and source_type='evidence_quarantined'
    and safe_title='M12-03 scan bridge fixture' order by created_at,id limit 1;
  perform pg_temp.check('scan source validation is tenant bound',
    public.m12_03_evidence_scan_dispatch_source_valid(v_org,v_dispatch)
    and not public.m12_03_evidence_scan_dispatch_source_valid(gen_random_uuid(),v_dispatch));
  update public.evidence_document_versions v set processing_state='failed',failure_code='scan_failed'
  from public.evidence_document_notification_outbox n
  join public.notification_dispatches d on d.organization_id=n.organization_id and d.source_id=n.id
  where d.organization_id=v_org and d.id=v_dispatch and v.organization_id=n.organization_id and v.id=n.version_id;
  perform pg_temp.check('changed scan state invalidates queued alert',
    not public.m12_03_evidence_scan_dispatch_source_valid(v_org,v_dispatch));
  update public.notification_dispatches set status='leased',lease_owner=v_worker,
    lease_expires_at=clock_timestamp()+interval '60 seconds',version=version+1
  where organization_id=v_org and id=v_dispatch returning version into v_checkpoint_version;
  select * into v_prepared from public.prepare_notification_dispatch_atomic(
    v_org,v_dispatch,v_worker,v_checkpoint_version);
  perform pg_temp.check('changed scan state cancels lease and terminalizes source',
    v_prepared.outcome='cancelled' and exists(
      select 1 from public.notification_dispatches d
      join public.evidence_document_notification_outbox n
        on n.organization_id=d.organization_id and n.id=d.source_id
      where d.organization_id=v_org and d.id=v_dispatch and d.status='cancelled'
        and d.safe_error_code='source_unavailable' and n.status='obsolete'));

  select * into v_claim from public.claim_notification_dispatch_atomic(v_org,v_worker,60);
  select * into v_prepared from public.prepare_notification_dispatch_atomic(
    v_org,(v_claim.dispatch->>'dispatchId')::uuid,v_worker,
    (v_claim.dispatch->>'checkpointVersion')::integer);
  perform pg_temp.check('scan payload uses exact event and owner',
    v_claim.outcome='claimed' and v_prepared.outcome='ready'
    and (v_prepared.delivery #>> '{payload,kind}') in ('evidence_quarantined','evidence_integrity_failure')
    and v_prepared.delivery #>> '{recipient,userId}'=v_owner::text);
  select * into v_complete from public.complete_notification_dispatch_atomic(
    v_org,(v_claim.dispatch->>'dispatchId')::uuid,v_worker,
    (v_claim.dispatch->>'checkpointVersion')::integer,'provider_accepted',repeat('c',64),null);
  perform pg_temp.check('accepted dispatch completes source in same transaction',
    v_complete.outcome='completed' and exists(
      select 1 from public.notification_dispatches d
      join public.evidence_document_notification_outbox n on n.organization_id=d.organization_id and n.id=d.source_id
      where d.organization_id=v_org and d.id=(v_claim.dispatch->>'dispatchId')::uuid
        and d.status='provider_accepted' and n.status='sent')
    and exists(select 1 from public.audit_logs a where a.organization_id=v_org
      and a.action='notification.dispatch_provider_accepted'
      and a.entity_id=v_claim.dispatch->>'dispatchId'));
  select * into v_complete from public.complete_notification_dispatch_atomic(
    v_org,(v_claim.dispatch->>'dispatchId')::uuid,v_worker,
    (v_claim.dispatch->>'checkpointVersion')::integer,'provider_accepted',repeat('c',64),null);
  perform pg_temp.check('duplicate completion replays',v_complete.outcome='replayed');

  update public.notification_preferences set modes=jsonb_set(modes,'{evidence}','"off"'::jsonb)
  where organization_id=v_org and user_id=v_owner;
  select * into v_claim from public.claim_notification_dispatch_atomic(v_org,v_worker,60);
  select * into v_prepared from public.prepare_notification_dispatch_atomic(
    v_org,(v_claim.dispatch->>'dispatchId')::uuid,v_worker,
    (v_claim.dispatch->>'checkpointVersion')::integer);
  perform pg_temp.check('changed preference suppresses unsent scan alert',
    v_claim.outcome='claimed' and v_prepared.outcome='cancelled'
    and exists(select 1 from public.notification_dispatches d
      join public.evidence_document_notification_outbox n
        on n.organization_id=d.organization_id and n.id=d.source_id
      where d.organization_id=v_org and d.id=(v_claim.dispatch->>'dispatchId')::uuid
        and d.status='cancelled' and d.safe_error_code='preference_suppressed'
        and n.status='sent'));

  select d.source_id into v_source_id from public.notification_dispatches d
  where d.organization_id=v_org and d.status='queued' and d.attempt_count=0
    and d.source_type in ('evidence_quarantined','evidence_integrity_failure')
    and d.safe_title='M12-03 scan bridge fixture' limit 1;
  begin
    update public.organization_settings set notification_delivery_mode='legacy' where organization_id=v_org;
  exception when check_violation then
    v_direct_switch_blocked:=true;
  end;
  perform pg_temp.check('direct rollback cannot bypass queued unified dispatch',
    v_direct_switch_blocked
    and (select notification_delivery_mode from public.organization_settings where organization_id=v_org)='unified');
  select * into v_mode from public.set_notification_delivery_mode_atomic(v_org,'legacy');
  perform pg_temp.check('guarded rollback releases only unattempted scan work',
    v_mode.outcome='updated' and v_mode.previous_mode='unified' and v_mode.current_mode='legacy'
    and exists(select 1 from public.notification_dispatches d
      join public.evidence_document_notification_outbox n
        on n.organization_id=d.organization_id and n.id=d.source_id
      where d.organization_id=v_org and d.source_id=v_source_id and d.status='cancelled'
        and d.safe_error_code='mode_rollback' and n.status='queued'));
  v_legacy_first:=public.claim_evidence_document_notification_atomic(v_org,v_worker,60);
  v_legacy_second:=public.claim_evidence_document_notification_atomic(v_org,v_worker,60);
  perform pg_temp.check('legacy scan worker receives both original alert kinds',
    v_legacy_first->>'eventType' in ('evidence_quarantined','evidence_integrity_failure')
    and v_legacy_second->>'eventType' in ('evidence_quarantined','evidence_integrity_failure')
    and v_legacy_first->>'eventType' <> v_legacy_second->>'eventType'
    and exists(select 1 from public.notification_dispatches d
      where d.organization_id=v_org and d.source_id=(v_legacy_first->>'outboxId')::uuid
        and d.safe_error_code='mode_rollback' and d.status='cancelled')
    and exists(select 1 from public.notification_dispatches d
      where d.organization_id=v_org and d.source_id=(v_legacy_second->>'outboxId')::uuid
        and d.safe_error_code='mode_rollback' and d.status='cancelled'));
end $$;

rollback;
