-- Transaction-only delivery guarantees. No fixture survives this file.
begin;
set local statement_timeout='30s';
create function pg_temp.assert_true(label text, valid boolean)
returns void language plpgsql as $$ begin
  if not coalesce(valid,false) then raise exception 'failed: %',label; end if;
end $$;

do $$
declare org_id uuid:=gen_random_uuid(); actor_id uuid; definition_id uuid;
  run_id uuid; recipient_id uuid; dispatch_id uuid; mode_result record;
  config jsonb; outcome_row record; version_now integer; schema_digest text;
  scheduled_run_id uuid; scheduled_recipient_id uuid; export_id uuid;
  worker_id uuid:=gen_random_uuid(); lease_version integer;
  feed_ref text; feed_fingerprint text; session_id uuid;
  artifact_id uuid:=gen_random_uuid(); grant_id uuid;
begin
  select u.id,s.id into strict actor_id,session_id from public.users u
  join auth.sessions s on s.user_id=u.auth_user_id
  where u.is_active and u.email_verified_at is not null
    and (s.not_after is null or s.not_after>clock_timestamp())
  order by s.created_at desc limit 1;
  insert into public.organizations(id,name,slug)
  values(org_id,'Report delivery rollback fixture','m14-04-delivery-'||org_id);
  insert into public.organization_members(organization_id,user_id,role)
  values(org_id,actor_id,'owner');
  insert into public.organization_session_bindings(
    organization_id,session_id,user_id,issued_at,last_seen_at)
  values(org_id,session_id,actor_id,clock_timestamp(),clock_timestamp());

  select * into mode_result from public.m14_04_get_email_preference(org_id,actor_id);
  perform pg_temp.assert_true('report preference independent default',
    mode_result.outcome='found' and mode_result.result->>'mode'='immediate'
    and (mode_result.result->>'version')::int=1);
  select * into outcome_row from public.m14_04_set_email_preference(
    org_id,actor_id,jsonb_build_object('mode','off','expectedVersion',1,
      'idempotencyKey',gen_random_uuid()));
  perform pg_temp.assert_true('report email opt off',outcome_row.outcome='updated'
    and outcome_row.result->>'mode'='off');
  select report_email_version into version_now from public.notification_preferences
  where organization_id=org_id and user_id=actor_id;
  perform pg_temp.assert_true('report preference version independent',
    version_now=2 and (select version=1 from public.notification_preferences
      where organization_id=org_id and user_id=actor_id));
  select * into outcome_row from public.m14_04_set_email_preference(
    org_id,actor_id,jsonb_build_object('mode','immediate','expectedVersion',1,
      'idempotencyKey',gen_random_uuid()));
  perform pg_temp.assert_true('stale report email update rejected',outcome_row.outcome='conflict');

  config:=jsonb_build_object('title','Fixture','report',jsonb_build_object(
    'kind','list','source','products.registry','format','csv','context','{}'::jsonb,
    'filters','{}'::jsonb),'schedule',jsonb_build_object('frequency','daily',
    'timezone','UTC','localTime','09:00'),'dateWindow',jsonb_build_object('kind','fixed'),
    'recipientUserIds',jsonb_build_array(actor_id),'emailEnabled',true);
  schema_digest:=public.m14_04_digest(public.m14_03_source_policy('products.registry'));
  insert into public.report_definitions(organization_id,owner_user_id,
    config,config_digest,source_schema_digest,create_key)
  values(org_id,actor_id,config,public.m14_04_digest(config),schema_digest,gen_random_uuid())
  returning id into definition_id;
  insert into public.report_runs(organization_id,definition_id,definition_version,
    owner_user_id,kind,config,config_digest,schema_version,source_schema_digest,
    scheduled_for,occurrence_key)
  values(org_id,definition_id,1,actor_id,'preview',config,
    public.m14_04_digest(config),'m14_04_v1',schema_digest,
    clock_timestamp(),'preview:delivery-test')
  returning id into run_id;
  insert into public.report_run_recipients(organization_id,run_id,user_id,email_state)
  values(org_id,run_id,actor_id,'off') returning id into recipient_id;
  perform public.m14_04_enqueue_notice(org_id,recipient_id);
  perform pg_temp.assert_true('preview never enqueues mail',not exists(
    select 1 from public.notification_dispatches
    where organization_id=org_id and source_id=recipient_id));

  insert into public.notification_dispatches(organization_id,category,source_type,
    source_id,source_subtype,original_recipient_user_id,effective_recipient_user_id)
  values(org_id,'scheduled_report','report_run_recipient',recipient_id,'ready',
    actor_id,actor_id) returning id into dispatch_id;
  update public.notification_dispatches set status='leased',lease_owner=gen_random_uuid(),
    lease_expires_at=clock_timestamp()+interval '2 minutes',version=version+1
  where organization_id=org_id and id=dispatch_id;
  update public.notification_dispatches set status='exhausted',lease_owner=null,
    lease_expires_at=null,safe_error_code='lease_expired_ambiguous',version=version+1
  where organization_id=org_id and id=dispatch_id;
  perform pg_temp.assert_true('ambiguous SMTP lease remains terminal',
    (select email_state='uncertain' from public.report_run_recipients
      where organization_id=org_id and id=recipient_id));
  select * into outcome_row from public.retry_notification_dispatch_atomic(
    org_id,actor_id,dispatch_id::text,3,gen_random_uuid());
  perform pg_temp.assert_true('generic retry cannot resend report',
    outcome_row.outcome='invalid_request');

  update public.report_runs set state='succeeded',finished_at=clock_timestamp()
  where organization_id=org_id and id=run_id;
  update public.report_definitions set state='active' where organization_id=org_id
    and id=definition_id;
  insert into public.report_runs(organization_id,definition_id,definition_version,
    owner_user_id,kind,config,config_digest,schema_version,source_schema_digest,
    scheduled_for,occurrence_key)
  values(org_id,definition_id,1,actor_id,'scheduled',config,
    public.m14_04_digest(config),'m14_04_v1',schema_digest,
    clock_timestamp(),'scheduled:delivery-test') returning id into scheduled_run_id;
  insert into public.report_run_recipients(organization_id,run_id,user_id,
    generation_state,email_state,manifest,manifest_digest)
  values(org_id,scheduled_run_id,actor_id,'ready','queued','{}'::jsonb,
    public.m14_04_digest('{}'::jsonb))
  returning id into scheduled_recipient_id;
  insert into public.export_jobs(organization_id,subject_kind,requester_id,
    report_recipient_id,source,format,scope,filters,context,columns,
    idempotency_key,request_digest,permission_version,state,manifest,parts)
  values(org_id,'scheduled',actor_id,scheduled_recipient_id,'products.registry',
    'csv','all_filtered','{}'::jsonb,'{}'::jsonb,'["id"]'::jsonb,
    gen_random_uuid(),repeat('a',64),1,'ready','{}'::jsonb,
    jsonb_build_array(jsonb_build_object('id',artifact_id,'name','fixture.csv',
      'mediaType','text/csv','byteLength',0,'sha256',repeat('a',64),
      'objectPath',org_id::text||'/fixture.csv')))
  returning id into export_id;
  update public.report_run_recipients set export_job_id=export_id
  where organization_id=org_id and id=scheduled_recipient_id;
  perform pg_temp.assert_true('published recipient authorized before pause',
    public.m14_04_authorize_recipient(org_id,actor_id,scheduled_run_id,
      scheduled_recipient_id));
  insert into public.notification_dispatches(organization_id,category,source_type,
    source_id,source_subtype,original_recipient_user_id,effective_recipient_user_id)
  values(org_id,'scheduled_report','report_run_recipient',scheduled_recipient_id,
    'ready',actor_id,actor_id) returning id into dispatch_id;
  perform pg_temp.assert_true('legacy due-org scanner finds scheduled report',
    exists(select 1 from public.list_due_notification_dispatch_organizations_atomic(
      null,1000) due where due.organization_id=org_id));
  select * into outcome_row from public.claim_notification_dispatch_atomic(
    org_id,worker_id,120);
  perform pg_temp.assert_true('legacy mode claims report source',
    outcome_row.outcome='claimed'
    and outcome_row.dispatch->>'dispatchId'=dispatch_id::text);
  lease_version:=(outcome_row.dispatch->>'checkpointVersion')::integer;
  update public.report_definitions set state='paused' where organization_id=org_id
    and id=definition_id;
  perform pg_temp.assert_true('paused published artifact retains read authority',
    public.m14_04_authorize_recipient(org_id,actor_id,scheduled_run_id,
      scheduled_recipient_id));
  perform pg_temp.assert_true('bound session can stream paused report',
    public.m14_04_authorize_download(org_id,actor_id,session_id,
      scheduled_run_id,scheduled_recipient_id));
  select * into outcome_row from public.m14_04_grant(org_id,actor_id,session_id,
    scheduled_run_id,scheduled_recipient_id,artifact_id,repeat('b',64));
  grant_id:=(outcome_row.result #>> '{data,grantId}')::uuid;
  perform pg_temp.assert_true('paused report grant has only public artifact fields',
    outcome_row.outcome='found' and grant_id is not null
    and not (outcome_row.result #> '{data,artifact}' ? 'objectPath'));
  select * into outcome_row from public.m14_04_redeem(org_id,actor_id,session_id,
    scheduled_run_id,scheduled_recipient_id,grant_id,repeat('b',64));
  perform pg_temp.assert_true('paused report grant redeems once',
    outcome_row.outcome='found' and outcome_row.result->>'exportJobId'=export_id::text
    and outcome_row.result #>> '{artifact,objectPath}'=org_id::text||'/fixture.csv');
  select * into outcome_row from public.m14_04_redeem(org_id,actor_id,session_id,
    scheduled_run_id,scheduled_recipient_id,grant_id,repeat('b',64));
  perform pg_temp.assert_true('report grant replay rejected',outcome_row.outcome='forbidden');
  select * into outcome_row from public.m14_04_grant(org_id,actor_id,session_id,
    scheduled_run_id,scheduled_recipient_id,artifact_id,repeat('c',64));
  grant_id:=(outcome_row.result #>> '{data,grantId}')::uuid;
  update public.report_run_recipients set grant_expires_at=clock_timestamp()-interval '1 second'
  where organization_id=org_id and id=scheduled_recipient_id;
  select * into outcome_row from public.m14_04_redeem(org_id,actor_id,session_id,
    scheduled_run_id,scheduled_recipient_id,grant_id,repeat('c',64));
  perform pg_temp.assert_true('expired report grant denied',outcome_row.outcome='forbidden');
  select f.ref,f.fingerprint into feed_ref,feed_fingerprint
  from public.m14_04_feed_rows(org_id,actor_id) f
  where f.ref='m14_'||scheduled_recipient_id::text||'_event';
  perform pg_temp.assert_true('paused report stays in opt-in inbox',feed_ref is not null);
  select * into outcome_row from public.mark_notification_feed_read_atomic(
    org_id,actor_id,jsonb_build_array(jsonb_build_object(
      'ref',feed_ref,'expectedFingerprint',feed_fingerprint)),gen_random_uuid());
  perform pg_temp.assert_true('scheduled report can be marked read',
    outcome_row.outcome='updated' and exists(
      select 1 from public.notification_feed_reads reads
      where reads.organization_id=org_id and reads.user_id=actor_id
        and reads.ref=feed_ref and reads.fingerprint=feed_fingerprint));
  perform pg_temp.assert_true('unbound session cannot stream report',
    not public.m14_04_authorize_download(org_id,actor_id,gen_random_uuid(),
      scheduled_run_id,scheduled_recipient_id));
  select * into outcome_row from public.prepare_notification_dispatch_atomic(
    org_id,dispatch_id,worker_id,lease_version);
  perform pg_temp.assert_true('pause before SMTP cancels claimed report',
    outcome_row.outcome='cancelled'
    and (select status='cancelled' from public.notification_dispatches
      where organization_id=org_id and id=dispatch_id));
  update public.users set session_epoch_at=clock_timestamp()+interval '2 seconds'
  where id=actor_id;
  perform pg_temp.assert_true('advanced session epoch blocks report streaming',
    not public.m14_04_authorize_download(org_id,actor_id,session_id,
      scheduled_run_id,scheduled_recipient_id));
end $$;
rollback;
