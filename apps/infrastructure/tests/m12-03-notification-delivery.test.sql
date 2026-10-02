begin;

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then
    raise exception 'check failed: %', p_name;
  end if;
end;
$$;

select pg_temp.check(
  'M12-03 notification tables are private service-owned state',
  to_regclass('public.notification_preferences') is not null
  and to_regclass('public.notification_dispatches') is not null
  and to_regclass('public.notification_digest_batches') is not null
  and (select relrowsecurity and not relforcerowsecurity from pg_class where oid='public.notification_preferences'::regclass)
  and (select relrowsecurity and not relforcerowsecurity from pg_class where oid='public.notification_dispatches'::regclass)
  and not has_table_privilege('authenticated','public.notification_dispatches','select')
  and has_table_privilege('service_role','public.notification_dispatches','select,insert,update,delete')
);

select pg_temp.check(
  'M12-03 RPCs are service-only pinned security definers',
  has_function_privilege('service_role','public.get_notification_preferences_atomic(uuid,uuid,uuid)','execute')
  and has_function_privilege('service_role','public.update_notification_preferences_atomic(uuid,uuid,uuid,integer,jsonb,jsonb,uuid,text)','execute')
  and has_function_privilege('service_role','public.get_critical_notification_route_atomic(uuid,uuid,uuid)','execute')
  and has_function_privilege('service_role','public.update_critical_notification_route_atomic(uuid,uuid,uuid,integer,uuid,uuid)','execute')
  and has_function_privilege('service_role','public.bridge_evidence_validity_notification_dispatches_atomic(uuid,integer)','execute')
  and not has_function_privilege('authenticated','public.update_notification_preferences_atomic(uuid,uuid,uuid,integer,jsonb,jsonb,uuid,text)','execute')
  and (select prosecdef and proconfig @> array['search_path=public, pg_temp']
       from pg_proc where oid='public.update_notification_preferences_atomic(uuid,uuid,uuid,integer,jsonb,jsonb,uuid,text)'::regprocedure)
);

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_owner uuid;
  v_admin uuid;
  v_preferences record;
  v_route record;
  v_replayed record;
  v_conflict record;
  v_pref_version integer;
  v_rejected_timezone boolean := false;
begin
  select id into v_owner from public.users where email='owner@cra.test';
  select id into v_admin from public.users where email='admin@cra.test';
  select coalesce((select version from public.notification_preferences
    where organization_id=v_org and user_id=v_owner),1) into v_pref_version;

  select * into v_preferences from public.update_notification_preferences_atomic(
    v_org,
    v_owner,
    v_owner,
    v_pref_version,
    '{"finding_triage":"immediate","evidence":"daily","supplier_owner":"off"}'::jsonb,
    '{"timezone":"Etc/UTC","localTime":"08:30","weekday":1,"quietHours":{"start":"18:00","end":"07:00"}}'::jsonb,
    '00000000-0000-4000-8000-000000120301',
    'owner preference setup'
  );
  select * into v_replayed from public.update_notification_preferences_atomic(
    v_org,
    v_owner,
    v_owner,
    v_pref_version,
    '{"finding_triage":"immediate","evidence":"daily","supplier_owner":"off"}'::jsonb,
    '{"timezone":"Etc/UTC","localTime":"08:30","weekday":1,"quietHours":{"start":"18:00","end":"07:00"}}'::jsonb,
    '00000000-0000-4000-8000-000000120301',
    'owner preference setup'
  );
  select * into v_conflict from public.update_notification_preferences_atomic(
    v_org,
    v_owner,
    v_owner,
    v_pref_version,
    '{"finding_triage":"weekly","evidence":"daily","supplier_owner":"off"}'::jsonb,
    '{"timezone":"Etc/UTC","localTime":"08:30","weekday":1,"quietHours":{"start":"18:00","end":"07:00"}}'::jsonb,
    '00000000-0000-4000-8000-000000120301',
    'changed replay'
  );

  perform pg_temp.check(
    'preferences require all category modes and replay by digest',
    v_preferences.outcome='updated'
    and v_preferences.result #>> '{preferences,modes,evidence}' = 'daily'
    and v_replayed.outcome='replayed'
    and v_conflict.outcome='idempotency_conflict'
  );

  select * into v_route from public.update_critical_notification_route_atomic(
    v_org,
    v_owner,
    v_owner,
    v_pref_version+1,
    v_admin,
    '00000000-0000-4000-8000-000000120302'
  );

  perform pg_temp.check(
    'critical route records one alternate user without toggles',
    v_route.outcome='updated'
    and v_route.result #>> '{route,userId}' = v_owner::text
    and v_route.result #>> '{route,alternateUserId}' = v_admin::text
  );
  begin
    update public.notification_preferences set timezone='Mars/Olympus'
    where organization_id=v_org and user_id=v_owner;
  exception when check_violation then
    v_rejected_timezone:=true;
  end;
  perform pg_temp.check('direct writes reject non-IANA timezones',v_rejected_timezone);
  perform pg_temp.check(
    'critical route rejects ordinary members as alternate recipients',
    (select outcome from public.update_critical_notification_route_atomic(
      v_org,v_owner,v_owner,v_pref_version+2,(select id from public.users where email='member@cra.test'),
      '00000000-0000-4000-8000-000000120304'))='invalid_request'
  );
  update public.organization_members set role='member'
  where organization_id=v_org and user_id=v_admin;
  perform pg_temp.check(
    'downgraded alternate is rejected at send time even if still a member',
    (select recipient->>'userId' from public.resolve_critical_notification_recipient(
      v_org,v_owner,null,'reporting_deadline'))=v_owner::text
  );
  update public.organization_members set role='admin'
  where organization_id=v_org and user_id=v_admin;
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
  v_delivery_recipient uuid;
begin
  select id into v_owner from public.users where email='owner@cra.test';
  select id into v_admin from public.users where email='admin@cra.test';
  perform public.update_critical_notification_route_atomic(
    v_org,
    v_owner,
    v_owner,
    coalesce((select version from public.notification_preferences where organization_id=v_org and user_id=v_owner), 1),
    v_admin,
    '00000000-0000-4000-8000-000000120303'
  );

  select * into v_create from public.create_reporting_obligation_atomic(
    v_org,
    v_owner,
    'severe_incident',
    null,
    date_trunc('second', clock_timestamp()) - interval '2 days',
    'Critical notification route test.',
    gen_random_uuid(),
    gen_random_uuid()
  );
  v_obligation := (v_create.result->'obligation'->>'id')::uuid;
  select * into v_reconcile from public.reconcile_reporting_deadline_monitoring_atomic(clock_timestamp(), 1000);

  select d.recipient_user_id into v_delivery_recipient
  from public.reporting_deadline_alert_deliveries d
  join public.reporting_deadline_alerts a on a.organization_id=d.organization_id and a.id=d.alert_id
  where a.organization_id=v_org and a.obligation_id=v_obligation
  order by d.created_at, d.id
  limit 1;

  perform pg_temp.check(
    'critical reporting deadlines bypass channel opt-out and use alternate route',
    v_reconcile.outcome='reconciled'
    and v_delivery_recipient = v_admin
  );
end;
$$;

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_worker uuid := '00000000-0000-4000-8000-000000120399';
  v_owner uuid;
  v_document uuid := gen_random_uuid();
  v_version uuid := gen_random_uuid();
  v_product uuid;
  v_bridge record;
  v_legacy jsonb;
  v_claim record;
  v_complete record;
begin
  select id into v_owner from public.users where email='owner@cra.test';
  select id into v_product from public.products where organization_id=v_org and archived_at is null limit 1;
  update public.organization_settings set notification_delivery_mode='unified' where organization_id=v_org;
  update public.notification_preferences
  set modes='{"finding_triage":"immediate","evidence":"immediate","supplier_owner":"off"}'::jsonb, version=version+1
  where organization_id=v_org and user_id=v_owner;

  insert into public.evidence_documents(id,organization_id,created_by)
  values(v_document,v_org,v_owner);
  insert into public.evidence_document_versions(
    id,organization_id,document_id,version_number,title,document_class,retention_evidence_class,owner_user_id,uploader_user_id,
    validity_starts_on,validity_ends_on,object_key,original_filename,declared_size_bytes,upload_expires_at,initialize_idempotency_key,initialize_request_digest
  ) values(
    v_version,v_org,v_document,1,'M12-03 bridge evidence','certificate','evidence_document',v_owner,v_owner,
    current_date - 1,current_date + 1,'m12-03/'||v_version::text,'m12-03.pdf',10,clock_timestamp()+interval '10 minutes',gen_random_uuid(),repeat('b',64)
  );
  insert into public.evidence_document_version_products(organization_id,version_id,product_id)
  values(v_org,v_version,v_product);
  update public.evidence_document_versions
  set processing_state='clean',actual_size_bytes=10,detected_media_type='application/pdf',original_sha256=repeat('a',64),finalized_at=clock_timestamp()
  where organization_id=v_org and id=v_version;
  update public.evidence_documents set current_version_id=v_version where organization_id=v_org and id=v_document;
  insert into public.evidence_document_notification_outbox(organization_id,version_id,owner_user_id,event_type,threshold_days,next_attempt_at)
  values(v_org,v_version,v_owner,'evidence_validity_expiring',30,clock_timestamp());

  v_legacy := public.claim_evidence_validity_notification_atomic(v_org,v_worker,60);
  select * into v_bridge from public.bridge_evidence_validity_notification_dispatches_atomic(v_org,100);
  select * into v_claim from public.claim_notification_dispatch_atomic(v_org,v_worker,60);
  select * into v_complete from public.complete_notification_dispatch_atomic(
    v_org,
    (v_claim.dispatch->>'dispatchId')::uuid,
    v_worker,
    (v_claim.dispatch->>'checkpointVersion')::integer,
    'provider_accepted',
    'smtp-message-id',
    null
  );

  perform pg_temp.check(
    'unified mode routes optional evidence delivery through central dispatch',
    v_legacy is null
    and v_bridge.outcome='bridged'
    and v_bridge.created=1
    and v_claim.outcome='claimed'
    and v_claim.dispatch ? 'checkpointVersion'
    and v_complete.outcome='completed'
    and exists (
      select 1 from public.evidence_document_notification_outbox
      where organization_id=v_org and version_id=v_version and status='sent'
    )
    and exists (
      select 1 from public.notification_dispatches
      where organization_id=v_org and source_type='evidence_validity' and status='provider_accepted'
    )
  );
end;
$$;

select pg_temp.check(
  'tenant export includes preference and dispatch evidence but excludes frozen digest batches',
  exists(select 1 from public.organization_export_source_tables where source_id='notification_delivery' and table_name='notification_preferences')
  and exists(select 1 from public.organization_export_source_tables where source_id='notification_delivery' and table_name='notification_dispatches')
  and not exists(select 1 from public.organization_export_source_tables where source_id='notification_delivery' and table_name='notification_digest_batches')
);

rollback;
