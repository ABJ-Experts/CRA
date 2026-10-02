begin;

create or replace function pg_temp.check(p_name text,p_ok boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok,false) then raise exception 'check failed: %',p_name; end if;
end $$;

select pg_temp.check('M5 and M9 bridge RPCs are installed and service-only',
  to_regprocedure('public.bridge_vulnerability_triage_notification_dispatches_atomic(uuid,integer)') is not null
  and to_regprocedure('public.bridge_supplier_owner_notification_dispatches_atomic(uuid,integer)') is not null
  and has_function_privilege('service_role','public.bridge_vulnerability_triage_notification_dispatches_atomic(uuid,integer)','execute')
  and has_function_privilege('service_role','public.bridge_supplier_owner_notification_dispatches_atomic(uuid,integer)','execute')
  and has_function_privilege('service_role','public.set_notification_delivery_mode_atomic(uuid,text)','execute')
  and not has_function_privilege('authenticated','public.bridge_vulnerability_triage_notification_dispatches_atomic(uuid,integer)','execute')
  and not has_function_privilege('authenticated','public.set_notification_delivery_mode_atomic(uuid,text)','execute'));

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_finding uuid;
  v_event uuid := gen_random_uuid();
  v_event_daily uuid := gen_random_uuid();
  v_event_off uuid := gen_random_uuid();
  v_event_revoked uuid := gen_random_uuid();
  v_event_unavailable uuid := gen_random_uuid();
  v_event_rollback uuid := gen_random_uuid();
  v_owner uuid;
  v_recipient uuid;
  v_m5 record;
  v_m5_again record;
  v_m5_dispatch uuid;
  v_m5_version integer;
  v_m5_delivery record;
  v_m5_completed record;
  v_legacy record;
  v_request record;
  v_m9_delivery uuid := gen_random_uuid();
  v_m9_revoked uuid := gen_random_uuid();
  v_m9_unavailable uuid := gen_random_uuid();
  v_supplier_delivery uuid := gen_random_uuid();
  v_m9 record;
  v_m9_again record;
  v_m9_dispatch uuid;
  v_m9_version integer;
  v_m9_prepared record;
  v_m9_completed record;
  v_legacy_m9 jsonb;
  v_worker uuid := gen_random_uuid();
  v_mode record;
  v_direct_switch_blocked boolean := false;
  v_eligible_users uuid[];
begin
  select f.id into v_finding from public.vulnerability_findings f
  join public.product_releases r on r.organization_id=f.organization_id and r.id=f.release_id
  join public.products p on p.organization_id=r.organization_id and p.id=r.product_id and p.archived_at is null
  where f.organization_id=v_org and f.status='active' order by f.id limit 1;
  select u.id into v_owner from public.users u where u.email='owner@cra.test';
  perform pg_temp.check('M5 seeded active finding is available',v_finding is not null and v_owner is not null);

  select * into v_mode from public.set_notification_delivery_mode_atomic(v_org,'unified');
  perform pg_temp.check('switch to unified is explicit and scoped',v_mode.outcome in ('updated','unchanged')
    and v_mode.current_mode='unified');
  insert into public.vulnerability_triage_alert_events(id,organization_id,finding_id,event_kind,event_key,due_at)
  values(v_event,v_org,v_finding,'internal_sla_breached','m1203:'||replace(v_event::text,'-',''),clock_timestamp()-interval '1 minute');
  select (detail.result #>> '{recipient,userId}')::uuid into v_recipient
  from public.get_vulnerability_triage_alert_details(v_org,v_event) detail where detail.outcome='found';
  perform pg_temp.check('M5 recipient remains eligible for source work',v_recipient is not null
    and public.m1201_source_can(v_org,v_recipient,'finding_triage',true));
  select * into v_m5 from public.bridge_vulnerability_triage_notification_dispatches_atomic(v_org,100);
  perform pg_temp.check('M5 immediate source bridges once',v_m5.outcome='bridged'
    and exists(select 1 from public.notification_dispatches d where d.organization_id=v_org
      and d.source_type='finding_triage_alert' and d.source_id=v_event and d.category='finding_triage'
      and d.source_link='/findings?findingId='||v_finding::text));
  select * into v_legacy from public.claim_vulnerability_triage_alert(v_org,'m1203-test',120);
  perform pg_temp.check('unified M5 source does not double claim through legacy worker',v_legacy.outcome='none_due');
  select * into v_m5_again from public.bridge_vulnerability_triage_notification_dispatches_atomic(v_org,100);
  perform pg_temp.check('M5 source event is idempotent',v_m5_again.created=0);
  select d.id into v_m5_dispatch from public.notification_dispatches d
    where d.organization_id=v_org and d.source_type='finding_triage_alert' and d.source_id=v_event;
  update public.notification_dispatches set status='leased',lease_owner=v_worker,
    lease_expires_at=clock_timestamp()+interval '2 minutes',version=version+1
    where organization_id=v_org and id=v_m5_dispatch returning version into v_m5_version;
  select * into v_m5_delivery from public.prepare_notification_dispatch_atomic(v_org,v_m5_dispatch,v_worker,v_m5_version);
  perform pg_temp.check('M5 prepare emits a strictly typed internal alert',v_m5_delivery.outcome='ready'
    and v_m5_delivery.delivery #>> '{payload,kind}'='finding_triage'
    and v_m5_delivery.delivery #>> '{recipient,userId}'=v_recipient::text
    and v_m5_delivery.delivery #>> '{payload,advisoryId}' is not null);
  select * into v_m5_completed from public.complete_notification_dispatch_atomic(
    v_org,v_m5_dispatch,v_worker,v_m5_version,'provider_accepted',repeat('a',64),null);
  perform pg_temp.check('M5 provider acceptance and source completion commit together',v_m5_completed.outcome='completed'
    and exists(select 1 from public.notification_dispatches d join public.vulnerability_triage_alert_events e
      on e.organization_id=d.organization_id and e.id=d.source_id
      where d.organization_id=v_org and d.id=v_m5_dispatch and d.status='provider_accepted' and e.state='delivered'));
  select * into v_m5_completed from public.complete_notification_dispatch_atomic(
    v_org,v_m5_dispatch,v_worker,v_m5_version,'provider_accepted',repeat('a',64),null);
  perform pg_temp.check('M5 completion replay does not update source twice',v_m5_completed.outcome='replayed');

  insert into public.notification_preferences(organization_id,user_id,modes)
  values(v_org,v_recipient,jsonb_build_object('finding_triage','daily','evidence','immediate','supplier_owner','immediate'))
  on conflict(organization_id,user_id) do update set modes=excluded.modes;
  insert into public.vulnerability_triage_alert_events(id,organization_id,finding_id,event_kind,event_key,due_at)
  values(v_event_daily,v_org,v_finding,'internal_sla_breached','m1203:'||replace(v_event_daily::text,'-',''),clock_timestamp()-interval '1 minute');
  perform public.bridge_vulnerability_triage_notification_dispatches_atomic(v_org,100);
  perform pg_temp.check('M5 daily preference freezes a digest-pending dispatch',
    exists(select 1 from public.notification_dispatches d where d.organization_id=v_org
      and d.source_type='finding_triage_alert' and d.source_id=v_event_daily and d.status='digest_pending'));
  update public.notification_preferences set modes=jsonb_set(modes,'{finding_triage}',to_jsonb('off'::text))
    where organization_id=v_org and user_id=v_recipient;
  insert into public.vulnerability_triage_alert_events(id,organization_id,finding_id,event_kind,event_key,due_at)
  values(v_event_off,v_org,v_finding,'internal_sla_breached','m1203:'||replace(v_event_off::text,'-',''),clock_timestamp()-interval '1 minute');
  perform public.bridge_vulnerability_triage_notification_dispatches_atomic(v_org,100);
  perform pg_temp.check('M5 off preference does not queue an email',
    exists(select 1 from public.notification_dispatches d where d.organization_id=v_org
      and d.source_type='finding_triage_alert' and d.source_id=v_event_off
      and d.status='cancelled' and d.safe_error_code='preference_suppressed'));
  update public.notification_preferences set modes=jsonb_set(modes,'{finding_triage}',to_jsonb('immediate'::text))
    where organization_id=v_org and user_id=v_recipient;
  insert into public.vulnerability_triage_alert_events(id,organization_id,finding_id,event_kind,event_key,due_at)
  values(v_event_revoked,v_org,v_finding,'internal_sla_breached','m1203:'||replace(v_event_revoked::text,'-',''),clock_timestamp()-interval '1 minute');
  perform public.bridge_vulnerability_triage_notification_dispatches_atomic(v_org,100);
  select d.id into v_m5_dispatch from public.notification_dispatches d where d.organization_id=v_org
    and d.source_type='finding_triage_alert' and d.source_id=v_event_revoked;
  update public.notification_dispatches set status='leased',lease_owner=v_worker,
    lease_expires_at=clock_timestamp()+interval '2 minutes',version=version+1
    where organization_id=v_org and id=v_m5_dispatch returning version into v_m5_version;
  update public.users set is_active=false where id=v_recipient;
  select * into v_m5_delivery from public.prepare_notification_dispatch_atomic(v_org,v_m5_dispatch,v_worker,v_m5_version);
  perform pg_temp.check('M5 deactivated recipient is denied at send time',v_m5_delivery.outcome='cancelled'
    and exists(select 1 from public.notification_dispatches d where d.organization_id=v_org
      and d.id=v_m5_dispatch and d.status='cancelled'));
  update public.users set is_active=true where id=v_recipient;

  select q.id request_id,q.current_revision_id revision_id,r.due_at,q.internal_owner_user_id
  into v_request from public.supplier_evidence_requests q
  join public.supplier_evidence_request_revisions r on r.organization_id=q.organization_id and r.id=q.current_revision_id
  join public.products p on p.organization_id=q.organization_id and p.id=q.product_id and p.archived_at is null
  where q.organization_id=v_org and q.state='open' and q.internal_owner_user_id is not null
    and r.due_at>clock_timestamp()
    and public.m9_04_request_has_outstanding_required(v_org,q.current_revision_id)
  order by q.id limit 1;
  perform pg_temp.check('M9 seeded outstanding request is available',v_request.request_id is not null);
  insert into public.supplier_evidence_reminder_deliveries(
    id,organization_id,request_id,revision_id,due_at_snapshot,offset_hours,recipient_kind,event_kind,
    owner_user_id,scheduled_for,next_attempt_at)
  values(v_m9_delivery,v_org,v_request.request_id,v_request.revision_id,v_request.due_at,48,'owner','owner_escalation',
    v_request.internal_owner_user_id,clock_timestamp()-interval '3 days',clock_timestamp()-interval '1 minute');
  insert into public.supplier_evidence_reminder_deliveries(
    id,organization_id,request_id,revision_id,due_at_snapshot,offset_hours,recipient_kind,event_kind,
    scheduled_for,next_attempt_at)
  values(v_supplier_delivery,v_org,v_request.request_id,v_request.revision_id,v_request.due_at,-25,'supplier','supplier_reminder',
    clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 minute');
  select * into v_m9 from public.bridge_supplier_owner_notification_dispatches_atomic(v_org,100);
  perform pg_temp.check('M9 internal owner bridges without supplier recipient',v_m9.outcome='bridged'
    and exists(select 1 from public.notification_dispatches d where d.organization_id=v_org
      and d.source_type='supplier_owner_escalation' and d.source_id=v_m9_delivery and d.category='supplier_owner'
      and d.source_link like '/suppliers/%?requestId='||v_request.request_id::text)
    and not exists(select 1 from public.notification_dispatches d where d.organization_id=v_org
      and d.source_type='supplier_reminder' and d.source_id=v_m9_delivery));
  select public.claim_supplier_evidence_reminder_delivery_atomic(v_org,gen_random_uuid(),120) into v_legacy_m9;
  perform pg_temp.check('unified M9 retains external supplier legacy delivery',
    v_legacy_m9->>'outcome'='claimed' and v_legacy_m9->>'eventKind'='supplier_reminder'
    and not exists(select 1 from public.supplier_evidence_reminder_deliveries d
      where d.organization_id=v_org and d.id=v_m9_delivery and d.state='leased'));
  select * into v_m9_again from public.bridge_supplier_owner_notification_dispatches_atomic(v_org,100);
  perform pg_temp.check('M9 owner source event is idempotent',v_m9_again.created=0);
  select d.id into v_m9_dispatch from public.notification_dispatches d
    where d.organization_id=v_org and d.source_type='supplier_owner_escalation' and d.source_id=v_m9_delivery;
  update public.notification_dispatches set status='leased',lease_owner=v_worker,
    lease_expires_at=clock_timestamp()+interval '2 minutes',version=version+1
    where organization_id=v_org and id=v_m9_dispatch returning version into v_m9_version;
  select * into v_m9_prepared from public.prepare_notification_dispatch_atomic(v_org,v_m9_dispatch,v_worker,v_m9_version);
  perform pg_temp.check('M9 prepare emits only internal owner payload',v_m9_prepared.outcome='ready'
    and v_m9_prepared.delivery #>> '{payload,kind}'='supplier_owner'
    and v_m9_prepared.delivery #>> '{recipient,userId}'=v_request.internal_owner_user_id::text
    and v_m9_prepared.delivery #>> '{payload,portalTitle}' is not null
    and v_m9_prepared.delivery #>> '{payload,dueAt}' is not null);
  select * into v_m9_completed from public.complete_notification_dispatch_atomic(
    v_org,v_m9_dispatch,v_worker,v_m9_version,'provider_accepted',repeat('b',64),null);
  perform pg_temp.check('M9 provider acceptance and owner source completion commit together',v_m9_completed.outcome='completed'
    and exists(select 1 from public.notification_dispatches d join public.supplier_evidence_reminder_deliveries source
      on source.organization_id=d.organization_id and source.id=d.source_id
      where d.organization_id=v_org and d.id=v_m9_dispatch and d.status='provider_accepted' and source.state='sent')
    and exists(select 1 from public.supplier_evidence_reminder_deliveries d
      where d.organization_id=v_org and d.id=v_supplier_delivery and d.state='leased'));
  insert into public.supplier_evidence_reminder_deliveries(
    id,organization_id,request_id,revision_id,due_at_snapshot,offset_hours,recipient_kind,event_kind,
    owner_user_id,scheduled_for,next_attempt_at)
  values(v_m9_unavailable,v_org,v_request.request_id,v_request.revision_id,v_request.due_at,73,'owner','owner_escalation',
    v_request.internal_owner_user_id,clock_timestamp()-interval '1 minute',clock_timestamp()-interval '1 minute');
  update public.users set is_active=false where id=v_request.internal_owner_user_id;
  perform public.bridge_supplier_owner_notification_dispatches_atomic(v_org,100);
  perform pg_temp.check('M9 unavailable owner creates title-free visible failure',
    exists(select 1 from public.notification_dispatches d where d.organization_id=v_org
      and d.source_type='supplier_owner_escalation' and d.source_id=v_m9_unavailable
      and d.status='cancelled' and d.safe_error_code='recipient_unavailable'
      and d.safe_title is null and d.source_link is null));
  update public.users set is_active=true where id=v_request.internal_owner_user_id;
  insert into public.supplier_evidence_reminder_deliveries(
    id,organization_id,request_id,revision_id,due_at_snapshot,offset_hours,recipient_kind,event_kind,
    owner_user_id,scheduled_for,next_attempt_at)
  values(v_m9_revoked,v_org,v_request.request_id,v_request.revision_id,v_request.due_at,72,'owner','owner_escalation',
    v_request.internal_owner_user_id,clock_timestamp()-interval '1 minute',clock_timestamp()-interval '1 minute');
  perform public.bridge_supplier_owner_notification_dispatches_atomic(v_org,100);
  select d.id into v_m9_dispatch from public.notification_dispatches d where d.organization_id=v_org
    and d.source_type='supplier_owner_escalation' and d.source_id=v_m9_revoked;
  perform pg_temp.check('M9 owner dispatch is valid before source closure',
    public.m12_03_dispatch_source_valid(v_org,v_m9_dispatch));
  update public.supplier_evidence_requests set state='closed',closed_at=clock_timestamp(),
    closed_by_user_id=v_owner where organization_id=v_org and id=v_request.request_id;
  perform pg_temp.check('M9 source closure invalidates queued owner delivery',
    not public.m12_03_dispatch_source_valid(v_org,v_m9_dispatch));
  update public.notification_dispatches set status='leased',lease_owner=v_worker,
    lease_expires_at=clock_timestamp()+interval '2 minutes',version=version+1
    where organization_id=v_org and id=v_m9_dispatch;
  select * into v_mode from public.set_notification_delivery_mode_atomic(v_org,'legacy');
  perform pg_temp.check('rollback refuses in-flight unified dispatch',v_mode.outcome='active_lease'
    and v_mode.current_mode='unified');
  begin
    update public.organization_settings set notification_delivery_mode='legacy' where organization_id=v_org;
  exception when check_violation then
    v_direct_switch_blocked := true;
  end;
  perform pg_temp.check('direct settings update cannot bypass lease guard',v_direct_switch_blocked);
  update public.notification_dispatches set status='cancelled',lease_owner=null,lease_expires_at=null,
    safe_error_code='source_unavailable',version=version+1
    where organization_id=v_org and id=v_m9_dispatch;
  select * into v_mode from public.set_notification_delivery_mode_atomic(v_org,'legacy');
  perform pg_temp.check('rollback refuses open muted and pending-digest source work',
    v_mode.outcome='unsafe_rollback' and v_mode.current_mode='unified');
  v_direct_switch_blocked:=false;
  begin
    update public.organization_settings set notification_delivery_mode='legacy' where organization_id=v_org;
  exception when check_violation then
    v_direct_switch_blocked:=true;
  end;
  perform pg_temp.check('direct UPDATE cannot bypass unsafe-rollback guard',v_direct_switch_blocked);
  -- Simulate explicit operator source reconciliation inside this rolled-back fixture.
  update public.vulnerability_triage_alert_events set state='skipped_deleted'
    where organization_id=v_org and id in (v_event_daily,v_event_off);
  insert into public.vulnerability_triage_alert_events(id,organization_id,finding_id,event_kind,event_key,due_at)
  values(v_event_rollback,v_org,v_finding,'internal_sla_breached',
    'm1203:'||replace(v_event_rollback::text,'-',''),clock_timestamp()-interval '1 minute');
  perform public.bridge_vulnerability_triage_notification_dispatches_atomic(v_org,100);
  perform pg_temp.check('rollback fixture has unattempted immediate work',
    exists(select 1 from public.notification_dispatches d where d.organization_id=v_org
      and d.source_type='finding_triage_alert' and d.source_id=v_event_rollback
      and d.status='queued' and d.attempt_count=0));
  v_direct_switch_blocked:=false;
  begin
    update public.organization_settings set notification_delivery_mode='legacy' where organization_id=v_org;
  exception when check_violation then
    v_direct_switch_blocked:=true;
  end;
  perform pg_temp.check('direct mode update cannot leave queued unified delivery active',v_direct_switch_blocked);
  update public.notification_dispatches set attempt_count=1 where organization_id=v_org
    and source_type='finding_triage_alert' and source_id=v_event_rollback;
  select * into v_mode from public.set_notification_delivery_mode_atomic(v_org,'legacy');
  perform pg_temp.check('attempted queued dispatch blocks ambiguous rollback',
    v_mode.outcome='unsafe_rollback' and exists(select 1 from public.notification_dispatches d
      where d.organization_id=v_org and d.source_type='finding_triage_alert'
        and d.source_id=v_event_rollback and d.status='queued'));
  -- Only this rolled-back test fixture resets an artificial attempt count.
  update public.notification_dispatches set attempt_count=0 where organization_id=v_org
    and source_type='finding_triage_alert' and source_id=v_event_rollback;
  select * into v_mode from public.set_notification_delivery_mode_atomic(v_org,'legacy');
  perform pg_temp.check('rollback permits drained work and leaves supplier delivery independent',
    v_mode.outcome='updated' and v_mode.current_mode='legacy'
    and exists(select 1 from public.supplier_evidence_reminder_deliveries d
      where d.organization_id=v_org and d.id=v_supplier_delivery and d.state='leased')
    and exists(select 1 from public.notification_dispatches d join public.vulnerability_triage_alert_events e
      on e.organization_id=d.organization_id and e.id=d.source_id
      where d.organization_id=v_org and d.source_type='finding_triage_alert' and d.source_id=v_event_rollback
        and d.status='cancelled' and d.safe_error_code='mode_rollback' and e.state='queued')
    and not exists(select 1 from public.list_due_notification_dispatch_organizations_atomic(null,1000) due
      where due.organization_id=v_org));
  select * into v_mode from public.set_notification_delivery_mode_atomic(v_org,'unified');
  perform pg_temp.check('reenabling unified resumes only still-authorized released work',
    v_mode.outcome='updated'
    and exists(select 1 from public.notification_dispatches d where d.organization_id=v_org
      and d.source_type='finding_triage_alert' and d.source_id=v_event_rollback
      and d.status='queued' and d.attempt_count=0 and d.safe_error_code is null));
  select array_agg(m.user_id) into v_eligible_users from public.organization_members m
    join public.users u on u.id=m.user_id and u.is_active
    where m.organization_id=v_org and public.m5_triage_actor_can_edit_findings(v_org,m.user_id);
  perform pg_temp.check('M5 fixture has eligible recipients',cardinality(v_eligible_users)>0);
  update public.users set is_active=false where id=any(v_eligible_users);
  insert into public.vulnerability_triage_alert_events(id,organization_id,finding_id,event_kind,event_key,due_at)
  values(v_event_unavailable,v_org,v_finding,'internal_sla_breached',
    'm1203:'||replace(v_event_unavailable::text,'-',''),clock_timestamp()-interval '1 minute');
  perform public.bridge_vulnerability_triage_notification_dispatches_atomic(v_org,100);
  perform pg_temp.check('M5 no-recipient source becomes visible terminal failure',
    exists(select 1 from public.vulnerability_triage_alert_events e where e.organization_id=v_org
      and e.id=v_event_unavailable and e.state='recipient_unavailable' and e.error_code='recipient_unavailable')
    and not exists(select 1 from public.notification_dispatches d where d.organization_id=v_org
      and d.source_type='finding_triage_alert' and d.source_id=v_event_unavailable));
  perform pg_temp.check('cross-tenant source and dispatch are not visible',
    not public.m12_03_dispatch_source_valid(gen_random_uuid(),v_m5_dispatch)
    and not public.m12_03_dispatch_source_valid(gen_random_uuid(),v_m9_dispatch));
end $$;

rollback;
