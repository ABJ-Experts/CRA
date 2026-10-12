begin;
create function pg_temp.assert_ok(label text, condition boolean) returns void
language plpgsql as $$ begin if not coalesce(condition,false) then raise exception '%',label; end if; end $$;
select pg_temp.assert_ok('M14-03 operational dispatcher exists',to_regprocedure('public.m14_03_operational_source_rows(uuid,uuid,text,jsonb,jsonb)') is not null);
select pg_temp.assert_ok('operational dispatcher has one stable database snapshot',
 (select provolatile='s' from pg_proc where oid=to_regprocedure('public.m14_03_operational_source_rows(uuid,uuid,text,jsonb,jsonb)')));
select pg_temp.assert_ok('operational dispatcher preserves hardened pinned search path',
 (select proconfig @> array['search_path=pg_catalog, public'] from pg_proc where oid=to_regprocedure('public.m14_03_operational_source_rows(uuid,uuid,text,jsonb,jsonb)')));
select pg_temp.assert_ok('operational source functions are service-only',not exists(
 select 1 from pg_proc p where p.pronamespace='public'::regnamespace and
 (p.proname like 'm14_03_source_%_rows' or p.proname like 'm14_03_operational_%' or p.proname like 'm14_03_static_%')
 and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute') or not has_function_privilege('service_role',p.oid,'execute'))));

do $$ declare
 o uuid:='00000000-0000-4000-8000-0000000000ca';a uuid;viewer uuid;c uuid;r uuid;
 pack text;version text;p uuid;ctx jsonb;expected jsonb;actual jsonb;source text;policy jsonb;
 columns jsonb;native_row record;count_before bigint;count_after bigint;
 legacy_notifications_only boolean;
 begin
 select m.user_id into a from public.organization_members m join public.users u on u.id=m.user_id
 where m.organization_id=o and u.email='owner@cra.test' and m.role='owner';
 select m.user_id into viewer from public.organization_members m join public.users u on u.id=m.user_id
 where m.organization_id=o and u.email='viewer@cra.test';
 perform pg_temp.assert_ok('seeded owner and viewer are available',a is not null and viewer is not null);
 select id into c from public.connectors where organization_id=o and archived_at is null order by id limit 1;
 select id into p from public.products where organization_id=o and archived_at is null order by id limit 1;
 select pack_key,version_key into pack,version from public.framework_pack_versions where owner_org_id is null order by pack_key,version_key limit 1;
 ctx:=jsonb_build_object('connectorId',c,'productId',p,'packKey',pack,'versionKey',version);
 select coalesce(jsonb_agg(x.id::text order by x.created_at desc,x.id),'[]') into expected from public.m14_03_connector_registry_rows(o) x;
 select coalesce(jsonb_agg(x.source_id),'[]') into actual from public.m14_03_operational_source_rows(o,a,'connectors.overview','{}',ctx) x;
 perform pg_temp.assert_ok('connector list and export share active predicate and ordering',actual=expected);

 select count(*) into count_before from public.framework_custom_pack_drafts where organization_id=o;
 insert into public.framework_custom_pack_drafts(id,organization_id,pack_key,document,draft_digest,created_by,updated_by)
 select x.id,o,'custom.'||x.id::text,jsonb_build_object('title','M14 rollback parity '||x.n),repeat('b',64),a,a
 from (select gen_random_uuid() id,n from generate_series(1,121) n) x;
 select count(*) into count_after from public.m14_03_operational_source_rows(o,a,'frameworks.custom','{}','{}');
 perform pg_temp.assert_ok('custom framework export follows every native nextOffset beyond first page',count_after=count_before+121);
 select count(*) into count_before from public.notification_dispatches
 where organization_id=o and source_type<>'report_run_recipient';
 insert into public.notification_dispatches(organization_id,category,source_type,source_id,source_subtype,original_recipient_user_id,status,created_at)
 select o,'finding_triage','finding_triage_alert',gen_random_uuid(),'m14_export_parity_'||n,a,
 case when n%2=0 then 'failed' else 'queued' end,statement_timestamp()-n*interval '1 second' from generate_series(1,121) n;
 select count(*),coalesce(bool_and(x.row_values->>'sourceType'<>'report_run_recipient'),true)
 into count_after,legacy_notifications_only
 from public.m14_03_operational_source_rows(o,a,'notifications.deliveries','{}','{}') x;
 perform pg_temp.assert_ok('notification export follows every native cursor beyond first page',count_after>=count_before+121);
 perform pg_temp.assert_ok('legacy notification export excludes scheduled report dispatches',
   legacy_notifications_only);
 select * into native_row from public.list_notification_dispatches_atomic(o,a,'failed','finding_triage',null,null,100);
 columns:=public.m14_03_source_policy('notifications.deliveries')->'columns';
 select coalesce(jsonb_agg(public.m14_03_operational_projection(x.item,columns) order by x.n),'[]') into expected
 from jsonb_array_elements(native_row.result->'rows') with ordinality x(item,n);
 select coalesce(jsonb_agg(x.row_values),'[]') into actual from public.m14_03_operational_source_rows(o,a,'notifications.deliveries','{"status":"failed","category":"finding_triage"}','{}') x;
 perform pg_temp.assert_ok('delivery status/category filter and native ordering parity',actual=expected);
 select coalesce(jsonb_agg(x.row_values),'[]') into actual from public.m14_03_operational_source_rows(o,a,'frameworks.requirement_tree','{}',ctx) x;
 select coalesce(jsonb_agg(jsonb_build_object('requirementKey',x.requirement_key,'identifier',x.identifier,'parentKey',x.parent_requirement_key,
 'position',x.position,'depth',x.depth,'heading',x.heading,'text',x.text,'sourceReference',x.source_reference) order by x.tree_order),'[]')
 into expected from public.framework_requirements x where x.pack_key=pack and x.version_key=version;
 perform pg_temp.assert_ok('framework tree source query/order parity with public fields only',actual=expected);
 -- Credential-bearing and provider payload fields are never exportable, even if native source responses contain them.
 for source in select unnest(array['connectors.overview','connectors.overview','connectors.webhook_endpoints','connectors.siem_destinations','connectors.siem_deliveries','notifications.chat_channels']) loop
 policy:=public.m14_03_source_policy(source);
 perform pg_temp.assert_ok('approved metadata excludes credentials and arbitrary payload for '||source,
 not exists(select 1 from jsonb_array_elements_text(policy->'columns') k where k~* '(password|token|secretRef|ciphertext|nonce|authTag|credentialEnvelope|endpointUrl|objectPath|payload|connectionConfig)'));
 end loop;
 begin
 perform public.m14_03_operational_source_rows(o,viewer,'connectors.overview','{}','{}');
 raise exception 'viewer export unexpectedly authorized';
 exception when insufficient_privilege then null;end;
 begin
 perform public.m14_03_operational_source_rows('00000000-0000-4000-8000-0000000000cb',a,'connectors.overview','{}','{}');
 raise exception 'forged tenant export unexpectedly authorized';
 exception when insufficient_privilege then null;end;
 begin
 perform public.m14_03_operational_source_rows(o,a,'connectors.sync_history','{}',jsonb_build_object('connectorId',gen_random_uuid()));
 raise exception 'forged connector scope unexpectedly authorized';
 exception when no_data_found then null;end;
 begin
 perform public.m14_03_operational_source_rows(o,a,'unregistered.table','{}','{}');
 raise exception 'unknown source unexpectedly authorized';
 exception when invalid_parameter_value then null;end;
 insert into public.sync_runs(organization_id,connector_id,reconciliation_kind,actor_kind,actor_user_id,trigger_idempotency_key,trigger_request_digest,adapter_version,mapping_version,correlation_id)
 values(o,c,'incremental','user',a,gen_random_uuid(),repeat('a',64),'1.0.0','export-parity',gen_random_uuid()) returning id into r;
 ctx:=ctx||jsonb_build_object('syncRunId',r);
 for source in select unnest(array['connectors.sync_records','connectors.sync_plan_items','connectors.run_conflicts','connectors.sync_run_attempts']) loop
 perform public.m14_03_operational_source_rows(o,a,source,'{}',ctx);
 end loop;
 perform pg_temp.assert_ok('all nested run source statements compile against verified parent scope',true);
 end $$;


-- A destination narrowing its product scope revokes an already generated export.
select pg_temp.assert_ok('SIEM delivery authorization has one reachable source-owned branch',
 (select regexp_count(pg_get_functiondef('public.m14_03_operational_snapshot_access(public.export_jobs)'::regprocedure),'when ''connectors.siem_deliveries'' then')=1));
do $$ declare v_org uuid:=gen_random_uuid();v_user uuid;v_session uuid;v_legal uuid:=gen_random_uuid();v_product uuid:=gen_random_uuid();
 v_dest uuid:=gen_random_uuid();v_event uuid;v_delivery uuid:=gen_random_uuid();v_jobid uuid;v_job jsonb;v_claim jsonb;v_artifact uuid:=gen_random_uuid();v_grant jsonb;v_record public.export_jobs;
begin
 select u.id,s.id into strict v_user,v_session from public.users u join public.organization_members m on m.user_id=u.id and m.role='owner'
 join auth.sessions s on s.user_id=u.auth_user_id where u.is_active and (s.not_after is null or s.not_after>clock_timestamp()) order by s.created_at desc limit 1;
 insert into public.organizations(id,name,slug) values(v_org,'M14 export rollback fixture','m14-export-'||v_org::text);
 insert into public.organization_members(organization_id,user_id,role) values(v_org,v_user,'owner');
 insert into public.organization_session_bindings(organization_id,session_id,user_id,issued_at,last_seen_at) values(v_org,v_session,v_user,clock_timestamp(),clock_timestamp());
 insert into public.organization_legal_entities(id,organization_id,identifier,display_name,legal_name,registered_address_line_1,registered_address_locality,registered_address_postal_code,registered_address_country,main_establishment_country,manufacturer_contact_name,manufacturer_contact_email,created_by,updated_by) values(v_legal,v_org,'m14-fixture','M14 fixture','M14 fixture','1 Test','Test','12345','DE','DE','Test','m14@example.test',v_user,v_user);
 insert into public.products(id,organization_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,name,internal_code,product_type,responsible_owner_id,created_by,updated_by)
 values(v_product,v_org,v_legal,0,'{}','Original Ω fixture','=SUM(A1:A2)','standalone_software',v_user,v_user,v_user);

 select audit_id into v_event from public.m13_01_append_audit_event(v_org,'organization','m14-siem-fixture:'||gen_random_uuid(),
 'user',v_user::text,'product.updated','product',v_product::text,'completed',gen_random_uuid(),null,'{}',null,null,null,v_user);
 insert into public.siem_destinations(id,organization_id,display_name,transport,format,endpoint,event_classes,product_ids,authority_user_id,dataset_epoch,database_identity)
 values(v_dest,v_org,'M14 rollback SIEM','https','json','https://example.test/fixture',array['products'],array[v_product],v_user,gen_random_uuid(),'m14-rollback');
 insert into public.siem_deliveries(id,organization_id,destination_id,event_id,destination_revision,event_sequence,payload)
 select v_delivery,v_org,v_dest,v_event,1,coalesce(chain_sequence,1),'{}'::jsonb from public.audit_logs where id=v_event;
 v_job:=public.m14_03_create_export(v_org,v_user,v_session,jsonb_build_object('source','connectors.siem_deliveries','format','csv','scope','all_filtered','filters','{}'::jsonb,'context',jsonb_build_object('destinationId',v_dest),'idempotencyKey',gen_random_uuid()));
 v_jobid:=(v_job->>'id')::uuid;
 update public.export_jobs set requested_at='1970-01-01',updated_at='-infinity' where organization_id=v_org;
 v_claim:=public.m14_03_claim_export('m14-siem-fixture');
 v_claim:=public.m14_03_capture_export(v_org,v_jobid,'m14-siem-fixture',(v_claim->>'version')::integer);
 perform pg_temp.assert_ok('SIEM fixture captured one authorized product delivery',(v_claim->>'totalRows')::integer=1);
 v_claim:=public.m14_03_publish_capture(v_org,v_jobid,'m14-siem-fixture',(v_claim->>'version')::integer);
 update public.export_jobs set state='ready',worker_id=null,lease_expires_at=null,parts=jsonb_build_array(jsonb_build_object('id',v_artifact,'name','fixture.csv','mediaType','text/csv','byteLength',1,'sha256',repeat('b',64),'rowCount',1,'objectPath',v_org||'/'||v_jobid||'/fixture.csv')) where id=v_jobid;
 v_grant:=public.m14_03_issue_export_download_grant(v_org,v_user,v_session,v_jobid,v_artifact,repeat('c',64));
 update public.siem_destinations set product_ids=array[gen_random_uuid()] where id=v_dest;
 select * into v_record from public.export_jobs where id=v_jobid;
 perform pg_temp.assert_ok('narrowed SIEM source product scope denies frozen snapshot',not public.m14_03_snapshot_access(v_record));
 begin perform public.m14_03_get_export(v_org,v_user,v_session,v_jobid);raise exception 'narrowed SIEM metadata accepted';exception when insufficient_privilege then null;end;
 begin perform public.m14_03_issue_export_download_grant(v_org,v_user,v_session,v_jobid,v_artifact,repeat('d',64));raise exception 'narrowed SIEM new grant accepted';exception when insufficient_privilege then null;end;
 begin perform public.m14_03_redeem_export_download_grant(v_org,v_user,v_session,v_jobid,(v_grant->>'grantId')::uuid,repeat('c',64));raise exception 'narrowed SIEM issued grant accepted';exception when insufficient_privilege then null;end;
end $$;

-- Characterize the aggregate authorization closure independently of source delivery.
-- The transaction restores the real source authority function after this fixture.
create temporary table m14_feed_authority_fixture(ref text,fingerprint text,source_created_at timestamptz);
create or replace function public.m12_06_feed_rows(p_organization_id uuid,p_actor_user_id uuid)
returns table(ref text,category text,severity text,occurred_at timestamptz,source_created_at timestamptz,title text,summary text,source_state text,notice_kind text,url text,fingerprint text)
language sql stable security definer set search_path=public,pg_temp as $$
select f.ref,'finding_triage'::text,'info'::text,f.source_created_at,f.source_created_at,
'Authorized fixture'::text,'Finding triage SLA breached'::text,'active'::text,'event'::text,'/notifications'::text,f.fingerprint
from pg_temp.m14_feed_authority_fixture f
$$;
do $$ declare o uuid:='00000000-0000-4000-8000-0000000000ca';a uuid;
 as_of timestamptz:='2026-10-09T08:01:10Z';w timestamptz:='2026-10-09T08:00:00Z';before_digest text;after_digest text;class text;
begin
 select m.user_id into a from public.organization_members m join public.users u on u.id=m.user_id where m.organization_id=o and u.email='owner@cra.test';
 insert into m14_feed_authority_fixture values('m5_fixture_1','first','2026-10-09T08:00:10Z'),('m5_fixture_2','second','2026-10-09T08:00:20Z');
 class:=public.m12_06_feed_event_class('m5_fixture_1','Finding triage SLA breached');
 before_digest:=public.m14_03_feed_group_scope(o,a,class,w,'finding_triage',null,as_of);
 insert into m14_feed_authority_fixture values('m5_fixture_3','third','2026-10-09T08:01:20Z');
 after_digest:=public.m14_03_feed_group_scope(o,a,class,w,'finding_triage',null,as_of);
 perform pg_temp.assert_ok('frozen grouped authorization survives new same-window members after high-water',before_digest=after_digest);
 delete from m14_feed_authority_fixture where ref='m5_fixture_1';
 after_digest:=public.m14_03_feed_group_scope(o,a,class,w,'finding_triage',null,as_of);
 perform pg_temp.assert_ok('revoked captured member invalidates dependent grouped counts',before_digest<>after_digest);
end $$;
rollback;
