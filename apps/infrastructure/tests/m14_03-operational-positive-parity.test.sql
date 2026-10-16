-- Populated source parity with rollback-only fixtures; no provider egress.
begin;
set local statement_timeout='30s';
create function pg_temp.assert_ok(label text, condition boolean) returns void language plpgsql as $$begin
 if not coalesce(condition,false) then raise exception '%',label;end if;end$$;
do $$declare o uuid:='00000000-0000-4000-8000-0000000000ca';a uuid;c uuid:=gen_random_uuid();channel uuid:=gen_random_uuid();
 native jsonb;actual jsonb;approved jsonb;ctx jsonb;source text;baseline bigint;observed bigint;pack text;version text;
begin
 select m.user_id into strict a from public.organization_members m join public.users u on u.id=m.user_id where m.organization_id=o and m.role='owner' and u.email='owner@cra.test';
 insert into public.connectors(id,organization_id,connector_type,display_name,adapter_version,mapping_version,created_by,updated_by)
 values(c,o,'reference_conformance','M14 positive rollback connector','1.0.0','m14-positive',a,a);
 insert into public.sync_runs(organization_id,connector_id,reconciliation_kind,actor_kind,actor_user_id,trigger_idempotency_key,trigger_request_digest,adapter_version,mapping_version,correlation_id,status,committed_at)
 select o,c,'incremental','user',a,gen_random_uuid(),repeat('a',64),'1.0.0','m14-positive',gen_random_uuid(),case when n%2=0 then 'failed' else 'completed' end,case when n%2=1 then statement_timestamp() else null end from generate_series(1,121)n;
 ctx:=jsonb_build_object('connectorId',c);
 select count(*) into observed from public.m14_03_operational_source_rows(o,a,'connectors.sync_history','{}',ctx);
 perform pg_temp.assert_ok('positive sync history includes121 native rows',observed=121);
 select count(*) into observed from public.m14_03_operational_source_rows(o,a,'connectors.sync_runs','{"status":"failed"}',ctx);
 perform pg_temp.assert_ok('positive native sync status filter parity',observed=60);
 select coalesce(jsonb_agg(x.source_id),'[]') into actual from (select source_id from public.m14_03_operational_source_rows(o,a,'connectors.sync_runs','{"status":"failed","page":2,"pageSize":25}',ctx||'{"_exportScope":"current_page"}') limit 25)x;
 select coalesce(jsonb_agg(x.id::text),'[]') into native from (select id from public.m14_03_connector_run_rows(o,c,'failed') order by created_at desc,id offset 25 limit 25)x;
 perform pg_temp.assert_ok('positive current page uses shared native row ordering and offset',actual=native);
 select count(*) into observed from public.m14_03_operational_source_rows(o,a,'connectors.overview','{}','{}') where source_id=c::text;
 perform pg_temp.assert_ok('positive rendered connector overview exports fixture once',observed=1);
 select count(*) into observed from public.m14_03_operational_source_rows(o,a,'connectors.catalogue','{}','{}');
 perform pg_temp.assert_ok('positive canonical connector catalogue is populated',observed>0);
 insert into public.notification_chat_channels(id,organization_id,mode,display_name,event_classes,target_metadata,credential_envelope,created_by_user_id,updated_by_user_id)
 values(channel,o,'slack_webhook','M14 positive rollback channel',array['high_severity_alert'],'{}',
 jsonb_build_object('format','aes-256-gcm-v1','keyId','test-fixture','ciphertext','not-a-provider-credential','nonce',repeat('a',16),'authTag',repeat('a',24)),a,a);
 approved:=public.m14_03_source_policy('notifications.chat_channels')->'columns';
 select public.m14_03_operational_projection(public.m12_05_chat_channel_public(x),approved) into native from public.notification_chat_channels x where x.id=channel;
 select row_values into actual from public.m14_03_operational_source_rows(o,a,'notifications.chat_channels','{"mode":"slack_webhook"}','{}') where source_id=channel::text;
 perform pg_temp.assert_ok('positive chat channel uses canonical public projection without envelope',actual=native and not actual?'credentialEnvelope');
 insert into public.notification_chat_deliveries(organization_id,channel_id,event_class,source_kind,source_id,source_revision,severity,effective_at,next_attempt_at,route_version,created_at,status)
 select o,channel,'high_severity_alert','m5_triage',gen_random_uuid(),'1','high',statement_timestamp(),statement_timestamp(),1,
 statement_timestamp()-n*interval '1 second',case when n%2=0 then 'failed' else 'queued' end from generate_series(1,121)n;
 select count(*) into observed from public.m14_03_operational_source_rows(o,a,'notifications.chat_deliveries',jsonb_build_object('channelId',channel),'{}');
 perform pg_temp.assert_ok('positive chat export follows every native cursor121 rows',observed=121);
 native:=public.m12_05_list_chat_deliveries_atomic(o,a,null,null,channel,null,50);
 perform pg_temp.assert_ok('native long chat cursor is canonical URL-safe base64',
  length(native->>'nextCursor')>76 and native->>'nextCursor'~'^[A-Za-z0-9_-]+$');
 perform pg_temp.assert_ok('native cursor rejects empty',public.m12_05_list_chat_deliveries_atomic(o,a,null,null,channel,'',50)->>'outcome'='invalid_request');
 perform pg_temp.assert_ok('native cursor rejects over512 characters',public.m12_05_list_chat_deliveries_atomic(o,a,null,null,channel,repeat('a',513),50)->>'outcome'='invalid_request');
 perform pg_temp.assert_ok('native cursor rejects non-url-safe characters',public.m12_05_list_chat_deliveries_atomic(o,a,null,null,channel,'!',50)->>'outcome'='invalid_request');
 approved:=public.m14_03_source_policy('notifications.chat_deliveries')->'columns';
 native:=public.m12_05_list_chat_deliveries_atomic(o,a,'failed','high_severity_alert',channel,null,50);
 select coalesce(jsonb_agg(public.m14_03_operational_projection(x.item,approved) order by x.n),'[]') into native from jsonb_array_elements(native->'rows') with ordinality x(item,n);
 select coalesce(jsonb_agg(x.row_values),'[]') into actual from (select row_values from public.m14_03_operational_source_rows(o,a,'notifications.chat_deliveries',jsonb_build_object('status','failed','eventClass','high_severity_alert','channelId',channel),'{}') limit 50)x;
 perform pg_temp.assert_ok('positive chat native status/event/channel filter and sort parity',actual=native);
 select count(*) into baseline from public.notification_digest_batches where organization_id=o and batch_kind='burst';
 insert into public.notification_digest_batches(organization_id,user_id,category,window_start,window_end,dispatch_ids,batch_kind,event_class,created_at)
 select o,a,'finding_triage',statement_timestamp()-n*interval '5 minutes',statement_timestamp()-n*interval '5 minutes'+interval '2 minutes',array[gen_random_uuid()],'burst','finding_sla_breached',statement_timestamp()-n*interval '1 second' from generate_series(1,121)n;
 select count(*) into observed from public.m14_03_operational_source_rows(o,a,'notifications.burst_batches','{}','{}');
 perform pg_temp.assert_ok('positive burst export follows every native cursor121 rows',observed=baseline+121);
 select result into native from public.list_notification_burst_batches_atomic(o,a,null,50);
 approved:=public.m14_03_source_policy('notifications.burst_batches')->'columns';
 select coalesce(jsonb_agg(public.m14_03_operational_projection(x.item,approved) order by x.n),'[]') into native from jsonb_array_elements(native->'rows') with ordinality x(item,n);
 select coalesce(jsonb_agg(x.row_values),'[]') into actual from (select row_values from public.m14_03_operational_source_rows(o,a,'notifications.burst_batches','{}','{}') limit 50)x;
 perform pg_temp.assert_ok('positive burst public field and native ordering parity',actual=native);
 insert into public.framework_controls(organization_id,title,description,owner_user_id,created_by,updated_by)
 values(o,'M14 positive rollback control','Exact Ω description',a,a,a);
 select count(*) into observed from public.m14_03_operational_source_rows(o,a,'frameworks.controls','{}','{}') where row_values->>'title'='M14 positive rollback control';
 perform pg_temp.assert_ok('positive control exports exact native row',observed=1);
 select count(*) into observed from public.m14_03_operational_source_rows(o,a,'frameworks.catalog','{}','{}');
 perform pg_temp.assert_ok('positive public framework catalogue populated',observed>0);
 select pack_key,version_key into pack,version from public.framework_pack_versions where owner_org_id is null and exists(select 1 from public.framework_requirements r where r.pack_key=framework_pack_versions.pack_key and r.version_key=framework_pack_versions.version_key) limit 1;
 select count(*) into observed from public.m14_03_operational_source_rows(o,a,'frameworks.requirement_tree','{}',jsonb_build_object('packKey',pack,'versionKey',version));
 perform pg_temp.assert_ok('positive requirement tree populated',observed>0);
 perform pg_temp.assert_ok('positive role permission matrix populated',(select count(*) from public.m14_03_operational_source_rows(o,a,'permissions.matrix','{}','{}'))>0);
end $$;
rollback;
