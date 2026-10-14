-- Rollback-only M15-03 authority checks. No retained rows are changed.
begin;
set local statement_timeout = '30s';
create function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'M15-03 check failed: %', label; end if; end $$;
select pg_temp.check('latest typed registry exists', to_regclass('public.operator_registry_observations') is not null);
select pg_temp.check('reader role exists without login/bypass', exists(select 1 from pg_roles where rolname='cra_operator_registry_reader' and not rolcanlogin and not rolbypassrls and not rolsuper));
select pg_temp.check('browser registry denied', not has_table_privilege('authenticated','public.operator_registry_observations','select'));
select pg_temp.check('reader table denial', not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','storage','auth') and c.relkind in ('r','p','v','m') and has_table_privilege('cra_operator_registry_reader',c.oid,'select,insert,update,delete')));
select pg_temp.check('reader no customer RPC authority', not exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef and p.proname<>'m15_03_operator_read' and has_function_privilege('cra_operator_registry_reader',p.oid,'execute')));
select pg_temp.check('RLS nonforced', exists(select 1 from pg_class where oid='public.operator_registry_observations'::regclass and relrowsecurity and not relforcerowsecurity));
select pg_temp.check('bounded source statement timeout', (select proconfig @> array['statement_timeout=200ms'] from pg_proc where oid='public.m15_03_read_health_source(uuid,uuid,text,uuid)'::regprocedure));
select pg_temp.check('capped counts explicit', public.m15_03_queue('exports',10001,0,0,0,0,0,clock_timestamp(),clock_timestamp())->>'countRelation'='at_least' and public.m15_03_queue('exports',10001,0,0,0,0,0,clock_timestamp(),clock_timestamp())->>'pending'='10000');
do $$ declare o uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid(); u uuid; r jsonb; i uuid:=gen_random_uuid(); principal uuid:=gen_random_uuid(); k uuid:=gen_random_uuid(); obs jsonb; t timestamptz:=clock_timestamp()-interval '1 minute'; before_count bigint; begin
 select id into strict u from public.users where email='owner@cra.test';
 insert into public.organizations(id,name,slug) values(o,'M15-03 rollback health fixture','m15-03-'||o),(other_org,'M15-03 foreign fixture','m15-03-'||other_org);
 insert into public.organization_members(organization_id,user_id,role) values(o,u,'owner');
 r:=public.m15_03_read_health_source(o,u,'deadline_monitor',null);
 perform pg_temp.check('health owner allowed',r->>'outcome'='ready');
 perform pg_temp.check('foreign tenant denied',public.m15_03_read_health_source(other_org,u,'deadline_monitor',null)->>'outcome'='forbidden');
 insert into public.base_role_permission_overrides(organization_id,base_role,permissions) values(o,'owner','{"can_view_system_health":false}');
 perform pg_temp.check('health hard override immediate',public.m15_03_read_health_source(o,u,'deadline_monitor',null)->>'outcome'='forbidden');
 update public.base_role_permission_overrides set permissions='{"can_view_system_health":true,"can_view_reporting":false,"can_view_findings":false,"can_view_products":false,"can_view_licensing":false}' where organization_id=o;
 perform pg_temp.check('source permission withheld',public.m15_03_read_health_source(o,u,'deadline_monitor',null)->>'outcome'='withheld');
 perform pg_temp.check('licence permission withheld',public.m15_03_read_health_source(o,u,'usage_metering',null)->>'outcome'='withheld');
 perform pg_temp.check('product permission withheld',public.m15_03_read_health_source(o,u,'evidence_processing',null)->>'outcome'='withheld');
 update public.base_role_permission_overrides set permissions='{"can_view_system_health":true}' where organization_id=o;
 perform pg_temp.check('foreign/unknown product withheld',public.m15_03_read_health_source(o,u,'evidence_processing',gen_random_uuid())->>'outcome'='withheld');
 obs:=jsonb_build_object('schemaVersion',1,'instanceId',i,'revision',1,'sourceAt',public.m7_snapshot_timestamp_utc(t),'observedAt',public.m7_snapshot_timestamp_utc(t),'instance',jsonb_build_object('instanceId',i,'label','Rollback instance','status','healthy','version',null,'commit',null,'sources',jsonb_build_array(jsonb_build_object('source','local','status','healthy','sourceAt',public.m7_snapshot_timestamp_utc(t),'observedAt',public.m7_snapshot_timestamp_utc(t),'attemptedAt',public.m7_snapshot_timestamp_utc(t),'succeededAt',public.m7_snapshot_timestamp_utc(t),'receivedAt',public.m7_snapshot_timestamp_utc(t),'reasons','[]'::jsonb))),'tenants','[]'::jsonb,'nextCursor',null);
 obs:=jsonb_build_object('metadata',obs,'digest',encode(extensions.digest(public.m15_03_canonical_json(obs),'sha256'),'hex'));
 r:=public.m15_03_publish_observation(i,obs);
 perform pg_temp.check('publication applied',r->>'outcome'='published');
 perform pg_temp.check('same publication replay',public.m15_03_publish_observation(i,obs)->>'outcome'='replayed');
 perform pg_temp.check('changed digest rejected',public.m15_03_publish_observation(i,jsonb_set(obs,'{digest}',to_jsonb(repeat('b',64))))->>'outcome'='invalid');
 perform pg_temp.check('out of order withheld',public.m15_03_publish_observation(i,jsonb_set(obs,'{metadata,revision}','0'))->>'outcome'='invalid');
 perform pg_temp.check('wrong instance binding rejected',public.m15_03_publish_observation(gen_random_uuid(),obs)->>'outcome'='invalid');
 -- Digest-valid future entity metadata must not manufacture a fresh read.
 declare future_metadata jsonb;future_payload jsonb;begin
  future_metadata:=jsonb_set(obs->'metadata','{instance,lastObservedAt}',to_jsonb(public.m7_snapshot_timestamp_utc(clock_timestamp()+interval '1 day')));
  future_metadata:=jsonb_set(future_metadata,'{revision}','2');
  future_payload:=jsonb_build_object('metadata',future_metadata,'digest',encode(extensions.digest(public.m15_03_canonical_json(future_metadata),'sha256'),'hex'));
  perform pg_temp.check('future entity metadata rejected',public.m15_03_publish_observation(i,future_payload)->>'outcome'='invalid');
  future_metadata:=jsonb_set(obs->'metadata','{revision}','2');
  future_metadata:=jsonb_set(future_metadata,'{instance,sources}',(future_metadata#>'{instance,sources}')||jsonb_build_array(jsonb_set(future_metadata#>'{instance,sources,0}','{source}','"backups"')));
  future_payload:=jsonb_build_object('metadata',future_metadata,'digest',encode(extensions.digest(public.m15_03_canonical_json(future_metadata),'sha256'),'hex'));
  perform pg_temp.check('M15-05 absent backup authority remains unknown',public.m15_03_publish_observation(i,future_payload)->>'outcome'='invalid');
 end;
 r:=public.m15_03_record_poll_outcome(i,clock_timestamp(),'collection_unreachable');
 perform pg_temp.check('failure keeps last source/success',exists(select 1 from public.operator_registry_observations where instance_id=i and source_observed_at=public.m7_snapshot_timestamp_utc(t)::timestamptz and succeeded_at>=t and succeeded_at<clock_timestamp() and status='unreachable'));
 r:=public.m15_03_operator_read(principal,k,array[i],array[]::uuid[],'instances',null,null,50);
 perform pg_temp.check('scoped metadata read',jsonb_array_length(r->'instances')=1);
 perform pg_temp.check('security audit before disclosure',exists(select 1 from public.audit_logs where event_scope='security' and actor_type='operator' and actor_id=principal::text and correlation_id=k));
 r:=public.m15_03_operator_read(principal,gen_random_uuid(),array[]::uuid[],array[]::uuid[],'instances',null,null,50);
 perform pg_temp.check('empty scope no metadata',jsonb_array_length(r->'instances')=0);
 select count(*) into before_count from public.audit_logs where event_scope='security';
 -- An actual BEFORE INSERT failure must abort disclosure and its receipt.
 execute 'create function pg_temp.m15_03_fail_audit() returns trigger language plpgsql as $f$ begin if new.actor_id='''||principal||''' then raise exception ''fixture audit unavailable''; end if; return new; end $f$';
 execute 'create trigger m15_03_fixture_audit_failure before insert on public.audit_logs for each row execute function pg_temp.m15_03_fail_audit()';
 begin
  perform public.m15_03_operator_read(principal,gen_random_uuid(),array[i],array[]::uuid[],'instances',null,null,50);
  raise exception 'audit failure disclosed data';
 exception when raise_exception then if sqlerrm<>'fixture audit unavailable' then raise; end if; end;
 perform pg_temp.check('audit failure receipt rolled back',(select count(*) from public.audit_logs where event_scope='security')=before_count);
end $$;
do $$ declare o uuid:=gen_random_uuid();u uuid;entity uuid:=gen_random_uuid();p1 uuid:=gen_random_uuid();p2 uuid:=gen_random_uuid();d uuid:=gen_random_uuid();v uuid:=gen_random_uuid();r jsonb;begin
 select id into strict u from public.users where email='owner@cra.test';
 insert into public.organizations(id,name,slug) values(o,'M15-03 product aggregate rollback fixture','m15-03-product-'||o);
 insert into public.organization_members(organization_id,user_id,role) values(o,u,'owner');
 insert into public.organization_legal_entities(id,organization_id,identifier,display_name,completion_status,status,created_by,updated_by) values(entity,o,'fixture','Rollback fixture','needs_completion','inactive',u,u);
 -- Archived products avoid admitting unlicensed growth; source permissions and
 -- normal evidence relationships remain fully enabled for scope verification.
 insert into public.products(id,organization_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,name,internal_code,product_type,responsible_owner_id,archived_at,created_by,updated_by) values(p1,o,entity,0,'{}','Fixture one','one','component',u,clock_timestamp(),u,u),(p2,o,entity,0,'{}','Fixture two','two','component',u,clock_timestamp(),u,u);
 insert into public.evidence_documents(id,organization_id,created_by) values(d,o,u);
 insert into public.evidence_document_versions(id,organization_id,document_id,version_number,title,document_class,retention_evidence_class,owner_user_id,uploader_user_id,object_key,original_filename,declared_size_bytes,upload_expires_at,initialize_idempotency_key,initialize_request_digest) values(v,o,d,1,'Rollback scope fixture','certificate','evidence_document',u,u,'m15-03-rollback/'||v,'fixture.pdf',10,clock_timestamp()+interval '10 minutes',gen_random_uuid(),repeat('c',64));
 insert into public.evidence_document_version_products(organization_id,version_id,product_id) values(o,v,p1);
 insert into public.evidence_document_scan_jobs(organization_id,version_id) values(o,v);
 r:=public.m15_03_read_health_source(o,u,'evidence_processing',p1);
 perform pg_temp.check('own linked product work included',r#>>'{data,queue,pending}'='1');
 r:=public.m15_03_read_health_source(o,u,'evidence_processing',p2);
 perform pg_temp.check('other product work excluded',r#>>'{data,queue,pending}'='0');
 insert into public.base_role_permission_overrides(organization_id,base_role,permissions) values(o,'owner','{"can_view_system_health":true,"can_view_evidence":false}');
 perform pg_temp.check('source revocation hides previously included work',public.m15_03_read_health_source(o,u,'evidence_processing',p1)->>'outcome'='withheld');
end $$;
rollback;
