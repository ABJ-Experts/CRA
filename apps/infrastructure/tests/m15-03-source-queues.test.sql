begin;
set local statement_timeout='30s';
create function pg_temp.check(label text,ok boolean) returns void language plpgsql as $$begin if not coalesce(ok,false) then raise exception 'M15-03 source queue check: %',label;end if;end $$;
do $$ declare o uuid:=gen_random_uuid();u uuid;r jsonb;source text;config jsonb;digest text;definition uuid;run uuid;recipient uuid;connector uuid;epoch bigint;result record;sync_run uuid;entity uuid:=gen_random_uuid();product uuid:=gen_random_uuid();release uuid:=gen_random_uuid();sbom uuid:=gen_random_uuid();begin
 select id into strict u from public.users where email='owner@cra.test';
 insert into public.organizations(id,name,slug)values(o,'M15-03 source queue rollback fixture','m15-03-queue-'||o);
 insert into public.organization_members(organization_id,user_id,role)values(o,u,'owner');
 foreach source in array array['exports','reports','notifications','connectors','sboms'] loop
  r:=public.m15_03_read_health_source(o,u,source,null);
  perform pg_temp.check(source||' is an implemented source',r->>'outcome'='ready');
  perform pg_temp.check(source||' excludes other tenant work',r#>>'{data,queue,pending}'='0' and r#>>'{data,queue,running}'='0');
 end loop;
 r:=public.m15_03_read_health_source(o,u,'vulnerability_feeds',null);
 perform pg_temp.check('instance-global feed execution withheld',r#>'{data,queue}'='null'::jsonb);
 insert into public.organization_export_jobs(organization_id,actor_user_id,request_digest)values(o,u,repeat('a',64));
 perform pg_temp.check('M1 owned export is pending',public.m15_03_read_health_source(o,u,'exports',null)#>>'{data,queue,pending}'='1');
 config:=jsonb_build_object('title','Rollback queue fixture','report',jsonb_build_object('kind','list','source','products.registry','format','csv','context','{}'::jsonb,'filters','{}'::jsonb),'schedule',jsonb_build_object('frequency','daily','timezone','UTC','localTime','09:00'),'dateWindow',jsonb_build_object('kind','fixed'),'recipientUserIds',jsonb_build_array(u),'emailEnabled',true);
 digest:=public.m14_04_digest(public.m14_03_source_policy('products.registry'));
 insert into public.report_definitions(organization_id,owner_user_id,config,config_digest,source_schema_digest,create_key)values(o,u,config,public.m14_04_digest(config),digest,gen_random_uuid())returning id into definition;
 insert into public.report_runs(organization_id,definition_id,definition_version,owner_user_id,kind,config,config_digest,schema_version,source_schema_digest,scheduled_for,occurrence_key)values(o,definition,1,u,'preview',config,public.m14_04_digest(config),'m14_04_v1',digest,clock_timestamp(),'preview:m15-03-queue')returning id into run;
 insert into public.report_run_recipients(organization_id,run_id,user_id,email_state)values(o,run,u,'off')returning id into recipient;
 perform pg_temp.check('owned report waiting generation is pending',public.m15_03_read_health_source(o,u,'reports',null)#>>'{data,queue,pending}'='1');
 insert into public.notification_dispatches(organization_id,category,source_type,source_id,source_subtype,original_recipient_user_id,effective_recipient_user_id)values(o,'scheduled_report','report_run_recipient',recipient,'ready',u,u);
 perform pg_temp.check('owned recipient notification is pending',public.m15_03_read_health_source(o,u,'notifications',null)#>>'{data,queue,pending}'='1');
 update public.report_run_recipients set generation_state='ready',email_state='uncertain' where organization_id=o and id=recipient;
 perform pg_temp.check('uncertain report delivery distinct from runnable work',public.m15_03_read_health_source(o,u,'reports',null)#>>'{data,queue,uncertainDelivery}'='1');
 select version into epoch from public.organization_permissions_version where organization_id=o;
 begin
  perform public.m11_create_connector_atomic(o,u,epoch,gen_random_uuid(),'reference_conformance','M15-03 rollback','1.0.0','v1','{}','manual');
  raise exception 'unlicensed connector mutation unexpectedly admitted';
 exception when insufficient_privilege then if sqlerrm<>'licensing_customer_write_denied' then raise;end if;end;
 -- Retained source work is represented with rollback-only typed rows. Runtime
 -- admission remains denied above; health reads do not admit new work.
 insert into public.connectors(organization_id,connector_type,display_name,adapter_version,mapping_version,created_by,updated_by)values(o,'reference_conformance','Rollback retained connector','1.0.0','v1',u,u)returning id into connector;
 insert into public.sync_runs(organization_id,connector_id,reconciliation_kind,work_kind,actor_kind,actor_user_id,trigger_idempotency_key,trigger_request_digest,adapter_version,mapping_version,correlation_id)values(o,connector,'incremental','dry_run','user',u,gen_random_uuid(),repeat('d',64),'1.0.0','v1',gen_random_uuid())returning id into sync_run;
 perform pg_temp.check('connector queued count',public.m15_03_read_health_source(o,u,'connectors',null)#>>'{data,queue,pending}'='1');
 update public.sync_runs set status='running' where organization_id=o and id=sync_run;
 update public.sync_runs set status='waiting_for_review' where organization_id=o and id=sync_run;
 perform pg_temp.check('connector human review separated',public.m15_03_read_health_source(o,u,'connectors',null)#>>'{data,queue,waitingForReview}'='1' and public.m15_03_read_health_source(o,u,'connectors',null)#>>'{data,queue,pending}'='0');
 insert into public.organization_legal_entities(id,organization_id,identifier,display_name,completion_status,status,created_by,updated_by)values(entity,o,'fixture','Rollback fixture','needs_completion','inactive',u,u);
 insert into public.products(id,organization_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,name,internal_code,product_type,responsible_owner_id,archived_at,created_by,updated_by)values(product,o,entity,0,'{}','Archived queue fixture','queue','component',u,clock_timestamp(),u,u);
 insert into public.product_releases(id,organization_id,product_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,label,release_version,created_by,updated_by)values(release,o,product,entity,0,'{}','Rollback','1',u,u);
 insert into public.sbom_sources(id,organization_id,product_id,release_id,actor_user_id,correlation_id,source_kind,idempotency_key,request_digest,original_filename,declared_media_type,declared_byte_size,declared_sha256,staging_storage_key,upload_expires_at)values(sbom,o,product,release,u,gen_random_uuid(),'manual_upload',gen_random_uuid(),repeat('b',64),'fixture.json','application/json',1,repeat('c',64),o||'/'||sbom||'/'||repeat('c',64),clock_timestamp()+interval '10 minutes');
 insert into public.sbom_ingest_jobs(organization_id,source_id,release_id,actor_user_id,correlation_id,idempotency_key,input_sha256)values(o,sbom,release,u,gen_random_uuid(),gen_random_uuid(),repeat('c',64));
 perform pg_temp.check('SBOM source scoped queued count',public.m15_03_read_health_source(o,u,'sboms',product)#>>'{data,queue,pending}'='1');
 insert into public.base_role_permission_overrides(organization_id,base_role,permissions)values(o,'owner','{"can_view_system_health":true,"can_view_products":false,"can_view_connectors":false,"can_export_organization":false,"can_view_reporting":false,"can_view_findings":false,"can_view_licensing":false,"can_view_evidence":false,"can_view_sboms":false,"can_view_audit":false,"can_export_products":false}');
 perform pg_temp.check('report source permission revocation',public.m15_03_read_health_source(o,u,'reports',null)->>'outcome'='withheld');
 perform pg_temp.check('notification source permission revocation',public.m15_03_read_health_source(o,u,'notifications',null)->>'outcome'='withheld');
 perform pg_temp.check('connector permission revocation',public.m15_03_read_health_source(o,u,'connectors',null)->>'outcome'='withheld');
 perform pg_temp.check('SBOM product permission revocation',public.m15_03_read_health_source(o,u,'sboms',null)->>'outcome'='withheld');
 perform pg_temp.check('export permission revocation',public.m15_03_read_health_source(o,u,'exports',null)->>'outcome'='withheld');
 -- Exercise the final RPC for every source, including delegated queue paths.
 -- Heterogeneous queues retain own work above; revoked source access must not
 -- masquerade as zero/unavailable or change the strict projection keyset.
 foreach source in array array['deadline_monitor','vulnerability_feeds','usage_metering','licensing','evidence_processing','connectors','sboms','exports','reports','notifications'] loop
  r:=public.m15_03_read_health_source(o,u,source,null);
  perform pg_temp.check(source||' health-only actor is withheld',r->>'outcome'='withheld');
  perform pg_temp.check(source||' final projection keys',(select array_agg(k order by k) from jsonb_object_keys(r)k)=array['data','observedAt','outcome','reasons','source','sourceAt']);
  perform pg_temp.check(source||' withheld null provenance/body',r->'sourceAt'='null'::jsonb and r->'data'='null'::jsonb and r->>'source'=source and r->'reasons'='["source_permission_withheld"]'::jsonb);
 end loop;
end $$;
do $$ declare o uuid;u uuid;p uuid;r uuid;before_pending bigint;after_pending bigint;begin
 select m.organization_id,m.user_id,p.id,r.id into strict o,u,p,r from public.organization_members m join public.users u on u.id=m.user_id and u.email='owner@cra.test' join public.products p on p.organization_id=m.organization_id and p.archived_at is null join public.product_releases r on r.organization_id=m.organization_id and r.product_id=p.id and r.archived_at is null where m.role='owner' order by p.id,r.id limit 1;
 before_pending:=(public.m15_03_read_health_source(o,u,'notifications',p)#>>'{data,queue,pending}')::bigint;
 insert into public.product_regulatory_outbox_events(organization_id,product_id,release_id,event_type,event_key,payload,correlation_id,due_at,alert_threshold_days,delivery_state,support_period_revision,original_recipient_user_id)values(o,p,r,'support_period.alert','m15-03-rollback-critical-'||gen_random_uuid(),'{}',gen_random_uuid(),clock_timestamp(),0,'scheduled',1,u);
 after_pending:=(public.m15_03_read_health_source(o,u,'notifications',p)#>>'{data,queue,pending}')::bigint;
 perform pg_temp.check('source-owned critical support notification included',after_pending=before_pending+1);
end $$;
rollback;
