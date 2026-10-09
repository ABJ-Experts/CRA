begin;

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'check failed: %', p_name; end if;
end $$;

select pg_temp.check('chat configuration and delivery are durable private tables',
  to_regclass('public.notification_chat_channels') is not null
  and to_regclass('public.notification_chat_deliveries') is not null
  and (select relrowsecurity and not relforcerowsecurity from pg_class
    where oid='public.notification_chat_channels'::regclass)
  and (select relrowsecurity and not relforcerowsecurity from pg_class
    where oid='public.notification_chat_deliveries'::regclass)
  and not has_table_privilege('authenticated','public.notification_chat_channels','select')
  and has_table_privilege('service_role','public.notification_chat_channels','select,insert,update,delete'));

select pg_temp.check('chat commands and worker transitions are atomic RPCs',
  to_regprocedure('public.m12_05_create_chat_channel_atomic(uuid,uuid,uuid,jsonb,jsonb,integer,text,uuid)') is not null
  and to_regprocedure('public.m12_05_begin_chat_channel_test_atomic(uuid,uuid,uuid,integer,text,uuid)') is not null
  and to_regprocedure('public.m12_05_complete_chat_channel_test_atomic(uuid,uuid,uuid,uuid,text,text,text)') is not null
  and to_regprocedure('public.m12_05_confirm_chat_channel_atomic(uuid,uuid,uuid,integer,uuid,text,uuid)') is not null
  and to_regprocedure('public.m12_05_set_chat_channel_enabled_atomic(uuid,uuid,uuid,integer,boolean,uuid)') is not null
  and to_regprocedure('public.m12_05_bridge_chat_deliveries_atomic(uuid,integer)') is not null
  and to_regprocedure('public.m12_05_claim_chat_delivery_atomic(uuid,uuid,integer)') is not null
  and to_regprocedure('public.m12_05_prepare_chat_delivery_atomic(uuid,uuid,uuid,integer)') is not null
  and to_regprocedure('public.m12_05_complete_chat_delivery_atomic(uuid,uuid,uuid,integer,text,text,text,integer)') is not null
  and not has_function_privilege('authenticated',
    'public.m12_05_create_chat_channel_atomic(uuid,uuid,uuid,jsonb,jsonb,integer,text,uuid)','execute')
  and has_function_privilege('service_role',
    'public.m12_05_create_chat_channel_atomic(uuid,uuid,uuid,jsonb,jsonb,integer,text,uuid)','execute'));

do $$
declare
  v_org uuid:='00000000-0000-4000-8000-0000000000ca';
  v_owner uuid;
  v_product uuid;
  v_release uuid;
  v_channel uuid:='00000000-0000-4000-8000-000000120505';
  v_credential jsonb:='{"format":"aes-256-gcm-v1","keyId":"test","ciphertext":"YWJj","nonce":"AAAAAAAAAAAAAAAA","authTag":"AAAAAAAAAAAAAAAAAAAAAA=="}'::jsonb;
  v_config jsonb;
  v_created jsonb;
  v_replay jsonb;
  v_test jsonb;
  v_confirm jsonb;
  v_enabled jsonb;
  v_wrong jsonb;
  v_delivery uuid;
  v_claim jsonb;
  v_event uuid;
  v_old_event uuid;
  v_bridged uuid;
  v_worker uuid:=gen_random_uuid();
  v_prepared jsonb;
  v_allowed boolean;
  v_retry_key uuid:=gen_random_uuid();
  v_retry_version integer;
  v_retry jsonb;
begin
  select id into v_owner from public.users where email='owner@cra.test';
  select p.id,r.id into v_product,v_release from public.products p
    join public.product_releases r on r.organization_id=p.organization_id and r.product_id=p.id
    where p.organization_id=v_org and p.archived_at is null and r.archived_at is null
    order by p.id,r.id limit 1;
  v_config:=jsonb_build_object('mode','slack_webhook','displayName','Regulatory alerts',
    'eventClasses',jsonb_build_array('countdown_warning','approval_prompt'),
    'productIds',jsonb_build_array(v_product),'includeOrganizationWide',false,
    'targetMetadata','{}'::jsonb);
  perform pg_temp.check('organization-wide route allows an empty product allowlist',
    public.m12_05_chat_configuration_valid(v_org,v_owner,
      jsonb_set(jsonb_set(v_config,'{productIds}','[]'::jsonb),
        '{includeOrganizationWide}','true'::jsonb)));
  perform pg_temp.check('channel rejects product outside the authorized tenant scope',
    public.m12_05_create_chat_channel_atomic(v_org,v_owner,gen_random_uuid(),
      jsonb_set(v_config,'{productIds}',jsonb_build_array(gen_random_uuid())),
      v_credential,1,repeat('a',64),gen_random_uuid())->>'outcome'='invalid_request');
  v_created:=public.m12_05_create_chat_channel_atomic(v_org,v_owner,v_channel,v_config,v_credential,1,
    repeat('a',64),'00000000-0000-4000-8000-000000120501');
  perform pg_temp.check('channel listing returns bounded strict public projection',
    public.m12_05_list_chat_channels(v_org,v_owner,100,null,null) #>> '{channels,0,id}'=v_channel::text);
  v_replay:=public.m12_05_create_chat_channel_atomic(v_org,v_owner,v_channel,v_config,
    jsonb_set(v_credential,'{ciphertext}','"ZGVm"'::jsonb),1,
    repeat('a',64),'00000000-0000-4000-8000-000000120501');
  perform pg_temp.check('create replays stable fingerprint despite randomized envelope',
    v_created->>'outcome'='updated' and v_replay->>'outcome'='replayed');
  perform pg_temp.check('same key with a different secret fingerprint conflicts',
    public.m12_05_create_chat_channel_atomic(v_org,v_owner,v_channel,v_config,v_credential,1,
      repeat('c',64),'00000000-0000-4000-8000-000000120501')->>'outcome'='conflict');
  perform pg_temp.check('channel responses redact all routing and credentials',
    v_created #>> '{result,channel,displayName}'='Regulatory alerts'
    and v_created #>> '{result,channel,safeErrorCode}' is null
    and not (v_created->'result'->'channel' ? 'credentialEnvelope')
    and not (v_created->'result'->'channel' ? 'targetMetadata'));
  perform pg_temp.check('cross-tenant read is forbidden',
    public.m12_05_list_chat_channels_atomic('00000000-0000-4000-8000-0000000000cb',v_owner)->>'outcome'='forbidden');
  v_test:=public.m12_05_begin_chat_channel_test_atomic(v_org,v_owner,v_channel,1,repeat('b',64),
    '00000000-0000-4000-8000-000000120502');
  perform pg_temp.check('begin test is not an accepted provider delivery',
    v_test->>'outcome'='found' and
    (select test_accepted_at is null from public.notification_chat_channels where id=v_channel));
  perform pg_temp.check('pending test cannot enable route',
    public.m12_05_set_chat_channel_enabled_atomic(v_org,v_owner,v_channel,1,true,
      '00000000-0000-4000-8000-000000120503')->>'outcome'='invalid_state');
  perform pg_temp.check('test completion requires matching tenant and test',
    public.m12_05_complete_chat_channel_test_atomic(v_org,v_owner,v_channel,
      (v_test #>> '{result,testId}')::uuid,'provider_accepted',null,null)->>'outcome'='updated');
  v_wrong:=public.m12_05_confirm_chat_channel_atomic(v_org,v_owner,v_channel,1,
    (v_test #>> '{result,testId}')::uuid,repeat('c',64),'00000000-0000-4000-8000-000000120504');
  perform pg_temp.check('wrong code does not confirm and counts attempt',
    v_wrong->>'outcome'='invalid_request' and
    (select test_attempt_count=1 from public.notification_chat_channels where id=v_channel));
  v_confirm:=public.m12_05_confirm_chat_channel_atomic(v_org,v_owner,v_channel,1,
    (v_test #>> '{result,testId}')::uuid,repeat('b',64),'00000000-0000-4000-8000-000000120506');
  perform pg_temp.check('matching accepted challenge verifies current route',
    v_confirm->>'outcome'='updated' and v_confirm #>> '{result,channel,verified}'='true');
  v_enabled:=public.m12_05_set_chat_channel_enabled_atomic(v_org,v_owner,v_channel,2,true,
    '00000000-0000-4000-8000-000000120507');
  perform pg_temp.check('enabled route starts only at activation',
    v_enabled->>'outcome'='updated' and v_enabled #>> '{result,channel,enabled}'='true'
    and (select active_from is not null from public.notification_chat_channels where id=v_channel));
  insert into public.notification_chat_deliveries(organization_id,channel_id,event_class,source_kind,source_id,
    source_revision,source_product_id,severity,effective_at,next_attempt_at,route_version)
    values(v_org,v_channel,'countdown_warning','m2_support',gen_random_uuid(),'1',v_product,'high',
      clock_timestamp(),clock_timestamp(),3) returning id into v_delivery;
  v_claim:=public.m12_05_claim_chat_delivery_atomic(v_org,gen_random_uuid(),30);
  perform pg_temp.check('claim durably records attempt before provider call',
    v_claim->>'outcome'='claimed' and v_claim #>> '{result,deliveryId}'=v_delivery::text
    and (select status='attempted' and attempt_count=1 and attempted_at is not null
      from public.notification_chat_deliveries where id=v_delivery));
  update public.notification_chat_deliveries set lease_expires_at=clock_timestamp()-interval '1 second'
    where id=v_delivery;
  perform public.m12_05_claim_chat_delivery_atomic(v_org,gen_random_uuid(),30);
  perform pg_temp.check('expired attempted lease is uncertain and never auto-replayed',
    (select status='uncertain' and attempt_count=1 from public.notification_chat_deliveries where id=v_delivery));
  insert into public.product_regulatory_outbox_events(organization_id,product_id,release_id,
    event_type,event_key,payload,correlation_id,due_at,alert_threshold_days,delivery_state,
    support_period_revision,delivery_attempts)
    values(v_org,v_product,v_release,'support_period.alert','m12-05-old-email-retry-'||gen_random_uuid()::text,
      jsonb_build_object('supportPeriodEnd',public.m12_05_chat_utc(clock_timestamp()-interval '1 minute')),
      gen_random_uuid(),clock_timestamp(),0,'retrying',1,1)
    returning id into v_old_event;
  insert into public.product_regulatory_outbox_events(organization_id,product_id,release_id,
    event_type,event_key,payload,correlation_id,due_at,alert_threshold_days,delivery_state,
    support_period_revision)
    values(v_org,v_product,v_release,'support_period.alert','m12-05-chat-bridge-fixture-'||gen_random_uuid()::text,
      '{}'::jsonb,gen_random_uuid(),clock_timestamp()+interval '1 second',0,'scheduled',1)
    returning id into v_event;
  perform pg_sleep(1.1);
  perform pg_temp.check('enabled channel bridges source-owned event exactly once',
    public.m12_05_bridge_chat_deliveries_atomic(v_org,100)=1);
  perform pg_temp.check('pre-route email retry does not replay historical source event',
    (select count(*)=0 from public.notification_chat_deliveries
      where organization_id=v_org and source_kind='m2_support' and source_id=v_old_event));
  perform pg_temp.check('duplicate bridge preserves one logical delivery',
    public.m12_05_bridge_chat_deliveries_atomic(v_org,100)=0
    and (select count(*)=1 from public.notification_chat_deliveries
      where organization_id=v_org and source_kind='m2_support' and source_id=v_event));
  select id into v_bridged from public.notification_chat_deliveries
    where organization_id=v_org and source_kind='m2_support' and source_id=v_event;
  update public.notification_chat_deliveries set status='uncertain',version=version+1
    where organization_id=v_org and id=v_bridged returning version into v_retry_version;
  v_retry:=public.m12_05_retry_chat_delivery_atomic(v_org,v_owner,v_bridged,v_retry_version,v_retry_key);
  perform pg_temp.check('admin retry is versioned, tenant scoped, and idempotent for its original payload',
    v_retry->>'outcome'='updated'
    and public.m12_05_retry_chat_delivery_atomic(v_org,v_owner,v_bridged,v_retry_version,v_retry_key)->>'outcome'='replayed'
    and public.m12_05_retry_chat_delivery_atomic(v_org,v_owner,v_bridged,v_retry_version+1,v_retry_key)->>'outcome'='idempotency_conflict'
    and public.m12_05_retry_chat_delivery_atomic('00000000-0000-4000-8000-0000000000cb',v_owner,
      v_bridged,v_retry_version,gen_random_uuid())->>'outcome'='forbidden');
  update public.product_regulatory_outbox_events set due_at=clock_timestamp()+interval '10 minutes',
    delivery_attempts=1 where organization_id=v_org and id=v_event;
  update public.notification_chat_channels set last_claimed_at=clock_timestamp()-interval '2 seconds'
    where id=v_channel;
  v_claim:=public.m12_05_claim_chat_delivery_atomic(v_org,v_worker,30);
  perform pg_temp.check('claim of bridged source is tenant scoped and versioned',
    v_claim #>> '{result,deliveryId}'=v_bridged::text
    and public.m12_05_prepare_chat_delivery_atomic('00000000-0000-4000-8000-0000000000cb',
      v_bridged,v_worker,(v_claim #>> '{result,checkpointVersion}')::integer)->>'outcome'='not_found');
  v_prepared:=public.m12_05_prepare_chat_delivery_atomic(v_org,v_bridged,v_worker,
    (v_claim #>> '{result,checkpointVersion}')::integer);
  perform pg_temp.check('prepare emits only a trusted application route',
    v_prepared->>'outcome'='ready'
    and v_prepared #>> '{result,appPath}'='/products/'||v_product::text
    and v_prepared #>> '{result,eventClass}'='countdown_warning');
  update public.products set archived_at=clock_timestamp() where organization_id=v_org and id=v_product;
  v_allowed:=public.m12_05_revalidate_chat_delivery_atomic(v_org,v_bridged,v_worker,
    (v_claim #>> '{result,checkpointVersion}')::integer);
  perform pg_temp.check('send-time source revocation cancels without outbound bytes',
    not v_allowed
    and (select status='cancelled' from public.notification_chat_deliveries where id=v_bridged));
end $$;

do $$
declare v_org uuid:='00000000-0000-4000-8000-0000000000ca';
  v_owner uuid; v_viewer uuid; v_finding uuid; v_product uuid;
  v_assessment uuid:=gen_random_uuid(); v_event uuid;
begin
  select id into v_owner from public.users where email='owner@cra.test';
  select id into v_viewer from public.users where email='viewer@cra.test';
  select f.id,p.id into v_finding,v_product from public.vulnerability_findings f
    join public.product_releases r on r.organization_id=f.organization_id and r.id=f.release_id
    join public.products p on p.organization_id=r.organization_id and p.id=r.product_id
    where f.organization_id=v_org and f.status='active' and p.archived_at is null
      and public.m5_triage_finding_severity(v_org,f.id) not in ('high','critical')
      and not exists(select 1 from public.vulnerability_finding_assessments a
        where a.organization_id=v_org and a.finding_id=f.id and a.is_current)
    order by f.id limit 1;
  if v_finding is null then raise exception 'low-severity M5 approval fixture unavailable'; end if;
  insert into public.vulnerability_finding_assessments(id,organization_id,finding_id,revision,vex_status,
    detail,approval_state,approval_required,policy_severity,policy_version,submitted_by,updated_by)
  values(v_assessment,v_org,v_finding,1,'affected','M12-05 severity fixture',
    'awaiting_approval',true,'unknown',0,v_viewer,v_viewer);
  insert into public.vulnerability_finding_assessment_history_events(
    organization_id,assessment_id,event_type,actor_user_id,new_values)
  values(v_org,v_assessment,'submitted',v_viewer,'{}'::jsonb) returning id into v_event;
  perform pg_temp.check('low-severity M5 approval does not become a high-severity chat prompt',
    public.m12_05_chat_source_current(v_org,v_owner,'m5_approval',v_event,array[v_product])
      ->>'active'='false');
end $$;

do $$
declare v_org uuid:='00000000-0000-4000-8000-0000000000ca';
  v_owner uuid; v_release uuid; v_obligation uuid; v_stage uuid; v_draft uuid;
  v_created record; v_lock record; v_saved record;
begin
  select id into v_owner from public.users where email='owner@cra.test';
  select r.id into v_release from public.product_releases r
    join public.products p on p.organization_id=r.organization_id and p.id=r.product_id
    where r.organization_id=v_org and r.archived_at is null and p.archived_at is null
    order by r.id limit 1;
  select * into v_created from public.create_reporting_obligation_atomic(v_org,v_owner,
    'severe_incident',null,clock_timestamp()-interval '1 hour','M12-05 SQL test',gen_random_uuid(),gen_random_uuid());
  v_obligation:=(v_created.result->'obligation'->>'id')::uuid;
  select id into v_stage from public.reporting_obligation_stages
    where organization_id=v_org and obligation_id=v_obligation and stage_kind='early_warning';
  select * into v_created from public.create_reporting_stage_draft_atomic(v_org,v_owner,
    v_obligation,v_stage,v_release,gen_random_uuid(),gen_random_uuid());
  v_draft:=(v_created.result->'draft'->>'id')::uuid;
  select * into v_lock from public.acquire_reporting_stage_draft_lock_atomic(v_org,v_owner,v_draft,1,
    gen_random_uuid(),gen_random_uuid());
  select * into v_saved from public.save_reporting_stage_draft_atomic(v_org,v_owner,v_draft,1,
    (v_lock.result->>'lockToken')::uuid,'{"summary":"confirmed","impact":"bounded"}'::jsonb,
    '{"summary":{"origin":"human"},"impact":{"origin":"human"}}'::jsonb,
    '[{"countryCode":"DE","provenance":{"origin":"human"}}]'::jsonb,
    gen_random_uuid(),gen_random_uuid());
  perform pg_temp.check('complete M6 draft transaction emits one durable approval request',
    v_saved.outcome='updated' and
    (select count(*)=1 from public.reporting_obligation_events e
      where e.organization_id=v_org and e.obligation_id=v_obligation
        and e.event_kind='approval_requested' and e.new_value->>'stageId'=v_stage::text
        and e.new_value->>'draftRevision'='2'));
  perform public.m12_05_emit_report_approval_requested(v_org,v_stage);
  perform pg_temp.check('duplicate M6 readiness scan cannot duplicate a revision prompt',
    (select count(*)=1 from public.reporting_obligation_events e
      where e.organization_id=v_org and e.obligation_id=v_obligation and e.event_kind='approval_requested'));
end $$;

do $$
declare v_org uuid:='00000000-0000-4000-8000-0000000000ca';
  v_channel uuid:='00000000-0000-4000-8000-000000120505';
  v_owner uuid;
begin
  select id into v_owner from public.users where email='owner@cra.test';
  update public.users set is_active=false where id=v_owner;
  perform public.m12_05_bridge_chat_deliveries_atomic(v_org,100);
  perform pg_temp.check('revoked route custodian is disabled with a visible reason',
    (select not enabled and verified_at is null and safe_error_code='route_admin_revoked'
      from public.notification_chat_channels where organization_id=v_org and id=v_channel)
    and (select count(*)=1 from public.audit_logs
      where organization_id=v_org and action='notification.chat_route_admin_revoked'
        and entity_id=v_channel::text));
end $$;

rollback;
